/**
 * Board.tsx — the main 3×3 board, drawn in SVG.
 *
 * Layers (bottom → top):
 *   1. background + grid
 *   2. line odds        translucent bars: "this line completes in 50% of universes"
 *   3. squares          probability ring + X / O "slots" whose opacity and size
 *                       follow P(X), P(O); ghostly when uncertain
 *   4. links            curves between correlated squares (superposition tethers
 *                       and entangled X–O pairs) with hoverable badges
 *   5. selection arrow  what the move you are building will connect
 *   6. hit areas        transparent rects that receive clicks / drags / hover
 *
 * The board draws either the real state, a PREVIEW of a move (dashed style),
 * or a single universe you are PEEKING at from the multiverse panel.
 */

import { useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  correlations, lineOdds, linesOf, cellOf, squareName, LINES, LINE_NAMES, X, O, EMPTY, CERTAIN_EPS,
  type QState, type Correlation, type Player, type Move, moveCells,
} from '../../engine/index.ts';
import { settings } from '../../app/store.ts';
import type { GameController } from '../game/controller.ts';

export const PAD = 15;
export const CELL = 100;
export const SIZE = 330;
export const cx = (i: number): number => PAD + (i % 3) * CELL + CELL / 2;
export const cy = (i: number): number => PAD + Math.floor(i / 3) * CELL + CELL / 2;
const RING_R = 42;
const RING_C = 2 * Math.PI * RING_R;
const pct = (p: number): string => `${Math.round(p * 100)}%`;

// ───────────────────────────── Glyphs ──────────────────────────────────────

export function XGlyph({ size = 24, width = 9 }: { size?: number; width?: number }) {
  return (
    <path
      class="glyph glyph-x"
      d={`M${-size},${-size} L${size},${size} M${size},${-size} L${-size},${size}`}
      stroke-width={width}
      stroke-linecap="round"
      fill="none"
    />
  );
}

export function OGlyph({ size = 25, width = 8 }: { size?: number; width?: number }) {
  return <circle class="glyph glyph-o" r={size} stroke-width={width} fill="none" />;
}

// ───────────────────────────── Square ──────────────────────────────────────

interface SlotLayout {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  ghost: boolean;
}

/** Where and how big each token slot is drawn for a given distribution. */
function slotLayout(dist: readonly number[], t: Player): SlotLayout {
  const p = dist[t];
  const q = dist[t === X ? O : X];
  const both = p > CERTAIN_EPS && q > CERTAIN_EPS;
  if (p <= CERTAIN_EPS) return { x: 0, y: 0, scale: 0.4, opacity: 0, ghost: false };
  if (p > 1 - CERTAIN_EPS) return { x: 0, y: 0, scale: 1, opacity: 1, ghost: false };
  const opacity = 0.28 + 0.62 * p;
  if (both) return { x: t === X ? -21 : 21, y: -6, scale: 0.56, opacity, ghost: true };
  return { x: 0, y: -4, scale: 0.8, opacity, ghost: true };
}

function Ring({ dist }: { dist: readonly number[] }) {
  const uncertain = Math.max(dist[0], dist[1], dist[2]) < 1 - CERTAIN_EPS;
  const segs: [string, number][] = [
    ['ring-x', dist[X]],
    ['ring-o', dist[O]],
    ['ring-e', dist[EMPTY]],
  ];
  let start = 0;
  return (
    <g class="ring" style={{ opacity: uncertain ? 1 : 0 }} transform="rotate(-90)">
      <circle class="ring-track" r={RING_R} />
      {segs.map(([cls, p]) => {
        const gap = p > 0.02 && p < 0.999 ? 3 : 0;
        const len = Math.max(0, p * RING_C - gap);
        const el = (
          <circle
            key={cls}
            class={`ring-seg ${cls}`}
            r={RING_R}
            style={{ strokeDasharray: `${len} ${RING_C}`, strokeDashoffset: `${-start}` }}
          />
        );
        start += p * RING_C;
        return el;
      })}
    </g>
  );
}

