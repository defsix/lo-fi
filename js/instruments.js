// The voices: comping keys, a sub bass, and a lead for the melody.

export function createKeys(bus) {
  const filter = new Tone.Filter({ frequency: 3200, type: 'lowpass', rolloff: -24 }).connect(bus);
  const chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 4, depth: 0.4, wet: 0.3 }).connect(filter).start();
  const tremolo = new Tone.Tremolo({ frequency: 2.4, depth: 0.18, wet: 0.25 }).connect(chorus).start();
  const reverb = new Tone.Reverb({ decay: 4, wet: 0.28 }).connect(tremolo);

  const keys = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 2,
    modulationIndex: 2.4,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.012, decay: 0.9, sustain: 0.28, release: 1.8 },
    modulationEnvelope: { attack: 0.008, decay: 0.35, sustain: 0.1, release: 0.8 },
  }).connect(reverb);
  keys.volume.value = -11;
  keys.maxPolyphony = 24;

  return keys;
}

export function createLead(bus) {
  const filter = new Tone.Filter({ frequency: 3800, type: 'lowpass', rolloff: -12 }).connect(bus);
  const delay = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.28, wet: 0.22 }).connect(filter);
  const reverb = new Tone.Reverb({ decay: 3, wet: 0.3 }).connect(delay);

  const lead = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3,
    modulationIndex: 1.8,
    oscillator: { type: 'triangle' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.014, decay: 0.5, sustain: 0.2, release: 1.1 },
    modulationEnvelope: { attack: 0.01, decay: 0.25, sustain: 0.05, release: 0.6 },
  }).connect(reverb);
  lead.volume.value = -14;
  lead.maxPolyphony = 8;

  return lead;
}

export function createBass(bus) {
  const filter = new Tone.Filter({ frequency: 420, type: 'lowpass', rolloff: -12 }).connect(bus);

  const bass = new Tone.MonoSynth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.35 },
    filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.4, release: 0.3, baseFrequency: 160, octaves: 1.6 },
  }).connect(filter);
  bass.volume.value = -12;

  return bass;
}
