// Keeping an endless stream running from finite chunks.
//
// One <audio> element cannot be seamless: swapping its source leaves a gap.
// So there is a small ring of them. Each chunk is rendered with a tail of
// reverb and release past the end of its music, and the next chunk starts
// when the current one reaches the end of its *music* — so the outgoing
// tail rings over the incoming downbeat, and the seam is covered by decay
// rather than being a hole.
//
// The next chunk is rendered while the current one plays, which is the whole
// point: rendering is several times faster than playback, so the work
// finishes long before it is needed and the device is then idle. That idle
// is what survives the screen going off.
//
// Three elements rather than two, which is not obvious and was arrived at by
// measurement. At any moment one is playing, one is still ringing the tail
// of the chunk before it, and one is free to have the next chunk loaded onto
// it. With only two, loading the next chunk necessarily reused the element
// still ringing — cutting its tail off mid-decay and opening the very gap
// the tail exists to cover. Measured, that took the longest silence from
// 100ms to 320ms.

import { renderChunk, toWavBlob, TAIL_SECONDS } from './render.js';
import { createComposition } from './compose.js';
import { readWords } from './words.js';
import { makeSeed, normaliseSeed, seedRng, barRngFor } from './seed.js';

// Chunks start short and grow. A first chunk of 52 seconds is 25 seconds of
// silence after pressing play on a phone, which is far too long to ask of
// someone who just pressed play; two bars is a few seconds. Once sound is
// going there is a whole chunk's playback to render the next one in, so the
// size can climb until seams are rare.
//
// How fast it may climb is not a guess. Chunk N is rendered while chunk N-1
// plays, so it can only grow by the device's render ratio: at 2.07x
// (Chrome, measured on a Pixel) doubling each time leaves 3% of headroom,
// which is not headroom. So the ratio is measured from each render and the
// next size follows from it, which also degrades sensibly on a device
// slower than any assumption baked in here.
const FIRST_CHUNK_BARS = 2;
const MAX_CHUNK_BARS = 16;
const MIN_CHUNK_BARS = 2;

// Of the time a chunk buys us, only spend this much rendering the next. The
// rest absorbs the device being busy with something other than us.
const RENDER_SAFETY = 0.75;

// How far before the current chunk's music ends to start the next element.
//
// This exists to cancel the delay between calling play() and the element
// actually sounding. It used to be a fixed 0.12s, on the reasoning that an
// <audio> element cannot be started with sample accuracy and a little early
// was safer than a little late. Measured, that reasoning was wrong twice
// over: play() here returns sound within about 4ms, so the lead was almost
// entirely error, and the error is not harmless. Every changeover landed
// the new bar 116ms (min 93, max 139) before the old one had finished — the
// last thirty-second of the outgoing bar sounding on top of the incoming
// downbeat. A doubled transient at every seam, which is what a changeover
// crackle is made of.
//
// So it is measured instead of assumed. The lead starts small and each
// handover reports where the seam actually landed; the estimate follows.
// A device where play() really is slow converges on a large lead, and this
// one converges on almost none, without either being written down here.
const INITIAL_LEAD = 0.02;
// The lead may be negative, and this took a real report to notice. Clamped
// at zero it can shorten the wait but never extend it, so an incoming chunk
// that is still early with the lead already at zero has nothing left to
// give: a Firefox-on-Android log came back with lead=0 and seam=-38ms twice
// running, stuck. A negative lead hands over *after* the music ends, into
// the tail that is ringing anyway — which is what the tail is for.
const LEAD_BOUND = 0.4;

// How much of each observed error to take out.
//
// A media element's currentTime is quantised to its buffer: every seam this
// has measured came back a multiple of 23ms, which is 1024 samples at
// 44.1kHz. Correcting for a reading inside one quantum is chasing the
// clock's resolution rather than the latency, and the first version of this
// did exactly that — 20 -> 48 -> 34 -> 6 -> 0ms, hunting rather than
// settling. So readings below a quantum are left alone, and what is outside
// it is corrected gently.
const LEAD_DEADBAND = 0.025;
const LEAD_CORRECTION = 0.4;

