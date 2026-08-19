/**
 * Precomputes two numbers per board: a reachable target, and the record.
 *
 * The player needs to know what they are aiming for — without it a score is a
 * number with no meaning, and the game reads as a puzzle with a hidden answer.
 * The solver is far too slow to run on a phone, so both are computed once here
 * and shipped next to the seeds. The client stays offline and instant.
 *
 * Why two numbers. Simulating a population of players showed the solver's best
 * is out of reach for almost everyone: the median player reached 31% of it, and
 * not one of forty matched it. A single figure labelled "objetivo" therefore
 * told 97% of players they had fallen short, every day. So the record stays as
 * the thing to chase, and the shipped *target* is what a player who thinks about
 * it can actually hit — measured with a deliberately mid-tier search budget
 * rather than guessed as a percentage.
 *
 *   npm run pars
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from '@fuse/sim';
import { CURATED_COUNT, CURATION_BUDGET, dailyBoard, solve } from '@fuse/gen';

const EPOCH_MS = Date.parse('2026-01-01T00:00:00Z');
const dateForPuzzle = (n: number) =>
  new Date(EPOCH_MS + (n - 1) * 86400000).toISOString().slice(0, 10);

// A deeper search than curation used: this number is shown to players, so it is
// worth spending seconds on. Curation only needed a comparable signal.
const BUDGET = { ...CURATION_BUDGET, samples: 600, climbs: 100, restarts: 20 } as const;

/**
 * Stands in for a player who tries a few arrangements and keeps the best.
 *
 * Sampling only, no hill climbing: a person does not iteratively refine one
 * layout the way the solver does, they picture a few and pick the best. Adding
 * even four climb steps pushed this to 81% of the record, which the population
 * simulation says essentially nobody reaches. At these settings it lands near
 * 47%, against the 41% a "thoughtful" simulated player actually managed.
 *
 * Frozen, like CURATION_BUDGET: change it and every shipped target shifts
 * meaning without the numbers in the app looking any different.
 */
const REACHABLE_BUDGET = { samples: 150, climbs: 0, restarts: 1, seed: 0x7ea0 } as const;

const limit = Number(process.argv[2] ?? CURATED_COUNT);
const pars: number[] = [];
const targets: number[] = [];
const pieceCounts = [0, 0, 0, 0, 0, 0];
const started = Date.now();

for (let n = 1; n <= limit; n++) {
  const board = dailyBoard(dateForPuzzle(n));
  const s = solve(board, BUDGET);

  // The stored number must be reachable, so verify it replays before shipping it.
  const replay = run(board, s.best);
  if (replay.score !== s.par) {
    throw new Error(`puzzle #${n}: par ${s.par} does not replay (got ${replay.score})`);
  }

  pars.push(s.par);
  // Never above the record, and never so low it is hit by accident.
  const reachable = solve(board, REACHABLE_BUDGET).par;
  targets.push(Math.min(reachable, s.par));
  pieceCounts[s.best.length]++;
  if (n % 100 === 0) process.stdout.write(`  ${n}/${limit}\n`);
}

const out = fileURLToPath(new URL('../packages/gen/src/pars.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(pars)}\n`);
const targetsOut = fileURLToPath(new URL('../packages/gen/src/targets.json', import.meta.url));
writeFileSync(targetsOut, `${JSON.stringify(targets)}
`);

const mean = pars.reduce((a, b) => a + b, 0) / pars.length;
console.log('');
console.log(`boards       : ${pars.length}`);
const meanTarget = targets.reduce((a, b) => a + b, 0) / targets.length;
console.log(`mean record  : ${Math.round(mean)}`);
console.log(`mean target  : ${Math.round(meanTarget)}  (${Math.round((meanTarget / mean) * 100)}% of record)`);
console.log(`min / max    : ${Math.min(...pars)} / ${Math.max(...pars)}`);
console.log(`elapsed      : ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log('');
console.log('pieces used by the best known run:');
for (let k = 1; k <= 5; k++) {
  const pct = Math.round((pieceCounts[k] / pars.length) * 100);
  console.log(`  ${k} piece${k === 1 ? ' ' : 's'}: ${String(pieceCounts[k]).padStart(4)}  ${pct}%`);
}
console.log(`\nwrote ${out}`);
