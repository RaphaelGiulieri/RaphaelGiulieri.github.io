// modules.js — per-particle behaviours.
//
// Each factory returns a function `(system, particleIdx, dt, time) => void`
// that the Emitter calls every frame for every particle it owns. The
// returned function is a closure over a mutable `params` object plus a
// `schema` describing how to render the params in the editor UI:
//
//     mod.name        = 'gravity'
//     mod.params      = { x: 0, y: -9.8, z: 0 }     // mutable; UI writes here
//     mod.schema      = { x: { type: 'float', min: -50, max: 50, step: 0.1 }, ... }
//     mod.kind        = 'force' | 'overlife' | 'force-field' | 'shape'
//     mod.wgslSnippet = (params, paramRefs) => string | null
//
// The modules read params *by reference* every call so live edits take
// effect immediately without recreating the function.
//
// `wgslSnippet` (added in v2 schema-bump for the WebGPU migration) is the
// WebGPU-side counterpart of the JS apply function: it returns a chunk of
// WGSL code that performs the same effect on a particle in a compute shader.
// Phase 0 leaves this null on every module; Phase 2 fills them in one by one.
// The WebGL2 backend ignores the snippet entirely; the WebGPU backend
// concatenates them at emitter setup.

import { Curve, Gradient } from './curves.js';
import { evalBoundScalar, evalBoundColor } from './bound.js';

const _tmpRGBA = new Float32Array(4);
const _tmpRGBA2 = new Float32Array(4);

// Used by the editor to enumerate available modules.
export const MODULE_DEFS = [];

function register(def) {
  // Defensive default: every module def has a wgslSnippet field, even if null,
  // so the WebGPU backend can iterate uniformly without per-module hasOwnProperty.
  if (!('wgslSnippet' in def)) def.wgslSnippet = null;
  // Guard: factory must produce a function with moduleName set, so the
  // skip-helper and codegen can identify it.
  const probe = def.factory();
  if (typeof probe !== 'function') {
    throw new Error(`register("${def.name}"): factory() didn't return a function`);
  }
  if (!probe.moduleName) {
    throw new Error(`register("${def.name}"): factory()'s return value has no moduleName property`);
  }
  MODULE_DEFS.push(def);
  return def;
}

// ---------------------------------------------------------------- gravity
export function gravity(g = [0, -9.8, 0]) {
  const params = { x: g[0] || 0, y: g[1] || 0, z: g[2] || 0 };
  const apply = (sys, i, dt) => {
    sys.vel[i*3]     += evalBoundScalar(params.x, i, sys, null) * dt;
    sys.vel[i*3 + 1] += evalBoundScalar(params.y, i, sys, null) * dt;
    sys.vel[i*3 + 2] += evalBoundScalar(params.z, i, sys, null) * dt;
  };
  apply.moduleName = 'gravity';
  apply.kind = 'force';
  apply.forceMode = 'add';
  apply.params = params;
  apply.schema = {
    x: { type: 'float', min: -50, max: 50, step: 0.1, bindable: true },
    y: { type: 'float', min: -50, max: 50, step: 0.1, bindable: true },
    z: { type: 'float', min: -50, max: 50, step: 0.1, bindable: true },
  };
  apply.wgslSnippet = (paramRefs) => `
{
  accel.x = accel.x + eval_bound(module_params.${paramRefs.x}, p, i);
  accel.y = accel.y + eval_bound(module_params.${paramRefs.y}, p, i);
  accel.z = accel.z + eval_bound(module_params.${paramRefs.z}, p, i);
}`;
  return apply;
}
register({ name: 'gravity', category: 'Forces', factory: gravity, doc: 'Constant force applied per second.' });

// ---------------------------------------------------------------- drag
export function drag(coefficient = 0.4) {
  const params = { coefficient };
  const apply = (sys, i, dt) => {
    const c = evalBoundScalar(params.coefficient, i, sys, null);
    const f = Math.exp(-c * dt);
    sys.vel[i*3]     *= f;
    sys.vel[i*3 + 1] *= f;
    sys.vel[i*3 + 2] *= f;
  };
  apply.moduleName = 'drag';
  apply.kind = 'force';
  apply.forceMode = 'mul';
  apply.params = params;
  apply.schema = {
    coefficient: { type: 'float', min: 0, max: 10, step: 0.05, bindable: true },
  };
  apply.wgslSnippet = (paramRefs) => `
{
  let drag_c = eval_bound(module_params.${paramRefs.coefficient}, p, i);
  let drag_f = exp(-drag_c * u.dt);
  p.vel = p.vel * drag_f;
}`;
  return apply;
}
register({ name: 'drag', category: 'Forces', factory: drag, doc: 'Exponential velocity decay. Higher = stronger drag.' });

// ---------------------------------------------------------------- attractor
export function attractor({ position = [0,0,0], strength = 1, falloff = 'inv-square' } = {}) {
  const params = { x: position[0], y: position[1], z: position[2], strength, falloff };
  const apply = (sys, i, dt) => {
    const px = evalBoundScalar(params.x, i, sys, null);
    const py = evalBoundScalar(params.y, i, sys, null);
    const pz = evalBoundScalar(params.z, i, sys, null);
    const ks = evalBoundScalar(params.strength, i, sys, null);
    const dx = px - sys.pos[i*3];
    const dy = py - sys.pos[i*3 + 1];
    const dz = pz - sys.pos[i*3 + 2];
    const r2 = dx*dx + dy*dy + dz*dz + 0.01;
    const f = (params.falloff === 'inv-square') ? ks / r2 : ks / Math.sqrt(r2);
    sys.vel[i*3]     += dx * f * dt;
    sys.vel[i*3 + 1] += dy * f * dt;
    sys.vel[i*3 + 2] += dz * f * dt;
  };
  apply.moduleName = 'attractor';
  apply.kind = 'force-field';
  apply.forceMode = 'add';
  apply.params = params;
  apply.schema = {
    x: { type: 'float', min: -20, max: 20, step: 0.1, bindable: true },
    y: { type: 'float', min: -20, max: 20, step: 0.1, bindable: true },
    z: { type: 'float', min: -20, max: 20, step: 0.1, bindable: true },
    strength: { type: 'float', min: -50, max: 50, step: 0.1, bindable: true },
    falloff:  { type: 'enum',  options: ['inv-square', 'inverse'] },
  };
  apply.wgslSnippet = (paramRefs) => {
    const falloffLine = paramRefs.falloff === 'inv-square'
      ? 'let f = ks / r2;'
      : 'let f = ks * inverseSqrt(r2);';
    return `
{
  let attractor_pos = vec3<f32>(
    eval_bound(module_params.${paramRefs.x}, p, i),
    eval_bound(module_params.${paramRefs.y}, p, i),
    eval_bound(module_params.${paramRefs.z}, p, i),
  );
  let ks = eval_bound(module_params.${paramRefs.strength}, p, i);
  let d = attractor_pos - p.pos;
  let r2 = dot(d, d) + 0.01;
  ${falloffLine}
  accel = accel + d * f;
}`;
  };
  return apply;
}
register({ name: 'attractor', category: 'Forces', factory: attractor, doc: 'Pulls particles toward a point. inv-square is gravity-like; inverse is gentler.' });

