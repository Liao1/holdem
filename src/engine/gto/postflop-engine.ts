import type { Player, GameState, PlayerAction, LegalAction } from '../types';
import { ActionType, GamePhase } from '../types';
import { BIG_BLIND } from '../constants';
import { isInPosition } from './position';
import { solve } from './solver/solver-bridge';
import type { SolverAction } from './solver/solver-bridge';
import { boardToSolverIds, findHandInPrivateCards, solverIdToCard } from './solver/card-adapter';
import { buildRanges } from './solver/range-builder';

const RANK_CHARS = '  23456789TJQKA';
const SUIT_CHARS: Record<string, string> = { clubs: 'c', diamonds: 'd', hearts: 'h', spades: 's' };

interface StreetHistoryContext {
  historyActions: SolverAction[];
  streetContribution: number;
  playerStreetBets: Map<string, number>;
}

function cardStr(c: { rank: number; suit: string }): string {
  return (RANK_CHARS[c.rank] || '?') + (SUIT_CHARS[c.suit] || '?');
}

function currentPlayerAfterHistoryLength(len: number): 'oop' | 'ip' {
  return len % 2 === 0 ? 'oop' : 'ip';
}

/**
 * In multiway spots we collapse to a 2-player abstraction.
 * If the mapped history ends on the wrong side, trim oldest actions
 * until the solver turn matches the bot side.
 */
function alignHistoryForExpectedPlayer(
  historyActions: SolverAction[],
  expectedPlayer: 'oop' | 'ip',
): { aligned: SolverAction[]; dropped: number } {
  const aligned = historyActions.slice();
  let dropped = 0;
  while (aligned.length > 0 && currentPlayerAfterHistoryLength(aligned.length) !== expectedPlayer) {
    aligned.shift();
    dropped++;
  }
  return { aligned, dropped };
}

/**
 * Make a postflop decision using the WASM CFR solver.
 * Supports both heads-up and multiway pots (multiway approximated by
 * merging all opponent ranges into a single virtual opponent).
 * Falls back to check/fold if the solver is unavailable.
 */
export async function getPostflopAction(
  player: Player,
  gameState: GameState,
  legalActions: LegalAction[],
): Promise<PlayerAction> {
  const solverResult = await trySolverAction(player, gameState, legalActions);
  if (solverResult) return solverResult;

  // Minimal fallback: check if possible, otherwise fold
  if (legalActions.some(a => a.type === ActionType.CHECK)) {
    return { type: ActionType.CHECK, amount: 0, playerId: player.id };
  }
  return { type: ActionType.FOLD, amount: 0, playerId: player.id };
}

/**
 * Attempt to get a solver-based action.
 */
