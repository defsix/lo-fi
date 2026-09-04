// Bundles index.html into a single self-contained page.
//
// The hosted listening page can't fetch anything — no CDN, no module
// imports — so Tone.js and every engine module are inlined, and the
// document wrapper is dropped because the artifact host supplies its own.
// Run: node tools/build-artifact.mjs [outfile]

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = resolve(root, process.argv[2] || 'dist/engine-room.html');

// Dependency order matters: concatenated modules share one scope.
const MODULES = [
  'js/voicing.js',
  'js/theory.js',
  'js/groove.js',
  'js/melody.js',
  'js/arrange.js',
  'js/sections.js',
  'js/master.js',
  'js/capture.js',
  'js/instruments.js',
  'js/drums.js',
  'js/engine.js',
];
const PAGE = 'js/page.js';

// Every module under js/ is engine code and must be listed above, or the
// bundle fails at runtime with a missing function.
const missing = readdirSync(resolve(root, 'js'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => `js/${f}`)
  .filter((f) => f !== PAGE && !MODULES.includes(f));

if (missing.length) throw new Error(`these engine modules are not in the bundle: ${missing.join(', ')}`);

function read(file) {
  return readFileSync(resolve(root, file), 'utf8');
}

function stripModuleSyntax(source, file) {
  const body = source.replace(/^import[\s\S]*?from\s+'[^']+';\s*$/gm, '').replace(/^export\s+/gm, '');
  return `// ---- ${file} ${'-'.repeat(Math.max(0, 60 - file.length))}\n${body.trim()}\n`;
}

const tone = read('vendor/tone.js');
const bundle = [...MODULES, PAGE].map((file) => stripModuleSyntax(read(file), file)).join('\n');

// A literal </script> in inlined source would close the tag early.
for (const [source, label] of [[tone, 'vendor/tone.js'], [bundle, 'engine modules']]) {
  if (/<\/script/i.test(source)) throw new Error(`${label} contains a </script> sequence and cannot be inlined as-is`);
}

const TONE_TAG = '<script src="vendor/tone.js"></script>';
const PAGE_TAG = '<script type="module" src="js/page.js"></script>';

let html = read('index.html');
for (const [tag, label] of [[TONE_TAG, 'Tone'], [PAGE_TAG, 'page']]) {
  if (!html.includes(tag)) throw new Error(`index.html no longer has the ${label} script tag the bundler replaces`);
}

html = html
  // The artifact host provides doctype, head and body itself.
  .replace(/^<!doctype html>\s*/i, '')
  .replace(/<\/?(?:html|head|body)(?:\s[^>]*)?>\s*/gi, '')
  .replace(/<meta\s+(?:charset|name="viewport")[^>]*>\s*/gi, '')
  .replace(TONE_TAG, () => `<script>\n${tone}\n</script>`)
  .replace(PAGE_TAG, () => `<script>\n${bundle}\n</script>`);

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html, 'utf8');

console.log(
  `built ${outFile} — ${(html.length / 1024).toFixed(0)} KB ` +
    `(tone ${(tone.length / 1024).toFixed(0)} KB, engine + page ${(bundle.length / 1024).toFixed(0)} KB)`
);