// ---------------------------------------------------------------- curlNoise
//
// Multi-octave pseudo-curl turbulence. Not true divergence-free curl-noise
// (that needs Stefan-Gustavson simplex with analytical derivatives, expensive
// in JS); instead two octaves of orthogonal sin·cos fields with cross-axis
// modulation. Cheap and visually fluid-like.
export function curlNoise({ frequency = 0.4, amplitude = 1, evolveSpeed = 0.2, octaves = 2 } = {}) {
  const params = { frequency, amplitude, evolveSpeed, octaves };
  const apply = (sys, i, dt, time) => {
    const freq = evalBoundScalar(params.frequency, i, sys, null);
    const amp  = evalBoundScalar(params.amplitude, i, sys, null);
    const tt = time * evalBoundScalar(params.evolveSpeed, i, sys, null);
    let fx = 0, fy = 0, fz = 0;
    let f = freq, a = 1;
    const N = Math.max(1, Math.min(4, Math.round(params.octaves)));
    for (let o = 0; o < N; o++) {
      const x = sys.pos[i*3]     * f;
      const y = sys.pos[i*3 + 1] * f;
      const z = sys.pos[i*3 + 2] * f;
      const off = o * 13.71;
      fx += Math.sin(y * 1.3 + tt + off)       * Math.cos(z * 1.7 - tt * 0.6 - off) * a;
      fy += Math.sin(z * 1.3 + tt * 1.1 + off) * Math.cos(x * 1.7 + tt * 0.7 + off) * a;
      fz += Math.sin(x * 1.3 - tt * 0.9 + off) * Math.cos(y * 1.7 + tt + off)       * a;
      f *= 2.13;  a *= 0.5;
    }
    sys.vel[i*3]     += fx * amp * dt;
    sys.vel[i*3 + 1] += fy * amp * dt;
    sys.vel[i*3 + 2] += fz * amp * dt;
  };
  apply.moduleName = 'curlNoise';
  apply.kind = 'force-field';
  apply.forceMode = 'add';
  apply.params = params;
  apply.schema = {
    frequency:   { type: 'float', min: 0.05, max: 4,   step: 0.02, bindable: true },
    amplitude:   { type: 'float', min: 0,    max: 20,  step: 0.1,  bindable: true },
    evolveSpeed: { type: 'float', min: 0,    max: 2,   step: 0.01, bindable: true },
    octaves:     { type: 'float', min: 1,    max: 4,   step: 1 },
  };
  // Codegen-time loop unroll: octaves is numeric (not bindable), so we fix the
  // iteration count at shader-compilation time, matching the JS path exactly.
  apply.wgslSnippet = (paramRefs) => {
    // params.octaves is a plain number (not bindable) — read it directly from
    // the closure rather than via paramRefs, which would be a struct-field name
    // (e.g. 'm0_curlNoise_octaves') because emitModuleParamsStruct includes
    // numeric params as Bound fields.
    const N = Math.max(1, Math.min(4, Math.round(params.octaves ?? 2)));
    let octaveBody = '';
    for (let o = 0; o < N; o++) {
      octaveBody += `
    {
      let cn_off = ${(o * 13.71).toFixed(6)};
      let cn_x = p.pos.x * cn_f;
      let cn_y = p.pos.y * cn_f;
      let cn_z = p.pos.z * cn_f;
      cn_fx = cn_fx + sin(cn_y * 1.3 + cn_tt + cn_off)       * cos(cn_z * 1.7 - cn_tt * 0.6 - cn_off) * cn_a;
      cn_fy = cn_fy + sin(cn_z * 1.3 + cn_tt * 1.1 + cn_off) * cos(cn_x * 1.7 + cn_tt * 0.7 + cn_off) * cn_a;
      cn_fz = cn_fz + sin(cn_x * 1.3 - cn_tt * 0.9 + cn_off) * cos(cn_y * 1.7 + cn_tt + cn_off)       * cn_a;
      cn_f = cn_f * 2.13;
      cn_a = cn_a * 0.5;
    }`;
    }
    return `
{
  let cn_freq = eval_bound(module_params.${paramRefs.frequency}, p, i);
  let cn_amp  = eval_bound(module_params.${paramRefs.amplitude}, p, i);
  let cn_tt   = u.time * eval_bound(module_params.${paramRefs.evolveSpeed}, p, i);
  var cn_fx = 0.0; var cn_fy = 0.0; var cn_fz = 0.0;
  var cn_f = cn_freq; var cn_a = 1.0;
${octaveBody}
  accel = accel + vec3<f32>(cn_fx, cn_fy, cn_fz) * cn_amp;
}`;
  };
  return apply;
}
register({ name: 'curlNoise', category: 'Forces', factory: curlNoise, doc: 'Pseudo-curl turbulence — fluid-like motion (multi-octave sin·cos).' });

// ---------------------------------------------------------------- wind
export function wind({ vector = [1, 0, 0], gustiness = 0, gustFreq = 0.7 } = {}) {
  const params = { x: vector[0] ?? 0, y: vector[1] ?? 0, z: vector[2] ?? 0, gustiness, gustFreq };
  const apply = (sys, i, dt, time) => {
    // Uniform sinusoidal gust: scales the entire wind vector by (1 + g·sin(t·gf·2π)).
    const g  = evalBoundScalar(params.gustiness, i, sys, null);
    const gf = evalBoundScalar(params.gustFreq,  i, sys, null);
    const gust = 1.0 + g * Math.sin(time * gf * 2 * Math.PI);
    sys.vel[i*3]     += evalBoundScalar(params.x, i, sys, null) * gust * dt;
    sys.vel[i*3 + 1] += evalBoundScalar(params.y, i, sys, null) * gust * dt;
    sys.vel[i*3 + 2] += evalBoundScalar(params.z, i, sys, null) * gust * dt;
  };
  apply.moduleName = 'wind';
  apply.kind = 'force';
  apply.forceMode = 'add';
  apply.params = params;
  apply.schema = {
    x:        { type: 'float', min: -30, max: 30, step: 0.1,  bindable: true },
    y:        { type: 'float', min: -30, max: 30, step: 0.1,  bindable: true },
    z:        { type: 'float', min: -30, max: 30, step: 0.1,  bindable: true },
    gustiness:{ type: 'float', min: 0,   max: 10, step: 0.05 },
    gustFreq: { type: 'float', min: 0.01,max: 5,  step: 0.01 },
  };
  apply.wgslSnippet = (paramRefs) => `
{
  let wx        = eval_bound(module_params.${paramRefs.x}, p, i);
  let wy        = eval_bound(module_params.${paramRefs.y}, p, i);
  let wz        = eval_bound(module_params.${paramRefs.z}, p, i);
  let w_gust    = eval_bound(module_params.${paramRefs.gustiness}, p, i);
  let w_gustfreq = eval_bound(module_params.${paramRefs.gustFreq}, p, i);
  let gust      = 1.0 + w_gust * sin(u.time * w_gustfreq * 6.283185);
  accel = accel + vec3<f32>(wx, wy, wz) * gust;
}`;
  return apply;
}
register({ name: 'wind', category: 'Forces', factory: wind, doc: 'Directional force with optional sinusoidal gusts.' });

// ---------------------------------------------------------------- vortex
//
// Rotational force around an arbitrary axis (default: world Y). Tangential
// velocity proportional to `strength / (1 + r * r)` so far particles aren't
// flung; close particles spin fast.
export function vortex({ position = [0,0,0], axis = [0,1,0], strength = 4, inwardPull = 0 } = {}) {
  const params = {
    x: position[0], y: position[1], z: position[2],
    ax: axis[0], ay: axis[1], az: axis[2],
    strength, inwardPull,
  };
  const apply = (sys, i, dt) => {
    // axis (unit-normalise once per particle)
    let nx = params.ax, ny = params.ay, nz = params.az;
    const al = Math.hypot(nx, ny, nz) || 1;
    nx /= al; ny /= al; nz /= al;
    // r = pos - center
    const rx = sys.pos[i*3]     - evalBoundScalar(params.x, i, sys, null);
    const ry = sys.pos[i*3 + 1] - evalBoundScalar(params.y, i, sys, null);
    const rz = sys.pos[i*3 + 2] - evalBoundScalar(params.z, i, sys, null);
    // r perpendicular to axis: r - (r·n) n
    const rn = rx * nx + ry * ny + rz * nz;
    const px = rx - rn * nx, py = ry - rn * ny, pz = rz - rn * nz;
    // tangent = axis × p
    const tx = ny * pz - nz * py;
    const ty = nz * px - nx * pz;
    const tz = nx * py - ny * px;
    const r2 = px*px + py*py + pz*pz + 0.01;
    const k = evalBoundScalar(params.strength, i, sys, null) / (1 + r2);
    sys.vel[i*3]     += tx * k * dt;
    sys.vel[i*3 + 1] += ty * k * dt;
    sys.vel[i*3 + 2] += tz * k * dt;
    // optional inward pull (spirals)
    const ip = evalBoundScalar(params.inwardPull, i, sys, null);
    if (ip !== 0) {
      const pl = Math.sqrt(r2);
      const inv = ip / pl;
      sys.vel[i*3]     -= px * inv * dt;
      sys.vel[i*3 + 1] -= py * inv * dt;
      sys.vel[i*3 + 2] -= pz * inv * dt;
    }
  };
  apply.moduleName = 'vortex';
  apply.kind = 'force-field';
  apply.forceMode = 'add';
  apply.params = params;
  apply.schema = {
    x:          { type: 'float', min: -20, max: 20, step: 0.1, bindable: true },
    y:          { type: 'float', min: -20, max: 20, step: 0.1, bindable: true },
    z:          { type: 'float', min: -20, max: 20, step: 0.1, bindable: true },
    ax:         { type: 'float', min: -1,  max: 1,  step: 0.01 },
    ay:         { type: 'float', min: -1,  max: 1,  step: 0.01 },
    az:         { type: 'float', min: -1,  max: 1,  step: 0.01 },
    strength:   { type: 'float', min: -30, max: 30, step: 0.1, bindable: true },
    inwardPull: { type: 'float', min: -10, max: 10, step: 0.05, bindable: true },
  };
  apply.wgslSnippet = (paramRefs) => `
{
  let v_cx = eval_bound(module_params.${paramRefs.x}, p, i);
  let v_cy = eval_bound(module_params.${paramRefs.y}, p, i);
  let v_cz = eval_bound(module_params.${paramRefs.z}, p, i);
  let v_ax = eval_bound(module_params.${paramRefs.ax}, p, i);
  let v_ay = eval_bound(module_params.${paramRefs.ay}, p, i);
  let v_az = eval_bound(module_params.${paramRefs.az}, p, i);
  let v_ks = eval_bound(module_params.${paramRefs.strength}, p, i);
  let v_ip = eval_bound(module_params.${paramRefs.inwardPull}, p, i);
  let v_axis_raw = vec3<f32>(v_ax, v_ay, v_az);
  let v_aLen = max(length(v_axis_raw), 0.000001);
  let v_n = v_axis_raw / v_aLen;
  let v_r = p.pos - vec3<f32>(v_cx, v_cy, v_cz);
  let v_rn = dot(v_r, v_n);
  let v_perp = v_r - v_n * v_rn;
  let v_r2 = dot(v_perp, v_perp) + 0.01;
  let v_tangent = cross(v_n, v_perp);
  let v_k = v_ks / (1.0 + v_r2);
  accel = accel + v_tangent * v_k;
  if (v_ip != 0.0) {
    let v_pl = sqrt(v_r2);
    let v_inv = v_ip / v_pl;
    accel = accel - v_perp * v_inv;
  }
}`;
  return apply;
}
register({ name: 'vortex', category: 'Forces', factory: vortex, doc: 'Rotational force around an arbitrary axis. inwardPull > 0 makes a spiral sink.' });