async function trySolverAction(
  player: Player,
  gameState: GameState,
  legalActions: LegalAction[],
): Promise<PlayerAction | null> {
  try {
    // Find all active opponents
    const activePlayers = gameState.players.filter(
      p => p.status === 'ACTIVE' || p.status === 'ALL_IN',
    );
    const opponentIds = activePlayers
      .filter(p => p.id !== player.id)
      .map(p => p.id);
    if (opponentIds.length === 0) return null;

    const ip = isInPosition(player, gameState);
    const expectedPlayer: 'oop' | 'ip' = ip ? 'ip' : 'oop';

    const holeStr = player.holeCards.map(c => cardStr(c)).join('');
    const boardStr = gameState.communityCards.map(c => cardStr(c)).join(' ');
    console.log('[PostflopEngine] === Decision Start ===');
    console.log('[PostflopEngine] player:', player.id, 'hand:', holeStr, 'board:', boardStr);
    console.log('[PostflopEngine] position:', ip ? 'IP' : 'OOP', 'opponents:', opponentIds.length);
    console.log('[PostflopEngine] legalActions:', legalActions.map(a => {
      let s = a.type as string;
      if (a.callAmount) s += `(call=${a.callAmount})`;
      if (a.minAmount != null) s += `(min=${a.minAmount},max=${a.maxAmount})`;
      return s;
    }).join(', '));

    const streetHistory = buildStreetHistoryContext(gameState);
    const currentTotalPot = getTotalPot(gameState);
    const startingPot = Math.max(currentTotalPot - streetHistory.streetContribution, BIG_BLIND);

    let historyActionsForSolver = streetHistory.historyActions;
    if (opponentIds.length > 1) {
      const { aligned, dropped } = alignHistoryForExpectedPlayer(historyActionsForSolver, expectedPlayer);
      historyActionsForSolver = aligned;
      if (dropped > 0) {
        console.log('[PostflopEngine] multiway history aligned: dropped', dropped, 'oldest actions');
      }
    }

    // Build ranges (multiway: opponents merged into virtual opponent)
    const { oopRange, ipRange } = buildRanges(gameState, player.id, opponentIds, ip);

    // Convert board to solver IDs
    const board = boardToSolverIds(gameState.communityCards);

    // effective_stack is measured from the start of the current street
    const maxOpponentChips = Math.max(
      ...opponentIds.map(id => {
        const p = gameState.players.find(pl => pl.id === id)!;
        const streetBet = streetHistory.playerStreetBets.get(id) || 0;
        return p.chips + streetBet;
      }),
    );
    const playerStreetBet = streetHistory.playerStreetBets.get(player.id) || 0;
    let effectiveStack = Math.min(player.chips + playerStreetBet, maxOpponentChips);

    // Cap SPR based on remaining streets to keep game tree manageable.
    const numBoardCards = gameState.communityCards.length;
    const maxSpr = numBoardCards === 3 ? 6 : numBoardCards === 4 ? 10 : 15;
    if (effectiveStack > startingPot * maxSpr) {
      const capped = Math.floor(startingPot * maxSpr);
      console.log('[PostflopEngine] SPR cap: stack', effectiveStack, '→', capped, '(pot:', startingPot, 'streets:', 6 - numBoardCards, ')');
      effectiveStack = capped;
    }

    console.log('[PostflopEngine] currentPot:', currentTotalPot, 'streetStartPot:', startingPot);
    console.log('[PostflopEngine] street history:', streetHistory.historyActions.map(a => `${a.type}:${a.amount}`).join(' / ') || '(none)');
    if (historyActionsForSolver !== streetHistory.historyActions) {
      console.log('[PostflopEngine] solver history:', historyActionsForSolver.map(a => `${a.type}:${a.amount}`).join(' / ') || '(root)');
    }
    console.log('[PostflopEngine] effectiveStack:', effectiveStack, 'SPR:', (effectiveStack / startingPot).toFixed(1));

    const timeBudgetMs = numBoardCards === 3 ? 30000 : 10000;

    // Solve
    const result = await solve(oopRange, ipRange, board, startingPot, effectiveStack, {
      historyActions: historyActionsForSolver,
      currentTotalPot,
      targetExploitabilityPctOfCurrentPot: 0.5,
      timeBudgetMs,
    });

    if (!result) {
      console.warn('[PostflopEngine] Solver returned null');
      return null;
    }

    if (result.currentPlayer !== expectedPlayer) {
      console.warn('[PostflopEngine] Solver player mismatch:', {
        expectedPlayer,
        solverPlayer: result.currentPlayer,
        resolvedHistory: result.history,
        opponents: opponentIds.length,
        inputHistory: historyActionsForSolver.map(a => `${a.type}:${a.amount}`),
      });
      return null;
    }

    console.log('[PostflopEngine] === Solver Output ===');
    console.log('[PostflopEngine] iterations:', result.iterations, 'elapsedMs:', result.elapsedMs.toFixed(0), 'stoppedBy:', result.stoppedBy);
    console.log('[PostflopEngine] exploitability:', result.exploitability.toFixed(2), `(${result.exploitabilityPctOfCurrentPot.toFixed(2)}% pot)`, 'target:', result.targetExploitability.toFixed(2));
    console.log('[PostflopEngine] resolved history indices:', result.history.join(',') || '(root)');
    console.log('[PostflopEngine] currentPlayer:', result.currentPlayer);
    console.log('[PostflopEngine] actions:', result.actions.map(a => `${a.type}:${a.amount}`).join(' / '));
    console.log('[PostflopEngine] numHands (private combos):', result.numHands);
    if (result.actions.length === 0) {
      console.warn('[PostflopEngine] Solver returned empty actions');
      return null;
    }

    // Find the bot's hand in the solver's private cards
    const handIdx = findHandInPrivateCards(player.holeCards, result.privateCards);
    if (handIdx < 0) {
      console.warn('[PostflopEngine] Hand', holeStr, 'not found in privateCards');
      return null;
    }

    // Decode the matched combo for verification
    const packed = result.privateCards[handIdx];
    const matchedC1 = solverIdToCard(packed & 0xff);
    const matchedC2 = solverIdToCard((packed >> 8) & 0xff);
    const matchedLabel = cardStr(matchedC1) + cardStr(matchedC2);
    const matchedCanonical = [cardStr(matchedC1), cardStr(matchedC2)].sort().join('');
    const holeCanonical = player.holeCards.map(cardStr).sort().join('');
    console.log('[PostflopEngine] hand matched at index', handIdx, '→', matchedLabel, `(canon=${matchedCanonical}, expected=${holeCanonical})`);

    // Read the strategy for this hand
    const numActions = result.actions.length;
    const handStrategy: number[] = [];
    for (let a = 0; a < numActions; a++) {
      handStrategy.push(result.strategy[a * result.numHands + handIdx]);
    }

    // Log the strategy for this specific hand
    console.log('[PostflopEngine] === Hand Strategy ===');
    for (let a = 0; a < numActions; a++) {
      const action = result.actions[a];
      const prob = handStrategy[a];
      console.log(`[PostflopEngine]   ${action.type}:${action.amount} → ${(prob * 100).toFixed(1)}%`);
    }

    // Sample an action according to the strategy probabilities
    const chosenIdx = sampleAction(handStrategy);
    const chosenSolverAction = result.actions[chosenIdx] || result.actions[0];
    console.log('[PostflopEngine] === Sampled Action ===');
    console.log('[PostflopEngine] chosen:', chosenSolverAction.type, 'amount:', chosenSolverAction.amount);

    // Map solver action → game action
    const finalAction = mapSolverAction(chosenSolverAction, player, legalActions);
    console.log('[PostflopEngine] decision trace:', {
      sampled: chosenSolverAction,
      final: { type: finalAction.type, amount: finalAction.amount },
      legal: legalActions.map(a => ({
        type: a.type,
        callAmount: a.callAmount,
        minAmount: a.minAmount,
        maxAmount: a.maxAmount,
      })),
    });

    return finalAction;
  } catch (e) {
    console.warn('[PostflopEngine] Solver failed:', e);
    return null;
  }
}

