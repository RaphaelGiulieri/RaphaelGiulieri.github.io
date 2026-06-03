// Phase 3: one rotating sphere at origin via the default planet shader.

import { createCamera, setAspect } from './render/camera.js';
import { makeIcosphere } from './render/sphere-mesh.js';
import { getMeshPipeline } from './render/pipeline.js';
import { mat4Identity } from '../particles/core/math.js';

const CLEAR_COLOR = { r: 0.004, g: 0.004, b: 0.004, a: 1.0 };

export async function mountScene({ section }) {
    const canvas = section.querySelector('#galaxy-canvas');
    if (!canvas) throw new Error('no #galaxy-canvas');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resizeBacking() {
        const w = Math.floor(canvas.clientWidth  * dpr);
        const h = Math.floor(canvas.clientHeight * dpr);
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w; canvas.height = h; return true;
        }
        return false;
    }
    resizeBacking();

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('no adapter');
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    const camera = createCamera();
    setAspect(camera, canvas.width / canvas.height);
    camera.distance = 4;

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

    const camUbo  = device.createBuffer({ size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bodyUbo = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const { pipeline, cameraBGL, bodyBGL } = await getMeshPipeline(device, format, 'default-planet.wgsl');
    const cameraBG = device.createBindGroup({
        layout: cameraBGL,
        entries: [{ binding: 0, resource: { buffer: camUbo } }],
    });
    const bodyBG = device.createBindGroup({
        layout: bodyBGL,
        entries: [{ binding: 0, resource: { buffer: bodyUbo } }],
    });

    const accent = new Float32Array([1.0, 0.30, 0.10, 1.0]);
    const model = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);

    function frame(now) {
        if (resizeBacking()) { setAspect(camera, canvas.width / canvas.height); ensureDepth(); }
        const t = now * 0.001;

        const camArr = new Float32Array(48);
        camArr.set(camera.view, 0);
        camArr.set(camera.proj, 16);
        camArr.set([camera.eye[0], camera.eye[1], camera.eye[2], 0], 32);
        device.queue.writeBuffer(camUbo, 0, camArr);

        // Rotate the sphere around Y over time
        const c = Math.cos(t * 0.5), s = Math.sin(t * 0.5);
        mat4Identity(model);
        model[0] = c; model[2] = s; model[8] = -s; model[10] = c;
        const bodyArr = new Float32Array(32);
        bodyArr.set(model, 0);
        bodyArr.set(accent, 16);
        bodyArr.set([t, 1.0, 0.0, 0.0], 20);
        device.queue.writeBuffer(bodyUbo, 0, bodyArr);

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
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, cameraBG);
        pass.setBindGroup(1, bodyBG);
        pass.setVertexBuffer(0, vbuf);
        pass.setIndexBuffer(ibuf, ico.indexFormat);
        pass.drawIndexed(ico.indexCount);
        pass.end();
        device.queue.submit([enc.finish()]);

        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return { device, context, format, camera, canvas };
}
