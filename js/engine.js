import { pickKey, pickProgression, buildChords } from './theory.js';
import { createMaster } from './master.js';
import { createKeys, createLead, createBass, createLightKeys, createLightLead } from './instruments.js';
import { createDrumKit, drumsForBar } from './drums.js';
import { compForBar, bassForBar } from './arrange.js';
import { makeMotif, realiseMotif } from './melody.js';
import { STEPS_PER_BAR, grooveOffset, accent } from './groove.js';

const BPM = 74;
const FFT_SIZE = 128;
const BARS_PER_PHRASE = 4;

export class LofiEngine {
  // `options.bypass` names effects to leave out and `options.latencyHint`
  // overrides the buffer size hint, so a fault that only appears in one
  // browser can be bisected without a rebuild.
  constructor(options = {}) {
    this.bypass = new Set(options.bypass || []);
    // Null means: leave the browser's own default alone. See start().
    this.latencyHint = options.latencyHint || null;
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
    const master = createMaster(this.bypass);
    this.master = master.bus;
    this.reverbSend = master.send;
    const light = this.bypass.has('light');
    this.keys = light ? createLightKeys(this.master) : createKeys(this.master, this.reverbSend, this.bypass);
    this.lead = light ? createLightLead(this.master) : createLead(this.master, this.reverbSend, this.bypass);
    this.bass = createBass(this.master);
    this.drumKit = createDrumKit(this.master);

    // ?bypass=meters removes the analysers, which are polled from the main
    // thread every frame for the visualiser.
    if (!this.bypass.has('meters')) {
      this.analyser = new Tone.Analyser('fft', FFT_SIZE);
      this.meter = new Tone.Analyser('waveform', 512);
      this.master.connect(this.analyser);
      this.master.connect(this.meter);
    }

    // One sequence drives everything on a sixteenth grid. Each voice takes
    // its own offset from the groove template rather than sitting on the
    // grid line, which is where the feel comes from.
    const steps = Array.from({ length: STEPS_PER_BAR }, (_, i) => i);
    this.stepSeq = new Tone.Sequence((time, step) => this._onStep(time, step), steps, '16n');
  }

  async start() {
    // The context's latency hint is left to the browser unless asked for
    // explicitly. Forcing 'playback' here once looked sensible - a stream
    // does not need an instrument's small buffer - but measured against the
    // current graph it changes the late-note rate by less than the variance
    // between runs, so it buys nothing. It is not free, either: it is the
    // one setting that reconfigures the browser's output stream, and Firefox
    // was rendering a clean graph while its live output crackled. Anything
    // that costs nothing and is the prime suspect should go.
    if (!this.contextConfigured && this.latencyHint) {
      Tone.setContext(new Tone.Context({ latencyHint: this.latencyHint }));
      this.contextConfigured = true;
    }

    await Tone.start();
    if (Tone.getContext().state !== 'running') {
      throw new Error('the browser did not allow audio to start');
    }

    this.build();
    if (Tone.getTransport().state === 'started') return;

    // Tone schedules from the main thread on a lookahead. The default 0.1s
    // leaves no room for a busy main thread, and a late schedule is heard as
    // a stutter or a click. This is a music player, so latency costs nothing.
    Tone.getContext().lookAhead = 0.3;

    Tone.getTransport().bpm.value = BPM;
    // Feel is applied per hit in groove.js, so the transport itself stays
    // straight — two swing sources fight each other.
    Tone.getTransport().swing = 0;

    this.regenerate();

    if (!this.scheduled) {
      this.stepSeq.start(0);
      this.scheduled = true;
    }
    Tone.getTransport().start();
  }

  stop() {
    if (typeof Tone === 'undefined') return;
    Tone.getTransport().stop();
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
    // A squared taper, so the slider tracks perceived loudness rather than
    // dB. The offset reclaims headroom: trimming the voices to fix the
    // spectrum left the master peaking around -17 dBFS, which is inaudibly
    // quiet on a laptop, with the limiter never even engaging.
    this.master.volume.value = percent <= 0 ? -60 : 20 * Math.log10(Math.pow(percent / 100, 2)) + 6;
  }

  getSpectrum() {
    return this.analyser ? this.analyser.getValue() : null;
  }

  // null, not 0, when there is no meter: 0 would read as silence and trip
  // the watchdog into reporting a fault that isn't there.
  getLevel() {
    if (!this.meter) return null;
    const buf = this.meter.getValue();
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  getContextState() {
    return typeof Tone === 'undefined' ? 'no-tone' : Tone.getContext().state;
  }

  get isPlaying() {
    return typeof Tone !== 'undefined' && Tone.getTransport().state === 'started';
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
      Tone.getDraw().schedule(() => this.onChordChange(chord, this.key), time);
    }
  }

  _onStep(time, step) {
    if (step === 0) {
      this._planBar(time);
      this.bar++;
    }
    if (!this.plan) return;

    const { chord, comp, bass, melody, drums } = this.plan;
    const off = this.bypass;

    // --- drums
    if (!off.has('drums') && drums.kick.includes(step)) {
      const at = time + grooveOffset(step, 'kick');
      const velocity = 0.85 + Math.random() * 0.12;
      this.drumKit.kick.triggerAttackRelease('A1', '8n', at, velocity);
      this.drumKit.click.triggerAttackRelease('32n', at, velocity * 0.6);
    }
    if (!off.has('drums') && (drums.snare.includes(step) || drums.fill.includes(step))) {
      this.drumKit.snare.triggerAttackRelease('16n', time + grooveOffset(step, 'snare'), 0.62 + Math.random() * 0.14);
    }
    // A ghost and a backbeat hit on the same step would schedule two notes
    // on one voice out of order, since the ghost sits earlier in the groove
    // than the snare — Tone rejects the second as going back in time.
    const struck = drums.snare.includes(step) || drums.fill.includes(step);
    if (!off.has('drums') && !struck && drums.ghosts.includes(step)) {
      this.drumKit.snare.triggerAttackRelease('32n', time + grooveOffset(step, 'ghost'), 0.12 + Math.random() * 0.08);
    }
    if (!off.has('drums') && drums.hats.includes(step)) {
      this.drumKit.hat.triggerAttackRelease('32n', time + grooveOffset(step, 'hat'), accent(step) * (0.5 + Math.random() * 0.16));
    }

    // --- chords, rolled rather than struck as a block
    for (const hit of off.has('keys') ? [] : comp) {
      if (hit.step !== step) continue;
      const at = time + grooveOffset(step, 'keys');
      hit.notes.forEach((note, i) => {
        this.keys.triggerAttackRelease(note, hit.duration, at + i * hit.roll, hit.velocity);
      });
    }

    // --- bass
    for (const hit of off.has('bass') ? [] : bass) {
      if (hit.step !== step) continue;
      this.bass.triggerAttackRelease(hit.note, hit.duration, time + grooveOffset(step, 'bass'), hit.velocity);
    }

    // --- melody
    for (const note of off.has('lead') ? [] : melody) {
      if (note.step !== step) continue;
      this.lead.triggerAttackRelease(note.note, note.duration, time + grooveOffset(step, 'lead'), note.velocity);
    }

    void chord;
  }
}
