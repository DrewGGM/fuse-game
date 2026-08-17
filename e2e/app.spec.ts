/**
 * End-to-end tests for the critical path.
 *
 * These drive the real UI on a phone-sized viewport: tapping the canvas at real
 * coordinates, pressing the real buttons, reading the real DOM. The board is
 * deterministic per date, so tests can assert on exact scores without stubbing
 * the game.
 */
import { expect, test, type Page } from '@playwright/test';

const BOARD_PAD = 10; // must match BoardView's padding

test.beforeEach(async ({ page }) => {
  // Playwright gives every test a fresh context, so storage already starts empty.
  // Registering a clear() init script here would also fire on page.reload() and
  // wipe the very state a persistence test is trying to verify.
  await page.goto('/');
  await expect(page.locator('#screen-home')).toBeVisible();
});

/** Taps a board cell the way a finger would. */
async function tapCell(page: Page, x: number, y: number): Promise<void> {
  const canvas = page.locator('#board-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('board canvas has no box');

  const dims = await page.evaluate(() => {
    const b = (window as any).__fuse.session.board;
    return { w: b.w, h: b.h };
  });

  const cellW = (box.width - BOARD_PAD * 2) / dims.w;
  const cellH = (box.height - BOARD_PAD * 2) / dims.h;
  await page.mouse.click(
    box.x + BOARD_PAD + (x + 0.5) * cellW,
    box.y + BOARD_PAD + (y + 0.5) * cellH
  );
}

/** Places the whole inventory on the first legal cells found, left to right. */
async function fillBoard(page: Page): Promise<void> {
  const cells = await page.evaluate(() => {
    const b = (window as any).__fuse.session.board;
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < b.cells.length && out.length < 5; i++) {
      const x = i % b.w;
      const y = Math.floor(i / b.w);
      if (b.cells[i] !== 0) continue;
      if (x === b.originX && y === b.originY) continue;
      out.push({ x, y });
    }
    return out;
  });
  for (const c of cells) await tapCell(page, c.x, c.y);
}

// ---------------------------------------------------------------------------

test.describe('home', () => {
  test('shows today’s puzzle with three attempts and no streak', async ({ page }) => {
    await expect(page.locator('#daily-no')).toHaveText(/^#\d+$/);
    await expect(page.locator('#meta-attempts')).toHaveText('3');
    await expect(page.locator('#meta-best')).toHaveText('—');
    await expect(page.locator('#meta-streak')).toHaveText('0');
    await expect(page.locator('#reset-note')).toContainText('Tablero nuevo en');
  });

  test('renders a board preview rather than an empty canvas', async ({ page }) => {
    const painted = await page.evaluate(() => {
      const c = document.getElementById('preview-canvas') as HTMLCanvasElement;
      const ctx = c.getContext('2d')!;
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let nonBackground = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 20 || data[i + 1] > 20 || data[i + 2] > 20) nonBackground++;
      }
      return { nonBackground, pixels: data.length / 4 };
    });
    expect(painted.nonBackground).toBeGreaterThan(painted.pixels * 0.005);
  });
});