// When to read the two clocks back. The arithmetic works backwards from
// currentTime, so a throttled timer firing late gives the same answer —
// which matters, because hidden is exactly when this needs to be right.
const SEAM_CHECK_MS = 300;

// A glitch is heard, not caught. By the time anyone can say "there, at
// 3:42" the moment is a minute gone and nothing was watching. So the stream
// keeps a short flight recorder: every handover, render, seam and media-
// element complaint, timestamped against the music rather than the wall
// clock, so a report says which bar was sounding rather than what time it
// was. Bounded, because this runs for hours.
const LOG_LIMIT = 240;

// Playing, still-ringing, and free-to-load. See the note at the top.
const ELEMENT_COUNT = 3;

// How long two elements are live at a changeover is decided by the length
// of the rendered tail, not here — see TAIL_SECONDS in render.js. An
// earlier attempt shortened it by fading the outgoing element's volume
// instead, which was the wrong tool: HTMLMediaElement.volume can only be
// stepped, and thirty steps a second put a small discontinuity into the
// output at each one. Measured, that put jumps into the signal that had not
// been there before. Rendering a shorter tail achieves the same thing with
// no steps at all.

// How many rendered chunks to keep in reserve.
//
// One was enough while the tab was in front, and not enough behind it: a
// backgrounded tab is given much less CPU, so a render that comfortably
// beat playback in the foreground can miss its handover, and a handover
// with nothing to hand to is the stutter. Two chunks means a render can
// take an entire extra chunk's playback and still not be late.
//
// The cost is memory — a chunk is several megabytes of WAV — and a texture
// or word change taking one chunk longer to be heard. Both are cheap
// against the music stopping.
const QUEUE_DEPTH = 2;

// Pausing a media element cuts the waveform wherever it happens to be, and
// a waveform cut mid-cycle is a step change — which is what a click is. So
// nothing here is ever stopped outright; it is taken to silence first.
// Short enough not to feel like a fade, long enough to have no edge.
const FADE_MS = 90;

function fadeOut(element, done) {
  if (!element || element.paused) { if (done) done(); return; }
  const from = element.volume;

  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    element.volume = 0;
    element.pause();
    element.volume = from; // restored, so the next play is not silent
    if (done) done();
  };

  // No fade while the page is hidden, and this is the important part: a
  // hidden page does not run requestAnimationFrame at all. Driving the fade
  // from rAF meant that when the tab lost focus the fade never finished, so
  // the outgoing element was never paused and never had its source cleared
  // — it kept playing underneath the next chunk. Two chunks sounding at
  // once is what that was heard as, a stutter between segments whenever the
  // site was not in front.
  //
  // Nobody is looking at a hidden tab, and a click there is a far smaller
  // problem than two chunks of music overlapping, so it stops at once.
  if (typeof document !== 'undefined' && document.hidden) {
    finish();
    return;
  }

  const started = performance.now();
  const step = () => {
    const t = (performance.now() - started) / FADE_MS;
    if (t >= 1) { finish(); return; }
    // Equal-power rather than linear: a linear ramp on amplitude is still
    // audible as a dip in the middle.
    element.volume = from * Math.cos((t * Math.PI) / 2);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);

  // And a deadline, because the page can be hidden *during* a fade, which
  // stops rAF mid-way and would strand it just the same. A timer keeps
  // running when hidden — throttled, but it runs.
  setTimeout(finish, FADE_MS * 4);
}

