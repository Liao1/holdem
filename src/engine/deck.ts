import type { Card, Suit, Rank } from './types';

const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

function createFullDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

/** Fisher-Yates shuffle using crypto.getRandomValues */
function shuffle(cards: Card[]): void {
  const arr = new Uint32Array(cards.length);
  crypto.getRandomValues(arr);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = arr[i] % (i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
}

export class Deck {
  private cards: Card[] = [];
  private index = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.cards = createFullDeck();
    shuffle(this.cards);
    this.index = 0;
  }

  draw(): Card {
    if (this.index >= this.cards.length) {
      throw new Error('No more cards in the deck');
    }
    return this.cards[this.index++];
  }

  burn(): void {
    if (this.index >= this.cards.length) {
      throw new Error('No more cards to burn');
    }
    this.index++;
  }

  get remaining(): number {
    return this.cards.length - this.index;
  }
}
