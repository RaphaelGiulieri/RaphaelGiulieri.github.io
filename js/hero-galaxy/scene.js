// Phase 4: render the 3 suns at their galaxy positions, each with sun.wgsl.

import { createCamera, setAspect } from './render/camera.js';
import { wireControls } from './render/controls.js';
import { makeIcosphere } from './render/sphere-mesh.js';
import { getMeshPipeline } from './render/pipeline.js';
import { loadGalaxyData } from './data-loader.js';
import { createBody, writeBodyUbo, bodyDescFromSun } from './bodies.js';
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
    // getState is a closure on the future state machine; Phase 5 always reports galaxy.
    const controls = wireControls({ canvas, camera, getState: () => 'galaxy' });

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

    // Warm the default-planet pipeline to get cameraBGL + bodyBGL
    const { pipeline: defaultPipeline, cameraBGL, bodyBGL } =
        await getMeshPipeline(device, format, 'default-planet.wgsl');
    const cameraBG = device.createBindGroup({
        layout: cameraBGL,
        entries: [{ binding: 0, resource: { buffer: camUbo } }],
    });

    const { pipeline: sunPipeline } = await getMeshPipeline(device, format, 'sun.wgsl');

    // Build sun bodies from data
    const suns = [];
    for (const sys of galaxy.systems) {
        const body = createBody(device, bodyBGL, {
            ...bodyDescFromSun(sys),
            label: `sun ${sys.id}`,
        });
        body.accent[0] = sys.sunTint[0];
        body.accent[1] = sys.sunTint[1];
        body.accent[2] = sys.sunTint[2];
        body.accent[3] = 1.0;
        body.worldPos[0] = sys.galaxyPosition[0];
        body.worldPos[1] = sys.galaxyPosition[1];
        body.worldPos[2] = sys.galaxyPosition[2];
        suns.push(body);
    }

    function frame(now) {
        if (resizeBacking()) { setAspect(camera, canvas.width / canvas.height); ensureDepth(); }
        const t = now * 0.001;
        const lastNow = frame._lastNow ?? now;
        const dt = Math.min(0.05, (now - lastNow) / 1000);
        frame._lastNow = now;
        controls.tickInertia(dt);

        const camArr = new Float32Array(48);
        camArr.set(camera.view, 0);
        camArr.set(camera.proj, 16);
        camArr.set([camera.eye[0], camera.eye[1], camera.eye[2], 0], 32);
        device.queue.writeBuffer(camUbo, 0, camArr);

        for (const s of suns) {
            const M = new Float32Array(16);
            mat4Identity(M);
            const sc = s.scale;
            M[0] = sc; M[5] = sc; M[10] = sc;
            M[12] = s.worldPos[0]; M[13] = s.worldPos[1]; M[14] = s.worldPos[2];
            writeBodyUbo(device, s, M, t);
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
        pass.setPipeline(sunPipeline);
        pass.setBindGroup(0, cameraBG);
        pass.setVertexBuffer(0, vbuf);
        pass.setIndexBuffer(ibuf, ico.indexFormat);
        for (const s of suns) {
            pass.setBindGroup(1, s.bg);
            pass.drawIndexed(ico.indexCount);
        }
        pass.end();
        device.queue.submit([enc.finish()]);

        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return { device, context, format, camera, canvas, galaxy, suns };
}
