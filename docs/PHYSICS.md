# The physics of Tiq Taq Two

This document is for the curious — especially if you've met Dirac notation before. Everything here is exactly what the code in `src/engine/` does; file references are given so you can read along.

## 1. The state space

Each square is a **qutrit** with orthonormal basis states

$$|E\rangle,\ |X\rangle,\ |O\rangle \qquad (\text{empty, X, O}).$$

Nine squares give a Hilbert space $\mathcal H = (\mathbb C^3)^{\otimes 9}$ of dimension $3^9 = 19\,683$. A computational basis state is an ordinary board, e.g. $|X{\cdot}O\ {\cdot}{\cdot}{\cdot}\ {\cdot}{\cdot}{\cdot}\rangle$. The full game state is

$$|\psi\rangle = \sum_{b\,\in\,\{E,X,O\}^9} a_b\,|b\rangle, \qquad \sum_b |a_b|^2 = 1.$$

The game calls each basis state with $a_b \neq 0$ a **universe**. In practice only a handful are non-zero, so `QState` (`qstate.ts`) stores the state *sparsely*: a map from board (encoded as a base-3 integer) to complex amplitude. Nothing is approximated — this is the full state vector, just without its zeros.

**An invariant.** Every gate below either conserves the number of tokens on a board or (PLACE) increases it by exactly one *in every branch*. So all universes always hold the same number of tokens — the game's notion of "turn number" stays well defined inside a superposition.

## 2. The gates (`gates.ts`)

### PLACE$_t$ — writing a token

On one square, swap $|E\rangle$ and $|t\rangle$ and leave the third state alone:

$$P_X = |X\rangle\langle E| + |E\rangle\langle X| + |O\rangle\langle O| .$$

A permutation matrix, hence unitary. The rules only apply it to squares that are empty in every universe, where it simply writes $t$.

### HALF_SWAP — the qutrit √iSWAP

On two squares $(a, b)$, for every pair of *different* values $p \neq q$:

$$|pq\rangle \mapsto \tfrac{1}{\sqrt2}\left(|pq\rangle + i\,|qp\rangle\right), \qquad |pp\rangle \mapsto |pp\rangle .$$

In each 2-dimensional block $\{|pq\rangle, |qp\rangle\}$ this is

$$U = \frac{1}{\sqrt 2}\begin{pmatrix} 1 & i \\ i & 1\end{pmatrix}, \qquad U U^\dagger = \mathbb 1, \qquad U^2 = \begin{pmatrix} 0 & i \\ i & 0\end{pmatrix}\ (\text{iSWAP}),\qquad U^4 = -\mathbb 1 .$$

This is the gate the original Quantum TiqTaqToe uses. It conserves tokens: it only ever moves them between two squares. Think of squares as optical **modes**, tokens as (hard-core, distinguishable) **particles**, and HALF_SWAP as a 50/50 **beam splitter** between two modes. Tiq Taq Two is secretly a tiny linear-optics experiment.

### KNOB$_k$ — a phase shifter

$$K_k = |E\rangle\langle E| + i^{k}\,|X\rangle\langle X| + i^{-k}\,|O\rangle\langle O| = e^{\,i\,(k\pi/2)\,\hat Q}, \qquad \hat Q = |X\rangle\langle X| - |O\rangle\langle O| .$$

Tokens carry a "charge" $\pm1$ under the knob. $K_k$ is diagonal, so **it changes no probability** — phase is invisible until branches recombine.

Only quarter turns ($k \in \{0,1,2,3\}$) are used in play: the factors $1, i, -1, -i$ are exact in floating point, which keeps online clients bit-for-bit identical (see §7). The interference *chart* sweeps a continuous angle with `knobGateAngle` purely for drawing.

## 3. Moves as circuits (`rules.ts`)

