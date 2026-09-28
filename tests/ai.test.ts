import { describe, expect, it } from 'vitest';
import { classicalValue } from '../src/ai/classical.ts';
import { scoreMoves } from '../src/ai/search.ts';
import { chooseMove } from '../src/ai/bot.ts';
import { computeHints } from '../src/ai/hints.ts';
import {
  newGame, defaultRules, applyMove, legalMoves, previewMove, seededRng, X, O, type GameState, type Move,
} from '../src/engine/index.ts';

const always = (r: number) => () => r;
function play(state: GameState, moves: Move[]): GameState {
  let s = state;
  for (const m of moves) s = applyMove(s, m, always(0.5)).state;
  return s;
}

describe('classical oracle', () => {
  it('knows tic-tac-toe is a draw', () => {
    expect(classicalValue(0, X)).toBe(0);
  });
});

describe('bot', () => {
  it('takes an immediate win', () => {
    // X: ① ②  O: ④ ⑤ — X to move wins on ③
    const s = play(newGame(defaultRules(2)), [
      { kind: 'place', cell: 0 }, { kind: 'place', cell: 3 },
      { kind: 'place', cell: 1 }, { kind: 'place', cell: 4 },
    ]);
    for (const d of ['medium', 'hard'] as const) {
      const m = chooseMove(s, d, always(0.5));
      const out = applyMove(s, m, always(0.5)).state;
      expect(out.result?.winner).toBe(X);
    }
  });

  it('stops an immediate certain win by the opponent', () => {
    // X: ① ⑨  O: ⑤ ④ — O threatens ⑥. X may block classically, or put a
    // split on ⑥: while ⑥ is uncertain, nobody can place there either.
    const s = play(newGame(defaultRules(1)), [
      { kind: 'place', cell: 0 }, { kind: 'place', cell: 4 },
      { kind: 'place', cell: 8 }, { kind: 'place', cell: 3 },
    ]);
    for (const d of ['medium', 'hard'] as const) {
      const after = applyMove(s, chooseMove(s, d, always(0.5)), always(0.5)).state;
      for (const reply of legalMoves(after)) {
        const pv = previewMove(after, reply);
        expect(pv.pending.kind === 'certain-end' && pv.pending.winner === O).toBe(false);
      }
    }
  });

  it('never loses classic tic-tac-toe against a random player', () => {
    const rng = seededRng('classic');
    for (let g = 0; g < 16; g++) {
      const botSide = g % 2 === 0 ? X : O;
      let s = newGame(defaultRules(0));
      while (!s.result) {
        const moves = legalMoves(s);
        const m = s.toMove === botSide ? chooseMove(s, 'hard', rng) : moves[Math.floor(rng() * moves.length)];
        s = applyMove(s, m, rng).state;
      }
      expect(s.result.winner === null || s.result.winner === botSide).toBe(true);
    }
  });

  it('thinks fast enough at level 3', () => {
    const s = play(newGame(defaultRules(3)), [
      { kind: 'split', a: 0, b: 2 }, { kind: 'place', cell: 4 },
      { kind: 'link', a: 6, b: 4 },
    ]);
    const t0 = performance.now();
    const hints = computeHints(s, 3);
    const t1 = performance.now();
    chooseMove(s, 'hard', always(0.2));
    const t2 = performance.now();
    expect(hints.length).toBe(3);
    console.log(`level-3 hints ${Math.round(t1 - t0)} ms, hard move ${Math.round(t2 - t1)} ms, moves ${scoreMoves(s, 1).length}`);
    // A smoke check for accidental exponential blow-ups (it takes well under a
    // second on a laptop), not a benchmark — generous so slow CI runners pass.
    expect(t2 - t1).toBeLessThan(30_000);
  });
});
