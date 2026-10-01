// Fonctions pures (testées) : lecture d'une liste collée, conversion des fiches OMDb, tri et filtres du carnet.

const NA = 'N/A';

const GENRES_FR = {
  Action: 'Action', Adventure: 'Aventure', Animation: 'Animation', Biography: 'Biopic', Comedy: 'Comédie',
  Crime: 'Policier', Documentary: 'Documentaire', Drama: 'Drame', Family: 'Famille', Fantasy: 'Fantastique',
  'Film-Noir': 'Film noir', History: 'Histoire', Horror: 'Horreur', Music: 'Musique', Musical: 'Comédie musicale',
  Mystery: 'Mystère', Romance: 'Romance', 'Sci-Fi': 'Science-fiction', Short: 'Court métrage', Sport: 'Sport',
  Thriller: 'Thriller', War: 'Guerre', Western: 'Western', 'Reality-TV': 'Téléréalité', 'Talk-Show': 'Talk-show',
  News: 'Actualités', 'Game-Show': 'Jeu télévisé', Adult: 'Adulte',
};

export const TYPE_LABELS = { movie: 'Film', series: 'Série', episode: 'Épisode', game: 'Jeu' };

const clean = (value) => (value == null || value === NA || value === '' ? null : String(value).trim());

/** « 8.8/10 » → 8.8 ; « 87% » → 87 ; « 74/100 » → 74. */
function parseScore(value) {
  const text = clean(value);
  if (!text) return null;
  const n = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseMinutes(runtime) {
  const text = clean(runtime);
  if (!text) return null;
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? n : null;
}

const parseVotes = (votes) => {
  const text = clean(votes);
  if (!text) return null;
  const n = Number.parseInt(text.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

export const translateGenre = (genre) => GENRES_FR[genre] ?? genre;

/** Première année d'un champ OMDb (« 2008–2013 » → 2008). */
export const firstYear = (year) => {
  const m = String(year ?? '').match(/\d{4}/);
  return m ? Number(m[0]) : null;
};

/** Résultat de recherche OMDb (liste) → aperçu. */
export function fromSearchResult(r) {
  return {
    id: r.imdbID,
    title: clean(r.Title) ?? 'Sans titre',
    year: clean(r.Year),
    type: r.Type,
    poster: clean(r.Poster),
  };
}

/** Fiche complète OMDb → titre du carnet (sans les champs personnels). */
export function fromOmdb(d, now = Date.now()) {
  const sources = Object.fromEntries((d.Ratings ?? []).map((r) => [r.Source, r.Value]));
  return {
    id: d.imdbID,
    title: clean(d.Title) ?? 'Sans titre',
    year: clean(d.Year),
    type: d.Type,
    poster: clean(d.Poster),
    genres: (clean(d.Genre) ?? '').split(',').map((g) => g.trim()).filter(Boolean),
    runtime: parseMinutes(d.Runtime),
    seasons: parseScore(d.totalSeasons),
    director: clean(d.Director),
    writer: clean(d.Writer),
    actors: clean(d.Actors),
    plot: clean(d.Plot),
    country: clean(d.Country),
    language: clean(d.Language),
    rated: clean(d.Rated),
    awards: clean(d.Awards),
    ratings: {
      imdb: parseScore(d.imdbRating) ?? parseScore(sources['Internet Movie Database']),
      imdbVotes: parseVotes(d.imdbVotes),
      rt: parseScore(sources['Rotten Tomatoes']),
      mc: parseScore(d.Metascore) ?? parseScore(sources.Metacritic),
    },
    fetchedAt: now,
  };
}

const IMDB_ID = /\b(tt\d{6,10})\b/;

/**
 * Une ligne collée → { raw, query, year, imdbId } ou null si la ligne est vide / un commentaire.
 * Accepte : « Inception », « Inception (2010) », « Inception - 2010 », « 1. Inception », « tt1375666 », lien IMDb.
 */
export function parseLine(line) {
  const raw = String(line ?? '').trim();
  if (!raw || raw.startsWith('#')) return null;
  const id = raw.match(IMDB_ID);
  if (id) return { raw, query: null, year: null, imdbId: id[1] };
  let text = raw
    .replace(/^\s*(?:[-*•–—>]+|\d{1,3}[.)]|\[[ xX]?\])\s*/, '') // puces, numéros, cases à cocher
    .replace(/\s+/g, ' ')
    .trim();
  let year = null;
  const yearMatch = text.match(/^(.*?)[\s,;:–—-]*[([]?\s*((?:19|20)\d{2})\s*[)\]]?\s*$/);
  if (yearMatch && yearMatch[1].trim()) {
    year = Number(yearMatch[2]);
    text = yearMatch[1].trim();
  }
  text = text.replace(/[\s,;:–—-]+$/, '').trim();
  if (!text) return null;
  return { raw, query: text, year, imdbId: null };
}

/** Texte collé → lignes reconnues, doublons retirés. */
export function parseList(text) {
  const seen = new Set();
  return String(text ?? '')
    .split(/\r?\n/)
    .map(parseLine)
    .filter(Boolean)
    .filter((item) => {
      const key = item.imdbId ?? `${item.query.toLowerCase()}|${item.year ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// ——— Carnet : filtres, tri, statistiques ———

const NULL_LAST = (a, b, dir) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir * (a < b ? -1 : a > b ? 1 : 0);
};

export const SORTS = {
  added: { label: 'Ajout récent', key: (t) => t.addedAt, dir: -1 },
  priority: { label: 'Priorité', key: (t) => (t.priority ? 1 : 0), dir: -1, then: 'added' },
  imdb: { label: 'Note IMDb', key: (t) => t.ratings?.imdb, dir: -1 },
  rt: { label: 'Rotten Tomatoes', key: (t) => t.ratings?.rt, dir: -1 },
  mc: { label: 'Metacritic', key: (t) => t.ratings?.mc, dir: -1 },
  mine: { label: 'Ma note', key: (t) => t.myRating, dir: -1 },
  year: { label: 'Année (récent)', key: (t) => firstYear(t.year), dir: -1 },
  runtime: { label: 'Durée (court)', key: (t) => t.runtime, dir: 1 },
  title: { label: 'Titre (A→Z)', key: (t) => t.title?.toLocaleLowerCase('fr'), dir: 1 },
};

export function sortTitles(titles, sortKey = 'added') {
  const sort = SORTS[sortKey] ?? SORTS.added;
  const then = sort.then ? SORTS[sort.then] : SORTS.title;
  return [...titles].sort((a, b) =>
    NULL_LAST(sort.key(a), sort.key(b), sort.dir) || NULL_LAST(then.key(a), then.key(b), then.dir));
}

const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** filters : { status: 'todo'|'watched'|'all', type: 'all'|'movie'|'series', genre, text, minImdb, minRt } */
export function filterTitles(titles, filters = {}) {
  const { status = 'all', type = 'all', genre = '', text = '', minImdb = 0, minRt = 0 } = filters;
  const needle = normalize(text.trim());
  return titles.filter((t) => {
    if (status !== 'all' && t.status !== status) return false;
    if (type !== 'all' && t.type !== type) return false;
    if (genre && !(t.genres ?? []).includes(genre)) return false;
    if (minImdb && !((t.ratings?.imdb ?? 0) >= minImdb)) return false;
    if (minRt && !((t.ratings?.rt ?? 0) >= minRt)) return false;
    if (needle) {
      const hay = normalize([t.title, t.director, t.actors, t.note, ...(t.genres ?? []).map(translateGenre)].join(' '));
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export function allGenres(titles) {
  const set = new Set(titles.flatMap((t) => t.genres ?? []));
  return [...set].sort((a, b) => translateGenre(a).localeCompare(translateGenre(b), 'fr'));
}

/** Temps de visionnage estimé (films seulement, les séries n'ont qu'une durée d'épisode). */
export function stats(titles) {
  const todo = titles.filter((t) => t.status === 'todo');
  const minutes = todo.filter((t) => t.type === 'movie').reduce((sum, t) => sum + (t.runtime ?? 0), 0);
  return {
    total: titles.length,
    todo: todo.length,
    watched: titles.length - todo.length,
    movieMinutes: minutes,
  };
}

export function formatRuntime(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/** Couleur Rotten Tomatoes : « frais » à partir de 60 %. */
export const rtState = (score) => (score == null ? null : score >= 60 ? 'fresh' : 'rotten');

/** Affiche plus nette : les liens Amazon acceptent une largeur (`SX300` par défaut). */
export function posterUrl(url, width = 300) {
  if (!url) return null;
  return url.replace(/\._V1_.*?(\.\w+)$/, `._V1_SX${width}$1`);
}
