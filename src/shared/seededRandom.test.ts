import { describe, expect, it } from 'vitest';
import { hashStringToSeed, mulberry32, rngFromString } from './seededRandom';

describe('hashStringToSeed', () => {
  it('is deterministic for the same string', () => {
    expect(hashStringToSeed('2026-07-11')).toBe(hashStringToSeed('2026-07-11'));
  });

  it('produces different seeds for different strings', () => {
    expect(hashStringToSeed('2026-07-11')).not.toBe(hashStringToSeed('2026-07-12'));
  });

  it('always returns a non-negative 32-bit integer', () => {
    for (const s of ['', 'a', '2026-01-01', '2099-12-31', 'x'.repeat(50)]) {
      const h = hashStringToSeed(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('mulberry32', () => {
  it('produces the exact same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces a different sequence for a different seed', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('always returns numbers in [0, 1)', () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 500; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('does not repeat the same value indefinitely (sanity check it is actually varying)', () => {
    const rng = mulberry32(7);
    const values = new Set(Array.from({ length: 20 }, () => rng()));
    expect(values.size).toBeGreaterThan(15);
  });
});

describe('rngFromString', () => {
  it('is fully deterministic given the same string seed — the core guarantee Stage 3 depends on', () => {
    // Same "day" (string) must reproduce the identical sequence across
    // separate calls, standing in for separate page loads / players.
    const runA = rngFromString('2026-07-11');
    const runB = rngFromString('2026-07-11');
    const pickA = Array.from({ length: 15 }, () => Math.floor(runA() * 4));
    const pickB = Array.from({ length: 15 }, () => Math.floor(runB() * 4));
    expect(pickA).toEqual(pickB);
  });

  it('produces a different sequence for a different date', () => {
    const today = rngFromString('2026-07-11');
    const tomorrow = rngFromString('2026-07-12');
    const a = Array.from({ length: 15 }, () => Math.floor(today() * 4));
    const b = Array.from({ length: 15 }, () => Math.floor(tomorrow() * 4));
    expect(a).not.toEqual(b);
  });
});
