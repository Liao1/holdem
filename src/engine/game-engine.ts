import type {
  Player, GameState, PlayerAction, LogEntry, WinnerInfo,
  OnStateChange, OnActionRequest, OnAnimation, EvaluatedHand, Card,
} from './types';
import { GamePhase, ActionType } from './types';
import { BIG_BLIND, SMALL_BLIND, STARTING_CHIPS, BOT_NAMES } from './constants';
import { Deck } from './deck';
import { calculateLegalActions, validateAction } from './betting-engine';
import { buildSidePots, distributePots } from './pot-manager';
import { evaluateBestHand } from './hand-evaluator';

export class GameEngine {
  private state: GameState;
  private deck: Deck;
  private onStateChange: OnStateChange;
  private onActionRequest: OnActionRequest;
  private onAnimation: OnAnimation;
  private running = false;

  constructor(
    playerCount: number,
    onStateChange: OnStateChange,
    onActionRequest: OnActionRequest,
    onAnimation: OnAnimation,
  ) {
    this.onStateChange = onStateChange;
    this.onActionRequest = onActionRequest;
    this.onAnimation = onAnimation;
    this.deck = new Deck();

    const players: Player[] = [];

    // Human player at seat 0
    players.push({
      id: 'human',
      name: 'You',
      chips: STARTING_CHIPS,
      holeCards: [],
      currentBet: 0,
      totalBetThisHand: 0,
      hasActedThisRound: false,
      status: 'ACTIVE',
      seatIndex: 0,
      isHuman: true,
      isDealer: false,
    });

    // Bot players
    for (let i = 0; i < playerCount; i++) {
      players.push({
        id: `bot-${i}`,
        name: BOT_NAMES[i],
        chips: STARTING_CHIPS,
        holeCards: [],
        currentBet: 0,
        totalBetThisHand: 0,
        hasActedThisRound: false,
        status: 'ACTIVE',
        seatIndex: i + 1,
        isHuman: false,
        isDealer: false,
      });
    }

    this.state = {
      players,
      communityCards: [],
      pots: [],
      currentBet: 0,
      lastRaiseIncrement: BIG_BLIND,
      phase: GamePhase.WAITING,
      dealerIndex: -1,
      activePlayerIndex: -1,
      smallBlindIndex: -1,
      bigBlindIndex: -1,
      handNumber: 0,
      actionLog: [],
      winners: null,
      humanActionRequired: false,
      legalActions: [],
    };
  }

  getState(): GameState {
    return { ...this.state };
  }

  async startGame(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Pick initial dealer randomly
    const activePlayers = this.getActivePlayers();
    const randomIdx = Math.floor(Math.random() * activePlayers.length);
    this.state.dealerIndex = activePlayers[randomIdx].seatIndex;

    await this.gameLoop();
  }

  private async gameLoop(): Promise<void> {
    while (this.running) {
      const activePlayers = this.getPlayersInGame();
      if (activePlayers.length < 2) {
        this.state.phase = GamePhase.GAME_OVER;
        this.emitState();
        this.running = false;
        return;
      }

      await this.runHand();

      // Brief pause between hands
      await this.sleep(1500);
    }
  }

  private async runHand(): Promise<void> {
    this.initHand();
    await this.postBlinds();

    // Deal hole cards
    this.dealHoleCards();
    this.emitState();
    await this.onAnimation({ type: 'DEAL_HOLE_CARDS' });

    const phases: GamePhase[] = [GamePhase.PRE_FLOP, GamePhase.FLOP, GamePhase.TURN, GamePhase.RIVER];

    for (const phase of phases) {
      this.state.phase = phase;

      if (phase !== GamePhase.PRE_FLOP) {
        await this.dealCommunityCards(phase);
      }

      this.emitState();

      // Check if only one player remains
      if (this.getUnfoldedPlayers().length <= 1) {
        await this.awardLastPlayer();
        await this.cleanup();
        return;
      }

      // If no active players can act (all all-in or folded except <=1), skip betting
      if (this.getActivePlayers().length <= 1) {
        continue;
      }

      const allFolded = await this.runBettingRound(phase);
      if (allFolded) {
        await this.awardLastPlayer();
        await this.cleanup();
        return;
      }

      // After betting, if all remaining players are all-in, deal remaining boards
      if (this.getActivePlayers().length <= 1 && this.getUnfoldedPlayers().length > 1) {
        const remainingPhases = phases.slice(phases.indexOf(phase) + 1);
        for (const rp of remainingPhases) {
          this.state.phase = rp;
          await this.dealCommunityCards(rp);
          this.emitState();
          await this.sleep(600);
        }
        break;
      }
    }

    await this.showdown();
    await this.cleanup();
  }

