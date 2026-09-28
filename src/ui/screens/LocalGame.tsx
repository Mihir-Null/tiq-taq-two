/**
 * LocalGame.tsx — games on this device: vs the bot, pass-and-play, sandbox.
 *
 * Route: #/play?mode=bot|local|sandbox&level=0..3&difficulty=easy|medium|hard&side=X|O|random&quanta=N
 * Without enough parameters, a setup form is shown first.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { X, O, LEVELS, ALL_LEVELS, type Level, type Player, type RuleSet } from '../../engine/index.ts';
import { DIFFICULTY_INFO, type Difficulty } from '../../ai/search.ts';
import { GameController, LocalDriver, type SeatInfo } from '../game/controller.ts';
import { GameView } from '../components/GameView.tsx';
import { Icon } from '../components/Icon.tsx';
import { TokenMark } from '../components/Panels.tsx';
import { navigate, route } from '../../app/router.ts';
import { progress, updateProgress, displayName } from '../../app/store.ts';

type Mode = 'bot' | 'local' | 'sandbox';

interface Setup {
  mode: Mode;
  level: Level;
  difficulty: Difficulty;
  side: 'X' | 'O' | 'random';
  quanta: number;
}

/** Read the game settings from the URL — which anyone can edit, so validate everything. */
function readSetup(q: URLSearchParams): Setup | null {
  const mode = q.get('mode') as Mode | null;
  const level = Number(q.get('level'));
  if (!mode || !['bot', 'local', 'sandbox'].includes(mode) || !ALL_LEVELS.includes(level as Level)) return null;
  const d = q.get('difficulty');
  const difficulty: Difficulty = d === 'easy' || d === 'medium' || d === 'hard' ? d : 'medium';
  const sd = q.get('side');
  const side: Setup['side'] = sd === 'O' || sd === 'random' ? sd : 'X';
  const n = Number(q.get('quanta'));
  const quanta = q.has('quanta') && Number.isFinite(n) ? Math.max(0, Math.min(9, Math.round(n))) : LEVELS[level as Level].defaultQuanta;
  return { mode, level: level as Level, difficulty, side, quanta };
}

export function LocalGameScreen() {
  const q = route.value.query;
  const setup = readSetup(q);
  // `g` changes on rematch so the game remounts cleanly.
  const game = q.get('g') ?? '0';
  if (!setup || q.get('setup') === '1') return <SetupForm initial={setup} preset={(q.get('mode') as Mode) ?? 'bot'} />;
  return <LocalGame key={`${q.toString()}#${game}`} setup={setup} />;
}

function LocalGame({ setup }: { setup: Setup }) {
  const ctrl = useMemo(() => {
    const rules: RuleSet = { level: setup.level, quanta: setup.quanta };
    const human = (name: string): SeatInfo => ({ kind: 'human', name, local: true });
    let seats: Record<Player, SeatInfo>;
    let mySide: Player = X;
    if (setup.mode === 'bot') {
      mySide = setup.side === 'random' ? (Math.random() < 0.5 ? X : O) : setup.side === 'O' ? O : X;
      const bot: SeatInfo = { kind: 'bot', name: DIFFICULTY_INFO[setup.difficulty].name, difficulty: setup.difficulty, local: false };
      seats = mySide === X ? { [X]: human(displayName() === 'Anonymous qubit' ? 'You' : displayName()), [O]: bot } : { [X]: bot, [O]: human(displayName() === 'Anonymous qubit' ? 'You' : displayName()) };
    } else {
      seats = { [X]: human('Player X'), [O]: human('Player O') };
    }
    const c = new GameController({
      rules,
      seats,
      driver: new LocalDriver(),
      hintsAllowed: true,
      undoAllowed: true,
    });
    return c;
  }, [setup]);

  useEffect(() => {
    ctrl.start();
    return () => ctrl.dispose();
  }, [ctrl]);

  // Record stats once per game — undoing the final move and finishing again
  // doesn't count as another game.
  const result = ctrl.live.value.result;
  const recorded = useRef(false);
  useEffect(() => {
    if (!result || setup.mode !== 'bot' || recorded.current) return;
    recorded.current = true;
    const me = ctrl.seats.value[X].local ? X : O;
    updateProgress((p) => ({
      ...p,
      stats: {
        played: p.stats.played + 1,
        won: p.stats.won + (result.winner === me ? 1 : 0),
        drawn: p.stats.drawn + (result.winner === null ? 1 : 0),
      },
    }));
  }, [result]);

  /** A fresh game with the same settings; `swap` also trades sides with the bot. */
  const again = (swap: boolean) => {
    const qs = new URLSearchParams(route.value.query);
    qs.set('g', String(Date.now()));
    if (swap && setup.mode === 'bot' && setup.side !== 'random') qs.set('side', setup.side === 'X' ? 'O' : 'X');
    location.hash = `#/play?${qs.toString()}`;
  };

  const title = setup.mode === 'bot' ? `vs ${DIFFICULTY_INFO[setup.difficulty].name}` : setup.mode === 'local' ? 'Pass & play' : 'Sandbox';

  return (
    <div class="screen game-screen">
      <div class="screen-head">
        <button class="btn ghost small" onClick={() => navigate('/play', { ...Object.fromEntries(route.value.query), setup: 1 })}>
          <Icon name="chevronLeft" size={16} /> Setup
        </button>
        <h2>
          {title} <span class={`level-pill lv${setup.level}`}>Level {setup.level} · {LEVELS[setup.level].name}</span>
        </h2>
      </div>
      <GameView
        ctrl={ctrl}
        actions={
          <>
            <button class="btn ghost small" onClick={() => ctrl.driver.undo?.(ctrl)} disabled={!ctrl.canUndo.value} data-tip="Take back your last move · key U">
              <Icon name="undo" size={16} /> Undo
            </button>
            <button class="btn ghost small" onClick={() => again(false)} data-tip="Start over with the same settings and sides">
              <Icon name="restart" size={16} /> Restart
            </button>
          </>
        }
        resultActions={
          <>
            <button class="btn primary" onClick={() => again(true)}>
              <Icon name="restart" size={16} /> {setup.mode === 'bot' ? 'Rematch (swap sides)' : 'Play again'}
            </button>
            <button class="btn" onClick={() => ctrl.setViewPly(0)}>
              <Icon name="history" size={16} /> Review
            </button>
            <button class="btn ghost" onClick={() => navigate('/play', { ...Object.fromEntries(route.value.query), setup: 1 })}>
              New game
            </button>
          </>
        }
      />
    </div>
  );
}

