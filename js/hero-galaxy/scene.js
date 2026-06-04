// Phase 6: full scene with state machine. Galaxy → system → planet visibility
// driven by `state.level`. Bodies are allocated up-front; per-frame visibility
// filters which ones go into the render pass. Exposes window.HERO_GALAXY
// programmatic API so we can verify navigation without the click handlers
// (those land in Phase 7).

import { createCamera, setAspect, applyOrbitDelta } from './render/camera.js';
import { wireControls } from './render/controls.js';
import { makeIcosphere } from './render/sphere-mesh.js';
import { getMeshPipeline, getBloomPipeline } from './render/pipeline.js';
import { loadGalaxyData } from './data-loader.js';
import { createBody, writeBodyUbo, bodyDescFromStar, bodyDescFromPlanet, bodyDescFromMoon } from './bodies.js';
import { mat4Identity } from '../particles/core/math.js';
import { screenToRay, hitTestBodies } from './render/raycast.js';
import { createBreadcrumb } from './breadcrumb.js';
import { mountStarfield } from './render/starfield.js';
import { mat4Multiply } from '../particles/core/math.js';
import { setupDevPanel, applySavedDefaults } from './dev-panel.js';
import { mountConsole } from './console.js';

const HERO_GALAXY_DEV_PANEL = true;   // flip to false in production

// Mesh canvas is layered ON TOP of the starfield canvas; clear with alpha=0
// so the stars show through wherever meshes don't draw.
const CLEAR_COLOR = { r: 0, g: 0, b: 0, a: 0 };

