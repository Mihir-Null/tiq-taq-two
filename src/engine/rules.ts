/**
 * rules.ts — the game itself: levels, moves, turn resolution and scoring.
 *
 * ┌──────────────────────── RULES IN ONE SCREEN ────────────────────────────┐
 * │ The board is 9 qutrits. The game state is a superposition of classical  │
 * │ boards ("universes"). Every token move adds exactly one token to EVERY  │
 * │ universe, so all universes always hold the same number of tokens.       │
 * │                                                                         │
 * │ Level 0  Classic     PLACE on a square that is empty in every universe. │
 * │ Level 1  Superpos.   + SPLIT: your token goes into two empty squares.   │
 * │ Level 2  Entangle.   + LINK: your token half-swaps with an opponent's.  │
 * │                      + OBSERVE (⚡1): measure one uncertain square.     │
 * │ Level 3  Interfer.   + MERGE (⚡1): twist a phase knob, then half-swap  │
 * │                        two squares so universes meet and interfere.     │
 * │                                                                         │
 * │ After every move:                                                       │
 * │  • If EVERY universe contains a finished line → the game ends. If all   │
 * │    universes agree on the result, no dice needed; otherwise the board   │
 * │    collapses to one universe (Born rule) and that one decides.          │
 * │  • If NO square is empty in every universe (e.g. the board is full)     │
 * │    → the board collapses. A full board then ends the game.              │
 * │ Scoring on a classical board: more complete lines wins; equal = draw.   │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { QState, CERTAIN_EPS, type Trace } from './qstate.ts';
import { placeGate, HALF_SWAP, knobGate } from './gates.ts';
import {
  EMPTY, X, O, other, verdictOf, NUM_CELLS, ALL_CELLS, squareName,
  type Cell, type Player,
} from './board.ts';

// ─────────────────────────────── Levels ────────────────────────────────────

export type Level = 0 | 1 | 2 | 3;
export const ALL_LEVELS: readonly Level[] = [0, 1, 2, 3];

export interface LevelFeatures {
  split: boolean;
  link: boolean;
  observe: boolean;
  merge: boolean;
}

export interface LevelInfo {
  level: Level;
  name: string;
  tagline: string;
  features: LevelFeatures;
  /** How many ⚡ quanta each player starts with by default. */
  defaultQuanta: number;
}

export const LEVELS: Record<Level, LevelInfo> = {
  0: {
    level: 0, name: 'Classic', tagline: 'Plain old tic-tac-toe',
    features: { split: false, link: false, observe: false, merge: false }, defaultQuanta: 0,
  },
  1: {
    level: 1, name: 'Superposition', tagline: 'Be in two places at once',
    features: { split: true, link: false, observe: false, merge: false }, defaultQuanta: 0,
  },
  2: {
    level: 2, name: 'Entanglement', tagline: 'Spooky links & observation',
    features: { split: true, link: true, observe: true, merge: false }, defaultQuanta: 2,
  },
  3: {
    level: 3, name: 'Interference', tagline: 'Universes can cancel out',
    features: { split: true, link: true, observe: true, merge: true }, defaultQuanta: 3,
  },
};

export interface RuleSet {
  level: Level;
  /** ⚡ each player starts with (spent on Observe and Merge). */
  quanta: number;
}

export const defaultRules = (level: Level): RuleSet => ({ level, quanta: LEVELS[level].defaultQuanta });

// ─────────────────────────────── Moves ─────────────────────────────────────

export type Move =
  /** Put your token on a square that is empty in every universe. */
  | { kind: 'place'; cell: number }
  /** Token appears on `a`, then half-swaps with EMPTY square `b`: 50/50 in both. */
  | { kind: 'split'; a: number; b: number }
  /** Token appears on `a`, then half-swaps with square `b` where the opponent may be. */
  | { kind: 'link'; a: number; b: number }
  /** Measure square `cell` (costs ⚡1). */
  | { kind: 'observe'; cell: number }
  /** Twist the phase of square `a` by `turns` × 90°, then half-swap `a` and `b` (costs ⚡1). */
  | { kind: 'merge'; a: number; b: number; turns: number };

export type MoveKind = Move['kind'];

export const MOVE_COST: Record<MoveKind, number> = { place: 0, split: 0, link: 0, observe: 1, merge: 1 };

/** Does this move add a token to the board? (Observe and Merge don't.) */
export const addsToken = (m: Move): boolean => m.kind === 'place' || m.kind === 'split' || m.kind === 'link';

export const moveCells = (m: Move): number[] =>
  m.kind === 'place' || m.kind === 'observe' ? [m.cell] : [m.a, m.b];

