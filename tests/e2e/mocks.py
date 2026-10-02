"""Faux services pour les tests e2e : OMDb, affiches, et une feuille Google (application web Apps Script)."""
import json, re
from urllib.parse import urlparse, parse_qs

DB = {
  "tt1375666": dict(Title="Inception", Year="2010", Type="movie", Runtime="148 min", Genre="Action, Adventure, Sci-Fi",
                    Director="Christopher Nolan", Actors="Leonardo DiCaprio, Joseph Gordon-Levitt", imdbRating="8.8", imdbVotes="2,612,000",
                    Metascore="74", Ratings=[{"Source":"Internet Movie Database","Value":"8.8/10"},{"Source":"Rotten Tomatoes","Value":"87%"},{"Source":"Metacritic","Value":"74/100"}],
                    Plot="A thief who steals corporate secrets through dream-sharing technology."),
  "tt0068646": dict(Title="The Godfather", Year="1972", Type="movie", Runtime="175 min", Genre="Crime, Drama", Director="Francis Ford Coppola",
                    imdbRating="9.2", imdbVotes="2,100,000", Metascore="100", Ratings=[{"Source":"Rotten Tomatoes","Value":"97%"}], Plot="The aging patriarch..."),
  "tt14452776": dict(Title="The Bear", Year="2022–", Type="series", Runtime="30 min", Genre="Comedy, Drama", totalSeasons="4",
                     imdbRating="8.5", imdbVotes="300,000", Ratings=[{"Source":"Internet Movie Database","Value":"8.5/10"}], Plot="A young chef..."),
  "tt0111161": dict(Title="The Shawshank Redemption", Year="1994", Type="movie", Runtime="142 min", Genre="Drama", imdbRating="9.3",
                    Ratings=[{"Source":"Rotten Tomatoes","Value":"89%"}], Poster="N/A"),
  "tt0137523": dict(Title="Fight Club", Year="1999", Type="movie", Runtime="139 min", Genre="Drama", imdbRating="8.8",
                    Ratings=[{"Source":"Rotten Tomatoes","Value":"79%"}]),
  "tt1160419": dict(Title="Dune", Year="2021", Type="movie", Runtime="155 min", Genre="Action, Adventure, Drama, Sci-Fi", imdbRating="8.0",
                    Ratings=[{"Source":"Rotten Tomatoes","Value":"83%"}], Metascore="74"),
  "tt0816692": dict(Title="Interstellar", Year="2014", Type="movie", Runtime="169 min", Genre="Adventure, Drama, Sci-Fi",
                    Director="Christopher Nolan", Actors="Matthew McConaughey, Anne Hathaway, Jessica Chastain", imdbRating="8.7",
                    Ratings=[{"Source":"Rotten Tomatoes","Value":"73%"}]),
  "tt6751668": dict(Title="Parasite", Year="2019", Type="movie", Runtime="132 min", Genre="Drama, Thriller", Director="Bong Joon Ho",
                    Actors="Song Kang-ho, Lee Sun-kyun, Cho Yeo-jeong", imdbRating="8.5", Ratings=[{"Source":"Rotten Tomatoes","Value":"99%"}]),
  "tt0087182": dict(Title="Dune", Year="1984", Type="movie", Runtime="137 min", Genre="Action, Adventure, Sci-Fi", imdbRating="6.3",
                    Ratings=[{"Source":"Rotten Tomatoes","Value":"36%"}]),
}
COLORS = ["#7a2e1d", "#1d3f7a", "#2e6b3a", "#6b2e6b", "#7a6a1d", "#1d6b6b", "#444"]
for i, (k, v) in enumerate(DB.items()):
    v.update(imdbID=k, Response="True")
    v.setdefault("Poster", f"https://m.media-amazon.com/images/M/{k}@._V1_SX300.jpg")
calls = []

def omdb(route):
    q = {k: v[0] for k, v in parse_qs(urlparse(route.request.url).query).items()}
    calls.append(q)
    body = {"Response": "False", "Error": "Movie not found!"}
    if q.get("apikey") != "abcd1234":
        body = {"Response": "False", "Error": "Invalid API key!"}
    elif "i" in q and q["i"] in DB:
        body = DB[q["i"]]
    elif "i" in q and re.fullmatch(r"tt\d+", q["i"]):
        # Titre inconnu du faux OMDb (suggestions, recherche avancée) : fiche générique crédible.
        n = int(q["i"][2:]) % 30
        body = dict(imdbID=q["i"], Title=f"Titre {q['i']}", Year="2000", Type="series" if n % 5 == 0 else "movie",
                    Runtime="110 min", Genre="Drama, Sci-Fi" if n % 2 else "Thriller", imdbRating=f"{6 + n / 10:.1f}",
                    Ratings=[{"Source": "Rotten Tomatoes", "Value": f"{55 + n}%"}], Poster="N/A", Response="True")
    elif "t" in q:
        t = q["t"].lower()
        hits = [v for v in DB.values() if v["Title"].lower() == t and (not q.get("y") or v["Year"].startswith(q["y"]))]
        if hits: body = hits[0]
    elif "s" in q:
        s = q["s"].lower()
        hits = [v for v in DB.values() if s in v["Title"].lower() and (not q.get("type") or v["Type"] == q["type"])]
        if hits:
            body = {"Response": "True", "totalResults": str(len(hits)),
                    "Search": [{k: v[k] for k in ("Title", "Year", "imdbID", "Type", "Poster")} for v in hits]}
    route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(body))

def poster(route):
    m = re.search(r"/M/(tt\d+)", route.request.url)
    idx = list(DB).index(m.group(1)) if m and m.group(1) in DB else 0
    title = DB.get(m.group(1), {}).get("Title", "?") if m else "?"
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="444"><rect width="300" height="444" fill="{COLORS[idx % len(COLORS)]}"/><text x="20" y="400" font-size="34" fill="#fff" font-family="Georgia">{title}</text></svg>'
    route.fulfill(status=200, content_type="image/svg+xml", body=svg)


SHEET = {"titles": {}, "settings": {}, "posts": 0}
SHEET_URL = "https://script.google.com/macros/s/TEST_DEPLOYMENT/exec"
SHEET_TOKEN = "codeSecretDeTest123456"

def sheet(route):
    req = route.request
    if req.method == "GET":
        q = {k: v[0] for k, v in parse_qs(urlparse(req.url).query).items()}
        body = ({"ok": True, "v": 1, "titles": list(SHEET["titles"].values()), "settings": SHEET["settings"]}
                if q.get("token") == SHEET_TOKEN else {"ok": False, "error": "unauthorized"})
    else:
        data = json.loads(req.post_data or "{}")
        if data.get("token") != SHEET_TOKEN:
            body = {"ok": False, "error": "unauthorized"}
        else:
            SHEET["posts"] += 1
            for i in data.get("remove", []): SHEET["titles"].pop(i, None)
            for t in data.get("upsert", []): SHEET["titles"][t["id"]] = t
            SHEET["settings"].update(data.get("settings") or {})
            body = {"ok": True, "v": 1}
    route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(body))

def wire(ctx):
    ctx.route("https://www.omdbapi.com/**", omdb)
    ctx.route("https://m.media-amazon.com/**", poster)
    ctx.route("https://script.google.com/**", sheet)
