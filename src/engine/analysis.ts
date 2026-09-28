/**
 * analysis.ts — read-only questions about a quantum state, for visualisation.
 *
 * Nothing here changes the game; it answers "what would we see if we looked?"
 * and "which squares know about each other?" so the UI can draw rings,
 * forecast bars and entanglement links.
 */

import { QState } from './qstate.ts';
import { cellOf, LINES, verdictOf, EMPTY, X, O, squareName, type Cell, type Player, NUM_CELLS } from './board.ts';

const EPS = 1e-9;

// ───────────────────────────── Line odds ───────────────────────────────────

export interface LineOdds {
  line: number;
  /** Probability the line is all X if the board were observed now. */
  x: number;
  /** Probability the line is all O if the board were observed now. */
  o: number;
}

export function lineOdds(q: QState): LineOdds[] {
  const out: LineOdds[] = LINES.map((_, line) => ({ line, x: 0, o: 0 }));
  for (const u of q.universes()) {
    for (let l = 0; l < LINES.length; l++) {
      const [a, b, c] = LINES[l];
      const va = cellOf(u.code, a);
      if (va === EMPTY || va !== cellOf(u.code, b) || va !== cellOf(u.code, c)) continue;
      if (va === X) out[l].x += u.p;
      else out[l].o += u.p;
    }
  }
  return out;
}

// ───────────────────────────── Forecast ────────────────────────────────────

export interface Forecast {
  /** P(X would lead on lines) if the whole board were observed right now. */
  xWin: number;
  oWin: number;
  /** Universes where both have lines and the count is equal. */
  tie: number;
  /** Universes where nobody has a line yet — the game would go on. */
  open: number;
}

export function forecast(q: QState): Forecast {
  const f: Forecast = { xWin: 0, oWin: 0, tie: 0, open: 0 };
  for (const u of q.universes()) {
    const v = verdictOf(u.code);
    if (v.leader === null) f.open += u.p;
    else if (v.leader === 0) f.tie += u.p;
    else if (v.leader === X) f.xWin += u.p;
    else f.oWin += u.p;
  }
  return f;
}

// ─────────────────────────── Uncertainty ───────────────────────────────────

/** Shannon entropy (bits) of a distribution — 0 = certain, log2(3) ≈ 1.58 = max for a square. */
export function entropyBits(dist: readonly number[]): number {
  let h = 0;
  for (const p of dist) if (p > EPS) h -= p * Math.log2(p);
  return h;
}

/** Squares whose content differs between universes. */
export function uncertainCells(q: QState): number[] {
  const out: number[] = [];
  for (let i = 0; i < NUM_CELLS; i++) if (q.definite(i) === null) out.push(i);
  return out;
}

// ─────────────────────────── Correlations ──────────────────────────────────

export type CorrelationKind =
  /** One token spread over two squares: "(T, empty) or (empty, T)". */
  | 'tether'
  /** An X and an O that may have traded places: "(X, O) or (O, X)". */
  | 'swap'
  /** Anything more tangled. */
  | 'mixed';

export interface Correlation {
  a: number;
  b: number;
  /** Mutual information in bits: how much knowing one square tells you about the other. */
  mi: number;
  kind: CorrelationKind;
  /** For tethers: whose token is spread over the two squares. */
  token: Player | null;
  /** joint[va][vb] = P(square a = va AND square b = vb). */
  joint: number[][];
  /** Plain-language "if … then …" facts, most useful first. */
  statements: string[];
}

const VALUE_WORD: Record<Cell, string> = { 0: 'empty', 1: 'X', 2: 'O' };

/**
 * Pairwise correlations between uncertain squares.
 *
 * Mutual information I(A;B) = Σ P(a,b) · log₂[ P(a,b) / (P(a)P(b)) ] is zero
 * exactly when the two squares are independent. Every split or link creates
 * a strongly correlated pair; the board draws a link for each.
 */
export function correlations(q: QState, minBits = 0.05): Correlation[] {
  const unc = uncertainCells(q);
  if (unc.length < 2) return [];
  const dists = q.cellDists();
  const out: Correlation[] = [];
  for (let i = 0; i < unc.length; i++) {
    for (let j = i + 1; j < unc.length; j++) {
      const a = unc[i];
      const b = unc[j];
      const joint = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (const u of q.universes()) joint[cellOf(u.code, a)][cellOf(u.code, b)] += u.p;
      let mi = 0;
      for (let va = 0; va < 3; va++) for (let vb = 0; vb < 3; vb++) {
        const p = joint[va][vb];
        if (p > EPS) mi += p * Math.log2(p / (dists[a][va] * dists[b][vb]));
      }
      if (mi < minBits) continue;

      let kind: CorrelationKind = 'mixed';
      let token: Player | null = null;
      const swapMass = joint[X][O] + joint[O][X];
      if (swapMass > 1 - 1e-6 && joint[X][O] > EPS && joint[O][X] > EPS) kind = 'swap';
      for (const t of [X, O] as Player[]) {
        const m = joint[t][EMPTY] + joint[EMPTY][t];
        if (m > 1 - 1e-6 && joint[t][EMPTY] > EPS && joint[EMPTY][t] > EPS) {
          kind = 'tether';
          token = t;
        }
      }
      out.push({ a, b, mi, kind, token, joint, statements: implications(a, b, joint, dists[a], dists[b]) });
    }
  }
  return out.sort((x, y) => y.mi - x.mi);
}

/** Deterministic implications such as "If ① is X, ⑤ is certainly O." */
function implications(a: number, b: number, joint: number[][], da: readonly number[], db: readonly number[]): string[] {
  const out: { text: string; score: number }[] = [];
  const add = (from: number, to: number, fromDist: readonly number[], cond: (v: number, w: number) => number) => {
    for (let v = 0; v < 3; v++) {
      if (fromDist[v] < 1e-6) continue;
      for (let w = 0; w < 3; w++) {
        const pCond = cond(v, w) / fromDist[v];
        if (pCond > 1 - 1e-6) {
          // Prefer statements about tokens over statements about emptiness.
          const score = (v === EMPTY ? 0 : 2) + (w === EMPTY ? 0 : 1);
          out.push({ text: `If ${squareName(from)} is ${VALUE_WORD[v as Cell]}, ${squareName(to)} is certainly ${VALUE_WORD[w as Cell]}.`, score });
        }
      }
    }
  };
  add(a, b, da, (v, w) => joint[v][w]);
  add(b, a, db, (v, w) => joint[w][v]);
  return out.sort((x, y) => y.score - x.score).slice(0, 4).map((s) => s.text);
}

// ─────────────────────────── Interference info ─────────────────────────────

/**
 * After a gate recorded with a trace: which output boards received more than
 * one contribution (i.e. where universes met), and how the arrows combined.
 */
export interface Meeting {
  code: number;
  /** Sum of |contribution|² — the probability if the arrows did NOT interfere. */
  naive: number;
  /** Actual probability |Σ contributions|². */
  actual: number;
  contributions: number;
}

export function meetingsFromTrace(q: QState, trace: Map<number, { from: number; amp: { re: number; im: number } }[]>): Meeting[] {
  const out: Meeting[] = [];
  for (const [code, list] of trace) {
    if (list.length < 2) continue;
    let naive = 0;
    let re = 0;
    let im = 0;
    for (const c of list) {
      naive += c.amp.re * c.amp.re + c.amp.im * c.amp.im;
      re += c.amp.re;
      im += c.amp.im;
    }
    const actual = q.prob(code) > 0 ? re * re + im * im : 0;
    out.push({ code, naive, actual, contributions: list.length });
  }
  return out;
}
