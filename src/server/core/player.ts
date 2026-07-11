// Per-user cosmetic profile: coin balance + unlocked/equipped skins.
// Unlike vault.ts/quest.ts this is NOT date-scoped — it's an ongoing
// player profile, not something that resets daily. Same Redis-hash-per-key
// pattern as the rest of the codebase, just keyed by userId instead of date.

import { redis } from '@devvit/web/server';
import type { PlayerProfile } from '../../shared/api';
import { DEFAULT_SKIN_ID, getSkin, isValidSkinId } from '../../shared/economy';

const playerKey = (userId: string): string => `player:${userId}`;

const parseUnlockedSkins = (raw: string | undefined): string[] => {
  if (!raw) return [DEFAULT_SKIN_ID];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
      return parsed.includes(DEFAULT_SKIN_ID) ? parsed : [DEFAULT_SKIN_ID, ...parsed];
    }
    return [DEFAULT_SKIN_ID];
  } catch {
    return [DEFAULT_SKIN_ID];
  }
};

export const getPlayerProfile = async (userId: string): Promise<PlayerProfile> => {
  const raw = await redis.hGetAll(playerKey(userId));
  const coins = raw?.coins ? Number(raw.coins) : 0;
  const unlockedSkins = parseUnlockedSkins(raw?.unlockedSkins);
  const equippedSkin = raw?.equippedSkin && unlockedSkins.includes(raw.equippedSkin) ? raw.equippedSkin : DEFAULT_SKIN_ID;
  return { coins, unlockedSkins, equippedSkin };
};

/** Called once per finished run with that run's earned coins (already computed by the caller from distance — this just credits it). */
export const addCoins = async (userId: string, amount: number): Promise<PlayerProfile> => {
  if (amount > 0) {
    await redis.hIncrBy(playerKey(userId), 'coins', amount);
  }
  return getPlayerProfile(userId);
};

export type SkinActionResult = { profile: PlayerProfile; error?: string };

/**
 * Unlocking an already-owned skin is just treated as an equip request
 * (idempotent, matches how the shop UI treats a tap on an owned swatch).
 * Coin check + deduction is a read-then-write, not a single atomic
 * transaction — acceptable here since this is a single-player cosmetic
 * balance, not real money, and the rest of this codebase takes the same
 * read-then-write approach outside the one place (vault crack claiming)
 * that specifically needed hSetNX's atomicity.
 */
export const unlockSkin = async (userId: string, skinId: string): Promise<SkinActionResult> => {
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

export const equipSkin = async (userId: string, skinId: string): Promise<SkinActionResult> => {
  const profile = await getPlayerProfile(userId);
  if (!profile.unlockedSkins.includes(skinId)) {
    return { profile, error: 'Skin not unlocked.' };
  }
  await redis.hSet(playerKey(userId), { equippedSkin: skinId });
  return { profile: { ...profile, equippedSkin: skinId } };
};
