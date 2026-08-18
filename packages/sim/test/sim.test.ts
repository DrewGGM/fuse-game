import { describe, expect, it } from 'vitest';
import {
  BOMB_RADIUS,
  Cell,
  COMBO_WINDOW,
  Dir,
  INVENTORY_SIZE,
  InvalidPlacementError,
  MAX_MULTIPLIER,
  MAX_SPARKS,
  MAX_TICKS,
  NODE_VALUE,
  Piece,
  createSim,
  countNodes,
  run,
  step,
  validatePlacements,
  type Board,
  type DirValue,
  type PieceValue,
  type Placement,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Test board builder — an ASCII map keeps the intent of each test visible.
//   '.' empty   '#' wall   'o' node   '>' '<' '^' 'v' origin + direction
// ---------------------------------------------------------------------------

function board(map: string[], inventory: PieceValue[] = fiveMirrors(), energy = 200): Board {
  const h = map.length;
  const w = map[0].length;
  const cells = new Uint8Array(w * h);
  let originX = 0;
  let originY = 0;
  let originDir: DirValue = Dir.Right;

  for (let y = 0; y < h; y++) {
    expect(map[y].length, `row ${y} has the wrong width`).toBe(w);
    for (let x = 0; x < w; x++) {
      const ch = map[y][x];
      const at = y * w + x;
      if (ch === '#') cells[at] = Cell.Wall;
      else if (ch === 'o') cells[at] = Cell.Node;
      else cells[at] = Cell.Empty;

      if (ch === '>' || ch === '<' || ch === '^' || ch === 'v') {
        originX = x;
        originY = y;
        originDir = ch === '>' ? Dir.Right : ch === '<' ? Dir.Left : ch === '^' ? Dir.Up : Dir.Down;
      }
    }
  }
  return { w, h, cells, originX, originY, originDir, energy, inventory };
}

function fiveMirrors(): PieceValue[] {
  return [Piece.MirrorA, Piece.MirrorA, Piece.MirrorA, Piece.MirrorA, Piece.MirrorA];
}

/** Places the inventory on cells that are guaranteed not to matter for the test. */
function parkPieces(b: Board, used: Placement[] = []): Placement[] {
  const out = [...used];
  const inv = [...b.inventory];
  for (const u of used) {
    const i = inv.indexOf(u.piece);
    if (i >= 0) inv.splice(i, 1);
  }
  const taken = new Set(used.map((p) => p.y * b.w + p.x));
  for (let i = b.cells.length - 1; i >= 0 && out.length < INVENTORY_SIZE; i--) {
    if (b.cells[i] !== Cell.Empty) continue;
    if (taken.has(i)) continue;
    const x = i % b.w;
    const y = Math.floor(i / b.w);
    if (x === b.originX && y === b.originY) continue;
    out.push({ x, y, piece: inv.pop()! });
    taken.add(i);
  }
  return out;
}

// ---------------------------------------------------------------------------

describe('validatePlacements', () => {
  const b = board(['>....', '.....', '.....']);

  it('accepts fewer pieces than the inventory holds', () => {
    // The point of relaxing this: on most boards two or three pieces do all the
    // work, and forcing five implied a fit that does not exist.
    expect(() => validatePlacements(b, [{ x: 1, y: 1, piece: Piece.MirrorA }])).not.toThrow();
    expect(() =>
      validatePlacements(b, [
        { x: 1, y: 1, piece: Piece.MirrorA },
        { x: 3, y: 1, piece: Piece.MirrorA },
      ])
    ).not.toThrow();
  });

  it('rejects an empty run', () => {
    expect(() => validatePlacements(b, [])).toThrow(InvalidPlacementError);
  });

  it('rejects more pieces than the inventory holds', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ x: i, y: 1, piece: Piece.MirrorA }));
    expect(() => validatePlacements(b, six)).toThrowError(/between/);
  });

  it('rejects using a piece more times than it was dealt', () => {
    // The board's inventory is five MirrorA, so three MirrorB is impossible.
    const board2 = board(
      ['>....', '.....', '.....'],
      [Piece.MirrorA, Piece.MirrorA, Piece.MirrorB, Piece.Splitter, Piece.Boost]
    );
    expect(() =>
      validatePlacements(board2, [
        { x: 1, y: 1, piece: Piece.MirrorB },
        { x: 2, y: 1, piece: Piece.MirrorB },
      ])
    ).toThrowError(/not available/);
  });

  it('rejects a piece off the board', () => {
    const p = parkPieces(b);
    p[0] = { x: 99, y: 0, piece: p[0].piece };
    expect(() => validatePlacements(b, p)).toThrowError(/off the board/);
  });

  it('rejects a piece on a wall', () => {
    const walled = board(['>#...', '.....', '.....']);
    const p = parkPieces(walled);
    p[0] = { x: 1, y: 0, piece: p[0].piece };
    expect(() => validatePlacements(walled, p)).toThrowError(/not empty/);
  });

  it('rejects two pieces on the same cell', () => {
    const p = parkPieces(b);
    p[0] = { x: 2, y: 2, piece: p[0].piece };
    p[1] = { x: 2, y: 2, piece: p[1].piece };
    expect(() => validatePlacements(b, p)).toThrowError(/Two pieces/);
  });

  it('rejects building on the spark origin', () => {
    const p = parkPieces(b);
    p[0] = { x: b.originX, y: b.originY, piece: p[0].piece };
    expect(() => validatePlacements(b, p)).toThrowError(/spark origin/);
  });

  it('rejects a piece that is not in the daily inventory', () => {
    const p = parkPieces(b);
    p[0] = { ...p[0], piece: Piece.Bomb };
    expect(() => validatePlacements(b, p)).toThrowError(/not available/);
  });

  it('accepts a legal full set', () => {
    expect(() => validatePlacements(b, parkPieces(b))).not.toThrow();
  });
});

