/**
 * client.ts — promise-based access to the bot.
 *
 *   const move  = await ai.move(state, 'hard');
 *   const hints = await ai.hints(state, 3);
 *
 * Uses a Web Worker when available. `?worker&inline` asks Vite to embed the
 * worker's code in the main bundle (as a Blob URL), which keeps the
 * single-file build self-contained. Without Worker support (tests, very old
 * browsers) it falls back to running on the main thread.
 */

import AiWorker from './ai.worker.ts?worker&inline';
import { stateToJSON, stateFromJSON, type GameState, type Move } from '../engine/index.ts';
import type { AiRequest, AiResponse } from './protocol.ts';
import type { Difficulty } from './search.ts';
import type { Hint } from './hints.ts';

type Pending = { req: AiRequest; resolve: (r: AiResponse) => void };
/** `Omit` that works member-by-member on a union type. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Run a request right here on the main thread (fallback when workers are unavailable). */
async function runHere(req: AiRequest): Promise<AiResponse> {
  const [{ chooseMove }, { computeHints }] = await Promise.all([import('./bot.ts'), import('./hints.ts')]);
  const state = stateFromJSON(req.state);
  try {
    return req.kind === 'move'
      ? { id: req.id, ok: true, move: chooseMove(state, req.difficulty) }
      : { id: req.id, ok: true, hints: computeHints(state, req.count) };
  } catch (err) {
    return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

class AiClient {
  #worker: Worker | null = null;
  #broken = false;
  #nextId = 1;
  #pending = new Map<number, Pending>();

  #ensureWorker(): Worker | null {
    if (this.#worker || this.#broken) return this.#worker;
    if (typeof Worker === 'undefined') {
      this.#broken = true;
      return null;
    }
    try {
      const w = new AiWorker();
      w.addEventListener('message', (e: MessageEvent<AiResponse>) => {
        const p = this.#pending.get(e.data.id);
        if (p) {
          this.#pending.delete(e.data.id);
          p.resolve(e.data);
        }
      });
      // If the worker can't load (e.g. a strict Content-Security-Policy), finish
      // everything that was waiting on the main thread instead.
      w.addEventListener('error', (e) => {
        console.warn('bot worker failed; using the main thread instead', e);
        this.#broken = true;
        this.#worker = null;
        const waiting = [...this.#pending.values()];
        this.#pending.clear();
        for (const p of waiting) void runHere(p.req).then(p.resolve);
      });
      this.#worker = w;
    } catch (err) {
      console.warn('cannot start bot worker', err);
      this.#broken = true;
      this.#worker = null;
    }
    return this.#worker;
  }

  async #request(req: DistributiveOmit<AiRequest, 'id'>): Promise<AiResponse> {
    const full = { ...req, id: this.#nextId++ } as AiRequest;
    const w = this.#ensureWorker();
    if (!w) return runHere(full);
    return new Promise((resolve) => {
      this.#pending.set(full.id, { req: full, resolve });
      w.postMessage(full);
    });
  }

  async move(state: GameState, difficulty: Difficulty): Promise<Move> {
    const res = await this.#request({ kind: 'move', state: stateToJSON(state), difficulty });
    if (!res.ok) throw new Error(res.error);
    if (!('move' in res)) throw new Error('unexpected bot reply');
    return res.move;
  }

  async hints(state: GameState, count = 3): Promise<Hint[]> {
    const res = await this.#request({ kind: 'hints', state: stateToJSON(state), count });
    if (!res.ok) throw new Error(res.error);
    if (!('hints' in res)) throw new Error('unexpected bot reply');
    return res.hints;
  }
}

export const ai = new AiClient();
