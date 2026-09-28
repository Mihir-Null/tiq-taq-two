/**
 * ai.worker.ts — runs the bot in a Web Worker (a background thread), so a
 * slow search never freezes the animations on the main thread.
 *
 * Messages in:  { id, kind: 'move', state, difficulty }  |  { id, kind: 'hints', state, count }
 * Messages out: { id, ok: true, move } | { id, ok: true, hints } | { id, ok: false, error }
 */

import { stateFromJSON } from '../engine/serialize.ts';
import { chooseMove } from './bot.ts';
import { computeHints } from './hints.ts';
import type { AiRequest, AiResponse } from './protocol.ts';

const post = (msg: AiResponse) => (self as unknown as Worker).postMessage(msg);

self.addEventListener('message', (e: MessageEvent<AiRequest>) => {
  const req = e.data;
  try {
    const state = stateFromJSON(req.state);
    if (req.kind === 'move') post({ id: req.id, ok: true, move: chooseMove(state, req.difficulty) });
    else post({ id: req.id, ok: true, hints: computeHints(state, req.count) });
  } catch (err) {
    post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
