"""Standalone screenshots for Tier-3 demos."""
import asyncio
import os
from pathlib import Path

OUT = Path(os.path.expandvars("%TEMP%/rg-shots"))
OUT.mkdir(parents=True, exist_ok=True)

async def main():
    import nodriver as uc
    browser = await uc.start(headless=False, lang="en-US")
    try:
        # Demo #7 — WFC tiles
        page = await browser.get('http://127.0.0.1:5500/demos/wfc-tiles.html')
        await page.set_window_size(width=1280, height=800)
        await asyncio.sleep(0.6)
        await page.save_screenshot(str(OUT / "demo7-wfc-early.png"))
        await asyncio.sleep(2.5)
        await page.save_screenshot(str(OUT / "demo7-wfc-mid.png"))
        # Speed up to fast
        await page.evaluate("document.getElementById('speed').click(); document.getElementById('speed').click();")
        await asyncio.sleep(3.0)
        await page.save_screenshot(str(OUT / "demo7-wfc-fast.png"))
        diag7 = await page.evaluate("""JSON.stringify({
            cw: document.getElementById('c').width,
            ch: document.getElementById('c').height,
            status: document.getElementById('status').textContent
        })""")
        print('DEMO 7 DIAG:', diag7)

        # Demo #8 — PBR studio
        page8 = await browser.get('http://127.0.0.1:5500/demos/pbr-studio.html')
        await asyncio.sleep(2.0)
        await page8.save_screenshot(str(OUT / "demo8-pbr-default.png"))
        # Polished metal: low roughness, full metallic
        await page8.evaluate("""(() => {
            const r = document.getElementById('roughness'); r.value = 0.10; r.dispatchEvent(new Event('input'));
            const m = document.getElementById('metallic');  m.value = 1.00; m.dispatchEvent(new Event('input'));
        })()""")
        await asyncio.sleep(1.0)
        await page8.save_screenshot(str(OUT / "demo8-pbr-polished.png"))
        # Rough plastic: high roughness, no metal, blue hue
        await page8.evaluate("""(() => {
            const r = document.getElementById('roughness'); r.value = 0.85; r.dispatchEvent(new Event('input'));
            const m = document.getElementById('metallic');  m.value = 0.00; m.dispatchEvent(new Event('input'));
            const h = document.getElementById('hue');       h.value = 200;  h.dispatchEvent(new Event('input'));
        })()""")
        await asyncio.sleep(1.0)
        await page8.save_screenshot(str(OUT / "demo8-pbr-rough-blue.png"))
        diag8 = await page8.evaluate("""JSON.stringify({
            cw: document.getElementById('c').width,
            ch: document.getElementById('c').height
        })""")
        print('DEMO 8 DIAG:', diag8)

        # Demo #9 — marching squares
        page9 = await browser.get('http://127.0.0.1:5500/demos/marching-squares.html')
        await asyncio.sleep(2.5)
        await page9.save_screenshot(str(OUT / "demo9-marching-topo.png"))
        # Toggle off layers
        await page9.evaluate("document.getElementById('layers').click()")
        await asyncio.sleep(1.5)
        await page9.save_screenshot(str(OUT / "demo9-marching-single.png"))
        # More balls
        await page9.evaluate("document.getElementById('balls').click()")
        await page9.evaluate("document.getElementById('layers').click()")
        await asyncio.sleep(1.5)
        await page9.save_screenshot(str(OUT / "demo9-marching-9balls.png"))
        diag9 = await page9.evaluate("""JSON.stringify({
            cw: document.getElementById('c').width,
            ch: document.getElementById('c').height
        })""")
        print('DEMO 9 DIAG:', diag9)

        print('SHOTS:', sorted([f for f in os.listdir(OUT) if f.startswith(('demo7-','demo8-','demo9-'))]))
    finally:
        browser.stop()

if __name__ == "__main__":
    asyncio.run(main())
