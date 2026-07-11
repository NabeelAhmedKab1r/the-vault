// Today's leaderboard: each user's BEST score for TODAY's UTC date. Uses a
// Redis sorted set for efficient ranking, plus a small companion hash for
// usernames, since a sorted set member can't carry extra metadata. Same
// lazy date-keyed pattern as quest.ts: a new day is just a new, empty key,
// no rotation/cron job needed to "reset" it.

import { redis } from '@devvit/web/server';
import { todayUTC } from './dateUTC';

export type LeaderboardEntry = {
  userId: string;
  username: string;
  score: number;
};

export type LeaderboardResult = {
  top: LeaderboardEntry[];
  me: { rank: number; score: number } | null;
};

const scoresKey = (date: string): string => `leaderboard:${date}`;
const namesKey = (date: string): string => `leaderboard:${date}:names`;

export type SubmitScoreResult = {
  /** True if, after this submission, this user is today's #1 — regardless of whether THIS particular submission was the one that got them there (matches "if the live player takes the #1 spot themselves... this should just naturally fall out" from the ghost-racer spec). */
  becameNumberOne: boolean;
};

/**
 * Records `score` as this user's result for today, but only keeps it if
 * it's a new best — a worse run should never overwrite a better one from
 * earlier today. Username is only refreshed alongside an improving score
 * (cheap to skip otherwise; a stale display name for one day is harmless).
 * The scoring/persistence behavior here is unchanged from before — the
 * only addition is the returned becameNumberOne flag, purely so the ghost
 * racer feature knows when to (re)save the replay, and re-derived from the
 * SAME sorted set rather than any separate bookkeeping.
 */
export const submitScore = async (userId: string, username: string, score: number): Promise<SubmitScoreResult> => {
  const date = todayUTC();
  const key = scoresKey(date);
  const current = await redis.zScore(key, userId);
  if (current === undefined || score > current) {
    await redis.zAdd(key, { member: userId, score });
    await redis.hSet(namesKey(date), { [userId]: username });
  }

  const top = await redis.zRange(key, 0, 0, { by: 'rank', reverse: true });
  const becameNumberOne = top.length > 0 && top[0]!.member === userId;
  return { becameNumberOne };
};

/**
 * Removes this user's own entry from today's leaderboard — dev-only, so a
 * tester can re-earn a clean #1 across repeated runs instead of being stuck
 * behind their own earlier best. Only ever touches the calling user's own
 * member in the sorted set/name hash, never anyone else's.
 */
export const removeMyScore = async (userId: string): Promise<void> => {
  const date = todayUTC();
  await redis.zRem(scoresKey(date), [userId]);
  await redis.hDel(namesKey(date), [userId]);
};

export const getLeaderboard = async (userId: string | undefined, limit: number): Promise<LeaderboardResult> => {
  const date = todayUTC();
  const sKey = scoresKey(date);
  const nKey = namesKey(date);

  const topRaw = await redis.zRange(sKey, 0, limit - 1, { by: 'rank', reverse: true });
  const names = topRaw.length > 0 ? await redis.hMGet(nKey, topRaw.map((e) => e.member)) : [];
  const top: LeaderboardEntry[] = topRaw.map((entry, i) => ({
    userId: entry.member,
    username: names[i] ?? 'unknown',
    score: entry.score,
  }));

  let me: LeaderboardResult['me'] = null;
  if (userId) {
    const [score, ascendingRank, total] = await Promise.all([
      redis.zScore(sKey, userId),
      redis.zRank(sKey, userId),
      redis.zCard(sKey),
    ]);
    // zRank is ascending (0 = lowest score) — flip to a 1-indexed
    // descending rank, where 1 is the best score today.
    if (score !== undefined && ascendingRank !== undefined) {
      me = { rank: total - ascendingRank, score };
    }
  }

  return { top, me };
};
