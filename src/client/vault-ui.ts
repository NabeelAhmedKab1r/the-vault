import { COMBINATION_LENGTH, validateGuessFormat } from '../shared/game';
import { checkHypothesis } from '../shared/scratchpad';
import type { BoardEntry, BoardResponse, GuessResponse, InitResponse, MyAttempt, VaultPublicState } from '../shared/api';

type UIState = {
  username: string;
  vault: VaultPublicState;
  board: BoardEntry[];
  myAttempt: MyAttempt | null;
};

const POLL_INTERVAL_MS = 8000;

const formatRelativeTime = (ts: number): string => {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${Math.floor(diffHour / 24)}d ago`;
};

const userGuessRow = (username: string, guess: string): HTMLSpanElement => {
  const wrap = document.createElement('span');
  const userSpan = document.createElement('strong');
  userSpan.textContent = username;
  const guessSpan = document.createElement('span');
  guessSpan.className = 'guess-code';
  guessSpan.textContent = ` ${guess}`;
  wrap.append(userSpan, guessSpan);
  return wrap;
};

export const initVaultUI = (): void => {
  const vaultStatusEl = document.getElementById('vault-status') as HTMLParagraphElement;
  const guessForm = document.getElementById('guess-form') as HTMLFormElement;
  const guessInput = document.getElementById('guess-input') as HTMLInputElement;
  const guessSubmitBtn = document.getElementById('guess-submit') as HTMLButtonElement;
  const guessErrorEl = document.getElementById('guess-error') as HTMLParagraphElement;
  const guessResultEl = document.getElementById('guess-result') as HTMLParagraphElement;
  const boardListEl = document.getElementById('board-list') as HTMLUListElement;
  const boardEmptyEl = document.getElementById('board-empty') as HTMLParagraphElement;
  const scratchInput = document.getElementById('scratch-input') as HTMLInputElement;
  const scratchErrorEl = document.getElementById('scratch-error') as HTMLParagraphElement;
  const scratchSummaryEl = document.getElementById('scratch-summary') as HTMLParagraphElement;
  const scratchListEl = document.getElementById('scratch-list') as HTMLUListElement;

  let state: UIState | null = null;
  let submitting = false;

  const renderHeader = (): void => {
    if (!state) return;
    vaultStatusEl.textContent = `The Vault — ${state.vault.date} (${state.vault.status}) · signed in as ${state.username}`;
  };

  const renderGuessSection = (): void => {
    if (!state) return;
    const { vault, myAttempt } = state;

    if (vault.status === 'cracked') {
      guessForm.style.display = 'none';
      guessResultEl.textContent =
        myAttempt && myAttempt.score === vault.combinationLength
          ? `🎉 YOU CRACKED IT — the combination was ${vault.revealedCombination}.`
          : `🔓 Cracked by ${vault.crackedByUsername ?? 'someone'} — the combination was ${vault.revealedCombination}.`;
      return;
    }

    if (vault.status === 'expired') {
      guessForm.style.display = 'none';
      guessResultEl.textContent = `Vault expired unsolved. The combination was ${vault.revealedCombination}.`;
      return;
    }

    if (myAttempt) {
      guessForm.style.display = 'none';
      guessResultEl.textContent = `You guessed ${myAttempt.guess} → ${myAttempt.score}/${vault.combinationLength}. Come back after the next reset.`;
      return;
    }

    guessForm.style.display = '';
    guessResultEl.textContent = '';
  };

  const renderBoard = (): void => {
    if (!state) return;
    boardEmptyEl.style.display = state.board.length === 0 ? '' : 'none';
    boardListEl.replaceChildren(
      ...state.board.map((entry) => {
        const li = document.createElement('li');
        const right = document.createElement('span');
        right.textContent = `${entry.score}/${COMBINATION_LENGTH} · ${formatRelativeTime(entry.ts)}`;
        li.append(userGuessRow(entry.username, entry.guess), right);
        return li;
      })
    );
  };

  const renderScratchPad = (): void => {
    const raw = scratchInput.value.trim();
    scratchErrorEl.textContent = '';
    scratchSummaryEl.textContent = '';
    scratchListEl.replaceChildren();

    if (!raw || !state) return;

    const validation = validateGuessFormat(raw);
    if (!validation.valid) {
      scratchErrorEl.textContent = validation.error;
      return;
    }

    const result = checkHypothesis(raw, state.board);

    if (result.totalCount === 0) {
      scratchSummaryEl.textContent = 'Nothing on the board yet to compare against.';
      return;
    }

    scratchSummaryEl.textContent = result.isFullyConsistent
      ? `✓ Still possible — consistent with all ${result.totalCount} guesses on the board.`
      : `Consistent with ${result.consistentCount} of ${result.totalCount} guesses on the board.`;

    scratchListEl.replaceChildren(
      ...result.results.map((entryResult) => {
        const li = document.createElement('li');
        li.className = entryResult.consistent ? 'consistent' : 'inconsistent';
        const right = document.createElement('span');
        right.textContent = `${entryResult.consistent ? '✓' : '✗'} would score ${entryResult.hypotheticalScore} (actual ${entryResult.actualScore})`;
        li.append(userGuessRow(entryResult.username, entryResult.guess), right);
        return li;
      })
    );
  };

  const render = (): void => {
    renderHeader();
    renderGuessSection();
    renderBoard();
    renderScratchPad();
  };

  const handleGuessSubmit = async (): Promise<void> => {
    if (submitting) return;
    const raw = guessInput.value.trim();
    const validation = validateGuessFormat(raw);
    if (!validation.valid) {
      guessErrorEl.textContent = validation.error;
      return;
    }

    submitting = true;
    guessSubmitBtn.disabled = true;
    guessErrorEl.textContent = '';

    try {
      const res = await fetch('/api/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guess: raw }),
      });
      const data = (await res.json()) as GuessResponse;

      if (data.status === 'error') {
        guessErrorEl.textContent = data.error;
        guessSubmitBtn.disabled = false;
        submitting = false;
        return;
      }

      if (state) {
        state.vault = data.vault;
        state.board = data.board;
        state.myAttempt = { guess: raw, score: data.score, ts: Date.now() };
      }
      submitting = false;
      render();
    } catch (error) {
      guessErrorEl.textContent = `Failed to submit guess: ${String(error)}`;
      guessSubmitBtn.disabled = false;
      submitting = false;
    }
  };

  const loadInit = async (): Promise<void> => {
    try {
      const res = await fetch('/api/init');
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data = (await res.json()) as InitResponse;
      state = {
        username: data.username,
        vault: data.vault,
        board: data.board,
        myAttempt: data.myAttempt,
      };
      render();
    } catch (error) {
      vaultStatusEl.textContent = `Failed to load vault: ${String(error)}`;
    }
  };

  const pollBoard = async (): Promise<void> => {
    if (!state) return;
    try {
      const res = await fetch('/api/board');
      if (!res.ok) return;
      const data = (await res.json()) as BoardResponse;
      state.vault = data.vault;
      state.board = data.board;
      render();
    } catch {
      // A missed poll isn't worth surfacing to the user — it'll retry next tick.
    }
  };

  guessInput.addEventListener('input', () => {
    guessInput.value = guessInput.value.replace(/[^0-9]/g, '').slice(0, COMBINATION_LENGTH);
    guessErrorEl.textContent = '';
  });

  guessForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void handleGuessSubmit();
  });

  scratchInput.addEventListener('input', () => {
    scratchInput.value = scratchInput.value.replace(/[^0-9]/g, '').slice(0, COMBINATION_LENGTH);
    renderScratchPad();
  });

  void loadInit();
  setInterval(() => void pollBoard(), POLL_INTERVAL_MS);
};
