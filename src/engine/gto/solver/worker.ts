import * as Comlink from 'comlink';

/**
 * Solver Worker — runs WASM CFR solver off the main thread.
 *
 * Supports both multi-threaded (solver-mt, via SharedArrayBuffer + Rayon)
 * and single-threaded (solver-st) modes. MT is preferred for performance;
 * ST is used as a fallback when SharedArrayBuffer is unavailable (e.g. Safari/iOS).
 */

function detectMTSupport(): { enabled: boolean; reason: string } {
  if (typeof SharedArrayBuffer === 'undefined') {
    return { enabled: false, reason: 'SharedArrayBuffer unavailable' };
  }
  if (typeof Atomics === 'undefined') {
    return { enabled: false, reason: 'Atomics unavailable' };
  }
  if (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated) {
    return { enabled: false, reason: 'crossOriginIsolated=false' };
  }

  try {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    if (!(memory.buffer instanceof SharedArrayBuffer)) {
      return { enabled: false, reason: 'WASM shared memory buffer is not SharedArrayBuffer' };
    }

    // initThreadPool internally postMessages WebAssembly.Memory to child workers.
    // Probe cloneability upfront to avoid noisy runtime DataCloneError stack traces.
    const channel = new MessageChannel();
    channel.port1.postMessage(memory);
    channel.port1.close();
    channel.port2.close();
  } catch (e) {
    return { enabled: false, reason: `shared memory clone probe failed: ${String(e)}` };
  }

  return { enabled: true, reason: 'ok' };
}

const mtSupport = detectMTSupport();
const canUseMT = mtSupport.enabled;

type SolverActionType = 'Fold' | 'Check' | 'Call' | 'Bet' | 'Raise' | 'Allin';

interface SolverNodeAction {
  type: SolverActionType;
  amount: number;
}

interface HistoryStepInput {
  type: SolverActionType;
  amount: number;
}

interface HistoryResolutionStep {
  requested: HistoryStepInput;
  resolved: SolverNodeAction;
  actionIndex: number;
  amountDelta: number;
}

interface TreeProfile {
  oopFlopBet: string;
  ipFlopBet: string;
  oopFlopRaise: string;
  ipFlopRaise: string;
  oopTurnBet: string;
  ipTurnBet: string;
  oopTurnRaise: string;
  ipTurnRaise: string;
  oopRiverBet: string;
  ipRiverBet: string;
  oopRiverRaise: string;
  ipRiverRaise: string;
  addAllInThreshold: number;
  forceAllInThreshold: number;
  mergingThreshold: number;
}

interface WasmGameManager {
  free(): void;
  init(
    oopRange: Float32Array,
    ipRange: Float32Array,
    board: Uint8Array,
    startingPot: number,
    effectiveStack: number,
    rakeRate: number,
    rakeCap: number,
    donkOption: boolean,
    oopFlopBet: string,
    oopFlopRaise: string,
    oopTurnBet: string,
    oopTurnRaise: string,
    oopTurnDonk: string,
    oopRiverBet: string,
    oopRiverRaise: string,
    oopRiverDonk: string,
    ipFlopBet: string,
    ipFlopRaise: string,
    ipTurnBet: string,
    ipTurnRaise: string,
    ipRiverBet: string,
    ipRiverRaise: string,
    addAllInThreshold: number,
    forceAllInThreshold: number,
    mergingThreshold: number,
    addedLines: string,
    removedLines: string,
  ): string | undefined;
  allocate_memory(enableCompression: boolean): void;
  solve_step(currentIteration: number): void;
  exploitability(): number;
  finalize(): void;
  apply_history(history: Uint32Array): void;
  current_player(): string;
  actions_after(append: Uint32Array): string;
  get_results(): Float64Array;
  private_cards(player: number): Uint16Array;
  num_actions(): number;
}

interface WasmGameManagerFactory {
  new: () => WasmGameManager;
}

function normalizeActionType(type: string): SolverActionType | null {
  if (type === 'AllIn') return 'Allin';
  if (type === 'Fold' || type === 'Check' || type === 'Call' || type === 'Bet' || type === 'Raise' || type === 'Allin') {
    return type;
  }
  return null;
}

function parseActionString(actionsStr: string): SolverNodeAction[] {
  if (!actionsStr || actionsStr === 'terminal' || actionsStr === 'chance') {
    return [];
  }

  const actions: SolverNodeAction[] = [];
  for (const part of actionsStr.split('/')) {
    const [rawType, amountStr] = part.split(':');
    const type = normalizeActionType(rawType);
    if (!type) continue;
    const amount = Number.parseInt(amountStr ?? '0', 10);
    actions.push({
      type,
      amount: Number.isFinite(amount) ? amount : 0,
    });
  }
  return actions;
}

