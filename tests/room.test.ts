import { describe, expect, it, vi } from 'vitest';
import { RoomHost, type ConnHandle } from '../src/net/room-host.ts';
import { makeNonce, makeChain, anchorOf, chainValue, verifyChainValue, CHAIN_LENGTH } from '../src/net/fair-seed.ts';
import { sha256Hex } from '../src/net/sha256.ts';
import {
  PROTOCOL_VERSION, DEFAULT_ROOM_SETTINGS, cleanName,
  type HostMsg, type ClientMsg, type Seat, type GameInfo,
} from '../src/net/protocol.ts';
import { Channel } from '../src/net/channel.ts';
import { newGame, applyMove, noDice, X, O, type GameState, type Move } from '../src/engine/index.ts';

// The real RoomClient pulls in the game controller, which pulls in the bot's
// Web Worker. Tests never need the bot, so replace it with a stub.
vi.mock('../src/ai/client.ts', () => ({
  ai: {
    move: () => Promise.reject(new Error('no bot in tests')),
    hints: () => Promise.resolve([]),
  },
}));
const { RoomClient, clientId, verifyMove } = await import('../src/net/room-client.ts');

const tick = () => new Promise((r) => setTimeout(r, 0));
const wire = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/**
 * A minimal scripted client: records what it receives and plays the dice
 * protocol honestly (unless told to misbehave).
 */
class FakeClient {
  inbox: HostMsg[] = [];
  handle: ConnHandle;
  id: string;
  token = '';
  chain = makeChain();
  /** Send wrong chain values. */
  cheat = false;
  /** Ignore reveal requests. */
  silent = false;
  closed = false;
  constructor(host: RoomHost, name: string, id = makeNonce(), token?: string, chain?: string[]) {
    this.id = id;
    if (chain) this.chain = chain;
    this.handle = host.connect({
      send: (m) => {
        const msg = wire(m);
        this.inbox.push(msg);
        if (msg.t === 'welcome') this.token = msg.token;
        if (msg.t === 'seed-request') this.send({ t: 'commit', gameId: msg.gameId, anchor: anchorOf(this.chain) });
        if (msg.t === 'reveal-request' && !this.silent) this.send({ t: 'reveal', gameId: msg.gameId, ply: msg.ply, value: this.value(msg.ply) });
      },
      close: () => (this.closed = true),
    });
    this.send({ t: 'hello', v: PROTOCOL_VERSION, clientId: id, name, token });
  }
  value(ply: number): string {
    return this.cheat ? makeNonce() : chainValue(this.chain, ply)!;
  }
  send(m: ClientMsg) {
    this.handle.receive(wire(m));
  }
  move(gameId: string, ply: number, move: Move) {
    this.send({ t: 'move', gameId, ply, move, reveal: this.value(ply) });
  }
  last<T extends HostMsg['t']>(t: T): Extract<HostMsg, { t: T }> | undefined {
    return [...this.inbox].reverse().find((m) => m.t === t) as Extract<HostMsg, { t: T }> | undefined;
  }
  all<T extends HostMsg['t']>(t: T): Extract<HostMsg, { t: T }>[] {
    return this.inbox.filter((m) => m.t === t) as Extract<HostMsg, { t: T }>[];
  }
  get room() {
    return this.last('room')?.room ?? this.last('welcome')?.room;
  }
}

function setup(opts: { revealTimeoutMs?: number } = {}) {
  const host = new RoomHost({
    code: 'TEST1', settings: { ...DEFAULT_ROOM_SETTINGS, level: 3, quanta: 3 },
    abandonAfterMs: 50, seedTimeoutMs: 200, ...opts,
  });
  const a = new FakeClient(host, 'Alice');
  const b = new FakeClient(host, 'Bob');
  return { host, a, b };
}

/** Replay a game's move records like a client would; returns the final state. */
function replay(g: GameInfo): GameState {
  let s = newGame(g.rules, X);
  for (const rec of g.moves) {
    const out = verifyMove(g, s, rec);
    if (typeof out === 'string') throw new Error(out);
    s = out.state;
  }
  return s;
}