function Square({ i, dist, showPercents }: { i: number; dist: readonly number[]; showPercents: boolean }) {
  const lx = slotLayout(dist, X);
  const lo = slotLayout(dist, O);
  const slot = (t: Player, l: SlotLayout) => (
    <g
      key={t}
      class={`slot ${t === X ? 'slot-x' : 'slot-o'} ${l.ghost ? 'ghost' : ''}`}
      style={{ transform: `translate(${l.x}px, ${l.y}px) scale(${l.scale})`, opacity: l.opacity }}
    >
      {t === X ? <XGlyph /> : <OGlyph />}
    </g>
  );
  const labels: JSX.Element[] = [];
  if (showPercents) {
    for (const [t, l] of [[X, lx], [O, lo]] as [Player, SlotLayout][]) {
      if (!l.ghost) continue;
      labels.push(
        <text key={`l${t}`} class={`pct ${t === X ? 'pct-x' : 'pct-o'}`} x={l.x} y={31} text-anchor="middle">
          {pct(dist[t])}
        </text>,
      );
    }
  }
  return (
    <g class="square" transform={`translate(${cx(i)} ${cy(i)})`}>
      <Ring dist={dist} />
      {slot(X, lx)}
      {slot(O, lo)}
      {labels}
    </g>
  );
}

// ───────────────────────────── Links ───────────────────────────────────────

function curve(a: number, b: number, bow = 0.18): { d: string; mx: number; my: number } {
  const x1 = cx(a), y1 = cy(a), x2 = cx(b), y2 = cy(b);
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  // Bow sideways so a link never runs straight through the square between.
  const nx = -dy / len, ny = dx / len;
  const k = len * bow;
  const qx = (x1 + x2) / 2 + nx * k, qy = (y1 + y2) / 2 + ny * k;
  // Start/end a little outside the glyphs.
  const s = 30 / len;
  const sx = x1 + dx * s, sy = y1 + dy * s, ex = x2 - dx * s, ey = y2 - dy * s;
  // The badge goes where the curve keeps farthest from every square's centre —
  // over a grid line, not on top of some other square's token and percentage.
  const at = (t: number): [number, number] => [
    (1 - t) ** 2 * sx + 2 * (1 - t) * t * qx + t * t * ex,
    (1 - t) ** 2 * sy + 2 * (1 - t) * t * qy + t * t * ey,
  ];
  let best = at(0.5);
  let bestScore = -Infinity;
  for (let t = 0.2; t <= 0.8001; t += 0.05) {
    const [px, py] = at(t);
    let clear = Infinity;
    for (let i = 0; i < 9; i++) clear = Math.min(clear, Math.hypot(px - cx(i), py - cy(i)));
    const score = clear - 20 * Math.abs(t - 0.5); // prefer the middle when it's clear anyway
    if (score > bestScore) {
      bestScore = score;
      best = [px, py];
    }
  }
  return { d: `M${sx},${sy} Q${qx},${qy} ${ex},${ey}`, mx: best[0], my: best[1] };
}

function Links({ list, onTip }: { list: Correlation[]; onTip: (c: Correlation | null, x?: number, y?: number) => void }) {
  return (
    <g class="links">
      {list.map((c) => {
        const { d, mx, my } = curve(c.a, c.b);
        const strength = Math.min(1, c.mi);
        const cls = c.kind === 'tether' ? `link-tether ${c.token === X ? 'tok-x' : 'tok-o'}` : c.kind === 'swap' ? 'link-swap' : 'link-mixed';
        return (
          <g key={`${c.a}-${c.b}`} class={`link ${cls}`} style={{ opacity: 0.35 + 0.65 * strength }}>
            <path class="link-path" d={d} />
            <g
              class="link-badge"
              transform={`translate(${mx} ${my})`}
              onPointerEnter={() => onTip(c, mx, my)}
              onPointerLeave={() => onTip(null)}
              onClick={(e) => {
                e.stopPropagation();
                onTip(c, mx, my);
              }}
            >
              <circle r="10" />
              <text y="4" text-anchor="middle">{c.kind === 'swap' ? '⇄' : c.kind === 'tether' ? '~' : '≈'}</text>
            </g>
          </g>
        );
      })}
    </g>
  );
}

