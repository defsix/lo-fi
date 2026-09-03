// A basic swung boom-bap kit: kick, snare, and closed hats, each hit
// carrying a small random timing/velocity offset so it doesn't feel
// mechanical.

export function createDrumKit() {
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.35, sustain: 0 },
  }).toDestination();
  kick.volume.value = -6;

  const snareFilter = new Tone.Filter({ frequency: 1800, type: 'bandpass' }).toDestination();
  const snare = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.18, sustain: 0 },
  }).connect(snareFilter);
  snare.volume.value = -10;

  const hatFilter = new Tone.Filter({ frequency: 8000, type: 'highpass' }).toDestination();
  const hat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.04, sustain: 0 },
  }).connect(hatFilter);
  hat.volume.value = -24;

  return { kick, snare, hat };
}

// 8 steps per bar (eighth notes). Transport swing pushes the off-beats
// late for the shuffle feel.
const KICK_PATTERN = [1, 0, 0, 1, 0, 0, 1, 0];
const SNARE_PATTERN = [0, 0, 1, 0, 0, 0, 1, 0];
const HAT_ACCENTS = [1, 0.55, 0.75, 0.5, 0.9, 0.55, 0.75, 0.5];

function jitter(seconds = 0.012) {
  return (Math.random() - 0.5) * 2 * seconds;
}

export function scheduleDrums({ kick, snare, hat }) {
  return new Tone.Sequence(
    (time, step) => {
      const t = time + jitter();
      if (KICK_PATTERN[step]) kick.triggerAttackRelease('C1', '8n', t, 0.9 + Math.random() * 0.1);
      if (SNARE_PATTERN[step]) snare.triggerAttackRelease('16n', t, 0.8 + Math.random() * 0.15);
      hat.triggerAttackRelease('32n', t, HAT_ACCENTS[step] * (0.8 + Math.random() * 0.2));
    },
    [0, 1, 2, 3, 4, 5, 6, 7],
    '8n'
  );
}
