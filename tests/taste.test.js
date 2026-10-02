import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  affinity, buildProfile, commonLinks, diversify, explain, favouriteDecades, finalScore, genreAffinity, genreWeights, itemWeight, queryFeatures,
  usefulFeatures,
} from '../js/taste.js';

const nolan = { prop: 'P57', qid: 'Q25191', label: 'Christopher Nolan' };
const zimmer = { prop: 'P86', qid: 'Q76364', label: 'Hans Zimmer' };
const scifi = { prop: 'P136', qid: 'Q471839', label: 'cinéma de science-fiction' };
const dicaprio = { prop: 'P161', qid: 'Q38111', label: 'Leonardo DiCaprio' };
const extra = { prop: 'P161', qid: 'Q1', label: 'Figurant Inconnu' };
const horror = { prop: 'P136', qid: 'Q200092', label: 'horreur' };

test('itemWeight apprend des étoiles, du « vu » et des titres écartés', () => {
  assert.equal(itemWeight({ id: 'a', myRating: 5 }), 2);
  assert.equal(itemWeight({ id: 'a', myRating: 4 }), 1);
  assert.equal(itemWeight({ id: 'a', myRating: 1 }), -2);
  assert.equal(itemWeight({ id: 'a', status: 'watched' }), 0.4);
  assert.equal(itemWeight({ id: 'a', status: 'todo' }), 0.1);
  assert.equal(itemWeight({ id: 'a', myRating: 5 }, new Set(['a'])), -1);
});

test('usefulFeatures garde les acteurs principaux et retire les réalisateurs d’épisodes', () => {
  assert.deepEqual(usefulFeatures([nolan, dicaprio, extra], { type: 'movie', actors: 'Leonardo DiCaprio, Elliot Page' }), [nolan, dicaprio]);
  assert.deepEqual(usefulFeatures([nolan, scifi], { type: 'series' }), [scifi]);
  const writers = Array.from({ length: 6 }, (_, i) => ({ prop: 'P58', qid: `Q${i + 10}`, label: `Auteur ${i}` }));
  assert.deepEqual(usefulFeatures([...writers, scifi], { type: 'series' }), [scifi]);
  assert.deepEqual(usefulFeatures([{ prop: 'P86', qid: 'Q5', label: 'Q5' }]), []); // pas de libellé
});

const items = [
  { title: 'Inception', weight: 2, features: [nolan, zimmer, scifi, dicaprio] },
  { title: 'Interstellar', weight: 2, features: [nolan, zimmer, scifi] },
  { title: 'Shutter Island', weight: 1, features: [dicaprio] },
  { title: 'Saw', weight: -2, features: [horror] },
];

test('buildProfile et commonLinks trouvent ce qui relie les coups de cœur', () => {
  const profile = buildProfile(items);
  assert.equal(profile.get('P57=Q25191').weight, 4);
  assert.deepEqual(profile.get('P161=Q38111').liked, ['Inception', 'Shutter Island']);
  assert.equal(profile.get('P136=Q200092').weight, -2);
  const links = commonLinks(profile).map((e) => e.label);
  assert.equal(links[0], 'Christopher Nolan');
  assert.ok(links.includes('Leonardo DiCaprio'));
  assert.ok(!links.includes('horreur'));
});

test('queryFeatures inclut les traits négatifs pour pouvoir les écarter', () => {
  const keys = queryFeatures(buildProfile(items)).map((e) => e.key);
  assert.equal(keys[0], 'P57=Q25191');
  assert.ok(keys.includes('P136=Q200092'));
});

test('affinity : même réalisateur > même genre ; un trait détesté fait baisser', () => {
  const profile = buildProfile(items);
  const byNolan = affinity(['P57=Q25191'], profile).affinity;
  const bySciFi = affinity(['P136=Q471839'], profile).affinity;
  const horrorSciFi = affinity(['P136=Q471839', 'P136=Q200092'], profile).affinity;
  assert.ok(byNolan > bySciFi);
  assert.ok(horrorSciFi < bySciFi);
  const { reasons } = affinity(['P136=Q471839', 'P57=Q25191', 'P136=Q200092'], profile);
  assert.deepEqual(reasons.map((e) => e.label), ['Christopher Nolan', 'cinéma de science-fiction']);
  assert.deepEqual(explain(reasons, (t) => t, 1), ['Réalisation : Christopher Nolan (comme Inception, Interstellar)']);
  const writerToo = buildProfile([{ title: 'Inception', weight: 2, features: [nolan, { ...nolan, prop: 'P58' }] }]);
  const both = affinity(['P57=Q25191', 'P58=Q25191'], writerToo).reasons;
  assert.deepEqual(explain(both), ['Réalisation et scénario : Christopher Nolan (comme Inception)']);
});

test('finalScore récompense les bonnes notes', () => {
  assert.ok(finalScore(5, { imdb: 8.5, rt: 95 }) > finalScore(5, { imdb: 6, rt: 40 }));
  assert.ok(finalScore(5, {}) < finalScore(5, { imdb: 7.5 }));
});

test('genreWeights / genreAffinity : les genres aimés rapprochent, les genres détestés éloignent', () => {
  const titles = [{ genres: ['Sci-Fi', 'Drama'], w: 2 }, { genres: ['Horror'], w: -2 }];
  const weights = genreWeights(titles, (t) => t.w);
  assert.deepEqual(weights, { 'Sci-Fi': 2, Drama: 2, Horror: -2 });
  assert.ok(genreAffinity(['Sci-Fi'], weights) > genreAffinity(['Horror', 'Sci-Fi'], weights));
  assert.equal(genreAffinity([], weights), 0);
  assert.ok(finalScore(1, { imdb: 7 }, 2) > finalScore(1, { imdb: 7 }, -2));
});

test('diversify évite dix suggestions pour la même raison', () => {
  const n = { qid: 'Q25191' };
  const b = { qid: 'Q1' };
  const list = [{ id: 1, score: 10, reasons: [n] }, { id: 2, score: 9.5, reasons: [n] }, { id: 3, score: 9, reasons: [n] }, { id: 4, score: 8, reasons: [b] }];
  assert.deepEqual(diversify(list).map((c) => c.id), [1, 4, 2, 3]);
});

test('commonLinks regroupe les rôles d’une même personne', () => {
  const p = buildProfile([
    { title: 'Inception', weight: 2, features: [nolan, { ...nolan, prop: 'P58' }] },
    { title: 'Interstellar', weight: 2, features: [nolan, { ...nolan, prop: 'P58' }] },
  ]);
  const [first] = commonLinks(p);
  assert.equal(first.rolesText, 'Réalisation et scénario');
  assert.deepEqual(first.liked, ['Inception', 'Interstellar']);
});

test('favouriteDecades', () => {
  assert.deepEqual(favouriteDecades([{ year: '2010' }, { year: '2014' }, { year: '1999' }, { year: '2022–' }]), [{ decade: 2010, count: 2 }]);
});
