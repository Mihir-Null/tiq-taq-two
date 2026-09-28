/**
 * controller.ts — the brain of a game screen.
 *
 * One GameController backs every board you see: games against the bot,
 * pass-and-play, the sandbox, tutorials and online matches. It holds:
 *   • the move history (a list of immutable snapshots),
 *   • what the local player is currently doing (tool, selected squares,
 *     hovered square, knob position) and the resulting PREVIEW,
 *   • a queue of animations (measurements and collapses) to play,
 *   • time-travel ("show me the board after move 4").
 *
 * What happens when a move is committed depends on the *driver*: a local
 * driver applies it immediately (and may ask the bot to reply); the online
 * driver sends it to the room host and waits for confirmation. The screen
 * code doesn't care which.
 *
 * Everything is a Preact signal, so components re-render automatically.
 */

import { signal, computed, batch, type Signal } from '@preact/signals';
import {
  applyMove, previewMove, whyIllegal, explainPreview, rngForPly, randomSeed, other, LEVELS, CERTAIN_EPS,
  type GameState, type GameEvent, type Move, type MoveKind, type MoveOutcome, type MovePreview, type Player,
  type Explanation, newGame, type RuleSet, type GameResult,
} from '../../engine/index.ts';
import type { Difficulty } from '../../ai/search.ts';
import type { Hint } from '../../ai/hints.ts';
import { ai } from '../../ai/client.ts';
import { sfx } from '../../audio/sfx.ts';
import { settings } from '../../app/store.ts';

export type Tool = MoveKind;

export interface SeatInfo {
  kind: 'human' | 'bot' | 'remote';
  name: string;
  difficulty?: Difficulty;
  /** Can the person at this screen make moves for this seat? */
  local: boolean;
}

export interface Snapshot {
  state: GameState;
  move: Move | null;
  mover: Player | null;
  events: GameEvent[];
}

type MeasureEvent = Extract<GameEvent, { type: 'measure' }>;
type CollapseEvent = Extract<GameEvent, { type: 'collapse' }>;

export type Anim =
  | { kind: 'measure'; id: number; event: MeasureEvent; mover: Player | null }
  | { kind: 'collapse'; id: number; event: CollapseEvent };

export interface Driver {
  /** The local player committed `move`. */
  submit(ctrl: GameController, move: Move): void;
  /** Optional: take back the last move(s). */
  undo?(ctrl: GameController): void;
  /** Optional: called once when the controller is ready (e.g. bot opens). */
  start?(ctrl: GameController): void;
  dispose?(): void;
}

export interface ControllerOptions {
  rules: RuleSet;
  first?: Player;
  seats: Record<Player, SeatInfo>;
  driver: Driver;
  hintsAllowed?: boolean;
  undoAllowed?: boolean;
  /** Tutorials can restrict which tools are shown. */
  tools?: Tool[];
  initial?: GameState;
  /** No sound effects (used by the ambient demo on the home screen). */
  muted?: boolean;
}