// ---------------------------------------------------------------- spring
//
// Pull particles toward an anchor with Hooke's law + critical-damping option.
// Useful for "settle to home" effects and oscillations.
export function spring({ anchor = [0, 0, 0], k = 5, damping = 0.4 } = {}) {
  const params = { x: anchor[0], y: anchor[1], z: anchor[2], k, damping };
  const apply = (sys, i, dt) => {
    const ax = evalBoundScalar(params.x, i, sys, null);
    const ay = evalBoundScalar(params.y, i, sys, null);
    const az = evalBoundScalar(params.z, i, sys, null);
    const kv = evalBoundScalar(params.k, i, sys, null);
    const dv = evalBoundScalar(params.damping, i, sys, null);
    const dx = ax - sys.pos[i*3];
    const dy = ay - sys.pos[i*3 + 1];
    const dz = az - sys.pos[i*3 + 2];
    sys.vel[i*3]     += dx * kv * dt - sys.vel[i*3]     * dv * dt;
    sys.vel[i*3 + 1] += dy * kv * dt - sys.vel[i*3 + 1] * dv * dt;
    sys.vel[i*3 + 2] += dz * kv * dt - sys.vel[i*3 + 2] * dv * dt;
  };
  apply.moduleName = 'spring';
  apply.kind = 'force';
  apply.params = params;
  apply.schema = {
    x:       { type: 'float', min: -20, max: 20, step: 0.1, bindable: true },
    y:       { type: 'float', min: -20, max: 20, step: 0.1, bindable: true },
    z:       { type: 'float', min: -20, max: 20, step: 0.1, bindable: true },
    k:       { type: 'float', min: 0,   max: 50, step: 0.1, bindable: true },
    damping: { type: 'float', min: 0,   max: 10, step: 0.05, bindable: true },
  };
  apply.wgslSnippet = (paramRefs) => `
{
  let sp_anchor = vec3<f32>(
    eval_bound(module_params.${paramRefs.x}, p, i),
    eval_bound(module_params.${paramRefs.y}, p, i),
    eval_bound(module_params.${paramRefs.z}, p, i),
  );
  let sp_k = eval_bound(module_params.${paramRefs.k}, p, i);
  let sp_damp = eval_bound(module_params.${paramRefs.damping}, p, i);
  accel = accel + sp_k * (sp_anchor - p.pos) - sp_damp * p.vel;
}`;
  return apply;
}
register({ name: 'spring', category: 'Forces', factory: spring, doc: 'Pull toward anchor (Hooke\'s law) + linear damping.' });

// ---------------------------------------------------------------- velocityOverLifetime
export function velocityOverLifetime({ multiplier = null, swirl = 0 } = {}) {
  const params = { multiplier, swirl };
  const apply = (sys, i, dt) => {
    if (params.multiplier) {
      const t = sys.life[i] > 0 ? sys.age[i] / sys.life[i] : 0;
      const m = params.multiplier.sample(t);
      sys.vel[i*3]     *= m;
      sys.vel[i*3 + 1] *= m;
      sys.vel[i*3 + 2] *= m;
    }
    if (params.swirl !== 0) {
      const x = sys.pos[i*3], z = sys.pos[i*3 + 2];
      const r = Math.hypot(x, z) + 0.001;
      const tx = -z / r, tz = x / r;
      sys.vel[i*3]     += tx * params.swirl * dt;
      sys.vel[i*3 + 2] += tz * params.swirl * dt;
    }
  };
  apply.moduleName = 'velocityOverLifetime';
  apply.kind = 'force';
  apply.forceMode = 'mul';
  apply.params = params;
  apply.schema = {
    swirl: { type: 'float', min: -10, max: 10, step: 0.05 },
  };
  apply.wgslSnippet = (paramRefs) => {
    if (!('swirl' in paramRefs)) return null;   // multiplier-Curve case not in 2A
    // Match JS semantics: swirl is a TANGENTIAL-FORCE per-second around Y at
    // the particle's current X-Z position, NOT a rotation rate. Matches:
    //   tx = -z/r, tz = x/r            // unit tangent
    //   vel.xz += (tx, tz) * swirl * dt
    // This was previously coded as a velocity-vector rotation (cos/sin),
    // which only matched the JS at vel=0 — so tWgpuParityVelocityOverLife
    // passed Δ=0 trivially because the parity fixture spawns at origin
    // with speed=0. Real presets with non-zero pos/vel diverged.
    return `
{
  let swirl = eval_bound(module_params.${paramRefs.swirl}, p, i);
  let r = sqrt(p.pos.x * p.pos.x + p.pos.z * p.pos.z) + 0.001;
  let tx = -p.pos.z / r;
  let tz =  p.pos.x / r;
  p.vel.x = p.vel.x + tx * swirl * u.dt;
  p.vel.z = p.vel.z + tz * swirl * u.dt;
}`;
  };
  return apply;
}
register({ name: 'velocityOverLifetime', category: 'Forces', factory: velocityOverLifetime, doc: 'Tangential swirl around Y axis.' });

// ---------------------------------------------------------------- colorOverLifetime
export function colorOverLifetime(gradient) {
  const params = { gradient };
  const apply = (sys, i) => {
    const t = sys.life[i] > 0 ? sys.age[i] / sys.life[i] : 0;
    params.gradient.sample(t, _tmpRGBA);
    sys.color[i*4]     = _tmpRGBA[0];
    sys.color[i*4 + 1] = _tmpRGBA[1];
    sys.color[i*4 + 2] = _tmpRGBA[2];
    sys.color[i*4 + 3] = _tmpRGBA[3];
  };
  apply.moduleName = 'colorOverLifetime';
  apply.kind = 'overlife';
  apply.params = params;
  apply.schema = {
    gradient: { type: 'gradient' },
  };
  apply.wgslSnippet = (paramRefs) => {
    if (!('gradient' in paramRefs)) return null;
    return `
{
  p.color = eval_bound_color(module_params.${paramRefs.gradient}, p, i);
}`;
  };
  return apply;
}
register({ name: 'colorOverLifetime', category: 'Over Lifetime', factory: () => {
  return colorOverLifetime(new Gradient([[0, [1,1,1,1]], [1, [1, 0.5, 0.1, 0]]]));
}, doc: 'Particle colour from gradient over lifetime.' });

