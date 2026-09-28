/**
 * PreviewCard.tsx — "what will this move do?" in words and pictures.
 *
 * Shows step-by-step instructions while you pick squares, then the preview
 * explanation, and for special moves:
 *   • Observe: the odds of each outcome,
 *   • Merge:   the phase knob, the interference fringe (probability vs knob
 *              angle) and the arrows adding head-to-tail where universes meet.
 */

import { useMemo } from 'preact/hooks';
import {
  HALF_SWAP, knobGateAngle, squareName, X, O, EMPTY, MOVE_COST, quantaOf, abs,
  type MovePreview, type QState, type Player, type Contribution,
} from '../../engine/index.ts';
import type { GameController } from '../game/controller.ts';
import { Icon } from './Icon.tsx';
import { MiniBoard } from './Board.tsx';
import { TOOL_INFO } from './Panels.tsx';
import { Term } from './Term.tsx';

const pct = (p: number) => `${Math.round(p * 100)}%`;

function instructions(ctrl: GameController): string {
  const t = ctrl.tool.value;
  const n = ctrl.selection.value.length;
  switch (t) {
    case 'place':
      return 'Tap a square that is empty in every universe.';
    case 'split':
      return n === 0
        ? 'Tap the first square for your token (must be empty in every universe).'
        : 'Now tap a second empty square — your token will be in BOTH, 50/50. (Tap the first again to cancel.)';
    case 'link':
      return n === 0
        ? 'Tap an empty square for your new token.'
        : 'Now tap a square where your opponent might be — the two tokens get entangled.';
    case 'observe':
      return 'Tap an uncertain square (one with a ring) to force it to decide. Costs ⚡1.';
    case 'merge':
      return n === 0
        ? 'Tap the first square — the knob will twist the phase of whatever is there.'
        : n === 1
          ? 'Tap a second square to half-swap with. Try it on the two halves of a split token!'
          : 'Turn the knob and watch the probabilities move, then play the move.';
  }
}

