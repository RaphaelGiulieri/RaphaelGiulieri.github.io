// curves.js — Curve (scalar) and Gradient (rgba) over [0,1] with cached LUTs.
// Both pre-bake at construction so the per-particle hot path is one array
// lookup + one lerp (or just a clamp+round, depending on quality preference).

const DEFAULT_SAMPLES = 256;

function findSegment(keys, t) {
  let j = 0;
  while (j < keys.length - 1 && keys[j + 1][0] < t) j++;
  return j;
}

export class Curve {
  // keys: [[t0, v0], [t1, v1], ...] in ascending t order, t in [0,1].
  constructor(keys, samples = DEFAULT_SAMPLES) {
    if (!keys || keys.length === 0) keys = [[0, 0], [1, 0]];
    this.keys = keys.slice();
    this.lut = new Float32Array(samples);
    this._version = 1;
    this._bake(samples);
  }
  // Mutate in place: replace keys, re-bake the LUT, bump version. Use this
  // instead of constructing a fresh Curve when keys change at runtime — keeps
  // the instance identity stable so consumers that key caches by identity
  // (e.g. the WebGPU LUT atlas) can sync via version comparison.
  update(keys) {
    if (!keys || keys.length === 0) keys = [[0, 0], [1, 0]];
    this.keys = keys.slice();
    this._bake(this.lut.length);
    this._version++;
    return this;
  }
  _bake(n) {
    const keys = this.keys;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const j = findSegment(keys, t);
      const k0 = keys[Math.max(0, j)];
      const k1 = keys[Math.min(keys.length - 1, j + 1)];
      if (k0 === k1) { this.lut[i] = k0[1]; continue; }
      const span = (k1[0] - k0[0]) || 1;
      const f = Math.max(0, Math.min(1, (t - k0[0]) / span));
      this.lut[i] = k0[1] + (k1[1] - k0[1]) * f;
    }
  }
  sample(t) {
    const n = this.lut.length;
    if (t <= 0) return this.lut[0];
    if (t >= 1) return this.lut[n - 1];
    const f = t * (n - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(i0 + 1, n - 1);
    const frac = f - i0;
    return this.lut[i0] + (this.lut[i1] - this.lut[i0]) * frac;
  }
  toJSON() { return { keys: this.keys, samples: this.lut.length }; }
}

export class Gradient {
  // keys: [[t0, [r,g,b,a]], [t1, [r,g,b,a]], ...]
  constructor(keys, samples = DEFAULT_SAMPLES) {
    if (!keys || keys.length === 0) keys = [[0, [1,1,1,1]], [1, [1,1,1,1]]];
    this.keys = keys.map(k => [k[0], k[1].slice()]);
    this.lut = new Float32Array(samples * 4);
    this._version = 1;
    this._bake(samples);
  }
  // See Curve.update — mutates in place and bumps _version.
  update(keys) {
    if (!keys || keys.length === 0) keys = [[0, [1,1,1,1]], [1, [1,1,1,1]]];
    this.keys = keys.map(k => [k[0], k[1].slice()]);
    this._bake(this.lut.length / 4);
    this._version++;
    return this;
  }
  _bake(n) {
    const keys = this.keys;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const j = findSegment(keys, t);
      const k0 = keys[Math.max(0, j)];
      const k1 = keys[Math.min(keys.length - 1, j + 1)];
      const off = i * 4;
      if (k0 === k1) {
        for (let c = 0; c < 4; c++) this.lut[off + c] = k0[1][c];
        continue;
      }
      const span = (k1[0] - k0[0]) || 1;
      const f = Math.max(0, Math.min(1, (t - k0[0]) / span));
      for (let c = 0; c < 4; c++) {
        this.lut[off + c] = k0[1][c] + (k1[1][c] - k0[1][c]) * f;
      }
    }
  }
  // Writes 4 components into out (or returns a new array). t clamped to [0,1].
  sample(t, out) {
    const n = this.lut.length / 4;
    let f;
    if (t <= 0) f = 0;
    else if (t >= 1) f = n - 1;
    else f = t * (n - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(i0 + 1, n - 1);
    const frac = f - i0;
    const o0 = i0 * 4, o1 = i1 * 4;
    const r = this.lut[o0]     + (this.lut[o1]     - this.lut[o0])     * frac;
    const g = this.lut[o0 + 1] + (this.lut[o1 + 1] - this.lut[o0 + 1]) * frac;
    const b = this.lut[o0 + 2] + (this.lut[o1 + 2] - this.lut[o0 + 2]) * frac;
    const a = this.lut[o0 + 3] + (this.lut[o1 + 3] - this.lut[o0 + 3]) * frac;
    if (out) { out[0] = r; out[1] = g; out[2] = b; out[3] = a; return out; }
    return [r, g, b, a];
  }
  toJSON() { return { keys: this.keys, samples: this.lut.length / 4 }; }
}
