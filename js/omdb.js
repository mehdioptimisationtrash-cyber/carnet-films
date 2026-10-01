// Accès à OMDb (www.omdbapi.com) : recherche, fiche complète avec notes IMDb / Rotten Tomatoes / Metacritic.
import { fromOmdb, fromSearchResult } from './model.js';

const BASE = 'https://www.omdbapi.com/';
const TIMEOUT_MS = 12000;
const detailCache = new Map(); // id → fiche (le temps de la session)

export class OmdbError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code; // 'key' | 'limit' | 'notfound' | 'network'
  }
}

function explain(error) {
  const text = String(error ?? '');
  if (/invalid api key|no api key/i.test(text)) return new OmdbError('Clé OMDb refusée — vérifie-la dans Réglages.', 'key');
  if (/limit/i.test(text)) return new OmdbError('Limite du jour atteinte (1 000 demandes). Réessaie demain.', 'limit');
  if (/not found/i.test(text)) return new OmdbError('Aucun titre trouvé.', 'notfound');
  return new OmdbError(text || 'Réponse inattendue d’OMDb.', 'network');
}

async function call(key, params) {
  if (!key) throw new OmdbError('Ajoute ta clé OMDb dans Réglages.', 'key');
  const url = new URL(BASE);
  url.search = new URLSearchParams({ apikey: key, ...params }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    throw new OmdbError(navigator.onLine === false ? 'Pas de connexion internet.' : 'OMDb ne répond pas, réessaie.', 'network');
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new OmdbError(`OMDb a répondu une erreur (${res.status}).`, 'network');
  if (data.Response === 'False') throw explain(data.Error);
  return data;
}

/** Recherche par titre : { results, total }. type : '' | 'movie' | 'series'. */
export async function search(key, query, { type = '', page = 1 } = {}) {
  try {
    const data = await call(key, { s: query, page: String(page), ...(type ? { type } : {}) });
    return { results: (data.Search ?? []).map(fromSearchResult), total: Number(data.totalResults) || 0 };
  } catch (err) {
    if (err.code === 'notfound' || /too many results/i.test(err.message)) return { results: [], total: 0 };
    throw err;
  }
}

/** Fiche complète par identifiant IMDb (tt…). `fresh` ignore le cache de session. */
export async function details(key, id, { fresh = false } = {}) {
  if (!fresh && detailCache.has(id)) return detailCache.get(id);
  const data = await call(key, { i: id, plot: 'full' });
  const title = fromOmdb(data);
  detailCache.set(id, title);
  return title;
}

/**
 * Trouve le meilleur titre pour une ligne de liste ({ query, year, imdbId }).
 * Essaie d'abord la correspondance exacte d'OMDb, puis la recherche, puis sans l'année.
 */
export async function resolve(key, item) {
  if (item.imdbId) return details(key, item.imdbId);
  const attempts = [
    { t: item.query, ...(item.year ? { y: String(item.year) } : {}) },
    ...(item.year ? [{ t: item.query }] : []),
  ];
  for (const params of attempts) {
    try {
      const data = await call(key, { ...params, plot: 'full' });
      const title = fromOmdb(data);
      detailCache.set(title.id, title);
      return title;
    } catch (err) {
      if (err.code !== 'notfound') throw err;
    }
  }
  const { results } = await search(key, item.query);
  const best = results.find((r) => !item.year || String(r.year).startsWith(String(item.year))) ?? results[0];
  return best ? details(key, best.id) : null;
}

/** Vérifie une clé avec une demande connue. */
export async function checkKey(key) {
  await call(key, { i: 'tt0111161' });
  return true;
}

/** Exécute `task` sur chaque élément, `limit` à la fois, en appelant `onEach(index, result)`. */
export async function pool(items, limit, task, onEach) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        onEach(index, { ok: true, value: await task(items[index], index) });
      } catch (error) {
        onEach(index, { ok: false, error });
        if (error.code === 'key' || error.code === 'limit') next = items.length; // inutile de continuer
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
