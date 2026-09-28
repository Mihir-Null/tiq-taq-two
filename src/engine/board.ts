/**
 * board.ts — classical boards ("universes") and how we number them.
 *
 * Each of the 9 squares is a QUTRIT: a quantum object with three basis
 * states instead of a qubit's two:
 *
 *      |E⟩ = empty      |X⟩ = holds an X      |O⟩ = holds an O
 *
 * A *classical* board is one definite choice for all 9 squares, e.g.
 * "X·O·X····". There are 3⁹ = 19 683 of them. We encode a board as a single
 * integer in base 3 — digit i is square i — so a board is just a number in
 * [0, 19683). That makes boards cheap Map keys and gives every client the
 * same canonical ordering (sort by number).
 *
 * Squares are indexed 0‥8 in reading order; the UI shows them as 1‥9:
 *
 *      0 1 2        ① ② ③
 *      3 4 5   →    ④ ⑤ ⑥
 *      6 7 8        ⑦ ⑧ ⑨
 */

/** Values a square can take. (Plain constants: `enum` is not type-erasable.) */
export const EMPTY = 0;
export const X = 1;
export const O = 2;
export type Cell = typeof EMPTY | typeof X | typeof O;

/** Players reuse the token numbers: player X places `X` (1), player O places `O` (2). */
export type Player = typeof X | typeof O;
export const other = (p: Player): Player => (p === X ? O : X);
export const playerChar = (p: Player): 'X' | 'O' => (p === X ? 'X' : 'O');
export const cellChar = (v: Cell): string => (v === X ? 'X' : v === O ? 'O' : '·');

export const NUM_CELLS = 9;
export const NUM_BOARDS = 19683; // 3^9
export const POW3: readonly number[] = [1, 3, 9, 27, 81, 243, 729, 2187, 6561];
export const ALL_CELLS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];

/** Read square `i` of board `code`. */
export const cellOf = (code: number, i: number): Cell =>
  (Math.floor(code / POW3[i]) % 3) as Cell;

/** Return a new board code with square `i` set to `v`. */
export const withCell = (code: number, i: number, v: Cell): number =>
  code + (v - cellOf(code, i)) * POW3[i];

export function encode(cells: readonly Cell[]): number {
  let code = 0;
  for (let i = 0; i < NUM_CELLS; i++) code += cells[i] * POW3[i];
  return code;
}

export function decode(code: number): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < NUM_CELLS; i++) out.push(cellOf(code, i));
  return out;
}

/** Parse a 9-char board string like "X.O......" (".", "·", "_" or "E" = empty). */
export function parseBoard(s: string): number {
  const chars = s.replace(/\s+/g, '');
  if (chars.length !== NUM_CELLS) throw new Error(`board string needs 9 squares: "${s}"`);
  return encode([...chars].map((ch) => (ch === 'X' ? X : ch === 'O' ? O : EMPTY)) as Cell[]);
}

/** "X·O·X····" — compact text form used in logs, notation and the math view. */
export const boardString = (code: number): string => decode(code).map(cellChar).join('');

/** The 8 winning lines: 3 rows, 3 columns, 2 diagonals. */
export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
export const LINE_NAMES = ['top row', 'middle row', 'bottom row', 'left column', 'middle column', 'right column', 'diagonal ↘', 'diagonal ↙'];

/** Indices (into LINES) of every line fully owned by player `p` on this board. */
export function linesOf(code: number, p: Player): number[] {
  const out: number[] = [];
  for (let l = 0; l < LINES.length; l++) {
    const [a, b, c] = LINES[l];
    if (cellOf(code, a) === p && cellOf(code, b) === p && cellOf(code, c) === p) out.push(l);
  }
  return out;
}

export const countLines = (code: number, p: Player): number => linesOf(code, p).length;

/** How many tokens (X or O) sit on this board. */
export function tokenCount(code: number): number {
  let n = 0;
  for (let i = 0; i < NUM_CELLS; i++) if (cellOf(code, i) !== EMPTY) n++;
  return n;
}

/** Circled numerals used for square names in the UI: ① … ⑨. */
export const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
export const squareName = (i: number): string => CIRCLED[i] ?? `#${i + 1}`;

/**
 * The result of one *classical* board, using this game's scoring:
 * whoever owns MORE complete lines wins; equal counts are a tie.
 * (In ordinary play the game stops at the first line, so this reduces to
 * normal tic-tac-toe. Collapses can produce boards where both players have
 * lines — then the count decides.)
 */
export interface BoardVerdict {
  xLines: number;
  oLines: number;
  /** X or O if they lead on lines, 0 for a tie with lines, null if nobody has a line. */
  leader: Player | 0 | null;
}

export function verdictOf(code: number): BoardVerdict {
  const xLines = countLines(code, X);
  const oLines = countLines(code, O);
  let leader: Player | 0 | null = null;
  if (xLines + oLines > 0) leader = xLines > oLines ? X : oLines > xLines ? O : 0;
  return { xLines, oLines, leader };
}
