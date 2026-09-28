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
                          │  seats · fair seed · validates moves with the engine
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
| `rng.ts` | Seeded PRNG: `rngForPly(seed, ply)` gives each move its own random stream. |
| `serialize.ts` | GameState ⇄ plain JSON (for the worker and the network). |

**Immutability pays off everywhere.** `applyMove` returns a new `GameState`, so previews are just "apply without committing", undo is "drop the last snapshot", and time travel is "show an old snapshot". There is no state mutation to un-do.

**Randomness is injected.** `applyMove(state, move, rng)` never calls `Math.random`. Local games pass a seeded stream; lessons pass scripted numbers (so the story always unfolds the same way); the bot passes carefully chosen numbers to enumerate every outcome (`allOutcomes`); online games pass the shared seed.

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

Only **moves** cross the network. The room host validates each move with the engine, applies it with the shared seed, and broadcasts `{ply, move, hash}`. Every client applies the same move to its own engine and compares the state fingerprint — any divergence triggers a resync (the full move list is replayed). This is how RTS games and emulators stay in sync with tiny bandwidth.

### Fair dice (`fair-seed.ts`)

1. Each player sends `SHA-256(nonce)` (commit).
2. When both commits are in, both reveal their nonces.
3. Everyone verifies, then `seed = SHA-256(nonceX | nonceO)`.

The host can't grind seeds (it commits before seeing the guest's nonce), and clients verify the ceremony themselves. SHA-256 is implemented in plain TS (`sha256.ts`) because `crypto.subtle` is missing on plain-http LAN pages.

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
- Chat/emotes are rate-limited; names and text are cleaned; rooms cap their membership.
- Reconnects: the host hands each member a secret token; presenting it later reclaims the seat. A seated player who stays away too long forfeits.
- The server limits connections and rooms per IP, caps message size, pings sockets to drop dead ones, and closes empty rooms.

## 5. The server (`server/main.ts`)

~250 lines, one dependency (`ws`). It serves `dist/`, answers `/api/health` and `/api/rooms`, and upgrades `/ws` to WebSockets. It imports `RoomHost` straight from `src/net/` — Node ≥ 22.18 strips TypeScript types natively, which is why every import in the shared code uses a `.ts` extension and the tsconfig enables `erasableSyntaxOnly` + `verbatimModuleSyntax`.

## 6. Lessons (`src/tutorial/`)

A lesson is data: a list of steps with coach text, an optional spotlight selector, highlighted squares, moves the lesson plays itself, scripted dice, and a goal (`next`, pick a tool, select squares, peek at a universe, or play a matching move). `LessonRunner` plays the scripted side, checks the learner's actions (watching signals for UI goals), and records progress (which unlocks levels).

## 7. Tests (`tests/`)

- `engine.test.ts` — gate unitarity, superposition amplitudes, entanglement statistics, the Mach–Zehnder and N00N formulas, crowded/full collapses, 300 random games (norm = 1, equal token counts, termination), determinism.
- `ai.test.ts` — takes wins, stops certain losses, never loses classic tic-tac-toe, speed.
- `room.test.ts` — the whole room protocol with scripted fake clients: seating, the seed ceremony (and a cheater), illegal/stale/out-of-turn moves, reconnect tokens, resignation, rematch seat swap, late spectators, abandonment, chat limits.
