/**
 * Carnet Films — script Google Apps Script (VERSION 1).
 * L'app fournit ce script avec ton code secret déjà rempli (Réglages → Sauvegarde en ligne → Copier le script).
 * À coller dans une feuille Google (Extensions → Apps Script), à la place de tout le contenu, puis :
 *   Déployer → Nouveau déploiement → Type : Application web
 *   Exécuter en tant que : Moi · Qui a accès : Tout le monde → Déployer → copier l'URL (…/exec).
 * Pour une mise à jour : Déployer → Gérer les déploiements → ✏️ → Version : Nouvelle version (l'URL ne change pas).
 *
 * Onglets créés automatiquement :
 *  - carnet   : une ligne par titre, lisible (ne pas modifier la dernière colonne « données brutes »)
 *  - reglages : la clé OMDb (pour retrouver tout le carnet sur un autre appareil)
 */
const TOKEN = 'COLLE_ICI_TON_CODE_SECRET';
const VERSION = 1;
const PLACEHOLDER = 'COLLE_ICI_TON' + '_CODE_SECRET'; // découpé exprès : jamais égal à TOKEN par erreur
const CELL_MAX = 45000; // une cellule Google Sheets contient au plus 50 000 caractères

const HEADER = ['id', 'titre', 'titre original', 'type', 'année', 'statut', 'prioritaire', 'ma note /5', 'commentaire',
  'IMDb /10', 'Rotten Tomatoes %', 'Metacritic /100', 'genres', 'durée (min)', 'réalisation', 'ajouté le', 'vu le',
  'lien IMDb', 'jaquette', 'modifié le', 'données brutes'];
const RAW = HEADER.length - 1;

// Refuse tout tant que le code secret n'a pas été choisi (le dépôt est public).
function checkToken(token) {
  if (TOKEN === PLACEHOLDER || TOKEN.length < 16) return 'script_not_configured';
  return token === TOKEN ? null : 'unauthorized';
}

function doGet(e) {
  const refused = checkToken(e && e.parameter ? e.parameter.token : '');
  if (refused) return out({ ok: false, error: refused });
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return out({ ok: true, v: VERSION, titles: readTitles(ss), settings: readSettings(ss) });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad json' }); }
  const refused = checkToken(body ? body.token : '');
  if (refused) return out({ ok: false, error: refused });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    writeTitles(ss, Array.isArray(body.upsert) ? body.upsert : [], Array.isArray(body.remove) ? body.remove : []);
    if (body.settings && typeof body.settings === 'object') writeSettings(ss, body.settings);
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
  return out({ ok: true, v: VERSION });
}

/* ---------- carnet ---------- */

function readTitles(ss) {
  const sh = ss.getSheetByName('carnet');
  const n = sh ? sh.getLastRow() - 1 : 0;
  if (n <= 0) return [];
  const titles = [];
  sh.getRange(2, 1, n, HEADER.length).getValues().forEach((r) => {
    if (!r[RAW]) return;
    try { titles.push(JSON.parse(r[RAW])); } catch (err) { /* ligne abîmée : ignorée */ }
  });
  return titles;
}

/** Met à jour / ajoute / retire des lignes, puis réécrit le tableau trié (ajout le plus récent en haut). */
function writeTitles(ss, upsert, remove) {
  if (!upsert.length && !remove.length) return;
  const sh = sheet(ss, 'carnet', HEADER);
  const n = sh.getLastRow() - 1;
  const rows = n > 0 ? sh.getRange(2, 1, n, HEADER.length).getValues() : [];
  const byId = {};
  rows.forEach((r) => { if (r[0]) byId[String(r[0])] = r; });
  remove.forEach((id) => { delete byId[String(id)]; });
  upsert.forEach((t) => {
    if (t && /^tt\d+$/.test(String(t.id))) byId[t.id] = toRow(t);
  });
  const all = Object.keys(byId).map((id) => byId[id]).sort((a, b) => String(b[15]).localeCompare(String(a[15])));
  if (n > 0) sh.getRange(2, 1, n, HEADER.length).clearContent();
  if (all.length) sh.getRange(2, 1, all.length, HEADER.length).setValues(all);
}

function toRow(t) {
  const r = t.ratings || {};
  const fr = t.fr || {};
  let raw = JSON.stringify(t);
  if (raw.length > CELL_MAX) raw = JSON.stringify(Object.assign({}, t, { fr: null })); // le synopsis sera rechargé
  return [
    t.id, fr.title || t.title || '', t.title || '', t.type === 'series' ? 'série' : 'film', t.year || '',
    t.status === 'watched' ? 'vu' : 'à voir', t.priority ? 'oui' : '', blank(t.myRating), t.note || '',
    blank(r.imdb), blank(r.rt), blank(r.mc), (t.genres || []).join(', '), blank(t.runtime), t.director || '',
    day(t.addedAt), day(t.watchedAt), 'https://www.imdb.com/title/' + t.id + '/', t.poster || '', day(t.updatedAt),
    raw.length > CELL_MAX ? '' : raw,
  ];
}

/* ---------- réglages ---------- */

function readSettings(ss) {
  const sh = ss.getSheetByName('reglages');
  const n = sh ? sh.getLastRow() - 1 : 0;
  const settings = {};
  if (n > 0) sh.getRange(2, 1, n, 2).getValues().forEach((r) => { if (r[0]) settings[String(r[0])] = String(r[1]); });
  return settings;
}

function writeSettings(ss, settings) {
  const sh = sheet(ss, 'reglages', ['réglage', 'valeur']);
  const merged = Object.assign(readSettings(ss), settings);
  const rows = Object.keys(merged).map((k) => [k, merged[k]]);
  const n = sh.getLastRow() - 1;
  if (n > 0) sh.getRange(2, 1, n, 2).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
}

/* ---------- outils ---------- */

function sheet(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), header.length).setNumberFormat('@'); // tout en texte : rien n'est converti
  }
  return sh;
}

// Date AAAA-MM-JJ HH:MM (texte) à partir d'un horodatage en millisecondes.
function day(ms) {
  if (!ms) return '';
  return Utilities.formatDate(new Date(Number(ms)), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm');
}

function blank(v) {
  return v === null || v === undefined ? '' : String(v);
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