/**
 * Sample an action index from a probability distribution.
 */
function sampleAction(probabilities: number[]): number {
  const sanitized = probabilities.map(p => (Number.isFinite(p) && p > 0 ? p : 0));
  const total = sanitized.reduce((sum, p) => sum + p, 0);
  if (total <= 0) return 0;

  let roll = Math.random() * total;
  for (let i = 0; i < sanitized.length; i++) {
    roll -= sanitized[i];
    if (roll <= 0) return i;
  }
  return sanitized.length - 1;
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

    case 'Check': {
      if (legalActions.some(a => a.type === ActionType.CHECK)) {
        return { type: ActionType.CHECK, amount: 0, playerId };
      }
      const call = legalActions.find(a => a.type === ActionType.CALL);
      if (call) {
        return { type: ActionType.CALL, amount: call.callAmount || 0, playerId };
      }
      return { type: ActionType.FOLD, amount: 0, playerId };
    }

    case 'Call': {
      const call = legalActions.find(a => a.type === ActionType.CALL);
      if (call) {
        return { type: ActionType.CALL, amount: call.callAmount || 0, playerId };
      }
      if (legalActions.some(a => a.type === ActionType.CHECK)) {
        return { type: ActionType.CHECK, amount: 0, playerId };
      }
      return { type: ActionType.FOLD, amount: 0, playerId };
    }

    case 'Bet': {
      const bet = legalActions.find(a => a.type === ActionType.BET);
      if (bet) {
        const min = bet.minAmount || 0;
        const max = bet.maxAmount || min;
        const clamped = Math.min(Math.max(solverAction.amount, min), max);
        return { type: ActionType.BET, amount: clamped, playerId };
      }

      const raise = legalActions.find(a => a.type === ActionType.RAISE);
      if (raise) {
        const min = raise.minAmount || 0;
        const max = raise.maxAmount || min;
        const clamped = Math.min(Math.max(solverAction.amount, min), max);
        return { type: ActionType.RAISE, amount: clamped, playerId };
      }

      if (legalActions.some(a => a.type === ActionType.CHECK)) {
        return { type: ActionType.CHECK, amount: 0, playerId };
      }

      const call = legalActions.find(a => a.type === ActionType.CALL);
      if (call) {
        return { type: ActionType.CALL, amount: call.callAmount || 0, playerId };
      }

      return { type: ActionType.FOLD, amount: 0, playerId };
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

      if (legalActions.some(a => a.type === ActionType.CHECK)) {
        return { type: ActionType.CHECK, amount: 0, playerId };
      }

      return { type: ActionType.FOLD, amount: 0, playerId };
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

      if (legalActions.some(a => a.type === ActionType.CHECK)) {
        return { type: ActionType.CHECK, amount: 0, playerId };
      }

      return { type: ActionType.FOLD, amount: 0, playerId };
    }
  }
}

