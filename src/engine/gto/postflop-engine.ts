import type { Player, GameState, PlayerAction, LegalAction } from '../types';
import { ActionType } from '../types';
import { BIG_BLIND } from '../constants';
import { isInPosition } from './position';
import { solve } from './solver/solver-bridge';
import type { SolverAction } from './solver/solver-bridge';
import { boardToSolverIds, findHandInPrivateCards, solverIdToCard } from './solver/card-adapter';
import { buildRanges } from './solver/range-builder';

const RANK_CHARS = '  23456789TJQKA';
const SUIT_CHARS: Record<string, string> = { clubs: 'c', diamonds: 'd', hearts: 'h', spades: 's' };
function cardStr(c: { rank: number; suit: string }): string {
  return (RANK_CHARS[c.rank] || '?') + (SUIT_CHARS[c.suit] || '?');
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

    // Build ranges (multiway: opponents merged into virtual opponent)
    const { oopRange, ipRange } = buildRanges(gameState, player.id, opponentIds, ip);

    // Convert board to solver IDs
    const board = boardToSolverIds(gameState.communityCards);

    // Calculate starting pot and effective stack
    // starting_pot = total pot (including current bets from all players)
    // effective_stack = remaining chips behind (NOT including currentBet, which is already in pot)
    const startingPot = getTotalPot(gameState);
    const maxOpponentChips = Math.max(
      ...opponentIds.map(id => {
        const p = gameState.players.find(pl => pl.id === id)!;
        return p.chips;
      }),
    );
    let effectiveStack = Math.min(player.chips, maxOpponentChips);

    // Cap SPR based on remaining streets to keep game tree manageable
    // Flop (3 streets) = smallest cap, River (1 street) = largest cap
    const numBoardCards = gameState.communityCards.length;
    const MAX_SPR = numBoardCards === 3 ? 4 : numBoardCards === 4 ? 8 : 15;
    if (effectiveStack > startingPot * MAX_SPR) {
      const capped = Math.floor(startingPot * MAX_SPR);
      console.log('[PostflopEngine] SPR cap: stack', effectiveStack, '→', capped, '(pot:', startingPot, 'streets:', 6 - numBoardCards, ')');
      effectiveStack = capped;
    }
    console.log('[PostflopEngine] pot:', startingPot, 'effectiveStack:', effectiveStack, 'SPR:', (effectiveStack / startingPot).toFixed(1));

    // Solve
    const result = await solve(oopRange, ipRange, board, startingPot, effectiveStack);
    if (!result) {
      console.warn('[PostflopEngine] Solver returned null');
      return null;
    }

    console.log('[PostflopEngine] === Solver Output ===');
    console.log('[PostflopEngine] iterations:', result.iterations, 'exploitability:', result.exploitability.toFixed(2));
    console.log('[PostflopEngine] currentPlayer:', result.currentPlayer);
    console.log('[PostflopEngine] actions:', result.actions.map(a => `${a.type}:${a.amount}`).join(' / '));
    console.log('[PostflopEngine] numHands (private combos):', result.numHands);

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
    console.log('[PostflopEngine] hand matched at index', handIdx, '→', cardStr(matchedC1) + cardStr(matchedC2));

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
    const chosenSolverAction = result.actions[chosenIdx];
    console.log('[PostflopEngine] === Sampled Action ===');
    console.log('[PostflopEngine] chosen:', chosenSolverAction.type, 'amount:', chosenSolverAction.amount);

    // Map solver action → game action
    const finalAction = mapSolverAction(chosenSolverAction, player, legalActions);
    console.log('[PostflopEngine] → final game action:', finalAction.type, 'amount:', finalAction.amount);
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
