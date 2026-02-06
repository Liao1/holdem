import { useState } from 'react';
import { STARTING_CHIPS, BIG_BLIND, SMALL_BLIND, BOT_NAMES } from '../engine/constants';

interface GameSetupProps {
  onStart: (numOpponents: number) => void;
}

export default function GameSetup({ onStart }: GameSetupProps) {
  const [numOpponents, setNumOpponents] = useState(5);

  return (
    <div className="h-full w-full flex items-center justify-center bg-gradient-to-b from-gray-900 to-gray-950">
      <div className="bg-gray-800/80 border border-gray-700 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <h1 className="text-3xl font-bold text-center mb-2 text-white">
          Texas Hold'em
        </h1>
        <p className="text-gray-400 text-center text-sm mb-6">
          No-Limit Poker
        </p>

        <div className="space-y-4 mb-6">
          <div className="flex justify-between text-sm text-gray-300">
            <span>Blinds</span>
            <span className="text-yellow-400 font-medium">${SMALL_BLIND} / ${BIG_BLIND}</span>
          </div>
          <div className="flex justify-between text-sm text-gray-300">
            <span>Buy-in</span>
            <span className="text-yellow-400 font-medium">${STARTING_CHIPS}</span>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm text-gray-300 mb-3">
            Opponents: <span className="text-yellow-400 font-bold text-lg">{numOpponents}</span>
          </label>
          <input
            type="range"
            min={1}
            max={8}
            value={numOpponents}
            onChange={(e) => setNumOpponents(Number(e.target.value))}
            className="w-full accent-yellow-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1 (Heads-up)</span>
            <span>8 (Full table)</span>
          </div>
        </div>

        {/* Player list preview */}
        <div className="mb-6 bg-gray-900/50 rounded-lg p-3">
          <div className="text-xs text-gray-500 mb-2">Players:</div>
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs bg-blue-800/50 border border-blue-600/50 rounded-full px-2.5 py-0.5 text-blue-200">
              You
            </span>
            {BOT_NAMES.slice(0, numOpponents).map(name => (
              <span
                key={name}
                className="text-xs bg-gray-700/50 border border-gray-600/50 rounded-full px-2.5 py-0.5 text-gray-300"
              >
                {name}
              </span>
            ))}
          </div>
        </div>

        <button
          onClick={() => onStart(numOpponents)}
          className="w-full py-3 bg-yellow-600 hover:bg-yellow-500 text-black font-bold text-lg rounded-xl transition-colors active:scale-[0.98]"
        >
          Start Game
        </button>
      </div>
    </div>
  );
}
