/**
 * room-host.ts — the referee of one room. Runs in the room creator's browser
 * (peer-to-peer mode) or in the Node server (server mode) — same code.
 *
 * Responsibilities:
 *   • members: who is here, who sits in the X / O seat, who only watches;
 *   • the fair-seed ceremony (commit–reveal, see fair-seed.ts);
 *   • validating every move with the real engine and broadcasting it;
 *   • chat, emotes, rematches, resignations, disconnects and reconnects.
 *
 * It never trusts incoming data: every message is shape-checked, rate
 * limited where it matters, and moves are re-validated by the engine.
 *
 * Transport-agnostic: it talks to "connections" that only need send() and
 * close(). WebSockets, WebRTC data channels and in-memory pipes all fit.
 */

import {
  newGame, applyMove, whyIllegal, rngForPly, resign as resignState, abandon as abandonState, X, O,
  type GameState, type Move, type Player,
} from '../engine/index.ts';
import {
  PROTOCOL_VERSION, EMOTES, cleanName, cleanText, sanitizeSettings,
  type ClientMsg, type HostMsg, type RoomSettings, type RoomSnapshot, type MemberInfo, type GameInfo,
  type Seat, type LobbyEntry,
} from './protocol.ts';
import { verifyReveal, combineSeed, makeNonce } from './fair-seed.ts';

export interface Conn {
  send(msg: HostMsg): void;
  close(reason?: string): void;
}

/** What `RoomHost.connect` returns: feed it the connection's messages. */
export interface ConnHandle {
  receive(msg: unknown): void;
  close(): void;
}

interface Member {
  id: string;
  token: string;
  name: string;
  seat: Seat | null;
  conn: Conn | null;
  isOwner: boolean;
  recent: number[];
}

interface HostGame extends GameInfo {
  state: GameState | null;
}

export interface RoomHostOptions {
  code: string;
  settings: RoomSettings;
  /** Called whenever something visible in the lobby list changes. */
  onChange?: () => void;
  /** A seated player who stays disconnected this long forfeits. */
  abandonAfterMs?: number;
  /** Max time for the seed ceremony. */
  seedTimeoutMs?: number;
  maxMembers?: number;
  log?: (...args: unknown[]) => void;
}

const SEATS: Seat[] = ['X', 'O'];
const seatPlayer = (s: Seat): Player => (s === 'X' ? X : O);
const otherSeat = (s: Seat): Seat => (s === 'X' ? 'O' : 'X');
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

export class RoomHost {
  readonly code: string;
  settings: RoomSettings;
  readonly createdAt = Date.now();
  readonly #members = new Map<string, Member>();
  #game: HostGame | null = null;
  #gameCounter = 0;
  #gamesPlayed = 0;
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #opts: Required<Omit<RoomHostOptions, 'onChange' | 'log'>> & Pick<RoomHostOptions, 'onChange' | 'log'>;
  #closed = false;

  constructor(opts: RoomHostOptions) {
    this.code = opts.code;
    this.settings = { ...opts.settings };
    this.#opts = { abandonAfterMs: 90_000, seedTimeoutMs: 20_000, maxMembers: 24, ...opts };
  }

  // ─────────────────────────── connections ─────────────────────────────────

