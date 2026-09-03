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

const KEYS = ['C', 'D', 'Eb', 'F', 'G', 'A', 'Bb'];

// Semitones above the chord root. Rootless and spread: no root, guide
// tones low, colour on top, spanning more than an octave.
const VOICINGS = {
  maj7: [4, 11, 14, 19], // 3  7  9  5
  m7: [3, 10, 14, 17], // b3 b7  9 11
  m9: [3, 10, 14, 19], // b3 b7  9  5
  dom7: [4, 10, 14, 21], // 3 b7  9 13
  m7b5: [3, 10, 14, 18], // b3 b7  9 b5
};

const QUALITY_SUFFIX = { maj7: 'maj7', m7: 'm7', m9: 'm9', dom7: '7', m7b5: 'm7b5' };

// Each chord is [semitones above the key root, quality, roman numeral].
// Mostly ii-V-I family, plus one borrowed-chord progression for colour.
const PROGRESSIONS = [
  [[0, 'maj7', 'Imaj7'], [9, 'm7', 'vi7'], [2, 'm7', 'ii7'], [7, 'dom7', 'V7']],
  [[2, 'm7', 'ii7'], [7, 'dom7', 'V7'], [0, 'maj7', 'Imaj7'], [0, 'maj7', 'Imaj7']],
  [[9, 'm7', 'vi7'], [2, 'm7', 'ii7'], [7, 'dom7', 'V7'], [0, 'maj7', 'Imaj7']],
  [[5, 'maj7', 'IVmaj7'], [4, 'm7', 'iii7'], [9, 'm7', 'vi7'], [7, 'dom7', 'V7']],
  [[0, 'maj7', 'Imaj7'], [10, 'dom7', 'bVII7'], [5, 'maj7', 'IVmaj7'], [5, 'm7', 'iv7']],
  [[0, 'maj7', 'Imaj7'], [5, 'maj7', 'IVmaj7'], [4, 'm7', 'iii7'], [9, 'm9', 'vi9']],
];

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

export function pickProgression(rng = Math.random) {
  return PROGRESSIONS[Math.floor(rng() * PROGRESSIONS.length)];
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

export function buildChords(keyName, progression) {
  const keyRoot = keyRootAbsolute(keyName, KEYS_OCTAVE);
  const useFlats = keyName.includes('b');

  return progression.map(([semitones, quality, roman]) => {
    const root = keyRoot + semitones;
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
export function scaleTones(keyName, fromOctave, octaves = 2) {
  const root = keyRootAbsolute(keyName, fromOctave);
  const tones = [];
  for (let o = 0; o < octaves; o++) {
    for (const step of MAJOR_SCALE) tones.push(root + o * 12 + step);
  }
  return tones;
}
