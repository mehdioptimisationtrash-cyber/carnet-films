// Suggestions sur mesure : profil de goûts (notes, coups de cœur, refus) → candidats Wikidata → fiches OMDb → classement.
import { displayTitle } from './model.js';
import * as omdb from './omdb.js';
import { frenchTitles } from './french.js';
import { fetchCandidates, fetchFeatures } from './wikidata.js';
import {
  affinity, buildProfile, commonLinks, diversify, explain, favouriteDecades, finalScore, genreAffinity, genreWeights,
  itemWeight, queryFeatures, usefulFeatures,
} from './taste.js';

export const MIN_LOVED = 3;
const SHORTLIST = 45; // fiches OMDb chargées pour le classement final
const DETAILS_AT_ONCE = 4;
const MIN_IMDB = 5.8; // en dessous, même un titre très « lié » n'est pas proposé

export const lovedTitles = (state) => state.titles.filter((t) => t.myRating >= 4);

/** Profil de goûts et liens entre les coups de cœur. */
export async function analyse(state) {
  const dismissed = new Set(state.dismissed ?? []);
  const inCarnet = new Set(state.titles.map((t) => t.id));
  const signals = [
    ...state.titles.map((t) => ({ t, weight: itemWeight(t, dismissed) })),
    ...[...dismissed].filter((id) => !inCarnet.has(id)).map((id) => ({ t: { id, title: id }, weight: -1 })),
  ].filter((s) => s.weight);
  const features = await fetchFeatures(signals.map((s) => s.t.id));
  const profile = buildProfile(signals.map(({ t, weight }) => ({
    title: displayTitle(t), weight, features: usefulFeatures(features[t.id] ?? [], { type: t.type, actors: t.actors }),
  })));
  const loved = lovedTitles(state);
  return {
    profile,
    links: commonLinks(profile),
    decades: favouriteDecades(loved),
    genres: genreWeights(state.titles.filter((t) => t.myRating || t.status === 'watched'), (t) => itemWeight(t, dismissed)),
    lovedCount: loved.length,
    unknown: loved.filter((t) => !(features[t.id] ?? []).length).map(displayTitle), // absents de Wikidata
  };
}

/**
 * Suggestions classées : [{ fiche, score, reasons, why: [phrases] }].
 * type : '' | 'movie' | 'series'. onProgress(texte) pour l'affichage.
 */
export async function suggest(analysis, state, { type = '', count = 24, onProgress = () => {} } = {}) {
  onProgress('Recherche de titres liés à tes goûts…');
  const exclude = new Set([...state.titles.map((t) => t.id), ...(state.dismissed ?? [])]);
  const candidates = await fetchCandidates(queryFeatures(analysis.profile));
  const shortlist = candidates
    .filter((c) => !exclude.has(c.id))
    .map((c) => ({ ...c, ...affinity(c.hits, analysis.profile, c.sitelinks) }))
    .filter((c) => c.reasons.length && c.affinity > 0)
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, SHORTLIST);

  const fiches = new Map();
  let done = 0;
  await omdb.pool(shortlist, DETAILS_AT_ONCE, (c) => omdb.details(state.apiKey, c.id), (i, res) => {
    done += 1;
    onProgress(`Notes IMDb et Rotten Tomatoes… ${done}/${shortlist.length}`);
    if (res.ok) fiches.set(shortlist[i].id, res.value);
  });
  const ranked = shortlist
    .filter((c) => fiches.has(c.id))
    .map((c) => ({ ...c, fiche: fiches.get(c.id) }))
    .filter(({ fiche }) => (fiche.type === 'movie' || fiche.type === 'series') && (!type || fiche.type === type))
    .filter(({ fiche }) => fiche.ratings.imdb == null || fiche.ratings.imdb >= MIN_IMDB)
    .map((c) => ({ ...c, score: finalScore(c.affinity, c.fiche.ratings, genreAffinity(c.fiche.genres, analysis.genres)) }))
    .sort((a, b) => b.score - a.score);
  const picked = diversify(ranked).slice(0, count);
  const fr = await frenchTitles(picked.map((c) => c.fiche.id));
  return picked.map((c) => ({
    fiche: fr[c.fiche.id] ? { ...c.fiche, frTitle: fr[c.fiche.id] } : c.fiche,
    score: c.score,
    reasons: c.reasons,
    why: explain(c.reasons),
  }));
}
