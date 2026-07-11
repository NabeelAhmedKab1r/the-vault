import { Scene } from 'phaser';

// No real asset loading yet — everything drawn here is procedural (see
// theme.ts / Runner.ts), so there's nothing to preload.
export class Preloader extends Scene {
  constructor() {
    super('Preloader');
  }

  create() {
    this.scene.start('Runner');
  }
}
