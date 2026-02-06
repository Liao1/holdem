/* tslint:disable */
/* eslint-disable */

export class GameManager {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    actions_after(append: Uint32Array): string;
    allocate_memory(enable_compression: boolean): void;
    apply_history(history: Uint32Array): void;
    current_player(): string;
    exploitability(): number;
    finalize(): void;
    get_chance_reports(append: Uint32Array, num_actions: number): Float64Array;
    get_results(): Float64Array;
    init(oop_range: Float32Array, ip_range: Float32Array, board: Uint8Array, starting_pot: number, effective_stack: number, rake_rate: number, rake_cap: number, donk_option: boolean, oop_flop_bet: string, oop_flop_raise: string, oop_turn_bet: string, oop_turn_raise: string, oop_turn_donk: string, oop_river_bet: string, oop_river_raise: string, oop_river_donk: string, ip_flop_bet: string, ip_flop_raise: string, ip_turn_bet: string, ip_turn_raise: string, ip_river_bet: string, ip_river_raise: string, add_allin_threshold: number, force_allin_threshold: number, merging_threshold: number, added_lines: string, removed_lines: string): string | undefined;
    memory_usage(enable_compression: boolean): bigint;
    static new(): GameManager;
    num_actions(): number;
    possible_cards(): bigint;
    private_cards(player: number): Uint16Array;
    solve_step(current_iteration: number): void;
    total_bet_amount(append: Uint32Array): Uint32Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_gamemanager_free: (a: number, b: number) => void;
    readonly gamemanager_actions_after: (a: number, b: number, c: number) => [number, number];
    readonly gamemanager_allocate_memory: (a: number, b: number) => void;
    readonly gamemanager_apply_history: (a: number, b: number, c: number) => void;
    readonly gamemanager_current_player: (a: number) => [number, number];
    readonly gamemanager_exploitability: (a: number) => number;
    readonly gamemanager_finalize: (a: number) => void;
    readonly gamemanager_get_chance_reports: (a: number, b: number, c: number, d: number) => [number, number];
    readonly gamemanager_get_results: (a: number) => [number, number];
    readonly gamemanager_init: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number, x: number, y: number, z: number, a1: number, b1: number, c1: number, d1: number, e1: number, f1: number, g1: number, h1: number, i1: number, j1: number, k1: number, l1: number, m1: number, n1: number, o1: number, p1: number, q1: number, r1: number, s1: number, t1: number, u1: number) => [number, number];
    readonly gamemanager_memory_usage: (a: number, b: number) => bigint;
    readonly gamemanager_new: () => number;
    readonly gamemanager_num_actions: (a: number) => number;
    readonly gamemanager_possible_cards: (a: number) => bigint;
    readonly gamemanager_private_cards: (a: number, b: number) => [number, number];
    readonly gamemanager_solve_step: (a: number, b: number) => void;
    readonly gamemanager_total_bet_amount: (a: number, b: number, c: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
