// The kit and its patterns.
//
// Timing and velocity come from groove.js; this decides what gets hit.
// The previous pattern was byte-identical every bar forever, which the ear
// picks up as a machine within about four bars. Here the kick pattern
// varies, ghost notes fill the gaps, and phrase ends get a fill.

import { STEPS_PER_BAR } from './groove.js';

export function createDrumKit(bus) {
  // Softer attack and a shorter pitch sweep than before: the old kick's
  // click was reading as a crackle once the limiter caught it.
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.03,
    octaves: 3,
    envelope: { attack: 0.004, decay: 0.28, sustain: 0, release: 0.1 },
  });
  const kickTone = new Tone.Filter({ frequency: 320, type: 'lowpass', rolloff: -12 }).connect(bus);
  kick.connect(kickTone);
  kick.volume.value = -11;

  const snareTone = new Tone.Filter({ frequency: 1500, type: 'bandpass', Q: 0.9 }).connect(bus);
  const snare = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.002, decay: 0.14, sustain: 0 },
  }).connect(snareTone);
  snare.volume.value = -12;

  // Rolled off at both ends: an open-topped hat is what makes a cheap kit
  // sound brittle.
  const hatHigh = new Tone.Filter({ frequency: 4200, type: 'highpass' });
  const hatTop = new Tone.Filter({ frequency: 9000, type: 'lowpass' }).connect(bus);
  hatHigh.connect(hatTop);
  const hat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.035, sustain: 0 },
  }).connect(hatHigh);
  hat.volume.value = -20;

  return { kick, snare, hat };
}

// 16 steps to the bar. Kicks syncopate against the backbeat rather than
// marking every beat.
const KICK_PATTERNS = [
  [0, 6, 10],
  [0, 7],
  [0, 6, 11],
  [0, 3, 10],
  [0, 10],
];

// Backbeat, always. This is the anchor everything else leans against.
const SNARE_STEPS = [4, 12];

// Quiet taps between the backbeats.
const GHOST_STEPS = [7, 11, 14, 3];

// Bar-ending fills: a couple of extra snares to turn the phrase over.
const FILLS = [
  [14, 15],
  [11, 14, 15],
  [13, 15],
];

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

// `barInPhrase` runs 0..3; the fourth bar turns the phrase over.
export function drumsForBar(barInPhrase, rng = Math.random) {
  const kick = pick(KICK_PATTERNS, rng);
  const ghosts = GHOST_STEPS.filter(() => rng() < 0.35);
  const fill = barInPhrase === 3 && rng() < 0.7 ? pick(FILLS, rng) : [];

  // Hats on eighths, dropping the occasional one so the pattern breathes.
  const hats = [];
  for (let step = 0; step < STEPS_PER_BAR; step += 2) {
    if (rng() < 0.9) hats.push(step);
  }
  // A few doubled-up sixteenths, the way a player fills a bar.
  if (rng() < 0.4) hats.push(13);
  if (rng() < 0.3) hats.push(7);

  return { kick, snare: SNARE_STEPS, ghosts, hats, fill };
}
