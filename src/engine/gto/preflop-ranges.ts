import type { Card } from '../types';
import { Position } from './types';
import type { HandKey, Range, RangeAction, RangeSpec } from './types';

// ── Hand Key Generation ────────────────────────────────────

const RANK_CHARS: Record<number, string> = {
  14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T',
  9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2',
};

/**
 * Convert two hole cards to a hand key like "AKs", "QJo", "TT".
 */
export function holeCardsToHandKey(cards: Card[]): HandKey {
  const [c1, c2] = cards;
  const high = Math.max(c1.rank, c2.rank);
  const low = Math.min(c1.rank, c2.rank);
  const highChar = RANK_CHARS[high];
  const lowChar = RANK_CHARS[low];

  if (high === low) return `${highChar}${lowChar}`;
  const suited = c1.suit === c2.suit ? 's' : 'o';
  return `${highChar}${lowChar}${suited}`;
}

// ── Range Builder ──────────────────────────────────────────

function buildRange(spec: RangeSpec): Range {
  const range: Range = new Map();

  for (const hand of spec.alwaysRaise) {
    range.set(hand, { fold: 0, call: 0, raise: 1, allIn: 0 });
  }

  for (const [hand, raiseFreq] of spec.mixedRaise) {
    const existing = range.get(hand);
    if (existing) {
      existing.raise = raiseFreq;
      existing.fold = 1 - raiseFreq;
    } else {
      range.set(hand, { fold: 1 - raiseFreq, call: 0, raise: raiseFreq, allIn: 0 });
    }
  }

  for (const hand of spec.alwaysCall) {
    const existing = range.get(hand);
    if (existing) {
      // Already has raise freq, remaining goes to call
      existing.call = 1 - existing.raise - existing.allIn;
      existing.fold = 0;
    } else {
      range.set(hand, { fold: 0, call: 1, raise: 0, allIn: 0 });
    }
  }

  for (const [hand, callFreq] of spec.mixedCall) {
    const existing = range.get(hand);
    if (existing) {
      existing.call = callFreq;
      existing.fold = Math.max(0, 1 - existing.raise - existing.call - existing.allIn);
    } else {
      range.set(hand, { fold: 1 - callFreq, call: callFreq, raise: 0, allIn: 0 });
    }
  }

  return range;
}

// ── Helper: generate pair range "AA" down to "66" etc. ────

function pairs(from: string, to: string): HandKey[] {
  const ranks = 'AKQJT98765432';
  const fromIdx = ranks.indexOf(from);
  const toIdx = ranks.indexOf(to);
  const result: HandKey[] = [];
  for (let i = fromIdx; i <= toIdx; i++) {
    result.push(`${ranks[i]}${ranks[i]}`);
  }
  return result;
}

function suitedRange(high: string, fromLow: string, toLow: string): HandKey[] {
  const ranks = 'AKQJT98765432';
  const fromIdx = ranks.indexOf(fromLow);
  const toIdx = ranks.indexOf(toLow);
  const result: HandKey[] = [];
  for (let i = fromIdx; i <= toIdx; i++) {
    if (ranks[i] !== high) {
      result.push(`${high}${ranks[i]}s`);
    }
  }
  return result;
}

function offsuitRange(high: string, fromLow: string, toLow: string): HandKey[] {
  const ranks = 'AKQJT98765432';
  const fromIdx = ranks.indexOf(fromLow);
  const toIdx = ranks.indexOf(toLow);
  const result: HandKey[] = [];
  for (let i = fromIdx; i <= toIdx; i++) {
    if (ranks[i] !== high) {
      result.push(`${high}${ranks[i]}o`);
    }
  }
  return result;
}

// ── RFI Ranges by Position ─────────────────────────────────

const UTG_RFI: RangeSpec = {
  alwaysRaise: [
    ...pairs('A', '7'),           // AA-77
    ...suitedRange('A', 'K', 'T'), // AKs-ATs
    'KQs', 'KJs',
    'AKo', 'AQo',
  ],
  mixedRaise: [
    ['66', 0.7],
    ['AJo', 0.8],
    ['QJs', 0.6],
    ['JTs', 0.5],
  ],
  alwaysCall: [],
  mixedCall: [],
};