export function sameMove(a: Move, b: Move): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'place':
    case 'observe':
      return a.cell === (b as typeof a).cell;
    case 'merge': {
      const m = b as typeof a;
      return a.a === m.a && a.b === m.b && ((a.turns - m.turns) % 4 + 4) % 4 === 0;
    }
    default: {
      const m = b as typeof a;
      return a.a === m.a && a.b === m.b;
    }
  }
}

// ─────────────────────────── Game state & events ───────────────────────────

export type EndReason = 'line' | 'decided' | 'full' | 'resign' | 'abandon';

export interface GameResult {
  /** The winner, or null for a draw. */
  winner: Player | null;
  xLines: number;
  oLines: number;
  /** The classical board that became real (null if all universes agreed without collapsing). */
  code: number | null;
  /** True when the outcome was the same in every universe — no dice were needed. */
  certain: boolean;
  reason: EndReason;
}

export type CollapseReason = 'crowded' | 'full' | 'decided';

export type GameEvent =
  | { type: 'measure'; cell: number; outcome: Cell; p: number; r: number; before: QState }
  | { type: 'collapse'; reason: CollapseReason; code: number; p: number; r: number; before: QState }
  | { type: 'end'; result: GameResult };

export interface GameState {
  readonly rules: RuleSet;
  /** The quantum state of the board. */
  readonly q: QState;
  /** Tokens per universe (identical in all universes). */
  readonly tokens: number;
  readonly toMove: Player;
  /** Remaining ⚡ for [X, O]. */
  readonly quanta: readonly [number, number];
  /** Number of moves played so far. */
  readonly ply: number;
  readonly result: GameResult | null;
}

export function newGame(rules: RuleSet, first: Player = X): GameState {
  return {
    rules,
    q: QState.basis(0),
    tokens: 0,
    toMove: first,
    quanta: [rules.quanta, rules.quanta],
    ply: 0,
    result: null,
  };
}

export const quantaOf = (s: GameState, p: Player): number => s.quanta[p - 1];

export class IllegalMoveError extends Error {}

// ───────────────────────────── Validation ──────────────────────────────────

const inRange = (i: number): boolean => Number.isInteger(i) && i >= 0 && i < NUM_CELLS;

/**
 * Why can't this move be played? Returns a friendly explanation, or null if
 * the move is legal. The UI shows these strings as tooltips.
 */
export function whyIllegal(s: GameState, m: Move): string | null {
  if (s.result) return 'The game is over.';
  const f = LEVELS[s.rules.level].features;
  const me = s.toMove;
  const q = s.q;
  const cost = MOVE_COST[m.kind];
  if (cost > quantaOf(s, me)) return `That needs ⚡${cost} and you have none left.`;

  switch (m.kind) {
    case 'place':
      if (!inRange(m.cell)) return 'No such square.';
      if (!q.certainlyEmpty(m.cell)) return notEmptyReason(q, m.cell);
      return null;

    case 'split':
      if (!f.split) return 'Splitting unlocks at level 1 (Superposition).';
      if (!inRange(m.a) || !inRange(m.b)) return 'No such square.';
      if (m.a === m.b) return 'Pick two different squares.';
      if (!q.certainlyEmpty(m.a)) return notEmptyReason(q, m.a);
      if (!q.certainlyEmpty(m.b)) {
        const pOpp = q.cellDist(m.b)[other(me)];
        return pOpp > CERTAIN_EPS && f.link
          ? `${squareName(m.b)} may hold your opponent's token — that makes this a Link, not a Split.`
          : `A split needs two squares that are empty in every universe; ${squareName(m.b)} isn't.`;
      }
      return null;

    case 'link':
      if (!f.link) return 'Linking unlocks at level 2 (Entanglement).';
      if (!inRange(m.a) || !inRange(m.b)) return 'No such square.';
      if (m.a === m.b) return 'Pick two different squares.';
      if (!q.certainlyEmpty(m.a)) return `Your new token must start on a certainly-empty square. ${notEmptyReason(q, m.a)}`;
      if (q.cellDist(m.b)[other(me)] <= CERTAIN_EPS) {
        return `A link needs a square where your opponent's token might be; ${squareName(m.b)} never holds one.`;
      }
      return null;

    case 'observe':
      if (!f.observe) return 'Observing unlocks at level 2 (Entanglement).';
      if (!inRange(m.cell)) return 'No such square.';
      if (q.definite(m.cell) !== null) return `${squareName(m.cell)} is already certain — there is nothing to observe.`;
      return null;

    case 'merge': {
      if (!f.merge) return 'Merging unlocks at level 3 (Interference).';
      if (!inRange(m.a) || !inRange(m.b)) return 'No such square.';
      if (m.a === m.b) return 'Pick two different squares.';
      if (!Number.isInteger(m.turns)) return 'The knob only turns in quarter turns.';
      const after = mergeUnitary(q, m);
      if (after.samePhysicsAs(q)) return 'Merging these squares with this knob setting would change nothing.';
      return null;
    }
  }
}

