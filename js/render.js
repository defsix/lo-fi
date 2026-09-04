// Rendering the music to audio, faster than it plays.
//
// This is the half that makes the thing work on a phone. Playing live means
// a scheduler on the main thread every fraction of a second, forever, and a
// phone with the screen off will not give us that. Rendering means a burst
// of work and then nothing at all: an <audio> element plays with no
// JavaScript running, which is exactly what a locked phone allows, and it
// is a finite seekable resource, which is what the platform wants before it
// will keep audio alive in the background.
//
// Measured on a Pixel 10 Pro: 30 seconds of this music renders in 7.0s in
// Firefox and 14.5s in Chrome — 4.3x and 2.1x faster than it plays. Firefox
// being the quicker one is the reverse of live playback, where it was far
// worse, because rendering offline never touches the audio output backend
// that its problem lives in.

import { createMaster } from './master.js';
import { createKeys, createLead, createBass } from './instruments.js';
import { createDrumKit } from './drums.js';
import { planBar, eventsForBar } from './compose.js';

export const BPM = 74;
export const SECONDS_PER_BAR = (60 / BPM) * 4;

// Rendered past the end of the music so reverb and release tails complete
// rather than being cut off mid-decay. The player overlaps this tail with
// the next chunk, which is what hides the seam between them.
export const TAIL_SECONDS = 2.5;

// The voices take note names and Tone durations; drums take a duration and
// velocity only. One shape here so the loop below stays readable.
function fire(voice, event) {
  if (event.note) voice.triggerAttackRelease(event.note, event.duration, event.time, event.velocity);
  else voice.triggerAttackRelease(event.duration, event.time, event.velocity);
}

/**
 * Render `bars` of music starting at `startBar`, advancing `state`.
 * Returns { buffer, startBar, bars, plans } — plans so the caller can show
 * what is playing without re-deriving it.
 */
export async function renderChunk({ state, startBar, bars, bypass = new Set() }) {
  const musicSeconds = bars * SECONDS_PER_BAR;

  // Decide the whole chunk before rendering. planBar advances the
  // composition, and doing it outside Tone.Offline keeps the render callback
  // to nothing but scheduling.
  const plans = [];
  for (let i = 0; i < bars; i++) plans.push(planBar(state, startBar + i));

  const buffer = await Tone.Offline(async () => {
    Tone.getTransport().bpm.value = BPM;
    const master = createMaster(bypass);
    const light = bypass.has('light');
    const voices = {
      keys: light ? null : createKeys(master.bus, master.send, bypass),
      lead: light ? null : createLead(master.bus, master.send, bypass),
      bass: createBass(master.bus),
    };
    const kit = createDrumKit(master.bus);
    const targets = {
      kick: kit.kick, click: kit.click, snare: kit.snare, hat: kit.hat,
      keys: voices.keys, bass: voices.bass, lead: voices.lead,
    };

    for (let i = 0; i < bars; i++) {
      const plan = plans[i];
      const barStart = i * SECONDS_PER_BAR;

      // The section filter, moved as the arrangement moves. Offline there is
      // no draw loop to fight, so it is simply ramped in place.
      if (master.tone) {
        master.tone.frequency.rampTo(1400 + plan.section.tone * 8100, 2.4, barStart);
      }

      const events = eventsForBar(plan, SECONDS_PER_BAR);
      for (const [name, list] of Object.entries(events)) {
        const voice = targets[name];
        if (!voice || bypass.has(name)) continue;
        for (const event of list) fire(voice, { ...event, time: barStart + event.time });
      }
    }
    Tone.getTransport().start();
  }, musicSeconds + TAIL_SECONDS);

  return { buffer, startBar, bars, plans, musicSeconds };
}

/**
 * An AudioBuffer as a WAV blob, which is what an <audio> element will take.
 * Uncompressed on purpose: an encoder would cost more time than it saves,
 * and the blob never leaves the device.
 */
export function toWavBlob(buffer) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const bytes = 44 + frames * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, frames * channels * 2, true);

  const data = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}
