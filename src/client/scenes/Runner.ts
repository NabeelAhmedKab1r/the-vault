import { Scene, GameObjects } from 'phaser';
import type * as Phaser from 'phaser';
import { THEME_COLORS, THEME_TEXT_COLORS } from '../theme';
import { DEATH_MARKER_THRESHOLD } from '../../shared/api';
import type {
  DeathMarkersResponse,
  GhostInputEvent,
  GhostReplay,
  GhostResponse,
  LeaderboardResponse,
  PlayerProfile,
  PlayerResponse,
  QuestResponse,
  SceneryActionResponse,
  SkinActionResponse,
} from '../../shared/api';
import { DEFAULT_SCENERY_ID, DEFAULT_SKIN_ID, SCENERY, SKINS, type SceneryDef, type SkinDef } from '../../shared/economy';
import { rngFromString } from '../../shared/seededRandom';
import {
  DEATH_MARKER_SIZE,
  ensureBackgroundTexturesForScenery,
  ensureDeathMarkerTexture,
  ensureObstacleTextures,
  ensurePlayerTexturesForSkin,
  ensureSceneryPreviewTexture,
  ensureSparkTexture,
  GROUND_TILE,
  MIDGROUND_TILE,
  OBSTACLE_BASE,
  PLAYER_BASE_H,
  PLAYER_BASE_W,
  SCENERY_PREVIEW_SIZE,
  SKYLINE_TILE,
} from './runnerGraphics';

type RunState = 'ready' | 'playing' | 'gameover';

type Rect = { x: number; y: number; w: number; h: number };
const pointInRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

type ShopTab = 'skins' | 'scenery';

type ShopSwatchVisuals = {
  bg: GameObjects.Graphics;
  icon: GameObjects.Image;
  lockIcon: GameObjects.Text;
  label: GameObjects.Text;
  rect: Rect;
};

type ShopSwatch = ShopSwatchVisuals & { skin: SkinDef };
type ShopScenerySwatch = ShopSwatchVisuals & { scenery: SceneryDef };

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
// Ghost always renders with DEFAULT_SKIN_ID's textures regardless of the
// equipped skin (see class doc), so it needs its own anim key — RUN_ANIM_KEY
// gets torn down/recreated by setEquippedSkin() whenever the player's skin
// changes, which would otherwise yank the ghost's frames out from under it.
const GHOST_RUN_ANIM_KEY = 'ghost-run';
const GHOST_TINT = 0x8fd8ff;
const GHOST_ALPHA = 0.4;

/** Matches server/routes/api.ts's LEADERBOARD_LIMIT — how many pre-created row slots to build. */
const LEADERBOARD_LIMIT = 10;

/**
 * "The Vault: Getaway" runner scene, through the post-Stage-4 shop pass:
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
 *  - Shop follow-up: skin unlock/equip taps now apply optimistically
 *    (instant visual update, network call reconciles/rolls back after —
 *    see applyEquipSkin/applyUnlockSkin) instead of waiting on a round
 *    trip before anything changed on screen, which was the real source of
 *    "switching skins feels laggy," not the redraw cost or the open/close
 *    fade. A second shop tab ("SCENERY") reuses the exact same unlock/
 *    equip/optimistic-update pattern applied to the parallax background's
 *    color palette instead of the player sprite's.
 */
export class Runner extends Scene {
  private skyline!: GameObjects.TileSprite;
  private midground!: GameObjects.TileSprite;
  private ground!: GameObjects.TileSprite;
  private player!: PhysicsSprite;
  private obstacles!: Phaser.Physics.Arcade.Group;
  private jumpEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private landEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  // Today's #1 run's ghost — created once (hidden) in create(), then
  // shown/repositioned/replayed per run in resetRun()/update(). See the
  // ghostReplay/ghostAlive/ghostInputIndex fields below for playback state.
  private ghost!: PhysicsSprite;
  private ghostLabel!: GameObjects.Text;
  private ghostReplay: GhostReplay | null = null;
  private ghostInputIndex = 0;
  private ghostAlive = false;
  // Bumped on every loadGhostReplay() call so a slow/late response from an
  // earlier request can't clobber a newer one if the player retries fast.
  private ghostRequestId = 0;
  private scoreText!: GameObjects.Text;
  private promptText!: GameObjects.Text;
  private questText!: GameObjects.Text;
  private questCelebrationText!: GameObjects.Text;
  private questEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  private coinText!: GameObjects.Text;
  private shopButtonText!: GameObjects.Text;
  private shopBackdrop!: GameObjects.Graphics;
  private shopPanelBg!: GameObjects.Graphics;
  private shopSkinsTabText!: GameObjects.Text;
  private shopSceneryTabText!: GameObjects.Text;
  private shopSubtitleText!: GameObjects.Text;
  private shopCoinText!: GameObjects.Text;
  private shopCloseText!: GameObjects.Text;
  private shopSwatches: ShopSwatch[] = [];
  private shopScenerySwatches: ShopScenerySwatch[] = [];