function notEmptyReason(q: QState, i: number): string {
  const [pE] = q.cellDist(i);
  if (pE < CERTAIN_EPS) return `${squareName(i)} is taken.`;
  return `${squareName(i)} is only empty in ${Math.round(pE * 100)}% of universes — you can only place on certainly-empty squares.`;
}

export const isLegal = (s: GameState, m: Move): boolean => whyIllegal(s, m) === null;

/**
 * Every legal move. `dedupe` drops moves that are physically equivalent for
 * search purposes (split a→b vs b→a only differ by an unobservable phase
 * below level 3, where no Merge can ever reveal it).
 */
export function legalMoves(s: GameState, opts: { dedupe?: boolean } = {}): Move[] {
  if (s.result) return [];
  const out: Move[] = [];
  const f = LEVELS[s.rules.level].features;
  const empties = ALL_CELLS.filter((i) => s.q.certainlyEmpty(i));
  const phaseMatters = f.merge;
  for (const cell of empties) out.push({ kind: 'place', cell });
  if (f.split) {
    for (const a of empties) for (const b of empties) {
      if (a === b) continue;
      if (opts.dedupe && !phaseMatters && b < a) continue;
      out.push({ kind: 'split', a, b });
    }
  }
  const tryPush = (m: Move) => { if (isLegal(s, m)) out.push(m); };
  if (f.link) for (const a of empties) for (const b of ALL_CELLS) if (a !== b) tryPush({ kind: 'link', a, b });
  if (f.observe) for (const cell of ALL_CELLS) tryPush({ kind: 'observe', cell });
  if (f.merge) {
    for (let a = 0; a < NUM_CELLS; a++) for (let b = 0; b < NUM_CELLS; b++) {
      if (a === b) continue;
      for (let turns = 0; turns < 4; turns++) tryPush({ kind: 'merge', a, b, turns });
    }
  }
  return out;
}

// ───────────────────────────── Applying moves ──────────────────────────────

/** Put `player`'s token on `a`, then HALF_SWAP(a, b) — the split/link operator. */
function quantumPlace(q: QState, player: Player, a: number, b: number, trace?: Trace): QState {
  return q.applyOne(a, placeGate(player)).applyTwo(a, b, HALF_SWAP, trace);
}

/** KNOB(turns) on square a, then HALF_SWAP(a, b) — the merge operator. */
function mergeUnitary(q: QState, m: Extract<Move, { kind: 'merge' }>, trace?: Trace): QState {
  return q.applyOne(m.a, knobGate(m.turns)).applyTwo(m.a, m.b, HALF_SWAP, trace);
}

/**
 * The deterministic ("unitary") part of a move — everything except the dice.
 * For Observe this is the unchanged state (the measurement happens next).
 * Pass `trace` to record which universes fed which (for the UI).
 */
export function unitaryPart(s: GameState, m: Move, trace?: Trace): QState {
  const me = s.toMove;
  switch (m.kind) {
    case 'place':
      return s.q.applyOne(m.cell, placeGate(me));
    case 'split':
    case 'link':
      return quantumPlace(s.q, me, m.a, m.b, trace);
    case 'observe':
      return s.q;
    case 'merge':
      return mergeUnitary(s.q, m, trace);
  }
}

export interface MoveOutcome {
  state: GameState;
  events: GameEvent[];
}

/**
 * Play a move. `rng` supplies uniform numbers in [0,1) for any measurement
 * this move triggers (online games derive it from the shared seed and ply).
 */
export function applyMove(s: GameState, m: Move, rng: () => number): MoveOutcome {
  const why = whyIllegal(s, m);
  if (why) throw new IllegalMoveError(why);

  const me = s.toMove;
  const events: GameEvent[] = [];
  let q = unitaryPart(s, m);
  const quanta: [number, number] = [s.quanta[0], s.quanta[1]];
  quanta[me - 1] -= MOVE_COST[m.kind];

  if (m.kind === 'observe') {
    const r = rng();
    const res = q.measureCell(m.cell, r);
    events.push({ type: 'measure', cell: m.cell, outcome: res.outcome, p: res.p, r, before: q });
    q = res.state;
  }

  const next: GameState = {
    ...s,
    q,
    quanta,
    tokens: s.tokens + (addsToken(m) ? 1 : 0),
    toMove: other(me),
    ply: s.ply + 1,
  };
  return { state: resolve(next, rng, events), events };
}

