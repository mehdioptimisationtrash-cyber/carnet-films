"""Parcours complet dans WebKit (iPhone) avec un faux OMDb. Lancer : python3 tests/e2e/run.py (serveur sur 8766)."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp")
sys.path.insert(0, str(Path(__file__).parent))
BASE = "http://localhost:8766/"
from mocks import *

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
    page.fill(".search-input", "les évadés")
    page.wait_for_selector(".result strong >> text=Les Évadés", timeout=20000)  # recherche par titre français
    page.fill(".search-input", "dune")
    page.wait_for_selector(".result >> text=Dune")
    page.wait_for_selector(".result .chip.rt")
    page.screenshot(path=str(OUT / "02-recherche.png"), full_page=True)
    page.wait_for_selector(".result:has-text('2021') .add")
    page.click(".result:has-text('2021') .add")
    page.wait_for_selector(".result:has-text('2021') .added")

    # Fiche depuis la recherche
    page.click(".result:has-text('1984') .result-main")
    page.wait_for_selector(".detail .score.rt.rotten")
    page.screenshot(path=str(OUT / "03-fiche-recherche.png"))
    page.click(".sheet-head button")

    # Import de liste
    page.click(".import-cta")
    page.fill(".import-text", "Inception\nLe Parrain (1972)\nThe Bear\n- Dune 2021\nhttps://www.imdb.com/title/tt0111161/\nFilm qui n'existe pas\nFight Club")
    page.click("text=Rechercher ces titres")
    page.wait_for_selector(".imp.found"); page.wait_for_selector(".imp.pending", state="detached", timeout=60000)
    page.wait_for_selector(".imp strong >> text=Les Évadés", timeout=20000)  # titre français via Wikidata
    assert page.locator(".imp strong >> text=Le Parrain").count() == 1, "Le Parrain retrouvé par son titre français"
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
    page.wait_for_selector(".card-title >> text=Le Parrain", timeout=30000)  # enrichissement en arrière-plan
    first = page.locator(".grid .card-title").first.inner_text()
    assert first == "Le Parrain", first
    page.click(".segmented >> text=Séries")
    assert page.locator(".grid .card").count() == 1
    page.click(".segmented[aria-label=Type] >> text=Tout")

    # Fiche du carnet : marquer vu + note + commentaire
    page.click(".card:has-text('Inception')")
    page.wait_for_selector(".personal")
    page.wait_for_selector(".synopsis >> text=rêve partagé", timeout=20000)
    page.screenshot(path=str(OUT / "06b-synopsis.png"))
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
    dp.click(".card:has-text('Le Parrain')"); dp.wait_for_selector(".synopsis >> text=Corleone", timeout=20000)
    dp.wait_for_timeout(600); dp.screenshot(path=str(OUT / "08-fiche-desktop.png"))
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
