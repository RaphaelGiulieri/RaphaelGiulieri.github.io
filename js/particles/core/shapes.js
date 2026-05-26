// shapes.js — spawn-shape factories.
//
// Each shape exports a function that returns an object:
//   {
//     type:    string,                 // 'cone' | 'sphere' | ...
//     params:  { ... },                // mutable; UI writes here, sample() reads here
//     schema:  { key: { type, min, max, step | options } },
//     sample(rng, outPos, outDir)      // writes spawn position + unit direction
//   }
//
// The editor mutates `params` in place; sample() reads from `params` every
// call so live edits propagate immediately (same pattern as modules).

import { TAU } from './math.js';

export function point() {
  return {
    type: 'point',
    params: {},
    schema: {},
    sample(rng, outPos, outDir) {
      outPos[0] = 0; outPos[1] = 0; outPos[2] = 0;
      outDir[0] = 0; outDir[1] = 1; outDir[2] = 0;
    },
  };
}

export function sphere(opts = {}) {
  const params = {
    radius: opts.radius ?? 1,
    surface: !!opts.surface,
  };
  return {
    type: 'sphere',
    params,
    schema: {
      radius:  { type: 'float', min: 0.01, max: 30, step: 0.01 },
      surface: { type: 'bool' },
    },
    sample(rng, outPos, outDir) {
      rng.unit(outDir);
      const r = params.surface ? params.radius : Math.cbrt(rng.next()) * params.radius;
      outPos[0] = outDir[0] * r;
      outPos[1] = outDir[1] * r;
      outPos[2] = outDir[2] * r;
    },
  };
}

export function cone(opts = {}) {
  const params = {
    radius:    opts.radius ?? 0.2,
    halfAngle: opts.halfAngle ?? Math.PI / 8,
  };
  return {
    type: 'cone',
    params,
    schema: {
      radius:    { type: 'float', min: 0.01, max: 20,         step: 0.01 },
      halfAngle: { type: 'float', min: 0,    max: Math.PI,    step: 0.01 },
    },
    sample(rng, outPos, outDir) {
      const a = rng.next() * TAU;
      const r = Math.sqrt(rng.next()) * params.radius;
      outPos[0] = Math.cos(a) * r;
      outPos[1] = 0;
      outPos[2] = Math.sin(a) * r;
      const cosHA = Math.cos(params.halfAngle);
      const cosTheta = 1 - rng.next() * (1 - cosHA);
      const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
      const phi = rng.next() * TAU;
      outDir[0] = sinTheta * Math.cos(phi);
      outDir[1] = cosTheta;
      outDir[2] = sinTheta * Math.sin(phi);
    },
  };
}

export function box(opts = {}) {
  const s = opts.size ?? [1, 1, 1];
  const params = { sx: s[0], sy: s[1], sz: s[2] };
  return {
    type: 'box',
    params,
    schema: {
      sx: { type: 'float', min: 0, max: 30, step: 0.05 },
      sy: { type: 'float', min: 0, max: 30, step: 0.05 },
      sz: { type: 'float', min: 0, max: 30, step: 0.05 },
    },
    sample(rng, outPos, outDir) {
      outPos[0] = (rng.next() - 0.5) * params.sx;
      outPos[1] = (rng.next() - 0.5) * params.sy;
      outPos[2] = (rng.next() - 0.5) * params.sz;
      outDir[0] = 0; outDir[1] = 1; outDir[2] = 0;
    },
  };
}

export function ring(opts = {}) {
  const params = {
    radius:    opts.radius    ?? 1,
    thickness: opts.thickness ?? 0,
    height:    opts.height    ?? 0,
  };
  return {
    type: 'ring',
    params,
    schema: {
      radius:    { type: 'float', min: 0.01, max: 30, step: 0.01 },
      thickness: { type: 'float', min: 0,    max: 5,  step: 0.01 },
      height:    { type: 'float', min: 0,    max: 5,  step: 0.01 },
    },
    sample(rng, outPos, outDir) {
      const a = rng.next() * TAU;
      const r = params.radius + (params.thickness ? (rng.next() - 0.5) * params.thickness : 0);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      outPos[0] = x;
      outPos[1] = (rng.next() - 0.5) * params.height;
      outPos[2] = z;
      const len = Math.hypot(x, z) || 1;
      outDir[0] = x / len; outDir[1] = 0; outDir[2] = z / len;
    },
  };
}

export function line(opts = {}) {
  const ax = opts.axis ?? [1, 0, 0];
  const dr = opts.direction ?? [0, 1, 0];
  const params = {
    length: opts.length ?? 1,
    ax: ax[0], ay: ax[1], az: ax[2],
    dx: dr[0], dy: dr[1], dz: dr[2],
  };
  return {
    type: 'line',
    params,
    schema: {
      length: { type: 'float', min: 0, max: 30, step: 0.05 },
    },
    sample(rng, outPos, outDir) {
      const t = (rng.next() - 0.5) * params.length;
      outPos[0] = params.ax * t;
      outPos[1] = params.ay * t;
      outPos[2] = params.az * t;
      outDir[0] = params.dx; outDir[1] = params.dy; outDir[2] = params.dz;
    },
  };
}

export function disc(opts = {}) {
  const dr = opts.direction ?? [0, 1, 0];
  const params = {
    radius: opts.radius ?? 1,
    dx: dr[0], dy: dr[1], dz: dr[2],
  };
  return {
    type: 'disc',
    params,
    schema: {
      radius: { type: 'float', min: 0.01, max: 30, step: 0.01 },
    },
    sample(rng, outPos, outDir) {
      const out2 = [0, 0];
      rng.insideDisc(out2);
      outPos[0] = out2[0] * params.radius;
      outPos[1] = 0;
      outPos[2] = out2[1] * params.radius;
      outDir[0] = params.dx; outDir[1] = params.dy; outDir[2] = params.dz;
    },
  };
}

// Catalogue used by the editor for the shape-type dropdown.
export const SHAPE_FACTORIES = { point, sphere, cone, box, ring, line, disc };
