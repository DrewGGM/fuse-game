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

/**
 * Marks the tutorial as seen before the app boots.
 *
 * Every test except the tutorial suite starts on the home screen, and a
 * first-run tutorial would otherwise sit in front of all of them. Written as an
 * init script rather than a clear() so it survives page.reload() — unlike
 * clearing storage, re-applying this flag is idempotent.
 */
async function skipTutorial(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const raw = localStorage.getItem('fuse.save.v1');
    const data = raw ? JSON.parse(raw) : {};
    data.tutorialDone = true;
    localStorage.setItem('fuse.save.v1', JSON.stringify(data));
  });
}

test.beforeEach(async ({ page }) => {
  // Playwright gives every test a fresh context, so storage already starts empty.
  await skipTutorial(page);
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

/** The first `count` cells a piece may legally go on. */
async function freeCells(page: Page, count: number): Promise<{ x: number; y: number }[]> {
  return page.evaluate((n) => {
    const b = (window as any).__fuse.session.board;
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < b.cells.length && out.length < n; i++) {
      const x = i % b.w;
      const y = Math.floor(i / b.w);
      if (b.cells[i] !== 0) continue;
      if (x === b.originX && y === b.originY) continue;
      out.push({ x, y });
    }
    return out;
  }, count);
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
  test('a single piece is enough to light the fuse', async ({ page }) => {
    // The rule that used to demand all five implied a fit that does not exist:
    // on 89% of boards the best known run uses fewer.
    await page.locator('#btn-play').click();
    await expect(page.locator('#screen-game')).toBeVisible();
    await expect(page.locator('#btn-launch')).toBeDisabled();
    await expect(page.locator('#launch-hint')).toHaveText('Coloca al menos una pieza');

    const cells = await freeCells(page, 1);
    await tapCell(page, cells[0].x, cells[0].y);

    await expect(page.locator('#btn-launch')).toBeEnabled();
    await expect(page.locator('#launch-hint')).toHaveText('1 de 5 · un solo toque');
    await expect(page.locator('#tray-note')).toContainText('Puedes encender ya');
  });

  test('the tray says outright that pieces are optional', async ({ page }) => {
    await page.locator('#btn-play').click();
    await expect(page.locator('#tray-note')).toContainText('No hace falta usarlas todas');
  });

  test('tapping a placed piece picks it back up', async ({ page }) => {
    await page.locator('#btn-play').click();
    await fillBoard(page);
    const first = await page.evaluate(() => {
      const p = (window as any).__fuse.session.placements[0];
      return { x: p.x, y: p.y };
    });

    await tapCell(page, first.x, first.y);

    await expect(page.locator('#launch-hint')).toHaveText('4 de 5 · un solo toque');
  });

  test('undo and clear behave as labelled', async ({ page }) => {
    await page.locator('#btn-play').click();
    await expect(page.locator('#btn-undo')).toBeDisabled();

    await fillBoard(page);
    await page.locator('#btn-undo').click();
    await expect(page.locator('#launch-hint')).toHaveText('4 de 5 · un solo toque');

    await page.locator('#btn-clear').click();
    await expect(page.locator('#launch-hint')).toHaveText('Coloca al menos una pieza');
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

/**
 * Counts what the audio graph is actually asked to play.
 *
 * The unit tests prove the module picks a sample over a tone; only a real
 * browser proves the files exist, are served, and decode. Installed before the
 * app boots so nothing is missed, and it records instead of blocking — the game
 * plays exactly as it would otherwise.
 */
async function watchAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log = { samples: [] as number[], tones: [] as number[] };
    (window as any).__audio = log;

    const source = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function (this: AudioContext) {
      const node = source.call(this);
      const start = node.start.bind(node);
      node.start = ((...args: unknown[]) => {
        log.samples.push(node.playbackRate.value);
        return (start as (...a: unknown[]) => void)(...args);
      }) as typeof node.start;
      return node;
    };

    const osc = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      const node = osc.call(this);
      const start = node.start.bind(node);
      node.start = ((...args: unknown[]) => {
        log.tones.push(node.frequency.value);
        return (start as (...a: unknown[]) => void)(...args);
      }) as typeof node.start;
      return node;
    };
  });
  await page.reload();
  await expect(page.locator('#screen-home')).toBeVisible();
}

