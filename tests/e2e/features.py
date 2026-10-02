"""Sauvegarde en ligne (2 appareils), recherche avancée et « Pour moi » dans WebKit iPhone.
Faux OMDb + fausse feuille Google ; Wikidata / Wikipédia réels. Lancer : python3 tests/e2e/features.py <dossier captures>."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from playwright.sync_api import sync_playwright
from mocks import *
import re

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp")
BASE = "http://localhost:8766/"
errors = []

def new_page(browser, p):
    ctx = browser.new_context(**p.devices["iPhone 13"], service_workers="block")
    wire(ctx)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and "Failed to load resource" not in m.text and errors.append(m.text))
    return page

with sync_playwright() as p:
    browser = p.webkit.launch()
    page = new_page(browser, p)
    page.goto(BASE)
    page.fill(".key-form input", "abcd1234"); page.click(".key-form button")
    page.wait_for_selector(".search-input")

    # ——— Recherche avancée : films réalisés par Christopher Nolan, IMDb 7+ ———
    page.click(".advanced > summary")
    page.fill(".adv-person input", "Christopher Nolan")
    page.select_option(".adv-person select", "P57")
    page.select_option(".select:has-text('IMDb minimum') select", "7")
    page.click("text=Lancer la recherche avancée")
    page.wait_for_selector(".advanced .result >> text=Inception", timeout=45000)
    page.wait_for_selector(".advanced .status >> text=/\\d+ titres?/", timeout=45000)
    n_adv = page.locator(".advanced .result").count()
    assert n_adv >= 6, n_adv
    page.screenshot(path=str(OUT / "10-avancee.png"), full_page=True)

    # ——— Pour moi : 3 coups de cœur → liens + suggestions ———
    page.click(".tab >> text=Pour moi")
    assert page.locator("text=Trouver mes suggestions").is_disabled()
    for q, btn in (("inception", "❤❤ Adoré"), ("interstellar", "❤❤ Adoré"), ("parasite", "❤ Aimé")):
        page.fill(".love-search input", q); page.click(".love-search button")
        page.wait_for_selector(f".love-row >> text=/{q}/i", timeout=20000)
        page.locator(".love-row").filter(has_text=re.compile(q, re.I)).first.locator(f"text={btn}").click()
        page.wait_for_selector(f".loved-chip >> text=/{q}/i")
    page.click("text=Trouver mes suggestions")
    page.wait_for_selector(".links >> text=Christopher Nolan", timeout=60000)
    try:
        page.wait_for_selector(".sugg", timeout=90000)
    except Exception:
        print("DBG", page.locator(".disc-cta").inner_text(), errors); page.screenshot(path=str(OUT / "dbg.png"), full_page=True); raise
    first_why = page.locator(".sugg .why").first.inner_text()
    print("liens :", page.locator(".links li").count(), "| suggestions :", page.locator(".sugg").count(), "| 1re raison :", first_why.splitlines()[0])
    assert page.locator(".sugg").count() >= 6
    page.screenshot(path=str(OUT / "11-pour-moi.png"), full_page=True)
    before = page.locator(".sugg").count()
    page.locator(".sugg").first.locator("text=Pas pour moi").click()
    page.locator(".sugg").first.locator("text=Déjà vu").click()
    page.locator(".sugg").first.locator(".star >> nth=4").click()
    page.locator(".sugg").first.locator("text=+ À voir").click()
    assert page.locator(".sugg").count() == before - 3, (page.locator(".sugg").count(), before)
    page.wait_for_selector("text=Recalculer avec mes nouveaux avis")
    state = page.evaluate("JSON.parse(localStorage.getItem('carnet-films:v1'))")
    assert len(state["dismissed"]) == 1 and sum(1 for t in state["titles"] if t.get("myRating") == 5) == 3, state["dismissed"]

    # ——— Sauvegarde en ligne : brancher la feuille ———
    page.click(".tab >> text=Réglages")
    page.wait_for_selector("text=n’est que sur cet appareil")
    page.click(".cloud details summary")
    form = page.locator(".cloud details .cloud-form")
    form.locator("input").nth(0).fill(SHEET_URL)
    form.locator("input").nth(1).fill(SHEET_TOKEN)
    form.locator("button[type=submit]").click()
    page.wait_for_selector("text=Ton carnet est enregistré dans ta feuille", timeout=20000)
    page.wait_for_selector(".cloud-status >> text=/Enregistré en ligne|À jour/", timeout=20000)
    page.screenshot(path=str(OUT / "12-feuille.png"), full_page=True)
    assert len(SHEET["titles"]) == len(state["titles"]) == 5, (len(SHEET["titles"]), len(state["titles"]))
    assert SHEET["settings"]["omdbKey"] == "abcd1234"
    page.click(".sheet-head button")

    # Changement → envoyé automatiquement
    page.click(".tab >> text=Carnet")
    page.click(".segmented >> text=Tout")
    page.click(".card:has-text('Parasite')")
    page.fill(".personal textarea", "Revoir en VO")
    page.click("text=Marquer comme vu") if page.locator("text=Marquer comme vu").count() else None
    page.click(".personal .star >> nth=4")
    page.click(".sheet-head button")
    page.wait_for_timeout(3500)
    assert SHEET["titles"]["tt6751668"]["myRating"] == 5 and SHEET["titles"]["tt6751668"]["note"] == "Revoir en VO", SHEET["titles"]["tt6751668"]

    # ——— Deuxième appareil : rien en local, tout revient de la feuille (clé OMDb comprise) ———
    other = new_page(browser, p)
    other.goto(BASE)
    other.click(".restore summary")
    other.locator(".restore input").nth(0).fill(SHEET_URL)
    other.locator(".restore input").nth(1).fill(SHEET_TOKEN)
    other.click("text=Récupérer mon carnet")
    other.wait_for_selector(".grid .card", timeout=20000)
    other.click(".segmented >> text=Tout")
    n_other = other.locator(".grid .card").count()
    assert n_other == len(SHEET["titles"]), (n_other, len(SHEET["titles"]))
    # supprimé sur l'appareil 2 → disparaît de la feuille puis de l'appareil 1
    other.click(".card:has-text('Inception')")
    other.on("dialog", lambda d: d.accept())
    other.click("text=Retirer du carnet")
    other.wait_for_timeout(3500)
    assert "tt1375666" not in SHEET["titles"]
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_timeout(2500)
    assert page.locator(".card:has-text('Inception')").count() == 0
    other.screenshot(path=str(OUT / "13-autre-appareil.png"), full_page=True)
    browser.close()

print("Envois à la feuille :", SHEET["posts"])
print("Erreurs :", errors or "aucune")
print("OK")
