import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import { getBoard, getMyAttempt, getOrCreateTodayVault, submitGuess, toPublicVaultState } from '../core/vault';
import type { BoardResponse, GuessRequest, GuessResponse, InitResponse } from '../../shared/api';

type ErrorResponse = {
  status: 'error';
  message: string;
};

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
