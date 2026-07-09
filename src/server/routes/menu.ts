import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post';
import { devCloseTodayVault, getOrCreateTodayVault, resetTodayVault } from '../core/vault';

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

menu.post('/dev-reset-vault', async (c) => {
  if (!isDevSubreddit()) {
    return c.json<UiResponse>(
      { showToast: 'Vault reset is disabled outside the dev test subreddit.' },
      403
    );
  }

  try {
    const date = await resetTodayVault();
    return c.json<UiResponse>(
      { showToast: `Vault reset for ${date}. Reload the post to get a fresh combination.` },
      200
    );
  } catch (error) {
    console.error(`Error resetting vault: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to reset vault' }, 400);
  }
});

// Runs the exact same close+archive mechanics as the real midnight-UTC cron
// job (see routes/scheduler.ts), but against TODAY's vault instead of
// yesterday's — so the archive flow can be exercised in one sitting instead
// of waiting for a real day boundary. Pair with "Reset today's vault" above
// to get a fresh vault again afterward.
menu.post('/dev-rotate-now', async (c) => {
  if (!isDevSubreddit()) {
    return c.json<UiResponse>(
      { showToast: 'Vault rotation is disabled outside the dev test subreddit.' },
      403
    );
  }

  try {
    const result = await devCloseTodayVault();
    if (!result.closed) {
      return c.json<UiResponse>({ showToast: result.reason }, 200);
    }
    const summary =
      result.archive.status === 'cracked'
        ? `cracked by ${result.archive.winner.username}`
        : `unsolved, ${result.archive.closest.length} closest guess(es)`;
    return c.json<UiResponse>(
      {
        showToast: `Closed ${result.date} (${summary}). Reload to see it in the archive strip.`,
      },
      200
    );
  } catch (error) {
    console.error(`Error running dev rotation: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to run rotation' }, 400);
  }
});

// Lets you feed yourself the winning guess to test the crack-reveal path
// live, instead of brute-forcing 5 unique digits. Logged too, in case the
// toast gets missed.
menu.post('/dev-reveal-combination', async (c) => {
  if (!isDevSubreddit()) {
    return c.json<UiResponse>(
      { showToast: 'Combination reveal is disabled outside the dev test subreddit.' },
      403
    );
  }

  try {
    const vault = await getOrCreateTodayVault();
    console.log(`[DEV] Today's (${vault.date}) combination: ${vault.combination}`);
    return c.json<UiResponse>(
      { showToast: `Today's combination is ${vault.combination} (also logged).` },
      200
    );
  } catch (error) {
    console.error(`Error revealing combination: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to reveal combination' }, 400);
  }
});