// ---------------------------------------------------------------- sizeOverLifetime
export function sizeOverLifetime(curve) {
  const params = { curve };
  const apply = (sys, i) => {
    const t = sys.life[i] > 0 ? sys.age[i] / sys.life[i] : 0;
    sys.size[i] = params.curve.sample(t);
  };
  apply.moduleName = 'sizeOverLifetime';
  apply.kind = 'overlife';
  apply.params = params;
  apply.schema = {
    curve: { type: 'curve' },
  };
  apply.wgslSnippet = (paramRefs) => {
    // sizeOverLifetime's JS apply does: sys.size[i] = curve.sample(t)  — a SET.
    // The wgslSnippet matches that semantics: assign, not multiply.
    if (!('curve' in paramRefs)) return null;
    return `
{
  p.size = eval_bound(module_params.${paramRefs.curve}, p, i);
}`;
  };
  return apply;
}
register({ name: 'sizeOverLifetime', category: 'Over Lifetime', factory: () => {
  return sizeOverLifetime(new Curve([[0, 0], [0.2, 1], [1, 0]]));
}, doc: 'Particle size from curve over lifetime.' });

// ---------------------------------------------------------------- rotationOverLifetime
export function rotationOverLifetime(curve) {
  const params = { curve };
  const apply = (sys, i) => {
    const t = sys.life[i] > 0 ? sys.age[i] / sys.life[i] : 0;
    sys.avel[i] = params.curve.sample(t);
  };
  apply.moduleName = 'rotationOverLifetime';
  apply.kind = 'overlife';
  apply.params = params;
  apply.schema = {
    curve: { type: 'curve' },
  };
  apply.wgslSnippet = (paramRefs) => {
    if (!('curve' in paramRefs)) return null;
    return `
{
  p.avel = eval_bound(module_params.${paramRefs.curve}, p, i);
}`;
  };
  return apply;
}
register({ name: 'rotationOverLifetime', category: 'Over Lifetime', factory: () => {
  return rotationOverLifetime(new Curve([[0, 0], [1, 6.28]]));
}, doc: 'Angular velocity from curve over lifetime.' });

// ---------------------------------------------------------------- boundary
export function boundary({ shape = 'sphere', radius = 50, size = [50,50,50], mode = 'kill', restitution = 0.7 } = {}) {
  const params = { shape, radius, sx: size[0], sy: size[1], sz: size[2], mode, restitution };
  const apply = (sys, i) => {
    if (params.shape === 'sphere') {
      const x = sys.pos[i*3], y = sys.pos[i*3 + 1], z = sys.pos[i*3 + 2];
      const r2 = x*x + y*y + z*z;
      const r = params.radius;
      if (r2 <= r * r) return;
      if (params.mode === 'kill') { sys.age[i] = sys.life[i]; return; }
      const len = Math.sqrt(r2);
      const nx = x / len, ny = y / len, nz = z / len;
      if (params.mode === 'wrap') {
        sys.pos[i*3]     = -nx * r;
        sys.pos[i*3 + 1] = -ny * r;
        sys.pos[i*3 + 2] = -nz * r;
      } else {
        sys.pos[i*3]     = nx * r;
        sys.pos[i*3 + 1] = ny * r;
        sys.pos[i*3 + 2] = nz * r;
        const vn = sys.vel[i*3]*nx + sys.vel[i*3+1]*ny + sys.vel[i*3+2]*nz;
        if (vn > 0) {
          sys.vel[i*3]     -= 2 * vn * nx * params.restitution;
          sys.vel[i*3 + 1] -= 2 * vn * ny * params.restitution;
          sys.vel[i*3 + 2] -= 2 * vn * nz * params.restitution;
        }
      }
    } else {
      const sx = params.sx, sy = params.sy, sz = params.sz;
      const x = sys.pos[i*3], y = sys.pos[i*3+1], z = sys.pos[i*3+2];
      const out = Math.abs(x) > sx || Math.abs(y) > sy || Math.abs(z) > sz;
      if (!out) return;
      if (params.mode === 'kill') { sys.age[i] = sys.life[i]; return; }
      for (let k = 0; k < 3; k++) {
        const lim = [sx, sy, sz][k];
        const p = sys.pos[i*3 + k];
        if (Math.abs(p) > lim) {
          if (params.mode === 'wrap') {
            sys.pos[i*3 + k] = -Math.sign(p) * lim;
          } else {
            sys.pos[i*3 + k] = Math.sign(p) * lim;
            sys.vel[i*3 + k] = -sys.vel[i*3 + k] * params.restitution;
          }
        }
      }
    }
  };
  apply.moduleName = 'boundary';
  apply.kind = 'force';
  apply.params = params;
  apply.schema = {
    shape:       { type: 'enum',  options: ['sphere', 'box'] },
    radius:      { type: 'float', min: 1, max: 100, step: 0.5 },
    mode:        { type: 'enum',  options: ['kill', 'bounce', 'wrap'] },
    restitution: { type: 'float', min: 0, max: 1,  step: 0.05 },
  };
  return apply;
}
// `boundary` is the legacy combined sphere/box module from Phase 0. It is
// not used by any preset and was not ported to WebGPU in Phase 2B
// (constraint.sphere / constraint.box cover its use cases on both backends
// and are bindable). The factory is kept for compatibility with any
// external callers; if a config tries to use it on WebGPU the module-codegen
// will throw a clear error pointing to the replacements.
register({ name: 'boundary', category: 'Constraints', factory: boundary,
  doc: 'DEPRECATED — legacy combined sphere/box. Use constraint.sphere or constraint.box instead. Not ported to WebGPU.' });

// =============================================================================
// constraint.* — boundary primitives, one per shape so each has a focused schema.
// Behaviours: 'kill' (mark dead), 'bounce' (reflect velocity), 'wrap' (teleport).
// =============================================================================

function constraintSphere({ radius = 5, mode = 'kill', restitution = 0.7 } = {}) {
  const params = { radius, mode, restitution };
  const apply = (sys, i) => {
    const r = evalBoundScalar(params.radius, i, sys, null);
    const x = sys.pos[i*3], y = sys.pos[i*3+1], z = sys.pos[i*3+2];
    const r2 = x*x + y*y + z*z;
    if (r2 <= r * r) return;
    if (params.mode === 'kill') { sys.age[i] = sys.life[i]; return; }
    const len = Math.sqrt(r2);
    const nx = x / len, ny = y / len, nz = z / len;
    if (params.mode === 'wrap') {
      sys.pos[i*3] = -nx * r; sys.pos[i*3+1] = -ny * r; sys.pos[i*3+2] = -nz * r;
    } else {
      sys.pos[i*3] = nx * r; sys.pos[i*3+1] = ny * r; sys.pos[i*3+2] = nz * r;
      const vn = sys.vel[i*3]*nx + sys.vel[i*3+1]*ny + sys.vel[i*3+2]*nz;
      if (vn > 0) {
        sys.vel[i*3]   -= 2 * vn * nx * params.restitution;
        sys.vel[i*3+1] -= 2 * vn * ny * params.restitution;
        sys.vel[i*3+2] -= 2 * vn * nz * params.restitution;
      }
    }
  };
  apply.moduleName = 'constraint.sphere';
  apply.kind = 'constraint';
  apply.params = params;
  apply.schema = {
    radius:      { type: 'float', min: 0.1, max: 100, step: 0.1, bindable: true },
    mode:        { type: 'enum',  options: ['kill', 'bounce', 'wrap'] },
    restitution: { type: 'float', min: 0, max: 1, step: 0.05 },
  };
  apply.wgslSnippet = (paramRefs) => {
    const mode = paramRefs.mode || 'kill';
    const radiusBound = paramRefs.radius;
    // restitution is in the ModuleParams struct (emitModuleParamsStruct includes
    // all number params). Call eval_bound so it works whether the value is a
    // plain constant Bound or a live-bindable Bound.
    const restitBound = paramRefs.restitution;
    const modeBody = (() => {
      if (mode === 'kill') {
        return `if (r2 > rad * rad) { p.life = 0.0; }`;
      }
      if (mode === 'wrap') {
        return `
            if (r2 > rad * rad) {
                let len = sqrt(r2);
                let n = p.pos / len;
                p.pos = -n * rad;
            }`;
      }
      // bounce — eval restitution once outside the radius check for clarity
      return `
            if (r2 > rad * rad) {
                let len = sqrt(r2);
                let n = p.pos / len;
                p.pos = n * rad;
                let vn = dot(p.vel, n);
                if (vn > 0.0) {
                    let restit = eval_bound(module_params.${restitBound}, p, i);
                    p.vel = p.vel - 2.0 * vn * n * restit;
                }
            }`;
    })();
    return `
{
  let rad = eval_bound(module_params.${radiusBound}, p, i);
  let r2 = dot(p.pos, p.pos);
  ${modeBody}
}`;
  };
  return apply;
}

