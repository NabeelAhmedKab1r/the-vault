import { redis } from '@devvit/web/server';
import {
  COMBINATION_LENGTH,
  generateCombination,
  scoreGuess,
  validateGuessFormat,
} from '../../shared/game';
import type { ArchiveEntry, BoardEntry, VaultPublicState, VaultStatus } from '../../shared/api';
import { computeAssists, computeClosest } from './rotation';

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

/** YYYY-MM-DD in UTC, offset by `daysOffset` whole days from now. The vault always rotates at midnight UTC. */
const dateUTCOffset = (daysOffset: number): string =>
  new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

export const todayUTC = (): string => dateUTCOffset(0);

const vaultKey = (date: string): string => `vault:${date}`;
const attemptsKey = (date: string): string => `attempts:${date}`;
const archiveKey = (date: string): string => `archive:${date}`;
const ARCHIVE_INDEX_KEY = 'archive:index';
const dateToScore = (date: string): number => Number(date.replace(/-/g, ''));

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
 * next access. Also clears any archive entry for today, in case it was
 * closed via the dev-only rotation trigger — otherwise a stale archive
 * entry would sit next to a freshly-generated vault for the same date.
 * Only ever called from the moderator-only, subreddit-gated menu action in
 * routes/menu.ts — never reachable from the game UI.
 */
export const resetTodayVault = async (): Promise<string> => {
  const date = todayUTC();
  await redis.del(vaultKey(date), attemptsKey(date), archiveKey(date));
  await redis.zRem(ARCHIVE_INDEX_KEY, [date]);
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

export type RotationOutcome =
  | { closed: true; alreadyArchived: boolean; date: string; archive: ArchiveEntry }
  | { closed: false; date: string; reason: string };

/**
 * Closes out the vault for `date` and stores its archive record. Idempotent:
 * if `date` was already archived, returns the existing entry instead of
 * recomputing it (safe to call twice if a cron retry or a dev click fires
 * more than once). Does not touch any other date's vault.
 */
const closeVaultAndArchive = async (date: string): Promise<RotationOutcome> => {
  const existingRaw = await redis.get(archiveKey(date));
  if (existingRaw) {
    return { closed: true, alreadyArchived: true, date, archive: JSON.parse(existingRaw) as ArchiveEntry };
  }

  const hash = await redis.hGetAll(vaultKey(date));
  if (!hash?.combination) {
    return { closed: false, date, reason: `No vault found for ${date} — nothing to close.` };
  }

  const vault = parseVaultRecord(date, hash);
  const board = await getBoard(date);

  const archive: ArchiveEntry =
    vault.status === 'cracked' && vault.crackedByUserId
      ? {
          date,
          status: 'cracked',
          combination: vault.combination,
          winner: { userId: vault.crackedByUserId, username: vault.crackedByUsername ?? 'unknown' },
          assists: computeAssists(board, vault.crackedByUserId),
          totalGuesses: board.length,
        }
      : {
          date,
          status: 'unsolved',
          combination: vault.combination,
          closest: computeClosest(board),
          totalGuesses: board.length,
        };

  await redis.set(archiveKey(date), JSON.stringify(archive));
  await redis.zAdd(ARCHIVE_INDEX_KEY, { member: date, score: dateToScore(date) });

  // "Closed" just means no longer accepting guesses. A cracked vault is
  // already closed; an active one that ran out the clock becomes expired.
  if (vault.status === 'active') {
    await redis.hSet(vaultKey(date), { status: 'expired' });
  }

  return { closed: true, alreadyArchived: false, date, archive };
};

/** Production entry point: called by the midnight-UTC cron job to close out yesterday's vault. */
export const runDailyRotation = async (): Promise<RotationOutcome> => closeVaultAndArchive(dateUTCOffset(-1));

/**
 * DEV-ONLY: closes out TODAY's vault immediately instead of waiting for a
 * real day boundary, using the exact same close+archive mechanics as
 * runDailyRotation. Only ever called from the moderator-only,
 * subreddit-gated menu action in routes/menu.ts.
 */
export const devCloseTodayVault = async (): Promise<RotationOutcome> => closeVaultAndArchive(todayUTC());

/** Fetches the most recently archived vaults, most recent first. */
export const getRecentArchive = async (limit: number): Promise<ArchiveEntry[]> => {
  const dates = await redis.zRange(ARCHIVE_INDEX_KEY, 0, limit - 1, { by: 'rank', reverse: true });
  if (dates.length === 0) return [];

  const raw = await redis.mGet(dates.map((d) => archiveKey(d.member)));
  return raw.filter((value): value is string => Boolean(value)).map((value) => JSON.parse(value) as ArchiveEntry);
};
