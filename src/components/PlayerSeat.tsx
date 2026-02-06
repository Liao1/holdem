import { motion } from 'motion/react';
import type { Player } from '../engine/types';
import Card from './Card';

interface PlayerSeatProps {
  player: Player;
  isActive: boolean;
  isDealer: boolean;
  isSB: boolean;
  isBB: boolean;
  showCards: boolean;
  style: { top: string; left: string };
}

export default function PlayerSeat({
  player, isActive, isDealer, isSB, isBB, showCards, style,
}: PlayerSeatProps) {
  if (player.status === 'BUSTED') return null;

  const isFolded = player.status === 'FOLDED';
  const isAllIn = player.status === 'ALL_IN';

  return (
    <motion.div
      className="absolute flex flex-col items-center gap-1"
      style={{
        top: style.top,
        left: style.left,
        transform: 'translate(-50%, -50%)',
      }}
      animate={isActive ? { scale: 1.05 } : { scale: 1 }}
    >
      {/* Position badges */}
      <div className="flex gap-1 mb-0.5">
        {isDealer && (
          <span className="text-[10px] font-bold bg-yellow-500 text-black px-1.5 py-0.5 rounded-full">D</span>
        )}
        {isSB && (
          <span className="text-[10px] font-bold bg-blue-500 text-white px-1.5 py-0.5 rounded-full">SB</span>
        )}
        {isBB && (
          <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full">BB</span>
        )}
      </div>

      {/* Hole cards */}
      <div className="flex gap-0.5 mb-1 h-[62px]">
        {player.holeCards.length > 0 ? (
          player.holeCards.map((card, i) => (
            <Card
              key={i}
              card={card}
              faceUp={showCards && !isFolded}
              dealing
              delay={i * 0.1}
              small
            />
          ))
        ) : (
          <div className="w-[92px] h-[62px]" />
        )}
      </div>

      {/* Player info box */}
      <div
        className={`
          relative rounded-lg px-3 py-1.5 min-w-[100px] text-center
          border-2 transition-all duration-300
          ${isActive
            ? 'border-yellow-400 bg-gray-800/90 shadow-[0_0_15px_rgba(250,204,21,0.4)]'
            : isFolded
              ? 'border-gray-600/50 bg-gray-800/40 opacity-50'
              : isAllIn
                ? 'border-red-500 bg-gray-800/90 shadow-[0_0_10px_rgba(239,68,68,0.3)]'
                : 'border-gray-600 bg-gray-800/80'
          }
        `}
      >
        <div className="text-xs font-semibold truncate">
          {player.name}
          {isAllIn && <span className="ml-1 text-red-400 text-[10px]">ALL IN</span>}
        </div>
        <div className="text-sm font-bold text-yellow-400">
          ${player.chips}
        </div>

        {/* Thinking indicator for bots */}
        {isActive && !player.isHuman && (
          <div className="flex justify-center gap-1 mt-0.5">
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                className="w-1 h-1 bg-yellow-400 rounded-full"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Current bet */}
      {player.currentBet > 0 && (
        <motion.div
          className="text-xs bg-black/60 rounded-full px-2 py-0.5 text-yellow-300 font-medium mt-0.5"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
        >
          ${player.currentBet}
        </motion.div>
      )}
    </motion.div>
  );
}
