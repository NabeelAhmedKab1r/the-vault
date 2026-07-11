// Pure vault logic shared by the server (real scoring) and the client
// (scratch-pad hypothesis checking). No Devvit or DOM dependencies here
// so this file can run and be unit tested anywhere.

export const COMBINATION_LENGTH = 5;

/** Fisher-Yates shuffle of the digits 0-9, keeping the first N as the combination. */
export const generateCombination = (rng: () => number = Math.random): string => {
  const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = digits.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = digits[i]!;
    const b = digits[j]!;
    digits[i] = b;
    digits[j] = a;
  }
  return digits.slice(0, COMBINATION_LENGTH).join('');
};

export type GuessValidation = { valid: true } | { valid: false; error: string };

/** Format rules: exactly COMBINATION_LENGTH digits, 0-9, no repeats. */
export const validateGuessFormat = (guess: string): GuessValidation => {
  if (typeof guess !== 'string' || guess.length !== COMBINATION_LENGTH) {
    return { valid: false, error: `Guess must be exactly ${COMBINATION_LENGTH} digits.` };
  }
  if (!/^[0-9]+$/.test(guess)) {
    return { valid: false, error: 'Guess must contain only digits 0-9.' };
  }
  if (new Set(guess.split('')).size !== COMBINATION_LENGTH) {
    return { valid: false, error: 'Guess must not repeat any digit.' };
  }
  return { valid: true };
};

export type Score = {
  /** "Black peg" count: digits correct AND in the correct position. */
  correctPosition: number;
  /** "White peg" count: digits that appear in the combination, just not at that position. */
  correctDigitWrongPosition: number;
};

/**
 * Full Mastermind-style scoring. Since combinations are 5 unique digits with
 * no repeats, this is simple: any guessed digit not in the right position is
 * a "wrong position" hit as long as it appears somewhere else in the
 * combination — no duplicate-digit bookkeeping needed.
 *
 * correctPosition + correctDigitWrongPosition can never exceed
 * COMBINATION_LENGTH, since that's the total number of digits shared between
 * two 5-unique-digit strings in the best case.
 */
export const scoreGuess = (guess: string, combination: string): Score => {
  if (guess.length !== combination.length) {
    throw new Error('Guess and combination must be the same length.');
  }
  let correctPosition = 0;
  let correctDigitWrongPosition = 0;
  for (let i = 0; i < combination.length; i++) {
    if (guess[i] === combination[i]) {
      correctPosition++;
    } else if (combination.includes(guess[i]!)) {
      correctDigitWrongPosition++;
    }
  }
  return { correctPosition, correctDigitWrongPosition };
};
