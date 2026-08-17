import { dailyBoard, solve, CURATION_BUDGET } from '@fuse/gen';
import { run } from '@fuse/sim';
const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const board = dailyBoard(date);
const s = solve(board, { ...CURATION_BUDGET, samples: 800, climbs: 120, restarts: 16 });
console.log(JSON.stringify({ date, par: s.par, ignited: s.ignitedAtPar, total: s.totalNodes, best: s.best, verify: run(board, s.best).score }));
