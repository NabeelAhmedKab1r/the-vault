// Small, dependency-free seeded PRNG so a given day's obstacle sequence is
// reproducible across every player (and across retries by the same
// player) instead of using Math.random(). mulberry32 is a small, fast,
// widely-published PRNG; xmur3-style hashing turns an arbitrary string
// (e.g. today's UTC date) into the 32-bit integer seed it needs.
// Reimplemented directly rather than pulled in as a dependency for
// something this small and well-known.

/** Turns an arbitrary string into a 32-bit integer seed. */
export const hashStringToSeed = (str: string): number => {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
};

/**
 * mulberry32: returns a generator matching Math.random()'s `() => number`
 * in [0, 1) signature, so it's a drop-in replacement anywhere Math.random()
 * was used for something that now needs to be deterministic.
 */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Convenience: a seeded RNG generator directly from a string seed (e.g. "2026-07-11"). */
export const rngFromString = (seed: string): (() => number) => mulberry32(hashStringToSeed(seed));
