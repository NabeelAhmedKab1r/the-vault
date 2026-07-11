import { Scene, GameObjects } from 'phaser';
import type * as Phaser from 'phaser';
import { THEME_COLORS, THEME_TEXT_COLORS } from '../theme';
import type {
  LeaderboardResponse,
  PlayerProfile,
  PlayerResponse,
  QuestResponse,
  SkinActionResponse,
} from '../../shared/api';
import { DEFAULT_SKIN_ID, SKINS, type SkinDef } from '../../shared/economy';
import { rngFromString } from '../../shared/seededRandom';
import {
  ensureBackgroundTextures,
  ensureObstacleTextures,
  ensurePlayerTexturesForSkin,
  ensureSparkTexture,
  GROUND_TILE,
  MIDGROUND_TILE,
  OBSTACLE_BASE,
  PLAYER_BASE_H,
  PLAYER_BASE_W,
  SKYLINE_TILE,
} from './runnerGraphics';

type RunState = 'ready' | 'playing' | 'gameover';

type Rect = { x: number; y: number; w: number; h: number };
const pointInRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

type ShopSwatch = {
  skin: SkinDef;
  bg: GameObjects.Graphics;
  icon: GameObjects.Image;
  lockIcon: GameObjects.Text;
  label: GameObjects.Text;
  rect: Rect;
};

/** Reference width the tuning constants below were picked at — actual sizes/speeds scale from this per the established doorScaleFor-style pattern. */
const REFERENCE_WIDTH = 400;

type PhysicsSprite = GameObjects.Sprite & { body: Phaser.Physics.Arcade.Body };

// The player's collision box is deliberately SMALLER than its full sprite
// (native/unscaled units, matching the art's own 44x56 canvas) — a forgiving
// hitbox that ignores the head/shoulders reads as fair, not glitchy, when a
// jump only just clears an obstacle. Values are in the sprite's local
// (pre-scale) space; Arcade Physics applies the sprite's current scale to
// these automatically, so they don't need recalculating on resize.
const PLAYER_BODY_W = 30;
const PLAYER_BODY_H = 42;
const PLAYER_BODY_OFFSET_X = (PLAYER_BASE_W - PLAYER_BODY_W) / 2;
const PLAYER_BODY_OFFSET_Y = PLAYER_BASE_H - PLAYER_BODY_H;

const RUN_ANIM_KEY = 'thief-run';

/** Matches server/routes/api.ts's LEADERBOARD_LIMIT — how many pre-created row slots to build. */
const LEADERBOARD_LIMIT = 10;

/**
 * "The Vault — Getaway" runner scene, through Stage 4:
 *  - Stage 1: core tap-to-jump loop (confirmed fun before anything else got built).
 *  - Stage 2A: visual polish only — parallax background, real (if simple)
 *    player/obstacle art instead of flat rectangles, small juice touches
 *    (jump dust, landing puff, collision shake). Gameplay tuning/fairness
 *    unchanged from Stage 1 on purpose.
 *  - Stage 2B: one daily quest ("clear N obstacles in a single run"),
 *    persisted server-side per user per UTC day (see server/core/quest.ts),
 *    surviving both retries and page reloads once completed.
 *  - Stage 2C: coins earned per run (server-computed from distance, never
 *    client-supplied), spent in an in-canvas shop to unlock/equip palette-
 *    swapped cosmetic skins — see server/core/player.ts and
 *    shared/economy.ts for the catalog + persistence.
 *  - Stage 3: obstacle TYPE selection is now driven by a seeded PRNG keyed
 *    on today's UTC date (see shared/seededRandom.ts) instead of
 *    Math.random(), so every player sees the identical obstacle sequence
 *    on a given day, and it's reproducible across retries by re-seeding
 *    fresh at the start of every run (see resetRun). Spawn TIMING was
 *    already a fixed interval with no randomness to seed.
 *  - Stage 4: a leaderboard of today's best scores per user (server-side,
 *    date-keyed the same way quest.ts is — see server/core/leaderboard.ts),
 *    with the player's own rank always shown even outside the top 10.
 */
export class Runner extends Scene {
  private skyline!: GameObjects.TileSprite;
  private midground!: GameObjects.TileSprite;
  private ground!: GameObjects.TileSprite;
  private player!: PhysicsSprite;
  private obstacles!: Phaser.Physics.Arcade.Group;
  private jumpEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private landEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private scoreText!: GameObjects.Text;
  private promptText!: GameObjects.Text;
  private questText!: GameObjects.Text;
  private questCelebrationText!: GameObjects.Text;
  private questEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  private coinText!: GameObjects.Text;
  private shopButtonText!: GameObjects.Text;
  private shopBackdrop!: GameObjects.Graphics;
  private shopPanelBg!: GameObjects.Graphics;
  private shopTitleText!: GameObjects.Text;
  private shopSubtitleText!: GameObjects.Text;
  private shopCoinText!: GameObjects.Text;
  private shopCloseText!: GameObjects.Text;
  private shopSwatches: ShopSwatch[] = [];

  private shopButtonRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private shopCloseRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private shopSwatchW = 0;
  private shopSwatchH = 0;
  private shopOpen = false;

  private leaderboardButtonText!: GameObjects.Text;
  private leaderboardBackdrop!: GameObjects.Graphics;
  private leaderboardPanelBg!: GameObjects.Graphics;
  private leaderboardTitleText!: GameObjects.Text;
  private leaderboardMeText!: GameObjects.Text;
  private leaderboardRowTexts: GameObjects.Text[] = [];
  private leaderboardCloseText!: GameObjects.Text;

  private leaderboardButtonRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private leaderboardCloseRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private leaderboardOpen = false;

