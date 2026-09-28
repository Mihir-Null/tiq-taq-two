# Architecture

A guided tour of the code: what each part does, how the parts talk, and why they're built that way. Read alongside the source — every file starts with a comment explaining its role.

```
                 ┌────────────────────────── browser ───────────────────────────┐
                 │                                                               │
 user input ───▶ │  UI (Preact)  ──▶  GameController  ──▶  Driver                │
                 │   Board, panels      signals: history,     Local  → engine     │
                 │   overlays           selection, preview,   Lesson → script     │
                 │                      animation queue       Net    → RoomClient │
                 │        ▲                    │                        │         │
                 │        └──── re-render ◀────┘                        ▼         │
                 │                                                   Channel ──┐  │
                 │  AI worker (bot, hints)  ◀── engine (pure TS) ──▶            │  │
                 └──────────────────────────────────────────────────────────────┼──┘
                                                          WebRTC / WebSocket /   │
                                                          BroadcastChannel       │
                          ┌──────────────── RoomHost (referee) ◀────────────────┘
                          │  in the creator's tab (P2P) or in server/main.ts
                          │  seats · fair dice · validates moves with the engine
                          └──▶ broadcasts accepted moves to every client
```

## 1. The engine (`src/engine/`) — pure, shared, deterministic

No DOM, no timers, no randomness of its own. The same files run in the browser, in the bot's Web Worker, in the Node server and in tests.

| File | Role |
| --- | --- |
| `complex.ts` | Minimal complex arithmetic, exact quarter-turn phases. |
| `board.ts` | Boards as base-3 integers, lines, scoring (`verdictOf`). |
| `qstate.ts` | `QState`: immutable sparse state vector. `applyOne` / `applyTwo` apply gates to every universe; `measureCell` / `measureAll` implement the Born rule with an injected random number. |
| `gates.ts` | PLACE, HALF_SWAP, KNOB as sparse matrices (+ dense versions for unitarity tests). |
| `rules.ts` | Levels, `Move` types, `whyIllegal` (human-readable reasons), `applyMove`, end-of-move `resolve` (collapses, results), `previewMove`, `allOutcomes` (every random branch, for the bot), `replay`. |
| `analysis.ts` | Marginals, line odds, forecast, mutual-information links, interference "meetings". |
| `explain.ts` | Turns a preview into plain English. |
| `notation.ts` | Short notation (`①~③`, `②⇄⑤`, `◉⑤`, `③⋈⑤@90°`) and sentences. |
| `rng.ts` | Seeded PRNG: `seededRng(key)`; `rngForPly(seed, ply)` gives each move its own random stream (local games). |
| `serialize.ts` | GameState ⇄ plain JSON (for the worker and the network). |

**Immutability pays off everywhere.** `applyMove` returns a new `GameState`, so previews are just "apply without committing", undo is "drop the last snapshot", and time travel is "show an old snapshot". There is no state mutation to un-do.

**Randomness is injected.** `applyMove(state, move, rng)` never calls `Math.random`. Local games pass a seeded stream; lessons pass scripted numbers (so the story always unfolds the same way); the bot passes carefully chosen numbers to enumerate every outcome (`allOutcomes`); online games pass a stream seeded by both players' dice values for that move.

## 2. The UI (`src/ui/`, Preact + signals)

**Why Preact?** A 4 kB React-compatible library: JSX templates are type-checked by TypeScript, and the mental model transfers to React. **Signals** (`@preact/signals`) are reactive values: a component that reads `ctrl.preview.value` re-renders whenever the preview changes — no prop drilling, no manual subscriptions.

### GameController (`ui/game/controller.ts`)

One controller backs every board — bot games, pass-and-play, lessons, online. It owns:

- `snapshots` — the history (`{state, move, mover, events}`),
- interaction state — `tool`, `selection`, `hover`, `knob`, `peek`,
- derived signals — `candidate` (the move your clicks describe), `candidateError`, `preview`, `explanation`, `canAct`,
- an **animation queue** — measurements and collapses play one after another; `display` shows the state *before* the dice while an animation runs (and hides the result, so nothing spoils it),
- time travel (`viewPly`).

