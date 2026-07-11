// Procedural runner art. No image assets exist in this project, so the
// player run-cycle, obstacle variants, background parallax tiles, and the
// particle spark are all drawn at runtime with Phaser's Graphics API and
// turned into generated textures — same approach the old vault reveal
// scenes used (see the deleted vaultGraphics.ts), just re-themed for a
// heist getaway instead of a combination-lock door.

import { Scene, GameObjects } from 'phaser';
import { THEME_COLORS } from '../theme';
import type { SceneryPalette, SkinPalette } from '../../shared/economy';

const SPARK_KEY = 'runner-spark';

export const ensureSparkTexture = (scene: Scene): string => {
  if (!scene.textures.exists(SPARK_KEY)) {
    const g = scene.make.graphics({}, false);
    g.fillStyle(THEME_COLORS.gold, 1);
    g.fillCircle(3, 3, 3);
    g.generateTexture(SPARK_KEY, 6, 6);
    g.destroy();
  }
  return SPARK_KEY;
};

// --- Player: a simple thief silhouette, drawn at a fixed base resolution
// and scaled up/down freely at render time (flat silhouette art has no
// fine detail to lose from scaling). 3 run-cycle frames (scissoring legs)
// plus 1 tucked-legs jump pose. Skins (Stage 2C) are palette swaps of this
// same shape set — one full texture set generated per skin, keyed by skin
// id, so equipping a skin is just switching which pre-generated keys the
// player sprite uses, no runtime redraw needed mid-game.
export const PLAYER_BASE_W = 44;
export const PLAYER_BASE_H = 56;

const runKeysForSkin = (skinId: string): string[] => [0, 1, 2].map((i) => `runner-run-${skinId}-${i}`);
const jumpKeyForSkin = (skinId: string): string => `runner-jump-${skinId}`;

const drawThiefHeadAndTorso = (g: GameObjects.Graphics, palette: SkinPalette): void => {
  const cx = PLAYER_BASE_W / 2;
  g.fillStyle(palette.head, 1);
  g.fillCircle(cx, 9, 8);
  g.fillStyle(palette.torso, 1);
  g.fillRoundedRect(cx - 8, 15, 16, 22, 4);
};

const drawThiefRunFrame = (g: GameObjects.Graphics, legOffset: number, palette: SkinPalette): void => {
  drawThiefHeadAndTorso(g, palette);
  const cx = PLAYER_BASE_W / 2;
  g.fillStyle(palette.legs, 1);
  const frontX = cx + 4 + legOffset * 8;
  const backX = cx - 4 - legOffset * 8;
  const legLen = 20 - Math.abs(legOffset) * 5;
  g.fillRoundedRect(frontX - 4, 35, 8, legLen, 3);
  g.fillRoundedRect(backX - 4, 35, 8, legLen, 3);
};

const drawThiefJumpFrame = (g: GameObjects.Graphics, palette: SkinPalette): void => {
  drawThiefHeadAndTorso(g, palette);
  const cx = PLAYER_BASE_W / 2;
  // Both legs tucked up under the body — a dynamic "mid-jump" read.
  g.fillStyle(palette.legs, 1);
  g.fillRoundedRect(cx - 9, 33, 8, 12, 3);
  g.fillRoundedRect(cx + 1, 33, 8, 12, 3);
};

/** Generates (once, cached by texture key) a full run+jump texture set for one skin's palette. */
export const ensurePlayerTexturesForSkin = (
  scene: Scene,
  skinId: string,
  palette: SkinPalette
): { run: string[]; jump: string } => {
  const runKeys = runKeysForSkin(skinId);
  const jumpKey = jumpKeyForSkin(skinId);

  if (!scene.textures.exists(runKeys[0]!)) {
    [-1, 0, 1].forEach((offset, i) => {
      const g = scene.make.graphics({}, false);
      drawThiefRunFrame(g, offset, palette);
      g.generateTexture(runKeys[i]!, PLAYER_BASE_W, PLAYER_BASE_H);
      g.destroy();
    });
  }
  if (!scene.textures.exists(jumpKey)) {
    const g = scene.make.graphics({}, false);
    drawThiefJumpFrame(g, palette);
    g.generateTexture(jumpKey, PLAYER_BASE_W, PLAYER_BASE_H);
    g.destroy();
  }
  return { run: runKeys, jump: jumpKey };
};

// --- Obstacles: 4 heist-themed visual variants, all drawn within the SAME
// bounding box so the gameplay hitbox stays identical across variants —
// this is purely cosmetic variety, the jump-clearance math tuned in Stage 1
// doesn't change based on which one spawns.
export const OBSTACLE_BASE = 40;
const OBSTACLE_KEYS = [
  'runner-obstacle-crate',
  'runner-obstacle-laser',
  'runner-obstacle-dog',
  'runner-obstacle-barrier',
];

