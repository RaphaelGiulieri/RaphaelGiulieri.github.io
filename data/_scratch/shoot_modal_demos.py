"""Open each dossier with a live demo, scroll to the iframe, screenshot."""
import asyncio
import os
from pathlib import Path

OUT = Path(os.path.expandvars("%TEMP%/rg-shots"))
OUT.mkdir(parents=True, exist_ok=True)
URL = "http://127.0.0.1:5500/"

async def shoot_dossier(page, project_id, label):
    # Reset to root
    await page.get(URL)
    await asyncio.sleep(1.6)
    # Click the project card (need to find it — may be in archive)
    await page.evaluate("document.getElementById('work').scrollIntoView({behavior:'instant', block:'start'})")
    await asyncio.sleep(0.3)
    found = await page.evaluate(f"""(() => {{
        const card = document.querySelector('#projectsGrid [data-project-id=\\"{project_id}\\"]');
        if (!card) return false;
        // Reveal archive if hidden
        if (card.classList.contains('is-archived')) {{
            const t = document.getElementById('archiveToggle');
            if (t) t.click();
        }}
        card.click();
        return true;
    }})()""")
    if not found:
        print(f'NO CARD: {project_id}')
        return
    await asyncio.sleep(1.2)

    # Find first .dossier-media-shader iframe and scroll modal so it's visible
    await page.evaluate("""(() => {
        var iframe = document.querySelector('.dossier-media-shader iframe');
        if (iframe) {
            var modal = document.getElementById('modal');
            var rect = iframe.getBoundingClientRect();
            var modalRect = modal.getBoundingClientRect();
            modal.scrollTo({top: modal.scrollTop + rect.top - modalRect.top - 80, behavior: 'instant'});
        }
    })()""")
    await asyncio.sleep(2.5)
    await page.save_screenshot(str(OUT / f"modal-{label}-1.png"))

    # If there's a second iframe, scroll to it
    has2 = await page.evaluate("""document.querySelectorAll('.dossier-media-shader iframe').length >= 2""")
    if has2:
        await page.evaluate("""(() => {
            var iframes = document.querySelectorAll('.dossier-media-shader iframe');
            var iframe = iframes[1];
            var modal = document.getElementById('modal');
            var rect = iframe.getBoundingClientRect();
            var modalRect = modal.getBoundingClientRect();
            modal.scrollTo({top: modal.scrollTop + rect.top - modalRect.top - 80, behavior: 'instant'});
        })()""")
        await asyncio.sleep(2.5)
        await page.save_screenshot(str(OUT / f"modal-{label}-2.png"))

    # Close modal
    await page.evaluate("document.querySelector('.dossier-close')?.click()")
    await asyncio.sleep(0.4)

async def main():
    import nodriver as uc
    browser = await uc.start(headless=False, lang="en-US")
    try:
        page = await browser.get(URL)
        await page.set_window_size(width=1440, height=900)
        await asyncio.sleep(2.0)

        await shoot_dossier(page, 'tech_volumetric', 'volumetric')
        await shoot_dossier(page, 'sabda_vfx', 'sabda')
        await shoot_dossier(page, 'lrd_calico', 'lrd')
        await shoot_dossier(page, 'tech_lighting', 'lighting')

        print('SHOTS:', sorted([f for f in os.listdir(OUT) if f.startswith('modal-')]))
    finally:
        browser.stop()

if __name__ == "__main__":
    asyncio.run(main())
