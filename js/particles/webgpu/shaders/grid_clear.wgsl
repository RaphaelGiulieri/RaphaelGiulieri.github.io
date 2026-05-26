struct GridUniforms {
  origin:          vec3<f32>,
  cell_size:       f32,
  cells_per_axis:  u32,
  num_cells:       u32,
  alive_count:     u32,
  _pad:            u32,
};

@group(0) @binding(0) var<uniform>             g:           GridUniforms;
@group(0) @binding(1) var<storage, read_write> cellCount:   array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> cellStart:   array<u32>;
@group(0) @binding(3) var<storage, read_write> writeOffset: array<atomic<u32>>;

@compute @workgroup_size(256)
fn cs_clear(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= g.num_cells) { return; }
  atomicStore(&cellCount[i],   0u);
  cellStart[i] = 0u;
  atomicStore(&writeOffset[i], 0u);
}
