// Why some chords sound muddy, from first principles.
//
// Two tones closer together than roughly one critical band fall on
// overlapping regions of the basilar membrane and beat against each other
// instead of fusing. That beating is heard as roughness. Critical bands are
// a roughly fixed width in Hz but a *widening* width in semitones as pitch
// falls, which is why a minor third is sweet at the top of the keyboard and
// mud at the bottom.
//
// Arrangers encode this as a "low interval limit" table. Rather than copy
// the table, the same limits are derived here from the Glasberg & Moore
// equivalent rectangular bandwidth, so the rule scales to any interval.

const ERB_K = 0.7; // separation required, as a fraction of one ERB

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Glasberg & Moore (1990): the width of the auditory filter at f, in Hz.
export function erb(frequency) {
  return 24.7 * (0.00437 * frequency + 1);
}

// True when two pitches are far enough apart to be heard as two notes
// rather than as one rough one.
export function isClear(lowMidi, highMidi) {
  const lowHz = midiToFreq(lowMidi);
  const separation = midiToFreq(highMidi) - lowHz;
  return separation >= ERB_K * erb(lowHz);
}

// The lowest MIDI note at which an interval of `semitones` stays clear, or
// null when it never does. A semitone spans a smaller fraction of the
// spectrum (5.9%) than an ERB does (~10.8% of centre frequency at the top
// end), so a minor 2nd sits inside one critical band at every pitch — which
// is exactly why semitone clusters buzz wherever you put them.
export function lowIntervalLimit(semitones) {
  for (let midi = 12; midi <= 108; midi++) {
    if (isClear(midi, midi + semitones)) return midi;
  }
  return null;
}

// Lifts notes out of the mud: any pitch too close to the one below it gets
// moved up an octave until the pair reads clearly. Applied to a voicing this
// turns a close stack into the spread the genre wants, for an acoustic
// reason rather than as a style preference.
export function declutter(midiNotes) {
  const sorted = [...midiNotes].sort((a, b) => a - b);
  const out = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    let note = sorted[i];
    let guard = 0;
    // Two octaves is the ceiling: a minor 2nd is inside a critical band at
    // every pitch, so an uncapped loop would chase it off the keyboard.
    while (!isClear(out[out.length - 1], note) && guard < 2) {
      note += 12;
      guard++;
    }
    out.push(note);
  }

  return out;
}
