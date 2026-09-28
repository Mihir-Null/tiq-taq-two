/**
 * SidePanels.tsx — the inspection tools: Multiverse, History and Physics.
 */

import { useEffect, useRef } from 'preact/hooks';
import {
  verdictOf, linesOf, LINES, boardString, moveSentence, moveNotation, eventSentence, phaseDegrees, abs,
  X, O, EMPTY, type Universe, type Complex, type QState, type Player,
} from '../../engine/index.ts';
import { settings } from '../../app/store.ts';
import type { GameController } from '../game/controller.ts';
import { MiniBoard } from './Board.tsx';
import { TokenMark } from './Panels.tsx';
import { Icon } from './Icon.tsx';
import { Term } from './Term.tsx';

const pct = (p: number) => (p > 0 && p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`);

/** Colour for a phase angle (hue wheel), used for amplitude arrows everywhere. */
export const phaseColor = (deg: number): string => `hsl(${deg} var(--phase-s) var(--phase-l))`;

export function PhaseDial({ amp, size = 18 }: { amp: Complex; size?: number }) {
  const deg = phaseDegrees(amp);
  const r = Math.min(1, abs(amp));
  const a = (deg * Math.PI) / 180;
  const len = 3 + 5 * Math.sqrt(r);
  return (
    <svg class="phase-dial" width={size} height={size} viewBox="-10 -10 20 20" data-tip={`Phase ${deg}° — the direction of this universe's arrow`}>
      <circle r="9" />
      <line x1="0" y1="0" x2={Math.cos(a) * len} y2={-Math.sin(a) * len} style={{ stroke: phaseColor(deg) }} />
    </svg>
  );
}

const winCells = (code: number): number[] => {
  const cells = new Set<number>();
  for (const p of [X, O] as Player[]) for (const l of linesOf(code, p)) for (const c of LINES[l]) cells.add(c);
  return [...cells];
};

// ─────────────────────────────── Multiverse ────────────────────────────────

function UniverseCard({
  ctrl, u, before, vanished = false, showPhase,
}: { ctrl: GameController; u: Universe; before: number | null; vanished?: boolean; showPhase: boolean }) {
  const v = verdictOf(u.code);
  const pinned = ctrl.pinned.value === u.code;
  let delta: string | null = null;
  if (before !== null && !vanished) {
    if (before < 1e-12) delta = 'new';
    else if (u.p > before + 0.005) delta = '↑';
    else if (u.p < before - 0.005) delta = '↓';
  }
  return (
    <button
      class={`uv-card ${vanished ? 'vanished' : ''} ${pinned ? 'pinned' : ''}`}
      onPointerEnter={() => !vanished && (ctrl.peek.value = u.code)}
      onPointerLeave={() => (ctrl.peek.value = null)}
      onFocus={() => !vanished && (ctrl.peek.value = u.code)}
      onBlur={() => (ctrl.peek.value = null)}
      onClick={() => !vanished && (ctrl.pinned.value = pinned ? null : u.code)}
      data-tip={vanished ? 'This universe disappears' : `Universe ${boardString(u.code)} · ${pct(u.p)} likely. Tap to show it on the board.`}
      aria-label={`Universe with probability ${pct(u.p)}`}
    >
      <MiniBoard code={u.code} size={58} highlight={winCells(u.code)} />
      <div class="uv-bar">
        <span style={{ width: `${Math.max(2, u.p * 100)}%` }} />
      </div>
      <div class="uv-meta">
        <span class="uv-p">{vanished ? '—' : pct(u.p)}</span>
        {showPhase && !vanished && <PhaseDial amp={u.amp} />}
        {delta && <span class={`uv-delta d-${delta === 'new' ? 'new' : delta === '↑' ? 'up' : 'down'}`}>{delta}</span>}
      </div>
      {v.leader !== null && (
        <span class={`uv-verdict ${v.leader === X ? 'vx' : v.leader === O ? 'vo' : 'vt'}`}>
          {v.leader === 0 ? 'tie' : `${v.leader === X ? 'X' : 'O'} line`}
        </span>
      )}
      {vanished && <span class="uv-verdict vgone">vanishes</span>}
    </button>
  );
}

