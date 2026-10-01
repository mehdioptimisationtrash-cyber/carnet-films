// Version française d'un titre : identifiant IMDb → article Wikipédia FR (via Wikidata) → titre français + synopsis.
// Aucun texte n'est traduit : le synopsis est celui rédigé sur Wikipédia.
import { cleanFrTitle, extractSynopsis } from './synopsis.js';
import { details, pool, resolve } from './omdb.js';
import { firstYear } from './model.js';
import * as store from './store.js';

const SPARQL = 'https://query.wikidata.org/sparql';
const WIKI_API = 'https://fr.wikipedia.org/w/api.php';
const TIMEOUT_MS = 12000;
const IDS_PER_QUERY = 40;
const THROTTLE_WAIT_MS = 3000;
const ARTICLES_AT_ONCE = 2;
const RETRY_MISSING_MS = 30 * 24 * 3600 * 1000; // un titre sans page FR est revérifié après 30 jours

const pageCache = new Map(); // imdbId → titre de page FR | null
const RETRY_FAILED_MS = 5 * 60 * 1000; // après une panne réseau, on réessaie 5 min plus tard
const failedAt = new Map(); // imdbId → date du dernier échec
const frCache = new Map(); // imdbId → { title, synopsis, intro, url, fetchedAt } | { missing: true, fetchedAt }

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET JSON ; si Wikipédia demande de ralentir (429), attend puis réessaie (2 fois au plus). */
async function getJson(url, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429 && attempt < 2) {
    await wait(THROTTLE_WAIT_MS * (attempt + 1));
    return getJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`Wikipédia a répondu ${res.status}`);
  return res.json();
}

/** Identifiants IMDb → titres des articles Wikipédia FR (une seule requête Wikidata par lot). */
export async function frenchPages(ids) {
  const unknown = [...new Set(ids)].filter((id) => /^tt\d+$/.test(id) && !pageCache.has(id));
  for (let i = 0; i < unknown.length; i += IDS_PER_QUERY) {
    const chunk = unknown.slice(i, i + IDS_PER_QUERY);
    const query = `SELECT ?imdb ?article WHERE { VALUES ?imdb { ${chunk.map((id) => `"${id}"`).join(' ')} }
      ?item wdt:P345 ?imdb . ?article schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> . }`;
    const data = await getJson(`${SPARQL}?format=json&query=${encodeURIComponent(query)}`);
    chunk.forEach((id) => pageCache.set(id, null));
    for (const b of data?.results?.bindings ?? []) {
      const page = decodeURIComponent(b.article.value.split('/wiki/')[1] ?? '').replace(/_/g, ' ');
      if (page) pageCache.set(b.imdb.value, page);
    }
  }
  return new Map(ids.map((id) => [id, pageCache.get(id) ?? null]));
}

/** Titre français seul (pour les listes de résultats) : { imdbId → titre } ; silencieux en cas d'échec. */
export async function frenchTitles(ids) {
  try {
    const pages = await frenchPages(ids);
    return Object.fromEntries([...pages].filter(([, p]) => p).map(([id, p]) => [id, cleanFrTitle(p)]));
  } catch {
    return {};
  }
}

/** Fiche française complète d'un titre. Lève une erreur seulement si le réseau échoue. */
export async function fetchFrench(id) {
  if (frCache.has(id)) return frCache.get(id);
  const page = (await frenchPages([id])).get(id);
  let fr = { missing: true, fetchedAt: Date.now() };
  if (page) {
    const params = new URLSearchParams({
      action: 'query', prop: 'extracts', explaintext: '1', exsectionformat: 'wiki', redirects: '1',
      titles: page, format: 'json', formatversion: '2', origin: '*',
    });
    const data = await getJson(`${WIKI_API}?${params}`);
    const article = data?.query?.pages?.[0];
    const { synopsis, intro } = extractSynopsis(article?.extract ?? '');
    const finalTitle = article?.title ?? page;
    fr = {
      title: cleanFrTitle(finalTitle),
      synopsis,
      intro,
      url: `https://fr.wikipedia.org/wiki/${encodeURIComponent(finalTitle.replace(/ /g, '_'))}`,
      fetchedAt: Date.now(),
    };
  }
  frCache.set(id, fr);
  return fr;
}