function selectActionIndex(
  requested: HistoryStepInput,
  available: SolverNodeAction[],
): { index: number; amountDelta: number } | null {
  const requestedType = normalizeActionType(requested.type);
  if (!requestedType) return null;

  const candidates = available
    .map((action, index) => ({ action, index }))
    .filter(x => x.action.type === requestedType);

  if (candidates.length === 0) {
    return null;
  }

  if (requestedType === 'Fold' || requestedType === 'Check' || requestedType === 'Call') {
    return { index: candidates[0].index, amountDelta: 0 };
  }

  let best = candidates[0];
  let bestDelta = Math.abs(best.action.amount - requested.amount);
  for (let i = 1; i < candidates.length; i++) {
    const delta = Math.abs(candidates[i].action.amount - requested.amount);
    if (delta < bestDelta) {
      best = candidates[i];
      bestDelta = delta;
    }
  }

  return { index: best.index, amountDelta: bestDelta };
}

function getTreeProfile(streetsLeft: number): TreeProfile {
  // Profile tuned for stronger strategy quality under medium/long per-street budgets.
  if (streetsLeft >= 3) {
    return {
      oopFlopBet: '33%,66%',
      ipFlopBet: '33%,66%',
      oopFlopRaise: '2.5x',
      ipFlopRaise: '2.5x',
      oopTurnBet: '66%',
      ipTurnBet: '66%',
      oopTurnRaise: '2.5x',
      ipTurnRaise: '2.5x',
      oopRiverBet: '75%,125%',
      ipRiverBet: '75%,125%',
      oopRiverRaise: '2.5x',
      ipRiverRaise: '2.5x',
      addAllInThreshold: 0.88,
      forceAllInThreshold: 0.2,
      mergingThreshold: 0.45,
    };
  }

  if (streetsLeft === 2) {
    return {
      oopFlopBet: '33%,75%',
      ipFlopBet: '33%,75%',
      oopFlopRaise: '2.5x',
      ipFlopRaise: '2.5x',
      oopTurnBet: '50%,100%',
      ipTurnBet: '50%,100%',
      oopTurnRaise: '2.5x',
      ipTurnRaise: '2.5x',
      oopRiverBet: '66%,125%',
      ipRiverBet: '66%,125%',
      oopRiverRaise: '2.5x',
      ipRiverRaise: '2.5x',
      addAllInThreshold: 0.85,
      forceAllInThreshold: 0.2,
      mergingThreshold: 0.32,
    };
  }

  return {
    oopFlopBet: '33%,75%',
    ipFlopBet: '33%,75%',
    oopFlopRaise: '2.5x',
    ipFlopRaise: '2.5x',
    oopTurnBet: '50%,100%',
    ipTurnBet: '50%,100%',
    oopTurnRaise: '2.5x',
    ipTurnRaise: '2.5x',
    oopRiverBet: '66%,125%',
    ipRiverBet: '66%,125%',
    oopRiverRaise: '2.5x',
    ipRiverRaise: '2.5x',
    addAllInThreshold: 0.82,
    forceAllInThreshold: 0.15,
    mergingThreshold: 0.3,
  };
}

let wasmReady = false;
let manager: WasmGameManager | null = null;

// Dynamically loaded module bindings
let GameManagerClass: WasmGameManagerFactory | null = null;
let initThreadPoolFn: ((n: number) => Promise<void>) | null = null;
let exitThreadPoolFn: (() => Promise<void>) | null = null;

