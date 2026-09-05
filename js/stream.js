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

import { renderChunk, toWavBlob } from './render.js';
import { createComposition } from './compose.js';
import { readWords } from './words.js';

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

// Start the next element this far before the current chunk's music ends.
// An <audio> element cannot be started with sample accuracy, so the handover
// is deliberately placed inside the tail where a few tens of milliseconds
// of error are covered by the decay.
const HANDOVER_LEAD = 0.12;

// Playing, still-ringing, and free-to-load. See the note at the top.
const ELEMENT_COUNT = 3;

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
    this.state = createComposition(this.sense);
    this.palette = this.state.palette;
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
    }
    return this.elements[index];
  }

  _say(text) {
    if (this.onStatus) this.onStatus(text);
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
    this.pending = renderChunk({
      state: this.state,
      startBar,
      bars,
      bypass: this.bypass,
      texture: this.texture,
    })
      .then((chunk) => {
        const renderSeconds = (performance.now() - startedAt) / 1000;
        // Measured throughput, tail included, since the tail is real work.
        this.renderRatio = chunk.musicSeconds / Math.max(0.001, renderSeconds);
        chunk.renderSeconds = renderSeconds;
        chunk.ratio = this.renderRatio;
        this.nextChunkBars = this._nextSize(bars);
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

  async start() {
    if (this.playing) return;
    this.playing = true;
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
    const wait = Math.max(0, chunk.musicSeconds - HANDOVER_LEAD) * 1000;
    this.handoverTimer = setTimeout(() => this._handover(), wait);

    // A backstop for a throttled timer. With the screen off the timer above
    // can fire late, and by then the tail has run out and the gap is real.
    // The element's own end event comes from the media pipeline, so if it
    // arrives first, hand over immediately rather than waiting.
    el.onended = () => {
      if (this.playing && this.current === chunk) this._handover();
    };
  }

  async _handover() {
    if (!this.playing) return;
    clearTimeout(this.handoverTimer);
    const outgoing = this._element(this.active);
    outgoing.onended = null;
    const next = this.queue.shift() || (await this._renderAhead().catch(() => null));
    if (!this.playing || !next) return;
    if (this.queue[0] === next) this.queue.shift();
    if (this.staged === next) this.staged = null;

    // Move to the next element in the ring; the outgoing one keeps sounding
    // its tail on the element we just left.
    this.active = next.element !== undefined ? next.element : (this.active + 1) % ELEMENT_COUNT;
    await this._play(next);

    // Only now, with `active` moved on, is it safe to work out which
    // element is free and load the chunk after this one onto it.
    this._stageNext();

    // Let the old one finish its tail, then free it. Revoking the URL while
    // it is still playing would cut the decay short.
    const url = outgoing.src;
    setTimeout(() => {
      // Only if nothing has been staged onto it since: the next render may
      // already have claimed this element for the chunk after next.
      if (outgoing.src === url) {
        // The tail should be silent by now, but "should be" is how clicks
        // get shipped.
        fadeOut(outgoing, () => {
          outgoing.removeAttribute('src');
          outgoing.load();
          URL.revokeObjectURL(url);
        });
      }
    }, 4000);

    this._renderAhead();
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
  setWords(words) {
    this.reading = readWords(words);
    this.sense = this.reading ? this.reading.sense : null;
    this.state = createComposition(this.sense);
    this.palette = this.state.palette;
    this.nextBar = 0;
    this.nextChunkBars = this.fixedBars || FIRST_CHUNK_BARS;
    return this.reading;
  }

  setVolume(percent) {
    this.volume = Math.max(0, Math.min(1, percent / 100));
    for (const el of this.elements) if (el) el.volume = this.volume;
  }

  stop() {
    this.playing = false;
    clearTimeout(this.handoverTimer);
    for (const el of this.elements) {
      if (!el) continue;
      el.onended = null;
      const url = el.src;
      // Fade, then tear down — clearing src underneath a playing element is
      // the same instant cut as pausing it.
      fadeOut(el, () => {
        el.removeAttribute('src');
        el.load();
        if (url) URL.revokeObjectURL(url);
      });
    }
    for (const chunk of this.queue) if (chunk.url) URL.revokeObjectURL(chunk.url);
    this.queue = [];
    this.staged = null;
    this.current = null;
    this._say('stopped');
  }

  get isPlaying() {
    return this.playing;
  }
}
