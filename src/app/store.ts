/**
 * store.ts — app-wide settings and progress, saved in localStorage.
 *
 * Signals (from @preact/signals) are reactive values: any component that
 * reads `settings.value` re-renders when it changes. An `effect` writes every
 * change back to localStorage. Storage can be unavailable (private mode,
 * sandboxed iframes), so every access is wrapped in try/catch and the app
 * keeps working in memory.
 */

import { signal, effect, computed } from '@preact/signals';
import type { Level } from '../engine/index.ts';

export type ThemeChoice = 'auto' | 'lab' | 'academia';
export type AnimSpeed = 'slow' | 'normal' | 'fast';
export type ConfirmMode = 'touch' | 'always' | 'never';

export interface Settings {
  theme: ThemeChoice;
  sound: boolean;
  volume: number;
  animSpeed: AnimSpeed;
  reduceMotion: boolean;
  /** Show percentages on squares. */
  showPercents: boolean;
  showSquareNumbers: boolean;
  /** Draw the chance of each line on the board. */
  showLineOdds: boolean;
  /** Draw links between correlated (entangled) squares. */
  showLinks: boolean;
  /** Show amplitudes, phases and the state vector (for the physics-curious). */
  physicsView: boolean;
  /** When to ask for a second tap before a move is played. */
  confirmMoves: ConfirmMode;
  coachTips: boolean;
  playerName: string;
  /** Optional lobby server URL typed in by the user (overrides the build-time default). */
  customServer: string;
}

export interface Progress {
  /** Lessons finished, by id. */
  lessons: Record<string, true>;
  /** Highest level unlocked for quick play (lessons unlock levels). */
  unlocked: Level;
  /** Coach tips already shown. */
  tipsSeen: Record<string, true>;
  stats: { played: number; won: number; drawn: number };
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  sound: true,
  volume: 0.6,
  animSpeed: 'normal',
  reduceMotion: false,
  showPercents: true,
  showSquareNumbers: true,
  showLineOdds: true,
  showLinks: true,
  physicsView: false,
  confirmMoves: 'touch',
  coachTips: true,
  playerName: '',
  customServer: '',
};

const DEFAULT_PROGRESS: Progress = {
  lessons: {},
  unlocked: 1,
  tipsSeen: {},
  stats: { played: 0, won: 0, drawn: 0 },
};

function load<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...fallback, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  return { ...fallback };
}

function persist(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore — the app keeps working in memory */
  }
}

export const settings = signal<Settings>(load('tq2.settings', DEFAULT_SETTINGS));
export const progress = signal<Progress>(load('tq2.progress', DEFAULT_PROGRESS));

effect(() => persist('tq2.settings', settings.value));
effect(() => persist('tq2.progress', progress.value));

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
}

export function updateProgress(f: (p: Progress) => Progress): void {
  progress.value = f(progress.value);
}

export function resetProgress(): void {
  progress.value = { ...DEFAULT_PROGRESS, lessons: {}, tipsSeen: {} };
}

// ───────────────────────────── Theme ───────────────────────────────────────

const prefersLight = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: light)') : null;
const systemLight = signal(prefersLight?.matches ?? false);
prefersLight?.addEventListener('change', (e) => (systemLight.value = e.matches));

/** The theme actually in use ("auto" resolved against the OS preference). */
export const activeTheme = computed<'lab' | 'academia'>(() => {
  const t = settings.value.theme;
  if (t === 'auto') return systemLight.value ? 'academia' : 'lab';
  return t;
});

effect(() => {
  const theme = activeTheme.value;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'lab' ? '#2c2e34' : '#efe6d2');
});

const prefersReducedMotion = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const reducedMotion = computed(() => settings.value.reduceMotion || (prefersReducedMotion?.matches ?? false));

effect(() => {
  document.documentElement.dataset.motion = reducedMotion.value ? 'reduced' : 'full';
  document.documentElement.dataset.speed = settings.value.animSpeed;
});

/** Multiplier for animation durations. */
export const animScale = computed(() =>
  reducedMotion.value ? 0.01 : settings.value.animSpeed === 'fast' ? 0.45 : settings.value.animSpeed === 'slow' ? 1.6 : 1,
);

/** A display name for online play (asks once, remembers). */
export function displayName(): string {
  return settings.value.playerName.trim() || 'Anonymous qubit';
}
