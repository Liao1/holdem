import * as Comlink from 'comlink';

/**
 * Solver Worker — runs WASM CFR solver off the main thread.
 *
 * The worker loads the single-threaded wasm-postflop solver and exposes
 * methods for initialisation, solving, and strategy retrieval via Comlink.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let solverModule: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let manager: any = null;

const solverAPI = {
  /**
   * Load the WASM module. Call once before anything else.
   */
  async loadWasm(): Promise<void> {
    if (solverModule) return;
    // @ts-ignore: runtime dynamic import from Vite public directory
    const mod = await import(/* @vite-ignore */ '/pkg/solver-st/solver.js');
    await mod.default({ module_or_path: '/wasm/solver_bg.wasm' });
    solverModule = mod;
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
    // GameManager.new() is a static factory method
    manager = solverModule.GameManager.new();

    // Simplified bet sizing configuration
    const oopFlopBet = '33%,75%';
    const oopFlopRaise = '2.5x';
    const oopTurnBet = '50%,75%';
    const oopTurnRaise = '2.5x';
    const oopTurnDonk = '';
    const oopRiverBet = '66%,100%';
    const oopRiverRaise = '2.5x';
    const oopRiverDonk = '';
    const ipFlopBet = '33%,75%';
    const ipFlopRaise = '2.5x';
    const ipTurnBet = '50%,75%';
    const ipTurnRaise = '2.5x';
    const ipRiverBet = '66%,100%';
    const ipRiverRaise = '2.5x';

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
      0.1,        // mergingThreshold
      '',         // addedLines
      '',         // removedLines
    );

    // init returns string on error, undefined on success
    if (error !== undefined) {
      manager.free();
      manager = null;
      return error;
    }

    // Allocate memory (no compression for speed)
    manager.allocate_memory(false);
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
    solverModule = null;
  },
};

export type SolverAPI = typeof solverAPI;

Comlink.expose(solverAPI);
