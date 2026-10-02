// Exécute apps-script/Code.gs dans une fausse feuille Google pour vérifier l'aller-retour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildPush, mergeRemote, settingsFromRemote } from '../js/sync-model.js';

const SOURCE = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const TOKEN = 'test-code-assez-long-123';

function fakeSheet() {
  const cells = [];
  const range = (r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cells[r - 1 + i]?.[c - 1 + j] ?? '')),
    setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { cells[r - 1 + i] ??= []; cells[r - 1 + i][c - 1 + j] = x; })); return this; },
    clearContent() { for (let i = 0; i < nr; i += 1) for (let j = 0; j < nc; j += 1) if (cells[r - 1 + i]) cells[r - 1 + i][c - 1 + j] = ''; return this; },
    setFontWeight() { return this; },
    setNumberFormat() { return this; },
  });
  return {
    getRange: (a, ...rest) => range(a, ...rest),
    getLastRow: () => { let last = 0; cells.forEach((row, i) => { if (row?.some((x) => x !== '' && x != null)) last = i + 1; }); return last; },
    getMaxRows: () => 1000,
    setFrozenRows() {},
    cells: () => cells,
  };
}

function loadScript(token = TOKEN) {
  const sheets = {};
  const ss = { getSheetByName: (n) => sheets[n] ?? null, insertSheet: (n) => (sheets[n] = fakeSheet()), getSpreadsheetTimeZone: () => 'Europe/Paris' };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }), MimeType: { JSON: 'json' } },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 16).replace('T', ' ') },
  };
  vm.createContext(ctx);
  vm.runInContext(token ? SOURCE.replace("'COLLE_ICI_TON_CODE_SECRET'", `'${token}'`) : SOURCE, ctx);
  return { ctx, sheets };
}

const post = (ctx, payload) => ctx.doPost({ postData: { contents: JSON.stringify({ token: TOKEN, ...payload }) } });
const get = (ctx) => ctx.doGet({ parameter: { token: TOKEN } });

const inception = {
  id: 'tt1375666', title: 'Inception', year: '2010', type: 'movie', status: 'watched', myRating: 5, note: 'Conseillé par Julie',
  priority: false, ratings: { imdb: 8.8, rt: 87, mc: 74 }, genres: ['Action', 'Sci-Fi'], runtime: 148, director: 'Christopher Nolan',
  addedAt: 1000, watchedAt: 2000, updatedAt: 3000, fr: { title: 'Inception', synopsis: ['Dans un futur proche…'] },
};
const bear = { id: 'tt14452776', title: 'The Bear', type: 'series', status: 'todo', addedAt: 5000, ratings: { imdb: 8.5 }, fr: { title: 'The Bear' } };

test('le script refuse tout tant que le code secret n’est pas choisi', () => {
  const { ctx } = loadScript(null);
  assert.equal(ctx.doGet({ parameter: { token: 'COLLE_ICI_TON_CODE_SECRET' } }).error, 'script_not_configured');
});

test('le script refuse un mauvais code secret', () => {
  const { ctx } = loadScript();
  assert.equal(ctx.doGet({ parameter: { token: 'faux' } }).error, 'unauthorized');
  assert.equal(ctx.doPost({ postData: { contents: '{"token":"faux"}' } }).error, 'unauthorized');
});

test('aller-retour téléphone → feuille → autre appareil', () => {
  const { ctx, sheets } = loadScript();
  const phone = { titles: [bear, inception], apiKey: 'abcd1234', dismissed: ['tt0000001'] };
  const push = buildPush(phone, {});
  assert.equal(post(ctx, push.payload).ok, true);

  const rows = sheets.carnet.cells();
  assert.equal(rows.length, 3); // en-tête + 2 titres
  assert.equal(rows[1][0], 'tt14452776'); // ajout le plus récent en haut
  const inc = rows[2];
  assert.deepEqual(inc.slice(0, 12), ['tt1375666', 'Inception', 'Inception', 'film', '2010', 'vu', '', '5', 'Conseillé par Julie', '8.8', '87', '74']);

  // Un autre appareil vide récupère tout, y compris la clé OMDb.
  const remote = get(ctx);
  const merged = mergeRemote([], remote.titles, {});
  assert.deepEqual(merged.titles.map((t) => t.id), ['tt14452776', 'tt1375666']);
  assert.equal(merged.titles[1].note, 'Conseillé par Julie');
  assert.deepEqual(settingsFromRemote(remote.settings, { apiKey: '', dismissed: [] }), { apiKey: 'abcd1234', dismissed: ['tt0000001'] });

  // Retrait d'un titre.
  const next = buildPush({ ...phone, titles: [inception] }, push.synced);
  assert.deepEqual(next.payload.remove, ['tt14452776']);
  post(ctx, next.payload);
  assert.deepEqual(get(ctx).titles.map((t) => t.id), ['tt1375666']);
});

test('un titre trop gros pour une cellule est enregistré sans son synopsis', () => {
  const { ctx } = loadScript();
  const huge = { ...inception, fr: { title: 'Inception', synopsis: ['x'.repeat(60000)] } };
  post(ctx, { upsert: [huge] });
  const [back] = get(ctx).titles;
  assert.equal(back.fr, null);
  assert.equal(back.note, 'Conseillé par Julie');
});
