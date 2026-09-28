/**
 * ui-state.ts — small pieces of app-wide UI state (modals, toasts).
 */

import { signal } from '@preact/signals';

export const settingsOpen = signal(false);

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'bad';
}

export const toasts = signal<Toast[]>([]);
let nextId = 1;

export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3500): void {
  const t: Toast = { id: nextId++, text, kind };
  toasts.value = [...toasts.value, t];
  setTimeout(() => (toasts.value = toasts.value.filter((x) => x.id !== t.id)), ms);
}

/** Copy text to the clipboard, with a toast either way. */
export async function copyText(text: string, what = 'Copied'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} to clipboard`, 'good');
  } catch {
    toast('Could not access the clipboard — select and copy manually.', 'bad');
  }
}
