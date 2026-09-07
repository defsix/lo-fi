// The voices: comping keys, a sub bass, and a lead for the melody.
//
// The tonal voices take the master bus plus a send into the shared reverb.
// Nothing here owns a reverb of its own — see master.js for why that matters.

// A light build for devices whose audio backend cannot keep up. An FM voice
// is two oscillators and two envelopes; a plain one is a single oscillator,
// and measurably less than half the cost. It sounds thinner - the FM Rhodes
// is a lot of this music's character - so it is opt-in, never the default.
// Tone's PolySynth builds a voice the first time it needs one, and a timer
// disposes voices that have gone idle. For a fixed texture that settles; for
// an arrangement that thickens and thins it never does. Measured here, the
// keys pool cycles 12 -> 11 -> 10 -> 9 -> 12 every bar for the whole track,
// so an FM voice - two oscillators, two envelopes and their gains - is torn
// down and rebuilt on the main thread while the music plays. The scheduler
// lives on that thread, which is how it reaches the ear.
//
// A fixed pool costs nothing in exchange: idle voices have stopped
// oscillators, so the DSP is the same and only the churn goes. Measured at
// 8x CPU throttle it cut main-thread blocking from 125 to 91 ms per second,
// with no note dropped and no change to the sound.
//
// The collector runs on Tone's own context timer rather than the window's,
// so it takes context.clearInterval; window.clearInterval silently does
// nothing, which is how this looked like a dead end the first time.
function pinVoices(poly) {
  // Reaching into Tone's internals: if a future version moves them, leave
  // the synth alone and take the churn rather than throwing on load.
  if (typeof poly._getNextAvailableVoice !== 'function' || !Array.isArray(poly._availableVoices)) {
    return poly;
  }

  poly.context.clearInterval(poly._gcTimeout);
  poly._collectGarbage = () => {};

  // Claim every voice, then hand them all back, so the pool is built out to
  // maxPolyphony before a note is ever played.
  const held = [];
  for (let i = 0; i < poly.maxPolyphony; i++) {
    const voice = poly._getNextAvailableVoice();
    if (!voice) break;
    held.push(voice);
  }
  for (const voice of held) poly._availableVoices.push(voice);

  return poly;
}


// --- timbres -------------------------------------------------------------
//
// The palettes name voices — rhodes, celeste, vibes, pluck — and until now
// every one of them got the same FM Rhodes, so six identities shared one
// sound. That is the last place the sameness was living: mode, tempo and
// drums could all differ and the track still announced itself with the same
// instrument in the first bar.
//
// These are all FM, because FM is what this engine already renders quickly
// and what gives a struck-metal character cheaply. What separates them is
// where the modulator sits relative to the carrier (harmonicity), how hard
// it pushes (modulation index), and how the note decays.
//
//   rhodes    harmonicity 2, gentle index, long sustain — the electric
//             piano tine: a soft bell that holds.
//   celeste   harmonicity 3.01 and a fast-decaying modulator. The slight
//             detune from a whole number is what stops it ringing like a
//             pure bell and makes it read as a struck metal bar.
//   vibes     harmonicity 4, low index, very long decay, no sustain — the
//             note blooms and falls away rather than being held.
//   pluck     harmonicity 1, a short sharp modulation burst, quick decay —
//             a string sound rather than a struck one.
const TIMBRES = {
  rhodes: {
    harmonicity: 2,
    modulationIndex: 2.4,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.012, decay: 0.9, sustain: 0.28, release: 1.8 },
    modulationEnvelope: { attack: 0.008, decay: 0.35, sustain: 0.1, release: 0.8 },
    cutoff: 3200,
    volume: -13,
  },
  celeste: {
    harmonicity: 3.01,
    // Measured: at an index of 3.2 this was spectrally indistinguishable
    // from the Rhodes — 366Hz against 390Hz of spectral centroid. The
    // harmonicity places the sidebands but the index decides whether they
    // are loud enough to be a timbre or just arithmetic.
    modulationIndex: 7.5,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.004, decay: 1.4, sustain: 0.06, release: 1.6 },
    modulationEnvelope: { attack: 0.002, decay: 0.18, sustain: 0, release: 0.4 },
    cutoff: 4200,
    volume: -14,
  },
  vibes: {
    harmonicity: 4,
    // Same correction, more gently: a vibraphone is a purer sound than a
    // celeste, so it takes less, but 1.4 was not enough to be anything.
    modulationIndex: 4,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.006, decay: 2.2, sustain: 0.04, release: 2.4 },
    modulationEnvelope: { attack: 0.004, decay: 0.5, sustain: 0.02, release: 0.9 },
    cutoff: 3600,
    volume: -13,
  },
  pluck: {
    harmonicity: 1,
    modulationIndex: 4.5,
    oscillator: { type: 'triangle' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.003, decay: 0.55, sustain: 0.08, release: 0.7 },
    modulationEnvelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.2 },
    cutoff: 3000,
    volume: -12,
  },
};

