import type { Card, Suit } from '../../types';

/**
 * Mapping from game suit to solver suit index.
 * Solver convention: 0=clubs, 1=diamonds, 2=hearts, 3=spades.
 */
const SUIT_TO_SOLVER: Record<Suit, number> = {
  clubs: 0,
  diamonds: 1,
  hearts: 2,
  spades: 3,
};

const SOLVER_TO_SUIT: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

/**
 * Convert a game Card to solver card ID (0-51).
 * Solver encoding: cardId = (rank - 2) * 4 + suitIndex
 * rank 0=2, 1=3, ..., 12=Ace
 */
export function cardToSolverId(card: Card): number {
  return (card.rank - 2) * 4 + SUIT_TO_SOLVER[card.suit];
}

/**
 * Convert a solver card ID (0-51) back to a game Card.
 */
export function solverIdToCard(id: number): Card {
  const rank = Math.floor(id / 4) + 2;
  const suit = SOLVER_TO_SUIT[id % 4];
  return { rank: rank as Card['rank'], suit };
}

/**
 * Convert an array of board Cards to solver card IDs (Uint8Array for WASM).
 */
export function boardToSolverIds(board: Card[]): Uint8Array {
  return new Uint8Array(board.map(cardToSolverId));
}

/**
 * Compute the 1326-combo index for two solver card IDs.
 * For c1 < c2: index = 52*c1 - c1*(c1+1)/2 + c2 - c1 - 1
 */
export function comboIndex(solverIdA: number, solverIdB: number): number {
  const c1 = Math.min(solverIdA, solverIdB);
  const c2 = Math.max(solverIdA, solverIdB);
  return 52 * c1 - (c1 * (c1 + 1)) / 2 + c2 - c1 - 1;
}

/**
 * Find the combo index for a pair of hole cards in the private cards array
 * returned by the solver.
 *
 * privateCards is a Uint16Array where each element packs two card IDs:
 *   low byte = card1, high byte = card2
 *
 * Returns the index into the private cards array, or -1 if not found.
 */
export function findHandInPrivateCards(
  holeCards: Card[],
  privateCards: Uint16Array,
): number {
  const id0 = cardToSolverId(holeCards[0]);
  const id1 = cardToSolverId(holeCards[1]);

  for (let i = 0; i < privateCards.length; i++) {
    const packed = privateCards[i];
    const c1 = packed & 0xff;
    const c2 = (packed >> 8) & 0xff;
    if ((c1 === id0 && c2 === id1) || (c1 === id1 && c2 === id0)) {
      return i;
    }
  }
  return -1;
}
