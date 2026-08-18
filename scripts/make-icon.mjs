/**
 * Draws the app icon and splash from the game's own visual language.
 *
 * The icon is the single most-seen asset — store listing, home screen, task
 * switcher — so it is drawn with the same canvas code and palette as the board
 * rather than sourced from a pack. It has to survive being 48 pixels wide, so it
 * carries exactly three elements: the spark, the mirror that turns it, and the
 * node it lights.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const DRAW = `
function draw(ctx, S) {
  const u = S / 24;                       // one grid unit, so the art scales cleanly

  // Ground: the unlit board.
  const bg = ctx.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, '#0d181d');
  bg.addColorStop(1, '#05090b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);

  ctx.globalCompositeOperation = 'lighter';

  // The trail: in from the left, turning up at the mirror.
  const trail = ctx.createLinearGradient(0, 15 * u, 14 * u, 15 * u);
  trail.addColorStop(0, 'rgba(255,176,32,0)');
  trail.addColorStop(1, 'rgba(255,176,32,0.95)');
  ctx.strokeStyle = trail;
  ctx.lineWidth = 1.9 * u;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(2.5 * u, 15 * u);
  ctx.lineTo(14 * u, 15 * u);
  ctx.stroke();

  const up = ctx.createLinearGradient(14 * u, 15 * u, 14 * u, 7 * u);
  up.addColorStop(0, 'rgba(255,176,32,0.95)');
  up.addColorStop(1, 'rgba(255,240,200,0.95)');
  ctx.strokeStyle = up;
  ctx.beginPath();
  ctx.moveTo(14 * u, 15 * u);
  ctx.lineTo(14 * u, 8 * u);
  ctx.stroke();

  // The node it lights, glowing.
  const glow = ctx.createRadialGradient(14 * u, 7 * u, 0, 14 * u, 7 * u, 7 * u);
  glow.addColorStop(0, 'rgba(255,200,80,0.85)');
  glow.addColorStop(1, 'rgba(255,176,32,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(14 * u, 7 * u, 7 * u, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fff0c8';
  ctx.beginPath();
  ctx.arc(14 * u, 7 * u, 2.6 * u, 0, Math.PI * 2);
  ctx.fill();

  // The mirror: the one cool element, so the eye reads a cause and an effect.
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = '#dbe9ee';
  ctx.lineWidth = 1.7 * u;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(11.6 * u, 17.6 * u);
  ctx.lineTo(16.4 * u, 12.8 * u);
  ctx.stroke();
}
`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');

async function render(size, transparentBg = false) {
  return page.evaluate(
    ({ size, drawSrc, transparentBg }) => {
      const c = document.getElementById('c');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, size, size);
      eval(drawSrc);
      if (transparentBg) {
        // Adaptive foreground: draw art only, on transparency.
        ctx.clearRect(0, 0, size, size);
        ctx.save();
        ctx.translate(size * 0.16, size * 0.16);
        ctx.scale(0.68, 0.68);
        draw(ctx, size);
        ctx.restore();
      } else {
        draw(ctx, size);
      }
      return c.toDataURL('image/png');
    },
    { size, drawSrc: DRAW, transparentBg }
  );
}

mkdirSync('assets', { recursive: true });
const save = (name, dataUrl) =>
  writeFileSync(`assets/${name}`, Buffer.from(dataUrl.split(',')[1], 'base64'));

save('icon.png', await render(1024));
save('icon-foreground.png', await render(1024, true));
save('icon-background.png', await page.evaluate((size) => {
  const c = document.getElementById('c');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#0d181d');
  bg.addColorStop(1, '#05090b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  return c.toDataURL('image/png');
}, 1024));

// Splash: a flat ground with the mark centred.
//
// Deliberately no gradient. A full-bleed gradient dithers badly and pushed the
// splash set to 2.6 MB across densities — a quarter of the install size, for a
// screen that shows for a fraction of a second. A flat field compresses to
// almost nothing and looks identical at a glance.
save('splash.png', await page.evaluate(({ drawSrc }) => {
  const S = 1200;
  const c = document.getElementById('c');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#070b0d';
  ctx.fillRect(0, 0, S, S);
  eval(drawSrc);
  ctx.save();
  ctx.translate(S / 2 - 180, S / 2 - 180);
  draw(ctx, 360);
  ctx.restore();
  return c.toDataURL('image/png');
}, { drawSrc: DRAW }));

await browser.close();
console.log('wrote assets/icon.png, icon-foreground.png, icon-background.png, splash.png');