function constraintBox({ sx = 5, sy = 5, sz = 5, mode = 'kill', restitution = 0.7 } = {}) {
  const params = { sx, sy, sz, mode, restitution };
  const apply = (sys, i) => {
    const x = sys.pos[i*3], y = sys.pos[i*3+1], z = sys.pos[i*3+2];
    const sX = evalBoundScalar(params.sx, i, sys, null);
    const sY = evalBoundScalar(params.sy, i, sys, null);
    const sZ = evalBoundScalar(params.sz, i, sys, null);
    const out = Math.abs(x) > sX || Math.abs(y) > sY || Math.abs(z) > sZ;
    if (!out) return;
    if (params.mode === 'kill') { sys.age[i] = sys.life[i]; return; }
    const lim = [sX, sY, sZ];
    for (let k = 0; k < 3; k++) {
      const p = sys.pos[i*3 + k];
      if (Math.abs(p) > lim[k]) {
        if (params.mode === 'wrap') sys.pos[i*3 + k] = -Math.sign(p) * lim[k];
        else { sys.pos[i*3 + k] = Math.sign(p) * lim[k]; sys.vel[i*3 + k] = -sys.vel[i*3 + k] * params.restitution; }
      }
    }
  };
  apply.moduleName = 'constraint.box';
  apply.kind = 'constraint';
  apply.params = params;
  apply.schema = {
    sx: { type: 'float', min: 0.1, max: 100, step: 0.1, bindable: true },
    sy: { type: 'float', min: 0.1, max: 100, step: 0.1, bindable: true },
    sz: { type: 'float', min: 0.1, max: 100, step: 0.1, bindable: true },
    mode: { type: 'enum', options: ['kill', 'bounce', 'wrap'] },
    restitution: { type: 'float', min: 0, max: 1, step: 0.05 },
  };
  apply.wgslSnippet = (paramRefs) => {
    const mode = paramRefs.mode || 'kill';
    const modeBody = (() => {
      if (mode === 'kill') return `
            if (abs(p.pos.x) > limX || abs(p.pos.y) > limY || abs(p.pos.z) > limZ) {
                p.life = 0.0;
            }`;
      if (mode === 'wrap') return `
            if (abs(p.pos.x) > limX) { p.pos.x = -sign(p.pos.x) * limX; }
            if (abs(p.pos.y) > limY) { p.pos.y = -sign(p.pos.y) * limY; }
            if (abs(p.pos.z) > limZ) { p.pos.z = -sign(p.pos.z) * limZ; }`;
      // bounce — reflect each axis independently with restitution
      return `
            if (abs(p.pos.x) > limX) { p.pos.x = sign(p.pos.x) * limX; p.vel.x = -p.vel.x * eval_bound(module_params.${paramRefs.restitution}, p, i); }
            if (abs(p.pos.y) > limY) { p.pos.y = sign(p.pos.y) * limY; p.vel.y = -p.vel.y * eval_bound(module_params.${paramRefs.restitution}, p, i); }
            if (abs(p.pos.z) > limZ) { p.pos.z = sign(p.pos.z) * limZ; p.vel.z = -p.vel.z * eval_bound(module_params.${paramRefs.restitution}, p, i); }`;
    })();
    return `
{
  let limX = eval_bound(module_params.${paramRefs.sx}, p, i);
  let limY = eval_bound(module_params.${paramRefs.sy}, p, i);
  let limZ = eval_bound(module_params.${paramRefs.sz}, p, i);
  ${modeBody}
}`;
  };
  return apply;
}

// Y-axis ground plane (or any axis-aligned plane).
function constraintPlane({ axis = 'y', value = 0, side = 'below', mode = 'bounce', restitution = 0.7 } = {}) {
  const params = { axis, value, side, mode, restitution };
  const apply = (sys, i) => {
    const k = params.axis === 'x' ? 0 : params.axis === 'z' ? 2 : 1;
    const v = evalBoundScalar(params.value, i, sys, null);
    const p = sys.pos[i*3 + k];
    const violated = params.side === 'below' ? p < v : p > v;
    if (!violated) return;
    if (params.mode === 'kill') { sys.age[i] = sys.life[i]; return; }
    if (params.mode === 'wrap') { sys.pos[i*3 + k] = (params.side === 'below') ? v + (v - p) : v - (p - v); return; }
    // bounce: clamp + reflect velocity if heading further wrong
    sys.pos[i*3 + k] = v;
    const vk = sys.vel[i*3 + k];
    const headingWrong = (params.side === 'below' && vk < 0) || (params.side === 'above' && vk > 0);
    if (headingWrong) sys.vel[i*3 + k] = -vk * params.restitution;
  };
  apply.moduleName = 'constraint.plane';
  apply.kind = 'constraint';
  apply.params = params;
  apply.schema = {
    axis:        { type: 'enum',  options: ['x', 'y', 'z'] },
    value:       { type: 'float', min: -50, max: 50, step: 0.1, bindable: true },
    side:        { type: 'enum',  options: ['below', 'above'] },
    mode:        { type: 'enum',  options: ['kill', 'bounce', 'wrap'] },
    restitution: { type: 'float', min: 0,   max: 1, step: 0.05 },
  };
  apply.wgslSnippet = (paramRefs) => {
    const axis  = paramRefs.axis  || 'y';
    const side  = paramRefs.side  || 'below';
    const mode  = paramRefs.mode  || 'bounce';
    const valueBound  = paramRefs.value;
    const restitBound = paramRefs.restitution;

    // Violation comparison: below → p < v, above → p > v.
    const cmp = side === 'below' ? '<' : '>';
    // Heading further wrong: below → vel < 0, above → vel > 0.
    const headingWrong = side === 'below' ? '< 0.0' : '> 0.0';

    const modeBody = (() => {
      if (mode === 'kill') {
        return `if (p.pos.${axis} ${cmp} v) { p.life = 0.0; }`;
      }
      if (mode === 'wrap') {
        // JS: below → v + (v - p) = 2v - p;  above → v - (p - v) = 2v - p.
        // Both simplify to the same formula.
        return `
            if (p.pos.${axis} ${cmp} v) {
                p.pos.${axis} = v + (v - p.pos.${axis});
            }`;
      }
      // bounce: clamp to plane, reflect velocity if heading further wrong.
      return `
            if (p.pos.${axis} ${cmp} v) {
                p.pos.${axis} = v;
                if (p.vel.${axis} ${headingWrong}) {
                    p.vel.${axis} = -p.vel.${axis} * eval_bound(module_params.${restitBound}, p, i);
                }
            }`;
    })();

    return `
{
  let v = eval_bound(module_params.${valueBound}, p, i);
  ${modeBody}
}`;
  };
  return apply;
}

function constraintDistance({ x = 0, y = 0, z = 0, max = 30, mode = 'kill' } = {}) {
  const params = { x, y, z, max, mode };
  const apply = (sys, i) => {
    const cx = evalBoundScalar(params.x, i, sys, null);
    const cy = evalBoundScalar(params.y, i, sys, null);
    const cz = evalBoundScalar(params.z, i, sys, null);
    const m  = evalBoundScalar(params.max, i, sys, null);
    const dx = sys.pos[i*3] - cx, dy = sys.pos[i*3+1] - cy, dz = sys.pos[i*3+2] - cz;
    if (dx*dx + dy*dy + dz*dz <= m*m) return;
    if (params.mode === 'kill') { sys.age[i] = sys.life[i]; return; }
    const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
    sys.pos[i*3]   = cx + dx / r * m;
    sys.pos[i*3+1] = cy + dy / r * m;
    sys.pos[i*3+2] = cz + dz / r * m;
  };
  apply.moduleName = 'constraint.distance';
  apply.kind = 'constraint';
  apply.params = params;
  apply.schema = {
    x:    { type: 'float', min: -50, max: 50, step: 0.1, bindable: true },
    y:    { type: 'float', min: -50, max: 50, step: 0.1, bindable: true },
    z:    { type: 'float', min: -50, max: 50, step: 0.1, bindable: true },
    max:  { type: 'float', min: 0.1, max: 100, step: 0.1, bindable: true },
    mode: { type: 'enum',  options: ['kill', 'clamp'] },
  };
  apply.wgslSnippet = (paramRefs) => {
    const mode = paramRefs.mode || 'kill';
    const xB = paramRefs.x, yB = paramRefs.y, zB = paramRefs.z, mB = paramRefs.max;
    const modeBody = (() => {
      if (mode === 'kill') return `if (d2 > m * m) { p.life = 0.0; }`;
      // clamp
      return `
            if (d2 > m * m) {
                let r = sqrt(d2);
                p.pos = vec3<f32>(cx, cy, cz) + (p.pos - vec3<f32>(cx, cy, cz)) / r * m;
            }`;
    })();
    return `
{
  let cx = eval_bound(module_params.${xB}, p, i);
  let cy = eval_bound(module_params.${yB}, p, i);
  let cz = eval_bound(module_params.${zB}, p, i);
  let m  = eval_bound(module_params.${mB}, p, i);
  let dx = p.pos.x - cx; let dy = p.pos.y - cy; let dz = p.pos.z - cz;
  let d2 = dx*dx + dy*dy + dz*dz;
  ${modeBody}
}`;
  };
  return apply;
}

