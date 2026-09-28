/**
 * room-client.ts — one player's (or spectator's) view of a room.
 *
 * It keeps reactive copies of everything the UI needs (room snapshot, chat,
 * connection status) and replicates the game locally:
 *
 *   'seed-request'   → build a secret hash chain, send only its anchor
 *   'reveal-request' → the opponent's move rolls dice: check that move, then
 *                      send our chain value for it (see fair-seed.ts)
 *   'moved'          → re-check the move and both dice values ourselves,
 *                      apply it to our own engine, compare fingerprints
 *   'room'           → if we fell behind, rebuild — verifying every move
 *
 * Moves the local player makes go out through NetDriver and only appear on
 * the board once the host has accepted and echoed them.
 *
 * Trust: we never take the host's word for dice or history. Whatever it
 * sends is replayed with our own engine, and any mismatch is reported.
 */

import { signal, batch } from '@preact/signals';
import {
  applyMove, needsDice, seededRng, noDice, whyIllegal, sameMove, newGame, X, O,
  type GameState, type Move, type MoveOutcome, type Player, type GameResult,
} from '../engine/index.ts';
import { GameController, type Driver, type SeatInfo, type Snapshot } from '../ui/game/controller.ts';
import { sfx } from '../audio/sfx.ts';
import { makeNonce, makeChain, anchorOf, chainValue, verifyChainValue, diceSeed } from './fair-seed.ts';
import {
  PROTOCOL_VERSION, sanitizeMove,
  type HostMsg, type RoomSnapshot, type GameInfo, type Seat, type RoomSettings, type MoveRecord,
} from './protocol.ts';
import type { Channel } from './channel.ts';

export type Backend = 'p2p' | 'srv' | 'local';
export type Status = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface ChatLine {
  id: number;
  kind: 'chat' | 'system';
  name?: string;
  text: string;
  at: number;
  mine?: boolean;
}

let lineIds = 1;

const seatPlayer = (s: Seat): Player => (s === 'X' ? X : O);

/**
 * A random id for this browser TAB. It survives reloads (sessionStorage), so
 * refreshing mid-game reclaims your seat, while two tabs count as two
 * different people — handy for testing with the "Same browser" rooms.
 */
let memoryId: string | null = null;
export function clientId(): string {
  try {
    let id = sessionStorage.getItem('tq2.clientId');
    if (!id) {
      id = makeNonce();
      sessionStorage.setItem('tq2.clientId', id);
    }
    return id;
  } catch {
    return (memoryId ??= makeNonce());
  }
}

const tokenKey = (backend: Backend, code: string) => `tq2.token.${backend}.${code}`;
const chainKey = (backend: Backend, code: string, gameId: string) => `tq2.chain.${backend}.${code}.${gameId}`;

/**
 * Replay one recorded move on top of `s`, checking everything: right player,
 * legal move, dice values that match both players' chains, same fingerprint.
 * Returns the outcome, or a description of what doesn't add up.
 */
export function verifyMove(g: Pick<GameInfo, 'id' | 'anchors'>, s: GameState, rec: MoveRecord): MoveOutcome | string {
  if (rec.by !== 'X' && rec.by !== 'O') return 'a move by nobody';
  if (seatPlayer(rec.by) !== s.toMove) return 'a move by the wrong player';
  const move = sanitizeMove(rec.move);
  if (!move || whyIllegal(s, move)) return 'an illegal move';
  let rng: () => number = noDice;
  if (needsDice(s, move)) {
    const d = rec.dice;
    if (!d || !verifyChainValue(g.anchors.X, d.X, s.ply) || !verifyChainValue(g.anchors.O, d.O, s.ply)) {
      return "dice that don't match the players' commitments";
    }
    rng = seededRng(diceSeed(g.id, s.ply, d.X, d.O));
  }
  const out = applyMove(s, move, rng);
  if (out.state.q.hash() !== rec.hash) return 'a different board than ours';
  return out;
}