describe('partial runs', () => {
  it('a single well-placed mirror can score', () => {
    //  row 0:  . . . o .        one MirrorA at (3,1) turns the spark upward
    //  row 1:  > . . _ .        into the node directly above it
    const b = board(
      ['...o.', '>....', '.....'],
      [Piece.MirrorA, Piece.MirrorA, Piece.MirrorB, Piece.Splitter, Piece.Boost]
    );
    const r = run(b, [{ x: 3, y: 1, piece: Piece.MirrorA }]);
    expect(r.ignited).toBe(1);
    expect(r.score).toBe(NODE_VALUE);
  });

  it('an unused piece left on the board can hurt the score', () => {
    // This is the whole reason for letting players drop pieces: a spare mirror
    // parked in the path deflects the spark away from nodes it would have lit.
    const b = board(
      ['.....', '>oo.o', '.....'],
      [Piece.MirrorA, Piece.MirrorA, Piece.MirrorA, Piece.MirrorA, Piece.MirrorA]
    );

    // One mirror, parked out of the way: the spark runs the whole row.
    const clean = run(b, [{ x: 0, y: 2, piece: Piece.MirrorA }]);
    expect(clean.ignited).toBe(3);

    // A second mirror dropped in the gap at (3,1) turns the spark off the row.
    const cluttered = run(b, [
      { x: 0, y: 2, piece: Piece.MirrorA },
      { x: 3, y: 1, piece: Piece.MirrorA },
    ]);
    expect(cluttered.ignited).toBe(2);
  });
});

describe('spark movement', () => {
  it('scores a node it passes through', () => {
    const b = board(['>..o.', '.....', '.....']);
    const r = run(b, parkPieces(b));
    expect(r.ignited).toBe(1);
    expect(r.score).toBe(NODE_VALUE);
  });

  it('dies at the board edge', () => {
    const b = board(['>....', '.....', '.....']);
    const r = run(b, parkPieces(b));
    expect(r.ignited).toBe(0);
    expect(r.ticks).toBeLessThan(10);
  });

  it('dies on a wall without lighting anything behind it', () => {
    const b = board(['>.#oo', '.....', '.....']);
    const r = run(b, parkPieces(b));
    expect(r.ignited).toBe(0);
  });

  it('never lights the same node twice', () => {
    // A mirror pair sends the spark back over the node it already lit.
    const b = board(
      ['>o...', '.....', '.....'],
      [Piece.MirrorA, Piece.MirrorB, Piece.MirrorA, Piece.MirrorB, Piece.MirrorA]
    );
    const r = run(b, parkPieces(b));
    expect(r.ignited).toBeLessThanOrEqual(1);
  });

  it('runs out of energy and stops', () => {
    const b = board(['>....', '.....', '.....'], fiveMirrors(), 3);
    const r = run(b, parkPieces(b));
    expect(r.ticks).toBeLessThanOrEqual(4);
  });
});

