import type { GameState } from '../engine/types';
import { GamePhase, ActionType } from '../engine/types';
import PlayerSeat from './PlayerSeat';
import CommunityCards from './CommunityCards';
import PotDisplay from './PotDisplay';
import ActionPanel from './ActionPanel';
import HandResult from './HandResult';
import GameLog from './GameLog';
import { getSeatPosition } from '../utils/seatLayout';

interface PokerTableProps {
  gameState: GameState;
  onAction: (type: ActionType, amount: number) => void;
}

export default function PokerTable({ gameState, onAction }: PokerTableProps) {
  const {
    players, communityCards, pots, phase,
    dealerIndex, smallBlindIndex, bigBlindIndex,
    activePlayerIndex, winners, actionLog, handNumber,
    humanActionRequired, legalActions,
  } = gameState;

  const totalPlayers = players.length;
  const isShowdown = phase === GamePhase.SHOWDOWN;
  const isGameOver = phase === GamePhase.GAME_OVER;

  const currentPot = pots.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="relative w-full h-full bg-gradient-to-b from-gray-900 to-gray-950 overflow-hidden">
      {/* Main table area (excludes log panel) */}
      <div className="absolute inset-0 mr-52">
        {/* Table felt */}
        <div
          className="absolute top-[10%] left-[8%] right-[8%] bottom-[18%]
            bg-gradient-to-b from-[var(--color-felt-green)] to-[var(--color-felt-dark)]
            rounded-[50%] border-[6px] border-[var(--color-felt-border)]
            shadow-[inset_0_0_60px_rgba(0,0,0,0.3),0_0_40px_rgba(0,0,0,0.5)]"
        />

        {/* Community cards + pot at table center */}
        <div
          className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 z-10"
          style={{ top: '35%' }}
        >
          <PotDisplay pots={pots} showDetails={isShowdown} />
          <CommunityCards cards={communityCards} />
        </div>

        {/* Player seats */}
        {players.map((player) => {
          const position = getSeatPosition(player.seatIndex, totalPlayers);
          return (
            <PlayerSeat
              key={player.id}
              player={player}
              isActive={player.seatIndex === activePlayerIndex}
              isDealer={player.seatIndex === dealerIndex}
              isSB={player.seatIndex === smallBlindIndex}
              isBB={player.seatIndex === bigBlindIndex}
              showCards={player.isHuman || isShowdown}
              style={position}
            />
          );
        })}

        {/* Hand result overlay */}
        {winners && winners.length > 0 && (
          <HandResult winners={winners} />
        )}

        {/* Hand number */}
        <div className="absolute top-3 left-3 text-xs text-gray-500">
          Hand #{handNumber}
        </div>

        {/* Action panel */}
        <ActionPanel
          legalActions={legalActions}
          currentPot={currentPot}
          onAction={onAction}
          enabled={humanActionRequired}
        />
      </div>

      {/* Game over overlay */}
      {isGameOver && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-yellow-500 rounded-2xl p-8 text-center">
            <h2 className="text-3xl font-bold text-yellow-400 mb-2">
              {players.find(p => p.isHuman)?.status === 'BUSTED'
                ? 'Game Over'
                : 'You Win!'}
            </h2>
            <p className="text-gray-400 mb-4">
              {players.find(p => p.isHuman)?.status === 'BUSTED'
                ? 'You ran out of chips.'
                : 'All opponents eliminated!'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-yellow-600 hover:bg-yellow-500 text-black font-bold rounded-lg transition-colors"
            >
              Play Again
            </button>
          </div>
        </div>
      )}

      {/* Game log */}
      <GameLog entries={actionLog} currentHand={handNumber} />
    </div>
  );
}
