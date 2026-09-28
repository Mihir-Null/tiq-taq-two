/**
 * rng.ts — deterministic randomness.
 *
 * Quantum measurements are random, but in an online game both players must
 * see the SAME random outcome. Instead of sending "the outcome was X" (which
 * the sender could fake), both clients derive the random numbers from a
 * shared seed that nobody controlled alone (see net/fair-seed.ts), plus the
 * move number. Same seed + same moves ⇒ same universe for everyone.
 *
 * xmur3 turns a string into 32-bit seeds; sfc32 is a small, fast, well-mixed
 * PRNG. Both use only 32-bit integer math (Math.imul, >>>), which behaves
 * identically in every JavaScript engine.
 */

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** A stream of uniform numbers in [0, 1) derived from a string key. */
export function seededRng(key: string): () => number {
  const h = xmur3(key);
  const rng = sfc32(h(), h(), h(), h());
  for (let i = 0; i < 12; i++) rng(); // warm up
  return rng;
}

/** The random stream used while resolving move number `ply` of a game. */
export const rngForPly = (seed: string, ply: number): (() => number) => seededRng(`${seed}#${ply}`);

/** For moves that must not roll dice: calling it is a bug, so it says so loudly. */
export const noDice = (): number => {
  throw new Error('This move was expected to roll no dice.');
};

/** A fresh random seed for local games (not security-sensitive). */
export function randomSeed(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
