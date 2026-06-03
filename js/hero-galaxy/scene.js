// Phase 6: full scene with state machine. Galaxy → system → planet visibility
// driven by `state.level`. Bodies are allocated up-front; per-frame visibility
// filters which ones go into the render pass. Exposes window.HERO_GALAXY
// programmatic API so we can verify navigation without the click handlers
// (those land in Phase 7).

import { createCamera, setAspect, applyOrbitDelta } from './render/camera.js';
import { wireControls } from './render/controls.js';
import { makeIcosphere } from './render/sphere-mesh.js';
import { getMeshPipeline } from './render/pipeline.js';
import { loadGalaxyData } from './data-loader.js';
import { createBody, writeBodyUbo, bodyDescFromSun, bodyDescFromPlanet, bodyDescFromMoon } from './bodies.js';
import { mat4Identity } from '../particles/core/math.js';
import { screenToRay, hitTestBodies } from './render/raycast.js';
import { createBreadcrumb } from './breadcrumb.js';
import { mountStarfield } from './render/starfield.js';

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
        },
    });

    const controls = wireControls({ canvas, camera, getState: () => state.level });

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
    const { pipeline: sunPipeline } = await getMeshPipeline(device, format, 'sun.wgsl');
    const { pipeline: moonPipeline } = await getMeshPipeline(device, format, 'default-moon.wgsl');

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

    // Per-planet pipeline cache. Keys are shader paths; values are built pipelines.
    // Lazy: first system entry warms its planet's pipelines.
    const planetPipelineCache = new Map();
    planetPipelineCache.set('default-planet.wgsl', { pipeline: defaultPipeline });
    async function planetPipelineFor(shaderPath) {
        if (planetPipelineCache.has(shaderPath)) return planetPipelineCache.get(shaderPath);
        const built = await getMeshPipeline(device, format, shaderPath);
        planetPipelineCache.set(shaderPath, built);
        return built;
    }

    // Build sun, planet, and moon bodies
    const suns = [];
    const planets = []; // [{ body, sun }]
    const moons   = []; // [{ body, planet }]
    for (const sys of galaxy.systems) {
        const sun = createBody(device, bodyBGL, {
            ...bodyDescFromSun(sys),
            label: `sun ${sys.id}`,
        });
        sun.accent[0] = sys.sunTint[0];
        sun.accent[1] = sys.sunTint[1];
        sun.accent[2] = sys.sunTint[2];
        sun.accent[3] = 1.0;
        sun.worldPos[0] = sys.galaxyPosition[0];
        sun.worldPos[1] = sys.galaxyPosition[1];
        sun.worldPos[2] = sys.galaxyPosition[2];
        suns.push(sun);
        for (const p of sys.planets) {
            const planetBody = createBody(device, bodyBGL, {
                ...bodyDescFromPlanet(p, sys), label: `planet ${p.id}`,
            });
            planets.push({ body: planetBody, sun });
            for (const m of p.moons || []) {
                const moonBody = createBody(device, bodyBGL, {
                    ...bodyDescFromMoon(m, p, sys), label: `moon ${m.projectId}`,
                });
                moons.push({ body: moonBody, planet: planetBody });
            }
        }
    }

    function visibleSuns()    { return suns; }
    function visiblePlanets() {
        if (state.level === 'galaxy') return [];
        return planets.filter(p => p.body.meta.systemId === state.focusedSystemId);
    }
    function visibleMoons() {
        if (state.level !== 'planet') return [];
        return moons.filter(m => m.body.meta.planetId === state.focusedPlanetId);
    }

    function applyStateCamera() {
        if (state.level === 'galaxy') {
            camera.target.set([0, 0, 0]);
            camera.distance = 80;
        } else if (state.level === 'system') {
            const sun = suns.find(s => s.id === state.focusedSystemId);
            if (sun) {
                camera.target.set(sun.worldPos);
                camera.distance = 18;
            }
        } else if (state.level === 'planet') {
            const planetBody = planets.find(p => p.body.id === state.focusedPlanetId)?.body;
            if (planetBody) {
                camera.target.set(planetBody.worldPos);
                camera.distance = 3.5;
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
        let endTarget = [0, 0, 0], endDist = 80;
        if (goal.level === 'system' || goal.level === 'planet') {
            const sysId = goal.focusedSystemId || state.focusedSystemId;
            const sys = galaxy.systems.find(s => s.id === sysId);
            if (sys) {
                for (const p of sys.planets) {
                    // Fire-and-forget — pipelines build during the Bezier fly.
                    planetPipelineFor(p.shader || 'default-planet.wgsl');
                }
            }
        }
        if (goal.level === 'system') {
            const sun = suns.find(s => s.id === goal.focusedSystemId);
            if (sun) { endTarget = [sun.worldPos[0], sun.worldPos[1], sun.worldPos[2]]; endDist = 18; }
        } else if (goal.level === 'planet') {
            const planetEntry = planets.find(p => p.body.id === goal.focusedPlanetId);
            if (planetEntry) {
                const body = planetEntry.body;
                endTarget = [body.worldPos[0], body.worldPos[1], body.worldPos[2]];
                endDist = 3.5;
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
        });
    }
    function tickTransition(now) {
        if (!transition) return;
        const u = Math.min(1, (now - transition.t0) / transition.ms);
        const e = cubicBezier(u, 0.4, 0, 0.2, 1);
        const { start, end } = transition;
        camera.target[0] = start.target[0] + (end.target[0] - start.target[0]) * e;
        camera.target[1] = start.target[1] + (end.target[1] - start.target[1]) * e;
        camera.target[2] = start.target[2] + (end.target[2] - start.target[2]) * e;
        camera.distance = start.distance + (end.distance - start.distance) * e;
        applyOrbitDelta(camera, 0, 0);
        if (u >= 1) {
            state.level = transition.goal.level;
            state.focusedSystemId = transition.goal.focusedSystemId ?? null;
            state.focusedPlanetId = transition.goal.focusedPlanetId ?? null;
            transition = null;
            breadcrumb.render(state);
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

    canvas.addEventListener('click', (e) => {
        const r = canvas.getBoundingClientRect();
        const ndc = {
            x: ((e.clientX - r.left) / r.width)  * 2 - 1,
            y: -((e.clientY - r.top)  / r.height) * 2 + 1,
        };
        const ray = screenToRay(camera, ndc.x, ndc.y);
        if (!ray) return;
        const targets = currentSelectionTargets();
        const hit = hitTestBodies(ray, targets);
        if (hit) handleBodyClick(hit.body);
        else     handleEmptyClick();
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
        if (state.level === 'galaxy') return suns;
        if (state.level === 'system') return visiblePlanets().map(p => p.body);
        if (state.level === 'planet') return visibleMoons().map(m => m.body);
        return [];
    }

    function handleBodyClick(body) {
        if (body.kind === 'sun') {
            transitionTo({ level: 'system', focusedSystemId: body.id });
        } else if (body.kind === 'planet') {
            transitionTo({ level: 'planet', focusedSystemId: body.meta.systemId, focusedPlanetId: body.id });
        } else if (body.kind === 'moon') {
            const projectId = body.meta.projectId;
            if (typeof window.openModal === 'function') {
                window.openModal(projectId, section);
            }
        }
    }

    function handleEmptyClick() {
        if (state.level === 'planet') {
            transitionTo({ level: 'system', focusedSystemId: state.focusedSystemId });
        } else if (state.level === 'system') {
            transitionTo({ level: 'galaxy' });
        }
    }

    function frame(now) {
        if (resizeBacking()) { setAspect(camera, canvas.width / canvas.height); ensureDepth(); }
        const t = now * 0.001;
        const lastNow = frame._lastNow ?? now;
        const dt = Math.min(0.05, (now - lastNow) / 1000);
        frame._lastNow = now;
        controls.tickInertia(dt);
        tickTransition(now);

        // Update planet positions (orbit around their sun)
        for (const { body, sun } of planets) {
            const o = body.orbit; if (!o) continue;
            const a = (t * (2 * Math.PI / o.period)) + (o.phase || 0);
            const tilt = (o.tilt || 0) * Math.PI / 180;
            body.worldPos[0] = sun.worldPos[0] + Math.cos(a) * o.radius;
            body.worldPos[1] = sun.worldPos[1] + Math.sin(tilt) * o.radius * 0.15;
            body.worldPos[2] = sun.worldPos[2] + Math.sin(a) * o.radius * Math.cos(tilt);
        }
        for (const { body, planet } of moons) {
            const o = body.orbit; if (!o) continue;
            const a = (t * (2 * Math.PI / o.period)) + (o.phase || 0);
            const tilt = (o.tilt || 0) * Math.PI / 180;
            body.worldPos[0] = planet.worldPos[0] + Math.cos(a) * o.radius;
            body.worldPos[1] = planet.worldPos[1] + Math.sin(tilt) * o.radius * 0.2;
            body.worldPos[2] = planet.worldPos[2] + Math.sin(a) * o.radius * Math.cos(tilt);
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
        const allBodies = suns.concat(planets.map(p => p.body), moons.map(m => m.body));
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

        // Suns UBOs
        for (const s of visibleSuns()) {
            const M = new Float32Array(16);
            mat4Identity(M);
            const sc = s.scale;
            M[0] = sc; M[5] = sc; M[10] = sc;
            M[12] = s.worldPos[0]; M[13] = s.worldPos[1]; M[14] = s.worldPos[2];
            writeBodyUbo(device, s, M, t);
        }
        // Planet + moon UBOs (only visible ones)
        const visPls = visiblePlanets();
        for (const { body } of visPls) {
            const M = new Float32Array(16);
            mat4Identity(M);
            const sc = body.scale;
            M[0] = sc; M[5] = sc; M[10] = sc;
            M[12] = body.worldPos[0]; M[13] = body.worldPos[1]; M[14] = body.worldPos[2];
            writeBodyUbo(device, body, M, t);
        }
        const visMs = visibleMoons();
        for (const { body } of visMs) {
            const M = new Float32Array(16);
            mat4Identity(M);
            const sc = body.scale;
            M[0] = sc; M[5] = sc; M[10] = sc;
            M[12] = body.worldPos[0]; M[13] = body.worldPos[1]; M[14] = body.worldPos[2];
            writeBodyUbo(device, body, M, t);
        }

        // Starfield in its own pass on its own canvas + device. We feed it
        // our view/proj matrices so the stars track the camera. Bloom is
        // off (would over-light the swap target) and the bg is opaque so
        // the mesh canvas's premultiplied alpha compositing shows stars
        // behind everything.
        if (starPs) {
            starPs.update(dt);
            starPs.render({
                view: camera.view,
                proj: camera.proj,
                bgColor: [0.004, 0.004, 0.004, 1],
                postfx: { enableBloom: false, exposure: 1.0, vignette: 0.1 },
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
        pass.setPipeline(sunPipeline);
        pass.setBindGroup(0, cameraBG);
        pass.setVertexBuffer(0, vbuf);
        pass.setIndexBuffer(ibuf, ico.indexFormat);
        for (const s of visibleSuns()) {
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
        pass.end();
        device.queue.submit([enc.finish()]);

        requestAnimationFrame(frame);
    }
    breadcrumb.render(state);
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
        state, suns, planets, moons, galaxy,
    };

    return { device, context, format, camera, canvas, galaxy, suns, planets, moons, state, applyStateCamera };
}
