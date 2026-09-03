// Chord progression generation: keys, jazzy 7th-chord qualities, and a
// handful of lo-fi-flavored progressions (mostly ii-V-I family) voiced
// into actual note names for the pad and bass instruments.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const MAJOR_SCALE_STEPS = [0, 2, 4, 5, 7, 9, 11];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

const QUALITY_SUFFIX = { maj7: 'maj7', m7: 'm7', dom7: '7', m7b5: 'm7b5', m9: 'm9', maj9: 'maj9' };

const CHORD_QUALITIES = {
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  m7b5: [0, 3, 6, 10],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
};

// Each entry is a progression of {degree (1-7), quality}, one chord per
// entry, played in order and looped.
const PROGRESSIONS = [
  [{ degree: 2, q: 'm7' }, { degree: 5, q: 'dom7' }, { degree: 1, q: 'maj7' }, { degree: 1, q: 'maj7' }],
  [{ degree: 1, q: 'maj7' }, { degree: 6, q: 'm7' }, { degree: 2, q: 'm7' }, { degree: 5, q: 'dom7' }],
  [{ degree: 6, q: 'm7' }, { degree: 2, q: 'm7' }, { degree: 5, q: 'dom7' }, { degree: 1, q: 'maj7' }],
  [{ degree: 1, q: 'maj7' }, { degree: 4, q: 'maj7' }, { degree: 2, q: 'm7' }, { degree: 5, q: 'dom7' }],
  [{ degree: 3, q: 'm7' }, { degree: 6, q: 'm7' }, { degree: 2, q: 'm7' }, { degree: 5, q: 'dom7' }],
];

const KEYS = ['C', 'D', 'Eb', 'F', 'G', 'A', 'Bb'];

function degreeToSemitone(degree) {
  return MAJOR_SCALE_STEPS[(degree - 1 + 7) % 7];
}

function absoluteToNoteName(absoluteSemitone) {
  const octave = Math.floor(absoluteSemitone / 12);
  const n = ((absoluteSemitone % 12) + 12) % 12;
  return NOTE_NAMES[n] + octave;
}

export function pickKey() {
  return KEYS[Math.floor(Math.random() * KEYS.length)];
}

export function pickProgression() {
  return PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];
}

// "Dm7", "G7", "Cmaj7" — the chord as a player would name it.
export function chordLabel(chord) {
  return chord.root.replace(/\d+$/, '') + QUALITY_SUFFIX[chord.quality];
}

// "ii7", "V7", "Imaj7" — the chord's function within the key.
export function romanLabel({ degree, quality }) {
  const numeral = ROMAN[degree - 1];
  if (quality === 'm7') return numeral.toLowerCase() + '7';
  if (quality === 'm9') return numeral.toLowerCase() + '9';
  if (quality === 'm7b5') return numeral.toLowerCase() + 'm7b5';
  if (quality === 'dom7') return numeral + '7';
  return numeral + QUALITY_SUFFIX[quality];
}

// Builds an array of voiced chords: { root, quality, bass, notes: [...] }
// `octave` sets the pad's register (bass sits two octaves below it).
export function buildChords(keyName, progression, octave = 4) {
  const keyRootIndex = NOTE_NAMES.indexOf(keyName);
  const keyRootAbsolute = keyRootIndex + octave * 12;

  return progression.map(({ degree, q }) => {
    const rootAbsolute = keyRootAbsolute + degreeToSemitone(degree);
    const intervals = CHORD_QUALITIES[q];
    const notes = intervals.map((iv) => absoluteToNoteName(rootAbsolute + iv));
    const bass = absoluteToNoteName(rootAbsolute - 24);
    return { degree, quality: q, root: absoluteToNoteName(rootAbsolute), bass, notes };
  });
}
