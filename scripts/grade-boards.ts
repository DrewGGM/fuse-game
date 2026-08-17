/**
 * Grades a stretch of daily boards and prints a report.
 *
 * This is the tool that answers "are the puzzles any good?" without shipping
 * them first. Run it after touching anything in @fuse/gen or @fuse/sim.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/grade-boards.ts 2026-09-01 30
 */
import { Cell, Piece, type Board } from '@fuse/sim';
import { dailyBoard, gradeBoard } from '@fuse/gen';

const PIECE_GLYPH: Record<number, string> = {
  [Piece.MirrorA]: '/',
  [Piece.MirrorB]: '\\',
  [Piece.Splitter]: 'Y',
  [Piece.Boost]: '+',
  [Piece.Bomb]: '*',
};

const ARROW = ['^', '>', 'v', '<'];

function render(board: Board, placements: { x: number; y: number; piece: number }[] = []): string {
  const rows: string[] = [];
  const overlay = new Map<number, string>();
  for (const p of placements) overlay.set(p.y * board.w + p.x, PIECE_GLYPH[p.piece] ?? '?');

  for (let y = 0; y < board.h; y++) {
    let row = '';
    for (let x = 0; x < board.w; x++) {
      const at = y * board.w + x;
      if (x === board.originX && y === board.originY) row += ARROW[board.originDir];
      else if (overlay.has(at)) row += overlay.get(at);
      else if (board.cells[at] === Cell.Wall) row += '#';
      else if (board.cells[at] === Cell.Node) row += 'o';
      else row += '·';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

function datesFrom(start: string, days: number): string[] {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => new Date(t0 + i * 86400000).toISOString().slice(0, 10));
}

const start = process.argv[2] ?? '2026-09-01';
const days = Number(process.argv[3] ?? 20);
const verbose = process.argv.includes('--show');

let good = 0;
const parRatios: number[] = [];
const routeCounts: number[] = [];

for (const date of datesFrom(start, days)) {
  const board = dailyBoard(date);
  const grade = gradeBoard(board, { samples: 300, climbs: 350, restarts: 10 });
  const s = grade.solution;
  const ratio = s.totalNodes ? s.ignitedAtPar / s.totalNodes : 0;
  parRatios.push(ratio);
  routeCounts.push(s.nearParRoutes);
  if (grade.good) good++;

  console.log(
    `${date}  ${grade.good ? 'OK  ' : 'BAD '} par=${String(s.par).padStart(5)}  ` +
      `lit=${s.ignitedAtPar}/${s.totalNodes} (${Math.round(ratio * 100)}%)  ` +
      `first=${String(grade.casual).padStart(5)}  par/first=${(s.par / Math.max(grade.casual, 1)).toFixed(1)}x` +
      (grade.good ? '' : `  <- ${grade.reasons.join('; ')}`)
  );

  if (verbose && !grade.good) {
    console.log(render(board, s.best));
    console.log('');
  }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log('');
console.log(`good boards      : ${good}/${days} (${Math.round((good / days) * 100)}%)`);
console.log(`mean nodes lit   : ${Math.round(mean(parRatios) * 100)}%`);
console.log(`mean near-par    : ${mean(routeCounts).toFixed(1)} routes`);