const drawCrate = (g: GameObjects.Graphics): void => {
  const b = OBSTACLE_BASE;
  g.fillStyle(THEME_COLORS.steel, 1);
  g.fillRect(2, 2, b - 4, b - 4);
  g.lineStyle(2, THEME_COLORS.steelDark, 1);
  g.strokeRect(2, 2, b - 4, b - 4);
  g.lineBetween(2, 2, b - 2, b - 2);
  g.lineBetween(b - 2, 2, 2, b - 2);
};

const drawLaserPost = (g: GameObjects.Graphics): void => {
  const b = OBSTACLE_BASE;
  g.fillStyle(THEME_COLORS.steelDark, 1);
  g.fillRect(2, 0, 6, b);
  g.fillRect(b - 8, 0, 6, b);
  g.fillStyle(THEME_COLORS.danger, 1);
  g.fillRect(4, b * 0.32, b - 8, 3);
  g.fillRect(4, b * 0.6, b - 8, 3);
};

const drawGuardDog = (g: GameObjects.Graphics): void => {
  const b = OBSTACLE_BASE;
  g.fillStyle(THEME_COLORS.steelDark, 1);
  g.fillEllipse(b / 2, b * 0.68, b - 8, b * 0.45);
  g.fillRect(6, b * 0.82, 4, b * 0.18);
  g.fillRect(b - 10, b * 0.82, 4, b * 0.18);
  g.fillCircle(b * 0.78, b * 0.48, 8);
  g.fillTriangle(b * 0.7, b * 0.38, b * 0.76, b * 0.22, b * 0.82, b * 0.38);
};

const drawAlarmBarrier = (g: GameObjects.Graphics): void => {
  const b = OBSTACLE_BASE;
  g.fillStyle(THEME_COLORS.steelDark, 1);
  g.fillRect(b * 0.15, b * 0.65, 4, b * 0.35);
  g.fillRect(b * 0.75, b * 0.65, 4, b * 0.35);
  g.fillStyle(THEME_COLORS.gold, 1);
  g.fillRect(2, b * 0.32, b - 4, b * 0.38);
  g.fillStyle(THEME_COLORS.danger, 1);
  for (let i = 0; i < 4; i++) {
    g.fillRect(2 + i * (b / 4), b * 0.32, b / 8, b * 0.38);
  }
};

export const ensureObstacleTextures = (scene: Scene): string[] => {
  const drawers: Array<(g: GameObjects.Graphics) => void> = [drawCrate, drawLaserPost, drawGuardDog, drawAlarmBarrier];
  OBSTACLE_KEYS.forEach((key, i) => {
    if (!scene.textures.exists(key)) {
      const g = scene.make.graphics({}, false);
      drawers[i]!(g);
      g.generateTexture(key, OBSTACLE_BASE, OBSTACLE_BASE);
      g.destroy();
    }
  });
  return OBSTACLE_KEYS;
};

// --- Community death marker: a small "danger tag" badge overlaid on
// obstacles that have claimed several deaths today (see Runner.ts's
// DEATH_MARKER_THRESHOLD) — purely a read-only ambient hint, same
// draw-shapes-then-generateTexture approach as everything else here, at a
// small fixed size independent of the obstacle art it sits on top of.
export const DEATH_MARKER_SIZE = 18;
const DEATH_MARKER_KEY = 'runner-death-marker';

export const ensureDeathMarkerTexture = (scene: Scene): string => {
  if (!scene.textures.exists(DEATH_MARKER_KEY)) {
    const g = scene.make.graphics({}, false);
    const s = DEATH_MARKER_SIZE;
    // Dark smudge backing so the mark reads clearly against any obstacle's
    // palette, then a red scratch-mark "X" on top.
    g.fillStyle(0x000000, 0.4);
    g.fillCircle(s / 2, s / 2, s / 2);
    g.lineStyle(3, THEME_COLORS.danger, 1);
    const pad = 4;
    g.lineBetween(pad, pad, s - pad, s - pad);
    g.lineBetween(s - pad, pad, pad, s - pad);
    g.generateTexture(DEATH_MARKER_KEY, s, s);
    g.destroy();
  }
  return DEATH_MARKER_KEY;
};

// --- Parallax background tiles. Each layer's texture is generated at
// EXACTLY the pixel height it will be displayed at (no runtime cropping/
// offset math needed) with its content anchored to the tile's bottom edge,
// so positioning a TileSprite with origin (0,1) at the ground line lines
// everything up automatically. Horizontal scroll is done by the caller via
// tilePositionX — the tile just needs to repeat cleanly left-to-right.
//
// Scenery (Stage 2C follow-up) reuses this exact same shape layout per
// palette — one full tile set generated per scenery id, keyed by id, so
// equipping a scenery is just swapping which pre-baked texture keys the
// TileSprites point at (see Runner.ts's setEquippedScenery), no new
// rendering system.
export const SKYLINE_TILE = { w: 320, h: 220 };
export const MIDGROUND_TILE = { w: 220, h: 130 };
export const GROUND_TILE = { w: 120, h: 22 };

