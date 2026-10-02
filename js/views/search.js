// Onglet Rechercher : recherche OMDb, notes chargées pour chaque résultat, ajout en un geste.
import { h } from '../ui.js';
import * as store from '../store.js';
import * as omdb from '../omdb.js';
import { findByFrenchTitle, frenchTitles } from '../french.js';
import { resultCard } from './result-card.js';
import { advancedPanel } from './advanced.js';
import { openImport } from './import.js';

const DEBOUNCE_MS = 450;
const RATINGS_AT_ONCE = 4;
const NO_RESULT = 'Aucun résultat. Vérifie l’orthographe, ou colle le lien IMDb du titre.';

// Gardé entre deux affichages de l'onglet.
let last = { query: '', type: '', results: [], total: 0, page: 1, ratings: {}, frTitles: {} };

export function renderSearch(root) {
  const { apiKey } = store.getState();
  const list = h('ul.results');
  const status = h('p.status.muted', { role: 'status' });
  const more = h('button.btn.ghost.more', { type: 'button', hidden: true, onclick: () => run(last.page + 1) }, 'Plus de résultats');
  let timer = null;
  let token = 0;

  const drawList = () => {
    list.replaceChildren(...last.results.map((r) => resultCard(r, { ratings: last.ratings[r.id], frTitle: last.frTitles[r.id], onAdded: drawList })));
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

  /** Titres trouvés par leur nom français (Wikipédia), placés en tête s'ils manquent aux résultats OMDb. */
  async function addFrenchMatches(query, myToken) {
    try {
      const ids = await findByFrenchTitle(query, { limit: 4 });
      const fresh = ids.filter((id) => !last.results.some((r) => r.id === id));
      const fiches = (await Promise.all(fresh.map((id) => omdb.details(apiKey, id).catch(() => null))))
        .filter((f) => f && (!typeSel.value || f.type === typeSel.value));
      if (myToken !== token) return;
      if (!fiches.length) { if (!last.results.length) status.textContent = NO_RESULT; return; }
      const titles = await frenchTitles(fiches.map((f) => f.id));
      if (myToken !== token) return;
      last = {
        ...last,
        results: [...fiches.map(({ id, title, year, type, poster }) => ({ id, title, year, type, poster })), ...last.results],
        total: last.total + fiches.length,
        ratings: { ...last.ratings, ...Object.fromEntries(fiches.map((f) => [f.id, f.ratings])) },
        frTitles: { ...last.frTitles, ...titles },
      };
      status.textContent = `${last.total.toLocaleString('fr-FR')} résultat${last.total > 1 ? 's' : ''}`;
      drawList();
    } catch (err) {
      console.error('Recherche en français impossible', err);
      if (myToken === token && !last.results.length) status.textContent = NO_RESULT;
    }
  }

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
        : 'Recherche aussi en français…';
      drawList();
      loadRatings(results, myToken);
      frenchTitles(results.map((r) => r.id)).then((found) => {
        if (myToken !== token) return;
        last = { ...last, frTitles: { ...last.frTitles, ...found } };
        drawList();
      });
      if (page === 1) addFrenchMatches(query, myToken);
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
    advancedPanel(),
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
