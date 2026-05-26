// interact_sph_density.wgsl — SPH density pass.
// interact_common.wgsl is concatenated above this file at load time.
// Reads the spatial grid, walks the 27 neighbour cells, accumulates the
// Poly6 kernel contribution from every particle within h, and writes the
// result to particles[i].density.

struct SphParams {
  smoothing_radius: f32,
  rest_density:     f32,
  stiffness:        f32,
  viscosity:        f32,
  mass:             f32,
  _pad0:            f32,
  _pad1:            f32,
  _pad2:            f32,
};

@group(3) @binding(0) var<uniform> sp: SphParams;

const PI: f32 = 3.14159265358979323846;

@compute @workgroup_size(256)
fn cs_sph_density(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.max_particles) { return; }
  var p = particles[i];
  if (p.life == 0.0 || p.age >= p.life) { return; }

  let q = (p.pos - g.origin) / g.cell_size;
  let c = vec3<i32>(floor(q));
  let n = i32(g.cells_per_axis);
  if (c.x < 0 || c.y < 0 || c.z < 0 || c.x >= n || c.y >= n || c.z >= n) {
    particles[i].density = 0.0;
    return;
  }

  let h  = sp.smoothing_radius;
  let h2 = h * h;
  let POLY6 = 315.0 / (64.0 * PI * pow(h, 9.0));
  var density: f32 = 0.0;
  for (var dz = -1; dz <= 1; dz = dz + 1) {
    for (var dy = -1; dy <= 1; dy = dy + 1) {
      for (var dx = -1; dx <= 1; dx = dx + 1) {
        let nc = c + vec3<i32>(dx, dy, dz);
        if (nc.x < 0 || nc.y < 0 || nc.z < 0 || nc.x >= n || nc.y >= n || nc.z >= n) { continue; }
        let cell = u32(nc.x + nc.y * n + nc.z * n * n);
        let s = cellStart[cell];
        let e = s + cellCount[cell];
        for (var k = s; k < e; k = k + 1u) {
          let other = particles[partIdx[k]];
          let r_vec = p.pos - other.pos;
          let r2 = dot(r_vec, r_vec);
          if (r2 < h2) {
            let x = h2 - r2;
            density = density + sp.mass * POLY6 * x * x * x;
          }
        }
      }
    }
  }
  particles[i].density = density;
}
