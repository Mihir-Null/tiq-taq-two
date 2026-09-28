/**
 * fair-seed.ts — agreeing on dice with someone you don't trust.
 *
 * Online, both players must see the same random collapses, so the random
 * numbers come from a shared seed. But who picks the seed? If the host did,
 * it could try seeds offline until it found one that favours it. Instead we
 * use a COMMIT–REVEAL coin flip:
 *
 *   1. Each player picks a secret random nonce and sends only its hash
 *      (the "commitment"). A hash reveals nothing about the nonce…
 *   2. …but once both commitments are in, nobody can change their nonce
 *      any more (finding another nonce with the same SHA-256 is infeasible).
 *   3. Both reveal their nonces; everyone checks them against the hashes.
 *   4. seed = nonceX + nonceO. Neither player alone controlled it.
 *
 * The worst a cheater can do is refuse to reveal — which everyone sees.
 */

import { sha256Hex } from './sha256.ts';

export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const commitmentOf = (nonce: string): string => sha256Hex(`tiq-taq-two:${nonce}`);

export const verifyReveal = (commitment: string, nonce: string): boolean =>
  typeof nonce === 'string' && nonce.length >= 16 && nonce.length <= 128 && commitmentOf(nonce) === commitment;

export const combineSeed = (nonceX: string, nonceO: string): string => sha256Hex(`${nonceX}|${nonceO}`);
