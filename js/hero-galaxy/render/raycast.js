// Pick a screen pixel → world-space ray (eye, dir). Hit-test against a list
// of bodies (each with worldPos + radiusWorld + scale). Closest hit wins.

import { mat4Multiply } from '../../particles/core/math.js';

export function screenToRay(camera, ndcX, ndcY) {
    const vp = new Float32Array(16);
    mat4Multiply(camera.proj, camera.view, vp);
    const inv = invert4(vp);
    if (!inv) return null;
    // WebGPU NDC z ∈ [0,1]; near=0, far=1.
    const n = transformPoint(inv, ndcX, ndcY, 0.0);
    const f = transformPoint(inv, ndcX, ndcY, 1.0);
    const dir = [f[0] - n[0], f[1] - n[1], f[2] - n[2]];
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    return {
        eye: [camera.eye[0], camera.eye[1], camera.eye[2]],
        dir: [dir[0]/l, dir[1]/l, dir[2]/l],
    };
}

export function hitSphere(ray, center, radius) {
    const ox = ray.eye[0] - center[0], oy = ray.eye[1] - center[1], oz = ray.eye[2] - center[2];
    const b = ox * ray.dir[0] + oy * ray.dir[1] + oz * ray.dir[2];
    const c = ox*ox + oy*oy + oz*oz - radius*radius;
    const disc = b*b - c;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    const t1 = -b - sq;
    if (t1 > 0) return t1;
    const t2 = -b + sq;
    return t2 > 0 ? t2 : -1;
}

export function hitTestBodies(ray, bodies) {
    let bestT = Infinity, best = null;
    for (const b of bodies) {
        const t = hitSphere(ray, b.worldPos, b.radiusWorld * b.scale);
        if (t > 0 && t < bestT) { bestT = t; best = b; }
    }
    return best ? { body: best, t: bestT } : null;
}

function invert4(m) {
    const out = new Float32Array(16);
    const a00 = m[0],  a01 = m[1],  a02 = m[2],  a03 = m[3];
    const a10 = m[4],  a11 = m[5],  a12 = m[6],  a13 = m[7];
    const a20 = m[8],  a21 = m[9],  a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00*a11 - a01*a10, b01 = a00*a12 - a02*a10, b02 = a00*a13 - a03*a10;
    const b03 = a01*a12 - a02*a11, b04 = a01*a13 - a03*a11, b05 = a02*a13 - a03*a12;
    const b06 = a20*a31 - a21*a30, b07 = a20*a32 - a22*a30, b08 = a20*a33 - a23*a30;
    const b09 = a21*a32 - a22*a31, b10 = a21*a33 - a23*a31, b11 = a22*a33 - a23*a32;
    const det = b00*b11 - b01*b10 + b02*b09 + b03*b08 - b04*b07 + b05*b06;
    if (!det) return null;
    const id = 1 / det;
    out[0]  = ( a11*b11 - a12*b10 + a13*b09) * id;
    out[1]  = (-a01*b11 + a02*b10 - a03*b09) * id;
    out[2]  = ( a31*b05 - a32*b04 + a33*b03) * id;
    out[3]  = (-a21*b05 + a22*b04 - a23*b03) * id;
    out[4]  = (-a10*b11 + a12*b08 - a13*b07) * id;
    out[5]  = ( a00*b11 - a02*b08 + a03*b07) * id;
    out[6]  = (-a30*b05 + a32*b02 - a33*b01) * id;
    out[7]  = ( a20*b05 - a22*b02 + a23*b01) * id;
    out[8]  = ( a10*b10 - a11*b08 + a13*b06) * id;
    out[9]  = (-a00*b10 + a01*b08 - a03*b06) * id;
    out[10] = ( a30*b04 - a31*b02 + a33*b00) * id;
    out[11] = (-a20*b04 + a21*b02 - a23*b00) * id;
    out[12] = (-a10*b09 + a11*b07 - a12*b06) * id;
    out[13] = ( a00*b09 - a01*b07 + a02*b06) * id;
    out[14] = (-a30*b03 + a31*b01 - a32*b00) * id;
    out[15] = ( a20*b03 - a21*b01 + a22*b00) * id;
    return out;
}

function transformPoint(m, x, y, z) {
    const w = m[3]*x + m[7]*y + m[11]*z + m[15];
    const iw = w === 0 ? 1 : 1 / w;
    return [
        (m[0]*x + m[4]*y + m[8]*z + m[12]) * iw,
        (m[1]*x + m[5]*y + m[9]*z + m[13]) * iw,
        (m[2]*x + m[6]*y + m[10]*z + m[14]) * iw,
    ];
}
