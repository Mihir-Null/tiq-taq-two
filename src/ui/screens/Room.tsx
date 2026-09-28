/**
 * Room.tsx — a multiplayer room: the lobby (seats, settings, chat) and,
 * once the game starts, the full game view with chat and emotes.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { LEVELS, ALL_LEVELS, X, O, type Level } from '../../engine/index.ts';
import { navigate, shareUrl } from '../../app/router.ts';
import { displayName } from '../../app/store.ts';
import { copyText } from '../../app/ui-state.ts';
import { activeSession, joinRoom, leaveSession, type Session } from '../../net/session.ts';
import { EMOTES, type Seat } from '../../net/protocol.ts';
import type { Backend, RoomClient } from '../../net/room-client.ts';
import { GameView } from '../components/GameView.tsx';
import { TokenMark } from '../components/Panels.tsx';
import { Icon } from '../components/Icon.tsx';
import { Term } from '../components/Term.tsx';
import { useServer } from './Online.tsx';

const BACKENDS: Backend[] = ['p2p', 'srv', 'local'];
const BACKEND_LABEL: Record<Backend, string> = { p2p: 'Peer-to-peer', srv: 'Lobby server', local: 'Same browser' };

export function RoomScreen({ backend, code }: { backend: string; code: string }) {
  const b = (BACKENDS.includes(backend as Backend) ? backend : 'p2p') as Backend;
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { info: server, checking } = useServer();
  const session = activeSession.value;
  const matches = !!session && session.backend === b && session.code === code;

  useEffect(() => {
    if (matches) return;
    if (b === 'srv' && checking) return;
    let live = true;
    setError(null);
    joinRoom(b, code, displayName(), server?.base).catch((err: unknown) => {
      if (live) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      live = false;
    };
  }, [b, code, checking, attempt]);

  if (error) {
    return (
      <div class="screen">
        <div class="card" style={{ maxWidth: '560px' }}>
          <h2>Couldn't join room {code}</h2>
          <p>{error}</p>
          <div class="row gap">
            <button class="btn primary" onClick={() => setAttempt((n) => n + 1)}>
              <Icon name="restart" size={16} /> Try again
            </button>
            <button class="btn" onClick={() => navigate('/online')}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!matches) {
    return (
      <div class="screen">
        <p class="muted">
          <span class="dots"><i /><i /><i /></span> Connecting to room <strong>{code}</strong> ({BACKEND_LABEL[b]})…
        </p>
      </div>
    );
  }
  return <RoomView session={session!} />;
}

function RoomView({ session }: { session: Session }) {
  const c = session.client;
  const room = c.room.value;
  const ctrl = c.ctrl.value;
  const status = c.status.value;
  // After a game you can step back to the lobby (to change rules or seats).
  const [lobbyView, setLobbyView] = useState(false);
  useEffect(() => setLobbyView(false), [ctrl]);

  const leave = () => {
    if (session.hosting && room && room.members.filter((m) => m.connected).length > 1) {
      if (!confirm('You are hosting this room — leaving closes it for everyone. Leave?')) return;
    }
    leaveSession();
    navigate('/online');
  };

  if (status === 'closed') {
    return (
      <div class="screen">
        <div class="card" style={{ maxWidth: '560px' }}>
          <h2>Disconnected</h2>
          <p>{c.error.value ?? 'The connection to the room was closed.'}</p>
          <button class="btn primary" onClick={() => { leaveSession(); navigate('/online'); }}>
            Back to online play
          </button>
        </div>
      </div>
    );
  }
  if (!room) {
    return (
      <div class="screen">
        <p class="muted"><span class="dots"><i /><i /><i /></span> Joining…</p>
      </div>
    );
  }

  const bar = <RoomBar session={session} onLeave={leave} />;

  if (ctrl && !lobbyView) {
    const g = room.game;
    const mySeat = g ? (['X', 'O'] as Seat[]).find((s) => g.seats[s] === c.me.value) ?? null : null;
    const playing = g?.phase === 'playing';
    const oppSeat: Seat | null = mySeat ? (mySeat === 'X' ? 'O' : 'X') : null;
    return (
      <div class="screen game-screen">
        <GameView
          ctrl={ctrl}
          banner={bar}
          extraTabs={[
            { id: 'chat', label: 'Chat', icon: 'chat', badge: c.unread.value || undefined, render: () => <Chat client={c} /> },
            { id: 'room', label: 'Room', icon: 'users', render: () => <RoomInfo session={session} /> },
          ]}
          actions={
            mySeat && playing ? (
              <button class="btn ghost small" onClick={() => confirm('Resign this game?') && c.resign()}>
                <Icon name="flag" size={16} /> Resign
              </button>
            ) : undefined
          }
          resultActions={
            mySeat && g ? (
              <>
                <button class={`btn ${g.rematch[mySeat] ? '' : 'primary'}`} onClick={() => c.rematch(!g.rematch[mySeat])}>
                  <Icon name="restart" size={16} /> {g.rematch[mySeat] ? 'Cancel rematch' : 'Rematch (swap sides)'}
                </button>
                {oppSeat && g.rematch[oppSeat] && <span class="small good">Your opponent wants a rematch!</span>}
                <button class="btn" onClick={() => ctrl.setViewPly(0)}>
                  <Icon name="history" size={16} /> Review
                </button>
                <button class="btn ghost" onClick={() => setLobbyView(true)} data-tip="Change the rules or seats, then start a new game">
                  <Icon name="users" size={16} /> Lobby
                </button>
              </>
            ) : (
              <span class="small muted">You're watching. Waiting for the players…</span>
            )
          }
        />
        <EmotePop client={c} />
      </div>
    );
  }

  return (
    <div class="screen room-lobby">
      {bar}
      {ctrl && (
        <button class="btn small ghost" style={{ marginTop: '8px' }} onClick={() => setLobbyView(false)}>
          <Icon name="chevronLeft" size={14} /> Back to the last game
        </button>
      )}
      <div class="online-grid" style={{ marginTop: '14px' }}>
        <div class="form-grid">
          <Lobby session={session} />
        </div>
        <section class="card">
          <h3>
            <Icon name="chat" size={18} /> Chat
          </h3>
          <Chat client={c} />
        </section>
      </div>
      <EmotePop client={c} />
    </div>
  );
}

function RoomBar({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const c = session.client;
  const room = c.room.value!;
  const link = shareUrl(`/room/${session.backend}/${session.code}`);
  const status = c.status.value;
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: 'Tiq Taq Two', text: `Join my quantum tic-tac-toe room ${session.code}`, url: link });
        return;
      } catch {
        /* fall back to copy */
      }
    }
    await copyText(link, 'Invite link copied');
  };
  const spectators = room.members.filter((m) => !m.seat && m.connected).length;
  return (
    <div class="room-banner">
      <span class={`status-dot ${status === 'open' ? 'ok' : status === 'reconnecting' ? 'wait' : 'bad'}`} data-tip={status} />
      <strong>{room.settings.name}</strong>
      <span class="room-code" style={{ fontSize: '1.05rem' }} data-tip="Room code — friends type this in to join">
        {session.code}
      </span>
      <button class="btn small" onClick={() => void share()} data-tip="Copy or share an invite link">
        <Icon name="share" size={14} /> Invite
      </button>
      <span class="small muted">
        {BACKEND_LABEL[session.backend]}
        {c.latency.value !== null && ` · ${c.latency.value} ms`}
        {spectators > 0 && ` · ${spectators} watching`}
      </span>
      <div class="emotes" style={{ marginLeft: 'auto' }}>
        {['👋', '🤔', '😮', '🎲', 'GG'].map((e) => (
          <button key={e} onClick={() => c.react(e)} aria-label={`React ${e}`}>
            {e}
          </button>
        ))}
      </div>
      <button class="btn small ghost" onClick={onLeave}>
        <Icon name="close" size={14} /> Leave
      </button>
    </div>
  );
}

