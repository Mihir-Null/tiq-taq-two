/**
 * server/main.ts — the optional Tiq Taq Two lobby server.
 *
 *   npm run build          # builds the web app into dist/
 *   npm run server         # node server/main.ts  → http://localhost:8787
 *
 * One process does three jobs:
 *   1. serves the built web app (dist/) — so the whole game is one URL,
 *   2. GET /api/health and /api/rooms — the public lobby list,
 *   3. WebSocket /ws — hosts rooms. Each room runs the very same RoomHost
 *      class that runs in a browser tab in peer-to-peer mode.
 *
 * Node ≥ 22.18 executes this TypeScript file directly ("type stripping"):
 * no compile step, and the engine files are shared with the browser as-is.
 *
 * Environment variables (all optional):
 *   PORT=8787  HOST=0.0.0.0  STATIC_DIR=dist  SERVER_NAME="My lobby"
 *   ALLOWED_ORIGINS=*        comma-separated list of web origins allowed to
 *                            use the API/WebSocket (e.g. https://you.github.io)
 *   MAX_ROOMS=300  TRUST_PROXY=1 (exactly one reverse proxy sits in front: take the
 *                            client address from the last X-Forwarded-For entry)
 *
 * Robustness rules this file follows: nothing a client sends may crash the
 * process (every handler is wrapped), and every per-client resource is capped
 * (sockets and rooms per IP, failed join attempts, message rate per socket).
 */

import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomHost } from '../src/net/room-host.ts';
import {
  PROTOCOL_VERSION, makeRoomCode, normalizeCode, sanitizeSettings,
  type ServerRequest, type ServerReply, type LobbyEntry,
} from '../src/net/protocol.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const STATIC_DIR = path.resolve(here, '..', process.env.STATIC_DIR ?? 'dist');
const SERVER_NAME = process.env.SERVER_NAME ?? 'Tiq Taq Two lobby';
const ALLOWED = (process.env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 300);
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const EMPTY_ROOM_TTL = 3 * 60_000;

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

// ─────────────────────────────── Rooms ─────────────────────────────────────

interface RoomEntry {
  host: RoomHost;
  emptySince: number | null;
  creatorIp: string;
}

const rooms = new Map<string, RoomEntry>();

function newRoom(settings: unknown, ip: string): RoomEntry | string {
  if (rooms.size >= MAX_ROOMS) return 'The server is full right now — try again later.';
  const mine = [...rooms.values()].filter((r) => r.creatorIp === ip).length;
  if (mine >= 8) return 'You already have many rooms open on this server.';
  let code = makeRoomCode();
  while (rooms.has(code)) code = makeRoomCode();
  const host = new RoomHost({ code, settings: sanitizeSettings(settings), log });
  const entry: RoomEntry = { host, emptySince: null, creatorIp: ip };
  rooms.set(code, entry);
  log(`room ${code} created (${rooms.size} open)`);
  return entry;
}

// Close rooms that have been empty for a while.
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (!r.host.isEmpty) r.emptySince = null;
    else if (r.emptySince === null) r.emptySince = now;
    else if (now - r.emptySince > EMPTY_ROOM_TTL) {
      r.host.close('Room closed after being empty.');
      rooms.delete(code);
      log(`room ${code} closed (empty)`);
    }
  }
}, 30_000).unref();

function lobby(): LobbyEntry[] {
  return [...rooms.values()]
    .filter((r) => r.host.settings.isPublic && !r.host.isEmpty)
    .map((r) => r.host.lobbyEntry())
    .sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : a.status === 'waiting' ? -1 : 1))
    .slice(0, 100);
}

// ─────────────────────────────── HTTP ──────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/**
 * May a page from `origin` use the API / WebSocket? Pages served by this very
 * server (origin host = the Host header) always may, so setting
 * ALLOWED_ORIGINS for a GitHub Pages copy doesn't lock out the server's own copy.
 */
