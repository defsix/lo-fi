// Measures the spectral balance of the master bus.
//
// Needed because the engine can't be judged by reading it, and defects like
// an empty frequency band or a filter fighting another filter are invisible
// until measured. Requires playwright and a server on :8080 serving the repo
// root:  python3 -m http.server 8080
//
// Run: node tools/analyse-spectrum.mjs

import pkg from 'playwright';
const { chromium } = pkg;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8080/live.html', { waitUntil: 'domcontentloaded' });
await page.click('#play');
await page.waitForTimeout(600);

await page.evaluate(() => {
  const engine = window.__engine;
  const fft = new Tone.Analyser('fft', 2048);
  const wave = new Tone.Analyser('waveform', 4096);
  engine.master.connect(fft);
  engine.master.connect(wave);

  window.__sampleRate = Tone.getContext().sampleRate;
  window.__bins = new Float32Array(fft.size).fill(0);
  window.__count = 0;
  window.__peak = 0;
  window.__rmsSamples = [];

  window.__timer = setInterval(() => {
    const spec = fft.getValue();
    for (let i = 0; i < spec.length; i++) {
      // dB -> linear power, averaged, so quiet frames don't dominate the mean
      window.__bins[i] += Math.pow(10, spec[i] / 10);
    }
    window.__count++;

    const buf = wave.getValue();
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i]);
      if (v > window.__peak) window.__peak = v;
      sum += buf[i] * buf[i];
    }
    window.__rmsSamples.push(Math.sqrt(sum / buf.length));
  }, 120);
});

// One key per run isn't representative — the spectrum shifts with register.
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(12000);
  await page.evaluate(() => window.__engine.regenerate());
}

const data = await page.evaluate(() => {
  clearInterval(window.__timer);
  return {
    bins: Array.from(window.__bins),
    count: window.__count,
    sampleRate: window.__sampleRate,
    peak: window.__peak,
    rms: window.__rmsSamples,
  };
});
await browser.close();

const binHz = data.sampleRate / 2 / data.bins.length;
const BANDS = [
  [20, 60, 'sub'],
  [60, 120, 'bass'],
  [120, 250, 'low mid'],
  [250, 500, 'mid'],
  [500, 1000, 'upper mid'],
  [1000, 2000, 'presence'],
  [2000, 4000, 'brightness'],
  [4000, 8000, 'air'],
  [8000, 16000, 'top'],
];

let total = 0;
const bandPower = BANDS.map(([lo, hi, name]) => {
  let power = 0;
  for (let i = 0; i < data.bins.length; i++) {
    const f = i * binHz;
    if (f >= lo && f < hi) power += data.bins[i] / data.count;
  }
  total += power;
  return { name, lo, hi, power };
});

console.log(`sample rate ${data.sampleRate} | ${data.count} frames over 60s\n`);
const loudest = Math.max(...bandPower.map((b) => b.power));
console.log('band            range        share      dB vs loudest band');
for (const b of bandPower) {
  const share = (b.power / total) * 100;
  const rel = 10 * Math.log10(b.power / loudest);
  const bar = '#'.repeat(Math.max(0, Math.round((rel + 60) / 1.5)));
  console.log(
    `${b.name.padEnd(12)} ${String(b.lo).padStart(5)}-${String(b.hi).padEnd(6)} ${share.toFixed(2).padStart(6)}%  ${rel.toFixed(1).padStart(6)} dB  ${bar}`
  );
}

// A phone or tablet speaker reproduces almost nothing below ~400Hz, so the
// full-range balance above is not the mix its listener gets. This is the
// same energy restricted to what such a speaker can actually radiate.
const small = bandPower.filter((b) => b.lo >= 250);
const smallTotal = small.reduce((sum, b) => sum + b.power, 0);
console.log('\nAS HEARD ON A SMALL SPEAKER (nothing below 250Hz survives)');
for (const b of small) {
  const share = (b.power / smallTotal) * 100;
  console.log(`  ${b.name.padEnd(12)} ${String(b.lo).padStart(5)}-${String(b.hi).padEnd(6)} ${share.toFixed(1).padStart(5)}%  ${'#'.repeat(Math.round(share / 1.5))}`);
}

const rms = data.rms.filter((v) => v > 0);
rms.sort((a, b) => a - b);
const medianRms = rms[Math.floor(rms.length / 2)];
const p10 = rms[Math.floor(rms.length * 0.1)];
const p90 = rms[Math.floor(rms.length * 0.9)];
const db = (v) => (20 * Math.log10(v)).toFixed(1);

console.log(`\npeak            ${db(data.peak)} dBFS`);
console.log(`median RMS      ${db(medianRms)} dBFS`);
console.log(`quiet / loud    ${db(p10)} / ${db(p90)} dBFS  (dynamic swing ${(db(p90) - db(p10)).toFixed(1)} dB)`);
console.log(`crest factor    ${(20 * Math.log10(data.peak / medianRms)).toFixed(1)} dB`);