export function Multiverse({ ctrl }: { ctrl: GameController }) {
  const display = ctrl.display.value;
  const pv = ctrl.viewPly.value === null && !ctrl.anim.value ? ctrl.preview.value : null;
  const q = pv ? pv.q : display.q;
  const list = q.byProbability();
  const vanished = pv ? display.q.byProbability().filter((u) => q.prob(u.code) < 1e-12) : [];
  const showPhase = settings.value.physicsView || display.rules.level >= 3;
  const MAX = 24;
  const rest = list.slice(MAX);
  const restP = rest.reduce((s, u) => s + u.p, 0);
  return (
    <div class="multiverse">
      <div class="mv-head">
        <div>
          <strong>
            {list.length} {list.length === 1 ? 'universe' : 'universes'}
          </strong>
          {pv && <span class="badge">after this move</span>}
        </div>
        <p class="muted small">
          Each card is one ordinary board the game could turn out to be. Every move acts on all of them at once; a{' '}
          <Term k="collapse" /> makes one real. Hover a card to see it on the board.
        </p>
      </div>
      <div class="mv-grid">
        {list.slice(0, MAX).map((u) => (
          <UniverseCard key={u.code} ctrl={ctrl} u={u} before={pv ? display.q.prob(u.code) : null} showPhase={showPhase} />
        ))}
        {vanished.slice(0, 8).map((u) => (
          <UniverseCard key={`gone${u.code}`} ctrl={ctrl} u={u} before={null} vanished showPhase={false} />
        ))}
      </div>
      {rest.length > 0 && (
        <p class="muted small">
          …and {rest.length} more universes ({pct(restP)} together).
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────── History ───────────────────────────────────

export function HistoryPanel({ ctrl }: { ctrl: GameController }) {
  const snaps = ctrl.snapshots.value;
  const view = ctrl.viewPly.value;
  const last = snaps.length - 1;
  const active = view ?? last;
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (view === null && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [snaps.length, view]);
  return (
    <div class="history">
      <div class="hist-controls">
        <button class="icon-btn" onClick={() => ctrl.setViewPly(0)} disabled={active === 0} data-tip="Start position" aria-label="Start position">
          <Icon name="chevronLeft" size={16} />
          <Icon name="chevronLeft" size={16} />
        </button>
        <button class="icon-btn" onClick={() => ctrl.step(-1)} disabled={active === 0} data-tip="One move back  [←]" aria-label="Back">
          <Icon name="chevronLeft" size={18} />
        </button>
        <span class="hist-pos">
          {active === last ? 'Live' : `Move ${active} / ${last}`}
        </span>
        <button class="icon-btn" onClick={() => ctrl.step(1)} disabled={view === null} data-tip="One move forward  [→]" aria-label="Forward">
          <Icon name="chevronRight" size={18} />
        </button>
        <button class={`btn small ${view === null ? 'ghost' : 'primary'}`} onClick={() => ctrl.setViewPly(null)} disabled={view === null}>
          Live
        </button>
      </div>
      <ol class="hist-list" ref={list}>
        <li class={`hist-item ${active === 0 ? 'on' : ''}`} onClick={() => ctrl.setViewPly(0)}>
          <span class="hist-n">0</span> <span class="muted">Empty board</span>
        </li>
        {snaps.slice(1).map((sn, k) => {
          const i = k + 1;
          return (
            <li key={i} class={`hist-item ${active === i ? 'on' : ''}`} onClick={() => ctrl.setViewPly(i)}>
              <span class="hist-n">{i}</span>
              {sn.mover && <TokenMark p={sn.mover} size={16} />}
              <span class="hist-text">
                {sn.move && sn.mover ? moveSentence(sn.move, sn.mover) : ''}
                {sn.move && <code class="notation">{moveNotation(sn.move)}</code>}
                {sn.events.map((e, j) => (
                  <span key={j} class={`hist-ev ev-${e.type}`}>
                    <Icon name={e.type === 'measure' ? 'observe' : e.type === 'collapse' ? 'dice' : 'flag'} size={13} /> {eventSentence(e)}
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─────────────────────────────── Physics ───────────────────────────────────

/** Pretty amplitude: recognises 1, 1/√2, ½, 1/(2√2)… times 1, i, −1, −i. */
export function prettyAmp(a: Complex): string {
  const m = abs(a);
  const deg = phaseDegrees(a);
  let mag: string | null = null;
  for (let k = 0; k <= 12; k++) {
    if (Math.abs(m - 2 ** (-k / 2)) < 1e-9) {
      const whole = 2 ** Math.floor(k / 2);
      mag = k === 0 ? '1' : k % 2 === 0 ? `1/${whole}` : whole === 1 ? '1/√2' : `1/(${whole}√2)`;
      break;
    }
  }
  if (mag !== null && deg % 90 === 0) {
    const pre = deg === 0 ? '' : deg === 90 ? 'i' : deg === 180 ? '−' : '−i';
    if (mag === '1') return deg === 0 ? '1' : deg === 90 ? 'i' : deg === 180 ? '−1' : '−i';
    if (pre === 'i' || pre === '−i') return `${pre}·${mag}`;
    return `${pre}${mag}`;
  }
  const re = Math.round(a.re * 1000) / 1000;
  const im = Math.round(a.im * 1000) / 1000;
  if (Math.abs(im) < 1e-9) return `${re}`;
  if (Math.abs(re) < 1e-9) return `${im}i`;
  return `(${re} ${im < 0 ? '−' : '+'} ${Math.abs(im)}i)`;
}

const ketString = (code: number): string => {
  const s = boardString(code);
  return `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6, 9)}`;
};

function PhasorPlot({ ctrl, q }: { ctrl: GameController; q: QState }) {
  const us = q.byProbability().slice(0, 32);
  const R = 70;
  return (
    <svg class="phasor" viewBox="-90 -90 180 180" width="100%" role="img" aria-label="Amplitudes as arrows">
      <circle class="unit" r={R} />
      <circle class="unit half" r={R * Math.SQRT1_2} />
      <line class="axis" x1="-86" y1="0" x2="86" y2="0" />
      <line class="axis" x1="0" y1="-86" x2="0" y2="86" />
      <text class="axis-label" x="84" y="-4" text-anchor="end">+1</text>
      <text class="axis-label" x="4" y="-78">+i</text>
      {us.map((u) => {
        const deg = phaseDegrees(u.amp);
        return (
          <g key={u.code} onPointerEnter={() => (ctrl.peek.value = u.code)} onPointerLeave={() => (ctrl.peek.value = null)}>
            <line class="phasor-arrow" x1="0" y1="0" x2={u.amp.re * R} y2={-u.amp.im * R} style={{ stroke: phaseColor(deg) }} />
            <circle class="phasor-tip" cx={u.amp.re * R} cy={-u.amp.im * R} r="3.2" style={{ fill: phaseColor(deg) }}>
              <title>{`${ketString(u.code)}  ${prettyAmp(u.amp)}  (${pct(u.p)})`}</title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}

export function PhysicsPanel({ ctrl }: { ctrl: GameController }) {
  const display = ctrl.display.value;
  const pv = ctrl.viewPly.value === null && !ctrl.anim.value ? ctrl.preview.value : null;
  const q = pv ? pv.q : display.q;
  const us = q.byProbability();
  const dists = q.cellDists();
  return (
    <div class="physics">
      <h4>
        The state vector {pv && <span class="badge">after this move</span>}
      </h4>
      <p class="muted small">
        Each square is a <Term k="qutrit" /> (empty, X or O), so the board lives in a space of 3⁹ = 19 683 possible boards.
        Only {us.length} {us.length === 1 ? 'has' : 'have'} a non-zero <Term k="amplitude" />:
      </p>
      <div class="ket-list">
        <span class="psi">|ψ⟩ =</span>
        {us.slice(0, 16).map((u, i) => (
          <div class="ket-row" key={u.code} onPointerEnter={() => (ctrl.peek.value = u.code)} onPointerLeave={() => (ctrl.peek.value = null)}>
            <span class="ket-sign">{i === 0 ? '' : '+'}</span>
            <span class="ket-amp">{prettyAmp(u.amp)}</span>
            <span class="ket">|{ketString(u.code)}⟩</span>
            <PhaseDial amp={u.amp} size={16} />
            <span class="ket-p">{pct(u.p)}</span>
          </div>
        ))}
        {us.length > 16 && <div class="muted small">+ {us.length - 16} more terms</div>}
      </div>
      <h4>Amplitudes as arrows</h4>
      <p class="muted small">
        Arrow length² = probability, direction = <Term k="phase" />. The inner circle is length 1/√2 (50%).
      </p>
      <PhasorPlot ctrl={ctrl} q={q} />
      <h4>Each square on its own</h4>
      <table class="qutrit-table">
        <thead>
          <tr>
            <th>Square</th>
            <th>empty</th>
            <th class="tx">X</th>
            <th class="to">O</th>
          </tr>
        </thead>
        <tbody>
          {dists.map((d, i) => (
            <tr key={i} class={Math.max(...d) < 0.999 ? 'uncertain' : ''} onPointerEnter={() => (ctrl.hover.value = null)}>
              <td>{i + 1}</td>
              <td>{pct(d[EMPTY])}</td>
              <td class="tx">{pct(d[X])}</td>
              <td class="to">{pct(d[O])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted small">
        Note: these per-square numbers lose the correlations between squares — that's why the full state vector above
        is needed. Entangled squares can't be described one at a time.
      </p>
    </div>
  );
}

