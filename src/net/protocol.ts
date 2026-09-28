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
 * deterministic engine (same dice values ⇒ same collapses). A state
 * fingerprint rides along with every move so any divergence is caught.
 * Dice come from per-move hash-chain reveals by both players (fair-seed.ts).
 */

import type { GameResult, Level, Move, RuleSet } from '../engine/index.ts';

/**
 * Bump whenever messages OR engine behaviour change: two clients must run
 * identical rules for lockstep to work, so mismatched versions are refused
 * with a "reload the page" message instead of drifting apart.
 */
export const PROTOCOL_VERSION = 2;

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

/** One accepted move, with everything needed to replay and verify it. */
export interface MoveRecord {
  move: Move;
  by: Seat;
  /** Both players' hash-chain values for this move, or null if it rolled no dice. */
  dice: Record<Seat, string> | null;
  /** State fingerprint after the move (QState.hash). */
  hash: string;
}

export interface GameInfo {
  id: string;
  rules: RuleSet;
  /** Member ids in each seat for this game. */
  seats: Record<Seat, string>;
  names: Record<Seat, string>;
  phase: GamePhase;
  /** Each player's hash-chain anchor (their commitment to all future dice). */
  anchors: Partial<Record<Seat, string>>;
  moves: MoveRecord[];
  /** A move waiting for the other player's dice value. */
  pending: { ply: number; move: Move; by: Seat } | null;
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
  /** My hash-chain anchor for this game. */
  | { t: 'commit'; gameId: string; anchor: string }
  /** My chain value for move `ply` (only after the host showed me that move). */
  | { t: 'reveal'; gameId: string; ply: number; value: string }
  /** `reveal` is my chain value for this move number. */
  | { t: 'move'; gameId: string; ply: number; move: Move; reveal: string }
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
  /** Please commit to a hash chain for this game. */
  | { t: 'seed-request'; gameId: string }
  /** `by` played `move` as move number `ply`, and it rolls dice: send your value. */
  | { t: 'reveal-request'; gameId: string; ply: number; move: Move; by: Seat }
  | { t: 'game-start'; game: GameInfo }
  | { t: 'moved'; gameId: string; ply: number; move: Move; by: Seat; hash: string; dice: Record<Seat, string> | null }
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

/**
 * Invisible troublemakers: control characters, zero-width spaces and
 * bidirectional overrides (which can make "Alice" look like someone else, or
 * flip the text that follows). Zero-width (non-)joiners stay: emoji
 * sequences like 👩‍💻 and several scripts need them.
 */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/g;

export const cleanName = (s: unknown): string =>
  (typeof s === 'string' ? s : '').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Anonymous qubit';

export const cleanText = (s: unknown, max = 280): string =>
  (typeof s === 'string' ? s : '').replace(INVISIBLE, ' ').trim().slice(0, max);

const isCell = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < 9;

/** Copy only the fields a Move may have — never store or relay foreign junk. */
export function sanitizeMove(m: unknown): Move | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  switch (o.kind) {
    case 'place':
    case 'observe':
      return isCell(o.cell) ? { kind: o.kind, cell: o.cell } : null;
    case 'split':
    case 'link':
      return isCell(o.a) && isCell(o.b) ? { kind: o.kind, a: o.a, b: o.b } : null;
    case 'merge':
      return isCell(o.a) && isCell(o.b) && Number.isInteger(o.turns) && (o.turns as number) >= 0 && (o.turns as number) < 4
        ? { kind: 'merge', a: o.a, b: o.b, turns: o.turns as number }
        : null;
    default:
      return null;
  }
}

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
