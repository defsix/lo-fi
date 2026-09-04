# Bug report: Web Audio crackling in Firefox for Android 155

Ready to paste. Everything below the line is the report itself.

## Where to file it

**Bugzilla → Core → Audio/Video: cubeb** — cubeb is Firefox's audio output
layer, which is where the evidence points.

<https://bugzilla.mozilla.org/enter_bug.cgi?product=Core&component=Audio%2FVideo%3A+cubeb>

You need a Bugzilla account (free, email sign-up). Set:

- **Component:** Audio/Video: cubeb
- **Version:** Firefox 155
- **Hardware / OS:** ARM / Android
- **Summary:** the title below

Worth also adding a short comment with a link to your new bug on
[bug 1750282](https://bugzilla.mozilla.org/show_bug.cgi?id=1750282), the open
Android crackling report, so the two are connected. Do not file it *as* a
duplicate: that one predates this Firefox version and has no device
comparison in it.

If you would rather not use Bugzilla, [Mozilla Connect][connect] takes
reports from users and Mozilla staff read it, but a bug with this much
evidence belongs in Bugzilla.

[connect]: https://connect.mozilla.org/

---

## Summary

Web Audio output crackles on some Android devices in Firefox 155 far more
severely than Chrome on the same device with the same content, and is clean
in Firefox on another Android device

## Steps to reproduce

1. On an affected Android device, open <https://defsix.github.io/lo-fi/> in
   Firefox and press play.
2. Listen for 20 seconds.

A reduced, library-free page of individual Web Audio tests is at
<https://defsix.github.io/lo-fi/audio-test.html>. It also prints the audio
context's sample rate and latencies.

## Actual result

Continuous crackling and popping throughout playback, and markedly worse
than Chrome on the same device — by roughly a factor of ten, judged by ear.

## Expected result

Playback no worse than Chrome on the same device, and clean as in Firefox
on the Xperia below.

Note on scope, stated up front rather than discovered later: this page had
its own performance problems, they were found and fixed, and both browsers
improved. Chrome is not fully clean either. What separates them is
magnitude — on the same device, same page, same build, Firefox is roughly
ten times worse than Chrome by the reporter's ear.

## Device comparison

All three run Firefox 155.0 and report a 48000 Hz context.

| device | Android | output latency | result |
|---|---|---|---|
| Sony Xperia XQ-BC52 | 13 | 7.7 ms | clean |
| Pixel 10 Pro | 17 | 14.7 ms | crackles |
| Samsung Galaxy Tab S5 | (desktop-site UA) | 80.0 ms | crackles, worst |

Chrome is clean on all three. Desktop Firefox 155 is clean.

## What has been ruled out

The page is a generative audio engine built on Tone.js. The following were
each tested rather than assumed:

- **The audio the page produces.** The engine's output was captured from its
  own master bus in Firefox on an affected device, using MediaRecorder, and
  analysed: zero sample-to-sample discontinuities, no samples at or over full
  scale, peak −3.7 dBFS. That captured file plays back cleanly on the same
  device that crackles live. So the graph renders correct audio and the
  problem is downstream of it.
- **Every effect.** Bypassing reverb, chorus, tremolo, feedback delay and
  the limiter together changes nothing.
- **The entire master chain.** Routing the bus straight to the destination —
  no filters, no limiter, no gain staging — still crackles.
- **The cost of the graph — partly, and honestly not entirely.** The page
  did have a real capacity problem: it rebuilt synth voices on the main
  thread while playing, and asked for the browser's smallest output buffer.
  Both are fixed (a fixed voice pool, and `latencyHint: 'playback'`),
  cutting main-thread blocking from 125 to 91 ms per second and taking the
  output buffer from 441 to 1024 samples. Both browsers improved and
  **neither is fully clean**, so graph cost is not excluded as a
  contributing factor and work on it continues. What is not explained by
  cost alone is the gap: on identical hardware and build, Firefox is about
  ten times worse than Chrome, and a reduced build (`?light`:
  single-oscillator voices, no effects, one biquad on the master) does not
  close it.
- **Buffer size.** This looked like the obvious cause and the data refutes
  it: output latency across the three devices spans a factor of ten and runs
  the wrong way, with the *cleanest* device reporting the *least* buffering
  (7.7 ms) and the worst reporting by far the most (80 ms). Requesting more
  via `latencyHint`, including an explicit number of seconds, does not help.
- **Hardware.** Three devices with different SoCs.
- **Bug 1947917** (the Firefox 135 AAudio regression, fixed in 136). This is
  Firefox 155.

Notably, the reduced test page is *clean* on an affected device: a plain
`<audio>` element, a single oscillator, a small graph, a new oscillator
started and stopped per note at four notes per second, and a permanently
running oscillator gated by a gain envelope all play without artifacts. Only
the larger engine crackles, so the trigger appears to be scale — number of
nodes, or density of scheduled AudioParam automation — rather than any
individual operation.

## Additional information

The variable that tracks the symptom across the two devices whose OS version
is visible is the Android version: Android 13 clean, Android 17 crackling,
on the same Firefox build and the same sample rate.

Happy to run further diagnostics — the page has switches to disable
individual voices, effects, the visualiser and the analysers
(`?bypass=drums,keys,lead,bass,visual,meters,master,filters,reverb,chorus,tremolo,delay,limiter`),
a `?light` reduced build, `?latency=` to set the hint, and `?debug` for an
in-page capture button and a latency readout.
