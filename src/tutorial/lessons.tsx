/**
 * lessons.tsx — the interactive tutorials.
 *
 * A lesson is a scripted game: the learner plays one side, the lesson plays
 * the other (and can pre-play a few moves to set up a position). Each step
 * shows coach text, may spotlight part of the screen, and waits for the
 * learner to do something specific (pick a tool, play a certain move, peek
 * at a universe…) or just press Next.
 *
 * Measurements inside lessons use scripted random numbers (`rolls`), so the
 * story always unfolds the same way — the text tells you when that happens.
 */

import type { JSX } from 'preact';
import { X, previewMove, type GameState, type Level, type Move, type Player, type RuleSet } from '../engine/index.ts';
import type { Tool } from '../ui/game/controller.ts';
import { Term } from '../ui/components/Term.tsx';

export type Expect =
  | { kind: 'next' }
  | { kind: 'move'; match: (m: Move, s: GameState) => boolean; hint: string }
  | { kind: 'tool'; tool: Tool }
  | { kind: 'select'; cells: number[] }
  | { kind: 'peek' };

export interface LessonStep {
  title?: string;
  text: () => JSX.Element;
  /** CSS selector of something to spotlight. */
  spot?: string;
  /** Spotlight on phones instead (where the screen can't show everything at once); 'none' for no spotlight. */
  spotPhone?: string;
  /** Board squares to highlight. */
  cells?: number[];
  expect?: Expect;
  /** Moves played automatically (by the lesson) when the step starts. */
  auto?: Move[];
  /** Random numbers to use for any measurement during this step. */
  rolls?: number[];
  tools?: Tool[];
  tool?: Tool;
  nextLabel?: string;
}

export interface Lesson {
  id: string;
  level: Level;
  title: string;
  blurb: string;
  minutes: number;
  rules: RuleSet;
  learner: Player;
  opponent: string;
  /** Moves played instantly before step 1 (to start from an interesting position). */
  setup?: Move[];
  steps: LessonStep[];
  /** Level unlocked for quick play when the lesson is finished. */
  unlocks: Level;
}

const place = (cell: number) => (m: Move) => m.kind === 'place' && m.cell === cell;
const split = (a: number, b: number) => (m: Move) =>
  m.kind === 'split' && ((m.a === a && m.b === b) || (m.a === b && m.b === a));
const link = (a: number, b: number) => (m: Move) => m.kind === 'link' && m.a === a && m.b === b;
const observe = (cell: number) => (m: Move) => m.kind === 'observe' && m.cell === cell;

