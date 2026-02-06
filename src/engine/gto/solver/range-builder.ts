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

// ── Preflop raiser identification ────────────────────────────

interface RaiserInfo {
  raiserId: string;
  raiserPosition: Position;
  wasReRaised: boolean;
}

function identifyPreflopRaiser(gameState: GameState): RaiserInfo | null {
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

// ── Per-player range building ────────────────────────────────

/**
 * Build a single player's estimated range as a 1326-element Float32Array.
 */
function buildPlayerRange(
  gameState: GameState,
  playerId: string,
  raiserInfo: RaiserInfo | null,
  blockedIds: Set<number>,
): Float32Array {
  const player = gameState.players.find(p => p.id === playerId);
  if (!player) return defaultRange(blockedIds);

  const pos = getPlayerPosition(player, gameState);

  if (!raiserInfo) {
    // Limped pot: wide range
    const wideRange = getRFIRange(Position.BTN);
    return rangeToFloat32(wideRange, 'call', blockedIds);
  }

  const isRaiser = raiserInfo.raiserId === playerId;

  if (raiserInfo.wasReRaised) {
    // 3-bet pot
    const range = getFacing3BetRange();
    return rangeToFloat32(range, isRaiser ? 'raise' : 'call', blockedIds);
  }

  // Single raised pot
  if (isRaiser) {
    return rangeToFloat32(getRFIRange(pos), 'raise', blockedIds);
  }

  // Caller
  return rangeToFloat32(getBBDefenseRange(raiserInfo.raiserPosition), 'call', blockedIds);
}

// ── Range merging for multiway ───────────────────────────────

/**
 * Merge multiple opponent ranges into one by taking the max weight per combo.
 * This represents "any opponent could hold this combo".
 */
function mergeRanges(ranges: Float32Array[]): Float32Array {
  if (ranges.length === 0) return new Float32Array(1326);
  if (ranges.length === 1) return ranges[0];

  const merged = new Float32Array(1326);
  for (let i = 0; i < 1326; i++) {
    let max = 0;
    for (const range of ranges) {
      if (range[i] > max) max = range[i];
    }
    merged[i] = max;
  }
  return merged;
}

// ── Public API ───────────────────────────────────────────────

export interface RangeResult {
  oopRange: Float32Array;
  ipRange: Float32Array;
}

/**
 * Build OOP and IP ranges for the solver.
 *
 * Supports both heads-up and multiway pots. For multiway, all opponent
 * ranges are merged into one "virtual opponent" range (max per combo).
 *
 * @param gameState      Current game state
 * @param botPlayerId    The bot player's ID
 * @param opponentIds    IDs of all active opponents
 * @param botIsIP        Whether the bot acts last (is in position)
 */
export function buildRanges(
  gameState: GameState,
  botPlayerId: string,
  opponentIds: string[],
  botIsIP: boolean,
): RangeResult {
  const blockedIds = new Set(gameState.communityCards.map(c => cardToSolverId(c)));
  const raiserInfo = identifyPreflopRaiser(gameState);

  // Build bot's range
  const botRange = buildPlayerRange(gameState, botPlayerId, raiserInfo, blockedIds);

  // Build each opponent's range, then merge
  const opponentRanges = opponentIds.map(id =>
    buildPlayerRange(gameState, id, raiserInfo, blockedIds),
  );
  const mergedOpponentRange = mergeRanges(opponentRanges);

  return {
    oopRange: botIsIP ? mergedOpponentRange : botRange,
    ipRange: botIsIP ? botRange : mergedOpponentRange,
  };
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
