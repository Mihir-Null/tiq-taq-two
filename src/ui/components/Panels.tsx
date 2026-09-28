/**
 * Panels.tsx — the pieces around the board: players, tools, forecast.
 */

import type { JSX } from 'preact';
import { X, O, forecast, playerChar, type Player, MOVE_COST, quantaOf } from '../../engine/index.ts';
import type { GameController, Tool } from '../game/controller.ts';
import { Icon } from './Icon.tsx';

// ─────────────────────────────── Players ───────────────────────────────────

export function TokenMark({ p, size = 22 }: { p: Player; size?: number }) {
  return (
    <svg class={`token-mark ${p === X ? 'mark-x' : 'mark-o'}`} width={size} height={size} viewBox="-30 -30 60 60" aria-label={playerChar(p)}>
      {p === X ? <path d="M-18,-18 L18,18 M18,-18 L-18,18" stroke-width="9" stroke-linecap="round" fill="none" /> : <circle r="18" stroke-width="8" fill="none" />}
    </svg>
  );
}

export function Quanta({ n, max, player }: { n: number; max: number; player?: Player }) {
  if (max <= 0) return null;
  const tip = `⚡ quanta left: ${n} of ${max}. Observe and Merge cost ⚡1 each.`;
  // Many pips would squeeze the player's name: show a count instead.
  if (max > 3) {
    return (
      <span class={`quanta compact ${n > 0 ? 'has' : ''}`} data-tip={tip} aria-label={`${n} quanta left`}>
        <Icon name="bolt" size={13} />
        {n}
      </span>
    );
  }
  return (
    <span class="quanta" data-tip={tip} aria-label={`${n} quanta left`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} class={`pip ${i < n ? 'full' : ''} ${player === X ? 'pip-x' : 'pip-o'}`}>
          <Icon name="bolt" size={13} />
        </span>
      ))}
    </span>
  );
}

export function PlayerBar({ ctrl }: { ctrl: GameController }) {
  // `display` hides the result until collapse animations have finished.
  const past = ctrl.viewPly.value !== null;
  const s = past ? ctrl.display.value : { ...ctrl.live.value, result: ctrl.display.value.result };
  const seats = ctrl.seats.value;
  const bothLocal = seats[X].local && seats[O].local;
  return (
    <div class="players">
      {([X, O] as Player[]).map((p) => {
        const seat = seats[p];
        const active = !s.result && s.toMove === p;
        const thinking = active && ctrl.thinking.value;
        const status = s.result
          ? s.result.winner === p ? 'Winner' : s.result.winner === null ? 'Draw' : ''
          : active
            ? thinking ? 'Thinking…' : seat.local && !bothLocal && !past ? 'Your turn' : 'To move'
            : '';
        return (
          <div key={p} class={`player ${p === X ? 'player-x' : 'player-o'} ${active ? 'active' : ''} ${s.result?.winner === p ? 'winner' : ''}`}>
            <TokenMark p={p} size={26} />
            <div class="player-text">
              <div class="player-name">
                {seat.name}
                {seat.local && !bothLocal && <span class="you">you</span>}
                {seat.kind === 'bot' && <Icon name="bot" size={14} class="dim" />}
              </div>
              <div class="player-status">
                {thinking && <span class="dots" aria-hidden="true"><i /><i /><i /></span>}
                {status}
              </div>
            </div>
            <Quanta n={quantaOf(s, p)} max={s.rules.quanta} player={p} />
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────── Tools ─────────────────────────────────────

export const TOOL_INFO: Record<Tool, { name: string; icon: string; key: string; desc: string; concept: string }> = {
  place: { name: 'Place', icon: 'place', key: 'P', concept: 'classical', desc: 'Put your token on a square that is empty in every universe.' },
  split: { name: 'Split', icon: 'split', key: 'S', concept: 'superposition', desc: 'Superposition: your token goes into two empty squares at once — 50% each.' },
  link: { name: 'Link', icon: 'link', key: 'L', concept: 'entanglement', desc: 'Entanglement: your new token half-swaps with a square where your opponent might be.' },
  observe: { name: 'Observe', icon: 'observe', key: 'O', concept: 'measurement', desc: 'Measurement: force one uncertain square to decide. Costs ⚡1.' },
  merge: { name: 'Merge', icon: 'merge', key: 'M', concept: 'interference', desc: 'Interference: twist the phase knob, then half-swap two squares so universes meet. Costs ⚡1.' },
};

export function ToolPalette({ ctrl }: { ctrl: GameController }) {
  const tools = ctrl.tools.value;
  const s = ctrl.live.value;
  const current = ctrl.tool.value;
  const left = quantaOf(s, s.toMove);
  // No tools for a single-tool level, a finished game, or someone just watching.
  if (tools.length <= 1 || s.result || !ctrl.hasLocalPlayer.value) return null;
  return (
    <div class="tools" role="toolbar" aria-label="Move type">
      {tools.map((t) => {
        const info = TOOL_INFO[t];
        const cost = MOVE_COST[t];
        const broke = cost > left;
        return (
          <button
            key={t}
            class={`tool tool-${t} ${current === t ? 'on' : ''}`}
            aria-pressed={current === t}
            disabled={broke && ctrl.myTurn.value}
            data-tip={`${info.desc} · key ${info.key}`}
            onClick={() => ctrl.setTool(t)}
          >
            <Icon name={info.icon} size={22} />
            <span class="tool-name">{info.name}</span>
            {cost > 0 && (
              <span class="tool-cost">
                <Icon name="bolt" size={11} />
                {cost}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────── Forecast ──────────────────────────────────

export function ForecastBar({ ctrl }: { ctrl: GameController }) {
  const pv = ctrl.preview.value;
  const q = pv ? pv.q : ctrl.display.value.q;
  const f = forecast(q);
  const segs: [string, number, string][] = [
    ['fx', f.xWin, 'X leads on lines'],
    ['ft', f.tie, 'Tied on lines'],
    ['fo', f.oWin, 'O leads on lines'],
    ['fn', f.open, 'No line yet — the game would go on'],
  ];
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  return (
    <div class="forecast" data-tip="If every square were observed right now, these are the chances of each outcome. Only the universe that becomes real counts!">
      <div class="forecast-label">
        <Icon name="dice" size={14} /> If we looked now{pv ? ' (after this move)' : ''}:
      </div>
      <div class="forecast-bar" role="img" aria-label={`X ${pct(f.xWin)}, tie ${pct(f.tie)}, O ${pct(f.oWin)}, no line ${pct(f.open)}`}>
        {segs.map(([cls, p, label]) =>
          p > 0.001 ? (
            <div key={cls} class={`fseg ${cls}`} style={{ flexGrow: p }} title={`${label}: ${pct(p)}`}>
              {p >= 0.12 && <span>{pct(p)}</span>}
            </div>
          ) : null,
        )}
      </div>
      <div class="forecast-legend">
        <span class="lx">X {pct(f.xWin)}</span>
        <span class="lo">O {pct(f.oWin)}</span>
        {f.tie > 0.001 && <span class="lt">tie {pct(f.tie)}</span>}
        <span class="ln">no line {pct(f.open)}</span>
      </div>
    </div>
  );
}

export function Explainer({ children }: { children: JSX.Element | JSX.Element[] | string }) {
  return <p class="explainer">{children}</p>;
}