export const LESSONS: Lesson[] = [
  // ─────────────────────────────── Level 0 ─────────────────────────────────
  {
    id: 'basics',
    level: 0,
    title: 'The board',
    blurb: 'Plain tic-tac-toe, and how this board shows you things.',
    minutes: 1,
    rules: { level: 0, quanta: 0 },
    learner: X,
    opponent: 'Coach O',
    unlocks: 1,
    steps: [
      {
        title: 'Welcome!',
        text: () => (
          <>
            Tiq Taq Two starts as ordinary tic-tac-toe: you are <strong>X</strong>, get three in a row to win. Soon your
            tokens will learn some quantum tricks — but first, the basics.
          </>
        ),
        nextLabel: "Let's go",
      },
      {
        text: () => <>Hover (or tap) the centre square ⑤. The board previews what your move would do. Click it to play.</>,
        cells: [4],
        spot: '.board-area',
        expect: { kind: 'move', match: place(4), hint: 'Place your X in the centre, square ⑤.' },
      },
      {
        text: () => <>Coach O answered on ②. Now take the corner ③ — that sets up the diagonal ③ ⑤ ⑦.</>,
        auto: [{ kind: 'place', cell: 1 }],
        cells: [2],
        expect: { kind: 'move', match: place(2), hint: 'Place on the top-right corner, square ③.' },
      },
      {
        text: () => <>Coach O forgot to block! Finish the diagonal on ⑦.</>,
        auto: [{ kind: 'place', cell: 8 }],
        cells: [6],
        expect: { kind: 'move', match: place(6), hint: 'Complete the diagonal: square ⑦.' },
      },
      {
        title: 'Three in a row!',
        text: () => (
          <>
            That's the classic game. Everything you know still works in Tiq Taq Two — the quantum moves are extra
            options. Next lesson: how one X can be in <em>two</em> squares at once.
          </>
        ),
        nextLabel: 'Finish lesson',
      },
    ],
  },

  // ─────────────────────────────── Level 1 ─────────────────────────────────
  {
    id: 'superposition',
    level: 1,
    title: 'Superposition',
    blurb: 'Split a token across two squares and meet the multiverse.',
    minutes: 3,
    rules: { level: 1, quanta: 0 },
    learner: X,
    opponent: 'Coach O',
    unlocks: 2,
    steps: [
      {
        title: 'Two places at once',
        text: () => (
          <>
            In this game every square is a tiny quantum object. That lets your X be in two squares <em>at the same
            time</em> — physicists call it <Term k="superposition" />. Let's try.
          </>
        ),
        nextLabel: 'Show me',
      },
      {
        text: () => <>Pick the <strong>Split</strong> tool.</>,
        spot: '.tool-split',
        expect: { kind: 'tool', tool: 'split' },
      },
      {
        text: () => (
          <>
            Tap ① and then ③ (with a mouse you can also drag from ① to ③). Your X will be in <strong>both</strong>.
          </>
        ),
        cells: [0, 2],
        tool: 'split',
        expect: { kind: 'move', match: split(0, 2), hint: 'Split between the top corners: ① and ③.' },
      },
      {
        title: 'Ghosts',
        text: () => (
          <>
            Both faint X's are the <em>same</em> token, 50% in each square. The ring around a square shows its odds:
            X in blue, empty in grey. It is not secretly in one of them — the game genuinely keeps both possibilities.
          </>
        ),
        spot: '.board-area',
      },
      {
        title: 'The multiverse',
        text: () => (
          <>
            The <strong>Multiverse</strong> panel lists every ordinary board the game could turn out to be — right now
            two <Term k="universe">universes</Term>. Hover or tap a card to peek at it on the board.
          </>
        ),
        spot: '.gl-side',
        expect: { kind: 'peek' },
      },
      {
        text: () => <>Coach O took the centre. Split again, across the bottom corners ⑦ and ⑨.</>,
        auto: [{ kind: 'place', cell: 4 }],
        cells: [6, 8],
        tool: 'split',
        expect: { kind: 'move', match: split(6, 8), hint: 'Split between the bottom corners: ⑦ and ⑨.' },
      },
      {
        title: '2 × 2 = 4 universes',
        text: () => (
          <>
            Each split doubles the universes: 2 × 2 = 4 (count the Multiverse cards). In one of them X sits on both ①
            and ⑦ — so an X on ④ would finish the left column <em>in that universe only</em>. A line in just some
            universes doesn't win: every universe has to agree, or the board has to collapse first.
          </>
        ),
        spot: '.board-area',
      },
      {
        text: () => (
          <>
            Coach O threatens the middle row (④ ⑤ ⑥). Switch to <strong>Place</strong> and block on ④.
          </>
        ),
        auto: [{ kind: 'place', cell: 5 }],
        cells: [3],
        tool: 'place',
        expect: { kind: 'move', match: place(3), hint: 'Block the middle row: place on ④.' },
      },
      {
        title: 'Heads up: a collapse is coming',
        text: () => (
          <>
            O now threatens the middle column. Block ⑧ — but look at the preview first: after this move no square
            is empty in <em>every</em> universe, so nobody could place a token. The board will{' '}
            <Term k="collapse" />: one universe becomes real.
          </>
        ),
        auto: [{ kind: 'place', cell: 1 }],
        cells: [7],
        tool: 'place',
        rolls: [0.1],
        expect: { kind: 'move', match: place(7), hint: 'Block the middle column: place on ⑧.' },
      },
      {
        title: 'Reality chose!',
        text: () => (
          <>
            The wheel gave each universe a slice as big as its <Term k="probability" />, and the universe with your X
            on ① and ⑦ became real — only a 25% chance, the dice were kind today! Splits let you threaten several lines
            at once; the collapse decides which survives.
          </>
        ),
        nextLabel: 'Finish lesson',
      },
    ],
  },

  // ─────────────────────────────── Level 2 ─────────────────────────────────
  {
    id: 'entanglement',
    level: 2,
    title: 'Entanglement & observation',
    blurb: 'Link your fate to your opponent’s token, then look.',
    minutes: 3,
    rules: { level: 2, quanta: 2 },
    learner: X,
    opponent: 'Coach O',
    unlocks: 3,
    steps: [
      {
        title: 'Spooky links',
        text: () => (
          <>
            Level 2 adds two moves: <strong>Link</strong> creates <Term k="entanglement" /> with an opponent's token,
            and <strong>Observe</strong> (costs ⚡1) forces a square to decide. Start by placing an X on ①.
          </>
        ),
        cells: [0],
        tool: 'place',
        expect: { kind: 'move', match: place(0), hint: 'Place on the top-left corner, ①.' },
      },
      {
        text: () => (
          <>
            O is in the centre. Pick <strong>Link</strong>, tap the empty ⑨ (your new X starts there), then tap O's ⑤.
          </>
        ),
        auto: [{ kind: 'place', cell: 4 }],
        spot: '.tool-link',
        cells: [8, 4],
        expect: { kind: 'move', match: link(8, 4), hint: 'Link: first the empty ⑨, then O’s ⑤.' },
      },
      {
        title: 'Entangled!',
        text: () => (
          <>
            Your X and O's token did a <Term k="halfswap">half-swap</Term>: either X is on ⑨ and O on ⑤ — or they traded
            places. Neither square has a value on its own; only the <em>pair</em> does. Tap the purple ⇄ badge
            between them to read the link.
          </>
        ),
        spot: '.board-area',
      },
      {
        text: () => (
          <>
            Peek at the two universes in the Multiverse panel: in one the tokens stayed, in the other they swapped.
          </>
        ),
        spot: '.gl-side',
        expect: { kind: 'peek' },
      },
      {
        title: 'Look!',
        text: () => (
          <>
            You have ⚡2. Pick <strong>Observe</strong> and tap ⑤ twice (select, then confirm). It costs ⚡1 and your
            turn, and forces ⑤ to decide.
          </>
        ),
        auto: [{ kind: 'place', cell: 2 }],
        spot: '.tool-observe',
        cells: [4],
        rolls: [0.3],
        expect: { kind: 'move', match: observe(4), hint: 'Observe the centre square ⑤.' },
      },
      {
        title: 'Spooky action',
        text: () => (
          <>
            ⑤ turned out X — and ⑨ instantly became O, although you never touched it. The two answers were linked all
            along. (No message travelled between the squares: entanglement correlates results, it can't send
            signals.)
          </>
        ),
        spot: '.board-area',
      },
      {
        title: 'Summary',
        text: () => (
          <>
            <strong>Link</strong> half-swaps your new token with one of your opponent's. <strong>Observe</strong>{' '}
            spends ⚡ to settle a square — handy to kill a threat that exists only in some universes. Level 3 adds the
            strangest idea of all: universes that cancel.
          </>
        ),
        nextLabel: 'Finish lesson',
      },
    ],
  },

  // ─────────────────────────────── Level 3 ─────────────────────────────────
  {
    id: 'interference',
    level: 3,
    title: 'Phase & interference',
    blurb: 'Turn a knob and make a universe cancel itself out.',
    minutes: 4,
    rules: { level: 3, quanta: 3 },
    learner: X,
    opponent: 'Coach O',
    unlocks: 3,
    setup: [
      { kind: 'split', a: 3, b: 5 },
      { kind: 'place', cell: 1 },
      { kind: 'place', cell: 0 },
      { kind: 'place', cell: 8 },
      { kind: 'place', cell: 6 },
      { kind: 'place', cell: 7 },
    ],
    steps: [
      {
        title: 'A dangerous moment',
        text: () => (
          <>
            This lesson starts mid-game. Your X is split between ④ and ⑥. In the universe where it's on ④ you already
            own the left column (① ④ ⑦) — but that's only 50%. Meanwhile O threatens the middle column: if O gets ⑤,
            O wins.
          </>
        ),
        spot: '.board-area',
        cells: [3, 5],
      },
      {
        title: 'Arrows',
        text: () => (
          <>
            Every universe carries an arrow — its <Term k="amplitude" />. Length² is the probability; the direction is
            the <Term k="phase" />. Look at the little dials on the universe cards: both 50%, but pointing different
            ways (0° and 90°). Phase is invisible… until universes meet.
          </>
        ),
        spot: '.gl-side',
      },
      {
        text: () => (
          <>
            Pick <strong>Merge</strong> (⚡1). It twists the phase of the first square with a knob, then half-swaps the
            two squares so the two universes land on the same boards and <Term k="interference">interfere</Term>.
          </>
        ),
        spot: '.tool-merge',
        expect: { kind: 'tool', tool: 'merge' },
      },
      {
        text: () => <>Tap ④ and then ⑥.</>,
        cells: [3, 5],
        tool: 'merge',
        expect: { kind: 'select', cells: [3, 5] },
      },
      {
        title: 'Turn the knob',
        text: () => (
          <>
            Turn the knob and watch the preview: the probability sloshes between ④ and ⑥ like a wave (the chart in
            the move card draws the whole wave). Find the setting where your X lands <strong>100% on ④</strong>, then
            play it.
          </>
        ),
        spot: '.preview-card',
        // Phones: the knob sits in the bar above the tools; keep the board undimmed to watch it work.
        spotPhone: 'none',
        tool: 'merge',
        expect: {
          kind: 'move',
          match: (m, s) =>
            m.kind === 'merge' &&
            ((m.a === 3 && m.b === 5) || (m.a === 5 && m.b === 3)) &&
            previewMove(s, m).q.cellDist(3)[X] > 0.999,
          hint: 'Not that knob setting — look for the one where the preview shows X 100% on ④.',
        },
      },
      {
        title: 'Destructive interference',
        text: () => (
          <>
            The universe with X on ⑥ was reached from two directions with opposite arrows — they cancelled to exactly
            zero. Every remaining universe has your left column: you win with certainty, no dice needed. This
            cancelling is how quantum computers make wrong answers disappear.
          </>
        ),
        spot: '.board-area',
        nextLabel: 'Finish lesson',
      },
    ],
  },
];

export const lessonById = (id: string): Lesson | undefined => LESSONS.find((l) => l.id === id);