export async function mountScene({ section }) {
    const canvas = section.querySelector('#galaxy-canvas');
    if (!canvas) throw new Error('no #galaxy-canvas');
    const starsCanvas = section.querySelector('#galaxy-stars');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resizeBacking() {
        const w = Math.floor(canvas.clientWidth  * dpr);
        const h = Math.floor(canvas.clientHeight * dpr);
        let changed = false;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; changed = true; }
        if (starsCanvas && (starsCanvas.width !== w || starsCanvas.height !== h)) {
            starsCanvas.width = w; starsCanvas.height = h;
        }
        return changed;
    }
    resizeBacking();

    const galaxy = await loadGalaxyData();

    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'premultiplied' });

    const camera = createCamera();
    setAspect(camera, canvas.width / canvas.height);
    camera.distance = 80;
    camera.target.set([0, 0, 0]);

    // State machine
    const state = {
        level: 'galaxy',
        focusedSystemId: null,
        focusedPlanetId: null,
        focusedMoonId:   null,
    };

    // Breadcrumb DOM manager. `onCrumbClick` is wired below to call transitionTo
    // (defined after state, since it closes over `transitionTo`).
    const breadcrumb = createBreadcrumb({
        root: section,
        galaxyData: galaxy,
        onCrumbClick: (key) => {
            if (key === 'galaxy') transitionTo({ level: 'galaxy' });
            else if (key.startsWith('system:')) transitionTo({ level: 'system', focusedSystemId: key.slice(7) });
            else if (key.startsWith('planet:')) transitionTo({ level: 'planet', focusedSystemId: state.focusedSystemId, focusedPlanetId: key.slice(7) });
            else if (key.startsWith('moon:'))   transitionTo({ level: 'moon',   focusedSystemId: state.focusedSystemId, focusedPlanetId: state.focusedPlanetId, focusedMoonId: key.slice(5) });
        },
    });

    // Spaceship-board console — context for the current focal body. Mounts
    // bottom-left of the section, re-rendered whenever `state` transitions.
    // "Open dossier" is the only path to the modal now that clicking a moon
    // zooms in instead of opening it.
    const consoleApi = await mountConsole({
        section,
        galaxyData: galaxy,
        onOpenDossier: (projectId) => {
            if (typeof window.openModal === 'function') window.openModal(projectId, section);
        },
    });
    consoleApi.render(state);

    const controls = wireControls({
        canvas, camera, getState: () => state.level,
    });

    // Live-mutable tuning state for the dev panel + render loop.
    const postfx = {
        enableBloom:    true,
        bloomThreshold: 0.55,
        bloomSoftKnee:  0.6,
        bloomIntensity: 0.7,
        blurPasses:     2,
        exposure:       1.0,
        vignette:       0.08,
    };
    const ambient = {
        planetSpinRate: 0.2,   // rad/sec planet self-rotation factor
    };

    // Compute global JSON orbit-radius bounds. The dev panel's planetOrbitMin /
    // planetOrbitMax (and the moon equivalents) re-map each body's orbit radius
    // by lerping between those bounds, keyed off the body's original normalized
    // position. The innermost planet across all systems hits the user-set min;
    // the outermost hits the max; all others distribute proportionally. Same
    // logic for moons against the global moon-radius range.
    const allPlanetR = galaxy.systems.flatMap(s => s.planets.map(p => p.orbit?.radius ?? 0));
    const allMoonR   = galaxy.systems.flatMap(s => s.planets.flatMap(p => (p.moons || []).map(m => m.orbit?.radius ?? 0)));
    const _planetOrigMin = allPlanetR.length ? Math.min(...allPlanetR) : 1;
    const _planetOrigMax = allPlanetR.length ? Math.max(...allPlanetR) : 1;
    const _moonOrigMin   = allMoonR.length   ? Math.min(...allMoonR)   : 1;
    const _moonOrigMax   = allMoonR.length   ? Math.max(...allMoonR)   : 1;
    const _planetSpan = Math.max(1e-6, _planetOrigMax - _planetOrigMin);
    const _moonSpan   = Math.max(1e-6, _moonOrigMax   - _moonOrigMin);

    // Body spread + camera distances — multipliers on top of the JSON values
    // so the dev panel can tune the whole scene's scale without re-baking data.
    const world = {
        galaxySpread:      1.0,   // multiplier on star positions from origin
        // Per-orbit ranges. Innermost body across all systems sits at *Min,
        // outermost at *Max; everything in between is lerped proportionally.
        // Factory defaults reproduce the original JSON layout.
        planetOrbitMin:    _planetOrigMin,
        planetOrbitMax:    _planetOrigMax,
        moonOrbitMin:      _moonOrigMin,
        moonOrbitMax:      _moonOrigMax,
        starSize:          1.0,
        planetSize:        1.0,
        moonSize:          1.0,
        haloScale:         2.4,
        camDistGalaxy:     140,
        camDistSystem:     32,
        camDistPlanet:     6,
        camDistMoon:       1.5,
        // Lighting. Each planet + moon is lit by its parent star via Lambert
        // in fs_main; ambientFloor is the night-side luminance it keeps so
        // the dark side still reads (editorial > realism). sunTintStrength
        // bleeds the parent star's tint onto the day-side (0 = colour-neutral
        // Lambert, 1 = day-side fully picks up the sun's colour).
        ambientFloor:      0.18,
        sunTintStrength:   0.55,
        // Sun bloom — a camera-facing gaussian billboard per sun, drawn
        // additively after the halo pass. Independent of the bloom on
        // distant starfield particles (which is handled by the engine's
        // post-fx on its own canvas).
        sunBloomRadiusMul: 5.5,   // billboard size = sun radius × this
        sunBloomIntensity: 1.4,   // brightness of the glow at centre
        sunBloomFalloff:   2.4,   // gaussian sharpness — higher = tighter
        // Label positioning — see CSS --gap and the per-kind silhouette
        // multipliers used in the per-frame projection.
        labelGapPx:        6,
        labelMultStar:     1.2,   // multiplier of star's body radius (no halo math)
        labelMultPlanet:   1.0,
        labelMultMoon:     1.0,
    };

    // Snapshot the code-side defaults BEFORE applying any localStorage
    // overrides — the dev panel uses this for "reset to factory".
    const factoryDefaults = {
        postfx:  { ...postfx },
        ambient: { ...ambient },
        world:   { ...world },
    };
    // Layer any saved overrides on top of the live state. If the user clicked
    // "save as default" in a prior session, those values now take effect.
    if (HERO_GALAXY_DEV_PANEL) applySavedDefaults({ postfx, ambient, world });

    const ico = makeIcosphere(5);
    const vbuf = device.createBuffer({ size: ico.vertexData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vbuf, 0, ico.vertexData);
    const ibuf = device.createBuffer({ size: ico.indexData.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ibuf, 0, ico.indexData);

    let depthTex = null;
    function ensureDepth() {
        if (depthTex && depthTex.width === canvas.width && depthTex.height === canvas.height) return;
        depthTex?.destroy();
        depthTex = device.createTexture({
            size: [canvas.width, canvas.height, 1],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
    }
    ensureDepth();

    const camUbo = device.createBuffer({ size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Warm core pipelines
    const { pipeline: defaultPipeline, cameraBGL, bodyBGL } =
        await getMeshPipeline(device, format, 'default-planet.wgsl');
    const cameraBG = device.createBindGroup({
        layout: cameraBGL,
        entries: [{ binding: 0, resource: { buffer: camUbo } }],
    });
    const { pipeline: starPipeline } = await getMeshPipeline(device, format, 'star.wgsl');
    const { pipeline: moonPipeline } = await getMeshPipeline(device, format, 'default-moon.wgsl');
    const { pipeline: starHaloPipeline } = await getMeshPipeline(device, format, 'star-halo.wgsl', { alphaBlend: true });
    // Halo bodies share the star's accent + UBO data but are drawn at a larger
    // scale on a separate pass. The multiplier lives in `world.haloScale` so
    // the dev panel can tune the bloom-disc size live.

    // Star bloom billboard pipeline — gaussian sprite per sun, drawn last so
    // the glow stacks over halos + meshes additively. Builds its own camera
    // bind group because its bodyBGL is a separate layout.
    const { pipeline: sunBloomPipeline, cameraBGL: bloomCameraBGL, bodyBGL: bloomBodyBGL }
        = await getBloomPipeline(device, format);
    const bloomCameraBG = device.createBindGroup({
        layout: bloomCameraBGL,
        entries: [{ binding: 0, resource: { buffer: camUbo } }],
    });

    // Mount the starfield (on its own canvas, its own GPUDevice). Mobile gets
    // a smaller count for budget; matched to spec § 5.3.
    const isMobile = window.matchMedia('(max-width: 720px)').matches;
    let starPs = null;
    if (starsCanvas) {
        try {
            starPs = await mountStarfield({ canvas: starsCanvas, particleCount: isMobile ? 8000 : 20000 });
        } catch (e) {
            console.warn('[hero-galaxy] starfield mount failed (continuing without stars):', e);
        }
    }

    // ── Phase 12: per-planet particle rings ──
    // Disc-mesh rings + bloom are deferred to v2 (see spec § Out of scope and
    // Task 14.1). Particle rings work today by adding emitters to the
    // starfield ps and binding the orbit module's centre params to live
    // planet positions (we update them in the frame loop below).
    const ringOrbits = [];   // [{ planetBody, orbitMod }]
    if (starPs) {
        try {
            const { Emitter, shapes, modules } = await import('../particles/index.js');
            for (const sys of galaxy.systems) {
                for (const p of sys.planets) {
                    const r = p.ring;
                    if (!r || r.type !== 'particles') continue;
                    const planetEntry = planets.find(pl => pl.body.id === p.id);
                    if (!planetEntry) continue;
                    const body = planetEntry.body;
                    const meanR = (r.innerRadius + r.outerRadius) / 2;
                    const thick = r.outerRadius - r.innerRadius;
                    const tiltRad = (r.tilt || 0) * Math.PI / 180;
                    const axis = [0, Math.cos(tiltRad), Math.sin(tiltRad)];
                    const orbitMod = modules.orbit({
                        center: [body.worldPos[0], body.worldPos[1], body.worldPos[2]],
                        axis, speed: 0.4, radius: meanR, springK: 8,
                    });
                    ringOrbits.push({ planetBody: body, orbitMod });
                    await starPs.addEmitter(new Emitter({
                        position: [body.worldPos[0], body.worldPos[1], body.worldPos[2]],
                        shape: shapes.ring({ radius: meanR, thickness: thick, height: 0.05 }),
                        rate: 0,
                        bursts: [{ time: 0, count: isMobile ? Math.floor((r.count || 3000) * 0.4) : (r.count || 3000) }],
                        initial: {
                            lifetime: { min: 1e9, max: 1e9 },
                            speed:    { min: 0, max: 0 },
                            size:     { min: 0.6, max: 1.4 },
                            color:    [body.accent[0], body.accent[1], body.accent[2], 1],
                        },
                        modules: [orbitMod],
                    }));
                }
            }
        } catch (e) {
            console.warn('[hero-galaxy] particle rings setup failed (continuing without rings):', e);
        }
    }

    // Per-planet pipeline cache. Keys are shader paths; values are built
    // pipelines (or the default-planet pipeline on fetch/compile failure).
    const planetPipelineCache = new Map();
    planetPipelineCache.set('default-planet.wgsl', { pipeline: defaultPipeline });
    async function planetPipelineFor(shaderPath) {
        if (planetPipelineCache.has(shaderPath)) return planetPipelineCache.get(shaderPath);
        const built = await getMeshPipeline(device, format, shaderPath);
        planetPipelineCache.set(shaderPath, built);
        return built;
    }
    // Warm pipelines for EVERY planet up-front, in parallel, so they render
    // immediately at galaxy view rather than only after a system has been
    // visited. Most fall back to default-planet.wgsl; the 4 distinctive
    // shaders compile genuinely. Cost is one-time at boot (<150ms typical).
    {
        const allShaderPaths = new Set();
        for (const sys of galaxy.systems) {
            for (const p of sys.planets) allShaderPaths.add(p.shader || 'default-planet.wgsl');
        }
        await Promise.all(Array.from(allShaderPaths).map(planetPipelineFor));
    }

    // Build star, planet, and moon bodies (each system's centre IS a star,
    // not "our sun" — the rename reflects that. Some metadata keys remain
    // `sun*` in the JSON for back-compat with the spec; the runtime is star-).
    const stars = [];
    const planets = []; // [{ body, star }]
    const moons   = []; // [{ body, planet }]
    for (const sys of galaxy.systems) {
        const star = createBody(device, bodyBGL, {
            ...bodyDescFromStar(sys),
            label: `star ${sys.id}`,
        });
        star.accent[0] = sys.sunTint[0];
        star.accent[1] = sys.sunTint[1];
        star.accent[2] = sys.sunTint[2];
        star.accent[3] = 1.0;
        // Cache the original position from JSON; the frame loop multiplies by
        // world.galaxySpread so the dev panel can re-space the galaxy live.
        star._origPos = [sys.galaxyPosition[0], sys.galaxyPosition[1], sys.galaxyPosition[2]];
        star._origScale = star.scale;
        star.worldPos[0] = sys.galaxyPosition[0];
        star.worldPos[1] = sys.galaxyPosition[1];
        star.worldPos[2] = sys.galaxyPosition[2];
        // Halo companion — same accent + worldPos, separate UBO so it can be
        // drawn with the alpha-blended halo pipeline without conflicting with
        // the star's own UBO write.
        star.haloBuf = device.createBuffer({
            label: `star-halo ${sys.id}`,
            size: 128,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        star.haloBG = device.createBindGroup({
            layout: bodyBGL,
            entries: [{ binding: 0, resource: { buffer: star.haloBuf } }],
        });
        // Bloom billboard UBO — separate buffer + bind group bound to the
        // bloom pipeline's own bodyBGL (the bloom shader has its own
        // BindGroupLayout in pipeline.js).
        star.bloomBuf = device.createBuffer({
            label: `star-bloom ${sys.id}`,
            size: 128,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        star.bloomBG = device.createBindGroup({
            layout: bloomBodyBGL,
            entries: [{ binding: 0, resource: { buffer: star.bloomBuf } }],
        });
        stars.push(star);
        for (const p of sys.planets) {
            const planetBody = createBody(device, bodyBGL, {
                ...bodyDescFromPlanet(p, sys), label: `planet ${p.id}`,
            });
            planetBody._origScale  = planetBody.scale;
            planetBody._origOrbitR = p.orbit?.radius ?? 0;
            planetBody._origOrbitFrac = (planetBody._origOrbitR - _planetOrigMin) / _planetSpan;
            planets.push({ body: planetBody, star });
            for (const m of p.moons || []) {
                const moonBody = createBody(device, bodyBGL, {
                    ...bodyDescFromMoon(m, p, sys), label: `moon ${m.projectId}`,
                });
                moonBody._origScale  = moonBody.scale;
                moonBody._origOrbitR = m.orbit?.radius ?? 0;
                moonBody._origOrbitFrac = (moonBody._origOrbitR - _moonOrigMin) / _moonSpan;
                // `star` is denormalized here so the frame loop can pass
                // the moon's grandparent-star position into the lighting UBO
                // without a chain lookup.
                moons.push({ body: moonBody, planet: planetBody, star });
            }
        }
    }

    // Per-body floating labels (DOM-positioned in CSS px each frame).
    const labelsRoot = section.querySelector('#galaxy-labels');
    const labels = new Map();   // body → { el, body }
    if (labelsRoot) {
        for (const star of stars) {
            const sys = galaxy.systems.find(s => s.id === star.id);
            const el = document.createElement('div');
            el.className = 'galaxy-label is-star';
            el.textContent = sys?.name || star.id;
            labelsRoot.appendChild(el);
            labels.set(star, { el, body: star });
        }
        for (const { body } of planets) {
            const el = document.createElement('div');
            el.className = 'galaxy-label is-planet';
            el.textContent = body.meta.planetName || body.id;
            labelsRoot.appendChild(el);
            labels.set(body, { el, body });
        }
        for (const { body } of moons) {
            const el = document.createElement('div');
            el.className = 'galaxy-label is-moon';
            el.textContent = body.meta.title || body.meta.projectId;
            labelsRoot.appendChild(el);
            labels.set(body, { el, body });
        }
    }
    // Reused per-frame scratch (avoid GC pressure projecting ~40 bodies/frame).
    const _vp     = new Float32Array(16);
    const _proj4  = new Float32Array(4);

    function visibleStars()   { return stars; }
    function visiblePlanets() {
        // Render every planet at every level — other-system planets stay
        // visible at planet view so the user can hop to them directly.
        return planets;
    }
    function visibleMoons() {
        // Render every moon at every level — keeps the full structure of the
        // galaxy visible whatever the user is focused on.
        return moons;
    }

    function applyStateCamera() {
        if (state.level === 'galaxy') {
            camera.target.set([0, 0, 0]);
            camera.distance = world.camDistGalaxy;
        } else if (state.level === 'system') {
            const star = stars.find(s => s.id === state.focusedSystemId);
            if (star) {
                camera.target.set(star.worldPos);
                camera.distance = world.camDistSystem;
            }
        } else if (state.level === 'planet') {
            const planetBody = planets.find(p => p.body.id === state.focusedPlanetId)?.body;
            if (planetBody) {
                camera.target.set(planetBody.worldPos);
                camera.distance = world.camDistPlanet;
            }
        } else if (state.level === 'moon') {
            const moonBody = moons.find(m => m.body.id === state.focusedMoonId)?.body;
            if (moonBody) {
                camera.target.set(moonBody.worldPos);
                camera.distance = world.camDistMoon;
            }
        }
        applyOrbitDelta(camera, 0, 0);
    }

    // ── Bezier-eased camera transitions ────────────────────────────────────
    let transition = null;
    function transitionTo(goal) {
        const start = {
            yaw: camera.yaw, pitch: camera.pitch, distance: camera.distance,
            target: [camera.target[0], camera.target[1], camera.target[2]],
        };
        let endTarget = [0, 0, 0], endDist = world.camDistGalaxy;
        if (goal.level === 'system' || goal.level === 'planet') {
            const sysId = goal.focusedSystemId || state.focusedSystemId;
            const sys = galaxy.systems.find(s => s.id === sysId);
            if (sys) {
                for (const p of sys.planets) {
                    planetPipelineFor(p.shader || 'default-planet.wgsl');
                }
            }
        }
        if (goal.level === 'system') {
            const star = stars.find(s => s.id === goal.focusedSystemId);
            if (star) { endTarget = [star.worldPos[0], star.worldPos[1], star.worldPos[2]]; endDist = world.camDistSystem; }
        } else if (goal.level === 'planet') {
            const planetEntry = planets.find(p => p.body.id === goal.focusedPlanetId);
            if (planetEntry) {
                const body = planetEntry.body;
                endTarget = [body.worldPos[0], body.worldPos[1], body.worldPos[2]];
                endDist = world.camDistPlanet;
            }
        } else if (goal.level === 'moon') {
            const moonEntry = moons.find(m => m.body.id === goal.focusedMoonId);
            if (moonEntry) {
                const body = moonEntry.body;
                endTarget = [body.worldPos[0], body.worldPos[1], body.worldPos[2]];
                endDist = world.camDistMoon;
            }
        }
        const fromLevel = state.level, toLevel = goal.level;
        const ms = (fromLevel === 'galaxy' || toLevel === 'galaxy') ? 1200 : 900;
        transition = {
            start,
            end: { yaw: camera.yaw, pitch: camera.pitch, distance: endDist, target: endTarget },
            t0: performance.now(), ms, goal,
        };
        // Reflect the destination in the breadcrumb during the fly.
        breadcrumb.render({
            level: goal.level,
            focusedSystemId: goal.focusedSystemId ?? state.focusedSystemId,
            focusedPlanetId: goal.focusedPlanetId ?? state.focusedPlanetId,
            focusedMoonId:   goal.focusedMoonId   ?? state.focusedMoonId,
        });
    }
    function tickTransition(now) {
        if (!transition) return;
        const u = Math.min(1, (now - transition.t0) / transition.ms);
        const e = cubicBezier(u, 0.4, 0, 0.2, 1);
        const { start, end, goal } = transition;
        // Live end-target: re-read the goal body's current worldPos every
        // frame so the camera lands on the planet's actual position at u=1,
        // not the frozen snapshot from transitionTo. Without this the camera
        // snaps to the moving body at the end of the flight.
        let endTarget = end.target;
        if (goal.level === 'system') {
            const star = stars.find(s => s.id === goal.focusedSystemId);
            if (star) endTarget = star.worldPos;
        } else if (goal.level === 'planet') {
            const pb = planets.find(p => p.body.id === goal.focusedPlanetId)?.body;
            if (pb) endTarget = pb.worldPos;
        } else if (goal.level === 'moon') {
            const mb = moons.find(m => m.body.id === goal.focusedMoonId)?.body;
            if (mb) endTarget = mb.worldPos;
        }
        camera.target[0] = start.target[0] + (endTarget[0] - start.target[0]) * e;
        camera.target[1] = start.target[1] + (endTarget[1] - start.target[1]) * e;
        camera.target[2] = start.target[2] + (endTarget[2] - start.target[2]) * e;
        camera.distance = start.distance + (end.distance - start.distance) * e;
        applyOrbitDelta(camera, 0, 0);
        if (u >= 1) {
            state.level = transition.goal.level;
            state.focusedSystemId = transition.goal.focusedSystemId ?? null;
            state.focusedPlanetId = transition.goal.focusedPlanetId ?? null;
            state.focusedMoonId   = transition.goal.focusedMoonId   ?? null;
            transition = null;
            breadcrumb.render(state);
            consoleApi.render(state);
        }
    }
    function cubicBezier(t, p1x, p1y, p2x, p2y) {
        const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
        const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
        function sampleCurveX(u) { return ((ax * u + bx) * u + cx) * u; }
        function sampleCurveY(u) { return ((ay * u + by) * u + cy) * u; }
        function sampleCurveDerivX(u) { return (3 * ax * u + 2 * bx) * u + cx; }
        let u = t;
        for (let i = 0; i < 8; i++) {
            const x = sampleCurveX(u) - t;
            const d = sampleCurveDerivX(u);
            if (Math.abs(x) < 1e-4) break;
            if (Math.abs(d) < 1e-6) break;
            u -= x / d;
        }
        return sampleCurveY(u);
    }

    // ── Hit testing + click navigation ─────────────────────────────────────
    let cursorNdc = null;
    let hovered = null;

    canvas.addEventListener('pointermove', (e) => {
        const r = canvas.getBoundingClientRect();
        cursorNdc = {
            x: ((e.clientX - r.left) / r.width)  * 2 - 1,
            y: -((e.clientY - r.top)  / r.height) * 2 + 1,
        };
    });
    canvas.addEventListener('pointerleave', () => { cursorNdc = null; });

    // Track pointerdown position so the click handler can tell a true click
    // from a drag-to-rotate. Without this, releasing a drag fires `click` on
    // empty space, which zooms the camera one level out — extremely annoying
    // when the user is just orbiting at system/planet view.
    let downX = 0, downY = 0;
    canvas.addEventListener('pointerdown', (e) => {
        downX = e.clientX; downY = e.clientY;
    });

    canvas.addEventListener('click', (e) => {
        // Drag threshold: ≥6 px of movement between down and up = drag, ignore.
        if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
        const r = canvas.getBoundingClientRect();
        const clickX = e.clientX - r.left;
        const clickY = e.clientY - r.top;
        const w = r.width, h = r.height;

        // Exclude the currently-focused body from the hit-test entirely so
        // clicking on it (or empty space) falls through to handleEmptyClick.
        const focusedId = state.level === 'system' ? state.focusedSystemId
                        : state.level === 'planet' ? state.focusedPlanetId
                        : state.level === 'moon'   ? state.focusedMoonId
                        : null;
        const targets = currentSelectionTargets().filter(b => b.id !== focusedId);

        // ── Screen-space hit test ──────────────────────────────────────────
        // 3D ray-vs-sphere picking failed badly at system / planet view: the
        // sun sits at the camera target and intercepts virtually every ray
        // before it reaches other-system planets / moons / etc. Instead,
        // project each body to screen pixels and pick whichever body's
        // visible disc the click landed inside. Tiny bodies (moons) get a
        // minimum click radius so they stay grabbable.
        mat4Multiply(camera.proj, camera.view, _vp);
        const fovScale = (h * 0.5) / Math.tan(camera.fov * 0.5);
        const MIN_PX = 14;   // minimum click target radius for tiny bodies

        let best = null, bestEyeDist = Infinity, bestScore = Infinity;
        for (const b of targets) {
            const wp = b.worldPos;
            const cx = _vp[0]*wp[0] + _vp[4]*wp[1] + _vp[8] *wp[2] + _vp[12];
            const cy = _vp[1]*wp[0] + _vp[5]*wp[1] + _vp[9] *wp[2] + _vp[13];
            const cw = _vp[3]*wp[0] + _vp[7]*wp[1] + _vp[11]*wp[2] + _vp[15];
            if (cw <= 0.001) continue;  // behind camera
            const ndcX = cx / cw, ndcY = cy / cw;
            if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1) continue;  // off-screen

            const bx = (ndcX * 0.5 + 0.5) * w;
            const by = (-ndcY * 0.5 + 0.5) * h;
            const dx = wp[0] - camera.eye[0];
            const dy = wp[1] - camera.eye[1];
            const dz = wp[2] - camera.eye[2];
            const eyeDist = Math.max(0.01, Math.hypot(dx, dy, dz));
            const worldR = b.radiusWorld * b.scale;
            const screenR = Math.max(MIN_PX, worldR * fovScale / eyeDist);
            const d = Math.hypot(clickX - bx, clickY - by);
            if (d > screenR) continue;
            // Two-level priority: prefer the body whose visible disc most
            // clearly covers the click (smallest normalized offset); break
            // ties by depth (closer-to-camera wins for overlapping discs).
            const score = d / screenR;
            if (score < bestScore - 0.05 || (score < bestScore + 0.05 && eyeDist < bestEyeDist)) {
                bestScore = score; bestEyeDist = eyeDist; best = b;
            }
        }
        if (best) handleBodyClick(best);
        else      handleEmptyClick();
    });

    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // Scope ESC: if the existing project modal is open, let it own ESC.
        // js/main.js signals open via aria-hidden="false" on #modal.
        const modal = document.querySelector('#modal[aria-hidden="false"]');
        if (modal) return;
        handleEmptyClick();
    });

    function currentSelectionTargets() {
        if (state.level === 'galaxy') return stars;
        // At system / planet view, every star and every planet stays
        // clickable so the user can hop directly between bodies — clicking
        // another planet at planet view re-focuses on that planet (instead of
        // back-stepping to the system), clicking another sun re-focuses on
        // that sun's system, etc. Moons are included only when they're the
        // contextual selection (system view: moons of the focused system;
        // planet view: moons of the focused planet) so their project-modal
        // click target stays predictable.
        const out = [...stars, ...planets.map(p => p.body)];
        for (const m of visibleMoons()) out.push(m.body);
        return out;
    }

    function handleBodyClick(body) {
        if (body.kind === 'star') {
            transitionTo({ level: 'system', focusedSystemId: body.id });
        } else if (body.kind === 'planet') {
            transitionTo({ level: 'planet', focusedSystemId: body.meta.systemId, focusedPlanetId: body.id });
        } else if (body.kind === 'moon') {
            transitionTo({
                level: 'moon',
                focusedSystemId: body.meta.systemId,
                focusedPlanetId: body.meta.planetId,
                focusedMoonId:   body.id,
            });
        }
    }

    function handleEmptyClick() {
        if (state.level === 'moon') {
            transitionTo({ level: 'planet', focusedSystemId: state.focusedSystemId, focusedPlanetId: state.focusedPlanetId });
        } else if (state.level === 'planet') {
            transitionTo({ level: 'system', focusedSystemId: state.focusedSystemId });
        } else if (state.level === 'system') {
            transitionTo({ level: 'galaxy' });
        }
    }

    let running = true;
    const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
            const wasRunning = running;
            running = e.intersectionRatio >= 0.1;
            if (running && !wasRunning) requestAnimationFrame(frame);
        }
    }, { threshold: [0, 0.1] });
    io.observe(section);

    function frame(now) {
        if (!running) return;
        if (resizeBacking()) { setAspect(camera, canvas.width / canvas.height); ensureDepth(); }
        const t = now * 0.001;
        const lastNow = frame._lastNow ?? now;
        const dt = Math.min(0.05, (now - lastNow) / 1000);
        frame._lastNow = now;
        controls.tickInertia(dt);
        tickTransition(now);

        // Stars: apply the galaxy-spread multiplier to the cached JSON pos.
        for (const star of stars) {
            star.worldPos[0] = star._origPos[0] * world.galaxySpread;
            star.worldPos[1] = star._origPos[1] * world.galaxySpread;
            star.worldPos[2] = star._origPos[2] * world.galaxySpread;
            star.scale = star._origScale * world.starSize;
        }
        // Planets: orbit around their star at lerp(min, max, normalized_orbit_frac).
        for (const { body, star } of planets) {
            const o = body.orbit; if (!o) continue;
            const r = world.planetOrbitMin + (world.planetOrbitMax - world.planetOrbitMin) * body._origOrbitFrac;
            const a = (t * (2 * Math.PI / o.period)) + (o.phase || 0);
            const tilt = (o.tilt || 0) * Math.PI / 180;
            body.worldPos[0] = star.worldPos[0] + Math.cos(a) * r;
            body.worldPos[1] = star.worldPos[1] + Math.sin(tilt) * r * 0.15;
            body.worldPos[2] = star.worldPos[2] + Math.sin(a) * r * Math.cos(tilt);
            body.scale = body._origScale * world.planetSize;
        }
        // Moons: orbit around their planet at lerp(min, max, normalized_orbit_frac).
        for (const { body, planet } of moons) {
            const o = body.orbit; if (!o) continue;
            const r = world.moonOrbitMin + (world.moonOrbitMax - world.moonOrbitMin) * body._origOrbitFrac;
            const a = (t * (2 * Math.PI / o.period)) + (o.phase || 0);
            const tilt = (o.tilt || 0) * Math.PI / 180;
            body.worldPos[0] = planet.worldPos[0] + Math.cos(a) * r;
            body.worldPos[1] = planet.worldPos[1] + Math.sin(tilt) * r * 0.2;
            body.worldPos[2] = planet.worldPos[2] + Math.sin(a) * r * Math.cos(tilt);
            body.scale = body._origScale * world.moonSize;
        }

        // Lock the camera target to the focused body's current worldPos so
        // the camera tracks it as it orbits (planets around their star, etc.)
        // — without this, the target stays frozen at the body's position when
        // the transition completed and the body drifts off-centre. During a
        // transition tickTransition is the authority; we only snap here when
        // idle.
        if (!transition) {
            if (state.level === 'system') {
                const s = stars.find(x => x.id === state.focusedSystemId);
                if (s) {
                    camera.target[0] = s.worldPos[0];
                    camera.target[1] = s.worldPos[1];
                    camera.target[2] = s.worldPos[2];
                    applyOrbitDelta(camera, 0, 0);
                }
            } else if (state.level === 'planet') {
                const pl = planets.find(p => p.body.id === state.focusedPlanetId)?.body;
                if (pl) {
                    camera.target[0] = pl.worldPos[0];
                    camera.target[1] = pl.worldPos[1];
                    camera.target[2] = pl.worldPos[2];
                    applyOrbitDelta(camera, 0, 0);
                }
            } else if (state.level === 'moon') {
                const mn = moons.find(m => m.body.id === state.focusedMoonId)?.body;
                if (mn) {
                    camera.target[0] = mn.worldPos[0];
                    camera.target[1] = mn.worldPos[1];
                    camera.target[2] = mn.worldPos[2];
                    applyOrbitDelta(camera, 0, 0);
                }
            }
        }

        // Ring orbit centres track their planet's current world position
        for (const { planetBody, orbitMod } of ringOrbits) {
            orbitMod.params.cx = planetBody.worldPos[0];
            orbitMod.params.cy = planetBody.worldPos[1];
            orbitMod.params.cz = planetBody.worldPos[2];
        }

        // Hover detection + hover_t tween
        let newHovered = null;
        if (cursorNdc) {
            const ray = screenToRay(camera, cursorNdc.x, cursorNdc.y);
            const hit = hitTestBodies(ray, currentSelectionTargets());
            if (hit) newHovered = hit.body;
        }
        hovered = newHovered;
        const allBodies = stars.concat(planets.map(p => p.body), moons.map(m => m.body));
        for (const b of allBodies) {
            const target = (b === hovered) ? 1.0 : 0.0;
            b.hoverT += (target - b.hoverT) * Math.min(1, dt * 8);
        }

        // Camera UBO
        const camArr = new Float32Array(48);
        camArr.set(camera.view, 0);
        camArr.set(camera.proj, 16);
        camArr.set([camera.eye[0], camera.eye[1], camera.eye[2], 0], 32);
        device.queue.writeBuffer(camUbo, 0, camArr);

        // Stars UBOs (one for the body, one for its alpha-blended halo at
        // world.haloScale). Stars + halos are self-emissive — pass ambient
        // floor = 1.0 so the Lambert wrap in fs_main collapses to lit=1 and
        // the existing star / halo shaders render unchanged.
        for (const s of visibleStars()) {
            const M = new Float32Array(16);
            mat4Identity(M);
            const sc = s.scale;
            M[0] = sc; M[5] = sc; M[10] = sc;
            M[12] = s.worldPos[0]; M[13] = s.worldPos[1]; M[14] = s.worldPos[2];
            writeBodyUbo(device, s, M, t);   // default ambientFloor=1.0 → self-lit
            // Halo UBO — bigger scale, same accent + worldPos. Inlined to
            // avoid a temporary star_halo body object.
            const Mh = new Float32Array(16);
            mat4Identity(Mh);
            const sch = s.scale * world.haloScale;
            Mh[0] = sch; Mh[5] = sch; Mh[10] = sch;
            Mh[12] = s.worldPos[0]; Mh[13] = s.worldPos[1]; Mh[14] = s.worldPos[2];
            const arr = new Float32Array(32);
            arr.set(Mh, 0);
            arr.set(s.accent, 16);
            arr[20] = t;
            arr[21] = s.radiusWorld * world.haloScale;
            arr[22] = 0;
            arr[23] = s.hoverT;
            // light_pos.w = 1.0 → halo is self-lit, ignored by Lambert wrap.
            arr[24] = 0; arr[25] = 0; arr[26] = 0; arr[27] = 1.0;
            // light_color.w = 0 → no sun-tint blend (halo keeps its own glow).
            arr[28] = 1; arr[29] = 1; arr[30] = 1; arr[31] = 0;
            device.queue.writeBuffer(s.haloBuf, 0, arr);
            // Bloom billboard UBO — only model (for worldPos via translation),
            // accent (for glow tint), and params (radius, multiplier,
            // intensity, plus the gaussian falloff in light_pos.x).
            const Bm = new Float32Array(16);
            mat4Identity(Bm);
            const bsc = s.scale;   // model scale is irrelevant for the billboard,
            Bm[0] = bsc; Bm[5] = bsc; Bm[10] = bsc;
            Bm[12] = s.worldPos[0]; Bm[13] = s.worldPos[1]; Bm[14] = s.worldPos[2];
            const barr = new Float32Array(32);
            barr.set(Bm, 0);
            barr.set(s.accent, 16);
            barr[20] = t;                                       // unused
            barr[21] = s.radiusWorld;                           // radius_world
            barr[22] = world.sunBloomRadiusMul;                 // radius multiplier
            barr[23] = world.sunBloomIntensity;                 // intensity
            barr[24] = world.sunBloomFalloff;                   // gaussian falloff exponent
            device.queue.writeBuffer(s.bloomBuf, 0, barr);
        }
        // Planet + moon UBOs (only visible ones). Planet self-rotates slowly
        // on Y; phase derived from its id so each planet spins out-of-sync.
        // Each gets its parent star's worldPos as the Lambert light source.
        const visPls = visiblePlanets();
        for (const { body, star } of visPls) {
            const M = new Float32Array(16);
            const spin = t * ambient.planetSpinRate + (body.id.length * 0.7);
            const cs = Math.cos(spin), sn = Math.sin(spin);
            const sc = body.scale;
            M[0]  =  cs * sc; M[2]  =  sn * sc;
            M[5]  =        sc;
            M[8]  = -sn * sc; M[10] =  cs * sc;
            M[15] = 1;
            M[12] = body.worldPos[0]; M[13] = body.worldPos[1]; M[14] = body.worldPos[2];
            writeBodyUbo(device, body, M, t, star.worldPos, world.ambientFloor, star.accent, world.sunTintStrength);
        }
        const visMs = visibleMoons();
        for (const { body, star } of visMs) {
            const M = new Float32Array(16);
            mat4Identity(M);
            const sc = body.scale;
            M[0] = sc; M[5] = sc; M[10] = sc;
            M[12] = body.worldPos[0]; M[13] = body.worldPos[1]; M[14] = body.worldPos[2];
            writeBodyUbo(device, body, M, t, star.worldPos, world.ambientFloor, star.accent, world.sunTintStrength);
        }

        // Project + position floating labels. Labels stay constant CSS px
        // regardless of zoom — CSS units, not world units. Visibility rules:
        // — galaxy view shows only sun labels (planets too small)
        // — system view shows the focal system's sun + planets
        // — planet view shows the focal planet + its moons
        if (labelsRoot) {
            // CSS reads --gap from the labels container so we set it once per
            // frame; individual labels inherit it through the cascade.
            labelsRoot.style.setProperty('--gap', world.labelGapPx + 'px');
            mat4Multiply(camera.proj, camera.view, _vp);
            const rect = canvas.getBoundingClientRect();
            const sectionRect = section.getBoundingClientRect();
            const w = rect.width, h = rect.height;
            const offX = rect.left - sectionRect.left;
            const offY = rect.top  - sectionRect.top;
            for (const { el, body } of labels.values()) {
                let show = false;
                // Other systems' star labels stay visible at every zoom level
                // so the visitor never loses orientation. Planet/moon labels
                // appear only when we're inside their parent body.
                if (state.level === 'galaxy') {
                    // Stars + every planet — lets visitors skim every
                    // skill/sub-category from the top-down view without
                    // having to zoom into each system.
                    show = body.kind === 'star' || body.kind === 'planet';
                } else if (state.level === 'system') {
                    show = body.kind === 'star'
                        || (body.kind === 'planet' && body.meta.systemId === state.focusedSystemId);
                } else if (state.level === 'planet' || state.level === 'moon') {
                    show = body.kind === 'star'
                        || (body.kind === 'planet' && body.meta.systemId === state.focusedSystemId)
                        || (body.kind === 'moon'   && body.meta.planetId === state.focusedPlanetId);
                }
                if (!show) { el.classList.remove('is-visible'); continue; }
                // Project worldPos → clip
                const wp = body.worldPos;
                _proj4[0] = _vp[0]*wp[0] + _vp[4]*wp[1] + _vp[8] *wp[2] + _vp[12];
                _proj4[1] = _vp[1]*wp[0] + _vp[5]*wp[1] + _vp[9] *wp[2] + _vp[13];
                _proj4[2] = _vp[2]*wp[0] + _vp[6]*wp[1] + _vp[10]*wp[2] + _vp[14];
                _proj4[3] = _vp[3]*wp[0] + _vp[7]*wp[1] + _vp[11]*wp[2] + _vp[15];
                if (_proj4[3] <= 0.001) { el.classList.remove('is-visible'); continue; }
                const ndcX = _proj4[0] / _proj4[3];
                const ndcY = _proj4[1] / _proj4[3];
                if (ndcX < -1.05 || ndcX > 1.05 || ndcY < -1.05 || ndcY > 1.05) { el.classList.remove('is-visible'); continue; }
                const px = offX + (ndcX * 0.5 + 0.5) * w;
                const py = offY + (-ndcY * 0.5 + 0.5) * h;
                // Project a per-kind silhouette radius onto the screen so the
                // label sits above the visible body. Multipliers are tunable
                // via the dev panel (labelMultStar / labelMultPlanet /
                // labelMultMoon) so e.g. stars can clear their halo or not.
                const dx = wp[0] - camera.eye[0];
                const dy = wp[1] - camera.eye[1];
                const dz = wp[2] - camera.eye[2];
                const eyeDist = Math.max(0.01, Math.hypot(dx, dy, dz));
                const mult = body.kind === 'star'   ? world.labelMultStar
                           : body.kind === 'planet' ? world.labelMultPlanet
                           : world.labelMultMoon;
                const worldRadius = body.radiusWorld * body.scale * mult;
                const screenRadius = worldRadius * (h * 0.5) / (eyeDist * Math.tan(camera.fov * 0.5));
                el.style.setProperty('--x', px + 'px');
                el.style.setProperty('--y', (py - screenRadius) + 'px');
                el.classList.add('is-visible');
            }
        }

        // Starfield in its own pass on its own canvas + device. Bloom is on
        // with a low threshold + wider blur so even the dim shells get a
        // visible halo — gives the field the "deep-space photograph" feel.
        // NOTE (Task 14.1): full-frame bloom over meshes + particles is
        // deferred to v2; sun + planet shaders rely on their own fresnel.
        if (starPs) {
            starPs.update(dt);
            starPs.render({
                view: camera.view,
                proj: camera.proj,
                bgColor: [0.004, 0.004, 0.004, 1],
                postfx,
            });
        }

        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: CLEAR_COLOR,
                loadOp: 'clear', storeOp: 'store',
            }],
            depthStencilAttachment: {
                view: depthTex.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear', depthStoreOp: 'store',
            },
        });
        // Suns
        pass.setPipeline(starPipeline);
        pass.setBindGroup(0, cameraBG);
        pass.setVertexBuffer(0, vbuf);
        pass.setIndexBuffer(ibuf, ico.indexFormat);
        for (const s of visibleStars()) {
            pass.setBindGroup(1, s.bg);
            pass.drawIndexed(ico.indexCount);
        }
        // Planets — per-planet pipeline if compiled, else default. Pipelines
        // not yet ready (compile pending) skip this frame and render next time.
        for (const { body } of visPls) {
            const built = planetPipelineCache.get(body.shaderPath);
            if (!built) continue;
            pass.setPipeline(built.pipeline);
            pass.setBindGroup(1, body.bg);
            pass.drawIndexed(ico.indexCount);
        }
        // Moons
        if (visMs.length) {
            pass.setPipeline(moonPipeline);
            for (const { body } of visMs) {
                pass.setBindGroup(1, body.bg);
                pass.drawIndexed(ico.indexCount);
            }
        }
        // Star halos — additive blend, no depth write. They composite over
        // geometry behind them, but since they render the BACK faces of a
        // larger sphere they don't hide the star body itself.
        pass.setPipeline(starHaloPipeline);
        for (const s of visibleStars()) {
            pass.setBindGroup(1, s.haloBG);
            pass.drawIndexed(ico.indexCount);
        }
        // Star bloom — gaussian sprite billboard per sun, drawn last so the
        // glow stacks additively over halos + meshes. Uses its own camera +
        // body bind groups (the bloom pipeline has a separate bodyBGL) and
        // 4 vertices in a triangle-strip (no vertex buffer).
        pass.setPipeline(sunBloomPipeline);
        pass.setBindGroup(0, bloomCameraBG);
        for (const s of visibleStars()) {
            pass.setBindGroup(1, s.bloomBG);
            pass.draw(4);
        }
        pass.end();
        device.queue.submit([enc.finish()]);

        requestAnimationFrame(frame);
    }
    breadcrumb.render(state);
    if (HERO_GALAXY_DEV_PANEL) setupDevPanel({ postfx, ambient, world, factoryDefaults });
    requestAnimationFrame(frame);

    // Expose programmatic navigation for verification + Phase 7 click handlers
    window.HERO_GALAXY = {
        gotoGalaxy() { transitionTo({ level: 'galaxy' }); },
        gotoSystem(systemId) {
            const sys = galaxy.systems.find(s => s.id === systemId);
            if (!sys) { console.warn('no system', systemId); return; }
            transitionTo({ level: 'system', focusedSystemId: systemId });
        },
        gotoPlanet(planetId) {
            const pl = planets.find(p => p.body.id === planetId);
            if (!pl) { console.warn('no planet', planetId); return; }
            transitionTo({ level: 'planet', focusedSystemId: pl.body.meta.systemId, focusedPlanetId: planetId });
        },
        state, stars, planets, moons, galaxy,
    };

    return { device, context, format, camera, canvas, galaxy, stars, planets, moons, state, applyStateCamera };
}