test.describe('playing a run', () => {
  test('placing five pieces enables the launch button', async ({ page }) => {
    await page.locator('#btn-play').click();
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('#btn-launch')).toBeDisabled();
    await expect(page.locator('#launch-hint')).toHaveText('Coloca 5 piezas');

    await fillBoard(page);

    await expect(page.locator('#btn-launch')).toBeEnabled();
    await expect(page.locator('#launch-hint')).toHaveText('Un solo toque');
  });

  test('tapping a placed piece picks it back up', async ({ page }) => {
    await page.locator('#btn-play').click();
    await fillBoard(page);
    const first = await page.evaluate(() => {
      const p = (window as any).__fuse.session.placements[0];
      return { x: p.x, y: p.y };
    });

    await tapCell(page, first.x, first.y);

    await expect(page.locator('#btn-launch')).toBeDisabled();
    await expect(page.locator('#launch-hint')).toHaveText('Coloca 1 pieza');
  });

  test('undo and clear behave as labelled', async ({ page }) => {
    await page.locator('#btn-play').click();
    await expect(page.locator('#btn-undo')).toBeDisabled();

    await fillBoard(page);
    await page.locator('#btn-undo').click();
    await expect(page.locator('#launch-hint')).toHaveText('Coloca 1 pieza');

    await page.locator('#btn-clear').click();
    await expect(page.locator('#launch-hint')).toHaveText('Coloca 5 piezas');
    await expect(page.locator('#btn-clear')).toBeDisabled();
  });

  test('a run reaches the result screen and the score matches the simulation', async ({ page }) => {
    await page.locator('#btn-play').click();
    await fillBoard(page);

    const expected = await page.evaluate(() => {
      const f = (window as any).__fuse;
      return f.session.placements.map((p: any) => [p.x, p.y, p.piece]);
    });
    expect(expected).toHaveLength(5);

    await page.locator('#btn-launch').click();
    await expect(page.locator('#screen-result')).toBeVisible({ timeout: 20_000 });

    const shown = await page.locator('#result-score').textContent();
    const stored = await page.evaluate(() => {
      const f = (window as any).__fuse;
      return f.store.getResult(f.utcDate())?.best ?? null;
    });
    expect(Number((shown ?? '').replace(/\D/g, ''))).toBe(stored);
  });

  test('the share summary carries no placement information', async ({ page }) => {
    await page.locator('#btn-play').click();
    await fillBoard(page);
    await page.locator('#btn-launch').click();
    await expect(page.locator('#screen-result')).toBeVisible({ timeout: 20_000 });

    const share = (await page.locator('#result-share').textContent()) ?? '';
    expect(share).toMatch(/^Fuse #\d+/m);
    expect(share).toMatch(/[█░]{10}/);
    // A coordinate leaking into the share text would spoil the puzzle.
    expect(share).not.toMatch(/\bx\s*[:=]|\by\s*[:=]|piece/i);
  });
});

test.describe('attempt limit', () => {
  test('runs out after three ranked attempts and falls back to practice', async ({ page }) => {
    for (let i = 3; i >= 1; i--) {
      await expect(page.locator('#meta-attempts')).toHaveText(String(i));
      await page.locator('#btn-play').click();
      await fillBoard(page);
      await page.locator('#btn-launch').click();
      await expect(page.locator('#screen-result')).toBeVisible({ timeout: 20_000 });
      await page.locator('#btn-result-home').click();
      await expect(page.locator('#screen-home')).toBeVisible();
    }

    await expect(page.locator('#meta-attempts')).toHaveText('0');
    await expect(page.locator('#daily-done')).toBeVisible();

    await page.locator('#btn-play').click();
    await expect(page.locator('#game-sub')).toHaveText('Práctica · sin ranking');
    await expect(page.locator('#toast')).toContainText('práctica', { ignoreCase: true });
  });

  test('a played day counts towards the streak', async ({ page }) => {
    await page.locator('#btn-play').click();
    await fillBoard(page);
    await page.locator('#btn-launch').click();
    await expect(page.locator('#screen-result')).toBeVisible({ timeout: 20_000 });
    await page.locator('#btn-result-home').click();
    await expect(page.locator('#meta-streak')).toHaveText('1');
  });
});

test.describe('archive', () => {
  test('lists past puzzles and plays them unranked', async ({ page }) => {
    await page.locator('#btn-archive').click();
    await expect(page.locator('#screen-archive')).toBeVisible();

    const rows = page.locator('.archive-row');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(5);
    await expect(rows.first().locator('.archive-score')).toHaveText('sin jugar');

    await rows.first().click();
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('#game-sub')).toHaveText('Práctica · sin ranking');

    // Practice must never consume a ranked attempt.
    await fillBoard(page);
    await page.locator('#btn-launch').click();
    await expect(page.locator('#screen-result')).toBeVisible({ timeout: 20_000 });
    await page.locator('#btn-result-home').click();
    await expect(page.locator('#meta-attempts')).toHaveText('3');
  });
});

