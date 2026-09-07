import { createMaster } from './master.js';
import { createKeys, createLead, createBass, createLightKeys, createLightLead } from './instruments.js';
import { createDrumKit } from './drums.js';
import { STEPS_PER_BAR } from './groove.js';
import { isCycleStart } from './sections.js';
import { createComposition, renewMaterial, planBar, eventsForBar } from './compose.js';

// The live engine used to carry its own copy of the composition — its own
// regenerate, its own per-bar planning, its own fixed tempo and its own
// single set of instruments. That meant the two pages were different
// instruments wearing the same name, and every musical change had to be
// made twice or land on only one of them. They now share compose.js, so the
// live engine gets the palettes, modes, tempos, voices and drum feels that
// the rendered stream has.
const DEFAULT_BPM = 74;
const FFT_SIZE = 128;

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
    this.master = null;
    this.masterParts = null;
    this.reverbSend = null;
    this.toneFilter = null;
    this.scheduled = false;

    this.chords = [];
    this.key = null;
    this.motif = null;
    this.bar = 0;
    this.plan = null;
    // Replaced by the palette's tempo once one is chosen in build().
    this.bpm = DEFAULT_BPM;
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
    const master = createMaster(this.bypass, output, (this.palette && this.palette.level) || 0);
    this.masterParts = master;
    this.master = master.bus;
    this.reverbSend = master.send;
    this.toneFilter = master.tone;
    const light = this.bypass.has('light');
    // The palette is chosen before the graph is built, so its instruments
    // are the ones that get built.
    if (!this.state) {
      this.state = createComposition();
      this.palette = this.state.palette;
      this.key = this.state.key;
      this.chords = this.state.chords;
    }
    const voicing = (this.palette && this.palette.voices) || {};
    this.keys = light ? createLightKeys(this.master) : createKeys(this.master, this.reverbSend, this.bypass, 1, voicing.keys);
    this.lead = light ? createLightLead(this.master) : createLead(this.master, this.reverbSend, this.bypass, 1, voicing.lead);
    this.bass = createBass(this.master, voicing.bass);
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

    // The palette has to be chosen before the graph is built, because it
    // decides which instruments get built. Choosing it after — which is
    // what calling regenerate() below build() did — left the voices set up
    // for one identity while the music played at another's tempo, and the
    // bars then overlapped badly enough that Tone rejected them as going
    // backwards in time.
    if (!this.state) this.regenerate();
    this.build();
    if (Tone.getTransport().state === 'started') return;

    // Tone schedules from the main thread on a lookahead. The default 0.1s
    // leaves no room for a busy main thread, and a late schedule is heard as
    // a stutter or a click. This is a music player, so latency costs nothing.
    Tone.getContext().lookAhead = 0.3;

    Tone.getTransport().bpm.value = this.palette ? this.palette.bpm : DEFAULT_BPM;
    // Feel is applied per hit in groove.js, so the transport itself stays
    // straight — two swing sources fight each other.
    Tone.getTransport().swing = 0;

    if (!this.scheduled) {
      this.stepSeq.start(0);
      this.scheduled = true;
    }
    Tone.getTransport().start();
  }

  stop() {
    if (typeof Tone === 'undefined') return;
    Tone.getTransport().stop();
    Tone.getTransport().cancel();

    // Silence first, and immediately. When the page is hidden the engine
    // writes half a minute of music ahead of the playhead, so at the moment
    // stop is pressed that music is already committed to the voices at times
    // that have not arrived yet. releaseAll cannot reach a note that has not
    // attacked, and measured, stop left the output at 0.24 peak for the six
    // seconds after it.
    if (this.master) this.master.volume.value = -Infinity;
    if (this.keys) this.keys.releaseAll();
    if (this.lead) this.lead.releaseAll();
    if (this.bass) this.bass.triggerRelease();

    // Then tear the graph down, so the next play cannot inherit those notes.
    // Rebuilding costs a moment on a button press and is the only thing that
    // actually stops the sound.
    this._teardown();
    this.bar = 0;
    this.plan = null;
  }

  _teardown() {
    const parts = [this.stepSeq, this.keys, this.lead, this.bass, this.analyser, this.meter];
    if (this.drumKit) parts.push(...Object.values(this.drumKit));
    // The master chain last, so nothing is disconnected out from under a
    // voice mid-teardown.
    if (this.masterParts && this.masterParts.dispose) parts.push({ dispose: this.masterParts.dispose });
    for (const part of parts) {
      // Disposing a node twice throws, and a half-built graph can hold nulls.
      try {
        if (part && typeof part.dispose === 'function') part.dispose();
      } catch (_) { /* already gone */ }
    }
    this.stepSeq = null;
    this.keys = null;
    this.lead = null;
    this.bass = null;
    this.drumKit = null;
    this.analyser = null;
    this.meter = null;
    this.master = null;
    this.masterParts = null;
    this.reverbSend = null;
    this.toneFilter = null;
    // build() keys off this.keys, and the sequence has to be re-scheduled.
    this.scheduled = false;
  }

  // A different piece, which means a different palette, which means
  // different instruments — so this only takes effect once the graph is
  // rebuilt. The page stops and starts around it, which does that.
  regenerate() {
    this.state = createComposition();
    this.palette = this.state.palette;
    this.key = this.state.key;
    this.chords = this.state.chords;
    this.bar = 0;
    this.plan = null;
    if (typeof Tone !== 'undefined' && Tone.getTransport().state === 'started') {
      Tone.getTransport().bpm.value = this.palette.bpm;
    }
    return this.chords;
  }

  // New material, same place in the arrangement — used at a cycle boundary,
  // where resetting the bar counter would restart the intro instead. The
  // palette is kept: a stream that changed instrument and tempo every three
  // minutes would be a playlist, not a track.
  regenerateKeepingPosition() {
    renewMaterial(this.state);
    this.key = this.state.key;
    this.chords = this.state.chords;
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

  // Everything a bar plays is decided once, at its first step. The
  // decisions themselves live in compose.js, shared with the renderer.
  _planBar(time) {
    // A fresh key and progression at the top of each cycle: the stream is
    // endless, so it should not be the same eight bars endlessly.
    if (isCycleStart(this.bar)) this.regenerateKeepingPosition();

    const plan = planBar(this.state, this.bar);
    this.plan = plan;
    this.section = plan.section;
    this.key = this.state.key;
    this.chords = this.state.chords;

    // Open or close the master filter to match the section, around whatever
    // the palette already asked for. Ramped over most of a bar so it is a
    // change of light rather than a switch being thrown.
    if (this.toneFilter) {
      const cutoff = (1400 + plan.section.tone * 8100) * (this.palette ? this.palette.tone : 1);
      this.toneFilter.frequency.rampTo(Math.max(900, Math.min(12000, cutoff)), 2.4, time);
    }

    if (this.onChordChange) {
      // Scheduled against the bar's own time, not Tone.now(): the draw
      // timeline rejects times that don't advance, and now() sampled inside
      // a lookahead callback doesn't reliably.
      Tone.getDraw().schedule(() => this.onChordChange(plan.chord, this.key), time);
    }
  }

  // One bar, scheduled in one go.
  //
  // This used to trigger note by note as the sequence stepped, with its own
  // copy of the groove offsets, velocities and voice gating. eventsForBar
  // already does all of that for the renderer, so the live engine now asks
  // for the same events and simply plays them — which also means it gets
  // the section entry ramps it never had.
  _onStep(time, step) {
    if (step !== 0) return;
    this._planBar(time);
    this.bar++;
    if (!this.plan) return;

    const off = this.bypass;
    // From the transport, not from the palette. They are the same in normal
    // use, but deriving it from the palette meant that anything changing the
    // transport tempo — a test fast-forwarding, or a future tempo ramp —
    // spread a bar's events over a different length than the bar actually
    // lasted, so bars overlapped and Tone rejected the notes as going
    // backwards in time.
    const secondsPerBar = (60 / Tone.getTransport().bpm.value) * 4;
    const events = eventsForBar(this.plan, secondsPerBar);
    const targets = {
      kick: this.drumKit.kick, click: this.drumKit.click,
      snare: this.drumKit.snare, hat: this.drumKit.hat,
      keys: this.keys, bass: this.bass, lead: this.lead,
    };
    // ?bypass= names voices to silence; drums are named as a group.
    const silenced = (name) =>
      off.has(name) || (off.has('drums') && ['kick', 'click', 'snare', 'hat'].includes(name));

    for (const [name, list] of Object.entries(events)) {
      const voice = targets[name];
      if (!voice || silenced(name)) continue;
      for (const event of list) {
        const at = time + event.time;
        if (event.note) voice.triggerAttackRelease(event.note, event.duration, at, event.velocity);
        else voice.triggerAttackRelease(event.duration, at, event.velocity);
      }
    }
  }
}
