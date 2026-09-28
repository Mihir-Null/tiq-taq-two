/**
 * room-client.ts — one player's (or spectator's) view of a room.
 *
 * It keeps reactive copies of everything the UI needs (room snapshot, chat,
 * connection status) and replicates the game locally:
 *
 *   'game-start'  → verify the fair seed, build a GameController
 *   'moved'       → apply the move to our own engine copy with the shared
 *                   seed, compare the host's state fingerprint with ours
 *   'room'        → if we somehow fell behind, rebuild from the move list
 *
 * Moves the local player makes go out through NetDriver and only appear on
 * the board once the host has accepted and echoed them.
 */

import { signal, batch } from '@preact/signals';
import { applyMove, rngForPly, newGame, X, O, type Move } from '../engine/index.ts';
import { GameController, type Driver, type SeatInfo, type Snapshot } from '../ui/game/controller.ts';
import { sfx } from '../audio/sfx.ts';
import { makeNonce, commitmentOf, combineSeed, verifyReveal } from './fair-seed.ts';
import { PROTOCOL_VERSION, type HostMsg, type RoomSnapshot, type GameInfo, type Seat, type RoomSettings } from './protocol.ts';
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

class NetDriver implements Driver {
  readonly #client: RoomClient;
  readonly #gameId: string;
  constructor(client: RoomClient, gameId: string) {
    this.#client = client;
    this.#gameId = gameId;
  }
  submit(ctrl: GameController, move: Move): void {
    ctrl.sending.value = true;
    this.#client.send({ t: 'move', gameId: this.#gameId, ply: ctrl.live.value.ply, move });
    const ply = ctrl.live.value.ply;
    setTimeout(() => {
      // No echo after a while? Ask for a full snapshot.
      if (ctrl.sending.value && ctrl.live.value.ply === ply) {
        ctrl.sending.value = false;
        this.#client.send({ t: 'sync' });
      }
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
  #nonces = new Map<string, string>();
  #gameId: string | null = null;
  #seed: string | null = null;
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
      (reason) => this.#onLost(reason),
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
    this.#closedByUs = true;
    clearInterval(this.#pingTimer);
    this.#channel?.close();
    this.ctrl.value?.dispose();
    this.status.value = 'closed';
  }

  async #onLost(reason: string): Promise<void> {
    if (this.#closedByUs || this.status.value === 'closed') return;
    this.status.value = 'reconnecting';
    this.#system(`${reason} Reconnecting…`);
    for (let attempt = 0; attempt < 5 && !this.#closedByUs; attempt++) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
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

  amOwner(): boolean {
    const r = this.room.value;
    return r?.members.find((m) => m.id === this.me.value)?.isOwner ?? false;
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
    if (this.#gameId) this.send({ t: 'resign', gameId: this.#gameId });
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
      case 'seed-request': {
        const nonce = makeNonce();
        this.#nonces.set(msg.gameId, nonce);
        this.seeding.value = 'Agreeing on fair dice…';
        this.send({ t: 'commit', gameId: msg.gameId, hash: commitmentOf(nonce) });
        return;
      }
      case 'reveal-request': {
        const nonce = this.#nonces.get(msg.gameId);
        if (nonce) this.send({ t: 'reveal', gameId: msg.gameId, nonce });
        return;
      }
      case 'game-start':
        this.seeding.value = null;
        if (!this.#verifySeed(msg.game)) return;
        this.#buildGame(msg.game);
        sfx.join();
        return;
      case 'moved':
        this.#onMoved(msg);
        return;
      case 'game-over':
        if (msg.gameId === this.#gameId) this.ctrl.value?.endWith(msg.result);
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
          this.#closedByUs = true;
          this.status.value = 'closed';
        }
        if (msg.code === 'illegal' || msg.code === 'stale' || msg.code === 'not-your-turn') {
          const c = this.ctrl.value;
          if (c) {
            c.sending.value = false;
            c.say(msg.message, true);
          }
          this.send({ t: 'sync' });
        }
        return;
      case 'closed':
        this.#closedByUs = true;
        this.error.value = msg.reason;
        this.status.value = 'closed';
        return;
      case 'pong':
        this.latency.value = Math.round(performance.now() - msg.at);
        return;
    }
  }

  /** Check the host's seed ceremony ourselves — never just trust it. */
  #verifySeed(g: GameInfo): boolean {
    const ok =
      !!g.seed && !!g.commits.X && !!g.commits.O && !!g.nonces.X && !!g.nonces.O &&
      verifyReveal(g.commits.X, g.nonces.X) && verifyReveal(g.commits.O, g.nonces.O) &&
      combineSeed(g.nonces.X, g.nonces.O) === g.seed;
    if (!ok) {
      this.error.value = 'The dice could not be verified — the game data does not add up.';
      this.#system('⚠ Seed verification failed. Leaving is recommended.');
    }
    // Our own commitment must be the one the host recorded.
    const mySeat = (['X', 'O'] as Seat[]).find((s) => g.seats[s] === this.me.value);
    const mine = mySeat ? this.#nonces.get(g.id) : undefined;
    if (mySeat && mine && g.nonces[mySeat] !== mine) {
      this.error.value = 'The host altered your dice commitment!';
      return false;
    }
    return ok;
  }

  /** Make sure the local controller matches the host's game description. */
  #syncGame(g: GameInfo | null): void {
    if (!g || g.phase === 'seeding') {
      if (g?.phase === 'seeding' && !this.seeding.value) this.seeding.value = 'Starting the game…';
      if (!g && this.ctrl.value) {
        this.ctrl.value.dispose();
        this.ctrl.value = null;
        this.#gameId = null;
      }
      return;
    }
    this.seeding.value = null;
    const c = this.ctrl.value;
    const upToDate = c && this.#gameId === g.id && c.snapshots.value.length - 1 === g.moves.length;
    if (!upToDate) {
      if (!this.#verifySeed(g)) return;
      this.#buildGame(g);
    } else if (g.forcedResult) c!.endWith(g.forcedResult);
    // Seat names may change (reconnects) — keep them fresh.
    const cc = this.ctrl.value;
    if (cc) cc.hintsAllowed.value = !!this.room.value?.settings.hints && this.mySeat() !== null;
  }

  #buildGame(g: GameInfo): void {
    if (!g.seed) return;
    const me = this.me.value;
    const seat = (s: Seat): SeatInfo => {
      const local = g.seats[s] === me;
      return { kind: local ? 'human' : 'remote', name: g.names[s], local };
    };
    const old = this.ctrl.value;
    const sameGame = old && this.#gameId === g.id;
    // Replay every move with the shared seed to rebuild the history.
    const snaps: Snapshot[] = [{ state: newGame(g.rules, X), move: null, mover: null, events: [] }];
    for (const move of g.moves) {
      const s = snaps[snaps.length - 1].state;
      const out = applyMove(s, move, rngForPly(g.seed, s.ply));
      snaps.push({ state: out.state, move, mover: s.toMove, events: out.events });
    }
    if (g.forcedResult) {
      const last = snaps[snaps.length - 1];
      last.state = { ...last.state, result: g.forcedResult };
    }
    this.#seed = g.seed;
    this.#gameId = g.id;
    if (sameGame) {
      old!.resetHistory(snaps);
      old!.sending.value = false;
      return;
    }
    old?.dispose();
    const ctrl = new GameController({
      rules: g.rules,
      seats: { [X]: seat('X'), [O]: seat('O') },
      driver: new NetDriver(this, g.id),
      hintsAllowed: !!this.room.value?.settings.hints && (g.seats.X === me || g.seats.O === me),
      undoAllowed: false,
    });
    ctrl.resetHistory(snaps);
    this.ctrl.value = ctrl;
  }

  #onMoved(msg: Extract<HostMsg, { t: 'moved' }>): void {
    const c = this.ctrl.value;
    if (!c || msg.gameId !== this.#gameId || !this.#seed) {
      this.send({ t: 'sync' });
      return;
    }
    const s = c.live.value;
    if (msg.ply < s.ply) return; // duplicate
    if (msg.ply > s.ply) {
      this.send({ t: 'sync' }); // we missed something
      return;
    }
    const out = applyMove(s, msg.move, rngForPly(this.#seed, s.ply));
    c.sending.value = false;
    if (out.state.q.hash() !== msg.hash) {
      console.warn('desync detected — resyncing');
      this.#system('Out of sync with the host — resynchronising.');
      this.send({ t: 'sync' });
      return;
    }
    c.accept(msg.move, s.toMove, out);
  }
}

