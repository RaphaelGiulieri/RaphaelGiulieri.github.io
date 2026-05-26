// interact_sph_force.wgsl — SPH force pass (pressure + viscosity).
// interact_common.wgsl is concatenated above this file at load time.
// Reads density written by interact_sph_density, walks 27 neighbour cells,
// accumulates Spiky-gradient pressure force and Visc-Laplacian viscosity
// force, then integrates the total acceleration into particles[i].vel.

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
fn cs_sph_force(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.max_particles) { return; }
  var p = particles[i];
  if (p.life == 0.0 || p.age >= p.life) { return; }
  if (p.density <= 1e-3) { return; }   // density pass produced 0 → skip

  let q = (p.pos - g.origin) / g.cell_size;
  let c = vec3<i32>(floor(q));
  let n = i32(g.cells_per_axis);
  if (c.x < 0 || c.y < 0 || c.z < 0 || c.x >= n || c.y >= n || c.z >= n) { return; }

  let h  = sp.smoothing_radius;
  // Spiky gradient kernel coefficient: -45 / (π h^6)
  let SPIKY    = -45.0 / (PI * pow(h, 6.0));
  // Viscosity Laplacian kernel coefficient: 45 / (π h^6)
  let VISC_LAP =  45.0 / (PI * pow(h, 6.0));

  let press_i = sp.stiffness * (p.density - sp.rest_density);

  var f_press: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
  var f_visc:  vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);

  for (var dz = -1; dz <= 1; dz = dz + 1) {
    for (var dy = -1; dy <= 1; dy = dy + 1) {
      for (var dx = -1; dx <= 1; dx = dx + 1) {
        let nc = c + vec3<i32>(dx, dy, dz);
        if (nc.x < 0 || nc.y < 0 || nc.z < 0 || nc.x >= n || nc.y >= n || nc.z >= n) { continue; }
        let cell = u32(nc.x + nc.y * n + nc.z * n * n);
        let s = cellStart[cell];
        let e = s + cellCount[cell];
        for (var k = s; k < e; k = k + 1u) {
          let other_idx = partIdx[k];
          if (other_idx == i) { continue; }
          let other = particles[other_idx];
          let r_vec = p.pos - other.pos;
          let r2 = dot(r_vec, r_vec);
          if (r2 < h * h && r2 > 1e-8 && other.density > 1e-3) {
            let r = sqrt(r2);
            let press_j = sp.stiffness * (other.density - sp.rest_density);
            // Symmetric pressure: average of the two particle pressures divided
            // by neighbour density (standard SPH pressure force formulation).
            let avg_p   = (press_i + press_j) / (2.0 * other.density);
            let spiky   = SPIKY * (h - r) * (h - r);
            f_press = f_press + (-sp.mass * avg_p * spiky) * (r_vec / r);
            // Viscosity force: Visc-Laplacian ∝ (v_j - v_i)
            let lap = VISC_LAP * (h - r);
            f_visc = f_visc + sp.viscosity * sp.mass / other.density * (other.vel - p.vel) * lap;
          }
        }
      }
    }
  }
  let accel = (f_press + f_visc) / p.density;
  particles[i].vel = p.vel + accel * u.dt;
}
