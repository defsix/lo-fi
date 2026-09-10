# 076 lofi

Generative lo-fi that composes itself in your browser. Nothing is sampled and
nothing is streamed — every note is decided and synthesised on your device,
a few bars ahead of what you are hearing.

**[defsix.github.io/lo-fi](https://defsix.github.io/lo-fi/)**

## How it works

The hard problem was not writing the music, it was keeping it playing with
the screen off. A Web Audio graph is throttled or suspended the moment a
phone stops looking at the page, which is exactly when you most want music.

So nothing plays live. The engine renders a chunk of music offline — faster
than real time — encodes it to WAV, and hands it to an `<audio>` element. An
`<audio>` element keeps playing with no JavaScript running at all, which is
what survives the screen going off. While one chunk plays, the next is
rendered, and a ring of three elements passes the music between them.

    compose.js   what happens in bar N, with no audio nodes involved
    render.js    that, rendered offline into a buffer
    stream.js    the ring of elements, the handovers, the flight recorder
    palette.js   the seven track identities
    seed.js      a generator per bar, so a seed names a whole track

Chunks start at two bars so play is nearly instant, then grow as fast as the
device proves it can render — measured per render, not assumed.

## Playing

Three words shape the piece. They pick a key, a tempo, a mode and a set of
instruments; type nothing and it chooses freely. `sleep` asks for something
different — see the [privacy note](https://defsix.github.io/lo-fi/privacy.html).

Every track has a seed, shown under the player. A link carrying it plays the
same piece note for note on any device, without a byte of audio crossing the
wire.

### URL flags

| flag | effect |
|---|---|
| `seed=` | pin an exact track |
| `words=` | the three words, e.g. `words=rain+neon+midnight` |
| `scope=0` | no visualiser |
| `bars=N` | fixed chunk size, disables the ramp |
| `keys=` `lead=` | per-voice trims in dB |
| `texture=1` | the tape and vinyl layer |
| `bypass=` | drop parts of the chain: `reverb`, `chorus`, `tremolo`, `filters`, or a voice |

## Reporting a glitch

The player keeps a flight recorder: handovers, renders, seam corrections,
screen-off transitions and any complaint the media element makes, stamped
against the music rather than the clock. **report glitch** copies the lot,
seed first, so the exact track can be played back. It has found several real
bugs that were invisible from the outside.

## Development

    node tools/build-artifact.mjs   bundle live.html into one file
    node tools/make-icons.mjs       redraw the icons from js/artwork.js
    node tools/stamp-build.mjs      stamp the build (run before committing)
    sh   tools/fetch-fonts.sh       refetch and rebuild the self-hosted fonts

There is no build step for the site itself — it is static files, served as
they are, and every module is loaded natively.

## Privacy

No accounts, no analytics, no cookies, no third-party requests. The fonts are
self-hosted specifically so that loading the page does not hand your IP
address to anyone. Full note: **[privacy.html](https://defsix.github.io/lo-fi/privacy.html)**.

## Licence

MIT — see [LICENSE](LICENSE). Bundled third-party components and their
licences are listed in [NOTICE](NOTICE).
