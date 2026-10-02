// Point d'entrée : accueil (clé OMDb) puis deux onglets, Rechercher et Carnet.
import { h } from './ui.js';
import * as store from './store.js';
import { renderSearch } from './views/search.js';
import { renderCarnet } from './views/carnet.js';
import { renderDiscover } from './views/discover.js';
import { openSettings, renderWelcome } from './views/settings.js';
import { enrichCarnet, needsFrench } from './french.js';
import { startSync } from './sync.js';

const TABS = [
  { id: 'carnet', label: 'Carnet', icon: '▦' },
  { id: 'search', label: 'Rechercher', icon: '⌕' },
  { id: 'discover', label: 'Pour moi', icon: '✦' },
];

const main = document.getElementById('app');
const nav = document.querySelector('nav.tabs');
let current = TABS.some((t) => `#${t.id}` === location.hash) ? location.hash.slice(1) : 'carnet';

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
  // Garde le curseur dans la recherche du carnet si l'écran est redessiné pendant la saisie.
  const typing = document.activeElement?.closest?.('.carnet-search') ? document.activeElement.selectionStart : null;
  if (!store.getState().apiKey) {
    nav.hidden = true;
    renderWelcome(main, () => go('search'), () => go('carnet'));
    return;
  }
  drawNav();
  if (current === 'search') renderSearch(main);
  else if (current === 'discover') renderDiscover(main);
  else renderCarnet(main, { goSearch: () => go('search') });
  if (typing != null) {
    const input = main.querySelector('.carnet-search input');
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(typing, typing);
  }
}

// Titres français + synopsis Wikipédia : complétés en arrière-plan pour tout titre du carnet qui n'en a pas.
let enriching = false;
async function enrichInBackground() {
  if (enriching || !store.getState().titles.some(needsFrench)) return;
  enriching = true;
  try {
    await enrichCarnet();
  } finally {
    enriching = false;
  }
}

// Redessine l'onglet quand les données changent (sauf pendant une saisie de texte).
store.subscribe((_, meta) => {
  // Les compléments en arrière-plan (titres français) ne redessinent que le carnet : une recherche en cours reste intacte.
  if (!meta.quiet && !(meta.background && current !== 'carnet')) draw();
  if (!meta.background) setTimeout(enrichInBackground, 300);
});

draw();
startSync();
enrichInBackground();

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
