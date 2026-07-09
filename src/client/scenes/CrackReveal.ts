import { Scene, GameObjects } from 'phaser';
import type * as Phaser from 'phaser';
import { doorScaleFor, drawDial, drawGlow, drawVaultDoor, ensureSparkTexture } from './vaultGraphics';
import { playChime } from '../audio';

export type CrackRevealData = {
  username: string;
  combination: string;
  onDismiss: () => void;
};

/** The "wow moment": vault door swings open, particle burst, winner's name. */
export class CrackReveal extends Scene {
  private payload!: CrackRevealData;
  private door!: GameObjects.Graphics;
  private dial!: GameObjects.Graphics;
  private glow!: GameObjects.Graphics;
  private title!: GameObjects.Text;
  private nameText!: GameObjects.Text;
  private comboText!: GameObjects.Text;
  private continueText!: GameObjects.Text;
  private sparkKey!: string;
  private centerX = 0;
  private centerY = 0;
  private doorScale = 1;

  constructor() {
    super('CrackReveal');
  }

  init(data: CrackRevealData): void {
    this.payload = data;
  }

  create(): void {
    this.sparkKey = ensureSparkTexture(this);
    this.cameras.main.setBackgroundColor('#0f0f0f');

    this.glow = drawGlow(this, 0, 0);
    this.door = drawVaultDoor(this, 0, 0);
    this.dial = drawDial(this, 0, 0);

    this.title = this.add
      .text(0, 0, 'THE VAULT IS OPEN', { fontFamily: 'Arial Black', fontSize: '26px', color: '#ffd166' })
      .setOrigin(0.5)
      .setAlpha(0);

    this.nameText = this.add
      .text(0, 0, `u/${this.payload.username}`, { fontFamily: 'Arial Black', fontSize: '34px', color: '#ffffff' })
      .setOrigin(0.5)
      .setAlpha(0)
      .setScale(0.5);

    this.comboText = this.add
      .text(0, 0, `Combination: ${this.payload.combination}`, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#cccccc',
      })
      .setOrigin(0.5)
      .setAlpha(0);

    this.continueText = this.add
      .text(0, 0, 'Tap to continue ▸', { fontFamily: 'Arial', fontSize: '15px', color: '#999999' })
      .setOrigin(0.5)
      .setAlpha(0)
      .setInteractive({ useHandCursor: true });
    this.continueText.on('pointerdown', () => this.payload.onDismiss());

    this.layout(this.scale.width, this.scale.height);
    this.scale.on('resize', (size: Phaser.Structs.Size) => this.layout(size.width, size.height));

    // Dial spins fast, easing to a stop — the "cracking" anticipation beat.
    this.tweens.add({
      targets: this.dial,
      angle: 360 * 4,
      duration: 900,
      ease: 'Cubic.easeOut',
      onComplete: () => this.openDoor(),
    });
  }

  /** Repositions everything for the current canvas size. Called on create and on every resize. */
  private layout(width: number, height: number): void {
    this.cameras.resize(width, height);
    this.centerX = width / 2;
    this.centerY = height * 0.42;

    this.doorScale = doorScaleFor(width, height);
    // The glow starts at scale 0 (hidden) and is tweened up to doorScale by
    // openDoor() — only reposition it here, don't touch its scale.
    this.glow.setPosition(this.centerX, this.centerY);
    this.door.setPosition(this.centerX, this.centerY).setScale(this.doorScale);
    this.dial.setPosition(this.centerX, this.centerY).setScale(this.doorScale);

    this.title.setPosition(this.centerX, height * 0.1);
    this.nameText.setPosition(this.centerX, height * 0.74);
    this.comboText.setPosition(this.centerX, height * 0.8);
    this.continueText.setPosition(this.centerX, height * 0.92);
  }

  private openDoor(): void {
    playChime();
    this.cameras.main.flash(200, 255, 230, 150);
    this.cameras.main.shake(250, 0.01);

    // "Door swings open": scale the face down to edge-on while the glow
    // behind it scales up — a cheap but legible 2D stand-in for a hinge swing.
    this.tweens.add({ targets: this.door, scaleX: 0, duration: 450, ease: 'Cubic.easeIn' });
    this.tweens.add({ targets: this.dial, scaleX: 0, duration: 450, ease: 'Cubic.easeIn' });
    this.tweens.add({
      targets: this.glow,
      scale: this.doorScale,
      duration: 350,
      ease: 'Back.easeOut',
      onComplete: () => this.spawnParticles(),
    });

    this.tweens.add({ targets: this.title, alpha: 1, duration: 300, delay: 200 });
    this.tweens.add({
      targets: this.nameText,
      alpha: 1,
      scale: 1,
      duration: 500,
      delay: 500,
      ease: 'Back.easeOut',
    });
    this.tweens.add({ targets: this.comboText, alpha: 1, duration: 400, delay: 900 });
    this.tweens.add({ targets: this.continueText, alpha: 1, duration: 400, delay: 1200 });
  }

  private spawnParticles(): void {
    const emitter = this.add.particles(this.centerX, this.centerY, this.sparkKey, {
      speed: { min: 150, max: 350 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.6, end: 0 },
      lifespan: 900,
      gravityY: 200,
      tint: [0xffd166, 0xffffff, 0xffa500],
    });
    emitter.explode(40, this.centerX, this.centerY);
  }
}
