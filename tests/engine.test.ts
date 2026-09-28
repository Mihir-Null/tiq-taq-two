import { describe, expect, it } from 'vitest';
import {
  QState, HALF_SWAP, placeGate, knobGate, oneGateMatrix, twoGateMatrix,
  newGame, defaultRules, applyMove, legalMoves, whyIllegal, replay, previewMove,
  rngForPly, seededRng, parseBoard, cellOf, X, O, EMPTY, conj, mul, add, c, abs2,
  type Complex, type Move, type GameState, forecast, correlations, lineOdds, NUM_CELLS,
  allOutcomes, needsDice, noDice,
} from '../src/engine/index.ts';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Check U†U = 1 for a dense complex matrix. */
function expectUnitary(m: Complex[][]) {
  const n = m.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = c(0);
      for (let k = 0; k < n; k++) s = add(s, mul(conj(m[k][i]), m[k][j]));
      expect(s.re).toBeCloseTo(i === j ? 1 : 0, 12);
      expect(s.im).toBeCloseTo(0, 12);
    }
  }
}

const always = (r: number) => () => r;

function play(state: GameState, moves: Move[], rng = always(0.5)): GameState {
  let s = state;
  for (const m of moves) s = applyMove(s, m, rng).state;
  return s;
}

// ─── gates ──────────────────────────────────────────────────────────────────

describe('gates are unitary', () => {
  it('PLACE for X and O', () => {
    expectUnitary(oneGateMatrix(placeGate(X)));
    expectUnitary(oneGateMatrix(placeGate(O)));
  });
  it('HALF_SWAP (qutrit √iSWAP)', () => expectUnitary(twoGateMatrix(HALF_SWAP)));
  it('KNOB for every quarter turn', () => {
    for (let k = 0; k < 4; k++) expectUnitary(oneGateMatrix(knobGate(k)));
  });
  it('HALF_SWAP applied twice is a full swap (iSWAP)', () => {
    const m = twoGateMatrix(HALF_SWAP);
    // (HALF_SWAP)² on |X E⟩ should be i|E X⟩
    const XE = X * 3 + EMPTY;
    const EX = EMPTY * 3 + X;
    let out = c(0);
    for (let k = 0; k < 9; k++) out = add(out, mul(m[EX][k], m[k][XE]));
    expect(out.re).toBeCloseTo(0, 12);
    expect(out.im).toBeCloseTo(1, 12);
  });
});

// ─── superposition ──────────────────────────────────────────────────────────

describe('split = superposition', () => {
  it('creates two equally likely universes with a relative phase i', () => {
    const s = play(newGame(defaultRules(1)), [{ kind: 'split', a: 0, b: 2 }]);
    expect(s.q.size).toBe(2);
    expect(s.q.cellDist(0)[X]).toBeCloseTo(0.5, 12);
    expect(s.q.cellDist(2)[X]).toBeCloseTo(0.5, 12);
    const onA = s.q.amp(parseBoard('X........'));
    const onB = s.q.amp(parseBoard('..X......'));
    expect(onA.re).toBeCloseTo(Math.SQRT1_2, 12);
    expect(onB.im).toBeCloseTo(Math.SQRT1_2, 12);
    expect(s.tokens).toBe(1);
    expect(s.toMove).toBe(O);
  });

  it('refuses to split onto a square that is not certainly empty', () => {
    const s = play(newGame(defaultRules(1)), [{ kind: 'split', a: 0, b: 2 }]);
    expect(whyIllegal(s, { kind: 'place', cell: 0 })).toMatch(/only empty in 50%/);
    expect(whyIllegal(s, { kind: 'split', a: 1, b: 2 })).not.toBeNull();
  });
});

// ─── entanglement & measurement ─────────────────────────────────────────────

