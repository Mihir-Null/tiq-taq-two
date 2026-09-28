/**
 * Home.tsx — the landing screen: what is this, and where do I start?
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { X, O, LEVELS, ALL_LEVELS, defaultRules, type Move, type Level } from '../../engine/index.ts';
import { GameController, LocalDriver, type SeatInfo } from '../game/controller.ts';
import { Board } from '../components/Board.tsx';
import { Icon } from '../components/Icon.tsx';
import { Term } from '../components/Term.tsx';
import { navigate } from '../../app/router.ts';
import { progress } from '../../app/store.ts';
import { LESSONS } from '../../tutorial/lessons.tsx';

/** A scripted loop that shows off each quantum idea on a small board. */
const DEMO: { move: Move; caption: string }[] = [
  { move: { kind: 'split', a: 0, b: 2 }, caption: 'X splits: one token, two places at once.' },
  { move: { kind: 'place', cell: 4 }, caption: 'O plays an ordinary move in the centre.' },
  { move: { kind: 'link', a: 6, b: 4 }, caption: 'X links with the O: either X–O or O–X — entangled.' },
  { move: { kind: 'split', a: 5, b: 8 }, caption: 'O splits too. The multiverse keeps growing…' },
  { move: { kind: 'merge', a: 0, b: 2, turns: 2 }, caption: 'X merges its halves: they interfere and X lands 100% on ①.' },
  { move: { kind: 'observe', cell: 6 }, caption: 'O observes ⑦ — its entangled partner ⑤ snaps into place too.' },
];

function DemoBoard() {
  const [round, setRound] = useState(0);
  const [caption, setCaption] = useState('Tiq Taq Two: every square is a quantum object.');
  const ctrl = useMemo(() => {
    const seat = (name: string): SeatInfo => ({ kind: 'remote', name, local: false });
    return new GameController({ rules: defaultRules(3), seats: { [X]: seat('X'), [O]: seat('O') }, driver: new LocalDriver(`demo-${round}`), muted: true });
  }, [round]);

  useEffect(() => {
    let step = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (step < DEMO.length) {
        const { move, caption: c } = DEMO[step++];
        try {
          const s = ctrl.live.value;
          (ctrl.driver as LocalDriver).submit(ctrl, move);
          ctrl.skipAnims();
          if (ctrl.live.value !== s) setCaption(c);
        } catch {
          /* a move may be illegal after a random collapse — just skip it */
        }
        timer = setTimeout(tick, 2600);
      } else {
        timer = setTimeout(() => setRound((r) => r + 1), 1800);
      }
    };
    timer = setTimeout(tick, 1400);
    return () => clearTimeout(timer);
  }, [ctrl]);

  return (
    <figure class="demo">
      <Board ctrl={ctrl} compact interactive={false} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function Home() {
  const done = progress.value.lessons;
  const unlocked = progress.value.unlocked;
  const firstLesson = LESSONS.find((l) => !done[l.id]);
  return (
    <div class="screen home">
      <section class="hero">
        <div class="hero-text">
          <h1 class="wordmark" aria-label="Tiq Taq Two">
            ti<span class="q-x">q</span> ta<span class="q-o">q</span> <span class="ket">|two⟩</span>
          </h1>
          <p class="tagline">
            Tic-tac-toe where your X can be in two places at once, get <Term k="entanglement">entangled</Term> with an
            O, and even <Term k="interference">cancel itself out</Term>. No physics needed — the board shows you
            everything.
          </p>
          <div class="hero-actions">
            <button class="btn primary big" onClick={() => navigate(firstLesson ? `/lesson/${firstLesson.id}` : '/learn')}>
              <Icon name="book" size={18} /> {firstLesson ? (Object.keys(done).length ? 'Continue learning' : 'Learn to play') : 'Lessons'}
            </button>
            <button class="btn big" onClick={() => navigate('/play', { mode: 'bot', level: Math.min(unlocked, 3), difficulty: 'easy', side: 'X' })}>
              <Icon name="bot" size={18} /> Play the bot
            </button>
            <button class="btn big" onClick={() => navigate('/online')}>
              <Icon name="globe" size={18} /> Play online
            </button>
          </div>
        </div>
        <div class="hero-demo">
          <DemoBoard />
        </div>
      </section>

      <section class="mode-cards">
        <button class="mode-card" onClick={() => navigate('/online')}>
          <Icon name="globe" size={26} />
          <strong>Online lobbies</strong>
          <span>Create a room, share the code, play a friend anywhere. Spectators welcome.</span>
        </button>
        <button class="mode-card" onClick={() => navigate('/play', { mode: 'local', level: Math.min(unlocked, 3) })}>
          <Icon name="users" size={26} />
          <strong>Pass & play</strong>
          <span>Two players, one screen. Great for teaching someone in person.</span>
        </button>
        <button class="mode-card" onClick={() => navigate('/play', { mode: 'sandbox', level: 3, quanta: 6 })}>
          <Icon name="flask" size={26} />
          <strong>Sandbox lab</strong>
          <span>Play both sides with extra ⚡, undo freely, open the physics view and experiment.</span>
        </button>
        <button class="mode-card" onClick={() => navigate('/learn', { tab: 'codex' })}>
          <Icon name="atom" size={26} />
          <strong>Codex</strong>
          <span>Every quantum idea in the game, explained twice: in game terms and in real physics.</span>
        </button>
      </section>

      <section class="ladder">
        <h2>Four levels of quantumness</h2>
        <div class="ladder-grid">
          {ALL_LEVELS.map((lv: Level) => {
            const lesson = LESSONS.find((l) => l.level === lv);
            const isDone = lesson ? !!done[lesson.id] : false;
            return (
              <div key={lv} class={`ladder-card lv${lv} ${lv > unlocked ? 'locked' : ''}`}>
                <div class="ladder-top">
                  <span class="lv-num">{lv}</span>
                  <strong>{LEVELS[lv].name}</strong>
                  {isDone && <Icon name="check" size={16} class="good" />}
                  {lv > unlocked && <Icon name="lock" size={14} class="dim" />}
                </div>
                <p class="small">{LEVELS[lv].tagline}</p>
                <div class="ladder-actions">
                  {lesson && (
                    <button class="btn small" onClick={() => navigate(`/lesson/${lesson.id}`)}>
                      <Icon name="book" size={14} /> {isDone ? 'Replay lesson' : 'Lesson'}
                    </button>
                  )}
                  <button class="btn small ghost" onClick={() => navigate('/play', { mode: 'bot', level: lv, difficulty: 'easy', side: 'X' })}>
                    <Icon name="play" size={14} /> Play
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <footer class="home-foot small muted">
        Inspired by <a href="https://quantumfrontiers.com/2019/07/15/tiqtaqtoe/" target="_blank" rel="noopener">Quantum TiqTaqToe</a> by
        Evert van Nieuwenburg. Every square really is a simulated qutrit; every move really is a unitary gate.
      </footer>
    </div>
  );
}
