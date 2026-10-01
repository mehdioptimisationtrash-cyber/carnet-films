"""Génère icons/icon-180.png et icon-512.png depuis icons/icon.svg (Playwright Chromium)."""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
svg = (root / "icons" / "icon.svg").read_text()
with sync_playwright() as p:
    browser = p.chromium.launch()
    for size in (180, 512):
        page = browser.new_page(viewport={"width": size, "height": size})
        page.set_content(f'<body style="margin:0;background:#15100f">{svg.replace("<svg ", f"<svg width={size} height={size} ", 1)}</body>')
        page.screenshot(path=str(root / "icons" / f"icon-{size}.png"), clip={"x": 0, "y": 0, "width": size, "height": size})
    browser.close()
