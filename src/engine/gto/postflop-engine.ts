import type { Player, GameState, PlayerAction, LegalAction } from '../types';
import { ActionType, GamePhase } from '../types';
import { BIG_BLIND } from '../constants';
import { HandCategory } from './types';
import type { HandAnalysis, BoardTexture } from './types';
import { analyzeHand } from './hand-analysis';
import { analyzeBoardTexture } from './board-texture';
import { isInPosition, countActivePlayers } from './position';
import { calculateBetSize } from './bet-sizing';
import { solve } from './solver/solver-bridge';
import type { SolverAction } from './solver/solver-bridge';
import { boardToSolverIds, findHandInPrivateCards } from './solver/card-adapter';
import { buildRanges } from './solver/range-builder';

/**
 * Make a postflop decision based on hand analysis, board texture, and game context.
 * In heads-up pots, attempts to use the WASM CFR solver for GTO-accurate play.
 * Falls back to heuristics for multiway pots or when the solver is unavailable.
 */
export async function getPostflopAction(
  player: Player,
  gameState: GameState,
  legalActions: LegalAction[],
): Promise<PlayerAction> {
  const numActive = countActivePlayers(gameState);

  // Use solver only for heads-up pots
  if (numActive === 2) {
    const solverResult = await trySolverAction(player, gameState, legalActions);
    if (solverResult) return solverResult;
  }

  // Fallback: heuristic for multiway pots or solver failure
  return getHeuristicAction(player, gameState, legalActions);
}

/**
 * Attempt to get a solver-based action for heads-up pots.
 */
async function trySolverAction(
  player: Player,
  gameState: GameState,
  legalActions: LegalAction[],
): Promise<PlayerAction | null> {
  try {
    // Identify OOP and IP players
    const activePlayers = gameState.players.filter(
      p => p.status === 'ACTIVE' || p.status === 'ALL_IN',
    );
    if (activePlayers.length !== 2) return null;

    const ip = isInPosition(player, gameState);
    const opponent = activePlayers.find(p => p.id !== player.id);
    if (!opponent) return null;

    const oopPlayer = ip ? opponent.id : player.id;
    const ipPlayer = ip ? player.id : opponent.id;

    // Build ranges from preflop action
    const { oopRange, ipRange } = buildRanges(gameState, oopPlayer, ipPlayer);

    // Convert board to solver IDs
    const board = boardToSolverIds(gameState.communityCards);

    // Calculate starting pot and effective stack
    const startingPot = getTotalPot(gameState);
    const oopObj = gameState.players.find(p => p.id === oopPlayer)!;
    const ipObj = gameState.players.find(p => p.id === ipPlayer)!;
    const effectiveStack = Math.min(
      oopObj.chips + oopObj.currentBet,
      ipObj.chips + ipObj.currentBet,
    );

    // Solve
    const result = await solve(oopRange, ipRange, board, startingPot, effectiveStack);
    if (!result) return null;

    // Find the bot's hand in the solver's private cards
    const handIdx = findHandInPrivateCards(player.holeCards, result.privateCards);
    if (handIdx < 0) return null;

    // Read the strategy for this hand
    const numActions = result.actions.length;
    const handStrategy: number[] = [];
    for (let a = 0; a < numActions; a++) {
      handStrategy.push(result.strategy[a * result.numHands + handIdx]);
    }

    // Sample an action according to the strategy probabilities
    const chosenIdx = sampleAction(handStrategy);
    const chosenSolverAction = result.actions[chosenIdx];

    // Map solver action → game action
    return mapSolverAction(chosenSolverAction, player, legalActions);
  } catch (e) {
    console.warn('[PostflopEngine] Solver failed, using heuristic:', e);
    return null;
  }
}

/**
 * Sample an action index from a probability distribution.
 */
function sampleAction(probabilities: number[]): number {
  const total = probabilities.reduce((sum, p) => sum + p, 0);
  if (total <= 0) return 0;

  let roll = Math.random() * total;
  for (let i = 0; i < probabilities.length; i++) {
    roll -= probabilities[i];
    if (roll <= 0) return i;
  }
  return probabilities.length - 1;
}

/**
 * Map a solver action to a game PlayerAction.
 */
