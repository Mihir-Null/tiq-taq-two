/**
 * fair-seed.ts — dice that nobody can predict or steer, between players who
 * don't trust each other (and a referee who may be one of them).
 *
 * Online, both players must see the same collapses, so every random number
 * has to be derived from data both sides can check. Two rules make that fair:
 *
 *   1. Nobody may CHOOSE the randomness (or it isn't random).
 *   2. Nobody may KNOW the randomness for a move before that move is fixed —
 *      otherwise a player could compute "if I observe square 5 now it comes
 *      out X" and only make moves whose dice favour them.
 *
 * Rule 1 alone is a classic commit–reveal coin flip. Rule 2 needs fresh,
 * unpredictable input for every move, from BOTH players, revealed only after
 * the move is on the table. Doing a full commit–reveal round per move would
 * be slow, so each player commits once to a HASH CHAIN:
 *
 *   secret s ──H──▶ c₁ ──H──▶ c₂ ──H──▶ … ──H──▶ c₆₄ = anchor (sent at game start)
 *
 * For move number p a player reveals c₆₃₋ₚ: the value that hashes to the
 * previously revealed one. Anyone can check it by hashing it p+1 times and
 * comparing with the anchor, but nobody can compute it early — that would
 * mean inverting SHA-256. So the values unlock one at a time, backwards.
 *
 * Per move: the mover sends their value with the move; the host then asks the
 * other player for theirs — only after the move is fixed (and only when the
 * move actually rolls dice). The dice for that move come from
 * SHA-256(game, move number, both values). Neither player alone knew both.
 *
 * What a cheater can still do: refuse to answer (the room forfeits them after
 * a timeout), or — if they are the peer-to-peer room host — stall the game.
 * They can't pick, predict or rewrite dice: every client re-checks every value.
 */

import { sha256Hex } from './sha256.ts';

/** Moves a chain can cover. A game has at most 9 token moves + 2 × 9 ⚡ moves. */
export const CHAIN_LENGTH = 64;

export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const step = (x: string): string => sha256Hex(`tiq-taq-two:chain:${x}`);

/** [c₀ = secret, c₁, …, c_L]; the last element is the public anchor. */
export function makeChain(secret: string = makeNonce(), length = CHAIN_LENGTH): string[] {
  const chain = [secret];
  for (let i = 0; i < length; i++) chain.push(step(chain[i]));
  return chain;
}

export const anchorOf = (chain: string[]): string => chain[chain.length - 1];

/** The value a player reveals for move number `ply` (0-based). */
export function chainValue(chain: string[], ply: number): string | null {
  const i = chain.length - 2 - ply;
  return i >= 0 && Number.isInteger(ply) ? chain[i] : null;
}

const HEX = /^[0-9a-f]{32,64}$/;

/** Does `value` hash to `anchor` in exactly ply + 1 steps? */
export function verifyChainValue(anchor: unknown, value: unknown, ply: number): boolean {
  if (typeof anchor !== 'string' || typeof value !== 'string' || !HEX.test(value) || !HEX.test(anchor)) return false;
  if (!Number.isInteger(ply) || ply < 0 || ply >= CHAIN_LENGTH) return false;
  let x = value;
  for (let i = 0; i <= ply; i++) x = step(x);
  return x === anchor;
}

export const isAnchor = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);

/** The seed for one move's dice, from both players' revealed values. */
export const diceSeed = (gameId: string, ply: number, valueX: string, valueO: string): string =>
  sha256Hex(`tiq-taq-two:dice:${gameId}:${ply}:${valueX}:${valueO}`);
