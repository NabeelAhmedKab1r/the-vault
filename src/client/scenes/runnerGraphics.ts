// Procedural runner art. No image assets exist in this project, so the
// player run-cycle, obstacle variants, background parallax tiles, and the
// particle spark are all drawn at runtime with Phaser's Graphics API and
// turned into generated textures — same approach the old vault reveal
// scenes used (see the deleted vaultGraphics.ts), just re-themed for a
// heist getaway instead of a combination-lock door.

import { Scene, GameObjects } from 'phaser';
import { THEME_COLORS } from '../theme';
import type { SkinPalette } from '../../shared/economy';

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

// --- Parallax background tiles. Each layer's texture is generated at
// EXACTLY the pixel height it will be displayed at (no runtime cropping/
// offset math needed) with its content anchored to the tile's bottom edge,
// so positioning a TileSprite with origin (0,1) at the ground line lines
// everything up automatically. Horizontal scroll is done by the caller via
// tilePositionX — the tile just needs to repeat cleanly left-to-right.
export const SKYLINE_TILE = { w: 320, h: 220 };
export const MIDGROUND_TILE = { w: 220, h: 130 };
export const GROUND_TILE = { w: 120, h: 22 };

const SKYLINE_KEY = 'runner-bg-skyline';
const MIDGROUND_KEY = 'runner-bg-mid';
const GROUND_KEY = 'runner-bg-ground';

export const ensureBackgroundTextures = (scene: Scene): { skyline: string; midground: string; ground: string } => {
  if (!scene.textures.exists(SKYLINE_KEY)) {
    const g = scene.make.graphics({}, false);
    const { w, h } = SKYLINE_TILE;
    g.fillStyle(0x171512, 1);
    const buildings = [
      { x: 0, w: 60, h: 130 },
      { x: 60, w: 40, h: 90 },
      { x: 110, w: 70, h: 170 },
      { x: 190, w: 50, h: 110 },
      { x: 250, w: 55, h: 150 },
    ];
    buildings.forEach((b) => g.fillRect(b.x, h - b.h, b.w, b.h));
    g.fillStyle(THEME_COLORS.gold, 0.3);
    for (let i = 0; i < 16; i++) {
      const bx = 8 + ((i * 41) % (w - 16));
      const by = h - 15 - ((i * 29) % 100);
      g.fillRect(bx, by, 3, 4);
    }
    g.generateTexture(SKYLINE_KEY, w, h);
    g.destroy();
  }

  if (!scene.textures.exists(MIDGROUND_KEY)) {
    const g = scene.make.graphics({}, false);
    const { w, h } = MIDGROUND_TILE;
    g.fillStyle(0x232120, 1);
    const shapes = [
      { x: 10, w: 40, h: 70 },
      { x: 70, w: 55, h: 50 },
      { x: 140, w: 35, h: 90 },
      { x: 180, w: 35, h: 60 },
    ];
    shapes.forEach((s) => g.fillRect(s.x, h - s.h, s.w, s.h));
    g.generateTexture(MIDGROUND_KEY, w, h);
    g.destroy();
  }

  if (!scene.textures.exists(GROUND_KEY)) {
    const g = scene.make.graphics({}, false);
    const { w, h } = GROUND_TILE;
    g.fillStyle(THEME_COLORS.steelDark, 1);
    g.fillRect(0, 0, w, h);
    g.fillStyle(THEME_COLORS.steel, 1);
    g.fillRect(0, 0, w, 3);
    g.lineStyle(1, 0x1c1e22, 1);
    for (let x = 0; x < w; x += 30) {
      g.lineBetween(x, 4, x, h);
    }
    g.generateTexture(GROUND_KEY, w, h);
    g.destroy();
  }

  return { skyline: SKYLINE_KEY, midground: MIDGROUND_KEY, ground: GROUND_KEY };
};