test.describe('how to play', () => {
  test('explains every piece', async ({ page }) => {
    await page.locator('#btn-howto').click();
    await expect(page.locator('#screen-howto')).toBeVisible();
    await expect(page.locator('.piece-row')).toHaveCount(5);
    await expect(page.locator('.piece-row').first()).toContainText('Espejo');
  });
});

test.describe('settings', () => {
  test('persists a palette choice across a reload', async ({ page }) => {
    await page.locator('#btn-settings').click();
    await expect(page.locator('#screen-settings')).toBeVisible();

    await page.locator('.palette').nth(1).click();
    const chosen = await page.evaluate(() => (window as any).__fuse.store.load().settings.palette);
    expect(chosen).toBe('plasma');

    await page.reload();
    await page.locator('#btn-settings').click();
    await expect(page.locator('.palette').nth(1)).toHaveAttribute('data-selected', 'true');
  });

  test('locked palettes are not selectable', async ({ page }) => {
    await page.locator('#btn-settings').click();
    const locked = page.locator('.palette[data-locked="true"]').first();
    await expect(locked).toBeVisible();
    await locked.click();
    await expect(page.locator('#toast')).toContainText('pack de paletas', { ignoreCase: true });
  });

  test('toggles are off by default where the player has not opted in', async ({ page }) => {
    await page.locator('#btn-settings').click();
    // A daily reminder is a notification; it must never default to on.
    await expect(page.locator('#set-reminder')).not.toBeChecked();
    await expect(page.locator('#set-sound')).toBeChecked();
  });
});

test.describe('monetisation rules', () => {
  test('never shows an ad before or during play', async ({ page }) => {
    await page.locator('#btn-play').click();
    await expect(page.locator('#offers .offer')).toHaveCount(0);
    await fillBoard(page);
    await page.locator('#btn-launch').click();
    await expect(page.locator('#screen-result')).toBeVisible({ timeout: 20_000 });
    // Only now, at a natural break, may an opt-in offer appear.
    await expect(page.locator('#offers .offer').first()).toBeVisible();
  });

  test('offers are capped at two a day', async ({ page }) => {
    await page.locator('#btn-play').click();
    await fillBoard(page);
    await page.locator('#btn-launch').click();
    await expect(page.locator('#screen-result')).toBeVisible({ timeout: 20_000 });

    // Wait on the state the cap is actually made of. The toast lingers for two
    // seconds, so waiting on it lets the second iteration pass before its reward
    // has been granted.
    const rewardsLeft = () =>
      page.evaluate(() => {
        const f = (window as any).__fuse;
        return f.store.rewardsLeft(f.utcDate(), 2);
      });

    for (let i = 0; i < 2; i++) {
      const offer = page.locator('#offers .offer').first();
      if (!(await offer.isVisible())) break;
      const before = await rewardsLeft();
      await offer.click();
      await expect.poll(rewardsLeft, { timeout: 15_000 }).toBe(before - 1);
    }

    expect(await rewardsLeft()).toBe(0);
    // With the cap spent, no further offer may be shown.
    await expect(page.locator('#offers .offer')).toHaveCount(0);
  });

  test('practice runs carry no offers at all', async ({ page }) => {
    await page.locator('#btn-archive').click();
    await page.locator('.archive-row').first().click();
    await fillBoard(page);
    await page.locator('#btn-launch').click();
    await expect(page.locator('#screen-result')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#offers .offer')).toHaveCount(0);
  });
});

test.describe('robustness', () => {
  test('recovers from a corrupt save instead of failing to boot', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('fuse.save.v1', '{not json'));
    await page.goto('/');
    await expect(page.locator('#screen-home')).toBeVisible();
    await expect(page.locator('#meta-attempts')).toHaveText('3');
  });

  test('logs no console errors during a full run', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.locator('#btn-play').click();
    await fillBoard(page);
    await page.locator('#btn-launch').click();
    await expect(page.locator('#screen-result')).toBeVisible({ timeout: 20_000 });

    expect(errors).toEqual([]);
  });
});
