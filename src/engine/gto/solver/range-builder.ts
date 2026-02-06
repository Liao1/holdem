import type { Card, GameState } from '../../types';
import { ActionType, GamePhase } from '../../types';
import { Position } from '../types';
import type { Range, HandKey } from '../types';
import { getPlayerPosition } from '../position';
import {
  getRFIRange,
  getBBDefenseRange,
  getFacing3BetRange,
} from '../preflop-ranges';
import { cardToSolverId } from './card-adapter';

/** All 13 rank characters in descending order (A=index 0) */
const RANKS = 'AKQJT98765432';
/** Rank char → game rank value (2-14) */
const CHAR_TO_RANK: Record<string, number> = {
  A: 14, K: 13, Q: 12, J: 11, T: 10,
  '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2,
};

const SUITS: Card['suit'][] = ['clubs', 'diamonds', 'hearts', 'spades'];

/**
 * Enumerate all concrete 2-card combos for a HandKey, excluding board blockers.
 * Returns array of [solverIdA, solverIdB] pairs.
 */
function enumerateCombos(
  handKey: HandKey,
  blockedIds: Set<number>,
): [number, number][] {
  const combos: [number, number][] = [];

  if (handKey.length === 2) {
    // Pair: e.g. "AA"
    const rank = CHAR_TO_RANK[handKey[0]];
    const cards: number[] = [];
    for (const suit of SUITS) {
      const id = cardToSolverId({ rank: rank as Card['rank'], suit });
      if (!blockedIds.has(id)) cards.push(id);
    }
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        combos.push([cards[i], cards[j]]);
      }
    }
  } else {
    // Suited or offsuit: e.g. "AKs", "AKo"
    const rank1 = CHAR_TO_RANK[handKey[0]];
    const rank2 = CHAR_TO_RANK[handKey[1]];
    const isSuited = handKey[2] === 's';

    for (let si = 0; si < 4; si++) {
      const id1 = cardToSolverId({ rank: rank1 as Card['rank'], suit: SUITS[si] });
      if (blockedIds.has(id1)) continue;

      if (isSuited) {
        const id2 = cardToSolverId({ rank: rank2 as Card['rank'], suit: SUITS[si] });
        if (!blockedIds.has(id2)) {
          combos.push([id1, id2]);
        }
      } else {
        for (let sj = 0; sj < 4; sj++) {
          if (si === sj) continue;
          const id2 = cardToSolverId({ rank: rank2 as Card['rank'], suit: SUITS[sj] });
          if (!blockedIds.has(id2)) {
            combos.push([id1, id2]);
          }
        }
      }
    }
  }

  return combos;
}

/**
 * Generate all 169 canonical hand keys.
 */
function allHandKeys(): HandKey[] {
  const keys: HandKey[] = [];
  for (let i = 0; i < 13; i++) {
    for (let j = i; j < 13; j++) {
      if (i === j) {
        keys.push(`${RANKS[i]}${RANKS[j]}`);
      } else {
        keys.push(`${RANKS[i]}${RANKS[j]}s`);
        keys.push(`${RANKS[i]}${RANKS[j]}o`);
      }
    }
  }
  return keys;
}

const ALL_HAND_KEYS = allHandKeys();

/**
 * Convert a Range map to a 1326-element Float32Array for the solver.
 * Each combo's weight is the raise freq (for raiser) or call freq (for caller).
 */
function rangeToFloat32(
  range: Range,
  mode: 'raise' | 'call',
  blockedIds: Set<number>,
): Float32Array {
  const arr = new Float32Array(1326);

  for (const handKey of ALL_HAND_KEYS) {
    const action = range.get(handKey);
    if (!action) continue;

    const weight = mode === 'raise'
      ? action.raise + action.allIn
      : action.call + action.raise + action.allIn;
    if (weight <= 0) continue;

    const combos = enumerateCombos(handKey, blockedIds);
    for (const [c1, c2] of combos) {
      const lo = Math.min(c1, c2);
      const hi = Math.max(c1, c2);
      const idx = 52 * lo - (lo * (lo + 1)) / 2 + hi - lo - 1;
      arr[idx] = weight;
    }
  }

  return arr;
}

