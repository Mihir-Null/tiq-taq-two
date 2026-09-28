/**
 * room-host.ts — the referee of one room. Runs in the room creator's browser
 * (peer-to-peer mode) or in the Node server (server mode) — same code.
 *
 * Responsibilities:
 *   • members: who is here, who sits in the X / O seat, who only watches;
 *   • fair dice: collecting each player's hash-chain anchor at the start and
 *     their per-move values during play (see fair-seed.ts);
 *   • validating every move with the real engine and broadcasting it;
 *   • chat, emotes, rematches, resignations, disconnects and reconnects.
 *
 * It never trusts incoming data: every message is shape-checked, every
 * connection is rate limited, and moves are re-validated by the engine.
 *
 * Transport-agnostic: it talks to "connections" that only need send() and
 * close(). WebSockets, WebRTC data channels and in-memory pipes all fit.
 */

import {
  newGame, applyMove, whyIllegal, needsDice, seededRng, noDice,
  resign as resignState, abandon as abandonState, X, O,
  type GameState, type Move, type Player,
} from '../engine/index.ts';
import {
  PROTOCOL_VERSION, EMOTES, cleanName, cleanText, sanitizeSettings, sanitizeMove,
  type ClientMsg, type HostMsg, type RoomSettings, type RoomSnapshot, type MemberInfo, type GameInfo,
  type Seat, type LobbyEntry,
} from './protocol.ts';
import { makeNonce, isAnchor, verifyChainValue, diceSeed } from './fair-seed.ts';

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
  /** Chain values received for the pending move (kept private until it resolves). */
  pendingDice: Partial<Record<Seat, string>>;
}

export interface RoomHostOptions {
  code: string;
  settings: RoomSettings;
  /** Called whenever something visible in the lobby list changes. */
  onChange?: () => void;
  /** A seated player who stays disconnected this long forfeits. */
  abandonAfterMs?: number;
  /** Max time for both players to commit to their dice at the start. */
  seedTimeoutMs?: number;
  /** A connected player who doesn't send their dice value this long forfeits. */
  revealTimeoutMs?: number;
  maxMembers?: number;
  log?: (...args: unknown[]) => void;
}

