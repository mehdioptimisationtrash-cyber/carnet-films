import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLine, parseList, fromOmdb, sortTitles, filterTitles, stats, formatRuntime, rtState, posterUrl, firstYear,
} from '../js/model.js';

test('parseLine reconnaît titre seul, année, puces et identifiants IMDb', () => {
  assert.deepEqual(parseLine('Inception'), { raw: 'Inception', query: 'Inception', year: null, imdbId: null });
  assert.equal(parseLine('Inception (2010)').year, 2010);
  assert.equal(parseLine('Inception (2010)').query, 'Inception');
  assert.equal(parseLine('- Dune 2021').query, 'Dune');
  assert.equal(parseLine('- Dune 2021').year, 2021);
  assert.equal(parseLine('3. Le Parrain – 1972').query, 'Le Parrain');
  assert.equal(parseLine('[x] Heat').query, 'Heat');
  assert.equal(parseLine('https://www.imdb.com/title/tt0111161/').imdbId, 'tt0111161');
  assert.equal(parseLine('   '), null);
  assert.equal(parseLine('# commentaire'), null);
});

test("parseLine garde un titre qui n'est qu'une année", () => {
  assert.deepEqual(parseLine('1917'), { raw: '1917', query: '1917', year: null, imdbId: null });
  assert.equal(parseLine('2001 : l’odyssée de l’espace').query, '2001 : l’odyssée de l’espace');
});

test('parseList retire les doublons', () => {
  const items = parseList('Heat\nheat\nHeat (1995)\n\ntt0113277\nhttps://imdb.com/title/tt0113277');
  assert.equal(items.length, 3);
});

test('fromOmdb lit les trois notes et ignore les N/A', () => {
  const t = fromOmdb({
    imdbID: 'tt1375666', Title: 'Inception', Year: '2010', Type: 'movie', Poster: 'N/A', Runtime: '148 min',
    Genre: 'Action, Adventure, Sci-Fi', imdbRating: '8.8', imdbVotes: '2,612,000', Metascore: '74',
    Ratings: [
      { Source: 'Internet Movie Database', Value: '8.8/10' },
      { Source: 'Rotten Tomatoes', Value: '87%' },
      { Source: 'Metacritic', Value: '74/100' },
    ],
    Director: 'Christopher Nolan', Plot: 'N/A',
  }, 1);
  assert.equal(t.poster, null);
  assert.equal(t.plot, null);
  assert.equal(t.runtime, 148);
  assert.deepEqual(t.genres, ['Action', 'Adventure', 'Sci-Fi']);
  assert.deepEqual(t.ratings, { imdb: 8.8, imdbVotes: 2612000, rt: 87, mc: 74 });
});

test('fromOmdb sans Rotten Tomatoes', () => {
  const t = fromOmdb({ imdbID: 'tt1', Title: 'X', Type: 'series', imdbRating: 'N/A', Ratings: [], totalSeasons: '5' });
  assert.equal(t.ratings.rt, null);
  assert.equal(t.ratings.imdb, null);
  assert.equal(t.seasons, 5);
});

const sample = [
  { id: 'a', title: 'Alien', type: 'movie', status: 'todo', addedAt: 1, ratings: { imdb: 8.5, rt: 93 }, runtime: 117, genres: ['Horror'] },
  { id: 'b', title: 'Brazil', type: 'movie', status: 'watched', addedAt: 3, ratings: { imdb: 7.8, rt: null }, runtime: 132, genres: ['Sci-Fi'] },
  { id: 'c', title: 'Chernobyl', type: 'series', status: 'todo', addedAt: 2, ratings: { imdb: 9.3, rt: 95 }, runtime: 330, genres: ['Drama'], priority: true },
];

test('sortTitles met les notes manquantes à la fin', () => {
  assert.deepEqual(sortTitles(sample, 'rt').map((t) => t.id), ['c', 'a', 'b']);
  assert.deepEqual(sortTitles(sample, 'imdb').map((t) => t.id), ['c', 'a', 'b']);
  assert.deepEqual(sortTitles(sample, 'added').map((t) => t.id), ['b', 'c', 'a']);
  assert.deepEqual(sortTitles(sample, 'priority').map((t) => t.id), ['c', 'b', 'a']);
  assert.deepEqual(sortTitles(sample, 'title').map((t) => t.id), ['a', 'b', 'c']);
});

test('filterTitles combine statut, type, genre, texte et seuils', () => {
  assert.deepEqual(filterTitles(sample, { status: 'todo' }).map((t) => t.id), ['a', 'c']);
  assert.deepEqual(filterTitles(sample, { type: 'series' }).map((t) => t.id), ['c']);
  assert.deepEqual(filterTitles(sample, { genre: 'Horror' }).map((t) => t.id), ['a']);
  assert.deepEqual(filterTitles(sample, { text: 'science' }).map((t) => t.id), ['b']);
  assert.deepEqual(filterTitles(sample, { minRt: 94 }).map((t) => t.id), ['c']);
});

test('stats et durées', () => {
  assert.deepEqual(stats(sample), { total: 3, todo: 2, watched: 1, movieMinutes: 117 });
  assert.equal(formatRuntime(117), '1 h 57');
  assert.equal(formatRuntime(120), '2 h');
  assert.equal(formatRuntime(45), '45 min');
  assert.equal(formatRuntime(null), null);
});

test('petits utilitaires', () => {
  assert.equal(rtState(60), 'fresh');
  assert.equal(rtState(59), 'rotten');
  assert.equal(rtState(null), null);
  assert.equal(firstYear('2008–2013'), 2008);
  assert.equal(
    posterUrl('https://m.media-amazon.com/images/M/abc@._V1_SX300.jpg', 600),
    'https://m.media-amazon.com/images/M/abc@._V1_SX600.jpg',
  );
  assert.equal(posterUrl(null), null);
});
