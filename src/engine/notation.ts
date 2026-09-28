/**
 * notation.ts — short names and full sentences for moves and events.
 *
 * Notation used in the history panel and chat:
 *     ⑤          place on ⑤
 *     ①~③        split between ① and ③
 *     ②⇄⑤        link: new token on ②, half-swapped with ⑤
 *     ◉⑤         observe ⑤
 *     ③⋈⑤@90°    merge ③ and ⑤ with the knob at 90°
 */

import { squareName, playerChar, boardString, cellChar, type Player } from './board.ts';
import type { GameEvent, GameResult, Move } from './rules.ts';

export const knobDegrees = (turns: number): number => ((((turns % 4) + 4) % 4) * 90);

export function moveNotation(m: Move): string {
  switch (m.kind) {
    case 'place': return squareName(m.cell);
    case 'split': return `${squareName(m.a)}~${squareName(m.b)}`;
    case 'link': return `${squareName(m.a)}⇄${squareName(m.b)}`;
    case 'observe': return `◉${squareName(m.cell)}`;
    case 'merge': return `${squareName(m.a)}⋈${squareName(m.b)}@${knobDegrees(m.turns)}°`;
  }
}

export function moveSentence(m: Move, p: Player): string {
  const who = playerChar(p);
  switch (m.kind) {
    case 'place': return `${who} places on ${squareName(m.cell)}`;
    case 'split': return `${who} splits across ${squareName(m.a)} and ${squareName(m.b)}`;
    case 'link': return `${who} links ${squareName(m.a)} with ${squareName(m.b)}`;
    case 'observe': return `${who} observes ${squareName(m.cell)}`;
    case 'merge': return `${who} merges ${squareName(m.a)} & ${squareName(m.b)} (knob ${knobDegrees(m.turns)}°)`;
  }
}

const pct = (p: number): string => `${Math.round(p * 100)}%`;

export const COLLAPSE_WHY = {
  crowded: 'No square was empty in every universe',
  full: 'The board was full',
  decided: 'Every universe had a finished line',
} as const;

export function eventSentence(e: GameEvent): string {
  switch (e.type) {
    case 'measure':
      return `Observed ${squareName(e.cell)}: ${cellChar(e.outcome) === '·' ? 'empty' : cellChar(e.outcome)} (had a ${pct(e.p)} chance)`;
    case 'collapse':
      return `Collapse — ${COLLAPSE_WHY[e.reason].toLowerCase()}. Universe ${boardString(e.code)} became real (${pct(e.p)}).`;
    case 'end':
      return resultSentence(e.result);
  }
}

export function resultSentence(r: GameResult): string {
  if (r.reason === 'resign') return `${r.winner ? playerChar(r.winner) : '?'} wins — opponent resigned.`;
  if (r.reason === 'abandon') return `${r.winner ? playerChar(r.winner) : '?'} wins — opponent left.`;
  const lines = r.xLines + r.oLines > 0 ? ` (lines X ${r.xLines} : ${r.oLines} O)` : '';
  if (r.winner === null) return `Draw${lines}.`;
  const how = r.certain ? (r.code === null ? ' in every universe' : '') : ' after the collapse';
  return `${playerChar(r.winner)} wins${how}${lines}.`;
}
