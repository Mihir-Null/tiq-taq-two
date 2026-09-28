/**
 * bot.ts — the three bot personalities.
 *
 *   Kitten (easy)   1-ply evaluation, high randomness, sometimes just wanders.
 *   Cat (medium)    1-ply expectimax: every move, every universe, every
 *                   measurement outcome — then the classical oracle.
 *   Tiger (hard)    Monte-Carlo: shortlist with the Cat's evaluation, then
 *                   simulate real games to pick the move that wins most.
 */

import { legalMoves, previewMove, type GameState, type Move } from '../engine/index.ts';
import { scoreMoves, softmaxPick, type Difficulty } from './search.ts';
import { monteCarlo } from './montecarlo.ts';

export function chooseMove(s: GameState, difficulty: Difficulty, rand: () => number = Math.random): Move {
  const moves = legalMoves(s, { dedupe: true });
  if (moves.length === 0) throw new Error('no legal moves');

  // Any difficulty takes a certain win when it sees one.
  for (const m of moves) {
    const pv = previewMove(s, m);
    if (pv.pending.kind === 'certain-end' && pv.pending.winner === s.toMove) return m;
  }

  switch (difficulty) {
    case 'easy': {
      if (rand() < 0.3) {
        const tokenMoves = moves.filter((m) => m.kind === 'place' || m.kind === 'split' || m.kind === 'link');
        const pool = tokenMoves.length ? tokenMoves : moves;
        return pool[Math.floor(rand() * pool.length)];
      }
      return softmaxPick(scoreMoves(s, 1), 0.35, rand);
    }
    case 'medium':
      return softmaxPick(scoreMoves(s, 1), 0.05, rand);
    case 'hard':
      return monteCarlo(s, rand, { shortlist: 14, budget: 2400 })[0].move;
  }
}
