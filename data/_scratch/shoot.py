"""Headless-ish Chrome screenshot of the portfolio root via nodriver."""
import asyncio
import os
import sys
from pathlib import Path

# Write screenshots outside the workspace so VS Code Live Server doesn't reload the page on each save.
OUT = Path(os.path.expandvars("%TEMP%/rg-shots"))
OUT.mkdir(parents=True, exist_ok=True)

URL = "http://127.0.0.1:5500/"

async def main():
    import nodriver as uc
    browser = await uc.start(headless=False, lang="en-US")
    try:
        page = await browser.get(URL)
        await asyncio.sleep(2.5)  # let fonts + JSON fetches + renders settle

        # Set viewport to desktop
        await page.set_window_size(width=1440, height=900)
        await asyncio.sleep(0.5)

        # 1. Hero
        await page.evaluate("window.scrollTo(0, 0)")
        await asyncio.sleep(0.5)
        await page.save_screenshot(str(OUT / "01-hero.png"))

        # 2. Work
        await page.evaluate("document.getElementById('work').scrollIntoView({behavior:'instant', block:'start'})")
        await asyncio.sleep(0.5)
        await page.save_screenshot(str(OUT / "02-work.png"))

        # 3. Click 'All' pill is already active; scroll more into the grid
        await page.evaluate("window.scrollBy(0, 400)")
        await asyncio.sleep(0.4)
        await page.save_screenshot(str(OUT / "03-work-grid.png"))

        # 4. Research
        await page.evaluate("document.getElementById('research').scrollIntoView({behavior:'instant', block:'start'})")
        await asyncio.sleep(0.4)
        await page.save_screenshot(str(OUT / "04-research.png"))

        # 5. Experience
        await page.evaluate("document.getElementById('experience').scrollIntoView({behavior:'instant', block:'start'})")
        await asyncio.sleep(0.4)
        await page.save_screenshot(str(OUT / "05-experience.png"))

        # 6. Contact
        await page.evaluate("document.getElementById('contact').scrollIntoView({behavior:'instant', block:'start'})")
        await asyncio.sleep(0.4)
        await page.save_screenshot(str(OUT / "06-contact.png"))

        # Pre-7: patch Element.prototype.setAttribute globally for #modal
        await page.evaluate("""
            window.__attrChanges = [];
            const orig = Element.prototype.setAttribute;
            Element.prototype.setAttribute = function(name, value) {
                if (this.id === 'modal') {
                    window.__attrChanges.push({
                        name, value,
                        stack: (new Error().stack || '').split('\\n').slice(0, 8).join(' | ')
                    });
                }
                return orig.call(this, name, value);
            };
        """)

        # 7. Modal test — open the qatar_360 dossier (it has a live shader demo)
        await page.evaluate("document.getElementById('work').scrollIntoView({behavior:'instant', block:'start'})")
        await asyncio.sleep(0.3)
        await page.evaluate("document.querySelector('#projectsGrid [data-project-id=\"qatar_360\"]')?.click()")
        await asyncio.sleep(2.0)
        await page.save_screenshot(str(OUT / "07-modal.png"))

        # 7a. Diag the modal state
        diag2 = await page.evaluate("""JSON.stringify({
            display: getComputedStyle(document.getElementById('modal')).display,
            ariaHidden: document.getElementById('modal').getAttribute('aria-hidden'),
            bodyOverflow: document.body.style.overflow,
            modalScrollHeight: document.getElementById('modal').scrollHeight,
            modalClientHeight: document.getElementById('modal').clientHeight,
            sheetHeight: document.querySelector('.dossier-sheet')?.getBoundingClientRect().height || 0,
            sheetTop: document.querySelector('.dossier-sheet')?.getBoundingClientRect().top || 0
        })""")
        print('MODAL STATE before scroll:', diag2)

        # 7b. CONTROL: just sleep without scrolling
        await asyncio.sleep(0.5)
        diag2b = await page.evaluate("""JSON.stringify({
            display: getComputedStyle(document.getElementById('modal')).display,
            ariaHidden: document.getElementById('modal').getAttribute('aria-hidden')
        })""")
        print('MODAL STATE after pure sleep (no scroll):', diag2b)
        # Now do the scroll
        await page.evaluate("document.getElementById('modal').scrollTo({top: 460, behavior: 'instant'})")
        await asyncio.sleep(0.4)
        diag3 = await page.evaluate("""JSON.stringify({
            display: getComputedStyle(document.getElementById('modal')).display,
            ariaHidden: document.getElementById('modal').getAttribute('aria-hidden'),
            modalScrollTop: document.getElementById('modal').scrollTop,
            modalScrollHeight: document.getElementById('modal').scrollHeight,
            closeStack: window.__closeModalStack || 'no close fired',
            attrChanges: window.__attrChanges
        })""")
        print('MODAL STATE after scroll:', diag3)
        await page.save_screenshot(str(OUT / "07b-modal-scrolled.png"))

        # 7c. Scroll further to show next-card footer
        await page.evaluate("var s=document.getElementById('modal'); s.scrollTo({top: s.scrollHeight, behavior: 'instant'})")
        await asyncio.sleep(0.4)
        await page.save_screenshot(str(OUT / "07c-modal-bottom.png"))

        # 7d. Scroll to where the live demo iframe lands ("See it live" section)
        await page.evaluate("""
            var iframe = document.querySelector('.dossier-media-shader iframe');
            if (iframe) {
                var modal = document.getElementById('modal');
                var rect = iframe.getBoundingClientRect();
                var modalRect = modal.getBoundingClientRect();
                modal.scrollTo({top: modal.scrollTop + rect.top - modalRect.top - 80, behavior: 'instant'});
            }
        """)
        await asyncio.sleep(2.0)  # let WebGL warm up
        await page.save_screenshot(str(OUT / "07d-modal-livedemo.png"))

        # 7e. Standalone demo page
        await page.evaluate("document.querySelector('.dossier-close')?.click()")
        await asyncio.sleep(0.3)
        await page.get('http://127.0.0.1:5500/demos/curl-noise-particles.html')
        await asyncio.sleep(2.5)
        await page.save_screenshot(str(OUT / "09-demo-standalone.png"))
        await page.get(URL)  # back to portfolio for the rest of the tests
        await asyncio.sleep(1.0)

        # 8. Light mode
        await page.evaluate("document.getElementById('themeToggle').click()")
        await asyncio.sleep(0.5)
        await page.evaluate("document.querySelector('.dossier-close')?.click()")
        await asyncio.sleep(0.3)
        await page.evaluate("window.scrollTo(0, 0)")
        await asyncio.sleep(0.5)
        await page.save_screenshot(str(OUT / "08-hero-light.png"))

        # Also capture runtime diagnostics
        diag = await page.evaluate("""
            JSON.stringify({
                heroCards: document.querySelectorAll('#heroProjects .hero-project-card').length,
                projectCards: document.querySelectorAll('#projectsGrid .card-project').length,
                visibleProjects: [...document.querySelectorAll('#projectsGrid .card-project')].filter(el => !el.classList.contains('is-hidden')).length,
                researchCards: document.querySelectorAll('#researchGrid .card-research').length,
                timelineEntries: document.querySelectorAll('#experienceTimeline .timeline-entry').length,
                filterItems: document.querySelectorAll('.filter-strip .filter-item').length,
                archiveVisible: getComputedStyle(document.getElementById('archiveToggle')).display !== 'none',
                archiveCount: document.getElementById('archiveCount')?.textContent,
                theme: document.documentElement.classList.contains('theme-dark') ? 'dark' : (document.documentElement.classList.contains('theme-light') ? 'light' : 'auto'),
                title: document.title
            })
        """)
        with open(OUT / "diag.json", "w") as f:
            f.write(str(diag))

        print("DIAG:", diag)
        print("SHOTS:", sorted(os.listdir(OUT)))
    finally:
        browser.stop()

if __name__ == "__main__":
    asyncio.run(main())
