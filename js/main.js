import { LofiEngine } from './engine.js';

const engine = new LofiEngine();

const startBtn = document.getElementById('start-btn');
const statusEl = document.getElementById('status');
const keyEl = document.getElementById('key-info');
const chordEl = document.getElementById('chord-info');

engine.onChordChange = (chord, key) => {
  keyEl.textContent = key;
  chordEl.textContent = `${chord.root} ${chord.quality}`;
};

startBtn.addEventListener('click', async () => {
  if (engine.isPlaying) {
    engine.stop();
    startBtn.textContent = 'start';
    statusEl.textContent = 'stopped';
  } else {
    startBtn.disabled = true;
    await engine.start();
    startBtn.disabled = false;
    startBtn.textContent = 'stop';
    statusEl.textContent = 'generating…';
  }
});
