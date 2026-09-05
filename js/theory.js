// Keys, chord voicings and progressions.
//
// The voicings here are the difference between "a computer playing the
// right notes" and something that sounds played: the bass takes the root
// and the keys take the guide tones (3rd and 7th) plus colour, spread
// across two octaves. Close root-position stacks are what made the first
// version sound like a MIDI demo.

import { declutter } from './voicing.js';

// Our absolute pitch numbers count semitones from C0; MIDI counts from C-1.
const MIDI_OFFSET = 12;

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const ENHARMONIC = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

// Everything this engine wrote until now was in major, which is why every
// track shared the same slightly polite cast whatever else changed.
//
// Dorian is the one that matters most: minor with a raised sixth, which
// reads warm rather than dark, and it is the mode the genre leans on
// hardest. Aeolian is plain natural minor, heavier. Mixolydian is major
// with a flat seventh — brighter than dorian, less resolved than major.
export const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

const KEYS = ['C', 'D', 'Eb', 'F', 'G', 'A', 'Bb'];

// Semitones above the chord root. Rootless and spread: no root, guide
// tones low, colour on top, spanning more than an octave.
const VOICINGS = {
  maj7: [4, 11, 14, 19], // 3  7  9  5
  m7: [3, 10, 14, 17], // b3 b7  9 11
  m9: [3, 10, 14, 19], // b3 b7  9  5
  dom7: [4, 10, 14, 21], // 3 b7  9 13
  m7b5: [3, 10, 14, 18], // b3 b7  9 b5
  // m11 is the chord this music was missing. Sources reach for it before
  // anything else — the eleventh sits a fourth above the fifth and blurs
  // the third, so the chord is minor without insisting on it.
  m11: [3, 10, 17, 21], // b3 b7 11 13
  maj9: [4, 11, 14, 16], // 3  7  9  3(8ve)
  maj13: [4, 11, 14, 21], // 3  7  9 13
  // Minor-major seventh: the seventh pulled up under a minor third. Used
  // sparingly, as a chord to pass through rather than sit on.
  mMaj7: [3, 11, 14, 19], // b3  7  9  5
  // Suspended: no third at all, so it belongs to neither mode and can sit
  // between two chords that disagree.
  sus: [5, 10, 14, 19], //  4 b7  9  5
  dom7s5: [4, 10, 14, 20], // 3 b7  9 #5
};

const QUALITY_SUFFIX = {
  maj7: 'maj7', m7: 'm7', m9: 'm9', dom7: '7', m7b5: 'm7b5',
  m11: 'm11', maj9: 'maj9', maj13: 'maj13', mMaj7: 'mMaj7',
  sus: 'sus', dom7s5: '7#5',
};

// Each chord is [semitones above the key root, quality, roman numeral].
//
// Grouped by family rather than listed flat, because the *shape* of a
// progression is as much of its character as its chords. Everything here
// used to be four-chord functional jazz in major — one flavour, played
// every time. The genre also lives on two-chord vamps that go nowhere on
// purpose, and on parallel motion that is not functional harmony at all.
// Each entry carries the modes it belongs to. Without that, a palette could
// declare itself dorian and be handed a major turnaround, which is how the
// first version of this went: the mode was stated and then contradicted by
// the chords, so it did nothing at all.
//
// MINOR covers dorian and aeolian; the difference between them is the sixth,
// which these progressions mostly leave to the melody. MAJOR covers major
// and mixolydian, where the flat seventh is likewise the melody's business.
const MINOR = ['dorian', 'aeolian'];
const MAJOR = ['major', 'mixolydian'];

