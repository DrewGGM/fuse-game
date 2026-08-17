import { describe, expect, it } from 'vitest';
import { Cell, INVENTORY_SIZE, PLAYABLE_PIECES, Piece, run } from '@fuse/sim';
import {
  BOARD_H,
  CURATION_BUDGET,
  BOARD_W,
  createRng,
  dailyBoard,
  dailySeed,
  dateToSeed,
  generateBoard,
  gradeBoard,
  isStructurallyValid,
  puzzleNumber,
  solve,
} from '../src/index.js';

function datesFrom(start: string, days: number): string[] {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => new Date(t0 + i * 86400000).toISOString().slice(0, 10));
}

describe('createRng', () => {
  it('is reproducible from a seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 50 }, () => a.int(1000));
    const seqB = Array.from({ length: 50 }, () => b.int(1000));
    expect(seqB).toEqual(seqA);
  });

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 30 }, ((r) => () => r.int(1000))(createRng(1)));
    const b = Array.from({ length: 30 }, ((r) => () => r.int(1000))(createRng(2)));
    expect(b).not.toEqual(a);
  });

  it('stays within bounds, including degenerate ones', () => {
    const r = createRng(7);
    for (let i = 0; i < 500; i++) {
      const v = r.int(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
    expect(r.int(0)).toBe(0);
    expect(r.int(-5)).toBe(0);
  });

  it('shuffles without losing or duplicating elements', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = createRng(99).shuffle([...items]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });
});

describe('dateToSeed', () => {
  it('is stable for a given date', () => {
    expect(dateToSeed('2026-08-17')).toBe(dateToSeed('2026-08-17'));
  });

  it('differs between adjacent dates', () => {
    expect(dateToSeed('2026-08-18')).not.toBe(dateToSeed('2026-08-17'));
  });

  it('rejects malformed dates', () => {
    for (const bad of ['2026-8-17', '17/08/2026', '2026-13-01', '2026-01-00', 'tomorrow', '']) {
      expect(() => dateToSeed(bad), bad).toThrow();
    }
  });
});

describe('puzzleNumber', () => {
  it('starts at 1 on the epoch and increments daily', () => {
    expect(puzzleNumber('2026-01-01')).toBe(1);
    expect(puzzleNumber('2026-01-02')).toBe(2);
    expect(puzzleNumber('2027-01-01')).toBe(366);
  });
});

describe('generateBoard', () => {
  it('produces the declared dimensions', () => {
    const b = generateBoard(1);
    expect(b.w).toBe(BOARD_W);
    expect(b.h).toBe(BOARD_H);
    expect(b.cells.length).toBe(BOARD_W * BOARD_H);
  });

  it('is reproducible from a seed', () => {
    const a = generateBoard(4242);
    const b = generateBoard(4242);
    expect(Array.from(b.cells)).toEqual(Array.from(a.cells));
    expect(b.inventory).toEqual(a.inventory);
  });

  it('never puts anything on the spark origin', () => {
    for (let seed = 1; seed < 200; seed++) {
      const b = generateBoard(seed * 7919);
      expect(b.cells[b.originY * b.w + b.originX]).toBe(Cell.Empty);
    }
  });

  it('always starts on an edge pointing inward', () => {
    for (let seed = 1; seed < 200; seed++) {
      const b = generateBoard(seed * 104729);
      const onEdge =
        b.originX === 0 || b.originY === 0 || b.originX === b.w - 1 || b.originY === b.h - 1;
      expect(onEdge).toBe(true);
      // The first step must land on the board.
      const dx = [0, 1, 0, -1][b.originDir];
      const dy = [-1, 0, 1, 0][b.originDir];
      const nx = b.originX + dx;
      const ny = b.originY + dy;
      expect(nx >= 0 && ny >= 0 && nx < b.w && ny < b.h).toBe(true);
    }
  });

  it('always deals exactly five playable pieces, at least two of them mirrors', () => {
    for (let seed = 1; seed < 300; seed++) {
      const b = generateBoard(seed * 31337);
      expect(b.inventory).toHaveLength(INVENTORY_SIZE);
      for (const p of b.inventory) expect(PLAYABLE_PIECES).toContain(p);
      const mirrors = b.inventory.filter((p) => p === Piece.MirrorA || p === Piece.MirrorB).length;
      expect(mirrors).toBeGreaterThanOrEqual(2);
    }
  });

  it('leaves enough empty cells to place the whole inventory', () => {
    for (let seed = 1; seed < 300; seed++) {
      const b = generateBoard(seed * 2654435761);
      let empty = 0;
      for (let i = 0; i < b.cells.length; i++) if (b.cells[i] === Cell.Empty) empty++;
      expect(empty).toBeGreaterThan(INVENTORY_SIZE);
    }
  });
});

