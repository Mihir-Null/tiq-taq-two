/**
 * runner.ts — plays a Lesson: drives the scripted side, checks what the
 * learner does, and advances through the steps.
 */

import { signal, effect } from '@preact/signals';
import { applyMove, type Move, type Player } from '../engine/index.ts';
import { GameController, type Driver, type SeatInfo } from '../ui/game/controller.ts';
import { animScale, updateProgress } from '../app/store.ts';
import type { Lesson, LessonStep } from './lessons.tsx';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class LessonRunner {
  readonly lesson: Lesson;
  readonly ctrl: GameController;
  readonly stepIdx = signal(0);
  /** True while the lesson itself is playing moves. */
  readonly busy = signal(false);
  readonly finished = signal(false);
  #rolls: number[] = [];
  #epoch = 0;
  #advancing = false;
  #stopWatch: () => void;

  constructor(lesson: Lesson) {
    this.lesson = lesson;
    const learner: SeatInfo = { kind: 'human', name: 'You', local: true };
    const coach: SeatInfo = { kind: 'remote', name: lesson.opponent, local: false };
    const seats = (lesson.learner === 1 ? { 1: learner, 2: coach } : { 1: coach, 2: learner }) as Record<Player, SeatInfo>;
    const driver: Driver = { submit: (_ctrl, move) => this.#onLearnerMove(move) };
    this.ctrl = new GameController({ rules: lesson.rules, seats, driver, hintsAllowed: false, undoAllowed: false });
    for (const m of lesson.setup ?? []) this.#apply(m);
    this.ctrl.skipAnims();

    // Watch the UI for "pick this tool / select these squares / peek" goals.
    this.#stopWatch = effect(() => {
      const st = this.step;
      const exp = st.expect;
      const c = this.ctrl;
      if (!exp || this.busy.value) return;
      let met = false;
      if (exp.kind === 'tool') met = c.tool.value === exp.tool;
      else if (exp.kind === 'select') {
        const sel = c.selection.value;
        met = sel.length === exp.cells.length && exp.cells.every((x) => sel.includes(x));
      } else if (exp.kind === 'peek') met = c.peek.value !== null || c.pinned.value !== null;
      if (met) void this.advance(exp.kind === 'peek' ? 900 : 250);
    });
  }

  get step(): LessonStep {
    return this.lesson.steps[this.stepIdx.value];
  }

  get total(): number {
    return this.lesson.steps.length;
  }

  dispose(): void {
    this.#epoch++;
    this.#stopWatch();
    this.ctrl.dispose();
  }

  /** Scripted randomness: each step may queue the numbers its measurements will use. */
  #rng = (): number => (this.#rolls.length ? this.#rolls.shift()! : 0.5);

  #apply(m: Move): void {
    const s = this.ctrl.live.value;
    const out = applyMove(s, m, this.#rng);
    this.ctrl.accept(m, s.toMove, out);
  }

  async start(): Promise<void> {
    await this.#enter(0);
  }

  async #enter(i: number): Promise<void> {
    const epoch = ++this.#epoch;
    const st = this.lesson.steps[i];
    const c = this.ctrl;
    this.stepIdx.value = i;
    this.#advancing = false;
    c.allowedTools.value = st.tools ?? null;
    if (st.tool && c.tool.value !== st.tool) {
      c.tool.value = st.tool;
      c.selection.value = [];
    }
    c.highlight.value = st.cells ?? [];
    this.#rolls = [...(st.rolls ?? [])];
    if (st.auto?.length) {
      this.busy.value = true;
      for (const m of st.auto) {
        await c.whenIdle();
        await sleep(700 * animScale.value + 150);
        if (epoch !== this.#epoch) return;
        this.#apply(m);
      }
      await c.whenIdle();
      if (epoch !== this.#epoch) return;
      this.busy.value = false;
    }
  }

  /** Go to the next step (after animations settle). */
  async advance(delay = 0): Promise<void> {
    if (this.#advancing || this.finished.value) return;
    this.#advancing = true;
    const epoch = this.#epoch;
    if (delay) await sleep(delay);
    await this.ctrl.whenIdle();
    if (epoch !== this.#epoch) return;
    const i = this.stepIdx.value;
    if (i + 1 >= this.lesson.steps.length) this.#finish();
    else await this.#enter(i + 1);
  }

  /** "Next" button: only for steps that just need reading. */
  next(): void {
    const exp = this.step.expect;
    if (!exp || exp.kind === 'next') void this.advance();
  }

  #onLearnerMove(m: Move): void {
    const st = this.step;
    const exp = st.expect;
    if (this.busy.value) return;
    if (!exp || exp.kind === 'next') {
      this.ctrl.say('Read the coach note, then press Next.', true);
      return;
    }
    if (exp.kind !== 'move') {
      this.ctrl.say('Follow the coach note first.', true);
      return;
    }
    if (!exp.match(m, this.ctrl.live.value)) {
      this.ctrl.say(exp.hint, true);
      return;
    }
    this.#apply(m);
    void this.advance();
  }

  #finish(): void {
    this.finished.value = true;
    this.ctrl.highlight.value = [];
    const l = this.lesson;
    updateProgress((p) => ({
      ...p,
      lessons: { ...p.lessons, [l.id]: true },
      unlocked: Math.max(p.unlocked, l.unlocks) as typeof p.unlocked,
    }));
  }
}

