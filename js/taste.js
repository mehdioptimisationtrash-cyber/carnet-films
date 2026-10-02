// Fonctions pures (testées) du moteur de goûts : profil appris des notes, liens entre coups de cœur, score des suggestions.
// Les « traits » d'un titre viennent de Wikidata : réalisation, création, scénario, acteurs principaux, musique, thèmes, genres…

/** Poids de chaque type de lien : un même réalisateur compte plus qu'un même pays. */
export const ROLES = {
  P57: { weight: 3, label: 'Réalisation' },
  P170: { weight: 3, label: 'Création' },
  P58: { weight: 2, label: 'Scénario' },
  P144: { weight: 1.5, label: 'D’après' },
  P161: { weight: 1.2, label: 'Avec' },
  P921: { weight: 1.2, label: 'Thème' },
  P179: { weight: 1, label: 'Série / saga' },
  P86: { weight: 0.8, label: 'Musique' },
  P344: { weight: 0.5, label: 'Image' },
  P136: { weight: 0.6, label: 'Genre' },
  P495: { weight: 0.2, label: 'Pays' },
};

const MAX_WRITERS = 4; // au-delà (séries), les scénaristes ne disent plus rien des goûts
const STAR_WEIGHTS = { 5: 2, 4: 1, 3: 0.2, 2: -1, 1: -2 };

/** Ce qu'un titre dit de mes goûts : adoré = +2, aimé = +1, bof = négatif, écarté des suggestions = -1. */
export function itemWeight(t, dismissed = new Set()) {
  if (dismissed.has(t.id)) return -1;
  if (t.myRating) return STAR_WEIGHTS[t.myRating] ?? 0;
  return t.status === 'watched' ? 0.4 : 0.1; // vu sans note ; simplement mis de côté « à voir » (signal faible)
}

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Nettoie les traits bruts d'un titre : acteurs principaux seulement (ceux cités par OMDb),
 * pas de réalisateurs d'épisodes pour une série, pas de longue liste de scénaristes.
 */
export function usefulFeatures(features, { type, actors } = {}) {
  const main = new Set(String(actors ?? '').split(',').map(norm).filter(Boolean));
  const writers = features.filter((f) => f.prop === 'P58').length;
  return features.filter((f) => {
    if (!ROLES[f.prop]) return false;
    if (f.prop === 'P57' && type === 'series') return false;
    if (f.prop === 'P58' && writers > MAX_WRITERS) return false;
    if (f.prop === 'P161') return main.has(norm(f.label));
    return !/^Q\d+$/.test(f.label ?? ''); // libellé manquant : inutilisable pour expliquer
  });
}

export const featureKey = (f) => `${f.prop}=${f.qid}`;

/**
 * Profil : pour chaque trait, somme des poids des titres qui l'ont.
 * items = [{ title, weight, features }]. Renvoie Map clé → { key, prop, qid, label, weight, liked: [titres], disliked: [titres] }.
 */
export function buildProfile(items) {
  const profile = new Map();
  for (const { title, weight, features } of items) {
    if (!weight) continue;
    for (const f of features) {
      const key = featureKey(f);
      const entry = profile.get(key) ?? { key, prop: f.prop, qid: f.qid, label: f.label, weight: 0, liked: [], disliked: [] };
      entry.weight += weight;
      (weight > 0 ? entry.liked : entry.disliked).push(title);
      profile.set(key, entry);
    }
  }
  return profile;
}

const strength = (e) => e.weight * ROLES[e.prop].weight;

/**
 * Regroupe les rôles d'une même personne / chose (« Réalisation et scénario : Christopher Nolan »).
 * Renvoie [{ qid, label, roles: ['Réalisation', 'Scénario'], liked, weight }] dans l'ordre reçu.
 */
export function groupByThing(entries) {
  const groups = new Map();
  for (const e of entries) {
    const g = groups.get(e.qid);
    if (g) {
      g.roles.push(ROLES[e.prop].label);
      g.liked = [...new Set([...g.liked, ...e.liked])];
    } else {
      groups.set(e.qid, { qid: e.qid, label: e.label, roles: [ROLES[e.prop].label], liked: [...e.liked], weight: e.weight, prop: e.prop });
    }
  }
  return [...groups.values()];
}

const rolesText = (roles) => {
  const [first, ...rest] = roles;
  return rest.length ? `${first} et ${rest.map((r) => r.toLowerCase()).join(' et ')}` : first;
};

// Dans « ce qui relie tes goûts », les genres et pays communs sont vite banals : on en garde peu.
const LINK_CAPS = { P136: 2, P495: 1 };

