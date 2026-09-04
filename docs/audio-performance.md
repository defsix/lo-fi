# Making it play on a phone

Chrome on a Pixel 10 Pro played the intro cleanly and then broke into
stutter and crackle around 30-40 seconds in — the point where the
arrangement brings the drums back and the texture fills out.

## It was not the arrangement

First thing worth ruling out, because the arrangement had just landed. The
previous commit was measured against the current one under identical CPU
throttling:

| build | late notes | worst |
|---|---|---|
| before sections | 8/412 — 1.94% | 128.6 ms |
| with sections | 5/223 — 2.24% | 52.1 ms |

The same rate, with a worse tail before. The engine had always been dropping
notes under load; the arrangement only gave the failure an obvious moment to
happen in, by putting a quiet intro in front of it.

## A note on measurement

The first several comparisons here were run by counting notes scheduled into
the past. That metric cannot resolve the differences it was being asked
about: identical code measured 2.50%, 4.14%, 1.28% and 1.71% across four
runs, because five discrete events per run means two notes either way swings
it by a percentage point. Two conclusions were drawn from it and both were
wrong.

Notes go late because the main thread, where Tone schedules, is blocked. So
measure that instead: event-loop delay sampled at 5 ms, several thousand
samples a run, plus the browser's own longtask record. That reproduces —
baseline came back at 133.2 and 125.2 ms/s of blocking on separate runs,
against 81.0 and 77.0 for the same variant.

## What was actually wrong

**Voice churn.** Tone's PolySynth builds a voice on first need and disposes
idle ones on a timer. For a fixed texture that settles. For an arrangement
that thickens and thins it never does: the keys pool cycled 12 → 11 → 10 →
9 → 12 every bar, for the whole track, tearing down and rebuilding an FM
voice — two oscillators, two envelopes, their gains — on the main thread
while the music played.

Bypassing the keys took late notes to exactly zero, against ~4% for
everything else bypassed in turn, so the keys were the whole cost. Since
longtask measures the main thread and synthesis runs on the audio thread,
the cost had to be construction rather than DSP.

The fix is a fixed pool: every voice built up front, collector stopped.
Idle voices have stopped oscillators, so the DSP is unchanged and only the
churn goes.

| | main-thread blocking | max lag | musical cost |
|---|---|---|---|
| baseline | 125.2 ms/s | 463 ms | — |
| fixed pool | 90.8 ms/s | 266 ms | none |
| pool + polyphony capped at 8 | 82.9 ms/s | 238 ms | drops notes |
| polyphony capped at 8 | 77.0 ms/s | 214 ms | drops notes |

Capping polyphony is slightly better and was not taken: at the cap Tone
drops notes rather than stealing voices, so it buys smoothness with missing
chord tones.

One trap worth recording. The collector runs on Tone's *context* timer, not
the window's, so it takes `context.clearInterval`. `window.clearInterval`
silently does nothing, which made this look like a dead end on the first
attempt and produced a confident, wrong "pre-allocation doesn't help".

**Buffer size.** The context asked for the browser's default, which in
Chrome is `interactive` — the smallest latency it can manage. That is the
right setting for an instrument someone plays and the wrong one for a
stream nobody plays. Measured in Chrome:

| latencyHint | buffer |
|---|---|
| `interactive` (was the default) | 441 samples |
| `balanced` | 441 samples |
| `playback` (now the default) | 1024 samples |
| `0.2` | 8192 samples |

2.3x more time for the audio thread to render each block, for 13 ms more
before sound starts.

This had been rejected once on the grounds that it did not move the
late-note rate. That was the wrong instrument twice over: the metric could
not resolve anything that size, and late notes measure the main thread
while buffer size protects the audio thread. Web Audio's own implementers
are explicit that a larger render quantum is what lets a bigger graph
render in time.

## Prior art

Worth knowing that none of this is novel. Tone.js carries repeat reports of
Android crackling on its own examples ([#604][1], [#188][2], [#558][3]),
all clean on desktop. There is an open complaint that the mandated
128-sample render quantum [causes distortion across mobile devices][4].
[Paul Adenot's performance notes][5] are the reference for the buffer-size
point and for cheap reverb from delay lines rather than convolution, which
is what the master chain already does.

The larger structural point: [generative.fm][6], the most established
generative-music site, does not synthesise. It fetches audio samples and
schedules them on Tone's Transport, because buffer playback is far cheaper
than oscillators. This engine is committed to synthesising everything, so
the comparable move would be rendering its own voices to buffers once at
startup and playing those back — still nothing sampled from anyone, but
buffer reads instead of live FM. Not done, and a large change.

## Outcome

Confirmed on the device: **Chrome on the Pixel 10 Pro is clean.** Both
fixes together did it, so density was the mechanism rather than thermal
throttling, and the listening test that would have separated them was not
needed.

Firefox 155 on the same device still crackles on the same build. That is
the separate backend problem recorded in `firefox-android-audio.md`, and
this result sharpens it: the page's own capacity problem is gone and Chrome
proves the graph renders in time on that hardware, so the browser is now
the only variable left.

[1]: https://github.com/Tonejs/Tone.js/issues/604
[2]: https://github.com/Tonejs/Tone.js/issues/188
[3]: https://github.com/Tonejs/Tone.js/issues/558
[4]: https://github.com/WebAudio/web-audio-api/issues/2632
[5]: https://padenot.github.io/web-audio-perf/
[6]: https://github.com/generativefm/generative.fm
