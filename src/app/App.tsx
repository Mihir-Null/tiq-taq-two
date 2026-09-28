/**
 * App.tsx — the app shell: header, the current screen, dialogs and toasts.
 */

import { route, navigate } from './router.ts';
import { settings, updateSettings, activeTheme } from './store.ts';
import { settingsOpen, toasts } from './ui-state.ts';
import { Icon } from '../ui/components/Icon.tsx';
import { Home } from '../ui/screens/Home.tsx';
import { LocalGameScreen } from '../ui/screens/LocalGame.tsx';
import { LearnScreen } from '../ui/screens/Learn.tsx';
import { LessonScreen } from '../ui/screens/Lesson.tsx';
import { OnlineHub } from '../ui/screens/Online.tsx';
import { RoomScreen } from '../ui/screens/Room.tsx';
import { SettingsModal } from '../ui/screens/Settings.tsx';
import { activeSession } from '../net/session.ts';

function Header() {
  const first = route.value.parts[0] ?? '';
  const s = settings.value;
  const nav: [string, string, string][] = [
    ['learn', 'Learn', 'book'],
    ['play', 'Play', 'play'],
    ['online', 'Online', 'globe'],
  ];
  return (
    <header class="app-header">
      <a class="brand" href="#/" aria-label="Tiq Taq Two home">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="-30 -30 60 60" width="26" height="26">
            <path class="bm-x" d="M-22,-22 L-4,-4 M-4,-22 L-22,-4" />
            <circle class="bm-o" cx="13" cy="-13" r="9" />
            <path class="bm-x ghost" d="M4,4 L22,22 M22,4 L4,22" />
            <circle class="bm-o ghost" cx="-13" cy="13" r="9" />
          </svg>
        </span>
        <span class="brand-name">
          tiq taq <span class="ket">|two⟩</span>
        </span>
      </a>
      <nav class="main-nav">
        {nav.map(([id, label, icon]) => (
          <a key={id} href={`#/${id}`} class={first === id || (id === 'learn' && first === 'lesson') || (id === 'online' && first === 'room') ? 'on' : ''}>
            <Icon name={icon} size={16} />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      {activeSession.value && first !== 'room' && (
        <a class="room-pill" href={`#/room/${activeSession.value.backend}/${activeSession.value.code}`} data-tip="You're still in an online room — tap to return">
          <span class="status-dot ok" /> {activeSession.value.code}
        </a>
      )}
      <div class="header-tools">
        <button
          class="icon-btn"
          onClick={() => updateSettings({ theme: activeTheme.value === 'lab' ? 'academia' : 'lab' })}
          data-tip={`Switch to the ${activeTheme.value === 'lab' ? 'Academia (light)' : 'Lab console (dark)'} theme`}
          aria-label="Toggle theme"
        >
          <Icon name="theme" />
        </button>
        <button class="icon-btn" onClick={() => updateSettings({ sound: !s.sound })} data-tip={s.sound ? 'Mute sounds' : 'Unmute sounds'} aria-label="Toggle sound">
          <Icon name={s.sound ? 'soundOn' : 'soundOff'} />
        </button>
        <button class="icon-btn" onClick={() => (settingsOpen.value = true)} data-tip="Settings" aria-label="Settings">
          <Icon name="gear" />
        </button>
      </div>
    </header>
  );
}

function Screen() {
  const r = route.value;
  const [first, second, third] = r.parts;
  switch (first) {
    case undefined:
      return <Home />;
    case 'play':
      return <LocalGameScreen />;
    case 'learn':
      return <LearnScreen />;
    case 'lesson':
      return <LessonScreen id={second ?? ''} />;
    case 'online':
      return <OnlineHub />;
    case 'room':
      return <RoomScreen key={`${second}/${third}`} backend={second ?? ''} code={third ?? ''} />;
    default:
      return (
        <div class="screen">
          <h2>Lost in the multiverse</h2>
          <p>This page doesn't exist in any universe.</p>
          <button class="btn primary" onClick={() => navigate('/')}>
            Home
          </button>
        </div>
      );
  }
}

export function App() {
  return (
    <>
      <Header />
      <main id="main">
        <Screen />
      </main>
      {settingsOpen.value && <SettingsModal />}
      <div class="toasts" aria-live="polite">
        {toasts.value.map((t) => (
          <div key={t.id} class={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