  // Same seed every run today, re-applied fresh at the start of each run
  // (see resetRun) so a retry reproduces the identical obstacle sequence,
  // not a continuation of wherever the previous run's RNG stream left off.
  private dailySeed = '';
  private obstacleRng: () => number = Math.random;

  private obstacleKeys: string[] = [];
  private skinTextures = new Map<string, { run: string[]; jump: string }>();
  private equippedRunKeys: string[] = [];
  private equippedJumpKey = '';

  // Coins/skins default to DEFAULT_SKIN_ID's out-of-the-box state and get
  // corrected once loadPlayerProfile() resolves — same "render something
  // reasonable immediately, reconcile with the server shortly after"
  // approach as the quest status.
  private playerProfile: PlayerProfile = { coins: 0, unlockedSkins: [DEFAULT_SKIN_ID], equippedSkin: DEFAULT_SKIN_ID };

  private state: RunState = 'ready';
  private distance = 0;
  private distanceFloat = 0;
  private best = 0;
  private scrollSpeed = 220;
  private spawnTimer?: Phaser.Time.TimerEvent;
  private wasGrounded = true;

  // Daily quest: "clear N obstacles in a single run." questTarget/
  // questCompleted default to the server's own defaults and get corrected
  // once loadQuestStatus() resolves — see create(). obstaclesClearedThisRun
  // resets every retry (the quest must be earned within ONE run), but
  // questCompleted deliberately does NOT reset on retry — once true it
  // stays true for the rest of the day, on this client and (via the
  // completion POST) on the server, surviving a page reload too.
  private questTarget = 12;
  private questCompleted = false;
  private obstaclesClearedThisRun = 0;

  private groundY = 0;
  private playerX = 0;
  private obstacleSize = 40;
  private scaleFactor = 1;

  constructor() {
    super('Runner');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x0f0f0f);

    const bg = ensureBackgroundTextures(this);
    this.obstacleKeys = ensureObstacleTextures(this);
    // Pre-generate every skin's texture set up front (cheap, only 5 skins)
    // so equipping one later is just switching which pre-baked keys the
    // player sprite/anim point at — no mid-game texture generation stutter.
    this.skinTextures.clear();
    SKINS.forEach((skin) => {
      this.skinTextures.set(skin.id, ensurePlayerTexturesForSkin(this, skin.id, skin.palette));
    });
    const sparkKey = ensureSparkTexture(this);

    this.skyline = this.add.tileSprite(0, 0, SKYLINE_TILE.w, SKYLINE_TILE.h, bg.skyline).setOrigin(0, 1).setDepth(-30);
    this.midground = this.add
      .tileSprite(0, 0, MIDGROUND_TILE.w, MIDGROUND_TILE.h, bg.midground)
      .setOrigin(0, 1)
      .setDepth(-20);
    this.ground = this.add.tileSprite(0, 0, GROUND_TILE.w, GROUND_TILE.h, bg.ground).setOrigin(0, 0).setDepth(-10);
    this.physics.add.existing(this.ground, true);

    this.player = this.add.sprite(0, 0, this.skinTextures.get(DEFAULT_SKIN_ID)!.run[0]!) as PhysicsSprite;
    this.player.setDepth(1);
    this.physics.add.existing(this.player);
    this.player.body.setSize(PLAYER_BODY_W, PLAYER_BODY_H);
    this.player.body.setOffset(PLAYER_BODY_OFFSET_X, PLAYER_BODY_OFFSET_Y);
    this.physics.add.collider(this.player, this.ground);

    this.obstacles = this.physics.add.group();
    this.physics.add.overlap(this.player, this.obstacles, () => this.onCollide(), undefined, this);

    this.jumpEmitter = this.add.particles(0, 0, sparkKey, {
      speed: { min: 40, max: 90 },
      angle: { min: 100, max: 170 },
      scale: { start: 1, end: 0 },
      lifespan: 300,
      gravityY: 400,
      tint: [0x9aa4b2, 0x7a828f],
      emitting: false,
    });
    this.jumpEmitter.setDepth(2);

    this.landEmitter = this.add.particles(0, 0, sparkKey, {
      speed: { min: 30, max: 70 },
      angle: { min: -150, max: -30 },
      scale: { start: 1, end: 0 },
      lifespan: 250,
      gravityY: 500,
      tint: [0x9aa4b2, 0xf2f0e6],
      emitting: false,
    });
    this.landEmitter.setDepth(2);

    this.scoreText = this.add
      .text(16, 16, '0', {
        fontFamily: 'Arial Black',
        fontSize: '20px',
        color: THEME_TEXT_COLORS.gold,
      })
      .setDepth(100);

    this.questText = this.add
      .text(16, 44, '', {
        fontFamily: 'Arial',
        fontSize: '13px',
        color: THEME_TEXT_COLORS.textMuted,
      })
      .setDepth(100);

    this.promptText = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial Black',
        fontSize: '22px',
        color: THEME_TEXT_COLORS.text,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(100);

