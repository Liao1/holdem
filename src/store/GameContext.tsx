import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react';
import { gameReducer, initialUIState, type UIState, type UIAction } from './gameReducer';

interface GameContextValue {
  state: UIState;
  dispatch: Dispatch<UIAction>;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialUIState);

  return (
    <GameContext.Provider value={{ state, dispatch }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGameContext(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGameContext must be used within GameProvider');
  return ctx;
}
