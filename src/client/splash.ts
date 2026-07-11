import { navigateTo, context, requestExpandedMode } from '@devvit/web/client';

const startButton = document.getElementById('start-button') as HTMLButtonElement;
const docsLink = document.getElementById('docs-link') as HTMLDivElement;
const titleElement = document.getElementById('title') as HTMLHeadingElement;

startButton.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});

docsLink.addEventListener('click', () => {
  navigateTo('https://developers.reddit.com/docs');
});

if (context.username) {
  titleElement.textContent = `The Vault — Getaway — welcome back, ${context.username}`;
}
