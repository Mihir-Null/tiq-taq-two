import { describe, expect, it } from 'vitest';
import { RoomHost, type ConnHandle } from '../src/net/room-host.ts';
import { commitmentOf, combineSeed, makeNonce, verifyReveal } from '../src/net/fair-seed.ts';
import { sha256Hex } from '../src/net/sha256.ts';
import { PROTOCOL_VERSION, DEFAULT_ROOM_SETTINGS, type HostMsg, type ClientMsg, type Seat } from '../src/net/protocol.ts';
import { applyMove, newGame, rngForPly, X, type GameState, type Move } from '../src/engine/index.ts';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A minimal scripted client: records what it receives, answers the seed ceremony. */
class FakeClient {
  inbox: HostMsg[] = [];
  handle: ConnHandle;
  id: string;
  token = '';
  nonce = makeNonce();
  cheat = false;
  closed = false;
  constructor(host: RoomHost, name: string, id = makeNonce(), token?: string) {
    this.id = id;
    this.handle = host.connect({
      send: (m) => {
        const msg = JSON.parse(JSON.stringify(m)) as HostMsg;
        this.inbox.push(msg);
        if (msg.t === 'welcome') this.token = msg.token;
        if (msg.t === 'seed-request') this.send({ t: 'commit', gameId: msg.gameId, hash: commitmentOf(this.nonce) });
        if (msg.t === 'reveal-request') this.send({ t: 'reveal', gameId: msg.gameId, nonce: this.cheat ? makeNonce() : this.nonce });
      },
      close: () => (this.closed = true),
    });
    this.send({ t: 'hello', v: PROTOCOL_VERSION, clientId: id, name, token });
  }
  send(m: ClientMsg) {
    this.handle.receive(JSON.parse(JSON.stringify(m)));
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

function setup() {
  const host = new RoomHost({ code: 'TEST1', settings: { ...DEFAULT_ROOM_SETTINGS, level: 3, quanta: 3 }, abandonAfterMs: 50, seedTimeoutMs: 200 });
  const a = new FakeClient(host, 'Alice');
  const b = new FakeClient(host, 'Bob');
  return { host, a, b };
}

describe('sha256', () => {
  it('matches known test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });
  it('verifies reveals', () => {
    const n = makeNonce();
    expect(verifyReveal(commitmentOf(n), n)).toBe(true);
    expect(verifyReveal(commitmentOf(n), makeNonce())).toBe(false);
  });
});

describe('room host', () => {
  it('seats the first two players and makes the first the owner', () => {
    const { a, b } = setup();
    const room = b.room!;
    expect(room.members.map((m) => [m.name, m.seat, m.isOwner])).toEqual([
      ['Alice', 'X', true],
      ['Bob', 'O', false],
    ]);
    expect(a.last('welcome')?.you).toBe(a.id);
  });

  it('runs the fair-seed ceremony and a verified game', () => {
    const { host, a, b } = setup();
    a.send({ t: 'start' });
    const start = b.last('game-start')!;
    expect(start).toBeDefined();
    const g = start.game;
    expect(g.seed).toBe(combineSeed(a.nonce, b.nonce));
    expect(verifyReveal(g.commits.X!, g.nonces.X!)).toBe(true);

    // Replay locally, like a real client, and compare fingerprints.
    let local: GameState = newGame(g.rules, X);
    const play = (who: FakeClient, move: Move) => {
      who.send({ t: 'move', gameId: g.id, ply: local.ply, move });
      const echo = a.last('moved')!;
      expect(echo.ply).toBe(local.ply);
      local = applyMove(local, move, rngForPly(g.seed!, local.ply)).state;
      expect(echo.hash).toBe(local.q.hash());
    };
    play(a, { kind: 'split', a: 0, b: 2 });
    play(b, { kind: 'place', cell: 4 });
    play(a, { kind: 'link', a: 6, b: 4 });

    // Out-of-turn, stale and illegal moves are refused with a reason.
    b.send({ t: 'move', gameId: g.id, ply: local.ply, move: { kind: 'place', cell: 0 } });
    expect(b.last('error')?.code).toBe('illegal');
    a.send({ t: 'move', gameId: g.id, ply: local.ply, move: { kind: 'place', cell: 1 } });
    expect(a.last('error')?.code).toBe('not-your-turn');
    b.send({ t: 'move', gameId: g.id, ply: 0, move: { kind: 'place', cell: 1 } });
    expect(b.last('error')?.code).toBe('stale');
    b.send({ t: 'move', gameId: g.id, ply: local.ply, move: { kind: 'teleport' } as unknown as Move });
    expect(b.last('error')?.code).toBe('bad-move');
    expect(host.snapshot().game?.moves).toHaveLength(3);
  });

  it('cancels the game when a reveal does not match its commitment', () => {
    const { a, b } = setup();
    b.cheat = true;
    a.send({ t: 'start' });
    expect(a.last('game-start')).toBeUndefined();
    expect(a.all('system').some((m) => /didn't match/.test(m.text))).toBe(true);
    expect(a.room?.game).toBeNull();
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

  it('gives late spectators the whole move list', () => {
    const { host, a, b } = setup();
    a.send({ t: 'start' });
    const g = a.last('game-start')!.game;
    a.send({ t: 'move', gameId: g.id, ply: 0, move: { kind: 'place', cell: 4 } });
    const c = new FakeClient(host, 'Carol');
    const room = c.last('welcome')!.room;
    expect(room.members.find((m) => m.name === 'Carol')?.seat).toBeNull();
    expect(room.game?.moves).toEqual([{ kind: 'place', cell: 4 }]);
    expect(room.game?.seed).toBe(combineSeed(a.nonce, b.nonce));
  });

  it('awards the game when a player abandons it', async () => {
    const { a, b } = setup();
    a.send({ t: 'start' });
    b.handle.close();
    await new Promise((r) => setTimeout(r, 120));
    expect(a.last('game-over')?.result.reason).toBe('abandon');
    expect(a.last('game-over')?.result.winner).toBe(X);
  });

  it('rate-limits chat and sanitises text', () => {
    const { a, b } = setup();
    for (let i = 0; i < 10; i++) a.send({ t: 'chat', text: `  hi\u0007 ${i}  ` });
    const chats = b.all('chat');
    expect(chats).toHaveLength(6);
    expect(chats[0].text).toBe('hi  0');
    expect(a.last('error')?.code).toBe('slow-down');
  });
});