export function PreviewCard({ ctrl }: { ctrl: GameController }) {
  const s = ctrl.live.value;
  if (s.result) return null;
  if (ctrl.viewPly.value !== null) {
    return (
      <div class="card preview-card">
        <p class="muted">You're viewing an earlier position.</p>
        <button class="btn" onClick={() => ctrl.setViewPly(null)}>
          <Icon name="skip" size={16} /> Back to live
        </button>
      </div>
    );
  }
  if (!ctrl.myTurn.value) {
    const seat = ctrl.seats.value[s.toMove];
    return (
      <div class="card preview-card waiting">
        <span class="dots" aria-hidden="true"><i /><i /><i /></span>
        <span>
          {seat.kind === 'bot' ? `${seat.name} is thinking…` : `Waiting for ${seat.name}…`}
        </span>
      </div>
    );
  }

  const t = ctrl.tool.value;
  const info = TOOL_INFO[t];
  const pv = ctrl.preview.value;
  const ex = ctrl.explanation.value;
  const err = ctrl.candidateError.value;
  const cost = MOVE_COST[t];
  const left = quantaOf(s, s.toMove);

  return (
    <div class={`card preview-card tone-${ex?.tone ?? 'neutral'}`} aria-live="polite">
      <div class="preview-head">
        <Icon name={info.icon} size={18} />
        <strong>{info.name}</strong>
        {info.concept !== 'classical' && (
          <span class="concept">
            <Term k={info.concept === 'measurement' ? 'measurement' : info.concept} />
          </span>
        )}
        {cost > 0 && (
          <span class="cost" data-tip="Quanta this move costs">
            <Icon name="bolt" size={12} />
            {cost} · {left} left
          </span>
        )}
      </div>

      {!pv && (
        <>
          <p class="instructions">{instructions(ctrl)}</p>
          {err && ctrl.candidate.value && <p class="why-not">{err}</p>}
        </>
      )}

      {pv && ex && (
        <>
          <p class="headline">{ex.headline}</p>
          {ex.details.length > 0 && (
            <ul class="details">
              {ex.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
          {pv.move.kind === 'observe' && pv.observeOutcomes && <ObserveOdds pv={pv} />}
          {pv.move.kind === 'merge' && <MergeLab ctrl={ctrl} pv={pv} />}
          {ex.warnings.map((w, i) => (
            <p key={i} class="warning">
              <Icon name="info" size={14} /> {w}
            </p>
          ))}
          <div class="preview-actions">
            {ctrl.readyToConfirm.value ? (
              <>
                <button class="btn primary" onClick={() => ctrl.confirm()}>
                  <Icon name="check" size={16} /> Play move <kbd>Enter</kbd>
                </button>
                <button class="btn ghost" onClick={() => ctrl.clearSelection()}>
                  Cancel <kbd>Esc</kbd>
                </button>
              </>
            ) : (
              <span class="muted small">Click to play this move.</span>
            )}
          </div>
        </>
      )}

      {pv === null && t === 'merge' && ctrl.selection.value.length === 2 && <Knob ctrl={ctrl} />}
    </div>
  );
}

// ───────────────────────────── Observe odds ────────────────────────────────

function ObserveOdds({ pv }: { pv: MovePreview }) {
  return (
    <div class="odds-list">
      {pv.observeOutcomes!.map((o) => (
        <div key={o.outcome} class={`odds-row ${o.outcome === X ? 'is-x' : o.outcome === O ? 'is-o' : 'is-e'}`}>
          <span class="odds-name">{o.outcome === EMPTY ? 'empty' : o.outcome === X ? 'X' : 'O'}</span>
          <span class="odds-track">
            <span class="odds-fill" style={{ width: pct(o.p) }} />
          </span>
          <span class="odds-p">{pct(o.p)}</span>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────── Merge lab ───────────────────────────────────

export function Knob({ ctrl }: { ctrl: GameController }) {
  const k = ctrl.knob.value;
  const angle = k * 90;
  return (
    <div class="knob-row">
      <button class="icon-btn" onClick={() => ctrl.setKnob(k - 1)} aria-label="Turn knob back" data-tip="Turn the knob back a quarter turn  [ [ ]">
        <Icon name="undo" size={18} />
      </button>
      <svg class="knob" viewBox="-54 -54 108 108" width="100" height="100" role="slider" aria-valuenow={angle} aria-valuemin={0} aria-valuemax={270} aria-label="Phase knob">
        <circle class="knob-face" r="34" />
        {[0, 1, 2, 3].map((q) => {
          const a = (q * Math.PI) / 2;
          const x = Math.sin(a) * 44;
          const y = -Math.cos(a) * 44;
          return (
            <g key={q} class={`knob-tick ${q === k ? 'on' : ''}`} onClick={() => ctrl.setKnob(q)}>
              <circle cx={x} cy={y} r="9.5" />
              <text x={x} y={y + 3.3} text-anchor="middle">{q * 90}</text>
            </g>
          );
        })}
        <g style={{ transform: `rotate(${angle}deg)` }} class="knob-hand">
          <line x1="0" y1="0" x2="0" y2="-28" />
          <circle r="5" />
        </g>
      </svg>
      <button class="icon-btn" onClick={() => ctrl.setKnob(k + 1)} aria-label="Turn knob forward" data-tip="Turn the knob forward a quarter turn  [ ] ]">
        <Icon name="redo" size={18} />
      </button>
      <div class="knob-label">
        Knob <strong>{angle}°</strong>
        <div class="muted small">
          Twists the <Term k="phase" /> of {squareName(ctrl.selection.value[0] ?? 0)}
        </div>
      </div>
    </div>
  );
}

function MergeLab({ ctrl, pv }: { ctrl: GameController; pv: MovePreview }) {
  const m = pv.move as Extract<MovePreview['move'], { kind: 'merge' }>;
  const before = ctrl.live.value.q;
  return (
    <div class="merge-lab">
      <Knob ctrl={ctrl} />
      <FringeChart q={before} a={m.a} b={m.b} turns={m.turns} />
      <ArrowSums pv={pv} />
    </div>
  );
}

/**
 * The interference fringe: probability of a token landing on each of the two
 * squares as the knob sweeps a full turn. Dots mark the four real settings.
 */
function FringeChart({ q, a, b, turns }: { q: QState; a: number; b: number; turns: number }) {
  const data = useMemo(() => {
    const N = 72;
    const series: Record<Player, { pa: number[]; pb: number[] }> = { [X]: { pa: [], pb: [] }, [O]: { pa: [], pb: [] } };
    for (let k = 0; k <= N; k++) {
      const th = (k / N) * 2 * Math.PI;
      const r = q.applyOne(a, knobGateAngle(th)).applyTwo(a, b, HALF_SWAP);
      for (const t of [X, O] as Player[]) {
        series[t].pa.push(r.cellDist(a)[t]);
        series[t].pb.push(r.cellDist(b)[t]);
      }
    }
    const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    const main: Player = range(series[X].pa) >= range(series[O].pa) ? X : O;
    return { N, main, pa: series[main].pa, pb: series[main].pb, flat: range(series[main].pa) < 0.01 };
  }, [q, a, b]);

  const W = 240, H = 92, L = 26, B = 16, T = 8;
  const xAt = (k: number) => L + (k / data.N) * (W - L - 6);
  const yAt = (p: number) => T + (1 - p) * (H - T - B);
  const path = (ys: number[]) => ys.map((p, k) => `${k ? 'L' : 'M'}${xAt(k).toFixed(1)},${yAt(p).toFixed(1)}`).join(' ');
  const tokenName = data.main === X ? 'X' : 'O';
  if (data.flat) {
    return <p class="muted small">No interference here — the knob wouldn't change the odds for these squares.</p>;
  }
  return (
    <figure class="fringe">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Interference fringe">
        <line class="axis" x1={L} y1={yAt(0)} x2={W - 6} y2={yAt(0)} />
        <line class="axis" x1={L} y1={yAt(1)} x2={W - 6} y2={yAt(1)} />
        <text class="axis-label" x={L - 4} y={yAt(1) + 3} text-anchor="end">100%</text>
        <text class="axis-label" x={L - 4} y={yAt(0) + 3} text-anchor="end">0%</text>
        {[0, 1, 2, 3, 4].map((qq) => (
          <g key={qq}>
            <line class="grid-v" x1={xAt((qq * data.N) / 4)} y1={T} x2={xAt((qq * data.N) / 4)} y2={yAt(0)} />
            <text class="axis-label" x={xAt((qq * data.N) / 4)} y={H - 3} text-anchor="middle">{qq * 90}°</text>
          </g>
        ))}
        <path class={`fringe-a ${data.main === X ? 'is-x' : 'is-o'}`} d={path(data.pa)} />
        <path class={`fringe-b ${data.main === X ? 'is-x' : 'is-o'}`} d={path(data.pb)} />
        {[0, 1, 2, 3].map((qq) => {
          const k = (qq * data.N) / 4;
          return <circle key={qq} class={`fringe-dot ${qq === turns ? 'on' : ''}`} cx={xAt(k)} cy={yAt(data.pa[k])} r={qq === turns ? 4.5 : 3} />;
        })}
      </svg>
      <figcaption class="small">
        <span class="swatch solid" /> {tokenName} on {squareName(a)}
        <span class="swatch dashed" /> {tokenName} on {squareName(b)} — as the knob turns
      </figcaption>
    </figure>
  );
}

/**
 * Head-to-tail arrow sums: for every board that two universes both land on,
 * draw their arrows chained together. The dashed resultant is what's left:
 * long = reinforced, zero = cancelled.
 */
function ArrowSums({ pv }: { pv: MovePreview }) {
  const meetings = [...pv.trace.entries()].filter(([, list]) => list.length >= 2).slice(0, 3);
  if (!meetings.length) return null;
  return (
    <div class="arrow-sums">
      <div class="small muted">
        Where universes meet, their <Term k="amplitude">arrows</Term> add head-to-tail:
      </div>
      <div class="arrow-sum-row">
        {meetings.map(([code, list]) => (
          <ArrowSum key={code} code={code} list={list} />
        ))}
      </div>
    </div>
  );
}

function ArrowSum({ code, list }: { code: number; list: Contribution[] }) {
  const R = 30;
  let x = 0, y = 0;
  const arrows = list.map((c, i) => {
    const x2 = x + c.amp.re * R * 1.3;
    const y2 = y - c.amp.im * R * 1.3;
    const el = <line key={i} class={`arr arr-${i % 3}`} x1={x} y1={y} x2={x2} y2={y2} marker-end="url(#ah)" />;
    x = x2;
    y = y2;
    return el;
  });
  const sum = list.reduce((s, c) => ({ re: s.re + c.amp.re, im: s.im + c.amp.im }), { re: 0, im: 0 });
  const p = abs(sum) ** 2;
  const cancelled = p < 1e-9;
  return (
    <div class={`arrow-sum ${cancelled ? 'cancelled' : 'kept'}`}>
      <svg viewBox="-48 -48 96 96" width="92" height="92">
        <defs>
          <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" class="ah" />
          </marker>
        </defs>
        <circle class="unit" r={R * 1.3} />
        <line class="axis" x1="-44" y1="0" x2="44" y2="0" />
        <line class="axis" x1="0" y1="-44" x2="0" y2="44" />
        {arrows}
        {!cancelled && <line class="resultant" x1="0" y1="0" x2={x} y2={y} />}
        {cancelled && <circle class="zero" r="4" />}
      </svg>
      <MiniBoard code={code} size={40} />
      <span class="small">{cancelled ? 'cancel → 0%' : `→ ${pct(p)}`}</span>
    </div>
  );
}

