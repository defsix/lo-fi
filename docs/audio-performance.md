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

## The screen going off is a different fault

Reported separately and worth not conflating with the crackle: on the Pixel
the track stutters mildly when it reaches the main section, and then, when
the screen sleeps, collapses into barely any playback at all.

The second one is not capacity. Tone schedules notes from a timer and hands
them to Web Audio a fraction of a second before they sound; audio already
scheduled keeps rendering, anything not yet scheduled never arrives. When
Android stops servicing our timers the engine goes quiet within one
lookahead window, which is exactly the reported symptom.

`js/background.js` looks 4 seconds ahead instead of 0.3 while hidden, so a
throttled timer still leaves continuous music behind it.

The second half took two attempts. The first played a *separate* silent
element alongside the Web Audio, on the theory that any playing media would
keep the page alive. Tested on the device: no lock-screen controls, no
improvement. Two reasons, both documented by Chrome and neither guessed
correctly the first time — [full audio focus is only granted to media
longer than five seconds][8], and there is [no media notification for Web
Audio at all unless it is played back through an audio element][9]. A
sibling element could never have worked.

So `?stream` routes the mix itself into a `MediaStreamAudioDestinationNode`
and plays *that* through an `<audio>` element. Measured, the speakers path
drops to zero and the stream carries the full signal at the same level, so
the mix moves rather than doubling.

**Tested on the Pixel, and it does not work either.** No lock-screen
controls, background playback still around a tenth audible, and no change
to the crackle. The likely reason is that a live `MediaStream` has no
duration, and the five-second rule that grants full audio focus cannot be
satisfied by something that never ends.

The six-second element did eventually produce **lock-screen controls in
Chrome**, so media session works. It did not restore playback, which says
audio focus alone does not stop Android freezing the timers.

### The horizon was the answer, and it was set eight times too small

Declaring this unachievable was premature. Notes handed to Web Audio play
on the **audio thread**, which keeps rendering with the screen off; only
the *scheduling* is frozen. So the question was never whether we can stop
Android throttling us — it is how much music each timer firing leaves
behind before the freeze.

The first attempt used a four-second horizon. If a throttled timer fires
about once a minute that is roughly 7% of a minute with sound, and the
phone reported 10-15%. The arithmetic matching the symptom is what
identified the mistake.

Measured, with the main thread frozen solid for ten seconds:

| hidden lookahead | audible while frozen |
|---|---|
| a fraction of a second | 5% |
| 30 seconds | 79-85% |

**And on the actual phone, thirty seconds was worse than useless: the music
stopped dead the instant the screen went off, where four seconds had at
least limped along at 10-15%.** So the horizon is back to four, with
`?horizon=` exposing the dial.

The reason is almost certainly that the horizon is not free to reach.
Widening it makes the engine write every note between here and there in one
synchronous burst — hundreds of them — on a main thread that is about to be
throttled, and asks a twelve-voice pool to hold half a minute of
overlapping notes at once. A desktop absorbs that burst. A phone is broken
by it. The headless measurement could not see this for the same reason it
could not see the visualiser: the cost being measured did not exist on the
hardware doing the measuring.

That is the third time in this investigation that a result from the
throttled harness inverted on real hardware. The harness is useful for
mechanism and useless for magnitude, and nothing from it should be believed
about a phone until a phone has said so.

This has a consequence that had to be handled first: at the moment stop is
pressed, half a minute of music is already committed to the voices at times
that have not arrived, and `releaseAll` cannot reach a note that has not
attacked. Measured, stop left the output at 0.24 peak for six seconds. So
`stop()` now silences the bus, then tears the whole graph down — voices,
sequence, analysers and the master chain, which has to go too because the
reverb send is fed in parallel with the bus and keeps sounding after it.
The next play rebuilds. After the fix: 0.086 in the first second as release
tails decay, then silence.

The user-side lever remains Android's per-app battery setting, Optimised to
Unrestricted, which no web page can reach.

`?stream` stays, opt-in, because it costs nothing and the platform may
change. `?bypass=keepalive` disables the element side for comparison.

Firefox fixed background-tab `setTimeout` throttling for pages with an
AudioContext in Firefox 50 ([bug 1181073][7]), but that is desktop tab
throttling; screen-off on Android is the platform suspending the process,
which is a different mechanism.

The thing no page can reach is the browser's own Android battery setting.
Per-app "Optimised" versus "Unrestricted" is widely reported as the single
most effective fix, and it belongs to whoever holds the phone.

