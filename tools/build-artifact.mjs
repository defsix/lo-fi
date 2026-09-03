// Bundles the engine into a single self-contained HTML page.
//
// The hosted listening page can't fetch anything — no CDN, no module
// imports — so Tone.js and the engine modules are inlined into one file.
// Run: node tools/build-artifact.mjs [outfile]

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = resolve(root, process.argv[2] || 'dist/engine-room.html');

// Dependency order matters: concatenated modules share one scope.
const MODULES = ['js/theory.js', 'js/master.js', 'js/instruments.js', 'js/drums.js', 'js/engine.js'];

// main.js drives the repo's own test page and has no place in the bundle;
// everything else under js/ is engine code and must be listed above, or the
// page fails at runtime with a missing function.
const PAGE_ENTRY = 'main.js';
const missing = readdirSync(resolve(root, 'js'))
  .filter((f) => f.endsWith('.js') && f !== PAGE_ENTRY)
  .map((f) => `js/${f}`)
  .filter((f) => !MODULES.includes(f));

if (missing.length) throw new Error(`these engine modules are not in the bundle: ${missing.join(', ')}`);

function stripModuleSyntax(source, file) {
  const withoutImports = source.replace(/^import[\s\S]*?from\s+'[^']+';\s*$/gm, '');
  const withoutExports = withoutImports.replace(/^export\s+/gm, '');
  return `// ---- ${file} ${'-'.repeat(Math.max(0, 62 - file.length))}\n${withoutImports === source ? withoutExports : withoutExports.trimStart()}`;
}

const tone = readFileSync(resolve(root, 'vendor/tone.js'), 'utf8');
const engine = MODULES.map((file) => stripModuleSyntax(readFileSync(resolve(root, file), 'utf8'), file)).join('\n');
const template = readFileSync(resolve(root, 'tools/artifact-template.html'), 'utf8');

for (const [placeholder, label] of [['/*__TONE__*/', 'TONE'], ['/*__ENGINE__*/', 'ENGINE']]) {
  if (!template.includes(placeholder)) throw new Error(`template is missing the ${label} placeholder`);
}

// A literal </script> in the inlined source would close the tag early.
for (const [source, label] of [[tone, 'vendor/tone.js'], [engine, 'engine modules']]) {
  if (/<\/script/i.test(source)) throw new Error(`${label} contains a </script> sequence and cannot be inlined as-is`);
}

const html = template.replace('/*__TONE__*/', () => tone).replace('/*__ENGINE__*/', () => engine);

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html, 'utf8');

console.log(`built ${outFile} — ${(html.length / 1024).toFixed(0)} KB (tone ${(tone.length / 1024).toFixed(0)} KB, engine ${(engine.length / 1024).toFixed(0)} KB)`);
