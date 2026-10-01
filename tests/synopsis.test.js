import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanFrTitle, extractSynopsis, splitSections } from '../js/synopsis.js';

const ARTICLE = `La vie est belle est un film italien réalisé par Roberto Benigni, sorti en 1997.

== Synopsis ==

=== Partie I ===
En 1939, dans l'Italie fasciste, Guido arrive à Arezzo.

Il tombe amoureux de Dora.

=== Partie II ===
Guido est déporté avec son fils.

== Fiche technique ==
Titre : La vita è bella`;

test('extractSynopsis prend la section Synopsis sans les sous-titres', () => {
  const { synopsis, intro } = extractSynopsis(ARTICLE);
  assert.deepEqual(synopsis, [
    "En 1939, dans l'Italie fasciste, Guido arrive à Arezzo.",
    'Il tombe amoureux de Dora.',
    'Guido est déporté avec son fils.',
  ]);
  assert.match(intro, /^La vie est belle est un film italien/);
});

test('extractSynopsis préfère « Résumé » à « Résumé détaillé »', () => {
  const text = 'Intro.\n== Résumé détaillé ==\nLa fin.\n== Résumé ==\nLe début.\n';
  assert.deepEqual(extractSynopsis(text).synopsis, ['Le début.']);
});

test('extractSynopsis sans section de synopsis renvoie seulement la présentation', () => {
  const { synopsis, intro } = extractSynopsis('Un court métrage.\n== Fiche technique ==\nDurée : 10 min');
  assert.equal(synopsis, null);
  assert.equal(intro, 'Un court métrage.');
  assert.deepEqual(extractSynopsis(''), { synopsis: null, intro: null });
});

test('splitSections ignore les sous-sections de niveau 3', () => {
  assert.deepEqual(splitSections(ARTICLE).sections.map((s) => s.heading), ['Synopsis', 'Fiche technique']);
});

test('cleanFrTitle retire les précisions entre parenthèses', () => {
  assert.equal(cleanFrTitle('Joker (film, 2019)'), 'Joker');
  assert.equal(cleanFrTitle('The Bear (série télévisée)'), 'The Bear');
  assert.equal(cleanFrTitle('Le Parrain (film)'), 'Le Parrain');
  assert.equal(cleanFrTitle('Les Gardiens de la Galaxie Vol. 2'), 'Les Gardiens de la Galaxie Vol. 2');
  assert.equal(cleanFrTitle('Mission: Impossible (série télévisée, 1966)'), 'Mission: Impossible');
  assert.equal(cleanFrTitle('Brazil (film)'), 'Brazil');
});
