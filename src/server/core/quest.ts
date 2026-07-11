// Daily quest completion tracking. Follows the same lazy, UTC-date-keyed
// Redis pattern as leaderboard.ts/ghost.ts/deathMarkers.ts — a new day's
// completion set exists as soon as anyone reads or writes it, so "resets at
// midnight UTC" falls out of the date-scoped key automatically, no
// rotation/cron job needed to reset anything.

import { redis } from '@devvit/web/server';
import type { QuestStatus } from '../../shared/api';
import { todayUTC } from './dateUTC';

/** Obstacles to clear in a single run to complete today's quest. Fixed for now — the date-scoped key is what makes completion reset daily, not the target itself. */
export const QUEST_TARGET = 12;

const questKey = (date: string): string => `quest:${date}`;

export const getQuestStatus = async (userId: string): Promise<QuestStatus> => {
  const date = todayUTC();
  const completed = await redis.hGet(questKey(date), userId);
  return { date, target: QUEST_TARGET, completed: completed === '1' };
};

/** Idempotent: completing an already-completed quest just confirms the same status back, so retried/duplicate calls from the client are harmless. */
export const completeQuest = async (userId: string): Promise<QuestStatus> => {
  const date = todayUTC();
  await redis.hSet(questKey(date), { [userId]: '1' });
  return { date, target: QUEST_TARGET, completed: true };
};
