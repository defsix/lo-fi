// Keeping the music alive when the screen goes off.
//
// Reported on a Pixel: the track stutters a little when it reaches the main
// section, and then, when the screen sleeps, collapses into barely any
// playback at all. Those are two different faults. The first is the cost of
// the graph. The second is Android suspending us.
//
// The mechanism matters for the fix. Tone schedules notes from a timer on
// the main thread and hands them to Web Audio a fraction of a second before
// they sound. Audio already scheduled keeps rendering; anything not yet
// scheduled never arrives. So when the platform stops servicing our timers,
// the engine goes quiet within one lookahead window and what you hear is
// exactly what was reported — a few fragments, then skipping.
//
// Two things help, and one thing we cannot reach:
//
//  1. Look further ahead when hidden. If the timer fires rarely, each firing
//     needs to write more music. This costs nothing while visible.
//  2. Be a media player. Android keeps media playback alive with the screen
//     off; it does not extend the same courtesy to a page that merely holds
//     an AudioContext. Chrome is explicit about this: there is no media
//     notification for Web Audio unless it is played back through an audio
//     element. So the mix is routed into a MediaStream and played by one.
//
// A first attempt played a *separate* silent element alongside the Web
// Audio, which produced no lock-screen controls and no improvement. Two
// reasons, both now accounted for: Chrome only grants full audio focus to
// media longer than five seconds, and by its own documentation a sibling
// element does nothing for Web Audio's own output anyway.
//
// What we cannot reach: the browser's own battery setting. Android's
// per-app "Optimised" vs "Unrestricted" is documented as the single most
// effective fix and no web page can touch it. If the two below are not
// enough, that setting is the next thing to try, and it is the user's to
// change.

// While hidden, schedule this far ahead instead of the usual fraction of a
// second, so a throttled timer still leaves continuous music behind it.
//
// The number matters more than it looks. Notes handed to Web Audio play on
// the audio thread, which keeps rendering with the screen off; it is only
// the scheduling that Android freezes. So the horizon is how long the music
// survives without a single timer firing.
//
// Measured, with the main thread frozen solid for ten seconds: at a
// fraction of a second's horizon, 5% of that stretch had sound. At thirty
// seconds, 79%. The first of those matches what a phone actually did with a
// four-second horizon, which is how this number was found to be wrong.
const HIDDEN_LOOKAHEAD = 30;

// A few milliseconds of silence, looped. Built here rather than shipped as
// a base64 blob so it is readable: a 44-byte WAV header over zeroed samples.
// Six seconds, not a fraction of one: Chrome only grants full audio focus
// to media longer than five, so a short loop is ignored entirely.
function silentWavUrl(seconds = 6, rate = 8000) {
  const frames = Math.floor(seconds * rate);
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);       // PCM header size
  view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true);        // block align
  view.setUint16(34, 16, true);       // bits per sample
  ascii(36, 'data');
  view.setUint32(40, frames * 2, true);
  // Samples are left at zero: the point is to be playback, not to be heard.
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

export function createBackgroundKeepAlive({ onPlay, onStop, bypass = new Set() } = {}) {
  const disabled = bypass.has('keepalive');
  let element = null;
  let restoreLookAhead = null;

  // Look further ahead while hidden, and put it back on return, so the
  // added latency is never paid while anyone is watching.
  function onVisibilityChange() {
    if (typeof Tone === 'undefined') return;
    const context = Tone.getContext();
    if (document.hidden) {
      if (restoreLookAhead === null) restoreLookAhead = context.lookAhead;
      context.lookAhead = HIDDEN_LOOKAHEAD;
    } else if (restoreLookAhead !== null) {
      context.lookAhead = restoreLookAhead;
      restoreLookAhead = null;
    }
  }

  function describe(playing) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    if (!playing || !window.MediaMetadata) return;
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: 'generative lo-fi',
      artist: '076 lofi',
      album: 'written live in your browser',
    });
    for (const [action, handler] of [['play', onPlay], ['pause', onStop], ['stop', onStop]]) {
      if (!handler) continue;
      // An unsupported action throws rather than returning false.
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (_) { /* the browser does not offer this control */ }
    }
  }

  return {
    // `stream` is the engine's own output as a MediaStream. When present the
    // element carries the real mix, which is the only arrangement Chrome
    // treats as media playback; without it we fall back to a silent loop,
    // which at least keeps a media element playing.
    start(stream) {
      document.addEventListener('visibilitychange', onVisibilityChange);
      onVisibilityChange();
      describe(true);
      if (disabled) return;
      if (!element) {
        element = stream ? new Audio() : new Audio(silentWavUrl());
        if (stream) element.srcObject = stream;
        element.loop = !stream; // A live stream has no end to loop back to.
        element.autoplay = true;
        // Not muted: a muted element is not playback as far as the platform
        // is concerned, which is the entire reason this exists.
        element.volume = 1;
        // In the document rather than detached: browsers are more consistent
        // about recognising an element they can see in the tree, and it
        // gives the page a way to check that this is actually running.
        element.setAttribute('data-keep-alive', '');
        document.body.appendChild(element);
      }
      // Autoplay rules are already satisfied - this only runs from the same
      // gesture that started the audio context.
      const started = element.play();
      if (started && started.catch) started.catch(() => { /* nothing to do */ });
    },

    stop() {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (restoreLookAhead !== null && typeof Tone !== 'undefined') {
        Tone.getContext().lookAhead = restoreLookAhead;
        restoreLookAhead = null;
      }
      describe(false);
      if (element) element.pause();
    },
  };
}
