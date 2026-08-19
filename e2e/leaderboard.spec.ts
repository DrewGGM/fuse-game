/**
 * The leaderboard, and what happens when it is not there.
 *
 * The API is stubbed at the network layer rather than pointed at a real Worker:
 * CI should not need wrangler running, and the interesting cases here are the
 * unhappy ones — no signal, a server that refuses, a queue that has to survive a
 * reload. Those are hard to produce reliably against a live server and trivial
 * to produce against a route handler.
 *
 * The real end-to-end path is covered separately by scripts/simulate-players.ts,
 * which drives actual HTTP against a local Worker.
 */
import { expect, test, type Page, type Route } from '@playwright/test';

const BOARD_PAD = 10;

interface StubOptions {
  /** Fail every call, as if there were no network at all. */
  offline?: boolean;
  /** Reject submissions with this error code. */
  rejectWith?: string;
  /** Players already on the board. */
  leaderboard?: { rank: number; handle: string; score: number }[];
}

/**
 * Intercepts the API. Returns a counter so a test can assert what was called.
 */
async function stubApi(page: Page, options: StubOptions = {}): Promise<{ submits: number }> {
  const counters = { submits: 0 };

  await page.route('**/v1/**', async (route: Route) => {
    const url = route.request().url();

    if (options.offline) {
      await route.abort('connectionrefused');
      return;
    }

    if (url.includes('/v1/players')) {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'test-player', handle: 'Chispa777', token: 'test-token' }),
      });
      return;
    }

    if (url.includes('/v1/runs')) {
      counters.submits++;
      if (options.rejectWith) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: options.rejectWith, message: 'no' } }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accepted: true,
          score: 5400,
          ignited: 10,
          totalNodes: 17,
          rank: 3,
          players: 42,
          percentile: 93,
          attemptsLeft: 2,
        }),
      });
      return;
    }

    if (url.includes('/v1/leaderboard')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          date: '2026-08-19',
          puzzle: 231,
          top: options.leaderboard ?? [
            { rank: 1, handle: 'Bobina100', score: 9000 },
            { rank: 1, handle: 'Mecha200', score: 9000 },
            { rank: 3, handle: 'Chispa777', score: 5400 },
          ],
        }),
      });
      return;
    }

    await route.fulfill({ status: 404, body: '{}' });
  });

  return counters;
}

async function skipTutorial(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const raw = localStorage.getItem('fuse.save.v1');
    const data = raw ? JSON.parse(raw) : {};
    data.tutorialDone = true;
    localStorage.setItem('fuse.save.v1', JSON.stringify(data));
  });
}

/** Plays one ranked run with a single piece, which is enough to score. */
async function playOneRun(page: Page): Promise<void> {
  await page.locator('#btn-play').click();
  await expect(page.locator('#screen-game')).toBeVisible();

  const cell = await page.evaluate(() => {
    const b = (window as any).__fuse.session.board;
    for (let i = 0; i < b.cells.length; i++) {
      const x = i % b.w;
      const y = Math.floor(i / b.w);
      if (b.cells[i] !== 0) continue;
      if (x === b.originX && y === b.originY) continue;
      return { x, y };
    }
    throw new Error('no free cell');
  });

  const box = await page.locator('#board-canvas').boundingBox();
  if (!box) throw new Error('no board');
  const dims = await page.evaluate(() => {
    const b = (window as any).__fuse.session.board;
    return { w: b.w, h: b.h };
  });
  await page.mouse.click(
    box.x + BOARD_PAD + (cell.x + 0.5) * ((box.width - BOARD_PAD * 2) / dims.w),
    box.y + BOARD_PAD + (cell.y + 0.5) * ((box.height - BOARD_PAD * 2) / dims.h)
  );

  await page.locator('#btn-launch').click();
  await expect(page.locator('#screen-result')).toBeVisible({ timeout: 20_000 });
}

test.beforeEach(async ({ page }) => {
  await skipTutorial(page);
});

