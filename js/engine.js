import { pickKey, pickProgression, buildChords } from './theory.js';
import { createMaster } from './master.js';
import { createKeys, createLead, createBass } from './instruments.js';
import { createDrumKit, drumsForBar } from './drums.js';
import { compForBar, bassForBar } from './arrange.js';
import { makeMotif, realiseMotif } from './melody.js';
import { STEPS_PER_BAR, grooveOffset, accent } from './groove.js';

const BPM = 74;
const FFT_SIZE = 128;
const BARS_PER_PHRASE = 4;

export class LofiEngine {
  constructor() {
    this.master = null;
    this.keys = null;
    this.lead = null;
    this.bass = null;
    this.drumKit = null;
    this.stepSeq = null;
    this.analyser = null;
    this.meter = null;
    this.scheduled = false;

    this.chords = [];
    this.key = null;
    this.motif = null;
    this.bar = 0;
    this.plan = null;
    this.bpm = BPM;
    this.onChordChange = null; // (chord, key) => void
  }

  build() {
    if (this.keys) return;
    this.master = createMaster();
    this.keys = createKeys(this.master);
    this.lead = createLead(this.master);
    this.bass = createBass(this.master);
    this.drumKit = createDrumKit(this.master);

    this.analyser = new Tone.Analyser('fft', FFT_SIZE);
    this.meter = new Tone.Analyser('waveform', 512);
    this.master.connect(this.analyser);
    this.master.connect(this.meter);

    // One sequence drives everything on a sixteenth grid. Each voice takes
    // its own offset from the groove template rather than sitting on the
    // grid line, which is where the feel comes from.
    const steps = Array.from({ length: STEPS_PER_BAR }, (_, i) => i);
    this.stepSeq = new Tone.Sequence((time, step) => this._onStep(time, step), steps, '16n');
  }

  async start() {
    await Tone.start();
    if (Tone.getContext().state !== 'running') {
      throw new Error('the browser did not allow audio to start');
    }

    this.build();
    if (Tone.Transport.state === 'started') return;

    Tone.Transport.bpm.value = BPM;
    // Feel is applied per hit in groove.js, so the transport itself stays
    // straight — two swing sources fight each other.
    Tone.Transport.swing = 0;

    this.regenerate();

    if (!this.scheduled) {
      this.stepSeq.start(0);
      this.scheduled = true;
    }
    Tone.Transport.start();
  }

  stop() {
    if (typeof Tone === 'undefined') return;
    Tone.Transport.stop();
    if (this.keys) this.keys.releaseAll();
    if (this.lead) this.lead.releaseAll();
    if (this.bass) this.bass.triggerRelease();
    this.bar = 0;
    this.plan = null;
  }

  regenerate() {
    this.key = pickKey();
    this.chords = buildChords(this.key, pickProgression());
    this.motif = makeMotif();
    this.bar = 0;
    this.plan = null;
    return this.chords;
  }

  setVolume(percent) {
    if (!this.master) return;
    this.master.volume.value = percent <= 0 ? -60 : -34 + (percent / 100) * 32;
  }

  getSpectrum() {
    return this.analyser ? this.analyser.getValue() : null;
  }

  getLevel() {
    if (!this.meter) return 0;
    const buf = this.meter.getValue();
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  getContextState() {
    return typeof Tone === 'undefined' ? 'no-tone' : Tone.getContext().state;
  }

  get isPlaying() {
    return typeof Tone !== 'undefined' && Tone.Transport.state === 'started';
  }

  get currentChord() {
    return this.chords[this.bar % this.chords.length] || null;
  }

  // Everything a bar plays is decided once, at its first step.
  _planBar(time) {
    // A new motif every other phrase: enough repetition to feel composed,
    // enough change that eight bars in it hasn't become wallpaper.
    if (this.bar > 0 && this.bar % (BARS_PER_PHRASE * 2) === 0 && Math.random() < 0.7) {
      this.motif = makeMotif();
    }

    const index = this.bar % this.chords.length;
    const chord = this.chords[index];
    const nextChord = this.chords[(index + 1) % this.chords.length];
    const barInPhrase = this.bar % BARS_PER_PHRASE;

    this.plan = {
      chord,
      // Thinning the comping on the second half of the phrase keeps eight
      // bars from landing as the same bar four times.
      comp: compForBar(chord, barInPhrase !== 2, Math.random),
      bass: bassForBar(chord, nextChord, Math.random),
      melody: realiseMotif(this.motif, chord, this.key, barInPhrase, Math.random),
      drums: drumsForBar(barInPhrase, Math.random),
    };

    if (this.onChordChange) {
      // Scheduled against the bar's own time, not Tone.now(): the draw
      // timeline rejects times that don't advance, and now() sampled inside
      // a lookahead callback doesn't reliably.
      Tone.Draw.schedule(() => this.onChordChange(chord, this.key), time);
    }
  }

  _onStep(time, step) {
    if (step === 0) {
      this._planBar(time);
      this.bar++;
    }
    if (!this.plan) return;

    const { chord, comp, bass, melody, drums } = this.plan;

    // --- drums
    if (drums.kick.includes(step)) {
      this.drumKit.kick.triggerAttackRelease('C1', '8n', time + grooveOffset(step, 'kick'), 0.85 + Math.random() * 0.12);
    }
    if (drums.snare.includes(step) || drums.fill.includes(step)) {
      this.drumKit.snare.triggerAttackRelease('16n', time + grooveOffset(step, 'snare'), 0.62 + Math.random() * 0.14);
    }
    if (drums.ghosts.includes(step)) {
      this.drumKit.snare.triggerAttackRelease('32n', time + grooveOffset(step, 'ghost'), 0.12 + Math.random() * 0.08);
    }
    if (drums.hats.includes(step)) {
      this.drumKit.hat.triggerAttackRelease('32n', time + grooveOffset(step, 'hat'), accent(step) * (0.5 + Math.random() * 0.16));
    }

    // --- chords, rolled rather than struck as a block
    for (const hit of comp) {
      if (hit.step !== step) continue;
      const at = time + grooveOffset(step, 'keys');
      hit.notes.forEach((note, i) => {
        this.keys.triggerAttackRelease(note, hit.duration, at + i * hit.roll, hit.velocity);
      });
    }

    // --- bass
    for (const hit of bass) {
      if (hit.step !== step) continue;
      this.bass.triggerAttackRelease(hit.note, hit.duration, time + grooveOffset(step, 'bass'), hit.velocity);
    }

    // --- melody
    for (const note of melody) {
      if (note.step !== step) continue;
      this.lead.triggerAttackRelease(note.note, note.duration, time + grooveOffset(step, 'lead'), note.velocity);
    }

    void chord;
  }
}
