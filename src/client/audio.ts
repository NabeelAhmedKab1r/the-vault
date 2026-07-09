// Simple synthesized sound effects via the Web Audio API directly — no
// audio files to source or license. Best-effort: browsers that block audio
// without a user gesture (rare here, since these always follow a click)
// just silently produce no sound.

let sharedContext: AudioContext | null = null;

const getContext = (): AudioContext | null => {
  try {
    sharedContext ??= new AudioContext();
    return sharedContext;
  } catch {
    return null;
  }
};

const playTone = (freq: number, startDelay: number, duration: number, type: OscillatorType): void => {
  const ctx = getContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;

  const startAt = ctx.currentTime + startDelay;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.2, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.05);
};

/** Ascending four-note chime for a successful crack. */
export const playChime = (): void => {
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => playTone(freq, i * 0.11, 0.35, 'triangle'));
};

/** A single low, dull thud for the vault staying shut. */
export const playThud = (): void => {
  playTone(110, 0, 0.3, 'sine');
};
