import type { PlayerAction, LegalAction, GameState } from './types';
import { GamePhase } from './types';
import { BOT_THINK_MIN_MS, BOT_THINK_MAX_MS } from './constants';
import { getPreflopAction, getPostflopAction } from './gto';

/**
 * Get a bot action using GTO-based strategy with simulated thinking delay.
 */
export async function getBotAction(
  playerId: string,
  legalActions: LegalAction[],
  gameState: GameState,
): Promise<PlayerAction> {
  // Simulate thinking
  const delay = BOT_THINK_MIN_MS + Math.random() * (BOT_THINK_MAX_MS - BOT_THINK_MIN_MS);
  await new Promise(resolve => setTimeout(resolve, delay));

  const player = gameState.players.find(p => p.id === playerId)!;

  if (gameState.phase === GamePhase.PRE_FLOP) {
    return getPreflopAction(player, gameState, legalActions);
  } else {
    return await getPostflopAction(player, gameState, legalActions);
  }
}
