// Point d'entrée : accueil (clé OMDb) puis deux onglets, Rechercher et Carnet.
import { h } from './ui.js';
import * as store from './store.js';
import { renderSearch } from './views/search.js';
import { renderCarnet } from './views/carnet.js';
import { openSettings, renderWelcome } from './views/settings.js';

const TABS = [
  { id: 'carnet', label: 'Carnet', icon: '▦' },
  { id: 'search', label: 'Rechercher', icon: '⌕' },
];

const main = document.getElementById('app');
const nav = document.querySelector('nav.tabs');
let current = location.hash === '#search' ? 'search' : 'carnet';

function go(tab) {
  current = tab;
  history.replaceState(null, '', `#${tab}`);
  draw();
  window.scrollTo({ top: 0 });
}

function drawNav() {
  nav.hidden = false;
  nav.replaceChildren(
    ...TABS.map((t) => h(`button.tab${t.id === current ? '.on' : ''}`, {
      type: 'button', 'aria-current': t.id === current ? 'page' : null, onclick: () => go(t.id),
    }, h('span.tab-icon', { 'aria-hidden': 'true' }, t.icon), h('span', {}, t.label))),
    h('button.tab.settings-btn', { type: 'button', onclick: openSettings, 'aria-label': 'Réglages' },
      h('span.tab-icon', { 'aria-hidden': 'true' }, '⚙'), h('span', {}, 'Réglages')),
  );
}

function draw() {
  if (!store.getState().apiKey) {
    nav.hidden = true;
    renderWelcome(main, () => go('search'));
    return;
  }
  drawNav();
  if (current === 'search') renderSearch(main);
  else renderCarnet(main, { goSearch: () => go('search') });
}

// Redessine l'onglet quand les données changent (sauf pendant une saisie de texte).
store.subscribe((_, meta) => {
  if (!meta.quiet) draw();
});

draw();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.error('Service worker', err));
  // Recharge seulement lors d'une mise à jour (pas à la toute première visite, ni pendant l'accueil).
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded || document.querySelector('.sheet, .welcome')) return;
    reloaded = true;
    location.reload();
  });
}
