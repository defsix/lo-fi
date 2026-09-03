// Measures the groove: where every note lands against the grid.
//
// Needed because the engine can't be judged by reading it, and defects like
// an empty frequency band or a filter fighting another filter are invisible
// until measured. Requires playwright and a server on :8080 serving the repo
// root:  python3 -m http.server 8080
//
// Run: node tools/analyse-timing.mjs

import pkg from 'playwright';
const { chromium } = pkg;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:8080/index.html', { waitUntil: 'domcontentloaded' });
await page.click('#play');
await page.waitForTimeout(400);

await page.evaluate(() => {
  window.__events = [];
  const engine = window.__engine;

  // Tag each note with the step it was scheduled from, and the step's own
  // grid time, so offsets can be measured exactly rather than inferred.
  const originalStep = engine._onStep.bind(engine);
  engine._onStep = (time, step) => {
    window.__step = step;
    window.__stepTime = time;
    return originalStep(time, step);
  };

  const tap = (obj, voice) => {
    const original = obj.triggerAttackRelease.bind(obj);
    obj.triggerAttackRelease = (...args) => {
      const hasNote = typeof args[0] === 'string' && /^[A-G]/.test(args[0]);
      const time = hasNote ? args[2] : args[1];
      const velocity = hasNote ? args[3] : args[2];
      window.__events.push({
        voice,
        step: window.__step,
        offsetMs: (time - window.__stepTime) * 1000,
        note: hasNote ? args[0] : null,
        velocity,
        bar: engine.bar,
      });
      return original(...args);
    };
  };
  tap(engine.keys, 'keys');
  tap(engine.lead, 'lead');
  tap(engine.bass, 'bass');
  tap(engine.drumKit.kick, 'kick');
  tap(engine.drumKit.snare, 'snare');
  tap(engine.drumKit.hat, 'hat');
});

await page.waitForTimeout(32000);
const { events, bpm } = await page.evaluate(() => ({ events: window.__events, bpm: window.Tone.Transport.bpm.value }));
await browser.close();

const bar = (60 / bpm) * 4;
const bars = 32 / bar;
console.log(`bpm ${bpm.toFixed(0)} | ${events.length} notes over ~${bars.toFixed(0)} bars\n`);

const byVoice = {};
for (const e of events) (byVoice[e.voice] ||= []).push(e);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

console.log('voice    per bar   offset on downbeats   offset on off-16ths');
for (const [voice, list] of Object.entries(byVoice)) {
  const down = list.filter((e) => e.step % 4 === 0).map((e) => e.offsetMs);
  const off = list.filter((e) => e.step % 2 === 1).map((e) => e.offsetMs);
  const fmt = (xs) => (xs.length ? `${median(xs) >= 0 ? '+' : ''}${median(xs).toFixed(0)}ms` : '-');
  console.log(
    `${voice.padEnd(8)} ${(list.length / bars).toFixed(1).padStart(6)}   ${fmt(down).padStart(18)}   ${fmt(off).padStart(17)}`
  );
}

// The backbeat specifically: snare on steps 4 and 12 should sit behind.
const backbeat = (byVoice.snare || []).filter((e) => e.step === 4 || e.step === 12).map((e) => e.offsetMs);
const ghosts = (byVoice.snare || []).filter((e) => e.step !== 4 && e.step !== 12);
console.log(`\nbackbeat lag: +${median(backbeat).toFixed(0)}ms over ${backbeat.length} hits`);
console.log(`ghost notes: ${ghosts.length} (${(ghosts.length / bars).toFixed(1)} per bar)`);

const leadNotes = (byVoice.lead || []).map((e) => e.note);
const leadBars = new Set((byVoice.lead || []).map((e) => e.bar));
console.log(`\nmelody: ${leadNotes.length} notes, ${new Set(leadNotes).size} distinct pitches, in ${leadBars.size} of ${Math.round(bars)} bars`);
console.log('  ', leadNotes.slice(0, 20).join(' '));

for (const voice of ['hat', 'snare', 'keys', 'lead']) {
  const vs = (byVoice[voice] || []).map((e) => e.velocity).filter((v) => typeof v === 'number');
  if (vs.length) console.log(`velocity ${voice.padEnd(6)} ${Math.min(...vs).toFixed(2)} - ${Math.max(...vs).toFixed(2)}`);
}

console.log('\nerrors:', errors.length ? errors : 'none');
