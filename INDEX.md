# CarnetFilms — INDEX

> Dernière analyse: 2026-10-02

Site : https://mehdioptimisationtrash-cyber.github.io/carnet-films/ (repo `mehdioptimisationtrash-cyber/carnet-films`, Pages sur `main`).

PWA (iPhone/Safari) de watchlist : onglets **Carnet** (mur de jaquettes, filtres/tri), **Rechercher** (simple + avancée + import de liste), **Pour moi** (suggestions apprises des goûts). Sans framework ni serveur.

**Stockage (exigence de Mehdi : en ligne, pas seulement le navigateur)** : feuille Google Sheets de Mehdi via Apps Script (`apps-script/Code.gs`, onglets `carnet` + `reglages` dont la clé OMDb). Fusion à chaque ouverture/retour dans l'app, envoi 2 s après chaque changement. localStorage = copie hors ligne. Adresse + code secret gardés sur l'appareil (affichés dans Réglages pour un 2e appareil).

## Source de données
- OMDb (`www.omdbapi.com`, CORS ouvert) : recherche, jaquettes (m.media-amazon.com), notes IMDb + Rotten Tomatoes + Metacritic. **Clé gratuite obligatoire** (1 000 demandes/jour), saisie à l'accueil. Pas d'alternative sans clé (suggestion IMDb sans CORS, imdbapi.dev injoignable).
- **Français (exigence de Mehdi : synopsis FR rédigé, jamais traduit)** : Wikidata SPARQL (identifiant IMDb P345 → article fr.wikipedia) puis extrait Wikipédia → section « Synopsis » (sinon intro). Donne aussi le titre français. Recherche/import par titre français : recherche fr.wikipedia → Q-id → IMDb. AlloCiné : pas d'accès ouvert ni CORS. Couverture testée : 22/22 titres (classiques + récents). Wikipédia limite le débit (429) → attente + réessai.

## Architecture & fichiers clés
| Fichier | Rôle |
|---|---|
| `js/model.js` | Pur/testé : lecture de liste (puces, années, liens IMDb, doublons), conversion fiche OMDb, tri/filtres, stats |
| `js/omdb.js` | Appels OMDb (search, details avec cache de session, resolve d'une ligne, checkKey, pool de requêtes) |
| `js/french.js` | Wikidata/Wikipédia : `fetchFrench`, `frenchTitles`, `findByFrenchTitle`, `resolveAnyTitle`, `enrichCarnet` (arrière-plan, `meta.background`) |
| `js/synopsis.js` | Pur/testé : découpe de l'article, choix de la section synopsis, nettoyage du titre FR |
| `js/sync.js` · `js/sync-model.js` | Sauvegarde en ligne : empreintes, envoi des changements, fusion (le téléphone gagne s'il a modifié, suppressions respectées des 2 côtés) |
| `apps-script/Code.gs` | Script Google ; l'app le fournit avec un code secret aléatoire déjà inséré (bouton « Copier le script ») |
| `js/views/cloud.js` | Réglage pas à pas + « J'ai déjà un carnet en ligne » sur l'accueil |
| `js/taste.js` | Pur/testé : poids des notes (5★=+2 … 1★=-2, écarté=-1, à voir=0,1), profil de traits, liens communs, score, variété |
| `js/wikidata.js` | Traits Wikidata (réal., création, scénario, acteurs principaux, musique, image, thèmes, genres, pays), candidats (2 requêtes), recherche avancée |
| `js/recommend.js` · `js/views/discover.js` | Onglet Pour moi : coups de cœur (≥3), « ce qui relie tes goûts », suggestions expliquées (+ À voir / Déjà vu ★ / Pas pour moi) |
| `js/views/advanced.js` · `result-card.js` | Recherche avancée (personne+rôle, genre, pays, type, années, IMDb/RT min, tri) |
| `js/store.js` | État localStorage `carnet-films:v1`, immuable, export/import JSON |
| `js/views/carnet.js` · `search.js` · `import.js` · `detail.js` · `settings.js` | Écrans (settings = accueil clé + réglages) |
| `sw.js` | Réseau d'abord pour l'app, cache d'abord pour les jaquettes. **Bump `CACHE_VERSION` + `js/version.js` à chaque modif** |
| `tests/model.test.js` | `npm test` |
| `tests/e2e/run.py` · `features.py` · `mocks.py` | WebKit iPhone : faux OMDb + fausse feuille Google, Wikidata/Wikipédia réels (`npm run serve` d'abord) |
| `tools/make_icons.py` | PNG des icônes depuis `icons/icon.svg` |

## Activité récente
- 2026-10-01 : création, tests e2e OK, publié et vérifié en ligne (vrai OMDb répond). v2 : plus de rechargement surprise à la 1re visite.
- 2026-10-01 : v3 — synopsis + titres français (Wikipédia), recherche et import par titre français ; vérifié en ligne.
- 2026-10-02 : v4 — sauvegarde Google Sheets, recherche avancée, onglet Pour moi. CSP style-src 'unsafe-inline' (WebKit bloquait des styles internes). Import : correspondance Wikipédia stricte (`titleMatches`).

## TODO
- Mehdi crée sa clé OMDb et l'installe sur l'iPhone (Safari → Partager → Sur l'écran d'accueil).
- Mehdi branche sa feuille Google (Réglages → Sauvegarde en ligne). Le vrai Apps Script n'a pas encore été testé en conditions réelles (seulement fausse feuille).
