// One bus every voice lands on, so levels are predictable and a limiter
// catches peaks before they reach the speakers.
//
// The lowpass is doing real work: full-bandwidth synth voices are what made
// the kit sound brittle and the peaks read as crackle. Rolling the top off
// is also simply how this music sounds. It sits above the hats' band though
// -- at 7.2k it met the hats' 6.5k highpass and left them a dead slot.
// The highpass sits at 50Hz and steeply: the bass fundamentals start at
// 65Hz and the kick now at 55Hz, so nothing musical lives underneath it,
// and what did live there was a noise bed no speaker could reproduce.
//
// The reverb is shared and algorithmic. Each voice used to own a Tone.Reverb,
// which is a *convolution* reverb: a 4-second tail means convolving every
// sample against ~176,000 of them, twice over. That is what was starving the
// audio thread and breaking the playback up. Freeverb is a handful of comb
// and allpass filters and costs almost nothing by comparison.

export function createMaster(bypass = new Set()) {
  // Each stage can be bypassed from the URL, so a browser-specific fault can
  // be bisected on the machine that actually has it.
  // -6 rather than -3, for headroom the file itself does not show a need
  // for. A signal can have no sample over full scale and still clip once the
  // browser resamples it to the device rate, because reconstruction
  // overshoots between the samples. That is inter-sample peaking, it is why
  // streaming targets leave about a decibel spare, and it produces exactly
  // the reported symptom: a clean capture and a distorted live output.
  // A trim after the limiter, because the limiter does not actually hold a
  // ceiling: it is a compressor, and its attack lets transients through
  // above the threshold. Measured, peaks were reaching -0.5dBFS against a
  // -6 threshold. This puts a fixed, predictable gap below full scale.
  const trim = new Tone.Gain(0.7).toDestination();
  const limiter = bypass.has('limiter')
    ? new Tone.Gain(1).connect(trim)
    : new Tone.Limiter(-6).connect(trim);
  // ?bypass=master sends the bus straight out, skipping every master stage.
  // This is the one part of the chain that has never been tested: the
  // capture taps the bus, which is *upstream* of all of it.
  if (bypass.has('master')) {
    const bare = new Tone.Volume(-4).toDestination();
    return { bus: bare, send: new Tone.Gain(0) };
  }

  const warmth = bypass.has('filters')
    ? limiter
    : new Tone.Filter({ frequency: 9500, type: 'lowpass', rolloff: -12 }).connect(limiter);

  // A steep filter fed near-silence drives its state toward denormalised
  // floats. Chrome flushes those to zero on the audio thread; Firefox has
  // historically not, and the cost of denormal arithmetic shows up as CPU
  // spikes heard as crackle. Four cascaded biquads at 50Hz is the worst
  // case for it, which is why this is separately bypassable.
  // The steep version is four cascaded biquads; the light build uses one.
  const rumble = bypass.has('filters')
    ? warmth
    : new Tone.Filter({
        frequency: 50,
        type: 'highpass',
        rolloff: bypass.has('light') ? -12 : -48,
      }).connect(warmth);

  const bus = new Tone.Volume(-4).connect(rumble);

  if (bypass.has('reverb') || bypass.has('light')) return { bus, send: new Tone.Gain(0) };

  const reverb = new Tone.Freeverb({ roomSize: 0.72, dampening: 1600, wet: 1 }).connect(bus);

  // Nothing below 400Hz goes to the reverb. Low frequencies smeared over a
  // long tail stop reading as notes and start reading as rumble — measured
  // as a spectral flatness of 0.67 in the keys' low band, which is most of
  // the way to noise. Keeping bass out of the reverb is standard practice
  // for exactly this reason.
  const send = new Tone.Filter({ frequency: 400, type: 'highpass', rolloff: -12 }).connect(reverb);

  return { bus, send };
}
