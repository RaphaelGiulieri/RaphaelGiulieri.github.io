// cs_compact_scan_global.wgsl — Pass B of stream compaction.
// Single workgroup of 256 threads performs an exclusive scan over partial_sums
// (≤ ceil(maxParticles/256), so for 1M particles that's 3906 partials —
// processed in 16 tiles of 256).
//
// Output: global_offsets[i] = sum of partial_sums[0..i-1].
// Last accumulated total is written to draw_indirect[1] (instance_count) so
// the next render pass uses the post-compaction alive count.

struct CompactUniforms {
  max_particles: u32,
  high_water: u32,
  num_workgroups: u32,
  _pad: u32,
}

@group(0) @binding(0) var<storage, read>       partial_sums:    array<u32>;
@group(0) @binding(1) var<storage, read_write> global_offsets:  array<u32>;
@group(0) @binding(2) var<storage, read_write> draw_indirect:   array<u32, 4>;
@group(0) @binding(3) var<uniform>             cu:               CompactUniforms;

const SCAN_WG: u32 = 256u;
var<workgroup> shared_data: array<u32, 256>;

@compute @workgroup_size(256)
fn cs_compact_scan_global(@builtin(local_invocation_id) lid: vec3<u32>) {
  let li = lid.x;
  let n = cu.num_workgroups;

  var base: u32 = 0u;
  let tiles = (n + SCAN_WG - 1u) / SCAN_WG;
  var tile: u32 = 0u;
  loop {
    if (tile >= tiles) { break; }
    let idx = tile * SCAN_WG + li;
    var v: u32 = 0u;
    if (idx < n) { v = partial_sums[idx]; }
    shared_data[li] = v;
    workgroupBarrier();

    // Inclusive scan within the tile.
    var off: u32 = 1u;
    loop {
      if (off >= SCAN_WG) { break; }
      let pv = select(0u, shared_data[li - off], li >= off);
      workgroupBarrier();
      shared_data[li] = shared_data[li] + pv;
      workgroupBarrier();
      off = off * 2u;
    }

    // exclusive = inclusive - my_value. Final = base + exclusive.
    if (idx < n) { global_offsets[idx] = base + shared_data[li] - v; }

    // Last thread reads the tile total (last inclusive scan value).
    let tile_total = shared_data[SCAN_WG - 1u];
    workgroupBarrier();
    base = base + tile_total;
    tile = tile + 1u;
  }

  // Thread 0 writes the post-compaction alive count to instance_count.
  if (li == 0u) {
    draw_indirect[1] = base;
  }
}
