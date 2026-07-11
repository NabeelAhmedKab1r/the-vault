import { Scene } from 'phaser';

// No assets to preload yet — Runner.ts draws everything procedurally.
export class Boot extends Scene {
  constructor() {
    super('Boot');
  }

  create() {
    this.scene.start('Preloader');
  }
}
