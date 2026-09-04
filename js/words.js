// Three words as a starting point for the music.
//
// The hard part is not wiring words to parameters, it is doing so in a way
// that means something. Two failure modes to avoid:
//
//   Hashing the string into a seed. Deterministic, effortless, and useless:
//   "rain" and "neon" would differ as much as "rain" and "rainy", and none
//   of it would relate to what the words mean. It looks like it works
//   because different words give different music.
//
//   A dictionary of exact words. Honest for the words in it, blank for
//   everything else, and everyone types something not in it.
//
// So: a small set of sense dimensions the music can actually act on, a
// vocabulary scored against them, and unknown words handled by their shape
// and by fuzzy matching rather than ignored. Three words are averaged, so
// "rain neon midnight" lands somewhere none of them would alone.
//
// The dimensions are chosen because the engine has a real lever for each:
//
//   warmth      register and filter — dark and low, or bright and open
//   energy      tempo and drum density
//   space       reverb and how much room is left between notes
//   melancholy  major or minor colour, and the progression chosen

const DIMENSIONS = ['warmth', 'energy', 'space', 'melancholy'];

// Scores run -1 to 1. Only words with a real musical reading are listed;
// padding this with vague entries would make everything average out.
const LEXICON = {
  // weather and light
  rain: { warmth: -0.3, energy: -0.4, space: 0.5, melancholy: 0.6 },
  storm: { warmth: -0.4, energy: 0.7, space: 0.4, melancholy: 0.3 },
  sun: { warmth: 0.8, energy: 0.4, space: -0.1, melancholy: -0.6 },
  sunset: { warmth: 0.6, energy: -0.3, space: 0.3, melancholy: 0.3 },
  dawn: { warmth: 0.3, energy: -0.2, space: 0.4, melancholy: -0.1 },
  fog: { warmth: -0.2, energy: -0.6, space: 0.8, melancholy: 0.4 },
  mist: { warmth: -0.1, energy: -0.6, space: 0.7, melancholy: 0.3 },
  snow: { warmth: -0.5, energy: -0.5, space: 0.6, melancholy: 0.3 },
  summer: { warmth: 0.8, energy: 0.3, space: 0.0, melancholy: -0.4 },
  winter: { warmth: -0.6, energy: -0.3, space: 0.4, melancholy: 0.5 },
  autumn: { warmth: 0.2, energy: -0.3, space: 0.2, melancholy: 0.5 },
  spring: { warmth: 0.5, energy: 0.4, space: 0.1, melancholy: -0.3 },

  // time and place
  midnight: { warmth: -0.4, energy: -0.3, space: 0.5, melancholy: 0.5 },
  night: { warmth: -0.3, energy: -0.3, space: 0.4, melancholy: 0.3 },
  morning: { warmth: 0.4, energy: 0.2, space: 0.2, melancholy: -0.3 },
  city: { warmth: -0.2, energy: 0.5, space: -0.3, melancholy: 0.2 },
  neon: { warmth: -0.1, energy: 0.5, space: 0.1, melancholy: 0.2 },
  ocean: { warmth: 0.1, energy: -0.3, space: 0.9, melancholy: 0.2 },
  forest: { warmth: 0.3, energy: -0.3, space: 0.6, melancholy: 0.1 },
  desert: { warmth: 0.5, energy: -0.4, space: 0.8, melancholy: 0.3 },
  train: { warmth: 0.0, energy: 0.3, space: 0.2, melancholy: 0.4 },
  home: { warmth: 0.7, energy: -0.3, space: -0.3, melancholy: -0.2 },
  attic: { warmth: 0.3, energy: -0.5, space: 0.2, melancholy: 0.5 },
  street: { warmth: -0.1, energy: 0.4, space: -0.1, melancholy: 0.2 },

  // feeling
  calm: { warmth: 0.4, energy: -0.7, space: 0.4, melancholy: -0.1 },
  quiet: { warmth: 0.2, energy: -0.8, space: 0.4, melancholy: 0.1 },
  slow: { warmth: 0.2, energy: -0.8, space: 0.3, melancholy: 0.2 },
  sleepy: { warmth: 0.4, energy: -0.8, space: 0.3, melancholy: 0.1 },
  dream: { warmth: 0.2, energy: -0.5, space: 0.8, melancholy: 0.2 },
  lonely: { warmth: -0.2, energy: -0.5, space: 0.6, melancholy: 0.9 },
  sad: { warmth: -0.1, energy: -0.4, space: 0.3, melancholy: 0.9 },
  happy: { warmth: 0.7, energy: 0.5, space: -0.1, melancholy: -0.8 },
  warm: { warmth: 0.9, energy: -0.1, space: 0.0, melancholy: -0.2 },
  cold: { warmth: -0.8, energy: -0.1, space: 0.3, melancholy: 0.4 },
  soft: { warmth: 0.5, energy: -0.5, space: 0.3, melancholy: 0.0 },
  bright: { warmth: 0.7, energy: 0.4, space: 0.0, melancholy: -0.5 },
  dark: { warmth: -0.7, energy: -0.1, space: 0.2, melancholy: 0.5 },
  hazy: { warmth: 0.2, energy: -0.5, space: 0.6, melancholy: 0.3 },
  restless: { warmth: -0.1, energy: 0.7, space: -0.2, melancholy: 0.4 },
  hope: { warmth: 0.5, energy: 0.2, space: 0.3, melancholy: -0.4 },
  memory: { warmth: 0.3, energy: -0.4, space: 0.5, melancholy: 0.6 },
  faded: { warmth: 0.1, energy: -0.5, space: 0.4, melancholy: 0.6 },
  velvet: { warmth: 0.7, energy: -0.4, space: 0.2, melancholy: 0.1 },
  amber: { warmth: 0.8, energy: -0.2, space: 0.1, melancholy: 0.1 },
  blue: { warmth: -0.3, energy: -0.3, space: 0.4, melancholy: 0.7 },
  gold: { warmth: 0.8, energy: 0.1, space: 0.1, melancholy: -0.2 },
  grey: { warmth: -0.3, energy: -0.4, space: 0.2, melancholy: 0.5 },

  // motion
  drift: { warmth: 0.2, energy: -0.6, space: 0.7, melancholy: 0.2 },
  float: { warmth: 0.2, energy: -0.6, space: 0.8, melancholy: 0.0 },
  run: { warmth: 0.0, energy: 0.8, space: -0.2, melancholy: 0.0 },
  dance: { warmth: 0.4, energy: 0.8, space: -0.1, melancholy: -0.4 },
  fall: { warmth: -0.1, energy: -0.2, space: 0.3, melancholy: 0.6 },
  wander: { warmth: 0.2, energy: -0.2, space: 0.5, melancholy: 0.3 },
};