const UTG1_RFI: RangeSpec = {
  alwaysRaise: [
    ...pairs('A', '6'),           // AA-66
    ...suitedRange('A', 'K', '9'), // AKs-A9s
    'KQs', 'KJs', 'QJs',
    'AKo', 'AQo', 'AJo',
  ],
  mixedRaise: [
    ['55', 0.8],
    ['KTs', 0.7],
    ['JTs', 0.7],
    ['T9s', 0.5],
    ['ATo', 0.5],
  ],
  alwaysCall: [],
  mixedCall: [],
};

const MP_RFI: RangeSpec = {
  alwaysRaise: [
    ...pairs('A', '5'),           // AA-55
    ...suitedRange('A', 'K', '7'), // AKs-A7s
    'A5s', 'A4s',                  // wheel aces
    'KQs', 'KJs', 'KTs',
    'QJs', 'QTs', 'JTs',
    'T9s',
    'AKo', 'AQo', 'AJo', 'ATo',
    'KQo',
  ],
  mixedRaise: [
    ['44', 0.7],
    ['33', 0.5],
    ['A3s', 0.5],
    ['A6s', 0.8],
    ['K9s', 0.6],
    ['Q9s', 0.4],
    ['J9s', 0.4],
    ['98s', 0.5],
  ],
  alwaysCall: [],
  mixedCall: [],
};

const CO_RFI: RangeSpec = {
  alwaysRaise: [
    ...pairs('A', '3'),           // AA-33
    ...suitedRange('A', 'K', '2'), // AKs-A2s
    ...suitedRange('K', 'Q', '7'), // KQs-K7s
    'QJs', 'QTs', 'Q9s',
    'JTs', 'J9s', 'J8s',
    'T9s', 'T8s',
    '98s', '87s',
    'AKo', 'AQo', 'AJo', 'ATo',
    'KQo', 'KJo',
  ],
  mixedRaise: [
    ['22', 0.7],
    ['K6s', 0.6], ['K5s', 0.5],
    ['Q8s', 0.5],
    ['76s', 0.6], ['65s', 0.5],
    ['KTo', 0.6],
    ['QJo', 0.7],
    ['A9o', 0.6],
  ],
  alwaysCall: [],
  mixedCall: [],
};

const BTN_RFI: RangeSpec = {
  alwaysRaise: [
    ...pairs('A', '2'),           // All pairs
    ...suitedRange('A', 'K', '2'), // All suited aces
    ...suitedRange('K', 'Q', '2'), // K2s+
    ...suitedRange('Q', 'J', '5'), // QJs-Q5s
    ...suitedRange('J', 'T', '6'), // JTs-J6s
    'T9s', 'T8s', 'T7s',
    '98s', '97s', '96s',
    '87s', '86s',
    '76s', '75s',
    '65s', '64s',
    '54s', '53s',
    '43s',
    'AKo', 'AQo', 'AJo', 'ATo', 'A9o', 'A8o', 'A7o',
    'KQo', 'KJo', 'KTo',
    'QJo', 'QTo',
    'JTo',
  ],
  mixedRaise: [
    ['Q4s', 0.5], ['Q3s', 0.4], ['Q2s', 0.3],
    ['J5s', 0.4],
    ['T6s', 0.4],
    ['95s', 0.3],
    ['85s', 0.4],
    ['74s', 0.3],
    ['63s', 0.3],
    ['52s', 0.2],
    ['42s', 0.2],
    ['A6o', 0.5], ['A5o', 0.5], ['A4o', 0.4],
    ['K9o', 0.6], ['K8o', 0.3],
    ['Q9o', 0.4],
    ['J9o', 0.3],
    ['T9o', 0.4],
  ],
  alwaysCall: [],
  mixedCall: [],
};

