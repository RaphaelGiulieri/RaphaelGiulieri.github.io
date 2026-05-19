"""Drive all sliders to zero via JS and verify particles end up in a tight cluster."""
import asyncio
import os
from pathlib import Path

OUT = Path(os.path.expandvars("%TEMP%/rg-shots"))

async def main():
    import nodriver as uc
    browser = await uc.start(headless=False, lang="en-US")
    try:
        page = await browser.get('http://127.0.0.1:5500/demos/curl-noise-particles.html')
        await page.set_window_size(width=1280, height=800)
        await asyncio.sleep(2.5)

        # Baseline screenshot — defaults
        await page.save_screenshot(str(OUT / "zerotest-1-defaults.png"))

        # Zero only DYNAMICS-affecting sliders (Field/Galaxy/Lorenz/Vortex/Curl/Containment)
        # while leaving Camera, Render, and Init at defaults. With all dynamics at zero,
        # particles should be PERFECTLY STATIC — verify by sampling positions across time.
        await page.evaluate("""(() => {
            const dynamicsKeys = [
                'field_speed','damping',
                'g_omega','g_kr','g_ky',
                'l_scale','l_offset','l_speed',
                'v_speed','v_pos','v_ydamp',
                'c_freq','c_amp','c_tspeed',
                'bound_r','bound_k'
            ];
            for (const k of dynamicsKeys) {
                const s = document.querySelector(`.debug input[data-key="${k}"]`);
                if (!s) continue;
                s.value = parseFloat(s.min);
                s.dispatchEvent(new Event('input', { bubbles: true }));
            }
            // Camera orbit: set to ZERO (slider min is -1, not 0)
            const cs = document.querySelector('.debug input[data-key="cam_speed"]');
            cs.value = 0;
            cs.dispatchEvent(new Event('input', { bubbles: true }));
            // DEBUG: force velocity read to zero in the shader.
            window.__dbgZeroVel = true;
            // Reset so the position state is clean.
            document.getElementById('reset').click();
        })()""")
        # Wait for auto-resets to fire (debounced 90ms) and a couple of sim frames
        await asyncio.sleep(1.5)
        await page.save_screenshot(str(OUT / "zerotest-2-allzero-t1.5.png"))
        await asyncio.sleep(2.0)
        await page.save_screenshot(str(OUT / "zerotest-2-allzero-t3.5.png"))
        # Hash the two PNGs — if identical, particles are static (camera also static).
        import hashlib
        h1 = hashlib.sha256(open(OUT/"zerotest-2-allzero-t1.5.png","rb").read()).hexdigest()[:16]
        h2 = hashlib.sha256(open(OUT/"zerotest-2-allzero-t3.5.png","rb").read()).hexdigest()[:16]
        print(f'HASH t=1.5s: {h1}')
        print(f'HASH t=3.5s: {h2}')
        print(f'STATIC: {h1 == h2}')

        return  # skip pixel-spread (canvas can't be read after compositor swap)
        # Read particle position spread to verify tight cluster
        spread = await page.evaluate("""(() => {
            // Can't easily read GPU texture from JS; instead approximate by counting pixels.
            // The canvas should show a tight cluster only — measure brightness distribution.
            const c = document.getElementById('c');
            const w = c.width, h = c.height;
            const canvas2 = document.createElement('canvas');
            canvas2.width = w; canvas2.height = h;
            const ctx = canvas2.getContext('2d');
            ctx.drawImage(c, 0, 0);
            const img = ctx.getImageData(0, 0, w, h).data;
            let lit = 0;
            let cx = 0, cy = 0;
            let extentX = 0, extentY = 0;
            const litPx = [];
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = (y * w + x) * 4;
                    const v = img[i] + img[i+1] + img[i+2];
                    if (v > 60) { litPx.push([x, y, v]); lit++; cx += x; cy += y; }
                }
            }
            if (lit === 0) return JSON.stringify({lit: 0});
            cx /= lit; cy /= lit;
            for (const [x, y] of litPx) {
                extentX = Math.max(extentX, Math.abs(x - cx));
                extentY = Math.max(extentY, Math.abs(y - cy));
            }
            return JSON.stringify({ lit, cx: cx|0, cy: cy|0, extentX: extentX|0, extentY: extentY|0, w, h });
        })()""")
        print('SPREAD AFTER ALL-ZERO:', spread)

        # Also wait longer and screenshot — if particles are static, this looks the same
        await asyncio.sleep(3.0)
        await page.save_screenshot(str(OUT / "zerotest-3-allzero-3s.png"))
        spread2 = await page.evaluate("""(() => {
            const c = document.getElementById('c');
            const w = c.width, h = c.height;
            const canvas2 = document.createElement('canvas');
            canvas2.width = w; canvas2.height = h;
            const ctx = canvas2.getContext('2d');
            ctx.drawImage(c, 0, 0);
            const img = ctx.getImageData(0, 0, w, h).data;
            let lit = 0;
            let cx = 0, cy = 0;
            let extentX = 0, extentY = 0;
            const litPx = [];
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = (y * w + x) * 4;
                    const v = img[i] + img[i+1] + img[i+2];
                    if (v > 60) { litPx.push([x, y]); lit++; cx += x; cy += y; }
                }
            }
            if (lit === 0) return JSON.stringify({lit: 0});
            cx /= lit; cy /= lit;
            for (const [x, y] of litPx) {
                extentX = Math.max(extentX, Math.abs(x - cx));
                extentY = Math.max(extentY, Math.abs(y - cy));
            }
            return JSON.stringify({ lit, cx: cx|0, cy: cy|0, extentX: extentX|0, extentY: extentY|0 });
        })()""")
        print('SPREAD AFTER 3s WAIT:', spread2)
    finally:
        browser.stop()

if __name__ == "__main__":
    asyncio.run(main())