export const constraint = {
  sphere:   constraintSphere,
  box:      constraintBox,
  plane:    constraintPlane,
  distance: constraintDistance,
};
register({ name: 'constraint.sphere',   category: 'Constraints', factory: () => constraintSphere(),   doc: 'Sphere boundary; kill/bounce/wrap.' });
register({ name: 'constraint.box',      category: 'Constraints', factory: () => constraintBox(),      doc: 'Axis-aligned box boundary.' });
register({ name: 'constraint.plane',    category: 'Constraints', factory: () => constraintPlane(),    doc: 'Single-axis plane (e.g. ground at y=0).' });
register({ name: 'constraint.distance', category: 'Constraints', factory: () => constraintDistance(), doc: 'Maximum distance from a point.' });


// =============================================================================
// audio.* — sugar wrappers for the most common audio bindings.
// =============================================================================

export const audio = {
  beatPulse:    ({ amount = 1.5 } = {}) => mulIntensity({ source: 'audio.beat.flash', scale: amount - 1, offset: 1, normalise: false }),
  bandToSize:   ({ band = 'bass', scale = 1 } = {}) => mulSize({ source: 'audio.bands.' + band, scale: 1 + (scale - 1), offset: 0, normalise: true }),
  rmsToRate:    null,   // editor-only sugar; would need to bind config.rate (not module-level)
};
register({ name: 'audio.beatPulse',  category: 'Audio', factory: () => audio.beatPulse(),  doc: 'Multiplies particle intensity on each beat (decay from beat.flash).' });
register({ name: 'audio.bandToSize', category: 'Audio', factory: () => audio.bandToSize(), doc: 'Multiplies size by an audio band\'s normalised value.' });

// =============================================================================
// Phase A1 — set / mul / add namespaces, binding-aware.
// Application order is enforced by Emitter._applyModules: force → set → mul → add.
// =============================================================================

function _bindParams(bound) {
  // Common shape so the editor can find the bound payload uniformly.
  return { bound };
}

// ----- set.* (replace property) ---------------------------------------------

function setSize(bound) {
  const params = _bindParams(bound);
  const apply = (sys, i) => { sys.size[i] = evalBoundScalar(params.bound, i, sys, null); };
  apply.moduleName = 'set.size';
  apply.kind = 'set';
  apply.params = params;
  apply.schema = { bound: { type: 'curve', bindable: true } };
  apply.wgslSnippet = (paramRefs) => `
{
  p.size = eval_bound(module_params.${paramRefs.bound}, p, i);
}`;
  return apply;
}
function setRotation(bound) {
  const params = _bindParams(bound);
  const apply = (sys, i) => { sys.rot[i] = evalBoundScalar(params.bound, i, sys, null); };
  apply.moduleName = 'set.rotation';
  apply.kind = 'set';
  apply.params = params;
  apply.schema = { bound: { type: 'curve', bindable: true } };
  apply.wgslSnippet = (paramRefs) => `
{
  p.rot = eval_bound(module_params.${paramRefs.bound}, p, i);
}`;
  return apply;
}
function setRotationVel(bound) {
  const params = _bindParams(bound);
  const apply = (sys, i) => { sys.avel[i] = evalBoundScalar(params.bound, i, sys, null); };
  apply.moduleName = 'set.rotationVel';
  apply.kind = 'set';
  apply.params = params;
  apply.schema = { bound: { type: 'curve', bindable: true } };
  apply.wgslSnippet = (paramRefs) => `
{
  p.avel = eval_bound(module_params.${paramRefs.bound}, p, i);
}`;
  return apply;
}
function setColor(bound) {
  const params = _bindParams(bound);
  const apply = (sys, i) => {
    evalBoundColor(params.bound, i, sys, _tmpRGBA);
    sys.color[i*4]     = _tmpRGBA[0];
    sys.color[i*4 + 1] = _tmpRGBA[1];
    sys.color[i*4 + 2] = _tmpRGBA[2];
    sys.color[i*4 + 3] = _tmpRGBA[3];
  };
  apply.moduleName = 'set.color';
  apply.kind = 'set';
  apply.params = params;
  apply.schema = { bound: { type: 'gradient' } };
  apply.wgslSnippet = (paramRefs) => `
{
  p.color = eval_bound_color(module_params.${paramRefs.bound}, p, i);
}`;
  return apply;
}
function setAlpha(bound) {
  const params = _bindParams(bound);
  const apply = (sys, i) => { sys.color[i*4 + 3] = evalBoundScalar(params.bound, i, sys, null); };
  apply.moduleName = 'set.alpha';
  apply.kind = 'set';
  apply.params = params;
  apply.schema = { bound: { type: 'curve', bindable: true } };
  apply.wgslSnippet = (paramRefs) => `
{
  p.color.a = eval_bound(module_params.${paramRefs.bound}, p, i);
}`;
  return apply;
}

export const set = { size: setSize, rotation: setRotation, rotationVel: setRotationVel, color: setColor, alpha: setAlpha };

register({ name: 'set.size',        category: 'Set', factory: () => setSize(new Curve([[0, 0], [0.2, 1], [1, 0]])),
  doc: 'Replace particle size each frame from a Curve or source.' });
register({ name: 'set.color',       category: 'Set', factory: () => setColor(new Gradient([[0, [1,1,1,1]], [1, [1,0.5,0.1,0]]])),
  doc: 'Replace particle colour from a Gradient or source.' });
register({ name: 'set.alpha',       category: 'Set', factory: () => setAlpha(new Curve([[0, 1], [1, 0]])),
  doc: 'Replace particle alpha each frame.' });
register({ name: 'set.rotation',    category: 'Set', factory: () => setRotation(new Curve([[0, 0], [1, 6.28]])),
  doc: 'Replace particle rotation each frame.' });
register({ name: 'set.rotationVel', category: 'Set', factory: () => setRotationVel(new Curve([[0, 0], [1, 6.28]])),
  doc: 'Replace particle angular velocity each frame.' });

// ----- mul.* (multiply property) --------------------------------------------

function mulSize(bound) {
  const params = _bindParams(bound);
  const apply = (sys, i) => { sys.size[i] *= evalBoundScalar(params.bound, i, sys, null); };
  apply.moduleName = 'mul.size';
  apply.kind = 'mul';
  apply.params = params;
  apply.schema = { bound: { type: 'curve', bindable: true } };
  apply.wgslSnippet = (paramRefs) => `
{
  p.size = p.size * eval_bound(module_params.${paramRefs.bound}, p, i);
}`;
  return apply;
}
function mulIntensity(bound) {
  // Scales rgb (not alpha). Useful for HDR amplification on a beat etc.
  const params = _bindParams(bound);
  const apply = (sys, i) => {
    const m = evalBoundScalar(params.bound, i, sys, null);
    sys.color[i*4]     *= m;
    sys.color[i*4 + 1] *= m;
    sys.color[i*4 + 2] *= m;
  };
  apply.moduleName = 'mul.intensity';
  apply.kind = 'mul';
  apply.params = params;
  apply.schema = { bound: { type: 'curve', bindable: true } };
  apply.wgslSnippet = (paramRefs) => `
{
  let m = eval_bound(module_params.${paramRefs.bound}, p, i);
  p.color = vec4<f32>(p.color.rgb * m, p.color.a);
}`;
  return apply;
}
function mulAlpha(bound) {
  const params = _bindParams(bound);
  const apply = (sys, i) => { sys.color[i*4 + 3] *= evalBoundScalar(params.bound, i, sys, null); };
  apply.moduleName = 'mul.alpha';
  apply.kind = 'mul';
  apply.params = params;
  apply.schema = { bound: { type: 'curve', bindable: true } };
  apply.wgslSnippet = (paramRefs) => `
{
  p.color.a = p.color.a * eval_bound(module_params.${paramRefs.bound}, p, i);
}`;
  return apply;
}