function getTotalPot(gameState: GameState): number {
  const fromPots = gameState.pots.reduce((sum, pot) => sum + pot.amount, 0);
  if (fromPots > 0) {
    return fromPots;
  }

  const committed = gameState.players.reduce((sum, p) => sum + p.totalBetThisHand, 0);
  return Math.max(committed, BIG_BLIND);
}

function buildStreetHistoryContext(gameState: GameState): StreetHistoryContext {
  if (gameState.phase !== GamePhase.FLOP && gameState.phase !== GamePhase.TURN && gameState.phase !== GamePhase.RIVER) {
    return {
      historyActions: [],
      streetContribution: 0,
      playerStreetBets: new Map(),
    };
  }

  const playerStreetBets = new Map<string, number>();
  const historyActions: SolverAction[] = [];

  const streetEntries = gameState.actionLog.filter(
    e => e.handNumber === gameState.handNumber && e.phase === gameState.phase,
  );

  for (const entry of streetEntries) {
    const prevBet = playerStreetBets.get(entry.playerId) || 0;
    const amount = Math.max(entry.amount, 0);

    switch (entry.action) {
      case ActionType.FOLD:
        historyActions.push({ type: 'Fold', amount: 0 });
        break;
      case ActionType.CHECK:
        historyActions.push({ type: 'Check', amount: 0 });
        break;
      case ActionType.CALL: {
        const nextBet = prevBet + amount;
        playerStreetBets.set(entry.playerId, nextBet);
        historyActions.push({ type: 'Call', amount: 0 });
        break;
      }
      case ActionType.BET: {
        const nextBet = prevBet + amount;
        playerStreetBets.set(entry.playerId, nextBet);
        historyActions.push({ type: 'Bet', amount: nextBet });
        break;
      }
      case ActionType.RAISE: {
        const raiseTo = Math.max(amount, prevBet);
        playerStreetBets.set(entry.playerId, raiseTo);
        historyActions.push({ type: 'Raise', amount: raiseTo });
        break;
      }
      case ActionType.ALL_IN: {
        const nextBet = prevBet + amount;
        playerStreetBets.set(entry.playerId, nextBet);
        historyActions.push({ type: 'Allin', amount: nextBet });
        break;
      }
      default:
        break;
    }
  }

  const streetContribution = Array.from(playerStreetBets.values())
    .reduce((sum, v) => sum + v, 0);

  return {
    historyActions,
    streetContribution,
    playerStreetBets,
  };
}
