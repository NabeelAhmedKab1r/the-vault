export type VaultStatus = 'active' | 'cracked' | 'expired';

export type BoardEntry = {
  userId: string;
  username: string;
  guess: string;
  correctPosition: number;
  correctDigitWrongPosition: number;
  ts: number;
};

export type VaultPublicState = {
  date: string; // YYYY-MM-DD, UTC
  status: VaultStatus;
  combinationLength: number;
  crackedByUsername?: string;
  crackedAt?: number;
  // Only present once the vault is no longer active (cracked or expired).
  revealedCombination?: string;
};

export type MyAttempt = {
  guess: string;
  correctPosition: number;
  correctDigitWrongPosition: number;
  ts: number;
};

export type InitResponse = {
  type: 'init';
  postId: string;
  username: string;
  userId?: string;
  vault: VaultPublicState;
  board: BoardEntry[];
  myAttempt: MyAttempt | null;
};

export type BoardResponse = {
  type: 'board';
  vault: VaultPublicState;
  board: BoardEntry[];
};

export type GuessRequest = {
  guess: string;
};

export type GuessResponse =
  | {
      type: 'guess';
      status: 'ok';
      correctPosition: number;
      correctDigitWrongPosition: number;
      cracked: boolean;
      vault: VaultPublicState;
      board: BoardEntry[];
    }
  | {
      type: 'guess';
      status: 'error';
      error: string;
    };

/** A single named score, used for both "assist" credits and "closest guess" entries. */
export type ArchiveScoreEntry = {
  userId: string;
  username: string;
  correctPosition: number;
  correctDigitWrongPosition: number;
};

export type ArchiveEntry =
  | {
      date: string;
      status: 'cracked';
      combination: string;
      winner: { userId: string; username: string };
      assists: ArchiveScoreEntry[];
      totalGuesses: number;
    }
  | {
      date: string;
      status: 'unsolved';
      combination: string;
      closest: ArchiveScoreEntry[];
      totalGuesses: number;
    };

export type ArchiveResponse = {
  type: 'archive';
  entries: ArchiveEntry[];
};

// --- Runner game types below. The vault types above are the old
// (soon-to-be-removed, per the pivot) combination-guessing backend, left
// in place only because vault.ts still depends on them.

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
};

export type PlayerResponse = {
  type: 'player';
  profile: PlayerProfile;
};

export type RunCompleteRequest = {
  distance: number;
};

export type SkinActionRequest = {
  skinId: string;
};

export type SkinActionResponse =
  | { type: 'skin'; status: 'ok'; profile: PlayerProfile }
  | { type: 'skin'; status: 'error'; error: string; profile: PlayerProfile };

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
