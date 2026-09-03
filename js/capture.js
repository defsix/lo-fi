// Captures the engine's output straight off the bus to a file.
//
// A phone recording of a speaker cannot answer questions about the engine: a
// voice recorder highpasses, gates and auto-levels, so its noise floor, its
// presence boost and its gating land in the measurement and swamp whatever
// the engine produced. This taps the signal before it reaches a speaker, so
// the file holds what the browser rendered on that device and nothing else.
//
// Tone.Recorder encodes to webm/opus rather than PCM. Lossy, and the reason
// is that raw PCM is not reachable here: ScriptProcessor is gone from the
// standardized-audio-context wrapper Tone builds on, an AudioWorklet node
// won't construct against that wrapper, and a polled analyser can't produce
// contiguous samples — its gaps would look exactly like the dropouts we are
// hunting for. Compression is fine for that hunt: a dropout is silence or a
// step lasting milliseconds and survives any codec. It is *not* fine for
// judging fine spectral detail, so treat band balance from a capture as
// indicative and trust tools/analyse-spectrum.mjs for that instead.

export async function capture(source, seconds, onProgress) {
  const recorder = new Tone.Recorder();
  source.connect(recorder);
  recorder.start();

  const started = Date.now();
  await new Promise((resolve) => {
    const tick = setInterval(() => {
      const done = (Date.now() - started) / (seconds * 1000);
      if (onProgress) onProgress(Math.min(1, done));
      if (done >= 1) {
        clearInterval(tick);
        resolve();
      }
    }, 250);
  });

  const blob = await recorder.stop();
  try {
    source.disconnect(recorder);
  } catch (err) {
    // already torn down
  }
  recorder.dispose();
  return blob;
}