export const mul = { size: mulSize, intensity: mulIntensity, alpha: mulAlpha };

register({ name: 'mul.size',      category: 'Mul', factory: () => mulSize(new Curve([[0, 1], [1, 0]])),
  doc: 'Multiply particle size — composes with previous set.size.' });
register({ name: 'mul.intensity', category: 'Mul', factory: () => mulIntensity(new Curve([[0, 1], [1, 1]])),
  doc: 'Multiply particle RGB (HDR amplifier — no-op at 1).' });
register({ name: 'mul.alpha',     category: 'Mul', factory: () => mulAlpha(new Curve([[0, 1], [1, 0]])),
  doc: 'Multiply particle alpha.' });

// ----- add.* (add to property) ----------------------------------------------

function addSize(bound) {
  const params = _bindParams(bound);
  const apply = (sys, i) => { sys.size[i] += evalBoundScalar(params.bound, i, sys, null); };
  apply.moduleName = 'add.size';
  apply.kind = 'add';
  apply.params = params;
  apply.schema = { bound: { type: 'curve', bindable: true } };
  apply.wgslSnippet = (paramRefs) => `
{
  p.size = p.size + eval_bound(module_params.${paramRefs.bound}, p, i);
}`;
  return apply;
}
function addRotation(bound) {
  const params = _bindParams(bound);
  const apply = (sys, i) => { sys.rot[i] += evalBoundScalar(params.bound, i, sys, null); };
  apply.moduleName = 'add.rotation';
  apply.kind = 'add';
  apply.params = params;
  apply.schema = { bound: { type: 'curve', bindable: true } };
  apply.wgslSnippet = (paramRefs) => `
{
  p.rot = p.rot + eval_bound(module_params.${paramRefs.bound}, p, i);
}`;
  return apply;
}

export const add = { size: addSize, rotation: addRotation };

register({ name: 'add.size',     category: 'Add', factory: () => addSize(0.0), doc: 'Add to particle size each frame.' });
register({ name: 'add.rotation', category: 'Add', factory: () => addRotation(0.0), doc: 'Add to particle rotation (alternative to angularVelocity).' });

// =============================================================================
// `force.*` namespace — group existing forces under their category for the
// new naming convention. Same factory functions, just re-exported.
// =============================================================================
export const force = {
  gravity,
  drag,
  attract: attractor,    // friendlier name
  attractor,             // keep old name too
  curl: curlNoise,       // friendlier name
  curlNoise,
  swirlY: velocityOverLifetime,  // the swirl part of velocityOverLifetime
  wind,
  vortex,
  spring,
};

// =============================================================================
// Aliases — old API names preserved as redirects to the new bindings-based ones.
// Existing presets keep working until phase E removes them.
// =============================================================================

// `colorOverLifetime(gradient)` → `set.color(gradient)` (Gradient is a 'life'-source shorthand)
const _origColorOverLifetime = colorOverLifetime;
const _origSizeOverLifetime  = sizeOverLifetime;
const _origRotationOverLifetime = rotationOverLifetime;

// Re-export the originals; they continue to use the simple closure pattern.
// New code should use set.color/set.size/set.rotationVel instead.
export {
  _origColorOverLifetime    as _alias_colorOverLifetime,
  _origSizeOverLifetime     as _alias_sizeOverLifetime,
  _origRotationOverLifetime as _alias_rotationOverLifetime,
};

