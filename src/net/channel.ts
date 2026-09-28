/**
 * channel.ts — the client's end of a connection, plus two simple transports:
 *
 *   • loopback:  an in-memory pipe to a RoomHost in the same tab
 *                (the P2P host's own player uses this);
 *   • broadcast: BroadcastChannel between tabs of the same browser — no
 *                network at all. Handy for testing multiplayer alone:
 *                open the app in two tabs and use a "Same browser" room.
 *
 * WebRTC (peer.ts) and WebSocket (ws.ts) produce the same Channel shape, so
 * RoomClient never needs to know how its messages travel.
 */

import type { ClientMsg, HostMsg } from './protocol.ts';
import type { RoomHost, ConnHandle } from './room-host.ts';

export class Channel {
  #onMessage: ((msg: HostMsg) => void) | null = null;
  #onClose: ((reason: string) => void) | null = null;
  #queue: HostMsg[] = [];
  #closed = false;
  #closeReason = '';
  readonly #send: (msg: ClientMsg) => void;
  readonly #close: () => void;

  constructor(send: (msg: ClientMsg) => void, close: () => void) {
    this.#send = send;
    this.#close = close;
  }

  send(msg: ClientMsg): void {
    if (!this.#closed) this.#send(msg);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#close();
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Register handlers. Messages that arrived earlier are delivered now. */
  listen(onMessage: (msg: HostMsg) => void, onClose: (reason: string) => void): void {
    this.#onMessage = onMessage;
    this.#onClose = onClose;
    for (const m of this.#queue.splice(0)) onMessage(m);
    if (this.#closed && this.#closeReason) onClose(this.#closeReason);
  }

  /** Called by the transport when a message arrives. */
  deliver(msg: HostMsg): void {
    if (this.#onMessage) this.#onMessage(msg);
    else this.#queue.push(msg);
  }

  /** Called by the transport when the connection dies. */
  lost(reason: string): void {
    if (this.#closed && this.#closeReason) return;
    this.#closed = true;
    this.#closeReason = reason;
    this.#onClose?.(reason);
  }
}

/** Deep-copy through JSON, exactly like a real network would. */
const wire = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** An in-memory channel to a RoomHost living in this same tab. */
export function loopback(host: RoomHost): Channel {
  let handle: ConnHandle | null = null;
  const ch = new Channel(
    (msg) => queueMicrotask(() => handle?.receive(wire(msg))),
    () => handle?.close(),
  );
  handle = host.connect({
    send: (msg) => queueMicrotask(() => ch.deliver(wire(msg))),
    close: (reason) => ch.lost(reason ?? 'closed'),
  });
  return ch;
}

// ───────────────────────── BroadcastChannel (same browser) ─────────────────

type BcFrame =
  | { k: 'open'; from: string }
  | { k: 'ack'; to: string }
  | { k: 'c2h'; from: string; msg: ClientMsg }
  | { k: 'h2c'; to: string; msg: HostMsg }
  | { k: 'bye'; from: string }
  | { k: 'kill'; to: string; reason: string };

const bcName = (code: string) => `tiq-taq-two:${code}`;

/** Serve `host` to other tabs of this browser. Returns a stop function. */
export function serveBroadcast(host: RoomHost, code: string): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const bc = new BroadcastChannel(bcName(code));
  const peers = new Map<string, ConnHandle>();
  bc.onmessage = (e: MessageEvent<BcFrame>) => {
    const f = e.data;
    if (f.k === 'open') {
      peers.get(f.from)?.close();
      const handle = host.connect({
        send: (msg) => bc.postMessage({ k: 'h2c', to: f.from, msg } satisfies BcFrame),
        close: (reason) => bc.postMessage({ k: 'kill', to: f.from, reason: reason ?? 'closed' } satisfies BcFrame),
      });
      peers.set(f.from, handle);
      bc.postMessage({ k: 'ack', to: f.from } satisfies BcFrame);
    } else if (f.k === 'c2h') peers.get(f.from)?.receive(f.msg);
    else if (f.k === 'bye') {
      peers.get(f.from)?.close();
      peers.delete(f.from);
    }
  };
  return () => {
    for (const [id] of peers) bc.postMessage({ k: 'kill', to: id, reason: 'The host closed the room.' } satisfies BcFrame);
    bc.close();
  };
}

/** Join a room served by another tab of this browser. */
export function connectBroadcast(code: string, timeoutMs = 1500): Promise<Channel> {
  return new Promise((resolve, reject) => {
    if (typeof BroadcastChannel === 'undefined') return reject(new Error('This browser has no BroadcastChannel.'));
    const bc = new BroadcastChannel(bcName(code));
    const me = Math.random().toString(36).slice(2);
    let acked = false;
    const ch = new Channel(
      (msg) => bc.postMessage({ k: 'c2h', from: me, msg } satisfies BcFrame),
      () => {
        bc.postMessage({ k: 'bye', from: me } satisfies BcFrame);
        bc.close();
      },
    );
    bc.onmessage = (e: MessageEvent<BcFrame>) => {
      const f = e.data;
      if (f.k === 'ack' && f.to === me) {
        acked = true;
        resolve(ch);
      } else if (f.k === 'h2c' && f.to === me) ch.deliver(f.msg);
      else if (f.k === 'kill' && f.to === me) ch.lost(f.reason);
    };
    bc.postMessage({ k: 'open', from: me } satisfies BcFrame);
    setTimeout(() => {
      if (!acked) {
        bc.close();
        reject(new Error('No room with that code is open in this browser.'));
      }
    }, timeoutMs);
  });
}