describe('dailySeed / dailyBoard', () => {
  it('always yields a structurally valid board', () => {
    for (const date of datesFrom('2026-01-01', 120)) {
      expect(isStructurallyValid(dailyBoard(date)), date).toBe(true);
    }
  });

  it('is deterministic per date', () => {
    expect(dailySeed('2026-08-17')).toBe(dailySeed('2026-08-17'));
  });

  it('does not repeat a board within a year', () => {
    const seen = new Set<string>();
    for (const date of datesFrom('2026-01-01', 365)) {
      const b = dailyBoard(date);
      const key = `${Array.from(b.cells).join('')}|${b.originX},${b.originY},${b.originDir}`;
      expect(seen.has(key), `duplicate board on ${date}`).toBe(false);
      seen.add(key);
    }
  });
});

describe('solve', () => {
  it('finds a scoring solution on a normal board', () => {
    const result = solve(dailyBoard('2026-08-17'), { samples: 600, climbs: 200 });
    expect(result.par).toBeGreaterThan(0);
    expect(result.best).toHaveLength(INVENTORY_SIZE);
  });

  it('returns a solution that actually reproduces par', () => {
    const board = dailyBoard('2026-09-01');
    const result = solve(board, { samples: 600, climbs: 200 });
    expect(run(board, result.best).score).toBe(result.par);
  });

  it('is reproducible for a given search seed', () => {
    const board = dailyBoard('2026-10-05');
    const a = solve(board, { samples: 400, climbs: 100, seed: 11 });
    const b = solve(board, { samples: 400, climbs: 100, seed: 11 });
    expect(b.par).toBe(a.par);
    expect(b.best).toEqual(a.best);
  });

  it('orders its percentiles', () => {
    const result = solve(dailyBoard('2026-11-11'), { samples: 500, climbs: 150 });
    expect(result.median).toBeLessThanOrEqual(result.p90);
    expect(result.p90).toBeLessThanOrEqual(result.par);
  });
});

describe('board quality gate', () => {
  // FR-2: the generator must produce playable boards with no human curation.
  // This is the slow test that earns the right to ship a generated daily.
  it('grades 60 consecutive days as good with no hand tuning', () => {
    const failures: string[] = [];
    for (const date of datesFrom('2026-09-01', 60)) {
      // Must be the exact budget the seeds were curated under — see CURATION_BUDGET.
      const grade = gradeBoard(dailyBoard(date), CURATION_BUDGET);
      if (!grade.good) failures.push(`${date}: ${grade.reasons.join('; ')}`);
    }
    expect(failures, `\n${failures.join('\n')}`).toEqual([]);
  });

  it('a par run always lights a meaningful share of the board', () => {
    for (const date of datesFrom('2026-12-01', 8)) {
      const board = dailyBoard(date);
      const { ignitedAtPar, totalNodes } = solve(board, CURATION_BUDGET);
      expect(ignitedAtPar / totalNodes, date).toBeGreaterThanOrEqual(0.55);
    }
  });
});
