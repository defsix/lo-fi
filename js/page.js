import { LofiEngine } from './engine.js';
import { chordLabel, romanLabel } from './theory.js';
import { capture } from './capture.js';
import { createBackgroundKeepAlive } from './background.js';

// ---- visualiser ---------------------------------------------------------
const params = new URLSearchParams(location.search);
const engine = new LofiEngine({
  // ?light is shorthand for the cheapest graph that still plays the music.
  bypass: [
    ...(params.get('bypass') || '').split(',').filter(Boolean),
    ...(params.has('light') ? ['light', 'chorus', 'tremolo', 'delay'] : []),
  ],
  latencyHint: params.get('latency') || undefined,
  // ?stream routes the mix through an <audio> element, which is the only
  // form of playback Chrome will keep alive with the screen off.
  useStream: params.has('stream'),
});
window.__engine = engine; // exposed for timing analysis in tests
const canvas = document.getElementById('scope-live');
const ctx = canvas.getContext('2d');
const BIN_COUNT = 64;
const smoothed = new Array(BIN_COUNT).fill(0);
let cssWidth = 0;
let cssHeight = 0;

// A phone reports a device pixel ratio around 2.3, which means a canvas with
// 5.3x the pixels to fill on the machine least able to afford it — and this
// is sixty-four soft bars, not text. Measured on a Pixel, removing the
// visualiser was the difference between crackling and playing, so its cost
// is not theoretical. Capped at 1: the bars look the same.
const MAX_DPR = 1;

function sizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const rect = canvas.getBoundingClientRect();
  cssWidth = rect.width;
  cssHeight = rect.height;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Read once, not per frame: getComputedStyle forces a style resolution, and
// at 60fps that competes with the note scheduling on the same thread.
// Read from an element that uses --accent: the custom property itself comes
// back as its unresolved declaration, calc() and all.
let AMBER = '#e3a24d';
function refreshAccent() {
  const probe = document.querySelector('.brand');
  if (probe) {
    const resolved = getComputedStyle(probe).color;
    if (resolved) AMBER = resolved;
  }
}
refreshAccent();

// The visualiser is decoration; the audio is not. Twenty frames a second is
// still smooth for bars that are already heavily smoothed, and it leaves the
// main thread — where notes are scheduled — that much freer.
const FRAME_MS = 1000 / 20;
let lastFrame = 0;
let scopeRunning = false;

function drawScope(now) {
  // Only while playing. This loop used to start at page load and run for the
  // life of the tab, drawing a flat line at full rate over a silent engine.
  if (!scopeRunning) return;
  requestAnimationFrame(drawScope);
  if (now - lastFrame < FRAME_MS) return;
  lastFrame = now;

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  const mid = cssHeight / 2;
  const barWidth = 3;
  const gap = (cssWidth - BIN_COUNT * barWidth) / (BIN_COUNT - 1);
  const values = engine.getSpectrum();
  ctx.fillStyle = AMBER;

  // FFT bins are linear in frequency and music is not: with 64 linear bins
  // over 22kHz, everything this engine produces lands in the first handful
  // and the rest of the width is a flat line of dots. Each bar now covers a
  // logarithmic slice and takes the loudest bin in it, which is how a
  // spectrum is read.
  // And only over the range this music occupies. The analyser's bins run to
  // the Nyquist limit, around 22kHz, while nothing here reaches much past
  // 6 — so spreading all of them across the width left two thirds of it as
  // a flat line of dots reporting silence accurately and uselessly.
  const binsAvailable = values ? values.length : BIN_COUNT;
  const highest = Math.min(binsAvailable, Math.ceil(binsAvailable * 0.34));
  const lowest = 1;
  const ratio = Math.pow(highest / lowest, 1 / BIN_COUNT);

  for (let i = 0; i < BIN_COUNT; i++) {
    let level = 0;
    if (values) {
      const from = Math.floor(lowest * Math.pow(ratio, i));
      const to = Math.max(from + 1, Math.floor(lowest * Math.pow(ratio, i + 1)));
      let loudest = -Infinity;
      for (let bin = from; bin < to && bin < highest; bin++) {
        if (values[bin] > loudest) loudest = values[bin];
      }
      // fft values arrive in dB: -100 is silence, 0 is full scale
      level = Math.max(0, Math.min(1, (loudest + 90) / 75));
    }
    const taper = Math.pow(Math.sin((i / (BIN_COUNT - 1)) * Math.PI), 0.6);
    smoothed[i] += (level * taper - smoothed[i]) * 0.22;

    const half = Math.max(1, smoothed[i] * (cssHeight / 2 - 6));
    const x = i * (barWidth + gap);
    ctx.globalAlpha = 0.35 + smoothed[i] * 0.6;
    ctx.fillRect(x, mid - half, barWidth, half * 2);
  }
  ctx.globalAlpha = 1;
}

