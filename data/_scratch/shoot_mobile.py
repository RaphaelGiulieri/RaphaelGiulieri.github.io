"""Mobile-viewport audit. iPhone 14-ish: 390 × 844.
Captures the root sections, a sample dossier modal at multiple scroll points,
and each demo standalone — to spot layout breaks."""
import asyncio, os
from pathlib import Path

OUT = Path(os.path.expandvars("%TEMP%/rg-shots"))
URL = "http://127.0.0.1:5500/"

# nodriver doesn't have a "device emulation" API per se, but set_window_size
# plus a meta-viewport-respecting browser gives us an iPhone-class layout.
W, H = 414, 896

DEMOS = [
    'curl-noise-particles', 'fluid-sim',
    'sdf-raymarch', 'retro-post', 'boids',
    'wfc-tiles', 'pbr-studio', 'marching-squares',
    'audio-reactive', 'l-system-tree', 'voronoi',
]

DOSSIERS = ['tech_volumetric', 'sabda_vfx', 'lrd_calico']

async def main():
    import nodriver as uc
    browser = await uc.start(headless=False, lang="en-US")
    try:
        # ---- ROOT ----
        page = await browser.get(URL)
        await page.set_window_size(width=W, height=H)
        await asyncio.sleep(2.0)
        # Hero
        await page.evaluate("window.scrollTo(0, 0)")
        await asyncio.sleep(0.4)
        await page.save_screenshot(str(OUT / "mobile-root-01-hero.png"))
        # Work
        await page.evaluate("document.getElementById('work').scrollIntoView({behavior:'instant', block:'start'})")
        await asyncio.sleep(0.4)
        await page.save_screenshot(str(OUT / "mobile-root-02-work.png"))
        # scroll into the grid more
        await page.evaluate("window.scrollBy(0, 600)")
        await asyncio.sleep(0.3)
        await page.save_screenshot(str(OUT / "mobile-root-03-work-grid.png"))
        # Research
        await page.evaluate("document.getElementById('research').scrollIntoView({behavior:'instant', block:'start'})")
        await asyncio.sleep(0.3)
        await page.save_screenshot(str(OUT / "mobile-root-04-research.png"))
        # Experience
        await page.evaluate("document.getElementById('experience').scrollIntoView({behavior:'instant', block:'start'})")
        await asyncio.sleep(0.3)
        await page.save_screenshot(str(OUT / "mobile-root-05-experience.png"))
        # Contact
        await page.evaluate("document.getElementById('contact').scrollIntoView({behavior:'instant', block:'start'})")
        await asyncio.sleep(0.3)
        await page.save_screenshot(str(OUT / "mobile-root-06-contact.png"))

        # ---- DOSSIER MODALS ----
        for did in DOSSIERS:
            await page.get(URL)
            await asyncio.sleep(1.5)
            await page.evaluate("document.getElementById('work').scrollIntoView({behavior:'instant', block:'start'})")
            await asyncio.sleep(0.3)
            ok = await page.evaluate(f"""(() => {{
                const c = document.querySelector('#projectsGrid [data-project-id=\\"{did}\\"]');
                if (!c) return false;
                if (c.classList.contains('is-archived')) document.getElementById('archiveToggle')?.click();
                c.click();
                return true;
            }})()""")
            if not ok:
                print(f'NOT FOUND: {did}')
                continue
            await asyncio.sleep(1.2)
            await page.save_screenshot(str(OUT / f"mobile-modal-{did}-1-top.png"))
            # scroll modal halfway
            await page.evaluate("var m=document.getElementById('modal'); m.scrollTo({top: 1100, behavior: 'instant'})")
            await asyncio.sleep(0.6)
            await page.save_screenshot(str(OUT / f"mobile-modal-{did}-2-mid.png"))
            await page.evaluate("var m=document.getElementById('modal'); m.scrollTo({top: 2400, behavior: 'instant'})")
            await asyncio.sleep(0.6)
            await page.save_screenshot(str(OUT / f"mobile-modal-{did}-3-deep.png"))
            await page.evaluate("document.querySelector('.dossier-close')?.click()")
            await asyncio.sleep(0.4)

        # ---- DEMOS standalone ----
        for d in DEMOS:
            await page.get(f'http://127.0.0.1:5500/demos/{d}.html')
            await asyncio.sleep(2.0)
            await page.save_screenshot(str(OUT / f"mobile-demo-{d}.png"))

        print('SHOTS:', sorted([f for f in os.listdir(OUT) if f.startswith('mobile-')]))
    finally:
        browser.stop()

if __name__ == "__main__":
    asyncio.run(main())