// ───────────────────────────── Line odds ───────────────────────────────────

function LineOddsLayer({ q }: { q: QState }) {
  const odds = lineOdds(q);
  const bars: JSX.Element[] = [];
  for (const o of odds) {
    const [a, , c] = LINES[o.line];
    const x1 = cx(a), y1 = cy(a), x2 = cx(c), y2 = cy(c);
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    for (const [t, p] of [[X, o.x], [O, o.o]] as [Player, number][]) {
      if (p < 0.02 || p > 1 - CERTAIN_EPS) continue;
      const off = t === X ? -5 : 5;
      bars.push(
        <line
          key={`${o.line}-${t}`}
          class={`odds ${t === X ? 'odds-x' : 'odds-o'}`}
          x1={x1 - ux * 34 + nx * off} y1={y1 - uy * 34 + ny * off}
          x2={x2 + ux * 34 + nx * off} y2={y2 + uy * 34 + ny * off}
          style={{ opacity: 0.12 + 0.55 * p, strokeWidth: 3 + 5 * p }}
        />,
      );
    }
  }
  return <g class="line-odds">{bars}</g>;
}

// ───────────────────────────── Board ───────────────────────────────────────

function SelectionArrow({ from, to, kind }: { from: number; to: number; kind: Move['kind'] }) {
  const { d } = curve(from, to, 0.12);
  return <path class={`sel-arrow sel-${kind}`} d={d} marker-end="url(#arrowhead)" />;
}

interface TipState {
  x: number;
  y: number;
  lines: string[];
  title: string;
  /** Open downwards (for squares in the top row). */
  below: boolean;
}

