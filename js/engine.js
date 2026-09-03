import { pickKey, pickProgression, buildChords } from './theory.js';
import { createPad, createBass } from './instruments.js';
import { createDrumKit, scheduleDrums } from './drums.js';

const BPM = 76;
const SWING = 0.58;
const CHORD_DURATION = '2m'; // one chord every 2 bars

export class LofiEngine {
  constructor() {
    this.pad = null;
    this.bass = null;
    this.drumKit = null;
    this.drumSeq = null;
    this.chordLoop = null;
    this.chords = [];
    this.chordIndex = 0;
    this.key = null;
    this.onChordChange = null; // (chord, key, index) => void
  }

  async start() {
    await Tone.start();
    if (Tone.Transport.state === 'started') return;

    this.pad = this.pad || createPad();
    this.bass = this.bass || createBass();
    this.drumKit = this.drumKit || createDrumKit();
    this.drumSeq = this.drumSeq || scheduleDrums(this.drumKit);
    this.chordLoop = this.chordLoop || new Tone.Loop((time) => this._playCurrentChord(time), CHORD_DURATION);

    Tone.Transport.bpm.value = BPM;
    Tone.Transport.swing = SWING;
    Tone.Transport.swingSubdivision = '8n';

    this.key = pickKey();
    this.progression = pickProgression();
    this.chords = buildChords(this.key, this.progression);
    this.chordIndex = 0;

    this.drumSeq.start(0);
    this.chordLoop.start(0);
    Tone.Transport.start();
    this._playCurrentChord(Tone.now());
  }

  stop() {
    Tone.Transport.stop();
    if (this.drumSeq) this.drumSeq.stop(0);
    if (this.chordLoop) this.chordLoop.stop(0);
    this.chordIndex = 0;
  }

  get isPlaying() {
    return Tone.Transport.state === 'started';
  }

  _playCurrentChord(time) {
    const chord = this.chords[this.chordIndex % this.chords.length];
    this.pad.triggerAttackRelease(chord.notes, CHORD_DURATION, time, 0.7);
    this.bass.triggerAttackRelease(chord.bass, CHORD_DURATION, time, 0.85);
    if (this.onChordChange) this.onChordChange(chord, this.key, this.chordIndex);
    this.chordIndex++;
  }
}
