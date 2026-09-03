// The melody line.
//
// There was no melody at all before, which is most of why it felt static:
// a chord and a bass note every two bars is a texture, not a tune.
//
// The thing that makes a generated line sound written rather than random
// is repetition. A short motif is stated, repeated with a small change,
// answered, and then given room to breathe. Random notes over the right
// scale still sound random.

import { scaleTones, toNoteName } from './theory.js';

const MELODY_OCTAVE = 4;

// Rhythmic cells on a 16-step bar. Sparse on purpose — space is a feature
// of this music, not an absence of ideas.
const RHYTHMS = [
  [0, 3, 6],
  [0, 6, 10],
  [2, 6, 8, 14],
  [0, 4, 10],
  [6, 10, 12],
  [0, 3, 6, 11],
];

// Shapes as scale-step offsets: rising, falling, arch, turn.
const CONTOURS = [
  [0, 2, 1],
  [2, 1, -1],
  [0, 1, 3, 2],
  [0, -1, 1],
  [3, 2, 0],
  [0, 2, 4, 3],
];

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

// A motif is a rhythm plus a contour: when the notes fall, and how the
// line moves. Both stay fixed for the phrase so the ear can recognise it.
export function makeMotif(rng = Math.random) {
  const rhythm = pick(RHYTHMS, rng);
  const contour = pick(CONTOURS, rng);
  return {
    rhythm,
    contour,
    // Sits in the upper half of the two-octave pool, clear of the chord
    // voicing underneath it — a melody inside the chords just thickens them.
    base: 5 + Math.floor(rng() * 4),
  };
}

// Nearest chord tone to a given pitch, so strong beats land on harmony.
function snapToChord(pitch, chord) {
  let best = pitch;
  let bestDistance = Infinity;
  for (const tone of chord.tones) {
    // Compare by pitch class so the melody keeps its own register.
    for (let octave = -1; octave <= 2; octave++) {
      const candidate = tone + octave * 12;
      const distance = Math.abs(candidate - pitch);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
  }
  return best;
}

// Realises the motif against one chord. `variation` walks 0..3 through the
// phrase: state it, repeat it changed, lift it, then thin it out.
export function realiseMotif(motif, chord, keyName, variation, rng = Math.random) {
  // Bar four is mostly rest — the line has to breathe or it becomes wallpaper.
  if (variation === 3 && rng() < 0.7) return [];

  const scale = scaleTones(keyName, MELODY_OCTAVE, 2);
  const lift = variation === 2 ? 1 : 0;
  const notes = [];

  const count = variation === 3 ? 2 : motif.rhythm.length;

  for (let i = 0; i < count; i++) {
    // The pitches carry the motif's identity, so the rhythm can shift a
    // little between statements — an identical rhythm every bar is its own
    // kind of machine.
    let step = motif.rhythm[i];
    if (variation === 1 && i === count - 1) step = Math.min(15, step + 2);
    if (variation === 2 && i === 0) step = Math.min(15, step + 1);
    const degree = motif.contour[i % motif.contour.length];
    const index = Math.min(scale.length - 1, Math.max(0, motif.base + degree + lift));
    let pitch = scale[index];

    // Land on the harmony where it matters, pass through it where it doesn't.
    if (step % 4 === 0) pitch = snapToChord(pitch, chord);

    // On the repeat, bend the last note somewhere new so it answers rather
    // than merely repeats.
    if (variation === 1 && i === count - 1) {
      pitch = snapToChord(pitch + (rng() < 0.5 ? 2 : -3), chord);
    }

    notes.push({
      step,
      note: toNoteName(pitch, chord.useFlats),
      duration: i === count - 1 ? '4n' : '8n',
      velocity: 0.34 + rng() * 0.12,
    });
  }

  return notes;
}
