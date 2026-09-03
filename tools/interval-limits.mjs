// Prints the low interval limits the engine derives from critical bandwidth,
// for checking against the tables arrangers use.
// Run: node tools/interval-limits.mjs

import { lowIntervalLimit, midiToFreq, erb } from '../js/voicing.js';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const INTERVALS = [
  [1, 'minor 2nd'],
  [2, 'major 2nd'],
  [3, 'minor 3rd'],
  [4, 'major 3rd'],
  [5, 'perfect 4th'],
  [6, 'tritone'],
  [7, 'perfect 5th'],
  [8, 'minor 6th'],
  [9, 'major 6th'],
  [10, 'minor 7th'],
  [12, 'octave'],
];

const noteName = (midi) => NAMES[midi % 12] + (Math.floor(midi / 12) - 1);

console.log('interval        lowest usable   freq      ERB there');
for (const [semitones, name] of INTERVALS) {
  const midi = lowIntervalLimit(semitones);
  if (midi === null) {
    console.log(`${name.padEnd(15)} never clear    - inside one critical band at every pitch`);
    continue;
  }
  const hz = midiToFreq(midi);
  console.log(
    `${name.padEnd(15)} ${noteName(midi).padEnd(14)} ${hz.toFixed(1).padStart(6)} Hz  ${erb(hz).toFixed(1).padStart(5)} Hz`
  );
}
