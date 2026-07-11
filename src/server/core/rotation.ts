// Pure outcome computation for closing out a vault. No Devvit imports here
// (no redis, no context) so this stays trivially unit-testable, same as
// src/shared/game.ts and src/shared/scratchpad.ts. The redis-touching
// orchestration that calls these lives in ./vault.ts.

import type { ArchiveScoreEntry, BoardEntry } from '../../shared/api';

export const ASSIST_SCORE_THRESHOLD = 3;

const toScoreEntry = (entry: BoardEntry): ArchiveScoreEntry => ({
  userId: entry.userId,
  username: entry.username,
  correctPosition: entry.correctPosition,
  correctDigitWrongPosition: entry.correctDigitWrongPosition,
});

/**
 * Assist credit: every guess that got ASSIST_SCORE_THRESHOLD+ digits in the
 * EXACT correct position, other than the winner's own guess — the winner
 * already gets "cracked it" credit, not an assist.
 *
 * Deliberately still keyed on correctPosition alone, not the new
 * correctDigitWrongPosition number. Assist credit is meant to recognize
 * guesses that meaningfully narrowed down the *actual* combination for
 * whoever cracked it later — correctPosition is the number that maps
 * directly onto "this guess was mostly the right combination," while
 * correctDigitWrongPosition (right digit, wrong slot) doesn't tell you which
 * slot is right and so is weaker signal of "this guess nearly cracked it."
 * Folding both numbers into one assist score would also require picking an
 * arbitrary weighting between them — correctPosition-only keeps the credit
 * rule simple and matches the pre-existing threshold value/semantics.
 */
export const computeAssists = (board: BoardEntry[], winnerUserId: string): ArchiveScoreEntry[] =>
  board
    .filter((entry) => entry.userId !== winnerUserId && entry.correctPosition >= ASSIST_SCORE_THRESHOLD)
    .map(toScoreEntry);

/**
 * Closest guess(es): every board entry tied at the highest rank, where rank
 * sorts primarily by correctPosition (the number that actually gets you
 * closer to cracking the vault) and breaks ties by correctDigitWrongPosition.
 * correctDigitWrongPosition is capped at COMBINATION_LENGTH (5), so weighting
 * correctPosition by 10 keeps the two numbers from ever colliding. An empty
 * board (nobody guessed that day) returns an empty list rather than throwing.
 */
export const computeClosest = (board: BoardEntry[]): ArchiveScoreEntry[] => {
  if (board.length === 0) return [];
  const rank = (entry: BoardEntry): number => entry.correctPosition * 10 + entry.correctDigitWrongPosition;
  const maxRank = Math.max(...board.map(rank));
  return board.filter((entry) => rank(entry) === maxRank).map(toScoreEntry);
};
