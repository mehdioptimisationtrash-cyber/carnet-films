"""Parcours complet dans WebKit (iPhone) avec un faux OMDb. Lancer : python3 tests/e2e/run.py (serveur sur 8766)."""
import json, re, sys
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp")
BASE = "http://localhost:8766/"
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
    elif "t" in q:
        t = q["t"].lower()
        alias = {"le parrain": "tt0068646"}
        hits = [v for v in DB.values() if v["Title"].lower() == t and (not q.get("y") or v["Year"].startswith(q["y"]))]
        if t in alias: hits = [DB[alias[t]]]
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

errors = []
with sync_playwright() as p:
    browser = p.webkit.launch()
    ctx = browser.new_context(**p.devices["iPhone 13"], service_workers="block", bypass_csp=True)
    ctx.route("https://www.omdbapi.com/**", omdb)
    ctx.route("https://m.media-amazon.com/**", poster)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.goto(BASE)
    page.screenshot(path=str(OUT / "01-accueil.png"), full_page=True)

    # Mauvaise clé puis bonne clé
    page.fill(".key-form input", "zzzz9999")
    page.click(".key-form button")
    page.wait_for_selector("text=Clé refusée")
    page.fill(".key-form input", "abcd1234")
    page.click(".key-form button")
    page.wait_for_selector(".search-input")

    # Recherche
    page.fill(".search-input", "dune")
    page.wait_for_selector(".result >> text=Dune")
    page.wait_for_selector(".result .chip.rt")
    page.screenshot(path=str(OUT / "02-recherche.png"), full_page=True)
    page.click(".result:first-child .add")
    page.wait_for_selector(".result:first-child .added")

    # Fiche depuis la recherche
    page.click(".result:nth-child(2) .result-main")
    page.wait_for_selector(".detail .score.rt.rotten")
    page.screenshot(path=str(OUT / "03-fiche-recherche.png"))
    page.click(".sheet-head button")

    # Import de liste
    page.click(".import-cta")
    page.fill(".import-text", "Inception\nLe Parrain (1972)\nThe Bear\n- Dune 2021\nhttps://www.imdb.com/title/tt0111161/\nFilm qui n'existe pas\nFight Club")
    page.click("text=Rechercher ces titres")
    page.wait_for_selector(".imp.found"); page.wait_for_selector(".imp.pending", state="detached")
    page.screenshot(path=str(OUT / "04-import.png"), full_page=False)
    assert page.locator(".imp.missing").count() == 1, "une ligne introuvable attendue"
    page.fill(".imp.missing input", "Fight Club")
    page.click(".imp.missing button")
    page.wait_for_selector(".imp.missing", state="detached"); page.wait_for_selector(".imp.pending", state="detached")
    btn = page.locator("text=/Ajouter \\d+ titres? au carnet/")
    label = btn.inner_text()
    assert label.startswith("Ajouter 5"), label  # Dune 2021 déjà dans le carnet, Fight Club dédoublonné
    btn.click()

    # Carnet
    page.click(".tab >> text=Carnet")
    page.wait_for_selector(".grid .card")
    assert page.locator(".grid .card").count() == 6, page.locator(".grid .card").count()
    page.screenshot(path=str(OUT / "05-carnet.png"), full_page=True)

    # Tri par RT, filtre séries
    page.click("summary")
    page.select_option(".select:has-text('Trier par') select", "rt")
    first = page.locator(".grid .card-title").first.inner_text()
    assert first == "The Godfather", first
    page.click(".segmented >> text=Séries")
    assert page.locator(".grid .card").count() == 1
    page.click(".segmented[aria-label=Type] >> text=Tout")

    # Fiche du carnet : marquer vu + note + commentaire
    page.click(".card:has-text('Inception')")
    page.wait_for_selector(".personal")
    page.fill(".personal textarea", "Conseillé par Julie")
    page.click("text=Marquer comme vu")
    page.click(".star >> nth=3")
    page.screenshot(path=str(OUT / "06-fiche-carnet.png"), full_page=False)
    page.click(".sheet-head button")
    assert page.locator(".grid .card").count() == 5
    page.click(".segmented >> text=Vus")
    page.wait_for_selector(".card.watched >> text=★★★★")

    # Persistance après rechargement
    page.reload()
    page.wait_for_selector(".grid .card")
    data = page.evaluate("JSON.parse(localStorage.getItem('carnet-films:v1'))")
    inc = next(t for t in data["titles"] if t["id"] == "tt1375666")
    assert inc["note"] == "Conseillé par Julie" and inc["myRating"] == 4 and inc["status"] == "watched", inc
    assert inc["ratings"] == {"imdb": 8.8, "imdbVotes": 2612000, "rt": 87, "mc": 74}, inc["ratings"]

    # Recherche dans le carnet
    page.click(".segmented >> text=Tout")
    page.fill(".carnet-search input", "coppola")
    assert page.locator(".grid .card").count() == 1

    # Desktop + sombre
    d = browser.new_context(viewport={"width": 1280, "height": 900}, color_scheme="dark", service_workers="block", bypass_csp=True)
    d.route("https://www.omdbapi.com/**", omdb); d.route("https://m.media-amazon.com/**", poster)
    dp = d.new_page()
    dp.goto(BASE)
    dp.evaluate("data => localStorage.setItem('carnet-films:v1', JSON.stringify(data))", {**data, "view": {**data["view"], "status": "all"}})
    dp.reload(); dp.wait_for_selector(".grid .card")
    dp.screenshot(path=str(OUT / "07-desktop-sombre.png"), full_page=True)
    dp.click(".card:has-text('Godfather')"); dp.wait_for_selector(".scores")
    dp.screenshot(path=str(OUT / "08-fiche-desktop.png"))
    # pas de débordement horizontal sur petit écran
    sp = browser.new_context(viewport={"width": 320, "height": 640}, service_workers="block", bypass_csp=True).new_page()
    sp.goto(BASE)
    sp.evaluate("data => localStorage.setItem('carnet-films:v1', JSON.stringify(data))", data)
    sp.reload(); sp.wait_for_selector(".grid .card")
    assert sp.evaluate("document.documentElement.scrollWidth <= 320"), "débordement à 320px"
    sp.screenshot(path=str(OUT / "09-320.png"), full_page=True)
    browser.close()

print("Appels OMDb :", len(calls))
print("Erreurs :", errors or "aucune")
print("OK")
