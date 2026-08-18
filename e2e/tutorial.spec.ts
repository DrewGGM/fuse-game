/**
 * The first-run tutorial.
 *
 * Lives in its own file on purpose: app.spec.ts marks the tutorial as seen
 * before every test so the rest of the suite starts on the home screen, and a
 * tutorial test sharing that context would never see the thing it is testing.
 */
import { expect, test, type Page } from '@playwright/test';

const BOARD_PAD = 10; // must match BoardView's padding
const TUT_W = 7;
const TUT_H = 9;

/** Taps a cell on the tutorial board. */
async function tapTutorialCell(page: Page, x: number, y: number): Promise<void> {
  const box = await page.locator('#tut-canvas').boundingBox();
  if (!box) throw new Error('tutorial canvas has no box');
  await page.mouse.click(
    box.x + BOARD_PAD + (x + 0.5) * ((box.width - BOARD_PAD * 2) / TUT_W),
    box.y + BOARD_PAD + (y + 0.5) * ((box.height - BOARD_PAD * 2) / TUT_H)
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('a brand new player lands in the tutorial, not the daily board', async ({ page }) => {
  await expect(page.locator('#screen-tutorial')).toBeVisible();
  await expect(page.locator('#screen-home')).toBeHidden();
  await expect(page.locator('#tut-step')).toHaveText('1 / 5');
});

test('teaches the mechanic and hands over to today, in five steps', async ({ page }) => {
  await expect(page.locator('#tut-piece')).toBeHidden();
  await page.locator('#btn-tut-next').click();
  await expect(page.locator('#tut-step')).toHaveText('2 / 5');

  await page.locator('#btn-tut-next').click();
  await expect(page.locator('#tut-step')).toHaveText('3 / 5');
  // Step three waits for a real tap, so the Next button must be out of the way.
  await expect(page.locator('#tut-piece')).toBeVisible();
  await expect(page.locator('#btn-tut-next')).toBeHidden();

  await tapTutorialCell(page, 3, 4);
  await expect(page.locator('#tut-step')).toHaveText('4 / 5');

  await page.locator('#btn-tut-next').click();
  await expect(page.locator('#tut-step')).toHaveText('5 / 5');
  // One mirror lights all four nodes: 100 + 200 + 300 + 400.
  // Spanish does not group four-digit numbers (CLDR minimumGroupingDigits: 2),
  // so this is "1000" and not "1.000".
  await expect(page.locator('#tut-text')).toContainText('1000 puntos con una sola pieza', {
    timeout: 20_000,
  });

  await page.locator('#btn-tut-next').click();
  await expect(page.locator('#screen-home')).toBeVisible();
});

test('the score never erases the closing lesson', async ({ page }) => {
  for (let i = 0; i < 2; i++) await page.locator('#btn-tut-next').click();
  await tapTutorialCell(page, 3, 4);
  await page.locator('#btn-tut-next').click();
  await expect(page.locator('#tut-step')).toHaveText('5 / 5');

  // Both must be on screen at once: the number proves one piece was enough, and
  // the sentence says why that matters.
  await expect(page.locator('#tut-text')).toContainText('1000 puntos', { timeout: 20_000 });
  await expect(page.locator('#tut-text')).toContainText('No hay una solución correcta');
});

test('a wrong tap is corrected, not punished', async ({ page }) => {
  await page.locator('#btn-tut-next').click();
  await page.locator('#btn-tut-next').click();

  await tapTutorialCell(page, 0, 0);
  await expect(page.locator('#tut-text')).toContainText('Casi');
  await expect(page.locator('#tut-step')).toHaveText('3 / 5');

  await tapTutorialCell(page, 3, 4);
  await expect(page.locator('#tut-step')).toHaveText('4 / 5');
});

test('skipping is remembered, so it never nags again', async ({ page }) => {
  await page.locator('#btn-tut-skip').click();
  await expect(page.locator('#screen-home')).toBeVisible();

  await page.reload();
  await expect(page.locator('#screen-home')).toBeVisible();
  await expect(page.locator('#screen-tutorial')).toBeHidden();
});

test('can be replayed from settings', async ({ page }) => {
  await page.locator('#btn-tut-skip').click();
  await page.locator('#btn-settings').click();
  await page.locator('#btn-replay-tutorial').click();
  await expect(page.locator('#screen-tutorial')).toBeVisible();
  await expect(page.locator('#tut-step')).toHaveText('1 / 5');
});
