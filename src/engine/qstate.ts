/**
 * qstate.ts — the quantum state of the whole board.
 *
 * The full state of 9 qutrits lives in a 3⁹ = 19 683-dimensional space:
 *
 *        |ψ⟩ = Σ  a(board) · |board⟩
 *            boards
 *
 * Each classical board with a non-zero amplitude a(board) is what the game
 * calls a UNIVERSE. In practice only a handful of boards are ever non-zero,
 * so we store the state *sparsely*: a Map from board code → amplitude.
 *
 * QState objects are immutable. Every gate returns a brand new QState, which
 * makes undo, previews ("what would this move do?") and time-travel through
 * the move history trivial: just keep the old objects around.
 *
 * Determinism matters for online play: every client (and the server) must
 * compute exactly the same numbers. So we always iterate universes in sorted
 * board-code order, and only ever multiply by 1/√2 and by exact quarter-turn
 * phases (see complex.ts).
 */

import { add, abs2, mul, scale, ZERO, ONE, type Complex } from './complex.ts';
import { cellOf, withCell, EMPTY, NUM_CELLS, type Cell } from './board.ts';

/** One branch of the superposition: a classical board and its amplitude. */
export interface Universe {
  readonly code: number;
  readonly amp: Complex;
  /** Probability = |amp|² (Born rule). */
  readonly p: number;
}

/**
 * A gate acting on ONE square: `gate[v]` lists what input value `v` turns
 * into, as (output value, complex coefficient) pairs. This is just a sparse
 * way of writing a 3×3 unitary matrix column by column.
 */
export type OneGate = readonly (readonly (readonly [Cell, Complex])[])[];

/**
 * A gate acting on TWO squares (a, b): `gate[va * 3 + vb]` lists the
 * (new va, new vb, coefficient) triples — a sparse 9×9 unitary matrix.
 */
export type TwoGate = readonly (readonly (readonly [Cell, Cell, Complex])[])[];

/** Which input universes fed which output universe (for interference visuals). */
export interface Contribution {
  /** Board code of the input universe. */
  readonly from: number;
  /** Amplitude it contributed = gate coefficient × input amplitude. */
  readonly amp: Complex;
}
export type Trace = Map<number, Contribution[]>;

/** Probabilities below this are float noise — treated as an exact zero. */
const PRUNE_P = 1e-14;
/** Tolerance for "is this square certain?" style questions. */
export const CERTAIN_EPS = 1e-9;

export class QState {
  /** board code → amplitude, iterated in ascending board order. */
  readonly #amps: ReadonlyMap<number, Complex>;
  #universes: Universe[] | null = null;
  #cellDists: (readonly [number, number, number])[] | null = null;

  private constructor(amps: Map<number, Complex>) {
    this.#amps = amps;
  }

  /** A single definite board (all squares definite), e.g. the empty board. */
  static basis(code = 0): QState {
    return new QState(new Map([[code, ONE]]));
  }

  /**
   * Build a state from (board, amplitude) pairs. Duplicate boards are summed,
   * near-zero amplitudes are dropped, and entries are stored in board order.
   */
  static from(entries: Iterable<readonly [number, Complex]>, normalize = false): QState {
    const acc = new Map<number, Complex>();
    for (const [code, amp] of entries) acc.set(code, add(acc.get(code) ?? ZERO, amp));
    return QState.#finish(acc, normalize);
  }

