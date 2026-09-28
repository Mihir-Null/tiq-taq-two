/**
 * gates.ts — the three operations every move is built from.
 *
 * Every one of these is a UNITARY: it maps the set of boards to itself in a
 * reversible, probability-preserving way. (Measurement — the Observe move and
 * collapses — is the only non-unitary thing in the game; see qstate.ts.)
 *
 *  1. PLACE(t)      one square     |E⟩ ↔ |t⟩            (put a token down)
 *  2. HALF_SWAP     two squares    √iSWAP for qutrits    (superposition / entanglement / interference)
 *  3. KNOB(k)       one square     phase i^(k·charge)    (twist the phase)
 */

import { c, ONE, quarterTurn, type Complex } from './complex.ts';
import { EMPTY, X, O, other, type Cell, type Player } from './board.ts';
import type { OneGate, TwoGate } from './qstate.ts';

const S = Math.SQRT1_2; // 1/√2

/**
 * PLACE(t): swap "empty" and "t" on one square; leave the third value alone.
 *
 *            |E⟩  |X⟩  |O⟩
 *     |E⟩  [  0    1    0 ]
 *     |X⟩  [  1    0    0 ]      (shown for t = X)
 *     |O⟩  [  0    0    1 ]
 *
 * A permutation matrix — reversible, hence unitary. The rules only allow it
 * on squares that are empty in every universe, so in practice it simply
 * writes `t` into that square in all universes at once.
 */
export function placeGate(t: Player): OneGate {
  const g: (readonly (readonly [Cell, Complex])[])[] = [];
  g[EMPTY] = [[t, ONE]];
  g[t] = [[EMPTY, ONE]];
  g[other(t)] = [[other(t), ONE]];
  return g;
}

/**
 * HALF_SWAP — the qutrit version of the √iSWAP gate (the gate the original
 * Quantum TiqTaqToe uses). On two squares holding p and q:
 *
 *      |p q⟩  →  ( |p q⟩ + i·|q p⟩ ) / √2      when p ≠ q
 *      |p p⟩  →    |p p⟩                        when both are equal
 *
 * In words: "swap the two squares — but only halfway". Applied to a fresh
 * token next to an empty square it creates SUPERPOSITION (the token is in
 * both places). Applied to your token next to an opponent's token it creates
 * ENTANGLEMENT ("either X-O or O-X"). Applied a second time to the same pair,
 * the two branches meet again and INTERFERE.
 *
 * On each 2-dimensional block {|pq⟩, |qp⟩} the matrix is
 *
 *                 1   [ 1  i ]
 *                ──── [ i  1 ]        which squares to iSWAP = [ 0 i ; i 0 ].
 *                 √2
 */
export const HALF_SWAP: TwoGate = (() => {
  const g: (readonly (readonly [Cell, Cell, Complex])[])[] = [];
  for (let va = 0 as Cell; va <= 2; va = (va + 1) as Cell) {
    for (let vb = 0 as Cell; vb <= 2; vb = (vb + 1) as Cell) {
      g[va * 3 + vb] =
        va === vb
          ? [[va, vb, ONE]]
          : [
              [va, vb, c(S, 0)], // stay:  1/√2
              [vb, va, c(0, S)], // swap:  i/√2
            ];
    }
  }
  return g;
})();

/**
 * KNOB(k): twist the phase of whatever sits in one square by k quarter turns.
 * Tokens carry a "charge" for this purpose: X = +1, O = −1, empty = 0, so
 *
 *      |E⟩ → |E⟩      |X⟩ → iᵏ |X⟩      |O⟩ → i⁻ᵏ |O⟩
 *
 * A diagonal (phase-only) gate: it changes NO probability at all. Its effect
 * only shows up when a following HALF_SWAP makes universes meet and
 * interfere — that is the whole trick of the Merge move.
 *
 * Why the ±charge? With it, one knob steers both kinds of quantum pair:
 *   • a split token (X-and-empty): relative phase iᵏ → flips at k = 2 (180°)
 *   • an entangled X–O pair:       relative phase i²ᵏ → flips at k = 1 (90°)
 * The X–O pair is twice as sensitive to the knob (like a N00N state in
 * quantum metrology — see docs/PHYSICS.md).
 */
export function knobGate(k: number): OneGate {
  const g: (readonly (readonly [Cell, Complex])[])[] = [];
  g[EMPTY] = [[EMPTY, ONE]];
  g[X] = [[X, quarterTurn(k)]];
  g[O] = [[O, quarterTurn(-k)]];
  return g;
}

/** Dense 3×3 matrix of a one-square gate (rows = outputs, columns = inputs). */
export function oneGateMatrix(gate: OneGate): Complex[][] {
  const m = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => c(0)));
  for (let v = 0; v < 3; v++) for (const [nv, k] of gate[v]) m[nv][v] = k;
  return m;
}

/** Dense 9×9 matrix of a two-square gate in the basis |EE⟩,|EX⟩,|EO⟩,|XE⟩,… */
export function twoGateMatrix(gate: TwoGate): Complex[][] {
  const m = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => c(0)));
  for (let v = 0; v < 9; v++) for (const [na, nb, k] of gate[v]) m[na * 3 + nb][v] = k;
  return m;
}

/**
 * KNOB at an arbitrary angle θ (radians). NOT used for gameplay — moves only
 * use exact quarter turns — but the interference chart sweeps θ smoothly to
 * draw the full fringe between the four knob positions.
 */
export function knobGateAngle(theta: number): OneGate {
  const g: (readonly (readonly [Cell, Complex])[])[] = [];
  g[EMPTY] = [[EMPTY, ONE]];
  g[X] = [[X, c(Math.cos(theta), Math.sin(theta))]];
  g[O] = [[O, c(Math.cos(theta), -Math.sin(theta))]];
  return g;
}
