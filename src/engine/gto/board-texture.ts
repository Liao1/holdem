import type { Card, Rank } from '../types';
import type { BoardTexture } from './types';

/**
 * Analyze the texture of community cards.
 */
export function analyzeBoardTexture(communityCards: Card[]): BoardTexture {
  if (communityCards.length < 3) {
    return {
      wetness: 0,
      pairedBoard: false,
      monotone: false,
      twoTone: false,
      rainbow: true,
      connected: false,
      highCard: 0,
      category: 'DRY',
    };
  }

  const ranks = communityCards.map(c => c.rank).sort((a, b) => b - a);
  const suits = communityCards.map(c => c.suit);
  const highCard = ranks[0];

  // Suit analysis
  const suitCounts = new Map<string, number>();
  for (const s of suits) {
    suitCounts.set(s, (suitCounts.get(s) || 0) + 1);
  }
  const maxSuitCount = Math.max(...suitCounts.values());
  const monotone = maxSuitCount >= 3;
  const twoTone = suitCounts.size === 2 && !monotone;
  const rainbow = suitCounts.size >= 3;

  // Pair check
  const rankCounts = new Map<number, number>();
  for (const r of ranks) {
    rankCounts.set(r, (rankCounts.get(r) || 0) + 1);
  }
  const pairedBoard = [...rankCounts.values()].some(c => c >= 2);

  // Connectivity analysis
  const uniqueRanks = [...new Set(ranks)].sort((a, b) => b - a);
  const connectedness = calculateConnectedness(uniqueRanks);
  const connected = connectedness >= 0.4;

  // Straight possibility count
  const straightPossibility = countStraightPossibilities(uniqueRanks);

  // Wetness score
  let wetness = 0;
  if (monotone) wetness += 0.35;
  else if (twoTone) wetness += 0.15;
  wetness += connectedness * 0.25;
  if (straightPossibility > 0) wetness += Math.min(straightPossibility * 0.08, 0.25);
  if (pairedBoard) wetness -= 0.10;
  wetness = Math.max(0, Math.min(1, wetness));

  const category = categorizeWetness(wetness);

  return {
    wetness,
    pairedBoard,
    monotone,
    twoTone,
    rainbow,
    connected,
    highCard,
    category,
  };
}

/**
 * Calculate how connected the board ranks are (0-1).
 * Looks at gaps between adjacent unique ranks.
 */
function calculateConnectedness(uniqueRanks: number[]): number {
  if (uniqueRanks.length < 2) return 0;

  let closeCount = 0;
  let totalGaps = 0;

  for (let i = 0; i < uniqueRanks.length - 1; i++) {
    const gap = uniqueRanks[i] - uniqueRanks[i + 1];
    totalGaps++;
    if (gap <= 2) closeCount++;       // adjacent or one-gapper
  }

  // Also consider wheel connectivity (A-2-3-4-5)
  if (uniqueRanks.includes(14) && uniqueRanks.some(r => r <= 5)) {
    closeCount += 0.3;
  }

  return totalGaps > 0 ? Math.min(closeCount / totalGaps, 1) : 0;
}

/**
 * Count how many possible straight draws the board supports.
 */
function countStraightPossibilities(uniqueRanks: number[]): number {
  let count = 0;

  // Check all possible 5-card straight windows
  const allRanks = [...uniqueRanks];
  // Add low-ace for wheel
  if (allRanks.includes(14)) allRanks.push(1);

  for (let high = 14; high >= 5; high--) {
    let inWindow = 0;
    for (const r of allRanks) {
      const adjusted = r === 1 ? 1 : r;
      if (adjusted <= high && adjusted > high - 5) inWindow++;
    }
    if (inWindow >= 2) count++;
  }

  return count;
}

function categorizeWetness(wetness: number): BoardTexture['category'] {
  if (wetness < 0.15) return 'DRY';
  if (wetness < 0.30) return 'SEMI_DRY';
  if (wetness < 0.50) return 'SEMI_WET';
  if (wetness < 0.70) return 'WET';
  return 'VERY_WET';
}
