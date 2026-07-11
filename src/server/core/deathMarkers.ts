// Today's per-obstacle-index death counts — a Redis hash (obstacle spawn
// index -> death count), same lazy date-keyed pattern as quest.ts/
// leaderboard.ts/ghost.ts: a new day is just a new, empty key. "Obstacle
// index" is the Nth obstacle spawned in a run (see Runner.ts's
// spawnObstacle), which — since obstacle spawn ORDER is deterministic from
// the daily seed regardless of client framerate — refers to the same
// physical obstacle position across every player's run today.

import { redis } from '@devvit/web/server';
import { todayUTC } from './dateUTC';

const deathsKey = (date: string): string => `deaths:${date}`;

const MAX_OBSTACLE_INDEX = 100_000; // generous — a real run is nowhere close, just guards a malformed payload

export const sanitizeObstacleIndex = (raw: unknown): number | null => {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const index = Math.floor(raw);
  if (index < 0 || index > MAX_OBSTACLE_INDEX) return null;
  return index;
};

export const recordDeath = async (obstacleIndex: number): Promise<void> => {
  await redis.hIncrBy(deathsKey(todayUTC()), String(obstacleIndex), 1);
};

export const getDeathCounts = async (): Promise<Record<number, number>> => {
  const raw = await redis.hGetAll(deathsKey(todayUTC()));
  const counts: Record<number, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const index = Number(key);
    const count = Number(value);
    if (Number.isInteger(index) && index >= 0 && Number.isFinite(count)) {
      counts[index] = count;
    }
  }
  return counts;
};

/**
 * Dev-only: sets (not increments) today's death count for one obstacle
 * index directly, so a marker can be made to appear without actually
 * dying there repeatedly. Idempotent by design — re-running always lands
 * on exactly `count`, rather than an increment-based tool that would keep
 * climbing higher on every click.
 */
export const setDeathCountForTesting = async (obstacleIndex: number, count: number): Promise<void> => {
  await redis.hSet(deathsKey(todayUTC()), { [String(obstacleIndex)]: String(count) });
};
