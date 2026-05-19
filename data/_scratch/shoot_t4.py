"""Standalone screenshots for Tier-4 demos."""
import asyncio
import os
from pathlib import Path

OUT = Path(os.path.expandvars("%TEMP%/rg-shots"))
OUT.mkdir(parents=True, exist_ok=True)

async def main():
    import nodriver as uc
    browser = await uc.start(headless=False, lang="en-US")
    try:
        page = await browser.get('http://127.0.0.1:5500/demos/audio-reactive.html')
        await page.set_window_size(width=1280, height=800)
        await asyncio.sleep(2.0)
        await page.save_screenshot(str(OUT / "demo10-audio-idle.png"))
        # Trigger play (simulated click — but synth requires user gesture in some browsers)
        await page.evaluate("document.getElementById('play').click()")
        await asyncio.sleep(3.0)
        await page.save_screenshot(str(OUT / "demo10-audio-playing.png"))
        diag = await page.evaluate("""JSON.stringify({
            cw: document.getElementById('c').width,
            ch: document.getElementById('c').height,
            amp: document.getElementById('amp').textContent
        })""")
        print('DEMO 10 DIAG:', diag)

        # Demo #11 — L-system tree
        page11 = await browser.get('http://127.0.0.1:5500/demos/l-system-tree.html')
        await asyncio.sleep(0.5)
        await page11.save_screenshot(str(OUT / "demo11-lsys-growing.png"))
        await asyncio.sleep(2.5)
        await page11.save_screenshot(str(OUT / "demo11-lsys-grown.png"))
        # Cycle archetypes
        for i in range(4):
            await page11.evaluate("document.getElementById('archetype').click()")
            await asyncio.sleep(3.0)
            await page11.save_screenshot(str(OUT / f"demo11-lsys-arch{i+2}.png"))
        diag11 = await page11.evaluate("""JSON.stringify({
            cw: document.getElementById('c').width,
            ch: document.getElementById('c').height,
            info: document.getElementById('info').textContent
        })""")
        print('DEMO 11 DIAG:', diag11)

        # Demo #12 — Voronoi
        page12 = await browser.get('http://127.0.0.1:5500/demos/voronoi.html')
        await asyncio.sleep(2.0)
        await page12.save_screenshot(str(OUT / "demo12-voronoi-cells.png"))
        await page12.evaluate("document.querySelector('[data-mode=\"1\"]').click();")
        await asyncio.sleep(1.0)
        await page12.save_screenshot(str(OUT / "demo12-voronoi-edges.png"))
        await page12.evaluate("document.querySelector('[data-mode=\"2\"]').click();")
        await asyncio.sleep(1.0)
        await page12.save_screenshot(str(OUT / "demo12-voronoi-worley.png"))
        await page12.evaluate("document.querySelector('[data-mode=\"3\"]').click();")
        await asyncio.sleep(1.0)
        await page12.save_screenshot(str(OUT / "demo12-voronoi-cracked.png"))
        diag12 = await page12.evaluate("""JSON.stringify({
            cw: document.getElementById('c').width,
            ch: document.getElementById('c').height
        })""")
        print('DEMO 12 DIAG:', diag12)

        print('SHOTS:', sorted([f for f in os.listdir(OUT) if f.startswith(('demo10-','demo11-','demo12-'))]))
    finally:
        browser.stop()

if __name__ == "__main__":
    asyncio.run(main())
