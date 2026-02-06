import type { Player, GameState, PlayerAction, LegalAction, LogEntry } from '../types';
import { ActionType, GamePhase } from '../types';
import { BIG_BLIND } from '../constants';
import { Position, PreflopScenario } from './types';
import { getPlayerPosition } from './position';
import {
  holeCardsToHandKey,
  getRFIRange,
  getBBDefenseRange,
  getFacing3BetRange,
  getFacing4BetRange,
  getLimpedPotRange,
  lookupHandInRange,
} from './preflop-ranges';
import {
  calculatePreflopRaiseSize,
  calculate3BetSize,
  calculate4BetSize,
} from './bet-sizing';
import type { RangeAction } from './types';

/**
 * Make a preflop decision based on GTO ranges.
 */
export function getPreflopAction(
  player: Player,
  gameState: GameState,
  legalActions: LegalAction[],
): PlayerAction {
  const position = getPlayerPosition(player, gameState);
  const handKey = holeCardsToHandKey(player.holeCards);
  const scenario = detectPreflopScenario(player, gameState);
  const rangeAction = lookupRange(handKey, position, scenario, gameState);

  // Select action based on range frequencies
  const selectedAction = selectActionByFrequency(rangeAction, legalActions);
  const amount = resolveAmount(selectedAction, player, gameState, legalActions, position, scenario);

  return {
    type: selectedAction,
    amount,
    playerId: player.id,
  };
}

/**
 * Detect the preflop scenario from the action log.
 */
function detectPreflopScenario(player: Player, gameState: GameState): PreflopScenario {
  const preflopActions = gameState.actionLog.filter(
    e => e.phase === GamePhase.PRE_FLOP && e.handNumber === gameState.handNumber
  );

  // Filter out blind posts
  const voluntaryActions = preflopActions.filter(
    e => e.action !== ActionType.POST_SB && e.action !== ActionType.POST_BB
  );

  // Count raises (BET and RAISE are both raises preflop)
  const raises = voluntaryActions.filter(
    e => e.action === ActionType.RAISE || e.action === ActionType.BET || e.action === ActionType.ALL_IN
  );

  // Did this player already raise?
  const myRaises = raises.filter(e => e.playerId === player.id);
  const otherRaises = raises.filter(e => e.playerId !== player.id);

  // Check for limpers (calls without preceding raise)
  const hasLimpers = voluntaryActions.some(
    e => e.action === ActionType.CALL && raises.length === 0
  );

  if (otherRaises.length === 0 && !hasLimpers) {
    return PreflopScenario.RFI;
  }

  if (hasLimpers && otherRaises.length === 0) {
    return PreflopScenario.LIMPED_POT;
  }

  if (myRaises.length > 0 && otherRaises.length > myRaises.length) {
    // I raised and someone re-raised
    const totalRaises = raises.length;
    if (totalRaises >= 4) return PreflopScenario.FACING_4BET;
    return PreflopScenario.FACING_3BET;
  }

  if (otherRaises.length >= 3) {
    return PreflopScenario.FACING_4BET;
  }

  if (otherRaises.length >= 2) {
    return PreflopScenario.FACING_3BET;
  }

  return PreflopScenario.FACING_RAISE;
}

/**
 * Look up the appropriate range based on scenario.
 */
function lookupRange(
  handKey: string,
  position: Position,
  scenario: PreflopScenario,
  gameState: GameState,
): RangeAction {
  switch (scenario) {
    case PreflopScenario.RFI: {
      const range = getRFIRange(position);
      return lookupHandInRange(handKey, range);
    }

    case PreflopScenario.FACING_RAISE: {
      if (position === Position.BB) {
        const openerPos = findOpenerPosition(gameState);
        const range = getBBDefenseRange(openerPos);
        return lookupHandInRange(handKey, range);
      }
      // Non-BB facing raise: use 3-bet or fold strategy
      const range = getFacing3BetRange();
      return lookupHandInRange(handKey, range);
    }

    case PreflopScenario.FACING_3BET: {
      const range = getFacing3BetRange();
      return lookupHandInRange(handKey, range);
    }

    case PreflopScenario.FACING_4BET: {
      const range = getFacing4BetRange();
      return lookupHandInRange(handKey, range);
    }

    case PreflopScenario.LIMPED_POT: {
      if (position === Position.BB) {
        const range = getLimpedPotRange();
        return lookupHandInRange(handKey, range);
      }
      // Non-BB in limped pot: ISO raise with RFI range
      const range = getRFIRange(position);
      return lookupHandInRange(handKey, range);
    }

    default:
      return { fold: 1, call: 0, raise: 0, allIn: 0 };
  }
}

