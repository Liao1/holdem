import type { Player, GameState } from '../types';
import { Position, PositionCategory } from './types';

/**
 * Position assignment tables by player count.
 * Positions are listed starting from SB, going clockwise.
 * The dealer button is always assigned to the last non-blind position.
 */
const POSITION_TABLES: Record<number, Position[]> = {
  2: [Position.SB, Position.BB],                                                          // SB=BTN
  3: [Position.SB, Position.BB, Position.BTN],
  4: [Position.SB, Position.BB, Position.UTG, Position.BTN],
  5: [Position.SB, Position.BB, Position.UTG, Position.CO, Position.BTN],
  6: [Position.SB, Position.BB, Position.UTG, Position.MP, Position.CO, Position.BTN],
  7: [Position.SB, Position.BB, Position.UTG, Position.UTG1, Position.MP, Position.CO, Position.BTN],
  8: [Position.SB, Position.BB, Position.UTG, Position.UTG1, Position.MP, Position.MP1, Position.CO, Position.BTN],
  9: [Position.SB, Position.BB, Position.UTG, Position.UTG1, Position.UTG2, Position.MP, Position.MP1, Position.CO, Position.BTN],
};

/**
 * Map a player to their table position based on seat arrangement and dealer button.
 */
export function getPlayerPosition(player: Player, gameState: GameState): Position {
  const activePlayers = gameState.players.filter(
    p => p.status !== 'BUSTED' && p.status !== 'SITTING_OUT'
  );
  const numPlayers = activePlayers.length;
  const table = POSITION_TABLES[numPlayers];
  if (!table) {
    // Fallback for unexpected counts
    return Position.MP;
  }

  // Build seat order starting from SB (one seat after dealer, clockwise)
  const dealerIdx = gameState.dealerIndex;
  const sorted = [...activePlayers].sort((a, b) => a.seatIndex - b.seatIndex);

  // Find dealer position in sorted array
  const dealerArrayIdx = sorted.findIndex(p => p.seatIndex === dealerIdx);
  if (dealerArrayIdx === -1) {
    // Dealer not found among active players; use first player
    const playerIdx = sorted.findIndex(p => p.id === player.id);
    return table[playerIdx % table.length];
  }

  // Reorder: start from the player after the dealer (SB position)
  const reordered: Player[] = [];
  for (let i = 1; i <= sorted.length; i++) {
    reordered.push(sorted[(dealerArrayIdx + i) % sorted.length]);
  }

  // Special case: heads-up, dealer = SB
  if (numPlayers === 2) {
    const dealerPlayer = sorted[dealerArrayIdx];
    if (player.id === dealerPlayer.id) return Position.SB;
    return Position.BB;
  }

  const playerIdx = reordered.findIndex(p => p.id === player.id);
  if (playerIdx === -1) return Position.MP; // fallback
  return table[playerIdx];
}

/**
 * Get the position category for simplified range lookup.
 */
export function getPositionCategory(pos: Position): PositionCategory {
  switch (pos) {
    case Position.UTG:
    case Position.UTG1:
    case Position.UTG2:
      return PositionCategory.EARLY;
    case Position.MP:
    case Position.MP1:
      return PositionCategory.MIDDLE;
    case Position.CO:
    case Position.BTN:
      return PositionCategory.LATE;
    case Position.SB:
    case Position.BB:
      return PositionCategory.BLINDS;
  }
}

/**
 * Check if a player is in position (acts last postflop).
 * BTN is always in position; in heads-up, non-BB is IP.
 */
export function isInPosition(player: Player, gameState: GameState): boolean {
  const pos = getPlayerPosition(player, gameState);
  const activePlayers = gameState.players.filter(
    p => p.status !== 'BUSTED' && p.status !== 'SITTING_OUT'
  );
  if (activePlayers.length === 2) {
    return pos === Position.SB; // HU: dealer/SB is IP postflop
  }
  return pos === Position.BTN;
}

/**
 * Count active players in the hand (not folded, not busted).
 */
export function countActivePlayers(gameState: GameState): number {
  return gameState.players.filter(
    p => p.status === 'ACTIVE' || p.status === 'ALL_IN'
  ).length;
}
