/**
 * complex.ts — the tiny bit of complex arithmetic the game needs.
 *
 * Quantum amplitudes are complex numbers. Two facts carry the whole game:
 *   • |amplitude|²  is a probability (the Born rule).
 *   • the ANGLE (phase) of an amplitude is invisible on its own, but decides
 *     whether two amplitudes that land on the same outcome add up
 *     (constructive interference) or cancel (destructive interference).
 *
 * We store a complex number as a plain `{ re, im }` object. Everything here is
 * pure and allocation-light; the state rarely holds more than a few hundred
 * amplitudes, so clarity beats micro-optimisation.
 */

export interface Complex {
  readonly re: number;
  readonly im: number;
}

export const c = (re: number, im = 0): Complex => ({ re, im });

export const ZERO: Complex = c(0, 0);
export const ONE: Complex = c(1, 0);
/** The imaginary unit i (a quarter turn: 90°). */
export const I: Complex = c(0, 1);

export const add = (a: Complex, b: Complex): Complex => c(a.re + b.re, a.im + b.im);
export const sub = (a: Complex, b: Complex): Complex => c(a.re - b.re, a.im - b.im);
export const mul = (a: Complex, b: Complex): Complex =>
  c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const scale = (a: Complex, s: number): Complex => c(a.re * s, a.im * s);
export const conj = (a: Complex): Complex => c(a.re, -a.im);

/** |z|² — for an amplitude this is exactly the probability it carries. */
export const abs2 = (a: Complex): number => a.re * a.re + a.im * a.im;
export const abs = (a: Complex): number => Math.sqrt(abs2(a));
/** Phase angle in radians, in (-π, π]. */
export const arg = (a: Complex): number => Math.atan2(a.im, a.re);

/**
 * iᵏ — an exact quarter turn. Phases in this game are always multiples of
 * 90°, so we never call cos/sin for gameplay. That matters for multiplayer:
 * `Math.sin` may differ in the last bit between browsers, but 1, i, -1, -i
 * are exact everywhere, so every client computes bit-identical states.
 */
export function quarterTurn(k: number): Complex {
  switch (((k % 4) + 4) % 4) {
    case 0: return ONE;
    case 1: return I;
    case 2: return c(-1, 0);
    default: return c(0, -1);
  }
}

/** Build a complex number from length and angle (only used for drawing). */
export const fromPolar = (r: number, theta: number): Complex =>
  c(r * Math.cos(theta), r * Math.sin(theta));

/** Round tiny float noise (e.g. 1e-17) to a clean 0 for display. */
const clean = (x: number, digits: number): number => {
  const f = 10 ** digits;
  const v = Math.round(x * f) / f;
  return Object.is(v, -0) ? 0 : v;
};

/** Human-friendly rendering such as `0.707`, `-0.5i`, `0.5 + 0.5i`. */
export function formatComplex(z: Complex, digits = 3): string {
  const re = clean(z.re, digits);
  const im = clean(z.im, digits);
  if (im === 0) return `${re}`;
  const imPart = `${Math.abs(im) === 1 ? '' : Math.abs(im)}i`;
  if (re === 0) return `${im < 0 ? '-' : ''}${imPart}`;
  return `${re} ${im < 0 ? '−' : '+'} ${imPart}`;
}

/** Phase in degrees, normalised to [0, 360). */
export function phaseDegrees(z: Complex): number {
  const d = (arg(z) * 180) / Math.PI;
  const r = Math.round(((d % 360) + 360) % 360);
  return r === 360 ? 0 : r;
}