let animIds = 1;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GameController {
  readonly snapshots: Signal<Snapshot[]>;
  readonly seats: Signal<Record<Player, SeatInfo>>;
  readonly driver: Driver;

  // ── interaction state ──
  readonly tool = signal<Tool>('place');
  readonly selection = signal<number[]>([]);
  readonly hover = signal<number | null>(null);
  readonly knob = signal(0);
  readonly peek = signal<number | null>(null);
  readonly pinned = signal<number | null>(null);
  readonly viewPly = signal<number | null>(null);
  readonly lastPointer = signal<'mouse' | 'touch' | 'pen'>('mouse');
  readonly allowedTools = signal<Tool[] | null>(null);
  /** Squares a lesson wants to draw attention to. */
  readonly highlight = signal<number[]>([]);
  readonly muted: boolean;

  // ── feedback ──
  readonly anim = signal<Anim | null>(null);
  readonly flash = signal<{ text: string; id: number; bad: boolean } | null>(null);
  readonly thinking = signal(false);
  /** An online move is on its way to the host. */
  readonly sending = signal(false);
  readonly hints = signal<Hint[] | null>(null);
  readonly hintsLoading = signal(false);
  readonly hintsAllowed = signal(true);
  readonly undoAllowed = signal(false);

  #queue: Anim[] = [];
  #idleWaiters: (() => void)[] = [];
  #flashTimer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;

  constructor(opts: ControllerOptions) {
    const initial = opts.initial ?? newGame(opts.rules, opts.first);
    this.snapshots = signal([{ state: initial, move: null, mover: null, events: [] }]);
    this.seats = signal(opts.seats);
    this.driver = opts.driver;
    this.hintsAllowed.value = opts.hintsAllowed ?? true;
    this.undoAllowed.value = opts.undoAllowed ?? false;
    this.allowedTools.value = opts.tools ?? null;
    this.muted = opts.muted ?? false;
  }

  start(): void {
    this.driver.start?.(this);
  }

  dispose(): void {
    this.#disposed = true;
    this.driver.dispose?.();
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  // ─────────────────────────── derived state ───────────────────────────────

  readonly live = computed(() => this.snapshots.value[this.snapshots.value.length - 1].state);

  readonly shown = computed<Snapshot>(() => {
    const list = this.snapshots.value;
    const v = this.viewPly.value;
    return v === null ? list[list.length - 1] : list[Math.max(0, Math.min(v, list.length - 1))];
  });

  /**
   * The state the board draws. During a measurement animation it shows the
   * moment *before* the dice land — and hides the result, so nothing on
   * screen spoils the outcome while the wheel is still spinning.
   */
  readonly display = computed<GameState>(() => {
    const s = this.shown.value.state;
    const a = this.anim.value;
    if (a && this.viewPly.value === null) return { ...s, q: a.event.before, result: null };
    return s;
  });

  readonly tools = computed<Tool[]>(() => {
    const f = LEVELS[this.live.value.rules.level].features;
    const all: Tool[] = ['place'];
    if (f.split) all.push('split');
    if (f.link) all.push('link');
    if (f.observe) all.push('observe');
    if (f.merge) all.push('merge');
    const allowed = this.allowedTools.value;
    return allowed ? all.filter((t) => allowed.includes(t)) : all;
  });

  readonly myTurn = computed(() => {
    const s = this.live.value;
    return !s.result && this.seats.value[s.toMove].local;
  });

  /** May the local user act right now? */
  readonly canAct = computed(
    () => this.myTurn.value && this.viewPly.value === null && !this.anim.value && !this.thinking.value && !this.sending.value,
  );

  /** The move the current selection/hover describes (may be illegal). */
  readonly candidate = computed<Move | null>(() => {
    if (!this.canAct.value) return null;
    const t = this.tool.value;
    const sel = this.selection.value;
    const h = this.hover.value;
    if (t === 'place' || t === 'observe') {
      const c = sel.length ? sel[0] : h;
      if (c === null || c === undefined) return null;
      return t === 'place' ? { kind: 'place', cell: c } : { kind: 'observe', cell: c };
    }
    if (sel.length === 2) return this.twoSquare(t, sel[0], sel[1]);
    if (sel.length === 1 && h !== null && h !== sel[0]) return this.twoSquare(t, sel[0], h);
    return null;
  });

  readonly candidateError = computed<string | null>(() => {
    const m = this.candidate.value;
    return m ? whyIllegal(this.live.value, m) : null;
  });

  readonly preview = computed<MovePreview | null>(() => {
    const m = this.candidate.value;
    if (!m || this.candidateError.value) return null;
    return previewMove(this.live.value, m);
  });

  readonly explanation = computed<Explanation | null>(() => {
    const pv = this.preview.value;
    return pv ? explainPreview(this.live.value, pv) : null;
  });

  /** Is the selection complete enough that a "Play move" button makes sense? */
  readonly readyToConfirm = computed(() => {
    const t = this.tool.value;
    const n = this.selection.value.length;
    return this.preview.value !== null && ((t === 'place' || t === 'observe') ? n === 1 : n === 2);
  });

  // ────────────────────────────── input ────────────────────────────────────

  /** Build a two-square move, turning split↔link automatically based on the target. */
  twoSquare(t: Tool, a: number, b: number): Move {
    if (t === 'merge') return { kind: 'merge', a, b, turns: this.knob.value };
    const s = this.live.value;
    const f = LEVELS[s.rules.level].features;
    const oppMaybe = s.q.cellDist(b)[other(s.toMove)] > CERTAIN_EPS;
    if (oppMaybe && f.link) return { kind: 'link', a, b };
    return { kind: 'split', a, b };
  }

  #needsConfirm(): boolean {
    const mode = settings.value.confirmMoves;
    if (mode === 'always') return true;
    if (mode === 'never') return false;
    return this.lastPointer.value !== 'mouse';
  }

  say(text: string, bad = false): void {
    if (bad) sfx.error();
    clearTimeout(this.#flashTimer);
    this.flash.value = { text, id: Date.now(), bad };
    this.#flashTimer = setTimeout(() => (this.flash.value = null), 3200);
  }

  #whyCantAct(): string {
    const s = this.live.value;
    if (s.result) return 'The game is over.';
    if (this.viewPly.value !== null) return "You're looking at the past — press “Live” to return.";
    if (this.anim.value) return 'Wait for the animation to finish.';
    if (this.thinking.value) return `${this.seats.value[s.toMove].name} is thinking…`;
    return `It's ${this.seats.value[s.toMove].name}'s turn.`;
  }

  setTool(t: Tool): void {
    if (!this.tools.value.includes(t)) return;
    batch(() => {
      this.tool.value = t;
      this.selection.value = [];
    });
    sfx.click();
  }

  setKnob(k: number): void {
    this.knob.value = ((k % 4) + 4) % 4;
    sfx.tick();
  }

  clearSelection(): void {
    this.selection.value = [];
  }

  clickCell(i: number): void {
    if (!this.canAct.value) {
      this.say(this.#whyCantAct(), true);
      return;
    }
    const s = this.live.value;
    const t = this.tool.value;
    const sel = this.selection.value;
    const confirm = this.#needsConfirm();

    if (t === 'place' || t === 'observe') {
      const m: Move = t === 'place' ? { kind: 'place', cell: i } : { kind: 'observe', cell: i };
      const err = whyIllegal(s, m);
      if (err) return this.say(err, true);
      // Observe always takes two taps: it costs ⚡ and can't be undone.
      if ((confirm || t === 'observe') && !(sel.length === 1 && sel[0] === i)) {
        this.selection.value = [i];
        sfx.select();
        return;
      }
      return this.commit(m);
    }

    // Two-square tools: split, link, merge.
    if (sel.length === 0 || sel.length === 2) {
      if (sel.length === 2) {
        if (i === sel[1] && t !== 'merge') return this.commit(this.twoSquare(t, sel[0], sel[1]));
        if (i === sel[0] || i === sel[1]) {
          this.selection.value = [];
          return;
        }
      }
      if (t !== 'merge' && !s.q.certainlyEmpty(i)) {
        return this.say('Start on a square that is empty in every universe — your new token appears there first.', true);
      }
      this.selection.value = [i];
      sfx.select();
      return;
    }
    if (i === sel[0]) {
      this.selection.value = [];
      return;
    }
    const m = this.twoSquare(t, sel[0], i);
    const err = whyIllegal(s, m);
    if (err) return this.say(err, true);
    if (t === 'merge' || confirm) {
      this.selection.value = [sel[0], i];
      sfx.select();
      return;
    }
    this.commit(m);
  }

  /** Drag from one square to another: a quick split / link / merge. */
  dragCells(a: number, b: number): void {
    if (!this.canAct.value || a === b) return;
    const s = this.live.value;
    let t = this.tool.value;
    if (t === 'place' || t === 'observe') {
      if (!LEVELS[s.rules.level].features.split) return;
      t = 'split';
      this.tool.value = 'split';
    }
    const m = this.twoSquare(t, a, b);
    const err = whyIllegal(s, m);
    if (err) return this.say(err, true);
    if (t === 'merge') {
      this.selection.value = [a, b];
      return;
    }
    this.commit(m);
  }

  confirm(): void {
    const pv = this.preview.value;
    if (pv && this.readyToConfirm.value) this.commit(pv.move);
  }

  commit(m: Move): void {
    if (!this.canAct.value) return;
    const err = whyIllegal(this.live.value, m);
    if (err) return this.say(err, true);
    batch(() => {
      this.selection.value = [];
      this.hover.value = null;
      this.hints.value = null;
      this.peek.value = null;
      this.pinned.value = null;
    });
    this.driver.submit(this, m);
  }

  /** Show a suggested move on the board (as a selection with preview). */
  applyHint(h: Hint): void {
    const m = h.move;
    batch(() => {
      this.tool.value = m.kind;
      if (m.kind === 'place' || m.kind === 'observe') this.selection.value = [m.cell];
      else {
        if (m.kind === 'merge') this.knob.value = m.turns;
        this.selection.value = [m.a, m.b];
      }
    });
  }

  async requestHints(): Promise<void> {
    if (!this.hintsAllowed.value || !this.canAct.value || this.hintsLoading.value) return;
    this.hintsLoading.value = true;
    const at = this.live.value;
    try {
      const hints = await ai.hints(at, 3);
      if (this.live.value === at) this.hints.value = hints;
    } catch (err) {
      console.error(err);
      this.say('The hint engine hiccuped — try again.', true);
    } finally {
      this.hintsLoading.value = false;
    }
  }

  // ──────────────────────── accepting moves ────────────────────────────────

  /** Record a move that has been played (by anyone) and queue its animations. */
  accept(move: Move, mover: Player, out: MoveOutcome): void {
    const snap: Snapshot = { state: out.state, move, mover, events: out.events };
    batch(() => {
      this.snapshots.value = [...this.snapshots.value, snap];
      this.hints.value = null;
      this.selection.value = [];
    });
    if (!this.muted) ({ place: sfx.place, split: sfx.split, link: sfx.link, observe: sfx.observe, merge: sfx.merge })[move.kind]();
    for (const e of out.events) {
      if (e.type === 'measure') this.#queue.push({ kind: 'measure', id: animIds++, event: e, mover });
      if (e.type === 'collapse') this.#queue.push({ kind: 'collapse', id: animIds++, event: e });
    }
    if (!this.anim.value) this.#nextAnim();
  }

  /** End the game from outside the engine (resignation, abandonment). */
  endWith(result: GameResult): void {
    const list = this.snapshots.value;
    const last = list[list.length - 1];
    if (last.state.result) return;
    this.snapshots.value = [...list.slice(0, -1), { ...last, state: { ...last.state, result } }];
  }

  /** Replace the whole history (online resync, tutorials). */
  resetHistory(snaps: Snapshot[]): void {
    this.#queue = [];
    batch(() => {
      this.snapshots.value = snaps;
      this.anim.value = null;
      this.viewPly.value = null;
      this.selection.value = [];
      this.hints.value = null;
    });
    this.#resolveIdle();
  }

  /** Remove the last `n` snapshots (undo). */
  truncate(n: number): void {
    const list = this.snapshots.value;
    if (list.length <= 1) return;
    this.#queue = [];
    batch(() => {
      this.snapshots.value = list.slice(0, Math.max(1, list.length - n));
      this.anim.value = null;
      this.selection.value = [];
      this.hints.value = null;
      this.viewPly.value = null;
    });
    this.#resolveIdle();
  }

  #nextAnim(): void {
    const next = this.#queue.shift() ?? null;
    this.anim.value = next;
    if (!next) this.#resolveIdle();
  }

  /** Called by the overlay when an animation has finished (or was skipped). */
  finishAnim(id: number): void {
    if (this.anim.value?.id === id) this.#nextAnim();
  }

  skipAnims(): void {
    this.#queue = [];
    this.#nextAnim();
  }

  #resolveIdle(): void {
    const waiters = this.#idleWaiters;
    this.#idleWaiters = [];
    for (const w of waiters) w();
  }

  /** Resolves once all queued animations have played. */
  whenIdle(): Promise<void> {
    if (!this.anim.value && this.#queue.length === 0) return Promise.resolve();
    return new Promise((r) => this.#idleWaiters.push(r));
  }

  // ─────────────────────────── time travel ─────────────────────────────────

  setViewPly(ply: number | null): void {
    const max = this.snapshots.value.length - 1;
    batch(() => {
      this.viewPly.value = ply === null || ply >= max ? null : Math.max(0, ply);
      this.selection.value = [];
      this.peek.value = null;
      this.pinned.value = null;
    });
  }

  step(delta: number): void {
    const max = this.snapshots.value.length - 1;
    const cur = this.viewPly.value ?? max;
    this.setViewPly(cur + delta);
  }
}

// ─────────────────────────────── Drivers ───────────────────────────────────

/**
 * Plays everything on this device: pass-and-play, the sandbox, and games
 * against the bot. Randomness comes from a per-game seed, so "undo and try
 * again" gives the same dice — no fishing for lucky collapses!
 */
export class LocalDriver implements Driver {
  readonly seed: string;
  #epoch = 0;

  constructor(seed = randomSeed()) {
    this.seed = seed;
  }

  start(ctrl: GameController): void {
    void this.#maybeBot(ctrl);
  }

  dispose(): void {
    this.#epoch++;
  }

  submit(ctrl: GameController, move: Move): void {
    const s = ctrl.live.value;
    const out = applyMove(s, move, rngForPly(this.seed, s.ply));
    ctrl.accept(move, s.toMove, out);
    void this.#maybeBot(ctrl);
  }

  undo(ctrl: GameController): void {
    this.#epoch++;
    ctrl.thinking.value = false;
    const snaps = ctrl.snapshots.value;
    // Step back to the previous position where a local human is to move.
    let n = 0;
    for (let i = snaps.length - 1; i > 0; i--) {
      n++;
      const prev = snaps[i - 1].state;
      if (ctrl.seats.value[prev.toMove].kind === 'human') break;
    }
    ctrl.truncate(n);
  }

  async #maybeBot(ctrl: GameController): Promise<void> {
    const epoch = this.#epoch;
    const s = ctrl.live.value;
    if (s.result || ctrl.disposed) return;
    const seat = ctrl.seats.value[s.toMove];
    if (seat.kind !== 'bot') return;
    ctrl.thinking.value = true;
    await ctrl.whenIdle();
    const t0 = performance.now();
    let move: Move;
    try {
      move = await ai.move(ctrl.live.value, seat.difficulty ?? 'medium');
    } catch (err) {
      console.error('bot failed', err);
      ctrl.thinking.value = false;
      return;
    }
    const wait = 700 - (performance.now() - t0);
    if (wait > 0) await sleep(wait);
    if (epoch !== this.#epoch || ctrl.disposed || ctrl.live.value !== s) return;
    ctrl.thinking.value = false;
    const out = applyMove(s, move, rngForPly(this.seed, s.ply));
    ctrl.accept(move, s.toMove, out);
    void this.#maybeBot(ctrl);
  }
}
