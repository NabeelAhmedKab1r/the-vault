// Owns the Phaser Game instance and the canvas's show/hide state. The
// canvas is an overlay reserved for two moments: the vault-crack reveal and
// the still-locked reveal. It stays hidden the rest of the time so the
// plain DOM UI (guess form, board, scratch pad, archive strip) stays the
// primary interface, per the Phase 4 scope.

import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import { Boot } from './scenes/Boot';
import { Preloader } from './scenes/Preloader';
import { Game as MainGame } from './scenes/Game';
import { CrackReveal, type CrackRevealData } from './scenes/CrackReveal';
import { LockedReveal, type LockedRevealClosestEntry, type LockedRevealData } from './scenes/LockedReveal';

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
  scene: [Boot, Preloader, MainGame, CrackReveal, LockedReveal],
};

let game: Phaser.Game | null = null;

const getContainer = (): HTMLDivElement => document.getElementById('game-container') as HTMLDivElement;

const showCanvas = (): void => {
  getContainer().classList.add('visible');
  // The container is full-viewport-sized even while hidden (see game.css),
  // but the viewport itself may have changed (orientation flip, on-screen
  // keyboard) since Phaser last measured it. Force a resync now so the
  // scene always lays out against the current, correct size.
  game?.scale.refresh();
};

const hideCanvas = (): void => {
  getContainer().classList.remove('visible');
};

export const initReveals = (): void => {
  game = new Game({ ...config, parent: 'game-container' });
};

export const showCrackReveal = (payload: { username: string; combination: string }): void => {
  if (!game) return;
  showCanvas();
  const data: CrackRevealData = { ...payload, onDismiss: hideCanvas };
  game.scene.start('CrackReveal', data);
};

export const showLockedReveal = (payload: {
  combination: string;
  closest: LockedRevealClosestEntry[];
}): void => {
  if (!game) return;
  showCanvas();
  const data: LockedRevealData = { ...payload, onDismiss: hideCanvas };
  game.scene.start('LockedReveal', data);
};
