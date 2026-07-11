import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import {
  getBoard,
  getMyAttempt,
  getOrCreateTodayVault,
  getRecentArchive,
  submitGuess,
  todayUTC,
  toPublicVaultState,
} from '../core/vault';
import { completeQuest, getQuestStatus, QUEST_TARGET } from '../core/quest';
import { addCoins, equipSkin, getPlayerProfile, unlockSkin } from '../core/player';
import { getLeaderboard, submitScore } from '../core/leaderboard';
import { COIN_DISTANCE_DIVISOR, DEFAULT_SKIN_ID } from '../../shared/economy';
import type {
  ArchiveResponse,
  BoardResponse,
  GuessRequest,
  GuessResponse,
  InitResponse,
  LeaderboardResponse,
  PlayerResponse,
  QuestResponse,
  RunCompleteRequest,
  SkinActionRequest,
  SkinActionResponse,
} from '../../shared/api';

type ErrorResponse = {
  status: 'error';
  message: string;
};

const ARCHIVE_STRIP_LIMIT = 14;

export const api = new Hono();

api.get('/init', async (c) => {
  const { postId, userId } = context;

  if (!postId) {
    console.error('API Init Error: postId not found in devvit context');
    return c.json<ErrorResponse>(
      { status: 'error', message: 'postId is required but missing from context' },
      400
    );
  }

  try {
    const [vault, username] = await Promise.all([
      getOrCreateTodayVault(),
      reddit.getCurrentUsername(),
    ]);
    const [board, myAttempt] = await Promise.all([
      getBoard(vault.date),
      userId ? getMyAttempt(vault.date, userId) : Promise.resolve(null),
    ]);

    const response: InitResponse = {
      type: 'init',
      postId,
      username: username ?? 'anonymous',
      vault: toPublicVaultState(vault),
      board,
      myAttempt,
    };
    if (userId) response.userId = userId;

    return c.json<InitResponse>(response);
  } catch (error) {
    console.error(`API Init Error for post ${postId}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error during initialization';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

// Lightweight poll target for the shared board — no per-user attempt lookup,
// so it stays cheap to call on an interval.
api.get('/board', async (c) => {
  try {
    const vault = await getOrCreateTodayVault();
    const board = await getBoard(vault.date);
    return c.json<BoardResponse>({ type: 'board', vault: toPublicVaultState(vault), board });
  } catch (error) {
    console.error('API Board Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error loading board';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.get('/archive', async (c) => {
  try {
    const entries = await getRecentArchive(ARCHIVE_STRIP_LIMIT);
    return c.json<ArchiveResponse>({ type: 'archive', entries });
  } catch (error) {
    console.error('API Archive Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error loading archive';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

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
  profile: { coins: 0, unlockedSkins: [DEFAULT_SKIN_ID], equippedSkin: DEFAULT_SKIN_ID },
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
    const [profile] = await Promise.all([addCoins(userId, coinsEarned), submitScore(userId, username, distance)]);
    return c.json<PlayerResponse>({ type: 'player', profile });
  } catch (error) {
    console.error(`API Run Complete Error for user ${userId}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error crediting coins';
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

api.post('/guess', async (c) => {
  const { userId } = context;

  if (!userId) {
    return c.json<GuessResponse>(
      { type: 'guess', status: 'error', error: 'You must be logged in to submit a guess.' },
      401
    );
  }

  const body = await c.req.json<GuessRequest>().catch(() => null);
  if (!body || typeof body.guess !== 'string') {
    return c.json<GuessResponse>({ type: 'guess', status: 'error', error: 'Missing guess.' }, 400);
  }

  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const result = await submitGuess(userId, username, body.guess);
    return c.json<GuessResponse>({ type: 'guess', ...result }, result.status === 'error' ? 400 : 200);
  } catch (error) {
    console.error(`API Guess Error for user ${userId}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error submitting guess';
    return c.json<GuessResponse>({ type: 'guess', status: 'error', error: message }, 400);
  }
});
