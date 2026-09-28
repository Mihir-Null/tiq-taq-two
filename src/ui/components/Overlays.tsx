/**
 * Overlays.tsx — the dramatic moments: measurements, collapses, results.
 *
 * Both animations show HONESTLY how the random outcome is picked:
 *   • Observe: the outcomes sit side by side on a bar, each as wide as its
 *     probability; a pointer sweeps to the random number r.
 *   • Collapse: every universe gets a slice of a wheel as wide as its
 *     probability; the wheel spins and stops with r under the pointer.
 * That is exactly what the engine does (see QState.measureCell/measureAll).
 */

import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  verdictOf, squareName, X, O, EMPTY, playerChar, type Cell, type GameResult,
} from '../../engine/index.ts';
import { animScale } from '../../app/store.ts';
import { sfx } from '../../audio/sfx.ts';
import type { Anim, GameController } from '../game/controller.ts';
import { MiniBoard } from './Board.tsx';
import { Icon } from './Icon.tsx';
import { Term } from './Term.tsx';

const pct = (p: number) => `${Math.round(p * 100)}%`;

function useTimeline(steps: number[], key: number, onStep: (i: number) => void): void {
  useEffect(() => {
    const scale = animScale.value;
    let t = 0;
    const timers = steps.map((ms, i) => {
      t += ms * scale;
      return setTimeout(() => onStep(i), t);
    });
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

// ─────────────────────────────── Observe ───────────────────────────────────

function MeasureOverlay({ ctrl, anim }: { ctrl: GameController; anim: Extract<Anim, { kind: 'measure' }> }) {
  const e = anim.event;
  const dist = e.before.cellDist(e.cell);
  const [stage, setStage] = useState(0); // 0 intro, 1 sweep, 2 reveal
  useTimeline([450, 1300, 1500], anim.id, (i) => {
    if (i === 0) setStage(1);
    if (i === 1) {
      setStage(2);
      sfx.land();
    }
    if (i === 2) ctrl.finishAnim(anim.id);
  });
  const segs = ([EMPTY, X, O] as Cell[]).filter((v) => dist[v] > 1e-12);
  const name = (v: Cell) => (v === EMPTY ? 'empty' : v === X ? 'X' : 'O');
  return (
    <div class="overlay measure-overlay" role="dialog" aria-label="Observation">
      <div class="overlay-card">
        <div class="overlay-kicker">
          <Icon name="observe" size={16} /> {anim.mover ? `${playerChar(anim.mover)} observes` : 'Observing'} square {squareName(e.cell)}
        </div>
        <div class="born-bar" style={{ '--dur': `${1300 * animScale.value}ms` } as Record<string, string>}>
          {segs.map((v) => (
            <div key={v} class={`born-seg seg-${name(v)} ${stage === 2 && v === e.outcome ? 'chosen' : ''} ${stage === 2 && v !== e.outcome ? 'dropped' : ''}`} style={{ flexGrow: dist[v] }}>
              <span>
                {name(v)} {pct(dist[v])}
              </span>
            </div>
          ))}
          <div class="born-pointer" style={{ left: stage >= 1 ? `${e.r * 100}%` : '0%' }} />
        </div>
        <p class="overlay-note small muted">
          Random number r = {e.r.toFixed(3)} lands in one slice — each slice is as wide as its <Term k="probability" />.
        </p>
        {stage === 2 && (
          <p class="overlay-result">
            It's <strong class={`is-${name(e.outcome)}`}>{name(e.outcome)}</strong>! Universes that disagreed vanish.
          </p>
        )}
        <button class="btn ghost small" onClick={() => ctrl.finishAnim(anim.id)}>
          Skip
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────── Collapse ──────────────────────────────────

const WHY_LONG: Record<string, string> = {
  crowded: 'No square is empty in every universe, so nobody could place a token. Reality has to pick one universe.',
  full: 'Every square is filled in every universe. Time to find out which universe is real!',
  decided: 'Every universe already contains a finished line — but they disagree about the winner. Reality picks one.',
};

function slicePath(a0: number, a1: number, r: number): string {
  if (a1 - a0 >= 359.999) return `M0,${-r} A${r},${r} 0 1,1 0,${r} A${r},${r} 0 1,1 0,${-r} Z`;
  const p = (deg: number) => {
    const t = (deg * Math.PI) / 180;
    return `${(Math.sin(t) * r).toFixed(2)},${(-Math.cos(t) * r).toFixed(2)}`;
  };
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M0,0 L${p(a0)} A${r},${r} 0 ${large},1 ${p(a1)} Z`;
}

function CollapseOverlay({ ctrl, anim }: { ctrl: GameController; anim: Extract<Anim, { kind: 'collapse' }> }) {
  const e = anim.event;
  const us = e.before.universes(); // canonical order = the order the engine lays out slices
  const [stage, setStage] = useState(0); // 0 intro, 1 spinning, 2 landed
  const turns = 3;
  const spin = 360 * turns + 360 - e.r * 360; // put the point r·360° under the top pointer
  useTimeline([700, 2700, 2000], anim.id, (i) => {
    if (i === 0) {
      setStage(1);
      for (let k = 0; k < 9; k++) setTimeout(() => sfx.tick(), 120 * k * k * 0.3 * animScale.value);
    }
    if (i === 1) {
      setStage(2);
      sfx.land();
    }
    if (i === 2) ctrl.finishAnim(anim.id);
  });

  const R = 100;
  let cum = 0;
  const slices = us.map((u) => {
    const a0 = cum * 360;
    cum += u.p;
    const a1 = cum * 360;
    const v = verdictOf(u.code);
    const cls = v.leader === X ? 'sl-x' : v.leader === O ? 'sl-o' : v.leader === 0 ? 'sl-t' : 'sl-n';
    const mid = ((a0 + a1) / 2) * (Math.PI / 180);
    const big = a1 - a0 > 34;
    return { u, a0, a1, cls, mid, big };
  });
  const chosenIdx = us.findIndex((u) => u.code === e.code);

  return (
    <div class="overlay collapse-overlay" role="dialog" aria-label="Collapse">
      <div class="overlay-card wide">
        <div class="overlay-kicker">
          <Icon name="dice" size={16} /> <Term k="collapse">Collapse!</Term>
        </div>
        <p class="small muted">{WHY_LONG[e.reason]}</p>
        <div class="wheel-wrap">
          <div class="wheel-pointer" aria-hidden="true" />
          <svg class="wheel" viewBox="-110 -110 220 220" width="230" height="230">
            <g
              class="wheel-rot"
              style={{
                transform: `rotate(${stage >= 1 ? spin : 0}deg)`,
                transitionDuration: `${2700 * animScale.value}ms`,
              }}
            >
              {slices.map((s, i) => (
                <g key={s.u.code} class={`slice ${s.cls} ${stage === 2 ? (i === chosenIdx ? 'chosen' : 'dim') : ''}`}>
                  <path d={slicePath(s.a0, s.a1, R)} />
                  {s.big && (
                    <g transform={`translate(${Math.sin(s.mid) * R * 0.58} ${-Math.cos(s.mid) * R * 0.58}) scale(0.34) translate(-45 -45)`}>
                      <MiniInline code={s.u.code} />
                    </g>
                  )}
                </g>
              ))}
            </g>
            <circle class="wheel-hub" r="12" />
          </svg>
          <div class="wheel-legend small">
            <span class="lg sl-x">X leads</span>
            <span class="lg sl-o">O leads</span>
            <span class="lg sl-t">tie</span>
            <span class="lg sl-n">no line</span>
          </div>
        </div>
        <p class="overlay-note small muted">
          {us.length} universes, each slice as wide as its probability. Random number r = {e.r.toFixed(3)}.
        </p>
        {stage === 2 && (
          <div class="overlay-result row">
            <MiniBoard code={e.code} size={64} />
            <div>
              This universe is now the only one. It had a <strong>{pct(e.p)}</strong> chance.
              <div class="small muted">{verdictText(e.code)}</div>
            </div>
          </div>
        )}
        <button class="btn ghost small" onClick={() => ctrl.finishAnim(anim.id)}>
          Skip
        </button>
      </div>
    </div>
  );
}

function verdictText(code: number): string {
  const v = verdictOf(code);
  if (v.leader === null) return 'Nobody has a line in it — play continues.';
  if (v.leader === 0) return `Both have ${v.xLines} line${v.xLines > 1 ? 's' : ''} — a tie.`;
  return `${v.leader === X ? 'X' : 'O'} has more lines (${v.xLines} : ${v.oLines}).`;
}

/** A classical board drawn directly as SVG children (for inside the wheel). */
function MiniInline({ code }: { code: number }) {
  return (
    <g class="mini-inline">
      <rect width="90" height="90" rx="12" class="mini-bg" />
      <path class="mini-grid" d="M30,6 V84 M60,6 V84 M6,30 H84 M6,60 H84" />
      {Array.from({ length: 9 }, (_, i) => {
        const v = Math.floor(code / 3 ** i) % 3;
        const x = (i % 3) * 30 + 15;
        const y = Math.floor(i / 3) * 30 + 15;
        if (v === X) return <path key={i} class="mini-x" d={`M${x - 8},${y - 8} L${x + 8},${y + 8} M${x + 8},${y - 8} L${x - 8},${y + 8}`} />;
        if (v === O) return <circle key={i} class="mini-o" cx={x} cy={y} r="8.5" />;
        return null;
      })}
    </g>
  );
}

export function AnimOverlay({ ctrl }: { ctrl: GameController }) {
  const a = ctrl.anim.value;
  if (!a || ctrl.viewPly.value !== null) return null;
  return a.kind === 'measure' ? <MeasureOverlay key={a.id} ctrl={ctrl} anim={a} /> : <CollapseOverlay key={a.id} ctrl={ctrl} anim={a} />;
}

// ─────────────────────────────── Result ────────────────────────────────────

export function describeResult(r: GameResult): string {
  switch (r.reason) {
    case 'line':
      return r.code === null
        ? 'Every universe agreed on the winner — no dice were needed.'
        : 'Three in a row.';
    case 'decided':
      return 'Every universe had a finished line; the collapse chose one of them.';
    case 'full':
      return r.certain ? 'The board filled up.' : 'The board filled up and collapsed — the surviving universe decided it.';
    case 'resign':
      return 'The opponent resigned.';
    case 'abandon':
      return 'The opponent left the game.';
  }
}

export function ResultBanner({ ctrl, children }: { ctrl: GameController; children?: ComponentChildren }) {
  const r = ctrl.live.value.result;
  const idle = !ctrl.anim.value;
  const seats = ctrl.seats.value;
  const soloLocal = seats[X].local !== seats[O].local ? (seats[X].local ? X : O) : null;
  useEffect(() => {
    if (!r || !idle) return;
    if (r.winner === null) sfx.draw();
    else if (soloLocal === null || r.winner === soloLocal) sfx.win();
    else sfx.lose();
  }, [r, idle]);
  if (!r || !idle) return null;
  const title =
    r.winner === null ? 'Draw' : soloLocal !== null && r.winner === soloLocal ? 'You win!' : `${seats[r.winner].name} wins!`;
  const lines = r.xLines + r.oLines > 0 ? `Lines: X ${r.xLines} · O ${r.oLines}` : '';
  return (
    <div class={`result-banner ${r.winner === X ? 'res-x' : r.winner === O ? 'res-o' : 'res-draw'}`} role="status">
      <div class="result-title">
        <Icon name={r.winner === null ? 'flag' : 'crown'} size={22} /> {title}
      </div>
      <div class="result-sub">{describeResult(r)}</div>
      {lines && <div class="result-lines small">{lines}</div>}
      <div class="result-actions">{children}</div>
    </div>
  );
}