class NetDriver implements Driver {
  readonly #client: RoomClient;
  readonly #gameId: string;
  constructor(client: RoomClient, gameId: string) {
    this.#client = client;
    this.#gameId = gameId;
  }
  submit(ctrl: GameController, move: Move): void {
    const ply = ctrl.live.value.ply;
    const reveal = this.#client.chainValueFor(this.#gameId, ply);
    if (!reveal) {
      ctrl.say("This tab lost its dice for this game (was it opened elsewhere?) — you can't move from here.", true);
      return;
    }
    ctrl.sending.value = true;
    this.#client.send({ t: 'move', gameId: this.#gameId, ply, move, reveal });
    setTimeout(() => {
      // No echo after a while? Ask for a snapshot; it tells us whether the
      // move is waiting for dice or got lost.
      if (ctrl.sending.value && ctrl.live.value.ply === ply) this.#client.send({ t: 'sync' });
    }, 8000);
  }
}

export class RoomClient {
  readonly backend: Backend;
  readonly code: string;
  readonly status = signal<Status>('connecting');
  readonly error = signal<string | null>(null);
  readonly me = signal<string | null>(null);
  readonly room = signal<RoomSnapshot | null>(null);
  readonly chat = signal<ChatLine[]>([]);
  readonly unread = signal(0);
  readonly ctrl = signal<GameController | null>(null);
  readonly emote = signal<{ id: number; emote: string; name: string } | null>(null);
  readonly latency = signal<number | null>(null);
  /** Seed-ceremony progress for the UI. */
  readonly seeding = signal<string | null>(null);
  chatVisible = false;

