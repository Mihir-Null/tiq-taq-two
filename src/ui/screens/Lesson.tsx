/**
 * Lesson.tsx — runs one interactive lesson: the game, a coach card, and a
 * spotlight that dims everything except what the coach is talking about.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { LEVELS } from '../../engine/index.ts';
import { lessonById, LESSONS } from '../../tutorial/lessons.tsx';
import { LessonRunner } from '../../tutorial/runner.ts';
import { GameView } from '../components/GameView.tsx';
import { Icon } from '../components/Icon.tsx';
import { navigate } from '../../app/router.ts';

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
    // Bring the target into view once.
    const el = document.querySelector(selector);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return () => cancelAnimationFrame(raf);
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
  if (runner.busy.value) return 'Watch…';
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
  const runner = useMemo(() => (lesson ? new LessonRunner(lesson) : null), [id]);
  useEffect(() => {
    if (!runner) return;
    void runner.start();
    return () => runner.dispose();
  }, [runner]);

  if (!lesson || !runner) {
    return (
      <div class="screen">
        <p>Lesson not found.</p>
        <button class="btn" onClick={() => navigate('/learn')}>All lessons</button>
      </div>
    );
  }

  const step = runner.step;
  const i = runner.stepIdx.value;
  const finished = runner.finished.value;
  const next = LESSONS[LESSONS.indexOf(lesson) + 1];
  const label = expectLabel(runner);
  const showNext = (!step.expect || step.expect.kind === 'next') && !runner.busy.value;

  const coach = (
    <div class={`coach-card ${finished ? 'done' : ''}`} role="region" aria-label="Lesson coach" aria-live="polite">
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
            {lesson.unlocks > lesson.level
              ? `Level ${lesson.unlocks} (${LEVELS[lesson.unlocks].name}) is unlocked.`
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

  return (
    <div class="screen game-screen lesson-screen">
      <GameView ctrl={runner.ctrl} coach={coach} tips={false} />
      {!finished && <Spotlight selector={step.spot} />}
    </div>
  );
}
