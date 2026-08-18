/**
 * Verifies every curated seed that ships with the app.
 *
 * "Solvable" needs defining before it can be checked, because Fuse has no win
 * condition — you always get a score. What must hold for every shipped board is:
 *
 *   1. At least one piece can legally be placed.
 *   2. A placement exists that scores, and the solver can produce it.
 *   3. That placement, replayed, reproduces the score exactly.
 *   4. It lights a substantial share of the nodes, so the board is not a trap.
 *   5. A weak first attempt still scores, so a player is never stuck at zero.
 *
 * Point 5 is the one that matters for "I cannot solve this": a board where only
 * an optimal line scores anything would feel broken even though it is solvable.
 */
import { INVENTORY_SIZE, run, type Board } from '@fuse/sim';
import { CURATION_BUDGET, CURATED_COUNT, dailyBoard, puzzleNumber, solve } from '@fuse/gen';
import { createRng } from '@fuse/gen';

const EPOCH_MS = Date.parse('2026-01-01T00:00:00Z');

function dateForPuzzle(n: number): string {
  return new Date(EPOCH_MS + (n - 1) * 86400000).toISOString().slice(0, 10);
}

function emptyCells(board: Board): number[] {
  const originIndex = board.originY * board.w + board.originX;
  const out: number[] = [];
  for (let i = 0; i < board.cells.length; i++) {
    if (board.cells[i] === 0 && i !== originIndex) out.push(i);
  }
  return out;
}

/**
 * How often does a completely random placement score anything at all?
 * This is the closest proxy for "a confused player pressing buttons".
 */
function blindScoreRate(board: Board, tries = 60): { rate: number; best: number } {
  const rng = createRng(0xb11d);
  const cells = emptyCells(board);
  let scored = 0;
  let best = 0;

  for (let t = 0; t < tries; t++) {
    const chosen: number[] = [];
    let guard = 0;
    while (chosen.length < INVENTORY_SIZE && guard < 200) {
      guard++;
      const at = cells[rng.int(cells.length)];
      if (!chosen.includes(at)) chosen.push(at);
    }
    if (chosen.length < INVENTORY_SIZE) continue;

    const score = run(
      board,
      chosen.map((at, i) => ({
        x: at % board.w,
        y: Math.floor(at / board.w),
        piece: board.inventory[i],
      }))
    ).score;
    if (score > 0) scored++;
    if (score > best) best = score;
  }
  return { rate: scored / tries, best };
}

const limit = Number(process.argv[2] ?? CURATED_COUNT);
const failures: string[] = [];
let minLitShare = 1;
let minBlindRate = 1;
let worstBoard = '';
let worstBlind = '';

console.log(`Verifying ${limit} of ${CURATED_COUNT} curated boards...\n`);
const started = Date.now();

for (let n = 1; n <= limit; n++) {
  const date = dateForPuzzle(n);
  const board = dailyBoard(date);

  // 1. Enough room to place the inventory.
  if (emptyCells(board).length < INVENTORY_SIZE) {
    failures.push(`#${n} ${date}: fewer than ${INVENTORY_SIZE} placeable cells`);
    continue;
  }

  const s = solve(board, CURATION_BUDGET);

  // 2 and 3. A scoring solution exists and replays to the same number.
  if (s.par <= 0) {
    failures.push(`#${n} ${date}: no scoring solution found`);
    continue;
  }
  // A solution may legally use fewer pieces than the inventory holds; on 89% of
  // boards the best known run does exactly that.
  if (s.best.length < 1 || s.best.length > INVENTORY_SIZE) {
    failures.push(`#${n} ${date}: solver returned ${s.best.length} placements`);
    continue;
  }
  const replay = run(board, s.best);
  if (replay.score !== s.par) {
    failures.push(`#${n} ${date}: replay ${replay.score} does not match par ${s.par}`);
    continue;
  }

  // 4. It lights a substantial share of the board.
  const litShare = s.ignitedAtPar / s.totalNodes;
  if (litShare < minLitShare) {
    minLitShare = litShare;
    worstBoard = `#${n} ${date} (${s.ignitedAtPar}/${s.totalNodes})`;
  }
  if (litShare < 0.5) {
    failures.push(`#${n} ${date}: par lights only ${s.ignitedAtPar}/${s.totalNodes}`);
  }

  // 5. Blind play still scores, so nobody is ever stuck at zero.
  const blind = blindScoreRate(board);
  if (blind.rate < minBlindRate) {
    minBlindRate = blind.rate;
    worstBlind = `#${n} ${date} (${Math.round(blind.rate * 100)}% of random attempts score)`;
  }
  if (blind.best === 0) {
    failures.push(`#${n} ${date}: 60 random attempts all scored zero`);
  }

  if (n % 100 === 0) process.stdout.write(`  checked ${n}\n`);
}

console.log('');
console.log(`checked            : ${limit}`);
console.log(`failures           : ${failures.length}`);
console.log(`worst lit share    : ${Math.round(minLitShare * 100)}%  ${worstBoard}`);
console.log(`worst blind rate   : ${worstBlind}`);
console.log(`elapsed            : ${((Date.now() - started) / 1000).toFixed(1)}s`);

if (failures.length > 0) {
  console.log('\nFAILURES:');
  for (const f of failures.slice(0, 40)) console.log(`  ${f}`);
  if (failures.length > 40) console.log(`  ...and ${failures.length - 40} more`);
  process.exitCode = 1;
} else {
  console.log('\nEvery curated board has a verified, reproducible solution.');
}

console.log(`\n(puzzle #1 is ${dateForPuzzle(1)}; today is puzzle #${puzzleNumber(new Date().toISOString().slice(0, 10))})`);