What happens on commit depends on the **driver**:

| Driver | Where | On `submit(move)` |
| --- | --- | --- |
| `LocalDriver` | pass-and-play, sandbox, vs bot | apply with the game's seed; if the next seat is a bot, ask the worker |
| lesson driver | `tutorial/runner.ts` | check the move against the lesson step, then apply with scripted dice |
| `NetDriver` | `net/room-client.ts` | send to the room host; the move appears when the host echoes it |

### Components

- `Board.tsx` — SVG. Each square has an X slot and an O slot whose scale/opacity follow $P(X)$, $P(O)$ with CSS transitions, a probability ring (three `stroke-dasharray` arcs), percentage labels, line-odds bars, correlation links with hoverable badges, the selection arrow, and transparent hit rects for clicks/drags/keyboard.
- `PreviewCard.tsx` — step instructions, the explanation, observation odds, and the **merge lab** (knob, fringe chart computed by sweeping a continuous knob angle, head-to-tail arrow sums from the gate trace).
- `SidePanels.tsx` — Multiverse cards (peek on hover), History (click to rewind), Physics (ket list, Argand diagram, qutrit marginals).
- `Overlays.tsx` — the observation bar and collapse wheel (pointer lands on the actual random number), the result banner.
- `Assist.tsx` — hint cards and coach tips.
- `GameView.tsx` — responsive layout + keyboard shortcuts.

Styles live in `ui/styles/`: `themes.css` holds the two themes as CSS variables; everything else only uses the variables.

## 3. The bot (`src/ai/`)

- `classical.ts` — exact tic-tac-toe values for all $3^9$ boards (memoised negamax), plus a variant where uncertain squares are unplayable.
- `search.ts` — **expectimax**: max/min layers for players, *average* layers for chance (observe outcomes, collapses — enumerated via `allOutcomes`). The static evaluation averages classical values over universes.
- `montecarlo.ts` — the **Tiger** bot and hints: shortlist moves with the 1-ply evaluation, then *simulate real games* (real dice) and keep the moves that win most (successive halving).
- `bot.ts` — difficulty personalities. `hints.ts` — attaches human-readable reasons.
- `ai.worker.ts` / `client.ts` — runs all of it in a Web Worker (inlined into the bundle with `?worker&inline`), with a main-thread fallback.

**Why Monte-Carlo?** Averaging a per-universe evaluation suffers from *strategy fusion*: it assumes each universe can follow its own best plan, but one move acts on all universes at once. Simulation plays the real game, so it has no such blind spot. The tournament script (`scripts/tournament.ts`) measured it: Tiger beats the 1-ply Cat at every level.

## 4. Multiplayer (`src/net/`)

### Lockstep replication

Only **moves** cross the network. The room host validates each move with the engine, applies it with that move's dice, and broadcasts `{ply, move, dice, hash}`. Every client re-checks the move and the dice, applies it to its own engine and compares the state fingerprint. A late joiner (or a client that fell behind) gets the whole move list and replays it — verifying every move, every dice value and every fingerprint; a list that rewrites already-played moves is refused. This is how RTS games and emulators stay in sync with tiny bandwidth.

### Fair dice (`fair-seed.ts`)

Two requirements: nobody may *choose* the randomness, and nobody may *know* a move's randomness before that move is fixed (or they could pick moves whose Observe/collapse outcomes favour them).

1. At the start each player picks a secret `s` and builds a hash chain `c₀ = s, cᵢ₊₁ = SHA-256(cᵢ)` up to `c₆₄`, and sends only the **anchor** `c₆₄`.
2. For move number `p`, a player's value is `c₆₃₋ₚ` — it hashes to the anchor in `p + 1` steps, so anyone can verify it, but nobody can compute it before it is revealed (that would mean inverting SHA-256).
3. The mover sends their value with the move. If the move rolls dice (`needsDice`: an Observe, or a collapse it triggers), the host then asks the *other* player for theirs — only now, when the move can no longer change. A client only answers for the actual next move, and only once.
4. The dice for that move are seeded by `SHA-256(game, p, valueX, valueO)`.

