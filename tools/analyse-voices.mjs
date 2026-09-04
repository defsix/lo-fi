import pkg from 'playwright';
const { chromium } = pkg;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8080/live.html', { waitUntil: 'domcontentloaded' });
await page.click('#play');
await page.waitForTimeout(1200);

await page.evaluate(() => {
  const engine = window.__engine;
  window.__voices = {
    keys: engine.keys,
    lead: engine.lead,
    bass: engine.bass,
    kick: engine.drumKit.kick,
    snare: engine.drumKit.snare,
    hat: engine.drumKit.hat,
  };
  window.__levels = {};
  for (const [name, v] of Object.entries(window.__voices)) window.__levels[name] = v.volume.value;

  window.__probe = new Tone.Analyser('fft', 1024);
  Tone.getDestination().connect(window.__probe);

  window.__solo = (only) => {
    for (const [name, v] of Object.entries(window.__voices)) {
      v.volume.value = only === null || name === only ? window.__levels[name] : -Infinity;
    }
  };

  window.__capture = (ms) =>
    new Promise((resolve) => {
      const bins = new Float32Array(window.__probe.size).fill(0);
      let n = 0;
      const t = setInterval(() => {
        const s = window.__probe.getValue();
        for (let i = 0; i < s.length; i++) bins[i] += Math.pow(10, s[i] / 10);
        n++;
      }, 40);
      setTimeout(() => {
        clearInterval(t);
        resolve({ bins: Array.from(bins, (b) => b / n), rate: Tone.getContext().sampleRate });
      }, ms);
    });
});

const results = [];
for (const voice of ['keys', 'lead', 'bass']) {
  await page.evaluate((v) => window.__solo(v), voice);
  const data = await page.evaluate((ms) => window.__capture(ms), 9000);
  results.push({ voice, ...data });
}
await page.evaluate(() => window.__solo(null));
await browser.close();

// Spectral flatness: geometric mean over arithmetic mean. Near 1 = noise,
// near 0 = a tone. This is what separates "static" from "a note".
function flatness(bins) {
  let logSum = 0;
  let sum = 0;
  let n = 0;
  for (const b of bins) {
    const v = Math.max(b, 1e-20);
    logSum += Math.log(v);
    sum += v;
    n++;
  }
  return Math.exp(logSum / n) / (sum / n);
}

console.log('voice     low-band power   share of its own    noisiness down low');
console.log('          (20-250Hz)       energy that is low  (1.0 = pure static)');
for (const r of results) {
  const binHz = r.rate / 2 / r.bins.length;
  const low = [];
  let lowPower = 0;
  let allPower = 0;
  r.bins.forEach((p, i) => {
    const f = i * binHz;
    allPower += p;
    if (f >= 20 && f < 250) {
      lowPower += p;
      low.push(p);
    }
  });
  const share = (lowPower / allPower) * 100;
  console.log(
    `${r.voice.padEnd(9)} ${(10 * Math.log10(lowPower)).toFixed(1).padStart(8)} dB  ${share.toFixed(1).padStart(14)}%  ${flatness(low).toFixed(3).padStart(18)}`
  );
}
