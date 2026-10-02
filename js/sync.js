// Sauvegarde en ligne : le carnet vit dans une feuille Google Sheets (application web Apps Script, voir apps-script/Code.gs).
// Le téléphone garde une copie pour fonctionner hors ligne ; à chaque ouverture, la feuille est relue et fusionnée.
import { buildPush, mergeRemote, settingsFromRemote } from './sync-model.js';
import * as store from './store.js';

const CONFIG_KEY = 'carnet-films:cloud';
const SYNCED_KEY = 'carnet-films:synced';
const DELAY_MS = 2000;
const RETRY_MS = 30000;
const TIMEOUT_MS = 25000;
const URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
const SCRIPT_ERRORS = {
  unauthorized: 'Code secret refusé : le script collé dans Google ne contient pas ce code. Recopie le script depuis l’app et redéploie.',
  script_not_configured: 'Le script Google n’a pas de code secret : recopie le script depuis l’app (bouton « Copier le script »).',
};

let timer = null;
let inflight = null;
let status = { state: 'off', label: 'Pas encore branchée' };
const statusListeners = new Set();

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error('Stockage local impossible', err);
  }
};

export const getConfig = () => read(CONFIG_KEY, { url: '', token: '' });
export const isEnabled = () => URL_PATTERN.test(getConfig().url) && Boolean(getConfig().token);
export const isValidUrl = (url) => URL_PATTERN.test(url);
/** Retire espaces, retours à la ligne et caractères invisibles (copier-coller). */
export const cleanText = (text) => String(text ?? '').replace(/[\s​-‏⁠﻿]/g, '');
export const getStatus = () => status;

export function onStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

function setStatus(state, label) {
  status = { state, label };
  statusListeners.forEach((fn) => fn(status));
}

const hhmm = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Code secret aléatoire (24 caractères) pour un nouveau script. */
export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 24).padEnd(24, 'x');
}

async function request(method, body, config = getConfig()) {
  const opts = { method, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) };
  let target = config.url;
  if (method === 'GET') {
    target += `?token=${encodeURIComponent(config.token)}&t=${Date.now()}`;
  } else {
    // text/plain évite la pré-vérification CORS qu'Apps Script ne gère pas.
    opts.body = JSON.stringify({ token: config.token, ...body });
    opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
  }
  let res;
  try {
    res = await fetch(target, opts);
  } catch (err) {
    if (!navigator.onLine) throw new Error('Pas de connexion internet');
    if (err.name === 'TimeoutError') throw new Error('Google ne répond pas, réessaie');
    // Google renvoie vers sa page de connexion quand le script n'est pas ouvert à « Tout le monde ».
    throw new Error('Google refuse l’accès : au déploiement, « Qui a accès » doit être « Tout le monde »');
  }
  if (!res.ok) throw new Error(`Google a répondu ${res.status}`);
  const data = await res.json().catch(() => null);
  if (data?.ok !== true) throw new Error(SCRIPT_ERRORS[data?.error] ?? data?.error ?? 'Réponse invalide de Google');
  return data;
}

/** Relit la feuille et la fusionne dans le téléphone. */
export async function pull() {
  if (!isEnabled()) return;
  setStatus('pending', 'Lecture de la feuille…');
  const data = await request('GET');
  const state = store.getState();
  const { titles, synced } = mergeRemote(state.titles, data.titles ?? [], read(SYNCED_KEY, {}));
  write(SYNCED_KEY, { ...read(SYNCED_KEY, {}), titles: synced.titles });
  store.replaceTitles(titles, settingsFromRemote(data.settings, state), { fromSync: true });
  setStatus('ok', `À jour (lu à ${hhmm()})`);
}

/** Envoie les changements en attente. */
export function flush() {
  clearTimeout(timer);
  timer = null;
  if (!isEnabled()) return Promise.resolve();
  if (inflight) return inflight;
  const push = buildPush(store.getState(), read(SYNCED_KEY, {}));
  if (!push) {
    if (status.state !== 'ok') setStatus('ok', 'À jour');
    return Promise.resolve();
  }
  if (!navigator.onLine) {
    setStatus('pending', 'Hors ligne — envoi au retour du réseau');
    return Promise.resolve();
  }
  setStatus('pending', 'Enregistrement en ligne…');
  inflight = request('POST', push.payload)
    .then(() => {
      write(SYNCED_KEY, push.synced);
      setStatus('ok', `Enregistré en ligne à ${hhmm()}`);
    })
    .catch((err) => {
      console.error('Sauvegarde en ligne échouée', err);
      setStatus('error', `Échec (${err.message}) — nouvel essai dans 30 s`);
      timer = setTimeout(flush, RETRY_MS);
    })
    .finally(() => {
      inflight = null;
      if (!timer && buildPush(store.getState(), read(SYNCED_KEY, {}))) timer = setTimeout(flush, DELAY_MS);
    });
  return inflight;
}

function schedule(_, meta = {}) {
  if (!isEnabled() || meta.fromSync) return;
  clearTimeout(timer);
  setStatus('pending', 'Modifications à enregistrer…');
  timer = setTimeout(flush, DELAY_MS);
}

/** Vérifie l'adresse + le code, les enregistre, fusionne la feuille puis envoie le téléphone. Renvoie le nombre de titres en ligne. */
export async function connect(url, token) {
  const config = { url: cleanText(url), token: cleanText(token) };
  if (!isValidUrl(config.url)) throw new Error('L’adresse doit commencer par https://script.google.com/macros/s/ et finir par /exec');
  if (!config.token) throw new Error('Code secret manquant');
  const data = await request('GET', null, config);
  write(CONFIG_KEY, config);
  write(SYNCED_KEY, null);
  await pull();
  await flush();
  return (data.titles ?? []).length;
}

export function disconnect() {
  write(CONFIG_KEY, null);
  write(SYNCED_KEY, null);
  clearTimeout(timer);
  setStatus('off', 'Pas encore branchée');
}

export async function syncNow() {
  await flush();
  await pull();
  await flush();
}

export function startSync() {
  store.subscribe(schedule);
  window.addEventListener('online', () => flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
    else if (isEnabled()) flush().then(pull).catch((err) => setStatus('error', `Lecture impossible (${err.message})`));
  });
  if (isEnabled()) {
    flush().then(pull).then(flush).catch((err) => setStatus('error', `Lecture impossible (${err.message})`));
  }
}