/**
 * Identify the preflop raiser from the action log.
 * Returns { raiserId, raiserPosition, wasReRaised }
 */
function identifyPreflopRaiser(gameState: GameState): {
  raiserId: string;
  raiserPosition: Position;
  wasReRaised: boolean;
} | null {
  const preflopActions = gameState.actionLog.filter(
    e => e.phase === GamePhase.PRE_FLOP && e.handNumber === gameState.handNumber,
  );

  const raises = preflopActions.filter(
    e => e.action === ActionType.RAISE || e.action === ActionType.BET || e.action === ActionType.ALL_IN,
  );

  if (raises.length === 0) return null;

  const lastRaise = raises[raises.length - 1];
  const raiser = gameState.players.find(p => p.id === lastRaise.playerId);
  if (!raiser) return null;

  return {
    raiserId: raiser.id,
    raiserPosition: getPlayerPosition(raiser, gameState),
    wasReRaised: raises.length >= 2,
  };
}

export interface RangeResult {
  oopRange: Float32Array;
  ipRange: Float32Array;
}

/**
 * Build OOP and IP ranges from the preflop action history.
 *
 * The solver requires 1326-element Float32Array for each player.
 * We infer ranges from preflop action patterns:
 *   - Raiser gets their RFI/3-bet range (raise weights)
 *   - Caller gets defense range (call weights)
 */
export function buildRanges(
  gameState: GameState,
  oopPlayer: string,
  ipPlayer: string,
): RangeResult {
  const board = gameState.communityCards;
  const blockedIds = new Set(board.map(c => cardToSolverId(c)));

  const raiserInfo = identifyPreflopRaiser(gameState);

  const oopPlayerObj = gameState.players.find(p => p.id === oopPlayer);
  const ipPlayerObj = gameState.players.find(p => p.id === ipPlayer);

  if (!oopPlayerObj || !ipPlayerObj) {
    return { oopRange: defaultRange(blockedIds), ipRange: defaultRange(blockedIds) };
  }

  const oopPos = getPlayerPosition(oopPlayerObj, gameState);
  const ipPos = getPlayerPosition(ipPlayerObj, gameState);

  if (!raiserInfo) {
    // Limped pot: both have wide ranges
    const wideRange = getRFIRange(Position.BTN); // widest RFI as proxy
    return {
      oopRange: rangeToFloat32(wideRange, 'call', blockedIds),
      ipRange: rangeToFloat32(wideRange, 'call', blockedIds),
    };
  }

  const isOopRaiser = raiserInfo.raiserId === oopPlayer;

  let raiserRange: Range;
  let callerRange: Range;

  if (raiserInfo.wasReRaised) {
    // 3-bet pot: raiser has 3-bet range, caller has continue vs 3-bet range
    raiserRange = getFacing3BetRange();
    callerRange = getFacing3BetRange();
  } else {
    // Single raised pot
    const raiserPos = isOopRaiser ? oopPos : ipPos;
    const callerPos = isOopRaiser ? ipPos : oopPos;
    raiserRange = getRFIRange(raiserPos);

    if (callerPos === Position.BB) {
      callerRange = getBBDefenseRange(raiserPos);
    } else {
      callerRange = getBBDefenseRange(raiserPos); // approximate
    }
  }

  if (isOopRaiser) {
    return {
      oopRange: rangeToFloat32(raiserRange, 'raise', blockedIds),
      ipRange: rangeToFloat32(callerRange, 'call', blockedIds),
    };
  } else {
    return {
      oopRange: rangeToFloat32(callerRange, 'call', blockedIds),
      ipRange: rangeToFloat32(raiserRange, 'raise', blockedIds),
    };
  }
}

/**
 * Fallback: uniform range over all unblocked combos.
 */
function defaultRange(blockedIds: Set<number>): Float32Array {
  const arr = new Float32Array(1326);
  for (let c1 = 0; c1 < 52; c1++) {
    if (blockedIds.has(c1)) continue;
    for (let c2 = c1 + 1; c2 < 52; c2++) {
      if (blockedIds.has(c2)) continue;
      const idx = 52 * c1 - (c1 * (c1 + 1)) / 2 + c2 - c1 - 1;
      arr[idx] = 1.0;
    }
  }
  return arr;
}