const PROGRESSION_FAMILIES = {
  // ii-V-I and relatives. Resolved, jazz-school, bright.
  turnaround: [
    { modes: MAJOR, chords: [[0, 'maj9', 'Imaj9'], [9, 'm7', 'vi7'], [2, 'm7', 'ii7'], [7, 'dom7', 'V7']] },
    { modes: MAJOR, chords: [[2, 'm7', 'ii7'], [7, 'dom7', 'V7'], [0, 'maj9', 'Imaj9'], [0, 'maj13', 'Imaj13']] },
    { modes: MAJOR, chords: [[9, 'm7', 'vi7'], [2, 'm11', 'ii11'], [7, 'dom7', 'V7'], [0, 'maj7', 'Imaj7']] },
    { modes: MAJOR, chords: [[5, 'maj7', 'IVmaj7'], [4, 'm7', 'iii7'], [9, 'm7', 'vi7'], [7, 'dom7', 'V7']] },
    { modes: ['mixolydian'], chords: [[0, 'maj9', 'Imaj9'], [10, 'maj7', 'bVIImaj7'], [5, 'maj9', 'IVmaj9'], [0, 'dom7', 'I7']] },
    // The minor turnaround: the same motion, arrived at from underneath.
    { modes: MINOR, chords: [[2, 'm7b5', 'ii7b5'], [7, 'dom7s5', 'V7#5'], [0, 'm9', 'i9'], [0, 'm11', 'i11']] },
    { modes: MINOR, chords: [[0, 'm11', 'i11'], [5, 'm7', 'iv7'], [10, 'dom7', 'bVII7'], [3, 'maj9', 'bIIImaj9']] },
  ],

  // Two chords, back and forth. The most common shape in the genre and the
  // one this engine could not make: nothing resolves, so nothing has to.
  vamp: [
    { modes: MINOR, chords: [[0, 'm11', 'i11'], [5, 'm9', 'iv9']] },
    { modes: MAJOR, chords: [[0, 'maj9', 'Imaj9'], [5, 'maj13', 'IVmaj13']] },
    { modes: MINOR, chords: [[0, 'm11', 'i11'], [10, 'maj7', 'bVIImaj7']] },
    { modes: MINOR, chords: [[0, 'm9', 'i9'], [3, 'maj9', 'bIIImaj9']] },
    { modes: MAJOR, chords: [[0, 'sus', 'Isus'], [5, 'maj9', 'IVmaj9']] },
    // Mixolydian's own sound: the flat seventh as a chord, not just a note
    // in the scale. Without this it shared major's harmony entirely and the
    // mode only reached the melody.
    { modes: ['mixolydian'], chords: [[0, 'dom7', 'I7'], [10, 'maj9', 'bVIImaj9']] },
    // Dorian's own sound: the major IV under a minor i, which is the raised
    // sixth doing the work that makes dorian warm rather than dark.
    { modes: ['dorian'], chords: [[0, 'm11', 'i11'], [5, 'dom7', 'IV7']] },
  ],

  // Planing: the same chord shape slid up or down. Not functional harmony —
  // the ear hears colour moving rather than a key being established.
  parallel: [
    { modes: MINOR, chords: [[0, 'm11', 'i11'], [1, 'm11', 'bII11'], [0, 'm11', 'i11'], [10, 'm11', 'bVII11']] },
    { modes: MAJOR, chords: [[0, 'maj9', 'Imaj9'], [2, 'maj9', 'IImaj9'], [5, 'maj9', 'IVmaj9'], [2, 'maj9', 'IImaj9']] },
    { modes: MINOR, chords: [[0, 'm9', 'i9'], [3, 'm9', 'bIII9'], [5, 'm9', 'iv9'], [3, 'm9', 'bIII9']] },
    { modes: MINOR, chords: [[0, 'm11', 'i11'], [3, 'm11', 'bIII11'], [5, 'm11', 'iv11'], [0, 'm11', 'i11']] },
  ],

  // Inward, minor-centred, with the borrowed and altered chords the sources
  // reach for when they want a progression to ache slightly.
  brooding: [
    { modes: MINOR, chords: [[0, 'm11', 'i11'], [5, 'm9', 'iv9'], [0, 'm11', 'i11'], [7, 'dom7s5', 'V7#5']] },
    { modes: MINOR, chords: [[0, 'm9', 'i9'], [8, 'maj7', 'bVImaj7'], [3, 'maj9', 'bIIImaj9'], [0, 'mMaj7', 'imMaj7']] },
    { modes: MINOR, chords: [[0, 'm7', 'i7'], [10, 'dom7', 'bVII7'], [8, 'maj7', 'bVImaj7'], [7, 'dom7', 'V7']] },
    { modes: MAJOR, chords: [[9, 'm11', 'vi11'], [5, 'maj7', 'IVmaj7'], [0, 'maj7', 'Imaj7'], [7, 'sus', 'Vsus']] },
  ],
};

export const PROGRESSION_FAMILY_NAMES = Object.keys(PROGRESSION_FAMILIES);

const ALL = Object.values(PROGRESSION_FAMILIES).flat();
const PROGRESSIONS = ALL.map((entry) => entry.chords);

// Where the comping voicings sit. The bass has its own register, set per
// chord below.
const KEYS_OCTAVE = 3;

function noteIndex(name) {
  const index = NOTE_NAMES.indexOf(ENHARMONIC[name] || name);
  if (index === -1) throw new Error(`unknown note name: ${name}`);
  return index;
}

export function toNoteName(absolute, useFlats = false) {
  const octave = Math.floor(absolute / 12);
  const n = ((absolute % 12) + 12) % 12;
  return (useFlats ? FLAT_NAMES : NOTE_NAMES)[n] + octave;
}

export function pickKey(rng = Math.random) {
  return KEYS[Math.floor(rng() * KEYS.length)];
}

// PROGRESSIONS run roughly brightest first to most inward last, so a
// melancholy reading can select across that range. Not a hard index: a
// window, so the same words still give different music each cycle.
export function pickProgressionFor(melancholy, rng = Math.random) {
  const spread = PROGRESSIONS.length - 1;
  // -1 (bright) to 1 (inward) onto the list, then a window of two either way.
  const centre = ((Math.max(-1, Math.min(1, melancholy)) + 1) / 2) * spread;
  const from = Math.max(0, Math.round(centre) - 1);
  const to = Math.min(spread, Math.round(centre) + 1);
  return PROGRESSIONS[from + Math.floor(rng() * (to - from + 1))];
}

