// Where each hit sits relative to the grid.
//
// The first version jittered every hit by a random +/-12ms, which is noise,
// not groove — it made the kit sound unsteady rather than human. Real feel
// is *directional* and consistent: hats on the beat play straight, the ones
// on the "and" are nudged late, and the snare sits behind the beat every
// time. Only a couple of milliseconds of randomness go on top.

// Sixteenth-note grid, 16 steps to the bar.
export const STEPS_PER_BAR = 16;

// Off-16ths ("e" and "a") land late — this is the shuffle. Kept well short
// of a triplet, which would tip it from swung into a different meter.
const SWING_MS = 34;

// The "and" of each beat gets a smaller push than the off-16ths.
const UPBEAT_MS = 12;

// Per-voice lag on top of the grid position.
const VOICE_LAG_MS = {
  kick: 0,
  snare: 20, // laid back — the single biggest contributor to the pocket
  hat: 6,
  ghost: 14,
  keys: 22, // chords land just after the beat, never on it
  bass: 8,
  lead: 16,
};

// Humanisation: small enough to blur the edges, not to unsteady the pulse.
const DRIFT_MS = { kick: 3, snare: 4, hat: 5, ghost: 5, keys: 7, bass: 4, lead: 9 };

function gridOffsetMs(step) {
  if (step % 4 === 0) return 0; // downbeat: straight
  if (step % 2 === 1) return SWING_MS; // the "e" and the "a"
  return UPBEAT_MS; // the "and"
}

// Seconds to add to a scheduled step time for this voice.
export function grooveOffset(step, voice, rng = Math.random) {
  const drift = (rng() - 0.5) * 2 * (DRIFT_MS[voice] || 0);
  return (gridOffsetMs(step) + (VOICE_LAG_MS[voice] || 0) + drift) / 1000;
}

// Velocity shape across the bar: downbeats carry weight, the backbeat
// answers, everything between stays quiet. Flat velocities read as machine.
export function accent(step) {
  if (step === 0) return 1;
  if (step === 8) return 0.92;
  if (step % 4 === 0) return 0.84;
  if (step % 2 === 0) return 0.62;
  return 0.48;
}