/**
 * Titre français (« Le Parrain », « Les Évadés ») → identifiants IMDb, du plus pertinent au moins pertinent.
 * Recherche dans Wikipédia FR, puis Wikidata donne l'identifiant IMDb de chaque article trouvé.
 */
export async function findByFrenchTitle(query, { year = null, limit = 4 } = {}) {
  const params = new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: [query, year].filter(Boolean).join(' '), gsrlimit: '8',
    gsrnamespace: '0', prop: 'pageprops', ppprop: 'wikibase_item', format: 'json', formatversion: '2', origin: '*',
  });
  const data = await getJson(`${WIKI_API}?${params}`);
  const pages = [...(data?.query?.pages ?? [])].sort((a, b) => a.index - b.index);
  const items = pages.map((p) => p.pageprops?.wikibase_item).filter((q) => /^Q\d+$/.test(q ?? ''));
  if (!items.length) return [];
  const sparql = `SELECT ?item ?imdb WHERE { VALUES ?item { ${items.map((q) => `wd:${q}`).join(' ')} }
    ?item wdt:P345 ?imdb . FILTER(STRSTARTS(?imdb, "tt")) }`;
  const res = await getJson(`${SPARQL}?format=json&query=${encodeURIComponent(sparql)}`);
  const byItem = new Map((res?.results?.bindings ?? []).map((b) => [b.item.value.split('/').pop(), b.imdb.value]));
  pages.forEach((p) => { const id = byItem.get(p.pageprops?.wikibase_item); if (id && !pageCache.has(id)) pageCache.set(id, p.title); });
  // Titre identique à la recherche d'abord (« Le Parrain (film) » avant « Le Parrain, 3e partie »).
  const norm = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const exact = (p) => norm(cleanFrTitle(p.title)) === norm(query);
  const ranked = [...pages.filter(exact), ...pages.filter((p) => !exact(p))];
  return [...new Set(ranked.map((p) => byItem.get(p.pageprops?.wikibase_item)).filter(Boolean))].slice(0, limit);
}

/**
 * Ligne de liste → fiche OMDb. Titre original d'abord (OMDb), sinon titre français via Wikipédia.
 * Les erreurs de clé / limite OMDb remontent ; une panne Wikipédia donne simplement « introuvable ».
 */
export async function resolveAnyTitle(key, item) {
  const found = await resolve(key, item);
  if (found || !item.query) return found;
  let ids = [];
  try {
    ids = await findByFrenchTitle(item.query, { year: item.year, limit: 3 });
  } catch (err) {
    console.error('Recherche Wikipédia impossible', err);
    return null;
  }
  const fiches = [];
  for (const id of ids) {
    try {
      const fiche = await details(key, id);
      if (!item.year || firstYear(fiche.year) === item.year) return fiche;
      fiches.push(fiche);
    } catch (err) {
      if (err.code !== 'notfound') throw err;
    }
  }
  return fiches[0] ?? null;
}

const needsFrench = (t) => !t.fr || (t.fr.missing && Date.now() - t.fr.fetchedAt > RETRY_MISSING_MS);

/** Complète en arrière-plan les titres du carnet qui n'ont pas encore leur version française. */
export async function enrichCarnet(ids = store.getState().titles.map((t) => t.id)) {
  const recentlyFailed = (id) => Date.now() - (failedAt.get(id) ?? 0) < RETRY_FAILED_MS;
  const todo = ids.map(store.findTitle).filter((t) => t && needsFrench(t) && !recentlyFailed(t.id)).map((t) => t.id);
  if (!todo.length) return;
  try {
    await frenchPages(todo); // un seul appel Wikidata pour tout le lot
  } catch (err) {
    console.error('Wikidata indisponible', err);
    todo.forEach((id) => failedAt.set(id, Date.now()));
    return;
  }
  await pool(todo, ARTICLES_AT_ONCE, fetchFrench, (i, res) => {
    if (!res.ok) { failedAt.set(todo[i], Date.now()); return; }
    if (store.findTitle(todo[i])) store.patchTitle(todo[i], { fr: res.value }, { background: true });
  });
}

export { needsFrench };
