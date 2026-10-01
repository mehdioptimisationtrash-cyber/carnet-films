// État de l'app, gardé dans le navigateur (localStorage). Mises à jour immuables.

const STORAGE_KEY = 'carnet-films:v1';

const EMPTY_STATE = Object.freeze({
  apiKey: '',
  titles: [], // [{ ...fiche OMDb, status: 'todo'|'watched', addedAt, watchedAt, myRating, note, priority }]
  view: { status: 'todo', type: 'all', genre: '', sort: 'added', minImdb: 0, minRt: 0 },
});

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const saved = JSON.parse(raw);
    return { ...EMPTY_STATE, ...saved, view: { ...EMPTY_STATE.view, ...saved.view } };
  } catch (err) {
    console.error('Lecture des données impossible', err);
    return EMPTY_STATE;
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.error('Sauvegarde impossible', err);
    return false;
  }
}

export const getState = () => state;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** `meta.quiet` : pas besoin de redessiner l'écran (saisie en cours). */
export function update(updater, meta = {}) {
  state = updater(state);
  const saved = persist();
  listeners.forEach((fn) => fn(state, meta));
  return saved;
}

export const findTitle = (id) => state.titles.find((t) => t.id === id) ?? null;

export const setApiKey = (apiKey) => update((s) => ({ ...s, apiKey: apiKey.trim() }));

export const setView = (changes, meta) => update((s) => ({ ...s, view: { ...s.view, ...changes } }), meta);

/** Ajoute des fiches au carnet (ignore celles déjà présentes). Renvoie le nombre ajouté. */
export function addTitles(fiches, extra = {}) {
  const known = new Set(state.titles.map((t) => t.id));
  const now = Date.now();
  const fresh = fiches
    .filter((f) => f && !known.has(f.id) && known.add(f.id))
    .map((f, i) => ({ status: 'todo', myRating: null, note: '', priority: false, watchedAt: null, ...f, ...extra, addedAt: now - i }));
  if (fresh.length) update((s) => ({ ...s, titles: [...fresh, ...s.titles] }));
  return fresh.length;
}

export function patchTitle(id, changes, meta) {
  return update((s) => ({ ...s, titles: s.titles.map((t) => (t.id === id ? { ...t, ...changes } : t)) }), meta);
}

/** Remplace les infos OMDb (notes à jour) sans toucher aux champs personnels. */
export function refreshTitle(fiche) {
  return patchTitle(fiche.id, fiche);
}

export const removeTitle = (id) => update((s) => ({ ...s, titles: s.titles.filter((t) => t.id !== id) }));

export function toggleWatched(id) {
  const t = findTitle(id);
  if (!t) return;
  const watched = t.status !== 'watched';
  patchTitle(id, { status: watched ? 'watched' : 'todo', watchedAt: watched ? Date.now() : null });
}

// ——— Sauvegarde fichier ———

export function exportJson() {
  return JSON.stringify({ app: 'carnet-films', version: 1, exportedAt: new Date().toISOString(), titles: state.titles }, null, 2);
}

/** Fusionne une sauvegarde : les titres déjà présents sont mis à jour avec la version importée. */
export function importJson(text) {
  const data = JSON.parse(text);
  const titles = Array.isArray(data) ? data : data?.titles;
  if (!Array.isArray(titles)) throw new Error('Fichier non reconnu.');
  const valid = titles.filter((t) => t && typeof t.id === 'string' && /^tt\d+$/.test(t.id) && typeof t.title === 'string');
  const byId = new Map(state.titles.map((t) => [t.id, t]));
  valid.forEach((t) => byId.set(t.id, { ...byId.get(t.id), ...t }));
  update((s) => ({ ...s, titles: [...byId.values()] }));
  return valid.length;
}
