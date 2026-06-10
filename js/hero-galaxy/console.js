// Spaceship-board console overlay. Self-contained: injects its own CSS,
// builds its DOM, and re-renders whenever the scene state changes (after a
// transition completes, or on first mount). Sits bottom-left, editorial
// styling matching the rest of the Technical Journal n° 01 language.
//
// Information surfaced per state level:
//
//   galaxy   — sector overview: discipline count / planet count / project
//              count + a one-line hint
//   system   — focused discipline: name, planet (sub-category) breakdown,
//              project count, list of planet names with their project count
//   planet   — focused sub-category: parent discipline, project count, list
//              of moons (projects) with status pills
//   moon     — focused project: parent discipline / sub-category, project
//              tagline, status / year / role meta strip, skill chips,
//              "Open dossier" button (the only path to the modal now that
//              clicking a moon zooms in instead of opening the modal)

export async function mountConsole({ section, galaxyData, onOpenDossier }) {
    let projectsById = new Map();
    try {
        const res = await fetch('data/projects.json');
        const json = await res.json();
        const list = Array.isArray(json) ? json : (json.projects || []);
        for (const p of list) projectsById.set(p.id, p);
    } catch (e) {
        console.warn('[hero-galaxy/console] could not load projects.json:', e);
    }

    if (!document.getElementById('hero-galaxy-console-style')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'hero-galaxy-console-style';
        styleEl.textContent = `
            .hg-console {
                position: absolute;
                left: 24px; bottom: 96px;
                z-index: 30;
                width: 320px;
                max-height: calc(100% - 260px);
                overflow-y: auto;
                padding: 16px 18px 14px;
                background: rgba(12, 10, 7, 0.86);
                color: var(--text, #f0ebe0);
                border: 1px solid var(--accent, #ff4b1f);
                font-family: var(--f-sans, 'Geist', system-ui, sans-serif);
                font-size: 12px; line-height: 1.5;
                backdrop-filter: blur(6px);
                opacity: 0; transform: translateY(8px);
                transition: opacity 360ms ease, transform 360ms ease;
                pointer-events: auto;
                scrollbar-width: thin;
                scrollbar-color: rgba(255,75,31,0.55) transparent;
            }
            .hg-console.is-on { opacity: 1; transform: translateY(0); }
            .hg-console::-webkit-scrollbar { width: 5px; }
            .hg-console::-webkit-scrollbar-thumb { background: rgba(255,75,31,0.5); }

            .hg-console-rail {
                display: flex; justify-content: space-between; align-items: baseline;
                font-family: var(--f-mono, 'JetBrains Mono', monospace);
                font-size: 9.5px; letter-spacing: 0.18em; text-transform: uppercase;
                color: var(--accent, #ff4b1f);
                margin-bottom: 10px;
            }
            .hg-console-rail .seq { opacity: 0.55; color: var(--text, #f0ebe0); }

            .hg-console-eyebrow {
                font-family: var(--f-mono, 'JetBrains Mono', monospace);
                font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
                color: rgba(240,235,224,0.6);
                margin-bottom: 2px;
            }
            .hg-console-title {
                font-family: var(--f-display, 'Fraunces', serif);
                font-size: 22px; line-height: 1.15; font-weight: 500;
                letter-spacing: -0.01em;
                margin: 0 0 10px;
                color: var(--text, #f0ebe0);
            }
            .hg-console-title em { font-style: italic; color: var(--accent, #ff4b1f); }

            .hg-console-meta {
                font-family: var(--f-mono, 'JetBrains Mono', monospace);
                font-size: 10px; letter-spacing: 0.04em;
                color: rgba(240,235,224,0.65);
                padding: 6px 0; border-top: 1px solid rgba(255,75,31,0.22);
                border-bottom: 1px solid rgba(255,75,31,0.22);
                margin: 4px 0 10px;
                display: flex; flex-wrap: wrap; gap: 4px 10px;
            }
            .hg-console-meta b {
                color: var(--accent, #ff4b1f); font-weight: 500;
            }

            .hg-console-body p {
                margin: 0 0 10px;
                color: rgba(240,235,224,0.85);
            }
            .hg-console-list {
                list-style: none; margin: 0 0 10px; padding: 0;
                font-family: var(--f-mono, 'JetBrains Mono', monospace);
                font-size: 10.5px; letter-spacing: 0.02em;
            }
            .hg-console-list li {
                display: flex; justify-content: space-between; gap: 8px;
                padding: 3px 0;
                border-bottom: 1px dotted rgba(240,235,224,0.12);
                color: rgba(240,235,224,0.85);
            }
            .hg-console-list li:last-child { border-bottom: 0; }
            .hg-console-list .right { opacity: 0.55; }
            .hg-console-list .dot {
                display: inline-block; width: 8px; height: 8px;
                border-radius: 50%;
                background: var(--accent, #ff4b1f);
                margin-right: 6px; vertical-align: 1px;
                opacity: 0.7;
            }

            .hg-console-chips {
                display: flex; flex-wrap: wrap; gap: 4px;
                margin: 0 0 12px;
            }
            .hg-console-chips span {
                font-family: var(--f-mono, 'JetBrains Mono', monospace);
                font-size: 9.5px; letter-spacing: 0.06em; text-transform: uppercase;
                padding: 3px 7px;
                color: var(--accent, #ff4b1f);
                border: 1px solid rgba(255,75,31,0.4);
            }
            .hg-console-hint {
                font-family: var(--f-mono, 'JetBrains Mono', monospace);
                font-size: 9.5px; letter-spacing: 0.08em; text-transform: uppercase;
                color: rgba(240,235,224,0.45);
                margin-top: 6px;
            }
            .hg-console-cta {
                display: inline-flex; align-items: center; gap: 8px;
                margin-top: 4px;
                background: var(--accent, #ff4b1f);
                color: var(--bg, #0c0a07);
                font-family: var(--f-mono, 'JetBrains Mono', monospace);
                font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
                padding: 8px 14px; border: 0; cursor: pointer;
                transition: filter 150ms;
            }
            .hg-console-cta:hover { filter: brightness(1.1); }
            .hg-console-cta:focus-visible { outline: 2px solid var(--text, #f0ebe0); outline-offset: 2px; }

            @media (max-width: 720px) {
                /* Bottom-aligned strip on mobile instead of bottom-left
                   panel. Sits above the SCROLL ↓ button (which is at
                   bottom: 72px on mobile per style.css) with a small gap,
                   spans the full width minus side gutters, and caps at
                   38% of the viewport so it never eats the whole hero. */
                .hg-console {
                    left: 12px;
                    right: 12px;
                    bottom: 116px;
                    width: auto;
                    max-height: 38dvh;
                    padding: 12px 14px 10px;
                    font-size: 11px;
                }
                .hg-console-title {
                    font-size: 18px;
                    margin-bottom: 6px;
                }
                .hg-console-meta {
                    font-size: 9px;
                    gap: 2px 8px;
                    padding: 4px 0;
                    margin: 2px 0 6px;
                }
                .hg-console-list {
                    font-size: 10px;
                    margin-bottom: 6px;
                }
                .hg-console-list li { padding: 2px 0; }
                .hg-console-body p { margin-bottom: 6px; }
                .hg-console-cta { padding: 10px 14px; font-size: 11px; }
            }
            @media (prefers-reduced-motion: reduce) {
                .hg-console { transition: none; }
            }
        `;
        document.head.appendChild(styleEl);
    }

    const panel = document.createElement('aside');
    panel.className = 'hg-console';
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', 'Hero galaxy console — context for the focused body');
    panel.innerHTML = `
        <div class="hg-console-rail">
            <span class="tag">— instrumentation</span>
            <span class="seq" data-role="seq">§ 00</span>
        </div>
        <div data-role="content"></div>
    `;
    section.appendChild(panel);

    const seqEl     = panel.querySelector('[data-role="seq"]');
    const contentEl = panel.querySelector('[data-role="content"]');

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    function projectCountForSystem(sys) {
        return (sys.planets || []).reduce((a, p) => a + (p.moons || []).length, 0);
    }

    function renderGalaxy() {
        seqEl.textContent = '§ 00';
        const systems = galaxyData.systems || [];
        const planetCount  = systems.reduce((a, s) => a + (s.planets || []).length, 0);
        const projectCount = systems.reduce((a, s) => a + projectCountForSystem(s), 0);
        const rows = systems.map(s => `
            <li><span><i class="dot"></i>${escapeHtml(s.name)}</span><span class="right">${projectCountForSystem(s)} projects</span></li>
        `).join('');
        contentEl.innerHTML = `
            <div class="hg-console-eyebrow">galaxy view</div>
            <h2 class="hg-console-title">All <em>disciplines</em></h2>
            <div class="hg-console-meta">
                <span><b>${systems.length}</b> systems</span>
                <span><b>${planetCount}</b> sub-categories</span>
                <span><b>${projectCount}</b> projects</span>
            </div>
            <div class="hg-console-body">
                <p>Each sun is a discipline, each planet a sub-category, each moon a project.</p>
                <ul class="hg-console-list">${rows}</ul>
            </div>
            <div class="hg-console-hint">click a body to fly in.</div>
        `;
    }

    function renderSystem(state) {
        seqEl.textContent = '§ 01';
        const sys = galaxyData.systems.find(s => s.id === state.focusedSystemId);
        if (!sys) { renderGalaxy(); return; }
        const planets = sys.planets || [];
        const projectCount = projectCountForSystem(sys);
        const rows = planets.map(p => `
            <li><span><i class="dot"></i>${escapeHtml(p.name)}</span><span class="right">${(p.moons || []).length} projects</span></li>
        `).join('');
        contentEl.innerHTML = `
            <div class="hg-console-eyebrow">discipline</div>
            <h2 class="hg-console-title">${escapeHtml(sys.name)}</h2>
            <div class="hg-console-meta">
                <span><b>${planets.length}</b> sub-categories</span>
                <span><b>${projectCount}</b> projects</span>
            </div>
            <div class="hg-console-body">
                <ul class="hg-console-list">${rows}</ul>
            </div>
            <div class="hg-console-hint">click a planet for the sub-category.</div>
        `;
    }

    function renderPlanet(state) {
        seqEl.textContent = '§ 02';
        const sys = galaxyData.systems.find(s => s.id === state.focusedSystemId);
        const pl  = sys?.planets.find(p => p.id === state.focusedPlanetId);
        if (!sys || !pl) { renderSystem(state); return; }
        const moons = pl.moons || [];
        const rows = moons.map(m => {
            const proj = projectsById.get(m.projectId);
            const title = proj?.title || m.projectId;
            const status = proj?.status ? proj.status : '';
            return `<li><span><i class="dot"></i>${escapeHtml(title)}</span><span class="right">${escapeHtml(status)}</span></li>`;
        }).join('');
        contentEl.innerHTML = `
            <div class="hg-console-eyebrow">sub-category · ${escapeHtml(sys.name)}</div>
            <h2 class="hg-console-title">${escapeHtml(pl.name)}</h2>
            <div class="hg-console-meta">
                <span><b>${moons.length}</b> projects in this lane</span>
            </div>
            <div class="hg-console-body">
                <ul class="hg-console-list">${rows}</ul>
            </div>
            <div class="hg-console-hint">click a moon to inspect.</div>
        `;
    }

    function renderMoon(state) {
        seqEl.textContent = '§ 03';
        const sys = galaxyData.systems.find(s => s.id === state.focusedSystemId);
        const pl  = sys?.planets.find(p => p.id === state.focusedPlanetId);
        if (!sys || !pl) { renderPlanet(state); return; }
        const proj = projectsById.get(state.focusedMoonId);
        const title   = proj?.title    || state.focusedMoonId;
        const tagline = proj?.tagline  || '';
        const status  = proj?.status   || '';
        const year    = proj?.year     || '';
        const role    = proj?.role     || '';
        const skills  = (proj?.skills_short || []).slice(0, 5);
        const metaBits = [];
        if (status) metaBits.push(`<span><b>status</b> ${escapeHtml(status)}</span>`);
        if (year)   metaBits.push(`<span><b>year</b> ${escapeHtml(String(year))}</span>`);
        if (role)   metaBits.push(`<span><b>role</b> ${escapeHtml(role)}</span>`);
        const chips = skills.map(s => `<span>${escapeHtml(s)}</span>`).join('');
        contentEl.innerHTML = `
            <div class="hg-console-eyebrow">project · ${escapeHtml(sys.name)} / ${escapeHtml(pl.name)}</div>
            <h2 class="hg-console-title">${escapeHtml(title)}</h2>
            ${metaBits.length ? `<div class="hg-console-meta">${metaBits.join('')}</div>` : ''}
            <div class="hg-console-body">
                ${tagline ? `<p>${escapeHtml(tagline)}</p>` : ''}
                ${chips ? `<div class="hg-console-chips">${chips}</div>` : ''}
            </div>
            ${proj ? `<button type="button" class="hg-console-cta" data-role="open">open dossier →</button>` : ''}
        `;
        const btn = contentEl.querySelector('[data-role="open"]');
        if (btn) btn.addEventListener('click', () => onOpenDossier?.(state.focusedMoonId));
    }

    function render(state) {
        if (state.level === 'galaxy') renderGalaxy();
        else if (state.level === 'system') renderSystem(state);
        else if (state.level === 'planet') renderPlanet(state);
        else if (state.level === 'moon')   renderMoon(state);
        requestAnimationFrame(() => panel.classList.add('is-on'));
    }

    return { render, el: panel };
}