const SB_RFI: RangeSpec = {
  // SB mostly 3-bets or folds; some calls
  alwaysRaise: [
    ...pairs('A', '4'),           // AA-44
    ...suitedRange('A', 'K', '2'), // All suited aces
    ...suitedRange('K', 'Q', '7'), // KQs-K7s
    'QJs', 'QTs', 'Q9s',
    'JTs', 'J9s',
    'T9s', 'T8s',
    '98s', '87s', '76s',
    'AKo', 'AQo', 'AJo', 'ATo',
    'KQo', 'KJo',
  ],
  mixedRaise: [
    ['33', 0.6], ['22', 0.5],
    ['K6s', 0.5], ['K5s', 0.4],
    ['Q8s', 0.5],
    ['J8s', 0.4],
    ['65s', 0.5], ['54s', 0.4],
    ['KTo', 0.5],
    ['QJo', 0.5],
    ['A9o', 0.6], ['A8o', 0.4],
  ],
  alwaysCall: [],
  mixedCall: [],
};

// ── BB Defense Ranges ──────────────────────────────────────

const BB_VS_EP: RangeSpec = {
  // ~25% defense vs EP open
  alwaysRaise: [
    ...pairs('A', 'Q'),  // AA-QQ
    'AKs', 'AKo',
  ],
  mixedRaise: [
    ['JJ', 0.5],
    ['AQs', 0.6],
    ['AQo', 0.3],
  ],
  alwaysCall: [
    ...pairs('T', '5'),  // TT-55
    ...suitedRange('A', 'Q', '9'), // AQs-A9s
    'KQs', 'KJs',
    'QJs', 'JTs',
  ],
  mixedCall: [
    ['44', 0.6], ['33', 0.5],
    ['A8s', 0.5], ['A7s', 0.4],
    ['KTs', 0.6],
    ['T9s', 0.6],
    ['98s', 0.5],
    ['87s', 0.4],
    ['AJo', 0.5],
    ['KQo', 0.4],
  ],
};

const BB_VS_LP: RangeSpec = {
  // ~40% defense vs BTN/CO open
  alwaysRaise: [
    ...pairs('A', 'T'),
    'AKs', 'AQs', 'AJs',
    'AKo', 'AQo',
  ],
  mixedRaise: [
    ['99', 0.4],
    ['ATs', 0.5],
    ['KQs', 0.5],
    ['A5s', 0.4], // blocker 3-bet
    ['A4s', 0.3],
    ['AJo', 0.3],
  ],
  alwaysCall: [
    ...pairs('9', '3'),
    ...suitedRange('A', 'K', '2'), // All suited aces
    ...suitedRange('K', 'Q', '5'), // KQs-K5s
    'QJs', 'QTs', 'Q9s',
    'JTs', 'J9s', 'J8s',
    'T9s', 'T8s',
    '98s', '97s',
    '87s', '86s',
    '76s', '75s',
    '65s', '54s',
    'ATo', 'AJo',
    'KQo', 'KJo', 'KTo',
    'QJo', 'QTo',
    'JTo',
  ],
  mixedCall: [
    ['22', 0.5],
    ['K4s', 0.4], ['K3s', 0.3],
    ['Q8s', 0.5],
    ['J7s', 0.3],
    ['96s', 0.3],
    ['85s', 0.3],
    ['74s', 0.2],
    ['64s', 0.3],
    ['53s', 0.2],
    ['43s', 0.2],
    ['A9o', 0.5], ['A8o', 0.3],
    ['K9o', 0.3],
    ['Q9o', 0.3],
    ['J9o', 0.2],
    ['T9o', 0.3],
  ],
};

// ── Facing 3-bet Ranges ────────────────────────────────────

const FACING_3BET_CONTINUE: RangeSpec = {
  alwaysRaise: [
    'AA', 'KK',
    'AKs',
  ],
  mixedRaise: [
    ['QQ', 0.7],
    ['AKo', 0.5],
    ['AQs', 0.3],
  ],
  alwaysCall: [
    'JJ', 'TT',
    'AQs', 'AJs',
    'KQs',
  ],
  mixedCall: [
    ['99', 0.7],
    ['88', 0.5],
    ['ATs', 0.5],
    ['AQo', 0.6],
    ['KJs', 0.4],
    ['QJs', 0.3],
    ['JTs', 0.3],
    ['AJo', 0.3],
  ],
};

