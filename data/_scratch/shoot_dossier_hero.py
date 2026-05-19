"""Open each dossier with new media, screenshot hero + gallery from the top."""
import asyncio, os
from pathlib import Path

OUT = Path(os.path.expandvars("%TEMP%/rg-shots"))
URL = "http://127.0.0.1:5500/"
TARGETS = ['tech_volumetric', 'sabda_vfx', 'lrd_calico', 'tech_lighting', 'tech_compute_procedural']

async def main():
    import nodriver as uc
    browser = await uc.start(headless=False, lang="en-US")
    try:
        page = await browser.get(URL)
        await page.set_window_size(width=1440, height=900)
        await asyncio.sleep(2.0)

        for pid in TARGETS:
            await page.get(URL)
            await asyncio.sleep(1.5)
            await page.evaluate("document.getElementById('work').scrollIntoView({behavior:'instant', block:'start'})")
            await asyncio.sleep(0.3)
            found = await page.evaluate(f"""(() => {{
                const card = document.querySelector('#projectsGrid [data-project-id=\\"{pid}\\"]');
                if (!card) return false;
                if (card.classList.contains('is-archived')) {{
                    const t = document.getElementById('archiveToggle');
                    if (t) t.click();
                }}
                card.click();
                return true;
            }})()""")
            if not found:
                print(f'NOT FOUND: {pid}')
                continue
            await asyncio.sleep(1.6)
            # Modal opens scrolled to top — capture HERO + first paragraph
            await page.save_screenshot(str(OUT / f"new-{pid}-1-top.png"))
            # Scroll halfway to capture the first gallery items
            await page.evaluate("var m=document.getElementById('modal'); m.scrollTo({top: 900, behavior: 'instant'})")
            await asyncio.sleep(0.7)
            await page.save_screenshot(str(OUT / f"new-{pid}-2-mid.png"))
            await page.evaluate("document.querySelector('.dossier-close')?.click()")
            await asyncio.sleep(0.4)
        print('SHOTS:', sorted([f for f in os.listdir(OUT) if f.startswith('new-')]))
    finally:
        browser.stop()

if __name__ == "__main__":
    asyncio.run(main())
