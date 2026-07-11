// Per-user cosmetic profile: coin balance + unlocked/equipped skins AND
// scenery. Unlike quest.ts/leaderboard.ts this is NOT date-scoped — it's an
// ongoing player profile, not something that resets daily. Same
// Redis-hash-per-key pattern as the rest of the codebase, just keyed by
// userId instead of date.

import { redis } from '@devvit/web/server';
import type { PlayerProfile } from '../../shared/api';
import {
  DEFAULT_SCENERY_ID,
  DEFAULT_SKIN_ID,
  getScenery,
  getSkin,
  isValidSceneryId,
  isValidSkinId,
} from '../../shared/economy';

const playerKey = (userId: string): string => `player:${userId}`;

const parseUnlockedList = (raw: string | undefined, defaultId: string): string[] => {
  if (!raw) return [defaultId];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
      return parsed.includes(defaultId) ? parsed : [defaultId, ...parsed];
    }
    return [defaultId];
  } catch {
    return [defaultId];
  }
};

export const getPlayerProfile = async (userId: string): Promise<PlayerProfile> => {
  const raw = await redis.hGetAll(playerKey(userId));
  const coins = raw?.coins ? Number(raw.coins) : 0;

  const unlockedSkins = parseUnlockedList(raw?.unlockedSkins, DEFAULT_SKIN_ID);
  const equippedSkin = raw?.equippedSkin && unlockedSkins.includes(raw.equippedSkin) ? raw.equippedSkin : DEFAULT_SKIN_ID;

  const unlockedScenery = parseUnlockedList(raw?.unlockedScenery, DEFAULT_SCENERY_ID);
  const equippedScenery =
    raw?.equippedScenery && unlockedScenery.includes(raw.equippedScenery) ? raw.equippedScenery : DEFAULT_SCENERY_ID;

  return { coins, unlockedSkins, equippedSkin, unlockedScenery, equippedScenery };
};

/** Called once per finished run with that run's earned coins (already computed by the caller from distance — this just credits it). */
export const addCoins = async (userId: string, amount: number): Promise<PlayerProfile> => {
  if (amount > 0) {
    await redis.hIncrBy(playerKey(userId), 'coins', amount);
  }
  return getPlayerProfile(userId);
};

export type ProfileActionResult = { profile: PlayerProfile; error?: string };

/**
 * Unlocking an already-owned skin is just treated as an equip request
 * (idempotent, matches how the shop UI treats a tap on an owned swatch).
 * Coin check + deduction is a read-then-write, not a single atomic
 * transaction — acceptable here since this is a single-player cosmetic
 * balance, not real money.
 */
export const unlockSkin = async (userId: string, skinId: string): Promise<ProfileActionResult> => {
  if (!isValidSkinId(skinId)) {
    return { profile: await getPlayerProfile(userId), error: 'Unknown skin.' };
  }

  const profile = await getPlayerProfile(userId);
  if (profile.unlockedSkins.includes(skinId)) {
    return equipSkin(userId, skinId);
  }

  const skin = getSkin(skinId);
  if (profile.coins < skin.cost) {
    return { profile, error: 'Not enough coins.' };
  }

  const unlockedSkins = [...profile.unlockedSkins, skinId];
  await redis.hSet(playerKey(userId), {
    unlockedSkins: JSON.stringify(unlockedSkins),
    equippedSkin: skinId,
  });
  await redis.hIncrBy(playerKey(userId), 'coins', -skin.cost);

  return { profile: await getPlayerProfile(userId) };
};

export const equipSkin = async (userId: string, skinId: string): Promise<ProfileActionResult> => {
  const profile = await getPlayerProfile(userId);
  if (!profile.unlockedSkins.includes(skinId)) {
    return { profile, error: 'Skin not unlocked.' };
  }
  await redis.hSet(playerKey(userId), { equippedSkin: skinId });
  return { profile: { ...profile, equippedSkin: skinId } };
};

/** Mirrors unlockSkin exactly, applied to the scenery category instead. */
export const unlockScenery = async (userId: string, sceneryId: string): Promise<ProfileActionResult> => {
  if (!isValidSceneryId(sceneryId)) {
    return { profile: await getPlayerProfile(userId), error: 'Unknown scenery.' };
  }

  const profile = await getPlayerProfile(userId);
  if (profile.unlockedScenery.includes(sceneryId)) {
    return equipScenery(userId, sceneryId);
  }

  const scenery = getScenery(sceneryId);
  if (profile.coins < scenery.cost) {
    return { profile, error: 'Not enough coins.' };
  }

  const unlockedScenery = [...profile.unlockedScenery, sceneryId];
  await redis.hSet(playerKey(userId), {
    unlockedScenery: JSON.stringify(unlockedScenery),
    equippedScenery: sceneryId,
  });
  await redis.hIncrBy(playerKey(userId), 'coins', -scenery.cost);

  return { profile: await getPlayerProfile(userId) };
};

export const equipScenery = async (userId: string, sceneryId: string): Promise<ProfileActionResult> => {
  const profile = await getPlayerProfile(userId);
  if (!profile.unlockedScenery.includes(sceneryId)) {
    return { profile, error: 'Scenery not unlocked.' };
  }
  await redis.hSet(playerKey(userId), { equippedScenery: sceneryId });
  return { profile: { ...profile, equippedScenery: sceneryId } };
};
