/**
 * hints.ts — turn the bot's move scores into advice a human can use.
 *
 * The search gives numbers; a hint needs a reason. We look at simple,
 * explainable features of each candidate move — does it win outright, block
 * a threat, build a threat, gamble on a measurement — and phrase the best one.
 */

import {
  previewMove, explainPreview, lineOdds, other, squareName, LINE_NAMES, LINES, X, O,
  playerChar, type GameState, type Move, type Player, type QState,
} from '../engine/index.ts';
import { monteCarlo } from './montecarlo.ts';

export type HintTag = 'win' | 'block' | 'threat' | 'fork' | 'gamble' | 'steer' | 'entangle' | 'spread' | 'solid';

export interface Hint {
  move: Move;
  /** Score after this move in simulated games: wins count 1, draws ½ (0–100). */
  percent: number;
  value: number;
  /** Simulated games played after this move, and how they ended (mover's view). */
  games: number;
  wins: number;
  draws: number;
  losses: number;
  tag: HintTag;
  /** One-line reason. */
  reason: string;
  /** What the move does (same text as the preview card). */
  headline: string;
}

/**
 * How dangerous is `p`'s best line? For each line: the chance none of its
 * squares belongs to the opponent, times how many of `p`'s tokens are
 * already (probably) there. Returns the best line and a score in [0, 3].
 */
export function threat(q: QState, p: Player): { line: number; score: number } {
  const d = q.cellDists();
  let best = { line: -1, score: 0 };
  LINES.forEach((cells, line) => {
    let open = 1;
    let mine = 0;
    for (const i of cells) {
      open *= 1 - d[i][other(p)];
      mine += d[i][p];
    }
    const score = open * mine;
    if (score > best.score) best = { line, score };
  });
  return best;
}

/** Lines where `p` has (almost surely) two tokens and the third square could still be theirs. */
function nearLines(q: QState, p: Player): number {
  const d = q.cellDists();
  let n = 0;
  for (const cells of LINES) {
    const mine = cells.reduce((s, i) => s + d[i][p], 0);
    const blocked = cells.some((i) => d[i][other(p)] > 0.999);
    if (!blocked && mine >= 1.95) n++;
  }
  return n;
}

export interface SimStats {
  value: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
}

export function describeHint(s: GameState, move: Move, sim: SimStats): Hint {
  const me = s.toMove;
  const them = other(me);
  const pv = previewMove(s, move);
  const ex = explainPreview(s, pv);
  const after = pv.q;
  const before = s.q;
  const percent = sim.games ? Math.round(((sim.wins + sim.draws / 2) / sim.games) * 100) : 50;
  const mk = (tag: HintTag, reason: string): Hint => ({ move, percent, ...sim, tag, reason, headline: ex.headline });

  if (pv.pending.kind === 'certain-end' && pv.pending.winner === me) return mk('win', 'Wins in every universe — no dice needed.');

  const tBefore = threat(before, them);
  const tAfter = threat(after, them);
  if (tBefore.score >= 1.5 && tAfter.score < tBefore.score - 0.4) {
    return mk('block', `Blunts ${playerChar(them)}'s ${LINE_NAMES[tBefore.line]} threat.`);
  }
  if (nearLines(after, me) >= 2 && nearLines(before, me) < 2) {
    return mk('fork', 'Creates two lines at once — hard to block both.');
  }
  if (move.kind === 'observe') {
    const d = before.cellDist(move.cell);
    const odds = [d[X] > 0.001 ? `X ${Math.round(d[X] * 100)}%` : '', d[O] > 0.001 ? `O ${Math.round(d[O] * 100)}%` : '']
      .filter(Boolean).join(' / ');
    return mk('gamble', `Forces ${squareName(move.cell)} to decide (${odds || 'empty'}).`);
  }
  if (move.kind === 'merge') return mk('steer', 'Uses interference to push probability where it helps you.');
  const odds = lineOdds(after);
  const myBest = Math.max(...odds.map((o) => (me === X ? o.x : o.o)));
  const myBestBefore = Math.max(...lineOdds(before).map((o) => (me === X ? o.x : o.o)));
  if (myBest > myBestBefore + 0.2) {
    return mk('threat', `Completes a line in ${Math.round(myBest * 100)}% of universes.`);
  }
  const tMine = threat(after, me);
  if (tMine.score > threat(before, me).score + 0.4) return mk('threat', `Builds toward the ${LINE_NAMES[tMine.line]}.`);
  if (move.kind === 'link') {
    return mk('entangle', `Ties your new ${playerChar(me)} to ${squareName(move.b)}: wherever ${playerChar(them)} turns out to be, you're the opposite.`);
  }
  if (move.kind === 'split') {
    return mk('spread', `Keeps ${squareName(move.a)} and ${squareName(move.b)} both in play — neither can be placed on while it's uncertain.`);
  }
  if (move.kind === 'place') {
    const lines = LINES.filter((l) => l.includes(move.cell)).length;
    return mk('solid', `A certain token on ${squareName(move.cell)}, part of ${lines} lines.`);
  }
  return mk('solid', 'Keeps your options open without giving much away.');
}

/**
 * The top `count` suggestions for the player to move, ranked by simulating
 * games (see montecarlo.ts). `rand` is injectable for reproducible tests.
 */
export function computeHints(s: GameState, count = 3, rand: () => number = Math.random): Hint[] {
  const scored = monteCarlo(s, rand, { shortlist: 12, budget: 2000 });
  const out: Hint[] = [];
  const seenTags = new Map<string, number>();
  for (const sm of scored) {
    const h = describeHint(s, sm.move, sm);
    // Prefer variety: don't show three near-identical "split" suggestions.
    const k = `${sm.move.kind}:${h.tag}`;
    const n = seenTags.get(k) ?? 0;
    if (n >= 2) continue;
    seenTags.set(k, n + 1);
    out.push(h);
    if (out.length >= count) break;
  }
  return out;
}
