// One bus every voice lands on, so levels are predictable and a limiter
// catches peaks before they reach the speakers.
//
// The lowpass is doing real work: full-bandwidth synth voices are what made
// the kit sound brittle and the peaks read as crackle. Rolling the top off
// is also simply how this music sounds. It sits above the hats' band though
// -- at 7.2k it met the hats' 6.5k highpass and left them a dead slot.
// A highpass takes out sub-40Hz rumble that only eats headroom.
//
// The reverb is shared and algorithmic. Each voice used to own a Tone.Reverb,
// which is a *convolution* reverb: a 4-second tail means convolving every
// sample against ~176,000 of them, twice over. That is what was starving the
// audio thread and breaking the playback up. Freeverb is a handful of comb
// and allpass filters and costs almost nothing by comparison.

export function createMaster() {
  const limiter = new Tone.Limiter(-3).toDestination();
  const warmth = new Tone.Filter({ frequency: 9500, type: 'lowpass', rolloff: -12 }).connect(limiter);
  const rumble = new Tone.Filter({ frequency: 38, type: 'highpass', rolloff: -12 }).connect(warmth);
  const bus = new Tone.Volume(-4).connect(rumble);

  const reverb = new Tone.Freeverb({ roomSize: 0.82, dampening: 1800, wet: 1 }).connect(bus);
  const send = new Tone.Gain(0).connect(reverb);

  return { bus, send };
}
