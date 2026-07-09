import { describe, expect, it } from 'vitest';
import {
  COMBINATION_LENGTH,
  generateCombination,
  scoreGuess,
  validateGuessFormat,
} from './game';

describe('generateCombination', () => {
  it('produces a 5-digit string with no repeated digits', () => {
    for (let i = 0; i < 200; i++) {
      const combo = generateCombination();
      expect(combo).toHaveLength(COMBINATION_LENGTH);
      expect(new Set(combo.split('')).size).toBe(COMBINATION_LENGTH);
      expect(combo).toMatch(/^[0-9]{5}$/);
    }
  });

  it('is deterministic given a deterministic rng', () => {
    const seeded = () => 0; // always picks index 0 -> no swaps happen except last pick
    const a = generateCombination(seeded);
    const b = generateCombination(seeded);
    expect(a).toBe(b);
  });

  it('covers digits beyond the first five over many draws (not always 01234)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(generateCombination());
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('validateGuessFormat', () => {
  it('accepts a well-formed guess', () => {
    expect(validateGuessFormat('01234')).toEqual({ valid: true });
  });

  it('rejects wrong length', () => {
    expect(validateGuessFormat('1234').valid).toBe(false);
    expect(validateGuessFormat('123456').valid).toBe(false);
  });

  it('rejects non-digit characters', () => {
    expect(validateGuessFormat('1234a').valid).toBe(false);
    expect(validateGuessFormat('12-34').valid).toBe(false);
  });

  it('rejects repeated digits', () => {
    expect(validateGuessFormat('11234').valid).toBe(false);
  });
});

describe('scoreGuess', () => {
  it('returns 5 for an exact match', () => {
    expect(scoreGuess('12345', '12345')).toBe(5);
  });

  it('returns 0 when no positions match', () => {
    expect(scoreGuess('12345', '23451')).toBe(0);
  });

  it('counts only exact-position matches, not digit presence elsewhere', () => {
    // Every digit in '12345' appears somewhere in '15432', but only
    // position 0 ('1') actually lines up.
    expect(scoreGuess('12345', '15432')).toBe(1);
  });

  it('throws on mismatched lengths', () => {
    expect(() => scoreGuess('1234', '12345')).toThrow();
  });
});
