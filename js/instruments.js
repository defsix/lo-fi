// The voices: comping keys, a sub bass, and a lead for the melody.
//
// The tonal voices take the master bus plus a send into the shared reverb.
// Nothing here owns a reverb of its own — see master.js for why that matters.

export function createKeys(bus, reverbSend) {
  const filter = new Tone.Filter({ frequency: 3200, type: 'lowpass', rolloff: -24 }).connect(bus);
  const chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 4, depth: 0.4, wet: 0.3 }).connect(filter).start();
  const tremolo = new Tone.Tremolo({ frequency: 2.4, depth: 0.18, wet: 0.25 }).connect(chorus).start();

  const keys = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 2,
    modulationIndex: 2.4,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.012, decay: 0.9, sustain: 0.28, release: 1.8 },
    modulationEnvelope: { attack: 0.008, decay: 0.35, sustain: 0.1, release: 0.8 },
  }).connect(tremolo);
  keys.volume.value = -10;
  // Two comping hits a bar of four notes each, with a 1.8s release, needs
  // about a dozen voices. Twenty-four was DSP kept alive for nothing.
  keys.maxPolyphony = 12;

  const send = new Tone.Gain(0.3).connect(reverbSend);
  keys.connect(send);

  return keys;
}

export function createLead(bus, reverbSend) {
  const filter = new Tone.Filter({ frequency: 3800, type: 'lowpass', rolloff: -12 }).connect(bus);
  const delay = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.24, wet: 0.2 }).connect(filter);

  const lead = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3,
    modulationIndex: 1.8,
    oscillator: { type: 'triangle' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.014, decay: 0.5, sustain: 0.2, release: 1.1 },
    modulationEnvelope: { attack: 0.01, decay: 0.25, sustain: 0.05, release: 0.6 },
  }).connect(delay);
  lead.volume.value = -12;
  lead.maxPolyphony = 6;

  const send = new Tone.Gain(0.34).connect(reverbSend);
  lead.connect(send);

  return lead;
}

export function createBass(bus) {
  // A pure sine puts all of its energy on the fundamental: it dominates the
  // power spectrum while staying quiet to the ear, and vanishes entirely on
  // a phone speaker that can't reproduce 65Hz. A triangle keeps the weight
  // but carries enough harmonics to be heard as a note, not just felt.
  const filter = new Tone.Filter({ frequency: 700, type: 'lowpass', rolloff: -12 }).connect(bus);

  const bass = new Tone.MonoSynth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.35 },
    filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.4, release: 0.3, baseFrequency: 160, octaves: 1.6 },
  }).connect(filter);
  bass.volume.value = -14;

  return bass;
}
