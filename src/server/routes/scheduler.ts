import { Hono } from 'hono';
import type { TaskRequest, TaskResponse } from '@devvit/web/server';
import { runDailyRotation } from '../core/vault';

export const scheduler = new Hono();

// Fired once daily at midnight UTC (see devvit.json scheduler.tasks). Closes
// out yesterday's vault and stores its archive record. Does not touch
// today's vault — that still lazy-creates on first access as before.
scheduler.post('/daily-rotation', async (c) => {
  await c.req.json<TaskRequest>().catch(() => undefined);

  try {
    const result = await runDailyRotation();
    if (!result.closed) {
      console.log(`Daily rotation: ${result.reason}`);
    } else {
      console.log(
        `Daily rotation: closed vault for ${result.date} (${result.archive.status}${result.alreadyArchived ? ', already archived' : ''})`
      );
    }
    return c.json<TaskResponse>({ status: 'ok' }, 200);
  } catch (error) {
    console.error('Daily rotation error:', error);
    return c.json<TaskResponse>({ status: 'error' }, 500);
  }
});
