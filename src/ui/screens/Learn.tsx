/**
 * Learn.tsx — lessons, the full rules, and the Codex (glossary + physics).
 */

import { useEffect } from 'preact/hooks';
import { LEVELS, ALL_LEVELS } from '../../engine/index.ts';
import { LESSONS } from '../../tutorial/lessons.tsx';
import { GLOSSARY } from '../../tutorial/glossary.ts';
import { progress } from '../../app/store.ts';
import { navigate, route } from '../../app/router.ts';
import { Icon } from '../components/Icon.tsx';
import { Term } from '../components/Term.tsx';

type Tab = 'lessons' | 'rules' | 'codex';

export function LearnScreen() {
  const q = route.value.query;
  const term = q.get('term');
  const tab: Tab = term ? 'codex' : ((q.get('tab') as Tab) ?? 'lessons');
  const setTab = (t: Tab) => navigate('/learn', { tab: t });

  useEffect(() => {
    if (term) document.getElementById(`term-${term}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [term]);

  return (
    <div class="screen learn">
      <h2>Learn</h2>
      <div class="tabs big" role="tablist">
        {(['lessons', 'rules', 'codex'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} class={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            <Icon name={t === 'lessons' ? 'book' : t === 'rules' ? 'info' : 'atom'} size={16} />
            {t === 'lessons' ? 'Lessons' : t === 'rules' ? 'Rules' : 'Codex'}
          </button>
        ))}
      </div>
      {tab === 'lessons' && <Lessons />}
      {tab === 'rules' && <Rules />}
      {tab === 'codex' && <Codex highlight={term} />}
    </div>
  );
}

function Lessons() {
  const done = progress.value.lessons;
  return (
    <div class="lesson-grid">
      {LESSONS.map((l, i) => (
        <div key={l.id} class={`lesson-card lv${l.level} ${done[l.id] ? 'done' : ''}`}>
          <div class="lesson-num">{i + 1}</div>
          <div class="lesson-body">
            <strong>{l.title}</strong>
            <p class="small muted">{l.blurb}</p>
            <div class="lesson-meta small">
              <span class={`level-pill lv${l.level}`}>Level {l.level}</span>
              <span>~{l.minutes} min</span>
              {done[l.id] && (
                <span class="good">
                  <Icon name="check" size={14} /> done
                </span>
              )}
            </div>
          </div>
          <button class={`btn ${done[l.id] ? '' : 'primary'}`} onClick={() => navigate(`/lesson/${l.id}`)}>
            {done[l.id] ? 'Replay' : 'Start'}
          </button>
        </div>
      ))}
    </div>
  );
}

function Rules() {
  return (
    <div class="rules">
      <section class="card">
        <h3>The goal</h3>
        <p>
          Get three in a row — in the universe that becomes real. Every square is a quantum object (a{' '}
          <Term k="qutrit" />) that can be empty, X or O — or several of those at once.
        </p>
      </section>
      <section class="card">
        <h3>Moves</h3>
        <table class="rule-table">
          <tbody>
            <tr>
              <td><Icon name="place" /> <strong>Place</strong></td>
              <td>Put your token on a square that is empty in every universe.</td>
              <td class="lv">Level 0+</td>
            </tr>
            <tr>
              <td><Icon name="split" /> <strong>Split</strong></td>
              <td>Your token goes into two certainly-empty squares at once, 50/50 (<Term k="superposition" />).</td>
              <td class="lv">Level 1+</td>
            </tr>
            <tr>
              <td><Icon name="link" /> <strong>Link</strong></td>
              <td>Your new token appears on an empty square, then <Term k="halfswap">half-swaps</Term> with a square where the opponent might be (<Term k="entanglement" />).</td>
              <td class="lv">Level 2+</td>
            </tr>
            <tr>
              <td><Icon name="observe" /> <strong>Observe</strong> ⚡1</td>
              <td>Force one uncertain square to decide (<Term k="measurement" />). Disagreeing universes vanish.</td>
              <td class="lv">Level 2+</td>
            </tr>
            <tr>
              <td><Icon name="merge" /> <strong>Merge</strong> ⚡1</td>
              <td>Twist the <Term k="phase" /> of one square with a knob (0°, 90°, 180°, 270°), then half-swap it with another. Universes meet and <Term k="interference">interfere</Term>.</td>
              <td class="lv">Level 3</td>
            </tr>
          </tbody>
        </table>
        <p class="small muted">
          Place, Split and Link each add exactly one token to every universe. Observe and Merge add none and cost a{' '}
          <Term k="quanta">quantum ⚡</Term> — you start with 2 (level 2) or 3 (level 3).
        </p>
      </section>
      <section class="card">
        <h3>When does the game end?</h3>
        <ol>
          <li>
            If <strong>every</strong> universe contains a finished line, the game ends. If all universes agree on the
            winner, that's it — no dice. Otherwise the board <Term k="collapse">collapses</Term> into one universe and
            that one decides.
          </li>
          <li>
            If <strong>no square is empty in every universe</strong>, nobody can place, so the board collapses before
            the next turn. A full board is the most common case.
          </li>
          <li>
            On a real (collapsed) board, whoever has <strong>more</strong> lines wins; equal counts are a draw. In a
            purely classical game this is ordinary tic-tac-toe.
          </li>
        </ol>
        <p class="small muted">
          A line that exists in only some universes does not win yet — it has to survive.
        </p>
      </section>
      <section class="card">
        <h3>Levels</h3>
        <ul class="level-summary">
          {ALL_LEVELS.map((lv) => (
            <li key={lv}>
              <span class={`level-pill lv${lv}`}>Level {lv}</span> <strong>{LEVELS[lv].name}</strong> — {LEVELS[lv].tagline}
            </li>
          ))}
        </ul>
      </section>
      <section class="card">
        <h3>Reading the board</h3>
        <ul>
          <li><strong>Rings</strong> around a square show its odds: X, O and empty.</li>
          <li><strong>Faint tokens</strong> are uncertain; the percentage is the chance you'd find them there.</li>
          <li><strong>Coloured bars</strong> across the board show how likely each line is (if observed now).</li>
          <li><strong>Curved links</strong> join squares that know about each other: <code>~</code> one token in two places, <code>⇄</code> an entangled X–O pair, <code>≈</code> several moves tangled together (look at one square and you learn something about the other).</li>
          <li><strong>The forecast bar</strong> shows who would lead if everything were observed right now.</li>
          <li>The <strong>Multiverse</strong>, <strong>History</strong> and <strong>Physics</strong> tabs let you inspect everything — hover a universe to see it on the board, click a past move to rewind.</li>
        </ul>
      </section>
      <section class="card">
        <h3>Keyboard</h3>
        <p class="small">
          <kbd>1</kbd>–<kbd>9</kbd> squares · <kbd>P</kbd> <kbd>S</kbd> <kbd>L</kbd> <kbd>O</kbd> <kbd>M</kbd> tools ·
          <kbd>Enter</kbd> play · <kbd>Esc</kbd> cancel · <kbd>[</kbd> <kbd>]</kbd> knob · <kbd>H</kbd> hint ·
          <kbd>←</kbd> <kbd>→</kbd> history · <kbd>U</kbd> undo
        </p>
      </section>
    </div>
  );
}

function Codex({ highlight }: { highlight: string | null }) {
  return (
    <div class="codex">
      <p class="muted">
        Every quantum idea in the game, explained twice: what it means on the board, and what it means in real
        physics.
      </p>
      <div class="codex-grid">
        {GLOSSARY.map((g) => (
          <article key={g.id} id={`term-${g.id}`} class={`codex-card ${highlight === g.id ? 'hl' : ''}`}>
            <h3>{g.term}</h3>
            <p class="codex-short">{g.short}</p>
            <h4>In the game</h4>
            <p>{g.game}</p>
            <h4>In physics</h4>
            <p>{g.physics}</p>
            {g.math && <pre class="math">{g.math}</pre>}
          </article>
        ))}
      </div>
      <section class="card deep">
        <h3>Under the hood (for physicists)</h3>
        <p>
          The board is 9 qutrits with basis {'{'}|E⟩, |X⟩, |O⟩{'}'}; the state lives in a 3⁹ = 19 683-dimensional
          Hilbert space, stored sparsely (only non-zero amplitudes). Every token move is a unitary:
        </p>
        <pre class="math">{`PLACE(t)   : |E⟩ ↔ |t⟩                        (permutation)
HALF_SWAP  : |pq⟩ → (|pq⟩ + i|qp⟩)/√2, p ≠ q   (qutrit √iSWAP)
KNOB(k)    : |E⟩→|E⟩, |X⟩→iᵏ|X⟩, |O⟩→i⁻ᵏ|O⟩   (phase, "charge" ±1)
SPLIT/LINK = HALF_SWAP(a,b) · PLACE_a
MERGE      = HALF_SWAP(a,b) · KNOB_a(k)`}</pre>
        <p>
          Merging a split token is a Mach–Zehnder interferometer: P(lands on b) = cos²(φ/2). An entangled X–O pair
          has twice the phase sensitivity, P = sin²(φ) — the same super-resolution N00N states show in quantum
          metrology, because the knob acts on the pair's total "charge" difference of 2.
        </p>
        <p>
          Measurements follow the Born rule. Online, each move's random numbers combine a secret value from each player,
          revealed only after the move is made (a hash-chain commit–reveal), so nobody can steer or predict a collapse
          — and everyone sees the same universe become real.
        </p>
      </section>
    </div>
  );
}
