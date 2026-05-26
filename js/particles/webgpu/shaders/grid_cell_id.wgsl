// grid_cell_id.wgsl — fused cell-id + atomic count pass.
//
// For each alive particle i:
//   1. Compute the 3-D cell coordinate from its position.
//   2. Write the flat cell index into cellIdx[i] (SENTINEL if out-of-bounds or dead).
//   3. Write i itself into partIdx[i] (pre-sorted identity; scatter will reorder).
//   4. Atomic-increment cellCount[cellId] for in-bounds particles.
//
// Particle struct must match update.template.wgsl exactly. Kept in sync
// manually for now; codegen consolidation is a future cleanup.
struct Particle {
  pos:         vec3<f32>,
  _pad0:       f32,
  vel:         vec3<f32>,
  density:     f32,
  color:       vec4<f32>,
  size:        f32,
  rot:         f32,
  avel:        f32,
  age:         f32,
  life:        f32,
  spawn_idx:   f32,
  stable_rand: f32,
  emitter_id:  u32,
};

struct GridUniforms {
  origin:         vec3<f32>,
  cell_size:      f32,
  cells_per_axis: u32,
  num_cells:      u32,
  alive_count:    u32,
  _pad:           u32,
};

@group(0) @binding(0) var<uniform>             g:         GridUniforms;
@group(0) @binding(1) var<storage, read>       particles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> cellIdx:   array<u32>;
@group(0) @binding(3) var<storage, read_write> partIdx:   array<u32>;
@group(0) @binding(4) var<storage, read_write> cellCount: array<atomic<u32>>;

const SENTINEL: u32 = 0xFFFFFFFFu;

@compute @workgroup_size(256)
fn cs_cell_id(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= g.alive_count) { return; }
  partIdx[i] = i;
  let p = particles[i];
  if (p.life == 0.0 || p.age >= p.life) {
    cellIdx[i] = SENTINEL;
    return;
  }
  let q = (p.pos - g.origin) / g.cell_size;
  let c = vec3<i32>(floor(q));
  let n = i32(g.cells_per_axis);
  if (c.x < 0 || c.y < 0 || c.z < 0 || c.x >= n || c.y >= n || c.z >= n) {
    cellIdx[i] = SENTINEL;
    return;
  }
  let id = u32(c.x + c.y * n + c.z * n * n);
  cellIdx[i] = id;
  atomicAdd(&cellCount[id], 1u);
}
