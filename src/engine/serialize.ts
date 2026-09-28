/**
 * serialize.ts — turning game states into plain JSON and back.
 *
 * Needed whenever a state crosses a boundary that only copies plain data:
 * posting it to the bot's Web Worker, saving a sandbox position, or sending
 * a snapshot over the network.
 */

import { QState } from './qstate.ts';
import { c } from './complex.ts';
import type { GameState, GameResult, RuleSet } from './rules.ts';
import type { Player } from './board.ts';

export interface GameStateJSON {
  rules: RuleSet;
  q: [number, number, number][];
  tokens: number;
  toMove: Player;
  quanta: [number, number];
  ply: number;
  result: GameResult | null;
}

export function stateToJSON(s: GameState): GameStateJSON {
  return {
    rules: s.rules,
    q: s.q.toJSON(),
    tokens: s.tokens,
    toMove: s.toMove,
    quanta: [s.quanta[0], s.quanta[1]],
    ply: s.ply,
    result: s.result,
  };
}

export function stateFromJSON(j: GameStateJSON): GameState {
  return {
    rules: j.rules,
    q: QState.from(j.q.map(([code, re, im]) => [code, c(re, im)] as const)),
    tokens: j.tokens,
    toMove: j.toMove,
    quanta: j.quanta,
    ply: j.ply,
    result: j.result,
  };
}