function timbre(name) {
  return TIMBRES[name] || TIMBRES.rhodes;
}

export function createLightKeys(bus) {
  const filter = new Tone.Filter({ frequency: 3200, type: 'lowpass', rolloff: -12 }).connect(bus);
  const keys = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.012, decay: 0.9, sustain: 0.22, release: 1.4 },
  }).connect(filter);
  keys.volume.value = t.volume;
  keys.maxPolyphony = 8;
  // The build for devices that cannot keep up is the one that can least
  // afford to build voices mid-track.
  return pinVoices(keys);
}

export function createLightLead(bus) {
  const filter = new Tone.Filter({ frequency: 3800, type: 'lowpass', rolloff: -12 }).connect(bus);
  const lead = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.014, decay: 0.5, sustain: 0.18, release: 0.9 },
  }).connect(filter);
  lead.volume.value = -14;
  lead.maxPolyphony = 4;
  return pinVoices(lead);
}

// `toneScale` is how bright this voice is, 1 being as written.
//
// It moves the modulation index, not the filter, and that took three
// measurements to establish. Warmth was first applied to the master filter
// at 9.5kHz: no effect, because this music has almost nothing up there.
// Then to this voice's own low-pass at 3.2kHz: still no effect — measured
// on an isolated chord, moving the cutoff from 1.6kHz to 6.4kHz changed the
// energy above 1kHz from 12.34% to 12.06%, and in the wrong direction.
//
// The reason is that a filter can only remove. An FM voice with a sine
// carrier and a modulation index of 2.4 has few sidebands to begin with, so
// there is nothing above 1.6kHz for a filter to either keep or cut. The
// index is what *creates* them, so it is the only real brightness control
// this voice has. The filter still moves, a little, to follow.
export function createKeys(bus, reverbSend, bypass = new Set(), toneScale = 1, voice = 'rhodes', detune = 0) {
  const t = timbre(voice);
  const filter = new Tone.Filter({
    frequency: t.cutoff * Math.pow(toneScale, 0.5),
    type: 'lowpass',
    rolloff: -24,
  }).connect(bus);
  const chorus = bypass.has('chorus')
    ? filter
    : new Tone.Chorus({ frequency: 0.6, delayTime: 4, depth: 0.4, wet: 0.3 }).connect(filter).start();
  const tremolo = bypass.has('tremolo')
    ? chorus
    : new Tone.Tremolo({ frequency: 2.4, depth: 0.18, wet: 0.25 }).connect(chorus).start();

  const keys = new Tone.PolySynth(Tone.FMSynth, {
    // Concert pitch, in cents. Zero is A=440; a sleep palette asks for
    // A=432, which is -31.8 cents across every voice at once.
    detune,
    harmonicity: t.harmonicity,
    modulationIndex: t.modulationIndex * toneScale,
    oscillator: t.oscillator,
    modulation: t.modulation,
    envelope: t.envelope,
    modulationEnvelope: t.modulationEnvelope,
  }).connect(tremolo);
  // Measured above 250Hz — the band the ear judges balance in — the keys
  // were taking 25% of the mix against the lead's ~0%: not merely loud, but
  // burying the melody they are supposed to sit under. Raw power share says
  // the opposite (5%), because it is dominated by the kick and bass and is
  // no guide to what sits forward.
  keys.volume.value = t.volume;
  // Two comping hits a bar of four notes each, with a 1.8s release, needs
  // about a dozen voices. Twenty-four was DSP kept alive for nothing.
  keys.maxPolyphony = 12;

  const send = new Tone.Gain(0.3).connect(reverbSend);
  keys.connect(send);

  return pinVoices(keys);
}

