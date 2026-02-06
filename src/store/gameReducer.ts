import type { GameState } from '../engine/types';
import { GamePhase } from '../engine/types';

export interface UIState {
  gameState: GameState | null;
  isAnimating: boolean;
  gameStarted: boolean;
}

export type UIAction =
  | { type: 'UPDATE_STATE'; payload: GameState }
  | { type: 'SET_ANIMATING'; payload: boolean }
  | { type: 'RESET' };

export const initialUIState: UIState = {
  gameState: null,
  isAnimating: false,
  gameStarted: false,
};

export function gameReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'UPDATE_STATE':
      return {
        ...state,
        gameState: action.payload,
        gameStarted: true,
      };
    case 'SET_ANIMATING':
      return { ...state, isAnimating: action.payload };
    case 'RESET':
      return initialUIState;
    default:
      return state;
  }
}
