import type { GameState } from '../types';
import { GamePhase } from '../types';
import { BIG_BLIND } from '../constants';
import type { BoardTexture, BetSizingContext } from './types';
import { analyzeBoardTexture } from './board-texture';

/**
 * Calculate an appropriate bet size as a chip amount.
 */
export function calculateBetSize(
  gameState: GameState,
  purpose: 'cbet' | 'value' | 'semibluff' | 'raise',
  facingBetAmount: number = 0,
): number {
  const potSize = getTotalPot(gameState);
  const street = phaseToStreet(gameState.phase);
  const texture = analyzeBoardTexture(gameState.communityCards);

  if (purpose === 'raise') {
    return calculateRaiseSize(facingBetAmount, potSize);
  }

  const pctOfPot = getBetPercentage(purpose, street, texture);
  let amount = Math.round(potSize * pctOfPot);

  // Add ±10% jitter to avoid being predictable
  const jitter = 1 + (Math.random() * 0.2 - 0.1);
  amount = Math.round(amount * jitter);

  // Round to nearest BB
  amount = Math.max(BIG_BLIND, Math.round(amount / BIG_BLIND) * BIG_BLIND);

  return amount;
}

/**
 * Calculate preflop open raise size.
 */
export function calculatePreflopRaiseSize(
  gameState: GameState,
  isFromSB: boolean = false,
  numLimpers: number = 0,
): number {
  const bb = BIG_BLIND;
  let size: number;

  if (numLimpers > 0) {
    // ISO raise: 3bb + 1bb per limper
    size = bb * (3 + numLimpers);
  } else if (isFromSB) {
    size = bb * 3;
  } else {
    size = Math.round(bb * 2.5);
  }

  return size;
}

/**
 * Calculate 3-bet size (~3x the open raise).
 */
export function calculate3BetSize(openRaiseAmount: number): number {
  const size = Math.round(openRaiseAmount * 3);
  return Math.max(size, BIG_BLIND * 3);
}

/**
 * Calculate 4-bet size (~2.25x the 3-bet).
 */
export function calculate4BetSize(threeBetAmount: number): number {
  const size = Math.round(threeBetAmount * 2.25);
  return Math.max(size, BIG_BLIND * 4);
}

/**
 * Get bet percentage of pot based on purpose, street, and texture.
 */
function getBetPercentage(
  purpose: 'cbet' | 'value' | 'semibluff',
  street: 'FLOP' | 'TURN' | 'RIVER',
  texture: BoardTexture,
): number {
  const isDry = texture.category === 'DRY' || texture.category === 'SEMI_DRY';

  switch (purpose) {
    case 'cbet':
      if (street === 'FLOP') return isDry ? 0.33 : 0.55;
      if (street === 'TURN') return 0.60;
      return 0.70; // river
    case 'value':
      if (street === 'FLOP') return 0.60;
      if (street === 'TURN') return 0.66;
      return 0.75; // river
    case 'semibluff':
      if (street === 'FLOP') return 0.65;
      if (street === 'TURN') return 0.65;
      return 0.70; // river (pure bluff on river, not semi)
    default:
      return 0.50;
  }
}

/**
 * Calculate raise size (~3x the facing bet, or pot-sized).
 */
function calculateRaiseSize(facingBet: number, potSize: number): number {
  // Standard raise: ~2.5-3x facing bet
  const multiplier = 2.5 + Math.random() * 0.5;
  let raiseTotal = Math.round(facingBet * multiplier);

  // Cap at pot size
  raiseTotal = Math.min(raiseTotal, potSize + facingBet);

  // Round to BB
  raiseTotal = Math.max(BIG_BLIND * 2, Math.round(raiseTotal / BIG_BLIND) * BIG_BLIND);

  return raiseTotal;
}

/**
 * Get total pot size (sum of all pots + current round bets).
 */
function getTotalPot(gameState: GameState): number {
  let total = 0;
  for (const pot of gameState.pots) {
    total += pot.amount;
  }
  // Add current round bets not yet collected
  for (const p of gameState.players) {
    total += p.currentBet;
  }
  return Math.max(total, BIG_BLIND);
}

function phaseToStreet(phase: GamePhase): 'FLOP' | 'TURN' | 'RIVER' {
  switch (phase) {
    case GamePhase.FLOP: return 'FLOP';
    case GamePhase.TURN: return 'TURN';
    case GamePhase.RIVER: return 'RIVER';
    default: return 'FLOP';
  }
}
