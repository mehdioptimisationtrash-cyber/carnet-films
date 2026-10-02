import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPush, hashOf, mergeRemote, settingsFromRemote } from '../js/sync-model.js';

const A = { id: 'tt1', title: 'A', addedAt: 3 };
const B = { id: 'tt2', title: 'B', addedAt: 2 };
const C = { id: 'tt3', title: 'C', addedAt: 1 };
const state = (titles, extra = {}) => ({ titles, apiKey: 'k', dismissed: [], ...extra });

test('buildPush envoie tout la première fois, puis seulement les changements', () => {
  const first = buildPush(state([A, B]));
  assert.deepEqual(first.payload.upsert.map((t) => t.id), ['tt1', 'tt2']);
  assert.ok(first.payload.settings);
  assert.equal(buildPush(state([A, B]), first.synced), null);
  const changed = buildPush(state([{ ...A, note: 'x' }]), first.synced);
  assert.deepEqual(changed.payload.upsert.map((t) => t.id), ['tt1']);
  assert.deepEqual(changed.payload.remove, ['tt2']);
  assert.equal(changed.payload.settings, undefined);
});

test('mergeRemote : premier branchement = union des deux côtés', () => {
  const { titles } = mergeRemote([A, B], [B, C], {});
  assert.deepEqual(titles.map((t) => t.id), ['tt1', 'tt2', 'tt3']);
});

test('mergeRemote : la feuille gagne si le téléphone n’a rien changé, sinon le téléphone gagne', () => {
  const synced = { titles: { tt1: hashOf(A), tt2: hashOf(B) } };
  const remoteA = { ...A, note: 'vu ailleurs' };
  const localB = { ...B, note: 'modifié ici' };
  const { titles } = mergeRemote([A, localB], [remoteA, { ...B, note: 'autre' }], synced);
  assert.equal(titles.find((t) => t.id === 'tt1').note, 'vu ailleurs');
  assert.equal(titles.find((t) => t.id === 'tt2').note, 'modifié ici');
});

test('mergeRemote : suppressions des deux côtés respectées', () => {
  const synced = { titles: { tt1: hashOf(A), tt2: hashOf(B) } };
  // tt1 retiré sur un autre appareil ; tt2 retiré sur ce téléphone.
  const { titles, synced: next } = mergeRemote([A], [B], synced);
  assert.deepEqual(titles, []);
  assert.deepEqual(Object.keys(next.titles), ['tt2']); // l'envoi suivant retirera tt2 de la feuille
  assert.deepEqual(buildPush(state(titles), next).payload.remove, ['tt2']);
});

test('settingsFromRemote récupère la clé et fusionne les titres écartés', () => {
  const s = settingsFromRemote({ omdbKey: 'abcd1234', dismissed: '["tt9","x"]' }, { apiKey: '', dismissed: ['tt8'] });
  assert.deepEqual(s, { apiKey: 'abcd1234', dismissed: ['tt8', 'tt9'] });
  assert.equal(settingsFromRemote({ omdbKey: 'z' }, { apiKey: 'local' }).apiKey, 'local');
});