export function pickProgression(rng = Math.random) {
  return PROGRESSIONS[Math.floor(rng() * PROGRESSIONS.length)];
}

// A progression from a named family, in a given mode. The mode filter is
// what keeps a palette's stated identity and its actual chords in
// agreement; without it a dorian track gets a major turnaround and the mode
// is decoration.
export function pickProgressionFromFamily(family, rng = Math.random, mode = 'major') {
  const list = PROGRESSION_FAMILIES[family] || ALL;
  const fitting = list.filter((entry) => entry.modes.includes(mode));
  // Every family has something for every mode, but fall back to the family
  // rather than throwing if that ever stops being true.
  const from = fitting.length ? fitting : list;
  return from[Math.floor(rng() * from.length)].chords;
}

// "Dm7", "G7", "Cmaj7" — the chord as a player would name it.
export function chordLabel(chord) {
  return chord.rootName.replace(/\d+$/, '') + QUALITY_SUFFIX[chord.quality];
}

// "ii7", "V7", "Imaj7" — its function within the key.
export function romanLabel(chord) {
  return chord.roman;
}

// Without this, a piece in Bb sits nearly an octave above one in C purely
// because of where its root falls in the octave — the same progression would
// read bright in one key and dark in another. Keys above F drop an octave so
// every key plays in the same register. Chords and melody share the rule, or
// the melody drifts away from the harmony as the key changes.
export function keyRootAbsolute(keyName, baseOctave) {
  const pitchClass = noteIndex(keyName);
  return pitchClass + (pitchClass >= 7 ? baseOctave - 1 : baseOctave) * 12;
}

// Whether a chord is spelled with flats or sharps. Keying this off the key
// *name* was wrong twice over: F major has no "b" in its name but is a flat
// key (its bVII is Eb, not D#), and a borrowed minor chord in a sharp key
// still wants flats (the iv of G major is Cm7 — C Eb G Bb, never C D# G A#).
// Sharps are for chords that belong to a sharp key; everything else is flat.
const SHARP_KEYS = new Set(['G', 'D', 'A', 'E', 'B']);

// The basic seventh chord, without the added tensions. Spelling is decided
// on these: the root alone is too little (the iv of G major has a diatonic
// root but is borrowed, and wants Eb and Bb), and every voiced tone is too
// much (the iii of D major is a plain F#m7 whose added 9th happens to fall
// outside the key, and it should not become Gbm7 over that).
const CORE_TONES = {
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  m7b5: [0, 3, 6, 10],
  m11: [0, 3, 7, 10],
  maj9: [0, 4, 7, 11],
  maj13: [0, 4, 7, 11],
  mMaj7: [0, 3, 7, 11],
  // No third, so there is no minor/major question to answer; the fourth and
  // flat seventh decide it.
  sus: [0, 5, 7, 10],
  dom7s5: [0, 4, 8, 10],
};

function spellsWithFlats(keyName, semitonesAboveKey, quality) {
  if (!SHARP_KEYS.has(keyName)) return true;
  return !CORE_TONES[quality].every((interval) =>
    MAJOR_SCALE.includes((((semitonesAboveKey + interval) % 12) + 12) % 12)
  );
}

export function buildChords(keyName, progression) {
  const keyRoot = keyRootAbsolute(keyName, KEYS_OCTAVE);

  return progression.map(([semitones, quality, roman]) => {
    const root = keyRoot + semitones;
    const useFlats = spellsWithFlats(keyName, semitones, quality);
    return {
      root,
      roman,
      quality,
      rootName: toNoteName(root, useFlats),
      // Rootless in the keys, so the bass owns the bottom of the chord, and
      // run past the critical-band check so nothing sits close enough to
      // beat against its neighbour.
      notes: declutter(VOICINGS[quality].map((i) => root + i + MIDI_OFFSET)).map((midi) =>
        toNoteName(midi - MIDI_OFFSET, useFlats)
      ),
      // The bass gets its own register rather than tracking the chord an
      // octave down: with the chord register normalised, low keys were
      // putting bass fundamentals at 49Hz, which is felt more than heard and
      // eats the headroom everything else needs. Pinned to octave 2, every
      // root lands between 65 and 123Hz.
      bassRoot: (((root % 12) + 12) % 12) + 24,
      // Chord tones for the melody to land on, as absolute semitones.
      tones: [0, ...VOICINGS[quality]].map((interval) => root + interval),
      useFlats,
    };
  });
}

// The key's major scale across `octaves`, as absolute semitones — the
// melody draws from this so every note belongs to the key.
export function scaleTones(keyName, fromOctave, octaves = 2, mode = 'major') {
  const root = keyRootAbsolute(keyName, fromOctave);
  const steps = MODES[mode] || MAJOR_SCALE;
  const tones = [];
  for (let o = 0; o < octaves; o++) {
    for (const step of steps) tones.push(root + o * 12 + step);
  }
  return tones;
}
