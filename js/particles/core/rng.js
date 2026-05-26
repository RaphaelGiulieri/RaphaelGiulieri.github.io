// rng.js — seedable PRNG (Mulberry32). Every random call in the particle
// system goes through an instance of this, NEVER through Math.random().
// This is what makes determinism possible — given the same seed, the same
// sequence of float() / int() / unit() calls returns byte-identical values.

export class RNG {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this._state = this.seed || 1;
  }

  setSeed(seed) {
    this.seed = seed >>> 0;
    this._state = this.seed || 1;
  }

  // Mulberry32: small, fast, good enough for particle jitter.
  // Returns a float in [0, 1).
  next() {
    let z = (this._state += 0x6D2B79F5) | 0;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }

  // Float in [min, max).
  float(min, max) {
    return min + (max - min) * this.next();
  }

  // Integer in [min, max] inclusive.
  int(min, max) {
    return Math.floor(min + (max - min + 1) * this.next());
  }

  // Sample a {min, max} range object, or return scalar v unchanged.
  range(v) {
    if (v && typeof v === 'object' && 'min' in v && 'max' in v) {
      return this.float(v.min, v.max);
    }
    return v;
  }

  // Uniform direction on the unit sphere (Marsaglia 1972).
  unit(out = [0, 0, 0]) {
    let x, y, s;
    do {
      x = this.next() * 2 - 1;
      y = this.next() * 2 - 1;
      s = x * x + y * y;
    } while (s >= 1 || s === 0);
    const f = 2 * Math.sqrt(1 - s);
    out[0] = x * f;
    out[1] = y * f;
    out[2] = 1 - 2 * s;
    return out;
  }

  // Uniform point inside the unit ball, volume-correct.
  insideBall(out = [0, 0, 0]) {
    this.unit(out);
    const r = Math.cbrt(this.next());
    out[0] *= r; out[1] *= r; out[2] *= r;
    return out;
  }

  // Uniform point on the unit disc (XY plane), area-correct.
  insideDisc(out = [0, 0]) {
    const r = Math.sqrt(this.next());
    const a = this.next() * Math.PI * 2;
    out[0] = r * Math.cos(a);
    out[1] = r * Math.sin(a);
    return out;
  }
}
