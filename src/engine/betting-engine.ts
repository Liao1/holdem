import type { Player, GameState, LegalAction } from './types';
import { ActionType, GamePhase } from './types';
import { BIG_BLIND } from './constants';

/**
 * Calculate legal actions for a player given the current game state.
 */
export function calculateLegalActions(player: Player, gameState: GameState): LegalAction[] {
  const actions: LegalAction[] = [];

  if (player.status !== 'ACTIVE' || player.chips <= 0) {
    return actions;
  }

  const amountToCall = gameState.currentBet - player.currentBet;
  const playerChips = player.chips;

  // Always can fold (if there's a bet to face)
  if (amountToCall > 0) {
    actions.push({ type: ActionType.FOLD });
  }

  if (amountToCall === 0) {
    // No bet to call
    actions.push({ type: ActionType.CHECK });

    // Pre-flop BB option: current bet > 0 but player already matches it
    // This is a RAISE scenario, not a BET
    const isPreflopBBOption = gameState.phase === GamePhase.PRE_FLOP && gameState.currentBet > 0;

    if (isPreflopBBOption) {
      const minRaiseTotal = gameState.currentBet + gameState.lastRaiseIncrement;
      const raiseChipsNeeded = minRaiseTotal - player.currentBet;
      if (playerChips <= raiseChipsNeeded) {
        actions.push({
          type: ActionType.ALL_IN,
          minAmount: playerChips,
          maxAmount: playerChips,
        });
      } else {
        const maxRaiseTotal = player.currentBet + playerChips;
        actions.push({
          type: ActionType.RAISE,
          minAmount: minRaiseTotal,
          maxAmount: maxRaiseTotal,
        });
      }
    } else {
      // Post-flop or no existing bet: this is a BET
      const minBet = BIG_BLIND;
      if (playerChips <= minBet) {
        actions.push({
          type: ActionType.ALL_IN,
          minAmount: playerChips,
          maxAmount: playerChips,
        });
      } else {
        actions.push({
          type: ActionType.BET,
          minAmount: minBet,
          maxAmount: playerChips,
        });
      }
    }
  } else {
    // There's a bet to call
    if (playerChips <= amountToCall) {
      // Can only all-in (can't cover the call)
      actions.push({
        type: ActionType.ALL_IN,
        minAmount: playerChips,
        maxAmount: playerChips,
        callAmount: playerChips,
      });
    } else {
      // Can call
      actions.push({
        type: ActionType.CALL,
        callAmount: amountToCall,
      });

      // Can raise?
      const minRaiseTotal = gameState.currentBet + gameState.lastRaiseIncrement;
      const raiseChipsNeeded = minRaiseTotal - player.currentBet;

      if (playerChips > amountToCall) {
        if (playerChips < raiseChipsNeeded) {
          // Can't make minimum raise, but can go all-in (incomplete raise)
          actions.push({
            type: ActionType.ALL_IN,
            minAmount: playerChips,
            maxAmount: playerChips,
          });
        } else {
          // Can raise normally
          const maxRaiseTotal = player.currentBet + playerChips;
          actions.push({
            type: ActionType.RAISE,
            minAmount: minRaiseTotal,
            maxAmount: maxRaiseTotal,
          });
        }
      }
    }
  }

  return actions;
}

/**
 * Validate and normalize a player action.
 */
export function validateAction(
  action: { type: ActionType; amount: number },
  legalActions: LegalAction[],
  player: Player,
  gameState: GameState,
): { type: ActionType; amount: number } {
  const legal = legalActions.find(a => a.type === action.type);
  if (!legal) {
    // Default to fold or check
    const canCheck = legalActions.find(a => a.type === ActionType.CHECK);
    if (canCheck) return { type: ActionType.CHECK, amount: 0 };
    return { type: ActionType.FOLD, amount: 0 };
  }

  switch (action.type) {
    case ActionType.FOLD:
    case ActionType.CHECK:
      return { type: action.type, amount: 0 };

    case ActionType.CALL:
      return { type: ActionType.CALL, amount: legal.callAmount || 0 };

    case ActionType.BET: {
      const clamped = Math.min(Math.max(action.amount, legal.minAmount || 0), legal.maxAmount || 0);
      if (clamped >= player.chips) {
        return { type: ActionType.ALL_IN, amount: player.chips };
      }
      return { type: ActionType.BET, amount: clamped };
    }

    case ActionType.RAISE: {
      const clamped = Math.min(Math.max(action.amount, legal.minAmount || 0), legal.maxAmount || 0);
      const raiseAmount = clamped - player.currentBet;
      if (raiseAmount >= player.chips) {
        return { type: ActionType.ALL_IN, amount: player.chips };
      }
      return { type: ActionType.RAISE, amount: clamped };
    }

    case ActionType.ALL_IN:
      return { type: ActionType.ALL_IN, amount: player.chips };

    default:
      return { type: ActionType.FOLD, amount: 0 };
  }
}