const scopeEnabled = !(params.get('bypass') || '').includes('visual');

function startScope() {
  if (!scopeEnabled || scopeRunning) return;
  scopeRunning = true;
  requestAnimationFrame(drawScope);
}

function stopScope() {
  scopeRunning = false;
  // Leave the panel empty rather than frozen mid-bar.
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  smoothed.fill(0);
}

// ---- theme --------------------------------------------------------------
//
// The same colour system as the front page, driven by the same palettes, so
// the two pages are one product rather than an engine and its diagnostic.

function applyColour(palette) {
  if (!palette || palette.hue === undefined) return;
  document.documentElement.style.setProperty('--hue', String(palette.hue));
  document.documentElement.style.setProperty('--chroma', String(palette.chroma));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const probe = getComputedStyle(document.body).backgroundColor;
    if (probe) meta.setAttribute('content', probe);
  }
  // The scope reads --accent through an element, since the custom property
  // itself comes back with its calc() unresolved.
  setTimeout(refreshAccent, 2600);
  refreshAccent();
}

const MODE_KEY = '076lofi:mode';
function setMode(mode) {
  document.documentElement.dataset.mode = mode;
  try { localStorage.setItem(MODE_KEY, mode); } catch (_) { /* private window */ }
}
(function initMode() {
  let saved = null;
  try { saved = localStorage.getItem(MODE_KEY); } catch (_) { /* private window */ }
  if (saved === 'day' || saved === 'night') return setMode(saved);
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  setMode(prefersLight ? 'day' : 'night');
})();

// ---- controls -----------------------------------------------------------
const playBtn = document.getElementById('play');
const playIcon = document.getElementById('play-icon');
const regenBtn = document.getElementById('regen');
const volumeInput = document.getElementById('volume');
const statusEl = document.getElementById('status');
const keyEl = document.getElementById('key');
const progressionEl = document.getElementById('progression');
const chordEl = document.getElementById('chord');
const sectionEl = document.getElementById('section');

const PLAY_PATH = '<path d="M8 5v14l12-7z" fill="currentColor"></path>';
const PAUSE_PATH = '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"></rect><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"></rect>';

function setStatus(text, kind) {
  statusEl.textContent = text;
  if (kind) statusEl.setAttribute('data-tone', kind);
  else statusEl.removeAttribute('data-tone');
}

