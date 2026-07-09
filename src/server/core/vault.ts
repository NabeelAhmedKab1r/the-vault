import { redis } from '@devvit/web/server';
import {
  COMBINATION_LENGTH,
  generateCombination,
  scoreGuess,
  validateGuessFormat,
} from '../../shared/game';
import type { BoardEntry, VaultPublicState, VaultStatus } from '../../shared/api';

type VaultRecord = {
  date: string;
  combination: string;
  status: VaultStatus;
  createdAt: number;
  crackedByUserId?: string;
  crackedByUsername?: string;
  crackedAt?: number;
};

type StoredAttempt = {
  username: string;
  guess: string;
  score: number;
  ts: number;
};

export type SubmitGuessResult =
  | {
      status: 'ok';
      score: number;
      cracked: boolean;
      vault: VaultPublicState;
      board: BoardEntry[];
    }
  | {
      status: 'error';
      error: string;
    };

/** Today's date in UTC as YYYY-MM-DD. The vault always rotates at midnight UTC. */
export const todayUTC = (): string => new Date().toISOString().slice(0, 10);

const vaultKey = (date: string): string => `vault:${date}`;
const attemptsKey = (date: string): string => `attempts:${date}`;

const parseVaultRecord = (date: string, hash: Record<string, string>): VaultRecord => {
  const record: VaultRecord = {
    date,
    combination: hash.combination ?? '',
    status: (hash.status as VaultStatus | undefined) ?? 'active',
    createdAt: hash.createdAt ? Number(hash.createdAt) : Date.now(),
  };
  if (hash.crackedByUserId) record.crackedByUserId = hash.crackedByUserId;
  if (hash.crackedByUsername) record.crackedByUsername = hash.crackedByUsername;
  if (hash.crackedAt) record.crackedAt = Number(hash.crackedAt);
  return record;
};

/**
 * DEV-ONLY: wipes today's vault + attempts hash entirely, so a fresh
 * combination gets generated and the one-guess-per-day claim is cleared on
 * next access. Only ever called from the moderator-only, subreddit-gated
 * menu action in routes/menu.ts — never reachable from the game UI.
 */
export const resetTodayVault = async (): Promise<string> => {
  const date = todayUTC();
  await redis.del(vaultKey(date), attemptsKey(date));
  return date;
};

/**
 * Reads today's vault, creating it on first access. Creation is claimed via
 * hSetNX on the `combination` field, so concurrent first-requests of the day
 * can't generate two different combinations for the same date.
 */
export const getOrCreateTodayVault = async (): Promise<VaultRecord> => {
  const date = todayUTC();
  const key = vaultKey(date);

  const existing = await redis.hGetAll(key);
  if (existing?.combination) {
    return parseVaultRecord(date, existing);
  }

  const combination = generateCombination();
  const claimed = await redis.hSetNX(key, 'combination', combination);

  if (claimed) {
    await redis.hSet(key, { status: 'active', createdAt: String(Date.now()) });
    return { date, combination, status: 'active', createdAt: Date.now() };
  }

  // Lost the race to another concurrent request — read what it wrote instead.
  const winner = await redis.hGetAll(key);
  return parseVaultRecord(date, winner);
};

export const toPublicVaultState = (vault: VaultRecord): VaultPublicState => {
  const state: VaultPublicState = {
    date: vault.date,
    status: vault.status,
    combinationLength: COMBINATION_LENGTH,
  };
  if (vault.status !== 'active') state.revealedCombination = vault.combination;
  if (vault.crackedByUsername) state.crackedByUsername = vault.crackedByUsername;
  if (vault.crackedAt) state.crackedAt = vault.crackedAt;
  return state;
};

export const getBoard = async (date: string): Promise<BoardEntry[]> => {
  const raw = await redis.hGetAll(attemptsKey(date));
  if (!raw) return [];

  const entries: BoardEntry[] = Object.entries(raw).map(([userId, value]) => {
    const attempt = JSON.parse(value) as StoredAttempt;
    return {
      userId,
      username: attempt.username,
      guess: attempt.guess,
      score: attempt.score,
      ts: attempt.ts,
    };
  });

  entries.sort((a, b) => b.ts - a.ts);
  return entries;
};

export const getMyAttempt = async (
  date: string,
  userId: string
): Promise<StoredAttempt | null> => {
  const raw = await redis.hGet(attemptsKey(date), userId);
  if (!raw) return null;
  return JSON.parse(raw) as StoredAttempt;
};

/**
 * Marks the vault cracked. Two users could in principle submit the exact
 * correct combination in the same instant, so "who gets credit" is decided
 * with an atomic hSetNX claim on crackedByUserId rather than a read-then-write
 * — only one caller can ever win that claim.
 */
const markCracked = async (
  vault: VaultRecord,
  userId: string,
  username: string,
  ts: number
): Promise<VaultRecord> => {
  const key = vaultKey(vault.date);
  const claimed = await redis.hSetNX(key, 'crackedByUserId', userId);

  if (!claimed) {
    // Someone else's guess crossed the line first — reflect their win.
    const current = await redis.hGetAll(key);
    return parseVaultRecord(vault.date, current);
  }

  await redis.hSet(key, {
    status: 'cracked',
    crackedByUsername: username,
    crackedAt: String(ts),
  });

  return {
    ...vault,
    status: 'cracked',
    crackedByUserId: userId,
    crackedByUsername: username,
    crackedAt: ts,
  };
};

/** Enforces exactly one real guess per user per day via hSetNX on the attempts hash. */
export const submitGuess = async (
  userId: string,
  username: string,
  rawGuess: string
): Promise<SubmitGuessResult> => {
  const validation = validateGuessFormat(rawGuess);
  if (!validation.valid) {
    return { status: 'error', error: validation.error };
  }

  const vault = await getOrCreateTodayVault();
  if (vault.status !== 'active') {
    return {
      status: 'error',
      error: "Today's vault is already resolved — check back after the next reset.",
    };
  }

  const score = scoreGuess(rawGuess, vault.combination);
  const attempt: StoredAttempt = { username, guess: rawGuess, score, ts: Date.now() };

  const claimed = await redis.hSetNX(attemptsKey(vault.date), userId, JSON.stringify(attempt));
  if (!claimed) {
    return { status: 'error', error: 'You already made your one guess for today.' };
  }

  const cracked = score === COMBINATION_LENGTH;
  const finalVault = cracked ? await markCracked(vault, userId, username, attempt.ts) : vault;
  const board = await getBoard(vault.date);

  return {
    status: 'ok',
    score,
    cracked,
    vault: toPublicVaultState(finalVault),
    board,
  };
};
