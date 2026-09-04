# Lo-fi reference

The spec the engine is built against. Every number here is either taken from
a cited source or measured from our own output — nothing is here because it
felt right. Sources are listed at the bottom.

This is about *conventions and technique*, not about copying anyone's music.
Nothing is sampled or transcribed; what follows is how the genre is built.

---

## 1. Why these chords sound the way they do

Start below the music theory, at the ear.

**Simple frequency ratios fuse; complex ones beat.** The octave is 2:1, the
fifth 3:2, the fourth 4:3, the major third 5:4. The 9th of a chord is
literally the 9th partial of the harmonic series, which is why 9ths sound
like colour rather than like a wrong note.

**Roughness comes from the critical band.** Two tones closer than roughly one
critical bandwidth land on overlapping regions of the basilar membrane and
beat against each other instead of fusing. That beating is heard as
roughness — the "muddy" sensation.

The width of that band is given by Glasberg & Moore's equivalent rectangular
bandwidth:

```
ERB(f) = 24.7 × (0.00437·f + 1)    Hz
```

This is roughly constant in Hz but *widens in musical terms* as pitch falls:
at 1 kHz an ERB is about 132 Hz (≈2 semitones), at 100 Hz it is about 35 Hz
(≈5 semitones). A minor third is sweet at the top of the keyboard and mud at
the bottom — not by convention, but because of the ear.

**This is where "low interval limits" come from.** Arrangers keep a table of
the lowest pitch at which each interval stays clear. Rather than copy the
table, `js/voicing.js` derives it: an interval is clear when its separation
in Hz is at least 0.7 × ERB at the lower note. `node tools/interval-limits.mjs`
prints the result:

| interval | derived limit | traditional table |
|---|---|---|
| minor 3rd | D#3 (155.6 Hz) | ~C#3–Eb3 |
| major 3rd | G2 (98.0 Hz) | ~A2 |
| perfect 4th | C#2 (69.3 Hz) | — |
| perfect 5th | E1 (41.2 Hz) | — |
| minor 2nd | never | — |

The derived limits land within a couple of semitones of the arrangers'
values, from physics alone. The minor 2nd result is not a bug: a semitone
spans 5.9% of its frequency while an ERB spans ~10.8% at the top end, so a
semitone sits inside one critical band at *every* pitch. Semitone clusters
buzz wherever you put them.

**What follows for voicing.** Bass takes the root; the keys take the guide
tones (3rd and 7th) plus 9th/11th/13th colour, spread over about two
octaves, with nothing close-spaced down low. `declutter()` enforces this on
every chord the engine builds.

**Mild dissonance is preferred, not tolerated.** Listener studies find minor
9th, major 9th and minor 7th chords rated *highest* for preference,
regardless of musical training. The 7th is not a compromise for flavour —
it is the point. Plain triads are what sound thin here.

---

## 2. Time and feel

**Tempo.** 60–90 BPM; the study/chill centre of mass is mid-70s to low-80s.
We run at 74.

**Swing.** 55–60% on hats and percussion. Expressed as microtiming rather
than a swing knob, because the two fight each other if both are on.

**Feel is directional and consistent, not random.** This is the single
biggest lesson of the rewrite. Uniform random jitter — the obvious way to
"humanise" — sounds *unsteady*, not human. Real feel is a fixed pattern of
offsets that repeats every bar:

- Hats on the beat play straight; hats on the "and" are nudged late, but
  well short of a triplet or the meter changes.
- The snare sits behind the beat, consistently, every time.
- The kick stays close to the grid — it is the anchor everything leans on.
- Chords land 10–30 ms after the beat, never on it.

Our template (`js/groove.js`), and what it measures as in the browser:

| voice | designed | measured on downbeats | measured on off-16ths |
|---|---|---|---|
| kick | 0 ms | +1 ms | +34 ms |
| hats | +6 ms | +4 ms | +42 ms |
| snare | +20 ms | +20 ms | +50 ms |
| bass | +8 ms | +9 ms | +38 ms |
| keys | +22 ms | +36 ms | +78 ms |
| lead | +16 ms | +14 ms | +50 ms |

Random drift on top is 3–9 ms per voice — enough to blur the edges, not
enough to unsteady the pulse.

The keys measure later than they are designed because the measurement
averages every note of a rolled chord, and the roll spreads a voicing over
20–50 ms. The first note of the chord lands where the template puts it.

