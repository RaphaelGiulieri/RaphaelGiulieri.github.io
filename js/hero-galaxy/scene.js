// Scene mount + state machine. Phase 2: brings up a WebGPU device, configures
// the swapchain, and runs a render loop that clears to near-black. No content
// rendered yet — proves the canvas is alive.

import { createCamera, setAspect } from './render/camera.js';

const CLEAR_COLOR = { r: 0.004, g: 0.004, b: 0.004, a: 1.0 };

export async function mountScene({ section }) {
    const canvas = section.querySelector('#galaxy-canvas');
    if (!canvas) throw new Error('no #galaxy-canvas in section');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
        const w = Math.floor(canvas.clientWidth  * dpr);
        const h = Math.floor(canvas.clientHeight * dpr);
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w; canvas.height = h;
            return true;
        }
        return false;
    }
    resize();

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('no GPUAdapter');
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    const camera = createCamera();
    setAspect(camera, canvas.width / canvas.height);

    let running = true;
    function frame() {
        if (!running) return;
        if (resize()) setAspect(camera, canvas.width / canvas.height);

        const enc = device.createCommandEncoder({ label: 'galaxy frame' });
        const pass = enc.beginRenderPass({
            label: 'clear',
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: CLEAR_COLOR,
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });
        pass.end();
        device.queue.submit([enc.finish()]);

        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return { device, context, format, camera, canvas };
}
