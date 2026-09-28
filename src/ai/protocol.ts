import type { GameStateJSON, Move } from '../engine/index.ts';
import type { Difficulty } from './search.ts';
import type { Hint } from './hints.ts';

/** Messages exchanged between the page and the bot's Web Worker. */
export type AiRequest =
  | { id: number; kind: 'move'; state: GameStateJSON; difficulty: Difficulty }
  | { id: number; kind: 'hints'; state: GameStateJSON; count: number };

export type AiResponse =
  | { id: number; ok: true; move: Move }
  | { id: number; ok: true; hints: Hint[] }
  | { id: number; ok: false; error: string };
