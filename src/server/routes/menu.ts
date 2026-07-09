import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post';
import { resetTodayVault } from '../core/vault';

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

// DEV ONLY — DO NOT SHIP THIS ROUTE ACTIVE ON A REAL LAUNCH SUBREDDIT.
// Gated two ways: (1) `forUserType: "moderator"` in devvit.json means it
// never appears in the player-facing game UI or to non-mods, and (2) this
// handler refuses to run anywhere except the named dev/test subreddit, so
// even a moderator on a real subreddit can't trigger it. Wipes today's
// vault + attempts so the guess flow can be re-tested repeatedly.
const DEV_RESET_ALLOWED_SUBREDDITS = new Set(['daily_vault_dev']);

menu.post('/dev-reset-vault', async (c) => {
  const subreddit = context.subredditName;
  if (!subreddit || !DEV_RESET_ALLOWED_SUBREDDITS.has(subreddit)) {
    console.warn(`Blocked dev-reset-vault attempt on subreddit: ${subreddit ?? 'unknown'}`);
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