function mapSolverAction(
  solverAction: SolverAction,
  player: Player,
  legalActions: LegalAction[],
): PlayerAction {
  const playerId = player.id;

  switch (solverAction.type) {
    case 'Fold': {
      // Never fold if we can check
      if (legalActions.some(a => a.type === ActionType.CHECK)) {
        return { type: ActionType.CHECK, amount: 0, playerId };
      }
      return { type: ActionType.FOLD, amount: 0, playerId };
    }

    case 'Check':
      return { type: ActionType.CHECK, amount: 0, playerId };

    case 'Call': {
      const call = legalActions.find(a => a.type === ActionType.CALL);
      if (call) {
        return { type: ActionType.CALL, amount: call.callAmount || 0, playerId };
      }
      return { type: ActionType.CHECK, amount: 0, playerId };
    }

    case 'Bet': {
      const bet = legalActions.find(a => a.type === ActionType.BET);
      if (bet) {
        const min = bet.minAmount || 0;
        const max = bet.maxAmount || min;
        const clamped = Math.min(Math.max(solverAction.amount, min), max);
        return { type: ActionType.BET, amount: clamped, playerId };
      }
      // Fallback to check
      return { type: ActionType.CHECK, amount: 0, playerId };
    }

    case 'Raise': {
      const raise = legalActions.find(a => a.type === ActionType.RAISE);
      if (raise) {
        const min = raise.minAmount || 0;
        const max = raise.maxAmount || min;
        const clamped = Math.min(Math.max(solverAction.amount, min), max);
        return { type: ActionType.RAISE, amount: clamped, playerId };
      }
      // Fallback to call
      const call = legalActions.find(a => a.type === ActionType.CALL);
      if (call) {
        return { type: ActionType.CALL, amount: call.callAmount || 0, playerId };
      }
      return { type: ActionType.CHECK, amount: 0, playerId };
    }

    case 'Allin': {
      const allIn = legalActions.find(a => a.type === ActionType.ALL_IN);
      if (allIn) {
        return { type: ActionType.ALL_IN, amount: allIn.maxAmount || player.chips, playerId };
      }
      // Fallback: try raise to max
      const raise = legalActions.find(a => a.type === ActionType.RAISE);
      if (raise) {
        return { type: ActionType.RAISE, amount: raise.maxAmount || 0, playerId };
      }
      const call = legalActions.find(a => a.type === ActionType.CALL);
      if (call) {
        return { type: ActionType.CALL, amount: call.callAmount || 0, playerId };
      }
      return { type: ActionType.CHECK, amount: 0, playerId };
    }
  }
}

/**
 * Heuristic-based postflop action (original logic).
 * Used for multiway pots and as fallback when solver is unavailable.
 */
function getHeuristicAction(
  player: Player,
  gameState: GameState,
  legalActions: LegalAction[],
): PlayerAction {
  const analysis = analyzeHand(player.holeCards, gameState.communityCards);
  const texture = analyzeBoardTexture(gameState.communityCards);
  const ip = isInPosition(player, gameState);
  const numActive = countActivePlayers(gameState);
  const hasInitiative = checkInitiative(player, gameState);
  const street = getStreet(gameState.phase);
  const facingBet = isFacingBet(legalActions);
  const potOdds = calculatePotOdds(gameState, legalActions);

  let actionType: ActionType;
  let amount: number;

  if (facingBet) {
    ({ actionType, amount } = decideFacingBet(
      analysis, texture, player, gameState, legalActions, ip, numActive, street, potOdds
    ));
  } else {
    ({ actionType, amount } = decideInitiating(
      analysis, texture, player, gameState, legalActions, ip, numActive, hasInitiative, street
    ));
  }

  // Ensure action is legal
  const legal = legalActions.find(a => a.type === actionType);
  if (!legal) {
    const canCheck = legalActions.find(a => a.type === ActionType.CHECK);
    if (canCheck) return { type: ActionType.CHECK, amount: 0, playerId: player.id };
    return { type: ActionType.FOLD, amount: 0, playerId: player.id };
  }

  return { type: actionType, amount, playerId: player.id };
}

// ── Facing a bet ───────────────────────────────────────────

