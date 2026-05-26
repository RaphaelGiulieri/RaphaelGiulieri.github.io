struct GridUniforms {
  origin:          vec3<f32>,
  cell_size:       f32,
  cells_per_axis:  u32,
  num_cells:       u32,
  alive_count:     u32,
  _pad:            u32,
};

@group(0) @binding(0) var<uniform>             g:         GridUniforms;
@group(0) @binding(1) var<storage, read>       cellCount: array<u32>;
@group(0) @binding(2) var<storage, read_write> cellStart: array<u32>;

// Single-thread serial scan. Workgroup size 1, dispatched once.
// 125k iterations × ~few ns each = sub-millisecond at the default grid.
@compute @workgroup_size(1)
fn cs_scan(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x != 0u) { return; }
  var sum: u32 = 0u;
  let n = g.num_cells;
  for (var i: u32 = 0u; i < n; i = i + 1u) {
    cellStart[i] = sum;
    sum = sum + cellCount[i];
  }
}
