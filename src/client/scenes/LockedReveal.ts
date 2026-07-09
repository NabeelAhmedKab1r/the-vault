import { Scene, GameObjects } from 'phaser';
import type * as Phaser from 'phaser';
import { doorScaleFor, drawDial, drawVaultDoor } from './vaultGraphics';
import { playThud } from '../audio';

export type LockedRevealClosestEntry = {
  username: string;
  score: number;
};

export type LockedRevealData = {
  combination: string;
  closest: LockedRevealClosestEntry[];
  onDismiss: () => void;
};

/** The no-crack case: door rattles but stays shut, then reveals the answer. */
export class LockedReveal extends Scene {
  private payload!: LockedRevealData;
  private door!: GameObjects.Graphics;
  private dial!: GameObjects.Graphics;
  private title!: GameObjects.Text;
  private comboText!: GameObjects.Text;
  private closestText!: GameObjects.Text;
  private continueText!: GameObjects.Text;
  private centerX = 0;
  private centerY = 0;

  constructor() {
    super('LockedReveal');
  }

  init(data: LockedRevealData): void {
    this.payload = data;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#0f0f0f');

    this.door = drawVaultDoor(this, 0, 0);
    this.dial = drawDial(this, 0, 0);

    this.title = this.add
      .text(0, 0, 'VAULT STILL SEALED', { fontFamily: 'Arial Black', fontSize: '24px', color: '#9aa4b2' })
      .setOrigin(0.5)
      .setAlpha(0);

    this.comboText = this.add
      .text(0, 0, `Combination was: ${this.payload.combination}`, {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setAlpha(0);

    this.closestText = this.add
      .text(0, 0, this.closestSummary(), {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: '#cccccc',
        align: 'center',
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

    // Short, frustrated spin that overshoots slightly and settles — unlike
    // the crack case, this never reaches the "door opens" beat.
    this.tweens.add({
      targets: this.dial,
      angle: 360 * 1.5,
      duration: 500,
      ease: 'Back.easeOut',
      onComplete: () => this.rattle(),
    });
  }

  /** Repositions everything for the current canvas size. Called on create and on every resize. */
  private layout(width: number, height: number): void {
    this.cameras.resize(width, height);
    this.centerX = width / 2;
    this.centerY = height * 0.4;

    const doorScale = doorScaleFor(width, height);
    this.door.setPosition(this.centerX, this.centerY).setScale(doorScale);
    this.dial.setPosition(this.centerX, this.centerY).setScale(doorScale);

    this.title.setPosition(this.centerX, height * 0.1);
    this.comboText.setPosition(this.centerX, height * 0.72);
    this.closestText.setPosition(this.centerX, height * 0.8).setWordWrapWidth(width * 0.8);
    this.continueText.setPosition(this.centerX, height * 0.92);
  }

  private closestSummary(): string {
    if (this.payload.closest.length === 0) return 'Nobody guessed at all today.';
    const names = this.payload.closest.map((c) => `u/${c.username}`).join(', ');
    const score = this.payload.closest[0]?.score ?? 0;
    return `Closest: ${names} (${score}/5)`;
  }

  private rattle(): void {
    playThud();
    this.cameras.main.shake(300, 0.006);

    // The door itself wobbles a few times, like it's stuck — then settles.
    this.tweens.add({
      targets: this.door,
      x: '+=6',
      duration: 60,
      yoyo: true,
      repeat: 5,
    });

    this.tweens.add({ targets: this.title, alpha: 1, duration: 300, delay: 200 });
    this.tweens.add({ targets: this.comboText, alpha: 1, duration: 400, delay: 600 });
    this.tweens.add({ targets: this.closestText, alpha: 1, duration: 400, delay: 950 });
    this.tweens.add({ targets: this.continueText, alpha: 1, duration: 400, delay: 1300 });
  }
}
