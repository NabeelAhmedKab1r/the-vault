import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import { todayUTC } from '../core/dateUTC';
import { completeQuest, getQuestStatus, QUEST_TARGET } from '../core/quest';
import { addCoins, equipScenery, equipSkin, getPlayerProfile, unlockScenery, unlockSkin } from '../core/player';
import { getLeaderboard, submitScore } from '../core/leaderboard';
import { getGhostReplay, sanitizeGhostInputs, saveGhostReplay } from '../core/ghost';
import { getDeathCounts, recordDeath, sanitizeObstacleIndex } from '../core/deathMarkers';
import { COIN_DISTANCE_DIVISOR, DEFAULT_SCENERY_ID, DEFAULT_SKIN_ID } from '../../shared/economy';
import type {
  DeathMarkersResponse,
  GhostResponse,
  LeaderboardResponse,
  PlayerResponse,
  QuestResponse,
  RunCompleteRequest,
  SceneryActionRequest,
  SceneryActionResponse,
  SkinActionRequest,
  SkinActionResponse,
} from '../../shared/api';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const api = new Hono();

api.get('/quest', async (c) => {
  const { userId } = context;

  if (!userId) {
    return c.json<QuestResponse>({
      type: 'quest',
      quest: { date: todayUTC(), target: QUEST_TARGET, completed: false },
    });
  }

  try {
    const quest = await getQuestStatus(userId);
    return c.json<QuestResponse>({ type: 'quest', quest });
  } catch (error) {
    console.error(`API Quest Error for user ${userId}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error loading quest';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.post('/quest/complete', async (c) => {
  const { userId } = context;

  if (!userId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'You must be logged in to complete a quest.' }, 401);
  }

  try {
    const quest = await completeQuest(userId);
    return c.json<QuestResponse>({ type: 'quest', quest });
  } catch (error) {
    console.error(`API Quest Complete Error for user ${userId}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error completing quest';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

const anonymousProfile = (): PlayerResponse => ({
  type: 'player',
  profile: {
    coins: 0,
    unlockedSkins: [DEFAULT_SKIN_ID],
    equippedSkin: DEFAULT_SKIN_ID,
    unlockedScenery: [DEFAULT_SCENERY_ID],
    equippedScenery: DEFAULT_SCENERY_ID,
  },
});

api.get('/player', async (c) => {
  const { userId } = context;

  if (!userId) {
    return c.json<PlayerResponse>(anonymousProfile());
  }

  try {
    const profile = await getPlayerProfile(userId);
    return c.json<PlayerResponse>({ type: 'player', profile });
  } catch (error) {
    console.error(`API Player Error for user ${userId}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error loading player profile';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

// Reports a finished run's distance. Coins are computed and credited here
// (never trusting a client-supplied amount), and the same distance also
// updates the user's best-today leaderboard entry if it's an improvement —
// one report, both systems updated, rather than a second round-trip.
api.post('/run-complete', async (c) => {
  const { userId } = context;

  const body = await c.req.json<RunCompleteRequest>().catch(() => null);
  const distance =
    body && typeof body.distance === 'number' && Number.isFinite(body.distance) ? Math.max(0, Math.floor(body.distance)) : 0;

  if (!userId) {
    return c.json<PlayerResponse>(anonymousProfile());
  }

  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const coinsEarned = Math.floor(distance / COIN_DISTANCE_DIVISOR);
    const [profile, scoreResult] = await Promise.all([
      addCoins(userId, coinsEarned),
      submitScore(userId, username, distance),
    ]);
    const followUps: Promise<unknown>[] = [];
    if (scoreResult.becameNumberOne) {
      const inputs = sanitizeGhostInputs(body?.inputs);
      followUps.push(saveGhostReplay({ userId, username, score: distance, inputs }));
    }
    const deathObstacleIndex = sanitizeObstacleIndex(body?.deathObstacleIndex);
    if (deathObstacleIndex !== null) {
      followUps.push(recordDeath(deathObstacleIndex));
    }
    if (followUps.length > 0) await Promise.all(followUps);

    return c.json<PlayerResponse>({ type: 'player', profile });
  } catch (error) {
    console.error(`API Run Complete Error for user ${userId}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error crediting coins';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.get('/ghost', async (c) => {
  try {
    const replay = await getGhostReplay();
    return c.json<GhostResponse>({ type: 'ghost', replay });
  } catch (error) {
    console.error('API Ghost Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error loading ghost replay';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.get('/death-markers', async (c) => {
  try {
    const counts = await getDeathCounts();
    return c.json<DeathMarkersResponse>({ type: 'deathMarkers', counts });
  } catch (error) {
    console.error('API Death Markers Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error loading death markers';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

const LEADERBOARD_LIMIT = 10;

api.get('/leaderboard', async (c) => {
  const { userId } = context;
  try {
    const result = await getLeaderboard(userId, LEADERBOARD_LIMIT);
    return c.json<LeaderboardResponse>({ type: 'leaderboard', ...result });
  } catch (error) {
    console.error('API Leaderboard Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error loading leaderboard';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.post('/skins/unlock', async (c) => {
  const { userId } = context;
  if (!userId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'You must be logged in to unlock skins.' }, 401);
  }

  const body = await c.req.json<SkinActionRequest>().catch(() => null);
  if (!body || typeof body.skinId !== 'string') {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing skinId.' }, 400);
  }

  try {
    const result = await unlockSkin(userId, body.skinId);
    const response: SkinActionResponse = result.error
      ? { type: 'skin', status: 'error', error: result.error, profile: result.profile }
      : { type: 'skin', status: 'ok', profile: result.profile };
    return c.json<SkinActionResponse>(response, result.error ? 400 : 200);
  } catch (error) {
    console.error(`API Skin Unlock Error for user ${userId}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error unlocking skin';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.post('/skins/equip', async (c) => {
  const { userId } = context;
  if (!userId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'You must be logged in to equip skins.' }, 401);
  }

  const body = await c.req.json<SkinActionRequest>().catch(() => null);
  if (!body || typeof body.skinId !== 'string') {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing skinId.' }, 400);
  }

  try {
    const result = await equipSkin(userId, body.skinId);
    const response: SkinActionResponse = result.error
      ? { type: 'skin', status: 'error', error: result.error, profile: result.profile }
      : { type: 'skin', status: 'ok', profile: result.profile };
    return c.json<SkinActionResponse>(response, result.error ? 400 : 200);
  } catch (error) {
    console.error(`API Skin Equip Error for user ${userId}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error equipping skin';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.post('/scenery/unlock', async (c) => {
  const { userId } = context;
  if (!userId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'You must be logged in to unlock scenery.' }, 401);
  }

  const body = await c.req.json<SceneryActionRequest>().catch(() => null);
  if (!body || typeof body.sceneryId !== 'string') {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing sceneryId.' }, 400);
  }

  try {
    const result = await unlockScenery(userId, body.sceneryId);
    const response: SceneryActionResponse = result.error
      ? { type: 'scenery', status: 'error', error: result.error, profile: result.profile }
      : { type: 'scenery', status: 'ok', profile: result.profile };
    return c.json<SceneryActionResponse>(response, result.error ? 400 : 200);
  } catch (error) {
    console.error(`API Scenery Unlock Error for user ${userId}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error unlocking scenery';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.post('/scenery/equip', async (c) => {
  const { userId } = context;
  if (!userId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'You must be logged in to equip scenery.' }, 401);
  }

  const body = await c.req.json<SceneryActionRequest>().catch(() => null);
  if (!body || typeof body.sceneryId !== 'string') {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing sceneryId.' }, 400);
  }

  try {
    const result = await equipScenery(userId, body.sceneryId);
    const response: SceneryActionResponse = result.error
      ? { type: 'scenery', status: 'error', error: result.error, profile: result.profile }
      : { type: 'scenery', status: 'ok', profile: result.profile };
    return c.json<SceneryActionResponse>(response, result.error ? 400 : 200);
  } catch (error) {
    console.error(`API Scenery Equip Error for user ${userId}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error equipping scenery';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});
