import { Scene } from 'phaser';

// No real asset loading yet — Phase 4 adds the vault door / particle assets here.
export class Preloader extends Scene {
  constructor() {
    super('Preloader');
  }

  create() {
    this.scene.start('Game');
  }
}
