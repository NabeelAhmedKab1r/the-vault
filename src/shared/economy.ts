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

// Scenery: same unlock/equip pattern as skins, applied to the parallax
// background's color palette instead of the player sprite's. `glisten`
// adds a couple of small bright dots to the ground tile (see
// runnerGraphics.ts) — a cheap stand-in for "wet reflective glint" using
// the same Graphics-based texture generation as everything else, not a
// new rendering pipeline.
export type SceneryPalette = {
  skylineBase: number;
  skylineWindow: number;
  midgroundBase: number;
  groundBase: number;
  groundAccent: number;
  groundLine: number;
  glisten?: boolean;
};

export type SceneryDef = {
  id: string;
  name: string;
  /** 0 for the default, always-unlocked scenery. */
  cost: number;
  palette: SceneryPalette;
};

export const SCENERY: SceneryDef[] = [
  {
    id: 'classic',
    name: 'Classic',
    cost: 0,
    palette: {
      skylineBase: 0x171512,
      skylineWindow: 0xffd166,
      midgroundBase: 0x232120,
      groundBase: 0x2b2e33,
      groundAccent: 0x555b66,
      groundLine: 0x1c1e22,
    },
  },
  {
    id: 'foggy',
    name: 'Foggy',
    cost: 70,
    palette: {
      skylineBase: 0x2e3238,
      skylineWindow: 0xcfd6dc,
      midgroundBase: 0x363a40,
      groundBase: 0x3a3e44,
      groundAccent: 0x5a5f66,
      groundLine: 0x24272c,
    },
  },
  {
    id: 'dusk',
    name: 'Dusk',
    cost: 110,
    palette: {
      skylineBase: 0x2a1a2e,
      skylineWindow: 0xffa060,
      midgroundBase: 0x3a2438,
      groundBase: 0x3d2a3a,
      groundAccent: 0x6b4a63,
      groundLine: 0x1f1420,
    },
  },
  {
    id: 'nightrain',
    name: 'Night Rain',
    cost: 160,
    palette: {
      skylineBase: 0x0d1420,
      skylineWindow: 0x9fd8ff,
      midgroundBase: 0x141d2b,
      groundBase: 0x1a2430,
      groundAccent: 0x3a5670,
      groundLine: 0x0a1018,
      glisten: true,
    },
  },
  {
    id: 'neon',
    name: 'Neon',
    cost: 230,
    palette: {
      skylineBase: 0x160a22,
      skylineWindow: 0xff3fd6,
      midgroundBase: 0x1e0e2e,
      groundBase: 0x220f33,
      groundAccent: 0x00e5ff,
      groundLine: 0x0a0512,
    },
  },
];

export const DEFAULT_SCENERY_ID = SCENERY[0]!.id;

export const getScenery = (id: string): SceneryDef => SCENERY.find((s) => s.id === id) ?? SCENERY[0]!;

export const isValidSceneryId = (id: string): boolean => SCENERY.some((s) => s.id === id);
