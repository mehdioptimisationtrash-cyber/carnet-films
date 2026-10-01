# CarnetFilms — INDEX

> Dernière analyse: 2026-10-01

Site : https://mehdioptimisationtrash-cyber.github.io/carnet-films/ (repo `mehdioptimisationtrash-cyber/carnet-films`, Pages sur `main`).

PWA (iPhone/Safari) de watchlist : onglets **Carnet** (mur de jaquettes, filtres/tri) et **Rechercher** (+ import d'une liste collée). Sans framework ni serveur, données en localStorage.

## Source de données
OMDb (`www.omdbapi.com`, CORS ouvert) : recherche, jaquettes (m.media-amazon.com), notes IMDb + Rotten Tomatoes + Metacritic. **Clé gratuite obligatoire** (1 000 demandes/jour), saisie par Mehdi à l'accueil. Testé sans clé : la suggestion IMDb n'a pas de CORS, imdbapi.dev injoignable → pas d'alternative sans clé. Limite : titres français mal reconnus (OMDb = titres originaux), résumés en anglais.

## Architecture & fichiers clés
| Fichier | Rôle |
|---|---|
| `js/model.js` | Pur/testé : lecture de liste (puces, années, liens IMDb, doublons), conversion fiche OMDb, tri/filtres, stats |
| `js/omdb.js` | Appels OMDb (search, details avec cache de session, resolve d'une ligne, checkKey, pool de requêtes) |
| `js/store.js` | État localStorage `carnet-films:v1`, immuable, export/import JSON |
| `js/views/carnet.js` · `search.js` · `import.js` · `detail.js` · `settings.js` | Écrans (settings = accueil clé + réglages) |
| `sw.js` | Réseau d'abord pour l'app, cache d'abord pour les jaquettes. **Bump `CACHE_VERSION` + `js/version.js` à chaque modif** |
| `tests/model.test.js` | `npm test` |
| `tests/e2e/run.py` | Parcours complet WebKit iPhone avec faux OMDb (`npm run serve` d'abord) |
| `tools/make_icons.py` | PNG des icônes depuis `icons/icon.svg` |

## Activité récente
- 2026-10-01 : création, tests e2e OK, publié et vérifié en ligne (vrai OMDb répond). v2 : plus de rechargement surprise à la 1re visite.

## TODO
- Mehdi crée sa clé OMDb et l'installe sur l'iPhone (Safari → Partager → Sur l'écran d'accueil).
- Option : TMDB pour les titres/résumés en français ; synchro Google Sheets comme assiette.
