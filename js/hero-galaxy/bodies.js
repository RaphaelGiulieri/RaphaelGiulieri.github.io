// Per-body GPU state: one uniform buffer + bind group per body. Bodies are
// allocated up-front from the scene data; their model matrices are mutated
// per-frame by the scene state machine.

import { parseAccent } from './data-loader.js';

export function createBody(device, bodyBGL, opts) {
    const buf = device.createBuffer({
        label: opts.label || 'body uniform',
        size: 128,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bg = device.createBindGroup({
        layout: bodyBGL,
        entries: [{ binding: 0, resource: { buffer: buf } }],
    });
    return {
        kind: opts.kind,                  // 'sun' | 'planet' | 'moon'
        id: opts.id,
        shaderPath: opts.shaderPath,
        accent: opts.accent,              // Float32Array(4)
        worldPos: new Float32Array(3),
        radiusWorld: opts.radiusWorld || 1.0,
        scale: opts.scale || 1.0,
        hoverT: 0.0,
        buf, bg,
        parent: opts.parent || null,
        orbit:  opts.orbit  || null,
        meta:   opts.meta   || {},        // JS-side, not WGSL; free-form
    };
}

export function writeBodyUbo(device, body, model16, time) {
    const arr = new Float32Array(32);
    arr.set(model16, 0);
    arr.set(body.accent, 16);
    arr[20] = time;
    arr[21] = body.radiusWorld;
    arr[22] = 0;
    arr[23] = body.hoverT;
    device.queue.writeBuffer(body.buf, 0, arr);
}

export function bodyDescFromStar(sys) {
    return {
        kind: 'star',
        id: sys.id,
        shaderPath: sys.sunShader || 'star.wgsl',
        accent: new Float32Array(parseAccent(sys.accent || '#ffffff')),
        radiusWorld: sys.sunRadius || 2.0,
        scale: sys.sunRadius || 2.0,
        meta: { systemId: sys.id, starTint: sys.sunTint || [1, 1, 1] },
    };
}

export function bodyDescFromPlanet(planet, sys) {
    return {
        kind: 'planet',
        id: planet.id,
        shaderPath: planet.shader || 'default-planet.wgsl',
        accent: new Float32Array(parseAccent(sys.accent || '#ffffff')),
        radiusWorld: planet.size || 1.0,
        scale: planet.size || 1.0,
        orbit: planet.orbit,
        meta: { systemId: sys.id, planetId: planet.id, ring: planet.ring, planetName: planet.name },
    };
}

export function bodyDescFromMoon(moon, planet, sys) {
    return {
        kind: 'moon',
        id: moon.projectId,
        shaderPath: 'default-moon.wgsl',
        accent: new Float32Array(parseAccent(sys.accent || '#ffffff')),
        radiusWorld: moon.size || 0.25,
        scale: moon.size || 0.25,
        orbit: moon.orbit,
        meta: { systemId: sys.id, planetId: planet.id, projectId: moon.projectId, title: moon.title },
    };
}