/** Split X over ①③, O on ⑤, X links ⑦ with ⑤ … then O observes ⑦: a move that rolls dice. */
function playToObserve(a: FakeClient, b: FakeClient, gid: string) {
  a.move(gid, 0, { kind: 'split', a: 0, b: 2 });
  b.move(gid, 1, { kind: 'place', cell: 4 });
  a.move(gid, 2, { kind: 'link', a: 6, b: 4 });
  b.move(gid, 3, { kind: 'observe', cell: 6 });
}

describe('sha256 and hash chains', () => {
  it('matches known SHA-256 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });

  it('verifies chain values only for their own move number', () => {
    const chain = makeChain();
    const anchor = anchorOf(chain);
    for (const ply of [0, 1, 7, CHAIN_LENGTH - 1]) {
      expect(verifyChainValue(anchor, chainValue(chain, ply), ply)).toBe(true);
      expect(verifyChainValue(anchor, chainValue(chain, ply), ply + 1)).toBe(false);
    }
    expect(verifyChainValue(anchor, makeNonce(), 0)).toBe(false);
    expect(verifyChainValue(anchor, chainValue(chain, 0), -1)).toBe(false);
    expect(chainValue(chain, CHAIN_LENGTH)).toBeNull();
    // Revealing move 5's value discloses moves 0–4 (hash forwards) but never move 6.
    expect(verifyChainValue(chainValue(chain, 4), chainValue(chain, 5), 0)).toBe(true);
  });
});

describe('room host', () => {
  it('seats the first two players and makes the first the owner', () => {
    const { a, b } = setup();
    expect(b.room!.members.map((m) => [m.name, m.seat, m.isOwner])).toEqual([
      ['Alice', 'X', true],
      ['Bob', 'O', false],
    ]);
    expect(a.last('welcome')?.you).toBe(a.id);
  });

  it('starts once both players committed to their dice, and plays a verified game', () => {
    const { host, a, b } = setup();
    a.send({ t: 'start' });
    const g = b.last('game-start')!.game;
    expect(g.anchors).toEqual({ X: anchorOf(a.chain), O: anchorOf(b.chain) });
    const gid = g.id;

    a.move(gid, 0, { kind: 'split', a: 0, b: 2 });
    b.move(gid, 1, { kind: 'place', cell: 4 });
    a.move(gid, 2, { kind: 'link', a: 6, b: 4 });
    // None of those rolled dice, so nobody was asked for a value.
    expect(a.all('reveal-request')).toHaveLength(0);
    expect(b.all('reveal-request')).toHaveLength(0);
    expect(host.snapshot().game!.moves.map((m) => m.dice)).toEqual([null, null, null]);

    // An Observe rolls dice: only now is the OTHER player asked, and only for this move.
    b.move(gid, 3, { kind: 'observe', cell: 6 });
    const req = a.last('reveal-request')!;
    expect(req).toMatchObject({ gameId: gid, ply: 3, move: { kind: 'observe', cell: 6 }, by: 'O' });
    expect(b.all('reveal-request')).toHaveLength(0);
    const moved = a.last('moved')!;
    expect(moved.ply).toBe(3);
    expect(moved.dice).toEqual({ X: chainValue(a.chain, 3), O: chainValue(b.chain, 3) });

    // Every client can replay the whole game from the record and get the same board.
    const g2 = host.snapshot().game!;
    expect(replay(g2).q.hash()).toBe(moved.hash);

    // Out-of-turn, stale, illegal and malformed moves are refused with a reason.
    const ply = g2.moves.length;
    b.move(gid, ply, { kind: 'place', cell: 1 });
    expect(b.last('error')?.code).toBe('not-your-turn');
    a.move(gid, 0, { kind: 'place', cell: 1 });
    expect(a.last('error')?.code).toBe('stale');
    a.move(gid, ply, { kind: 'place', cell: 0 });
    expect(a.last('error')?.code).toBe('illegal');
    a.move(gid, ply, { kind: 'teleport' } as unknown as Move);
    expect(a.last('error')?.code).toBe('bad-move');
    expect(host.snapshot().game?.moves).toHaveLength(4);
  });

  it('keeps the mover’s dice value secret until the move resolves', () => {
    const { host, a, b } = setup();
    a.silent = true; // X will be slow to answer
    a.send({ t: 'start' });
    const gid = a.last('game-start')!.game.id;
    playToObserve(a, b, gid);
    const snap = host.snapshot().game!;
    expect(snap.pending).toMatchObject({ ply: 3, by: 'O' });
    expect(JSON.stringify(snap)).not.toContain(chainValue(b.chain, 3)!);
    expect(JSON.stringify(a.last('reveal-request'))).not.toContain(chainValue(b.chain, 3)!);
    // Moves wait for the dice.
    a.move(gid, 4, { kind: 'place', cell: 8 });
    expect(a.last('error')?.code).toBe('busy');
  });

  it('refuses a move whose dice value does not match, and forfeits a cheating answer', () => {
    const { a, b } = setup();
    a.send({ t: 'start' });
    const gid = a.last('game-start')!.game.id;
    a.cheat = true;
    a.move(gid, 0, { kind: 'place', cell: 4 });
    expect(a.last('error')?.code).toBe('bad-dice');
    a.cheat = false;
    a.move(gid, 0, { kind: 'split', a: 0, b: 2 });
    b.move(gid, 1, { kind: 'place', cell: 4 });
    a.move(gid, 2, { kind: 'link', a: 6, b: 4 });
    a.cheat = true; // X answers the dice request with garbage
    b.move(gid, 3, { kind: 'observe', cell: 6 });
    expect(b.last('game-over')?.result).toMatchObject({ winner: O, reason: 'abandon' });
  });

  it('forfeits a connected player who never sends their dice', async () => {
    const { a, b } = setup({ revealTimeoutMs: 40 });
    a.silent = true;
    a.send({ t: 'start' });
    playToObserve(a, b, a.last('game-start')!.game.id);
    expect(b.last('game-over')).toBeUndefined();
    await new Promise((r) => setTimeout(r, 80));
    expect(b.last('game-over')?.result).toMatchObject({ winner: O, reason: 'abandon' });
  });

  it('asks a reconnecting player again for the dice it is waiting for', () => {
    const { host, a, b } = setup();
    a.silent = true;
    a.send({ t: 'start' });
    const gid = a.last('game-start')!.game.id;
    playToObserve(a, b, gid);
    a.handle.close();
    const back = new FakeClient(host, 'Alice', a.id, a.token, a.chain);
    // The honest client answers the repeated request on arrival.
    expect(back.last('reveal-request')?.ply).toBe(3);
    expect(back.last('moved')?.ply).toBe(3);
    expect(host.snapshot().game!.pending).toBeNull();
    void b;
  });

  it('lets a player reconnect with their token, but not impersonate', async () => {
    const { host, a } = setup();
    a.send({ t: 'start' });
    a.handle.close();
    expect(host.snapshot().members.find((m) => m.id === a.id)?.connected).toBe(false);
    const thief = new FakeClient(host, 'Mallory', a.id, 'wrong-token');
    expect(thief.last('error')?.code).toBe('duplicate');
    const back = new FakeClient(host, 'Alice', a.id, a.token);
    expect(back.last('welcome')?.room.members.find((m) => m.id === a.id)?.seat).toBe('X');
    await tick();
  });

  it('handles resignation and swaps seats on rematch', () => {
    const { a, b } = setup();
    a.send({ t: 'start' });
    const g = a.last('game-start')!.game;
    b.send({ t: 'resign', gameId: g.id });
    expect(a.last('game-over')?.result.winner).toBe(X);
    a.send({ t: 'rematch', gameId: g.id, want: true });
    b.send({ t: 'rematch', gameId: g.id, want: true });
    const g2 = a.last('game-start')!.game;
    expect(g2.id).not.toBe(g.id);
    const seatOf = (id: string): Seat => (g2.seats.X === id ? 'X' : 'O');
    expect(seatOf(a.id)).toBe('O');
    expect(seatOf(b.id)).toBe('X');
  });

  it('gives late spectators the whole verifiable move list', () => {
    const { host, a, b } = setup();
    a.send({ t: 'start' });
    const gid = a.last('game-start')!.game.id;
    playToObserve(a, b, gid);
    const c = new FakeClient(host, 'Carol');
    const room = c.last('welcome')!.room;
    expect(room.members.find((m) => m.name === 'Carol')?.seat).toBeNull();
    expect(room.game?.moves).toHaveLength(4);
    expect(replay(room.game!).q.hash()).toBe(a.last('moved')!.hash);
  });

  it('awards the game when a player abandons it', async () => {
    const { a, b } = setup();
    a.send({ t: 'start' });
    b.handle.close();
    await new Promise((r) => setTimeout(r, 120));
    expect(a.last('game-over')?.result.reason).toBe('abandon');
    expect(a.last('game-over')?.result.winner).toBe(X);
  });

  it('lets someone take the seat of a player who left, and keeps the room owned', () => {
    const { host, a, b } = setup();
    b.handle.close();
    const c = new FakeClient(host, 'Carol');
    expect(c.room!.members.find((m) => m.id === c.id)?.seat).toBeNull(); // Bob may come back…
    c.send({ t: 'sit', seat: 'O' }); // …but Carol can take the seat
    expect(host.snapshot().members.map((m) => m.name)).toEqual(['Alice', 'Carol']);
    // The owner leaves while alone: the next person to arrive runs the room.
    c.handle.close();
    a.handle.close();
    const d = new FakeClient(host, 'Dave');
    expect(d.room!.members.find((m) => m.id === d.id)?.isOwner).toBe(true);
  });

  it('does not fill up with ghosts when people come and go', () => {
    const { host } = setup();
    for (let i = 0; i < 60; i++) new FakeClient(host, `Visitor ${i}`).handle.close();
    expect(host.snapshot().members.length).toBeLessThanOrEqual(3);
    expect(new FakeClient(host, 'Late').last('error')).toBeUndefined();
  });

  it('rate-limits chat, sanitises text and drops floods', () => {
    const { a, b } = setup();
    for (let i = 0; i < 10; i++) a.send({ t: 'chat', text: `  hi\u0007 ${i}  ` });
    const chats = b.all('chat');
    expect(chats).toHaveLength(6);
    expect(chats[0].text).toBe('hi  0');
    expect(a.last('error')?.code).toBe('slow-down');
    for (let i = 0; i < 400; i++) b.send({ t: 'sync' });
    expect(b.all('room').length).toBeLessThan(60);
    expect(b.closed).toBe(true);
  });

  it('strips invisible characters from names', () => {
    expect(cleanName('Al​ice‮')).toBe('Alice');
    expect(cleanName('👩‍💻 Ada')).toBe('👩‍💻 Ada');
  });
});

describe('room client (the player’s side)', () => {
  /** A real RoomClient wired to a scripted — possibly malicious — host. */
  function scripted() {
    const sent: ClientMsg[] = [];
    const ch = new Channel((m) => sent.push(wire(m)), () => undefined);
    const client = new RoomClient('p2p', 'ABCDE', 'Guest', () => Promise.reject(new Error('no reopen')));
    client.attach(ch);
    const me = clientId();
    const hostChain = makeChain();
    const game: GameInfo = {
      id: 'ABCDE-1', rules: { level: 2, quanta: 2 }, seats: { X: 'host', O: me }, names: { X: 'Host', O: 'Guest' },
      phase: 'playing', anchors: { X: anchorOf(hostChain) }, moves: [], pending: null, forcedResult: null, rematch: { X: false, O: false },
    };
    const room = (g: GameInfo | null) => ({
      code: 'ABCDE', settings: { ...DEFAULT_ROOM_SETTINGS, level: 2 as const, quanta: 2 },
      members: [
        { id: 'host', name: 'Host', seat: 'X' as Seat, connected: true, isOwner: true },
        { id: me, name: 'Guest', seat: 'O' as Seat, connected: true, isOwner: false },
      ],
      game: g, gamesPlayed: 0,
    });
    ch.deliver({ t: 'welcome', you: me, token: 'tok', room: room(null) });
    ch.deliver({ t: 'seed-request', gameId: game.id });
    const commit = sent.find((m) => m.t === 'commit') as Extract<ClientMsg, { t: 'commit' }>;
    game.anchors.O = commit.anchor;
    ch.deliver({ t: 'game-start', game: wire(game) });
    return { sent, ch, client, game, hostChain, room };
  }

  it('only reveals its dice for the opponent’s actual next move', () => {
    const { sent, ch, client, game } = scripted();
    const reveals = () => sent.filter((m) => m.t === 'reveal');
    // A future move number, a move that rolls no dice, or a request for "my own" move: refused.
    ch.deliver({ t: 'reveal-request', gameId: game.id, ply: 5, move: { kind: 'place', cell: 4 }, by: 'X' });
    ch.deliver({ t: 'reveal-request', gameId: game.id, ply: 0, move: { kind: 'place', cell: 4 }, by: 'X' });
    ch.deliver({ t: 'reveal-request', gameId: game.id, ply: 0, move: { kind: 'place', cell: 4 }, by: 'O' });
    expect(reveals()).toHaveLength(0);
    expect(client.ctrl.value).not.toBeNull();
  });

  it('checks every move itself, and notices rewritten history', () => {
    const { ch, client, game, room } = scripted();
    const ctrl = client.ctrl.value!;
    const move: Move = { kind: 'place', cell: 4 };
    const hash = hashAfterPlace(game);
    // A wrong fingerprint is caught…
    expect(verifyMove(game, ctrl.live.value, { move, by: 'X', dice: null, hash: 'x' })).toBe('a different board than ours');
    // …an honest move is applied.
    ch.deliver({ t: 'moved', gameId: game.id, ply: 0, move, by: 'X', hash, dice: null });
    expect(ctrl.snapshots.value).toHaveLength(2);
    // A later snapshot that swaps that move for another is refused, loudly.
    const other: Move = { kind: 'place', cell: 0 };
    const otherHash = applyMove(newGame(game.rules, X), other, noDice).state.q.hash();
    const s1 = applyMove(newGame(game.rules, X), other, noDice).state;
    const next: Move = { kind: 'place', cell: 8 };
    const forged: GameInfo = {
      ...game,
      moves: [
        { move: other, by: 'X', dice: null, hash: otherHash },
        { move: next, by: 'O', dice: null, hash: applyMove(s1, next, noDice).state.q.hash() },
      ],
    };
    ch.deliver({ t: 'room', room: room(forged) });
    expect(client.error.value).toMatch(/rewrote/);
    expect(ctrl.snapshots.value[1].move).toEqual(move);
  });

  it('rejects dice values that do not match the players’ commitments', () => {
    const { ch, client, game, room } = scripted();
    // Build a legal game up to an Observe, then attach made-up dice to it.
    let s = newGame(game.rules, X);
    const moves: Move[] = [{ kind: 'split', a: 0, b: 2 }, { kind: 'place', cell: 4 }, { kind: 'link', a: 6, b: 4 }];
    const recs = moves.map((move, i) => {
      s = applyMove(s, move, noDice).state;
      return { move, by: (i % 2 === 0 ? 'X' : 'O') as Seat, dice: null, hash: s.q.hash() };
    });
    const fakeDice = { X: makeNonce(), O: makeNonce() };
    const observe: Move = { kind: 'observe', cell: 6 };
    ch.deliver({ t: 'room', room: room({ ...game, moves: [...recs, { move: observe, by: 'O', dice: fakeDice, hash: 'x' }] }) });
    expect(client.error.value).toMatch(/dice that don't match/);
  });

  it('flags a forced result that cannot be true', () => {
    const { ch, client, game } = scripted();
    ch.deliver({ t: 'game-over', gameId: game.id, result: { winner: X, xLines: 0, oLines: 0, code: null, certain: true, reason: 'resign' } });
    expect(client.chat.value.some((l) => /you resigned — you didn't/.test(l.text))).toBe(true);
  });
});

/** Fingerprint after X places on ⑤ in a fresh game (no dice involved). */
function hashAfterPlace(g: GameInfo): string {
  return applyMove(newGame(g.rules, X), { kind: 'place', cell: 4 }, noDice).state.q.hash();
}
