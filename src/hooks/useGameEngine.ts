import { useRef, useCallback } from 'react';
import { GameEngine } from '../engine/game-engine';
import { getBotAction } from '../engine/bot-strategy';
import { useGameContext } from '../store/GameContext';
import type { GameState, PlayerAction, LegalAction, AnimationEvent } from '../engine/types';
import { ActionType } from '../engine/types';
import { ANIMATION_DURATION_MS } from '../engine/constants';

export function useGameEngine() {
  const { state, dispatch } = useGameContext();
  const engineRef = useRef<GameEngine | null>(null);
  const humanResolverRef = useRef<((action: PlayerAction) => void) | null>(null);

  const onStateChange = useCallback((gameState: GameState) => {
    dispatch({ type: 'UPDATE_STATE', payload: gameState });
  }, [dispatch]);

  const onActionRequest = useCallback(async (
    playerId: string,
    legalActions: LegalAction[],
  ): Promise<PlayerAction> => {
    const engine = engineRef.current;
    if (!engine) throw new Error('Engine not initialized');

    const gs = engine.getState();
    const player = gs.players.find(p => p.id === playerId);

    if (player?.isHuman) {
      // Update state to show legal actions for human
      const updatedState: GameState = {
        ...gs,
        humanActionRequired: true,
        legalActions,
      };
      dispatch({ type: 'UPDATE_STATE', payload: updatedState });

      // Wait for human input
      return new Promise<PlayerAction>((resolve) => {
        humanResolverRef.current = resolve;
      });
    } else {
      // Bot action
      return getBotAction(playerId, legalActions, gs);
    }
  }, [dispatch]);

  const onAnimation = useCallback(async (event: AnimationEvent): Promise<void> => {
    dispatch({ type: 'SET_ANIMATING', payload: true });
    await new Promise(resolve => setTimeout(resolve, ANIMATION_DURATION_MS));
    dispatch({ type: 'SET_ANIMATING', payload: false });
  }, [dispatch]);

  const startGame = useCallback((numOpponents: number) => {
    const engine = new GameEngine(numOpponents, onStateChange, onActionRequest, onAnimation);
    engineRef.current = engine;
    engine.startGame();
  }, [onStateChange, onActionRequest, onAnimation]);

  const submitHumanAction = useCallback((type: ActionType, amount: number) => {
    if (humanResolverRef.current) {
      const resolver = humanResolverRef.current;
      humanResolverRef.current = null;

      // Clear legal actions display
      const engine = engineRef.current;
      if (engine) {
        const gs = engine.getState();
        dispatch({
          type: 'UPDATE_STATE',
          payload: { ...gs, humanActionRequired: false, legalActions: [] },
        });
      }

      resolver({
        type,
        amount,
        playerId: 'human',
      });
    }
  }, [dispatch]);

  return {
    gameState: state.gameState,
    gameStarted: state.gameStarted,
    isAnimating: state.isAnimating,
    startGame,
    submitHumanAction,
  };
}