// ─────────────────────────── End-of-move resolution ────────────────────────

interface DecidedStatus {
  /** Does every universe contain at least one completed line? */
  allHaveLines: boolean;
  /** If every universe has the same leader: X, O, or 0 (tie); otherwise undefined. */
  unanimous: Player | 0 | undefined;
}

export function decidedStatus(q: QState): DecidedStatus {
  let leader: Player | 0 | undefined;
  let mixed = false;
  for (const u of q.universes()) {
    const v = verdictOf(u.code);
    if (v.leader === null) return { allHaveLines: false, unanimous: undefined };
    if (leader === undefined) leader = v.leader;
    else if (leader !== v.leader) mixed = true;
  }
  return { allHaveLines: true, unanimous: mixed ? undefined : leader };
}

export const hasCertainlyEmptySquare = (q: QState): boolean => ALL_CELLS.some((i) => q.certainlyEmpty(i));

function resultFromBoard(code: number, reason: EndReason, certain: boolean): GameResult {
  const v = verdictOf(code);
  return {
    winner: v.leader === X || v.leader === O ? v.leader : null,
    xLines: v.xLines,
    oLines: v.oLines,
    code,
    certain,
    reason,
  };
}

/**
 * After a move: check whether the game is decided, and whether the board is
 * too crowded to continue without looking. May collapse the state (which
 * uses `rng`) and may end the game.
 */
function resolve(s: GameState, rng: () => number, events: GameEvent[]): GameState {
  let q = s.q;
  let rolledDice = events.some((e) => e.type === 'measure');
  const collapse = (reason: CollapseReason) => {
    if (q.isClassical) return; // nothing uncertain left: looking changes nothing
    const r = rng();
    const res = q.measureAll(r);
    events.push({ type: 'collapse', reason, code: res.code, p: res.p, r, before: q });
    q = res.state;
    rolledDice = true;
  };
  const finish = (result: GameResult): GameState => {
    events.push({ type: 'end', result });
    return { ...s, q, result };
  };

  // At most: one collapse, then one final check — the loop never spins long.
  for (let guard = 0; guard < 3; guard++) {
    const d = decidedStatus(q);
    if (d.allHaveLines) {
      if (d.unanimous !== undefined) {
        // Same result in every universe — the outcome is certain.
        const top = q.byProbability()[0];
        const v = verdictOf(top.code);
        return finish({
          winner: d.unanimous === 0 ? null : d.unanimous,
          xLines: v.xLines,
          oLines: v.oLines,
          code: q.isClassical ? top.code : null,
          // "Certain" = no dice decided it. An Observe earlier in this same move
          // did roll dice, even if every surviving universe now agrees.
          certain: !rolledDice,
          reason: 'line',
        });
      }
      // Every universe has a finished game, but they disagree: reality must pick one.
      collapse('decided');
      return finish(resultFromBoard(q.universes()[0].code, 'decided', false));
    }
    if (!hasCertainlyEmptySquare(q)) {
      const full = s.tokens >= NUM_CELLS;
      collapse(full ? 'full' : 'crowded');
      if (full) return finish(resultFromBoard(q.universes()[0].code, 'full', !rolledDice));
      continue; // the board is classical now — re-check for lines
    }
    break;
  }
  return { ...s, q };
}

/**
 * Does playing `m` roll any dice — an Observe, or a collapse the move
 * triggers? (Online, only such moves need both players' random values.)
 */
export function needsDice(s: GameState, m: Move): boolean {
  let rolled = false;
  applyMove(s, m, () => {
    rolled = true;
    return 0.5;
  });
  return rolled;
}

/** End the game because `player` resigned. */
export function resign(s: GameState, player: Player): GameState {
  if (s.result) return s;
  return {
    ...s,
    result: { winner: other(player), xLines: 0, oLines: 0, code: null, certain: true, reason: 'resign' },
  };
}

/** End the game because `player` left / timed out. */
export function abandon(s: GameState, player: Player): GameState {
  if (s.result) return s;
  return {
    ...s,
    result: { winner: other(player), xLines: 0, oLines: 0, code: null, certain: true, reason: 'abandon' },
  };
}

// ─────────────────────────── Previews (no dice) ────────────────────────────

export type Pending =
  | { kind: 'none' }
  | { kind: 'certain-end'; winner: Player | null }
  | { kind: 'collapse'; reason: CollapseReason };