function decideFacingBet(
  analysis: HandAnalysis,
  texture: BoardTexture,
  player: Player,
  gameState: GameState,
  legalActions: LegalAction[],
  ip: boolean,
  numActive: number,
  street: 'FLOP' | 'TURN' | 'RIVER',
  potOdds: number,
): { actionType: ActionType; amount: number } {
  const { category, draws } = analysis;
  const multiplayerFactor = getMultiplayerBluffFactor(numActive);

  // Street aggression factor (later streets → tighter)
  const streetFactor = street === 'FLOP' ? 1.0 : street === 'TURN' ? 0.75 : 0.55;

  switch (category) {
    case HandCategory.PREMIUM: {
      // Raise most of the time
      const raiseFreq = 0.85 * streetFactor;
      if (rollCheck(raiseFreq)) {
        return raiseAction(player, gameState, legalActions);
      }
      return callAction(legalActions);
    }

    case HandCategory.STRONG: {
      // Call most, occasionally raise
      const raiseFreq = 0.15 * streetFactor;
      if (rollCheck(raiseFreq)) {
        return raiseAction(player, gameState, legalActions);
      }
      return callAction(legalActions);
    }

    case HandCategory.MONSTER_DRAW: {
      // Semi-bluff raise often, otherwise call
      const raiseFreq = 0.55 * streetFactor * multiplayerFactor;
      if (street !== 'RIVER' && rollCheck(raiseFreq)) {
        return raiseAction(player, gameState, legalActions);
      }
      // On river, draws missed → fold or bluff
      if (street === 'RIVER') {
        const bluffFreq = 0.25 * multiplayerFactor;
        if (rollCheck(bluffFreq)) {
          return raiseAction(player, gameState, legalActions);
        }
        return foldAction(legalActions);
      }
      return callAction(legalActions);
    }

    case HandCategory.STRONG_DRAW: {
      // Use pot odds and rule of 2/4 to decide
      const outs = draws.outs;
      const equityApprox = street === 'FLOP'
        ? Math.min(outs * 4, 60) / 100  // rule of 4 on flop
        : Math.min(outs * 2, 50) / 100; // rule of 2 on turn

      if (potOdds > 0 && equityApprox > (1 / (1 + potOdds))) {
        // Getting correct odds, call
        return callAction(legalActions);
      }

      // Semi-bluff raise sometimes when equity is close
      const semiBluffFreq = ip ? 0.40 : 0.25;
      if (street !== 'RIVER' && rollCheck(semiBluffFreq * multiplayerFactor)) {
        return raiseAction(player, gameState, legalActions);
      }

      // On river with missed draw, fold
      if (street === 'RIVER') {
        return foldAction(legalActions);
      }

      // Getting incorrect odds but implied odds might be there
      if (equityApprox > 0.15) {
        return callAction(legalActions);
      }
      return foldAction(legalActions);
    }

    case HandCategory.MARGINAL: {
      // Use minimum defense frequency concept
      // MDF = 1 - (bet / (pot + bet))
      const mdf = calculateMDF(gameState, legalActions);
      const callFreq = Math.min(mdf + (ip ? 0.05 : -0.05), 0.7);

      if (rollCheck(callFreq * streetFactor)) {
        return callAction(legalActions);
      }
      return foldAction(legalActions);
    }

    case HandCategory.WEAK: {
      // Mostly fold, occasionally call on flop with position
      if (street === 'FLOP' && ip && rollCheck(0.2)) {
        return callAction(legalActions);
      }
      return foldAction(legalActions);
    }

    case HandCategory.WEAK_DRAW: {
      // Check pot odds for gutshot
      if (street !== 'RIVER' && potOdds > 10) {
        return callAction(legalActions); // Great odds for gutshot
      }
      if (street === 'FLOP' && rollCheck(0.15)) {
        return callAction(legalActions);
      }
      return foldAction(legalActions);
    }

    case HandCategory.TRASH:
    default:
      return foldAction(legalActions);
  }
}

// ── Initiating action (no bet to face) ─────────────────────

