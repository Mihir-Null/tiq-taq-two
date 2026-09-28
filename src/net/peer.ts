/**
 * peer.ts — peer-to-peer rooms over WebRTC, using PeerJS.
 *
 * WebRTC lets two browsers exchange data directly, but they first need a
 * "signalling" service to find each other (swap connection offers). PeerJS
 * provides a free public signalling server, so this works on a purely static
 * host like GitHub Pages:
 *
 *   host tab:  new Peer("tiq-taq-two-K7Q2X")   ← the room code IS the address
 *   guest tab: new Peer().connect("tiq-taq-two-K7Q2X")
 *
 * After the handshake, game messages flow browser-to-browser; the signalling
 * server never sees them. Behind very strict NATs a direct path may be
 * impossible — configure a TURN server via VITE_ICE_SERVERS in that case.
 */

import Peer, { type DataConnection } from 'peerjs';
import { Channel } from './channel.ts';
import { peerConfig } from './config.ts';
import type { RoomHost, ConnHandle } from './room-host.ts';
import type { ClientMsg, HostMsg } from './protocol.ts';

const PREFIX = 'tiq-taq-two-';
export const peerIdFor = (code: string): string => `${PREFIX}${code}`;

export class CodeTakenError extends Error {}

function friendly(err: { type?: string; message?: string }): string {
  switch (err.type) {
    case 'peer-unavailable':
      return 'No room with that code — check the code, or ask the host to create a new room.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Could not reach the peer-to-peer signalling server. Check your connection (or try server rooms).';
    case 'browser-incompatible':
      return 'This browser does not support WebRTC.';
    case 'webrtc':
      return 'The direct connection failed (a firewall or strict NAT may be blocking it).';
    default:
      return err.message || 'Peer-to-peer connection failed.';
  }
}

export interface P2PHostHandle {
  close(): void;
}

/** Serve `host` to the world under its room code. Rejects with CodeTakenError if the code is in use. */
export function hostP2P(host: RoomHost, code: string, onProblem: (text: string) => void): Promise<P2PHostHandle> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerIdFor(code), peerConfig());
    let opened = false;
    const conns = new Set<DataConnection>();
    peer.on('open', () => {
      opened = true;
      resolve({
        close: () => {
          for (const c of conns) c.close();
          peer.destroy();
        },
      });
    });
    peer.on('error', (err) => {
      if (!opened) {
        peer.destroy();
        reject(err.type === 'unavailable-id' ? new CodeTakenError(code) : new Error(friendly(err)));
      } else if (err.type !== 'peer-unavailable') {
        onProblem(friendly(err));
      }
    });
    // Losing the signalling server does not break existing data connections,
    // but new guests couldn't find us — try to reconnect quietly.
    peer.on('disconnected', () => {
      setTimeout(() => {
        if (!peer.destroyed) {
          try {
            peer.reconnect();
          } catch {
            /* ignore */
          }
        }
      }, 1500);
    });
    peer.on('connection', (dc) => {
      let handle: ConnHandle | null = null;
      conns.add(dc);
      dc.on('open', () => {
        handle = host.connect({
          send: (msg: HostMsg) => {
            if (dc.open) void dc.send(msg);
          },
          close: () => dc.close(),
        });
      });
      dc.on('data', (d) => handle?.receive(d));
      const gone = () => {
        conns.delete(dc);
        handle?.close();
        handle = null;
      };
      dc.on('close', gone);
      dc.on('error', gone);
    });
  });
}

/** Connect to a P2P room as a guest. */
export function connectP2P(code: string, timeoutMs = 15000): Promise<Channel> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerConfig());
    let settled = false;
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      peer.destroy();
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail('Timed out connecting to the room.'), timeoutMs);
    peer.on('error', (err) => fail(friendly(err)));
    peer.on('open', () => {
      const dc = peer.connect(peerIdFor(code), { reliable: true, serialization: 'json' });
      const ch = new Channel(
        (msg: ClientMsg) => {
          if (dc.open) void dc.send(msg);
        },
        () => {
          dc.close();
          setTimeout(() => peer.destroy(), 200);
        },
      );
      dc.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ch);
      });
      dc.on('data', (d) => ch.deliver(d as HostMsg));
      dc.on('close', () => ch.lost('The connection to the host was lost.'));
      dc.on('error', () => ch.lost('The connection to the host failed.'));
    });
  });
}
