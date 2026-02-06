import type { Suit } from './types';

export const BIG_BLIND = 4;
export const SMALL_BLIND = 2;
export const STARTING_CHIPS = 400;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 9;

export const BOT_NAMES = [
  'Alice', 'Bob', 'Charlie', 'Diana',
  'Eve', 'Frank', 'Grace', 'Hank',
];

export const SUIT_SYMBOLS: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

export const RANK_LABELS: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

export const HAND_RANK_NAMES: Record<number, string> = {
  1: 'Royal Flush',
  2: 'Straight Flush',
  3: 'Four of a Kind',
  4: 'Full House',
  5: 'Flush',
  6: 'Straight',
  7: 'Three of a Kind',
  8: 'Two Pair',
  9: 'One Pair',
  10: 'High Card',
};

export const BOT_THINK_MIN_MS = 1000;
export const BOT_THINK_MAX_MS = 3000;
export const ANIMATION_DURATION_MS = 400;
