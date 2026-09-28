/**
 * Bot-vs-bot tournament — a tiny lab for tuning the AI.
 *
 *   node scripts/tournament.ts [level=2] [games=30] [botA=hard] [botB=medium] [fusionA] [fusionB]
 *
 * Each bot plays X in half the games and O in the other half (to cancel out
 * the first-move advantage). Node runs this TypeScript file directly.
 */
import { chooseMove } from '../src/ai/bot.ts';
import { tuning, type Difficulty } from '../src/ai/search.ts';
import { newGame, defaultRules, applyMove, seededRng, X, O, type Level } from '../src/engine/index.ts';

const [levelArg = '2', gamesArg = '30', a = 'hard', b = 'medium', fa, fb] = process.argv.slice(2);
const level = Number(levelArg) as Level;
const games = Number(gamesArg);
const fusion = (side: 'A' | 'B') => Number((side === 'A' ? fa : fb) ?? tuning.fusion);
const rng = seededRng(`tournament-${level}-${a}-${b}`);

let aWins = 0, bWins = 0, draws = 0;
const t0 = performance.now();
for (let g = 0; g < games; g++) {
  const aSide = g % 2 === 0 ? X : O;
  let s = newGame(defaultRules(level));
  while (!s.result) {
    const side = s.toMove === aSide ? 'A' : 'B';
    tuning.fusion = fusion(side);
    const m = chooseMove(s, (side === 'A' ? a : b) as Difficulty, rng);
    s = applyMove(s, m, rng).state;
  }
  if (s.result.winner === null) draws++;
  else if (s.result.winner === aSide) aWins++;
  else bWins++;
  process.stdout.write(`\rgame ${g + 1}/${games}`);
}
console.log(`\nLevel ${level}: ${a} ${aWins} – ${bWins} ${b}  (draws ${draws})  in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