  private shopButtonRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private shopSkinsTabRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private shopSceneryTabRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private shopCloseRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private shopSwatchW = 0;
  private shopSwatchH = 0;
  private shopOpen = false;
  private shopTab: ShopTab = 'skins';

  private sceneryTextures = new Map<string, { skyline: string; midground: string; ground: string }>();

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
  private playerProfile: PlayerProfile = {
    coins: 0,
    unlockedSkins: [DEFAULT_SKIN_ID],
    equippedSkin: DEFAULT_SKIN_ID,
    unlockedScenery: [DEFAULT_SCENERY_ID],
    equippedScenery: DEFAULT_SCENERY_ID,
  };

  private state: RunState = 'ready';
  private distance = 0;
  private distanceFloat = 0;
  private best = 0;
  private scrollSpeed = 220;
  private spawnTimer?: Phaser.Time.TimerEvent;
  private wasGrounded = true;

  // This run's jump log, for the ghost racer feature — timestamped as ms
  // elapsed since THIS run started (see shared/api.ts's GhostInputEvent for
  // why that's replay-portable), reset every retry alongside everything
  // else in resetRun. Only ever sent to the server; the server itself
  // decides whether to keep it (only if this run becomes today's #1).
  private runElapsedMs = 0;
  private recordedInputs: GhostInputEvent[] = [];

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

  // Spawn-order counter (see spawnObstacle) and today's community death
  // counts by that same index — deathMarkerKey is generated once in
  // create(); deathMarkerCounts is refreshed the same "fetch once at
  // create(), refresh again at each run start" way as the ghost replay.
  private obstacleSpawnIndex = 0;
  private deathMarkerCounts: Record<number, number> = {};
  private deathMarkerKey = '';

  constructor() {
    super('Runner');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x0f0f0f);

    this.obstacleKeys = ensureObstacleTextures(this);
    // Pre-generate every skin's and every scenery's texture set up front
    // (cheap, only 5 of each) so equipping one later is just switching
    // which pre-baked keys the player sprite/anim or TileSprites point at
    // — no mid-game texture generation stutter.
    this.skinTextures.clear();
    SKINS.forEach((skin) => {
      this.skinTextures.set(skin.id, ensurePlayerTexturesForSkin(this, skin.id, skin.palette));
    });
    this.sceneryTextures.clear();
    SCENERY.forEach((scenery) => {
      this.sceneryTextures.set(scenery.id, ensureBackgroundTexturesForScenery(this, scenery.id, scenery.palette));
      ensureSceneryPreviewTexture(this, scenery.id, scenery.palette);
    });
    const sparkKey = ensureSparkTexture(this);
    this.deathMarkerKey = ensureDeathMarkerTexture(this);

    const bg = this.sceneryTextures.get(DEFAULT_SCENERY_ID)!;
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
    this.physics.add.overlap(
      this.player,
      this.obstacles,
      (_player, obstacle) => this.onCollide(obstacle as unknown as PhysicsSprite),
      undefined,
      this
    );

    // Ghost: always DEFAULT_SKIN_ID's textures/anim (independent of the
    // live player's equipped skin — see GHOST_RUN_ANIM_KEY comment), tinted
    // + translucent to read as a silhouette, hidden until a run with a
    // replay to play starts. Uses overlap (not collider) against obstacles,
    // same as the real player, and no collider against the player itself —
    // "non-physically-interacting" per the ghost racer spec.
    const ghostTextures = this.skinTextures.get(DEFAULT_SKIN_ID)!;
    this.ghost = this.add.sprite(0, 0, ghostTextures.run[0]!) as PhysicsSprite;
    this.ghost.setDepth(0.8).setAlpha(GHOST_ALPHA).setTint(GHOST_TINT).setVisible(false);
    this.anims.create({
      key: GHOST_RUN_ANIM_KEY,
      frames: ghostTextures.run.map((key) => ({ key })),
      frameRate: 10,
      repeat: -1,
    });
    this.physics.add.existing(this.ghost);
    this.ghost.body.setSize(PLAYER_BODY_W, PLAYER_BODY_H);
    this.ghost.body.setOffset(PLAYER_BODY_OFFSET_X, PLAYER_BODY_OFFSET_Y);
    this.ghost.body.enable = false;
    this.physics.add.collider(this.ghost, this.ground);
    this.physics.add.overlap(this.ghost, this.obstacles, () => this.onGhostCollide(), undefined, this);

