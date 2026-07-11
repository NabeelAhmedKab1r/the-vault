// Today's #1 run's replay: not position data, just the timestamped jump
// log (see shared/api.ts's GhostInputEvent for why replaying that against
// the same seeded obstacles is enough to reproduce the run). Same lazy
// date-keyed pattern as quest.ts/leaderboard.ts — a new day is just a new,
// empty key, no rotation/cron job needed.

import { redis } from '@devvit/web/server';
import type { GhostInputEvent, GhostReplay } from '../../shared/api';
import { todayUTC } from './dateUTC';

/** Server-internal shape — carries userId so leaderboard.ts can tell "is this ghost mine" without a second lookup; stripped before it ever reaches a client. */
export type StoredGhostReplay = GhostReplay & { userId: string };

const ghostKey = (date: string): string => `ghost:${date}`;

// Generous but bounded — a real run's jump count is naturally tiny
// (roughly one jump per obstacle, spawned every 1.6s) compared to this cap,
// this just guards against a malformed or pathological payload.
const MAX_INPUTS = 2000;
const MAX_INPUT_MS = 30 * 60 * 1000; // 30 minutes — no real run is anywhere close

export const sanitizeGhostInputs = (raw: unknown): GhostInputEvent[] => {
  if (!Array.isArray(raw)) return [];
  const cleaned: GhostInputEvent[] = [];
  for (const entry of raw) {
    if (cleaned.length >= MAX_INPUTS) break;
    if (
      entry &&
      typeof entry === 'object' &&
      'action' in entry &&
      (entry as { action: unknown }).action === 'jump' &&
      't' in entry &&
      typeof (entry as { t: unknown }).t === 'number' &&
      Number.isFinite((entry as { t: number }).t) &&
      (entry as { t: number }).t >= 0 &&
      (entry as { t: number }).t <= MAX_INPUT_MS
    ) {
      cleaned.push({ t: (entry as { t: number }).t, action: 'jump' });
    }
  }
  // Replay depends on inputs being in chronological order.
  cleaned.sort((a, b) => a.t - b.t);
  return cleaned;
};

export const getGhostReplay = async (): Promise<GhostReplay | null> => {
  const raw = await redis.get(ghostKey(todayUTC()));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredGhostReplay;
    return { username: parsed.username, score: parsed.score, inputs: parsed.inputs };
  } catch {
    return null;
  }
};

export const saveGhostReplay = async (replay: StoredGhostReplay): Promise<void> => {
  await redis.set(ghostKey(todayUTC()), JSON.stringify(replay));
};

/**
 * Dev-only: clears today's stored ghost replay, but ONLY if it belongs to
 * the calling user — pairs with leaderboard.ts's removeMyScore (a #1 replay
 * is meaningless once its owner's leaderboard entry is gone) without risking
 * wiping some other real player's #1 replay out from under them. Returns
 * whether anything was actually cleared, purely for the toast message.
 */
export const clearMyGhostReplay = async (userId: string): Promise<boolean> => {
  const key = ghostKey(todayUTC());
  const raw = await redis.get(key);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as StoredGhostReplay;
    if (parsed.userId !== userId) return false;
  } catch {
    return false;
  }
  await redis.del(key);
  return true;
};
