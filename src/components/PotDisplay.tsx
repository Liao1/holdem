import { motion } from 'motion/react';
import type { Pot } from '../engine/types';

interface PotDisplayProps {
  pots: Pot[];
  showDetails?: boolean;
}

export default function PotDisplay({ pots, showDetails = false }: PotDisplayProps) {
  const totalPot = pots.reduce((sum, p) => sum + p.amount, 0);

  if (totalPot === 0) return null;

  // Only show side pot breakdown when there are genuinely different eligible sets
  const hasRealSidePots = showDetails && pots.length > 1;

  return (
    <div className="flex flex-col items-center gap-1">
      <motion.div
        className="bg-black/50 rounded-full px-4 py-1.5 border border-yellow-600/30"
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
      >
        <span className="text-yellow-400 font-bold text-lg">
          Pot: ${totalPot}
        </span>
      </motion.div>

      {hasRealSidePots && (
        <div className="flex gap-2">
          {pots.map((pot, i) => (
            <span key={i} className="text-xs text-gray-400 bg-black/40 rounded px-2 py-0.5">
              {i === 0 ? 'Main' : `Side ${i}`}: ${pot.amount}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
