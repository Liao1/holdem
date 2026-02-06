// ── GTO Module Types ───────────────────────────────────────

/** Poker table positions */
export enum Position {
  BTN = 'BTN',
  SB = 'SB',
  BB = 'BB',
  UTG = 'UTG',
  UTG1 = 'UTG1',
  UTG2 = 'UTG2',
  MP = 'MP',
  MP1 = 'MP1',
  CO = 'CO',
}

/** Simplified position categories for range lookup */
export enum PositionCategory {
  EARLY = 'EARLY',   // UTG, UTG1, UTG2
  MIDDLE = 'MIDDLE', // MP, MP1
  LATE = 'LATE',     // CO, BTN
  BLINDS = 'BLINDS', // SB, BB
}

/** Preflop scenario detected from action log */
export enum PreflopScenario {
  RFI = 'RFI',                 // First to voluntarily enter
  FACING_RAISE = 'FACING_RAISE',
  FACING_3BET = 'FACING_3BET',
  FACING_4BET = 'FACING_4BET',
  LIMPED_POT = 'LIMPED_POT',
}

/** Hand key string, e.g. "AA", "AKs", "T9o" */
export type HandKey = string;

/** Preflop range action frequencies (sum to 1.0) */
export interface RangeAction {
  fold: number;
  call: number;
  raise: number;
  allIn: number;
}

/** Compact range specification for building ranges */
export interface RangeSpec {
  alwaysRaise: HandKey[];
  mixedRaise: [HandKey, number][];   // [hand, raise frequency]
  alwaysCall: HandKey[];
  mixedCall: [HandKey, number][];    // [hand, call frequency]
}

/** Full range: hand key → action frequencies */
export type Range = Map<HandKey, RangeAction>;

/** Hand strength category for postflop decisions */
export enum HandCategory {
  PREMIUM = 'PREMIUM',           // Two pair+, top pair top kicker
  STRONG = 'STRONG',             // Top pair good kicker, overpair
  MARGINAL = 'MARGINAL',         // Middle pair, weak top pair
  WEAK = 'WEAK',                 // Bottom pair, ace high
  TRASH = 'TRASH',               // No pair, no draw
  MONSTER_DRAW = 'MONSTER_DRAW', // Combo draw (flush + straight)
  STRONG_DRAW = 'STRONG_DRAW',   // Flush draw or OESD
  WEAK_DRAW = 'WEAK_DRAW',      // Gutshot, backdoor draws
}

/** Board texture analysis result */
export interface BoardTexture {
  wetness: number;             // 0 (dry) to 1 (very wet)
  pairedBoard: boolean;
  monotone: boolean;           // 3+ same suit
  twoTone: boolean;            // exactly 2 suits
  rainbow: boolean;            // 3 different suits on flop
  connected: boolean;          // many straight draw possibilities
  highCard: number;            // highest card rank on board
  category: 'DRY' | 'SEMI_DRY' | 'SEMI_WET' | 'WET' | 'VERY_WET';
}

/** Draw information for a hand */
export interface DrawInfo {
  hasFlushDraw: boolean;
  hasNutFlushDraw: boolean;
  hasOESD: boolean;            // open-ended straight draw
  hasGutshot: boolean;
  hasBackdoorFlush: boolean;
  hasBackdoorStraight: boolean;
  outs: number;                // estimated total outs
}

/** Combined hand analysis result */
export interface HandAnalysis {
  category: HandCategory;
  draws: DrawInfo;
  relativeStrength: number;    // 0-1 scale
  madeHandRank: number;        // from HandRank enum (1=best, 10=worst)
  topPairOrBetter: boolean;
  overpair: boolean;
}

/** Bet sizing context */
export interface BetSizingContext {
  potSize: number;
  street: 'FLOP' | 'TURN' | 'RIVER';
  boardTexture: BoardTexture;
  isCheckRaise: boolean;
  facingBetAmount: number;     // 0 if initiating
}
