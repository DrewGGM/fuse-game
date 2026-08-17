/**
 * Property tests for the invariants the leaderboard rests on.
 *
 * These are the tests that matter most in the whole repository. A unit test
 * failing means a feature is broken; one of these failing means every score
 * ever submitted is suspect.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INVENTORY_SIZE, MAX_TICKS, run, type Placement } from '../src/index.js';
import { createRng, dailyBoard, generateBoard, utcDate } from '@fuse/gen';

/** Draws a legal placement set for a board, using a seeded RNG. */
function randomPlacements(board: ReturnType<typeof generateBoard>, seed: number): Placement[] | null {
  const rng = createRng(seed);
  const open: number[] = [];
  const originIndex = board.originY * board.w + board.originX;
  for (let i = 0; i < board.cells.length; i++) {
    if (board.cells[i] === 0 && i !== originIndex) open.push(i);
  }
  if (open.length < INVENTORY_SIZE) return null;

  const chosen: number[] = [];
  let guard = 0;
  while (chosen.length < INVENTORY_SIZE && guard < 500) {
    guard++;
    const at = open[rng.int(open.length)];
    if (!chosen.includes(at)) chosen.push(at);
  }
  if (chosen.length < INVENTORY_SIZE) return null;

  return chosen.map((at, i) => ({
    x: at % board.w,
    y: Math.floor(at / board.w),
    piece: board.inventory[i],
  }));
}

/** A broad sweep of (board, placements) pairs — the input domain for every property below. */
function* cases(count: number): Generator<{ board: ReturnType<typeof generateBoard>; placements: Placement[] }> {
  let produced = 0;
  for (let seed = 1; produced < count; seed++) {
    const board = generateBoard(seed * 0x9e3779b1);
    const placements = randomPlacements(board, seed * 7919);
    if (!placements) continue;
    produced++;
    yield { board, placements };
  }
}

describe('determinism', () => {
  it('the same input always produces the same output', () => {
    for (const { board, placements } of cases(300)) {
      const a = run(board, placements);
      const b = run(board, placements);
      expect(b).toEqual(a);
    }
  });

  it('a fresh board object with identical contents produces an identical checksum', () => {
    // Guards against the simulation accidentally capturing object identity
    // rather than the values — the kind of bug that only shows up across processes.
    for (const { board, placements } of cases(120)) {
      const clone = { ...board, cells: Uint8Array.from(board.cells), inventory: [...board.inventory] };
      expect(run(clone, placements).checksum).toBe(run(board, placements).checksum);
    }
  });

  it('placement order does not change the result', () => {
    // The board is a set of cells, not a list. Reordering the same pieces on the
    // same cells must score identically, or clients could game submission order.
    for (const { board, placements } of cases(150)) {
      const forwards = run(board, placements);
      const backwards = run(board, [...placements].reverse());
      expect(backwards.score).toBe(forwards.score);
      expect(backwards.checksum).toBe(forwards.checksum);
    }
  });
});

describe('simulation invariants', () => {
  it('always terminates within the tick cap', () => {
    for (const { board, placements } of cases(400)) {
      expect(run(board, placements).ticks).toBeLessThanOrEqual(MAX_TICKS);
    }
  });

  it('never lights more nodes than the board has', () => {
    for (const { board, placements } of cases(300)) {
      const r = run(board, placements);
      expect(r.ignited).toBeGreaterThanOrEqual(0);
      expect(r.ignited).toBeLessThanOrEqual(r.totalNodes);
    }
  });

  it('scores zero if and only if nothing was lit', () => {
    for (const { board, placements } of cases(300)) {
      const r = run(board, placements);
      expect(r.score === 0).toBe(r.ignited === 0);
    }
  });

  it('produces a checksum that changes when the score changes', () => {
    // Weak but useful: two runs with different scores must not collide,
    // otherwise the parity check could pass while the simulations diverged.
    const byScore = new Map<number, number>();
    let collisions = 0;
    for (const { board, placements } of cases(500)) {
      const r = run(board, placements);
      const seen = byScore.get(r.checksum);
      if (seen !== undefined && seen !== r.score) collisions++;
      byScore.set(r.checksum, r.score);
    }
    expect(collisions).toBe(0);
  });
});

describe('float discipline', () => {
  it('scores are always integers', () => {
    for (const { board, placements } of cases(300)) {
      const r = run(board, placements);
      expect(Number.isInteger(r.score)).toBe(true);
      expect(Number.isInteger(r.ignited)).toBe(true);
      expect(Number.isInteger(r.ticks)).toBe(true);
      expect(Number.isInteger(r.checksum)).toBe(true);
    }
  });

  it('checksums stay inside the unsigned 32-bit range', () => {
    for (const { board, placements } of cases(200)) {
      const c = run(board, placements).checksum;
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('the simulation source contains no transcendental maths', () => {
    // A grep-as-a-test. Cheap, and it catches the one mistake that would
    // silently break cross-engine agreement months from now.
    const src = new URL('../src/index.ts', import.meta.url);
    const code = readFileSync(src, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments — the rules are written there
      .replace(/\/\/.*$/gm, ''); // line comments
    const banned = ['Math.random', 'Math.sin', 'Math.cos', 'Math.tan', 'Math.pow', 'Math.sqrt', 'Date.now', 'new Date'];
    for (const token of banned) {
      expect(code.includes(token), `@fuse/sim must not use ${token}`).toBe(false);
    }
  });

  it('the simulation package declares no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });
});

describe('daily boards', () => {
  it('every player on a given date gets the same board', () => {
    const a = dailyBoard('2026-08-17');
    const b = dailyBoard('2026-08-17');
    expect(Array.from(b.cells)).toEqual(Array.from(a.cells));
    expect(b.inventory).toEqual(a.inventory);
    expect([b.originX, b.originY, b.originDir]).toEqual([a.originX, a.originY, a.originDir]);
  });

  it('consecutive dates are unrelated', () => {
    const a = dailyBoard('2026-08-17');
    const b = dailyBoard('2026-08-18');
    expect(Array.from(b.cells)).not.toEqual(Array.from(a.cells));
  });

  it('utcDate formats a timestamp as YYYY-MM-DD', () => {
    expect(utcDate(Date.parse('2026-08-17T23:59:59Z'))).toBe('2026-08-17');
    expect(utcDate(Date.parse('2026-08-18T00:00:00Z'))).toBe('2026-08-18');
  });
});