    this.ghostLabel = this.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: '11px', color: THEME_TEXT_COLORS.textMuted })
      .setOrigin(0.5, 1)
      .setAlpha(0.8)
      .setDepth(1.5)
      .setVisible(false);

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
    this.shopSkinsTabText = this.add
      .text(0, 0, 'SKINS', { fontFamily: 'Arial Black', fontSize: '16px', align: 'center' })
      .setOrigin(0.5)
      .setDepth(202)
      .setVisible(false);
    this.shopSceneryTabText = this.add
      .text(0, 0, 'SCENERY', { fontFamily: 'Arial Black', fontSize: '16px', align: 'center' })
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

    this.shopScenerySwatches = SCENERY.map((scenery) => ({
      scenery,
      bg: this.add.graphics().setDepth(201).setVisible(false),
      icon: this.add
        .image(0, 0, ensureSceneryPreviewTexture(this, scenery.id, scenery.palette))
        .setDepth(202)
        .setVisible(false),
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
    void this.loadGhostReplay();
    void this.loadDeathMarkerCounts();
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

    // Ghost is deliberately positioned at the SAME x as the player (not
    // offset) — its recorded jump timestamps were calibrated against
    // obstacles reaching exactly playerX, so any x offset here would make
    // it dodge early/late relative to where the obstacle actually is.
    this.ghost.setDisplaySize(playerDispW, playerDispH);
    this.ghost.body.setSize(PLAYER_BODY_W, PLAYER_BODY_H);
    this.ghost.body.setOffset(PLAYER_BODY_OFFSET_X, PLAYER_BODY_OFFSET_Y);
    if (this.state !== 'playing') {
      this.ghost.setPosition(this.playerX, this.groundY - playerDispH / 2);
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

    const tabGap = 14;
    const tabY = panelY + 20;
    this.shopSkinsTabText.setPosition(width / 2 - tabGap / 2, tabY).setOrigin(1, 0.5);
    this.shopSceneryTabText.setPosition(width / 2 + tabGap / 2, tabY).setOrigin(0, 0.5);
    const tabPad = 6;
    this.shopSkinsTabRect = {
      x: this.shopSkinsTabText.x - this.shopSkinsTabText.width - tabPad,
      y: tabY - this.shopSkinsTabText.height / 2 - tabPad,
      w: this.shopSkinsTabText.width + tabPad * 2,
      h: this.shopSkinsTabText.height + tabPad * 2,
    };
    this.shopSceneryTabRect = {
      x: this.shopSceneryTabText.x - tabPad,
      y: tabY - this.shopSceneryTabText.height / 2 - tabPad,
      w: this.shopSceneryTabText.width + tabPad * 2,
      h: this.shopSceneryTabText.height + tabPad * 2,
    };

    this.shopSubtitleText.setPosition(width / 2, panelY + 38).setWordWrapWidth(panelW - 32);
    this.shopCoinText.setPosition(width / 2, panelY + 60);

    const startX = width / 2 - budget / 2 + this.shopSwatchW / 2;
    const swatchY = panelY + headerH + this.shopSwatchH / 2;
    const labelFontSize = Math.max(10, Math.round(this.shopSwatchW * 0.15));

    // Both tabs' swatch rows share the exact same positions — only one is
    // ever visible at a time (see switchShopTab). Icon scale differs
    // because skin icons and scenery preview icons are generated at
    // different native resolutions (44px vs 40px) — using one shared scale
    // factor would size one of them slightly wrong.
    const skinIconScale = (this.shopSwatchW * 0.6) / PLAYER_BASE_W;
    const sceneryIconScale = (this.shopSwatchW * 0.6) / SCENERY_PREVIEW_SIZE;

    [this.shopSwatches, this.shopScenerySwatches].forEach((swatches, setIndex) => {
      const iconScale = setIndex === 0 ? skinIconScale : sceneryIconScale;
      swatches.forEach((swatch, i) => {
        const x = startX + i * (this.shopSwatchW + gap);
        swatch.bg.setPosition(x, swatchY);
        swatch.icon.setPosition(x, swatchY - this.shopSwatchH * 0.12).setScale(iconScale);
        swatch.lockIcon.setPosition(x + this.shopSwatchW / 2 - 11, swatchY - this.shopSwatchH / 2 + 11);
        swatch.label.setPosition(x, swatchY + this.shopSwatchH * 0.34).setFontSize(labelFontSize);
        swatch.rect = {
          x: x - this.shopSwatchW / 2,
          y: swatchY - this.shopSwatchH / 2,
          w: this.shopSwatchW,
          h: this.shopSwatchH,
        };
      });
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

    this.refreshShopTabStyle();
    this.refreshShopSwatches();
    this.refreshScenerySwatches();
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
      // Gated on shopOpen too, not just ownership — this runs from
      // layoutShop(), which also runs once during initial create() and on
      // every resize regardless of whether the shop is even open. Without
      // the shopOpen check, a locked skin's 🔒 glyph would render on the
      // main game screen the moment the page loads, since nothing else
      // was gating this particular object's visibility on the shop state.
      swatch.lockIcon.setVisible(this.shopOpen && this.shopTab === 'skins' && !owned);

      const labelText = equipped
        ? `${swatch.skin.name}\nEQUIPPED`
        : owned
          ? swatch.skin.name
          : `${swatch.skin.name}\n${swatch.skin.cost} coins`;
      swatch.label.setText(labelText).setColor(equipped ? THEME_TEXT_COLORS.gold : THEME_TEXT_COLORS.textMuted);
    });
  }

  private refreshScenerySwatches(): void {
    const w = this.shopSwatchW;
    const h = this.shopSwatchH;

    this.shopScenerySwatches.forEach((swatch) => {
      const owned = this.playerProfile.unlockedScenery.includes(swatch.scenery.id);
      const equipped = this.playerProfile.equippedScenery === swatch.scenery.id;

      swatch.bg.clear();
      swatch.bg.fillStyle(0x000000, 0.35);
      swatch.bg.fillRoundedRect(-w / 2 + 3, -h / 2 + 4, w, h, 8);
      swatch.bg.fillStyle(owned ? THEME_COLORS.steel : 0x201f22, 1);
      swatch.bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      swatch.bg.lineStyle(1, owned ? THEME_COLORS.gold : THEME_COLORS.steelDark, owned ? 0.35 : 0.9);
      swatch.bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);

      if (equipped) {
        swatch.bg.lineStyle(6, THEME_COLORS.gold, 0.18);
        swatch.bg.strokeRoundedRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 10);
        swatch.bg.lineStyle(3, THEME_COLORS.gold, 1);
        swatch.bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
      }

      swatch.icon.setAlpha(owned ? 1 : 0.32);
      swatch.icon.setTint(owned ? 0xffffff : 0x8a8a8a);
      swatch.lockIcon.setVisible(this.shopOpen && this.shopTab === 'scenery' && !owned);

      const labelText = equipped
        ? `${swatch.scenery.name}\nEQUIPPED`
        : owned
          ? swatch.scenery.name
          : `${swatch.scenery.name}\n${swatch.scenery.cost} coins`;
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

  private activeSwatches(): ShopSwatchVisuals[] {
    return this.shopTab === 'skins' ? this.shopSwatches : this.shopScenerySwatches;
  }

  private inactiveSwatches(): ShopSwatchVisuals[] {
    return this.shopTab === 'skins' ? this.shopScenerySwatches : this.shopSwatches;
  }

  private refreshShopTabStyle(): void {
    this.shopSkinsTabText.setColor(this.shopTab === 'skins' ? THEME_TEXT_COLORS.gold : THEME_TEXT_COLORS.textMuted);
    this.shopSceneryTabText.setColor(this.shopTab === 'scenery' ? THEME_TEXT_COLORS.gold : THEME_TEXT_COLORS.textMuted);
  }

  /**
   * Switching tabs is deliberately instant — no fade, no network call. This
   * is exactly the kind of interaction that felt laggy before the
   * optimistic-update fix elsewhere in this file, so staying snappy here
   * is intentional, not an oversight.
   */
  private switchShopTab(tab: ShopTab): void {
    if (this.shopTab === tab) return;
    this.shopTab = tab;

    this.inactiveSwatches().forEach((s) => {
      s.bg.setVisible(false);
      s.icon.setVisible(false);
      s.label.setVisible(false);
      s.lockIcon.setVisible(false);
    });

    // Refresh first so icon alpha (dimmed if locked) and lockIcon
    // visibility are correct for the tab being switched INTO, then just
    // show everything — the refresh call already gates lockIcon on
    // shopOpen + this.shopTab, so it doesn't need touching again here.
    if (tab === 'skins') this.refreshShopSwatches();
    else this.refreshScenerySwatches();

    this.activeSwatches().forEach((s) => {
      s.bg.setVisible(true).setAlpha(1);
      s.icon.setVisible(true);
      s.label.setVisible(true).setAlpha(1);
    });

    this.shopSubtitleText.setText(
      tab === 'skins' ? "the fence's stash — no questions asked" : 'paint the town — one coin at a time'
    );
    this.refreshShopTabStyle();
  }

  private openShop(): void {
    if (this.shopOpen) return;
    this.shopOpen = true;
    // Sets each icon's ownership-dependent alpha (1 or dimmed) and each
    // lockIcon's visibility (gated on shopOpen + active tab) for BOTH tabs,
    // before anything below reads/shows them.
    this.refreshShopSwatches();
    this.refreshScenerySwatches();
    this.refreshShopTabStyle();

    const active = this.activeSwatches();
    // The inactive tab's swatches must stay fully hidden even though the
    // shop itself is opening — refresh above already keeps their lockIcon
    // correctly hidden, but bg/icon/label aren't tab-aware, so hide those
    // explicitly.
    this.inactiveSwatches().forEach((s) => {
      s.bg.setVisible(false);
      s.icon.setVisible(false);
      s.label.setVisible(false);
    });

    const fixed = [
      this.shopBackdrop,
      this.shopPanelBg,
      this.shopSkinsTabText,
      this.shopSceneryTabText,
      this.shopSubtitleText,
      this.shopCoinText,
      this.shopCloseText,
    ];
    const bgAndLabels = [...fixed, ...active.flatMap((s) => [s.bg, s.label])];
    const icons = active.map((s) => s.icon);
    const lockIcons = active.map((s) => s.lockIcon);

    [...bgAndLabels, ...icons].forEach((o) => o.setVisible(true));
    // lockIcon visibility is left exactly as the refresh calls above set
    // it (true only for locked tiles) — never force it visible here, that
    // was the bug: showing a lock glyph on an owned tile regardless of
    // ownership.

    bgAndLabels.forEach((o) => o.setAlpha(0));
    this.tweens.add({ targets: bgAndLabels, alpha: 1, duration: 160, ease: 'Sine.easeOut' });
    icons.forEach((icon) => {
      const target = icon.alpha;
      icon.setAlpha(0);
      this.tweens.add({ targets: icon, alpha: target, duration: 160, ease: 'Sine.easeOut' });
    });
    lockIcons.forEach((lockIcon) => {
      lockIcon.setAlpha(0);
      this.tweens.add({ targets: lockIcon, alpha: 1, duration: 160, ease: 'Sine.easeOut' });
    });

    this.refreshMenuButtonsVisibility();
  }

  private closeShop(): void {
    if (!this.shopOpen) return;
    this.shopOpen = false;

    const allObjects = [
      this.shopBackdrop,
      this.shopPanelBg,
      this.shopSkinsTabText,
      this.shopSceneryTabText,
      this.shopSubtitleText,
      this.shopCoinText,
      this.shopCloseText,
      ...this.shopSwatches.flatMap((s) => [s.bg, s.icon, s.label, s.lockIcon]),
      ...this.shopScenerySwatches.flatMap((s) => [s.bg, s.icon, s.label, s.lockIcon]),
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

  /** Swaps which pre-generated texture set the parallax TileSprites use — tilePositionX (scroll offset) is untouched, so this never causes a visible "jump" mid-scroll. */
  private setEquippedScenery(sceneryId: string): void {
    const textures = this.sceneryTextures.get(sceneryId) ?? this.sceneryTextures.get(DEFAULT_SCENERY_ID)!;
    this.skyline.setTexture(textures.skyline);
    this.midground.setTexture(textures.midground);
    this.ground.setTexture(textures.ground);
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
      if (pointInRect(this.shopSkinsTabRect, pointer.x, pointer.y)) {
        this.switchShopTab('skins');
        return;
      }
      if (pointInRect(this.shopSceneryTabRect, pointer.x, pointer.y)) {
        this.switchShopTab('scenery');
        return;
      }
      if (this.shopTab === 'skins') {
        const hit = this.shopSwatches.find((s) => pointInRect(s.rect, pointer.x, pointer.y));
        if (hit) this.onSwatchTap(hit);
      } else {
        const hit = this.shopScenerySwatches.find((s) => pointInRect(s.rect, pointer.x, pointer.y));
        if (hit) this.onScenerySwatchTap(hit);
      }
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
      this.recordedInputs.push({ t: Math.round(this.runElapsedMs), action: 'jump' });
    }
  }

  private resetRun(startPlaying: boolean): void {
    // Marker Images are tracked outside the obstacles group (see
    // spawnObstacle/maybeAttachDeathMarker), so obstacles.clear() alone
    // would leak them — destroy each one first.
    this.obstacles.getChildren().forEach((child) => {
      (child.getData('marker') as GameObjects.Image | undefined)?.destroy();
    });
    this.obstacles.clear(true, true);
    this.spawnTimer?.remove();
    this.distance = 0;
    this.distanceFloat = 0;
    this.wasGrounded = true;
    this.runElapsedMs = 0;
    this.recordedInputs = [];
    this.obstacleSpawnIndex = 0;
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

    // Snapshot whatever replay is currently cached — see loadGhostReplay()
    // for why this run uses the last-resolved fetch rather than blocking
    // run start on a fresh network round trip.
    this.ghostInputIndex = 0;
    this.ghostAlive = startPlaying && this.ghostReplay !== null;
    this.ghost.setPosition(this.playerX, this.groundY - (PLAYER_BASE_H * this.scaleFactor) / 2);
    this.ghost.body.setVelocity(0, 0);
    (this.ghost.body as Phaser.Physics.Arcade.Body).enable = this.ghostAlive;
    this.ghost.anims.stop();
    this.ghost.setTexture(this.skinTextures.get(DEFAULT_SKIN_ID)!.run[1]!);
    this.ghost.setVisible(this.ghostAlive);
    this.ghostLabel.setText(this.ghostReplay ? `👻 ${this.ghostReplay.username}` : '');
    this.ghostLabel.setVisible(this.ghostAlive);

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
      // Kick off fresh fetches so the NEXT run (retry or otherwise) picks
      // up any #1/death-count change that happened since — never blocks
      // this run.
      void this.loadGhostReplay();
      void this.loadDeathMarkerCounts();
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

    // Spawn-order counter, not time or position — deterministic from the
    // daily seed regardless of client framerate, so "the Nth obstacle
    // spawned" means the same physical obstacle across every player's run
    // today (see shared/api.ts's RunCompleteRequest.deathObstacleIndex).
    const spawnIndex = this.obstacleSpawnIndex++;
    obstacle.setData('spawnIndex', spawnIndex);
    this.maybeAttachDeathMarker(obstacle, spawnIndex);
  }

  private onCollide(obstacle: PhysicsSprite): void {
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
    const deathObstacleIndex = obstacle.getData('spawnIndex') as number | undefined;
    void this.reportRunComplete(this.distance, this.recordedInputs, deathObstacleIndex);
  }

  private spawnLandingBurst(): void {
    this.landEmitter.explode(8, this.player.x, this.player.y + this.player.displayHeight / 2);
  }

  /**
   * The ghost's own death — independent of the real player's onCollide, and
   * deliberately not ending or otherwise affecting the live run. Since the
   * ghost replays the same recorded inputs against this run's identically-
   * seeded obstacles in real time, its own overlap firing naturally lands
   * at the same obstacle the original run died on, with no separate death
   * timestamp needing to be recorded/sent.
   */
  private onGhostCollide(): void {
    if (!this.ghostAlive) return;
    this.ghostAlive = false;
    this.ghost.setVisible(false);
    this.ghostLabel.setVisible(false);
    (this.ghost.body as Phaser.Physics.Arcade.Body).enable = false;
  }

  override update(_time: number, delta: number): void {
    if (this.state !== 'playing') return;

    this.runElapsedMs += delta;
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

    if (this.ghostAlive && this.ghostReplay) {
      const inputs = this.ghostReplay.inputs;
      const ghostBody = this.ghost.body as Phaser.Physics.Arcade.Body;
      while (this.ghostInputIndex < inputs.length && inputs[this.ghostInputIndex]!.t <= this.runElapsedMs) {
        if (ghostBody.blocked.down || ghostBody.touching.down) {
          ghostBody.setVelocityY(-620 * this.scaleFactor);
        }
        this.ghostInputIndex++;
      }
      const ghostGrounded = ghostBody.blocked.down || ghostBody.touching.down;
      if (ghostGrounded) {
        this.ghost.play(GHOST_RUN_ANIM_KEY, true);
      } else {
        this.ghost.anims.stop();
        this.ghost.setTexture(this.skinTextures.get(DEFAULT_SKIN_ID)!.jump);
      }
      this.ghostLabel.setPosition(this.ghost.x, this.ghost.y - this.ghost.displayHeight / 2 - 6);
    }

    this.obstacles.getChildren().forEach((child) => {
      const sprite = child as GameObjects.Sprite;
      const marker = sprite.getData('marker') as GameObjects.Image | undefined;
      if (marker) {
        marker.setPosition(sprite.x, sprite.y - this.obstacleSize / 2 - marker.displayHeight / 2 - 2);
      }
      if (sprite.x < -this.obstacleSize) {
        marker?.destroy();
        this.obstacles.remove(sprite, true, true);
        // Reaching this point only happens while state === 'playing', i.e.
        // no collision has ended the run yet — so scrolling fully off
        // screen means it was successfully avoided.
        this.obstaclesClearedThisRun++;
        this.checkQuestProgress();
      }
    });
  }

  /** Attaches a small "danger tag" marker above `obstacle` if today's death count at `spawnIndex` meets DEATH_MARKER_THRESHOLD — purely visual, no physics/gameplay effect. */
  private maybeAttachDeathMarker(obstacle: GameObjects.Sprite, spawnIndex: number): void {
    if ((this.deathMarkerCounts[spawnIndex] ?? 0) < DEATH_MARKER_THRESHOLD) return;
    const markerSize = DEATH_MARKER_SIZE * this.scaleFactor;
    const marker = this.add
      .image(obstacle.x, obstacle.y - this.obstacleSize / 2 - markerSize / 2 - 2, this.deathMarkerKey)
      .setDisplaySize(markerSize, markerSize)
      .setDepth(0.9);
    obstacle.setData('marker', marker);
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
      this.setEquippedScenery(this.playerProfile.equippedScenery);
      this.refreshCoinText();
      this.refreshShopSwatches();
      this.refreshScenerySwatches();
    } catch {
      // Non-critical — coins/skins/scenery just keep showing their
      // defaults until the next successful load.
    }
  }

  /**
   * Fetches today's #1 run's replay (null if nobody's posted a score yet).
   * Only updates this.ghostReplay/label — does NOT touch ghostAlive or the
   * ghost sprite's visibility, since resetRun() decides per-run whether to
   * actually play it back (see its comment for why this snapshot approach
   * is fine). The requestId guard means a slow response from a request
   * kicked off by an earlier run can't stomp a newer one.
   */
  private async loadGhostReplay(): Promise<void> {
    const requestId = ++this.ghostRequestId;
    try {
      const res = await fetch('/api/ghost');
      if (!res.ok) return;
      const data = (await res.json()) as GhostResponse;
      if (requestId !== this.ghostRequestId) return;
      this.ghostReplay = data.replay;
    } catch {
      // Best-effort — worst case this run just has no ghost to play back.
    }
  }

  /**
   * Fetches today's raw per-obstacle-index death counts. Only updates
   * this.deathMarkerCounts, read by maybeAttachDeathMarker() the next time
   * (or times) spawnObstacle() runs — an in-flight run's already-spawned
   * obstacles don't retroactively grow markers, which is fine for a purely
   * ambient hint.
   */
  private async loadDeathMarkerCounts(): Promise<void> {
    try {
      const res = await fetch('/api/death-markers');
      if (!res.ok) return;
      const data = (await res.json()) as DeathMarkersResponse;
      this.deathMarkerCounts = data.counts;
    } catch {
      // Best-effort — worst case no markers show up this run.
    }
  }

  /**
   * Reports a finished run's distance so the (server-authoritative) coin
   * balance updates — see server/routes/api.ts's /run-complete for why this
   * isn't computed client-side. `inputs` is this run's jump log; the server
   * only actually persists it if this run becomes today's new #1, so it's
   * cheap to always include. `deathObstacleIndex` is which obstacle ended
   * this run (undefined if it somehow didn't end in a collision), fed into
   * the community death-marker aggregate.
   */
  private async reportRunComplete(
    distance: number,
    inputs: GhostInputEvent[],
    deathObstacleIndex: number | undefined
  ): Promise<void> {
    try {
      const res = await fetch('/api/run-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ distance, inputs, deathObstacleIndex }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as PlayerResponse;
      this.playerProfile = data.profile;
      this.refreshCoinText();
      this.refreshShopSwatches();
      this.refreshScenerySwatches();
    } catch {
      // Best-effort — worst case this run's coins don't get credited, not
      // a broken experience (the run itself already fully played out).
    }
  }

  private onSwatchTap(swatch: ShopSwatch): void {
    const owned = this.playerProfile.unlockedSkins.includes(swatch.skin.id);
    if (owned) {
      if (this.playerProfile.equippedSkin !== swatch.skin.id) {
        this.applyEquipSkin(swatch.skin.id);
      }
      return;
    }
    if (this.playerProfile.coins < swatch.skin.cost) {
      this.flashInsufficientFunds(swatch);
      return;
    }
    this.applyUnlockSkin(swatch.skin);
  }

  private flashInsufficientFunds(swatch: ShopSwatchVisuals): void {
    swatch.label.setText('Need more\ncoins').setColor('#ff6b6b');
    const tab = this.shopTab;
    this.time.delayedCall(900, () => {
      if (tab === 'skins') this.refreshShopSwatches();
      else this.refreshScenerySwatches();
    });
  }

  /**
   * Optimistic update: apply the equip locally and redraw immediately —
   * switching skins used to wait on a full network round-trip before
   * anything on screen changed, which is what actually made it feel
   * laggy (the Graphics redraw itself is a handful of tiny shape fills,
   * sub-millisecond). The request below just reconciles with the server's
   * authoritative response afterward; on failure it rolls back to
   * whatever was true before the tap rather than leaving the UI showing
   * something the server never confirmed.
   */
  private applyEquipSkin(skinId: string): void {
    const previous = this.playerProfile;
    this.playerProfile = { ...this.playerProfile, equippedSkin: skinId };
    this.setEquippedSkin(skinId);
    this.refreshShopSwatches();
    void this.equipSkinRequest(skinId, previous);
  }

  private applyUnlockSkin(skin: SkinDef): void {
    const previous = this.playerProfile;
    // Mirrors exactly what server/core/player.ts's unlockSkin does, so the
    // optimistic state matches the confirmed response in the common case.
    this.playerProfile = {
      ...previous,
      coins: previous.coins - skin.cost,
      unlockedSkins: [...previous.unlockedSkins, skin.id],
      equippedSkin: skin.id,
    };
    this.setEquippedSkin(skin.id);
    this.refreshCoinText();
    this.refreshShopSwatches();
    void this.unlockSkinRequest(skin.id, previous);
  }

  private async equipSkinRequest(skinId: string, previous: PlayerProfile): Promise<void> {
    try {
      const res = await fetch('/api/skins/equip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skinId }),
      });
      const data = (await res.json()) as SkinActionResponse;
      // Always reconcile to the server's authoritative profile, whether it
      // confirmed the optimistic change or not — in the common case this
      // just re-applies what's already showing.
      this.playerProfile = data.profile;
      this.setEquippedSkin(this.playerProfile.equippedSkin);
      this.refreshShopSwatches();
    } catch {
      this.playerProfile = previous;
      this.setEquippedSkin(previous.equippedSkin);
      this.refreshShopSwatches();
    }
  }

  private async unlockSkinRequest(skinId: string, previous: PlayerProfile): Promise<void> {
    try {
      const res = await fetch('/api/skins/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skinId }),
      });
      const data = (await res.json()) as SkinActionResponse;
      this.playerProfile = data.profile;
      this.setEquippedSkin(this.playerProfile.equippedSkin);
      this.refreshCoinText();
      this.refreshShopSwatches();
    } catch {
      this.playerProfile = previous;
      this.setEquippedSkin(previous.equippedSkin);
      this.refreshCoinText();
      this.refreshShopSwatches();
    }
  }

  // --- Scenery: exact mirror of the skin unlock/equip flow above, applied
  // to the parallax background's palette instead of the player sprite's.

  private onScenerySwatchTap(swatch: ShopScenerySwatch): void {
    const owned = this.playerProfile.unlockedScenery.includes(swatch.scenery.id);
    if (owned) {
      if (this.playerProfile.equippedScenery !== swatch.scenery.id) {
        this.applyEquipScenery(swatch.scenery.id);
      }
      return;
    }
    if (this.playerProfile.coins < swatch.scenery.cost) {
      this.flashInsufficientFunds(swatch);
      return;
    }
    this.applyUnlockScenery(swatch.scenery);
  }

  private applyEquipScenery(sceneryId: string): void {
    const previous = this.playerProfile;
    this.playerProfile = { ...this.playerProfile, equippedScenery: sceneryId };
    this.setEquippedScenery(sceneryId);
    this.refreshScenerySwatches();
    void this.equipSceneryRequest(sceneryId, previous);
  }

  private applyUnlockScenery(scenery: SceneryDef): void {
    const previous = this.playerProfile;
    this.playerProfile = {
      ...previous,
      coins: previous.coins - scenery.cost,
      unlockedScenery: [...previous.unlockedScenery, scenery.id],
      equippedScenery: scenery.id,
    };
    this.setEquippedScenery(scenery.id);
    this.refreshCoinText();
    this.refreshScenerySwatches();
    void this.unlockSceneryRequest(scenery.id, previous);
  }

  private async equipSceneryRequest(sceneryId: string, previous: PlayerProfile): Promise<void> {
    try {
      const res = await fetch('/api/scenery/equip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneryId }),
      });
      const data = (await res.json()) as SceneryActionResponse;
      this.playerProfile = data.profile;
      this.setEquippedScenery(this.playerProfile.equippedScenery);
      this.refreshScenerySwatches();
    } catch {
      this.playerProfile = previous;
      this.setEquippedScenery(previous.equippedScenery);
      this.refreshScenerySwatches();
    }
  }

  private async unlockSceneryRequest(sceneryId: string, previous: PlayerProfile): Promise<void> {
    try {
      const res = await fetch('/api/scenery/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneryId }),
      });
      const data = (await res.json()) as SceneryActionResponse;
      this.playerProfile = data.profile;
      this.setEquippedScenery(this.playerProfile.equippedScenery);
      this.refreshCoinText();
      this.refreshScenerySwatches();
    } catch {
      this.playerProfile = previous;
      this.setEquippedScenery(previous.equippedScenery);
      this.refreshCoinText();
      this.refreshScenerySwatches();
    }
  }
}
