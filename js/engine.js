import { pickKey, pickProgression, buildChords } from './theory.js';
import { createPad, createBass } from './instruments.js';
import { createDrumKit, scheduleDrums } from './drums.js';

const BPM = 76;
const SWING = 0.58;
const CHORD_DURATION = '2m'; // one chord every 2 bars
const FFT_SIZE = 128;

export class LofiEngine {
  constructor() {
    this.pad = null;
    this.bass = null;
    this.drumKit = null;
    this.drumSeq = null;
    this.chordLoop = null;
    this.analyser = null;
    this.scheduled = false;
    this.chords = [];
    this.chordIndex = 0;
    this.key = null;
    this.progression = null;
    this.bpm = BPM;
    this.swing = SWING;
    this.onChordChange = null; // (chord, key, index) => void
  }

  // Builds the audio graph once; safe to call repeatedly.
  build() {
    if (this.pad) return;
    this.pad = createPad();
    this.bass = createBass();
    this.drumKit = createDrumKit();
    this.drumSeq = scheduleDrums(this.drumKit);
    this.chordLoop = new Tone.Loop((time) => this._playCurrentChord(time), CHORD_DURATION);
    this.analyser = new Tone.Analyser('fft', FFT_SIZE);
    Tone.getDestination().connect(this.analyser);
  }

  async start() {
    await Tone.start();
    if (Tone.getContext().state !== 'running') {
      throw new Error('the browser did not allow audio to start');
    }

    this.build();
    if (Tone.Transport.state === 'started') return;

    Tone.Transport.bpm.value = BPM;
    Tone.Transport.swing = SWING;
    Tone.Transport.swingSubdivision = '8n';

    this.regenerate();

    // Scheduled once for the life of the page: re-starting a sequence at the
    // same transport position throws. Transport.stop() rewinds to 0, so the
    // parts pick up from the top on the next start.
    if (!this.scheduled) {
      this.drumSeq.start(0);
      this.chordLoop.start(0);
      this.scheduled = true;
    }

    // The chord loop fires at position 0, so the first chord needs no
    // manual trigger — one here would stack a second voicing on top of it.
    Tone.Transport.start();
  }

  stop() {
    if (typeof Tone === 'undefined') return;
    Tone.Transport.stop();
    if (this.pad) this.pad.releaseAll();
    if (this.bass) this.bass.triggerRelease();
    this.chordIndex = 0;
  }

  // Picks a fresh key and progression. Takes effect from the next chord.
  regenerate() {
    this.key = pickKey();
    this.progression = pickProgression();
    this.chords = buildChords(this.key, this.progression);
    this.chordIndex = 0;
    return this.chords;
  }

  setVolume(percent) {
    Tone.getDestination().volume.value = percent === 0 ? -Infinity : -34 + (percent / 100) * 34;
  }

  getSpectrum() {
    return this.analyser ? this.analyser.getValue() : null;
  }

  get isPlaying() {
    return typeof Tone !== 'undefined' && Tone.Transport.state === 'started';
  }

  get currentChord() {
    return this.chords[this.chordIndex % this.chords.length] || null;
  }

  _playCurrentChord(time) {
    const chord = this.chords[this.chordIndex % this.chords.length];
    this.pad.triggerAttackRelease(chord.notes, CHORD_DURATION, time, 0.7);
    this.bass.triggerAttackRelease(chord.bass, CHORD_DURATION, time, 0.85);
    if (this.onChordChange) {
      const key = this.key;
      Tone.Draw.schedule(() => this.onChordChange(chord, key), time);
    }
    this.chordIndex++;
  }
}