  #channel: Channel | null = null;
  #reopen: () => Promise<Channel>;
  #name: string;
  /** Our secret hash chain per game id. */
  #chains = new Map<string, string[]>();
  /** Moves we sent our dice for, by move number — the host may not swap them afterwards. */
  #revealed = new Map<number, Move>();
  /** Games we resigned ourselves. */
  #resigned = new Set<string>();
  #gameId: string | null = null;
  #game: GameInfo | null = null;
  #closedByUs = false;
  #pingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(backend: Backend, code: string, name: string, reopen: () => Promise<Channel>) {
    this.backend = backend;
    this.code = code;
    this.#name = name;
    this.#reopen = reopen;
  }

  /** Start using an already-open channel. */
  attach(channel: Channel): void {
    this.#channel = channel;
    channel.listen(
      (msg) => this.#onMessage(msg),
      (reason) => void this.#onLost(reason),
    );
    let token: string | undefined;
    try {
      token = sessionStorage.getItem(tokenKey(this.backend, this.code)) ?? undefined;
    } catch {
      /* ignore */
    }
    channel.send({ t: 'hello', v: PROTOCOL_VERSION, clientId: clientId(), name: this.#name, token });
    clearInterval(this.#pingTimer);
    this.#pingTimer = setInterval(() => this.send({ t: 'ping', at: performance.now() }), 10000);
  }

  send(msg: Parameters<Channel['send']>[0]): void {
    this.#channel?.send(msg);
  }

  close(): void {
    this.#stop();
    this.ctrl.value?.dispose();
  }

  /** Terminal: no more reconnects, timers or transport. */
  #stop(): void {
    this.#closedByUs = true;
    clearInterval(this.#pingTimer);
    this.#channel?.close();
    this.status.value = 'closed';
  }

  async #onLost(reason: string): Promise<void> {
    if (this.#closedByUs || this.status.value === 'closed') return;
    clearInterval(this.#pingTimer);
    this.status.value = 'reconnecting';
    this.#system(`${reason} Reconnecting…`);
    for (let attempt = 0; attempt < 5 && !this.#closedByUs; attempt++) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      if (this.#closedByUs) return;
      try {
        const ch = await this.#reopen();
        if (this.#closedByUs) {
          ch.close();
          return;
        }
        this.attach(ch);
        return;
      } catch {
        /* try again */
      }
    }
    this.status.value = 'closed';
    this.error.value = reason;
  }

  // ─────────────────────────── derived helpers ─────────────────────────────

  mySeat(): Seat | null {
    const r = this.room.value;
    const me = this.me.value;
    return r?.members.find((m) => m.id === me)?.seat ?? null;
  }

  /** My seat in the current game (seats in the lobby can differ between games). */
  #gameSeat(g: Pick<GameInfo, 'seats'> | null = this.#game): Seat | null {
    if (!g) return null;
    const me = this.me.value;
    return g.seats.X === me ? 'X' : g.seats.O === me ? 'O' : null;
  }

  amOwner(): boolean {
    const r = this.room.value;
    return r?.members.find((m) => m.id === this.me.value)?.isOwner ?? false;
  }

  // ─────────────────────────── dice ────────────────────────────────────────

  #chain(gameId: string): string[] | null {
    let chain = this.#chains.get(gameId);
    if (!chain) {
      // After a page reload the secret comes back from sessionStorage.
      try {
        const secret = sessionStorage.getItem(chainKey(this.backend, this.code, gameId));
        if (secret) this.#chains.set(gameId, (chain = makeChain(secret)));
      } catch {
        /* ignore */
      }
    }
    return chain ?? null;
  }

  /** My chain value for move number `ply` of game `gameId`. */
  chainValueFor(gameId: string, ply: number): string | null {
    const chain = this.#chain(gameId);
    return chain ? chainValue(chain, ply) : null;
  }

  #onSeedRequest(gameId: string): void {
    let chain = this.#chain(gameId);
    if (!chain) {
      const secret = makeNonce();
      chain = makeChain(secret);
      this.#chains.set(gameId, chain);
      try {
        sessionStorage.setItem(chainKey(this.backend, this.code, gameId), secret);
      } catch {
        /* the game still works until this tab reloads */
      }
    }
    this.seeding.value = 'Agreeing on fair dice…';
    this.send({ t: 'commit', gameId, anchor: anchorOf(chain) });
  }

  /**
   * The opponent's move rolls dice and the host wants our value. Only answer
   * for the move that is actually next, and only once per move number —
   * otherwise a cheating host could learn our future values early.
   */
  #onRevealRequest(msg: Extract<HostMsg, { t: 'reveal-request' }>): void {
    const c = this.ctrl.value;
    const g = this.#game;
    const mine = this.#gameSeat();
    if (!c || !g || msg.gameId !== g.id || !mine || msg.by === mine) return;
    const s = c.live.value;
    const move = sanitizeMove(msg.move);
    if (msg.ply !== s.ply || seatPlayer(msg.by) !== s.toMove || !move || whyIllegal(s, move) || !needsDice(s, move)) return;
    const earlier = this.#revealed.get(msg.ply);
    if (earlier && !sameMove(earlier, move)) {
      this.#alarm('The host tried to change a move after seeing your dice.');
      return;
    }
    const value = this.chainValueFor(g.id, msg.ply);
    if (!value) return;
    this.#revealed.set(msg.ply, move);
    this.send({ t: 'reveal', gameId: g.id, ply: msg.ply, value });
  }

  // ─────────────────────────── actions ─────────────────────────────────────

  sit(seat: Seat | null): void {
    this.send({ t: 'sit', seat });
  }
  start(): void {
    this.send({ t: 'start' });
  }
  updateSettings(settings: Partial<RoomSettings>): void {
    this.send({ t: 'settings', settings });
  }
  resign(): void {
    if (!this.#gameId) return;
    this.#resigned.add(this.#gameId);
    this.send({ t: 'resign', gameId: this.#gameId });
  }
  rematch(want: boolean): void {
    if (this.#gameId) this.send({ t: 'rematch', gameId: this.#gameId, want });
  }
  say(text: string): void {
    if (text.trim()) this.send({ t: 'chat', text });
  }
  react(emote: string): void {
    this.send({ t: 'emote', emote });
  }

  // ─────────────────────────── incoming ────────────────────────────────────

  #system(text: string): void {
    this.#push({ id: lineIds++, kind: 'system', text, at: Date.now() });
  }

  /** Something the host sent doesn't add up: tell the player, loudly. */
  #alarm(text: string): void {
    this.error.value = text;
    this.#system(`⚠ ${text}`);
  }

  #push(line: ChatLine): void {
    this.chat.value = [...this.chat.value.slice(-199), line];
    if (!this.chatVisible && line.kind === 'chat' && !line.mine) this.unread.value++;
  }

  #onMessage(msg: HostMsg): void {
    switch (msg.t) {
      case 'welcome':
        batch(() => {
          this.me.value = msg.you;
          this.status.value = 'open';
          this.error.value = null;
          this.room.value = msg.room;
        });
        try {
          sessionStorage.setItem(tokenKey(this.backend, this.code), msg.token);
        } catch {
          /* ignore */
        }
        this.#syncGame(msg.room.game);
        return;
      case 'room':
        this.room.value = msg.room;
        this.#syncGame(msg.room.game);
        return;
      case 'seed-request':
        this.#onSeedRequest(msg.gameId);
        return;
      case 'reveal-request':
        this.#onRevealRequest(msg);
        return;
      case 'game-start':
        this.seeding.value = null;
        this.#syncGame(msg.game);
        sfx.join();
        return;
      case 'moved':
        this.#onMoved(msg);
        return;
      case 'game-over':
        if (msg.gameId !== this.#gameId) return;
        this.#checkForcedResult(msg.result);
        this.ctrl.value?.endWith(msg.result);
        return;
      case 'chat': {
        const mine = msg.from === this.me.value;
        this.#push({ id: lineIds++, kind: 'chat', name: msg.name, text: msg.text, at: msg.at, mine });
        if (!mine) sfx.chat();
        return;
      }
      case 'emote':
        this.emote.value = { id: lineIds++, emote: msg.emote, name: msg.name };
        return;
      case 'system':
        this.#system(msg.text);
        return;
      case 'error':
        this.#system(`⚠ ${msg.message}`);
        if (['version', 'duplicate', 'full'].includes(msg.code)) {
          this.error.value = msg.message;
          this.#stop();
        }
        if (['illegal', 'stale', 'not-your-turn', 'busy', 'bad-dice', 'bad-move'].includes(msg.code)) {
          const c = this.ctrl.value;
          if (c) {
            c.sending.value = false;
            c.say(msg.message, true);
          }
          this.send({ t: 'sync' });
        }
        return;
      case 'closed':
        this.error.value = msg.reason;
        this.#stop();
        return;
      case 'pong':
        this.latency.value = Math.round(performance.now() - msg.at);
        return;
    }
  }

  /** A result from outside the engine (resignation, abandonment) — is it plausible? */
  #checkForcedResult(r: GameResult): void {
    const mine = this.#gameSeat();
    if (!mine || !this.#gameId || r.winner === null || r.winner === seatPlayer(mine)) return;
    if (r.reason === 'resign' && !this.#resigned.has(this.#gameId)) {
      this.#system("⚠ The host says you resigned — you didn't. Treat this result with suspicion.");
    }
    if (r.reason === 'abandon' && this.status.value === 'open') {
      this.#system("⚠ The host says you left the game — but you're connected. Treat this result with suspicion.");
    }
  }

  /** Make sure the local controller matches the host's game description. */
  #syncGame(g: GameInfo | null): void {
    if (!g || g.phase === 'seeding') {
      if (g?.phase === 'seeding' && !this.seeding.value) this.seeding.value = 'Starting the game…';
      if (!g) this.seeding.value = null;
      if (!g && this.ctrl.value) {
        this.ctrl.value.dispose();
        this.ctrl.value = null;
        this.#gameId = null;
        this.#game = null;
      }
      return;
    }
    this.seeding.value = null;
    const c = this.ctrl.value;
    const known = c && this.#gameId === g.id ? c.snapshots.value.length - 1 : -1;
    if (known > g.moves.length) return; // an older snapshot overtaken by moves we already have
    if (known !== g.moves.length && !this.#buildGame(g)) return;
    this.#game = g;
    const cc = this.ctrl.value;
    if (!cc) return;
    if (g.forcedResult && !cc.live.value.result) {
      this.#checkForcedResult(g.forcedResult);
      cc.endWith(g.forcedResult);
    }
    // Our own move may be waiting for the opponent's dice: keep the board locked.
    const mine = this.#gameSeat(g);
    cc.sending.value = !!g.pending && g.pending.by === mine;
    cc.hintsAllowed.value = !!this.room.value?.settings.hints && mine !== null;
  }

  /** Build (or rebuild) the local game from the host's move list, verifying every move. */
  #buildGame(g: GameInfo): boolean {
    if (!g.anchors.X || !g.anchors.O) return false;
    const me = this.me.value;
    const old = this.ctrl.value;
    const sameGame = !!old && this.#gameId === g.id;
    const snaps: Snapshot[] = [{ state: newGame(g.rules, X), move: null, mover: null, events: [] }];
    for (const rec of g.moves) {
      const s = snaps[snaps.length - 1].state;
      const out = verifyMove(g, s, rec);
      if (typeof out === 'string') {
        this.#alarm(`The game data from the host contains ${out} at move ${s.ply + 1}. A different app version, or tampering — reload both pages.`);
        return false;
      }
      snaps.push({ state: out.state, move: rec.move, mover: s.toMove, events: out.events });
    }
    if (sameGame) {
      // History may only grow: the moves we already showed must still be there.
      const had = old!.snapshots.value;
      for (let i = 1; i < had.length; i++) {
        const a = had[i].move;
        const b = snaps[i]?.move;
        if (!a || !b || !sameMove(a, b)) {
          this.#alarm('The host rewrote moves that were already played. Leaving is recommended.');
          return false;
        }
      }
    }
    if (g.forcedResult) {
      const last = snaps[snaps.length - 1];
      last.state = { ...last.state, result: g.forcedResult };
    }
    this.#gameId = g.id;
    this.#game = g;
    if (sameGame) {
      old!.resetHistory(snaps);
      old!.sending.value = false;
      return true;
    }
    this.#revealed.clear();
    old?.dispose();
    const seat = (s: Seat): SeatInfo => {
      const local = g.seats[s] === me;
      return { kind: local ? 'human' : 'remote', name: g.names[s], local };
    };
    const ctrl = new GameController({
      rules: g.rules,
      seats: { [X]: seat('X'), [O]: seat('O') },
      driver: new NetDriver(this, g.id),
      hintsAllowed: !!this.room.value?.settings.hints && (g.seats.X === me || g.seats.O === me),
      undoAllowed: false,
    });
    ctrl.resetHistory(snaps);
    this.ctrl.value = ctrl;
    return true;
  }

  #onMoved(msg: Extract<HostMsg, { t: 'moved' }>): void {
    const c = this.ctrl.value;
    const g = this.#game;
    if (!c || !g || msg.gameId !== this.#gameId) {
      this.send({ t: 'sync' });
      return;
    }
    const s = c.live.value;
    if (msg.ply < s.ply) return; // duplicate
    if (msg.ply > s.ply) {
      this.send({ t: 'sync' }); // we missed something
      return;
    }
    const promised = this.#revealed.get(msg.ply);
    if (promised && !sameMove(promised, msg.move)) {
      this.#alarm('The host played a different move than the one you sent your dice for.');
      return;
    }
    const out = verifyMove(g, s, { move: msg.move, by: msg.by, dice: msg.dice, hash: msg.hash });
    c.sending.value = false;
    if (typeof out === 'string') {
      // A fresh snapshot either fixes a glitch or shows the real problem.
      this.#system(`Out of sync with the host (${out}) — resynchronising.`);
      this.send({ t: 'sync' });
      return;
    }
    c.accept(msg.move, s.toMove, out);
  }
}