  private initHand(): void {
    this.state.handNumber++;
    this.state.phase = GamePhase.HAND_INIT;
    this.state.communityCards = [];
    this.state.pots = [];
    this.state.currentBet = 0;
    this.state.lastRaiseIncrement = BIG_BLIND;
    this.state.winners = null;
    this.state.humanActionRequired = false;
    this.state.legalActions = [];

    // Reset all players for new hand
    for (const player of this.state.players) {
      if (player.status !== 'BUSTED') {
        player.status = 'ACTIVE';
      }
      player.holeCards = [];
      player.currentBet = 0;
      player.totalBetThisHand = 0;
      player.hasActedThisRound = false;
      player.isDealer = false;
    }

    // Move dealer button
    this.moveDealer();

    // Set blinds
    const playersInGame = this.getPlayersInGame();
    const dealerPos = playersInGame.findIndex(p => p.seatIndex === this.state.dealerIndex);

    if (playersInGame.length === 2) {
      // Heads-up: dealer = SB, other = BB
      this.state.smallBlindIndex = playersInGame[dealerPos].seatIndex;
      this.state.bigBlindIndex = playersInGame[(dealerPos + 1) % 2].seatIndex;
    } else {
      this.state.smallBlindIndex = playersInGame[(dealerPos + 1) % playersInGame.length].seatIndex;
      this.state.bigBlindIndex = playersInGame[(dealerPos + 2) % playersInGame.length].seatIndex;
    }

    this.state.players.find(p => p.seatIndex === this.state.dealerIndex)!.isDealer = true;

    // Reset deck
    this.deck.reset();
    this.emitState();
  }

  private moveDealer(): void {
    const playersInGame = this.getPlayersInGame();
    if (playersInGame.length === 0) return;

    if (this.state.dealerIndex === -1) {
      this.state.dealerIndex = playersInGame[0].seatIndex;
      return;
    }

    // Find next player in game after current dealer
    const currentDealerSeat = this.state.dealerIndex;
    const totalSeats = this.state.players.length;
    for (let offset = 1; offset <= totalSeats; offset++) {
      const nextSeat = (currentDealerSeat + offset) % totalSeats;
      const player = this.state.players.find(p => p.seatIndex === nextSeat);
      if (player && player.status !== 'BUSTED') {
        this.state.dealerIndex = nextSeat;
        return;
      }
    }
  }

  private async postBlinds(): Promise<void> {
    const sbPlayer = this.state.players.find(p => p.seatIndex === this.state.smallBlindIndex)!;
    const bbPlayer = this.state.players.find(p => p.seatIndex === this.state.bigBlindIndex)!;

    // Post small blind
    const sbAmount = Math.min(SMALL_BLIND, sbPlayer.chips);
    this.postBlind(sbPlayer, sbAmount);
    this.addLog(sbPlayer, ActionType.POST_SB, sbAmount);

    // Post big blind
    const bbAmount = Math.min(BIG_BLIND, bbPlayer.chips);
    this.postBlind(bbPlayer, bbAmount);
    this.addLog(bbPlayer, ActionType.POST_BB, bbAmount);

    this.state.currentBet = BIG_BLIND;
    this.state.lastRaiseIncrement = BIG_BLIND;

    // Build initial pot
    this.state.pots = buildSidePots(this.state.players);
    this.emitState();
  }