What each party can still do: refuse to answer (the host forfeits a connected player who stalls), or — for a peer-to-peer host, which is also the referee — stall or abort the game, or claim a resignation/abandonment that didn't happen (clients flag such claims in the chat). What nobody can do: pick, predict or rewrite dice, or rewrite history; every client verifies everything. SHA-256 is implemented in plain TS (`sha256.ts`) because `crypto.subtle` is missing on plain-http LAN pages.

### One referee, three transports

`RoomHost` (`room-host.ts`) is transport-agnostic: it talks to "connections" with `send`/`close`. The transports just produce those:

| Backend | Host runs in | Transport | Notes |
| --- | --- | --- | --- |
| `p2p` | creator's tab | WebRTC data channels via PeerJS | signalling via the public PeerJS server; works on GitHub Pages |
| `srv` | `server/main.ts` | WebSocket | public lobby list, rooms survive tab closes |
| `local` | creator's tab | BroadcastChannel | two tabs, same browser, zero network — for testing |

On the client side everything becomes a `Channel` (`channel.ts`), so `RoomClient` doesn't care which one it has. The host's own player in P2P mode uses an in-memory `loopback` channel — the exact same code path as everyone else.

### Robustness

- Every incoming message is shape-checked; moves are rebuilt field by field (`sanitizeMove`) and re-validated by the engine.
- Every connection is rate-limited (token bucket: bursts of 40, 8 messages/s; floods are dropped, then disconnected); chat/emotes have a tighter limit; names and text are cleaned (including invisible and bidirectional-override characters); rooms cap their membership and forget members who left without a seat.
- A seat whose player has left can be taken by anyone present (between games); a room whose owner left passes ownership to someone present — or to the next person who arrives.
- Reconnects: the host hands each member a secret token; presenting it later reclaims the seat. A seated player who stays away too long forfeits.
- The server limits connections, rooms and failed room-code guesses per IP, caps message size, rejects malformed URLs with 400 (instead of crashing), pings sockets to drop dead ones, and closes empty rooms.

## 5. The server (`server/main.ts`)

~250 lines, one dependency (`ws`). It serves `dist/`, answers `/api/health` and `/api/rooms`, and upgrades `/ws` to WebSockets. It imports `RoomHost` straight from `src/net/` — Node ≥ 22.18 strips TypeScript types natively, which is why every import in the shared code uses a `.ts` extension and the tsconfig enables `erasableSyntaxOnly` + `verbatimModuleSyntax`.

## 6. Lessons (`src/tutorial/`)

A lesson is data: a list of steps with coach text, an optional spotlight selector, highlighted squares, moves the lesson plays itself, scripted dice, and a goal (`next`, pick a tool, select squares, peek at a universe, or play a matching move). `LessonRunner` plays the scripted side, checks the learner's actions (watching signals for UI goals), and records progress (which unlocks levels).

## 7. Tests (`tests/`)

- `engine.test.ts` — gate unitarity, superposition amplitudes, entanglement statistics, the Mach–Zehnder and N00N formulas, crowded/full collapses, 300 random games (norm = 1, equal token counts, termination), determinism.
- `ai.test.ts` — takes wins, stops certain losses, never loses classic tic-tac-toe, speed.
- `server.test.ts` — the lobby server as a real process: malformed URLs, path traversal, WebSocket origins.
- `controller.test.ts` — undo against the bot, releasing animation waiters on dispose.
- `room.test.ts` — the whole room protocol with scripted fake clients: seating, hash-chain dice (secrecy until a move resolves, cheating and stalling players), illegal/stale/out-of-turn moves, reconnect tokens, resignation, rematch seat swap, late spectators, abandonment, seats of departed players, ghost members, chat limits and floods — plus a real `RoomClient` facing a malicious host (early reveal requests, rewritten history, forged dice, bogus forced results).
