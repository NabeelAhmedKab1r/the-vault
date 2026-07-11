/**
 * YYYY-MM-DD in UTC — the shared "what day is it" every date-keyed Redis
 * pattern (quest.ts, leaderboard.ts, ghost.ts, deathMarkers.ts) builds its
 * keys from, so a new day is just a new, empty key with no rotation/cron
 * job needed to "reset" anything.
 */
export const todayUTC = (): string => new Date().toISOString().slice(0, 10);