describe('link = entanglement', () => {
  it('X then O-link gives (X,O) or (O,X), never anything else', () => {
    const s = play(newGame(defaultRules(2)), [
      { kind: 'place', cell: 4 },
      { kind: 'link', a: 0, b: 4 },
    ]);
    expect(s.q.size).toBe(2);
    for (const u of s.q.universes()) {
      const a = cellOf(u.code, 0);
      const b = cellOf(u.code, 4);
      expect(new Set([a, b])).toEqual(new Set([X, O]));
      expect(u.p).toBeCloseTo(0.5, 12);
    }
    const corr = correlations(s.q);
    expect(corr).toHaveLength(1);
    expect(corr[0].kind).toBe('swap');
    expect(corr[0].mi).toBeCloseTo(1, 9); // one full bit
  });

  it('observing one half of the pair fixes the other ("spooky action")', () => {
    let s = play(newGame(defaultRules(2)), [
      { kind: 'place', cell: 4 },
      { kind: 'link', a: 0, b: 4 },
    ]);
    // X observes square ① with r = 0.9: outcomes laid out as [empty, X, O] = [0, .5, .5] → O
    s = applyMove(s, { kind: 'observe', cell: 0 }, always(0.9)).state;
    expect(s.q.isClassical).toBe(true);
    expect(s.q.definite(0)).toBe(O);
    expect(s.q.definite(4)).toBe(X);
    expect(s.quanta[0]).toBe(1); // X spent one ⚡
  });
});

// ─── interference ───────────────────────────────────────────────────────────

describe('merge = interference', () => {
  const splitThenMerge = (turns: number) =>
    play(newGame(defaultRules(3)), [
      { kind: 'split', a: 3, b: 5 },  // X over ④/⑥
      { kind: 'place', cell: 0 },     // O somewhere else
      { kind: 'merge', a: 3, b: 5, turns },
    ]);

  it('knob 0°: the two halves cancel on ④ and reinforce on ⑥', () => {
    const s = splitThenMerge(0);
    expect(s.q.cellDist(5)[X]).toBeCloseTo(1, 12);
    expect(s.q.size).toBe(1);
  });
  it('knob 180°: the token lands on ④ instead', () => {
    const s = splitThenMerge(2);
    expect(s.q.cellDist(3)[X]).toBeCloseTo(1, 12);
  });
  it('knob 90°: still 50/50 (arrows at right angles do not cancel)', () => {
    const s = splitThenMerge(1);
    expect(s.q.cellDist(3)[X]).toBeCloseTo(0.5, 12);
  });
  it('follows the Mach–Zehnder law P = cos²(φ/2) for a split token', () => {
    for (let k = 0; k < 4; k++) {
      const s = splitThenMerge(k);
      const phi = (k * Math.PI) / 2;
      expect(s.q.cellDist(5)[X]).toBeCloseTo(Math.cos(phi / 2) ** 2, 12);
    }
  });
  it('an entangled X–O pair is twice as sensitive: P = sin²(φ)', () => {
    for (let k = 0; k < 4; k++) {
      const s = play(newGame(defaultRules(3)), [
        { kind: 'place', cell: 4 },
        { kind: 'link', a: 0, b: 4 },
        { kind: 'merge', a: 0, b: 4, turns: k },
      ]);
      const phi = (k * Math.PI) / 2;
      // Probability that the O ends up on ① — period 180° instead of 360°:
      expect(s.q.cellDist(0)[O]).toBeCloseTo(Math.sin(phi) ** 2, 12);
    }
  });
  it('rejects a merge that changes nothing', () => {
    const s = play(newGame(defaultRules(3)), [{ kind: 'place', cell: 0 }, { kind: 'place', cell: 8 }]);
    // Two empty squares: half-swapping empty with empty does nothing.
    expect(whyIllegal(s, { kind: 'merge', a: 1, b: 2, turns: 0 })).toMatch(/change nothing/);
  });
});

// ─── resolution & scoring ───────────────────────────────────────────────────