const solverAPI = {
  /**
   * Load the WASM module. Call once before anything else.
   */
  async loadWasm(): Promise<void> {
    if (wasmReady) return;

    if (!canUseMT) {
      console.log('[Worker] solver-mt disabled:', mtSupport.reason);
    }

    if (canUseMT) {
      try {
        const mod = await import('../../../../pkg/solver-mt/solver.js');
        await mod.default();
        GameManagerClass = mod.GameManager as unknown as WasmGameManagerFactory;
        initThreadPoolFn = mod.initThreadPool;
        exitThreadPoolFn = mod.exitThreadPool;
        const numThreads = Math.min(navigator.hardwareConcurrency || 4, 8);
        await initThreadPoolFn!(numThreads);
        console.log('[Worker] solver-mt loaded, threads:', numThreads);
        wasmReady = true;
        return;
      } catch (e) {
        console.warn('[Worker] solver-mt load failed, falling back to solver-st:', e);
      }
    }

    const mod = await import('../../../../pkg/solver-st/solver.js');
    await mod.default();
    GameManagerClass = mod.GameManager as unknown as WasmGameManagerFactory;
    initThreadPoolFn = null;
    exitThreadPoolFn = null;
    console.log('[Worker] solver-st loaded (fallback)');
    wasmReady = true;
  },

  /**
   * Initialise a new game tree for solving.
   * Returns an error string or null on success.
   */
  init(
    oopRange: Float32Array,
    ipRange: Float32Array,
    board: Uint8Array,
    startingPot: number,
    effectiveStack: number,
  ): string | null {
    // Validate inputs
    if (board.length < 3 || board.length > 5) {
      return `Invalid board length: ${board.length}`;
    }
    if (startingPot <= 0 || effectiveStack <= 0) {
      return `Invalid pot/stack: pot=${startingPot}, stack=${effectiveStack}`;
    }

    const oopHasWeight = oopRange.some(w => w > 0);
    const ipHasWeight = ipRange.some(w => w > 0);
    if (!oopHasWeight || !ipHasWeight) {
      return 'Empty range detected';
    }

    // Free previous manager before creating a new one
    if (manager) {
      try { manager.free(); } catch { /* ignore */ }
      manager = null;
    }

    // GameManager.new() is a static factory method
    if (!GameManagerClass) {
      return 'GameManager class is not loaded';
    }
    const gm = GameManagerClass.new();
    manager = gm;

    // Bet sizing varies by number of remaining streets to keep tree size manageable:
    //   Flop: quality-priority profile
    //   Turn: balanced profile
    //   River: speed-priority profile
    const streetsLeft = 6 - board.length; // 3=flop, 2=turn, 1=river
    const profile = getTreeProfile(streetsLeft);
    const oopTurnDonk = '';
    const oopRiverDonk = '';

    const initStart = performance.now();
    const error = gm.init(
      oopRange,
      ipRange,
      board,
      startingPot,
      effectiveStack,
      0,          // rake_rate
      0,          // rake_cap
      false,      // donk_option
      profile.oopFlopBet,
      profile.oopFlopRaise,
      profile.oopTurnBet,
      profile.oopTurnRaise,
      oopTurnDonk,
      profile.oopRiverBet,
      profile.oopRiverRaise,
      oopRiverDonk,
      profile.ipFlopBet,
      profile.ipFlopRaise,
      profile.ipTurnBet,
      profile.ipTurnRaise,
      profile.ipRiverBet,
      profile.ipRiverRaise,
      profile.addAllInThreshold,
      profile.forceAllInThreshold,
      profile.mergingThreshold,
      '',         // addedLines
      '',         // removedLines
    );
    const initMs = performance.now() - initStart;

    // init returns string on error, undefined on success
    if (error !== undefined) {
      console.log('[Worker] init failed after', initMs.toFixed(0) + 'ms:', error);
      // Don't call free() here — partially initialized GameManager
      // may trigger Rust ownership errors on free
      manager = null;
      return error;
    }

    // Allocate memory
    const allocStart = performance.now();
    try {
      gm.allocate_memory(false);
    } catch (e) {
      // Same: don't free a failed-allocation manager
      manager = null;
      return `Memory allocation failed: ${e}`;
    }
    const allocMs = performance.now() - allocStart;

    console.log('[Worker] init:', initMs.toFixed(0) + 'ms, allocate:', allocMs.toFixed(0) + 'ms');
    return null;
  },

  /**
   * Resolve game action history into solver action indices.
   * Mapping is done step-by-step against currently available solver actions.
   */
  resolveHistory(steps: HistoryStepInput[]): {
    history: number[];
    mappedSteps: HistoryResolutionStep[];
    currentPlayer: string;
    error: string | null;
  } {
    if (!manager) {
      return {
        history: [],
        mappedSteps: [],
        currentPlayer: 'terminal',
        error: 'Solver manager is not initialized',
      };
    }

    const history: number[] = [];
    const mappedSteps: HistoryResolutionStep[] = [];

    for (const step of steps) {
      manager.apply_history(new Uint32Array(history));
      const currentPlayer = manager.current_player();
      if (currentPlayer === 'terminal' || currentPlayer === 'chance') {
        manager.apply_history(new Uint32Array([]));
        return {
          history,
          mappedSteps,
          currentPlayer,
          error: `Reached ${currentPlayer} while resolving history`,
        };
      }

      const available = parseActionString(manager.actions_after(new Uint32Array([])));
      const selected = selectActionIndex(step, available);
      if (!selected) {
        manager.apply_history(new Uint32Array([]));
        return {
          history,
          mappedSteps,
          currentPlayer,
          error: `No matching action for ${step.type}:${step.amount}`,
        };
      }

      history.push(selected.index);
      mappedSteps.push({
        requested: step,
        resolved: available[selected.index],
        actionIndex: selected.index,
        amountDelta: selected.amountDelta,
      });
    }

    manager.apply_history(new Uint32Array(history));
    const currentPlayer = manager.current_player();
    manager.apply_history(new Uint32Array([]));

    return {
      history,
      mappedSteps,
      currentPlayer,
      error: null,
    };
  },

  /**
   * Run CFR iterations until convergence or max iterations.
   */
  solve(
    maxIterations: number,
    targetExploitability: number,
    timeBudgetMs: number,
    checkInterval: number,
  ): { iterations: number; exploitability: number; elapsedMs: number; stoppedBy: 'target' | 'time_budget' | 'max_iterations' } {
    if (!manager) {
      return {
        iterations: 0,
        exploitability: Infinity,
        elapsedMs: 0,
        stoppedBy: 'max_iterations',
      };
    }

    const solveStart = performance.now();
    let exploitability = Infinity;
    let i = 0;
    let stoppedBy: 'target' | 'time_budget' | 'max_iterations' = 'max_iterations';
    const checkpoint = Math.max(1, Math.floor(checkInterval));
    const hasTimeBudget = Number.isFinite(timeBudgetMs) && timeBudgetMs > 0;

    for (; i < maxIterations; i++) {
      manager.solve_step(i);
      if ((i + 1) % checkpoint === 0 || i === maxIterations - 1) {
        exploitability = manager.exploitability();
        if (exploitability <= targetExploitability) {
          stoppedBy = 'target';
          break;
        }
        if (hasTimeBudget && performance.now() - solveStart >= timeBudgetMs) {
          stoppedBy = 'time_budget';
          break;
        }
      }
    }

    manager.finalize();
    const solveMs = performance.now() - solveStart;
    if (!Number.isFinite(exploitability)) {
      exploitability = manager.exploitability();
    }
    console.log(
      '[Worker] solve:',
      (i + 1),
      'iterations in',
      solveMs.toFixed(0) + 'ms, exploitability:',
      exploitability.toFixed(2),
      'stoppedBy:',
      stoppedBy,
    );
    return {
      iterations: i + 1,
      exploitability,
      elapsedMs: solveMs,
      stoppedBy,
    };
  },

  /**
   * Get the strategy at the current node (or after applying a history).
   *
   * history: array of action indices to apply from root before reading strategy.
   *
   * Returns the actions string, strategy array, hand count, and current player.
   */
  getStrategy(history: number[]): {
    actions: string;
    strategy: number[];
    numHands: number;
    currentPlayer: string;
  } | null {
    if (!manager) return null;

    manager.apply_history(new Uint32Array(history));

    const currentPlayer: string = manager.current_player();
    if (currentPlayer === 'terminal' || currentPlayer === 'chance') {
      manager.apply_history(new Uint32Array([]));
      return null;
    }

    const actions: string = manager.actions_after(new Uint32Array([]));
    const results: Float64Array = manager.get_results();

    const playerIdx = currentPlayer === 'oop' ? 0 : 1;
    const numHands = manager.private_cards(playerIdx).length;
    const numActions = manager.num_actions();
    const numHands0 = manager.private_cards(0).length;
    const numHands1 = manager.private_cards(1).length;

    // Layout of get_results (from Rust source):
    // [0] = pot + totalBet[0]  (pot for oop)
    // [1] = pot + totalBet[1]  (pot for ip)
    // [2] = isEmpty flag (0 = both non-empty)
    //
    // When isEmpty == 0:
    //   weights[0]:       numHands0 floats
    //   weights[1]:       numHands1 floats
    //   normWeights[0]:   numHands0 floats
    //   normWeights[1]:   numHands1 floats
    //   equity[0]:        numHands0 floats
    //   equity[1]:        numHands1 floats
    //   ev[0]:            numHands0 floats
    //   ev[1]:            numHands1 floats
    //   eqr[0]:           numHands0 floats
    //   eqr[1]:           numHands1 floats
    //   strategy:         numActions * numHands floats
    //   ev_detail:        numHands floats
    const strategyOffset = 3 + numHands0 * 5 + numHands1 * 5;
    const strategyLen = numActions * numHands;
    const strategy = Array.from(results.slice(strategyOffset, strategyOffset + strategyLen));

    // Reset to root
    manager.apply_history(new Uint32Array([]));

    return {
      actions,
      strategy,
      numHands,
      currentPlayer,
    };
  },

  /**
   * Get private cards (hole card combos) for a player.
   * Returns packed Uint16Array: low byte = card1, high byte = card2.
   */
  getPrivateCards(player: number): Uint16Array {
    if (!manager) return new Uint16Array(0);
    return manager.private_cards(player);
  },

  /**
   * Release solver resources.
   */
  async terminate(): Promise<void> {
    if (manager) {
      manager.free();
      manager = null;
    }
    if (exitThreadPoolFn) {
      try { await exitThreadPoolFn(); } catch { /* ignore */ }
    }
    wasmReady = false;
  },
};

export type SolverAPI = typeof solverAPI;

Comlink.expose(solverAPI);