export class LofiStream {
  constructor(options = {}) {
    this.bypass = new Set(options.bypass || []);
    // Off by default. The vinyl noise floor read as static rather than as a
    // record, and with it gone the rendered stream should sound like the
    // live engine rather than like a different instrument — same voices,
    // same effects, same mix. The texture layer stays in the codebase to be
    // dialled in deliberately later; ?texture=1 turns it on to hear it.
    this.texture = options.texture == null ? 0 : Number(options.texture);
    // ?bars= pins the size and turns the ramp off, for measuring.
    this.fixedBars = Number(options.barsPerChunk) || null;
    this.nextChunkBars = this.fixedBars || FIRST_CHUNK_BARS;
    // Music seconds produced per second of rendering, measured. Null until
    // the first chunk has been rendered and there is something to measure.
    this.renderRatio = null;
    // Three words, read into a sense the composition can act on. Null when
    // nothing usable was typed, which means "choose freely" rather than a
    // characterless middle.
    this.reading = readWords(options.words);
    this.sense = this.reading ? this.reading.sense : null;
    // The seed names the track. Supplied, it brings a particular one back;
    // absent, one is minted so that whatever plays can be linked to after
    // the fact rather than only before it.
    this.seed = normaliseSeed(options.seed) || makeSeed();
    this._compose();
    this.nextBar = 0;
    this.playing = false;
    this.volume = 0.8;

    // A ring of three. Created lazily so construction does not touch the DOM
    // before the page has one.
    this.elements = [];
    this.active = 0;
    this.pending = null;   // a render in flight
    this.queue = [];       // rendered chunks waiting their turn
    this.staged = null;    // the queued chunk already loaded onto an element
    this.current = null;   // what is sounding now
    this.handoverTimer = null;
    // Measured, not assumed. See INITIAL_LEAD.
    this.lead = INITIAL_LEAD;
    this.lastSeam = null;

    // The flight recorder, and the music clock it stamps against.
    this.log = [];
    this.musicPlayed = 0;   // seconds of music finished before the current chunk
    this.startedAt = null;  // wall clock, for comparing against the music clock

    this.onChunk = null;   // (chunk) => void, when a chunk starts sounding
    this.onStatus = null;  // (text) => void
  }

  _element(index) {
    if (!this.elements[index]) {
      const el = new Audio();
      el.preload = 'auto';
      el.volume = this.volume;
      // In the document so the browser treats it as a real media element.
      el.setAttribute('data-lofi-stream', String(index));
      document.body.appendChild(el);
      this.elements[index] = el;
      this._watchElement(el, index);
    }
    return this.elements[index];
  }

  _say(text) {
    if (this.onStatus) this.onStatus(text);
  }

  // --- the flight recorder ----------------------------------------------

  // Seconds of music heard since play. Not wall-clock time: it is the
  // position in the piece, which is what a report needs to be about.
  elapsed() {
    if (!this.playing) return this.musicPlayed;
    const el = this.elements[this.active];
    const within = el && !el.paused ? Math.min(el.currentTime, this.current ? this.current.musicSeconds : el.currentTime) : 0;
    return this.musicPlayed + within;
  }

  // The bar sounding now, worked out from the chunk rather than counted, so
  // it stays right across a handover.
  bar() {
    const c = this.current;
    if (!c || !c.musicSeconds) return null;
    const el = this.elements[this.active];
    const within = el && !el.paused ? Math.min(el.currentTime, c.musicSeconds) : 0;
    return c.startBar + Math.floor((within / c.musicSeconds) * c.bars);
  }

  /** For the page to record its own events against the music clock. */
  note(type, data = {}) {
    if (this.playing) this._note(type, data);
  }

  _note(type, data) {
    this.log.push({ at: +this.elapsed().toFixed(2), bar: this.bar(), type, ...data });
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }

