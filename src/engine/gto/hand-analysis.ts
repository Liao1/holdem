import type { Card, Rank, EvaluatedHand } from '../types';
import { HandRank } from '../types';
import { evaluateBestHand } from '../hand-evaluator';
import { analyzeBoardTexture } from './board-texture';
import { HandCategory } from './types';
import type { HandAnalysis, DrawInfo } from './types';

/**
 * Perform comprehensive hand analysis for postflop decision making.
 */
export function analyzeHand(
  holeCards: Card[],
  communityCards: Card[],
): HandAnalysis {
  const evaluated = evaluateBestHand(holeCards, communityCards);
  const draws = detectDraws(holeCards, communityCards);
  const relativeStrength = estimateRelativeStrength(evaluated, holeCards, communityCards);
  const topPairOrBetter = checkTopPairOrBetter(evaluated, holeCards, communityCards);
  const overpair = checkOverpair(holeCards, communityCards);
  const category = classifyHand(evaluated, draws, holeCards, communityCards, topPairOrBetter, overpair);

  return {
    category,
    draws,
    relativeStrength,
    madeHandRank: evaluated.rank,
    topPairOrBetter,
    overpair,
  };
}

/**
 * Classify hand into a strategic category.
 */
function classifyHand(
  evaluated: EvaluatedHand,
  draws: DrawInfo,
  holeCards: Card[],
  communityCards: Card[],
  topPairOrBetter: boolean,
  overpair: boolean,
): HandCategory {
  const rank = evaluated.rank;

  // Monster draw: combo draw (flush draw + straight draw)
  if (draws.hasFlushDraw && (draws.hasOESD || draws.hasGutshot) && rank >= HandRank.ONE_PAIR) {
    return HandCategory.MONSTER_DRAW;
  }

  // Premium: two pair or better, or top pair with top kicker
  if (rank <= HandRank.TWO_PAIR) {
    return HandCategory.PREMIUM;
  }

  if (rank === HandRank.ONE_PAIR) {
    if (overpair) return HandCategory.STRONG;
    if (topPairOrBetter) {
      // Check kicker quality
      const kickerRank = getKickerRank(holeCards, communityCards, evaluated);
      if (kickerRank >= 12) return HandCategory.PREMIUM; // TPTK (top pair top kicker)
      if (kickerRank >= 10) return HandCategory.STRONG;  // top pair good kicker
      return HandCategory.MARGINAL; // top pair weak kicker
    }
    // Middle or bottom pair
    const pairRelative = getPairPositionOnBoard(evaluated, communityCards);
    if (pairRelative === 'middle') return HandCategory.MARGINAL;
    return HandCategory.WEAK; // bottom pair
  }

  // Strong draw (no made hand)
  if (draws.hasFlushDraw || draws.hasOESD) {
    return HandCategory.STRONG_DRAW;
  }

  // Weak draw
  if (draws.hasGutshot || draws.hasBackdoorFlush || draws.hasBackdoorStraight) {
    return HandCategory.WEAK_DRAW;
  }

  // High card
  if (rank === HandRank.HIGH_CARD) {
    // Ace high has some showdown value
    const maxHoleRank = Math.max(holeCards[0].rank, holeCards[1].rank);
    if (maxHoleRank === 14) return HandCategory.WEAK;
    return HandCategory.TRASH;
  }

  return HandCategory.TRASH;
}

/**
 * Detect all drawing possibilities.
 */
function detectDraws(holeCards: Card[], communityCards: Card[]): DrawInfo {
  const allCards = [...holeCards, ...communityCards];
  const result: DrawInfo = {
    hasFlushDraw: false,
    hasNutFlushDraw: false,
    hasOESD: false,
    hasGutshot: false,
    hasBackdoorFlush: false,
    hasBackdoorStraight: false,
    outs: 0,
  };

  if (communityCards.length < 3) return result;

  // Flush draw detection
  const suitCounts = new Map<string, number>();
  for (const c of allCards) {
    suitCounts.set(c.suit, (suitCounts.get(c.suit) || 0) + 1);
  }

  for (const [suit, count] of suitCounts) {
    // Need at least one hole card in the suit to have a draw
    const holeInSuit = holeCards.filter(c => c.suit === suit);
    if (holeInSuit.length === 0) continue;

    if (count === 4 && communityCards.length <= 4) {
      result.hasFlushDraw = true;
      result.outs += 9;
      // Nut flush draw: holding the Ace of that suit
      if (holeInSuit.some(c => c.rank === 14)) {
        result.hasNutFlushDraw = true;
      }
    } else if (count === 3 && communityCards.length === 3) {
      // Backdoor flush draw on the flop
      if (holeInSuit.length >= 1) {
        result.hasBackdoorFlush = true;
        result.outs += 1; // ~1 effective out for backdoor
      }
    }
  }

  // Straight draw detection
  const straightInfo = detectStraightDraws(holeCards, communityCards);
  result.hasOESD = straightInfo.oesd;
  result.hasGutshot = straightInfo.gutshot;
  result.hasBackdoorStraight = straightInfo.backdoor;

  if (result.hasOESD) result.outs += 8;
  else if (result.hasGutshot) result.outs += 4;
  if (result.hasBackdoorStraight && !result.hasOESD && !result.hasGutshot) {
    result.outs += 1;
  }

  // Adjust for overlapping outs (flush + straight)
  if (result.hasFlushDraw && (result.hasOESD || result.hasGutshot)) {
    result.outs -= 2; // ~2 cards counted twice
  }

  return result;
}

/**
 * Detect straight draws using a window approach.
 */
