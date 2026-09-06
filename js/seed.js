// Making a track findable again.
//
// Every choice the composition makes already goes through an `rng` argument
// rather than Math.random directly — that was put in so two renders could be
// compared against each other. The same seam makes a track shareable: fix
// the source of the numbers and the same piece of music comes back.
//
// The awkward part is that chunks are not a fixed size. A device that
// renders quickly plans eight bars at a time, a slow one two, and a single
// running generator would hand out different numbers to bar 6 in each case
// — the same seed, two different tracks. So nothing draws from a shared
// stream. Each bar gets its own generator, derived from the seed and the
// bar number, and chunk boundaries stop mattering.

// No i, l, o or u: the seed gets read aloud and typed back in, and those are
// the four that get read back wrong.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const SEED_LENGTH = 8;

// What someone typing a seed probably meant.
const CONFUSIONS = { i: '1', l: '1', o: '0', u: 'v' };

/** A fresh seed. 40 bits, short enough to say out loud. */
export function makeSeed(random = Math.random) {
  let out = '';
  for (let i = 0; i < SEED_LENGTH; i++) out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return out;
}

/**
 * A seed from anything a URL or a person might supply. Returns null when
 * there is nothing usable left, so callers can tell "no seed given" from
 * "a seed that happens to be short".
 */
export function normaliseSeed(text) {
  if (!text) return null;
  const cleaned = String(text)
    .toLowerCase()
    .split('')
    .map((c) => CONFUSIONS[c] || c)
    .filter((c) => ALPHABET.includes(c))
    .join('')
    .slice(0, 16);
  return cleaned || null;
}

// xmur3: a string hash whose output is already well mixed, so that adjacent
// labels ("bar:6", "bar:7") do not produce adjacent generators.
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A generator for one part of one track. `label` names the part — the
 * composition, a particular bar, a particular phase of a bar — and two
 * different labels never share a stream, so the order in which they are
 * asked for numbers cannot change what any of them produces.
 */
export function seedRng(seed, label = '') {
  return mulberry32(xmur3(`${seed}/${label}`)());
}

/** The generator for one bar's `phase` of work under `seed`. */
export function barRngFor(seed) {
  return (bar, phase) => seedRng(seed, `${phase}:${bar}`);
}
