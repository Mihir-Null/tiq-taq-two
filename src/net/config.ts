/**
 * config.ts — where to find a lobby server and how to reach peers.
 *
 * Everything is optional. Set these at build time (e.g. in a `.env` file or
 * as environment variables when running `npm run build`):
 *
 *   VITE_SERVER_URL     https://tiq.example.com   your Node lobby server
 *                        (if unset, the app checks its own origin — which is
 *                        exactly right when the Node server hosts the app)
 *   VITE_STATIC_HOST    1   the app is on a static host (e.g. GitHub Pages):
 *                        don't look for a lobby server at its own address
 *   VITE_DISABLE_P2P    1   hide peer-to-peer rooms
 *   VITE_PEER_HOST / VITE_PEER_PORT / VITE_PEER_PATH / VITE_PEER_SECURE / VITE_PEER_KEY
 *                        use your own PeerJS signalling server instead of
 *                        the free public one (0.peerjs.com)
 *   VITE_ICE_SERVERS    JSON array of RTCIceServer, e.g. to add a TURN server
 *                        for players behind strict NATs
 */

import { settings } from '../app/store.ts';

const env = import.meta.env;

export const P2P_ENABLED = env.VITE_DISABLE_P2P !== '1' && env.VITE_DISABLE_P2P !== 'true';

export interface PeerConfig {
  host?: string;
  port?: number;
  path?: string;
  secure?: boolean;
  key?: string;
  config?: RTCConfiguration;
  debug?: 0 | 1 | 2 | 3;
}

export function peerConfig(): PeerConfig {
  const c: PeerConfig = { debug: 1 };
  if (env.VITE_PEER_HOST) c.host = env.VITE_PEER_HOST;
  if (env.VITE_PEER_PORT) c.port = Number(env.VITE_PEER_PORT);
  if (env.VITE_PEER_PATH) c.path = env.VITE_PEER_PATH;
  if (env.VITE_PEER_SECURE) c.secure = env.VITE_PEER_SECURE === '1' || env.VITE_PEER_SECURE === 'true';
  if (env.VITE_PEER_KEY) c.key = env.VITE_PEER_KEY;
  const ice = env.VITE_ICE_SERVERS;
  if (ice) {
    try {
      c.config = { iceServers: JSON.parse(ice) as RTCIceServer[] };
    } catch {
      console.warn('VITE_ICE_SERVERS is not valid JSON; using defaults');
    }
  }
  return c;
}

/** Candidate server base URLs, most specific first. */
export function serverCandidates(): string[] {
  const out: string[] = [];
  const custom = settings.value.customServer?.trim();
  if (custom) out.push(custom.replace(/\/+$/, ''));
  if (env.VITE_SERVER_URL) out.push(String(env.VITE_SERVER_URL).replace(/\/+$/, ''));
  // The page's own address hosts a lobby when the Node server serves the app.
  // Static hosts never do — asking would just log a 404.
  const staticHost =
    env.VITE_STATIC_HOST === '1' || env.VITE_STATIC_HOST === 'true' ||
    (typeof location !== 'undefined' && /\.github\.io$/.test(location.hostname));
  if (!staticHost && typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
    out.push(`${location.origin}${location.pathname.replace(/\/[^/]*$/, '')}`.replace(/\/+$/, ''));
  }
  return [...new Set(out)];
}

export interface ServerInfo {
  base: string;
  name: string;
  version: number;
  rooms: number;
  players: number;
}

/** Ask a candidate server "are you there?" (GET /api/health). */
export async function probeServer(base: string, timeoutMs = 2500): Promise<ServerInfo | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/health`, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const j = (await res.json()) as Partial<ServerInfo> & { ok?: boolean; app?: string };
    if (!j.ok || j.app !== 'tiq-taq-two') return null;
    return { base, name: j.name ?? 'Lobby server', version: j.version ?? 0, rooms: j.rooms ?? 0, players: j.players ?? 0 };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** First candidate that answers, or null. */
export async function findServer(): Promise<ServerInfo | null> {
  for (const base of serverCandidates()) {
    const info = await probeServer(base);
    if (info) return info;
  }
  return null;
}

export const wsUrl = (base: string): string => `${base.replace(/^http/, 'ws')}/ws`;
