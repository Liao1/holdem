import { useRef, useEffect } from 'react';
import type { LogEntry } from '../engine/types';
import { ActionType } from '../engine/types';

interface GameLogProps {
  entries: LogEntry[];
  currentHand: number;
}

function formatAction(entry: LogEntry): string {
  switch (entry.action) {
    case ActionType.POST_SB: return `posts SB $${entry.amount}`;
    case ActionType.POST_BB: return `posts BB $${entry.amount}`;
    case ActionType.FOLD: return 'folds';
    case ActionType.CHECK: return 'checks';
    case ActionType.CALL: return `calls $${entry.amount}`;
    case ActionType.BET: return `bets $${entry.amount}`;
    case ActionType.RAISE: return `raises to $${entry.amount}`;
    case ActionType.ALL_IN: return `goes all-in $${entry.amount}`;
    default: return entry.action;
  }
}

export default function GameLog({ entries, currentHand }: GameLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  // Show only current hand entries
  const handEntries = entries.filter(e => e.handNumber === currentHand);

  return (
    <div className="absolute right-0 top-0 w-52 h-full bg-gray-900/70 backdrop-blur border-l border-gray-700/50 flex flex-col">
      <div className="px-3 py-2 border-b border-gray-700/50">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Hand #{currentHand}
        </h3>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 space-y-0.5"
      >
        {handEntries.map((entry, i) => (
          <div key={i} className="text-xs text-gray-300 py-0.5">
            <span className="font-medium text-white">{entry.playerName}</span>{' '}
            <span className="text-gray-400">{formatAction(entry)}</span>
          </div>
        ))}
        {handEntries.length === 0 && (
          <div className="text-xs text-gray-500 italic">No actions yet</div>
        )}
      </div>
    </div>
  );
}
