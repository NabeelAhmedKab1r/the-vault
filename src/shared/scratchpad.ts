// Client-side (and unit-testable) constraint checking for the scratch pad.
// Nothing here talks to the network — it just re-scores a hypothetical
// combination against the board's already-public (guess, score) pairs.

import { scoreGuess } from './game';

export type BoardEntryForCheck = {
  username: string;
  guess: string;
  score: number;
};

export type ScratchPadEntryResult = {
  username: string;
  guess: string;
  actualScore: number;
  hypotheticalScore: number;
  /** True if this board entry's recorded score is compatible with the hypothesis being the real combination. */
  consistent: boolean;
};

export type ScratchPadResult = {
  hypothesis: string;
  results: ScratchPadEntryResult[];
  consistentCount: number;
  totalCount: number;
  /** True when the hypothesis hasn't been ruled out by anything on the board. */
  isFullyConsistent: boolean;
};

/**
 * scoreGuess(a, b) only counts equal-position digits, so it's symmetric:
 * scoreGuess(guess, combination) === scoreGuess(combination, guess).
 * That means we can reuse it directly to ask "if `hypothesis` were the real
 * combination, would `entry.guess` have produced `entry.score`?" by scoring
 * the hypothesis against the recorded guess and comparing to the recorded
 * score — no separate scoring rule needed for the scratch pad.
 */
export const checkHypothesis = (
  hypothesis: string,
  board: BoardEntryForCheck[]
): ScratchPadResult => {
  const results: ScratchPadEntryResult[] = board.map((entry) => {
    const hypotheticalScore = scoreGuess(hypothesis, entry.guess);
    return {
      username: entry.username,
      guess: entry.guess,
      actualScore: entry.score,
      hypotheticalScore,
      consistent: hypotheticalScore === entry.score,
    };
  });

  const consistentCount = results.filter((r) => r.consistent).length;

  return {
    hypothesis,
    results,
    consistentCount,
    totalCount: results.length,
    isFullyConsistent: consistentCount === results.length,
  };
};
