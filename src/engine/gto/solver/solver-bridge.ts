import * as Comlink from 'comlink';
import type { SolverAPI } from './worker';

export interface SolverAction {
  type: 'Fold' | 'Check' | 'Call' | 'Bet' | 'Raise' | 'Allin';
  amount: number;
}

export interface HistoryResolutionStep {
  requested: SolverAction;
  resolved: SolverAction;
  actionIndex: number;
  amountDelta: number;
}

export interface SolveOptions {
  /** Current-street action sequence in game terms to be resolved into solver indices. */
  historyActions?: SolverAction[];
  /** Target exploitability as a percentage of current total pot (default: 0.5). */
  targetExploitabilityPctOfCurrentPot?: number;
  /** Current total pot at decision point; used for exploitability target normalization. */
  currentTotalPot?: number;
  /** Time budget in ms (defaults by street: flop 15s / turn 6s / river 2s). */
  timeBudgetMs?: number;
  /** Max CFR iterations (defaults by street). */
  maxIterations?: number;
  /** Exploitability check interval in iterations. */
  checkInterval?: number;
}

export interface SolverResult {
  actions: SolverAction[];
  /** strategy[actionIndex * numHands + handIndex] = probability */
  strategy: number[];
  numHands: number;
  currentPlayer: 'oop' | 'ip';
  /** Private card combos as packed Uint16Array */
  privateCards: Uint16Array;
  history: number[];
  historyMapping: HistoryResolutionStep[];
  iterations: number;
  exploitability: number;
  targetExploitability: number;
  exploitabilityPctOfCurrentPot: number;
  elapsedMs: number;
  stoppedBy: 'target' | 'time_budget' | 'max_iterations';
}

/**
 * Parse the solver's action string "Fold:0/Check:0/Bet:12/Raise:36/Allin:400"
 * into structured SolverAction[].
 */
function parseActions(actionsStr: string): SolverAction[] {
  if (!actionsStr || actionsStr === 'terminal' || actionsStr === 'chance') {
    return [];
  }

  return actionsStr.split('/').map(part => {
    const [type, amountStr] = part.split(':');
    const amount = Number.parseInt(amountStr ?? '0', 10);
    return {
      type: type as SolverAction['type'],
      amount: Number.isFinite(amount) ? amount : 0,
    };
  });
}

function defaultTimeBudgetMs(boardLen: number): number {
  if (boardLen === 3) return 30_000;
  if (boardLen === 4) return 10_000;
  return 10_000;
}

function defaultMaxIterations(boardLen: number): number {
  if (boardLen === 3) return 60_000;
  if (boardLen === 4) return 24_000;
  return 24_000;
}

function defaultCheckInterval(boardLen: number): number {
  // Keep budget enforcement tight to avoid large budget overshoot.
  if (boardLen === 3) return 1;
  if (boardLen === 4) return 1;
  return 2;
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
 * @param options   Solver target/budget/history options
 * @returns SolverResult or null on failure
 */
export async function solve(
  oopRange: Float32Array,
  ipRange: Float32Array,
  board: Uint8Array,
  startingPot: number,
  effectiveStack: number,
  options: SolveOptions = {},
): Promise<SolverResult | null> {
  const ready = await ensureReady();
  if (!ready || !proxy) return null;

  try {
    const historyActions = options.historyActions ?? [];
    const currentTotalPot = Math.max(options.currentTotalPot ?? startingPot, 1);
    const targetPct = options.targetExploitabilityPctOfCurrentPot ?? 0.5;
    const targetExploitability = currentTotalPot * (targetPct / 100);
    const timeBudgetMs = options.timeBudgetMs ?? defaultTimeBudgetMs(board.length);
    const maxIterations = options.maxIterations ?? defaultMaxIterations(board.length);
    const checkInterval = options.checkInterval ?? defaultCheckInterval(board.length);

    // Log inputs
    const oopNonZero = oopRange.reduce((n, w) => n + (w > 0 ? 1 : 0), 0);
    const ipNonZero = ipRange.reduce((n, w) => n + (w > 0 ? 1 : 0), 0);
    console.log('[SolverBridge] === WASM Input ===');
    console.log('[SolverBridge] board:', Array.from(board));
    console.log('[SolverBridge] startingPot:', startingPot, 'effectiveStack:', effectiveStack);
    console.log('[SolverBridge] currentTotalPot:', currentTotalPot, 'targetPct:', targetPct);
    console.log('[SolverBridge] oopRange non-zero combos:', oopNonZero, '/ 1326');
    console.log('[SolverBridge] ipRange non-zero combos:', ipNonZero, '/ 1326');
    console.log('[SolverBridge] history actions:', historyActions.map(a => `${a.type}:${a.amount}`).join(' / '));

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

    const historyResolution = await proxy.resolveHistory(historyActions);
    if (historyResolution.error) {
      console.warn('[SolverBridge] Failed to resolve history:', historyResolution.error);
      return null;
    }

    console.log('[SolverBridge] resolved history:', historyResolution.history);
    if (historyResolution.mappedSteps.length > 0) {
      console.log('[SolverBridge] mapped steps:', historyResolution.mappedSteps.map(step =>
        `${step.requested.type}:${step.requested.amount} -> ${step.resolved.type}:${step.resolved.amount} [idx=${step.actionIndex}]`,
      ).join(' | '));
    }

    console.log(
      '[SolverBridge] solving: maxIter=%d, targetExpl=%.2f, budgetMs=%d, checkEvery=%d',
      maxIterations,
      targetExploitability,
      timeBudgetMs,
      checkInterval,
    );
    const solveResult = await proxy.solve(maxIterations, targetExploitability, timeBudgetMs, checkInterval);
    console.log('[SolverBridge] === WASM Solve Result ===');
    console.log(
      '[SolverBridge] iterations:',
      solveResult.iterations,
      'exploitability:',
      solveResult.exploitability,
      'time:',
      solveResult.elapsedMs.toFixed(0) + 'ms',
      'stoppedBy:',
      solveResult.stoppedBy,
    );

    // Get strategy at the given history position
    const strategyResult = await proxy.getStrategy(historyResolution.history);
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
      history: historyResolution.history,
      historyMapping: historyResolution.mappedSteps,
      iterations: solveResult.iterations,
      exploitability: solveResult.exploitability,
      targetExploitability,
      exploitabilityPctOfCurrentPot: (solveResult.exploitability * 100) / currentTotalPot,
      elapsedMs: solveResult.elapsedMs,
      stoppedBy: solveResult.stoppedBy,
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
