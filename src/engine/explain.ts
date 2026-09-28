/**
 * explain.ts — plain-language descriptions of what a move WOULD do.
 *
 * The preview card shows these while you hover or select a move, so that a
 * player who has never heard the word "amplitude" can still predict the
 * consequences of a quantum move.
 */

import { EMPTY, X, O, other, playerChar, squareName, type Player } from './board.ts';
import type { GameState, MovePreview } from './rules.ts';
import { forecast, meetingsFromTrace } from './analysis.ts';
import { knobDegrees } from './notation.ts';

export interface Explanation {
  headline: string;
  details: string[];
  /** Things that will happen automatically afterwards (collapses, the game ending). */
  warnings: string[];
  /** Whether this looks good / bad for the mover (colours the card). */
  tone: 'good' | 'bad' | 'neutral';
}

const pct = (p: number): string => `${Math.round(p * 100)}%`;
const tokenWord = (p: Player): string => playerChar(p);

export function explainPreview(s: GameState, pv: MovePreview): Explanation {
  const me = s.toMove;
  const them = other(me);
  const m = pv.move;
  const before = s.q;
  const after = pv.q;
  const details: string[] = [];
  const warnings: string[] = [];
  let headline = '';

  const nBefore = before.size;
  const nAfter = after.size;
  const multiverse = () => {
    if (nAfter !== nBefore) {
      details.push(`The multiverse goes from ${nBefore} to ${nAfter} universe${nAfter === 1 ? '' : 's'}.`);
    }
  };

  switch (m.kind) {
    case 'place':
      headline = `Your ${tokenWord(me)} lands on ${squareName(m.cell)} in every universe.`;
      break;

    case 'split': {
      const pa = after.cellDist(m.a)[me];
      const pb = after.cellDist(m.b)[me];
      headline = `Your ${tokenWord(me)} goes into superposition: ${pct(pa)} on ${squareName(m.a)}, ${pct(pb)} on ${squareName(m.b)}.`;
      details.push(`It is not secretly in one of them — every universe is doubled: one copy with the ${tokenWord(me)} on each square.`);
      multiverse();
      break;
    }

    case 'link': {
      const db = before.cellDist(m.b);
      headline = `Your ${tokenWord(me)} on ${squareName(m.a)} gets entangled with ${squareName(m.b)}.`;
      if (db[them] > 0.999) {
        details.push(`Either both stay put, or they trade places — 50/50. Seeing one square instantly tells you the other.`);
      } else {
        details.push(`Where ${squareName(m.b)} holds ${tokenWord(them)} (${pct(db[them])} of universes), the two tokens may trade places.`);
        if (db[EMPTY] > 1e-9) details.push(`Where ${squareName(m.b)} is empty (${pct(db[EMPTY])}), your ${tokenWord(me)} just spreads over both squares.`);
        if (db[me] > 1e-9) details.push(`Where ${squareName(m.b)} already holds your ${tokenWord(me)} (${pct(db[me])}), nothing moves.`);
      }
      multiverse();
      break;
    }

    case 'observe': {
      const d = before.cellDist(m.cell);
      const parts = [
        d[EMPTY] > 1e-9 ? `empty ${pct(d[EMPTY])}` : '',
        d[X] > 1e-9 ? `X ${pct(d[X])}` : '',
        d[O] > 1e-9 ? `O ${pct(d[O])}` : '',
      ].filter(Boolean);
      headline = `You look at ${squareName(m.cell)}: ${parts.join(' · ')}.`;
      details.push('Universes that disagree with what you see vanish; the survivors grow to fill 100%.');
      details.push('Squares entangled with it may snap into place too. Costs ⚡1 and uses your turn.');
      break;
    }

    case 'merge': {
      headline = `Squares ${squareName(m.a)} and ${squareName(m.b)} half-swap with the knob at ${knobDegrees(m.turns)}°.`;
      const meetings = meetingsFromTrace(after, pv.trace);
      const cancelled = meetings.filter((x) => x.actual < x.naive * 0.02).length;
      const boosted = meetings.filter((x) => x.actual > x.naive * 1.5).length;
      if (cancelled || boosted) {
        const bits: string[] = [];
        if (cancelled) bits.push(`${cancelled} outcome${cancelled > 1 ? 's' : ''} cancel out`);
        if (boosted) bits.push(`${boosted} reinforce${boosted > 1 ? '' : 's'}`);
        details.push(`Universes meet and interfere: ${bits.join(', ')}.`);
      } else {
        details.push('No universes meet here, so nothing interferes — the squares just half-swap.');
      }
      for (const cell of [m.a, m.b]) {
        const b0 = before.cellDist(cell);
        const a0 = after.cellDist(cell);
        const describe = (d: readonly number[]) =>
          [d[X] > 1e-9 ? `X ${pct(d[X])}` : '', d[O] > 1e-9 ? `O ${pct(d[O])}` : '', d[EMPTY] > 1e-9 ? `empty ${pct(d[EMPTY])}` : '']
            .filter(Boolean).join(', ');
        if (Math.abs(b0[X] - a0[X]) + Math.abs(b0[O] - a0[O]) > 0.01) {
          details.push(`${squareName(cell)}: ${describe(b0)} → ${describe(a0)}.`);
        }
      }
      multiverse();
      break;
    }
  }

  // How does the move change the "if we looked right now" odds?
  let tone: Explanation['tone'] = 'neutral';
  const fb = forecast(before);
  const fa = forecast(after);
  const mine = (f: typeof fa) => (me === X ? f.xWin : f.oWin);
  const theirs = (f: typeof fa) => (me === X ? f.oWin : f.xWin);
  if (m.kind !== 'observe') {
    if (Math.abs(mine(fa) - mine(fb)) > 0.005) {
      details.push(`Universes where you lead on lines: ${pct(mine(fb))} → ${pct(mine(fa))}.`);
      tone = mine(fa) > mine(fb) ? 'good' : 'bad';
    }
    if (Math.abs(theirs(fa) - theirs(fb)) > 0.005) {
      details.push(`Universes where ${tokenWord(them)} leads on lines: ${pct(theirs(fb))} → ${pct(theirs(fa))}.`);
      if (theirs(fa) < theirs(fb) && tone !== 'bad') tone = 'good';
      if (theirs(fa) > theirs(fb)) tone = 'bad';
    }
  }

  switch (pv.pending.kind) {
    case 'certain-end':
      warnings.push(
        pv.pending.winner === null
          ? 'Every universe ends tied — the game is a draw.'
          : pv.pending.winner === me
            ? 'You win in EVERY universe — no dice needed!'
            : `${tokenWord(them)} wins in every universe.`,
      );
      tone = pv.pending.winner === me ? 'good' : pv.pending.winner === null ? 'neutral' : 'bad';
      break;
    case 'collapse':
      warnings.push(
        pv.pending.reason === 'decided'
          ? 'Every universe will contain a finished line → the board collapses and one universe decides the game.'
          : pv.pending.reason === 'full'
            ? 'The board will be full → it collapses into one universe and the game is scored.'
            : 'No square will be empty in every universe → the board collapses before the next turn.',
      );
      break;
    case 'none':
      break;
  }
  if (m.kind === 'observe' && pv.observeOutcomes) {
    for (const o of pv.observeOutcomes) {
      const f = forecast(o.q);
      if (f.xWin + f.oWin + f.tie > 0.999) {
        warnings.push(`If it shows ${o.outcome === EMPTY ? 'empty' : o.outcome === X ? 'X' : 'O'}, the game is decided.`);
      }
    }
  }

  return { headline, details, warnings, tone };
}