function Lobby({ session }: { session: Session }) {
  const c = session.client;
  const room = c.room.value!;
  const me = c.me.value;
  const owner = c.amOwner();
  const s = room.settings;
  const seated = (seat: Seat) => room.members.find((m) => m.seat === seat);
  const bothReady = !!seated('X')?.connected && !!seated('O')?.connected;
  const seeding = room.game?.phase === 'seeding';

  return (
    <>
      <section class="card">
        <h3>Players</h3>
        <div class="seats">
          {(['X', 'O'] as Seat[]).map((seat) => {
            const m = seated(seat);
            return (
              <div key={seat} class={`seat ${m ? 'filled' : ''} ${m?.id === me ? 'me' : ''}`}>
                <TokenMark p={seat === 'X' ? X : O} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {m ? (
                    <>
                      <strong>{m.name}</strong> {m.id === me && <span class="you">you</span>}
                      <div class="small muted">
                        {m.isOwner ? 'Room owner · ' : ''}
                        {m.connected ? 'ready' : 'away'}
                      </div>
                    </>
                  ) : (
                    <span class="muted">Empty seat</span>
                  )}
                </div>
                {!m && !seeding && (
                  <button class="btn small" onClick={() => c.sit(seat)}>
                    Sit here
                  </button>
                )}
                {m && !m.connected && m.id !== me && !seeding && (
                  <button class="btn small" onClick={() => c.sit(seat)} data-tip={`${m.name} has left — take over this seat`}>
                    Take seat
                  </button>
                )}
                {m?.id === me && !seeding && (
                  <button class="btn small ghost" onClick={() => c.sit(null)}>
                    Watch instead
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {seeding ? (
          <p class="seed-note">
            <span class="dots"><i /><i /><i /></span>
            {c.seeding.value ?? 'Starting…'} Each player locks in a secret chain of random numbers. The dice of every
            move combine one fresh number from each player, revealed only after the move is made — so nobody can
            steer or predict a <Term k="collapse">collapse</Term>.
          </p>
        ) : owner ? (
          <button class="btn primary big" disabled={!bothReady} onClick={() => c.start()}>
            <Icon name="play" size={18} /> {bothReady ? 'Start game' : 'Waiting for a second player…'}
          </button>
        ) : (
          <p class="muted small">Waiting for the room owner to start the game.</p>
        )}
        {!bothReady && (
          <p class="small muted">
            Share the code <strong>{session.code}</strong> or the invite link with a friend.
            {session.backend === 'p2p' && ' Keep this tab open — the room lives here.'}
          </p>
        )}
      </section>

      <section class="card">
        <h3>Rules {owner ? '' : <span class="small muted">(set by the room owner)</span>}</h3>
        <div class="level-list">
          {ALL_LEVELS.map((lv: Level) => (
            <button
              key={lv}
              class={`level-choice lv${lv} ${s.level === lv ? 'on' : ''}`}
              disabled={!owner || seeding}
              onClick={() => c.updateSettings({ level: lv, quanta: LEVELS[lv].defaultQuanta })}
            >
              <span class="lv-num">{lv}</span>
              <span class="lv-text">
                <strong>{LEVELS[lv].name}</strong>
                <span class="small muted">{LEVELS[lv].tagline}</span>
              </span>
            </button>
          ))}
        </div>
        {LEVELS[s.level].features.observe && (
          <label class="range-row">
            <span>
              <Icon name="bolt" size={14} /> Quanta each: <strong>{s.quanta}</strong>
            </span>
            <input type="range" min="0" max="6" value={s.quanta} disabled={!owner || seeding} onChange={(e) => c.updateSettings({ quanta: Number((e.target as HTMLInputElement).value) })} />
          </label>
        )}
        <label class="toggle">
          <input type="checkbox" checked={s.hints} disabled={!owner || seeding} onChange={(e) => c.updateSettings({ hints: (e.target as HTMLInputElement).checked })} />
          <span class="switch" />
          <span>Hints allowed</span>
        </label>
        {session.backend === 'srv' && (
          <label class="toggle">
            <input type="checkbox" checked={s.isPublic} disabled={!owner || seeding} onChange={(e) => c.updateSettings({ isPublic: (e.target as HTMLInputElement).checked })} />
            <span class="switch" />
            <span>Listed in the public lobby</span>
          </label>
        )}
      </section>

      <RoomInfo session={session} />
    </>
  );
}

function RoomInfo({ session }: { session: Session }) {
  const c = session.client;
  const room = c.room.value!;
  return (
    <section class="card">
      <h3>In the room</h3>
      <ul class="member-list">
        {room.members.map((m) => (
          <li key={m.id}>
            <span class={`status-dot ${m.connected ? 'ok' : 'bad'}`} />
            {m.seat ? <TokenMark p={m.seat === 'X' ? X : O} size={14} /> : <Icon name="observe" size={14} class="dim" />}
            <span>{m.name}</span>
            {m.id === c.me.value && <span class="you">you</span>}
            {m.isOwner && <Icon name="crown" size={13} class="dim" />}
          </li>
        ))}
      </ul>
      <p class="small muted">
        {room.gamesPlayed} game{room.gamesPlayed === 1 ? '' : 's'} played · room {session.code} · {BACKEND_LABEL[session.backend]}
      </p>
    </section>
  );
}

function Chat({ client }: { client: RoomClient }) {
  const [text, setText] = useState('');
  const log = useRef<HTMLDivElement>(null);
  const lines = client.chat.value;
  useEffect(() => {
    client.chatVisible = true;
    client.unread.value = 0;
    return () => {
      client.chatVisible = false;
    };
  }, [client]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
    client.unread.value = 0;
  }, [lines.length]);
  return (
    <div class="chat">
      <div class="chat-log" ref={log} aria-live="polite">
        {lines.length === 0 && <div class="chat-line sys">No messages yet. Say hi!</div>}
        {lines.map((l) =>
          l.kind === 'system' ? (
            <div key={l.id} class="chat-line sys">{l.text}</div>
          ) : (
            <div key={l.id} class="chat-line">
              <span class="who" style={{ color: l.mine ? 'var(--accent)' : undefined }}>{l.name}</span>
              {l.text}
            </div>
          ),
        )}
      </div>
      <div class="emotes">
        {EMOTES.map((e) => (
          <button key={e} onClick={() => client.react(e)} aria-label={`React ${e}`}>
            {e}
          </button>
        ))}
      </div>
      <form
        class="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          client.say(text);
          setText('');
        }}
      >
        <input type="text" maxLength={280} value={text} placeholder="Message…" onInput={(e) => setText((e.target as HTMLInputElement).value)} aria-label="Chat message" />
        <button class="btn" type="submit" aria-label="Send">
          <Icon name="send" size={16} />
        </button>
      </form>
    </div>
  );
}

function EmotePop({ client }: { client: RoomClient }) {
  const e = client.emote.value;
  const [shown, setShown] = useState<typeof e>(null);
  useEffect(() => {
    if (!e) return;
    setShown(e);
    const t = setTimeout(() => setShown(null), 1900);
    return () => clearTimeout(t);
  }, [e?.id]);
  if (!shown) return null;
  return (
    <div key={shown.id} class="emote-pop" aria-live="polite">
      {shown.emote}
      <div class="small">{shown.name}</div>
    </div>
  );
}