    this.questCelebrationText = this.add
      .text(0, 0, 'QUEST COMPLETE!', {
        fontFamily: 'Arial Black',
        fontSize: '26px',
        color: THEME_TEXT_COLORS.gold,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(101)
      .setAlpha(0);

    this.questEmitter = this.add.particles(0, 0, sparkKey, {
      speed: { min: 80, max: 220 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.4, end: 0 },
      lifespan: 700,
      gravityY: 200,
      tint: [0xffd166, 0xffffff, 0xffa500],
      emitting: false,
    });
    this.questEmitter.setDepth(101);

    this.coinText = this.add
      .text(0, 16, '🪙 0', {
        fontFamily: 'Arial Black',
        fontSize: '16px',
        color: THEME_TEXT_COLORS.gold,
      })
      .setOrigin(1, 0)
      .setDepth(100);

    this.shopButtonText = this.add
      .text(0, 44, '🎨 SKINS', {
        fontFamily: 'Arial Black',
        fontSize: '13px',
        color: THEME_TEXT_COLORS.textMuted,
      })
      .setOrigin(1, 0)
      .setDepth(100);

    this.leaderboardButtonText = this.add
      .text(16, 70, '🏆 RANKS', {
        fontFamily: 'Arial Black',
        fontSize: '13px',
        color: THEME_TEXT_COLORS.textMuted,
      })
      .setOrigin(0, 0)
      .setDepth(100);

    // --- Shop overlay: created once, hidden until openShop() toggles it.
    // Input for it is handled manually (rect hit-testing in handleTap)
    // rather than per-object setInteractive() zones, so there's no
    // ambiguity with the single global pointerdown listener that also
    // drives jump/retry — see handleTap for why.
    this.shopBackdrop = this.add.graphics().setDepth(200).setVisible(false);
    this.shopPanelBg = this.add.graphics().setDepth(201).setVisible(false);
    this.shopTitleText = this.add
      .text(0, 0, 'SKINS', {
        fontFamily: 'Arial Black',
        fontSize: '18px',
        color: THEME_TEXT_COLORS.gold,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(202)
      .setVisible(false);
    this.shopSubtitleText = this.add
      .text(0, 0, "the fence's stash — no questions asked", {
        fontFamily: 'Arial',
        fontSize: '11px',
        fontStyle: 'italic',
        color: THEME_TEXT_COLORS.dim,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(202)
      .setVisible(false);
    this.shopCoinText = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial Black',
        fontSize: '14px',
        color: THEME_TEXT_COLORS.gold,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(202)
      .setVisible(false);
    this.shopCloseText = this.add
      .text(0, 0, '✕ CLOSE', {
        fontFamily: 'Arial Black',
        fontSize: '13px',
        color: THEME_TEXT_COLORS.textMuted,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(202)
      .setVisible(false);

    this.shopSwatches = SKINS.map((skin) => ({
      skin,
      bg: this.add.graphics().setDepth(201).setVisible(false),
      icon: this.add.image(0, 0, this.skinTextures.get(skin.id)!.run[1]!).setDepth(202).setVisible(false),
      lockIcon: this.add.text(0, 0, '🔒', { fontSize: '14px' }).setOrigin(0.5).setDepth(203).setVisible(false),
      label: this.add
        .text(0, 0, '', { fontFamily: 'Arial', fontSize: '11px', color: THEME_TEXT_COLORS.textMuted, align: 'center' })
        .setOrigin(0.5)
        .setDepth(202)
        .setVisible(false),
      rect: { x: 0, y: 0, w: 0, h: 0 },
    }));

    // --- Leaderboard overlay: same "create once, hidden, manual rect
    // hit-testing" pattern as the shop, for the same reason (see the
    // handleTap doc comment).
    this.leaderboardBackdrop = this.add.graphics().setDepth(200).setVisible(false);
    this.leaderboardPanelBg = this.add.graphics().setDepth(201).setVisible(false);
    this.leaderboardTitleText = this.add
      .text(0, 0, "TODAY'S LEADERBOARD", {
        fontFamily: 'Arial Black',
        fontSize: '16px',
        color: THEME_TEXT_COLORS.gold,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(202)
      .setVisible(false);
    this.leaderboardMeText = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial Black',
        fontSize: '13px',
        color: THEME_TEXT_COLORS.text,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(202)
      .setVisible(false);
    this.leaderboardRowTexts = Array.from({ length: LEADERBOARD_LIMIT }, () =>
      this.add
        .text(0, 0, '', { fontFamily: 'monospace', fontSize: '12px', color: THEME_TEXT_COLORS.text })
        .setOrigin(0, 0.5)
        .setDepth(202)
        .setVisible(false)
    );
    this.leaderboardCloseText = this.add
      .text(0, 0, '✕ CLOSE', {
        fontFamily: 'Arial Black',
        fontSize: '13px',
        color: THEME_TEXT_COLORS.textMuted,
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(202)
      .setVisible(false);

    this.layout(this.scale.width, this.scale.height);
    this.scale.on('resize', (size: Phaser.Structs.Size) => this.layout(size.width, size.height));

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handleTap(pointer));

    // Same UTC-date string format as the server's todayUTC() (see
    // server/core/vault.ts), computed independently rather than fetched —
    // toISOString() is already UTC-based regardless of the client's local
    // timezone, so this only disagrees with the server in the rare case of
    // a badly-skewed system clock, not a timezone difference. Trading that
    // tiny edge case for an instant "tap to start" with no network wait
    // felt like the right call given the core loop's snappiness already
    // being the thing that was confirmed fun in Stage 1.
    this.dailySeed = new Date().toISOString().slice(0, 10);

    this.setEquippedSkin(DEFAULT_SKIN_ID);
    this.resetRun(false);
    this.refreshQuestText();
    this.refreshCoinText();
    void this.loadQuestStatus();
    void this.loadPlayerProfile();
  }

  private layout(width: number, height: number): void {
    this.cameras.resize(width, height);
    this.physics.world.setBounds(0, 0, width, height);

    this.scaleFactor = Math.max(0.6, Math.min(1.4, width / REFERENCE_WIDTH));
    this.groundY = height * 0.75;
    this.playerX = width * 0.22;
    this.obstacleSize = Math.round(OBSTACLE_BASE * this.scaleFactor);
    this.scrollSpeed = 220 * this.scaleFactor;
    this.physics.world.gravity.y = 1800 * this.scaleFactor;

    const groundThickness = Math.round(20 * this.scaleFactor);
    this.ground.setPosition(0, this.groundY).setSize(width, groundThickness);
    (this.ground.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();

    this.skyline.setPosition(0, this.groundY).setSize(width, SKYLINE_TILE.h);
    this.midground.setPosition(0, this.groundY).setSize(width, MIDGROUND_TILE.h);

    const playerDispW = PLAYER_BASE_W * this.scaleFactor;
    const playerDispH = PLAYER_BASE_H * this.scaleFactor;
    this.player.setDisplaySize(playerDispW, playerDispH);
    // Defensive re-sync: body size/offset are meant to auto-track the
    // sprite's scale, but re-asserting the native (unscaled) values here
    // costs nothing and guards against relying on that alone.
    this.player.body.setSize(PLAYER_BODY_W, PLAYER_BODY_H);
    this.player.body.setOffset(PLAYER_BODY_OFFSET_X, PLAYER_BODY_OFFSET_Y);
    if (this.state !== 'playing') {
      this.player.setPosition(this.playerX, this.groundY - playerDispH / 2);
    }

    this.promptText.setPosition(width / 2, height * 0.4).setWordWrapWidth(Math.min(width * 0.8, 380));
    this.questCelebrationText.setPosition(width / 2, height * 0.25).setWordWrapWidth(Math.min(width * 0.8, 380));

    this.coinText.setPosition(width - 16, 16);
    this.shopButtonText.setPosition(width - 16, 44);
    const pad = 8;
    this.shopButtonRect = {
      x: this.shopButtonText.x - this.shopButtonText.width - pad,
      y: this.shopButtonText.y - pad,
      w: this.shopButtonText.width + pad * 2,
      h: this.shopButtonText.height + pad * 2,
    };

    this.leaderboardButtonText.setPosition(16, 70);
    this.leaderboardButtonRect = {
      x: this.leaderboardButtonText.x - pad,
      y: this.leaderboardButtonText.y - pad,
      w: this.leaderboardButtonText.width + pad * 2,
      h: this.leaderboardButtonText.height + pad * 2,
    };

    this.layoutShop(width, height);
    this.layoutLeaderboard(width, height);
  }

  private layoutShop(width: number, height: number): void {
    const budget = Math.min(width * 0.9, 380);
    const gap = 10;
    this.shopSwatchW = (budget - gap * (SKINS.length - 1)) / SKINS.length;
    this.shopSwatchH = this.shopSwatchW * 1.3;
    const panelW = budget + 20;
    const headerH = 122;
    const footerH = 50;
    const panelH = headerH + this.shopSwatchH + footerH;
    const panelX = width / 2 - panelW / 2;
    const panelY = height / 2 - panelH / 2;

    this.shopBackdrop.clear();
    this.shopBackdrop.fillStyle(0x000000, 0.72);
    this.shopBackdrop.fillRect(0, 0, width, height);

    this.drawShopPanelFrame(panelX, panelY, panelW, panelH);

    this.shopTitleText.setPosition(width / 2, panelY + 20);
    this.shopSubtitleText.setPosition(width / 2, panelY + 38).setWordWrapWidth(panelW - 32);
    this.shopCoinText.setPosition(width / 2, panelY + 60);

    const startX = width / 2 - budget / 2 + this.shopSwatchW / 2;
    const swatchY = panelY + headerH + this.shopSwatchH / 2;

    this.shopSwatches.forEach((swatch, i) => {
      const x = startX + i * (this.shopSwatchW + gap);
      swatch.bg.setPosition(x, swatchY);
      const iconScale = (this.shopSwatchW * 0.6) / PLAYER_BASE_W;
      swatch.icon.setPosition(x, swatchY - this.shopSwatchH * 0.12).setScale(iconScale);
      swatch.lockIcon.setPosition(x + this.shopSwatchW / 2 - 11, swatchY - this.shopSwatchH / 2 + 11);
      swatch.label
        .setPosition(x, swatchY + this.shopSwatchH * 0.34)
        .setFontSize(Math.max(10, Math.round(this.shopSwatchW * 0.15)));
      swatch.rect = {
        x: x - this.shopSwatchW / 2,
        y: swatchY - this.shopSwatchH / 2,
        w: this.shopSwatchW,
        h: this.shopSwatchH,
      };
    });

    this.shopCloseText.setPosition(width / 2, panelY + panelH - 20);
    const closeW = this.shopCloseText.width + 16;
    const closeH = this.shopCloseText.height + 12;
    this.shopCloseRect = {
      x: this.shopCloseText.x - closeW / 2,
      y: this.shopCloseText.y - closeH / 2,
      w: closeW,
      h: closeH,
    };

    this.refreshShopSwatches();
  }

  /**
   * "Fence's stash" panel frame: a soft off-center glow (same layered-
   * low-alpha-circle trick the old vault reveal scenes used for their
   * door glow), a darker fill band at the bottom to fake top-lighting
   * without relying on a renderer-dependent gradient fill, a double
   * border (dim outer line + faint gold inner accent), and small gold
   * corner brackets for a "reinforced case" read.
   */
  private drawShopPanelFrame(panelX: number, panelY: number, panelW: number, panelH: number): void {
    const g = this.shopPanelBg;
    g.clear();

    // Opaque base first, THEN the low-alpha glow on top of it (alpha
    // blending tints the dark base rather than being invisible underneath
    // an opaque fill), THEN a darker band at the bottom so the "light"
    // reads as coming from the top, THEN borders/brackets on top of all of it.
    g.fillStyle(0x1c1e22, 1);
    g.fillRoundedRect(panelX, panelY, panelW, panelH, 14);

    // Radii are based on panelH, not panelW — this panel is much wider than
    // it is tall, and a glow sized off the wide dimension would overflow
    // well past the panel's actual top/bottom edges into the backdrop.
    // Graphics fills aren't auto-clipped to earlier shapes in the same
    // object, so an oversized circle here would visibly bleed outside the
    // rounded-rect rather than reading as a contained glow.
    const glowCx = panelX + panelW / 2;
    const glowCy = panelY + panelH * 0.3;
    g.fillStyle(THEME_COLORS.gold, 0.09);
    g.fillCircle(glowCx, glowCy, panelH * 0.25);
    g.fillStyle(THEME_COLORS.gold, 0.07);
    g.fillCircle(glowCx, glowCy, panelH * 0.14);

    g.fillStyle(0x121316, 0.55);
    g.fillRect(panelX + 3, panelY + panelH * 0.58, panelW - 6, panelH * 0.42 - 3);

    g.lineStyle(2, THEME_COLORS.steel, 1);
    g.strokeRoundedRect(panelX, panelY, panelW, panelH, 14);
    g.lineStyle(1, THEME_COLORS.gold, 0.3);
    g.strokeRoundedRect(panelX + 4, panelY + 4, panelW - 8, panelH - 8, 11);

    const bracketLen = 14;
    const inset = 7;
    g.lineStyle(2, THEME_COLORS.gold, 0.75);
    const corners: Array<{ x: number; y: number; dx: 1 | -1; dy: 1 | -1 }> = [
      { x: panelX, y: panelY, dx: 1, dy: 1 },
      { x: panelX + panelW, y: panelY, dx: -1, dy: 1 },
      { x: panelX, y: panelY + panelH, dx: 1, dy: -1 },
      { x: panelX + panelW, y: panelY + panelH, dx: -1, dy: -1 },
    ];
    corners.forEach((c) => {
      g.lineBetween(c.x + inset * c.dx, c.y + inset * c.dy, c.x + (inset + bracketLen) * c.dx, c.y + inset * c.dy);
      g.lineBetween(c.x + inset * c.dx, c.y + inset * c.dy, c.x + inset * c.dx, c.y + (inset + bracketLen) * c.dy);
    });
  }

  private layoutLeaderboard(width: number, height: number): void {
    const budget = Math.min(width * 0.9, 380);
    const rowH = 22;
    const panelW = budget + 20;
    const panelH = 46 + 30 + LEADERBOARD_LIMIT * rowH + 50;
    const panelX = width / 2 - panelW / 2;
    const panelY = Math.max(20, height / 2 - panelH / 2);

    this.leaderboardBackdrop.clear();
    this.leaderboardBackdrop.fillStyle(0x000000, 0.7);
    this.leaderboardBackdrop.fillRect(0, 0, width, height);

    this.leaderboardPanelBg.clear();
    this.leaderboardPanelBg.fillStyle(THEME_COLORS.steelDark, 1);
    this.leaderboardPanelBg.fillRoundedRect(panelX, panelY, panelW, panelH, 12);
    this.leaderboardPanelBg.lineStyle(2, THEME_COLORS.steel, 1);
    this.leaderboardPanelBg.strokeRoundedRect(panelX, panelY, panelW, panelH, 12);

    this.leaderboardTitleText.setPosition(width / 2, panelY + 22);
    this.leaderboardMeText.setPosition(width / 2, panelY + 46).setWordWrapWidth(panelW - 32);

    const rowStartY = panelY + 72;
    const rowX = panelX + 20;
    this.leaderboardRowTexts.forEach((rowText, i) => {
      rowText.setPosition(rowX, rowStartY + i * rowH);
    });

    this.leaderboardCloseText.setPosition(width / 2, panelY + panelH - 20);
    const closeW = this.leaderboardCloseText.width + 16;
    const closeH = this.leaderboardCloseText.height + 12;
    this.leaderboardCloseRect = {
      x: this.leaderboardCloseText.x - closeW / 2,
      y: this.leaderboardCloseText.y - closeH / 2,
      w: closeW,
      h: closeH,
    };
  }

  private refreshLeaderboardDisplay(data: LeaderboardResponse): void {
    this.leaderboardMeText.setText(
      data.me ? `Your rank: #${data.me.rank} · Best: ${data.me.score}` : 'Play a run today to get on the board!'
    );

    if (data.top.length === 0) {
      this.leaderboardRowTexts.forEach((rowText, i) => {
        rowText.setText(i === 0 ? 'No scores yet today — be the first!' : '').setVisible(i === 0);
      });
      return;
    }

    this.leaderboardRowTexts.forEach((rowText, i) => {
      const entry = data.top[i];
      if (!entry) {
        rowText.setText('').setVisible(false);
        return;
      }
      const rank = String(i + 1).padStart(2, ' ');
      rowText.setText(`${rank}. ${entry.username}  ${entry.score}`).setVisible(true);
    });
  }

  private openLeaderboard(): void {
    if (this.leaderboardOpen) return;
    this.leaderboardOpen = true;
    [
      this.leaderboardBackdrop,
      this.leaderboardPanelBg,
      this.leaderboardTitleText,
      this.leaderboardMeText,
      this.leaderboardCloseText,
    ].forEach((o) => o.setVisible(true));
    this.leaderboardMeText.setText('Loading…');
    this.leaderboardRowTexts.forEach((t) => t.setText('').setVisible(false));
    this.refreshMenuButtonsVisibility();
    void this.loadLeaderboard();
  }

  private closeLeaderboard(): void {
    if (!this.leaderboardOpen) return;
    this.leaderboardOpen = false;
    [
      this.leaderboardBackdrop,
      this.leaderboardPanelBg,
      this.leaderboardTitleText,
      this.leaderboardMeText,
      this.leaderboardCloseText,
    ].forEach((o) => o.setVisible(false));
    this.leaderboardRowTexts.forEach((t) => t.setVisible(false));
    this.refreshMenuButtonsVisibility();
  }

  private async loadLeaderboard(): Promise<void> {
    try {
      const res = await fetch('/api/leaderboard');
      if (!res.ok) {
        if (this.leaderboardOpen) this.leaderboardMeText.setText('Could not load leaderboard.');
        return;
      }
      const data = (await res.json()) as LeaderboardResponse;
      // The player may have closed the overlay while this was in flight —
      // don't resurrect it with stale content.
      if (!this.leaderboardOpen) return;
      this.refreshLeaderboardDisplay(data);
    } catch {
      if (this.leaderboardOpen) this.leaderboardMeText.setText('Could not load leaderboard.');
    }
  }

  private refreshShopSwatches(): void {
    const w = this.shopSwatchW;
    const h = this.shopSwatchH;

    this.shopSwatches.forEach((swatch) => {
      const owned = this.playerProfile.unlockedSkins.includes(swatch.skin.id);
      const equipped = this.playerProfile.equippedSkin === swatch.skin.id;

      swatch.bg.clear();

      // Drop shadow first, offset down-right, so the tile itself reads as
      // sitting slightly above the panel rather than flush with it.
      swatch.bg.fillStyle(0x000000, 0.35);
      swatch.bg.fillRoundedRect(-w / 2 + 3, -h / 2 + 4, w, h, 8);

      // Warmer/brighter body when owned, a cooler near-black slab when
      // locked — "locked" should read at a glance from the tile color
      // alone, before anyone reads the price.
      swatch.bg.fillStyle(owned ? THEME_COLORS.steel : 0x201f22, 1);
      swatch.bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      swatch.bg.lineStyle(1, owned ? THEME_COLORS.gold : THEME_COLORS.steelDark, owned ? 0.35 : 0.9);
      swatch.bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);

      if (equipped) {
        // Soft outer glow (a wide, faint stroke) behind a crisp gold
        // border, rather than just the flat border it had before.
        swatch.bg.lineStyle(6, THEME_COLORS.gold, 0.18);
        swatch.bg.strokeRoundedRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 10);
        swatch.bg.lineStyle(3, THEME_COLORS.gold, 1);
        swatch.bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
      }

      swatch.icon.setAlpha(owned ? 1 : 0.32);
      swatch.icon.setTint(owned ? 0xffffff : 0x8a8a8a);
      swatch.lockIcon.setVisible(!owned);

      const labelText = equipped
        ? `${swatch.skin.name}\nEQUIPPED`
        : owned
          ? swatch.skin.name
          : `${swatch.skin.name}\n${swatch.skin.cost} coins`;
      swatch.label.setText(labelText).setColor(equipped ? THEME_TEXT_COLORS.gold : THEME_TEXT_COLORS.textMuted);
    });
  }

  private refreshCoinText(): void {
    const text = `🪙 ${this.playerProfile.coins}`;
    this.coinText.setText(text);
    this.shopCoinText.setText(text);
  }

  /** Both menu buttons share the same visibility rule: between runs, and only when neither overlay is already open. */
  private refreshMenuButtonsVisibility(): void {
    const visible = this.state !== 'playing' && !this.shopOpen && !this.leaderboardOpen;
    this.shopButtonText.setVisible(visible);
    this.leaderboardButtonText.setVisible(visible);
  }

  private openShop(): void {
    if (this.shopOpen) return;
    this.shopOpen = true;
    // Sets each icon's ownership-dependent alpha (1 or dimmed) and each
    // lockIcon's visibility BEFORE the fade below reads/uses them.
    this.refreshShopSwatches();

    const fixed = [
      this.shopBackdrop,
      this.shopPanelBg,
      this.shopTitleText,
      this.shopSubtitleText,
      this.shopCoinText,
      this.shopCloseText,
    ];
    const bgAndLabels = this.shopSwatches.flatMap((s) => [s.bg, s.label, s.lockIcon]);
    const icons = this.shopSwatches.map((s) => s.icon);

    [...fixed, ...bgAndLabels, ...icons].forEach((o) => o.setVisible(true));

    // Fixed chrome + tile backgrounds/labels/lock glyphs always fade to
    // full opacity. Each skin icon fades to whatever refreshShopSwatches
    // just set it to (dimmed if locked) — captured before zeroing, so a
    // locked tile's icon doesn't flash at full brightness mid-fade.
    [...fixed, ...bgAndLabels].forEach((o) => o.setAlpha(0));
    this.tweens.add({ targets: [...fixed, ...bgAndLabels], alpha: 1, duration: 160, ease: 'Sine.easeOut' });
    icons.forEach((icon) => {
      const target = icon.alpha;
      icon.setAlpha(0);
      this.tweens.add({ targets: icon, alpha: target, duration: 160, ease: 'Sine.easeOut' });
    });

    this.refreshMenuButtonsVisibility();
  }

  private closeShop(): void {
    if (!this.shopOpen) return;
    this.shopOpen = false;

    const allObjects = [
      this.shopBackdrop,
      this.shopPanelBg,
      this.shopTitleText,
      this.shopSubtitleText,
      this.shopCoinText,
      this.shopCloseText,
      ...this.shopSwatches.flatMap((s) => [s.bg, s.icon, s.label, s.lockIcon]),
    ];
    this.tweens.add({
      targets: allObjects,
      alpha: 0,
      duration: 120,
      ease: 'Sine.easeIn',
      onComplete: () => allObjects.forEach((o) => o.setVisible(false)),
    });

    this.refreshMenuButtonsVisibility();
  }

  private setEquippedSkin(skinId: string): void {
    const textures = this.skinTextures.get(skinId) ?? this.skinTextures.get(DEFAULT_SKIN_ID)!;
    this.equippedRunKeys = textures.run;
    this.equippedJumpKey = textures.jump;
    if (this.anims.exists(RUN_ANIM_KEY)) this.anims.remove(RUN_ANIM_KEY);
    this.anims.create({
      key: RUN_ANIM_KEY,
      frames: this.equippedRunKeys.map((key) => ({ key })),
      frameRate: 10,
      repeat: -1,
    });
    if (this.player && this.state !== 'playing') {
      this.player.setTexture(this.equippedRunKeys[1]!);
    }
  }

  /**
   * Single global pointerdown handler for the whole scene — jump/retry, the
   * shop, and the leaderboard all go through here, dispatched by manual
   * rect hit-testing rather than per-object setInteractive() zones. That
   * avoids a real ambiguity: a GameObject-specific interactive zone and
   * this scene-wide listener would BOTH fire for the same tap (they're
   * different event mechanisms, not one overriding the other), so a
   * dedicated "open shop"/"open leaderboard" zone layered on top of the
   * always-listening jump/retry handler could double-fire — open an
   * overlay AND start a new run from one tap. Routing everything through
   * one function sidesteps that entirely. shopOpen/leaderboardOpen can
   * never both be true — their "open" buttons only get checked in the
   * ready/gameover branch below, which isn't reachable while either
   * overlay is already showing.
   */
  private handleTap(pointer: Phaser.Input.Pointer): void {
    if (this.shopOpen) {
      if (pointInRect(this.shopCloseRect, pointer.x, pointer.y)) {
        this.closeShop();
        return;
      }
      const hit = this.shopSwatches.find((s) => pointInRect(s.rect, pointer.x, pointer.y));
      if (hit) this.onSwatchTap(hit);
      return;
    }

    if (this.leaderboardOpen) {
      if (pointInRect(this.leaderboardCloseRect, pointer.x, pointer.y)) {
        this.closeLeaderboard();
      }
      return;
    }

    if (this.state === 'ready' || this.state === 'gameover') {
      if (pointInRect(this.shopButtonRect, pointer.x, pointer.y)) {
        this.openShop();
        return;
      }
      if (pointInRect(this.leaderboardButtonRect, pointer.x, pointer.y)) {
        this.openLeaderboard();
        return;
      }
      this.resetRun(true);
      return;
    }
    if (this.player.body.blocked.down || this.player.body.touching.down) {
      this.player.body.setVelocityY(-620 * this.scaleFactor);
      this.jumpEmitter.explode(6, this.player.x, this.player.y + this.player.displayHeight / 2);
    }
  }

  private resetRun(startPlaying: boolean): void {
    this.obstacles.clear(true, true);
    this.spawnTimer?.remove();
    this.distance = 0;
    this.distanceFloat = 0;
    this.wasGrounded = true;
    // Re-seeded fresh every run from the same daily seed, so a retry
    // reproduces the identical obstacle sequence rather than continuing
    // wherever the previous run's RNG stream happened to leave off.
    this.obstacleRng = rngFromString(this.dailySeed);
    // Progress toward the quest resets every retry (it must be earned
    // within a single run) — completion itself does not, see the field
    // comment above.
    this.obstaclesClearedThisRun = 0;
    this.refreshQuestText();
    this.scoreText.setText('0');
    this.player.setPosition(this.playerX, this.groundY - (PLAYER_BASE_H * this.scaleFactor) / 2);
    this.player.body.setVelocity(0, 0);
    this.player.anims.stop();
    this.player.setTexture(this.equippedRunKeys[1]!);

    if (startPlaying) {
      this.state = 'playing';
      this.promptText.setVisible(false);
      // ~1.2s grace period before the first obstacle so a fresh run never
      // feels like an instant, unfair death.
      this.spawnTimer = this.time.addEvent({
        delay: 1600,
        startAt: 400,
        loop: true,
        callback: () => this.spawnObstacle(),
      });
    } else {
      this.state = 'ready';
      this.promptText.setText('TAP TO START').setVisible(true);
    }
    this.refreshMenuButtonsVisibility();
  }

  private spawnObstacle(): void {
    if (this.state !== 'playing') return;
    const key = this.obstacleKeys[Math.floor(this.obstacleRng() * this.obstacleKeys.length)]!;
    const x = this.scale.width + this.obstacleSize;
    const y = this.groundY - this.obstacleSize / 2;
    const obstacle = this.add.sprite(x, y, key).setDisplaySize(this.obstacleSize, this.obstacleSize).setDepth(0);
    this.obstacles.add(obstacle);
    const body = obstacle.body as Phaser.Physics.Arcade.Body;
    // Explicit native-size call rather than trusting the group's
    // auto-created body to have picked up setDisplaySize's scale — same
    // "assert the hitbox, don't assume it" approach used for the player
    // above, since obstacle hitbox size is what Stage 1's jump-clearance
    // tuning is actually built on.
    body.setSize(OBSTACLE_BASE, OBSTACLE_BASE);
    body.setAllowGravity(false);
    body.setVelocityX(-this.scrollSpeed);
  }

  private onCollide(): void {
    if (this.state !== 'playing') return;
    this.state = 'gameover';
    this.spawnTimer?.remove();
    this.obstacles.getChildren().forEach((child) => {
      ((child as PhysicsSprite).body).setVelocity(0, 0);
    });
    this.cameras.main.shake(220, 0.012);
    this.best = Math.max(this.best, this.distance);
    this.promptText.setText(`GAME OVER\nScore: ${this.distance}\nBest: ${this.best}\n\nTap to retry`).setVisible(true);
    this.refreshMenuButtonsVisibility();
    void this.reportRunComplete(this.distance);
  }

  private spawnLandingBurst(): void {
    this.landEmitter.explode(8, this.player.x, this.player.y + this.player.displayHeight / 2);
  }

  override update(_time: number, delta: number): void {
    if (this.state !== 'playing') return;

    this.distanceFloat += (this.scrollSpeed * delta) / 1000;
    this.distance = Math.floor(this.distanceFloat);
    this.scoreText.setText(String(this.distance));

    const scrollDelta = (this.scrollSpeed * delta) / 1000;
    this.ground.tilePositionX += scrollDelta;
    this.midground.tilePositionX += scrollDelta * 0.4;
    this.skyline.tilePositionX += scrollDelta * 0.15;

    const grounded = this.player.body.blocked.down || this.player.body.touching.down;
    if (grounded) {
      this.player.play(RUN_ANIM_KEY, true);
      if (!this.wasGrounded) this.spawnLandingBurst();
    } else {
      this.player.anims.stop();
      this.player.setTexture(this.equippedJumpKey);
    }
    this.wasGrounded = grounded;

    this.obstacles.getChildren().forEach((child) => {
      const sprite = child as GameObjects.Sprite;
      if (sprite.x < -this.obstacleSize) {
        this.obstacles.remove(sprite, true, true);
        // Reaching this point only happens while state === 'playing', i.e.
        // no collision has ended the run yet — so scrolling fully off
        // screen means it was successfully avoided.
        this.obstaclesClearedThisRun++;
        this.checkQuestProgress();
      }
    });
  }

  private async loadQuestStatus(): Promise<void> {
    try {
      const res = await fetch('/api/quest');
      if (!res.ok) return;
      const data = (await res.json()) as QuestResponse;
      this.questTarget = data.quest.target;
      this.questCompleted = data.quest.completed;
      this.refreshQuestText();
    } catch {
      // Non-critical — the quest line just keeps showing its default
      // target/progress until the next successful load.
    }
  }

  private async reportQuestComplete(): Promise<void> {
    try {
      await fetch('/api/quest/complete', { method: 'POST' });
    } catch {
      // Best-effort: the celebration and local "completed" state already
      // happened, so the run doesn't feel broken — worst case the server
      // just won't remember it was completed on a later page reload today.
    }
  }

  private refreshQuestText(): void {
    if (this.questCompleted) {
      this.questText.setText(`QUEST ✓ Cleared ${this.questTarget} in one run`).setColor(THEME_TEXT_COLORS.gold);
      return;
    }
    this.questText
      .setText(`Quest: clear ${this.questTarget} obstacles in one run (${this.obstaclesClearedThisRun}/${this.questTarget})`)
      .setColor(THEME_TEXT_COLORS.textMuted);
  }

  private checkQuestProgress(): void {
    if (this.questCompleted) return;
    this.refreshQuestText();
    if (this.obstaclesClearedThisRun >= this.questTarget) {
      this.completeQuestNow();
    }
  }

  private completeQuestNow(): void {
    if (this.questCompleted) return;
    this.questCompleted = true;
    this.refreshQuestText();
    this.spawnQuestCelebration();
    void this.reportQuestComplete();
  }

  private spawnQuestCelebration(): void {
    const x = this.questCelebrationText.x;
    const y = this.questCelebrationText.y;
    this.questEmitter.explode(24, x, y);
    this.questCelebrationText.setAlpha(1).setScale(0.6);
    this.tweens.add({ targets: this.questCelebrationText, scale: 1, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: this.questCelebrationText, alpha: 0, delay: 1200, duration: 500 });
  }

  private async loadPlayerProfile(): Promise<void> {
    try {
      const res = await fetch('/api/player');
      if (!res.ok) return;
      const data = (await res.json()) as PlayerResponse;
      this.playerProfile = data.profile;
      this.setEquippedSkin(this.playerProfile.equippedSkin);
      this.refreshCoinText();
      this.refreshShopSwatches();
    } catch {
      // Non-critical — coins/skins just keep showing their defaults until
      // the next successful load.
    }
  }

  /** Reports a finished run's distance so the (server-authoritative) coin balance updates — see server/routes/api.ts's /run-complete for why this isn't computed client-side. */
  private async reportRunComplete(distance: number): Promise<void> {
    try {
      const res = await fetch('/api/run-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ distance }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as PlayerResponse;
      this.playerProfile = data.profile;
      this.refreshCoinText();
      this.refreshShopSwatches();
    } catch {
      // Best-effort — worst case this run's coins don't get credited, not
      // a broken experience (the run itself already fully played out).
    }
  }

  private onSwatchTap(swatch: ShopSwatch): void {
    const owned = this.playerProfile.unlockedSkins.includes(swatch.skin.id);
    if (owned) {
      if (this.playerProfile.equippedSkin !== swatch.skin.id) {
        void this.equipSkinRequest(swatch.skin.id);
      }
      return;
    }
    if (this.playerProfile.coins < swatch.skin.cost) {
      this.flashInsufficientFunds(swatch);
      return;
    }
    void this.unlockSkinRequest(swatch.skin.id);
  }

  private flashInsufficientFunds(swatch: ShopSwatch): void {
    swatch.label.setText('Need more\ncoins').setColor('#ff6b6b');
    this.time.delayedCall(900, () => this.refreshShopSwatches());
  }

  private async unlockSkinRequest(skinId: string): Promise<void> {
    try {
      const res = await fetch('/api/skins/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skinId }),
      });
      const data = (await res.json()) as SkinActionResponse;
      this.playerProfile = data.profile;
      if (data.status === 'ok') this.setEquippedSkin(this.playerProfile.equippedSkin);
      this.refreshCoinText();
      this.refreshShopSwatches();
    } catch {
      // Best-effort — the shop just doesn't update; the player can retry the tap.
    }
  }

  private async equipSkinRequest(skinId: string): Promise<void> {
    try {
      const res = await fetch('/api/skins/equip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skinId }),
      });
      const data = (await res.json()) as SkinActionResponse;
      this.playerProfile = data.profile;
      if (data.status === 'ok') this.setEquippedSkin(this.playerProfile.equippedSkin);
      this.refreshShopSwatches();
    } catch {
      // Best-effort — the shop just doesn't update; the player can retry the tap.
    }
  }
}