test.describe('with a reachable server', () => {
  test('shows where the run placed', async ({ page }) => {
    await stubApi(page);
    await page.goto('/');
    await playOneRun(page);

    await expect(page.locator('#rank-card')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#rank-pos')).toHaveText('#3');
    await expect(page.locator('#rank-of')).toContainText('de 42');
    await expect(page.locator('#rank-of')).toContainText('93%');
  });

  test('previews the top of the board beside the rank', async ({ page }) => {
    await stubApi(page);
    await page.goto('/');
    await playOneRun(page);

    await expect(page.locator('.rank-row')).toHaveCount(3, { timeout: 15_000 });
    await expect(page.locator('.rank-row').first()).toContainText('Bobina100');
  });

  test('opens the full board and highlights the player', async ({ page }) => {
    await stubApi(page);
    await page.goto('/');
    await playOneRun(page);

    await expect(page.locator('#rank-card')).toBeVisible({ timeout: 15_000 });
    await page.locator('#btn-full-board').click();

    await expect(page.locator('#screen-board')).toBeVisible();
    await expect(page.locator('.board-row')).toHaveCount(3);
    // The stub returns the player's own handle in third place.
    await expect(page.locator('.board-row.is-me')).toHaveCount(1);
    await expect(page.locator('.board-row.is-me')).toContainText('Chispa777');
  });

  test('shows tied players sharing a position', async ({ page }) => {
    await stubApi(page);
    await page.goto('/');
    await playOneRun(page);
    await expect(page.locator('#rank-card')).toBeVisible({ timeout: 15_000 });
    await page.locator('#btn-full-board').click();

    // The board fetches before it renders, so wait for the rows rather than
    // reading whatever is on screen the instant the click returns.
    await expect(page.locator('.board-row')).toHaveCount(3);
    const positions = await page.locator('.board-pos').allTextContents();
    // Two players tied at the top, so nobody is second.
    expect(positions).toEqual(['1', '1', '3']);
  });

  test('empties the queue once a run is accepted', async ({ page }) => {
    await stubApi(page);
    await page.goto('/');
    await playOneRun(page);

    await expect
      .poll(() => page.evaluate(() => (window as any).__fuse.sync.pendingCount()), {
        timeout: 15_000,
      })
      .toBe(0);
    await expect(page.locator('#sync-note')).toBeHidden();
  });
});

test.describe('with no server', () => {
  test('still plays, scores and shares', async ({ page }) => {
    await stubApi(page, { offline: true });
    await page.goto('/');
    await playOneRun(page);

    // Everything local must be unaffected: the whole point of deriving the
    // board on the device is that a lost connection costs only the comparison.
    await expect(page.locator('#result-score')).not.toHaveText('0');
    await expect(page.locator('#result-share')).toContainText('Fuse #');
    await expect(page.locator('#result-gap')).not.toBeEmpty();
  });

  test('keeps the run and says so, rather than losing it silently', async ({ page }) => {
    await stubApi(page, { offline: true });
    await page.goto('/');
    await playOneRun(page);

    await expect(page.locator('#sync-note')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#sync-note')).toContainText('Sin conexión');
    expect(await page.evaluate(() => (window as any).__fuse.sync.pendingCount())).toBe(1);
  });

  test('the queued run survives a reload', async ({ page }) => {
    await stubApi(page, { offline: true });
    await page.goto('/');
    await playOneRun(page);
    await expect(page.locator('#sync-note')).toBeVisible({ timeout: 15_000 });

    await page.reload();
    expect(await page.evaluate(() => (window as any).__fuse.sync.pendingCount())).toBe(1);
  });

  test('sends the backlog when the network returns', async ({ page }) => {
    await stubApi(page, { offline: true });
    await page.goto('/');
    await playOneRun(page);
    await expect(page.locator('#sync-note')).toBeVisible({ timeout: 15_000 });

    // The network comes back; the queue drains without the player doing anything.
    await page.unroute('**/v1/**');
    const counters = await stubApi(page);
    await page.locator('#btn-result-home').click();

    await expect
      .poll(() => page.evaluate(() => (window as any).__fuse.sync.pendingCount()), {
        timeout: 15_000,
      })
      .toBe(0);
    expect(counters.submits).toBeGreaterThan(0);
  });

  test('shows no rank card at all rather than a blank one', async ({ page }) => {
    await stubApi(page, { offline: true });
    await page.goto('/');
    await playOneRun(page);
    await expect(page.locator('#rank-card')).toBeHidden();
  });
});

test.describe('when the server refuses a run', () => {
  test('says why instead of pretending it counted', async ({ page }) => {
    await stubApi(page, { rejectWith: 'ATTEMPTS_EXHAUSTED' });
    await page.goto('/');
    await playOneRun(page);

    await expect(page.locator('#sync-note')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#sync-note')).toContainText('intentos');
    // A refusal is final, so the run must not sit in the queue forever.
    expect(await page.evaluate(() => (window as any).__fuse.sync.pendingCount())).toBe(0);
  });

  test('does not retry a rejected run', async ({ page }) => {
    const counters = await stubApi(page, { rejectWith: 'SCORE_MISMATCH' });
    await page.goto('/');
    await playOneRun(page);
    await expect(page.locator('#sync-note')).toBeVisible({ timeout: 15_000 });

    await page.locator('#btn-result-home').click();
    await page.waitForTimeout(1500);
    expect(counters.submits).toBe(1);
  });
});

test.describe('practice runs', () => {
  test('are never submitted to the leaderboard', async ({ page }) => {
    const counters = await stubApi(page);
    await page.goto('/');

    await page.locator('#btn-archive').click();
    await page.locator('.archive-row').first().click();
    await expect(page.locator('#game-sub')).toHaveText('Práctica · sin ranking');

    const cell = await page.evaluate(() => {
      const b = (window as any).__fuse.session.board;
      for (let i = 0; i < b.cells.length; i++) {
        const x = i % b.w;
        const y = Math.floor(i / b.w);
        if (b.cells[i] === 0 && !(x === b.originX && y === b.originY)) return { x, y };
      }
      throw new Error('no cell');
    });
    const box = await page.locator('#board-canvas').boundingBox();
    const dims = await page.evaluate(() => {
      const b = (window as any).__fuse.session.board;
      return { w: b.w, h: b.h };
    });
    await page.mouse.click(
      box!.x + BOARD_PAD + (cell.x + 0.5) * ((box!.width - BOARD_PAD * 2) / dims.w),
      box!.y + BOARD_PAD + (cell.y + 0.5) * ((box!.height - BOARD_PAD * 2) / dims.h)
    );
    await page.locator('#btn-launch').click();
    await expect(page.locator('#screen-result')).toBeVisible({ timeout: 20_000 });

    await expect(page.locator('#rank-card')).toBeHidden();
    expect(counters.submits).toBe(0);
  });
});