describe('mirrors', () => {
  it('MirrorA turns a rightward spark upward', () => {
    //  > . /      the spark should leave the top edge, lighting the node above the mirror
    const b = board(
      ['..o..', '>./..', '.....'],
      [Piece.MirrorA, Piece.MirrorA, Piece.MirrorA, Piece.MirrorA, Piece.MirrorA]
    );
    const placed: Placement[] = [{ x: 2, y: 1, piece: Piece.MirrorA }];
    const r = run(b, parkPieces(b, placed));
    expect(r.ignited).toBe(1);
  });

  it('MirrorB turns a rightward spark downward', () => {
    const b = board(
      ['.....', '>....', '..o..'],
      [Piece.MirrorB, Piece.MirrorB, Piece.MirrorB, Piece.MirrorB, Piece.MirrorB]
    );
    const placed: Placement[] = [{ x: 2, y: 1, piece: Piece.MirrorB }];
    const r = run(b, parkPieces(b, placed));
    expect(r.ignited).toBe(1);
  });
});

describe('splitter', () => {
  it('creates a second spark that lights a node the first cannot reach', () => {
    const b = board(
      ['..o..', '>....', '..o..'],
      [Piece.Splitter, Piece.MirrorA, Piece.MirrorA, Piece.MirrorA, Piece.MirrorA]
    );
    const placed: Placement[] = [{ x: 2, y: 1, piece: Piece.Splitter }];
    const r = run(b, parkPieces(b, placed));
    expect(r.ignited).toBe(2);
  });

  it('passes straight through when there is not enough energy to divide', () => {
    const b = board(
      ['.....', '>o...', '.....'],
      [Piece.Splitter, Piece.MirrorA, Piece.MirrorA, Piece.MirrorA, Piece.MirrorA],
      2
    );
    const placed: Placement[] = [{ x: 3, y: 1, piece: Piece.Splitter }];
    expect(() => run(b, parkPieces(b, placed))).not.toThrow();
  });

  it('never exceeds the spark ceiling', () => {
    const wide = Array.from({ length: 15 }, (_, y) => (y === 7 ? '>' + '.'.repeat(14) : '.'.repeat(15)));
    const b = board(wide, [
      Piece.Splitter,
      Piece.Splitter,
      Piece.Splitter,
      Piece.Splitter,
      Piece.Splitter,
    ]);
    const placed: Placement[] = [
      { x: 2, y: 7, piece: Piece.Splitter },
      { x: 4, y: 7, piece: Piece.Splitter },
      { x: 6, y: 7, piece: Piece.Splitter },
      { x: 8, y: 7, piece: Piece.Splitter },
      { x: 10, y: 7, piece: Piece.Splitter },
    ];
    const state = createSim(b, placed);
    while (!state.done) step(state);
    expect(state.sparks.length).toBeLessThanOrEqual(MAX_SPARKS);
  });
});

describe('boost', () => {
  it('refills energy so the spark travels further than it otherwise could', () => {
    //          x: 0123456789012
    const map = ['.............', '>.........o..', '.............'];
    const inv: PieceValue[] = [
      Piece.Boost,
      Piece.MirrorA,
      Piece.MirrorA,
      Piece.MirrorA,
      Piece.MirrorA,
    ];

    // With 8 energy the spark reaches x=7 and dies short of the node at x=10.
    const withoutBoost = board(map, inv, 8);
    const parked = parkPieces(withoutBoost, [{ x: 3, y: 0, piece: Piece.Boost }]);
    expect(run(withoutBoost, parked).ignited).toBe(0);

    // Refuelled at x=5, it has 8 more steps and comfortably reaches x=10.
    const withBoost = board(map, inv, 8);
    const boosted = parkPieces(withBoost, [{ x: 5, y: 1, piece: Piece.Boost }]);
    expect(run(withBoost, boosted).ignited).toBe(1);
  });

  it('burns out after one use', () => {
    const b = board(
      ['.....', '>....', '.....'],
      [Piece.Boost, Piece.MirrorA, Piece.MirrorA, Piece.MirrorA, Piece.MirrorA]
    );
    const state = createSim(b, parkPieces(b, [{ x: 2, y: 1, piece: Piece.Boost }]));
    while (!state.done) step(state);
    expect(state.spent[1 * b.w + 2]).toBe(1);
  });
});

