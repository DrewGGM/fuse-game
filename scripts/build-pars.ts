/**
 * Precomputes the target score for every curated board.
 *
 * The player needs to know what they are aiming for — without it a score is a
 * number with no meaning, and the game reads as a puzzle with a hidden answer.
 * The solver is far too slow to run on a phone, so par is computed once here and
 * shipped as a table next to the seeds. The client stays offline and instant.
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

const limit = Number(process.argv[2] ?? CURATED_COUNT);
const pars: number[] = [];
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
  pieceCounts[s.best.length]++;
  if (n % 100 === 0) process.stdout.write(`  ${n}/${limit}\n`);
}

const out = fileURLToPath(new URL('../packages/gen/src/pars.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(pars)}\n`);

const mean = pars.reduce((a, b) => a + b, 0) / pars.length;
console.log('');
console.log(`boards       : ${pars.length}`);
console.log(`mean par     : ${Math.round(mean)}`);
console.log(`min / max    : ${Math.min(...pars)} / ${Math.max(...pars)}`);
console.log(`elapsed      : ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log('');
console.log('pieces used by the best known run:');
for (let k = 1; k <= 5; k++) {
  const pct = Math.round((pieceCounts[k] / pars.length) * 100);
  console.log(`  ${k} piece${k === 1 ? ' ' : 's'}: ${String(pieceCounts[k]).padStart(4)}  ${pct}%`);
}
console.log(`\nwrote ${out}`);