**Velocity carries as much groove as timing.** Flat velocities read as
machine no matter how good the timing is. Downbeats carry weight, the
backbeat answers, everything between stays quiet, and ghost notes sit at
0.12–0.20.

---

## 3. Harmony

- **Extensions are the default.** maj7, m7, and 9ths; 11ths and 13ths as
  colour. A triad sounds like the wrong genre.
- **Harmonic rhythm is slow.** "The same chord that lasts one beat in a jazz
  standard lasts four bars in a lo-fi loop." We use one chord per bar in
  four-bar phrases — slow, but not so slow that nothing moves.
- **Progressions** are mostly the ii–V–I family, plus borrowed chords for
  colour (bVII7, iv7) which is where the wistful quality comes from.
- **Register is normalised across keys.** Without it, a piece in Bb sits
  nearly an octave above one in C purely because of where the root falls in
  the octave, and the same progression reads bright in one key and dark in
  another.

---

## 4. Melody

The thing that separates a written line from a random one is **repetition**.
Notes drawn from the right scale still sound random if every bar is new.

The structure that works: state a motif, repeat it with one change, lift it,
then leave space. A motif is a rhythm *and* a contour; keeping the pitches
recognisable while shifting the rhythm slightly is what makes the repeat
feel like an answer rather than a copy.

**Space is a feature.** A bar of rest in every phrase is not an absence of
ideas; without it the line becomes wallpaper.

**Keep the melody clear of the chord voicing.** A line inside the chords
just thickens them.

---

## 5. Arrangement

Typical shape: intro (8–16 bars, chords and noise), main groove (16–32),
breakdown (8, stripped back), variation (16), outro (8–16, fading).

For an endless stream the lesson transfers as: bring elements in and out on
4- and 8-bar phrase boundaries, and let filters move. "Small tweaks keep it
fresh — filter automation, dropouts, drum variations, hi-hat changes." The
genre thrives on repetition, so the evolution should be subtle: no drops,
no dramatic bridge.

**Implemented** in `js/sections.js`. Six sections, gating which voices play,
how busy each is, and where the master low-pass sits:

| section | bars | voices | density | tone |
|---|---|---|---|---|
| intro | 8 | keys, bass | 0.6 | 0.45 |
| groove | 8 | keys, bass, drums | 0.8 | 0.8 |
| main | 16 | all | 1 | 1 |
| breakdown | 8 | keys, bass, lead | 0.5 | 0.4 |
| lift | 16 | all | 1 | 1 |
| drift | 8 | all | 0.65 | 0.7 |

`tone` maps to the master filter cutoff as `1400 + tone * 8100` Hz, ramped
over 2.4 s so a section change reads as a change of light rather than a
switch being thrown. Every boundary lands on a multiple of four bars, so
sections turn over in step with the progression, and the last bar of each
section gets the phrase-ending drum fill.

The intro plays once. After it, the cycle is the remaining five sections —
56 bars, about 3 minutes at 74 bpm — because a stream that restarts from
silence every three minutes sounds broken rather than composed. A fresh key
and progression arrive at each cycle boundary, where the music has just
thinned out anyway.

---

## 6. Sound and mix

### Targets from the sources

- **Low-pass** is the signature move — filter "lower than you expect",
  down toward 2 kHz on individual elements.
- **Tape wow and flutter**: 5–15% depth, wow rate 0.5–2 Hz. Tape speed
  7.5 IPS for the rolled-off sound.
- **Saturation**: drive 3–6 dB into the stage; low levels for glue, higher
  for colour.
- **Vinyl**: crackle, pops, and a high-frequency noise floor.
- **Sidechain** the pads and bass to the kick for the pump.
- **Loudness**: around −14 LUFS for streaming; the genre often sits quieter
  than modern masters, which suits it.

### What we measured

`analyse-spectrum.mjs` captures 60 seconds of our own master bus and reports
power per band, cycling the key several times per run so the result isn't one
key's register. This found a defect no amount of studying the design would
have caught:

| band | before | after |
|---|---|---|
| sub 20–60 | 1.2% | 4.7% |
| bass 60–120 | 59.0% | 75.4% |
| low mid 120–250 | 37.9% | 9.6% |
| mid 250–500 | 1.3% | 8.6% |
| upper mid 500–1k | 0.5% | 1.7% |
| presence 1–2k | 0.0% | 0.02% |
| brightness 2–4k | 0.0% | 0.01% |
| air 4–8k | 0.0% | 0.04% |

