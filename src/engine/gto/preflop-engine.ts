import type { Player, GameState, PlayerAction, LegalAction, LogEntry } from '../types';
import { ActionType, GamePhase } from '../types';
import { Position, PreflopScenario } from './types';
import type { RangeAction } from './types';
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
import { lookupPreflopRangeAction } from './strategy-loader';
import type { PreflopStrategyLookupContext } from './strategy-types';

/**
 * Make a preflop decision based on JSON strategy, with hardcoded fallback.
 */
export function getPreflopAction(
  player: Player,
  gameState: GameState,
  legalActions: LegalAction[],
): PlayerAction {
  const position = getPlayerPosition(player, gameState);
  const handKey = holeCardsToHandKey(player.holeCards);

  const strategyContext = buildStrategyContext(player, gameState, position);
  let rangeAction: RangeAction | null = null;

  if (strategyContext) {
    rangeAction = lookupPreflopRangeAction(strategyContext, handKey);
  }

  // Conservative fallback: use old hardcoded ranges if strategy spot is missing.
  if (!rangeAction) {
    const scenario = detectPreflopScenario(player, gameState);
    rangeAction = lookupRange(handKey, position, scenario, gameState);
  }

  const selectedAction = selectActionByFrequency(rangeAction, legalActions);

  // Keep existing sizing logic keyed by legacy scenario detection.
  const sizingScenario = detectPreflopScenario(player, gameState);
  const amount = resolveAmount(selectedAction, player, gameState, legalActions, position, sizingScenario);

  return {
    type: selectedAction,
    amount,
    playerId: player.id,
  };
}

function isRaiseLike(action: ActionType): boolean {
  return action === ActionType.RAISE || action === ActionType.BET || action === ActionType.ALL_IN;
}

function getCurrentHandPreflopVoluntaryActions(gameState: GameState): LogEntry[] {
  return gameState.actionLog.filter(
    e =>
      e.phase === GamePhase.PRE_FLOP
      && e.handNumber === gameState.handNumber
      && e.action !== ActionType.POST_SB
      && e.action !== ActionType.POST_BB,
  );
}

function getPlayerPositionById(playerId: string, gameState: GameState): Position | null {
  const p = gameState.players.find(x => x.id === playerId);
  if (!p) return null;
  return getPlayerPosition(p, gameState);
}

/**
 * Build rich lookup context for JSON strategy.
 * Returns null when the current action history is not covered by the chart set.
 */
function buildStrategyContext(
  player: Player,
  gameState: GameState,
  heroPosition: Position,
): PreflopStrategyLookupContext | null {
  const actions = getCurrentHandPreflopVoluntaryActions(gameState);
  const raises = actions.filter(a => isRaiseLike(a.action));

  // No raise yet -> open spot.
  if (raises.length === 0) {
    return {
      scenario: 'RFI',
      heroPosition,
    };
  }

  // Track whether hero limped before any raise.
  let runningRaises = 0;
  let heroLimped = false;
  for (const a of actions) {
    if (a.playerId === player.id && a.action === ActionType.CALL && runningRaises === 0) {
      heroLimped = true;
    }
    if (isRaiseLike(a.action)) {
      runningRaises += 1;
    }
  }

  const heroHasRaised = actions.some(a => a.playerId === player.id && isRaiseLike(a.action));

  // Hero has not raised yet and is facing an open raise.
  if (!heroHasRaised) {
    const firstRaise = raises[0];
    if (!firstRaise || firstRaise.playerId === player.id) return null;

    const openerPosition = getPlayerPositionById(firstRaise.playerId, gameState);
    if (!openerPosition) return null;

    // SB limped, BB raised -> dedicated chart.
    if (heroLimped && heroPosition === Position.SB && openerPosition === Position.BB) {
      return {
        scenario: 'SB_LIMP_VS_BB_RAISE',
        heroPosition,
        openerPosition,
      };
    }

    // Only charted as "Facing RFI" for first raise decisions.
    if (raises.length === 1) {
      return {
        scenario: 'FACING_RFI',
        heroPosition,
        openerPosition,
      };
    }

    return null;
  }

  // Hero raised. The chart set covers only "RFI then face exactly one 3-bet".
  const firstRaise = raises[0];
  if (!firstRaise || firstRaise.playerId !== player.id) {
    return null;
  }

  const raisesAfterHero = raises.filter(r => r.playerId !== player.id);
  if (raisesAfterHero.length !== 1) {
    return null;
  }

  const threeBettorPosition = getPlayerPositionById(raisesAfterHero[0].playerId, gameState);
  if (!threeBettorPosition) return null;

  return {
    scenario: 'RFI_VS_3BET',
    heroPosition,
    threeBettorPosition,
  };
}

/**
 * Detect the preflop scenario from the action log.
 */
function detectPreflopScenario(player: Player, gameState: GameState): PreflopScenario {
  const voluntaryActions = getCurrentHandPreflopVoluntaryActions(gameState);

  const raises = voluntaryActions.filter(e => isRaiseLike(e.action));

  const myRaises = raises.filter(e => e.playerId === player.id);
  const otherRaises = raises.filter(e => e.playerId !== player.id);

  // Check for limpers (calls without preceding raise)
  const hasLimpers = voluntaryActions.some(
    e => e.action === ActionType.CALL && raises.length === 0,
  );

  if (otherRaises.length === 0 && !hasLimpers) {
    return PreflopScenario.RFI;
  }

  if (hasLimpers && otherRaises.length === 0) {
    return PreflopScenario.LIMPED_POT;
  }

  if (myRaises.length > 0 && otherRaises.length > myRaises.length) {
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
 * Look up the appropriate fallback range based on scenario.
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
    e => e.phase === GamePhase.PRE_FLOP && e.handNumber === gameState.handNumber,
  );

  const firstRaise = preflopActions.find(e => e.action === ActionType.RAISE || e.action === ActionType.BET);

  if (!firstRaise) return Position.MP;

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

  const effectiveFold = canCheck ? 0 : rangeAction.fold;
  const effectiveRaise = (canRaise || canBet) ? rangeAction.raise : 0;
  const effectiveCall = canCall ? rangeAction.call : (canCheck ? rangeAction.call : 0);
  const effectiveAllIn = canAllIn ? rangeAction.allIn : 0;

  const total = effectiveFold + effectiveCall + effectiveRaise + effectiveAllIn;
  if (total === 0) {
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

      const preflopActions = gameState.actionLog.filter(
        e => e.phase === GamePhase.PRE_FLOP && e.handNumber === gameState.handNumber,
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
          return legal.maxAmount || player.chips;
        default:
          targetSize = calculatePreflopRaiseSize(gameState);
      }

      const min = legal.minAmount || 0;
      const max = legal.maxAmount || min;
      return Math.min(Math.max(targetSize, min), max);
    }

    default:
      return 0;
  }
}
