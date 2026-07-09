import { describe, expect, it } from 'vitest';
import { checkHypothesis } from './scratchpad';

describe('checkHypothesis', () => {
  it('is vacuously fully consistent against an empty board', () => {
    const result = checkHypothesis('01234', []);
    expect(result).toEqual({
      hypothesis: '01234',
      results: [],
      consistentCount: 0,
      totalCount: 0,
      isFullyConsistent: true,
    });
  });

  it('marks a hypothesis consistent when it would reproduce the recorded score', () => {
    // scoreGuess('01987', '01234') = 2 (positions 0 and 1 match) — matches the recorded score.
    const result = checkHypothesis('01987', [{ username: 'alice', guess: '01234', score: 2 }]);
    expect(result.results).toEqual([
      {
        username: 'alice',
        guess: '01234',
        actualScore: 2,
        hypotheticalScore: 2,
        consistent: true,
      },
    ]);
    expect(result.consistentCount).toBe(1);
    expect(result.isFullyConsistent).toBe(true);
  });

  it('marks a hypothesis inconsistent when it would score differently than recorded', () => {
    // A hypothesis identical to a past guess would always score 5 against it,
    // which contradicts any recorded score below 5.
    const result = checkHypothesis('01234', [{ username: 'alice', guess: '01234', score: 2 }]);
    expect(result.results[0]).toMatchObject({
      hypotheticalScore: 5,
      actualScore: 2,
      consistent: false,
    });
    expect(result.consistentCount).toBe(0);
    expect(result.isFullyConsistent).toBe(false);
  });

  it('evaluates each board entry independently and summarizes counts', () => {
    const board = [
      { username: 'alice', guess: '01234', score: 2 },
      { username: 'bob', guess: '56789', score: 0 },
    ];
    const result = checkHypothesis('01987', board);

    expect(result.results.map((r) => r.consistent)).toEqual([true, false]);
    expect(result.consistentCount).toBe(1);
    expect(result.totalCount).toBe(2);
    expect(result.isFullyConsistent).toBe(false);
  });

  it('is fully consistent only when every board entry agrees', () => {
    const board = [
      { username: 'alice', guess: '01234', score: 2 },
      { username: 'bob', guess: '01987', score: 2 },
    ];
    // '01234' itself scores 5 against itself and 2 against '01987' -
    // agrees with bob's recorded score but not alice's.
    const result = checkHypothesis('01234', board);
    expect(result.isFullyConsistent).toBe(false);
    expect(result.consistentCount).toBe(1);
  });
});
