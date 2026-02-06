import type { PlayerAction, LegalAction } from './types';
import { ActionType } from './types';
import { BOT_THINK_MIN_MS, BOT_THINK_MAX_MS } from './constants';

/**
 * Get a bot action using weighted random selection with simulated thinking delay.
 */
export async function getBotAction(
  playerId: string,
  legalActions: LegalAction[],
): Promise<PlayerAction> {
  // Simulate thinking
  const delay = BOT_THINK_MIN_MS + Math.random() * (BOT_THINK_MAX_MS - BOT_THINK_MIN_MS);
  await new Promise(resolve => setTimeout(resolve, delay));

  const action = selectWeightedAction(legalActions);
  return {
    type: action.type,
    amount: resolveAmount(action),
    playerId,
  };
}

/** Weight table: higher = more likely to pick */
const ACTION_WEIGHTS: Record<string, number> = {
  [ActionType.CHECK]: 40,
  [ActionType.CALL]: 35,
  [ActionType.BET]: 15,
  [ActionType.RAISE]: 12,
  [ActionType.FOLD]: 5,
  [ActionType.ALL_IN]: 3,
};

function selectWeightedAction(legalActions: LegalAction[]): LegalAction {
  // If can check, greatly reduce fold weight
  const canCheck = legalActions.some(a => a.type === ActionType.CHECK);

  let totalWeight = 0;
  const weighted: { action: LegalAction; weight: number }[] = [];

  for (const action of legalActions) {
    let weight = ACTION_WEIGHTS[action.type] || 1;
    if (canCheck && action.type === ActionType.FOLD) {
      weight = 0; // Never fold when can check
    }
    weighted.push({ action, weight });
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    return legalActions[0];
  }

  let roll = Math.random() * totalWeight;
  for (const { action, weight } of weighted) {
    roll -= weight;
    if (roll <= 0) return action;
  }

  return legalActions[legalActions.length - 1];
}

function resolveAmount(action: LegalAction): number {
  switch (action.type) {
    case ActionType.FOLD:
    case ActionType.CHECK:
      return 0;
    case ActionType.CALL:
      return action.callAmount || 0;
    case ActionType.ALL_IN:
      return action.maxAmount || 0;
    case ActionType.BET:
    case ActionType.RAISE: {
      const min = action.minAmount || 0;
      const max = action.maxAmount || min;
      // Random amount between min and max, biased toward smaller
      const range = max - min;
      const roll = Math.random();
      // Use sqrt to bias toward lower end
      return Math.floor(min + Math.sqrt(roll) * range);
    }
    default:
      return 0;
  }
}
