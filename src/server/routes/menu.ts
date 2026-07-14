import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post';
import { addCoins } from '../core/player';
import { removeMyScore, seedFakeLeaderboard, type FakeLeaderboardEntry } from '../core/leaderboard';
import { clearMyGhostReplay } from '../core/ghost';
import { seedFakeDeathCounts, setDeathCountForTesting } from '../core/deathMarkers';
import { DEATH_MARKER_THRESHOLD } from '../../shared/api';

export const menu = new Hono();

menu.post('/post-create', async (c) => {
  try {
    const post = await createPost();

    return c.json<UiResponse>(
      { navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}` },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create the Vault post' }, 400);
  }
});

// DEV ONLY — DO NOT SHIP THESE ROUTES ACTIVE ON A REAL LAUNCH SUBREDDIT.
// Every handler below is gated two ways: (1) `forUserType: "moderator"` in
// devvit.json means it never appears in the player-facing game UI or to
// non-mods, and (2) each handler refuses to run anywhere except the named
// dev/test subreddit, so even a moderator on a real subreddit can't trigger
// it. Remove this whole block (and the matching devvit.json menu entries)
// before a real launch — the gate is a safety net, not a reason to ship it.
const DEV_ALLOWED_SUBREDDITS = new Set(['daily_vault_dev']);

const isDevSubreddit = (): boolean => {
  const subreddit = context.subredditName;
  if (subreddit && DEV_ALLOWED_SUBREDDITS.has(subreddit)) return true;
  console.warn(`Blocked dev-only menu action on subreddit: ${subreddit ?? 'unknown'}`);
  return false;
};

// Credits the invoking moderator's own coin balance so shop unlocks (skins,
// scenery) can be tested without grinding out runs for coins first.
const DEV_COIN_GRANT = 1000;

menu.post('/dev-add-coins', async (c) => {
  if (!isDevSubreddit()) {
    return c.json<UiResponse>({ showToast: 'Coin grants are disabled outside the dev test subreddit.' }, 403);
  }

  const { userId } = context;
  if (!userId) {
    return c.json<UiResponse>({ showToast: 'Could not identify your account — are you logged in?' }, 400);
  }

  try {
    const profile = await addCoins(userId, DEV_COIN_GRANT);
    return c.json<UiResponse>(
      { showToast: `+${DEV_COIN_GRANT} coins — you now have ${profile.coins}. Reload the post to see it.` },
      200
    );
  } catch (error) {
    console.error(`Error granting dev coins: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to grant coins' }, 400);
  }
});

// Wipes the invoking moderator's own leaderboard entry for TODAY (and, if
// they're currently today's #1, the stored ghost replay that goes with
// it), so the ghost racer feature can be re-tested from a clean slate
// across repeated runs instead of being stuck behind an earlier best.
// Never touches any other player's score/replay.
menu.post('/dev-clear-my-score', async (c) => {
  if (!isDevSubreddit()) {
    return c.json<UiResponse>(
      { showToast: 'Clearing scores is disabled outside the dev test subreddit.' },
      403
    );
  }

  const { userId } = context;
  if (!userId) {
    return c.json<UiResponse>({ showToast: 'Could not identify your account — are you logged in?' }, 400);
  }

  try {
    const [, clearedGhost] = await Promise.all([removeMyScore(userId), clearMyGhostReplay(userId)]);
    const ghostNote = clearedGhost ? ' and today’s ghost replay (it was yours)' : '';
    return c.json<UiResponse>(
      { showToast: `Cleared today's leaderboard entry${ghostNote}. Reload the post for a clean run.` },
      200
    );
  } catch (error) {
    console.error(`Error clearing dev score: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to clear score' }, 400);
  }
});

// Sets today's death count for the FIRST obstacle spawned each run (spawn
// index 0) to exactly DEATH_MARKER_THRESHOLD, so the community death-marker
// badge can be tested without actually dying there repeatedly. Idempotent —
// re-running always lands on exactly the threshold, not an ever-climbing
// increment. Start a run afterward (or retry an existing one) to see the
// badge on the very first obstacle.
const DEATH_MARKER_TEST_INDEX = 0;

menu.post('/dev-bump-death-marker', async (c) => {
  if (!isDevSubreddit()) {
    return c.json<UiResponse>(
      { showToast: 'Death marker testing is disabled outside the dev test subreddit.' },
      403
    );
  }

  try {
    await setDeathCountForTesting(DEATH_MARKER_TEST_INDEX, DEATH_MARKER_THRESHOLD);
    return c.json<UiResponse>(
      {
        showToast: `First obstacle now has ${DEATH_MARKER_THRESHOLD} deaths today. Start/retry a run to see its marker.`,
      },
      200
    );
  } catch (error) {
    console.error(`Error bumping dev death marker: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to bump death marker' }, 400);
  }
});

// Fills today's leaderboard with a full page of fake entries (fixed
// synthetic userIds — see leaderboard.ts's fakeUserId — so re-running this
// just overwrites the same fake rows instead of piling up more each click)
// and scatters death counts across several obstacle indices, for testing
// how the leaderboard/death-marker UI looks with realistic data volume.
// No ghost replay is created for the fake #1 — see seedFakeLeaderboard's
// doc comment for why that's fine for pure display testing. Never touches
// the calling moderator's own real leaderboard entry.
const FAKE_LEADERBOARD_ENTRIES: FakeLeaderboardEntry[] = [
  { username: 'ShadowRunner', score: 612 },
  { username: 'NightCrawler88', score: 540 },
  { username: 'VaultGhost', score: 487 },
  { username: 'SwiftFoxxo', score: 431 },
  { username: 'PixelThief', score: 375 },
  { username: 'GetawayKing', score: 298 },
  { username: 'DashMaster_', score: 214 },
  { username: 'QuickSilver99', score: 156 },
  { username: 'BackAlleyBandit', score: 92 },
  { username: 'RookieRunner', score: 34 },
];

// Index 1 is deliberately below DEATH_MARKER_THRESHOLD (3) so testing can
// confirm low-death obstacles do NOT get a marker, not just that high-death
// ones do.
const FAKE_DEATH_COUNTS: Record<number, number> = {
  0: 9,
  1: 2,
  2: 14,
  3: 5,
  5: 3,
  7: 21,
  10: 4,
};

menu.post('/dev-seed-fake-data', async (c) => {
  if (!isDevSubreddit()) {
    return c.json<UiResponse>(
      { showToast: 'Fake data seeding is disabled outside the dev test subreddit.' },
      403
    );
  }

  try {
    await Promise.all([seedFakeLeaderboard(FAKE_LEADERBOARD_ENTRIES), seedFakeDeathCounts(FAKE_DEATH_COUNTS)]);
    return c.json<UiResponse>(
      {
        showToast: `Seeded ${FAKE_LEADERBOARD_ENTRIES.length} fake leaderboard entries and death markers at ${Object.keys(FAKE_DEATH_COUNTS).length} obstacles. Reload the post to see them.`,
      },
      200
    );
  } catch (error) {
    console.error(`Error seeding fake test data: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to seed fake data' }, 400);
  }
});