  /** Place a blind bet. Does NOT auto-set ALL_IN status. */
  private postBlind(player: Player, amount: number): void {
    const actual = Math.min(amount, player.chips);
    player.chips -= actual;
    player.currentBet += actual;
    player.totalBetThisHand += actual;
    // If player can't cover the blind, mark as all-in
    if (player.chips === 0) {
      player.status = 'ALL_IN';
    }
  }

  private dealHoleCards(): void {
    // Deal 2 cards to each player, starting left of dealer
    for (let round = 0; round < 2; round++) {
      for (const player of this.getDealtOrder()) {
        player.holeCards.push(this.deck.draw());
      }
    }
  }

  private async dealCommunityCards(phase: GamePhase): Promise<void> {
    this.deck.burn();

    switch (phase) {
      case GamePhase.FLOP: {
        const cards: Card[] = [this.deck.draw(), this.deck.draw(), this.deck.draw()];
        this.state.communityCards.push(...cards);
        this.emitState();
        await this.onAnimation({ type: 'DEAL_FLOP', cards });
        break;
      }
      case GamePhase.TURN: {
        const card = this.deck.draw();
        this.state.communityCards.push(card);
        this.emitState();
        await this.onAnimation({ type: 'DEAL_TURN', card });
        break;
      }
      case GamePhase.RIVER: {
        const card = this.deck.draw();
        this.state.communityCards.push(card);
        this.emitState();
        await this.onAnimation({ type: 'DEAL_RIVER', card });
        break;
      }
    }
  }

  private async runBettingRound(phase: GamePhase): Promise<boolean> {
    // For post-flop rounds, reset currentBet and player currentBets
    if (phase !== GamePhase.PRE_FLOP) {
      for (const player of this.state.players) {
        player.currentBet = 0;
      }
      this.state.currentBet = 0;
      this.state.lastRaiseIncrement = BIG_BLIND;
    }

    // Reset hasActedThisRound for all active players
    for (const player of this.state.players) {
      if (player.status === 'ACTIVE') {
        player.hasActedThisRound = false;
      }
    }

    // Determine acting order
    const actingOrder = this.getActingOrder(phase);
    let cursor = 0;

    while (true) {
      const activePlayers = this.getActivePlayers();
      if (activePlayers.length === 0) break;

      // Check if betting round is complete
      const allActed = activePlayers.every(p => p.hasActedThisRound);
      const allBetsEqual = activePlayers.every(p => p.currentBet === this.state.currentBet);
      if (allActed && allBetsEqual) break;

      // Find next active player to act from the acting order, starting from cursor
      const { player: nextPlayer, index: playerIdx } = this.findNextToAct(actingOrder, cursor);
      if (!nextPlayer || playerIdx === -1) break;

      this.state.activePlayerIndex = nextPlayer.seatIndex;
      const legalActions = calculateLegalActions(nextPlayer, this.state);

      if (legalActions.length === 0) {
        nextPlayer.hasActedThisRound = true;
        cursor = (playerIdx + 1) % actingOrder.length;
        continue;
      }

      this.emitState();

      // Request action
      const rawAction = await this.onActionRequest(nextPlayer.id, legalActions);
      const action = validateAction(rawAction, legalActions, nextPlayer, this.state);

      // Apply action
      this.applyAction(nextPlayer, action);

      // Advance cursor to position after current player
      cursor = (playerIdx + 1) % actingOrder.length;

      // Check if only one unfolded player remains
      if (this.getUnfoldedPlayers().length <= 1) {
        return true;
      }
    }

    this.state.activePlayerIndex = -1;
    this.state.humanActionRequired = false;
    this.emitState();
    return false;
  }

