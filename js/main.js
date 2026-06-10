/* =====================================================
   Raphael Giulieri — Technical Journal · n° 01
   Runtime. Hand-rolled, no framework.
   ===================================================== */
(function () {
    'use strict';

    const state = {
        projects: [],
        research: [],
        experiences: [],
        projectIndex: {}, // id → 1-based rank position
        activeFilter: 'all',
        showArchive: false,
        modalOpen: false,
        modalTrigger: null,
        modalPreviousFocus: null,
        tocObserver: null,
    };

    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pad = (n, w = 3) => String(n).padStart(w, '0');

    // ---- Theme --------------------------------------------------
    function initTheme() {
        const stored = localStorage.getItem('rg-theme');
        const html = document.documentElement;
        if (stored === 'light') html.classList.add('theme-light');
        if (stored === 'dark') html.classList.add('theme-dark');
        updateThemeLabel();

        $('#themeToggle').addEventListener('click', () => {
            const isLight = html.classList.contains('theme-light');
            const isDark = html.classList.contains('theme-dark');
            const systemLight = window.matchMedia('(prefers-color-scheme: light)').matches;
            html.classList.remove('theme-light', 'theme-dark');
            if (isLight) {
                html.classList.add('theme-dark');
                localStorage.setItem('rg-theme', 'dark');
            } else if (isDark) {
                html.classList.add('theme-light');
                localStorage.setItem('rg-theme', 'light');
            } else {
                html.classList.add(systemLight ? 'theme-dark' : 'theme-light');
                localStorage.setItem('rg-theme', systemLight ? 'dark' : 'light');
            }
            updateThemeLabel();
        });
    }
    function updateThemeLabel() {
        const html = document.documentElement;
        const isLight = html.classList.contains('theme-light') ||
            (!html.classList.contains('theme-dark') && window.matchMedia('(prefers-color-scheme: light)').matches);
        const label = $('.theme-label');
        if (label) label.textContent = isLight ? 'Light' : 'Dark';
    }

    // ---- Data ---------------------------------------------------
    async function loadData() {
        const [projects, research, experiences] = await Promise.all([
            fetch('data/projects.json').then((r) => r.json()),
            fetch('data/research.json').then((r) => r.json()),
            fetch('data/experiences.json').then((r) => r.json()),
        ]);
        state.projects = projects.projects;
        state.research = research.cards;
        state.experiences = experiences.entries;

        // Build 1-based index by rank desc (ties → year desc)
        const ranked = state.projects.slice().sort((a, b) =>
            ((b.rank || 0) - (a.rank || 0)) || ((b.year || 0) - (a.year || 0))
        );
        ranked.forEach((p, i) => {
            state.projectIndex[p.id] = i + 1;
        });
    }

    // ---- Category helpers --------------------------------------
    function primaryCategory(p) {
        const cats = p.categories || [];
        const priority = ['client', 'game', 'graphics', 'web', 'ml', 'automation', 'mod', 'tools', '3d', 'simulation', 'ai', 'rnd', 'docs'];
        for (const c of priority) if (cats.includes(c)) return c;
        return cats[0] || 'rnd';
    }
    function categoryLabel(cat) {
        const map = {
            game: 'Game', graphics: 'Graphics', web: 'Web', ml: 'ML',
            automation: 'Automation', tools: 'Tools', client: 'Client',
            mod: 'Mod', docs: 'Docs', '3d': '3D', simulation: 'Sim',
            ai: 'AI', rnd: 'R&D',
        };
        return map[cat] || cat;
    }
    function catVar(cat) {
        return `var(--cat-${cat})`;
    }
    function categoryDisplay(cats) {
        // Show first two category tags, comma-separated
        return (cats || []).slice(0, 2).map(categoryLabel).join(' · ');
    }

    // ---- Live counts (catalogue / clients / disciplines) ---------
    // Replaces [data-stat="..."] placeholders in the hero stats panel and
    // the Work section lede so the numbers track the actual data instead of
    // being hardcoded in index.html.
    function renderStats() {
        const counts = {
            catalogue: (state.projects || []).length,
            clients: (state.experiences || []).length,
            disciplines: (state.research || []).length,
        };
        $$('[data-stat]').forEach((el) => {
            const key = el.getAttribute('data-stat');
            if (counts[key] != null) el.textContent = String(counts[key]);
        });
    }

    // ---- Featured client work -----------------------------------
    // A short row of 4 hand-picked, named-or-shipped client engagements
    // that lead the Work section. Recruiter-in-a-hurry path: a small
    // curated set the visitor can act on before the full filterable grid.
    // IDs are intentionally hardcoded — this is curation, not ranking.
    const FEATURED_IDS = ['sabda_vfx', 'lrd_calico', 'qatar_360'];
    function renderFeatured() {
        const mount = $('#workFeatured');
        if (!mount || !state.projects) return;
        const byId = Object.fromEntries(state.projects.map((p) => [p.id, p]));
        const picks = FEATURED_IDS.map((id) => byId[id]).filter(Boolean);
        if (!picks.length) { mount.style.display = 'none'; return; }

        mount.innerHTML = `
            <p class="featured-label">Shipped for clients <span aria-hidden="true">·</span> pick of the catalogue</p>
            <div class="featured-grid">
                ${picks.map((p) => {
                    const pc = primaryCategory(p);
                    return `
                    <button class="featured-card" data-project-id="${esc(p.id)}" style="--cat-color: ${catVar(pc)}" aria-label="Case study: ${esc(p.title)}">
                        <p class="featured-meta">
                            <span>${esc(p.client || p.role || 'Client engagement')}</span>
                            <span class="featured-status" data-status="${esc(p.status || '')}">${esc(p.status || '')}</span>
                        </p>
                        <h3 class="featured-title">${esc(p.title)}</h3>
                        <p class="featured-tag">${esc(p.tagline || '')}</p>
                        <p class="featured-cta">Open dossier <span aria-hidden="true">→</span></p>
                    </button>`;
                }).join('')}
            </div>
        `;
        $$('.featured-card', mount).forEach((el) => {
            el.addEventListener('click', () => openModal(el.dataset.projectId, el));
        });
    }

    // ---- Filter-pill counts -------------------------------------
    // Append a `(n)` to each filter button so the visitor knows how many
    // projects are behind each category before clicking. Recomputes from
    // state.projects so it tracks the actual catalogue.
    function renderFilterCounts() {
        const pills = $$('.filter-item');
        if (!pills.length || !state.projects) return;
        pills.forEach((btn) => {
            const key = btn.getAttribute('data-filter');
            const n = key === 'all'
                ? state.projects.length
                : state.projects.filter((p) => (p.categories || []).includes(key)).length;
            // Hide pill + its trailing separator if the category is empty
            // (e.g. Mods after the mod-project cleanup).
            if (n === 0 && key !== 'all') {
                btn.style.display = 'none';
                const sep = btn.nextElementSibling;
                if (sep && sep.tagName === 'I') sep.style.display = 'none';
                return;
            }
            let count = btn.querySelector('.filter-count');
            if (!count) {
                count = document.createElement('span');
                count.className = 'filter-count';
                btn.appendChild(count);
            }
            count.textContent = ` ${n}`;
        });
    }

    // ---- Projects grid ------------------------------------------
    function renderProjects() {
        const mount = $('#projectsGrid');
        if (!mount) return;
        const sorted = state.projects.slice().sort((a, b) =>
            ((b.rank || 0) - (a.rank || 0)) || ((b.year || 0) - (a.year || 0))
        );
        mount.innerHTML = sorted.map((p) => projectCardHTML(p)).join('');

        $$('.card-project', mount).forEach((card) => {
            card.addEventListener('click', () => openModal(card.dataset.projectId, card));
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openModal(card.dataset.projectId, card);
                }
            });
        });

        applyFilter();
        updateArchiveCount();
    }
    function projectCardHTML(p) {
        const pc = primaryCategory(p);
        const idx = pad(state.projectIndex[p.id] || 0);
        const year = p.year_range || p.year || '';
        const skills = (p.skills_short || []).slice(0, 4)
            .map((s) => `<li class="card-skill">${esc(s)}</li>`).join('');
        const catsAttr = (p.categories || []).join(' ');
        return `
        <button
            class="card-project"
            data-project-id="${esc(p.id)}"
            data-categories="${esc(catsAttr)}"
            data-highlight="${p.highlight ? 'true' : 'false'}"
            style="--cat-color: ${catVar(pc)}"
            tabindex="0"
            aria-label="Case study: ${esc(p.title)}"
        >
            <header class="card-head">
                <span class="card-index">${idx} / ${pad(state.projects.length)}</span>
                <span class="card-cat">${esc(categoryDisplay(p.categories))}</span>
            </header>
            <h3 class="card-title">${esc(p.title)}<span class="card-title-underline" aria-hidden="true"></span></h3>
            <p class="card-tagline">${esc(p.tagline)}</p>
            ${skills ? `<ul class="card-skills">${skills}</ul>` : ''}
            <footer class="card-foot">
                <span class="card-status" data-status="${esc(p.status)}">${esc(p.status)}</span>
                <span class="card-year">${esc(year)}</span>
            </footer>
        </button>`;
    }

    // ---- Filter pills ------------------------------------------
    function initFilter() {
        const bar = $('.filter-strip');
        if (!bar) return;
        const pills = $$('.filter-item', bar);
        pills.forEach((pill) => {
            pill.addEventListener('click', () => {
                pills.forEach((p) => { p.classList.remove('is-active'); p.setAttribute('aria-selected', 'false'); });
                pill.classList.add('is-active');
                pill.setAttribute('aria-selected', 'true');
                state.activeFilter = pill.dataset.filter;
                applyFilter();
                updateArchiveCount();
            });
            pill.addEventListener('keydown', (e) => {
                const idx = pills.indexOf(pill);
                let next = null;
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = pills[(idx + 1) % pills.length];
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = pills[(idx - 1 + pills.length) % pills.length];
                else if (e.key === 'Home') next = pills[0];
                else if (e.key === 'End') next = pills[pills.length - 1];
                if (next) { e.preventDefault(); next.focus(); }
            });
        });
    }
    function applyFilter() {
        const filter = state.activeFilter;
        const showArchive = state.showArchive;
        $$('.card-project').forEach((card) => {
            const cats = (card.dataset.categories || '').split(/\s+/);
            const matchesCat = filter === 'all' || cats.includes(filter);
            const isHighlight = card.dataset.highlight === 'true';
            const matchesScope = showArchive || isHighlight;
            card.classList.toggle('is-hidden', !(matchesCat && matchesScope));
        });
    }
    function updateArchiveCount() {
        const filter = state.activeFilter;
        const hidden = state.projects.filter((p) => {
            const matchesCat = filter === 'all' || (p.categories || []).includes(filter);
            return matchesCat && !p.highlight;
        }).length;
        const countEl = $('#archiveCount');
        if (countEl) countEl.textContent = hidden > 0 ? `(${hidden})` : '';
        const btn = $('#archiveToggle');
        if (btn) btn.style.display = hidden === 0 && !state.showArchive ? 'none' : '';
    }
    function initArchiveToggle() {
        const btn = $('#archiveToggle');
        if (!btn) return;
        btn.addEventListener('click', () => {
            state.showArchive = !state.showArchive;
            btn.setAttribute('aria-expanded', state.showArchive ? 'true' : 'false');
            $('.archive-label').textContent = state.showArchive ? 'Hide archive' : 'Show archive';
            applyFilter();
        });
    }

    // ---- Research ----------------------------------------------
    function renderResearch() {
        const mount = $('#researchGrid');
        if (!mount) return;
        mount.innerHTML = state.research.map((c) => {
            const num = pad(c.order, 2);
            const status = (c.status || '').replace(/_/g, ' ');
            const touches = (c.groundwork || []).map((id) => {
                const title = (state.projects.find((p) => p.id === id) || {}).title || id;
                return `<a href="#work" data-project-id="${esc(id)}">${esc(title)}</a>`;
            }).join(', ');
            return `
            <article class="card-research">
                <span class="research-num" aria-hidden="true">${num}</span>
                <p class="research-label">Most wanted · n° ${num}</p>
                <h3 class="research-title">${esc(c.title)}</h3>
                <p class="research-pitch">${esc(c.pitch)}</p>
                <blockquote class="research-question">${esc(c.the_question)}</blockquote>
                <footer class="research-foot">
                    <span class="research-status">${esc(status)}</span>
                    ${touches ? `<span class="research-touches">Touches — ${touches}</span>` : ''}
                </footer>
            </article>`;
        }).join('');
    }

    // ---- Experience timeline -----------------------------------
    function renderExperience() {
        const mount = $('#experienceTimeline');
        if (!mount) return;
        const sorted = state.experiences.slice().sort((a, b) => (b.year_sort || 0) - (a.year_sort || 0));
        mount.innerHTML = sorted.map((e) => {
            const skills = (e.skills || []).map((s) => `<li class="timeline-skill">${esc(s)}</li>`).join('');
            const links = (e.project_ids || []).map((id) => {
                const title = (state.projects.find((p) => p.id === id) || {}).title || id;
                return `<a class="timeline-link" href="#work" data-project-id="${esc(id)}">${esc(title)} →</a>`;
            }).join(' ');
            return `
            <li class="timeline-entry">
                <span class="timeline-year">${esc(e.year)}</span>
                <div class="timeline-body">
                    <h3 class="timeline-role">${esc(e.role)}</h3>
                    <p class="timeline-client">${esc(e.client)}</p>
                    <p class="timeline-scope">${esc(e.scope)}</p>
                    ${skills ? `<ul class="timeline-skills">${skills}</ul>` : ''}
                    ${links ? `<div>${links}</div>` : ''}
                </div>
            </li>`;
        }).join('');
    }

    // ---- Modal + markdown renderer -----------------------------
    async function openModal(projectId, trigger) {
        const p = state.projects.find((x) => x.id === projectId);
        if (!p) return;
        const modal = $('#modal');
        const sheet = $('.dossier-sheet');
        renderDossierLoading();
        modal.setAttribute('aria-hidden', 'false');
        // Only set previous focus on first open in a chain (not on next-card navigation)
        if (!state.modalOpen) {
            state.modalPreviousFocus = document.activeElement;
        }
        state.modalOpen = true;
        state.modalTrigger = trigger;
        document.body.style.overflow = 'hidden';
        if (sheet) sheet.focus();
        modal.scrollTop = 0;
        try {
            const res = await fetch(`data/projects/${projectId}.md`);
            if (!res.ok) throw new Error('Not found');
            const md = await res.text();
            const { frontmatter, content } = splitFrontmatter(md);
            renderDossierFull(p, frontmatter, content);
            modal.scrollTop = 0;
        } catch (err) {
            $('#dossierBody').innerHTML = `<p>Couldn't load the case study. <a href="mailto:contact.raphael.giulieri@gmail.com">Let me know</a> and I'll send it directly.</p>`;
        }
    }
    function renderDossierLoading() {
        $('#dossierHero').className = 'dossier-hero';
        $('#dossierHero').innerHTML = '';
        $('#dossierMetaStrip').innerHTML = '';
        $('#dossierBody').innerHTML = '<p class="dossier-loading">Loading dossier…</p>';
        $('#dossierStat').className = 'dossier-stat is-empty';
        $('#dossierStat').innerHTML = '';
        $('#dossierToc').className = 'dossier-toc is-empty';
        $('#dossierToc').innerHTML = '';
        $('#dossierNext').innerHTML = '';
    }
    function closeModal() {
        const modal = $('#modal');
        modal.setAttribute('aria-hidden', 'true');
        state.modalOpen = false;
        document.body.style.overflow = '';
        if (state.tocObserver) { state.tocObserver.disconnect(); state.tocObserver = null; }
        disconnectDossierMedia();
        if (state.modalPreviousFocus) state.modalPreviousFocus.focus();
    }
    function initModal() {
        const modal = $('#modal');
        // Delegate so dynamically-rendered close buttons (e.g. .dossier-close
        // inside the hero) get picked up — they don't exist at boot.
        modal.addEventListener('click', (e) => {
            const t = e.target.closest('[data-modal-close]');
            if (t) closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (!state.modalOpen) return;
            if (e.key === 'Escape') closeModal();
            if (e.key === 'Tab') trapFocus(e);
        });
        initMediaLightbox();
    }

    // ---- Media lightbox: click a dossier diagram/image to zoom (Discord-style).
    // The SVG diagrams render small inside the narrow dossier column; this lets a
    // reader click any of them (or any still image) to see it full-size. ----
    let lightboxEl = null;
    function getLightbox() {
        if (lightboxEl) return lightboxEl;
        lightboxEl = document.createElement('div');
        lightboxEl.className = 'media-lightbox';
        lightboxEl.setAttribute('role', 'dialog');
        lightboxEl.setAttribute('aria-modal', 'true');
        lightboxEl.setAttribute('aria-label', 'Enlarged image');
        lightboxEl.innerHTML = '<button type="button" class="lightbox-close" aria-label="Close enlarged image">✕</button><img alt="">';
        // A click anywhere (backdrop, the image, or the close button) dismisses.
        lightboxEl.addEventListener('click', () => closeLightbox());
        document.body.appendChild(lightboxEl);
        return lightboxEl;
    }
    function openLightbox(src, alt) {
        const lb = getLightbox();
        const img = lb.querySelector('img');
        img.src = src;
        img.alt = alt || '';
        lb.classList.add('is-open');
    }
    function closeLightbox() {
        if (!lightboxEl) return;
        lightboxEl.classList.remove('is-open');
        const img = lightboxEl.querySelector('img');
        if (img) img.removeAttribute('src'); // release the decoded bitmap
    }
    function initMediaLightbox() {
        // Delegate: clicking any dossier still image / SVG diagram enlarges it.
        document.addEventListener('click', (e) => {
            const img = e.target.closest && e.target.closest('.dossier-media-image img');
            if (!img) return;
            e.preventDefault();
            openLightbox(img.currentSrc || img.src, img.alt);
        });
        // Esc closes the lightbox first. Capture phase + stopPropagation so the
        // dossier's own Esc handler doesn't also fire and close the dossier.
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && lightboxEl && lightboxEl.classList.contains('is-open')) {
                e.stopPropagation();
                e.preventDefault();
                closeLightbox();
            }
        }, true);
    }
    function trapFocus(e) {
        const sheet = $('.dossier-sheet');
        const focusables = $$('a[href], button:not(:disabled), input, textarea, select, [tabindex]:not([tabindex="-1"])', sheet);
        if (focusables.length === 0) { e.preventDefault(); sheet.focus(); return; }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    // Frontmatter --------------------------------------------------
    function splitFrontmatter(md) {
        if (!md.startsWith('---')) return { frontmatter: {}, content: md };
        const end = md.indexOf('\n---', 3);
        if (end === -1) return { frontmatter: {}, content: md };
        const fmRaw = md.slice(3, end).trim();
        const content = md.slice(end + 4).replace(/^\s*\n/, '');
        return { frontmatter: parseFrontmatter(fmRaw), content };
    }
    function parseFrontmatter(raw) {
        // YAML-ish: top-level scalars, arrays of scalars, arrays of objects, nested objects.
        const lines = raw.replace(/\r\n/g, '\n').split('\n');
        const out = {};
        let i = 0;
        const isCommentOrEmpty = (l) => !l.trim() || /^\s*#/.test(l);
        while (i < lines.length) {
            if (isCommentOrEmpty(lines[i])) { i++; continue; }
            const m = lines[i].match(/^(\s*)([a-zA-Z_][\w-]*):\s*(.*)$/);
            if (!m) { i++; continue; }
            const [, indent, key, val] = m;
            if (indent.length > 0) { i++; continue; }   // unexpected nesting at top, skip
            if (val !== '') { out[key] = parseValue(val); i++; continue; }
            // No inline value — peek ahead for array (- ...) or nested object (indented keys)
            let j = i + 1;
            while (j < lines.length && isCommentOrEmpty(lines[j])) j++;
            if (j >= lines.length) { out[key] = []; i = j; continue; }
            const next = lines[j];
            if (/^\s+-\s*/.test(next)) {
                // Array — could be scalars or objects
                const items = [];
                i = j;
                while (i < lines.length) {
                    if (isCommentOrEmpty(lines[i])) { i++; continue; }
                    const itemM = lines[i].match(/^(\s+)-\s*(.*)$/);
                    if (!itemM) break;
                    const [, itemIndent, rest] = itemM;
                    if (itemIndent.length === 0) break;
                    const objM = rest.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
                    if (objM) {
                        // Object entry — first key inline, then continuation lines deeper-indented
                        const obj = {};
                        obj[objM[1]] = parseValue(objM[2]);
                        i++;
                        while (i < lines.length) {
                            if (isCommentOrEmpty(lines[i])) { i++; continue; }
                            const contM = lines[i].match(/^(\s+)([a-zA-Z_][\w-]*):\s*(.*)$/);
                            if (!contM) break;
                            const contIndent = contM[1].length;
                            // Continuation must be deeper than the bullet's "- " line
                            if (contIndent <= itemIndent.length) break;
                            obj[contM[2]] = parseValue(contM[3]);
                            i++;
                        }
                        items.push(obj);
                    } else {
                        items.push(parseValue(rest));
                        i++;
                    }
                }
                out[key] = items;
            } else {
                // Nested object — indented key:value pairs
                const obj = {};
                i = j;
                while (i < lines.length) {
                    if (isCommentOrEmpty(lines[i])) { i++; continue; }
                    const innerM = lines[i].match(/^(\s+)([a-zA-Z_][\w-]*):\s*(.*)$/);
                    if (!innerM) break;
                    if (innerM[1].length === 0) break;
                    obj[innerM[2]] = parseValue(innerM[3]);
                    i++;
                }
                out[key] = obj;
            }
        }
        return out;
    }
    function parseValue(v) {
        v = v.trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
        if (v.startsWith('[') && v.endsWith(']')) {
            return v.slice(1, -1).split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
        }
        if (v === 'true') return true;
        if (v === 'false') return false;
        if (v === 'null') return null;
        if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
        return v;
    }

    // ---- Dossier composition (hero / meta / body+media / aside / next) ----
    function renderDossierFull(p, fm, content) {
        renderDossierHero(p, fm);
        renderDossierMetaStrip(p, fm);
        // Tokenise media placeholders before markdown parse, expand after — so
        // the markdown parser doesn't escape the resulting <figure> HTML.
        const { text, mediaTokens } = tokeniseMedia(content, fm);
        const bodyHtml = expandMediaTokens(renderMarkdown(text), mediaTokens);
        $('#dossierBody').innerHTML = bodyHtml;
        // Hide media figures whose <img> or <video> fail to load
        $$('#dossierBody .dossier-media img').forEach((img) => {
            img.addEventListener('error', () => { const fig = img.closest('figure'); if (fig) fig.style.display = 'none'; });
        });
        $$('#dossierBody .dossier-media video').forEach((vid) => {
            vid.addEventListener('error', () => { const fig = vid.closest('figure'); if (fig) fig.style.display = 'none'; });
        });
        renderDossierAside(p, fm);
        renderDossierNext(p);
        // Defer one frame so the modal is fully laid out before we measure
        // intersection — otherwise everything reports as off-screen on first
        // tick and the visible video never plays.
        requestAnimationFrame(observeDossierMedia);
    }

    function tokeniseMedia(content, fm) {
        const gallery = Array.isArray(fm.gallery) ? fm.gallery : [];
        const mediaTokens = [];
        const placeMedia = (item) => {
            const idx = mediaTokens.length;
            mediaTokens.push(mediaToHtml(item));
            return `@@MEDIA_${idx}@@`;
        };
        let text = content.replace(/!\[\[gallery:(\d+)\]\]/g, (_, n) => {
            const item = gallery[parseInt(n, 10)];
            return item ? placeMedia(item) : '';
        });
        text = text.replace(/!\[\[video:([\w-]+)\]\]/g, (_, name) => {
            const item = gallery.find((g) => g && g.name === name);
            return item ? placeMedia(item) : '';
        });
        return { text, mediaTokens };
    }
    function expandMediaTokens(html, mediaTokens) {
        // Strip <p> wrappers around isolated tokens — figures shouldn't be inside paragraphs.
        const stripped = html.replace(/<p>\s*(@@MEDIA_\d+@@)\s*<\/p>/g, '$1');
        return stripped.replace(/@@MEDIA_(\d+)@@/g, (_, n) => mediaTokens[parseInt(n, 10)] || '');
    }

    function splitTitle(title) {
        // Split on em-dash for "Main — Accent" patterns, else on " — ", else whole
        if (typeof title !== 'string') return { main: String(title || ''), accent: null };
        if (title.includes(' — ')) {
            const [main, ...rest] = title.split(' — ');
            return { main: main.trim(), accent: rest.join(' — ').trim() };
        }
        return { main: title, accent: null };
    }

    function renderDossierHero(p, fm) {
        const heroEl = $('#dossierHero');
        const hero = fm.hero || {};
        const idx = pad(state.projectIndex[p.id] || 0);
        const total = pad(state.projects.length);
        const pc = primaryCategory(p);
        const titleSplit = splitTitle(p.title);

        heroEl.dataset.cat = pc;
        heroEl.classList.remove('hero-loaded', 'hero-fallback');

        const heroSrc = hero.src || '';
        const isVideo = hero.type === 'video' || /\.(mp4|webm|mov)$/i.test(heroSrc);
        const useImage = heroSrc && !isVideo;
        const useVideo = heroSrc && isVideo;

        const titleHtml = titleSplit.accent
            ? `<span>${esc(titleSplit.main)}</span> <em>${esc(titleSplit.accent)}</em>`
            : esc(p.title);

        heroEl.innerHTML = `
            <div class="dossier-hero-bg">
                ${useImage ? `<img src="${esc(heroSrc)}" alt="${esc(hero.alt || p.title)}" loading="eager" decoding="async">` : ''}
                ${useVideo ? `<video src="${esc(heroSrc)}" ${hero.poster ? `poster="${esc(hero.poster)}"` : ''} autoplay loop muted playsinline></video>` : ''}
            </div>
            <div class="dossier-hero-overlay">
                <span class="dossier-hero-index">n° ${idx} <i>/</i> ${total}</span>
                <div class="dossier-hero-tools">
                    <span class="dossier-status-pill" data-status="${esc(p.status || '')}">${esc(p.status || '')}</span>
                    <button class="dossier-close" aria-label="Close dossier" data-modal-close>
                        <span>Close</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                </div>
                <h2 class="dossier-hero-title" id="dossierTitle">${titleHtml}</h2>
            </div>
        `;

        if (!useImage && !useVideo) {
            heroEl.classList.add('hero-fallback');
        } else if (useImage) {
            const img = heroEl.querySelector('img');
            if (img) {
                if (img.complete && img.naturalWidth > 0) {
                    heroEl.classList.add('hero-loaded');
                } else {
                    img.addEventListener('load', () => heroEl.classList.add('hero-loaded'));
                    img.addEventListener('error', () => {
                        heroEl.classList.add('hero-fallback');
                        img.remove();
                    });
                }
            }
        }
    }

    function renderDossierMetaStrip(p, fm) {
        const strip = $('#dossierMetaStrip');
        const parts = [];
        if (p.role) parts.push(`<span><i>Role</i> ${esc(p.role)}</span>`);
        if (p.client) parts.push(`<span><i>Client</i> ${esc(p.client)}</span>`);
        parts.push(`<span><i>Year</i> ${esc(p.year_range || p.year || '')}</span>`);
        const skills = (p.skills_short || []).slice(0, 3);
        if (skills.length) {
            parts.push(`<span class="dossier-meta-skills">${skills.map((s) => `<em class="skill-chip">${esc(s)}</em>`).join('')}</span>`);
        }
        const links = p.links || {};
        if (links.repo)   parts.push(`<a href="${esc(links.repo)}" target="_blank" rel="noopener">Repo ↗</a>`);
        if (links.demo)   parts.push(`<a href="${esc(links.demo)}" target="_blank" rel="noopener">Demo ↗</a>`);
        strip.innerHTML = parts.join('<i class="meta-sep" aria-hidden="true">·</i>');
    }

    function resolveMediaPlaceholders(content, fm) {
        const gallery = Array.isArray(fm.gallery) ? fm.gallery : [];
        // ![[gallery:N]]
        let s = content.replace(/!\[\[gallery:(\d+)\]\]/g, (_, n) => {
            const item = gallery[parseInt(n, 10)];
            return item ? mediaToHtml(item) : '';
        });
        // ![[video:NAME]] — looks for a gallery item with name=NAME
        s = s.replace(/!\[\[video:([\w-]+)\]\]/g, (_, name) => {
            const item = gallery.find((g) => g && g.name === name);
            return item ? mediaToHtml(item) : '';
        });
        return s;
    }

    function mediaToHtml(item) {
        if (!item || !item.src) return '';
        const cap = item.caption ? `<figcaption>${esc(item.caption)}</figcaption>` : '';
        const isShader = item.type === 'shader' || item.type === 'iframe' || /\.html?($|\?)/i.test(item.src);
        const isVideo = item.type === 'video' || /\.(mp4|webm|mov)$/i.test(item.src);
        if (isShader) {
            const aspect = item.aspect || '16 / 10';
            const title = item.alt || item.caption || 'Live demo';
            // data-src instead of src — the iframe doesn't load (and therefore
            // doesn't start its WebGL context) until it scrolls into view.
            // about:blank placeholder keeps the iframe element valid in the DOM.
            return `<figure class="dossier-media dossier-media-shader" style="--aspect: ${esc(aspect)}">
                <div class="shader-frame-wrap">
                    <iframe class="shader-frame" src="about:blank" data-src="${esc(item.src)}" title="${esc(title)}" loading="lazy" allow="autoplay; fullscreen" referrerpolicy="no-referrer"></iframe>
                    <a class="shader-popout" href="${esc(item.src)}" target="_blank" rel="noopener" aria-label="Open demo in new tab">↗ open</a>
                </div>
                ${cap}
            </figure>`;
        }
        if (isVideo) {
            // No autoplay attribute — the IntersectionObserver in observeMedia()
            // calls .play() when the figure becomes visible and .pause() when it
            // leaves. Cuts video-decode load to whatever's actually on-screen.
            return `<figure class="dossier-media dossier-media-video"><video src="${esc(item.src)}" ${item.poster ? `poster="${esc(item.poster)}"` : ''} loop muted playsinline preload="metadata"></video>${cap}</figure>`;
        }
        return `<figure class="dossier-media dossier-media-image"><img src="${esc(item.src)}" alt="${esc(item.alt || '')}" loading="lazy" decoding="async">${cap}</figure>`;
    }

    // Pause videos and unload shader iframes that aren't currently on-screen.
    // Without this, opening tech_compute_procedural starts 4 video decodes + 4
    // WebGL2 contexts simultaneously, which destroys frame rate.
    let dossierMediaObserver = null;
    function observeDossierMedia() {
        if (dossierMediaObserver) dossierMediaObserver.disconnect();
        // Scroll container is `.dossier` (outer modal div). `.dossier-sheet`
        // doesn't scroll despite housing the content.
        const root = document.querySelector('.dossier') || null;
        // Observe the .dossier-media FIGURES rather than the video/iframe inside.
        // The figures carry content-visibility:auto; observing inside a
        // content-contained subtree suppresses IntersectionObserver updates,
        // which is why the previous attempt failed (videos never paused on
        // scroll-away). The figure itself is always the observed boundary.
        // threshold: 1.0 = the entire figure must fit within the viewport.
        dossierMediaObserver = new IntersectionObserver((entries) => {
            for (const e of entries) {
                const fig = e.target;
                const fullyVisible = e.intersectionRatio >= 0.999;
                const video = fig.querySelector('video');
                const iframe = fig.querySelector('iframe.shader-frame');
                if (video) {
                    if (fullyVisible) video.play().catch(() => {});
                    else { try { video.pause(); } catch {} }
                }
                if (iframe) {
                    if (fullyVisible && iframe.dataset.src && iframe.src !== iframe.dataset.src) {
                        iframe.src = iframe.dataset.src;
                    } else if (!fullyVisible && iframe.dataset.src && iframe.src !== 'about:blank') {
                        try { iframe.src = 'about:blank'; } catch {}
                    }
                }
            }
        }, { root, threshold: [0, 0.5, 0.999, 1.0] });

        $$('#dossierBody .dossier-media').forEach((el) => {
            dossierMediaObserver.observe(el);
        });
    }
    function disconnectDossierMedia() {
        if (dossierMediaObserver) { dossierMediaObserver.disconnect(); dossierMediaObserver = null; }
        // Also explicitly pause everything in case the observer's pause callback didn't fire.
        $$('#dossierBody video').forEach((v) => { try { v.pause(); } catch {} });
        $$('#dossierBody iframe.shader-frame').forEach((f) => { try { f.src = 'about:blank'; } catch {} });
    }

    function renderDossierAside(p, fm) {
        const headline = fm.headline || {};
        const statEl = $('#dossierStat');
        if (headline.value) {
            statEl.innerHTML = `
                <div class="dossier-stat-figure">${esc(headline.value)}</div>
                <div class="dossier-stat-label">${esc(headline.label || '')}</div>
            `;
            statEl.classList.remove('is-empty');
        } else {
            statEl.innerHTML = '';
            statEl.classList.add('is-empty');
        }

        // Build TOC from h2s in the rendered body
        const headings = $$('#dossierBody h2');
        const tocEl = $('#dossierToc');
        if (state.tocObserver) { state.tocObserver.disconnect(); state.tocObserver = null; }
        if (headings.length === 0) {
            tocEl.innerHTML = '';
            tocEl.classList.add('is-empty');
            return;
        }
        tocEl.classList.remove('is-empty');
        const items = headings.map((h, idx) => {
            const id = `dossier-h2-${idx}`;
            h.id = id;
            const label = h.textContent.replace(/^§\s*/, '').trim();
            return `<li><a href="#${id}" data-toc-target="${id}"><span>${esc(label)}</span></a></li>`;
        }).join('');
        tocEl.innerHTML = `<p class="toc-label">In this dossier</p><ol>${items}</ol>`;

        // Click → smooth scroll within modal scroll container
        const modal = $('#modal');
        $$('a[data-toc-target]', tocEl).forEach((a) => {
            a.addEventListener('click', (e) => {
                e.preventDefault();
                const target = document.getElementById(a.dataset.tocTarget);
                if (!target) return;
                const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                const top = target.getBoundingClientRect().top - modal.getBoundingClientRect().top + modal.scrollTop - 24;
                modal.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
            });
        });

        // Scroll-spy
        if ('IntersectionObserver' in window) {
            const links = $$('a[data-toc-target]', tocEl);
            state.tocObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        const id = entry.target.id;
                        links.forEach((l) => l.classList.toggle('is-active', l.dataset.tocTarget === id));
                    }
                });
            }, { root: modal, rootMargin: '-15% 0px -65% 0px', threshold: 0 });
            headings.forEach((h) => state.tocObserver.observe(h));
        }
    }

    function renderDossierNext(p) {
        const nextEl = $('#dossierNext');
        const ranked = state.projects
            .filter((x) => x.highlight)
            .slice()
            .sort((a, b) => ((b.rank || 0) - (a.rank || 0)) || ((b.year || 0) - (a.year || 0)));
        if (ranked.length === 0) { nextEl.innerHTML = ''; return; }
        const idx = ranked.findIndex((x) => x.id === p.id);
        // Wrap to first if at the end; if not in highlights at all, pick top
        const next = idx === -1 ? ranked[0] : ranked[(idx + 1) % ranked.length];
        if (!next || next.id === p.id) { nextEl.innerHTML = ''; return; }
        const pc = primaryCategory(next);
        nextEl.innerHTML = `
            <p class="next-label">Continue reading</p>
            <button class="next-card" data-project-id="${esc(next.id)}" style="--cat-color: var(--cat-${pc})" type="button">
                <span class="next-num">n° ${pad(state.projectIndex[next.id])} <i>/</i> ${pad(state.projects.length)}</span>
                <span class="next-cat">${esc(categoryDisplay(next.categories))}</span>
                <h3 class="next-title">${esc(next.title)}</h3>
                <p class="next-tagline">${esc(next.tagline || '')}</p>
                <span class="next-arrow">Continue <i aria-hidden="true">→</i></span>
            </button>
        `;
        const btn = nextEl.querySelector('.next-card');
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                openModal(next.id, btn);
            });
        }
    }

    // Minimal markdown renderer ------------------------------------
    function renderMarkdown(md) {
        const lines = md.replace(/\r\n/g, '\n').split('\n');
        const out = [];
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            if (/^```/.test(line)) {
                const lang = line.replace(/^```/, '').trim();
                const buf = []; i++;
                while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
                i++;
                out.push(`<pre><code${lang ? ` class="lang-${esc(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
                continue;
            }
            if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
            const h = line.match(/^(#{1,3})\s+(.*)$/);
            if (h) {
                const level = h[1].length;
                out.push(`<h${level}>${inline(h[2])}</h${level}>`);
                i++; continue;
            }
            if (/^>\s?/.test(line)) {
                const buf = [];
                while (i < lines.length && /^>\s?/.test(lines[i])) {
                    buf.push(lines[i].replace(/^>\s?/, ''));
                    i++;
                }
                out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
                continue;
            }
            if (/^\|/.test(line) && i + 1 < lines.length && /^\|?\s*[-:| ]+$/.test(lines[i + 1])) {
                const rows = [];
                while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
                out.push(renderTable(rows));
                continue;
            }
            if (/^[\s]*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
                const ordered = /^\s*\d+\.\s+/.test(line);
                const tag = ordered ? 'ol' : 'ul';
                const items = [];
                while (i < lines.length && (ordered ? /^\s*\d+\.\s+/.test(lines[i]) : /^\s*[-*+]\s+/.test(lines[i]))) {
                    const item = lines[i].replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/, '');
                    items.push(`<li>${inline(item)}</li>`);
                    i++;
                }
                out.push(`<${tag}>${items.join('')}</${tag}>`);
                continue;
            }
            if (!line.trim()) { i++; continue; }
            const pBuf = [];
            while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>\s?|```|---|\s*[-*+]\s|\s*\d+\.\s|\|)/.test(lines[i])) {
                pBuf.push(lines[i]); i++;
            }
            if (pBuf.length) out.push(`<p>${inline(pBuf.join(' '))}</p>`);
        }
        return out.join('\n');
    }
    function renderTable(rows) {
        const splitRow = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const header = splitRow(rows[0]);
        const body = rows.slice(2).map(splitRow);
        const th = header.map((c) => `<th>${inline(c)}</th>`).join('');
        const trs = body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
        return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
    }
    function inline(text) {
        let s = esc(text);
        s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
        s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => {
            const url = u.replace(/\s+.*$/, '');
            if (/^data\/projects\/([\w-]+)\.md$/.test(url)) {
                const id = url.match(/^data\/projects\/([\w-]+)\.md$/)[1];
                return `<a href="#work" data-project-id="${id}">${t}</a>`;
            }
            const isExternal = /^https?:/.test(url);
            return `<a href="${esc(url)}"${isExternal ? ' target="_blank" rel="noopener"' : ''}>${t}</a>`;
        });
        return s;
    }

    // Delegate clicks on [data-project-id] to open modal
    document.addEventListener('click', (e) => {
        const a = e.target.closest('[data-project-id]');
        if (!a) return;
        if (a.closest('#dossierBody, .card-research, .hero-project-card, .timeline-link, .research-touches, .dossier-next')) {
            e.preventDefault();
            openModal(a.dataset.projectId, a);
        }
    });

    // ---- Scroll reveals ----------------------------------------
    function initReveals() {
        if (!('IntersectionObserver' in window)) {
            $$('.revealable').forEach((el) => el.classList.add('is-in'));
            return;
        }
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-in');
                    io.unobserve(entry.target);
                }
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
        $$('.revealable').forEach((el) => io.observe(el));
    }

    // ---- Rail active-section ------------------------------------
    function initRail() {
        const rail = $('.rail-list');
        if (!rail) return;
        const sections = $$('[data-section]');
        const stops = $$('li', rail);
        if (!('IntersectionObserver' in window)) return;
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    const key = entry.target.dataset.section;
                    stops.forEach((s) => s.classList.toggle('is-active', s.dataset.section === key));
                }
            });
        }, { rootMargin: '-40% 0px -40% 0px', threshold: 0 });
        sections.forEach((s) => io.observe(s));
    }

    // ---- Boot ---------------------------------------------------
    async function boot() {
        initTheme();
        try {
            await loadData();
        } catch (err) {
            console.error('Data load failed', err);
            const projectsMount = $('#projectsGrid');
            if (projectsMount) projectsMount.innerHTML = '<p class="loading">Could not load portfolio data. Check the console.</p>';
            return;
        }
        renderStats();
        renderProjects();
        renderFeatured();
        renderResearch();
        renderExperience();
        initFilter();
        renderFilterCounts();
        initArchiveToggle();
        initModal();
        initReveals();
        initRail();

        // Re-trigger reveals for dynamically-rendered content
        const heroRevealables = $$('.hero .revealable');
        requestAnimationFrame(() => {
            heroRevealables.forEach((el) => el.classList.add('is-in'));
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    // Public surface for js/chat.js — read-only references, do not mutate.
    window.openModal = openModal;
    window.renderMarkdown = renderMarkdown;
    Object.defineProperty(window, 'RG_PROJECTS', {
        get: () => state.projects,
        configurable: false,
    });
})();
