// Recherche avancée : par personne (réalisation, acteur·rice, scénario), genre, pays, années, type,
// puis filtre sur les notes IMDb / Rotten Tomatoes et tri. Titres trouvés via Wikidata, notes via OMDb.
import { h, toast } from '../ui.js';
import * as store from '../store.js';
import * as omdb from '../omdb.js';
import { frenchTitles } from '../french.js';
import { advancedSearch, COUNTRIES, GENRES } from '../wikidata.js';
import { firstYear } from '../model.js';
import { resultCard } from './result-card.js';

const AT_ONCE = 4;
const SORTS = [['popular', 'Les plus connus'], ['imdb', 'Note IMDb'], ['rt', 'Rotten Tomatoes'], ['recent', 'Plus récents'], ['old', 'Plus anciens']];
const ROLES = [['any', 'n’importe quel rôle'], ['P57', 'à la réalisation'], ['P161', 'à l’affiche (acteur·rice)'], ['P58', 'au scénario']];

// Gardé entre deux affichages de l'onglet.
let saved = {
  criteria: { person: '', role: 'any', genre: '', country: '', type: '', from: '', to: '', minImdb: 0, minRt: 0, sort: 'popular' },
  rows: [], // [{ id, sitelinks, year }]
  fiches: {}, // id → fiche OMDb
  frTitles: {},
  open: false,
  searched: false,
};

function sortKey(sort, row, fiche) {
  if (sort === 'imdb') return -(fiche?.ratings.imdb ?? 0);
  if (sort === 'rt') return -(fiche?.ratings.rt ?? -1);
  if (sort === 'recent') return -(row.year ?? firstYear(fiche?.year) ?? 0);
  if (sort === 'old') return row.year ?? firstYear(fiche?.year) ?? 9999;
  return -row.sitelinks;
}

/** Ligne gardée si ses notes (connues) respectent les minimums ; tant qu'elles chargent, on la montre. */
function passes(c, fiche) {
  if (!fiche) return true;
  if (c.minImdb && !((fiche.ratings.imdb ?? 0) >= c.minImdb)) return false;
  if (c.minRt && !((fiche.ratings.rt ?? 0) >= c.minRt)) return false;
  return true;
}

function field(label, control) {
  return h('label.select', {}, h('span', {}, label), control);
}

const options = (list, value) => list.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l));

export function advancedPanel() {
  const c = saved.criteria;
  const list = h('ul.results');
  const status = h('p.status.muted', { role: 'status' });
  let token = 0;

  const draw = () => {
    const { criteria } = saved;
    const shown = saved.rows
      .filter((r) => passes(criteria, saved.fiches[r.id]))
      .sort((a, b) => sortKey(criteria.sort, a, saved.fiches[a.id]) - sortKey(criteria.sort, b, saved.fiches[b.id]));
    list.replaceChildren(...shown.map((r) => {
      const fiche = saved.fiches[r.id];
      const preview = fiche ?? { id: r.id, title: '…', year: r.year ? String(r.year) : null };
      return resultCard(preview, { ratings: fiche?.ratings, frTitle: saved.frTitles[r.id], onAdded: draw });
    }));
    if (saved.searched && !saved.rows.length) status.textContent = 'Aucun titre ne correspond. Élargis les critères.';
  };

  const set = (key) => (e) => { saved = { ...saved, criteria: { ...saved.criteria, [key]: e.target.value } }; };
  const setAndDraw = (key, cast = (v) => v) => (e) => {
    saved = { ...saved, criteria: { ...saved.criteria, [key]: cast(e.target.value) } };
    draw();
  };

  async function run(e) {
    e.preventDefault();
    const myToken = ++token;
    const { apiKey } = store.getState();
    status.textContent = 'Recherche dans Wikidata…';
    list.replaceChildren();
    try {
      const rows = await advancedSearch(saved.criteria);
      if (myToken !== token) return;
      saved = { ...saved, rows, fiches: {}, frTitles: {}, searched: true };
      status.textContent = rows.length ? `${rows.length} titre${rows.length > 1 ? 's' : ''} trouvé${rows.length > 1 ? 's' : ''} — chargement des notes…` : '';
      draw();
      frenchTitles(rows.map((r) => r.id)).then((fr) => {
        if (myToken !== token) return;
        saved = { ...saved, frTitles: fr };
        draw();
      });
      let done = 0;
      await omdb.pool(rows, AT_ONCE, (r) => omdb.details(apiKey, r.id), (i, res) => {
        if (myToken !== token) return;
        done += 1;
        if (res.ok) saved = { ...saved, fiches: { ...saved.fiches, [rows[i].id]: res.value } };
        else if (res.error.code === 'notfound') saved = { ...saved, rows: saved.rows.filter((r) => r.id !== rows[i].id) };
        if (done % 4 === 0 || done === rows.length) draw();
      });
      if (myToken !== token) return;
      const kept = saved.rows.filter((r) => passes(saved.criteria, saved.fiches[r.id])).length;
      status.textContent = `${kept} titre${kept > 1 ? 's' : ''}${kept < saved.rows.length ? ` (sur ${saved.rows.length}, filtrés par note)` : ''}`;
      draw();
    } catch (err) {
      if (myToken !== token) return;
      status.textContent = err.message;
      if (!/critère/.test(err.message)) toast('Wikidata ne répond pas, réessaie dans un instant', 'error');
    }
  }

  const form = h('form.adv-form', { onsubmit: run },
    h('div.adv-person', {},
      field('Personne', h('input', { type: 'search', value: c.person, placeholder: 'ex. Denis Villeneuve, Marion Cotillard', oninput: set('person'), autocomplete: 'off' })),
      field('Rôle', h('select', { onchange: set('role') }, options(ROLES, c.role)))),
    h('div.filter-grid', {},
      field('Genre', h('select', { onchange: set('genre') }, options(GENRES, c.genre))),
      field('Pays', h('select', { onchange: set('country') }, options(COUNTRIES, c.country))),
      field('Type', h('select', { onchange: set('type') }, options([['', 'Films et séries'], ['movie', 'Films'], ['series', 'Séries']], c.type))),
      field('De (année)', h('input', { type: 'text', inputMode: 'numeric', maxLength: 4, value: c.from, placeholder: '1990', oninput: set('from') })),
      field('À (année)', h('input', { type: 'text', inputMode: 'numeric', maxLength: 4, value: c.to, placeholder: '2026', oninput: set('to') })),
      field('IMDb minimum', h('select', { onchange: setAndDraw('minImdb', Number) }, options([[0, 'Peu importe'], [6, '6+'], [7, '7+'], [7.5, '7,5+'], [8, '8+']], c.minImdb))),
      field('Rotten Tomatoes min.', h('select', { onchange: setAndDraw('minRt', Number) }, options([[0, 'Peu importe'], [60, '60 % (frais)'], [75, '75 %'], [90, '90 %']], c.minRt))),
      field('Trier par', h('select', { onchange: setAndDraw('sort') }, options(SORTS, c.sort)))),
    h('button.btn.primary.wide', { type: 'submit' }, 'Lancer la recherche avancée'));

  const panel = h('details.advanced', { open: saved.open, ontoggle: (e) => { saved = { ...saved, open: e.target.open }; } },
    h('summary', {}, 'Recherche avancée', h('small', {}, ' — par réalisateur, acteur, genre, pays, années, notes')),
    form, status, list);
  if (saved.rows.length) draw();
  return panel;
}