/**
 * Find the position of the first raiser.
 */
function findOpenerPosition(gameState: GameState): Position {
  const preflopActions = gameState.actionLog.filter(
    e => e.phase === GamePhase.PRE_FLOP && e.handNumber === gameState.handNumber
  );

  const firstRaise = preflopActions.find(
    e => e.action === ActionType.RAISE || e.action === ActionType.BET
  );

  if (!firstRaise) return Position.MP; // fallback

  const raiser = gameState.players.find(p => p.id === firstRaise.playerId);
  if (!raiser) return Position.MP;

  return getPlayerPosition(raiser, gameState);
}

/**
 * Select an action type based on range frequencies and available legal actions.
 */
function selectActionByFrequency(
  rangeAction: RangeAction,
  legalActions: LegalAction[],
): ActionType {
  const canCheck = legalActions.some(a => a.type === ActionType.CHECK);
  const canCall = legalActions.some(a => a.type === ActionType.CALL);
  const canRaise = legalActions.some(a => a.type === ActionType.RAISE);
  const canBet = legalActions.some(a => a.type === ActionType.BET);
  const canFold = legalActions.some(a => a.type === ActionType.FOLD);
  const canAllIn = legalActions.some(a => a.type === ActionType.ALL_IN);

  // Never fold if we can check
  const effectiveFold = canCheck ? 0 : rangeAction.fold;
  const effectiveRaise = (canRaise || canBet) ? rangeAction.raise : 0;
  const effectiveCall = canCall ? rangeAction.call : (canCheck ? rangeAction.call : 0);
  const effectiveAllIn = canAllIn ? rangeAction.allIn : 0;

  // Redistribute probabilities
  const total = effectiveFold + effectiveCall + effectiveRaise + effectiveAllIn;
  if (total === 0) {
    // No matching action in range → check or fold
    return canCheck ? ActionType.CHECK : ActionType.FOLD;
  }

  const roll = Math.random() * total;
  let cumulative = 0;

  cumulative += effectiveRaise;
  if (roll < cumulative) {
    if (canRaise) return ActionType.RAISE;
    if (canBet) return ActionType.BET;
    if (canAllIn) return ActionType.ALL_IN;
  }

  cumulative += effectiveAllIn;
  if (roll < cumulative) {
    return canAllIn ? ActionType.ALL_IN : ActionType.RAISE;
  }

  cumulative += effectiveCall;
  if (roll < cumulative) {
    if (canCall) return ActionType.CALL;
    if (canCheck) return ActionType.CHECK;
  }

  // Fold
  if (canFold) return ActionType.FOLD;
  return canCheck ? ActionType.CHECK : ActionType.FOLD;
}

/**
 * Resolve the chip amount for the selected action.
 */
function resolveAmount(
  actionType: ActionType,
  player: Player,
  gameState: GameState,
  legalActions: LegalAction[],
  position: Position,
  scenario: PreflopScenario,
): number {
  const legal = legalActions.find(a => a.type === actionType);

  switch (actionType) {
    case ActionType.FOLD:
    case ActionType.CHECK:
      return 0;

    case ActionType.CALL:
      return legal?.callAmount || 0;

    case ActionType.ALL_IN:
      return legal?.maxAmount || player.chips;

    case ActionType.BET:
    case ActionType.RAISE: {
      if (!legal) return 0;

      let targetSize: number;

      // Count limpers for sizing
      const preflopActions = gameState.actionLog.filter(
        e => e.phase === GamePhase.PRE_FLOP && e.handNumber === gameState.handNumber
      );
      const limpers = preflopActions.filter(e => e.action === ActionType.CALL).length;

      switch (scenario) {
        case PreflopScenario.RFI:
        case PreflopScenario.LIMPED_POT:
          targetSize = calculatePreflopRaiseSize(gameState, position === Position.SB, limpers);
          break;
        case PreflopScenario.FACING_RAISE:
          targetSize = calculate3BetSize(gameState.currentBet);
          break;
        case PreflopScenario.FACING_3BET:
          targetSize = calculate4BetSize(gameState.currentBet);
          break;
        case PreflopScenario.FACING_4BET:
          // 5-bet is usually all-in
          return legal.maxAmount || player.chips;
        default:
          targetSize = calculatePreflopRaiseSize(gameState);
      }

      // Clamp to legal range
      const min = legal.minAmount || 0;
      const max = legal.maxAmount || min;
      return Math.min(Math.max(targetSize, min), max);
    }

    default:
      return 0;
  }
}
