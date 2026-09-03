import { LofiEngine } from './engine.js';
import { chordLabel, romanLabel } from './theory.js';

const engine = new LofiEngine();

const startBtn = document.getElementById('start-btn');
const statusEl = document.getElementById('status');
const keyEl = document.getElementById('key-info');
const chordEl = document.getElementById('chord-info');

engine.onChordChange = (chord, key) => {
  keyEl.textContent = key;
  chordEl.textContent = chordLabel(chord);
};

startBtn.addEventListener('click', async () => {
  if (engine.isPlaying) {
    engine.stop();
    startBtn.textContent = 'start';
    statusEl.textContent = 'stopped';
    return;
  }

  startBtn.disabled = true;
  try {
    await engine.start();
    startBtn.textContent = 'stop';
    statusEl.textContent = engine.chords.map(romanLabel).join(' - ');
  } catch (err) {
    statusEl.textContent = err.message;
  } finally {
    startBtn.disabled = false;
  }
});
