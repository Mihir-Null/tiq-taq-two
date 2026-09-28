/**
 * Lesson.tsx — runs one interactive lesson: the game, a coach card, and a
 * spotlight that dims everything except what the coach is talking about.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { LEVELS, type Level } from '../../engine/index.ts';
import { lessonById, LESSONS, type Lesson } from '../../tutorial/lessons.tsx';
import { LessonRunner } from '../../tutorial/runner.ts';
import { GameView } from '../components/GameView.tsx';
import { Icon } from '../components/Icon.tsx';
import { navigate } from '../../app/router.ts';

/**
 * Scroll just enough to show `el` between whatever is pinned to the top of the
 * screen (the header, a sticky coach card beside it) and whatever is docked at
 * the bottom (a phone's tool bar, move bar and coach sheet).
 */
function reveal(el: Element): void {
  // Something pinned to the screen is always in view — scrolling can't help.
  for (let e: Element | null = el; e; e = e.parentElement) if (getComputedStyle(e).position === 'fixed') return;
  const r = el.getBoundingClientRect();
  let top = document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 0;
  let bottom = window.innerHeight;
  for (const sel of ['.gl-coach', '.gl-controls .tools', '.move-bar']) {
    const o = document.querySelector(sel);
    if (!o || o.contains(el)) continue;
    const pos = getComputedStyle(o).position;
    if (pos !== 'fixed' && pos !== 'sticky') continue;
    const b = o.getBoundingClientRect();
    if (b.height === 0 || b.right <= r.left || b.left >= r.right) continue; // not in the target's column
    if (b.top < window.innerHeight / 2) top = Math.max(top, b.bottom);
    else bottom = Math.min(bottom, b.top);
  }
  top += 8;
  bottom -= 8;
  let dy = 0;
  if (r.top < top) dy = r.top - top;
  else if (r.bottom > bottom) dy = Math.min(r.bottom - bottom, r.top - top); // never push its top out of view
  if (Math.abs(dy) > 2) window.scrollBy({ top: dy, behavior: 'smooth' });
}

