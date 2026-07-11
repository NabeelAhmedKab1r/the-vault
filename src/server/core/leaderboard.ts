// Today's leaderboard: each user's BEST score for TODAY's UTC date. Uses a
// Redis sorted set for efficient ranking — the same zAdd/zRange primitives
// vault.ts already uses for its archive index — plus a small companion
// hash for usernames, since a sorted set member can't carry extra
// metadata. Same lazy date-keyed pattern as quest.ts: a new day is just a
// new, empty key, no rotation/cron job needed to "reset" it.

import { redis } from '@devvit/web/server';
import { todayUTC } from './vault';

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

/**
 * Records `score` as this user's result for today, but only keeps it if
 * it's a new best — a worse run should never overwrite a better one from
 * earlier today. Username is only refreshed alongside an improving score
 * (cheap to skip otherwise; a stale display name for one day is harmless).
 */
export const submitScore = async (userId: string, username: string, score: number): Promise<void> => {
  const date = todayUTC();
  const current = await redis.zScore(scoresKey(date), userId);
  if (current !== undefined && current >= score) return;
  await redis.zAdd(scoresKey(date), { member: userId, score });
  await redis.hSet(namesKey(date), { [userId]: username });
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
