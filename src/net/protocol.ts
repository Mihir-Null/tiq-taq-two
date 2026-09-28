/**
 * protocol.ts — every message that travels between players.
 *
 * Shape of the network (identical for peer-to-peer and server modes):
 *
 *        client ──ClientMsg──▶  RoomHost  ──HostMsg──▶ every client
 *
 * One RoomHost is the referee of a room. In peer-to-peer mode it runs inside
 * the browser tab of whoever created the room; in server mode it runs in the
 * Node server. The code is the same (src/net/room-host.ts).
 *
 * The game itself is replicated by *lockstep*: the host broadcasts each
 * accepted move, and every client applies it to its own copy of the
 * deterministic engine (same seed ⇒ same collapses). A state fingerprint
 * rides along with every move so any divergence is caught immediately.
 */

import type { GameResult, Level, Move, RuleSet } from '../engine/index.ts';

export const PROTOCOL_VERSION = 1;

export type Seat = 'X' | 'O';

export interface RoomSettings {
  name: string;
  level: Level;
  quanta: number;
  /** Players may ask the bot for hints. */
  hints: boolean;
  /** Listed in the server's public lobby (server mode only). */
  isPublic: boolean;
}

export interface MemberInfo {
  id: string;
  name: string;
  seat: Seat | null;
  connected: boolean;
  isOwner: boolean;
}

export type GamePhase = 'seeding' | 'playing' | 'over';

export interface GameInfo {
  id: string;
  rules: RuleSet;
  /** Member ids in each seat for this game. */
  seats: Record<Seat, string>;
  names: Record<Seat, string>;
  phase: GamePhase;
  commits: Partial<Record<Seat, string>>;
  /** Revealed nonces (after both commits) — lets everyone verify the seed. */
  nonces: Partial<Record<Seat, string>>;
  seed: string | null;
  moves: Move[];
  /** Set when the game ends outside the engine (resignation, abandonment). */
  forcedResult: GameResult | null;
  rematch: Record<Seat, boolean>;
}

export interface RoomSnapshot {
  code: string;
  settings: RoomSettings;
  members: MemberInfo[];
  game: GameInfo | null;
  /** How many games have been played in this room. */
  gamesPlayed: number;
}

export const EMOTES = ['👋', '🤔', '😮', '😅', '🎲', '👀', '⚛️', '🌀', '🔥', '🤝', 'GG'] as const;

// ───────────────────────────── client → host ───────────────────────────────

export type ClientMsg =
  | { t: 'hello'; v: number; clientId: string; name: string; token?: string }
  | { t: 'sit'; seat: Seat | null }
  | { t: 'settings'; settings: Partial<RoomSettings> }
  | { t: 'start' }
  | { t: 'commit'; gameId: string; hash: string }
  | { t: 'reveal'; gameId: string; nonce: string }
  | { t: 'move'; gameId: string; ply: number; move: Move }
  | { t: 'resign'; gameId: string }
  | { t: 'rematch'; gameId: string; want: boolean }
  | { t: 'chat'; text: string }
  | { t: 'emote'; emote: string }
  | { t: 'sync' }
  | { t: 'ping'; at: number };

// ───────────────────────────── host → client ───────────────────────────────

export type HostMsg =
  | { t: 'welcome'; you: string; token: string; room: RoomSnapshot }
  | { t: 'room'; room: RoomSnapshot }
  | { t: 'seed-request'; gameId: string }
  | { t: 'reveal-request'; gameId: string }
  | { t: 'game-start'; game: GameInfo }
  | { t: 'moved'; gameId: string; ply: number; move: Move; by: Seat; hash: string }
  | { t: 'game-over'; gameId: string; result: GameResult }
  | { t: 'chat'; from: string; name: string; text: string; at: number }
  | { t: 'emote'; from: string; name: string; emote: string }
  | { t: 'system'; text: string }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong'; at: number }
  | { t: 'closed'; reason: string };

/** Messages the Node server understands before a socket joins a room. */
export type ServerRequest =
  | { t: 'srv-create'; settings: RoomSettings }
  | { t: 'srv-join'; code: string };

export type ServerReply =
  | { t: 'srv-joined'; code: string }
  | { t: 'error'; code: string; message: string };

/** Public lobby entry (GET /api/rooms). */
export interface LobbyEntry {
  code: string;
  name: string;
  level: Level;
  players: string[];
  spectators: number;
  status: 'waiting' | 'playing' | 'finished';
  createdAt: number;
}

// ───────────────────────────── helpers ─────────────────────────────────────

/** Room codes avoid look-alike characters (no I/O/0/1). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode(len = 5): string {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** Upper-case and strip spaces/dashes from a typed room code. */
export const normalizeCode = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

export const cleanName = (s: unknown): string =>
  (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Anonymous qubit';

export const cleanText = (s: unknown, max = 280): string =>
  (typeof s === 'string' ? s : '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

/** Validate untrusted settings, keeping `base` for anything missing or invalid. */
export function sanitizeSettings(patch: unknown, base: RoomSettings = DEFAULT_ROOM_SETTINGS): RoomSettings {
  const s = { ...base };
  if (!patch || typeof patch !== 'object') return s;
  const p = patch as Partial<Record<keyof RoomSettings, unknown>>;
  if (typeof p.name === 'string') s.name = cleanText(p.name, 40) || s.name;
  if (Number.isInteger(p.level) && (p.level as number) >= 0 && (p.level as number) <= 3) s.level = p.level as Level;
  if (Number.isInteger(p.quanta) && (p.quanta as number) >= 0 && (p.quanta as number) <= 9) s.quanta = p.quanta as number;
  if (typeof p.hints === 'boolean') s.hints = p.hints;
  if (typeof p.isPublic === 'boolean') s.isPublic = p.isPublic;
  return s;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  name: 'Quantum match',
  level: 2,
  quanta: 2,
  hints: true,
  isPublic: true,
};
