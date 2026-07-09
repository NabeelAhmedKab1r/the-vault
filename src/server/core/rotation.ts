// Pure outcome computation for closing out a vault. No Devvit imports here
// (no redis, no context) so this stays trivially unit-testable, same as
// src/shared/game.ts and src/shared/scratchpad.ts. The redis-touching
// orchestration that calls these lives in ./vault.ts.

import type { ArchiveScoreEntry, BoardEntry } from '../../shared/api';

export const ASSIST_SCORE_THRESHOLD = 3;

const toScoreEntry = (entry: BoardEntry): ArchiveScoreEntry => ({
  userId: entry.userId,
  username: entry.username,
  score: entry.score,
});

/**
 * Assist credit: every guess that scored ASSIST_SCORE_THRESHOLD+ exact-position
 * digits, other than the winner's own guess — the winner already gets
 * "cracked it" credit, not an assist.
 */
export const computeAssists = (board: BoardEntry[], winnerUserId: string): ArchiveScoreEntry[] =>
  board
    .filter((entry) => entry.userId !== winnerUserId && entry.score >= ASSIST_SCORE_THRESHOLD)
    .map(toScoreEntry);

/**
 * Closest guess(es): every board entry tied at the highest score. An empty
 * board (nobody guessed that day) returns an empty list rather than throwing.
 */
export const computeClosest = (board: BoardEntry[]): ArchiveScoreEntry[] => {
  if (board.length === 0) return [];
  const maxScore = Math.max(...board.map((entry) => entry.score));
  return board.filter((entry) => entry.score === maxScore).map(toScoreEntry);
};