  // Media elements report their own trouble, and it is the trouble nobody
  // can see from the outside: `waiting` is the element having run out of
  // data mid-playback, which is a stutter by definition.
  _watchElement(el, index) {
    if (el._watched) return;
    el._watched = true;

    // `waiting` means the element wants data it does not have. That is a
    // stutter — but only sometimes: it also fires at the top of every chunk
    // while the element takes hold of the blob it was just handed, before
    // any of it was due to be heard. The two are told apart by where the
    // element's own clock was when it happened, and how long it lasted.
    el.addEventListener('waiting', () => {
      if (!this.playing || index !== this.active) return;
      el._waitFrom = performance.now();
      el._waitAt = el.currentTime;
    });
    el.addEventListener('playing', () => {
      if (el._waitFrom == null) return;
      const ms = Math.round(performance.now() - el._waitFrom);
      const midChunk = el._waitAt > 0.05;
      el._waitFrom = null;
      if (!this.playing) return;
      // Mid-chunk it is an underrun and always worth a line. At the start of
      // a chunk it is only worth one if it took long enough to be heard.
      if (midChunk) this._note('underrun', { el: index, ms });
      else if (ms > 30) this._note('slow-start', { el: index, ms });
    });

    for (const event of ['stalled', 'error', 'abort']) {
      el.addEventListener(event, () => {
        if (this.playing && index === this.active) {
          this._note(event, { el: index, code: el.error ? el.error.code : undefined });
        }
      });
    }
  }

  /**
   * Everything known about the current playback, as text. Written to be
   * pasted into a message: the seed first, so the exact track can be played
   * back, then what the stream was doing around the moment complained of.
   */
  report(note) {
    const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const p = this.palette;
    const lines = [
      note ? `-- ${note} at ${mmss(this.elapsed())}, bar ${this.bar()} --` : '-- lofi report --',
      `seed      ${this.seed}`,
      `link      ${location.origin}${location.pathname}?seed=${this.seed}`,
      `track     ${p ? p.name : '?'} · ${this.state ? this.state.key : '?'} ${p ? p.mode : ''} · ${p ? Math.round(p.bpm) : '?'} bpm`,
      `position  ${mmss(this.elapsed())}  bar ${this.bar()}`,
      `chunk     ${this.current ? `${this.current.bars} bars from ${this.current.startBar}` : 'none'}`,
      `lead      ${Math.round(this.lead * 1000)} ms   last seam ${this.lastSeam == null ? '—' : Math.round(this.lastSeam * 1000) + ' ms'}`,
      `render    ${this.renderRatio ? this.renderRatio.toFixed(2) + '×' : '—'}  queue ${this.queue.length}  next ${this.nextChunkBars} bars`,
      `rendering ${
        this.renderingSince
          ? `yes — ${this.renderingWhat.bars} bars from ${this.renderingWhat.from}, ` +
            `${((performance.now() - this.renderingSince) / 1000).toFixed(1)}s in`
          : 'no'
      }`,
      `agent     ${navigator.userAgent}`,
      '',
      'time   bar   event',
    ];
    for (const e of this.log) {
      const { at, bar, type, ...rest } = e;
      const detail = Object.entries(rest).map(([k, v]) => `${k}=${v}`).join(' ');
      lines.push(`${mmss(at).padStart(6)} ${String(bar == null ? '—' : bar).padStart(5)}   ${type}${detail ? ' ' + detail : ''}`);
    }
    return lines.join('\n');
  }

  // Render the chunk after the one we last handed out. Only ever one render
  // in flight: two at once would compete for the same thread and neither
  // would finish early.
  // The largest chunk that still renders inside the current one's playback:
  //   render(b) <= safety * play(bars)   =>   b <= safety * bars * ratio
  //
  // Nothing is forced. An earlier version grew by at least a bar each time
  // regardless, which on a device rendering at 1.3x meant asking for three
  // bars during two bars of playback — arithmetic that cannot be met, and
  // it ran at the edge of stalling. If the device cannot afford to grow,
  // holding is correct, and if it cannot afford the current size, shrinking
  // is what keeps the music going.
  _nextSize(barsJustRendered) {
    if (this.fixedBars) return this.fixedBars;
    if (!this.renderRatio) return barsJustRendered;
    const affordable = Math.floor(barsJustRendered * this.renderRatio * RENDER_SAFETY);
    return Math.max(MIN_CHUNK_BARS, Math.min(MAX_CHUNK_BARS, affordable));
  }

