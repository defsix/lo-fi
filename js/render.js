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
import { sectionAt } from './sections.js';
import { createVinyl, createTapeWobble, createSaturation, createPump } from './texture.js';

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
/**
 * `texture` is the lo-fi character: vinyl, tape wobble, saturation and the
 * pump against the kick. 0 is clean, 1 is the full amount. Clean is a real
 * choice rather than a degraded mode, and it is also the cheaper render.
 */
export async function renderChunk({ state, startBar, bars, bypass = new Set(), texture = 1, rng = Math.random }) {
  const musicSeconds = bars * SECONDS_PER_BAR;
  const dirt = Math.max(0, Math.min(1, texture));

  // Decide the whole chunk before rendering. planBar advances the
  // composition, and doing it outside Tone.Offline keeps the render callback
  // to nothing but scheduling.
  // What the sense actually turned into, reported back so it can be checked
  // rather than assumed.
  const applied = {};
  const plans = [];
  // `rng` is threaded through rather than left as Math.random so a render
  // can be made repeatable. Without it, comparing two renders compares two
  // different pieces of music: every measurement of a mix parameter here
  // was noise until this existed.
  for (let i = 0; i < bars; i++) plans.push(planBar(state, startBar + i, rng));

  const buffer = await Tone.Offline(async () => {
    Tone.getTransport().bpm.value = BPM;
    const master = createMaster(bypass);

    // Start the filter where the previous chunk left it. Every chunk builds
    // a fresh master, so without this the cutoff snapped back to its 9500Hz
    // default at each chunk boundary and slid down again — a sweep every
    // time the music handed over, landing on section changes because chunks
    // and sections are both whole numbers of phrases.
    if (master.tone) {
      const previous = sectionAt(Math.max(0, startBar - 1));
      master.tone.frequency.value = 1400 + previous.tone * 8100;
      applied.startCutoff = Math.round(master.tone.frequency.value);
    }
    const light = bypass.has('light');
    // Texture goes between the voices and the master, so it colours the
    // whole record rather than any one instrument. Built back to front:
    //
    //   voices -> pump -> saturation -> tape wobble -> master bus
    //
    // The vinyl is the exception and joins at the bus. Dust on a record's
    // surface is not something the music passes through, and it should not
    // be ducked by the kick or bent by the tape either.
    let vinyl = null;
    let pump = null;
    let target = master.bus;
    if (dirt > 0) {
      vinyl = createVinyl(master.bus, { crackle: dirt, hiss: dirt });
      const wobble = createTapeWobble(master.bus, { depth: dirt });
      const saturation = createSaturation(wobble.node, { amount: 0.35 * dirt });
      pump = createPump(saturation.node, { depth: 0.3 * dirt });
      target = pump.node;
    }

    // Space scales how much of the voices reach the reverb. A gain in front
    // of the send rather than a change to the reverb itself, so the room
    // stays the same room and the words only decide how far into it we are.
    const sense = state.sense;
    const space = sense ? sense.space : 0;
    const reverbSend = new Tone.Gain(Math.max(0.35, Math.min(1.8, 1 + space * 0.7))).connect(master.send);

    // Brightness on the voices themselves. Measured on an isolated chord
    // this spans about 3.8x of the energy above 1kHz; in a full mix the
    // reverb and the other voices dilute it to nearer 1.2x, which is a tint
    // rather than a transformation — which is what it should be.
    const warmth = sense ? sense.warmth : 0;
    const toneScale = Math.pow(2, warmth * 1.2);
    applied.toneScale = toneScale;
    applied.warmth = warmth;
    applied.space = space;

    const voices = {
      keys: light ? null : createKeys(target, reverbSend, bypass, toneScale),
      lead: light ? null : createLead(target, reverbSend, bypass, toneScale),
      bass: createBass(target),
    };
    const kit = createDrumKit(target);
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
        // The master filter still follows the arrangement; warmth is applied
        // on the voices instead, where it can be heard.
        const cutoff = 1400 + plan.section.tone * 8100;
        master.tone.frequency.rampTo(Math.max(900, Math.min(12000, cutoff)), 2.4, barStart);
      }

      const events = eventsForBar(plan, SECONDS_PER_BAR, rng);
      for (const [name, list] of Object.entries(events)) {
        const voice = targets[name];
        if (!voice || bypass.has(name)) continue;
        for (const event of list) fire(voice, { ...event, time: barStart + event.time });
      }

      // The record's own surface, and the mix breathing against the kick.
      // Both scheduled bar by bar, because an offline render has no timer to
      // run them from.
      if (vinyl) vinyl.scheduleBar(barStart, SECONDS_PER_BAR, rng);
      if (pump) for (const kick of events.kick) pump.duck(barStart + kick.time);
    }
    Tone.getTransport().start();
  }, musicSeconds + TAIL_SECONDS);

  return { buffer, startBar, bars, plans, musicSeconds, applied };
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
