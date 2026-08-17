/**
 * Prints a fingerprint of simulation behaviour across many runs.
 *
 * Used to prove a refactor changed no behaviour: if this number moves, every
 * curated seed and every stored score has quietly changed meaning.
 */
import { run } from '@fuse/sim';
import { createRng, generateBoard } from '@fuse/gen';

let acc = 0x811c9dc5 | 0;
let scored = 0;
for (let i = 1; i <= 2000; i++) {
  const board = generateBoard((i * 0x9e3779b1) >>> 0);
  const rng = createRng((i * 7919) >>> 0);
  const originIndex = board.originY * board.w + board.originX;
  const open: number[] = [];
  for (let c = 0; c < board.cells.length; c++) {
    if (board.cells[c] === 0 && c !== originIndex) open.push(c);
  }
  const chosen: number[] = [];
  let guard = 0;
  while (chosen.length < 5 && guard < 400) {
    guard++;
    const at = open[rng.int(open.length)];
    if (!chosen.includes(at)) chosen.push(at);
  }
  if (chosen.length < 5) continue;
  const r = run(board, chosen.map((at, k) => ({ x: at % board.w, y: Math.floor(at / board.w), piece: board.inventory[k] })));
  if (r.score > 0) scored++;
  for (const v of [r.score, r.ignited, r.ticks, r.checksum]) {
    acc = Math.imul(acc ^ v, 0x01000193) | 0;
  }
}
console.log(JSON.stringify({ fingerprint: acc >>> 0, scored }));