test.describe('sound', () => {
  test('serves every cue', async ({ page }) => {
    const bad: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/sfx/') && r.status() !== 200) bad.push(`${r.status()} ${r.url()}`);
    });
    await page.reload();
    await page.waitForFunction(
      () => performance.getEntriesByType('resource').filter((e) => e.name.includes('/sfx/')).length === 8,
      null,
      // Interval rather than the default requestAnimationFrame: a throttled page
      // stops getting frames, and the wait then fails because nothing asked the
      // question, not because the answer was no.
      { timeout: 10_000, polling: 250 }
    );
    expect(bad).toEqual([]);
  });

  test('plays the samples, not the fallback tones, through a whole run', async ({ page }) => {
    await watchAudio(page);
    await page.locator('#btn-play').click();
    await fillBoard(page);
    await page.locator('#btn-launch').click();
    await expect(page.locator('#screen-result')).toBeVisible({ timeout: 20_000 });

    const log = await page.evaluate(() => (window as any).__audio as { samples: number[]; tones: number[] });
    // The first cue of a session is a tone by construction: decoding needs the
    // context, and the context needs the gesture that produced that first cue.
    expect(log.tones.length).toBeLessThanOrEqual(1);
    expect(log.samples.length).toBeGreaterThan(5);
  });

  test('bends the pitch upward as the combo climbs', async ({ page }) => {
    await watchAudio(page);
    await page.locator('#btn-play').click();
    await fillBoard(page);
    await page.locator('#btn-launch').click();
    await expect(page.locator('#screen-result')).toBeVisible({ timeout: 20_000 });

    const rates = await page.evaluate(() => (window as any).__audio.samples as number[]);
    // A chain that played one note eighty times would be a rattle. The rising
    // line is what makes it read as a single accelerating event.
    expect(Math.max(...rates)).toBeGreaterThan(1);
  });

  test('turning sound off means silence, not a quieter sound', async ({ page }) => {
    await page.locator('#btn-settings').click();
    await page.locator('#set-sound').uncheck();
    await page.locator('#btn-settings-back').click();

    await watchAudio(page);
    await page.locator('#btn-play').click();
    await fillBoard(page);
    await page.locator('#btn-launch').click();
    await expect(page.locator('#screen-result')).toBeVisible({ timeout: 20_000 });

    const log = await page.evaluate(() => (window as any).__audio as { samples: number[]; tones: number[] });
    expect(log.samples).toEqual([]);
    expect(log.tones).toEqual([]);
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

    // A save it cannot read is a new player, so the tutorial is the correct
    // landing screen — the point is that it boots at all rather than throwing.
    await expect(page.locator('#screen-tutorial')).toBeVisible();
    await page.locator('#btn-tut-skip').click();
    await expect(page.locator('#screen-home')).toBeVisible();
    await expect(page.locator('#meta-attempts')).toHaveText('3');
  });

  test('logs no console errors during a full run', async ({ page }) => {
    // The API is unreachable in this suite, and a browser always logs a failed
    // request. That is the network refusing, not the app misbehaving, so it is
    // filtered explicitly — and the assertion below proves the app absorbed it.
    const NETWORK = /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|Failed to load resource|Failed to fetch/i;
    const errors: string[] = [];
    page.on('console', (m) => {
      const text = m.text();
      if (m.type() !== 'error') return;
      if (text.includes('favicon') || NETWORK.test(text)) return;
      errors.push(text);
    });
    // An uncaught exception is never acceptable, network or not.
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

    await page.locator('#btn-play').click();
    await fillBoard(page);
    await page.locator('#btn-launch').click();
    await expect(page.locator('#screen-result')).toBeVisible({ timeout: 20_000 });

    expect(errors).toEqual([]);
  });

  test('a dead API never leaks an exception into the page', async ({ page }) => {
    const crashes: string[] = [];
    page.on('pageerror', (e) => crashes.push(e.message));

    await page.locator('#btn-play').click();
    await fillBoard(page);
    await page.locator('#btn-launch').click();
    await expect(page.locator('#screen-result')).toBeVisible({ timeout: 20_000 });
    // Give the failing submission time to reject and be handled.
    await page.waitForTimeout(2000);

    expect(crashes).toEqual([]);
    // And the run is not lost: it is waiting to be sent.
    expect(await page.evaluate(() => (window as any).__fuse.sync.pendingCount())).toBe(1);
  });
});

test.describe('the daily target', () => {
  test('is shown on the home screen', async ({ page }) => {
    // The home card shows the reachable target, not the record: a number that
    // nearly nobody reaches is not something to plan a run around.
    const { target, record } = await page.evaluate(() => {
      const f = (window as any).__fuse;
      const date = f.utcDate();
      return { target: f.dailyTarget(date), record: f.dailyPar(date) };
    });
    expect(target).toBeGreaterThan(0);
    expect(target).toBeLessThanOrEqual(record);
    await expect(page.locator('#meta-par')).toHaveText(target.toLocaleString('es-ES'));
  });

  test('turns a bare score into a distance', async ({ page }) => {
    await page.locator('#btn-play').click();
    const cells = await freeCells(page, 1);
    await tapCell(page, cells[0].x, cells[0].y);
    await page.locator('#btn-launch').click();
    await expect(page.locator('#screen-result')).toBeVisible({ timeout: 20_000 });

    await expect(page.locator('#result-par-label')).toContainText('Objetivo:');
    await expect(page.locator('#result-gap')).not.toBeEmpty();
    await expect(page.locator('#result-bar-mark')).toBeVisible();

    // The detail line states facts only; judgement belongs to the gap line, or
    // the screen ends up contradicting itself.
    await expect(page.locator('#result-detail')).toContainText('nodos encendidos');
    await expect(page.locator('#result-detail')).not.toContainText('más ahí dentro');
  });

  test('separates the reachable target from the record', async ({ page }) => {
    const { target, record } = await page.evaluate(() => {
      const f = (window as any).__fuse;
      const date = f.utcDate();
      return { target: f.dailyTarget(date), record: f.dailyPar(date) };
    });
    // Simulating a population of players showed the record is reached by
    // essentially nobody, so the two numbers must not be the same thing.
    expect(target).toBeGreaterThan(0);
    expect(record).toBeGreaterThanOrEqual(target);
    await expect(page.locator('#meta-par')).not.toHaveText('—');
  });
});

