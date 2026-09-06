// Renders the site icons from js/artwork.js, so the favicon, the home-screen
// icon and the lock-screen artwork are the same drawing rather than three.
//
// Needs Playwright, because the artwork is canvas code and resolves its
// colours through getComputedStyle. Run when the artwork changes:
//   node tools/make-icons.mjs

import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The house palette: the amber the brand has always used. Deliberately not
// one of the track identities — the site keeps one face, the tracks vary.
const SITE = { name: 'site', hue: 60, chroma: 0.1 };
const SIZES = [512, 192, 32];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };
const server = createServer((req, res) => {
  const path = resolve(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html');
  if (!path.startsWith(root) || !existsSync(path)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
  res.end(readFileSync(path));
});
await new Promise((done) => server.listen(0, done));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
// The mark is set in Space Mono; give the webfont a moment to arrive.
await page.waitForTimeout(1200);

for (const size of SIZES) {
  const dataUrl = await page.evaluate(
    async ({ size, palette }) => {
      const { paletteArtwork } = await import('./js/artwork.js');
      return paletteArtwork(palette, size, 'image/png');
    },
    { size, palette: SITE }
  );
  const file = `icon-${size}.png`;
  writeFileSync(resolve(root, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`wrote ${file}`);
}

await browser.close();
server.close();
