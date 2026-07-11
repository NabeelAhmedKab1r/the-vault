// Daily quest completion tracking. Follows the same lazy, UTC-date-keyed
// Redis pattern as vault.ts's getOrCreateTodayVault — a new day's
// completion set exists as soon as anyone reads or writes it, so "resets at
// midnight UTC" falls out of the date-scoped key automatically, the same
// way the vault itself resets without needing an explicit rotation step.
// (The vault's cron-triggered rotation is for ARCHIVING the outgoing day's
// result — the quest has no result worth archiving, so no cron involvement
// needed here.)

import { redis } from '@devvit/web/server';
import type { QuestStatus } from '../../shared/api';
import { todayUTC } from './vault';

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
