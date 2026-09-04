// The tape and the record: what makes this lo-fi rather than clean jazz.
//
// The genre's character is largely damage. Wow and flutter from a tape
// machine that never ran at quite the right speed, the noise floor of vinyl,
// saturation from pushing a preamp, and the mix breathing against the kick.
// Without it the engine writes a tidy jazz sketch; with it the same notes
// sound like a record someone found.
//
// Targets are from the sources in lofi-reference.md: wow 0.5-2 Hz at 5-15%
// depth, saturation as a few dB of drive for glue rather than colour, vinyl
// as crackle over a high-frequency noise floor.
//
// All of it is optional. Clean is a real choice, not a degraded mode — some
// of this music is better without the dirt — and it is also the cheaper
// path, which matters on a device rendering to a deadline.

// --- vinyl ---------------------------------------------------------------

// Crackle is not white noise: it is sparse, sharp, and irregular. A noise
// source gated by random short bursts reads as dust in a groove, where
// steady noise just reads as hiss.
export function createVinyl(destination, { crackle = 0.5, hiss = 0.5 } = {}) {
  const parts = [];

  // The surface: a quiet, filtered noise floor sitting under everything.
  const hissFilter = new Tone.Filter({ frequency: 3800, type: 'highpass', rolloff: -12 }).connect(destination);
  const hissNoise = new Tone.Noise('pink').connect(hissFilter);
  hissNoise.volume.value = -46 + hiss * 8;
  hissNoise.start();
  parts.push(hissFilter, hissNoise);

  // The dust: bandpassed noise, opened in short irregular bursts. A envelope
  // per burst rather than a continuous source, so each one has an attack.
  const crackleFilter = new Tone.Filter({ frequency: 2600, type: 'bandpass', Q: 1.1 }).connect(destination);
  const crackleGain = new Tone.Gain(0).connect(crackleFilter);
  const crackleNoise = new Tone.Noise('white').connect(crackleGain);
  crackleNoise.volume.value = -20;
  crackleNoise.start();
  parts.push(crackleFilter, crackleGain, crackleNoise);

  return {
    parts,
    // Called once per bar with the bar's start time: schedules that bar's
    // pops. Done ahead of time rather than by a timer, because this has to
    // work in an offline render where no timer will ever fire.
    scheduleBar(time, seconds, rng = Math.random) {
      const pops = Math.round((3 + rng() * 5) * crackle);
      for (let i = 0; i < pops; i++) {
        const at = time + rng() * seconds;
        const level = (0.04 + rng() * 0.13) * crackle;
        // Short and asymmetric: fast in, slightly slower out.
        crackleGain.gain.setValueAtTime(0, at);
        crackleGain.gain.linearRampToValueAtTime(level, at + 0.0015);
        crackleGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.012 + rng() * 0.02);
        crackleGain.gain.setValueAtTime(0, at + 0.045);
      }
    },
  };
}

// --- tape ----------------------------------------------------------------

// Wow is the slow drift of a tape machine's speed; flutter is the faster
// wobble on top. Both are pitch modulation, made here by modulating a short
// delay — the standard way, and cheaper than resampling.
export function createTapeWobble(destination, { depth = 0.5 } = {}) {
  const parts = [];
  const delay = new Tone.Delay({ delayTime: 0.006, maxDelay: 0.05 }).connect(destination);

  // 0.5-2 Hz for wow, per the sources. Slow enough to hear as drift rather
  // than vibrato.
  const wow = new Tone.LFO({ frequency: 0.7, min: 0.004, max: 0.004 + 0.005 * depth }).start();
  wow.connect(delay.delayTime);

  // Flutter is faster and much shallower; it thickens rather than bends.
  const flutter = new Tone.LFO({ frequency: 6.3, min: -0.0006 * depth, max: 0.0006 * depth }).start();
  const flutterScale = new Tone.Gain(1);
  flutter.connect(flutterScale);
  flutterScale.connect(delay.delayTime);

  parts.push(delay, wow, flutter, flutterScale);
  return { parts, node: delay };
}

// Every helper here connects to a destination and exposes `node` as its own
// input, so a chain is built back to front: the last stage first, then each
// earlier stage pointed at the one after it.
//
// Saturation for glue. A gentle curve, driven a few dB, not an effect you
// are meant to notice on its own.
export function createSaturation(destination, { amount = 0.4 } = {}) {
  const shaper = new Tone.WaveShaper((x) => {
    // Soft asymmetric clip: tanh-ish, with a touch of second harmonic, which
    // is what makes tape sound warm rather than merely squashed.
    const k = 1 + amount * 2.5;
    return Math.tanh(k * x) * 0.92 + 0.04 * Math.tanh(k * x * x);
  }, 2048).connect(destination);
  return { parts: [shaper], node: shaper };
}

// --- pump ----------------------------------------------------------------

// The mix breathing against the kick. Not a compressor here: an explicit
// duck, scheduled with the drums, because it has to be identical in an
// offline render and a compressor's behaviour depends on what reaches it.
export function createPump(destination, { depth = 0.35 } = {}) {
  const gain = new Tone.Gain(1).connect(destination);
  return {
    parts: [gain],
    node: gain,
    duck(time, amount = depth) {
      const floor = Math.max(0.2, 1 - amount);
      gain.gain.cancelScheduledValues(time);
      gain.gain.setValueAtTime(1, time);
      // Down fast, back up over most of a beat: the shape is the groove.
      gain.gain.linearRampToValueAtTime(floor, time + 0.012);
      gain.gain.exponentialRampToValueAtTime(1, time + 0.42);
    },
  };
}
