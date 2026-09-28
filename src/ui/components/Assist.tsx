/**
 * Assist.tsx — help while you play: hints from the bot and coach tips.
 */

import type { JSX } from 'preact';
import { correlations, forecast, moveSentence, LEVELS, type GameState } from '../../engine/index.ts';
import { settings, progress, updateProgress } from '../../app/store.ts';
import type { GameController } from '../game/controller.ts';
import type { HintTag } from '../../ai/hints.ts';
import { Icon } from './Icon.tsx';
import { Term } from './Term.tsx';

const TAG_NAMES: Record<HintTag, string> = {
  win: 'Winning move',
  block: 'Defence',
  threat: 'Attack',
  fork: 'Double threat',
  gamble: 'Gamble',
  steer: 'Interference',
  entangle: 'Entangle',
  spread: 'Superpose',
  solid: 'Solid',
};

export function HintsPanel({ ctrl }: { ctrl: GameController }) {
  const s = ctrl.live.value;
  if (!ctrl.hintsAllowed.value || s.result || !ctrl.myTurn.value) return null;
  const hints = ctrl.hints.value;
  const loading = ctrl.hintsLoading.value;
  const total = hints?.reduce((n, h) => n + h.games, 0) ?? 0;
  return (
    <div class="hints">
      <button class="btn hint-btn" onClick={() => void ctrl.requestHints()} disabled={loading || !ctrl.canAct.value} data-tip="Ask the Tiger bot for suggestions  [H]">
        <Icon name="hint" size={18} />
        {loading ? 'Simulating games…' : hints ? 'Refresh hints' : 'Hint'}
      </button>
      {hints && (
        <div class="hint-list">
          {hints.map((h, i) => (
            <button key={i} class="hint-card" onClick={() => ctrl.applyHint(h)} data-tip="Show this move on the board">
              <span class={`hint-tag tag-${h.tag}`}>{TAG_NAMES[h.tag]}</span>
              <span class="hint-move">{moveSentence(h.move, s.toMove)}</span>
              <span class="hint-reason">{h.reason}</span>
              <span class="hint-score">
                <span class="hint-meter">
                  <span style={{ width: `${h.percent}%` }} />
                </span>
                {h.percent}% · won {h.wins}, drew {h.draws}, lost {h.losses}
              </span>
            </button>
          ))}
          <p class="muted small">
            Scores come from {total} simulated games played out with real dice after each move — a quick
            Monte-Carlo estimate, not gospel.
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────── Coach ─────────────────────────────────────

interface Tip {
  id: string;
  when: (s: GameState, ctrl: GameController) => boolean;
  text: () => JSX.Element;
}

const TIPS: Tip[] = [
  {
    id: 'rings',
    when: (s) => s.q.size > 1,
    text: () => (
      <>
        Ghostly tokens are in <Term k="superposition" />. The ring around a square shows its odds (X, O, empty), and the
        Multiverse panel lists every board the game could turn out to be.
      </>
    ),
  },
  {
    id: 'swap',
    when: (s) => correlations(s.q).some((c) => c.kind === 'swap'),
    text: () => (
      <>
        The ⇄ badge marks an <Term k="entanglement">entangled</Term> pair: if one square turns out X, the other is O.
        Hover or tap the badge to read the link.
      </>
    ),
  },
  {
    id: 'partial-line',
    when: (s) => {
      const f = forecast(s.q);
      return f.xWin + f.oWin > 0.01 && f.open > 0.01;
    },
    text: () => (
      <>
        A line that exists in only <em>some</em> universes doesn't win yet. It counts if every universe has a finished
        line, or if it survives the <Term k="collapse" />.
      </>
    ),
  },
  {
    id: 'crowded',
    when: (s) => {
      let empties = 0;
      for (let i = 0; i < 9; i++) if (s.q.certainlyEmpty(i)) empties++;
      return empties === 1 && s.q.size > 1;
    },
    text: () => (
      <>
        Only one square is empty in every universe. Once it's taken nobody can place, so the board will{' '}
        <Term k="collapse" /> into a single universe.
      </>
    ),
  },
  {
    id: 'quanta',
    when: (s) => LEVELS[s.rules.level].features.observe && s.quanta[s.toMove - 1] > 0 && s.q.size > 1,
    text: () => (
      <>
        You have ⚡ quanta. <strong>Observe</strong> forces one square to decide right now — handy to settle a
        threatening superposition (but it uses your turn).
      </>
    ),
  },
  {
    id: 'merge',
    when: (s) =>
      LEVELS[s.rules.level].features.merge &&
      s.quanta[s.toMove - 1] > 0 &&
      correlations(s.q).some((c) => c.kind === 'tether' && c.token === s.toMove),
    text: () => (
      <>
        Your token is split. <strong>Merge</strong> its two squares and turn the knob: the halves{' '}
        <Term k="interference">interfere</Term>, and you can land it 100% where you like.
      </>
    ),
  },
  {
    id: 'history',
    when: (s) => s.ply >= 5,
    text: () => <>Tip: open History and click any move to rewind the board and inspect what happened.</>,
  },
];

export function CoachTip({ ctrl }: { ctrl: GameController }) {
  if (!settings.value.coachTips) return null;
  const s = ctrl.live.value;
  if (s.result || !ctrl.myTurn.value || ctrl.anim.value) return null;
  const seen = progress.value.tipsSeen;
  const tip = TIPS.find((t) => !seen[t.id] && t.when(s, ctrl));
  if (!tip) return null;
  const dismiss = () => updateProgress((p) => ({ ...p, tipsSeen: { ...p.tipsSeen, [tip.id]: true } }));
  return (
    <div class="coach" role="note">
      <Icon name="sparkle" size={16} />
      <div class="coach-text">{tip.text()}</div>
      <button class="btn small ghost" onClick={dismiss}>
        Got it
      </button>
    </div>
  );
}

