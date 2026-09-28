/**
 * search.ts — the bot: expectimax search over quantum moves.
 *
 * Game-tree search normally alternates MAX (my move) and MIN (your move)
 * layers. Quantum measurement adds CHANCE layers: when a move can turn out
 * several ways (an Observe, or a collapse), its value is the probability-
 * weighted AVERAGE of the outcomes. That is "expectimax".
 *
 *   value(state) =  terminal score                       if the game is over
 *                   heuristic(state)                     at the depth limit
 *                   max / min over moves of  Σ p·value(branch)   otherwise
 *
 * Values are always from X's point of view (+1 = X wins, −1 = O wins).
 */

import {
  allOutcomes, legalMoves, X, O, type GameState, type GameResult, type Move,
} from '../engine/index.ts';
import { classicalValue, blockedValue, linePotential } from './classical.ts';

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTY_INFO: Record<Difficulty, { name: string; blurb: string }> = {
  easy: { name: 'Kitten', blurb: 'Plays loosely and often experiments. Great for learning the moves.' },
  medium: { name: 'Cat', blurb: 'Looks one move ahead through every possible universe.' },
  hard: { name: 'Tiger', blurb: 'Simulates hundreds of games — with real dice — before each move.' },
};

export function terminalValue(r: GameResult): number {
  return r.winner === X ? 1 : r.winner === O ? -1 : 0;
}

/**
 * How much the evaluation trusts the optimistic "every universe plays its own
 * best move" value (1) versus the pessimistic "uncertain squares are
 * unplayable" value (0). Bot-vs-bot tournaments (scripts/tournament.ts) found
 * the optimistic value plays better at 1 ply — uncertain squares get freed by
 * a collapse soon enough — so it defaults to 1. Try other values yourself!
 */
export const tuning = { fusion: 1 };

/**
 * Static evaluation: for each universe, the classical value of that board
 * (a blend of the two estimates above, plus a little line potential to break
 * ties), averaged by probability; plus a small bonus for unspent ⚡.
 */
export function heuristic(s: GameState): number {
  if (s.result) return terminalValue(s.result);
  let mask = 0;
  for (let i = 0; i < 9; i++) if (s.q.definite(i) === null) mask |= 1 << i;
  const a = tuning.fusion;
  let v = 0;
  for (const u of s.q.universes()) {
    const fused = classicalValue(u.code, s.toMove);
    const blocked = mask && a < 1 ? blockedValue(u.code, mask, s.toMove) : fused;
    v += u.p * (0.85 * (a * fused + (1 - a) * blocked) + 0.15 * linePotential(u.code));
  }
  v += 0.02 * (s.quanta[0] - s.quanta[1]);
  return Math.max(-1, Math.min(1, v));
}

interface SearchCtx {
  cache: Map<string, number>;
  nodes: number;
}

const keyOf = (s: GameState, depth: number): string =>
  `${s.q.hash()}|${s.toMove}|${s.tokens}|${s.quanta[0]}${s.quanta[1]}|${depth}`;

function candidates(s: GameState): Move[] {
  return legalMoves(s, { dedupe: true });
}

/** Expected value of playing `m` (averaging over every random outcome). */
function moveValue(s: GameState, m: Move, depth: number, ctx: SearchCtx, alpha: number, beta: number): number {
  const branches = allOutcomes(s, m);
  if (branches.length === 1) return value(branches[0].state, depth - 1, ctx, alpha, beta);
  let v = 0;
  // Bounds are not valid inside an average, so chance children get a full window.
  for (const b of branches) v += b.p * value(b.state, depth - 1, ctx, -Infinity, Infinity);
  return v;
}

function value(s: GameState, depth: number, ctx: SearchCtx, alpha: number, beta: number): number {
  ctx.nodes++;
  if (s.result) return terminalValue(s.result);
  if (depth <= 0) return heuristic(s);
  const key = keyOf(s, depth);
  const hit = ctx.cache.get(key);
  if (hit !== undefined) return hit;

  const maximizing = s.toMove === X;
  const window0: [number, number] = [alpha, beta];
  let best = maximizing ? -Infinity : Infinity;
  let pruned = false;
  for (const m of candidates(s)) {
    const v = moveValue(s, m, depth, ctx, alpha, beta);
    if (maximizing) {
      if (v > best) best = v;
      if (best > alpha) alpha = best;
    } else {
      if (v < best) best = v;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) {
      pruned = true; // the opponent would never allow this line — stop looking
      break;
    }
  }
  // Only exact values are safe to cache. A cut-off (pruned) gives a bound, and
  // so does a value outside the window we were given (a "fail-low/high": the
  // true value is at most/at least that, not exactly it).
  if (!pruned && best > window0[0] && best < window0[1]) ctx.cache.set(key, best);
  return best;
}

export interface ScoredMove {
  move: Move;
  /** Expected value from the MOVER's point of view, in [-1, 1]. */
  value: number;
}

/** Score every legal move for the player to move. Higher = better for them. */
export function scoreMoves(s: GameState, depth: number, opts: { refineTop?: number } = {}): ScoredMove[] {
  const ctx: SearchCtx = { cache: new Map(), nodes: 0 };
  const sign = s.toMove === X ? 1 : -1;
  // Pass 1: shallow scores for everything (also used to order pass 2).
  let scored = candidates(s).map((move) => ({ move, value: sign * moveValue(s, move, 1, ctx, -Infinity, Infinity) }));
  scored.sort((a, b) => b.value - a.value);
  if (depth >= 2) {
    const top = opts.refineTop ?? scored.length;
    const refined = scored.slice(0, top).map((sm) => ({ move: sm.move, value: sign * moveValue(s, sm.move, depth, ctx, -Infinity, Infinity) }));
    scored = [...refined, ...scored.slice(top).map((x) => ({ ...x, value: Math.min(x.value, refined[refined.length - 1]?.value ?? x.value) }))];
    scored.sort((a, b) => b.value - a.value);
  }
  return scored;
}

/** Sample from exp(value / T): low temperature ≈ always the best move. */
export function softmaxPick(scored: ScoredMove[], temperature: number, rand: () => number): Move {
  const maxV = Math.max(...scored.map((x) => x.value));
  const weights = scored.map((x) => Math.exp((x.value - maxV) / temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < scored.length; i++) {
    r -= weights[i];
    if (r <= 0) return scored[i].move;
  }
  return scored[0].move;
}

/** Convert a value in [-1, 1] (mover's view) into a rough "win chance" for display. */
export const valueToPercent = (v: number): number => Math.round(((v + 1) / 2) * 100);
