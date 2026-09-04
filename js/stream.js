// Keeping an endless stream running from finite chunks.
//
// One <audio> element cannot be seamless: swapping its source leaves a gap.
// So there are two, alternating. Each chunk is rendered with a tail of
// reverb and release past the end of its music, and the next chunk starts
// when the current one reaches the end of its *music* — so the outgoing
// tail rings over the incoming downbeat, and the seam is covered by decay
// rather than being a hole.
//
// The next chunk is rendered while the current one plays, which is the whole
// point: rendering is several times faster than playback, so the work
// finishes long before it is needed and the device is then idle. That idle
// is what survives the screen going off.

import { renderChunk, toWavBlob, SECONDS_PER_BAR } from './render.js';
import { createComposition } from './compose.js';

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

export class LofiStream {
  constructor(options = {}) {
    this.bypass = new Set(options.bypass || []);
    // ?bars= pins the size and turns the ramp off, for measuring.
    this.fixedBars = Number(options.barsPerChunk) || null;
    this.nextChunkBars = this.fixedBars || FIRST_CHUNK_BARS;
    // Music seconds produced per second of rendering, measured. Null until
    // the first chunk has been rendered and there is something to measure.
    this.renderRatio = null;
    this.state = createComposition();
    this.nextBar = 0;
    this.playing = false;
    this.volume = 0.8;

    // Two elements, alternating. Created lazily so construction does not
    // touch the DOM before the page has one.
    this.elements = [];
    this.active = 0;
    this.pending = null;   // a render in flight
    this.queued = null;    // a rendered chunk waiting its turn
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
    if (this.pending || this.queued) return this.pending;
    const startBar = this.nextBar;
    const bars = this.nextChunkBars;
    this.nextBar += bars;
    const startedAt = performance.now();
    this.pending = renderChunk({
      state: this.state,
      startBar,
      bars,
      bypass: this.bypass,
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
        this.queued = chunk;
        this.pending = null;
        return chunk;
      })
      .catch((err) => {
        this.pending = null;
        this._say('render failed: ' + (err && err.message ? err.message : err));
        throw err;
      });
    return this.pending;
  }

  async start() {
    if (this.playing) return;
    this.playing = true;
    this._say('writing the first few bars…');

    const first = this.queued || (await this._renderAhead());
    if (!this.playing) return; // stopped while rendering
    this.queued = null;
    await this._play(first);
    this._renderAhead(); // get ahead immediately
  }

  async _play(chunk) {
    const el = this._element(this.active);
    el.src = chunk.url;
    el.volume = this.volume;
    el.currentTime = 0;
    this.current = chunk;
    await el.play().catch(() => { /* a stop raced the play */ });
    if (this.onChunk) this.onChunk(chunk);

    // Hand over at the end of this chunk's music, leaving its tail ringing.
    clearTimeout(this.handoverTimer);
    const wait = Math.max(0, chunk.musicSeconds - HANDOVER_LEAD) * 1000;
    this.handoverTimer = setTimeout(() => this._handover(), wait);
  }

  async _handover() {
    if (!this.playing) return;
    const outgoing = this._element(this.active);
    const next = this.queued || (await this._renderAhead().catch(() => null));
    if (!this.playing || !next) return;
    this.queued = null;

    // Swap to the other element so the outgoing tail keeps sounding.
    this.active = this.active === 0 ? 1 : 0;
    await this._play(next);

    // Let the old one finish its tail, then free it. Revoking the URL while
    // it is still playing would cut the decay short.
    const url = outgoing.src;
    setTimeout(() => {
      if (outgoing.src === url) {
        outgoing.pause();
        outgoing.removeAttribute('src');
        outgoing.load();
      }
      URL.revokeObjectURL(url);
    }, 4000);

    this._renderAhead();
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
      el.pause();
      const url = el.src;
      el.removeAttribute('src');
      el.load();
      if (url) URL.revokeObjectURL(url);
    }
    if (this.queued && this.queued.url) URL.revokeObjectURL(this.queued.url);
    this.queued = null;
    this.current = null;
    this._say('stopped');
  }

  get isPlaying() {
    return this.playing;
  }
}
