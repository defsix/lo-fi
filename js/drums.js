// The kit and its patterns.
//
// Timing and velocity come from groove.js; this decides what gets hit.
// The previous pattern was byte-identical every bar forever, which the ear
// picks up as a machine within about four bars. Here the kick pattern
// varies, ghost notes fill the gaps, and phrase ends get a fill.

import { STEPS_PER_BAR } from './groove.js';

export function createDrumKit(bus) {
  // The kick used to sit on C1 (33Hz) and sweep three octaves, which put
  // 69% of its energy below 60Hz: inaudible on a laptop or a phone, felt
  // rather than heard even on a good speaker, and measured as a flat noise
  // bed rather than a note because a swept pitch smears across the band. It
  // was the low-frequency noise. Now it sits on A1 (55Hz) with a shorter
  // sweep, and a highpass takes away what is left underneath.
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.024,
    octaves: 2,
    envelope: { attack: 0.004, decay: 0.26, sustain: 0, release: 0.1 },
  });
  const kickTone = new Tone.Filter({ frequency: 340, type: 'lowpass', rolloff: -12 }).connect(bus);
  const kickFloor = new Tone.Filter({ frequency: 48, type: 'highpass', rolloff: -24 }).connect(kickTone);
  kick.connect(kickFloor);
  kick.volume.value = -10;

  // A little beater click, so the kick still reads as a kick on a speaker
  // that cannot reproduce its body at all.
  const clickTone = new Tone.Filter({ frequency: 1800, type: 'bandpass', Q: 1.2 }).connect(bus);
  const click = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.02, sustain: 0 },
  }).connect(clickTone);
  click.volume.value = -30;

  const snareTone = new Tone.Filter({ frequency: 1500, type: 'bandpass', Q: 0.9 }).connect(bus);
  const snare = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.002, decay: 0.14, sustain: 0 },
  }).connect(snareTone);
  snare.volume.value = -10;

  // Rolled off at both ends: an open-topped hat is what makes a cheap kit
  // sound brittle.
  const hatHigh = new Tone.Filter({ frequency: 4200, type: 'highpass' });
  const hatTop = new Tone.Filter({ frequency: 9000, type: 'lowpass' }).connect(bus);
  hatHigh.connect(hatTop);
  const hat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.035, sustain: 0 },
  }).connect(hatHigh);
  hat.volume.value = -17;

  return { kick, click, snare, hat };
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
// Drum feels. One kit, played differently — which is most of what makes two
// lo-fi tracks sound like different records rather than the same one with
// different chords.
//
//   light     the default: eighths on the hat, backbeat, ghosts
//   brushed   quiet and busy, sixteenths, almost no kick weight
//   boombap   harder and simpler, the kick and snare doing the talking
//   halftime  the backbeat on 3 instead of 2 and 4, so the bar feels twice
//             as long and everything sits further back
//   none      handled by the caller; nothing is scheduled at all
const FEELS = {
  light: { hatStep: 2, hatChance: 0.9, ghostChance: 0.35, fillChance: 0.7, halfTime: false, doubles: true },
  brushed: { hatStep: 1, hatChance: 0.55, ghostChance: 0.6, fillChance: 0.45, halfTime: false, doubles: false },
  boombap: { hatStep: 2, hatChance: 1, ghostChance: 0.15, fillChance: 0.8, halfTime: false, doubles: false },
  halftime: { hatStep: 4, hatChance: 0.85, ghostChance: 0.25, fillChance: 0.5, halfTime: true, doubles: false },
};

// Half-time puts the snare on beat 3 alone. The bar is the same length; it
// simply feels twice as long, which is the point.
const HALFTIME_SNARE = [8];

export function drumsForBar(barInPhrase, rng = Math.random, feel = 'light') {
  const shape = FEELS[feel] || FEELS.light;
  const kick = pick(KICK_PATTERNS, rng);
  const ghosts = GHOST_STEPS.filter(() => rng() < shape.ghostChance);
  const fill = barInPhrase === 3 && rng() < shape.fillChance ? pick(FILLS, rng) : [];

  // Hats at this feel's subdivision, dropping the occasional one so the
  // pattern breathes.
  const hats = [];
  for (let step = 0; step < STEPS_PER_BAR; step += shape.hatStep) {
    if (rng() < shape.hatChance) hats.push(step);
  }
  // A few doubled-up sixteenths, the way a player fills a bar. Not in the
  // feels that are meant to stay out of the way.
  if (shape.doubles) {
    if (rng() < 0.4) hats.push(13);
    if (rng() < 0.3) hats.push(7);
  }

  const snare = shape.halfTime ? HALFTIME_SNARE : SNARE_STEPS;
  // Half-time drops the second kick too, or it fights its own backbeat.
  const kicks = shape.halfTime ? kick.filter((step) => step < 8) : kick;

  return { kick: kicks, snare, ghosts, hats, fill };
}
