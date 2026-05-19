"""Smoke-test: load the demo, dump JS console errors + a screenshot."""
import asyncio
import os
from pathlib import Path

OUT = Path(os.path.expandvars("%TEMP%/rg-shots"))

async def main():
    import nodriver as uc
    browser = await uc.start(headless=False, lang="en-US")
    try:
        # Inject an error catcher BEFORE the page loads
        page = await browser.get('http://127.0.0.1:5500/demos/curl-noise-particles.html')
        await page.set_window_size(width=1280, height=800)
        # Patch error capture
        await page.evaluate("""
            window.__errs = [];
            window.addEventListener('error', e => window.__errs.push({
                msg: e.message, file: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack
            }));
        """)
        # Reload to catch errors
        page = await browser.get('http://127.0.0.1:5500/demos/curl-noise-particles.html?nc=' + str(asyncio.get_event_loop().time()))
        await asyncio.sleep(2.5)
        diag = await page.evaluate("""JSON.stringify({
            errs: window.__errs || [],
            cw: document.getElementById('c').width,
            ch: document.getElementById('c').height,
            sliders: document.querySelectorAll('.debug input[type=range]').length,
            mode_btns: document.querySelectorAll('.controls button[data-mode]').length,
            debugInner: document.getElementById('debug')?.innerHTML.length || 0
        })""")
        print('DIAG:', diag)
        await page.save_screenshot(str(OUT / "particles-debug-ui.png"))
    finally:
        browser.stop()

if __name__ == "__main__":
    asyncio.run(main())
