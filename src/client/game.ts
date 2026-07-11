import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import { Boot } from './scenes/Boot';
import { Preloader } from './scenes/Preloader';
import { Runner } from './scenes/Runner';

// "The Vault: Getaway" is now a single fullscreen canvas game (no more
// embedded-dial-plus-DOM-chrome split from the old vault-cracking build) —
// see the project pivot notes for why. Arcade Physics powers the runner's
// gravity/collision.
const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  parent: 'game-container',
  backgroundColor: '#0f0f0f',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1024,
    height: 768,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 1800 },
      debug: false,
    },
  },
  scene: [Boot, Preloader, Runner],
};

document.addEventListener('DOMContentLoaded', () => {
  new Game(config);
});