function setPlayingUI(playing) {
  playIcon.innerHTML = playing ? PAUSE_PATH : PLAY_PATH;
  playIcon.style.marginLeft = playing ? '0' : '3px';
  playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function showPalette() {
  const palette = engine.palette;
  const name = document.getElementById('palette');
  const feel = document.getElementById('feel');
  if (!palette || !name) return;
  name.textContent = palette.name;
  name.dataset.idle = engine.isPlaying ? 'false' : 'true';
  if (feel) feel.textContent = palette.mode + ' \u00b7 ' + Math.round(palette.bpm) + ' bpm \u00b7 live';
  applyColour(palette);
}

function showMix() {
  keyEl.textContent = engine.key + ' major';
  progressionEl.textContent = engine.chords.map(romanLabel).join(' - ');
  chordEl.textContent = chordLabel(engine.chords[0]);
}

engine.onChordChange = (chord) => {
  chordEl.textContent = chordLabel(chord);
  if (engine.section) sectionEl.textContent = engine.section.name;
};

// The arrangement takes a new key at the top of each cycle, so the readout
// has to follow it rather than being set once at the start.
engine.onMixChange = () => { showMix(); showPalette(); };

// Screen-off on Android suspends us unless the platform thinks we are a
// media player. See background.js.
const keepAlive = createBackgroundKeepAlive({
  onPlay: () => { if (!engine.isPlaying) play(); },
  onStop: () => { if (engine.isPlaying) stop(); },
  bypass: new Set((params.get('bypass') || '').split(',').filter(Boolean)),
  // ?horizon= seconds of scheduling to keep ahead while hidden.
  hiddenLookAhead: params.get('horizon'),
});

async function play() {
  playBtn.disabled = true;
  try {
    await engine.start();
    keepAlive.start(engine.streamDestination ? engine.streamDestination.stream : null);
    startScope();
    engine.setVolume(Number(volumeInput.value));
    showMix();
    showPalette();
    setStatus('generating - chords, bass and drums written live in your browser');
    setPlayingUI(true);
  } catch (err) {
    setStatus('audio could not start: ' + (err && err.message ? err.message : String(err)), 'error');
  } finally {
    playBtn.disabled = false;
  }
}

function stop() {
  engine.stop();
  keepAlive.stop();
  stopScope();
  setPlayingUI(false);
  setStatus('stopped');
}

const modeBtn = document.getElementById('mode');
if (modeBtn) {
  modeBtn.addEventListener('click', () => {
    setMode(document.documentElement.dataset.mode === 'day' ? 'night' : 'day');
    applyColour(engine.palette);
  });
}

playBtn.addEventListener('click', () => (engine.isPlaying ? stop() : play()));

regenBtn.addEventListener('click', async () => {
  if (engine.isPlaying) stop();
  await play();
});

volumeInput.addEventListener('input', () => {
  if (engine.isPlaying) engine.setVolume(Number(volumeInput.value));
});

// The engine can be producing sound the browser never passes to a speaker.
// The meter reads the bus directly, so a live number here with no audio in
// the room means the page is fine and the output path is not.
let silentTicks = 0;

setInterval(() => {
  if (!engine.isPlaying) {
    sectionEl.textContent = '-';
    silentTicks = 0;
    return;
  }

  const level = engine.getLevel();
  const state = engine.getContextState();

  // Under ?debug, show what the device actually granted, so a request for
  // more buffering can be confirmed rather than assumed.
  if (params.has('debug') && window.Tone) {
    const c = Tone.getContext().rawContext;
    const ms = (v) => (typeof v === 'number' ? (v * 1000).toFixed(1) + 'ms' : 'n/a');
    setStatus(`${c.sampleRate}Hz · output latency ${ms(c.outputLatency)} · base ${ms(c.baseLatency)} · requested ${engine.latencyHint === null ? 'browser default' : engine.latencyHint}`);
  }

  if (level === null) return;

  if (engine.section) sectionEl.textContent = engine.section.name;

  if (state !== 'running') {
    setStatus('the browser suspended audio (' + state + ') - press play to resume', 'error');
    return;
  }

  if (level < 0.0005) {
    silentTicks++;
    if (silentTicks === 6) {
      setStatus('the engine is running but its output is silent - this is the audio graph, not your speakers', 'error');
    }
  } else if (silentTicks) {
    silentTicks = 0;
    setStatus('generating - chords, bass and drums written live in your browser');
  }
}, 500);

// Diagnostics, off unless asked for: open the page with ?debug to get a
// button that saves the engine's own output as a WAV. A phone recording of a
// speaker measures the phone; this measures the engine.
if (new URLSearchParams(location.search).has('debug')) {
  const button = document.createElement('button');
  button.className = 'regen';
  button.textContent = 'capture 20s';
  button.addEventListener('click', async () => {
    if (!engine.isPlaying) {
      setStatus('press play first - there is nothing to capture', 'error');
      return;
    }
    button.disabled = true;
    const blob = await capture(engine.master, 20, (done) => {
      button.textContent = `capturing ${Math.round(done * 100)}%`;
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '076-lofi-capture.webm';
    link.click();
    URL.revokeObjectURL(url);
    button.textContent = 'capture 20s';
    button.disabled = false;
    setStatus('captured - that file is the engine output, with no microphone in it');
  });
  document.querySelector('.transport').appendChild(button);
}

window.addEventListener('resize', sizeCanvas);
sizeCanvas();
setPlayingUI(false);

// ?bypass=visual stops the canvas entirely. It polls an analyser every frame
// on the same thread that schedules the notes.

