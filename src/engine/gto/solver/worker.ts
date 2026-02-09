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

let wasmReady = false;
let manager: any = null;

// Dynamically loaded module bindings
let GameManagerClass: any = null;
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
        GameManagerClass = mod.GameManager;
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
    GameManagerClass = mod.GameManager;
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
    manager = GameManagerClass.new();

    // Bet sizing varies by number of remaining streets to keep tree size manageable:
    //   Flop (3 streets): 1 bet size per street, minimal raise
    //   Turn (2 streets): 2 bet sizes on river, 1 on turn
    //   River (1 street): 2 bet sizes
    const streetsLeft = 6 - board.length; // 3=flop, 2=turn, 1=river
    let oopFlopBet: string, ipFlopBet: string, oopFlopRaise: string, ipFlopRaise: string;
    let oopTurnBet: string, ipTurnBet: string, oopTurnRaise: string, ipTurnRaise: string;
    let oopRiverBet: string, ipRiverBet: string, oopRiverRaise: string, ipRiverRaise: string;

    if (streetsLeft >= 3) {
      // Flop: very simple tree — 1 size per street
      oopFlopBet = '33%';   ipFlopBet = '33%';
      oopFlopRaise = '2x';  ipFlopRaise = '2x';
      oopTurnBet = '66%';   ipTurnBet = '66%';
      oopTurnRaise = '2x';  ipTurnRaise = '2x';
      oopRiverBet = '75%';  ipRiverBet = '75%';
      oopRiverRaise = '2x'; ipRiverRaise = '2x';
    } else if (streetsLeft === 2) {
      // Turn: medium complexity
      oopFlopBet = '33%,75%'; ipFlopBet = '33%,75%';
      oopFlopRaise = '2.5x';  ipFlopRaise = '2.5x';
      oopTurnBet = '50%,75%'; ipTurnBet = '50%,75%';
      oopTurnRaise = '2.5x';  ipTurnRaise = '2.5x';
      oopRiverBet = '66%,100%'; ipRiverBet = '66%,100%';
      oopRiverRaise = '2.5x';   ipRiverRaise = '2.5x';
    } else {
      // River: full complexity
      oopFlopBet = '33%,75%'; ipFlopBet = '33%,75%';
      oopFlopRaise = '2.5x';  ipFlopRaise = '2.5x';
      oopTurnBet = '50%,75%'; ipTurnBet = '50%,75%';
      oopTurnRaise = '2.5x';  ipTurnRaise = '2.5x';
      oopRiverBet = '66%,100%'; ipRiverBet = '66%,100%';
      oopRiverRaise = '2.5x';   ipRiverRaise = '2.5x';
    }
    const oopTurnDonk = '';
    const oopRiverDonk = '';

    const initStart = performance.now();
    const error = manager.init(
      oopRange,
      ipRange,
      board,
      startingPot,
      effectiveStack,
      0,          // rake_rate
      0,          // rake_cap
      false,      // donk_option
      oopFlopBet,
      oopFlopRaise,
      oopTurnBet,
      oopTurnRaise,
      oopTurnDonk,
      oopRiverBet,
      oopRiverRaise,
      oopRiverDonk,
      ipFlopBet,
      ipFlopRaise,
      ipTurnBet,
      ipTurnRaise,
      ipRiverBet,
      ipRiverRaise,
      0.80,       // addAllInThreshold (was 0.67)
      0.15,       // forceAllInThreshold
      0.4,        // mergingThreshold (was 0.2, higher = more merging = smaller tree)
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
      manager.allocate_memory(false);
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
   * Run CFR iterations until convergence or max iterations.
   */
  solve(
    maxIterations: number,
    targetExploitability: number,
  ): { iterations: number; exploitability: number } {
    if (!manager) return { iterations: 0, exploitability: Infinity };

    const solveStart = performance.now();
    let exploitability = Infinity;
    let i = 0;
    for (; i < maxIterations; i++) {
      manager.solve_step(i);
      if ((i + 1) % 10 === 0 || i === maxIterations - 1) {
        exploitability = manager.exploitability();
        if (exploitability <= targetExploitability) {
          break;
        }
      }
    }

    manager.finalize();
    const solveMs = performance.now() - solveStart;
    console.log('[Worker] solve:', (i + 1), 'iterations in', solveMs.toFixed(0) + 'ms, exploitability:', exploitability.toFixed(2));
    return { iterations: i + 1, exploitability };
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