  _renderAhead() {
    if (this.pending || this.queue.length >= QUEUE_DEPTH) return this.pending;
    const startBar = this.nextBar;
    const bars = this.nextChunkBars;
    this.nextBar += bars;
    const startedAt = performance.now();
    this.renderingSince = startedAt;
    this.renderingWhat = { from: startBar, bars };
    this._note('render-start', { from: startBar, bars });
    this.pending = renderChunk({
      state: this.state,
      startBar,
      bars,
      bypass: this.bypass,
      texture: this.texture,
      barRng: this.barRng,
    })
      .then((chunk) => {
        const renderSeconds = (performance.now() - startedAt) / 1000;
        // Measured throughput, tail included, since the tail is real work.
        this.renderRatio = chunk.musicSeconds / Math.max(0.001, renderSeconds);
        chunk.renderSeconds = renderSeconds;
        chunk.ratio = this.renderRatio;
        this.nextChunkBars = this._nextSize(bars);
        this.renderingSince = null;
        this._note('render-done', { from: startBar, bars, secs: +renderSeconds.toFixed(2), ratio: +this.renderRatio.toFixed(2) });
        chunk.url = URL.createObjectURL(toWavBlob(chunk.buffer));
        // The decoded buffer is megabytes and is not needed once encoded.
        chunk.buffer = null;
        this.queue.push(chunk);
        this.pending = null;
        // Load whatever plays next onto the free element straight away, so
        // the browser has a whole chunk's playback to get it ready in.
        this._stageNext();
        // Keep filling until the reserve is full.
        this._renderAhead();
        return chunk;
      })
      .catch((err) => {
        this.pending = null;
        this._say('render failed: ' + (err && err.message ? err.message : err));
        throw err;
      });
    return this.pending;
  }

  // Put a rendered chunk on an element and let the browser load it now,
  // rather than at the moment it has to start. A chunk is several megabytes
  // of WAV, and setting src at the seam meant the browser was fetching and
  // decoding it exactly when it needed to be playing — which is audible as
  // a crackle at the handover, and worst when the device is busy or the
  // screen is off.
  _stage(index, chunk) {
    const el = this._element(index);
    el.src = chunk.url;
    el.volume = this.volume;
    el.load();
    chunk.element = index;
    return el;
  }

  // Put the chunk that plays next onto the free element. The ring is
  // playing / still-ringing / free, so the free one is always the one after
  // the playing element — never active+2, which is the element still
  // sounding the previous chunk's tail.
  //
  // At most one chunk is ever staged. A render finishing during a handover
  // would otherwise load the chunk after next onto the element the handover
  // is about to play from, overwriting it a millisecond before it sounds —
  // which is exactly what the staging log caught.
  _stageNext() {
    if (this.staged || !this.current) return;
    const next = this.queue[0];
    if (!next) return;
    this._stage((this.active + 1) % ELEMENT_COUNT, next);
    this.staged = next;
  }

  // Release a chunk's audio once nothing can still be sounding it. Safe to
  // call with anything, including a chunk already retired.
  _retire(chunk) {
    if (!chunk || !chunk.url) return;
    const url = chunk.url;
    chunk.url = null;
    chunk.element = undefined;
    setTimeout(() => URL.revokeObjectURL(url), (TAIL_SECONDS + 2) * 1000);
  }

  async start() {
    if (this.playing) return;
    this.playing = true;
    this.musicPlayed = 0;
    this.startedAt = performance.now();
    this.log = [];
    this._note('start', { seed: this.seed, palette: this.palette ? this.palette.name : '?' });
    // The screen going off is the condition half of this architecture exists
    // for, and it is invisible in a log that does not record it.
    if (!this._watchingVisibility) {
      this._watchingVisibility = true;
      document.addEventListener('visibilitychange', () => {
        if (this.playing) this._note(document.hidden ? 'hidden' : 'visible', {});
      });
    }
    this._say('writing the first few bars…');

    const first = this.queue.shift() || (await this._renderAhead());
    if (!this.playing) return; // stopped while rendering
    if (this.queue[0] === first) this.queue.shift();
    if (first.element === undefined) this._stage(this.active, first);
    await this._play(first);
    this._renderAhead(); // get ahead immediately
  }

