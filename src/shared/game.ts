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

/**
 * Mastermind-style "black peg" count: digits that are correct AND in the
 * correct position. Never reveals which positions matched, only the count.
 */
export const scoreGuess = (guess: string, combination: string): number => {
  if (guess.length !== combination.length) {
    throw new Error('Guess and combination must be the same length.');
  }
  let exact = 0;
  for (let i = 0; i < combination.length; i++) {
    if (guess[i] === combination[i]) exact++;
  }
  return exact;
};