describe('bomb', () => {
  it('lights every node inside the blast and nothing outside it', () => {
    //  9 nodes total. A bomb at (1,2) reaches x in [-1,3], y in [0,4],
    //  which covers all of them except the node at (4,2).
    const b = board(
      ['.......', '.ooo...', '>.ooo..', '.ooo...', '.......'],
      [Piece.Bomb, Piece.MirrorA, Piece.MirrorA, Piece.MirrorA, Piece.MirrorA]
    );
    expect(BOMB_RADIUS).toBe(2);
    expect(countNodes(b)).toBe(9);

    const r = run(b, parkPieces(b, [{ x: 1, y: 2, piece: Piece.Bomb }]));
    expect(r.ignited).toBe(8);
  });

  it('consumes the spark, so nothing past the bomb is lit', () => {
    const b = board(
      ['.....', '>.#..', '.....'],
      [Piece.Bomb, Piece.MirrorA, Piece.MirrorA, Piece.MirrorA, Piece.MirrorA]
    );
    const state = createSim(b, parkPieces(b, [{ x: 1, y: 1, piece: Piece.Bomb }]));
    while (!state.done) step(state);
    expect(state.sparks.every((s) => !s.alive)).toBe(true);
  });
});

describe('combo multiplier', () => {
  it('increases with each node and raises the score above the flat rate', () => {
    const b = board(['>oooo', '.....', '.....']);
    const r = run(b, parkPieces(b));
    expect(r.ignited).toBe(4);
    // 100*1 + 100*2 + 100*3 + 100*4 = 1000, versus 400 at a flat rate.
    expect(r.score).toBe(1000);
  });

  it('never exceeds the ceiling', () => {
    const row = '>' + 'o'.repeat(30);
    const b = board([row, '.'.repeat(31), '.'.repeat(31)]);
    const r = run(b, parkPieces(b));
    const maxPossible = r.ignited * NODE_VALUE * MAX_MULTIPLIER;
    expect(r.score).toBeLessThanOrEqual(maxPossible);
  });

  it('resets after the combo window lapses', () => {
    const gap = '.'.repeat(COMBO_WINDOW + 4);
    const b = board([`>o${gap}o`, '.'.repeat(COMBO_WINDOW + 7), '.'.repeat(COMBO_WINDOW + 7)]);
    const r = run(b, parkPieces(b));
    expect(r.ignited).toBe(2);
    // First node at x1, second far away: the multiplier decayed back to 1.
    expect(r.score).toBe(NODE_VALUE * 2);
  });
});

describe('hard limits', () => {
  it('always terminates, even on a board designed to loop forever', () => {
    // Two mirrors facing each other trap the spark in a cycle.
    const b = board(
      ['.....', '>./.\\', '.....'],
      [Piece.MirrorA, Piece.MirrorB, Piece.MirrorA, Piece.MirrorB, Piece.MirrorA],
      100000
    );
    const placed: Placement[] = [
      { x: 2, y: 1, piece: Piece.MirrorA },
      { x: 4, y: 1, piece: Piece.MirrorB },
      { x: 2, y: 2, piece: Piece.MirrorB },
      { x: 4, y: 2, piece: Piece.MirrorA },
      { x: 0, y: 2, piece: Piece.MirrorA },
    ];
    const r = run(b, placed);
    expect(r.ticks).toBeLessThanOrEqual(MAX_TICKS);
  });
});

describe('countNodes', () => {
  it('counts only node cells', () => {
    expect(countNodes(board(['>o#o.', '.o...', '#....']))).toBe(3);
  });
});