// ───────────────────────── portfolio addition: sdfAttract ─────────────────────────
// Per-particle attraction toward the zero-isoline of a baked SDF texture.
// Mirrors webgpu/shaders/sdf_attract.wgsl — keep both files in sync.
// The system must be created with `updateSdfTexture(...)` + `updateSdfUniforms(...)`
// for this to do anything; without those, the null texture (neutral midpoint = 0
// distance everywhere) is sampled and the force is zero.
export function sdfAttract({
  strength = 200,
  insideRepel = 30,
  wander = 8,
  channel = 0,         // 0 = sample R, 1 = sample G
  centerX = 0,         // px in canvas-space — long-distance pull target
  centerY = 0,
  farPull = 30,        // strength of the constant center-pull when far-field
  boundsX = 0,         // word bounding-box top-left (canvas px) — per-particle target XY span
  boundsY = 0,
  boundsW = 0,
  boundsH = 0,
  spread = 0,          // lateral spring strength toward the per-particle target XY
  expCoef = 0.0022,    // exponential growth rate of far-pull w.r.t. distance
  expCap  = 8,         // cap on the exponential multiplier (prevents runaway)
  flow    = 0,         // tangential drift along the silhouette — keeps settled particles moving
  speedJitter = 0,     // 0..1 — per-particle speed multiplier amplitude (0 = uniform, 1 = 0.5x..1.5x)
} = {}) {
  const params = { strength, insideRepel, wander, channel, centerX, centerY, farPull,
                   boundsX, boundsY, boundsW, boundsH, spread, expCoef, expCap,
                   flow, speedJitter };
  const apply = (sys, i, dt) => {
    // CPU/WebGL2 fallback not used in the portfolio; no-op.
  };
  apply.moduleName = 'sdfAttract';
  apply.kind = 'force';
  apply.forceMode = 'add';
  apply.params = params;
  apply.schema = {
    strength:    { type: 'float', min: 0,   max: 1000, step: 1,   bindable: true },
    insideRepel: { type: 'float', min: 0,   max: 200,  step: 1,   bindable: true },
    wander:      { type: 'float', min: 0,   max: 50,   step: 0.5, bindable: true },
    channel:     { type: 'float', min: 0,   max: 1,    step: 1,   bindable: true },
    centerX:     { type: 'float', min: -4096, max: 4096, step: 1, bindable: true },
    centerY:     { type: 'float', min: -4096, max: 4096, step: 1, bindable: true },
    farPull:     { type: 'float', min: 0,   max: 500,  step: 1,   bindable: true },
    boundsX:     { type: 'float', min: -4096, max: 4096, step: 1, bindable: true },
    boundsY:     { type: 'float', min: -4096, max: 4096, step: 1, bindable: true },
    boundsW:     { type: 'float', min: 0,   max: 4096, step: 1,   bindable: true },
    boundsH:     { type: 'float', min: 0,   max: 4096, step: 1,   bindable: true },
    spread:      { type: 'float', min: 0,   max: 500,  step: 1,   bindable: true },
    expCoef:     { type: 'float', min: 0,   max: 0.02, step: 0.0001, bindable: true },
    expCap:      { type: 'float', min: 1,   max: 50,   step: 0.5, bindable: true },
    flow:        { type: 'float', min: 0,   max: 500,  step: 1,   bindable: true },
    speedJitter: { type: 'float', min: 0,   max: 1,    step: 0.01, bindable: true },
  };
  // Per-particle target-depth attraction: each particle picks a deterministic
  // pseudo-random target distance from the silhouette and converges to THAT
  // distance, not to d=0. The hash spreads target depths across the stroke
  // body, so the swarm fills the letters instead of stacking on the outline.
  //
  // Tuning intent: most particles target a few px INSIDE the silhouette (so
  // the letter looks solid); a small minority target just OUTSIDE (light
  // "halo" around the letter). The `inside_repel` param caps how deep the
  // band can go — below that, anti-collapse pushes particles back out.
  apply.wgslSnippet = (paramRefs) => `
{
  let xy = vec2<f32>(p.pos.x, p.pos.y);
  let strength     = eval_bound(module_params.${paramRefs.strength}, p, i);
  let inside_repel = eval_bound(module_params.${paramRefs.insideRepel}, p, i);
  let wander       = eval_bound(module_params.${paramRefs.wander}, p, i);
  let channel      = eval_bound(module_params.${paramRefs.channel}, p, i);
  let center_x     = eval_bound(module_params.${paramRefs.centerX}, p, i);
  let center_y     = eval_bound(module_params.${paramRefs.centerY}, p, i);
  let far_pull     = eval_bound(module_params.${paramRefs.farPull}, p, i);
  let bounds_x     = eval_bound(module_params.${paramRefs.boundsX}, p, i);
  let bounds_y     = eval_bound(module_params.${paramRefs.boundsY}, p, i);
  let bounds_w     = eval_bound(module_params.${paramRefs.boundsW}, p, i);
  let bounds_h     = eval_bound(module_params.${paramRefs.boundsH}, p, i);
  let spread       = eval_bound(module_params.${paramRefs.spread}, p, i);
  let exp_coef     = eval_bound(module_params.${paramRefs.expCoef}, p, i);
  let exp_cap      = eval_bound(module_params.${paramRefs.expCap}, p, i);
  let flow         = eval_bound(module_params.${paramRefs.flow}, p, i);
  let speed_jitter = eval_bound(module_params.${paramRefs.speedJitter}, p, i);

  // Per-particle speed multiplier (deterministic R2 hash) — every particle
  // has its own pace, so the swarm doesn't move as a monolith. With
  // speed_jitter=1, factors span 0.5x .. 1.5x; with 0, all uniform.
  let h_speed = fract(f32(i) * 0.32471795724474602 + 0.41421356237);
  let speed_mult = 1.0 + speed_jitter * (h_speed - 0.5);

  // Sample THIS emitter's channel of the packed RG SDF.
  let d  = sample_sdf_ch(xy, channel);
  let dx = sample_sdf_ch(xy + vec2<f32>(1.0, 0.0), channel) - sample_sdf_ch(xy - vec2<f32>(1.0, 0.0), channel);
  let dy = sample_sdf_ch(xy + vec2<f32>(0.0, 1.0), channel) - sample_sdf_ch(xy - vec2<f32>(0.0, 1.0), channel);
  let grad = vec2<f32>(dx, dy) * 0.5;
  let grad_len = length(grad);
  let dir_outward = select(vec2<f32>(0.0, 0.0), grad / max(grad_len, 0.0001), grad_len > 0.0001);

  // -------- Far-field center pull (exponential in distance) --------
  // When the gradient is near-zero (particle is outside the SDF's effective
  // range — the texture clamps to a constant value out there), no useful
  // direction can be derived from the SDF. Pull such particles toward the
  // word's centre so they enter the SDF's gradient zone. Force grows
  // exponentially with distance so distant particles converge fast; near
  // particles aren't yanked. Capped to prevent runaway.
  let to_center = vec2<f32>(center_x, center_y) - xy;
  let to_center_len = max(length(to_center), 0.0001);
  let to_center_dir = to_center / to_center_len;
  // Blend: far-pull weight is 1.0 when grad ≈ 0 (out of range) and ≈ 0 when
  // close enough to use SDF gradient.
  let far_w = 1.0 - smoothstep(0.001, 0.05, grad_len);
  // Exponential growth in distance — close-in particles get ~1×, distant get ~cap×.
  // Capped to prevent runaway acceleration at canvas-corner spawns.
  let exp_factor = min(exp(to_center_len * exp_coef), exp_cap);
  accel.x = accel.x + to_center_dir.x * far_pull * far_w * exp_factor;
  accel.y = accel.y + to_center_dir.y * far_pull * far_w * exp_factor;

  // -------- Per-particle target XY, projected onto the silhouette --------
  // Each particle gets a deterministic (x, y) target via the R2 plastic-number
  // quasi-random sequence (low-discrepancy — no clumping like sin-hash gives).
  // Raw R2 targets are uniform across the bbox rectangle, but most of the bbox
  // is white space between strokes. We project the target onto the nearest
  // silhouette using the local SDF gradient: target_xy → target_xy - grad * d
  // walks the point to the d=0 isoline, then biases slightly inside by 2px so
  // particles settle on the visible stroke. Targets in the SDF "dead zone"
  // (clamped, no gradient) drop their spring force via the target_valid weight.
  let fi = f32(i);
  let h_tx = fract(fi * 0.7548776662466927);   // 1 / phi2
  let h_ty = fract(fi * 0.5698402909980532);   // 1 / phi2^2
  let target_raw = vec2<f32>(bounds_x + h_tx * bounds_w, bounds_y + h_ty * bounds_h);
  // SDF probe at the raw target — 4 extra samples per particle per frame.
  let td  = sample_sdf_ch(target_raw, channel);
  let tdx = sample_sdf_ch(target_raw + vec2<f32>(2.0, 0.0), channel) - sample_sdf_ch(target_raw - vec2<f32>(2.0, 0.0), channel);
  let tdy = sample_sdf_ch(target_raw + vec2<f32>(0.0, 2.0), channel) - sample_sdf_ch(target_raw - vec2<f32>(0.0, 2.0), channel);
  let tgrad = vec2<f32>(tdx, tdy) * 0.25;
  let tgrad_len = length(tgrad);
  let tgrad_dir = select(vec2<f32>(0.0, 0.0), tgrad / max(tgrad_len, 0.0001), tgrad_len > 0.0001);
  // Project onto silhouette + bias 2px inside. tgrad_dir points OUTWARD, so
  // walking BACKWARDS by td moves toward d=0, then further to -2 goes inside.
  let target_xy = target_raw - tgrad_dir * (td + 2.0);
  // Validity: only apply the spring if the raw target was inside the SDF's
  // gradient zone — otherwise the projection is meaningless.
  let target_valid = smoothstep(0.001, 0.05, tgrad_len);
  let to_target = target_xy - xy;
  let to_target_len = length(to_target);
  let to_target_dir = select(vec2<f32>(0.0, 0.0), to_target / max(to_target_len, 0.0001), to_target_len > 0.001);
  let spread_mag = spread * tanh(to_target_len * 0.02) * target_valid;
  accel.x = accel.x + to_target_dir.x * spread_mag;
  accel.y = accel.y + to_target_dir.y * spread_mag;

  // -------- SDF gradient attraction (per-particle target depth) --------
  // ~80% target a narrow band JUST inside the silhouette (where the gradient
  // is sharp and well-defined), ~20% target a thin halo outside. Targeting
  // deeper than ~-6 hits the medial axis where the gradient collapses and
  // particles stagnate.
  let h_target = fract(sin(f32(i) * 17.913 + 3.4) * 43758.5453);
  let target_d = select(h_target * 2.5, -6.0 + h_target * 5.0 / 0.80, h_target < 0.80);
  let diff = d - target_d;
  let attract_mag = strength * tanh(abs(diff) * 0.04) * (1.0 - far_w);
  accel.x = accel.x - dir_outward.x * attract_mag * sign(diff);
  accel.y = accel.y - dir_outward.y * attract_mag * sign(diff);

  // Anti-collapse hard floor.
  if (d < -inside_repel) {
    let push = (-d - inside_repel) * 4.0;
    accel.x = accel.x + dir_outward.x * push;
    accel.y = accel.y + dir_outward.y * push;
  }

  // Wander noise — small amplitude for subtle breathing.
  let h  = fract(sin(f32(i) * 12.9898 + u.time * 7.7)  * 43758.5453);
  let h2 = fract(sin(f32(i) * 78.233  + u.time * 11.3) * 43758.5453);
  accel.x = accel.x + (h  - 0.5) * wander;
  accel.y = accel.y + (h2 - 0.5) * wander;

  // -------- Tangential flow along the silhouette --------
  // Once particles settle on the letter, all forces above go to zero and
  // they freeze. The tangential flow keeps them sliding along the outline:
  // tangent is perpendicular to the SDF gradient; per-particle sign + speed
  // give half the swarm a left-flow, half a right-flow, with varied paces.
  // Only active in the silhouette band (|d| < ~10 px) and the SDF zone.
  let tangent = vec2<f32>(-dir_outward.y, dir_outward.x);
  let h_flow = fract(f32(i) * 0.5698402909980532 + 0.13);
  let flow_sign = select(-1.0, 1.0, h_flow < 0.5);
  let in_band = 1.0 - smoothstep(0.0, 10.0, abs(d));
  let flow_mag = flow * flow_sign * in_band * (1.0 - far_w) * (0.4 + h_flow * 1.2);
  accel.x = accel.x + tangent.x * flow_mag;
  accel.y = accel.y + tangent.y * flow_mag;

  // -------- Per-particle speed multiplier --------
  // Scales every force this module contributed this frame. Drag is applied
  // by a separate module and not scaled here — that's intentional so the
  // damping is uniform while the *drive* varies per particle.
  accel.x = accel.x * speed_mult;
  accel.y = accel.y * speed_mult;
}`;
  return apply;
}
register({ name: 'sdfAttract', category: 'Forces', factory: sdfAttract,
  doc: 'Attracts particles toward the zero-isoline of a baked SDF texture (system.updateSdfTexture).' });