  /** Attach a new connection. Its first message must be `hello`. */
  connect(conn: Conn): ConnHandle {
    let member: Member | null = null;
    return {
      receive: (raw: unknown) => {
        if (this.#closed) return;
        const msg = raw as ClientMsg;
        if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
        try {
          if (!member) {
            if (msg.t === 'hello') member = this.#hello(conn, msg);
            return;
          }
          if (member.conn !== conn) return; // replaced by a newer connection
          this.#handle(member, msg);
        } catch (err) {
          this.#opts.log?.('room error', err);
          conn.send({ t: 'error', code: 'internal', message: 'The host hit an error handling that.' });
        }
      },
      close: () => {
        if (member && member.conn === conn) this.#disconnect(member);
      },
    };
  }

  /** Shut the room down (e.g. the P2P host closed their tab). */
  close(reason = 'The room was closed.'): void {
    this.#closed = true;
    for (const t of this.#timers.values()) clearTimeout(t);
    for (const m of this.#members.values()) {
      m.conn?.send({ t: 'closed', reason });
      m.conn?.close(reason);
    }
  }

  get connectedCount(): number {
    let n = 0;
    for (const m of this.#members.values()) if (m.conn) n++;
    return n;
  }

  get isEmpty(): boolean {
    return this.connectedCount === 0;
  }

  // ─────────────────────────── snapshots ───────────────────────────────────

  snapshot(): RoomSnapshot {
    const members: MemberInfo[] = [...this.#members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      seat: m.seat,
      connected: m.conn !== null,
      isOwner: m.isOwner,
    }));
    let game: GameInfo | null = null;
    if (this.#game) {
      const { state: _state, ...info } = this.#game;
      game = structuredClone(info);
    }
    return { code: this.code, settings: { ...this.settings }, members, game, gamesPlayed: this.#gamesPlayed };
  }

  lobbyEntry(): LobbyEntry {
    const players = [...this.#members.values()].filter((m) => m.seat).map((m) => m.name);
    const spectators = [...this.#members.values()].filter((m) => !m.seat && m.conn).length;
    const phase = this.#game?.phase;
    return {
      code: this.code,
      name: this.settings.name,
      level: this.settings.level,
      players,
      spectators,
      status: phase === 'playing' || phase === 'seeding' ? 'playing' : phase === 'over' ? 'finished' : 'waiting',
      createdAt: this.createdAt,
    };
  }

  // ─────────────────────────── internals ───────────────────────────────────

  #broadcast(msg: HostMsg): void {
    for (const m of this.#members.values()) m.conn?.send(msg);
  }

  #broadcastRoom(): void {
    this.#broadcast({ t: 'room', room: this.snapshot() });
    this.#opts.onChange?.();
  }

  #system(text: string): void {
    this.#broadcast({ t: 'system', text });
  }

  #timer(key: string, ms: number, fn: () => void): void {
    this.#clearTimer(key);
    this.#timers.set(key, setTimeout(() => {
      this.#timers.delete(key);
      if (!this.#closed) fn();
    }, ms));
  }

  #clearTimer(key: string): void {
    const t = this.#timers.get(key);
    if (t) clearTimeout(t);
    this.#timers.delete(key);
  }

  #inProgress(): boolean {
    return this.#game !== null && this.#game.phase !== 'over';
  }

  #hello(conn: Conn, msg: Extract<ClientMsg, { t: 'hello' }>): Member | null {
    if (msg.v !== PROTOCOL_VERSION) {
      conn.send({ t: 'error', code: 'version', message: 'This room runs a different version of the game — reload the page.' });
      conn.close('version');
      return null;
    }
    const id = typeof msg.clientId === 'string' ? msg.clientId.slice(0, 64) : '';
    if (id.length < 8) {
      conn.close('bad hello');
      return null;
    }
    let m = this.#members.get(id);
    if (m) {
      if (m.token !== msg.token) {
        conn.send({ t: 'error', code: 'duplicate', message: 'You are already in this room in another tab.' });
        conn.close('duplicate');
        return null;
      }
      if (m.conn) m.conn.close('replaced');
      m.conn = conn;
      m.name = cleanName(msg.name);
      this.#clearTimer(`abandon:${m.id}`);
      this.#system(`${m.name} reconnected.`);
    } else {
      if (this.#members.size >= this.#opts.maxMembers) {
        conn.send({ t: 'error', code: 'full', message: 'This room is full.' });
        conn.close('full');
        return null;
      }
      const isOwner = ![...this.#members.values()].some((x) => x.isOwner);
      m = { id, token: makeNonce(), name: cleanName(msg.name), seat: null, conn, isOwner, recent: [] };
      if (!this.#inProgress()) {
        const taken = new Set([...this.#members.values()].map((x) => x.seat));
        m.seat = SEATS.find((s) => !taken.has(s)) ?? null;
      }
      this.#members.set(id, m);
      this.#system(`${m.name} joined${m.seat ? ` as ${m.seat}` : ' to watch'}.`);
    }
    conn.send({ t: 'welcome', you: m.id, token: m.token, room: this.snapshot() });
    this.#broadcastRoom();
    // Rejoining in the middle of the seed ceremony: ask again.
    const g = this.#game;
    const seat = g ? SEATS.find((s) => g.seats[s] === m!.id) : undefined;
    if (g && g.phase === 'seeding' && seat) {
      if (!g.commits[seat]) conn.send({ t: 'seed-request', gameId: g.id });
      else if (g.commits.X && g.commits.O && !g.nonces[seat]) conn.send({ t: 'reveal-request', gameId: g.id });
    }
    return m;
  }

  #disconnect(m: Member): void {
    m.conn = null;
    const g = this.#game;
    const seat = g ? SEATS.find((s) => g.seats[s] === m.id) : undefined;
    if (g && seat && g.phase === 'seeding') {
      this.#cancelGame(`${m.name} left before the game started.`);
    } else if (g && seat && g.phase === 'playing') {
      this.#system(`${m.name} disconnected — they have ${Math.round(this.#opts.abandonAfterMs / 1000)} s to come back.`);
      this.#timer(`abandon:${m.id}`, this.#opts.abandonAfterMs, () => {
        const cur = this.#game;
        if (!cur || cur !== g || cur.phase !== 'playing' || m.conn) return;
        this.#forceEnd(abandonState(cur.state!, seatPlayer(seat)), `${m.name} did not come back.`);
      });
    } else {
      this.#system(`${m.name} left.`);
    }
    // Watchers who leave are simply forgotten; players keep their seat for a reconnect.
    if (!m.seat && !seat) this.#members.delete(m.id);
    if (m.isOwner) this.#passOwnership(m);
    this.#broadcastRoom();
  }

  #passOwnership(from: Member): void {
    const next = [...this.#members.values()].find((x) => x.conn && x !== from);
    if (!next) return;
    from.isOwner = false;
    next.isOwner = true;
    this.#system(`${next.name} is now the room owner.`);
  }

  #handle(m: Member, msg: ClientMsg): void {
    switch (msg.t) {
      case 'ping':
        m.conn?.send({ t: 'pong', at: Number(msg.at) || 0 });
        return;
      case 'sync':
        m.conn?.send({ t: 'room', room: this.snapshot() });
        return;
      case 'sit':
        return this.#sit(m, msg.seat);
      case 'settings':
        return this.#updateSettings(m, msg.settings);
      case 'start':
        if (!m.isOwner) return this.#err(m, 'not-owner', 'Only the room owner can start the game.');
        return this.#startGame(false);
      case 'commit':
        return this.#commit(m, msg);
      case 'reveal':
        return this.#reveal(m, msg);
      case 'move':
        return this.#move(m, msg);
      case 'resign':
        return this.#resign(m, msg.gameId);
      case 'rematch':
        return this.#rematch(m, msg);
      case 'chat': {
        const text = cleanText(msg.text);
        if (!text || !this.#rateOk(m)) return;
        this.#broadcast({ t: 'chat', from: m.id, name: m.name, text, at: Date.now() });
        return;
      }
      case 'emote':
        if (!(EMOTES as readonly string[]).includes(msg.emote) || !this.#rateOk(m)) return;
        this.#broadcast({ t: 'emote', from: m.id, name: m.name, emote: msg.emote });
        return;
    }
  }

  #err(m: Member, code: string, message: string): void {
    m.conn?.send({ t: 'error', code, message });
  }

  /** At most 6 chat/emote messages per 8 seconds. */
  #rateOk(m: Member): boolean {
    const now = Date.now();
    m.recent = m.recent.filter((t) => now - t < 8000);
    if (m.recent.length >= 6) {
      this.#err(m, 'slow-down', 'Slow down a little!');
      return false;
    }
    m.recent.push(now);
    return true;
  }

  #sit(m: Member, seat: Seat | null): void {
    if (this.#inProgress()) return this.#err(m, 'in-game', "You can't change seats during a game.");
    if (seat !== null && seat !== 'X' && seat !== 'O') return;
    if (seat) {
      const holder = [...this.#members.values()].find((x) => x.seat === seat);
      if (holder && holder !== m) {
        if (holder.conn) return this.#err(m, 'seat-taken', 'That seat is taken.');
        holder.seat = null; // an absent player's seat can be taken
      }
    }
    m.seat = seat;
    this.#broadcastRoom();
  }

  #updateSettings(m: Member, patch: Partial<RoomSettings>): void {
    if (!m.isOwner) return this.#err(m, 'not-owner', 'Only the room owner can change settings.');
    if (this.#inProgress()) return this.#err(m, 'in-game', 'Settings can change between games.');
    this.settings = sanitizeSettings(patch, this.settings);
    this.#broadcastRoom();
  }

  #startGame(swap: boolean): void {
    if (this.#inProgress()) return;
    const prev = this.#game;
    const bySeat = (s: Seat) => [...this.#members.values()].find((x) => x.seat === s);
    let xm = bySeat('X');
    let om = bySeat('O');
    if (swap && prev) {
      xm = this.#members.get(prev.seats.O);
      om = this.#members.get(prev.seats.X);
    }
    if (!xm || !om || !xm.conn || !om.conn) {
      this.#system('Both seats need a connected player to start.');
      return;
    }
    for (const x of this.#members.values()) x.seat = x === xm ? 'X' : x === om ? 'O' : null;
    this.#game = {
      id: `${this.code}-${++this.#gameCounter}`,
      rules: { level: this.settings.level, quanta: this.settings.quanta },
      seats: { X: xm.id, O: om.id },
      names: { X: xm.name, O: om.name },
      phase: 'seeding',
      commits: {},
      nonces: {},
      seed: null,
      moves: [],
      forcedResult: null,
      rematch: { X: false, O: false },
      state: null,
    };
    const gid = this.#game.id;
    this.#broadcastRoom();
    xm.conn.send({ t: 'seed-request', gameId: gid });
    om.conn.send({ t: 'seed-request', gameId: gid });
    this.#timer('seed', this.#opts.seedTimeoutMs, () => {
      if (this.#game?.id === gid && this.#game.phase === 'seeding') this.#cancelGame('Starting the game timed out — try again.');
    });
  }

  #cancelGame(why: string): void {
    this.#clearTimer('seed');
    this.#game = null;
    this.#system(why);
    this.#broadcastRoom();
  }

  #seatOf(m: Member, gameId: unknown): Seat | null {
    const g = this.#game;
    if (!g || g.id !== gameId) return null;
    return SEATS.find((s) => g.seats[s] === m.id) ?? null;
  }

  #commit(m: Member, msg: Extract<ClientMsg, { t: 'commit' }>): void {
    const g = this.#game;
    const seat = this.#seatOf(m, msg.gameId);
    if (!g || !seat || g.phase !== 'seeding' || g.commits[seat]) return;
    if (typeof msg.hash !== 'string' || !/^[0-9a-f]{64}$/.test(msg.hash)) return;
    g.commits[seat] = msg.hash;
    if (g.commits.X && g.commits.O) this.#broadcast({ t: 'reveal-request', gameId: g.id });
  }

  #reveal(m: Member, msg: Extract<ClientMsg, { t: 'reveal' }>): void {
    const g = this.#game;
    const seat = this.#seatOf(m, msg.gameId);
    if (!g || !seat || g.phase !== 'seeding' || !g.commits.X || !g.commits.O || g.nonces[seat]) return;
    if (!verifyReveal(g.commits[seat]!, msg.nonce)) {
      this.#cancelGame(`${m.name}'s dice didn't match their commitment — game cancelled.`);
      return;
    }
    g.nonces[seat] = msg.nonce;
    if (g.nonces.X && g.nonces.O) {
      this.#clearTimer('seed');
      g.seed = combineSeed(g.nonces.X, g.nonces.O);
      g.state = newGame(g.rules, X);
      g.phase = 'playing';
      const { state: _state, ...info } = g;
      this.#broadcast({ t: 'game-start', game: structuredClone(info) });
      this.#broadcastRoom();
    }
  }

  #move(m: Member, msg: Extract<ClientMsg, { t: 'move' }>): void {
    const g = this.#game;
    const seat = this.#seatOf(m, msg.gameId);
    if (!g || !seat || g.phase !== 'playing' || !g.state || !g.seed) return;
    const s = g.state;
    if (seatPlayer(seat) !== s.toMove) return this.#err(m, 'not-your-turn', "It's not your turn.");
    if (msg.ply !== s.ply) return this.#err(m, 'stale', 'That move was for an older position.');
    const move = sanitizeMove(msg.move);
    if (!move) return this.#err(m, 'bad-move', 'Malformed move.');
    const why = whyIllegal(s, move);
    if (why) return this.#err(m, 'illegal', why);
    const out = applyMove(s, move, rngForPly(g.seed, s.ply));
    g.state = out.state;
    g.moves.push(move);
    this.#broadcast({ t: 'moved', gameId: g.id, ply: s.ply, move, by: seat, hash: out.state.q.hash() });
    if (out.state.result) {
      g.phase = 'over';
      this.#gamesPlayed++;
      this.#broadcastRoom();
    }
  }

  #forceEnd(state: GameState, why: string): void {
    const g = this.#game;
    if (!g || !state.result) return;
    g.state = state;
    g.forcedResult = state.result;
    g.phase = 'over';
    this.#gamesPlayed++;
    this.#system(why);
    this.#broadcast({ t: 'game-over', gameId: g.id, result: state.result });
    this.#broadcastRoom();
  }

  #resign(m: Member, gameId: string): void {
    const g = this.#game;
    const seat = this.#seatOf(m, gameId);
    if (!g || !seat) return;
    if (g.phase === 'seeding') return this.#cancelGame(`${m.name} cancelled the game.`);
    if (g.phase !== 'playing' || !g.state) return;
    this.#forceEnd(resignState(g.state, seatPlayer(seat)), `${m.name} resigned.`);
  }

  #rematch(m: Member, msg: Extract<ClientMsg, { t: 'rematch' }>): void {
    const g = this.#game;
    const seat = this.#seatOf(m, msg.gameId);
    if (!g || !seat || g.phase !== 'over') return;
    g.rematch[seat] = msg.want === true;
    if (g.rematch.X && g.rematch.O) {
      const opp = this.#members.get(g.seats[otherSeat(seat)]);
      if (!opp?.conn) return this.#system('Your opponent is not connected.');
      this.#startGame(true);
      return;
    }
    this.#broadcastRoom();
  }
}
