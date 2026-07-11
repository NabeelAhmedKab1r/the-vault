// Cosmetic skin catalog + coin economy constants. Shared between client
// (rendering swatches, generating palette-swapped textures) and server
// (validating unlock requests / costs) so there's exactly one source of
// truth for what skins exist and what they cost.

export type SkinPalette = {
  head: number;
  torso: number;
  legs: number;
};

export type SkinDef = {
  id: string;
  name: string;
  /** 0 for the default, always-unlocked skin. */
  cost: number;
  palette: SkinPalette;
};

export const SKINS: SkinDef[] = [
  { id: 'classic', name: 'Classic', cost: 0, palette: { head: 0xffd166, torso: 0x2b2e33, legs: 0xffd166 } },
  { id: 'shadow', name: 'Shadow', cost: 50, palette: { head: 0x1c1e22, torso: 0x2b2e33, legs: 0x555b66 } },
  { id: 'crimson', name: 'Crimson', cost: 100, palette: { head: 0xff6b6b, torso: 0x7a2020, legs: 0xff6b6b } },
  { id: 'ghost', name: 'Ghost', cost: 150, palette: { head: 0xf2f0e6, torso: 0x9aa4b2, legs: 0xf2f0e6 } },
  { id: 'goldrush', name: 'Gold Rush', cost: 250, palette: { head: 0xffe08a, torso: 0xb8860b, legs: 0xffd166 } },
];

export const DEFAULT_SKIN_ID = SKINS[0]!.id;

export const getSkin = (id: string): SkinDef => SKINS.find((s) => s.id === id) ?? SKINS[0]!;

export const isValidSkinId = (id: string): boolean => SKINS.some((s) => s.id === id);

/**
 * Coins earned = floor(distance / this). A first-pass number, not tuned
 * against real play data (no way to playtest distances myself) — easy to
 * retune later since it's the one constant everything else derives from.
 */
export const COIN_DISTANCE_DIVISOR = 10;
