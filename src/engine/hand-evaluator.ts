import type { Card, EvaluatedHand } from './types';
import { HandRank } from './types';
import { HAND_RANK_NAMES, RANK_LABELS } from './constants';

// Pre-compute all C(7,5)=21 combination indices
const COMBINATIONS_7_5: number[][] = [];
(function computeCombinations() {
  for (let i = 0; i < 7; i++)
    for (let j = i + 1; j < 7; j++)
      for (let k = j + 1; k < 7; k++)
        for (let l = k + 1; l < 7; l++)
          for (let m = l + 1; m < 7; m++)
            COMBINATIONS_7_5.push([i, j, k, l, m]);
})();

/** Evaluate the best 5-card hand from 2 hole cards + up to 5 community cards */
export function evaluateBestHand(holeCards: Card[], communityCards: Card[]): EvaluatedHand {
  const allCards = [...holeCards, ...communityCards];

  if (allCards.length < 5) {
    throw new Error(`Need at least 5 cards, got ${allCards.length}`);
  }

  if (allCards.length === 5) {
    return evaluateFiveCards(allCards);
  }

  let best: EvaluatedHand | null = null;

  // For 6 cards, compute C(6,5)=6 combinations
  // For 7 cards, use pre-computed C(7,5)=21 combinations
  const combos = allCards.length === 7
    ? COMBINATIONS_7_5
    : getCombinations(allCards.length, 5);

  for (const combo of combos) {
    const fiveCards = combo.map(i => allCards[i]);
    const evaluated = evaluateFiveCards(fiveCards);
    if (!best || compareEvaluatedHands(evaluated, best) > 0) {
      best = evaluated;
    }
  }

  return best!;
}

function getCombinations(n: number, k: number): number[][] {
  const result: number[][] = [];
  const combo: number[] = [];
  function backtrack(start: number) {
    if (combo.length === k) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < n; i++) {
      combo.push(i);
      backtrack(i + 1);
      combo.pop();
    }
  }
  backtrack(0);
  return result;
}

/** Evaluate a 5-card hand */
function evaluateFiveCards(cards: Card[]): EvaluatedHand {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);

  // Flush check
  const isFlush = suits.every(s => s === suits[0]);

  // Straight check
  const straightHighCard = getStraightHighCard(ranks);
  const isStraight = straightHighCard > 0;

  // Frequency map
  const freq = new Map<number, number>();
  for (const r of ranks) {
    freq.set(r, (freq.get(r) || 0) + 1);
  }

  // Sort by frequency desc, then rank desc
  const groups = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  // Determine hand rank
  if (isFlush && isStraight) {
    if (straightHighCard === 14) {
      return makeResult(HandRank.ROYAL_FLUSH, cards, [HandRank.ROYAL_FLUSH, 14], 'Royal Flush');
    }
    return makeResult(
      HandRank.STRAIGHT_FLUSH, cards,
      [HandRank.STRAIGHT_FLUSH, straightHighCard],
      `Straight Flush, ${RANK_LABELS[straightHighCard]} high`
    );
  }

  if (groups[0][1] === 4) {
    const quad = groups[0][0];
    const kicker = groups[1][0];
    return makeResult(
      HandRank.FOUR_OF_A_KIND, cards,
      [HandRank.FOUR_OF_A_KIND, quad, kicker],
      `Four of a Kind, ${RANK_LABELS[quad]}s`
    );
  }

  if (groups[0][1] === 3 && groups[1][1] === 2) {
    const trips = groups[0][0];
    const pair = groups[1][0];
    return makeResult(
      HandRank.FULL_HOUSE, cards,
      [HandRank.FULL_HOUSE, trips, pair],
      `Full House, ${RANK_LABELS[trips]}s full of ${RANK_LABELS[pair]}s`
    );
  }

  if (isFlush) {
    return makeResult(
      HandRank.FLUSH, cards,
      [HandRank.FLUSH, ...ranks],
      `Flush, ${RANK_LABELS[ranks[0]]} high`
    );
  }

  if (isStraight) {
    return makeResult(
      HandRank.STRAIGHT, cards,
      [HandRank.STRAIGHT, straightHighCard],
      `Straight, ${RANK_LABELS[straightHighCard]} high`
    );
  }

  if (groups[0][1] === 3) {
    const trips = groups[0][0];
    const kickers = groups.slice(1).map(g => g[0]).sort((a, b) => b - a);
    return makeResult(
      HandRank.THREE_OF_A_KIND, cards,
      [HandRank.THREE_OF_A_KIND, trips, ...kickers],
      `Three of a Kind, ${RANK_LABELS[trips]}s`
    );
  }

  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const highPair = Math.max(groups[0][0], groups[1][0]);
    const lowPair = Math.min(groups[0][0], groups[1][0]);
    const kicker = groups[2][0];
    return makeResult(
      HandRank.TWO_PAIR, cards,
      [HandRank.TWO_PAIR, highPair, lowPair, kicker],
      `Two Pair, ${RANK_LABELS[highPair]}s and ${RANK_LABELS[lowPair]}s`
    );
  }

  if (groups[0][1] === 2) {
    const pair = groups[0][0];
    const kickers = groups.slice(1).map(g => g[0]).sort((a, b) => b - a);
    return makeResult(
      HandRank.ONE_PAIR, cards,
      [HandRank.ONE_PAIR, pair, ...kickers],
      `Pair of ${RANK_LABELS[pair]}s`
    );
  }

  return makeResult(
    HandRank.HIGH_CARD, cards,
    [HandRank.HIGH_CARD, ...ranks],
    `${RANK_LABELS[ranks[0]]} High`
  );
}

/** Returns the high card of a straight, or 0 if not a straight */
function getStraightHighCard(sortedRanks: number[]): number {
  const unique = [...new Set(sortedRanks)].sort((a, b) => b - a);
  if (unique.length < 5) return 0;

  // Normal straight check
  if (unique[0] - unique[4] === 4) {
    return unique[0];
  }

  // Wheel: A-2-3-4-5 (A is high=14, but in wheel high card is 5)
  if (unique[0] === 14 && unique[1] === 5 && unique[2] === 4 && unique[3] === 3 && unique[4] === 2) {
    return 5;
  }

  return 0;
}

function makeResult(rank: HandRank, cards: Card[], values: number[], description: string): EvaluatedHand {
  return { rank, bestFive: [...cards], values, description };
}

/**
 * Compare two evaluated hands.
 * Returns >0 if a is better, <0 if b is better, 0 if tie.
 * Lower HandRank enum = better hand.
 */
export function compareEvaluatedHands(a: EvaluatedHand, b: EvaluatedHand): number {
  const maxLen = Math.max(a.values.length, b.values.length);
  for (let i = 0; i < maxLen; i++) {
    const va = a.values[i] ?? 0;
    const vb = b.values[i] ?? 0;
    if (i === 0) {
      // First value is HandRank: lower is better
      if (va !== vb) return vb - va;
    } else {
      // Subsequent values: higher is better
      if (va !== vb) return va - vb;
    }
  }
  return 0;
}
