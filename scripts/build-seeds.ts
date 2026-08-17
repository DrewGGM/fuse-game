/**
 * Curates the daily seed table.
 *
 * Runtime seed selection can only afford cheap structural checks, and those let
 * roughly a quarter of boards through that are flat or unreachable. Curating
 * offline means the reference solver grades every single board before a player
 * ever sees it, while the client still derives the board itself with no network
 * call and no server trust.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/build-seeds.ts 800
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CURATION_BUDGET, generateBoard, gradeBoard, isStructurallyValid } from '@fuse/gen';

const wanted = Number(process.argv[2] ?? 800);
const out = fileURLToPath(new URL('../packages/gen/src/seeds.json', import.meta.url));

const approved: number[] = [];
const rejectReasons = new Map<string, number>();
let considered = 0;

const started = Date.now();
for (let i = 0; approved.length < wanted && i < wanted * 12; i++) {
  const seed = (0x2f6e2b1 + i * 0x9e3779b1) >>> 0;
  const board = generateBoard(seed);
  if (!isStructurallyValid(board)) continue;

  considered++;
  const grade = gradeBoard(board, CURATION_BUDGET);
  const s = grade.solution;

  // Stricter than the runtime gate: we are choosing, not accepting.
  const strictFailures: string[] = [...grade.reasons];
  if (s.totalNodes > 0 && s.ignitedAtPar / s.totalNodes < 0.55) {
    strictFailures.push('under half the nodes reachable');
  }
  if (s.par < 3000) strictFailures.push('par too low to feel worth chasing');

  if (strictFailures.length > 0) {
    for (const r of strictFailures) {
      const key = r.replace(/\d+/g, 'N');
      rejectReasons.set(key, (rejectReasons.get(key) ?? 0) + 1);
    }
    continue;
  }

  approved.push(seed);
  if (approved.length % 100 === 0) {
    process.stdout.write(`  ${approved.length}/${wanted} approved\n`);
  }
}

writeFileSync(out, `${JSON.stringify(approved)}\n`);

console.log('');
console.log(`approved   : ${approved.length}`);
console.log(`considered : ${considered}`);
console.log(`accept rate: ${Math.round((approved.length / Math.max(considered, 1)) * 100)}%`);
console.log(`elapsed    : ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log('');
console.log('rejections:');
for (const [reason, n] of [...rejectReasons].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${reason}`);
}
console.log(`\nwrote ${out}`);
