// Requêtes Wikidata : traits des titres (pour les goûts), candidats aux suggestions, recherche avancée.
import { getJson } from './french.js';
import { ROLES } from './taste.js';

const SPARQL = 'https://query.wikidata.org/sparql';
const IDS_PER_QUERY = 25;
const FEATURES_KEY = 'carnet-films:features';
const MAX_CACHED = 800;
const PROPS = Object.keys(ROLES);

const SPARQL_TIMEOUT_MS = 30000; // les recherches larges (genre + pays) prennent parfois 10 s
const sparql = async (query) => (await getJson(`${SPARQL}?format=json&query=${encodeURIComponent(query)}`, 0, SPARQL_TIMEOUT_MS))?.results?.bindings ?? [];
const qid = (uri) => String(uri ?? '').split('/').pop();
const safeQ = (q) => (/^Q\d+$/.test(q) ? q : null);
const safeP = (p) => (PROPS.includes(p) ? p : null);
const safeTt = (id) => (/^tt\d+$/.test(id) ? id : null);

// Les traits changent rarement : gardés sur l'appareil pour ne pas reposer la question à chaque fois.
const featureCache = (() => {
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(FEATURES_KEY)) ?? {})); } catch { return new Map(); }
})();
function saveCache() {
  try {
    const entries = [...featureCache].slice(-MAX_CACHED);
    localStorage.setItem(FEATURES_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* stockage plein : le cache sert seulement à aller plus vite */ }
}

/** Traits Wikidata de chaque titre : { tt… → [{ prop, qid, label }] } (tableau vide si le titre est inconnu de Wikidata). */
export async function fetchFeatures(ids) {
  const todo = [...new Set(ids.map(safeTt).filter(Boolean))].filter((id) => !featureCache.has(id));
  for (let i = 0; i < todo.length; i += IDS_PER_QUERY) {
    const chunk = todo.slice(i, i + IDS_PER_QUERY);
    const rows = await sparql(`SELECT ?imdb ?prop ?val ?valLabel WHERE {
      VALUES ?imdb { ${chunk.map((id) => `"${id}"`).join(' ')} }
      ?item wdt:P345 ?imdb .
      VALUES ?prop { ${PROPS.map((p) => `wdt:${p}`).join(' ')} }
      ?item ?prop ?val . FILTER(isIRI(?val))
      SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
    }`);
    const found = Object.fromEntries(chunk.map((id) => [id, []]));
    for (const b of rows) {
      const f = { prop: qid(b.prop.value), qid: qid(b.val.value), label: b.valLabel?.value ?? '' };
      if (safeP(f.prop) && safeQ(f.qid)) found[b.imdb.value]?.push(f);
    }
    Object.entries(found).forEach(([id, list]) => featureCache.set(id, list));
    saveCache();
  }
  return Object.fromEntries(ids.map((id) => [id, featureCache.get(id) ?? []]));
}

const GENRES_FOR_QUERY = 5;

/**
 * Titres qui partagent des traits avec le profil. features = [{ prop, qid, weight }].
 * Deux requêtes légères : les traits précis (personnes, thèmes, sagas) et les combinaisons d'au moins deux genres
 * aimés (les genres ou pays seuls renverraient des dizaines de milliers de titres).
 * Renvoie [{ id, sitelinks, hits: ['P57=Q25191', …] }].
 */
export async function fetchCandidates(features) {
  const specific = features.filter((f) => f.prop !== 'P136' && f.prop !== 'P495');
  const genres = features.filter((f) => f.prop === 'P136' && f.weight > 0).slice(0, GENRES_FOR_QUERY);
  const [byPeople, byGenres] = await Promise.all([candidatesByTraits(specific), candidatesByGenres(genres)]);
  const merged = new Map();
  for (const c of [...byPeople, ...byGenres]) {
    const known = merged.get(c.id);
    merged.set(c.id, known
      ? { ...known, sitelinks: Math.max(known.sitelinks, c.sitelinks), hits: [...new Set([...known.hits, ...c.hits])] }
      : c);
  }
  return [...merged.values()];
}

async function candidatesByGenres(genres) {
  const ids = genres.map((f) => safeQ(f.qid)).filter(Boolean);
  if (!ids.length) return [];
  const rows = await sparql(`SELECT ?imdb (MAX(?sl0) AS ?sl) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?g), "entity/"); separator="|") AS ?hits) WHERE {
    VALUES ?g { ${ids.map((q) => `wd:${q}`).join(' ')} }
    ?item wdt:P136 ?g . ?item wikibase:sitelinks ?sl0 . FILTER(?sl0 >= 40)
    ?item wdt:P345 ?imdb . FILTER(STRSTARTS(?imdb, "tt"))
  } GROUP BY ?imdb HAVING(COUNT(DISTINCT ?g) >= ${ids.length > 1 ? 2 : 1}) ORDER BY DESC(?sl) LIMIT 150`);
  return rows.map((b) => ({
    id: b.imdb.value, sitelinks: Number(b.sl?.value) || 0, hits: String(b.hits?.value ?? '').split('|').filter(Boolean).map((q) => `P136=${q}`),
  })).filter((c) => safeTt(c.id));
}

async function candidatesByTraits(features, limit = 300) {
  const pairs = features.map((f) => [safeP(f.prop), safeQ(f.qid)]).filter(([p, q]) => p && q);
  if (!pairs.length) return [];
  const rows = await sparql(`SELECT ?imdb (MAX(?sl0) AS ?sl)
      (GROUP_CONCAT(DISTINCT CONCAT(STRAFTER(STR(?p), "direct/"), "=", STRAFTER(STR(?v), "entity/")); separator="|") AS ?hits) WHERE {
    VALUES (?p ?v) { ${pairs.map(([p, q]) => `(wdt:${p} wd:${q})`).join(' ')} }
    ?item ?p ?v .
    ?item wdt:P345 ?imdb . FILTER(STRSTARTS(?imdb, "tt"))
    ?item wikibase:sitelinks ?sl0 . FILTER(?sl0 >= 8)
    FILTER NOT EXISTS { ?item wdt:P31 wd:Q21191270 }
  } GROUP BY ?imdb ORDER BY DESC(COUNT(DISTINCT ?v)) DESC(?sl) LIMIT ${Number(limit) || 300}`);
  return rows.map((b) => ({ id: b.imdb.value, sitelinks: Number(b.sl?.value) || 0, hits: String(b.hits?.value ?? '').split('|').filter(Boolean) }))
    .filter((c) => safeTt(c.id));
}

// ——— Recherche avancée ———

export const GENRES = [
  ['', 'Tous les genres'],
  ['Q188473', 'Action'], ['Q319221', 'Aventure'], ['Q202866', 'Animation'], ['Q645928', 'Biopic'],
  ['Q157443', 'Comédie'], ['Q859369', 'Comédie dramatique'], ['Q93204', 'Documentaire'], ['Q130232,Q1366112', 'Drame'],
  ['Q157394', 'Fantasy'], ['Q369747', 'Guerre'], ['Q17013749', 'Historique'], ['Q200092', 'Horreur'],
  ['Q1200678', 'Mystère / énigme'], ['Q959790,Q5937792', 'Policier'], ['Q1054574', 'Romance'],
  ['Q471839,Q24925', 'Science-fiction'], ['Q1535153', 'Super-héros'], ['Q2484376', 'Thriller'], ['Q172980', 'Western'],
];
export const COUNTRIES = [
  ['', 'Tous les pays'], ['Q142', 'France'], ['Q30', 'États-Unis'], ['Q145', 'Royaume-Uni'], ['Q16', 'Canada'],
  ['Q31', 'Belgique'], ['Q38', 'Italie'], ['Q29', 'Espagne'], ['Q183', 'Allemagne'], ['Q35', 'Danemark'], ['Q34', 'Suède'],
  ['Q17', 'Japon'], ['Q884', 'Corée du Sud'], ['Q148', 'Chine'], ['Q668', 'Inde'], ['Q96', 'Mexique'],
];
const KINDS = {
  movie: ['Q11424', 'Q24869', 'Q202866', 'Q506240', 'Q93204'],
  series: ['Q5398426', 'Q1259759', 'Q581714', 'Q526877', 'Q15416'],
};

const escapeLiteral = (s) => String(s).replace(/[\\"]/g, ' ').replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
const year = (y) => (Number.isInteger(Number(y)) && Number(y) > 1880 && Number(y) < 2100 ? Number(y) : null);

/**
 * criteria : { person, role: 'any'|'P57'|'P161'|'P58', genre: 'Q…,Q…', country, type: ''|'movie'|'series', from, to }.
 * Renvoie [{ id, sitelinks, year }] (au plus 80), les plus connus d'abord.
 */
export async function advancedSearch(criteria) {
  const { person = '', role = 'any', genre = '', country = '', type = '', from = '', to = '' } = criteria;
  const lines = [];
  if (person.trim()) {
    const roles = role === 'any' ? ['P57', 'P161', 'P58', 'P170'] : [safeP(role) ?? 'P161'];
    lines.push(`SERVICE wikibase:mwapi { bd:serviceParam wikibase:api "EntitySearch"; wikibase:endpoint "www.wikidata.org";
        mwapi:search "${escapeLiteral(person)}"; mwapi:language "fr". ?person wikibase:apiOutputItem mwapi:item. }
      ?person wdt:P31 wd:Q5 .`);
    lines.push(roles.map((p) => `{ ?item wdt:${p} ?person }`).join(' UNION '));
  }
  const genres = genre.split(',').map(safeQ).filter(Boolean);
  if (genres.length) lines.push(`VALUES ?genre { ${genres.map((q) => `wd:${q}`).join(' ')} } ?item wdt:P136 ?genre .`);
  if (safeQ(country)) lines.push(`?item wdt:P495 wd:${country} .`);
  if (KINDS[type]) lines.push(`VALUES ?kind { ${KINDS[type].map((q) => `wd:${q}`).join(' ')} } ?item wdt:P31 ?kind .`);
  const y1 = year(from);
  const y2 = year(to);
  if (y1 || y2) {
    lines.push('?item wdt:P577 ?date . BIND(YEAR(?date) AS ?y)');
    lines.push(`FILTER(${[y1 ? `?y >= ${y1}` : null, y2 ? `?y <= ${y2}` : null].filter(Boolean).join(' && ')})`);
  }
  if (!lines.length) throw new Error('Choisis au moins un critère (personne, genre, pays ou années).');
  const rows = await sparql(`SELECT ?imdb (MAX(?sl0) AS ?sl) (MIN(?y0) AS ?year) WHERE {
    ${lines.join('\n    ')}
    ?item wdt:P345 ?imdb . FILTER(STRSTARTS(?imdb, "tt"))
    ?item wikibase:sitelinks ?sl0 .
    FILTER NOT EXISTS { ?item wdt:P31 wd:Q21191270 }
    OPTIONAL { ?item wdt:P577 ?d0 . BIND(YEAR(?d0) AS ?y0) }
  } GROUP BY ?imdb ORDER BY DESC(?sl) LIMIT 80`);
  return rows.map((b) => ({ id: b.imdb.value, sitelinks: Number(b.sl?.value) || 0, year: Number(b.year?.value) || null }))
    .filter((r) => safeTt(r.id));
}
