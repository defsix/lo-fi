import { pickKey, pickProgression, buildChords } from './theory.js';
import { createMaster } from './master.js';
import { createKeys, createLead, createBass, createLightKeys, createLightLead } from './instruments.js';
import { createDrumKit, drumsForBar } from './drums.js';
import { compForBar, bassForBar } from './arrange.js';
import { makeMotif, realiseMotif } from './melody.js';
import { STEPS_PER_BAR, grooveOffset, accent } from './groove.js';
import { sectionAt, isCycleStart } from './sections.js';

const BPM = 74;
const FFT_SIZE = 128;
const BARS_PER_PHRASE = 4;

export class LofiEngine {
  // `options.bypass` names effects to leave out and `options.latencyHint`
  // overrides the buffer size hint, so a fault that only appears in one
  // browser can be bisected without a rebuild.
  constructor(options = {}) {
    this.bypass = new Set(options.bypass || []);
    // A number is seconds of requested buffering; a string is one of the
    // browser's own categories. Default 'playback' — see start() for why.
    // Pass ?latency=interactive to get the browser default back.
    const hint = options.latencyHint;
    this.latencyHint = hint == null || hint === '' ? 'playback' : (Number.isNaN(Number(hint)) ? hint : Number(hint));
    // Opt-in until it is shown to be clean on a real device: it moves the
    // whole mix onto a different output path.
    this.useStream = !!options.useStream;
    this.streamDestination = null;
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
    // Routing the mix through a MediaStream so it can be played by an
    // <audio> element: Chrome grants no media notification, and no
    // background playback, to audio that comes straight from Web Audio.
    let output = null;
    if (this.useStream) {
      const raw = Tone.getContext().rawContext;
      if (typeof raw.createMediaStreamDestination === 'function') {
        this.streamDestination = raw.createMediaStreamDestination();
        output = this.streamDestination;
      }
    }
    const master = createMaster(this.bypass, output);
    this.master = master.bus;
    this.reverbSend = master.send;
    this.toneFilter = master.tone;
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
    // Ask for a playback-sized buffer. The browser's default is
    // 'interactive' - the smallest latency it can manage without glitching -
    // which is the right setting for an instrument you play and the wrong
    // one for a stream nobody is playing. Measured in Chrome it is the
    // difference between a 441-sample buffer and a 1024-sample one: 2.3x
    // more time for the audio thread to render each block, for 13ms more
    // before sound starts, which nothing here can perceive.
    //
    // This was rejected once on the grounds that it did not move the
    // late-note rate. That was the wrong instrument: late notes measure the
    // main thread, and buffer size protects the audio thread, so the test
    // could not have seen the effect either way. Web Audio's own
    // implementers are explicit that a larger render quantum is what lets a
    // bigger graph render in time.
    //
    // ?latency=interactive restores the old behaviour for comparison.
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

  // New material, same place in the arrangement — used at a cycle boundary,
  // where resetting the bar counter would restart the intro instead.
  regenerateKeepingPosition() {
    this.key = pickKey();
    this.chords = buildChords(this.key, pickProgression());
    this.motif = makeMotif();
    if (this.onMixChange) this.onMixChange();
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

    // A fresh key and progression at the top of each cycle: the stream is
    // endless, so it should not be the same eight bars endlessly.
    if (isCycleStart(this.bar)) this.regenerateKeepingPosition();

    const section = sectionAt(this.bar);
    this.section = section;

    const index = this.bar % this.chords.length;
    const chord = this.chords[index];
    const nextChord = this.chords[(index + 1) % this.chords.length];
    const barInPhrase = this.bar % BARS_PER_PHRASE;

    // Open or close the master filter to match the section. Ramped over most
    // of a bar so it is a change of light rather than a switch being thrown.
    if (this.toneFilter) {
      const cutoff = 1400 + section.tone * 8100;
      this.toneFilter.frequency.rampTo(cutoff, 2.4, time);
    }

    this.plan = {
      chord,
      section,
      // Thinning the comping on the second half of the phrase keeps eight
      // bars from landing as the same bar four times.
      comp: section.voices.keys ? compForBar(chord, barInPhrase !== 2 && section.density > 0.7, Math.random) : [],
      bass: section.voices.bass ? bassForBar(chord, nextChord, Math.random) : [],
      // The melody sits out sparse sections entirely, and thins in the rest.
      melody:
        section.voices.lead && Math.random() < section.density
          ? realiseMotif(this.motif, chord, this.key, barInPhrase, Math.random)
          : [],
      drums: section.voices.drums
        ? drumsForBar(section.isLastBar ? 3 : barInPhrase, Math.random)
        : { kick: [], snare: [], ghosts: [], hats: [], fill: [] },
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