  private applyAction(player: Player, action: { type: ActionType; amount: number }): void {
    let logAmount = action.amount;

    switch (action.type) {
      case ActionType.FOLD:
        player.status = 'FOLDED';
        logAmount = 0;
        break;

      case ActionType.CHECK:
        logAmount = 0;
        break;

      case ActionType.CALL: {
        const callAmount = this.state.currentBet - player.currentBet;
        const actual = Math.min(callAmount, player.chips);
        this.placeBet(player, actual);
        logAmount = actual;
        break;
      }

      case ActionType.BET: {
        const betAmount = action.amount;
        this.placeBet(player, betAmount);
        this.state.lastRaiseIncrement = betAmount;
        this.state.currentBet = player.currentBet;
        this.reopenAction(player);
        logAmount = betAmount;
        break;
      }

      case ActionType.RAISE: {
        // action.amount is the total raise-to amount
        const raiseTotal = action.amount;
        const raiseIncrement = raiseTotal - this.state.currentBet;
        const amountToAdd = raiseTotal - player.currentBet;

        this.placeBet(player, amountToAdd);
        this.state.currentBet = raiseTotal;

        if (raiseIncrement >= this.state.lastRaiseIncrement) {
          this.state.lastRaiseIncrement = raiseIncrement;
        }
        this.reopenAction(player);
        logAmount = raiseTotal;
        break;
      }

      case ActionType.ALL_IN: {
        const allInAmount = player.chips;
        const newTotal = player.currentBet + allInAmount;
        this.placeBet(player, allInAmount);
        player.status = 'ALL_IN';

        if (newTotal > this.state.currentBet) {
          const raiseIncrement = newTotal - this.state.currentBet;
          this.state.currentBet = newTotal;

          if (raiseIncrement >= this.state.lastRaiseIncrement) {
            this.state.lastRaiseIncrement = raiseIncrement;
            this.reopenAction(player);
          }
          // Incomplete raise: don't re-open already acted players
        }
        logAmount = allInAmount;
        break;
      }
    }

    player.hasActedThisRound = true;
    this.addLog(player, action.type, logAmount);

    // Build pots after each action
    this.state.pots = buildSidePots(this.state.players);

    this.emitState();
  }

  private reopenAction(excludePlayer: Player): void {
    for (const p of this.state.players) {
      if (p.id !== excludePlayer.id && p.status === 'ACTIVE') {
        p.hasActedThisRound = false;
      }
    }
  }

  private placeBet(player: Player, amount: number): void {
    const actual = Math.min(amount, player.chips);
    player.chips -= actual;
    player.currentBet += actual;
    player.totalBetThisHand += actual;
  }

  private async awardLastPlayer(): Promise<void> {
    const remaining = this.getUnfoldedPlayers();
    if (remaining.length !== 1) return;

    const winner = remaining[0];
    this.state.pots = buildSidePots(this.state.players);
    const totalPot = this.state.pots.reduce((sum, p) => sum + p.amount, 0);

    winner.chips += totalPot;
    this.state.winners = [{
      playerId: winner.id,
      playerName: winner.name,
      amount: totalPot,
      potIndex: 0,
    }];

    this.state.phase = GamePhase.SHOWDOWN;
    this.emitState();
    await this.onAnimation({ type: 'AWARD_POT', winnerId: winner.id, amount: totalPot });
    await this.sleep(2000);
  }

  private async showdown(): Promise<void> {
    this.state.phase = GamePhase.SHOWDOWN;
    this.state.pots = buildSidePots(this.state.players);

    const playerHands = new Map<string, EvaluatedHand>();
    const showdownPlayers: Array<{ playerId: string; hand: EvaluatedHand }> = [];

    for (const player of this.getUnfoldedPlayers()) {
      if (player.holeCards.length === 2) {
        const hand = evaluateBestHand(player.holeCards, this.state.communityCards);
        playerHands.set(player.id, hand);
        showdownPlayers.push({ playerId: player.id, hand });
      }
    }

    this.emitState();
    await this.onAnimation({ type: 'SHOWDOWN', playerHands: showdownPlayers });

    const winners = distributePots(
      this.state.pots,
      playerHands,
      this.state.players,
      this.state.dealerIndex,
    );

    // Award chips
    for (const w of winners) {
      const player = this.state.players.find(p => p.id === w.playerId)!;
      player.chips += w.amount;
    }

    this.state.winners = winners;
    this.emitState();

    await this.sleep(3000);
  }

