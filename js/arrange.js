// What each voice plays in a given bar.
//
// Previously a chord was one block held for two bars and the bass was one
// sustained root underneath it — nothing moved between chord changes, which
// is why it didn't flow. Here the chord is comped in syncopated hits and
// the bass walks between roots.

import { toNoteName } from './theory.js';
import { accent } from './groove.js';

// Where the chord lands in the bar. Off-beat hits are the point: a chord
// on every downbeat sounds like a metronome playing harmony.
const COMP_PATTERNS = [
  [{ step: 0, duration: '2n' }, { step: 6, duration: '4n' }],
  [{ step: 0, duration: '4n.' }, { step: 6, duration: '4n' }, { step: 11, duration: '8n' }],
  [{ step: 2, duration: '4n' }, { step: 8, duration: '2n' }],
  [{ step: 0, duration: '2n.' }],
  [{ step: 0, duration: '4n' }, { step: 7, duration: '4n' }, { step: 12, duration: '4n' }],
];

// Bass roles resolve against the current chord: the root, its fifth, the
// octave, or a step that leads into the next chord's root.
const BASS_PATTERNS = [
  [{ step: 0, role: 'root', duration: '4n.' }, { step: 8, role: 'fifth', duration: '4n' }],
  [{ step: 0, role: 'root', duration: '2n' }, { step: 10, role: 'octave', duration: '8n' }],
  [{ step: 0, role: 'root', duration: '4n' }, { step: 6, role: 'root', duration: '8n' }, { step: 12, role: 'approach', duration: '4n' }],
  [{ step: 0, role: 'root', duration: '2n.' }],
  [{ step: 0, role: 'root', duration: '4n' }, { step: 7, role: 'fifth', duration: '8n' }, { step: 14, role: 'approach', duration: '8n' }],
];

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

export function compForBar(chord, dense, rng = Math.random) {
  const pattern = dense ? pick(COMP_PATTERNS, rng) : COMP_PATTERNS[3];
  return pattern.map((hit) => ({
    ...hit,
    notes: chord.notes,
    // Weighted by where the hit lands: a chord on the downbeat carries
    // more than one squeezed onto an off-beat.
    velocity: (0.3 + rng() * 0.12) * (0.75 + accent(hit.step) * 0.4),
    // Hits are rolled slightly rather than struck as a block — the give-away
    // of a played chord versus a triggered one. Kept tight enough that a
    // four-note voicing still lands as one chord.
    roll: 0.007 + rng() * 0.011,
  }));
}

export function bassForBar(chord, nextChord, rng = Math.random) {
  const pattern = pick(BASS_PATTERNS, rng);

  return pattern.map((hit) => {
    let pitch = chord.bassRoot;
    if (hit.role === 'fifth') pitch = chord.bassRoot + 7;
    else if (hit.role === 'octave') pitch = chord.bassRoot + 12;
    else if (hit.role === 'approach') {
      // Lead into the next root from a semitone away — the line arrives
      // somewhere instead of just restarting.
      const target = nextChord.bassRoot;
      pitch = target + (target > chord.bassRoot ? -1 : 1);
    }

    return {
      step: hit.step,
      note: toNoteName(pitch, chord.useFlats),
      duration: hit.duration,
      velocity: 0.6 + rng() * 0.15,
    };
  });
}
