import type { Player, GameState, PlayerAction, LegalAction } from '../types';
import { ActionType } from '../types';
import { BIG_BLIND } from '../constants';
import { isInPosition } from './position';
import { solve } from './solver/solver-bridge';
import type { SolverAction } from './solver/solver-bridge';
import { boardToSolverIds, findHandInPrivateCards } from './solver/card-adapter';
import { buildRanges } from './solver/range-builder';

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

    // Cap SPR to prevent excessively large game trees that exceed WASM memory
    const MAX_SPR = 12;
    if (effectiveStack > startingPot * MAX_SPR) {
      effectiveStack = Math.floor(startingPot * MAX_SPR);
    }

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