| Move | Circuit | Effect |
| --- | --- | --- |
| Place on $a$ | $P_t^{(a)}$ | token $t$ on $a$ in every universe |
| Split $a\to b$ | $\text{HS}^{(a,b)}\,P_t^{(a)}$ | $\lvert EE\rangle \to \tfrac1{\sqrt2}(\lvert tE\rangle + i\lvert Et\rangle)$ |
| Link $a\to b$ | $\text{HS}^{(a,b)}\,P_t^{(a)}$ | same circuit; $b$ holds the opponent's token $\bar t$: $\lvert t\bar t\rangle \to \tfrac1{\sqrt2}(\lvert t\bar t\rangle + i\lvert \bar t t\rangle)$ |
| Observe $a$ | projective measurement of qutrit $a$ | §4 |
| Merge $a, b$ @ $k$ | $\text{HS}^{(a,b)}\,K_k^{(a)}$ | branches meet and interfere (§5) |

Split and Link are literally the *same* circuit — the difference is only what is already on square $b$ in each universe. Linearity does the rest: if $b$ is X in some universes and empty in others, a Link entangles in the first and splits in the second, and the preview shows exactly that.

## 4. Measurement and the Born rule

**Observe** measures one qutrit in the $\{E, X, O\}$ basis. With projectors $\Pi_v = |v\rangle\langle v|_a$,

$$P(v) = \lVert \Pi_v\psi \rVert^2 = \sum_{b:\ b_a = v} |a_b|^2, \qquad |\psi\rangle \mapsto \frac{\Pi_v|\psi\rangle}{\sqrt{P(v)}} .$$

Universes that disagree with the outcome vanish; the survivors are renormalised. Any square correlated with $a$ "snaps" too — that's the spooky-action moment in the entanglement lesson.

A **collapse** measures all nine qutrits: universe $b$ becomes the only one with probability $|a_b|^2$.

**How the dice are drawn.** Given a uniform $r\in[0,1)$, the engine lays outcomes (or universes, in ascending board order) side by side on $[0,1)$, each as wide as its probability, and picks the one containing $r$ (`measureCell`, `measureAll`). The observation bar and collapse wheel in the UI draw exactly this layout with a pointer at $r$ — the animation is the algorithm.

## 5. Interference: Merge as a Mach–Zehnder interferometer

Split creates $\tfrac1{\sqrt2}(|XE\rangle + i|EX\rangle)$ on $(a, b)$ — the first beam splitter. A Merge applies the phase shifter $K$ on $a$, then a second beam splitter. With knob angle $\varphi$:

$$\tfrac1{\sqrt2}\left(e^{i\varphi}|XE\rangle + i|EX\rangle\right) \xrightarrow{\ \text{HS}\ } \tfrac12\left(e^{i\varphi}-1\right)|XE\rangle + \tfrac i2\left(e^{i\varphi}+1\right)|EX\rangle$$

$$\Rightarrow\quad P(X\text{ on } a) = \sin^2\!\tfrac\varphi2, \qquad P(X\text{ on } b) = \cos^2\!\tfrac\varphi2 .$$

At $\varphi = 0$ the $|XE\rangle$ contributions from the two universes are $\tfrac12$ and $-\tfrac12$: they **cancel exactly**, and the token lands on $b$ with certainty. At $\varphi = 180°$ it lands on $a$. At $90°$ it stays 50/50 (but with a different phase). The preview's "arrows head-to-tail" picture is these contributions drawn in the complex plane (`Trace` in `qstate.ts` records them).

**Entangled pairs fringe twice as fast.** For a Link pair $\tfrac1{\sqrt2}(|XO\rangle + i|OX\rangle)$ the two branches carry charges $+1$ and $-1$ on square $a$, so the knob imprints a *relative* phase $2\varphi$:

$$P(|XO\rangle) = \sin^2\varphi, \qquad P(|OX\rangle) = \cos^2\varphi .$$

Half the fringe period — the same phase super-resolution a two-photon N00N state shows in quantum metrology, because the branches differ by two units of the generator $\hat Q$. Both formulas are unit-tested in `tests/engine.test.ts`.

**Merge proves coherence.** The measurement statistics of a split token (50/50) are identical to a classical coin hidden under a cup. The difference only shows when branches recombine: a classical mixture would stay 50/50 under any knob setting, while the superposition can be steered to 100%. The Merge move is the experiment that tells "quantum" from "ignorance".

