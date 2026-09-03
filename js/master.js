// One bus every voice lands on, so levels are predictable and a limiter
// catches peaks before they reach the speakers.
//
// The lowpass is doing real work: full-bandwidth synth voices are what made
// the kit sound brittle and the peaks read as crackle. Rolling the top off
// is also simply how this music sounds.

export function createMaster() {
  const limiter = new Tone.Limiter(-3).toDestination();
  const warmth = new Tone.Filter({ frequency: 7200, type: 'lowpass', rolloff: -12 }).connect(limiter);
  const volume = new Tone.Volume(-4).connect(warmth);
  return volume;
}