const SEATS: Seat[] = ['X', 'O'];
const seatPlayer = (s: Seat): Player => (s === 'X' ? X : O);
const otherSeat = (s: Seat): Seat => (s === 'X' ? 'O' : 'X');
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
    this.#opts = { abandonAfterMs: 90_000, seedTimeoutMs: 20_000, revealTimeoutMs: 45_000, maxMembers: 24, ...opts };
  }

  // ─────────────────────────── connections ─────────────────────────────────

  /** Attach a new connection. Its first message must be `hello`. */
  connect(conn: Conn): ConnHandle {
    let member: Member | null = null;
    // Token bucket: bursts of up to 40 messages, 8 per second sustained. A
    // human never gets near that; a flood is dropped, then disconnected.
    let tokens = 40;
    let last = Date.now();
    let dropped = 0;
    return {
      receive: (raw: unknown) => {
        if (this.#closed) return;
        const now = Date.now();
        tokens = Math.min(40, tokens + ((now - last) * 8) / 1000);
        last = now;
        if (tokens < 1) {
          if (++dropped === 200) conn.close('Too many messages.');
          return;
        }
        tokens -= 1;
        const msg = raw as ClientMsg;
        if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
        try {
          if (!member) {
            if (msg.t !== 'hello') return;
            member = this.#hello(conn, msg);
            if (member) this.#resume(member);
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
        if (!this.#closed && member && member.conn === conn) this.#disconnect(member);
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
    const game = this.#game ? this.#publicGame(this.#game) : null;
    return { code: this.code, settings: { ...this.settings }, members, game, gamesPlayed: this.#gamesPlayed };
  }

  /** Everything about the game that everyone may see (never unrevealed dice). */
  #publicGame(g: HostGame): GameInfo {
    const { state: _state, pendingDice: _secret, ...info } = g;
    return structuredClone(info);
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
      this.#prune();
      if (this.#members.size >= this.#opts.maxMembers) {
        conn.send({ t: 'error', code: 'full', message: 'This room is full.' });
        conn.close('full');
        return null;
      }
      m = { id, token: makeNonce(), name: cleanName(msg.name), seat: null, conn, isOwner: false, recent: [] };
      // Newcomers take a free seat. (A seat whose player has left stays theirs
      // for a reconnect, but anyone present may take it with "Take seat".)
      if (!this.#inProgress()) m.seat = SEATS.find((seat) => !this.#holder(seat)) ?? null;
      this.#members.set(id, m);
      this.#system(`${m.name} joined${m.seat ? ` as ${m.seat}` : ' to watch'}.`);
    }
    // A room always needs someone present who can start games and change rules.
    if (![...this.#members.values()].some((x) => x.isOwner && x.conn)) {
      for (const x of this.#members.values()) x.isOwner = x === m;
    }
    conn.send({ t: 'welcome', you: m.id, token: m.token, room: this.snapshot() });
    this.#broadcastRoom();
    return m;
  }

  /** Back in the middle of a game? Ask again for whatever we were waiting for. */
  #resume(m: Member): void {
    const g = this.#game;
    const seat = g ? SEATS.find((s) => g.seats[s] === m.id) : undefined;
    if (!g || !seat) return;
    if (g.phase === 'seeding' && !g.anchors[seat]) m.conn?.send({ t: 'seed-request', gameId: g.id });
    if (g.phase === 'playing' && g.pending && g.pending.by !== seat && !g.pendingDice[seat]) this.#requestReveal(g, seat);
  }

  #holder(seat: Seat): Member | undefined {
    return [...this.#members.values()].find((x) => x.seat === seat);
  }

  /** Forget members who left and hold nothing (no seat, not in the current game). */
  #prune(): void {
    const g = this.#game;
    for (const [id, x] of this.#members) {
      const inGame = g && (g.seats.X === id || g.seats.O === id) && g.phase !== 'over';
      if (!x.conn && !x.seat && !inGame) this.#members.delete(id);
    }
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
    // Watchers who leave are simply forgotten; players keep their seat for a
    // reconnect (until someone else takes it between games).
    if (!m.seat && !seat) this.#members.delete(m.id);
    if (m.isOwner) this.#passOwnership(m);
    this.#broadcastRoom();
  }

  /** Hand ownership to someone still here. If nobody is, the next arrival gets it (#hello). */
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
      const holder = this.#holder(seat);
      if (holder && holder !== m) {
        if (holder.conn) return this.#err(m, 'seat-taken', 'That seat is taken.');
        // An absent player's seat can be taken; they are then simply gone.
        this.#members.delete(holder.id);
        this.#system(`${m.name} took ${holder.name}'s seat.`);
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
      anchors: {},
      moves: [],
      pending: null,
      forcedResult: null,
      rematch: { X: false, O: false },
      state: null,
      pendingDice: {},
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
    this.#clearTimer('reveal');
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
    if (!g || !seat || g.phase !== 'seeding' || g.anchors[seat] || !isAnchor(msg.anchor)) return;
    g.anchors[seat] = msg.anchor;
    if (!g.anchors.X || !g.anchors.O) return;
    // Both players are bound to their chains: play can begin.
    this.#clearTimer('seed');
    g.state = newGame(g.rules, X);
    g.phase = 'playing';
    this.#broadcast({ t: 'game-start', game: this.#publicGame(g) });
    this.#broadcastRoom();
  }

  #move(m: Member, msg: Extract<ClientMsg, { t: 'move' }>): void {
    const g = this.#game;
    const seat = this.#seatOf(m, msg.gameId);
    if (!g || !seat || g.phase !== 'playing' || !g.state) return;
    const s = g.state;
    if (g.pending) return this.#err(m, 'busy', 'Waiting for the dice of the last move.');
    if (seatPlayer(seat) !== s.toMove) return this.#err(m, 'not-your-turn', "It's not your turn.");
    if (msg.ply !== s.ply) return this.#err(m, 'stale', 'That move was for an older position.');
    const move = sanitizeMove(msg.move);
    if (!move) return this.#err(m, 'bad-move', 'Malformed move.');
    const why = whyIllegal(s, move);
    if (why) return this.#err(m, 'illegal', why);
    // (A chain covers CHAIN_LENGTH moves — far more than the ⚡ limits allow.)
    if (!verifyChainValue(g.anchors[seat], msg.reveal, s.ply)) return this.#err(m, 'bad-dice', "Your dice value doesn't match your commitment — reload the page.");
    if (!needsDice(s, move)) {
      this.#finishMove(g, move, seat, null);
      return;
    }
    // This move rolls dice: now (and only now) the other player adds theirs.
    g.pending = { ply: s.ply, move, by: seat };
    g.pendingDice = { [seat]: msg.reveal };
    const opp = otherSeat(seat);
    this.#requestReveal(g, opp);
    this.#broadcastRoom();
  }

  /** Ask `seat` for its chain value for the pending move; forfeit them if they stall while connected. */
  #requestReveal(g: HostGame, seat: Seat): void {
    const p = g.pending;
    const who = this.#members.get(g.seats[seat]);
    if (!p || !who) return;
    who.conn?.send({ t: 'reveal-request', gameId: g.id, ply: p.ply, move: p.move, by: p.by });
    this.#timer('reveal', this.#opts.revealTimeoutMs, () => {
      const cur = this.#game;
      if (cur !== g || cur.pending !== p || !g.state) return;
      // Disconnected players are handled by the (longer) abandon timer instead.
      if (who.conn) this.#forceEnd(abandonState(g.state, seatPlayer(seat)), `${who.name} did not send their dice.`);
    });
  }

  #reveal(m: Member, msg: Extract<ClientMsg, { t: 'reveal' }>): void {
    const g = this.#game;
    const seat = this.#seatOf(m, msg.gameId);
    const p = g?.pending;
    if (!g || !seat || !p || g.phase !== 'playing' || !g.state || p.by === seat || msg.ply !== p.ply || g.pendingDice[seat]) return;
    if (!verifyChainValue(g.anchors[seat], msg.value, p.ply)) {
      this.#forceEnd(abandonState(g.state, seatPlayer(seat)), `${m.name}'s dice didn't match their commitment.`);
      return;
    }
    this.#clearTimer('reveal');
    const dice = { ...g.pendingDice, [seat]: msg.value } as Record<Seat, string>;
    g.pending = null;
    g.pendingDice = {};
    this.#finishMove(g, p.move, p.by, dice);
  }

  /** Apply an accepted move with its dice (if any) and tell everyone. */
  #finishMove(g: HostGame, move: Move, by: Seat, dice: Record<Seat, string> | null): void {
    const s = g.state!;
    const rng = dice ? seededRng(diceSeed(g.id, s.ply, dice.X, dice.O)) : noDice;
    const out = applyMove(s, move, rng);
    const hash = out.state.q.hash();
    g.state = out.state;
    g.moves.push({ move, by, dice, hash });
    this.#broadcast({ t: 'moved', gameId: g.id, ply: s.ply, move, by, hash, dice });
    if (out.state.result) {
      g.phase = 'over';
      this.#gamesPlayed++;
    }
    this.#broadcastRoom();
  }

  #forceEnd(state: GameState, why: string): void {
    const g = this.#game;
    if (!g || !state.result) return;
    this.#clearTimer('reveal');
    g.state = state;
    g.forcedResult = state.result;
    g.pending = null;
    g.pendingDice = {};
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