export function Board({ ctrl, compact = false, interactive = true }: { ctrl: GameController; compact?: boolean; interactive?: boolean }) {
  const st = settings.value;
  const display = ctrl.display.value;
  const pv = ctrl.viewPly.value === null && !ctrl.anim.value ? ctrl.preview.value : null;
  const peekCode = ctrl.peek.value ?? ctrl.pinned.value;
  const q = pv ? pv.q : display.q;
  const peeking = peekCode !== null && !pv;
  const sel = ctrl.selection.value;
  const hover = ctrl.hover.value;
  const tool = ctrl.tool.value;
  const canAct = ctrl.canAct.value;
  const result = display.result;
  const [tip, setTip] = useState<TipState | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ from: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const dists = peeking
    ? Array.from({ length: 9 }, (_, i) => {
        const v = cellOf(peekCode!, i);
        return [v === EMPTY ? 1 : 0, v === X ? 1 : 0, v === O ? 1 : 0] as const;
      })
    : q.cellDists();
  const links = !peeking && st.showLinks ? correlations(q) : [];

  // Squares whose odds the previewed move would change.
  const changed = new Set<number>();
  if (pv) {
    const before = display.q.cellDists();
    for (let i = 0; i < 9; i++) {
      if (Math.abs(before[i][X] - dists[i][X]) + Math.abs(before[i][O] - dists[i][O]) > 0.005) changed.add(i);
    }
  }

  // Last move's squares (helps you follow what the opponent did).
  const lastMove = ctrl.shown.value.move;
  const lastCells = new Set(lastMove ? moveCells(lastMove) : []);
  const lessonCells = new Set(ctrl.highlight.value);

  // The "arrow" for two-square moves being built.
  let arrow: JSX.Element | null = null;
  if (canAct && (tool === 'split' || tool === 'link' || tool === 'merge') && sel.length >= 1) {
    const to = sel.length === 2 ? sel[1] : hover;
    if (to !== null && to !== sel[0]) {
      const m = ctrl.twoSquare(tool, sel[0], to);
      arrow = <SelectionArrow from={sel[0]} to={to} kind={m.kind} />;
    }
  }

  // Winning lines once the game is over.
  let winLines: number[] = [];
  if (result && result.winner) {
    const code = result.code ?? display.q.byProbability()[0]?.code;
    if (code !== undefined) winLines = linesOf(code, result.winner);
  }

  const cellFromPoint = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y) as SVGElement | null;
    const v = el?.getAttribute?.('data-cell');
    return v === null || v === undefined ? null : Number(v);
  };

  const showCellTip = (i: number, e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    const d = dists[i];
    const lines: string[] = [];
    if (peeking) lines.push(d[X] ? 'X in this universe' : d[O] ? 'O in this universe' : 'Empty in this universe');
    else {
      const parts = [
        d[X] > CERTAIN_EPS ? `X ${pct(d[X])}` : '',
        d[O] > CERTAIN_EPS ? `O ${pct(d[O])}` : '',
        d[EMPTY] > CERTAIN_EPS ? `empty ${pct(d[EMPTY])}` : '',
      ].filter(Boolean);
      lines.push(parts.join(' · '));
      if (Math.max(d[0], d[1], d[2]) < 1 - CERTAIN_EPS) {
        const n = q.universes().filter((u) => cellOf(u.code, i) !== EMPTY).length;
        lines.push(`Occupied in ${n} of ${q.size} universes`);
        for (const c of links) if (c.a === i || c.b === i) lines.push(...c.statements.slice(0, 1));
      } else if (d[EMPTY] > 0.999) lines.push('Empty in every universe');
      else lines.push('Certain — the same in every universe');
      // The line-odds bars through this square, in words.
      if (st.showLineOdds && !result) {
        const through = lineOdds(q)
          .filter((o) => LINES[o.line].includes(i) && (o.x >= 0.02 || o.o >= 0.02))
          .sort((a, b) => Math.max(b.x, b.o) - Math.max(a.x, a.o))
          .slice(0, 2);
        for (const o of through) {
          const who = [o.x >= 0.02 ? `X ${pct(o.x)}` : '', o.o >= 0.02 ? `O ${pct(o.o)}` : ''].filter(Boolean).join(', ');
          const name = LINE_NAMES[o.line];
          lines.push(`${name[0].toUpperCase()}${name.slice(1)} completed in ${who} of universes`);
        }
      }
    }
    // Top-row tips open below the square, so they don't cover the player bar.
    const below = i < 3;
    setTip({
      x: (cx(i) / SIZE) * r.width,
      y: ((below ? cy(i) + 50 : cy(i) - 50) / SIZE) * r.height,
      title: `Square ${squareName(i)}`,
      lines,
      below,
    });
  };

  const onLinkTip = (c: Correlation | null, x?: number, y?: number) => {
    if (!c || !wrap.current) return setTip(null);
    const r = wrap.current.getBoundingClientRect();
    const title =
      c.kind === 'swap' ? '⇄ Entangled pair' : c.kind === 'tether' ? '~ One token, two places' : '≈ Linked squares';
    const lines = [...c.statements.slice(0, 3)];
    if (c.kind === 'mixed') lines.push('Several moves are tangled up here — look at one square and you learn about the other.');
    if (st.physicsView) lines.push(`Mutual information: ${c.mi.toFixed(2)} bit${c.mi >= 0.995 && c.mi < 1.005 ? '' : 's'}`);
    setTip({ x: ((x ?? 0) / SIZE) * r.width, y: (((y ?? 0) - 16) / SIZE) * r.height, title, lines, below: false });
  };

  const classes = [
    'board',
    pv ? 'is-preview' : '',
    peeking ? 'is-peek' : '',
    canAct ? 'can-act' : '',
    compact ? 'compact' : '',
    result ? 'is-over' : '',
  ].join(' ');

  return (
    <div class="board-wrap" ref={wrap}>
      <svg
        class={classes}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="grid"
        aria-label="Game board"
        onPointerLeave={() => {
          ctrl.hover.value = null;
          setTip(null);
        }}
      >
        <defs>
          <marker id="arrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" class="arrowhead" />
          </marker>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* userSpaceOnUse: straight lines have a zero-area bounding box, which would make
              an objectBoundingBox filter region empty (and the line invisible). */}
          <filter id="ink" filterUnits="userSpaceOnUse" x="-20" y="-20" width={SIZE + 40} height={SIZE + 40}>
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" />
          </filter>
          {/* Same "hand-inked" wobble for tokens, sized to each glyph's own box. */}
          <filter id="ink-glyph" x="-15%" y="-15%" width="130%" height="130%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="1.8" />
          </filter>
        </defs>
        <rect class="board-bg" x="2" y="2" width={SIZE - 4} height={SIZE - 4} rx="18" />
        <g class="grid">
          {[1, 2].map((k) => (
            <g key={k}>
              <line x1={PAD + k * CELL} y1={PAD + 6} x2={PAD + k * CELL} y2={SIZE - PAD - 6} />
              <line x1={PAD + 6} y1={PAD + k * CELL} x2={SIZE - PAD - 6} y2={PAD + k * CELL} />
            </g>
          ))}
        </g>

        {/* Cell backgrounds: hover, selection, preview changes, last move */}
        {Array.from({ length: 9 }, (_, i) => {
          const c = [
            'cell-bg',
            sel.includes(i) ? 'selected' : '',
            hover === i && canAct ? 'hover' : '',
            changed.has(i) ? 'changed' : '',
            lastCells.has(i) && !pv ? 'last' : '',
            lessonCells.has(i) ? 'lesson-hl' : '',
          ].join(' ');
          return <rect key={i} class={c} x={PAD + (i % 3) * CELL + 5} y={PAD + Math.floor(i / 3) * CELL + 5} width={CELL - 10} height={CELL - 10} rx="12" />;
        })}

        {st.showLineOdds && !peeking && !result && <LineOddsLayer q={q} />}

        {Array.from({ length: 9 }, (_, i) => (
          <Square key={i} i={i} dist={dists[i]} showPercents={st.showPercents && !peeking} />
        ))}

        {st.showSquareNumbers &&
          Array.from({ length: 9 }, (_, i) => (
            <text key={i} class="cell-num" x={PAD + (i % 3) * CELL + 12} y={PAD + Math.floor(i / 3) * CELL + 21}>
              {i + 1}
            </text>
          ))}

        {winLines.map((l) => {
          const [a, , c] = LINES[l];
          return <line key={l} class={`win-line ${result?.winner === X ? 'win-x' : 'win-o'}`} x1={cx(a)} y1={cy(a)} x2={cx(c)} y2={cy(c)} />;
        })}

        {arrow}

        {/* Transparent hit areas on top — these receive input. */}
        {interactive && Array.from({ length: 9 }, (_, i) => (
          <rect
            key={`hit${i}`}
            class="cell-hit"
            data-cell={i}
            x={PAD + (i % 3) * CELL}
            y={PAD + Math.floor(i / 3) * CELL}
            width={CELL}
            height={CELL}
            role="gridcell"
            tabIndex={0}
            aria-label={`Square ${i + 1}: ${dists[i][X] > CERTAIN_EPS ? `X ${pct(dists[i][X])} ` : ''}${dists[i][O] > CERTAIN_EPS ? `O ${pct(dists[i][O])} ` : ''}${dists[i][EMPTY] > CERTAIN_EPS ? `empty ${pct(dists[i][EMPTY])}` : ''}`}
            onPointerEnter={(e) => {
              ctrl.hover.value = i;
              showCellTip(i, e);
            }}
            onPointerDown={(e) => {
              ctrl.lastPointer.value = e.pointerType as 'mouse' | 'touch' | 'pen';
              drag.current = { from: i, moved: false };
            }}
            onPointerMove={(e) => {
              if (!drag.current || e.buttons === 0) return;
              const over = cellFromPoint(e.clientX, e.clientY);
              if (over !== null && over !== drag.current.from) {
                drag.current.moved = true;
                if (ctrl.selection.value[0] !== drag.current.from && ctrl.canAct.value) {
                  // Dragging always means a two-square move: switch Place → Split
                  // right away, so the preview shows what the drop will do.
                  if ((tool === 'place' || tool === 'observe') && ctrl.tools.value.includes('split')) ctrl.tool.value = 'split';
                  if (ctrl.tool.value !== 'place' && ctrl.tool.value !== 'observe') ctrl.selection.value = [drag.current.from];
                }
                ctrl.hover.value = over;
              }
            }}
            onPointerUp={(e) => {
              const d = drag.current;
              drag.current = null;
              if (!d || !d.moved) return;
              const over = cellFromPoint(e.clientX, e.clientY);
              suppressClick.current = true;
              if (over !== null && over !== d.from) ctrl.dragCells(d.from, over);
            }}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              setTip(null);
              ctrl.clickCell(i);
            }}
            onFocus={() => (ctrl.hover.value = i)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                ctrl.clickCell(i);
              }
            }}
          />
        ))}

        {/* Links go last so their badges can be hovered/tapped. */}
        {links.length > 0 && <Links list={links} onTip={interactive ? onLinkTip : () => undefined} />}
      </svg>

      {pv && <div class="board-chip chip-preview">Preview</div>}
      {peeking &&
        (ctrl.pinned.value !== null && ctrl.peek.value === null ? (
          <button class="board-chip chip-peek pinned" onClick={() => (ctrl.pinned.value = null)}>
            One universe · {pct(display.q.prob(peekCode!))} · show all ✕
          </button>
        ) : (
          <div class="board-chip chip-peek">Peeking at one universe · {pct(display.q.prob(peekCode!))}</div>
        ))}
      {tip && (
        <div class={`board-tip ${tip.below ? 'below' : ''}`} style={{ left: `${tip.x}px`, top: `${tip.y}px` }}>
          <strong>{tip.title}</strong>
          {tip.lines.map((l, k) => (
            <div key={k}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Mini board ──────────────────────────────────

/** A tiny classical board (for universe cards, history and the collapse wheel). */
export function MiniBoard({ code, size = 54, highlight = [] as number[], cls = '' }: { code: number; size?: number; highlight?: number[]; cls?: string }) {
  return (
    <svg class={`mini-board ${cls}`} width={size} height={size} viewBox="0 0 90 90" aria-hidden="true">
      <rect class="mini-bg" width="90" height="90" rx="10" />
      <path class="mini-grid" d="M30,6 V84 M60,6 V84 M6,30 H84 M6,60 H84" />
      {Array.from({ length: 9 }, (_, i) => {
        const v = cellOf(code, i);
        const x = (i % 3) * 30 + 15;
        const y = Math.floor(i / 3) * 30 + 15;
        const hl = highlight.includes(i);
        if (v === X)
          return (
            <g key={i} transform={`translate(${x} ${y})`} class={hl ? 'mini-hl' : ''}>
              <path class="mini-x" d="M-8,-8 L8,8 M8,-8 L-8,8" />
            </g>
          );
        if (v === O)
          return (
            <g key={i} transform={`translate(${x} ${y})`} class={hl ? 'mini-hl' : ''}>
              <circle class="mini-o" r="8.5" />
            </g>
          );
        return null;
      })}
    </svg>
  );
}
