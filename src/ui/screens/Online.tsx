/**
 * Online.tsx — create or join a room.
 *
 * Two ways to play online:
 *   • Peer-to-peer — works on any static host (GitHub Pages). The room lives
 *     in the creator's browser tab; share the code or link.
 *   • Lobby server — if a Tiq Taq Two server is reachable, rooms live on the
 *     server and public rooms are listed here for anyone to join or watch.
 */

import { useEffect, useState } from 'preact/hooks';
import { LEVELS, ALL_LEVELS, type Level } from '../../engine/index.ts';
import { settings, updateSettings, displayName } from '../../app/store.ts';
import { navigate } from '../../app/router.ts';
import { toast } from '../../app/ui-state.ts';
import { findServer, probeServer, P2P_ENABLED, type ServerInfo } from '../../net/config.ts';
import { fetchLobby } from '../../net/ws.ts';
import { createRoom, joinRoom, activeSession } from '../../net/session.ts';
import { normalizeCode, DEFAULT_ROOM_SETTINGS, type LobbyEntry, type RoomSettings } from '../../net/protocol.ts';
import type { Backend } from '../../net/room-client.ts';
import { Icon } from '../components/Icon.tsx';

/** Remember the lobby server between screens. */
let serverCache: { info: ServerInfo | null; at: number } | null = null;

export function useServer(): { info: ServerInfo | null; checking: boolean; recheck: () => void } {
  const [info, setInfo] = useState<ServerInfo | null>(serverCache?.info ?? null);
  const [checking, setChecking] = useState(!serverCache);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    if (serverCache && n === 0 && Date.now() - serverCache.at < 30000) return;
    setChecking(true);
    void findServer().then((s) => {
      serverCache = { info: s, at: Date.now() };
      if (live) {
        setInfo(s);
        setChecking(false);
      }
    });
    return () => {
      live = false;
    };
  }, [n]);
  return { info, checking, recheck: () => setN((x) => x + 1) };
}

const BACKEND_INFO: Record<Backend, { name: string; icon: string; desc: string }> = {
  p2p: { name: 'Peer-to-peer', icon: 'share', desc: 'Direct browser-to-browser. No server needed; the room lives in your tab.' },
  srv: { name: 'Lobby server', icon: 'globe', desc: 'Hosted on the server: listed publicly, survives tab closes.' },
  local: { name: 'Same browser', icon: 'layers', desc: 'Two tabs of this browser, no network — for testing.' },
};

