// Procedural vault-door art. No image assets exist in this project, so the
// door, dial, and particle spark are all drawn at runtime with Phaser's
// Graphics API and turned into a tiny generated texture for the particle
// emitter. Shared by CrackReveal and LockedReveal so both scenes look like
// the same physical object.

import { Scene, GameObjects } from 'phaser';

export const VAULT_RADIUS = 130;

/** Reference width the door art was designed at. Only ever shrinks the door on narrower viewports, never enlarges it. */
const DOOR_REFERENCE_WIDTH = 400;

export const doorScaleFor = (width: number, height: number): number =>
  Math.min(1, Math.min(width, height * 1.3) / DOOR_REFERENCE_WIDTH);

export const VAULT_COLORS = {
  steel: 0x555b66,
  steelDark: 0x2b2e33,
  bolt: 0x1c1e22,
  gold: 0xffd166,
  glow: 0xfff2b2,
};

const SPARK_TEXTURE_KEY = 'vault-spark';

export const ensureSparkTexture = (scene: Scene): string => {
  if (!scene.textures.exists(SPARK_TEXTURE_KEY)) {
    const g = scene.make.graphics({}, false);
    g.fillStyle(VAULT_COLORS.gold, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture(SPARK_TEXTURE_KEY, 8, 8);
    g.destroy();
  }
  return SPARK_TEXTURE_KEY;
};

/** The steel door face: outer ring, rim bolts, and dial housing. Rotates/scales as one unit. */
export const drawVaultDoor = (scene: Scene, x: number, y: number): GameObjects.Graphics => {
  const door = scene.add.graphics({ x, y });

  door.fillStyle(VAULT_COLORS.steel, 1);
  door.fillCircle(0, 0, VAULT_RADIUS);
  door.lineStyle(8, VAULT_COLORS.steelDark, 1);
  door.strokeCircle(0, 0, VAULT_RADIUS);

  const boltCount = 8;
  door.fillStyle(VAULT_COLORS.bolt, 1);
  for (let i = 0; i < boltCount; i++) {
    const angle = (i / boltCount) * Math.PI * 2;
    door.fillCircle(Math.cos(angle) * VAULT_RADIUS * 0.85, Math.sin(angle) * VAULT_RADIUS * 0.85, 6);
  }

  door.fillStyle(VAULT_COLORS.steelDark, 1);
  door.fillCircle(0, 0, VAULT_RADIUS * 0.4);

  return door;
};

/** The combination dial: tick marks + pointer, drawn separately so it can spin independently of the door. */
export const drawDial = (scene: Scene, x: number, y: number): GameObjects.Graphics => {
  const dial = scene.add.graphics({ x, y });

  dial.fillStyle(VAULT_COLORS.gold, 1);
  dial.fillCircle(0, 0, VAULT_RADIUS * 0.3);

  dial.lineStyle(3, VAULT_COLORS.steelDark, 1);
  const ticks = 12;
  for (let i = 0; i < ticks; i++) {
    const angle = (i / ticks) * Math.PI * 2;
    const inner = VAULT_RADIUS * 0.18;
    const outer = VAULT_RADIUS * 0.28;
    dial.lineBetween(
      Math.cos(angle) * inner,
      Math.sin(angle) * inner,
      Math.cos(angle) * outer,
      Math.sin(angle) * outer
    );
  }

  dial.fillStyle(VAULT_COLORS.steelDark, 1);
  dial.fillTriangle(-4, -VAULT_RADIUS * 0.3, 4, -VAULT_RADIUS * 0.3, 0, -VAULT_RADIUS * 0.05);

  return dial;
};

/** Hidden light behind the door — scaled up from 0 as the door swings away. */
export const drawGlow = (scene: Scene, x: number, y: number): GameObjects.Graphics => {
  const glow = scene.add.graphics({ x, y });
  glow.fillStyle(VAULT_COLORS.glow, 0.9);
  glow.fillCircle(0, 0, VAULT_RADIUS * 0.9);
  glow.setScale(0);
  return glow;
};
