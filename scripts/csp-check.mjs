/**
 * Loads the built game in a clean Chromium and reports CSP violations.
 *
 * The developer machine has an antivirus that rewrites CSP meta tags in every
 * page it sees, which produces violations that have nothing to do with the app.
 * A browser launched by Playwright has no such extension.
 */
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });

const policy = await page.evaluate(() =>
  document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')
);
const fonts = await page.evaluate(async () => {
  await document.fonts.ready;
  return { loaded: document.fonts.size, chakra: document.fonts.check('16px "Chakra Petch"') };
});
const canvasPainted = await page.evaluate(() => {
  const c = document.getElementById('tut-canvas') || document.getElementById('preview-canvas');
  if (!c) return null;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 30 || d[i + 1] > 30 || d[i + 2] > 30) lit++;
  return { lit, pixels: d.length / 4 };
});

console.log('policy intact :', policy?.includes('kaspersky') ? 'NO — rewritten' : 'yes');
console.log('csp errors    :', errors.filter((e) => /Content.Security|Refused/i.test(e)).length);
console.log('other errors  :', errors.filter((e) => !/Content.Security|Refused|favicon/i.test(e)).length);
console.log('fonts loaded  :', fonts.loaded, '| Chakra Petch usable:', fonts.chakra);
console.log('canvas painted:', canvasPainted ? `${canvasPainted.lit} lit px` : 'no canvas');
if (errors.length) console.log('\nall errors:\n' + errors.map((e) => '  ' + e).join('\n'));

await browser.close();
