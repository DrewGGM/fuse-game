/**
 * Prints a board and, optionally, a solution over it.
 *
 *   npm run show -- 2026-08-18
 *   npm run show -- 2026-08-18 --solve
 */
import { Cell, Piece, run, type Placement } from '@fuse/sim';
import { CURATION_BUDGET, dailyBoard, puzzleNumber, solve } from '@fuse/gen';

const GLYPH: Record<number, string> = {
  [Piece.MirrorA]: '/',
  [Piece.MirrorB]: '\\',
  [Piece.Splitter]: 'Y',
  [Piece.Boost]: '+',
  [Piece.Bomb]: '*',
};

const NAME: Record<number, string> = {
  [Piece.MirrorA]: 'Espejo /',
  [Piece.MirrorB]: 'Espejo \\',
  [Piece.Splitter]: 'Divisor Y',
  [Piece.Boost]: 'Recarga +',
  [Piece.Bomb]: 'Carga *',
};

const ARROW = ['^', '>', 'v', '<'];

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const wantSolution = process.argv.includes('--solve');
const board = dailyBoard(date);

function render(placements: readonly Placement[] = []): string {
  const overlay = new Map<number, string>();
  for (const p of placements) overlay.set(p.y * board.w + p.x, GLYPH[p.piece]);

  const rows: string[] = ['     0 1 2 3 4 5 6 7 8'];
  for (let y = 0; y < board.h; y++) {
    let row = String(y).padStart(3) + '  ';
    for (let x = 0; x < board.w; x++) {
      const at = y * board.w + x;
      if (x === board.originX && y === board.originY) row += ARROW[board.originDir];
      else if (overlay.has(at)) row += overlay.get(at);
      else if (board.cells[at] === Cell.Wall) row += '#';
      else if (board.cells[at] === Cell.Node) row += 'o';
      else row += '.';
      row += ' ';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

console.log(`Reto #${puzzleNumber(date)}   ${date}`);
console.log(`Inventario: ${Array.from(board.inventory).map((p) => NAME[p]).join(' · ')}`);
console.log(`Energia: ${board.energy} pasos`);
console.log('');
console.log('TABLERO   (v origen de la chispa · o nodo · # muro)');
console.log(render());

if (wantSolution) {
  const s = solve(board, { ...CURATION_BUDGET, samples: 800, climbs: 120, restarts: 16 });
  const r = run(board, s.best);
  console.log('');
  console.log(`UNA BUENA SOLUCION  ->  ${r.score} pts · ${r.ignited}/${r.totalNodes} nodos`);
  console.log(render(s.best));
  console.log('');
  for (const p of s.best) {
    console.log(`  ${NAME[p.piece].padEnd(11)} en columna ${p.x}, fila ${p.y}`);
  }
}
