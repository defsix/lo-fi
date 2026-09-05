// Track identities.
//
// Every track this engine made sounded the same, and the reason was not too
// little randomness — it was that the randomness was all in the wrong
// place. Key, progression, melodic contour and comping pattern were rolled
// afresh each time, while tempo, mode, instruments and arrangement never
// moved at all. So the details differed and the identity never did, which
// is precisely the combination the ear hears as "the same track again".
//
// A palette is the identity: mode, tempo, harmonic shape, voices and drum
// feel, chosen together. Together matters. Rolling those independently
// gives a Rhodes at 96bpm over a brooding minor vamp with brushes, which is
// not variety, it is mush. Real records commit to a set of choices that
// belong to each other, and the variation happens inside that commitment.
//
// Names are shown to the listener. Knowing you are hearing "midnight rhodes"
// rather than "sunroom" is most of what makes two tracks feel like two
// tracks rather than one engine having a different afternoon.

export const PALETTES = [
  {
    name: 'midnight rhodes',
    blurb: 'dorian, brushed, close',
    mode: 'dorian',
    family: 'vamp',
    bpm: 71,
    voices: { keys: 'rhodes', lead: 'rhodes', bass: 'upright' },
    drums: 'brushed',
    // How far the master filter sits from wide open, before the arrangement
    // moves it. Darker palettes start further closed.
    tone: 0.78,
    reverb: 1.15,
  },
  {
    name: 'sunroom',
    blurb: 'major, light, unhurried',
    mode: 'major',
    family: 'turnaround',
    bpm: 84,
    voices: { keys: 'celeste', lead: 'celeste', bass: 'upright' },
    drums: 'light',
    tone: 1.05,
    reverb: 1.25,
  },
  {
    name: 'tape jazz',
    blurb: 'mixolydian, boom bap, forward',
    mode: 'mixolydian',
    family: 'turnaround',
    bpm: 92,
    voices: { keys: 'vibes', lead: 'vibes', bass: 'upright' },
    drums: 'boombap',
    tone: 1,
    reverb: 0.85,
  },
  {
    name: 'still',
    blurb: 'aeolian, no drums, wide',
    mode: 'aeolian',
    family: 'brooding',
    bpm: 63,
    voices: { keys: 'rhodes', lead: 'celeste', bass: 'upright' },
    drums: 'none',
    tone: 0.7,
    reverb: 1.6,
  },
  {
    name: 'corner shop',
    blurb: 'dorian, half-time, plucked',
    mode: 'dorian',
    family: 'parallel',
    bpm: 78,
    voices: { keys: 'pluck', lead: 'pluck', bass: 'upright' },
    drums: 'halftime',
    tone: 0.92,
    reverb: 1,
  },
  {
    name: 'blue hour',
    blurb: 'aeolian, sparse, distant',
    mode: 'aeolian',
    family: 'vamp',
    bpm: 68,
    voices: { keys: 'rhodes', lead: 'vibes', bass: 'upright' },
    drums: 'halftime',
    tone: 0.8,
    reverb: 1.35,
  },
];

// How well a palette suits a reading of the three words. Not a filter — the
// best match wins, but a near-match should sometimes win instead, or the
// same words would always give the same palette and we would be back to one
// track wearing different hats.
function fitness(palette, sense) {
  const brightness = { major: 0.7, mixolydian: 0.3, dorian: -0.2, aeolian: -0.7 }[palette.mode];
  const inwardness = { major: -0.6, mixolydian: -0.2, dorian: 0.3, aeolian: 0.8 }[palette.mode];
  // Tempo across the genre's range, mapped to the same -1..1 as energy.
  const pace = (palette.bpm - 63) / (92 - 63) * 2 - 1;
  const room = (palette.reverb - 0.85) / (1.6 - 0.85) * 2 - 1;

  const distance =
    Math.abs(brightness - sense.warmth) * 1.0 +
    Math.abs(inwardness - sense.melancholy) * 1.2 +
    Math.abs(pace - sense.energy) * 0.9 +
    Math.abs(room - sense.space) * 0.6;
  return -distance;
}

/**
 * Choose a palette. With no reading, any of them. With one, the closest —
 * but drawn from the best few rather than pinned to the single best, so the
 * words steer without dictating.
 */
export function pickPalette(sense = null, rng = Math.random) {
  if (!sense) return PALETTES[Math.floor(rng() * PALETTES.length)];
  const ranked = [...PALETTES].sort((a, b) => fitness(b, sense) - fitness(a, sense));
  // Weighted towards the front: 55% the best fit, 30% the second, 15% third.
  const roll = rng();
  const index = roll < 0.55 ? 0 : roll < 0.85 ? 1 : 2;
  return ranked[Math.min(index, ranked.length - 1)];
}

export function paletteByName(name) {
  return PALETTES.find((p) => p.name === name) || null;
}
