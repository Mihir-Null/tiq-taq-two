/**
 * glossary.ts — every quantum word the game uses, in two registers:
 *   short  → the one-line tooltip you see when hovering a dotted word
 *   game   → what it means on the board
 *   physics→ the real physics, for the curious (shown in the Codex)
 */

export interface GlossaryEntry {
  id: string;
  term: string;
  short: string;
  game: string;
  physics: string;
  /** Optional formula shown in the Codex. */
  math?: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    id: 'superposition',
    term: 'Superposition',
    short: 'Being in several states at once — not secretly in one of them.',
    game: 'A split token is in both squares at the same time. The board keeps a separate universe for each possibility until something forces a choice.',
    physics: 'A quantum state can be a weighted sum of basis states. An electron in a superposition of "here" and "there" is not in either place until measured; interference experiments prove both branches are real at the same time.',
    math: '|ψ⟩ = (|X·⟩ + i|·X⟩) / √2',
  },
  {
    id: 'universe',
    term: 'Universe (branch)',
    short: 'One complete, ordinary board that the game could turn out to be.',
    game: 'The Multiverse panel lists them. Every move acts on all universes at once. When the board collapses, exactly one becomes real.',
    physics: 'Each term of the superposition — one basis state of all 9 squares with its amplitude. "Many-worlds" language is a popular (and handy) way to picture these branches.',
  },
  {
    id: 'amplitude',
    term: 'Amplitude',
    short: 'An arrow attached to each universe: its length² is the probability.',
    game: 'Shown as the little clock-hand arrow on universe cards (physics view or level 3). Long arrow = likely universe.',
    physics: 'A complex number a. |a|² is the probability; the angle of a is its phase. Amplitudes, not probabilities, are what add up when branches meet.',
    math: 'P = |a|²,   a = |a|·e^{iφ}',
  },
  {
    id: 'probability',
    term: 'Probability (Born rule)',
    short: 'The chance of seeing an outcome = the squared length of its arrow.',
    game: 'Rings around squares and the percentages show it. The collapse wheel gives each universe a slice exactly as wide as its probability.',
    physics: 'The Born rule: measuring a state yields basis state k with probability |aₖ|². It is the only place where randomness enters quantum mechanics.',
    math: 'P(k) = |⟨k|ψ⟩|²',
  },
  {
    id: 'measurement',
    term: 'Measurement (observe)',
    short: 'Looking at a square forces it to pick one value, at random.',
    game: 'Observe costs ⚡1. Universes that disagree with what you see vanish; the rest grow to fill 100%.',
    physics: 'A projective measurement: the state is projected onto the subspace matching the result and renormalised. Afterwards the square is definite.',
    math: '|ψ⟩ → P̂ₖ|ψ⟩ / ‖P̂ₖ|ψ⟩‖',
  },
  {
    id: 'collapse',
    term: 'Collapse',
    short: 'The whole board is observed: one universe becomes the only one.',
    game: 'Happens automatically when no square is empty in every universe (e.g. a full board), or when every universe already contains a finished line but they disagree about who won. (If they all agree, the game just ends — no dice needed.)',
    physics: 'Measuring every qutrit at once. The outcome is random with Born-rule probabilities; the superposition is gone afterwards.',
  },
  {
    id: 'entanglement',
    term: 'Entanglement',
    short: 'Squares whose fates are linked: learning one tells you the other.',
    game: 'A Link half-swaps your token with the opponent\'s: "either X here and O there, or the other way round". Purple ⇄ links show entangled pairs.',
    physics: 'A joint state that cannot be written as (state of A) ⊗ (state of B). Measuring one part instantly fixes correlated results for the other — yet no signal travels, so nothing breaks relativity.',
    math: '(|XO⟩ + i|OX⟩) / √2',
  },
  {
    id: 'phase',
    term: 'Phase',
    short: 'The direction of a universe\'s arrow. Invisible alone — decisive when universes meet.',
    game: 'The Merge knob twists phases by quarter turns. Twisting changes no probability by itself, but decides which universes cancel when they recombine.',
    physics: 'The complex argument of an amplitude. A global phase is unobservable; relative phases between branches control interference.',
    math: 'a → a·e^{iφ}',
  },
  {
    id: 'interference',
    term: 'Interference',
    short: 'When two universes become the same board, their arrows add — they can cancel.',
    game: 'Merge a split token: its two halves meet. With the knob right, one outcome cancels to 0% and the other grows to 100%.',
    physics: 'Amplitudes add before squaring: |a + b|² ≠ |a|² + |b|². This is the engine of every quantum algorithm (and of the double-slit pattern).',
    math: '|a + b|² = |a|² + |b|² + 2·Re(a*b)',
  },
  {
    id: 'qutrit',
    term: 'Qutrit',
    short: 'A quantum object with three basic states — here: empty, X or O.',
    game: 'Every square is a qutrit. Nine squares make a system with 3⁹ = 19 683 possible boards.',
    physics: 'Like a qubit but with a 3-dimensional state space. Nine qutrits live in a 19 683-dimensional Hilbert space; the game only tracks the few boards with non-zero amplitude.',
  },
  {
    id: 'unitary',
    term: 'Unitary gate',
    short: 'A reversible operation that never creates or destroys probability.',
    game: 'Every token move is one. Place swaps "empty" and your token; Split and Link use the half-swap; Merge adds a phase twist.',
    physics: 'A matrix U with U†U = 1. Quantum evolution between measurements is always unitary, which is why information is never lost until you measure.',
  },
  {
    id: 'halfswap',
    term: 'Half-swap (√iSWAP)',
    short: 'Swap two squares — but only halfway, making a superposition of "stayed" and "swapped".',
    game: 'The heart of Split, Link and Merge. Doing it twice to the same pair completes the swap — if nothing else twisted the phases in between.',
    physics: 'On each pair of states {|pq⟩, |qp⟩} it acts as (1/√2)[[1, i], [i, 1]]; squared it is iSWAP. The original Quantum TiqTaqToe uses the same gate.',
    math: '|pq⟩ → (|pq⟩ + i|qp⟩)/√2',
  },
  {
    id: 'quanta',
    term: 'Quanta (⚡)',
    short: 'Your limited energy for Observe and Merge.',
    game: 'Each costs ⚡1. You start with 2 (level 2) or 3 (level 3). They don\'t add a token, so they are tempo moves — spend wisely.',
    physics: 'A game-design device, not physics — it keeps games finite and makes measurement a decision rather than a reflex.',
  },
];

export const GLOSSARY_BY_ID: Record<string, GlossaryEntry> = Object.fromEntries(GLOSSARY.map((g) => [g.id, g]));
