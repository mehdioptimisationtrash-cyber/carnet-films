// Onglet Carnet : la banque de titres, filtrée et triée, en mur de jaquettes.
import { h, poster, scoreChips, typeLabel } from '../ui.js';
import { allGenres, filterTitles, formatRuntime, SORTS, sortTitles, stats, translateGenre } from '../model.js';
import * as store from '../store.js';
import { openDetail } from './detail.js';
import { openImport } from './import.js';

let text = ''; // recherche dans le carnet, non sauvegardée

function segmented(name, options, value, onChange) {
  return h('div.segmented', { role: 'radiogroup', 'aria-label': name },
    options.map(([v, label]) => h(`button${v === value ? '.on' : ''}`, {
      type: 'button', role: 'radio', 'aria-checked': String(v === value), onclick: () => onChange(v),
    }, label)));
}

function select(label, options, value, onChange) {
  return h('label.select', {}, h('span', {}, label),
    h('select', { onchange: (e) => onChange(e.target.value) },
      options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l))));
}

function card(t) {
  return h('li', {},
    h(`button.card${t.status === 'watched' ? '.watched' : ''}`, { type: 'button', onclick: () => openDetail(t) },
      poster(t),
      t.priority ? h('span.flag', { title: 'Prioritaire' }, '🔥') : null,
      t.status === 'watched' ? h('span.seen', {}, t.myRating ? `✓ ${'★'.repeat(t.myRating)}` : '✓ Vu') : null,
      h('div.card-body', {},
        h('strong.card-title', {}, t.title),
        h('span.card-meta', {}, [typeLabel(t.type), t.year, t.type === 'movie' ? formatRuntime(t.runtime) : null].filter(Boolean).join(' · ')),
        scoreChips(t.ratings, { compact: true }))));
}

function empty(isEmptyCarnet, goSearch) {
  if (!isEmptyCarnet) return h('div.empty', {}, h('p', {}, 'Aucun titre ne correspond à ces filtres.'));
  return h('div.empty', {},
    h('p.empty-title', {}, 'Ton carnet est vide.'),
    h('p.muted', {}, 'Ajoute des titres depuis la recherche, ou colle directement ta liste.'),
    h('div.actions', {},
      h('button.btn.primary', { type: 'button', onclick: openImport }, 'Importer une liste'),
      h('button.btn.ghost', { type: 'button', onclick: goSearch }, 'Rechercher un titre')));
}

export function renderCarnet(root, { goSearch }) {
  const { titles, view } = store.getState();
  const s = stats(titles);
  const genres = allGenres(titles);
  const set = (changes) => store.setView(changes);
  const grid = h('ul.grid');
  const count = h('p.count.muted', { role: 'status' });

  const drawGrid = () => {
    const shown = sortTitles(filterTitles(titles, { ...view, text }), view.sort);
    grid.replaceChildren(...shown.map(card));
    count.textContent = `${shown.length} titre${shown.length > 1 ? 's' : ''}`;
    if (!shown.length) grid.replaceChildren(h('li.full', {}, empty(!titles.length, goSearch)));
  };

  const filters = h('details.filters', { open: !!(view.genre || view.minImdb || view.minRt) },
    h('summary', {}, 'Filtres & tri'),
    h('div.filter-grid', {},
      select('Trier par', Object.entries(SORTS).map(([k, v]) => [k, v.label]), view.sort, (sort) => set({ sort })),
      select('Genre', [['', 'Tous'], ...genres.map((g) => [g, translateGenre(g)])], view.genre, (genre) => set({ genre })),
      select('IMDb minimum', [[0, 'Peu importe'], [6, '6+'], [7, '7+'], [7.5, '7,5+'], [8, '8+']], view.minImdb, (v) => set({ minImdb: Number(v) })),
      select('Rotten Tomatoes min.', [[0, 'Peu importe'], [60, '60 % (frais)'], [75, '75 %'], [90, '90 %']], view.minRt, (v) => set({ minRt: Number(v) }))));

  root.replaceChildren(
    h('header.page-head', {},
      h('p.kicker', {}, 'Mon carnet'),
      h('h1', {}, s.todo ? `${s.todo} à voir` : 'Ma watchlist'),
      h('p.muted', {},
        [`${s.watched} vu${s.watched > 1 ? 's' : ''}`, s.movieMinutes ? `${formatRuntime(s.movieMinutes)} de films en attente` : null]
          .filter(Boolean).join(' · '))),
    h('div.toolbar', {},
      segmented('Statut', [['todo', 'À voir'], ['watched', 'Vus'], ['all', 'Tout']], view.status, (status) => set({ status })),
      segmented('Type', [['all', 'Tout'], ['movie', 'Films'], ['series', 'Séries']], view.type, (type) => set({ type }))),
    h('div.carnet-search', {},
      h('input', {
        type: 'search', value: text, placeholder: 'Chercher dans le carnet (titre, acteur, genre, commentaire)…',
        'aria-label': 'Chercher dans le carnet',
        oninput: (e) => { text = e.target.value; drawGrid(); },
      }),
      h('button.btn.ghost.icon', { type: 'button', onclick: openImport, 'aria-label': 'Importer une liste', title: 'Importer une liste' }, '＋ Liste')),
    filters, count, grid);
  drawGrid();
}