/** Dims the page around the element matching `selector` (pointer events pass through). */
function Spotlight({ selector }: { selector: string | undefined }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }
    let raf = 0;
    let last = '';
    const loop = () => {
      const el = document.querySelector(selector);
      const r = el?.getBoundingClientRect() ?? null;
      const key = r ? `${r.x|0},${r.y|0},${r.width|0},${r.height|0}` : '';
      if (key !== last) {
        last = key;
        setRect(r);
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    // Bring the target into view once (after the layout has settled).
    const t = setTimeout(() => {
      const el = document.querySelector(selector);
      if (el) reveal(el);
    }, 60);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [selector]);
  if (!rect) return null;
  const pad = 6;
  return (
    <div
      class="spotlight"
      aria-hidden="true"
      style={{ left: `${rect.left - pad}px`, top: `${rect.top - pad}px`, width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px` }}
    />
  );
}

function expectLabel(runner: LessonRunner): string | null {
  const exp = runner.step.expect;
  if (!exp || exp.kind === 'next') return null;
  if (runner.busy.value || runner.ctrl.anim.value) return 'Watch…';
  switch (exp.kind) {
    case 'tool':
      return 'Your turn: pick the tool.';
    case 'select':
      return 'Your turn: select the squares.';
    case 'peek':
      return 'Your turn: hover or tap a universe card.';
    case 'move':
      return 'Your turn: make the move.';
  }
}

export function LessonScreen({ id }: { id: string }) {
  const lesson = lessonById(id);
  if (!lesson) {
    return (
      <div class="screen">
        <p>Lesson not found.</p>
        <button class="btn" onClick={() => navigate('/learn')}>All lessons</button>
      </div>
    );
  }
  // Keyed by lesson: moving to the next lesson builds a fresh runner and view.
  return <LessonView key={lesson.id} lesson={lesson} />;
}

function LessonView({ lesson }: { lesson: Lesson }) {
  const runner = useMemo(() => new LessonRunner(lesson), [lesson]);
  useEffect(() => {
    void runner.start();
    return () => runner.dispose();
  }, [runner]);

  const step = runner.step;
  const i = runner.stepIdx.value;
  const finished = runner.finished.value;
  const unlocked = runner.unlockedNow.value;
  // Phones: the coach is a sheet over the page; it can be tucked away.
  const [tucked, setTucked] = useState(false);
  useEffect(() => setTucked(false), [i, finished]);
  const next = LESSONS[LESSONS.indexOf(lesson) + 1];
  const label = expectLabel(runner);
  const showNext = (!step.expect || step.expect.kind === 'next') && !runner.busy.value;

  const coach = (
    <div class={`coach-card ${finished ? 'done' : ''} ${tucked ? 'tucked' : ''}`} role="region" aria-label="Lesson coach" aria-live="polite">
      <div class="coach-top">
        <span class="coach-lesson">
          <Icon name="book" size={14} /> {lesson.title}
        </span>
        <span class="coach-count">
          {Math.min(i + 1, runner.total)} / {runner.total}
        </span>
        <div class="coach-progress">
          <span style={{ width: `${((finished ? runner.total : i) / runner.total) * 100}%` }} />
        </div>
        <button class="icon-btn coach-tuck" onClick={() => setTucked(!tucked)} aria-expanded={!tucked} aria-label={tucked ? 'Show the coach' : 'Tuck the coach away'}>
          <Icon name="chevronDown" size={18} />
        </button>
      </div>
      {!finished && runner.busy.value ? (
        <p class="coach-busy">
          <span class="dots" aria-hidden="true"><i /><i /><i /></span> {lesson.opponent} is moving…
        </p>
      ) : !finished ? (
        <>
          {step.title && <h3>{step.title}</h3>}
          <p>{step.text()}</p>
          <div class="coach-actions">
            {showNext && (
              <button class="btn primary" onClick={() => runner.next()} autoFocus>
                {step.nextLabel ?? 'Next'} <Icon name="chevronRight" size={16} />
              </button>
            )}
            {label && <span class="coach-wait">{label}</span>}
            <button class="btn ghost small skip" onClick={() => navigate('/learn')}>
              Exit lesson
            </button>
          </div>
        </>
      ) : (
        <>
          <h3>
            <Icon name="check" size={18} /> Lesson complete!
          </h3>
          <p>
            {unlocked !== null
              ? `Level ${unlocked} (${LEVELS[unlocked as Level].name}) is now unlocked.`
              : lesson.unlocks > lesson.level
                ? `You're ready for level ${lesson.unlocks} (${LEVELS[lesson.unlocks].name}).`
                : 'You know every move in the game now.'}
          </p>
          <div class="coach-actions">
            {next && (
              <button class="btn primary" onClick={() => navigate(`/lesson/${next.id}`)}>
                Next: {next.title} <Icon name="chevronRight" size={16} />
              </button>
            )}
            <button class={`btn ${next ? '' : 'primary'}`} onClick={() => navigate('/play', { mode: 'bot', level: lesson.level === 0 ? 1 : lesson.level, difficulty: 'easy', side: 'X' })}>
              <Icon name="bot" size={16} /> Practise vs Kitten
            </button>
            <button class="btn ghost" onClick={() => navigate('/learn')}>
              All lessons
            </button>
          </div>
        </>
      )}
    </div>
  );

  // Phones can't show the board and the side panels at once: steps may pick a
  // different spotlight there, and steps about the board bring the board back.
  const phone = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 820px)').matches;
  const spot = phone && step.spotPhone ? (step.spotPhone === 'none' ? undefined : step.spotPhone) : step.spot;
  const aboutBoard = !spot && (!!step.cells?.length || step.expect?.kind === 'move' || step.expect?.kind === 'select');
  useEffect(() => {
    if (!aboutBoard || finished) return;
    const t = setTimeout(() => {
      const board = document.querySelector('.board-area');
      if (board) reveal(board);
    }, 60);
    return () => clearTimeout(t);
  }, [i, aboutBoard, finished]);

  return (
    <div class="screen game-screen lesson-screen">
      <GameView ctrl={runner.ctrl} coach={coach} tips={false} />
      {!finished && <Spotlight selector={spot} />}
    </div>
  );
}