  private async cleanup(): Promise<void> {
    this.state.phase = GamePhase.CLEANUP;

    // Mark busted players
    for (const player of this.state.players) {
      if (player.chips <= 0 && player.status !== 'BUSTED') {
        player.status = 'BUSTED';
      }
    }

    // Check game over
    const remaining = this.getPlayersInGame();
    if (remaining.length < 2) {
      this.state.phase = GamePhase.GAME_OVER;
      this.running = false;
    }

    this.emitState();
  }

  // ── Player query helpers ──────────────────────────────────

  private getPlayersInGame(): Player[] {
    return this.state.players.filter(p => p.status !== 'BUSTED');
  }

  private getActivePlayers(): Player[] {
    return this.state.players.filter(p => p.status === 'ACTIVE');
  }

  private getUnfoldedPlayers(): Player[] {
    return this.state.players.filter(p => p.status === 'ACTIVE' || p.status === 'ALL_IN');
  }

  /** Get deal order: starting from left of dealer */
  private getDealtOrder(): Player[] {
    const inGame = this.getPlayersInGame();
    const dealerIdx = inGame.findIndex(p => p.seatIndex === this.state.dealerIndex);
    const ordered: Player[] = [];
    for (let i = 1; i <= inGame.length; i++) {
      ordered.push(inGame[(dealerIdx + i) % inGame.length]);
    }
    return ordered;
  }

  /** Determine acting order for a betting round */
  private getActingOrder(phase: GamePhase): Player[] {
    const playersInGame = this.getPlayersInGame();
    const isHeadsUp = playersInGame.length === 2;

    let startSeatIndex: number;

    if (phase === GamePhase.PRE_FLOP) {
      if (isHeadsUp) {
        // Heads-up pre-flop: BTN/SB acts first
        startSeatIndex = this.state.smallBlindIndex;
      } else {
        // UTG: first player after BB
        const bbIdx = playersInGame.findIndex(p => p.seatIndex === this.state.bigBlindIndex);
        startSeatIndex = playersInGame[(bbIdx + 1) % playersInGame.length].seatIndex;
      }
    } else {
      if (isHeadsUp) {
        // Heads-up post-flop: BB acts first
        startSeatIndex = this.state.bigBlindIndex;
      } else {
        // Post-flop: first player left of dealer
        const dealerIdx = playersInGame.findIndex(p => p.seatIndex === this.state.dealerIndex);
        startSeatIndex = playersInGame[(dealerIdx + 1) % playersInGame.length].seatIndex;
      }
    }

    // Build ordered list starting from startSeatIndex
    const startIdx = playersInGame.findIndex(p => p.seatIndex === startSeatIndex);
    const ordered: Player[] = [];
    for (let i = 0; i < playersInGame.length; i++) {
      ordered.push(playersInGame[(startIdx + i) % playersInGame.length]);
    }
    return ordered;
  }

  /** Find next player who needs to act in the acting order, starting from a given position */
  private findNextToAct(actingOrder: Player[], startFrom: number): { player: Player | null; index: number } {
    const len = actingOrder.length;
    for (let i = 0; i < len; i++) {
      const idx = (startFrom + i) % len;
      const player = actingOrder[idx];
      if (player.status === 'ACTIVE' && (!player.hasActedThisRound || player.currentBet < this.state.currentBet)) {
        return { player, index: idx };
      }
    }
    return { player: null, index: -1 };
  }

  // ── Utility ────────────────────────────────────────────────

  private addLog(player: Player, action: ActionType, amount: number): void {
    this.state.actionLog.push({
      playerId: player.id,
      playerName: player.name,
      action,
      amount,
      phase: this.state.phase,
      handNumber: this.state.handNumber,
    });
  }

  private emitState(): void {
    this.onStateChange({ ...this.state });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