**Which-path information kills interference.** If a split token's two branches become correlated with something else (e.g. an opponent links into one of its squares), merging the pair no longer fully recombines the branches — the fringe chart loses contrast. That is decoherence by entanglement, in miniature. Try it in the sandbox and watch the chart flatten.

## 6. Correlations and entanglement on the board (`analysis.ts`)

The links drawn between squares come from the **mutual information** of the measurement statistics,

$$I(A;B) = \sum_{u,v} p(u,v)\,\log_2\frac{p(u,v)}{p(u)\,p(v)} ,$$

computed from $p(u,v) = \sum_{b:\,b_A=u,\,b_B=v}|a_b|^2$. A split token and a Link pair both carry exactly 1 bit. Two caveats worth knowing:

- A split token, $\tfrac1{\sqrt2}(|XE\rangle + i|EX\rangle)$, **is** an entangled state of the two squares (a qutrit W-like state — "mode entanglement" of one particle). The game calls it *superposition* to match intuition; physicists would call both moves entangling.
- Mutual information of computational-basis statistics can't distinguish entanglement from classical correlation — only coherence (phase) can, which is again what Merge probes.

The per-square rings are the marginals $p_a(v)$ — the reduced density matrix's diagonal. They lose all correlations, which is why the Multiverse and Physics tabs show the full state.

## 7. Determinism for online play

All clients must see the same collapses. Rather than trusting a sender's claimed outcome, every client runs the same engine with the **same random numbers**, seeded per move by both players (`rng.ts`: xmur3 + sfc32, 32-bit integer math only). For this to work the floating-point arithmetic must also be identical everywhere:

- gates only ever multiply amplitudes by $1/\sqrt2$ and by $\pm1, \pm i$ (no `Math.sin`, whose last bit may differ between engines); measurements renormalise by $1/\sqrt{P}$, which is safe too — IEEE-754 requires `sqrt` and division to be correctly rounded, so every engine gets the same bits;
- universes are always iterated in ascending board order, so sums are accumulated in the same order;
- after each move clients compare a fingerprint of the rounded amplitudes (`QState.hash`) with the host's.

The random numbers for each move come from a hash-chain commit–reveal protocol (`net/fair-seed.ts`): neither player chooses them, and neither can know them before the move is fixed.

## 8. What's physics and what's game design

- **Physics:** the state space, unitary moves, Born-rule measurements, interference, entanglement.
- **Game design:** turn order, "place only on certainly-empty squares", ⚡ quanta, when collapses happen, line counting.
- **An omniscient referee.** Rules like "is this square empty in every universe?" read the simulated wavefunction — something a real quantum computer can't do without measuring. The original TiqTaqToe has the same classical control layer. On hardware you would track such facts classically from the gate history (which the referee knows) rather than by peeking.

## 9. Running it on real hardware (exercise)

Encode each qutrit in two qubits, $|E\rangle\to|00\rangle$, $|X\rangle\to|10\rangle$, $|O\rangle\to|01\rangle$ ($|11\rangle$ unused, 18 qubits total). Then:

1. $P_X$ becomes a CNOT-like flip of the first qubit controlled on the second being 0.
2. $K_k$ is a pair of single-qubit phase gates ($i^k$ on the "X" qubit, $i^{-k}$ on the "O" qubit).
3. HALF_SWAP is the interesting one: it is a √iSWAP on the *two-qubit pairs* as wholes, acting only when the pairs differ. Decompose it into standard gates (hint: it's block-diagonal in the "which pair differs" structure; controlled-√iSWAPs will appear).

Record a game with the History tab, compile its moves, run it on a simulator, and compare your measured statistics to the Multiverse panel.

## 10. Small exercises

1. Show $U^4 = -\mathbb 1$ on each block, so four identical Merges (knob 0) return a split token to where it started — up to a sign you can't see.
2. Which knob setting maximises the chance an *opponent's* split token lands on the square you want? Check with the fringe chart.
3. An X is split over $(a,b)$, then an O **links** a fresh square $c$ with $b$. How many universes are there, and which squares are correlated? Predict, then verify in the sandbox's Physics tab.
4. Why does Link conserve the number of X's and O's in every universe, while a hypothetical "qutrit Hadamard" move would not?
