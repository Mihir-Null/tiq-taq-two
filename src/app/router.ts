/**
 * router.ts — a tiny hash router.
 *
 * Routes live after the "#" (e.g. `#/room/p2p/K7Q2X`). Hash routes need no
 * server configuration at all, which is what makes the app hostable on
 * GitHub Pages or any static file server.
 */

import { signal } from '@preact/signals';

export interface Route {
  /** Path segments, e.g. ['room', 'p2p', 'K7Q2X']. */
  parts: string[];
  /** Query parameters after "?" inside the hash, e.g. #/play?level=2 */
  query: URLSearchParams;
}

function parse(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs) };
}

export const route = signal<Route>(parse());

window.addEventListener('hashchange', () => {
  route.value = parse();
  window.scrollTo({ top: 0 });
});

/** Go to a route, e.g. navigate('/play', { level: 2 }). */
export function navigate(path: string, query?: Record<string, string | number | boolean | undefined>): void {
  const qs = query
    ? new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : '';
  const target = `#${path.startsWith('/') ? path : `/${path}`}${qs ? `?${qs}` : ''}`;
  if (location.hash === target) route.value = parse();
  else location.hash = target;
}

/** Absolute link to a route, for sharing (e.g. room invites). */
export function shareUrl(path: string): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#${path.startsWith('/') ? path : `/${path}`}`;
}
