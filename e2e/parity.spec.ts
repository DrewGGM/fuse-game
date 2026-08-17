/**
 * Cross-engine parity — the gate that everything else depends on.
 *
 * The leaderboard is honest only because the server can replay a run and get the
 * client's number back (ADR-002). That holds only while the simulation produces
 * identical output in a browser and in Node. This test proves it on every push
 * by running the same thousand cases in both and comparing the full checksum,
 * not just the score.
 *
 * If this ever fails, do not adjust the tolerance. Find the divergence.
 */
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { INVENTORY_SIZE, run as runInNode, type Placement } from '@fuse/sim';
import { createRng, generateBoard } from '@fuse/gen';

const CASES = 1000;

interface Case {
  seed: number;
  placements: Placement[];
}

/** Builds a browser-loadable bundle of the simulation, straight from source. */
async function bundleSim(): Promise<string> {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../packages/sim/src/index.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'FuseSim',
    target: 'es2022',
    platform: 'browser',
  });
  return result.outputFiles[0].text;
}

/** Deterministic corpus of legal runs, generated identically for both engines. */
function buildCases(count: number): Case[] {
  const cases: Case[] = [];
  for (let i = 1; cases.length < count; i++) {
    const seed = (i * 0x9e3779b1) >>> 0;
    const board = generateBoard(seed);
    const rng = createRng((i * 7919) >>> 0);

    const originIndex = board.originY * board.w + board.originX;
    const open: number[] = [];
    for (let c = 0; c < board.cells.length; c++) {
      if (board.cells[c] === 0 && c !== originIndex) open.push(c);
    }
    if (open.length < INVENTORY_SIZE) continue;

    const chosen: number[] = [];
    let guard = 0;
    while (chosen.length < INVENTORY_SIZE && guard < 400) {
      guard++;
      const at = open[rng.int(open.length)];
      if (!chosen.includes(at)) chosen.push(at);
    }
    if (chosen.length < INVENTORY_SIZE) continue;

    cases.push({
      seed,
      placements: chosen.map((at, k) => ({
        x: at % board.w,
        y: Math.floor(at / board.w),
        piece: board.inventory[k],
      })),
    });
  }
  return cases;
}

test.describe('simulation parity', () => {
  test(`${CASES} runs produce identical results in a browser and in Node`, async ({ page }) => {
    test.setTimeout(180_000);

    const [bundle, cases] = await Promise.all([bundleSim(), Promise.resolve(buildCases(CASES))]);

    // Boards are rebuilt inside the page from their seed, so the payload stays
    // small and the browser exercises the same construction path.
    const boards = cases.map((c) => {
      const b = generateBoard(c.seed);
      return {
        w: b.w,
        h: b.h,
        cells: Array.from(b.cells),
        originX: b.originX,
        originY: b.originY,
        originDir: b.originDir,
        energy: b.energy,
        inventory: Array.from(b.inventory),
      };
    });

    await page.goto('about:blank');
    await page.addScriptTag({ content: bundle });

    const browserResults = await page.evaluate(
      ({ boards, placements }) => {
        const sim = (window as any).FuseSim;
        return boards.map((raw: any, i: number) => {
          const board = { ...raw, cells: Uint8Array.from(raw.cells) };
          const r = sim.run(board, placements[i]);
          return { score: r.score, ignited: r.ignited, ticks: r.ticks, checksum: r.checksum };
        });
      },
      { boards, placements: cases.map((c) => c.placements) }
    );

    const nodeResults = cases.map((c) => {
      const r = runInNode(generateBoard(c.seed), c.placements);
      return { score: r.score, ignited: r.ignited, ticks: r.ticks, checksum: r.checksum };
    });

    const divergences: string[] = [];
    for (let i = 0; i < nodeResults.length; i++) {
      const a = nodeResults[i];
      const b = browserResults[i];
      if (a.checksum !== b.checksum || a.score !== b.score || a.ticks !== b.ticks) {
        divergences.push(
          `case ${i} (seed ${cases[i].seed}): node ${JSON.stringify(a)} vs browser ${JSON.stringify(b)}`
        );
      }
    }

    expect(divergences.slice(0, 5).join('\n')).toBe('');
    expect(divergences).toHaveLength(0);
    expect(nodeResults).toHaveLength(CASES);

    // A corpus where nothing ever scores would pass trivially. Make sure the
    // cases actually exercise ignition, splitting and combos.
    const scoring = nodeResults.filter((r) => r.score > 0).length;
    expect(scoring, 'the parity corpus must contain runs that actually score').toBeGreaterThan(
      CASES * 0.3
    );
  });
});