// ─────────────────────────────── Setup form ────────────────────────────────

function SetupForm({ initial, preset }: { initial: Setup | null; preset: Mode }) {
  const unlocked = progress.value.unlocked;
  const [s, setS] = useState<Setup>(
    initial ?? { mode: preset, level: Math.min(unlocked, 2) as Level, difficulty: 'easy', side: 'X', quanta: LEVELS[Math.min(unlocked, 2) as Level].defaultQuanta },
  );
  const set = (patch: Partial<Setup>) => setS((cur) => ({ ...cur, ...patch }));
  const start = () => navigate('/play', { mode: s.mode, level: s.level, difficulty: s.difficulty, side: s.side, quanta: s.quanta });

  return (
    <div class="screen setup-screen">
      <h2>New game</h2>
      <div class="setup-grid">
        <fieldset class="card">
          <legend>Opponent</legend>
          <div class="choice-row">
            {(['bot', 'local', 'sandbox'] as Mode[]).map((m) => (
              <button key={m} class={`choice ${s.mode === m ? 'on' : ''}`} onClick={() => set({ mode: m })}>
                <Icon name={m === 'bot' ? 'bot' : m === 'local' ? 'users' : 'flask'} size={22} />
                <strong>{m === 'bot' ? 'Bot' : m === 'local' ? 'Pass & play' : 'Sandbox'}</strong>
                <span class="small muted">{m === 'bot' ? 'Practice against the computer' : m === 'local' ? 'Two people, one screen' : 'Play both sides, undo freely'}</span>
              </button>
            ))}
          </div>
          {s.mode === 'bot' && (
            <>
              <div class="choice-row compact">
                {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
                  <button key={d} class={`choice ${s.difficulty === d ? 'on' : ''}`} onClick={() => set({ difficulty: d })} data-tip={DIFFICULTY_INFO[d].blurb}>
                    <strong>{DIFFICULTY_INFO[d].name}</strong>
                    <span class="small muted">{d}</span>
                  </button>
                ))}
              </div>
              <div class="side-row">
                <span>You play</span>
                {(['X', 'O', 'random'] as const).map((side) => (
                  <button key={side} class={`chip ${s.side === side ? 'on' : ''}`} onClick={() => set({ side })}>
                    {side === 'random' ? <Icon name="dice" size={16} /> : <TokenMark p={side === 'X' ? X : O} size={16} />}
                    {side === 'random' ? 'Random' : side}
                  </button>
                ))}
                <span class="small muted">X moves first.</span>
              </div>
            </>
          )}
        </fieldset>

        <fieldset class="card">
          <legend>Level</legend>
          <div class="level-list">
            {ALL_LEVELS.map((lv) => {
              const locked = lv > unlocked;
              return (
                <button
                  key={lv}
                  class={`level-choice lv${lv} ${s.level === lv ? 'on' : ''} ${locked ? 'locked' : ''}`}
                  onClick={() => set({ level: lv, quanta: LEVELS[lv].defaultQuanta })}
                >
                  <span class="lv-num">{lv}</span>
                  <span class="lv-text">
                    <strong>{LEVELS[lv].name}</strong>
                    <span class="small muted">{LEVELS[lv].tagline}</span>
                  </span>
                  {locked && (
                    <span class="lv-lock" data-tip="Finish the previous lesson to unlock — or just try it!">
                      <Icon name="lock" size={14} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {s.level > unlocked && (
            <p class="small warn-text">
              New moves here! The <a href="#/learn">lesson</a> takes 3 minutes — or dive in and use the hints.
            </p>
          )}
          {LEVELS[s.level].features.observe && (
            <label class="range-row">
              <span>
                <Icon name="bolt" size={14} /> Quanta each: <strong>{s.quanta}</strong>
              </span>
              <input type="range" min="0" max="6" value={s.quanta} onInput={(e) => set({ quanta: Number((e.target as HTMLInputElement).value) })} />
            </label>
          )}
        </fieldset>
      </div>
      <div class="setup-actions">
        <button class="btn primary big" onClick={start}>
          <Icon name="play" size={18} /> Start
        </button>
        {s.level > unlocked && (
          <button class="btn ghost" onClick={() => updateProgress((p) => ({ ...p, unlocked: 3 }))}>
            Unlock all levels
          </button>
        )}
      </div>
    </div>
  );
}