function decideInitiating(
  analysis: HandAnalysis,
  texture: BoardTexture,
  player: Player,
  gameState: GameState,
  legalActions: LegalAction[],
  ip: boolean,
  numActive: number,
  hasInitiative: boolean,
  street: 'FLOP' | 'TURN' | 'RIVER',
): { actionType: ActionType; amount: number } {
  const { category } = analysis;
  const isDry = texture.category === 'DRY' || texture.category === 'SEMI_DRY';
  const multiplayerCbet = getMultiplayerCbetFactor(numActive);
  const multiplayerBluff = getMultiplayerBluffFactor(numActive);
  const streetFactor = street === 'FLOP' ? 1.0 : street === 'TURN' ? 0.75 : 0.55;

  // C-bet opportunity
  const isCbet = hasInitiative;

  switch (category) {
    case HandCategory.PREMIUM:
    case HandCategory.STRONG: {
      // Value bet most of the time
      const betFreq = 0.85 * streetFactor;
      if (rollCheck(betFreq)) {
        return betAction('value', player, gameState, legalActions);
      }
      return checkAction(legalActions);
    }

    case HandCategory.MARGINAL: {
      let betFreq: number;
      if (isCbet) {
        betFreq = (isDry ? 0.55 : 0.35) * multiplayerCbet * streetFactor;
      } else {
        betFreq = (ip ? 0.30 : 0.15) * streetFactor;
      }
      if (rollCheck(betFreq)) {
        return betAction('cbet', player, gameState, legalActions);
      }
      return checkAction(legalActions);
    }

    case HandCategory.MONSTER_DRAW: {
      // Bet as semi-bluff most of the time
      const betFreq = 0.80 * multiplayerCbet * streetFactor;
      if (street !== 'RIVER' && rollCheck(betFreq)) {
        return betAction('semibluff', player, gameState, legalActions);
      }
      // River: bluff some fraction
      if (street === 'RIVER') {
        if (rollCheck(0.30 * multiplayerBluff)) {
          return betAction('semibluff', player, gameState, legalActions);
        }
      }
      return checkAction(legalActions);
    }

    case HandCategory.STRONG_DRAW: {
      const betFreq = (ip ? 0.65 : 0.50) * multiplayerCbet * streetFactor;
      if (street !== 'RIVER' && rollCheck(betFreq)) {
        return betAction('semibluff', player, gameState, legalActions);
      }
      return checkAction(legalActions);
    }

    case HandCategory.WEAK_DRAW: {
      // Small c-bet bluff occasionally on dry boards
      if (isCbet && isDry && street === 'FLOP' && rollCheck(0.30 * multiplayerBluff)) {
        return betAction('cbet', player, gameState, legalActions);
      }
      return checkAction(legalActions);
    }

    case HandCategory.WEAK: {
      // Occasional stab with ace-high
      if (isCbet && street === 'FLOP' && rollCheck(0.25 * multiplayerBluff)) {
        return betAction('cbet', player, gameState, legalActions);
      }
      return checkAction(legalActions);
    }

    case HandCategory.TRASH: {
      // Bluff on dry boards with initiative
      if (isCbet) {
        const bluffFreq = (isDry ? 0.45 : 0.10) * multiplayerBluff * streetFactor;
        if (rollCheck(bluffFreq)) {
          return betAction('cbet', player, gameState, legalActions);
        }
      }
      return checkAction(legalActions);
    }

    default:
      return checkAction(legalActions);
  }
}

// ── Helpers ────────────────────────────────────────────────

function rollCheck(probability: number): boolean {
  return Math.random() < probability;
}

function getStreet(phase: GamePhase): 'FLOP' | 'TURN' | 'RIVER' {
  switch (phase) {
    case GamePhase.FLOP: return 'FLOP';
    case GamePhase.TURN: return 'TURN';
    case GamePhase.RIVER: return 'RIVER';
    default: return 'FLOP';
  }
}

function isFacingBet(legalActions: LegalAction[]): boolean {
  return legalActions.some(a => a.type === ActionType.CALL || a.type === ActionType.FOLD);
}

function calculatePotOdds(gameState: GameState, legalActions: LegalAction[]): number {
  const callAction = legalActions.find(a => a.type === ActionType.CALL);
  if (!callAction || !callAction.callAmount) return 0;

  const potSize = getTotalPot(gameState);
  return potSize / callAction.callAmount;
}

function calculateMDF(gameState: GameState, legalActions: LegalAction[]): number {
  const callAction = legalActions.find(a => a.type === ActionType.CALL);
  if (!callAction || !callAction.callAmount) return 0.5;

  const potSize = getTotalPot(gameState);
  // MDF = 1 - bet/(pot + bet)
  // Approximation: pot before the bet ≈ potSize - callAmount
  const potBeforeBet = Math.max(potSize - callAction.callAmount, 1);
  return 1 - (callAction.callAmount / (potBeforeBet + callAction.callAmount));
}

function getTotalPot(gameState: GameState): number {
  let total = 0;
  for (const pot of gameState.pots) {
    total += pot.amount;
  }
  for (const p of gameState.players) {
    total += p.currentBet;
  }
  return Math.max(total, BIG_BLIND);
}

/**
 * Check if this player had the last aggressive action on the previous street.
 */