/** What will happen right after a move leaves the board in state `q` with `tokens` tokens? */
export function pendingAfter(q: QState, tokens: number): Pending {
  const d = decidedStatus(q);
  if (d.allHaveLines) {
    return d.unanimous !== undefined
      ? { kind: 'certain-end', winner: d.unanimous === 0 ? null : d.unanimous }
      : { kind: 'collapse', reason: 'decided' };
  }
  if (!hasCertainlyEmptySquare(q)) return { kind: 'collapse', reason: tokens >= NUM_CELLS ? 'full' : 'crowded' };
  return { kind: 'none' };
}

export interface MovePreview {
  move: Move;
  /** State right after the move's unitary part (before any dice). */
  q: QState;
  trace: Trace;
  tokens: number;
  /** For Observe: each possible outcome with its probability and resulting state. */
  observeOutcomes: { outcome: Cell; p: number; q: QState }[] | null;
  /** What resolution would follow (ignoring Observe's randomness). */
  pending: Pending;
}

/** Everything the UI needs to show "what would this move do?" — without playing it. */
export function previewMove(s: GameState, m: Move): MovePreview {
  const trace: Trace = new Map();
  const q = unitaryPart(s, m, trace);
  const tokens = s.tokens + (addsToken(m) ? 1 : 0);
  let observeOutcomes: MovePreview['observeOutcomes'] = null;
  if (m.kind === 'observe') {
    const dist = q.cellDist(m.cell);
    observeOutcomes = ([EMPTY, X, O] as Cell[])
      .filter((v) => dist[v] > CERTAIN_EPS)
      .map((v) => {
        // Measure with an r that lands inside v's slice, to get the projected state.
        const lo = v === EMPTY ? 0 : v === X ? dist[0] : dist[0] + dist[1];
        return { outcome: v, p: dist[v], q: q.measureCell(m.cell, lo + dist[v] / 2).state };
      });
  }
  return { move: m, q, trace, tokens, observeOutcomes, pending: pendingAfter(q, tokens) };
}

/** Replay a whole game from its seed and move list (used for online sync & history). */
export function replay(
  rules: RuleSet,
  first: Player,
  moves: readonly Move[],
  rngFor: (ply: number) => () => number,
): { states: GameState[]; events: GameEvent[][] } {
  const states: GameState[] = [newGame(rules, first)];
  const events: GameEvent[][] = [];
  for (const m of moves) {
    const cur = states[states.length - 1];
    const out = applyMove(cur, m, rngFor(cur.ply));
    states.push(out.state);
    events.push(out.events);
  }
  return { states, events };
}

// ───────────────────────── All outcomes (for the bot) ──────────────────────

export interface Branch {
  /** Probability of this branch. */
  p: number;
  state: GameState;
  events: GameEvent[];
}

/**
 * Every way a move can turn out, with probabilities — instead of rolling the
 * dice once, enumerate them all. The bot uses this for "expectimax" search.
 *
 * Trick: rather than duplicating the rules, we call the real `applyMove` with
 * a *scripted* random-number generator whose values land in the middle of
 * each outcome's slice. So the bot can never disagree with the real rules.
 */
export function allOutcomes(s: GameState, m: Move): Branch[] {
  const mid = (lo: number, p: number) => lo + p / 2;
  const scripted = (values: number[]) => {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
  };

  // Stage 1: the Observe measurement (if any).
  const stage1: { p: number; r: number[]; q: QState; tokens: number }[] = [];
  const pv = previewMove(s, m);
  if (m.kind === 'observe' && pv.observeOutcomes) {
    const dist = pv.q.cellDist(m.cell);
    for (const o of pv.observeOutcomes) {
      const lo = o.outcome === EMPTY ? 0 : o.outcome === X ? dist[0] : dist[0] + dist[1];
      stage1.push({ p: o.p, r: [mid(lo, o.p)], q: o.q, tokens: pv.tokens });
    }
  } else {
    stage1.push({ p: 1, r: [], q: pv.q, tokens: pv.tokens });
  }

  // Stage 2: a collapse during resolution (if the resulting board needs one).
  const out: Branch[] = [];
  for (const st of stage1) {
    const pend = pendingAfter(st.q, st.tokens);
    if (pend.kind === 'collapse' && !st.q.isClassical) {
      let lo = 0;
      for (const u of st.q.universes()) {
        const res = applyMove(s, m, scripted([...st.r, mid(lo, u.p)]));
        out.push({ p: st.p * u.p, state: res.state, events: res.events });
        lo += u.p;
      }
    } else {
      const res = applyMove(s, m, scripted([...st.r, 0.5]));
      out.push({ p: st.p, state: res.state, events: res.events });
    }
  }
  return out;
}
