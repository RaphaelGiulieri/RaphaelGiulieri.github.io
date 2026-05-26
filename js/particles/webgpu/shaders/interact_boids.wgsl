// interact_common.wgsl is concatenated ABOVE this file at fetch time.
// Particle, SimUniforms, GridUniforms + bindings @group(0..2) are in scope.

struct BoidsParams {
  sep_radius:    f32,
  sep_weight:    f32,
  align_weight:  f32,
  coh_weight:    f32,
  max_accel:     f32,
  max_speed:     f32,
  _pad0:         f32,
  _pad1:         f32,
};

@group(3) @binding(0) var<uniform> bp: BoidsParams;

@compute @workgroup_size(256)
fn cs_boids(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.max_particles) { return; }
  var p = particles[i];
  if (p.life == 0.0 || p.age >= p.life) { return; }

  // self_cell may be SENTINEL (out of bounds). Solvers no-op those.
  let q = (p.pos - g.origin) / g.cell_size;
  let c = vec3<i32>(floor(q));
  let n = i32(g.cells_per_axis);
  if (c.x < 0 || c.y < 0 || c.z < 0 || c.x >= n || c.y >= n || c.z >= n) { return; }

  var sep_force: vec3<f32> = vec3<f32>(0.0);
  var vel_sum:   vec3<f32> = vec3<f32>(0.0);
  var pos_sum:   vec3<f32> = vec3<f32>(0.0);
  var count:     u32       = 0u;

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
          let r_vec = other.pos - p.pos;
          let d2 = dot(r_vec, r_vec);
          if (d2 > g.cell_size * g.cell_size) { continue; }
          if (d2 > 1e-8 && d2 < bp.sep_radius * bp.sep_radius) {
            // separation: push away inversely with distance squared
            sep_force = sep_force - r_vec / d2;
          }
          vel_sum = vel_sum + other.vel;
          pos_sum = pos_sum + other.pos;
          count   = count + 1u;
        }
      }
    }
  }

  if (count == 0u) {
    particles[i].vel = p.vel;   // unchanged
    return;
  }
  let inv = 1.0 / f32(count);
  let mean_vel = vel_sum * inv;
  let mean_pos = pos_sum * inv;
  var accel: vec3<f32>
    = sep_force * bp.sep_weight
    + (mean_vel - p.vel)  * bp.align_weight
    + (mean_pos - p.pos)  * bp.coh_weight;
  let a_len = length(accel);
  if (a_len > bp.max_accel) { accel = accel * (bp.max_accel / a_len); }
  var new_vel = p.vel + accel * u.dt;
  let v_len = length(new_vel);
  if (v_len > bp.max_speed) { new_vel = new_vel * (bp.max_speed / v_len); }
  particles[i].vel = new_vel;
}
