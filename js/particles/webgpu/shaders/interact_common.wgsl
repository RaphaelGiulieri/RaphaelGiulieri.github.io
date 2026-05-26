// interact_common.wgsl — shared header concatenated above each solver.
// Owns the Particle struct, GridUniforms struct, and grid bind-group
// declarations at @group(2). Solver shaders ADD their own bindings at
// @group(3) for solver params (boids weights / sph constants).

struct Particle {
  pos: vec3<f32>,
  _pad0: f32,
  vel: vec3<f32>,
  density: f32,
  color: vec4<f32>,
  size: f32,
  rot: f32,
  avel: f32,
  age: f32,
  life: f32,
  spawn_idx: f32,
  stable_rand: f32,
  emitter_id: u32,
};

struct SimUniforms {
  view:           mat4x4<f32>,
  proj:           mat4x4<f32>,
  dt:             f32,
  time:           f32,
  pixel_scale:    f32,
  max_particles:  u32,
  this_emitter_id: u32,
  frame_idx:      u32,
  _pad:           vec2<f32>,
};

struct GridUniforms {
  origin:          vec3<f32>,
  cell_size:       f32,
  cells_per_axis:  u32,
  num_cells:       u32,
  alive_count:     u32,
  _pad:            u32,
};

@group(0) @binding(0) var<uniform>                  u:         SimUniforms;
@group(1) @binding(0) var<storage, read_write>      particles: array<Particle>;

@group(2) @binding(0) var<uniform>                  g:         GridUniforms;
@group(2) @binding(1) var<storage, read>            cellIdx:   array<u32>;
@group(2) @binding(2) var<storage, read>            partIdx:   array<u32>;
@group(2) @binding(3) var<storage, read>            cellStart: array<u32>;
@group(2) @binding(4) var<storage, read>            cellCount: array<u32>;

const SENTINEL: u32 = 0xFFFFFFFFu;
