// ── Card Types ──────────────────────────────────────────────

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
// 11=J, 12=Q, 13=K, 14=A

export interface Card {
  suit: Suit;
  rank: Rank;
}

// ── Player Types ────────────────────────────────────────────

export type PlayerStatus = 'ACTIVE' | 'FOLDED' | 'ALL_IN' | 'BUSTED' | 'SITTING_OUT';

export interface Player {
  id: string;
  name: string;
  chips: number;
  holeCards: Card[];
  currentBet: number;
  totalBetThisHand: number;
  hasActedThisRound: boolean;
  status: PlayerStatus;
  seatIndex: number;
  isHuman: boolean;
  isDealer: boolean;
}

// ── Game Phase ──────────────────────────────────────────────

export enum GamePhase {
  WAITING = 'WAITING',
  HAND_INIT = 'HAND_INIT',
  PRE_FLOP = 'PRE_FLOP',
  FLOP = 'FLOP',
  TURN = 'TURN',
  RIVER = 'RIVER',
  SHOWDOWN = 'SHOWDOWN',
  CLEANUP = 'CLEANUP',
  GAME_OVER = 'GAME_OVER',
}

// ── Action Types ────────────────────────────────────────────

export enum ActionType {
  FOLD = 'FOLD',
  CHECK = 'CHECK',
  CALL = 'CALL',
  BET = 'BET',
  RAISE = 'RAISE',
  ALL_IN = 'ALL_IN',
  POST_SB = 'POST_SB',
  POST_BB = 'POST_BB',
}

export interface LegalAction {
  type: ActionType;
  minAmount?: number;
  maxAmount?: number;
  callAmount?: number;
}

export interface PlayerAction {
  type: ActionType;
  amount: number;
  playerId: string;
}

// ── Pot Types ───────────────────────────────────────────────

export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
}

// ── Hand Evaluation ─────────────────────────────────────────

export enum HandRank {
  ROYAL_FLUSH = 1,
  STRAIGHT_FLUSH = 2,
  FOUR_OF_A_KIND = 3,
  FULL_HOUSE = 4,
  FLUSH = 5,
  STRAIGHT = 6,
  THREE_OF_A_KIND = 7,
  TWO_PAIR = 8,
  ONE_PAIR = 9,
  HIGH_CARD = 10,
}

export interface EvaluatedHand {
  rank: HandRank;
  bestFive: Card[];
  values: number[];   // [handRank, primary, secondary, kicker1, ...]
  description: string;
}

// ── Game State ──────────────────────────────────────────────

export interface GameState {
  players: Player[];
  communityCards: Card[];
  pots: Pot[];
  currentBet: number;
  lastRaiseIncrement: number;
  phase: GamePhase;
  dealerIndex: number;
  activePlayerIndex: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  handNumber: number;
  actionLog: LogEntry[];
  winners: WinnerInfo[] | null;
  humanActionRequired: boolean;
  legalActions: LegalAction[];
}

export interface LogEntry {
  playerId: string;
  playerName: string;
  action: ActionType;
  amount: number;
  phase: GamePhase;
  handNumber: number;
}

export interface WinnerInfo {
  playerId: string;
  playerName: string;
  amount: number;
  potIndex: number;
  hand?: EvaluatedHand;
}

// ── Animation Events ────────────────────────────────────────

export type AnimationEvent =
  | { type: 'DEAL_HOLE_CARDS' }
  | { type: 'DEAL_FLOP'; cards: Card[] }
  | { type: 'DEAL_TURN'; card: Card }
  | { type: 'DEAL_RIVER'; card: Card }
  | { type: 'PLAYER_ACTION'; playerId: string; action: PlayerAction }
  | { type: 'COLLECT_POTS' }
  | { type: 'AWARD_POT'; winnerId: string; amount: number }
  | { type: 'SHOWDOWN'; playerHands: Array<{ playerId: string; hand: EvaluatedHand }> };

// ── Engine Callbacks ────────────────────────────────────────

export type OnStateChange = (state: GameState) => void;
export type OnActionRequest = (playerId: string, legalActions: LegalAction[]) => Promise<PlayerAction>;
export type OnAnimation = (event: AnimationEvent) => Promise<void>;