const skylineKeyFor = (sceneryId: string): string => `runner-bg-skyline-${sceneryId}`;
const midgroundKeyFor = (sceneryId: string): string => `runner-bg-mid-${sceneryId}`;
const groundKeyFor = (sceneryId: string): string => `runner-bg-ground-${sceneryId}`;

export const ensureBackgroundTexturesForScenery = (
  scene: Scene,
  sceneryId: string,
  palette: SceneryPalette
): { skyline: string; midground: string; ground: string } => {
  const skylineKey = skylineKeyFor(sceneryId);
  const midgroundKey = midgroundKeyFor(sceneryId);
  const groundKey = groundKeyFor(sceneryId);

  if (!scene.textures.exists(skylineKey)) {
    const g = scene.make.graphics({}, false);
    const { w, h } = SKYLINE_TILE;
    g.fillStyle(palette.skylineBase, 1);
    const buildings = [
      { x: 0, w: 60, h: 130 },
      { x: 60, w: 40, h: 90 },
      { x: 110, w: 70, h: 170 },
      { x: 190, w: 50, h: 110 },
      { x: 250, w: 55, h: 150 },
    ];
    buildings.forEach((b) => g.fillRect(b.x, h - b.h, b.w, b.h));
    g.fillStyle(palette.skylineWindow, 0.3);
    for (let i = 0; i < 16; i++) {
      const bx = 8 + ((i * 41) % (w - 16));
      const by = h - 15 - ((i * 29) % 100);
      g.fillRect(bx, by, 3, 4);
    }
    g.generateTexture(skylineKey, w, h);
    g.destroy();
  }

  if (!scene.textures.exists(midgroundKey)) {
    const g = scene.make.graphics({}, false);
    const { w, h } = MIDGROUND_TILE;
    g.fillStyle(palette.midgroundBase, 1);
    const shapes = [
      { x: 10, w: 40, h: 70 },
      { x: 70, w: 55, h: 50 },
      { x: 140, w: 35, h: 90 },
      { x: 180, w: 35, h: 60 },
    ];
    shapes.forEach((s) => g.fillRect(s.x, h - s.h, s.w, s.h));
    g.generateTexture(midgroundKey, w, h);
    g.destroy();
  }

  if (!scene.textures.exists(groundKey)) {
    const g = scene.make.graphics({}, false);
    const { w, h } = GROUND_TILE;
    g.fillStyle(palette.groundBase, 1);
    g.fillRect(0, 0, w, h);
    g.fillStyle(palette.groundAccent, 1);
    g.fillRect(0, 0, w, 3);
    g.lineStyle(1, palette.groundLine, 1);
    for (let x = 0; x < w; x += 30) {
      g.lineBetween(x, 4, x, h);
    }
    if (palette.glisten) {
      // Cheap stand-in for "wet reflective glint" — a few small bright
      // dots, not a new lighting/shader system.
      g.fillStyle(0xdff6ff, 0.7);
      g.fillCircle(18, 13, 1.4);
      g.fillCircle(52, 8, 1.1);
      g.fillCircle(88, 16, 1.4);
      g.fillCircle(105, 9, 1);
    }
    g.generateTexture(groundKey, w, h);
    g.destroy();
  }

  return { skyline: skylineKey, midground: midgroundKey, ground: groundKey };
};

// --- Scenery shop swatch preview: a small "mini skyline" thumbnail per
// scenery palette, reusing the same fill-shapes-then-generateTexture
// approach as everything else above, just at a much smaller scale (the
// full-size building layout doesn't scale down cleanly to swatch size).
export const SCENERY_PREVIEW_SIZE = 40;

export const ensureSceneryPreviewTexture = (scene: Scene, sceneryId: string, palette: SceneryPalette): string => {
  const key = `runner-scenery-preview-${sceneryId}`;
  if (!scene.textures.exists(key)) {
    const g = scene.make.graphics({}, false);
    const s = SCENERY_PREVIEW_SIZE;
    g.fillStyle(palette.skylineBase, 1);
    g.fillRect(0, 0, s, s * 0.65);
    g.fillStyle(palette.skylineWindow, 0.85);
    g.fillRect(s * 0.18, s * 0.18, 3, 3);
    g.fillRect(s * 0.48, s * 0.32, 3, 3);
    g.fillRect(s * 0.72, s * 0.14, 3, 3);
    g.fillStyle(palette.groundBase, 1);
    g.fillRect(0, s * 0.65, s, s * 0.35);
    g.fillStyle(palette.groundAccent, 1);
    g.fillRect(0, s * 0.65, s, 2);
    g.generateTexture(key, s, s);
    g.destroy();
  }
  return key;
};
