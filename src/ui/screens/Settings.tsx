/**
 * Settings.tsx — the settings dialog.
 */

import { useEffect, useRef } from 'preact/hooks';
import { settings, updateSettings, updateProgress, resetProgress, progress, type ThemeChoice, type AnimSpeed, type ConfirmMode } from '../../app/store.ts';
import { settingsOpen, toast } from '../../app/ui-state.ts';
import { Icon } from '../components/Icon.tsx';

function Toggle({ label, value, onChange, tip }: { label: string; value: boolean; onChange: (v: boolean) => void; tip?: string }) {
  return (
    <label class="toggle" data-tip={tip}>
      <input type="checkbox" checked={value} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span class="switch" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="segmented" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={value === v} class={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function SettingsModal() {
  const s = settings.value;
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (settingsOpen.value = false);
    window.addEventListener('keydown', onKey);
    dialog.current?.querySelector<HTMLElement>('button, input')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="modal-backdrop" onClick={() => (settingsOpen.value = false)}>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Settings" ref={dialog} onClick={(e) => e.stopPropagation()}>
        <div class="modal-head">
          <h2>
            <Icon name="gear" /> Settings
          </h2>
          <button class="icon-btn" onClick={() => (settingsOpen.value = false)} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <section>
          <h3>Look</h3>
          <div class="setting-row">
            <span>Theme</span>
            <Segmented<ThemeChoice>
              value={s.theme}
              options={[['auto', 'Auto'], ['lab', 'Lab console'], ['academia', 'Academia']]}
              onChange={(theme) => updateSettings({ theme })}
            />
          </div>
          <div class="setting-row">
            <span>Animation speed</span>
            <Segmented<AnimSpeed>
              value={s.animSpeed}
              options={[['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']]}
              onChange={(animSpeed) => updateSettings({ animSpeed })}
            />
          </div>
          <Toggle label="Reduce motion" value={s.reduceMotion} onChange={(reduceMotion) => updateSettings({ reduceMotion })} tip="Skip spins and pulses (also follows your OS setting)" />
        </section>

        <section>
          <h3>Board</h3>
          <Toggle label="Show percentages on squares" value={s.showPercents} onChange={(showPercents) => updateSettings({ showPercents })} />
          <Toggle label="Show square numbers" value={s.showSquareNumbers} onChange={(showSquareNumbers) => updateSettings({ showSquareNumbers })} />
          <Toggle label="Show line odds" value={s.showLineOdds} onChange={(showLineOdds) => updateSettings({ showLineOdds })} tip="Bars across the board: how likely each line is" />
          <Toggle label="Show links between correlated squares" value={s.showLinks} onChange={(showLinks) => updateSettings({ showLinks })} />
          <Toggle label="Physics view (amplitudes & phases everywhere)" value={s.physicsView} onChange={(physicsView) => updateSettings({ physicsView })} />
          <div class="setting-row">
            <span data-tip="On touch screens you tap once to preview and again to play">Confirm moves</span>
            <Segmented<ConfirmMode>
              value={s.confirmMoves}
              options={[['touch', 'On touch'], ['always', 'Always'], ['never', 'Never']]}
              onChange={(confirmMoves) => updateSettings({ confirmMoves })}
            />
          </div>
          <Toggle label="Coach tips during games" value={s.coachTips} onChange={(coachTips) => updateSettings({ coachTips })} />
        </section>

        <section>
          <h3>Sound</h3>
          <Toggle label="Sound effects" value={s.sound} onChange={(sound) => updateSettings({ sound })} />
          <label class="range-row">
            <span>Volume</span>
            <input type="range" min="0" max="1" step="0.05" value={s.volume} onInput={(e) => updateSettings({ volume: Number((e.target as HTMLInputElement).value) })} />
          </label>
        </section>

        <section>
          <h3>You</h3>
          <label class="text-row">
            <span>Name (for online play)</span>
            <input type="text" maxLength={20} value={s.playerName} placeholder="Anonymous qubit" onInput={(e) => updateSettings({ playerName: (e.target as HTMLInputElement).value })} />
          </label>
          <p class="small muted">
            Games vs bot: {progress.value.stats.played} played · {progress.value.stats.won} won · {progress.value.stats.drawn} drawn
          </p>
          <div class="row gap">
            <button class="btn small" onClick={() => { updateProgress((p) => ({ ...p, unlocked: 3 })); toast('All levels unlocked', 'good'); }}>
              Unlock all levels
            </button>
            <button class="btn small" onClick={() => { updateProgress((p) => ({ ...p, tipsSeen: {} })); toast('Coach tips will show again', 'good'); }}>
              Replay coach tips
            </button>
            <button class="btn small danger" onClick={() => { if (confirm('Reset lessons, unlocks and stats?')) { resetProgress(); toast('Progress reset'); } }}>
              Reset progress
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
