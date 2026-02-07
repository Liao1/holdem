import * as Comlink from 'comlink';
import init, { GameManager } from '../../../../pkg/solver-st/solver.js';

/**
 * Solver Worker — runs WASM CFR solver off the main thread.
 *
 * The worker loads the single-threaded wasm-postflop solver and exposes
 * methods for initialisation, solving, and strategy retrieval via Comlink.
 */

let wasmReady = false;
let manager: GameManager | null = null;

const solverAPI = {
  /**
   * Load the WASM module. Call once before anything else.
   */
  async loadWasm(): Promise<void> {
    if (wasmReady) return;
    await init();
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
    manager = GameManager.new();

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
      0.67,       // addAllInThreshold
      0.15,       // forceAllInThreshold
      0.2,        // mergingThreshold (higher = more merging = smaller tree)
      '',         // addedLines
      '',         // removedLines
    );

    // init returns string on error, undefined on success
    if (error !== undefined) {
      // Don't call free() here — partially initialized GameManager
      // may trigger Rust ownership errors on free
      manager = null;
      return error;
    }

    // Allocate memory
    try {
      manager.allocate_memory(false);
    } catch (e) {
      // Same: don't free a failed-allocation manager
      manager = null;
      return `Memory allocation failed: ${e}`;
    }
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
  terminate(): void {
    if (manager) {
      manager.free();
      manager = null;
    }
    wasmReady = false;
  },
};

export type SolverAPI = typeof solverAPI;

Comlink.expose(solverAPI);
