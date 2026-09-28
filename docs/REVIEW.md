# Review notes (September 2026)

Before release, two independent reviewers went over the finished game without having written it:

- a **code, physics and security review** of the engine, bot, networking, server, controller and docs, which reproduced every finding it could with small scripts;
- a **hands-on UX review** in real browsers: all four lessons, games at every level, online rooms with spectators, both themes, on desktop (1400 and 1280 wide), tablet and phone.

This page lists what they found, why it mattered, and how it was fixed. Each fix is a commit in the history (`git log`), and most have a regression test.

## Multiplayer and security

| Finding | Why it mattered | Fix |
| --- | --- | --- |
| One malformed URL (`/%FF`, `//`) crashed the whole server | Anyone could take every room down, repeatedly | Every HTTP/upgrade handler is guarded; bad paths get **400** (`tests/server.test.ts`) |
| The dice seed was fixed at game start and known to both players | Each player could compute every future Observe/collapse outcome and only make moves whose dice favoured them | **Per-move dice from hash chains** (below) |
| A client revealed its nonce whenever asked | A peer-to-peer host could collect the guest's nonce first and then *grind* its own until the dice favoured it | Clients only reveal for the opponent's actual next move, once |
| Resync replayed moves without checking the host's fingerprints; a longer move list silently replaced history | Divergence (e.g. two app versions) or a rewritten history went unnoticed | Every replay checks each move, each dice value and each fingerprint; history may only grow; protocol version bumped to 2 |
| Players who left kept their seats forever; owners never changed; departed members piled up | Rooms became unusable ("room is full", nobody can start) | "Take seat" for absent players, ownership passes to someone present, seatless leavers are forgotten |
| No per-message rate limit; unlimited room-code guesses; `X-Forwarded-For` trusted from the client side | Floods, brute-forcing private rooms, bypassing per-IP limits | Token bucket per connection; 5 misses per socket / 30 per IP per 10 min; last proxy hop only |
| `ALLOWED_ORIGINS` blocked the server's *own* pages | Setting up "Pages + your server" broke server rooms on the server itself | Same-origin requests are always allowed |
| Two join attempts raced when opening an invite link | Spurious "already in this room in another tab" | One in-flight join per room |

### How the dice work now

Each player picks a secret `s` and publishes only the end of a hash chain, `c₆₄` where `cᵢ₊₁ = SHA-256(cᵢ)`. For move number `p` a player reveals `c₆₃₋ₚ`: anyone can check it by hashing `p + 1` times, but nobody can compute it early (that would mean inverting SHA-256). The mover sends their value with the move; the other player sends theirs only after the move is fixed, and only if the move rolls dice. That move's randomness is `SHA-256(game, p, value_X, value_O)`.

So nobody can choose or predict a collapse. What a cheater can still do: stall (a connected player who doesn't answer forfeits after 45 s), or — as a peer-to-peer host, which is also the referee — abort the game or claim a resignation that didn't happen (clients flag such claims in the chat). Details: [ARCHITECTURE.md](ARCHITECTURE.md#fair-dice-fair-seedts).

## Game logic and physics

- **Undo could freeze a game** when you played O: undoing the bot's opening move left it to move with nobody thinking. Now there is nothing to undo until you have moved, and undoing while the bot thinks cancels its reply.
- **"No dice were needed"** was shown for games decided right after an Observe. The `certain` flag now means "no dice rolled on the deciding move".
- The merge explanation said "no universes meet" at 90°/270°, while its own diagram showed them meeting (their arrows are at right angles, so the odds simply add).
- A `#/play?quanta=abc` URL gave unlimited quanta; all URL parameters are now validated.
- The search cache could store bounds as exact values (dormant: that search depth isn't used by the bots).
- The physics itself checked out: every gate is unitary, the Mach–Zehnder `cos²(φ/2)` and entangled-pair `sin²φ` laws hold, and a 3 000-game fuzz found no broken invariants.

## Teaching and UX

- **Glossary words navigated away** from the game (losing it). They now open a card in place, with a link to the Codex in a new tab.
- **Peeking at a universe drew X and O on every square**, and the **collapse wheel lost its mini boards** — both CSS selector bugs.
- **Phones**: the Play button, the knob and the collapse warning sat below the fold under the tool bar. A move bar now shows them above the tool bar, and tapping the second square again plays a Merge. Measurement/collapse overlays became a full-screen modal.
- **Lessons**: the coach and board scrolled out of view. Now the board and coach stay visible on desktop; on phones the coach is a tuckable sheet, and steps scroll to what they talk about. A rejected attempt keeps its selection (and the merge lab) open. Lesson 2 no longer points at a bar that isn't there.
- The Multiverse marked every universe "new/vanishes" on every move (teaching the wrong thing). Markers now appear only for a Merge; other moves get a sentence ("every universe splits in two…").
- Smaller things: link badges covering tokens, tooltips covering the player bar, spectators seeing tools, the tool palette after game over, low-contrast square numbers and chart labels, jargon in tooltips, Restart swapping sides, stats counted twice.

## Known limitations

- **Drag-to-split works with a mouse only.** On touch screens the board lets the page scroll (a drag there would fight scrolling); tap, tap is the touch gesture.
- Square tooltips are hover-only; on touch the same information is in the Multiverse and Physics tabs.
- A peer-to-peer host can end a game early or stall it (see above). Use server rooms when that matters.
- Peer-to-peer needs a direct WebRTC path; strict NATs need a TURN server (`VITE_ICE_SERVERS`).

## Checking it yourself

```bash
npm test          # 55 tests: engine physics, bot, room protocol (incl. a malicious host), server, controller
npm run typecheck
```
