"""Capture each mode at multiple timestamps so motion is visible across screenshots."""
import asyncio
import os
from pathlib import Path

OUT = Path(os.path.expandvars("%TEMP%/rg-shots"))
OUT.mkdir(parents=True, exist_ok=True)

MODES = [
    (0, 'galaxy'),
    (1, 'lorenz'),
    (2, 'vortex'),
    (3, 'curl'),
]

async def main():
    import nodriver as uc
    browser = await uc.start(headless=False, lang="en-US")
    try:
        page = await browser.get('http://127.0.0.1:5500/demos/curl-noise-particles.html')
        await page.set_window_size(width=1280, height=800)
        await asyncio.sleep(0.6)

        for idx, name in MODES:
            # Click the mode button + reset to bring particles back to a fresh sphere
            await page.evaluate(f"document.querySelector('[data-mode=\"{idx}\"]').click(); document.getElementById('reset').click();")
            # Three samples spaced enough to make motion obvious
            for label, sleep_s in [('t0', 0.4), ('t3', 3.0), ('t6', 3.0)]:
                await asyncio.sleep(sleep_s)
                await page.save_screenshot(str(OUT / f"motion-{name}-{label}.png"))

        diag = await page.evaluate("""JSON.stringify({
            cw: document.getElementById('c').width,
            ch: document.getElementById('c').height,
            err: document.querySelector('.err')?.textContent || null
        })""")
        print('DIAG:', diag)
        print('SHOTS:', sorted([f for f in os.listdir(OUT) if f.startswith('motion-')]))
    finally:
        browser.stop()

if __name__ == "__main__":
    asyncio.run(main())
