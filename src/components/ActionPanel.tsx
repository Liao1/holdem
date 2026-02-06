import { useState, useEffect } from 'react';
import type { LegalAction } from '../engine/types';
import { ActionType } from '../engine/types';

interface ActionPanelProps {
  legalActions: LegalAction[];
  currentPot: number;
  onAction: (type: ActionType, amount: number) => void;
  enabled: boolean;
}

export default function ActionPanel({ legalActions, currentPot, onAction, enabled }: ActionPanelProps) {
  const canFold = legalActions.some(a => a.type === ActionType.FOLD);
  const canCheck = legalActions.some(a => a.type === ActionType.CHECK);
  const callAction = legalActions.find(a => a.type === ActionType.CALL);
  const betAction = legalActions.find(a => a.type === ActionType.BET);
  const raiseAction = legalActions.find(a => a.type === ActionType.RAISE);
  const allInAction = legalActions.find(a => a.type === ActionType.ALL_IN);

  const sizeAction = raiseAction || betAction;
  const minAmount = sizeAction?.minAmount || 0;
  const maxAmount = sizeAction?.maxAmount || 0;

  const [raiseAmount, setRaiseAmount] = useState(minAmount);

  useEffect(() => {
    setRaiseAmount(minAmount);
  }, [minAmount]);

  if (!enabled || legalActions.length === 0) {
    return (
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-gray-900/80 backdrop-blur border-t border-gray-700/50 flex items-center justify-center">
        <span className="text-gray-500 text-sm">Waiting for other players...</span>
      </div>
    );
  }

  const presets = sizeAction ? [
    { label: '1/3', amount: Math.max(Math.floor(currentPot / 3), minAmount) },
    { label: '1/2', amount: Math.max(Math.floor(currentPot / 2), minAmount) },
    { label: '3/4', amount: Math.max(Math.floor(currentPot * 3 / 4), minAmount) },
    { label: 'Pot', amount: Math.max(currentPot, minAmount) },
  ].filter(p => p.amount <= maxAmount && p.amount >= minAmount) : [];

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-gray-900/90 backdrop-blur border-t border-gray-700/50 px-4 py-3 z-20">
      <div className="max-w-4xl mx-auto flex items-center gap-3 justify-center flex-wrap">
        {/* Fold */}
        {canFold && (
          <button
            onClick={() => onAction(ActionType.FOLD, 0)}
            className="px-5 py-2.5 bg-red-800 hover:bg-red-700 rounded-lg font-semibold text-sm transition-colors"
          >
            Fold
          </button>
        )}

        {/* Check */}
        {canCheck && (
          <button
            onClick={() => onAction(ActionType.CHECK, 0)}
            className="px-5 py-2.5 bg-green-800 hover:bg-green-700 rounded-lg font-semibold text-sm transition-colors"
          >
            Check
          </button>
        )}

        {/* Call */}
        {callAction && (
          <button
            onClick={() => onAction(ActionType.CALL, callAction.callAmount || 0)}
            className="px-5 py-2.5 bg-green-700 hover:bg-green-600 rounded-lg font-semibold text-sm transition-colors"
          >
            Call ${callAction.callAmount}
          </button>
        )}

        {/* Raise/Bet slider area */}
        {sizeAction && (
          <div className="flex items-center gap-2">
            {/* Presets */}
            <div className="flex gap-1">
              {presets.map(p => (
                <button
                  key={p.label}
                  onClick={() => setRaiseAmount(Math.min(p.amount, maxAmount))}
                  className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Slider */}
            <input
              type="range"
              min={minAmount}
              max={maxAmount}
              value={raiseAmount}
              onChange={(e) => setRaiseAmount(Number(e.target.value))}
              className="w-32 accent-yellow-500"
            />

            {/* Amount input */}
            <input
              type="number"
              min={minAmount}
              max={maxAmount}
              value={raiseAmount}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= minAmount && v <= maxAmount) setRaiseAmount(v);
              }}
              className="w-16 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-center"
            />

            {/* Raise/Bet button */}
            <button
              onClick={() => onAction(sizeAction.type, raiseAmount)}
              className="px-5 py-2.5 bg-yellow-600 hover:bg-yellow-500 text-black rounded-lg font-semibold text-sm transition-colors"
            >
              {sizeAction.type === ActionType.BET ? 'Bet' : 'Raise'} ${raiseAmount}
            </button>
          </div>
        )}

        {/* All-in (when can't raise normally) */}
        {allInAction && !sizeAction && (
          <button
            onClick={() => onAction(ActionType.ALL_IN, allInAction.maxAmount || 0)}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-500 rounded-lg font-bold text-sm transition-colors"
          >
            All In ${allInAction.maxAmount}
          </button>
        )}

        {/* All-in shortcut when raise is available */}
        {sizeAction && (
          <button
            onClick={() => onAction(sizeAction.type, maxAmount)}
            className="px-3 py-2.5 bg-red-700 hover:bg-red-600 rounded-lg font-bold text-xs transition-colors"
          >
            All In
          </button>
        )}
      </div>
    </div>
  );
}
