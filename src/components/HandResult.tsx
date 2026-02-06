import { motion, AnimatePresence } from 'motion/react';
import type { WinnerInfo } from '../engine/types';

interface HandResultProps {
  winners: WinnerInfo[] | null;
  onDismiss?: () => void;
}

export default function HandResult({ winners }: HandResultProps) {
  if (!winners || winners.length === 0) return null;

  // Group by pot
  const grouped = new Map<number, WinnerInfo[]>();
  for (const w of winners) {
    const list = grouped.get(w.potIndex) || [];
    list.push(w);
    grouped.set(w.potIndex, list);
  }

  return (
    <AnimatePresence>
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
      >
        <div className="bg-gray-900/95 border border-yellow-500/50 rounded-xl p-4 min-w-[280px] shadow-2xl">
          <h3 className="text-center text-yellow-400 font-bold text-lg mb-3">
            Hand Result
          </h3>
          {Array.from(grouped.entries()).map(([potIdx, potWinners]) => (
            <div key={potIdx} className="mb-2">
              {grouped.size > 1 && (
                <div className="text-xs text-gray-400 mb-1">
                  {potIdx === 0 ? 'Main Pot' : `Side Pot ${potIdx}`}
                </div>
              )}
              {potWinners.map((w, i) => (
                <div key={i} className="flex items-center justify-between gap-4 py-1">
                  <div>
                    <span className="font-semibold text-white">{w.playerName}</span>
                    {w.hand && (
                      <span className="text-xs text-gray-400 ml-2">
                        — {w.hand.description}
                      </span>
                    )}
                  </div>
                  <span className="text-yellow-400 font-bold">+${w.amount}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
