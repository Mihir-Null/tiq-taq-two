/**
 * GameView.tsx — the full game screen layout, shared by every mode.
 *
 *  ┌──────────── main ────────────┐┌── controls ──┐┌──── side ─────┐
 *  │ players                       ││ result       ││ Multiverse    │
 *  │ BOARD (+ overlays)            ││ tools        ││ History       │
 *  │ forecast                      ││ preview      ││ Physics       │
 *  │                               ││ hints, coach ││ (+ extra tab) │
 *  └───────────────────────────────┘└──────────────┘└───────────────┘
 *
 * On phones everything stacks into one column (see layout.css).
 */

import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import type { GameController, Tool } from '../game/controller.ts';
import { Board } from './Board.tsx';
import { PlayerBar, ToolPalette, ForecastBar } from './Panels.tsx';
import { PreviewCard } from './PreviewCard.tsx';
import { Multiverse, HistoryPanel, PhysicsPanel } from './SidePanels.tsx';
import { AnimOverlay, ResultBanner } from './Overlays.tsx';
import { HintsPanel, CoachTip } from './Assist.tsx';
import { Icon } from './Icon.tsx';

export interface ExtraTab {
  id: string;
  label: string;
  icon: string;
  badge?: number;
  render: () => JSX.Element;
}

interface Props {
  ctrl: GameController;
  /** Buttons shown under the controls (undo, resign, …). */
  actions?: ComponentChildren;
  /** Buttons shown in the result banner (rematch, …). */
  resultActions?: ComponentChildren;
  extraTabs?: ExtraTab[];
  /** Something to show above the board (room info…). */
  banner?: ComponentChildren;
  /** A lesson coach card — gets its own prominent spot in the layout. */
  coach?: ComponentChildren;
  /** Show contextual coach tips (off during lessons). */
  tips?: boolean;
  /** Allow keyboard shortcuts (tutorials may disable some). */
  keyboard?: boolean;
}

const TOOL_KEYS: Record<string, Tool> = { p: 'place', s: 'split', l: 'link', o: 'observe', m: 'merge' };

function useKeyboard(ctrl: GameController, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k >= '1' && k <= '9') {
        // Keyboard play is always two-step: select, then press again or Enter.
        ctrl.lastPointer.value = 'touch';
        ctrl.clickCell(Number(k) - 1);
      } else if (TOOL_KEYS[k]) ctrl.setTool(TOOL_KEYS[k]);
      else if (k === 'enter') ctrl.confirm();
      else if (k === 'escape') ctrl.clearSelection();
      else if (k === '[') ctrl.setKnob(ctrl.knob.value - 1);
      else if (k === ']') ctrl.setKnob(ctrl.knob.value + 1);
      else if (k === 'h') void ctrl.requestHints();
      else if (k === 'arrowleft') ctrl.step(-1);
      else if (k === 'arrowright') ctrl.step(1);
      else if ((k === 'u' || k === 'backspace') && ctrl.canUndo.value) ctrl.driver.undo?.(ctrl);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctrl, enabled]);
}

/**
 * Phones only (CSS hides it elsewhere): the move you're building, with Play /
 * Cancel — and the knob for a Merge — pinned just above the tool bar, so you
 * never have to scroll away from the board to confirm.
 */
function MoveBar({ ctrl }: { ctrl: GameController }) {
  const merge = ctrl.tool.value === 'merge' && ctrl.selection.value.length === 2;
  const ready = ctrl.readyToConfirm.value;
  if (!ctrl.canAct.value || (!ready && !merge)) return null;
  const ex = ctrl.explanation.value;
  // A warning ("the board will collapse…") matters more than the headline.
  const warning = ex?.warnings[0];
  return (
    <div class="move-bar" role="group" aria-label="Confirm your move">
      <span class={`move-bar-text ${warning ? 'warn' : ''}`}>
        {warning ? <><Icon name="info" size={13} /> {warning}</> : ex?.headline ?? ctrl.candidateError.value ?? ''}
      </span>
      <button class="btn ghost small" onClick={() => ctrl.clearSelection()}>
        Cancel
      </button>
      {merge && (
        <span class="move-bar-knob">
          <button class="icon-btn" onClick={() => ctrl.setKnob(ctrl.knob.value - 1)} aria-label="Turn the knob back">
            <Icon name="undo" size={18} />
          </button>
          Knob <strong>{ctrl.knob.value * 90}°</strong>
          <button class="icon-btn" onClick={() => ctrl.setKnob(ctrl.knob.value + 1)} aria-label="Turn the knob forward">
            <Icon name="redo" size={18} />
          </button>
        </span>
      )}
      <button class="btn primary small" disabled={!ready} onClick={() => ctrl.confirm()}>
        <Icon name="check" size={16} /> Play
      </button>
    </div>
  );
}

export function GameView({ ctrl, actions, resultActions, extraTabs = [], banner, coach, tips = true, keyboard = true }: Props) {
  const [tab, setTab] = useState<string>('mv');
  useKeyboard(ctrl, keyboard);
  const flash = ctrl.flash.value;
  const view = ctrl.viewPly.value;
  const tabs: ExtraTab[] = [
    { id: 'mv', label: 'Multiverse', icon: 'layers', render: () => <Multiverse ctrl={ctrl} /> },
    { id: 'hist', label: 'History', icon: 'history', render: () => <HistoryPanel ctrl={ctrl} /> },
    { id: 'phys', label: 'Physics', icon: 'atom', render: () => <PhysicsPanel ctrl={ctrl} /> },
    ...extraTabs,
  ];
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <div class={`game-layout ${coach ? 'has-coach' : ''}`}>
      {coach && <section class="gl-coach">{coach}</section>}
      <section class="gl-main">
        {banner}
        <PlayerBar ctrl={ctrl} />
        <div class="board-area">
          <Board ctrl={ctrl} />
          <AnimOverlay ctrl={ctrl} />
          {flash && (
            <div key={flash.id} class={`flash ${flash.bad ? 'bad' : ''}`} role="alert">
              {flash.text}
            </div>
          )}
        </div>
        {view !== null && (
          <div class="time-banner">
            <Icon name="history" size={16} /> Viewing the board after move {view}.
            <button class="btn small" onClick={() => ctrl.step(-1)} disabled={view === 0}>
              <Icon name="chevronLeft" size={14} />
            </button>
            <button class="btn small" onClick={() => ctrl.step(1)}>
              <Icon name="chevronRight" size={14} />
            </button>
            <button class="btn small primary" onClick={() => ctrl.setViewPly(null)}>
              Live
            </button>
          </div>
        )}
        <ForecastBar ctrl={ctrl} />
      </section>

      <section class="gl-controls">
        <ResultBanner ctrl={ctrl}>{resultActions}</ResultBanner>
        <ToolPalette ctrl={ctrl} />
        <MoveBar ctrl={ctrl} />
        <PreviewCard ctrl={ctrl} />
        <HintsPanel ctrl={ctrl} />
        {tips && <CoachTip ctrl={ctrl} />}
        {actions && <div class="game-actions">{actions}</div>}
      </section>

      <section class="gl-side">
        <div class={`tabs ${tabs.length > 3 ? 'many' : ''}`} role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === active.id}
              aria-label={t.label}
              data-tip={tabs.length > 3 && t.id !== active.id ? t.label : undefined}
              class={`tab ${t.id === active.id ? 'on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} size={16} />
              <span>{t.label}</span>
              {t.badge ? <span class="tab-badge">{t.badge}</span> : null}
            </button>
          ))}
        </div>
        <div class="tab-body" role="tabpanel">
          {active.render()}
        </div>
      </section>
    </div>
  );
}
