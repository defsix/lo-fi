// What the music is, separated from how it reaches the speakers.
//
// The engine used to decide each bar inside its transport callback, which
// meant the composition only existed while playing live. Rendering chunks
// offline needs the same decisions with no transport at all, and two copies
// of "what happens in bar 37" would drift apart within a week. So the
// decisions live here, and both paths ask this module.
//
// A plan is what a bar contains. Events are that plan flattened into notes
// with times, groove included. Neither touches an audio node.

import { pickKey, pickProgression, pickProgressionFor, buildChords } from './theory.js';
import { compForBar, bassForBar } from './arrange.js';
import { makeMotif, realiseMotif } from './melody.js';
import { drumsForBar } from './drums.js';
import { grooveOffset, accent } from './groove.js';
import { sectionAt, isCycleStart } from './sections.js';

export const BARS_PER_PHRASE = 4;
export const STEPS_PER_BAR = 16;

// A reading from words, turned into the choices the composition makes.
// Only what the engine has a real lever for: melancholy picks the
// progression's colour, energy sets the tempo and how busy the drums are,
// space and warmth are applied by the renderer to reverb and filtering.
//
// Progressions are ordered from brightest to most inward in theory.js, so
// melancholy selects across that range rather than pretending to compose.
export function createComposition(sense = null, rng = Math.random) {
  const key = pickKey(rng);
  const progression = sense ? pickProgressionFor(sense.melancholy, rng) : pickProgression(rng);
  return { key, chords: buildChords(key, progression), motif: makeMotif(rng), sense };
}

// New material, same place in the arrangement.
export function renewMaterial(state, rng = Math.random) {
  state.key = pickKey(rng);
  const progression = state.sense ? pickProgressionFor(state.sense.melancholy, rng) : pickProgression(rng);
  state.chords = buildChords(state.key, progression);
  state.motif = makeMotif(rng);
  return state;
}

// Everything a bar plays, decided once. Mutates `state` where the
// arrangement calls for new material, so bar N+1 follows from bar N.
export function planBar(state, bar, rng = Math.random) {
  // A new motif every other phrase: enough repetition to feel composed,
  // enough change that eight bars in it hasn't become wallpaper.
  if (bar > 0 && bar % (BARS_PER_PHRASE * 2) === 0 && rng() < 0.7) {
    state.motif = makeMotif(rng);
  }

  // A fresh key and progression at the top of each cycle: the stream is
  // endless, so it should not be the same eight bars endlessly.
  let renewed = false;
  if (isCycleStart(bar)) {
    renewMaterial(state, rng);
    renewed = true;
  }

  const section = sectionAt(bar);
  // Which voices are new in this section, and how far into it we are. A
  // voice that has been silent for eight bars arriving at full weight on a
  // downbeat is the thing that makes a section change sound like a switch
  // being thrown rather than like the music picking up.
  // Compared against the section before this one, not the bar before, so
  // the flag holds for the whole entry rather than only on the downbeat.
  const sectionStart = bar - section.barInSection;
  const before = sectionStart > 0 ? sectionAt(sectionStart - 1) : null;
  const entering = {};
  if (before) {
    for (const voice of ['keys', 'lead', 'bass', 'drums']) {
      if (section.voices[voice] && !before.voices[voice]) entering[voice] = true;
    }
  }
  // Energy leans on the section's own density rather than replacing it, so
  // the arrangement still shapes the piece and the words tint it.
  const energy = state.sense ? state.sense.energy : 0;
  const density = Math.max(0.2, Math.min(1, section.density * (1 + energy * 0.35)));
  const index = bar % state.chords.length;
  const chord = state.chords[index];
  const nextChord = state.chords[(index + 1) % state.chords.length];
  const barInPhrase = bar % BARS_PER_PHRASE;

  return {
    bar,
    chord,
    section,
    entering,
    barInSection: section.barInSection,
    key: state.key,
    renewed,
    // Thinning the comping on the second half of the phrase keeps eight
    // bars from landing as the same bar four times.
    comp: section.voices.keys ? compForBar(chord, barInPhrase !== 2 && density > 0.7, rng) : [],
    bass: section.voices.bass ? bassForBar(chord, nextChord, rng) : [],
    // The melody sits out sparse sections entirely, and thins in the rest.
    melody:
      section.voices.lead && rng() < density
        ? realiseMotif(state.motif, chord, state.key, barInPhrase, rng)
        : [],
    drums: section.voices.drums && (energy > -0.75 || section.density > 0.5)
      ? drumsForBar(section.isLastBar ? 3 : barInPhrase, rng)
      : { kick: [], snare: [], ghosts: [], hats: [], fill: [] },
  };
}

