struct GridUniforms {
  origin:          vec3<f32>,
  cell_size:       f32,
  cells_per_axis:  u32,
  num_cells:       u32,
  alive_count:     u32,
  _pad:            u32,
};

@group(0) @binding(0) var<uniform>             g:           GridUniforms;
@group(0) @binding(1) var<storage, read>       cellIdx:     array<u32>;
@group(0) @binding(2) var<storage, read>       cellStart:   array<u32>;
@group(0) @binding(3) var<storage, read_write> writeOffset: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> partIdx:     array<u32>;

const SENTINEL: u32 = 0xFFFFFFFFu;

@compute @workgroup_size(256)
fn cs_scatter(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= g.alive_count) { return; }
  let cell = cellIdx[i];
  if (cell == SENTINEL) { return; }
  let off = atomicAdd(&writeOffset[cell], 1u);
  partIdx[cellStart[cell] + off] = i;
}
