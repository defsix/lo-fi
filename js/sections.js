// The arrangement.
//
// Until now the engine played one texture forever: every bar had the same
// instruments doing the same density of the same thing, and no amount of
// per-bar variation fixes that — the ear hears the shape of a piece over
// tens of bars, not the detail within one.
//
// The genre's own convention is an intro of chords and noise, a main groove,
// a stripped breakdown, a variation, and an outro, with elements entering and
// leaving on four- and eight-bar boundaries. For an endless stream the same
// idea becomes a cycle: it never ends, but it is always somewhere.
//
// Nothing here is dramatic. Lo-fi lives on repetition; the arrangement is
// what stops repetition becoming wallpaper, and it does that by removing
// things as much as by adding them.

// `voices` gates what plays. `density` scales how busy each part is, and
// `tone` opens or closes the master filter — a closed filter is how the
// genre signals "we are somewhere quieter" without changing the notes.
const SECTIONS = [
  {
    name: 'intro',
    bars: 8,
    voices: { keys: true, bass: true, lead: false, drums: false },
    density: 0.6,
    tone: 0.45,
  },
  {
    name: 'groove',
    bars: 8,
    // Drums arrive, but the melody waits: one element at a time.
    voices: { keys: true, bass: true, lead: false, drums: true },
    density: 0.8,
    tone: 0.8,
  },
  {
    name: 'main',
    bars: 16,
    voices: { keys: true, bass: true, lead: true, drums: true },
    density: 1,
    tone: 1,
  },
  {
    name: 'breakdown',
    bars: 8,
    // The drums drop out. This is the section that makes the next one land.
    voices: { keys: true, bass: true, lead: true, drums: false },
    density: 0.5,
    tone: 0.4,
  },
  {
    name: 'lift',
    bars: 16,
    voices: { keys: true, bass: true, lead: true, drums: true },
    density: 1,
    tone: 1,
  },
  {
    name: 'drift',
    bars: 8,
    // Thins out before the cycle turns over, so the return to the groove
    // feels like an arrival rather than a loop point.
    voices: { keys: true, bass: true, lead: true, drums: true },
    density: 0.65,
    tone: 0.7,
  },
];

// The intro plays once. After that the cycle skips it — a stream that
// restarts from silence every three minutes sounds broken, not composed.
const FIRST_CYCLE_LENGTH = SECTIONS.reduce((sum, s) => sum + s.bars, 0);
const LOOP_SECTIONS = SECTIONS.slice(1);
const LOOP_LENGTH = LOOP_SECTIONS.reduce((sum, s) => sum + s.bars, 0);

export function sectionAt(bar) {
  let sections = SECTIONS;
  let position = bar;

  if (bar >= FIRST_CYCLE_LENGTH) {
    sections = LOOP_SECTIONS;
    position = (bar - FIRST_CYCLE_LENGTH) % LOOP_LENGTH;
  }

  for (const section of sections) {
    if (position < section.bars) {
      return {
        ...section,
        barInSection: position,
        // True on the last bar, so the drums can turn the phrase over.
        isLastBar: position === section.bars - 1,
      };
    }
    position -= section.bars;
  }

  return { ...sections[0], barInSection: 0, isLastBar: false };
}

// Where a fresh key and progression is least disruptive: the top of the
// cycle, where the music has just thinned out anyway.
export function isCycleStart(bar) {
  if (bar < FIRST_CYCLE_LENGTH) return false;
  return (bar - FIRST_CYCLE_LENGTH) % LOOP_LENGTH === 0;
}
