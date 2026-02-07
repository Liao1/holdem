import * as Comlink from 'comlink';
import type { SolverAPI } from './worker';

export interface SolverAction {
  type: 'Fold' | 'Check' | 'Call' | 'Bet' | 'Raise' | 'Allin';
  amount: number;
}

export interface SolverResult {
  actions: SolverAction[];
  /** strategy[handIndex * numActions + actionIndex] = probability */
  strategy: number[];
  numHands: number;
  currentPlayer: 'oop' | 'ip';
  /** Private card combos as packed Uint16Array */
  privateCards: Uint16Array;
  iterations: number;
  exploitability: number;
}

/**
 * Parse the solver's action string "Fold:0/Check:0/Bet:12/Raise:36/Allin:400"
 * into structured SolverAction[].
 */
function parseActions(actionsStr: string): SolverAction[] {
  return actionsStr.split('/').map(part => {
    const [type, amountStr] = part.split(':');
    return {
      type: type as SolverAction['type'],
      amount: parseInt(amountStr, 10),
    };
  });
}

let worker: Worker | null = null;
let proxy: Comlink.Remote<SolverAPI> | null = null;
let wasmReady = false;

/**
 * Ensure the solver worker is loaded and WASM is initialized.
 * Returns false if WASM loading fails.
 */
async function ensureReady(): Promise<boolean> {
  if (wasmReady && proxy) return true;

  try {
    if (!worker) {
      worker = new Worker(
        new URL('./worker.ts', import.meta.url),
        { type: 'module' },
      );
      proxy = Comlink.wrap<SolverAPI>(worker);
    }
    await proxy!.loadWasm();
    wasmReady = true;
    return true;
  } catch (e) {
    console.warn('[SolverBridge] WASM load failed:', e);
    wasmReady = false;
    return false;
  }
}

/**
 * Run the CFR solver for a given situation and return the strategy.
 *
 * @param oopRange  1326-element Float32Array (OOP range weights)
 * @param ipRange   1326-element Float32Array (IP range weights)
 * @param board     Solver card IDs for community cards
 * @param startingPot Pot at the start of postflop
 * @param effectiveStack Remaining effective stack
 * @param history   Action indices to navigate the game tree to current node
 * @returns SolverResult or null on failure
 */
export async function solve(
  oopRange: Float32Array,
  ipRange: Float32Array,
  board: Uint8Array,
  startingPot: number,
  effectiveStack: number,
  history: number[] = [],
): Promise<SolverResult | null> {
  const ready = await ensureReady();
  if (!ready || !proxy) return null;

  try {
    // Log inputs
    const oopNonZero = oopRange.reduce((n, w) => n + (w > 0 ? 1 : 0), 0);
    const ipNonZero = ipRange.reduce((n, w) => n + (w > 0 ? 1 : 0), 0);
    console.log('[SolverBridge] === WASM Input ===');
    console.log('[SolverBridge] board:', Array.from(board));
    console.log('[SolverBridge] startingPot:', startingPot, 'effectiveStack:', effectiveStack);
    console.log('[SolverBridge] oopRange non-zero combos:', oopNonZero, '/ 1326');
    console.log('[SolverBridge] ipRange non-zero combos:', ipNonZero, '/ 1326');
    console.log('[SolverBridge] history:', history);

    // Initialize the game tree
    const initError = await proxy.init(
      Comlink.transfer(oopRange, [oopRange.buffer]),
      Comlink.transfer(ipRange, [ipRange.buffer]),
      Comlink.transfer(board, [board.buffer]),
      startingPot,
      effectiveStack,
    );

    if (initError) {
      console.warn('[SolverBridge] Init error:', initError);
      return null;
    }

    // Fewer iterations for larger trees (flop=3 streets vs river=1 street)
    const streetsLeft = 6 - board.length;
    const maxIterations = streetsLeft >= 3 ? 50 : streetsLeft === 2 ? 100 : 200;
    const targetExploitability = startingPot * 0.01;
    console.log('[SolverBridge] solving: maxIter=%d, targetExpl=%.2f, streets=%d', maxIterations, targetExploitability, streetsLeft);
    const solveStart = performance.now();
    const solveResult = await proxy.solve(maxIterations, targetExploitability);
    const solveMs = performance.now() - solveStart;
    console.log('[SolverBridge] === WASM Solve Result ===');
    console.log('[SolverBridge] iterations:', solveResult.iterations, 'exploitability:', solveResult.exploitability, 'time:', solveMs.toFixed(0) + 'ms');

    // Get strategy at the given history position
    const strategyResult = await proxy.getStrategy(history);
    if (!strategyResult) {
      console.warn('[SolverBridge] getStrategy returned null (terminal/chance node)');
      return null;
    }

    console.log('[SolverBridge] === WASM Strategy Result ===');
    console.log('[SolverBridge] currentPlayer:', strategyResult.currentPlayer);
    console.log('[SolverBridge] actions:', strategyResult.actions);
    console.log('[SolverBridge] numHands:', strategyResult.numHands);
    console.log('[SolverBridge] strategy length:', strategyResult.strategy.length);

    const playerIdx = strategyResult.currentPlayer === 'oop' ? 0 : 1;
    const privateCards = await proxy.getPrivateCards(playerIdx);
    console.log('[SolverBridge] privateCards count:', privateCards.length);

    return {
      actions: parseActions(strategyResult.actions),
      strategy: strategyResult.strategy,
      numHands: strategyResult.numHands,
      currentPlayer: strategyResult.currentPlayer as 'oop' | 'ip',
      privateCards,
      iterations: solveResult.iterations,
      exploitability: solveResult.exploitability,
    };
  } catch (e) {
    console.warn('[SolverBridge] Solve error:', e);
    return null;
  }
}

/**
 * Shut down the solver worker and release resources.
 */
export function terminateSolver(): void {
  if (proxy) {
    proxy.terminate().catch(() => {});
  }
  if (worker) {
    worker.terminate();
    worker = null;
    proxy = null;
    wasmReady = false;
  }
}
