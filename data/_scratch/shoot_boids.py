"""Capture the new boids demo at multiple times to verify trail length + chase dynamics."""
import asyncio, os
from pathlib import Path

OUT = Path(os.path.expandvars("%TEMP%/rg-shots"))

async def main():
    import nodriver as uc
    browser = await uc.start(headless=False, lang="en-US")
    try:
        page = await browser.get('http://127.0.0.1:5500/demos/boids.html')
        await page.set_window_size(width=1280, height=800)
        await asyncio.sleep(2.0)
        await page.save_screenshot(str(OUT / "boids3-default.png"))
        # toggle cursor mode to predator + simulate a mouse position
        await page.evaluate("""document.getElementById('cursorMode').click();
            const c = document.getElementById('c');
            const r = c.getBoundingClientRect();
            const ev = new PointerEvent('pointermove', {
                clientX: r.left + r.width * 0.5,
                clientY: r.top  + r.height * 0.5,
                bubbles: true, pointerType: 'mouse'
            });
            c.dispatchEvent(ev);
        """)
        await asyncio.sleep(2.5)
        await page.save_screenshot(str(OUT / "boids3-cursor-predator.png"))
        # bump speed up
        await page.evaluate("""(() => {
            const s = document.getElementById('speed');
            s.value = 2.5;
            s.dispatchEvent(new Event('input', {bubbles: true}));
        })()""")
        await asyncio.sleep(2.0)
        await page.save_screenshot(str(OUT / "boids3-fast.png"))
        # toggle back to prey + slow down
        await page.evaluate("""document.getElementById('cursorMode').click();
            const s = document.getElementById('speed');
            s.value = 0.4;
            s.dispatchEvent(new Event('input', {bubbles: true}));
        """)
        await asyncio.sleep(2.0)
        await page.save_screenshot(str(OUT / "boids3-slow-prey.png"))
        diag = await page.evaluate("""JSON.stringify({
            cursorMode: document.getElementById('cursorMode').textContent,
            speed: document.getElementById('speed').value,
            speedLabel: document.getElementById('speedVal').textContent
        })""")
        print('DIAG:', diag)
    finally:
        browser.stop()

if __name__ == "__main__":
    asyncio.run(main())
