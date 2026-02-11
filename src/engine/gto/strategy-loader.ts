import { Position } from './types';
import type { RangeAction } from './types';
import type {
  PreflopStrategyFile,
  PreflopStrategyLookupContext,
  PreflopStrategySpot,
} from './strategy-types';
import preflopStrategyJson from './strategies/preflop-100bb-gto.json';

const EPSILON = 1e-6;

const DEFAULT_FOLD_ACTION: RangeAction = {
  fold: 1,
  call: 0,
  raise: 0,
  allIn: 0,
};

const warnOnceKeys = new Set<string>();

const VALID_POSITIONS = new Set(Object.values(Position));

function warnOnce(key: string, message: string): void {
  if (warnOnceKeys.has(key)) return;
  warnOnceKeys.add(key);
  console.warn(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPositionArray(value: unknown): value is Position[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string' && VALID_POSITIONS.has(v as Position));
}

function isValidRangeAction(value: unknown): value is RangeAction {
  if (!isObject(value)) return false;
  const fold = value.fold;
  const call = value.call;
  const raise = value.raise;
  const allIn = value.allIn;

  if (typeof fold !== 'number' || typeof call !== 'number' || typeof raise !== 'number' || typeof allIn !== 'number') {
    return false;
  }

  const nums = [fold, call, raise, allIn];
  if (nums.some(v => Number.isNaN(v) || v < -EPSILON || v > 1 + EPSILON)) return false;

  const total = fold + call + raise + allIn;
  return Math.abs(total - 1) <= 0.01;
}

function validateSpot(raw: unknown): PreflopStrategySpot | null {
  if (!isObject(raw)) return null;

  const id = raw.id;
  const scenario = raw.scenario;
  const heroPosition = raw.heroPosition;
  const openerPositions = raw.openerPositions;
  const threeBettorPositions = raw.threeBettorPositions;
  const notes = raw.notes;
  const hands = raw.hands;

  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof scenario !== 'string') return null;
  if (typeof heroPosition !== 'string' || !VALID_POSITIONS.has(heroPosition as Position)) return null;
  if (openerPositions !== undefined && !isPositionArray(openerPositions)) return null;
  if (threeBettorPositions !== undefined && !isPositionArray(threeBettorPositions)) return null;
  if (notes !== undefined && typeof notes !== 'string') return null;
  if (!isObject(hands)) return null;

  const validatedHands: Record<string, RangeAction> = {};
  for (const [handKey, action] of Object.entries(hands)) {
    if (!isValidRangeAction(action)) {
      warnOnce(`invalid-hand:${id}:${handKey}`, `[PreflopStrategy] Invalid action frequencies at ${id}:${handKey}; ignoring hand`);
      continue;
    }

    validatedHands[handKey] = {
      fold: action.fold,
      call: action.call,
      raise: action.raise,
      allIn: action.allIn,
    };
  }

  return {
    id,
    scenario: scenario as PreflopStrategySpot['scenario'],
    heroPosition: heroPosition as Position,
    openerPositions: openerPositions as Position[] | undefined,
    threeBettorPositions: threeBettorPositions as Position[] | undefined,
    notes: notes as string | undefined,
    hands: validatedHands,
  };
}

function validateStrategyFile(raw: unknown): PreflopStrategyFile {
  if (!isObject(raw)) {
    throw new Error('[PreflopStrategy] Strategy JSON root must be an object');
  }

  const version = raw.version;
  const source = raw.source;
  const assumptions = raw.assumptions;
  const spots = raw.spots;

  if (typeof version !== 'string') {
    throw new Error('[PreflopStrategy] Missing version');
  }

  if (!isObject(source)) {
    throw new Error('[PreflopStrategy] Missing source metadata');
  }

  if (!isObject(assumptions)) {
    throw new Error('[PreflopStrategy] Missing assumptions metadata');
  }

  if (!Array.isArray(spots)) {
    throw new Error('[PreflopStrategy] Missing spots array');
  }

  const validatedSpots: PreflopStrategySpot[] = [];
  for (const rawSpot of spots) {
    const spot = validateSpot(rawSpot);
    if (!spot) {
      warnOnce('invalid-spot', '[PreflopStrategy] Found invalid spot entry; skipping');
      continue;
    }
    validatedSpots.push(spot);
  }

  if (validatedSpots.length === 0) {
    throw new Error('[PreflopStrategy] No valid spots loaded');
  }

  return {
    version,
    source: {
      pdf: typeof source.pdf === 'string' ? source.pdf : '',
      extractedAt: typeof source.extractedAt === 'string' ? source.extractedAt : '',
      method: typeof source.method === 'string' ? source.method : '',
      stackDepthBb: typeof source.stackDepthBb === 'number' ? source.stackDepthBb : 100,
    },
    assumptions: {
      handGranularity: '169',
      unknownColorAction: 'FOLD',
      blueIsRaise: true,
      greenIsCall: true,
      darkGrayIsFold: true,
      whiteIsFold: true,
    },
    spots: validatedSpots,
  };
}

const strategyFile = validateStrategyFile(preflopStrategyJson as unknown);

function matchesSpot(spot: PreflopStrategySpot, ctx: PreflopStrategyLookupContext): boolean {
  if (spot.scenario !== ctx.scenario) return false;
  if (spot.heroPosition !== ctx.heroPosition) return false;

  if (ctx.scenario === 'FACING_RFI') {
    if (!ctx.openerPosition) return false;
    return !!spot.openerPositions?.includes(ctx.openerPosition);
  }

  if (ctx.scenario === 'RFI_VS_3BET') {
    if (!ctx.threeBettorPosition) return false;
    return !!spot.threeBettorPositions?.includes(ctx.threeBettorPosition);
  }

  return true;
}

export function getPreflopStrategyMeta(): PreflopStrategyFile['source'] {
  return strategyFile.source;
}

export function lookupPreflopRangeAction(
  ctx: PreflopStrategyLookupContext,
  handKey: string,
): RangeAction | null {
  const spot = strategyFile.spots.find(s => matchesSpot(s, ctx));

  if (!spot) {
    warnOnce(
      `missing-spot:${ctx.scenario}:${ctx.heroPosition}:${ctx.openerPosition || ''}:${ctx.threeBettorPosition || ''}`,
      `[PreflopStrategy] Missing spot for scenario=${ctx.scenario}, hero=${ctx.heroPosition}, opener=${ctx.openerPosition || '-'}, threeBettor=${ctx.threeBettorPosition || '-'}`,
    );
    return null;
  }

  const action = spot.hands[handKey];
  if (!action) {
    warnOnce(
      `missing-hand:${spot.id}:${handKey}`,
      `[PreflopStrategy] Missing hand ${handKey} in spot ${spot.id}; falling back to fold/check behavior`,
    );
    return DEFAULT_FOLD_ACTION;
  }

  return action;
}