  async _play(chunk) {
    const el = this._element(this.active);
    if (chunk.element !== this.active) this._stage(this.active, chunk);
    el.currentTime = 0;
    this.current = chunk;
    await el.play().catch(() => { /* a stop raced the play */ });

    // The page's callback must never be able to stop the music. It did:
    // a readout element renamed in the HTML but still referenced here threw
    // inside onChunk, the exception propagated out of _play, and the
    // handover chain died with it — one chunk played and then silence.
    // Drawing a readout is not worth a stream.
    if (this.onChunk) {
      try {
        this.onChunk(chunk);
      } catch (err) {
        this._say('readout failed: ' + (err && err.message ? err.message : err));
      }
    }

    // Hand over at the end of this chunk's music, leaving its tail ringing.
    clearTimeout(this.handoverTimer);
    const wait = Math.max(0, chunk.musicSeconds - this.lead) * 1000;
    this.handoverTimer = setTimeout(() => this._handover(), wait);

    // A backstop for a throttled timer. With the screen off the timer above
    // can fire late, and by then the tail has run out and the gap is real.
    // The element's own end event comes from the media pipeline, so if it
    // arrives first, hand over immediately rather than waiting.
    el.onended = () => {
      if (!this.playing || this.current !== chunk) return;
      // Reaching the end of the file means the handover timer never fired
      // in time — the tail has already run out and the gap is audible.
      this._note('ended-first', { from: chunk.startBar });
      this._handover();
    };
  }

  async _handover() {
    if (!this.playing) return;
    clearTimeout(this.handoverTimer);
    const outgoing = this._element(this.active);
    outgoing.onended = null;
    const finished = this.current;

    // Where the outgoing element is, at the moment we decide to switch.
    // Read before anything else moves, because _play advances `active`.
    const decidedAt = performance.now();
    const outClock = outgoing.paused ? null : outgoing.currentTime;
    // An empty queue here means the handover had to wait on a render. That
    // is the difference between a seam and a silence, so it is worth a line.
    const waited = this.queue.length === 0;
    const next = this.queue.shift() || (await this._renderAhead().catch(() => null));
    if (!this.playing || !next) {
      this._note('starved', { queue: 0 });
      return;
    }
    if (waited) this._note('waited-on-render', {});
    if (this.queue[0] === next) this.queue.shift();
    if (this.staged === next) this.staged = null;

    // Move to the next element in the ring; the outgoing one keeps sounding
    // its tail on the element we just left.
    this.active = next.element !== undefined ? next.element : (this.active + 1) % ELEMENT_COUNT;
    await this._play(next);

    if (finished) this.musicPlayed += finished.musicSeconds;
    this._note('chunk', { from: next.startBar, bars: next.bars });
    this._measureSeam(finished, decidedAt, outClock);

    // Only now, with `active` moved on, is it safe to work out which
    // element is free and load the chunk after this one onto it.
    this._stageNext();

    // Let the outgoing tail play itself out — the file ends at silence, so
    // nothing needs fading. This only catches an element that somehow has
    // not finished by then.
    setTimeout(() => {
      if (outgoing !== this._element(this.active) && !outgoing.paused) fadeOut(outgoing);
    }, (TAIL_SECONDS + 0.6) * 1000);

    // Free the chunk that just finished, once its tail has rung out.
    //
    // Tied to the chunk rather than to the element, which is the fix for a
    // real leak: the old code revoked only if that element's src had not
    // changed since, and with a ring of three the element is often
    // re-staged first — so the check failed, the revoke was skipped, and
    // several megabytes of WAV stayed in memory for the life of the tab.
    // Over a couple of hours of listening that is hundreds of megabytes.
    this._retire(finished);

    this._renderAhead();
  }

