/**
 * session.ts — creating and joining rooms, for each kind of backend:
 *
 *   p2p    peer-to-peer (WebRTC). The room host runs in the creator's tab.
 *          Works on any static host (GitHub Pages). Closing the host tab
 *          closes the room.
 *   srv    your Node lobby server. The room host runs on the server, rooms
 *          survive anyone's tab closing, and public rooms are listed.
 *   local  two tabs of the same browser (BroadcastChannel) — for testing.
 *
 * The current session lives in a module-level signal, so you can wander
 * around the app (read the Codex mid-game!) without leaving your room.
 */

import { signal } from '@preact/signals';
import { RoomHost } from './room-host.ts';
import { loopback, serveBroadcast, connectBroadcast, type Channel } from './channel.ts';
import { hostP2P, connectP2P, CodeTakenError } from './peer.ts';
import { openServerRoom } from './ws.ts';
import { RoomClient, type Backend } from './room-client.ts';
import { makeRoomCode, type RoomSettings } from './protocol.ts';

export interface Session {
  backend: Backend;
  code: string;
  client: RoomClient;
  /** True when the room's host runs in this tab (P2P / local creator). */
  hosting: boolean;
  close(): void;
}

export const activeSession = signal<Session | null>(null);

export function leaveSession(): void {
  activeSession.value?.close();
  activeSession.value = null;
}

function track(session: Session): Session {
  activeSession.value?.close();
  activeSession.value = session;
  return session;
}

/** Create a room and connect to it as its first member (the owner). */
export async function createRoom(backend: Backend, settings: RoomSettings, name: string, serverBase?: string): Promise<Session> {
  if (backend === 'srv') {
    if (!serverBase) throw new Error('No lobby server available.');
    const { channel, code } = await openServerRoom(serverBase, { t: 'srv-create', settings });
    const client = new RoomClient('srv', code, name, async () => (await openServerRoom(serverBase, { t: 'srv-join', code })).channel);
    client.attach(channel);
    return track({ backend, code, client, hosting: false, close: () => client.close() });
  }

  // P2P and same-browser rooms: the referee runs right here in this tab.
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = makeRoomCode();
    const host = new RoomHost({ code, settings });
    let stop: () => void;
    try {
      if (backend === 'p2p') {
        const h = await hostP2P(host, code, (problem) => console.warn(problem));
        stop = () => h.close();
      } else {
        stop = serveBroadcast(host, code);
      }
    } catch (err) {
      if (err instanceof CodeTakenError) continue; // astronomically rare: pick another code
      throw err;
    }
    const client = new RoomClient(backend, code, name, async () => loopback(host));
    client.attach(loopback(host));
    const close = () => {
      client.close();
      host.close('The host closed the room.');
      stop();
    };
    // Warn before closing the tab: the room lives here.
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (host.connectedCount > 1) e.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return track({
      backend,
      code,
      client,
      hosting: true,
      close: () => {
        window.removeEventListener('beforeunload', beforeUnload);
        close();
      },
    });
  }
  throw new Error('Could not find a free room code — try again.');
}

/** Join an existing room by code. */
export async function joinRoom(backend: Backend, code: string, name: string, serverBase?: string): Promise<Session> {
  const existing = activeSession.value;
  if (existing && existing.backend === backend && existing.code === code) return existing;
  let open: () => Promise<Channel>;
  if (backend === 'srv') {
    if (!serverBase) throw new Error('No lobby server available.');
    open = async () => (await openServerRoom(serverBase, { t: 'srv-join', code })).channel;
  } else if (backend === 'p2p') {
    open = () => connectP2P(code);
  } else {
    open = () => connectBroadcast(code);
  }
  const channel = await open();
  const client = new RoomClient(backend, code, name, open);
  client.attach(channel);
  return track({ backend, code, client, hosting: false, close: () => client.close() });
}
