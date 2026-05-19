"""Standalone screenshot pass for the live demos."""
import asyncio
import os
from pathlib import Path

OUT = Path(os.path.expandvars("%TEMP%/rg-shots"))
OUT.mkdir(parents=True, exist_ok=True)

async def main():
    import nodriver as uc
    browser = await uc.start(headless=False, lang="en-US")
    try:
        # Demo #1 — curl-noise particles (sanity check)
        page = await browser.get('http://127.0.0.1:5500/demos/curl-noise-particles.html')
        await page.set_window_size(width=1280, height=800)
        await asyncio.sleep(2.5)
        await page.save_screenshot(str(OUT / "demo1-curl-noise.png"))
        diag1 = await page.evaluate("""JSON.stringify({
            err: document.querySelector('.err')?.textContent || null,
            cw: document.getElementById('c').width,
            ch: document.getElementById('c').height
        })""")
        print('DEMO 1 DIAG:', diag1)

        # Demo #2 — fluid sim (the new one)
        page2 = await browser.get('http://127.0.0.1:5500/demos/fluid-sim.html')
        await asyncio.sleep(0.4)
        # First frame
        await page2.save_screenshot(str(OUT / "demo2-fluid-t0.png"))
        # Let auto-mode splats build up
        await asyncio.sleep(3.0)
        await page2.save_screenshot(str(OUT / "demo2-fluid-t3.png"))
        # And longer
        await asyncio.sleep(4.0)
        await page2.save_screenshot(str(OUT / "demo2-fluid-t7.png"))
        diag2 = await page2.evaluate("""JSON.stringify({
            err: document.querySelector('.err')?.textContent || null,
            cw: document.getElementById('c').width,
            ch: document.getElementById('c').height
        })""")
        print('DEMO 2 DIAG:', diag2)

        # Demo #3 — volumetric sky
        page3 = await browser.get('http://127.0.0.1:5500/demos/boids.html')
        await asyncio.sleep(2.0)
        await page3.save_screenshot(str(OUT / "demo3-sky-dawn.png"))

        # Sun at midday
        await page3.evaluate("var s=document.getElementById('sun'); s.value=0.5; s.dispatchEvent(new Event('input'));")
        await asyncio.sleep(1.5)
        await page3.save_screenshot(str(OUT / "demo3-sky-noon.png"))

        # Sun at dusk
        await page3.evaluate("var s=document.getElementById('sun'); s.value=0.85; s.dispatchEvent(new Event('input'));")
        await asyncio.sleep(1.5)
        await page3.save_screenshot(str(OUT / "demo3-sky-dusk.png"))

        diag3 = await page3.evaluate("""JSON.stringify({
            err: document.querySelector('.err')?.textContent || null,
            cw: document.getElementById('c').width,
            ch: document.getElementById('c').height
        })""")
        print('DEMO 3 DIAG:', diag3)

        print('SHOTS:', sorted(os.listdir(OUT)))
    finally:
        browser.stop()

if __name__ == "__main__":
    asyncio.run(main())