  static #finish(acc: Map<number, Complex>, forceNormalize: boolean): QState {
    const codes = [...acc.keys()].sort((x, y) => x - y);
    const out = new Map<number, Complex>();
    let norm2 = 0;
    for (const code of codes) {
      const amp = acc.get(code)!;
      const p = abs2(amp);
      if (p < PRUNE_P) continue; // destructive interference (or float dust) → gone
      out.set(code, amp);
      norm2 += p;
    }
    if (out.size === 0) throw new Error('quantum state vanished (norm 0) — this is a bug');
    // Unitary gates keep the norm at 1 up to rounding. We only rescale when
    // asked (after a measurement) or when rounding drift becomes visible.
    if (forceNormalize || Math.abs(norm2 - 1) > 1e-9) {
      const k = 1 / Math.sqrt(norm2);
      for (const [code, amp] of out) out.set(code, scale(amp, k));
    }
    return new QState(out);
  }

  /** Number of universes (non-zero branches). */
  get size(): number {
    return this.#amps.size;
  }

  amp(code: number): Complex {
    return this.#amps.get(code) ?? ZERO;
  }

  prob(code: number): number {
    return abs2(this.amp(code));
  }

  /** All universes in canonical (ascending board code) order. */
  universes(): readonly Universe[] {
    if (!this.#universes) {
      this.#universes = [...this.#amps].map(([code, amp]) => ({ code, amp, p: abs2(amp) }));
    }
    return this.#universes;
  }

  /** Universes sorted from most to least likely (ties broken by board code). */
  byProbability(): Universe[] {
    return [...this.universes()].sort((u, v) => v.p - u.p || u.code - v.code);
  }

  /** Σ|a|² — should always be 1. */
  norm2(): number {
    let s = 0;
    for (const u of this.universes()) s += u.p;
    return s;
  }

  /**
   * Marginal distribution of every square: dists[i] = [P(empty), P(X), P(O)].
   * This is what the probability rings on the board draw.
   */
  cellDists(): readonly (readonly [number, number, number])[] {
    if (!this.#cellDists) {
      const d = Array.from({ length: NUM_CELLS }, () => [0, 0, 0] as [number, number, number]);
      for (const u of this.universes()) {
        for (let i = 0; i < NUM_CELLS; i++) d[i][cellOf(u.code, i)] += u.p;
      }
      this.#cellDists = d;
    }
    return this.#cellDists;
  }

  cellDist(i: number): readonly [number, number, number] {
    return this.cellDists()[i];
  }

  /** The value square `i` has in EVERY universe, or null if it is uncertain. */
  definite(i: number): Cell | null {
    const d = this.cellDist(i);
    for (let v = 0 as Cell; v <= 2; v = (v + 1) as Cell) if (d[v] > 1 - CERTAIN_EPS) return v;
    return null;
  }

  /** True when square `i` is empty in every universe. */
  certainlyEmpty(i: number): boolean {
    return this.definite(i) === EMPTY;
  }

  /** True when the whole board is classical (exactly one universe). */
  get isClassical(): boolean {
    return this.#amps.size === 1;
  }

  /**
   * Apply a one-square gate to square `i` in every universe.
   * (Linearity: a gate acts on each branch independently and the results add.)
   */
  applyOne(i: number, gate: OneGate): QState {
    const acc = new Map<number, Complex>();
    for (const u of this.universes()) {
      for (const [nv, coeff] of gate[cellOf(u.code, i)]) {
        const nc = withCell(u.code, i, nv);
        acc.set(nc, add(acc.get(nc) ?? ZERO, mul(coeff, u.amp)));
      }
    }
    return QState.#finish(acc, false);
  }

  /**
   * Apply a two-square gate to squares (a, b) in every universe.
   *
   * This is where interference happens: two DIFFERENT input universes can
   * produce the SAME output board. Their contributions are added as complex
   * numbers, so they may reinforce or cancel. Pass a `trace` map to record
   * who contributed what (the UI draws those arrows head-to-tail).
   */
  applyTwo(a: number, b: number, gate: TwoGate, trace?: Trace): QState {
    const acc = new Map<number, Complex>();
    for (const u of this.universes()) {
      const va = cellOf(u.code, a);
      const vb = cellOf(u.code, b);
      for (const [na, nb, coeff] of gate[va * 3 + vb]) {
        const nc = withCell(withCell(u.code, a, na), b, nb);
        const contribution = mul(coeff, u.amp);
        acc.set(nc, add(acc.get(nc) ?? ZERO, contribution));
        if (trace) {
          const list = trace.get(nc) ?? [];
          list.push({ from: u.code, amp: contribution });
          trace.set(nc, list);
        }
      }
    }
    return QState.#finish(acc, false);
  }

  /** Multiply every amplitude by the same factor (used by tests / tools). */
  mapAmplitudes(f: (u: Universe) => Complex): QState {
    return QState.from(this.universes().map((u) => [u.code, f(u)] as const));
  }

  /**
   * MEASURE one square (the Observe move).
   *
   * Born rule: outcome v happens with probability P(square = v). Afterwards
   * every universe that disagrees with the result is deleted, and the
   * survivors are rescaled so the probabilities add up to 1 again.
   * Entangled squares therefore "snap" too — they only survive in the
   * universes that agree.
   *
   * `r` is a uniform random number in [0, 1). Passing it in (rather than
   * calling Math.random here) keeps the engine deterministic and testable.
   */
  measureCell(i: number, r: number): { outcome: Cell; p: number; state: QState } {
    const dist = this.cellDist(i);
    let outcome: Cell = EMPTY;
    let cumulative = 0;
    let lastPossible: Cell = EMPTY;
    let chosen = false;
    for (let v = 0 as Cell; v <= 2; v = (v + 1) as Cell) {
      if (dist[v] <= PRUNE_P) continue;
      lastPossible = v;
      cumulative += dist[v];
      if (!chosen && r < cumulative) {
        outcome = v;
        chosen = true;
      }
    }
    if (!chosen) outcome = lastPossible; // r landed in rounding slack at the very end
    const kept = this.universes().filter((u) => cellOf(u.code, i) === outcome);
    return {
      outcome,
      p: dist[outcome],
      state: QState.#finish(new Map(kept.map((u) => [u.code, u.amp])), true),
    };
  }

  /**
   * MEASURE EVERYTHING (a collapse): pick one universe with probability |a|².
   * Universes are laid out on [0, 1) in board order, each taking a slice as
   * wide as its probability; `r` says where the pointer stops. The collapse
   * animation draws exactly this: a wheel of slices and a pointer at r.
   */
  measureAll(r: number): { code: number; p: number; state: QState } {
    const us = this.universes();
    let cumulative = 0;
    let pick = us[us.length - 1];
    for (const u of us) {
      cumulative += u.p;
      if (r < cumulative) {
        pick = u;
        break;
      }
    }
    return { code: pick.code, p: pick.p, state: QState.basis(pick.code) };
  }

  /** Cheap equality check up to rounding. */
  equals(other: QState, eps = 1e-9): boolean {
    if (other.size !== this.size) return false;
    for (const u of this.universes()) {
      const w = other.amp(u.code);
      if (Math.abs(w.re - u.amp.re) > eps || Math.abs(w.im - u.amp.im) > eps) return false;
    }
    return true;
  }

  /**
   * Physically identical? Multiplying EVERY amplitude by the same phase
   * (a "global phase") changes nothing measurable, so we compare up to that.
   */
  samePhysicsAs(other: QState, eps = 1e-9): boolean {
    if (other.size !== this.size) return false;
    const first = this.universes()[0];
    const w0 = other.amp(first.code);
    if (abs2(w0) < PRUNE_P) return false;
    // ratio = w0 / a0 — the candidate global phase.
    const d = first.p;
    const ratio = { re: (w0.re * first.amp.re + w0.im * first.amp.im) / d, im: (w0.im * first.amp.re - w0.re * first.amp.im) / d };
    for (const u of this.universes()) {
      const expect = mul(ratio, u.amp);
      const w = other.amp(u.code);
      if (Math.abs(w.re - expect.re) > eps || Math.abs(w.im - expect.im) > eps) return false;
    }
    return true;
  }

  /**
   * A short fingerprint of the state (FNV-1a over rounded amplitudes).
   * Online clients compare fingerprints after every move to detect desyncs.
   */
  hash(): string {
    let h = 0x811c9dc5;
    const mix = (n: number) => {
      h ^= n | 0;
      h = Math.imul(h, 0x01000193);
    };
    for (const u of this.universes()) {
      mix(u.code);
      mix(Math.round(u.amp.re * 1e9));
      mix(Math.round(u.amp.im * 1e9));
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  /** Serialisable form (used by tests, debugging and the sandbox). */
  toJSON(): [number, number, number][] {
    return this.universes().map((u) => [u.code, u.amp.re, u.amp.im]);
  }
}
