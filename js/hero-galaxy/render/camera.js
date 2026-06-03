// Focal-locked orbital camera. State is (yaw, pitch, distance, fov, target),
// from which view + projection matrices are derived. No pan — target is the
// authoritative focal point and rotation always happens around it.

import {
    mat4LookAt, mat4Perspective, clamp, TAU
} from '../../particles/core/math.js';

const PITCH_LIMIT = (80 / 180) * Math.PI;

export function createCamera() {
    const cam = {
        target:   new Float32Array([0, 0, 0]),
        yaw:      Math.PI * 0.25,
        pitch:    Math.PI * 0.12,
        distance: 30,
        fov:      Math.PI / 3.5,
        aspect:   1,
        near:     0.1,
        far:      500,
        view:     new Float32Array(16),
        proj:     new Float32Array(16),
        eye:      new Float32Array(3),
    };
    recompute(cam);
    return cam;
}

export function setAspect(cam, aspect) {
    cam.aspect = aspect;
    recompute(cam);
}

export function setTarget(cam, x, y, z) {
    cam.target[0] = x; cam.target[1] = y; cam.target[2] = z;
    recompute(cam);
}

export function applyOrbitDelta(cam, dYaw, dPitch) {
    cam.yaw   = (cam.yaw + dYaw) % TAU;
    cam.pitch = clamp(cam.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
    recompute(cam);
}

export function applyZoomDelta(cam, factor, minDist, maxDist) {
    cam.distance = clamp(cam.distance * factor, minDist, maxDist);
    recompute(cam);
}

export function recompute(cam) {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const cy = Math.cos(cam.yaw),   sy = Math.sin(cam.yaw);
    cam.eye[0] = cam.target[0] + cam.distance * cp * sy;
    cam.eye[1] = cam.target[1] + cam.distance * sp;
    cam.eye[2] = cam.target[2] + cam.distance * cp * cy;
    mat4LookAt(cam.eye, cam.target, [0, 1, 0], cam.view);
    mat4Perspective(cam.fov, cam.aspect, cam.near, cam.far, cam.proj);
}
