/**
 * montecarlo.ts — "play it out many times and count": the Tiger bot.
 *
 * Averaging a static evaluation over universes has a blind spot (see
 * `blockedValue` in classical.ts): it assumes each universe can follow its
 * own best plan, even though every move acts on ALL universes at once.
 * Monte-Carlo simulation has no such blind spot — it simply plays the real
 * quantum game forward, rolling real dice for measurements, many times.
 *
 * Recipe (a "successive halving" bandit):
 *   1. Shortlist the most promising moves with the fast 1-ply evaluation.
 *   2. Play a few random-but-sensible games ("rollouts") after each.
 *   3. Drop the worse half, give the survivors twice as many rollouts.
 *   4. Repeat until one move is left or the budget runs out.
 *
 * Bonus for learners: the numbers are easy to explain — "after this move,
 * I won 64 of 100 simulated games".
 */

import {
  applyMove, placeGate, decidedStatus, other, LEVELS, X, O, CERTAIN_EPS,
  type GameState, type Move,
} from '../engine/index.ts';
import { scoreMoves } from './search.ts';

/** A cheap, reasonable move for rollouts: win if you can, block if you must, else explore. */
export function rolloutMove(s: GameState, rand: () => number): Move {
  const me = s.toMove;
  const them = other(me);
  const empties: number[] = [];
  for (let i = 0; i < 9; i++) if (s.q.certainlyEmpty(i)) empties.push(i);

  for (const c of empties) {
    const d = decidedStatus(s.q.applyOne(c, placeGate(me)));
    if (d.allHaveLines && d.unanimous === me) return { kind: 'place', cell: c };
  }
  for (const c of empties) {
    const d = decidedStatus(s.q.applyOne(c, placeGate(them)));
    if (d.allHaveLines && d.unanimous === them) return { kind: 'place', cell: c };
  }

  const f = LEVELS[s.rules.level].features;
  const r = rand();
  if (f.split && empties.length >= 2 && r < 0.4) {
    const a = empties[Math.floor(rand() * empties.length)];
    let b = empties[Math.floor(rand() * (empties.length - 1))];
    if (b === a) b = empties[empties.length - 1];
    return { kind: 'split', a, b };
  }
  if (f.link && r < 0.55) {
    const d = s.q.cellDists();
    const targets: number[] = [];
    for (let i = 0; i < 9; i++) if (d[i][them] > CERTAIN_EPS) targets.push(i);
    if (targets.length) {
      const a = empties[Math.floor(rand() * empties.length)];
      const b = targets[Math.floor(rand() * targets.length)];
      if (a !== b) return { kind: 'link', a, b };
    }
  }
  return { kind: 'place', cell: empties[Math.floor(rand() * empties.length)] };
}

/** Play `s` to the end with rollout moves. Returns +1 X wins, −1 O wins, 0 draw. */
export function rollout(s: GameState, rand: () => number): number {
  let cur = s;
  for (let guard = 0; guard < 40 && !cur.result; guard++) {
    cur = applyMove(cur, rolloutMove(cur, rand), rand).state;
  }
  const w = cur.result?.winner;
  return w === X ? 1 : w === O ? -1 : 0;
}

export interface MonteCarloScore {
  move: Move;
  /** Mean result from the MOVER's point of view, in [-1, 1]. */
  value: number;
  wins: number;
  draws: number;
  losses: number;
  games: number;
}

/**
 * Successive-halving Monte-Carlo over the shortlisted moves.
 * `budget` ≈ total number of simulated games.
 */
export function monteCarlo(
  s: GameState,
  rand: () => number,
  opts: { shortlist?: number; budget?: number } = {},
): MonteCarloScore[] {
  const shortlist = opts.shortlist ?? 12;
  const budget = opts.budget ?? 1200;
  const sign = s.toMove === X ? 1 : -1;
  const ranked = scoreMoves(s, 1);
  // A move that wins in every universe needs no simulation.
  let alive: MonteCarloScore[] = ranked.slice(0, shortlist).map((r) => ({
    move: r.move, value: 0, wins: 0, draws: 0, losses: 0, games: 0,
  }));
  const eliminated: MonteCarloScore[][] = [];
  const rounds = Math.max(1, Math.ceil(Math.log2(alive.length)));
  while (alive.length > 1) {
    const per = Math.max(4, Math.floor(budget / (rounds * alive.length)));
    for (const sc of alive) {
      for (let i = 0; i < per; i++) {
        const next = applyMove(s, sc.move, rand).state;
        const res = sign * (next.result ? (next.result.winner === X ? 1 : next.result.winner === O ? -1 : 0) : rollout(next, rand));
        if (res > 0) sc.wins++;
        else if (res < 0) sc.losses++;
        else sc.draws++;
        sc.games++;
      }
      // Wins count 1, draws ½: an estimate of "chance not to lose"-weighted score.
      sc.value = (sc.wins - sc.losses) / sc.games;
    }
    alive.sort((a, b) => b.value - a.value);
    const keep = Math.ceil(alive.length / 2);
    eliminated.push(alive.slice(keep));
    alive = alive.slice(0, keep);
  }
  // Best first: the final survivor, then each eliminated group from last to first.
  return [...alive, ...eliminated.reverse().flat()];
}
