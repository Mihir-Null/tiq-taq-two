/**
 * ws.ts — rooms hosted by your own Node server, over a WebSocket.
 *
 * The socket first asks the server to create or join a room
 * ({t:'srv-create'} / {t:'srv-join'}); once the server answers
 * {t:'srv-joined'}, the same socket carries ordinary room messages.
 */

import { Channel } from './channel.ts';
import { wsUrl } from './config.ts';
import type { ClientMsg, HostMsg, RoomSettings, ServerReply, LobbyEntry } from './protocol.ts';

export function openServerRoom(
  base: string,
  req: { t: 'srv-create'; settings: RoomSettings } | { t: 'srv-join'; code: string },
  timeoutMs = 10000,
): Promise<{ channel: Channel; code: string }> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(base));
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    let joined = false;
    let channel: Channel | null = null;
    const timer = setTimeout(() => {
      if (!joined) {
        ws.close();
        reject(new Error('The server did not answer.'));
      }
    }, timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify(req));
    ws.onerror = () => {
      if (!joined) {
        clearTimeout(timer);
        reject(new Error('Could not connect to the lobby server.'));
      }
    };
    ws.onclose = () => {
      if (!joined) {
        clearTimeout(timer);
        reject(new Error('The lobby server closed the connection.'));
      } else channel?.lost('Lost the connection to the lobby server.');
    };
    ws.onmessage = (e: MessageEvent<string>) => {
      let msg: HostMsg | ServerReply;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!joined) {
        clearTimeout(timer);
        if (msg.t === 'srv-joined') {
          joined = true;
          channel = new Channel(
            (m: ClientMsg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m)),
            () => ws.close(),
          );
          resolve({ channel, code: msg.code });
        } else {
          ws.close();
          reject(new Error(msg.t === 'error' ? msg.message : 'Unexpected server reply.'));
        }
        return;
      }
      channel?.deliver(msg as HostMsg);
    };
  });
}

/** Public rooms listed by the server (GET /api/rooms). */
export async function fetchLobby(base: string): Promise<LobbyEntry[]> {
  const res = await fetch(`${base}/api/rooms`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Server replied ${res.status}`);
  const j = (await res.json()) as { rooms: LobbyEntry[] };
  return j.rooms ?? [];
}
