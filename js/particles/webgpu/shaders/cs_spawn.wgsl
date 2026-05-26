// cs_spawn.wgsl — generates particle initial state from a SpawnDescriptor.
// Dispatched once per emitter per frame: dispatchWorkgroups(ceil(spawn_count/64)).
// Concatenated with spawn_rng.wgsl + sample_shape.wgsl + direction_override.wgsl
// + spawn_descriptor.wgsl by the spawn pipeline assembler.
//
// In standalone test mode, particles_out is bound at @group(0) @binding(0) and
// spawn at @group(0) @binding(1).

struct Particle {
  pos: vec3<f32>,
  _pad0: f32,
  vel: vec3<f32>,
  density: f32,             // was _pad1; SPH pass A writes here, zero for non-SPH
  color: vec4<f32>,
  size: f32,
  rot: f32,
  avel: f32,
  age: f32,
  life: f32,
  spawn_idx: f32,
  stable_rand: f32,
  emitter_id: u32,
}

@group(0) @binding(0) var<storage, read_write> particles_out: array<Particle>;

// Workgroup size 256 (was 64): at 8M+ spawn counts, 64 → 125000+ WGs which
// exceeds maxComputeWorkgroupsPerDimension (65535). 256 → ~31250 WGs.
// No shared memory used here so larger WG is free.
@compute @workgroup_size(256)
fn cs_spawn(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= spawn.spawn_count) { return; }
  let slot = spawn.base_slot + i;
  let spawn_idx = spawn.spawn_idx_base + i;
  var rng_state = rng_seed(spawn.emitter_id, spawn_idx);

  var pos: vec3<f32>;
  var dir: vec3<f32>;
  sample_shape(spawn.shape_id, spawn.shape_params, &rng_state, &pos, &dir);

  if (spawn.direction_mode != 0u) {
    apply_direction_override(spawn.direction_mode, spawn.direction_axis,
                             spawn.direction_half_angle, &rng_state, pos, &dir);
  }

  let speed = mix(spawn.speed.x, spawn.speed.y, rng_next_unit(&rng_state));
  let life  = mix(spawn.life.x,  spawn.life.y,  rng_next_unit(&rng_state));
  let size  = mix(spawn.size.x,  spawn.size.y,  rng_next_unit(&rng_state));
  let rot   = mix(spawn.rot.x,   spawn.rot.y,   rng_next_unit(&rng_state));
  let avel  = mix(spawn.avel.x,  spawn.avel.y,  rng_next_unit(&rng_state));
  let stable_rand = rng_next_unit(&rng_state);

  var p: Particle;
  p.pos = spawn.position + pos;
  p._pad0 = 0.0;
  p.vel = dir * speed;
  p.density = 0.0;
  p.color = spawn.color;
  p.size = size;
  p.rot = rot;
  p.avel = avel;
  p.age = 0.0;
  p.life = life;
  p.spawn_idx = f32(spawn_idx);
  p.stable_rand = stable_rand;
  p.emitter_id = spawn.emitter_id;
  particles_out[slot] = p;
}