## Where it actually is: not the synthesis

The plan after all the above was to render the voices to buffers, on the
strength of every measurement pointing at the keys — bypassing them took
late notes to zero, and an FM voice is two oscillators and two envelopes
against one interpolated read for a buffer.

One test on the device stopped that: **`?light` crackles the same as the
full build.** Single-oscillator voices, no reverb, chorus, tremolo or
delay, and it fails identically. Meanwhile `audio-test.html`, which is
library-free, runs 24 simultaneous oscillators and an automation storm on
the same device without artifacts.

So the cost of *synthesis* is not the driver, and a buffer rewrite would
have been a day spent on the wrong thing. What separates the clean
library-free page from the crackling engine is not oscillator count. It is
everything else in between: Tone's scheduling layer and the
standardized-audio-context shim it wraps every node in, per-note envelope
automation, the analysers, and a canvas redrawing at 2.3x device pixel
ratio.

That is the live suspect list, and it is a different investigation from the
one that produced the fixes above. Those fixes stand on their own
measurements — the voice churn and the undersized buffer were both real —
they were simply not the whole of it.

## The visualiser was a real cost, and the measurements hid it

On the Pixel, `?light&bypass=visual,meters` played at about 97% good on an
awake screen — the first configuration that essentially worked. `?light`
alone did not. So the difference was not the cheap synths. It was removing
the canvas and the analysers.

Two faults in the drawing code, both invisible on a desktop:

- The canvas sized itself to the full device pixel ratio. At the Pixel's
  2.3 that is 5.3x the pixels to fill, on the machine least able to afford
  them, for sixty-four heavily smoothed bars. Capped at 1, and they look
  the same.
- The draw loop started at page load and ran for the life of the tab,
  drawing a flat line at full rate over a silent engine. It now runs only
  while playing.

Measured at 2.3 device pixel ratio: 70,680 canvas pixels against roughly
374,000, at 20 frames a second rather than 30, and zero draws while
stopped. About eight times less work while playing.

Worth recording why this took so long to find. `?bypass=visual,meters` was
tested early and appeared to change nothing, so the visualiser was
dismissed. That test ran in a headless container where a canvas is nearly
free — the cost being measured did not exist on the hardware doing the
measuring. Every conclusion in this file that came from the throttled
harness carries that caveat: it can measure main-thread pressure, but only
the pressure that hardware actually feels.

## What did work: media session

The five-second rule was the blocker. With a six-second silent element,
**lock-screen controls appear in Chrome.** Playback with the screen off is
still degraded, so audio focus by itself does not stop Android throttling
the timers that schedule notes, but the media session half is now working
and the controls are wired to play and stop.

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

## The architecture question, asked too late

Everything above optimises *live* synthesis. The question that should have
come first is whether live synthesis is the right architecture for a phone
at all, and the answer is probably not.

The alternative is standard and was named here only in passing, as
"encode in the browser and feed Media Source Extensions", called large, and
dropped in favour of recommending a server. That was wrong on both counts.
Render the music to audio in chunks of thirty seconds or so, play each
chunk through an `<audio>` element, and queue the next while the current one
plays. Generation stays in the browser.

It inverts the exact arithmetic that beat us. Live scheduling needs the
main thread every fraction of a second, forever. Chunked rendering needs a
burst of CPU per chunk and then nothing at all — an `<audio>` element plays
with no JavaScript running, which is precisely what a locked phone allows.
It also gets background playback and lock-screen controls for free, because
it is a finite, seekable media resource, which is the thing Android wanted
all along and a live synthesiser could never provide.

The cost is whether the device can render faster than it plays. Measured
here with `Tone.Offline` on the real voices and master chain: 1.6x realtime
for the full graph, 2.6x with reverb, chorus, tremolo and delay bypassed —
so the reverb is about 40% of it. CPU throttling does not reach the offline
render thread, so those numbers are not a phone proxy and nothing here can
make them one.

`render-test.html` got that number on the device, and it settles it:

| browser | 30s rendered in | vs realtime |
|---|---|---|
| Firefox 155 | 7.02 s | **4.27x** |
| Chrome | 14.53 s | **2.07x** |

Both played cleanly, both survived the screen going off, both showed
lock-screen controls.