export function OnlineHub() {
  const { info: server, checking, recheck } = useServer();
  const [room, setRoom] = useState<RoomSettings>({ ...DEFAULT_ROOM_SETTINGS, name: `${displayName()}'s room` });
  const [backend, setBackend] = useState<Backend>(P2P_ENABLED ? 'p2p' : 'srv');
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [lobby, setLobby] = useState<LobbyEntry[] | null>(null);
  const [customUrl, setCustomUrl] = useState(settings.value.customServer);
  const session = activeSession.value;

  // Prefer the server when one is available.
  useEffect(() => {
    if (server && backend === 'p2p' && !P2P_ENABLED) setBackend('srv');
  }, [server]);

  // Poll the public lobby list.
  useEffect(() => {
    if (!server) return;
    let live = true;
    const load = () => fetchLobby(server.base).then((l) => live && setLobby(l)).catch(() => live && setLobby(null));
    void load();
    const t = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [server]);

  const name = displayName();
  const go = (b: Backend, c: string) => navigate(`/room/${b}/${c}`);

  const create = async () => {
    setBusy('Creating room…');
    try {
      const s = await createRoom(backend, room, name, server?.base);
      go(s.backend, s.code);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create the room.', 'bad', 6000);
    } finally {
      setBusy(null);
    }
  };

  const join = async (c: string, b?: Backend) => {
    const clean = normalizeCode(c);
    if (clean.length < 4) return toast('Room codes have 5 characters.', 'bad');
    setBusy('Joining…');
    // Try the server first (if any), then peer-to-peer, then same-browser tabs.
    const order: Backend[] = b ? [b] : [...(server ? ['srv' as const] : []), ...(P2P_ENABLED ? ['p2p' as const] : []), 'local'];
    let lastErr = '';
    for (const be of order) {
      try {
        const s = await joinRoom(be, clean, name, server?.base);
        setBusy(null);
        go(s.backend, s.code);
        return;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
    }
    setBusy(null);
    toast(lastErr || 'Room not found.', 'bad', 6000);
  };

  const saveCustom = async () => {
    const url = customUrl.trim().replace(/\/+$/, '');
    if (url && !(await probeServer(url))) {
      toast('No Tiq Taq Two server answered at that address.', 'bad');
      return;
    }
    updateSettings({ customServer: url });
    serverCache = null;
    recheck();
    toast(url ? 'Server saved' : 'Using the default server', 'good');
  };

  const backends: Backend[] = [...(P2P_ENABLED ? ['p2p' as const] : []), ...(server ? ['srv' as const] : []), 'local'];

  return (
    <div class="screen online">
      <div class="screen-head">
        <h2>
          <Icon name="globe" /> Play online
        </h2>
        <label class="text-row inline">
          <span class="small muted">Playing as</span>
          <input type="text" maxLength={20} value={settings.value.playerName} placeholder="Anonymous qubit" onInput={(e) => updateSettings({ playerName: (e.target as HTMLInputElement).value })} style={{ maxWidth: '200px' }} />
        </label>
      </div>

      {session && (
        <div class="room-banner">
          <span class="status-dot ok" /> You're in room <strong>{session.code}</strong>.
          <button class="btn small primary" onClick={() => go(session.backend, session.code)}>
            Return to room
          </button>
        </div>
      )}

      <div class="online-grid">
        <div class="form-grid">
          <section class="card">
            <h3>
              <Icon name="sparkle" size={18} /> Create a room
            </h3>
            <div class="form-grid">
              <label>
                Room name
                <input type="text" maxLength={40} value={room.name} onInput={(e) => setRoom({ ...room, name: (e.target as HTMLInputElement).value })} />
              </label>
              <div class="level-list">
                {ALL_LEVELS.map((lv: Level) => (
                  <button key={lv} class={`level-choice lv${lv} ${room.level === lv ? 'on' : ''}`} onClick={() => setRoom({ ...room, level: lv, quanta: LEVELS[lv].defaultQuanta })}>
                    <span class="lv-num">{lv}</span>
                    <span class="lv-text">
                      <strong>{LEVELS[lv].name}</strong>
                      <span class="small muted">{LEVELS[lv].tagline}</span>
                    </span>
                  </button>
                ))}
              </div>
              {LEVELS[room.level].features.observe && (
                <label class="range-row">
                  <span>
                    <Icon name="bolt" size={14} /> Quanta each: <strong>{room.quanta}</strong>
                  </span>
                  <input type="range" min="0" max="6" value={room.quanta} onInput={(e) => setRoom({ ...room, quanta: Number((e.target as HTMLInputElement).value) })} />
                </label>
              )}
              <label class="toggle">
                <input type="checkbox" checked={room.hints} onChange={(e) => setRoom({ ...room, hints: (e.target as HTMLInputElement).checked })} />
                <span class="switch" />
                <span>Allow hints (great for teaching)</span>
              </label>
              <div class="choice-row">
                {backends.map((b) => (
                  <button key={b} class={`choice ${backend === b ? 'on' : ''}`} onClick={() => setBackend(b)}>
                    <Icon name={BACKEND_INFO[b].icon} size={20} />
                    <strong>{BACKEND_INFO[b].name}</strong>
                    <span class="small muted">{BACKEND_INFO[b].desc}</span>
                  </button>
                ))}
              </div>
              {backend === 'srv' && (
                <label class="toggle">
                  <input type="checkbox" checked={room.isPublic} onChange={(e) => setRoom({ ...room, isPublic: (e.target as HTMLInputElement).checked })} />
                  <span class="switch" />
                  <span>List publicly in the lobby</span>
                </label>
              )}
              <button class="btn primary big" disabled={!!busy} onClick={() => void create()}>
                {busy === 'Creating room…' ? busy : (<><Icon name="play" size={18} /> Create room</>)}
              </button>
            </div>
          </section>
        </div>

        <div class="form-grid">
          <section class="card">
            <h3>
              <Icon name="users" size={18} /> Join with a code
            </h3>
            <form
              class="row gap"
              onSubmit={(e) => {
                e.preventDefault();
                void join(code);
              }}
            >
              <input class="code-input" type="text" maxLength={8} value={code} placeholder="K7Q2X" onInput={(e) => setCode(normalizeCode((e.target as HTMLInputElement).value))} aria-label="Room code" />
              <button class="btn primary" type="submit" disabled={!!busy || code.length < 4}>
                {busy === 'Joining…' ? busy : 'Join'}
              </button>
            </form>
            <p class="small muted">Got a link instead? Just open it — it drops you straight into the room.</p>
          </section>

          <section class="card">
            <h3>
              <span class={`status-dot ${checking ? 'wait' : server ? 'ok' : 'bad'}`} />
              {checking ? 'Looking for a lobby server…' : server ? server.name : 'No lobby server'}
            </h3>
            {server ? (
              <>
                <p class="small muted">
                  {server.rooms} room{server.rooms === 1 ? '' : 's'} · {server.players} player{server.players === 1 ? '' : 's'} online
                </p>
                <div class="lobby-list">
                  {lobby === null && <p class="small muted">Loading public rooms…</p>}
                  {lobby?.length === 0 && <p class="small muted">No public rooms yet — create one!</p>}
                  {lobby?.map((r) => (
                    <div key={r.code} class="lobby-row">
                      <div>
                        <div class="lobby-name">{r.name}</div>
                        <div class="lobby-meta">
                          <span class={`level-pill lv${r.level}`}>L{r.level} {LEVELS[r.level].name}</span>
                          <span>{r.players.join(' vs ') || 'empty'}</span>
                          {r.spectators > 0 && <span><Icon name="observe" size={12} /> {r.spectators}</span>}
                          <span>{r.status}</span>
                        </div>
                      </div>
                      <button class="btn small" onClick={() => void join(r.code, 'srv')}>
                        {r.status === 'waiting' && r.players.length < 2 ? 'Join' : 'Watch'}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              !checking && (
                <p class="small muted">
                  That's fine — peer-to-peer rooms work without one. Run <code>npm run server</code> to host your own lobby,
                  or point the app at one:
                </p>
              )
            )}
            <details class="small">
              <summary>Custom server address</summary>
              <div class="row gap" style={{ marginTop: '6px' }}>
                <input type="text" placeholder="https://tiq.example.com" value={customUrl} onInput={(e) => setCustomUrl((e.target as HTMLInputElement).value)} />
                <button class="btn small" onClick={() => void saveCustom()}>
                  Save
                </button>
              </div>
            </details>
          </section>
        </div>
      </div>
    </div>
  );
}