// Suffixes that carry meaning of their own, so "rainy" reads as "rain" and
// "slowly" as "slow" rather than as nothing at all.
const SUFFIXES = ['ing', 'ed', 'ly', 'y', 'ness', 's'];

function stem(word) {
  for (const suffix of SUFFIXES) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      const base = word.slice(0, -suffix.length);
      if (LEXICON[base]) return base;
      // "hazy" -> "haz" -> "haze"; try restoring a dropped e.
      if (LEXICON[base + 'e']) return base + 'e';
    }
  }
  return word;
}

// A word not in the lexicon still has a shape, and shape carries a little
// meaning: long words are slower to say than short ones, and the vowels in
// them are the oldest sound-symbolism there is — "gloom" is not "glee".
// This is a weak signal and is deliberately weighted as one, but it beats
// returning zero and pretending the word was never typed.
function fromShape(word) {
  const dark = (word.match(/[ou]/g) || []).length;
  const bright = (word.match(/[iea]/g) || []).length;
  const vowels = Math.max(1, dark + bright);
  const brightness = (bright - dark) / vowels;
  const length = Math.min(1, word.length / 10);
  return {
    warmth: brightness * 0.3,
    energy: (1 - length) * 0.3 - 0.1,
    space: length * 0.3,
    melancholy: -brightness * 0.25,
  };
}

// Levenshtein, capped: near enough to catch a typo, not so loose that every
// word matches something.
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

function closest(word) {
  let best = null;
  let bestScore = 3; // more than two edits away is a different word
  for (const candidate of Object.keys(LEXICON)) {
    const d = distance(word, candidate);
    if (d < bestScore) { bestScore = d; best = candidate; }
  }
  return best;
}

/** One word's reading, and how it was arrived at. */
export function readWord(raw) {
  const word = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return null;
  if (LEXICON[word]) return { word, sense: LEXICON[word], how: 'known' };
  const stemmed = stem(word);
  if (LEXICON[stemmed]) return { word, sense: LEXICON[stemmed], how: 'stem of ' + stemmed };
  const near = closest(word);
  if (near) return { word, sense: LEXICON[near], how: 'near ' + near };
  return { word, sense: fromShape(word), how: 'sound' };
}

/**
 * Three words averaged into one reading. Returns null when nothing usable
 * was typed, so callers can fall back to choosing at random rather than to
 * a flat, characterless middle.
 */
export function readWords(words) {
  const read = (words || []).map(readWord).filter(Boolean);
  if (!read.length) return null;
  const sense = {};
  for (const dimension of DIMENSIONS) {
    const sum = read.reduce((total, r) => total + (r.sense[dimension] || 0), 0);
    sense[dimension] = Math.max(-1, Math.min(1, sum / read.length));
  }
  return { sense, words: read };
}
