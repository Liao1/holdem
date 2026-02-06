import { GameProvider } from './store/GameContext';
import GameSetup from './components/GameSetup';
import PokerTable from './components/PokerTable';
import { useGameEngine } from './hooks/useGameEngine';

function GameApp() {
  const { gameState, gameStarted, startGame, submitHumanAction } = useGameEngine();

  if (!gameStarted || !gameState) {
    return <GameSetup onStart={startGame} />;
  }

  return <PokerTable gameState={gameState} onAction={submitHumanAction} />;
}

export default function App() {
  return (
    <GameProvider>
      <GameApp />
    </GameProvider>
  );
}
