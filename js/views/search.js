// Onglet Rechercher : recherche OMDb, notes chargées pour chaque résultat, ajout en un geste.
import { h, poster, scoreChips, toast, typeLabel } from '../ui.js';
import * as store from '../store.js';
import * as omdb from '../omdb.js';
import { openDetail } from './detail.js';
import { openImport } from './import.js';

const DEBOUNCE_MS = 450;
const RATINGS_AT_ONCE = 4;

// Gardé entre deux affichages de l'onglet.
let last = { query: '', type: '', results: [], total: 0, page: 1, ratings: {} };

function resultCard(r, refreshList) {
  const saved = store.findTitle(r.id);
  const ratings = last.ratings[r.id];
  const add = async (e) => {
    e.stopPropagation();
    try {
      const full = await omdb.details(store.getState().apiKey, r.id);
      store.addTitles([full]);
      toast(`« ${full.title} » ajouté au carnet`, 'ok');
      refreshList();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return h('li.result', {},
    h('button.result-main', { type: 'button', onclick: () => openDetail(r) },
      poster(r, { width: 160 }),
      h('div.result-text', {},
        h('strong', {}, r.title),
        h('span.muted', {}, [typeLabel(r.type), r.year].filter(Boolean).join(' · ')),
        ratings === undefined ? h('span.chips.pending', {}, 'notes…') : scoreChips(ratings) ?? h('span.muted.small', {}, 'pas encore noté'))),
    saved
      ? h('span.added', { title: 'Déjà dans le carnet' }, saved.status === 'watched' ? '✓ Vu' : '✓ Carnet')
      : h('button.add', { type: 'button', 'aria-label': `Ajouter ${r.title} au carnet`, onclick: add }, '+'));
}

export function renderSearch(root) {
  const { apiKey } = store.getState();
  const list = h('ul.results');
  const status = h('p.status.muted', { role: 'status' });
  const more = h('button.btn.ghost.more', { type: 'button', hidden: true, onclick: () => run(last.page + 1) }, 'Plus de résultats');
  let timer = null;
  let token = 0;

  const drawList = () => {
    list.replaceChildren(...last.results.map((r) => resultCard(r, drawList)));
    more.hidden = last.results.length >= last.total || !last.results.length;
  };

  const loadRatings = (items, myToken) => omdb.pool(
    items.filter((r) => last.ratings[r.id] === undefined),
    RATINGS_AT_ONCE,
    (r) => omdb.details(apiKey, r.id),
    (_, res) => {
      if (myToken !== token || !res.ok) return;
      last.ratings = { ...last.ratings, [res.value.id]: res.value.ratings };
      drawList();
    },
  );

  async function run(page = 1) {
    const query = input.value.trim();
    const myToken = ++token;
    if (query.length < 2) {
      last = { ...last, query, results: [], total: 0, page: 1 };
      status.textContent = query ? 'Tape au moins 2 lettres.' : '';
      drawList();
      return;
    }
    status.textContent = 'Recherche…';
    try {
      const { results, total } = await omdb.search(apiKey, query, { type: typeSel.value, page });
      if (myToken !== token) return;
      const merged = page === 1 ? results : [...last.results, ...results.filter((r) => !last.results.some((x) => x.id === r.id))];
      last = { ...last, query, type: typeSel.value, results: merged, total, page };
      status.textContent = total
        ? `${total.toLocaleString('fr-FR')} résultat${total > 1 ? 's' : ''}`
        : 'Aucun résultat. Essaie le titre original (souvent en anglais) ou colle le lien IMDb.';
      drawList();
      loadRatings(results, myToken);
    } catch (err) {
      if (myToken === token) status.textContent = err.message;
    }
  }

  const input = h('input.search-input', {
    type: 'search', placeholder: 'Titre d’un film ou d’une série…', value: last.query, enterKeyHint: 'search',
    autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Rechercher un titre',
    oninput: () => { clearTimeout(timer); timer = setTimeout(() => run(1), DEBOUNCE_MS); },
    onkeydown: (e) => { if (e.key === 'Enter') { clearTimeout(timer); run(1); input.blur(); } },
  });
  const typeSel = h('select', { 'aria-label': 'Type', onchange: () => run(1) },
    [['', 'Tout'], ['movie', 'Films'], ['series', 'Séries']].map(([v, l]) => h('option', { value: v, selected: last.type === v }, l)));

  root.replaceChildren(
    h('header.page-head', {},
      h('p.kicker', {}, 'Rechercher'),
      h('h1', {}, 'Trouver quoi regarder'),
      h('p.muted', {}, 'Titres de la base IMDb, avec les notes IMDb, Rotten Tomatoes et Metacritic.')),
    h('div.search-bar', {}, input, typeSel),
    h('button.import-cta', { type: 'button', onclick: openImport },
      h('span.import-icon', { 'aria-hidden': 'true' }, '☰'),
      h('span', {}, h('strong', {}, 'Importer une liste'), h('small', {}, 'Colle plusieurs titres d’un coup, un par ligne'))),
    status, list, more);
  if (last.results.length) {
    status.textContent = `${last.total.toLocaleString('fr-FR')} résultat${last.total > 1 ? 's' : ''}`;
    drawList();
  } else if (!last.query) {
    setTimeout(() => input.focus({ preventScroll: true }), 50);
  }
}