export function createLead(bus, reverbSend, bypass = new Set(), toneScale = 1, voice = 'rhodes', detune = 0) {
  const t = timbre(voice);
  const filter = new Tone.Filter({
    // The lead sits a little brighter than the comping of the same timbre,
    // so the line reads above the chords rather than inside them.
    frequency: t.cutoff * 1.15 * Math.pow(toneScale, 0.5),
    type: 'lowpass',
    rolloff: -12,
  }).connect(bus);
  const delay = bypass.has('delay')
    ? filter
    : new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.24, wet: 0.2 }).connect(filter);

  const lead = new Tone.PolySynth(Tone.FMSynth, {
    detune,
    harmonicity: t.harmonicity,
    modulationIndex: t.modulationIndex * 0.8 * toneScale,
    oscillator: t.oscillator,
    modulation: t.modulation,
    // Shorter than the comping voice of the same timbre: a melody note that
    // hangs as long as a chord note blurs into the chord.
    envelope: { ...t.envelope, decay: t.envelope.decay * 0.6, release: t.envelope.release * 0.65 },
    modulationEnvelope: t.modulationEnvelope,
  }).connect(delay);
  // Up a little as the keys come down, so the motif is heard as the line it
  // is rather than as something happening behind the chords.
  lead.volume.value = t.volume + 2;
  lead.maxPolyphony = 6;

  const send = new Tone.Gain(0.34).connect(reverbSend);
  lead.connect(send);

  return pinVoices(lead);
}

// `voice` picks the bass character. An upright is not a different waveform
// so much as a different attack: a finger pulling a thick string takes a
// moment to speak and the note dies rather than being held, where a synth
// bass arrives instantly and sits. That difference is most of what makes a
// track sound played rather than programmed.
const BASSES = {
  // The original: even, sustained, sits under everything without comment.
  synth: {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.35 },
    filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.4, release: 0.3, baseFrequency: 160, octaves: 1.6 },
    cutoff: 700,
    volume: -14,
  },
  upright: {
    // Slower to speak, and it decays instead of holding — the note is a
    // pluck with a body behind it, not a tone being sustained. Measured,
    // the first attempt died at almost exactly the same rate as the synth
    // bass (0.90s against 0.96s to a tenth), which is not a different
    // instrument. The sustain has to be genuinely low for the note to fall
    // away rather than be held at a slightly quieter level.
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.045, decay: 0.42, sustain: 0.05, release: 0.32 },
    // A wider filter sweep on the attack is the woody thump of the string
    // against the fingerboard before the note settles.
    filterEnvelope: { attack: 0.012, decay: 0.34, sustain: 0.16, release: 0.4, baseFrequency: 120, octaves: 2.4 },
    cutoff: 620,
    volume: -13,
  },
};

export function createBass(bus, voice = 'synth', detune = 0) {
  // A pure sine puts all of its energy on the fundamental: it dominates the
  // power spectrum while staying quiet to the ear, and vanishes entirely on
  // a phone speaker that can't reproduce 65Hz. A triangle keeps the weight
  // but carries enough harmonics to be heard as a note, not just felt.
  const b = BASSES[voice] || BASSES.synth;
  const filter = new Tone.Filter({ frequency: b.cutoff, type: 'lowpass', rolloff: -12 }).connect(bus);

  const bass = new Tone.MonoSynth({
    detune,
    oscillator: b.oscillator,
    envelope: b.envelope,
    filterEnvelope: b.filterEnvelope,
  }).connect(filter);
  bass.volume.value = b.volume;

  return bass;
}