Firefox being the *faster* one is the reverse of live playback, where it was
about ten times worse, and the reason matters: rendering offline never
touches cubeb, the audio output backend its bug lives in. So this
architecture does not merely fix screen-off playback — it routes around the
Firefox problem as well, which is where "browser agnostic" comes from.

### What was built

- `js/compose.js` — the composition, separated from the transport, so live
  and rendered paths share one answer to "what happens in bar 37". It also
  centralises a real bug: the groove moves notes across step boundaries, so
  a ghost can land before a snare on an adjacent step and a monophonic voice
  rejects the second. Events are now sorted per voice in one place. And
  times are clamped at zero, because on bar 0 the groove pulls the first
  note to a negative time, which Web Audio rejects outright — that was
  killing every render after the second.
- `js/render.js` — renders N bars offline plus a 2.5 s tail, so reverb and
  releases finish rather than being cut mid-decay.
- `js/stream.js` — two alternating `<audio>` elements. The next chunk starts
  as the current one's *music* ends, so the outgoing tail rings over the
  incoming downbeat. An `<audio>` element cannot be started with sample
  accuracy; putting the handover inside the tail is what makes that not
  matter.
- `stream.html` — the player.

Measured over 30 s and two handovers: longest silence 100 ms, shorter than
a musical rest. At a 16-bar chunk, handover fires at 51.79 s against 51.9 s
of music, with both elements sounding across the seam.

### Chunks start short and grow

A first chunk of 52 seconds means 25 seconds of silence after pressing
play, which is not a thing to ask of someone who just pressed play. So the
first chunk is two bars, and the size climbs once sound is going.

How fast it may climb is arithmetic, not taste. Chunk N renders while chunk
N-1 plays, so `render(b) <= safety * play(bars)`, which gives
`b <= safety * bars * ratio` — and the ratio is measured from each render
rather than assumed, so a slow device is handled by the same rule as a fast
one. With safety at 0.75 and the ratios measured on the Pixel:

| | ramp | reaches 16 bars |
|---|---|---|
| Firefox, 4.27x | 2 → 6 → 16 bars | ~26 s |
| Chrome, 2.07x | 2 → 3 → 4 → 6 → 9 → 13 → 16 | ~2 min |
| a device at 1.1x | holds at 2 bars | never, correctly |

Nothing is forced. A first version grew by at least a bar each time regardless
of what the device could afford, which at 1.3x meant asking for three bars
during two bars of playback — arithmetic that cannot be met — and it ran at
the edge of stalling. Holding is right when growth is unaffordable, and
shrinking is what keeps the music going when even the current size is.

## Verdict on live screen-off playback

Not achievable here. Four approaches, each reasoned from documentation or
measurement: a silent sibling element, a six-second one, the real mix
through a MediaStream, and a thirty-second scheduling horizon. The media
session half works — lock-screen controls appear in Chrome — and playback
does not. The last attempt made it worse than doing nothing.

What reliably gets background audio on Android is an `<audio>` element with
a finite, seekable resource, and a synthesiser generating sound live has
none to offer. The remaining routes are large: encode in the browser and
feed Media Source Extensions, or ship as an installed app. The user-side
lever is Android's per-app battery setting, which no page can reach.

## Outcome so far

Both browsers improved on the Pixel 10 Pro. **Neither is fixed.** Firefox
remains roughly ten times worse than Chrome by ear, on the same device and
build.

So the capacity problem is reduced, not solved, and these two fixes were
not the whole of it. What they do establish is that voice churn and buffer
size were both real contributors, and that the remaining cost is worth
attacking: the prior art points at rendering voices to buffers once at
startup and playing those back, which is the difference between a buffer
read and live FM per note.

An earlier version of this file claimed Chrome was clean. That was written
from a first listening impression and was wrong; longer listening found
Chrome still fails, just far less. Recorded because the same mistake had
already been made once in this investigation, by trusting a measurement
that could not see what it was asked about.

[1]: https://github.com/Tonejs/Tone.js/issues/604
[2]: https://github.com/Tonejs/Tone.js/issues/188
[3]: https://github.com/Tonejs/Tone.js/issues/558
[4]: https://github.com/WebAudio/web-audio-api/issues/2632
[5]: https://padenot.github.io/web-audio-perf/
[6]: https://github.com/generativefm/generative.fm
[7]: https://bugzilla.mozilla.org/show_bug.cgi?id=1181073
[8]: https://developer.chrome.com/blog/media-notifications
[9]: https://developer.chrome.com/blog/media-session
