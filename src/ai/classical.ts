/**
 * classical.ts — perfect play for ordinary (classical) tic-tac-toe boards.
 *
 * The bot evaluates a quantum position by asking, for every universe:
 * "if nobody ever used a quantum move again, who would win from this board
 * with perfect play?" and averaging those answers weighted by probability.
 *
 * There are only 3⁹ boards × 2 players to move, so we can afford an exact
 * negamax with memoisation (computed lazily, a few ms in total).
 * Values are from X's point of view: +1 X wins, −1 O wins, 0 draw.
 */

import { cellOf, withCell, verdictOf, other, EMPTY, X, O, NUM_BOARDS, NUM_CELLS, LINES, type Player } from '../engine/board.ts';

const UNKNOWN = 9;
const memo = new Int8Array(NUM_BOARDS * 2).fill(UNKNOWN);

export function classicalValue(code: number, toMove: Player): number {
  const idx = code * 2 + (toMove - 1);
  const cached = memo[idx];
  if (cached !== UNKNOWN) return cached;

  let value: number;
  const v = verdictOf(code);
  if (v.leader !== null) {
    // Someone already has a line: scored by line count.
    value = v.leader === X ? 1 : v.leader === O ? -1 : 0;
  } else {
    const target = toMove === X ? 1 : -1;
    let best = -target * 2; // worse than any real outcome
    let anyMove = false;
    for (let i = 0; i < NUM_CELLS; i++) {
      if (cellOf(code, i) !== EMPTY) continue;
      anyMove = true;
      const child = classicalValue(withCell(code, i, toMove), other(toMove));
      if (toMove === X ? child > best : child < best) best = child;
      if (best === target) break; // can't do better than a forced win
    }
    value = anyMove ? best : 0; // full board, no lines: draw
  }
  memo[idx] = value;
  return value;
}

/**
 * A smooth "how promising are the lines" score in roughly [-1, 1] from X's
 * view: lines still open for only one player count, more tokens count more.
 * Used to break ties between positions the exact value calls equal (usually 0).
 */
export function linePotential(code: number): number {
  let s = 0;
  for (const [a, b, c] of LINES) {
    let xs = 0;
    let os = 0;
    for (const i of [a, b, c]) {
      const v = cellOf(code, i);
      if (v === X) xs++;
      else if (v === O) os++;
    }
    if (os === 0 && xs > 0) s += xs * xs;
    else if (xs === 0 && os > 0) s -= os * os;
  }
  return Math.tanh(s / 8);
}

// ───────────────────── Classical play with blocked squares ──────────────────
//
// Weakness of `classicalValue` for quantum positions: it lets each universe
// pick its own best continuation — "if ⑥ is empty here, I'll just play ⑥".
// But while ⑥ is uncertain NOBODY can place there (placement needs a square
// that is empty in every universe). Search people call this mistake
// "strategy fusion". `blockedValue` fixes the worst of it: squares that are
// uncertain are treated as unplayable, so a universe only gets credit for
// moves that are actually available.
//
// Boards now need 4 values per square (empty, X, O, blocked): 4⁹ = 262 144.

const POW4 = [1, 4, 16, 64, 256, 1024, 4096, 16384, 65536];
const BLOCKED = 3;
const memo4 = new Int8Array(262144 * 2).fill(UNKNOWN);
const digit4 = (code4: number, i: number): number => Math.floor(code4 / POW4[i]) % 4;

function blockedValue4(code4: number, toMove: Player): number {
  const idx = code4 * 2 + (toMove - 1);
  const cached = memo4[idx];
  if (cached !== UNKNOWN) return cached;
  let xl = 0;
  let ol = 0;
  for (const [a, b, c] of LINES) {
    const va = digit4(code4, a);
    if ((va === X || va === O) && va === digit4(code4, b) && va === digit4(code4, c)) {
      if (va === X) xl++;
      else ol++;
    }
  }
  let value: number;
  if (xl + ol > 0) value = xl > ol ? 1 : ol > xl ? -1 : 0;
  else {
    const target = toMove === X ? 1 : -1;
    let best = -target * 2;
    let anyMove = false;
    for (let i = 0; i < NUM_CELLS; i++) {
      if (digit4(code4, i) !== EMPTY) continue;
      anyMove = true;
      const child = blockedValue4(code4 + toMove * POW4[i], other(toMove));
      if (toMove === X ? child > best : child < best) best = child;
      if (best === target) break;
    }
    value = anyMove ? best : 0;
  }
  memo4[idx] = value;
  return value;
}

/**
 * Classical value of universe `code` where the squares in `uncertainMask`
 * (bit i set = square i is uncertain in the superposition) cannot be played
 * if they are empty in this universe.
 */
export function blockedValue(code: number, uncertainMask: number, toMove: Player): number {
  let code4 = 0;
  for (let i = 0; i < NUM_CELLS; i++) {
    const v = cellOf(code, i);
    code4 += (v === EMPTY && uncertainMask & (1 << i) ? BLOCKED : v) * POW4[i];
  }
  return blockedValue4(code4, toMove);
}
