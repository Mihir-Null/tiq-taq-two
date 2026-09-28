# tiq taq |2⟩

**▶ Play: [mihir-null.github.io/tiq-taq-two](https://mihir-null.github.io/tiq-taq-two/)** · [source](https://github.com/Mihir-Null/tiq-taq-two)

**Quantum tic-tac-toe you can actually learn from.** Your X can sit in two squares at once, get entangled with an O, and — with the right twist of a phase knob — cancel itself out of a square entirely. Every square is a simulated **qutrit**, every move is a real **unitary gate**, and every collapse is a genuine **Born-rule measurement**. The board shows you all of it.

Play against a bot, pass-and-play, run guided lessons, or play friends online through **room codes** (peer-to-peer, works on GitHub Pages) or your own **lobby server** (public room list, spectators, reconnects).

> Inspired by Evert van Nieuwenburg's *Quantum TiqTaqToe*. Tiq Taq Two keeps its core (split, entangle, collapse when the board fills) and adds a level where universes interfere.

---

## Contents

- [Quick start](#quick-start)
- [The rules](#the-rules)
- [What you can see on screen](#what-you-can-see-on-screen)
- [Project tour](#project-tour)
- [Deploying](#deploying)
- [Ideas to tinker with](#ideas-to-tinker-with)
- Deeper docs: [PHYSICS.md](docs/PHYSICS.md) · [ARCHITECTURE.md](docs/ARCHITECTURE.md) · [DEPLOY.md](docs/DEPLOY.md)

## Quick start

Requires **Node ≥ 22.18** (the server runs TypeScript directly — no compile step).

```bash
npm install
npm run dev          # the app at http://localhost:5173 (hot reload)
npm run server:dev   # optional, in a 2nd terminal: lobby server on :8787
npm test             # engine, bot and room-protocol tests
```

`npm run dev` proxies `/api` and `/ws` to the lobby server, so with both running you get server rooms in development too. Without the server, peer-to-peer rooms, the bot, lessons and the sandbox all still work.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot module reload |
| `npm run build` | type-check (`tsc`) + production build into `dist/` |
| `npm run build:single` | the whole app inlined into **one** `dist-single/index.html` |
| `npm run server` | lobby server + serves `dist/` (default port 8787) |
| `npm start` | build, then serve everything from the Node server |
| `npm run typecheck` | type-check app and server |
| `node scripts/tournament.ts 2 30 hard medium` | bot-vs-bot tournament (level, games, bot A, bot B) |

With Nix: `nix develop` gives you a shell with Node; see [DEPLOY.md](docs/DEPLOY.md) for the NixOS module.

## The rules

The board is 9 qutrits (empty / X / O). The game state is a **superposition of ordinary boards** — the game calls each one a *universe*. Every token move adds exactly one token to *every* universe.

| Level | Adds | In one sentence |
| --- | --- | --- |
| 0 · Classic | **Place** | Put your token on a square that is empty in every universe. |
| 1 · Superposition | **Split** | Your token goes into two certainly-empty squares at once, 50/50. |
| 2 · Entanglement | **Link**, **Observe** ⚡ | Link: your new token half-swaps with a square where the opponent may be ("X–O or O–X"). Observe: force one square to decide. |
| 3 · Interference | **Merge** ⚡ | Twist a phase knob on one square, then half-swap two squares so universes meet — and add up or cancel. |

Observe and Merge add no token and cost a **quantum ⚡** (2 each at level 2, 3 at level 3).

**Ending.** After every move:

1. If **every** universe contains a finished line, the game ends. If all universes agree on the winner — no dice. Otherwise the board **collapses** into one universe (Born rule) and that one decides.
2. If **no square is empty in every universe**, nobody could place, so the board collapses before the next turn (a full board is the usual case).
3. On a collapsed board, **more lines wins**; equal is a draw. Played classically, this is exactly tic-tac-toe.

## What you can see on screen

- **Probability rings** around uncertain squares (X / O / empty shares) and faint "ghost" tokens with percentages.
- **Links** between squares that know about each other: `~` one token in two places, `⇄` an entangled X–O pair. Hover for "If ① is X, ⑤ is certainly O."
- **Line-odds bars** across the board and a **forecast bar**: who would lead if we looked right now.
- **Live previews** of every move before you commit — the board, the universe list and a plain-English explanation update as you hover.
- **Multiverse panel**: every universe as a mini board with its probability (and phase arrow). Hover one to *peek* at it on the board.
- **History**: rewind to any move and inspect it. **Physics tab**: the full state vector |ψ⟩ in Dirac notation, an Argand diagram of amplitudes, per-square qutrit marginals.
- **Merge lab**: a phase knob, the interference fringe (probability vs. knob angle) and the actual arrows adding head-to-tail where universes meet.
- **Honest dice**: observations and collapses animate *exactly* how the outcome is drawn — slices as wide as their probabilities, a pointer at the random number r.
- **Hints** from the Monte-Carlo bot ("won 376 of 540 simulated games"), coach tips, a glossary on every dotted word, four interactive lessons, and a Codex with game-level and physics-level explanations.
- Two themes: **Lab console** (dark, Sonokai-style) and **Academia** (parchment and ink). Keyboard play, reduced-motion support, synthesized sound effects.

## Project tour

```
src/
  engine/        pure TypeScript quantum engine — shared by browser, bot worker and server
    qstate.ts      sparse state vector: Map<board, amplitude>, gates, measurement
    gates.ts       PLACE, HALF_SWAP (qutrit √iSWAP), KNOB — all unitary
    rules.ts       levels, moves, validation, turn resolution, previews
    analysis.ts    marginals, line odds, forecast, mutual-information links
    explain.ts     plain-language move previews
  ai/            bots: classical oracle, expectimax, Monte-Carlo, hints, Web Worker
  net/           multiplayer: protocol, RoomHost (referee), RoomClient, transports
  tutorial/      lessons (scripted games), lesson runner, glossary
  ui/            Preact components, game controller, screens, styles
server/main.ts   the optional lobby server (HTTP + WebSocket + static files)
tests/           vitest: engine physics, rules, bot, room protocol
docs/            PHYSICS, ARCHITECTURE, DEPLOY
deploy/, nix/, Dockerfile, flake.nix, .github/workflows/
```

The design choices worth knowing about (all explained in [ARCHITECTURE.md](docs/ARCHITECTURE.md)):

- **Deterministic lockstep.** Online, only *moves* travel. Every client runs the same engine with the same seed, so collapses agree everywhere; a state fingerprint rides along with each move to catch any divergence.
- **Fair dice.** The seed comes from a commit–reveal "coin flip" between the two players, so no one — not even the room host — controls the collapses.
- **One referee, two homes.** `RoomHost` runs in the creator's tab (P2P) or in the Node server — same code.
- **Exact arithmetic where it matters.** Phases are always multiples of 90°, so amplitudes are bit-identical across browsers.

## Deploying

- **GitHub Pages** (static, P2P rooms): push to `main`; the included workflow builds and publishes. Set Pages → Source → "GitHub Actions".
- **Your own server** (P2P *and* server rooms, public lobby): `npm run build && npm run server`, or Docker, systemd, or the NixOS module. Put Caddy/nginx in front for HTTPS.
- **Both**: host the app on Pages and point it at your server with the `VITE_SERVER_URL` repository variable.

Details, reverse-proxy configs and TURN notes: [docs/DEPLOY.md](docs/DEPLOY.md).

## Ideas to tinker with

- **New gates → new moves.** A qutrit "Hadamard" (the 3×3 Fourier matrix) as a move that puts one square into an equal superposition of empty/X/O. Write it in `gates.ts`, validate it in `rules.ts`, and the previews, links, multiverse and physics views pick it up automatically.
- **Measure in another basis.** Observe currently measures in the {empty, X, O} basis. What would a Fourier-basis observation look like as a game mechanic?
- **Decoherence as a rule.** Every N turns, randomly measure one square ("the environment peeks") and watch strategies change.
- **Bots.** `scripts/tournament.ts` pits bots against each other. Try full MCTS with the Monte-Carlo rollouts, tune `tuning.fusion` in `ai/search.ts`, or train a policy.
- **Bigger boards.** 4×4 with four-in-a-row is 3¹⁶ ≈ 43 M boards — still fine sparsely; the engine only stores universes that exist.
- **Real hardware.** Map each qutrit onto two qubits (|E⟩→|00⟩, |X⟩→|10⟩, |O⟩→|01⟩), compile the gates, and replay a finished game on a simulator or quantum computer.

---

MIT licensed. Have fun collapsing.
