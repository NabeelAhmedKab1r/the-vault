export type QuestStatus = {
  date: string; // YYYY-MM-DD, UTC — a new date means a fresh, unearned quest
  target: number; // obstacles to clear in a single run to complete it
  completed: boolean;
};

export type QuestResponse = {
  type: 'quest';
  quest: QuestStatus;
};

export type PlayerProfile = {
  coins: number;
  unlockedSkins: string[];
  equippedSkin: string;
  unlockedScenery: string[];
  equippedScenery: string;
};

export type PlayerResponse = {
  type: 'player';
  profile: PlayerProfile;
};

/**
 * A single recorded jump, timestamped as milliseconds elapsed since that
 * run started (NOT wall-clock time, NOT frame count). Obstacle spawn
 * timing and jump airtime are both deliberately scale-factor-invariant
 * (see Runner.ts's REFERENCE_WIDTH-based tuning), so replaying these same
 * elapsed-time marks against the same seeded obstacle sequence reproduces
 * the run's obstacle-relative timing regardless of which device recorded
 * or replays it.
 */
export type GhostInputEvent = {
  t: number;
  action: 'jump';
};

export type RunCompleteRequest = {
  distance: number;
  /** This run's jump log — only actually stored server-side if this run becomes today's new #1. */
  inputs?: GhostInputEvent[];
  /**
   * The spawn-order index (0-based, same "Nth obstacle spawned this run"
   * counter Runner.ts increments in spawnObstacle) of whichever obstacle
   * ended this run — since obstacle spawn ORDER is deterministic from the
   * daily seed regardless of client framerate, this index means the same
   * physical obstacle position across every player's run today. Absent if
   * the run didn't end in a collision (shouldn't normally happen, but the
   * server treats it as "no death to record" rather than erroring).
   */
  deathObstacleIndex?: number;
};

export type SkinActionRequest = {
  skinId: string;
};

export type SkinActionResponse =
  | { type: 'skin'; status: 'ok'; profile: PlayerProfile }
  | { type: 'skin'; status: 'error'; error: string; profile: PlayerProfile };

export type SceneryActionRequest = {
  sceneryId: string;
};

export type SceneryActionResponse =
  | { type: 'scenery'; status: 'ok'; profile: PlayerProfile }
  | { type: 'scenery'; status: 'error'; error: string; profile: PlayerProfile };

export type LeaderboardEntry = {
  userId: string;
  username: string;
  score: number;
};

export type LeaderboardResponse = {
  type: 'leaderboard';
  top: LeaderboardEntry[];
  /** The requesting user's own rank/best-today, even when not in `top` — null if they haven't posted a score today (or aren't logged in). */
  me: { rank: number; score: number } | null;
};

/** Public shape of today's #1 run's replay — no userId, that's only needed server-side to detect "did this submission become #1". */
export type GhostReplay = {
  username: string;
  score: number;
  inputs: GhostInputEvent[];
};

export type GhostResponse = {
  type: 'ghost';
  /** null when nobody has posted a score today yet. */
  replay: GhostReplay | null;
};

export type DeathMarkersResponse = {
  type: 'deathMarkers';
  /**
   * Today's raw per-obstacle-index death counts — obstacle spawn index
   * (see RunCompleteRequest.deathObstacleIndex) mapped to how many runs
   * have died there today. Only indices with at least one death are
   * present. Unfiltered by any "meaningful" threshold — that's a display
   * decision, left to the client (see DEATH_MARKER_THRESHOLD below).
   */
  counts: Record<number, number>;
};

/**
 * Minimum deaths-today at an obstacle position before Runner.ts renders a
 * marker there. Shared (not just a Runner.ts-local const) so the dev-only
 * "bump death count" menu action (see server/routes/menu.ts) can set a
 * count that's guaranteed to actually cross the same line the client
 * checks, without the two ever drifting out of sync.
 */
export const DEATH_MARKER_THRESHOLD = 3;
