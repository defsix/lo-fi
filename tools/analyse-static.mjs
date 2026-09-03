import pkg from 'playwright';
const { chromium } = pkg;

const throttle = Number(process.argv[2] || 1);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

if (throttle > 1) {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: throttle });
}

await page.goto('http://localhost:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.click('#play');
await page.waitForTimeout(1000);

await page.evaluate(() => {
  const engine = window.__engine;

  // Post-limiter: what actually reaches the speakers.
  const post = new Tone.Analyser('waveform', 2048);
  Tone.getDestination().connect(post);

  window.__stats = {
    frames: 0,
    // A glitch is a discontinuity *inside* one contiguous snapshot: the
    // waveform jumping between neighbouring samples. Distortion is smooth.
    jumps: 0,
    biggestJump: 0,
    clipped: 0,
    samples: 0,
    prePeak: 0,
    postPeak: 0,
    preRms: [],
    postRms: [],
  };

  window.__timer = setInterval(() => {
    const s = window.__stats;
    const buf = post.getValue();
    const pre = engine.meter.getValue();

    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i];
      const a = Math.abs(v);
      if (a > s.postPeak) s.postPeak = a;
      if (a > 0.98) s.clipped++;
      sum += v * v;
      if (i > 0) {
        const jump = Math.abs(v - buf[i - 1]);
        if (jump > s.biggestJump) s.biggestJump = jump;
        // 0.25 between adjacent samples is a step no oscillator makes at
        // these frequencies; it is a discontinuity.
        if (jump > 0.25) s.jumps++;
      }
      s.samples++;
    }
    s.postRms.push(Math.sqrt(sum / buf.length));

    let preSum = 0;
    for (let i = 0; i < pre.length; i++) {
      const a = Math.abs(pre[i]);
      if (a > s.prePeak) s.prePeak = a;
      preSum += pre[i] * pre[i];
    }
    s.preRms.push(Math.sqrt(preSum / pre.length));
    s.frames++;
  }, 30);
});

await page.waitForTimeout(30000);
const s = await page.evaluate(() => {
  clearInterval(window.__timer);
  return window.__stats;
});
await browser.close();

const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
const med = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};

console.log(`CPU throttle ${throttle}x | ${s.frames} snapshots, ${s.samples} samples\n`);

console.log('IS IT GLITCHING?');
console.log(`  discontinuities:   ${s.jumps}  (${((s.jumps / s.samples) * 100).toFixed(4)}% of samples)`);
console.log(`  biggest jump:      ${s.biggestJump.toFixed(3)}  (1.0 = full scale in one sample)`);

console.log('\nIS IT DISTORTING?');
console.log(`  peak before limiter: ${db(s.prePeak)} dBFS`);
console.log(`  peak after limiter:  ${db(s.postPeak)} dBFS`);
console.log(`  median RMS before:   ${db(med(s.preRms))} dBFS`);
console.log(`  median RMS after:    ${db(med(s.postRms))} dBFS`);
console.log(`  limiter is pulling:  ${(Number(db(s.prePeak)) - Number(db(s.postPeak))).toFixed(1)} dB off the peaks`);
console.log(`  samples at/over FS:  ${s.clipped}  (${((s.clipped / s.samples) * 100).toFixed(4)}%)`);
console.log(`  crest factor after:  ${(Number(db(s.postPeak)) - Number(db(med(s.postRms)))).toFixed(1)} dB`);