function detectStraightDraws(
  holeCards: Card[],
  communityCards: Card[],
): { oesd: boolean; gutshot: boolean; backdoor: boolean } {
  const allCards = [...holeCards, ...communityCards];
  const allRanks = [...new Set(allCards.map(c => c.rank))].sort((a, b) => a - b);
  const holeRanks = new Set(holeCards.map(c => c.rank));

  // Add low-ace for wheel
  if (allRanks.includes(14)) allRanks.unshift(1);

  let oesd = false;
  let gutshot = false;
  let backdoor = false;

  // Check every 5-card window
  for (let high = 5; high <= 14; high++) {
    const low = high - 4;
    const inWindow = allRanks.filter(r => {
      const adjusted = r === 1 ? 1 : r;
      return adjusted >= low && adjusted <= high;
    });
    // Must use at least one hole card
    const holeInWindow = allRanks.filter(r => {
      const adjusted = r === 1 ? 1 : r;
      return adjusted >= low && adjusted <= high && (holeRanks.has(r) || (r === 1 && holeRanks.has(14)));
    });

    if (holeInWindow.length === 0) continue;

    const uniqueInWindow = new Set(inWindow.map(r => r === 1 ? 1 : r)).size;
    const gaps = 5 - uniqueInWindow;

    if (gaps === 1) {
      // Check if it's open-ended (missing card is on the outside)
      const presentInWindow: number[] = [];
      for (let r = low; r <= high; r++) {
        if (allRanks.some(ar => (ar === 1 ? 1 : ar) === r)) {
          presentInWindow.push(r);
        }
      }
      const missingRank = (() => {
        for (let r = low; r <= high; r++) {
          if (!presentInWindow.includes(r)) return r;
        }
        return -1;
      })();

      if (missingRank === low || missingRank === high) {
        // Edge missing → could be OESD if there's also another window
        oesd = true;
      } else {
        gutshot = true;
      }
    } else if (gaps === 2 && communityCards.length === 3) {
      backdoor = true;
    }
  }

  // OESD overrides gutshot
  if (oesd) gutshot = false;

  return { oesd, gutshot, backdoor };
}

/**
 * Estimate relative hand strength on a 0-1 scale.
 * Based on HandRank + kicker quality.
 */
function estimateRelativeStrength(
  evaluated: EvaluatedHand,
  holeCards: Card[],
  communityCards: Card[],
): number {
  // Base score from hand rank (1=Royal Flush → 1.0, 10=High Card → 0.1)
  const rankScore = (11 - evaluated.rank) / 10;

  // Kicker adjustment
  let kickerBonus = 0;
  if (evaluated.values.length > 1) {
    // Primary value (pair rank, trips rank, etc.)
    const primaryValue = evaluated.values[1] || 0;
    kickerBonus += (primaryValue / 14) * 0.05;
  }
  if (evaluated.values.length > 2) {
    const secondaryValue = evaluated.values[2] || 0;
    kickerBonus += (secondaryValue / 14) * 0.02;
  }

  // Board texture consideration: hand is weaker on wet boards
  const texture = analyzeBoardTexture(communityCards);
  const wetnessAdjust = -texture.wetness * 0.05;

  return Math.max(0, Math.min(1, rankScore + kickerBonus + wetnessAdjust));
}

/**
 * Check if the player has top pair or better using hole cards.
 */
function checkTopPairOrBetter(
  evaluated: EvaluatedHand,
  holeCards: Card[],
  communityCards: Card[],
): boolean {
  if (evaluated.rank < HandRank.ONE_PAIR) return true; // better than one pair

  if (evaluated.rank === HandRank.ONE_PAIR) {
    const boardHighest = Math.max(...communityCards.map(c => c.rank));
    // Check if our hole cards make a pair with the highest board card
    return holeCards.some(c => c.rank === boardHighest);
  }

  return false;
}

/**
 * Check if the player has an overpair (pocket pair above all board cards).
 */
function checkOverpair(holeCards: Card[], communityCards: Card[]): boolean {
  if (holeCards[0].rank !== holeCards[1].rank) return false;
  const pairRank = holeCards[0].rank;
  return communityCards.every(c => c.rank < pairRank);
}

/**
 * Determine kicker rank for a one-pair hand.
 */
function getKickerRank(
  holeCards: Card[],
  communityCards: Card[],
  evaluated: EvaluatedHand,
): number {
  if (evaluated.rank !== HandRank.ONE_PAIR) return 0;

  const pairRank = evaluated.values[1]; // The pair's rank
  // The kicker is the highest hole card that isn't the pair
  const kickers = holeCards
    .filter(c => c.rank !== pairRank)
    .map(c => c.rank);

  if (kickers.length > 0) return Math.max(...kickers);
  // Both hole cards make the pair (pocket pair that hit set? no, that's trips)
  // Or both hole cards are the pair rank → kicker from board
  return evaluated.values[2] || 0;
}

/**
 * Determine where a pair sits relative to the board.
 */
function getPairPositionOnBoard(
  evaluated: EvaluatedHand,
  communityCards: Card[],
): 'top' | 'middle' | 'bottom' {
  if (evaluated.rank !== HandRank.ONE_PAIR) return 'bottom';

  const pairRank = evaluated.values[1];
  const boardRanks = [...new Set(communityCards.map(c => c.rank))].sort((a, b) => b - a);

  if (pairRank === boardRanks[0]) return 'top';
  if (boardRanks.length >= 2 && pairRank > boardRanks[boardRanks.length - 1]) return 'middle';
  return 'bottom';
}
