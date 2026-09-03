// Two voices: a soft FM "Rhodes"-style pad for the chords, and a
// sine-based sub bass that follows the chord roots. Both land on the
// master bus rather than the destination directly.

export function createPad(bus) {
  const filter = new Tone.Filter({ frequency: 2200, type: 'lowpass', rolloff: -24 }).connect(bus);
  const chorus = new Tone.Chorus({ frequency: 0.8, delayTime: 3.5, depth: 0.5, wet: 0.35 }).connect(filter).start();
  const tremolo = new Tone.Tremolo({ frequency: 3.2, depth: 0.25, wet: 0.3 }).connect(chorus).start();
  const reverb = new Tone.Reverb({ decay: 3.5, wet: 0.25 }).connect(tremolo);

  const pad = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 1.5,
    modulationIndex: 3,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.03, decay: 0.4, sustain: 0.65, release: 1.6 },
    modulationEnvelope: { attack: 0.02, decay: 0.3, sustain: 0.2, release: 1 },
  }).connect(reverb);
  pad.volume.value = -10;
  // Voices are recycled rather than piling up: a 5-note chord every two
  // bars with a 1.6s release will otherwise exhaust the default pool.
  pad.maxPolyphony = 16;

  return pad;
}

export function createBass(bus) {
  const filter = new Tone.Filter({ frequency: 500, type: 'lowpass', rolloff: -12 }).connect(bus);

  const bass = new Tone.MonoSynth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.04, decay: 0.25, sustain: 0.85, release: 0.5 },
    filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.5, release: 0.5, baseFrequency: 200, octaves: 1.5 },
  }).connect(filter);
  bass.volume.value = -6;

  return bass;
}
