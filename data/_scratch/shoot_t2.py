"""Standalone screenshots for Tier-2 demos."""
import asyncio
import os
from pathlib import Path

OUT = Path(os.path.expandvars("%TEMP%/rg-shots"))
OUT.mkdir(parents=True, exist_ok=True)

async def main():
    import nodriver as uc
    browser = await uc.start(headless=False, lang="en-US")
    try:
        page = await browser.get('http://127.0.0.1:5500/demos/sdf-raymarch.html')
        await page.set_window_size(width=1280, height=800)
        await asyncio.sleep(2.0)
        await page.save_screenshot(str(OUT / "demo4-sdf-lattice.png"))

        await page.evaluate("document.querySelector('[data-scene=\"1\"]').click();")
        await asyncio.sleep(1.5)
        await page.save_screenshot(str(OUT / "demo4-sdf-hall.png"))

        await page.evaluate("document.querySelector('[data-scene=\"2\"]').click();")
        await asyncio.sleep(1.5)
        await page.save_screenshot(str(OUT / "demo4-sdf-fractal.png"))

        diag = await page.evaluate("""JSON.stringify({
            err: document.querySelector('.err')?.textContent || null,
            cw: document.getElementById('c').width,
            ch: document.getElementById('c').height
        })""")
        print('DEMO 4 DIAG:', diag)

        # Demo #5 — retro post
        page5 = await browser.get('http://127.0.0.1:5500/demos/retro-post.html')
        await asyncio.sleep(2.0)
        await page5.save_screenshot(str(OUT / "demo5-retro-all-on.png"))

        # Toggle off everything to see the raw scene
        await page5.evaluate("""document.querySelectorAll('.controls button').forEach(b => b.click());""")
        await asyncio.sleep(1.0)
        await page5.save_screenshot(str(OUT / "demo5-retro-all-off.png"))

        # Just dither + scanlines
        await page5.evaluate("""document.querySelector('[data-fx=\"dither\"]').click();
                              document.querySelector('[data-fx=\"scan\"]').click();
                              document.querySelector('[data-fx=\"pixel\"]').click();""")
        await asyncio.sleep(1.0)
        await page5.save_screenshot(str(OUT / "demo5-retro-pixel-dither-scan.png"))

        diag5 = await page5.evaluate("""JSON.stringify({
            err: document.querySelector('.err')?.textContent || null,
            cw: document.getElementById('c').width,
            ch: document.getElementById('c').height
        })""")
        print('DEMO 5 DIAG:', diag5)

        # Demo #6 — boids
        page6 = await browser.get('http://127.0.0.1:5500/demos/boids.html')
        await asyncio.sleep(2.5)
        await page6.save_screenshot(str(OUT / "demo6-boids-t2.png"))

        # Move "mouse" to mid-canvas to test interaction (synth pointer event)
        await page6.evaluate("""(() => {
            const c = document.getElementById('c');
            const r = c.getBoundingClientRect();
            const ev = new PointerEvent('pointermove', {
                clientX: r.left + r.width * 0.6,
                clientY: r.top  + r.height * 0.5,
                bubbles: true, pointerType: 'mouse'
            });
            c.dispatchEvent(ev);
        })()""")
        await asyncio.sleep(3.0)
        await page6.save_screenshot(str(OUT / "demo6-boids-cursor.png"))

        diag6 = await page6.evaluate("""JSON.stringify({
            cw: document.getElementById('c').width,
            ch: document.getElementById('c').height
        })""")
        print('DEMO 6 DIAG:', diag6)

        print('SHOTS:', sorted([f for f in os.listdir(OUT) if f.startswith(('demo4-','demo5-','demo6-'))]))
    finally:
        browser.stop()

if __name__ == "__main__":
    asyncio.run(main())