/** Ce qui relie mes coups de cœur : traits partagés par au moins deux titres aimés. */
export function commonLinks(profile, { min = 2, limit = 8 } = {}) {
  const shared = [...profile.values()]
    .filter((e) => e.liked.length >= min && e.weight > 0)
    .sort((a, b) => b.liked.length * ROLES[b.prop].weight - a.liked.length * ROLES[a.prop].weight || strength(b) - strength(a));
  const perProp = {};
  const capped = shared.filter((e) => {
    perProp[e.prop] = (perProp[e.prop] ?? 0) + 1;
    return perProp[e.prop] <= (LINK_CAPS[e.prop] ?? Infinity);
  });
  return groupByThing(capped).slice(0, limit).map((g) => ({ ...g, rolesText: rolesText(g.roles) }));
}

/** Traits à chercher sur Wikidata : les plus forts en positif, et quelques négatifs pour écarter. */
export function queryFeatures(profile, { positive = 60, negative = 12 } = {}) {
  const all = [...profile.values()];
  const pos = all.filter((e) => e.weight > 0).sort((a, b) => strength(b) - strength(a)).slice(0, positive);
  const neg = all.filter((e) => e.weight < 0).sort((a, b) => strength(a) - strength(b)).slice(0, negative);
  return [...pos, ...neg];
}

/**
 * Score d'affinité d'un candidat à partir des traits qu'il partage avec le profil.
 * Renvoie { affinity, reasons: [entrées du profil, les plus parlantes d'abord] }.
 */
export function affinity(hitKeys, profile, sitelinks = 0) {
  const hits = hitKeys.map((k) => profile.get(k)).filter(Boolean);
  const raw = hits.reduce((sum, e) => sum + strength(e), 0);
  const popularity = Math.log10(1 + sitelinks) * 0.3; // départage : un titre connu est plus sûr
  const reasons = hits.filter((e) => e.weight > 0).sort((a, b) => strength(b) - strength(a));
  return { affinity: raw + popularity, reasons };
}

/** Goût par genre OMDb (« Sci-Fi », « Drama »…) : { genre → poids }, à partir des titres notés. */
export function genreWeights(titles, weightOf) {
  const weights = {};
  for (const t of titles) {
    const w = weightOf(t);
    for (const g of t.genres ?? []) weights[g] = (weights[g] ?? 0) + w;
  }
  return weights;
}

/** Proximité de genres d'un candidat (moyenne des poids de ses genres OMDb). */
export function genreAffinity(genres = [], weights = {}) {
  if (!genres.length) return 0;
  return genres.reduce((sum, g) => sum + (weights[g] ?? 0), 0) / genres.length;
}

/** Score final une fois la fiche connue : l'affinité d'abord, puis genres et qualité. */
export function finalScore(affinityScore, ratings = {}, genreBonus = 0) {
  const imdb = ratings.imdb == null ? -0.4 : (ratings.imdb - 6.8) * 0.9;
  const rt = ratings.rt == null ? 0 : (ratings.rt - 70) / 40;
  return affinityScore + imdb + rt + Math.max(-2, Math.min(2, genreBonus * 0.5));
}

/** Phrases d'explication : « Réalisation et scénario : Christopher Nolan (comme Inception, Interstellar) ». */
export function explain(reasons, displayTitle = (t) => t, max = 3) {
  return groupByThing(reasons).slice(0, max).map((g) => {
    const examples = g.liked.slice(0, 2).map(displayTitle).join(', ');
    return `${rolesText(g.roles)} : ${g.label}${examples ? ` (comme ${examples})` : ''}`;
  });
}

/**
 * Variété : chaque suggestion qui partage sa raison principale avec une suggestion déjà retenue perd `penalty`
 * (sinon dix films du même réalisateur occuperaient toute la liste). list = [{ score, reasons }], trié ou non.
 */
export function diversify(list, penalty = 0.25) {
  const pool = [...list];
  const used = new Map(); // qid de la raison principale → nombre de fois déjà utilisée
  const out = [];
  while (pool.length) {
    let best = 0;
    let bestScore = -Infinity;
    pool.forEach((c, i) => {
      const n = used.get(c.reasons?.[0]?.qid) ?? 0;
      const s = c.score * (1 - penalty) ** n;
      if (s > bestScore) { bestScore = s; best = i; }
    });
    const [pick] = pool.splice(best, 1);
    const top = pick.reasons?.[0]?.qid;
    if (top) used.set(top, (used.get(top) ?? 0) + 1);
    out.push(pick);
  }
  return out;
}

/** Une décennie revient dans les coups de cœur ? (« années 2010 : 4 titres ») */
export function favouriteDecades(titles, min = 2) {
  const counts = {};
  for (const t of titles) {
    const y = Number(String(t.year ?? '').slice(0, 4));
    if (y) counts[Math.floor(y / 10) * 10] = (counts[Math.floor(y / 10) * 10] ?? 0) + 1;
  }
  return Object.entries(counts).filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]).map(([d, n]) => ({ decade: Number(d), count: n }));
}
