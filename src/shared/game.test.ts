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
  it('returns correctPosition 5 for an exact match, with no wrong-position hits', () => {
    expect(scoreGuess('12345', '12345')).toEqual({ correctPosition: 5, correctDigitWrongPosition: 0 });
  });

  it('returns all zeros when no digits are shared at all', () => {
    expect(scoreGuess('12345', '67890')).toEqual({ correctPosition: 0, correctDigitWrongPosition: 0 });
  });

  it('counts exact-position matches separately from digit-presence-elsewhere', () => {
    // Every digit in '12345' appears somewhere in '15432', but only
    // position 0 ('1') actually lines up — the rest are shared digits in
    // scrambled order, so they land in correctDigitWrongPosition instead.
    expect(scoreGuess('12345', '15432')).toEqual({ correctPosition: 1, correctDigitWrongPosition: 4 });
  });

  it('counts a fully scrambled guess as all wrong-position hits', () => {
    // '23451' is '12345' rotated by one — no position lines up, but every
    // digit is present elsewhere.
    expect(scoreGuess('12345', '23451')).toEqual({ correctPosition: 0, correctDigitWrongPosition: 5 });
  });

  it('mixes correct-position and wrong-position hits in one guess', () => {
    // combination '01234': guess '02143' -> pos0 '0' matches, pos2 '1' is
    // present elsewhere (pos1), pos... let's check each: guess=0,2,1,4,3
    // combo=0,1,2,3,4. i0: 0==0 correctPosition. i1: 2 vs 1, '2' is in combo -> wrong position.
    // i2: 1 vs 2, '1' is in combo -> wrong position. i3: 4 vs 3, '4' is in combo -> wrong position.
    // i4: 3 vs 4, '3' is in combo -> wrong position.
    expect(scoreGuess('02143', '01234')).toEqual({ correctPosition: 1, correctDigitWrongPosition: 4 });
  });

  it('does not count digits absent from the combination as wrong-position hits', () => {
    // combo '01234' has no '5' through '9', so a guess drawing from that
    // range only scores on the one overlapping digit ('0').
    expect(scoreGuess('05678', '01234')).toEqual({ correctPosition: 1, correctDigitWrongPosition: 0 });
  });

  it('keeps correctPosition + correctDigitWrongPosition within COMBINATION_LENGTH', () => {
    for (let i = 0; i < 200; i++) {
      const combo = generateCombination();
      const guess = generateCombination();
      const { correctPosition, correctDigitWrongPosition } = scoreGuess(guess, combo);
      expect(correctPosition + correctDigitWrongPosition).toBeLessThanOrEqual(COMBINATION_LENGTH);
    }
  });

  it('throws on mismatched lengths', () => {
    expect(() => scoreGuess('1234', '12345')).toThrow();
  });
});