// ── Facing 4-bet Range ─────────────────────────────────────

const FACING_4BET_CONTINUE: RangeSpec = {
  alwaysRaise: [  // 5-bet all-in
    'AA', 'KK',
  ],
  mixedRaise: [
    ['AKs', 0.6],
    ['QQ', 0.4],
  ],
  alwaysCall: [
    'AKo',
  ],
  mixedCall: [
    ['JJ', 0.5],
    ['AQs', 0.3],
  ],
};

// ── Limped Pot (BB check or raise option) ──────────────────

const LIMPED_POT_BB: RangeSpec = {
  alwaysRaise: [
    ...pairs('A', 'T'),
    'AKs', 'AQs', 'AJs', 'ATs',
    'AKo', 'AQo',
  ],
  mixedRaise: [
    ['99', 0.6], ['88', 0.5],
    ['A9s', 0.5], ['A8s', 0.4],
    ['KQs', 0.6], ['KJs', 0.5],
    ['AJo', 0.5],
    ['KQo', 0.4],
  ],
  alwaysCall: [],  // Already in, check behind with rest
  mixedCall: [],
};

// ── Build all ranges ───────────────────────────────────────

const RFI_RANGES: Map<Position, Range> = new Map([
  [Position.UTG, buildRange(UTG_RFI)],
  [Position.UTG1, buildRange(UTG1_RFI)],
  [Position.UTG2, buildRange(UTG1_RFI)], // Similar to UTG1
  [Position.MP, buildRange(MP_RFI)],
  [Position.MP1, buildRange(MP_RFI)],     // Similar to MP
  [Position.CO, buildRange(CO_RFI)],
  [Position.BTN, buildRange(BTN_RFI)],
  [Position.SB, buildRange(SB_RFI)],
  [Position.BB, buildRange(BTN_RFI)],     // BB doesn't RFI, but used as fallback
]);

const BB_DEFENSE_VS_EP = buildRange(BB_VS_EP);
const BB_DEFENSE_VS_LP = buildRange(BB_VS_LP);
const FACING_3BET_RANGE = buildRange(FACING_3BET_CONTINUE);
const FACING_4BET_RANGE = buildRange(FACING_4BET_CONTINUE);
const LIMPED_POT_RANGE = buildRange(LIMPED_POT_BB);

// ── Public API ─────────────────────────────────────────────

/**
 * Get the RFI (raise first in) range for a position.
 */
export function getRFIRange(position: Position): Range {
  return RFI_RANGES.get(position) || RFI_RANGES.get(Position.MP)!;
}

/**
 * Get BB defense range based on opener position.
 */
export function getBBDefenseRange(openerPosition: Position): Range {
  const isEarlyPos = [Position.UTG, Position.UTG1, Position.UTG2, Position.MP, Position.MP1]
    .includes(openerPosition);
  return isEarlyPos ? BB_DEFENSE_VS_EP : BB_DEFENSE_VS_LP;
}

/**
 * Get the range for facing a 3-bet.
 */
export function getFacing3BetRange(): Range {
  return FACING_3BET_RANGE;
}

/**
 * Get the range for facing a 4-bet.
 */
export function getFacing4BetRange(): Range {
  return FACING_4BET_RANGE;
}

/**
 * Get the limped pot range for BB.
 */
export function getLimpedPotRange(): Range {
  return LIMPED_POT_RANGE;
}

/**
 * Look up action frequencies for a hand in a range.
 * Returns default fold action if hand not in range.
 */
export function lookupHandInRange(hand: HandKey, range: Range): RangeAction {
  return range.get(hand) || { fold: 1, call: 0, raise: 0, allIn: 0 };
}

export { holeCardsToHandKey as toHandKey };