describe('resolution rules', () => {
  it('classic: first line wins immediately, with certainty', () => {
    const s = play(newGame(defaultRules(0)), [
      { kind: 'place', cell: 0 }, { kind: 'place', cell: 3 },
      { kind: 'place', cell: 1 }, { kind: 'place', cell: 4 },
      { kind: 'place', cell: 2 },
    ]);
    expect(s.result?.winner).toBe(X);
    expect(s.result?.certain).toBe(true);
    expect(s.result?.reason).toBe('line');
  });

  it('full board collapses and is scored', () => {
    // X keeps one token in superposition over ①/③ while the board fills up:
    //   X O X        the crowded collapse picks the universe with X on ①,
    //   X O O        X then fills ③ and the full board is a draw.
    //   O X X
    let s = newGame(defaultRules(1));
    const seen: string[] = [];
    const moves: Move[] = [
      { kind: 'split', a: 0, b: 2 }, { kind: 'place', cell: 1 },
      { kind: 'place', cell: 3 }, { kind: 'place', cell: 4 },
      { kind: 'place', cell: 7 }, { kind: 'place', cell: 5 },
      { kind: 'place', cell: 8 }, { kind: 'place', cell: 6 },
    ];
    for (const m of moves) {
      const out = applyMove(s, m, always(0.3));
      seen.push(...out.events.map((e) => (e.type === 'collapse' ? `collapse:${e.reason}` : e.type)));
      s = out.state;
    }
    expect(seen).toEqual(['collapse:crowded']);
    expect(s.q.definite(0)).toBe(X);
    expect(s.q.definite(2)).toBe(EMPTY);
    s = applyMove(s, { kind: 'place', cell: 2 }, always(0.3)).state;
    expect(s.result).toMatchObject({ winner: null, reason: 'full', xLines: 0, oLines: 0 });
  });

  it('crowded board (no certainly-empty square) collapses before the next turn', () => {
    // X splits ①/②, O splits... fill until every empty square is only "maybe" empty.
    let s = newGame(defaultRules(1));
    const moves: Move[] = [
      { kind: 'split', a: 0, b: 1 }, // X
      { kind: 'place', cell: 4 },    // O
      { kind: 'place', cell: 2 },    // X
      { kind: 'place', cell: 6 },    // O
      { kind: 'place', cell: 5 },    // X
      { kind: 'place', cell: 3 },    // O
      { kind: 'place', cell: 7 },    // X
    ];
    // Now tokens = 7; empties certainly: 8, and one of ①/② → after O places on ⑨
    // (cell 8) no square is certainly empty (one of ①/② is empty in each universe).
    const events = [];
    for (const m of moves) s = applyMove(s, m, always(0.25)).state;
    const out = applyMove(s, { kind: 'place', cell: 8 }, always(0.25));
    events.push(...out.events);
    expect(events.some((e) => e.type === 'collapse' && e.reason === 'crowded')).toBe(true);
    expect(out.state.q.isClassical).toBe(true);
  });

  it('never gets stuck: random games always finish, keep norm 1 and equal token counts', () => {
    const rng = seededRng('fuzz');
    for (let game = 0; game < 300; game++) {
      const level = (1 + (game % 3)) as 1 | 2 | 3;
      let s = newGame(defaultRules(level));
      let plies = 0;
      while (!s.result) {
        const moves = legalMoves(s);
        expect(moves.length).toBeGreaterThan(0);
        const m = moves[Math.floor(rng() * moves.length)];
        s = applyMove(s, m, rng).state;
        plies++;
        expect(s.q.norm2()).toBeCloseTo(1, 9);
        for (const u of s.q.universes()) {
          let t = 0;
          for (let i = 0; i < NUM_CELLS; i++) if (cellOf(u.code, i) !== EMPTY) t++;
          expect(t).toBe(s.tokens);
        }
        expect(plies).toBeLessThanOrEqual(9 + 2 * s.rules.quanta);
      }
    }
  });
});

