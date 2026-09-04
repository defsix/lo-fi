# Crackling audio in Firefox for Android

A long investigation, kept because the conclusion is "not our bug" and that
is exactly the kind of finding that gets re-investigated from scratch a year
later.

## Symptom

Continuous crackling and popping during live playback in Firefox for
Android. Chrome on the same devices is clean. Desktop Firefox is clean.

## What it is not

Each of these was tested, not assumed.

- **Not the composition or the mix.** The engine's own output, captured off
  the bus with `?debug`, is clean: zero discontinuities, nothing over full
  scale. The file plays back perfectly on the device that crackles live.
- **Not any effect.** `?bypass=reverb,chorus,tremolo,delay,limiter` changes
  nothing.
- **Not the master chain.** `?bypass=master` sends the bus straight to the
  destination. Still crackles.
- **Not the cost of the graph.** `?light` uses single-oscillator voices with
  no effects and cuts late notes sevenfold under an 8x CPU throttle. Still
  crackles.
- **Not Web Audio on the device.** A library-free test page
  (`audio-test.html`) plays a `<audio>` element, a bare oscillator, a small
  graph, a new node per note, and a permanently gated note — all clean.
- **Not node churn.** Building and stopping an oscillator per note, four
  times a second, is clean on the device that crackles.
- **Not the hardware.** Three devices with different silicon.
- **Not the Firefox 135 AAudio regression** ([bug 1947917][1], fixed in 136).
  This is Firefox 155.
- **Not buffer size, though it looked like it.** The obvious theory was that
  a small output buffer leaves the render callback no slack. The data says
  the opposite: the device that plays *cleanly* has the *smaller* buffer.

## The device matrix

| device | Android | Firefox | rate | output latency | result |
|---|---|---|---|---|---|
| Sony Xperia XQ-BC52 | 13 | 155.0 | 48000 | 7.7 ms | clean |
| Pixel 10 Pro | 17 | 155.0 | 48000 | 14.7 ms | crackles |
| Galaxy Tab S5 | reports desktop UA | 155.0 | 48000 | 80.0 ms | crackles, worst |

Same browser build, same sample rate, three different results. Buffering is
conclusively not the mechanism: the amount of it spans a factor of ten and
runs the wrong way, with the *cleanest* device having the *least* and the
worst having by far the most. Anything that asks for a bigger buffer,
`latencyHint` included, is aimed at the wrong thing.

The tablet reports `X11; Linux x86_64`, which is Firefox's desktop-site mode
rather than a real desktop, so its Android version is masked and it cannot
join the version correlation. Of the two that can, the clean one is on
Android 13 and the failing one on 17.

## What to try

`media.cubeb_latency_playback_ms` in `about:config` is the preference that
governs cubeb's playback buffering, and changing it has resolved related
crackling for other people. It is a browser setting; nothing in a web page
can reach it. `latencyHint`, including an explicit number of seconds via
`?latency=0.2`, is only a hint and evidently does not map onto it here.

## What we are not doing about it

Nothing further in this codebase. The engine has been excluded by
measurement at every layer, and changing the music to work around one
browser's audio backend on one Android version would cost real quality for a
fault we have shown is not ours.

The diagnostic switches stay, because they are how any of this was
established: `?bypass=` (drums, keys, lead, bass, visual, meters, master,
filters, reverb, chorus, tremolo, delay, limiter), `?light`, `?latency=`,
and `?debug` for the capture button and the latency readout.

[1]: https://bugzilla.mozilla.org/show_bug.cgi?id=1947917