function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || ALLOWED.includes('*') || ALLOWED.includes(origin)) return true;
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function clientIp(req: http.IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (TRUST_PROXY && typeof fwd === 'string') {
    // Only the LAST entry is trustworthy: our reverse proxy appended it. Earlier
    // entries arrive from the client and can say anything.
    const hops = fwd.split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.socket.remoteAddress ?? '?';
}

/**
 * The request path, percent-decoded — or null when it is malformed. (A bare
 * `decodeURIComponent('/%FF')` or `new URL('//', base)` throws; unguarded, one
 * such request would take the whole server down.)
 */
function requestPath(req: http.IncomingMessage): string | null {
  const raw = (req.url ?? '/').split(/[?#]/, 1)[0] || '/';
  if (!raw.startsWith('/')) return null;
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.includes('\0') ? null : decoded;
  } catch {
    return null;
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, req: http.IncomingMessage): void {
  const origin = req.headers.origin;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (originAllowed(origin, req.headers.host)) headers['Access-Control-Allow-Origin'] = ALLOWED.includes('*') ? '*' : origin ?? '';
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): void {
  let rel = pathname;
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(STATIC_DIR, `.${rel}`);
  // Never serve anything outside STATIC_DIR (path traversal like /../../etc/passwd).
  if (!file.startsWith(STATIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  let st;
  try {
    st = statSync(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  if (!st.isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }
  const hashed = rel.startsWith('/assets/');
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  // The file can vanish between stat and open (e.g. a rebuild of dist/).
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}

function handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin;
  const pathname = requestPath(req);
  if (pathname === null) {
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad request');
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': originAllowed(origin, req.headers.host) ? (ALLOWED.includes('*') ? '*' : origin ?? '') : '',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }
  if (pathname === '/api/health') {
    let players = 0;
    for (const r of rooms.values()) players += r.host.connectedCount;
    sendJson(res, 200, { ok: true, app: 'tiq-taq-two', name: SERVER_NAME, version: PROTOCOL_VERSION, rooms: rooms.size, players }, req);
    return;
  }
  if (pathname === '/api/rooms') {
    sendJson(res, 200, { rooms: lobby() }, req);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res, pathname);
}

const server = http.createServer((req, res) => {
  try {
    handleHttp(req, res);
  } catch (err) {
    // Last line of defence: log it, answer 500, keep serving everyone else.
    log('http error', req.method, (req.url ?? '').slice(0, 200), err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal error');
  }
});

// ───────────────────────────── WebSockets ──────────────────────────────────

const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
const perIp = new Map<string, number>();

/**
 * Failed `srv-join` attempts per IP (timestamps). Private rooms are protected
 * only by their code, so guessing codes must be slow: a socket may miss 5
 * times, an IP 30 times per 10 minutes.
 */
const joinFails = new Map<string, number[]>();
const JOIN_FAIL_WINDOW = 10 * 60_000;
function recentJoinFails(ip: string): number[] {
  const now = Date.now();
  const list = (joinFails.get(ip) ?? []).filter((t) => now - t < JOIN_FAIL_WINDOW);
  if (list.length) joinFails.set(ip, list);
  else joinFails.delete(ip);
  return list;
}
setInterval(() => {
  for (const ip of [...joinFails.keys()]) recentJoinFails(ip);
}, 60_000).unref();

function refuseUpgrade(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
  socket.destroy();
}

server.on('upgrade', (req, socket, head) => {
  try {
    if (requestPath(req) !== '/ws' || !originAllowed(req.headers.origin, req.headers.host)) {
      refuseUpgrade(socket, '403 Forbidden');
      return;
    }
    const ip = clientIp(req);
    if ((perIp.get(ip) ?? 0) >= 24) {
      refuseUpgrade(socket, '429 Too Many Requests');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws, ip));
  } catch (err) {
    log('upgrade error', (req.url ?? '').slice(0, 200), err);
    socket.destroy();
  }
});

function onSocket(ws: WebSocket & { alive?: boolean }, ip: string): void {
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  let handle: ReturnType<RoomHost['connect']> | null = null;
  let misses = 0;
  const reply = (m: ServerReply) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
  const lobbyTimer = setTimeout(() => {
    if (!handle) ws.close(1008, 'join timeout');
  }, 10_000);

  ws.on('message', (data) => {
    let msg: unknown;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (handle) {
      handle.receive(msg);
      return;
    }
    const req = msg as ServerRequest;
    let entry: RoomEntry | undefined;
    if (req?.t === 'srv-create') {
      const made = newRoom(req.settings, ip);
      if (typeof made === 'string') return reply({ t: 'error', code: 'refused', message: made });
      entry = made;
    } else if (req?.t === 'srv-join') {
      if (recentJoinFails(ip).length >= 30) {
        reply({ t: 'error', code: 'slow-down', message: 'Too many wrong room codes — wait a few minutes.' });
        ws.close(1008, 'too many attempts');
        return;
      }
      entry = rooms.get(normalizeCode(String(req.code ?? '')));
      if (!entry) {
        joinFails.set(ip, [...recentJoinFails(ip), Date.now()]);
        reply({ t: 'error', code: 'not-found', message: 'No room with that code on this server.' });
        if (++misses >= 5) ws.close(1008, 'too many attempts');
        return;
      }
    } else return;
    clearTimeout(lobbyTimer);
    reply({ t: 'srv-joined', code: entry.host.code });
    handle = entry.host.connect({
      send: (m) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m)),
      close: (reason) => ws.close(1000, (reason ?? '').slice(0, 100)),
    });
  });

  ws.on('close', () => {
    clearTimeout(lobbyTimer);
    handle?.close();
    const n = (perIp.get(ip) ?? 1) - 1;
    if (n <= 0) perIp.delete(ip);
    else perIp.set(ip, n);
  });
  ws.on('error', () => ws.close());
}

// Drop sockets that stopped answering pings (sleeping phones, dead networks).
setInterval(() => {
  for (const ws of wss.clients as Set<WebSocket & { alive?: boolean }>) {
    if (ws.alive === false) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, 30_000).unref();

server.listen(PORT, HOST, () => {
  log(`${SERVER_NAME} listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  log(`serving ${STATIC_DIR}${ALLOWED.includes('*') ? '' : ` · allowed origins: ${ALLOWED.join(', ')}`}`);
});

function shutdown(): void {
  log('shutting down');
  for (const r of rooms.values()) r.host.close('The server is restarting.');
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