describe('dice bookkeeping (used by the bot and by online play)', () => {
  it('allOutcomes covers every random branch, needsDice knows when dice roll, previews match', () => {
    const rng = seededRng('outcomes');
    for (let game = 0; game < 120; game++) {
      const level = (1 + (game % 3)) as 1 | 2 | 3;
      let s = newGame(defaultRules(level));
      while (!s.result) {
        const moves = legalMoves(s);
        const m = moves[Math.floor(rng() * moves.length)];
        const branches = allOutcomes(s, m);
        expect(branches.reduce((t, b) => t + b.p, 0)).toBeCloseTo(1, 9);
        if (needsDice(s, m)) {
          expect(() => applyMove(s, m, noDice)).toThrow();
        } else {
          // No dice: exactly one outcome, and the preview shows it.
          expect(branches).toHaveLength(1);
          const out = applyMove(s, m, noDice).state;
          expect(out.q.hash()).toBe(branches[0].state.q.hash());
          if (m.kind !== 'observe') expect(previewMove(s, m).q.hash()).toBe(out.q.hash());
        }
        s = applyMove(s, m, rng).state;
      }
    }
  });

  it('an Observe that settles the game is not reported as "no dice needed"', () => {
    // Random games: whenever a move that rolled dice also ended the game, the
    // result must not claim the outcome was certain.
    const rng = seededRng('certain-flag');
    let found = 0;
    for (let game = 0; game < 400 && found < 5; game++) {
      let s = newGame(defaultRules(2));
      while (!s.result) {
        const moves = legalMoves(s);
        const m = moves[Math.floor(rng() * moves.length)];
        const out = applyMove(s, m, rng);
        if (out.state.result && out.events.some((e) => e.type === 'measure' || e.type === 'collapse')) {
          expect(out.state.result.certain).toBe(false);
          found++;
        }
        s = out.state;
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

// ─── determinism ────────────────────────────────────────────────────────────

describe('determinism for online play', () => {
  const moves: Move[] = [
    { kind: 'split', a: 0, b: 2 },
    { kind: 'link', a: 4, b: 0 },
    { kind: 'split', a: 6, b: 8 },
    { kind: 'observe', cell: 4 },
  ];
  it('same seed + same moves ⇒ identical states', () => {
    const a = replay(defaultRules(3), X, moves, (ply) => rngForPly('seed-1', ply));
    const b = replay(defaultRules(3), X, moves, (ply) => rngForPly('seed-1', ply));
    expect(a.states.map((s) => s.q.hash())).toEqual(b.states.map((s) => s.q.hash()));
  });
});

// ─── analysis helpers ───────────────────────────────────────────────────────

describe('analysis', () => {
  it('forecast and line odds add up', () => {
    const s = play(newGame(defaultRules(1)), [
      { kind: 'place', cell: 0 }, { kind: 'place', cell: 3 },
      { kind: 'place', cell: 1 }, { kind: 'place', cell: 4 },
      { kind: 'split', a: 2, b: 8 },
    ]);
    const f = forecast(s.q);
    expect(f.xWin + f.oWin + f.tie + f.open).toBeCloseTo(1, 12);
    expect(f.xWin).toBeCloseTo(0.5, 12);
    expect(lineOdds(s.q)[0].x).toBeCloseTo(0.5, 12);
    expect(s.result).toBeNull(); // only half the universes have the line
  });

  it('preview does not roll dice and predicts observe outcomes', () => {
    const s = play(newGame(defaultRules(2)), [{ kind: 'split', a: 0, b: 1 }]);
    const pv = previewMove(s, { kind: 'observe', cell: 0 });
    expect(pv.observeOutcomes?.map((o) => o.p).reduce((x, y) => x + y)).toBeCloseTo(1, 12);
    expect(pv.observeOutcomes).toHaveLength(2);
  });

  it('QState keeps amplitudes normalised after measurement', () => {
    const q = QState.from([[0, c(0.6)], [1, c(0, 0.8)]]);
    const m = q.measureAll(0.99);
    expect(m.code).toBe(1);
    expect(abs2(m.state.amp(1))).toBeCloseTo(1, 12);
  });
});
