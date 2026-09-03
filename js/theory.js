// Chord progression generation: keys, jazzy 7th-chord qualities, and a
// handful of lo-fi-flavored progressions (mostly ii-V-I family) voiced
// into actual note names for the pad and bass instruments.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Flat keys read better in this idiom (Bb, Eb), but the table above is all
// sharps — looking up 'Bb' in it returns -1 and transposes the whole mix
// down a semitone, so names are normalised before any lookup and spelled
// back out with flats when the key calls for it.
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const ENHARMONIC = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

function noteIndex(name) {
  const index = NOTE_NAMES.indexOf(ENHARMONIC[name] || name);
  if (index === -1) throw new Error(`unknown note name: ${name}`);
  return index;
}

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

function absoluteToNoteName(absoluteSemitone, useFlats = false) {
  const octave = Math.floor(absoluteSemitone / 12);
  const n = ((absoluteSemitone % 12) + 12) % 12;
  return (useFlats ? FLAT_NAMES : NOTE_NAMES)[n] + octave;
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
  const keyRootAbsolute = noteIndex(keyName) + octave * 12;
  const useFlats = keyName.includes('b');

  return progression.map(({ degree, q }) => {
    const rootAbsolute = keyRootAbsolute + degreeToSemitone(degree);
    const intervals = CHORD_QUALITIES[q];
    const notes = intervals.map((iv) => absoluteToNoteName(rootAbsolute + iv, useFlats));
    const bass = absoluteToNoteName(rootAbsolute - 24, useFlats);
    return { degree, quality: q, root: absoluteToNoteName(rootAbsolute, useFlats), bass, notes };
  });
}
