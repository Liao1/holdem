import type { Player, Pot, EvaluatedHand, WinnerInfo } from './types';
import { compareEvaluatedHands } from './hand-evaluator';

/**
 * Build side pots using the iterative peel-off algorithm.
 * 1. Collect unique totalBetThisHand values, sort ascending
 * 2. Peel each layer: amount = increment * participants
 * 3. Eligible = invested >= layer threshold AND not folded
 * 4. Merge adjacent pots with identical eligible sets
 */
export function buildSidePots(players: Player[]): Pot[] {
  // Only consider players who bet something
  const bettors = players.filter(p => p.totalBetThisHand > 0);
  if (bettors.length === 0) return [];

  // Get unique bet levels, sorted ascending
  const betLevels = [...new Set(bettors.map(p => p.totalBetThisHand))].sort((a, b) => a - b);

  const pots: Pot[] = [];
  let previousLevel = 0;

  for (const level of betLevels) {
    const increment = level - previousLevel;
    if (increment <= 0) continue;

    // Players who contributed at least this level
    const contributors = bettors.filter(p => p.totalBetThisHand >= level);
    const potAmount = increment * contributors.length;

    // Eligible = contributed at this level AND not folded
    const eligible = contributors
      .filter(p => p.status !== 'FOLDED')
      .map(p => p.id);

    pots.push({ amount: potAmount, eligiblePlayerIds: eligible });
    previousLevel = level;
  }

  // Merge adjacent pots with identical eligible sets
  return mergePots(pots);
}

function mergePots(pots: Pot[]): Pot[] {
  if (pots.length <= 1) return pots;

  const merged: Pot[] = [pots[0]];
  for (let i = 1; i < pots.length; i++) {
    const last = merged[merged.length - 1];
    if (sameEligible(last.eligiblePlayerIds, pots[i].eligiblePlayerIds)) {
      last.amount += pots[i].amount;
    } else {
      merged.push({ ...pots[i] });
    }
  }
  return merged;
}

function sameEligible(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/**
 * Distribute pots to winners.
 * Each pot is independently settled.
 * Ties split evenly; odd chip goes to closest player left of dealer (worst position).
 */
export function distributePots(
  pots: Pot[],
  playerHands: Map<string, EvaluatedHand>,
  players: Player[],
  dealerIndex: number,
): WinnerInfo[] {
  const results: WinnerInfo[] = [];

  for (let potIndex = 0; potIndex < pots.length; potIndex++) {
    const pot = pots[potIndex];
    const eligible = pot.eligiblePlayerIds.filter(id => playerHands.has(id));

    if (eligible.length === 0) {
      // No eligible player with evaluated hand (shouldn't happen, but handle gracefully)
      // Give to the first eligible player
      if (pot.eligiblePlayerIds.length > 0) {
        results.push({
          playerId: pot.eligiblePlayerIds[0],
          playerName: players.find(p => p.id === pot.eligiblePlayerIds[0])?.name || '',
          amount: pot.amount,
          potIndex,
        });
      }
      continue;
    }

    if (eligible.length === 1) {
      const player = players.find(p => p.id === eligible[0])!;
      results.push({
        playerId: eligible[0],
        playerName: player.name,
        amount: pot.amount,
        potIndex,
        hand: playerHands.get(eligible[0]),
      });
      continue;
    }

    // Find the best hand among eligible players
    let bestHand = playerHands.get(eligible[0])!;
    for (let i = 1; i < eligible.length; i++) {
      const hand = playerHands.get(eligible[i])!;
      if (compareEvaluatedHands(hand, bestHand) > 0) {
        bestHand = hand;
      }
    }

    // Find all players with the best hand (ties)
    const winners = eligible.filter(id => {
      const hand = playerHands.get(id)!;
      return compareEvaluatedHands(hand, bestHand) === 0;
    });

    if (winners.length === 1) {
      const player = players.find(p => p.id === winners[0])!;
      results.push({
        playerId: winners[0],
        playerName: player.name,
        amount: pot.amount,
        potIndex,
        hand: playerHands.get(winners[0]),
      });
    } else {
      // Split pot
      const share = Math.floor(pot.amount / winners.length);
      const remainder = pot.amount - share * winners.length;

      // Sort winners by position: closest left of dealer gets odd chips
      const sortedWinners = sortByPositionFromDealer(winners, players, dealerIndex);

      for (let i = 0; i < sortedWinners.length; i++) {
        const player = players.find(p => p.id === sortedWinners[i])!;
        const extraChip = i < remainder ? 1 : 0;
        results.push({
          playerId: sortedWinners[i],
          playerName: player.name,
          amount: share + extraChip,
          potIndex,
          hand: playerHands.get(sortedWinners[i]),
        });
      }
    }
  }

  return results;
}

/**
 * Sort players by position starting from left of dealer (worst position first).
 * Odd chips go to the first in this order.
 */
function sortByPositionFromDealer(
  winnerIds: string[],
  players: Player[],
  dealerIndex: number,
): string[] {
  const totalPlayers = players.length;
  return [...winnerIds].sort((a, b) => {
    const playerA = players.find(p => p.id === a)!;
    const playerB = players.find(p => p.id === b)!;
    const posA = (playerA.seatIndex - dealerIndex - 1 + totalPlayers) % totalPlayers;
    const posB = (playerB.seatIndex - dealerIndex - 1 + totalPlayers) % totalPlayers;
    return posA - posB;
  });
}