// A plan flattened into notes with times in seconds from the bar's start,
// microtiming applied. Grouped by voice and sorted, because the groove moves
// notes across step boundaries — a ghost sits earlier than a snare, so on
// adjacent steps they come out of order, and a monophonic voice rejects a
// time earlier than the last one it was given.
export function eventsForBar(plan, secondsPerBar, rng = Math.random) {
  const stepDur = secondsPerBar / STEPS_PER_BAR;
  // A voice entering a section comes in under its eventual weight for the
  // first two bars. Not a fade — the notes are all there, played more
  // lightly, which is what a player does rather than what a mixer does.
  const entry = (voice) => {
    if (!plan.entering || !plan.entering[voice]) return 1;
    if (plan.barInSection === 0) return 0.55;
    if (plan.barInSection === 1) return 0.8;
    return 1;
  };
  const drumEntry = entry('drums');
  const leadEntry = entry('lead');
  const keysEntry = entry('keys');
  // Never before the start of the bar. The groove pulls some voices earlier
  // than their step, and on step 0 of the very first bar that lands at a
  // negative time, which Web Audio rejects outright.
  const at = (step, voice) => Math.max(0, step * stepDur + grooveOffset(step, voice));
  const out = { kick: [], click: [], snare: [], hat: [], keys: [], bass: [], lead: [] };
  const { comp, bass, melody, drums } = plan;

  for (const step of drums.kick) {
    const velocity = 0.85 + rng() * 0.12;
    out.kick.push({ note: 'A1', duration: '8n', time: at(step, 'kick'), velocity: velocity * drumEntry });
    out.click.push({ duration: '32n', time: at(step, 'kick'), velocity: velocity * 0.6 * drumEntry });
  }
  for (const step of [...drums.snare, ...drums.fill]) {
    out.snare.push({ duration: '16n', time: at(step, 'snare'), velocity: (0.62 + rng() * 0.14) * drumEntry });
  }
  for (const step of drums.ghosts) {
    // A ghost and a backbeat on the same step would put two notes on one
    // voice out of order, since the ghost sits earlier in the groove.
    if (drums.snare.includes(step) || drums.fill.includes(step)) continue;
    out.snare.push({ duration: '32n', time: at(step, 'ghost'), velocity: (0.12 + rng() * 0.08) * drumEntry });
  }
  for (const step of drums.hats) {
    out.hat.push({ duration: '32n', time: at(step, 'hat'), velocity: accent(step) * (0.5 + rng() * 0.16) * drumEntry });
  }

  for (const hit of comp) {
    // Rolled rather than struck as a block.
    hit.notes.forEach((note, i) => {
      out.keys.push({ note, duration: hit.duration, time: at(hit.step, 'keys') + i * hit.roll, velocity: hit.velocity * keysEntry });
    });
  }
  for (const hit of bass) {
    out.bass.push({ note: hit.note, duration: hit.duration, time: at(hit.step, 'bass'), velocity: hit.velocity });
  }
  for (const note of melody) {
    out.lead.push({ note: note.note, duration: note.duration, time: at(note.step, 'lead'), velocity: note.velocity * leadEntry });
  }

  for (const voice of Object.keys(out)) out[voice].sort((a, b) => a.time - b.time);
  return out;
}