**Before: 97% of the energy sat below 250 Hz with nothing at all above
1 kHz.** Causes, all of them defects rather than choices:

- The hats were highpassed at 6.5 kHz into a master lowpassed at 7.2 kHz —
  a 700 Hz slot. They were inaudible.
- The keys were lowpassed at 1.9 kHz, below their own harmonics.
- The kick and bass ran several dB too hot into the limiter.
- The bass was a **pure sine**, so all of its energy sat on the fundamental.
  That dominates a power spectrum while staying quiet to the ear, and
  disappears completely on a phone speaker that cannot reproduce 65 Hz. A
  triangle keeps the weight and adds enough harmonics to be heard as a note
  rather than felt as pressure.

Fixes: hats opened to 4.2 kHz, master to 9.5 kHz, keys to 3.2 kHz, lead to
3.8 kHz; kick and bass trimmed; sub-38 Hz rumble highpassed out; bass moved
to a triangle. The mid band came up 4 dB and the top is no longer empty.

**Read these numbers with care.** Power share is not loudness: the ear
weights mids and highs far more than a power measure does, and a natural
music spectrum falls steeply with frequency anyway. An A-weighted or
loudness-matched measure would be the right comparison, and we don't have
one. The measurement is reliable for catching *defects* — an empty band, a
filter fighting another filter — and unreliable as a target to tune toward.
Balance is still a question for ears.

Lesson worth keeping: **a dark genre is not an excuse for a dark mix.**
Everything above 1 kHz being empty is a defect, not a style.

---

## 7. Where the engine stands

| | status |
|---|---|
| Critical-band voicing | done — `js/voicing.js` |
| Spread rootless voicings | done — `js/theory.js` |
| Groove template, per-voice microtiming | done — `js/groove.js` |
| Motif melody with variation and rest | done — `js/melody.js` |
| Comping and walking bass | done — `js/arrange.js` |
| Ghost notes, fills, pattern variation | done — `js/drums.js` |
| Spectral balance | corrected, verify by ear |
| Vinyl crackle and tape hiss | done — `js/texture.js` |
| Wow and flutter | done — `js/texture.js` |
| Sidechain pump | done — `js/texture.js` |
| Saturation | done — `js/texture.js` |
| Sectional arrangement | done — `js/sections.js` |
| Clean / lo-fi switch | done — `stream.html` |
| Fixed voice pool, playback-sized buffer | done — see `docs/audio-performance.md` |

---

## Sources

- [LoFi Weekly — what lo-fi hip hop is in 2026](https://lofiweekly.com/2026/02/02/what-is-lo-fi-hip-hop-in-2026-the-sound-the-drums-the-chords-and-the-rules-you-can-break/)
- [Orphiq — lo-fi chord progressions and how to voice them](https://orphiq.com/resources/lofi-chord-progressions)
- [Soundfly — three examples of Dilla swing](https://flypaper.soundfly.com/play/three-examples-of-dilla-swing/)
- [Attack Magazine — drunk drummer-style grooves](https://www.attackmagazine.com/technique/beat-dissected/drunk-drummer-style-grooves/)
- [Mixed In Key — how to make lo-fi hip hop](https://mixedinkey.com/captain-plugins/wiki/how-to-make-lofi-hip-hop/)
- [Mastering The Mix — how to make lo-fi hip-hop](https://www.masteringthemix.com/blogs/learn/how-to-make-lo-fi-hip-hop)
- [Mode Audio — five production essentials of lo-fi hip hop](https://modeaudio.com/magazine/lofi-hip-hop-5-production-essentials)
- [Richard Pryn — how to structure lo-fi music](https://richardpryn.com/lofi-music-structure/)
- [Waves — adding a lo-fi vintage vibe](https://www.waves.com/tips-for-mixing-lo-fi-retro-vibes-into-your-tracks)
- [Sweetwater — low interval limit](https://www.sweetwater.com/insync/low-interval-limit/)
- [Register impacts perceptual consonance through roughness and sharpness](https://pmc.ncbi.nlm.nih.gov/articles/PMC9166839/)
- [Mild dissonance preferred over consonance in single chord perception](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4934671/)
