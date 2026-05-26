// math.js — minimal vec3 / mat4 helpers. Ported (lean) from
// RaphaelGiulieri.github.io/demos/curl-noise-particles.html lines 288-324.
// Right-handed, Y-up, column-major mat4 stored as Float32Array(16).

export function mat4Identity(out = new Float32Array(16)) {
  out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1;
  return out;
}

export function mat4Perspective(fovy, aspect, near, far, out = new Float32Array(16)) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function mat4Ortho(left, right, bottom, top, near, far, out = new Float32Array(16)) {
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = -2 * lr;
  out[5] = -2 * bt;
  out[10] = 2 * nf;
  out[12] = (left + right) * lr;
  out[13] = (top + bottom) * bt;
  out[14] = (far + near) * nf;
  out[15] = 1;
  return out;
}

export function mat4LookAt(eye, target, up, out = new Float32Array(16)) {
  const z0 = eye[0] - target[0], z1 = eye[1] - target[1], z2 = eye[2] - target[2];
  let zl = Math.hypot(z0, z1, z2) || 1;
  const zx = z0 / zl, zy = z1 / zl, zz = z2 / zl;
  const x0 = up[1] * zz - up[2] * zy;
  const x1 = up[2] * zx - up[0] * zz;
  const x2 = up[0] * zy - up[1] * zx;
  let xl = Math.hypot(x0, x1, x2) || 1;
  const xx = x0 / xl, xy = x1 / xl, xz = x2 / xl;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

export function mat4Multiply(a, b, out = new Float32Array(16)) {
  for (let i = 0; i < 4; i++) {
    const bi0 = b[i * 4], bi1 = b[i * 4 + 1], bi2 = b[i * 4 + 2], bi3 = b[i * 4 + 3];
    out[i * 4]     = a[0] * bi0 + a[4] * bi1 + a[8]  * bi2 + a[12] * bi3;
    out[i * 4 + 1] = a[1] * bi0 + a[5] * bi1 + a[9]  * bi2 + a[13] * bi3;
    out[i * 4 + 2] = a[2] * bi0 + a[6] * bi1 + a[10] * bi2 + a[14] * bi3;
    out[i * 4 + 3] = a[3] * bi0 + a[7] * bi1 + a[11] * bi2 + a[15] * bi3;
  }
  return out;
}

// vec3 helpers — operate in place on plain arrays / Float32Array views.

export function v3Set(o, x, y, z) { o[0] = x; o[1] = y; o[2] = z; return o; }
export function v3Copy(o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; }
export function v3Add(o, a, b) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; }
export function v3Sub(o, a, b) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; }
export function v3Scale(o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; }
export function v3Dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function v3Length(a) { return Math.hypot(a[0], a[1], a[2]); }
export function v3Normalize(o, a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l;
  return o;
}
export function v3Cross(o, a, b) {
  const ax = a[0], ay = a[1], az = a[2];
  const bx = b[0], by = b[1], bz = b[2];
  o[0] = ay * bz - az * by;
  o[1] = az * bx - ax * bz;
  o[2] = ax * by - ay * bx;
  return o;
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export const TAU = Math.PI * 2;
