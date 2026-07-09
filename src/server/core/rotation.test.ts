import { describe, expect, it } from 'vitest';
import type { BoardEntry } from '../../shared/api';
import { ASSIST_SCORE_THRESHOLD, computeAssists, computeClosest } from './rotation';

const entry = (userId: string, score: number, username = userId): BoardEntry => ({
  userId,
  username,
  guess: '01234',
  score,
  ts: 0,
});

describe('computeAssists', () => {
  it('returns an empty list for an empty board', () => {
    expect(computeAssists([], 'winner')).toEqual([]);
  });

  it('includes entries at or above the assist threshold', () => {
    const board = [entry('a', ASSIST_SCORE_THRESHOLD), entry('b', ASSIST_SCORE_THRESHOLD + 1)];
    const assists = computeAssists(board, 'nobody-won');
    expect(assists.map((a) => a.userId).sort()).toEqual(['a', 'b']);
  });

  it('excludes entries below the assist threshold', () => {
    const board = [entry('a', ASSIST_SCORE_THRESHOLD - 1)];
    expect(computeAssists(board, 'nobody-won')).toEqual([]);
  });

  it('excludes the winner even if their score clears the threshold', () => {
    const board = [entry('winner', 5), entry('helper', ASSIST_SCORE_THRESHOLD)];
    const assists = computeAssists(board, 'winner');
    expect(assists).toHaveLength(1);
    expect(assists[0]?.userId).toBe('helper');
  });

  it('carries username and score through unchanged', () => {
    const board = [entry('a', 4, 'alice')];
    expect(computeAssists(board, 'winner')).toEqual([{ userId: 'a', username: 'alice', score: 4 }]);
  });
});

describe('computeClosest', () => {
  it('returns an empty list for an empty board', () => {
    expect(computeClosest([])).toEqual([]);
  });

  it('returns the single highest scorer when there is no tie', () => {
    const board = [entry('a', 2), entry('b', 4), entry('c', 1)];
    const closest = computeClosest(board);
    expect(closest).toHaveLength(1);
    expect(closest[0]?.userId).toBe('b');
  });

  it('returns every entry tied at the highest score', () => {
    const board = [entry('a', 3), entry('b', 3), entry('c', 1)];
    const closest = computeClosest(board);
    expect(closest.map((c) => c.userId).sort()).toEqual(['a', 'b']);
  });

  it('returns everyone when all scores are tied', () => {
    const board = [entry('a', 0), entry('b', 0)];
    expect(computeClosest(board).map((c) => c.userId).sort()).toEqual(['a', 'b']);
  });
});
