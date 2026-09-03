// One bus every voice lands on, so levels are predictable and a limiter
// catches peaks before they reach the speakers. Voices used to connect to
// the destination individually, which left nothing between a stacked
// chord hit and the output.

export function createMaster() {
  const limiter = new Tone.Limiter(-2).toDestination();
  const volume = new Tone.Volume(-6).connect(limiter);
  return volume;
}