function checkInitiative(player: Player, gameState: GameState): boolean {
  const currentPhase = gameState.phase;
  let prevPhase: GamePhase;

  switch (currentPhase) {
    case GamePhase.FLOP: prevPhase = GamePhase.PRE_FLOP; break;
    case GamePhase.TURN: prevPhase = GamePhase.FLOP; break;
    case GamePhase.RIVER: prevPhase = GamePhase.TURN; break;
    default: return false;
  }

  const prevActions = gameState.actionLog.filter(
    e => e.phase === prevPhase && e.handNumber === gameState.handNumber
  );

  // Find last aggressive action
  for (let i = prevActions.length - 1; i >= 0; i--) {
    const action = prevActions[i].action;
    if (action === ActionType.RAISE || action === ActionType.BET || action === ActionType.ALL_IN) {
      return prevActions[i].playerId === player.id;
    }
  }

  return false;
}

/**
 * Multiplayer adjustment for c-bet frequency.
 */
function getMultiplayerCbetFactor(numActive: number): number {
  if (numActive <= 2) return 1.0;
  if (numActive === 3) return 0.6;
  return 0.35; // 4+ players
}

/**
 * Multiplayer adjustment for bluff frequency.
 */
function getMultiplayerBluffFactor(numActive: number): number {
  if (numActive <= 2) return 1.0;
  if (numActive === 3) return 0.5;
  return 0.2; // 4+ players
}

// ── Action builders ────────────────────────────────────────

function checkAction(legalActions: LegalAction[]): { actionType: ActionType; amount: number } {
  if (legalActions.some(a => a.type === ActionType.CHECK)) {
    return { actionType: ActionType.CHECK, amount: 0 };
  }
  return { actionType: ActionType.FOLD, amount: 0 };
}

function foldAction(legalActions: LegalAction[]): { actionType: ActionType; amount: number } {
  // Never fold if we can check
  if (legalActions.some(a => a.type === ActionType.CHECK)) {
    return { actionType: ActionType.CHECK, amount: 0 };
  }
  if (legalActions.some(a => a.type === ActionType.FOLD)) {
    return { actionType: ActionType.FOLD, amount: 0 };
  }
  return { actionType: ActionType.CHECK, amount: 0 };
}

function callAction(legalActions: LegalAction[]): { actionType: ActionType; amount: number } {
  const call = legalActions.find(a => a.type === ActionType.CALL);
  if (call) {
    return { actionType: ActionType.CALL, amount: call.callAmount || 0 };
  }
  // Can't call → check
  return checkAction(legalActions);
}

function raiseAction(
  player: Player,
  gameState: GameState,
  legalActions: LegalAction[],
): { actionType: ActionType; amount: number } {
  const raise = legalActions.find(a => a.type === ActionType.RAISE);
  if (raise) {
    const facingBet = gameState.currentBet - player.currentBet;
    const size = calculateBetSize(gameState, 'raise', facingBet);
    const min = raise.minAmount || 0;
    const max = raise.maxAmount || min;
    const clamped = Math.min(Math.max(size, min), max);
    return { actionType: ActionType.RAISE, amount: clamped };
  }

  // Try all-in if no raise available
  const allIn = legalActions.find(a => a.type === ActionType.ALL_IN);
  if (allIn) {
    return { actionType: ActionType.ALL_IN, amount: allIn.maxAmount || player.chips };
  }

  // Fallback to call
  return callAction(legalActions);
}

function betAction(
  purpose: 'cbet' | 'value' | 'semibluff',
  player: Player,
  gameState: GameState,
  legalActions: LegalAction[],
): { actionType: ActionType; amount: number } {
  const bet = legalActions.find(a => a.type === ActionType.BET);
  if (bet) {
    const size = calculateBetSize(gameState, purpose);
    const min = bet.minAmount || 0;
    const max = bet.maxAmount || min;
    const clamped = Math.min(Math.max(size, min), max);
    return { actionType: ActionType.BET, amount: clamped };
  }

  // Try raise (BB option preflop for example)
  const raise = legalActions.find(a => a.type === ActionType.RAISE);
  if (raise) {
    const size = calculateBetSize(gameState, purpose);
    const min = raise.minAmount || 0;
    const max = raise.maxAmount || min;
    const clamped = Math.min(Math.max(size, min), max);
    return { actionType: ActionType.RAISE, amount: clamped };
  }

  // Try all-in
  const allIn = legalActions.find(a => a.type === ActionType.ALL_IN);
  if (allIn) {
    return { actionType: ActionType.ALL_IN, amount: allIn.maxAmount || player.chips };
  }

  return checkAction(legalActions);
}
