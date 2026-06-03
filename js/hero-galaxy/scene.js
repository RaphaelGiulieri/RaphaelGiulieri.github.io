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

const CLEAR_COLOR = { r: 0.004, g: 0.004, b: 0.004, a: 1.0 };

export async function mountScene({ section }) {
    const canvas = section.querySelector('#galaxy-canvas');
    if (!canvas) throw new Error('no #galaxy-canvas');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resizeBacking() {
        const w = Math.floor(canvas.clientWidth  * dpr);
        const h = Math.floor(canvas.clientHeight * dpr);
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
        return false;
    }
    resizeBacking();

    const galaxy = await loadGalaxyData();

    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

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

    function frame(now) {
        if (resizeBacking()) { setAspect(camera, canvas.width / canvas.height); ensureDepth(); }
        const t = now * 0.001;
        const lastNow = frame._lastNow ?? now;
        const dt = Math.min(0.05, (now - lastNow) / 1000);
        frame._lastNow = now;
        controls.tickInertia(dt);

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
        // Planets (default shader for Phase 6; per-planet pipelines arrive in Phase 9)
        if (visPls.length) {
            pass.setPipeline(defaultPipeline);
            for (const { body } of visPls) {
                pass.setBindGroup(1, body.bg);
                pass.drawIndexed(ico.indexCount);
            }
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
    requestAnimationFrame(frame);

    // Expose programmatic navigation for verification + Phase 7 click handlers
    window.HERO_GALAXY = {
        gotoGalaxy() {
            state.level = 'galaxy';
            state.focusedSystemId = null;
            state.focusedPlanetId = null;
            applyStateCamera();
        },
        gotoSystem(systemId) {
            const sys = galaxy.systems.find(s => s.id === systemId);
            if (!sys) { console.warn('no system', systemId); return; }
            state.level = 'system';
            state.focusedSystemId = systemId;
            state.focusedPlanetId = null;
            applyStateCamera();
        },
        gotoPlanet(planetId) {
            const pl = planets.find(p => p.body.id === planetId);
            if (!pl) { console.warn('no planet', planetId); return; }
            state.level = 'planet';
            state.focusedSystemId = pl.body.meta.systemId;
            state.focusedPlanetId = planetId;
            applyStateCamera();
        },
        state, suns, planets, moons, galaxy,
    };

    return { device, context, format, camera, canvas, galaxy, suns, planets, moons, state, applyStateCamera };
}