  // Where the seam actually landed, and the correction that follows from it.
  //
  // Negative means the incoming downbeat sounded before the outgoing bar had
  // finished — the two overlap, and a doubled transient is audible. Positive
  // means a short hole in the music, which the outgoing tail is still
  // covering. Either way the lead moves to cancel it next time.
  _measureSeam(finished, decidedAt, outClock) {
    if (outClock == null || !finished || !finished.musicSeconds) return;
    const incoming = this._element(this.active);
    setTimeout(() => {
      if (!this.playing || !incoming || incoming.paused || !incoming.currentTime) return;
      // Worked backwards from each element's own clock, so a timer that
      // fired late does not corrupt the answer.
      const startedAt = performance.now() - incoming.currentTime * 1000;
      const musicEndedAt = decidedAt + (finished.musicSeconds - outClock) * 1000;
      const offset = (startedAt - musicEndedAt) / 1000;
      // A second out is not a seam, it is a stall; correcting from it would
      // throw the estimate away.
      if (!Number.isFinite(offset) || Math.abs(offset) > 0.75) return;
      this.lastSeam = offset;
      const before = this.lead;
      if (Math.abs(offset) >= LEAD_DEADBAND) {
        const moved = this.lead + offset * LEAD_CORRECTION;
        this.lead = Math.max(-LEAD_BOUND, Math.min(LEAD_BOUND, moved));
      }
      this._note('seam', {
        off: Math.round(offset * 1000),
        lead: before === this.lead ? Math.round(this.lead * 1000) : Math.round(before * 1000) + '→' + Math.round(this.lead * 1000),
      });
    }, SEAM_CHECK_MS);
  }

  // For setting the texture levels from the console while they are being
  // tuned. Takes effect on the next chunk rendered, so it can be a couple of
  // chunks before it is heard — which is why this is not a control on the
  // page. The right levels are something to arrive at, not to hand over.
  setTexture(amount) {
    this.texture = Math.max(0, Math.min(1, Number(amount) || 0));
  }

  // New words mean a new piece: everything already written was written for
  // the old ones. Called while stopped, so nothing has to be thrown away.
  setWords(words, seed) {
    this.reading = readWords(words);
    this.sense = this.reading ? this.reading.sense : null;
    // New words are a new piece, so unless a particular one was asked for
    // by seed, this is a new track and gets a new name.
    this.seed = normaliseSeed(seed) || makeSeed();
    this._compose();
    this.nextBar = 0;
    this.nextChunkBars = this.fixedBars || FIRST_CHUNK_BARS;
    return this.reading;
  }

  // Everything the seed decides, decided. Kept in one place because the
  // composition and the per-bar generators have to come from the same seed
  // or a link would restore the harmony and not the arrangement.
  _compose() {
    this.state = createComposition(this.sense, seedRng(this.seed, 'composition'));
    this.palette = this.state.palette;
    this.barRng = barRngFor(this.seed);
  }

  setVolume(percent) {
    this.volume = Math.max(0, Math.min(1, percent / 100));
    for (const el of this.elements) if (el) el.volume = this.volume;
  }

  stop() {
    if (this.playing) this._note('stop', {});
    this.playing = false;
    clearTimeout(this.handoverTimer);
    for (const el of this.elements) {
      if (!el) continue;
      el.onended = null;
      // Fade, then tear down — clearing src underneath a playing element is
      // the same instant cut as pausing it.
      fadeOut(el, () => {
        el.removeAttribute('src');
        el.load();
      });
    }
    // Every chunk still holding audio, whether playing, staged or queued.
    for (const chunk of [this.current, ...this.queue]) this._retire(chunk);
    this.queue = [];
    this.staged = null;
    this.current = null;
    this._say('stopped');
  }

  get isPlaying() {
    return this.playing;
  }

  /**
   * Where the sounding chunk has reached, in seconds, and the notes it
   * holds. This is how the page draws the music: from the score and the
   * element's own clock, not from the signal.
   */
  position() {
    const chunk = this.current;
    if (!chunk || !this.playing) return null;
    const el = this.elements[this.active];
    if (!el || el.paused) return null;
    return { at: el.currentTime, score: chunk.score, chunk };
  }
}
