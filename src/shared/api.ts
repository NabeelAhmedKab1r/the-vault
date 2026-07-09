export type VaultStatus = 'active' | 'cracked' | 'expired';

export type BoardEntry = {
  userId: string;
  username: string;
  guess: string;
  score: number;
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
  score: number;
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
      score: number;
      cracked: boolean;
      vault: VaultPublicState;
      board: BoardEntry[];
    }
  | {
      type: 'guess';
      status: 'error';
      error: string;
    };
