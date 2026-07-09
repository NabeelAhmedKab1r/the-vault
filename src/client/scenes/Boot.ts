import { Scene } from 'phaser';

// No assets to preload yet — Phase 4 adds the vault-crack reveal art here.
export class Boot extends Scene {
  constructor() {
    super('Boot');
  }

  create() {
    this.scene.start('Preloader');
  }
}
