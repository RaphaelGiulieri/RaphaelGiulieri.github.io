// cs_compact_scan_local.wgsl — Pass A of stream compaction.
// Each thread reads one particle's alive flag, performs an inclusive Hillis-
// Steele scan within the 256-thread workgroup, writes its local offset to
// scan_local_offsets[i], and the WG total to partial_sums[wgid.x].
//
// Concatenated above by the compaction pipeline assembler with the Particle
// struct definition.

struct CompactUniforms {
  max_particles: u32,
  high_water:    u32,
  num_workgroups: u32,
  _pad: u32,
}

@group(0) @binding(0) var<storage, read>       particles_in:        array<Particle>;
@group(0) @binding(1) var<storage, read_write> scan_local_offsets:  array<u32>;
@group(0) @binding(2) var<storage, read_write> partial_sums:        array<u32>;
@group(0) @binding(3) var<uniform>             cu:                   CompactUniforms;

const COMPACT_WG: u32 = 256u;
var<workgroup> shared_scan: array<u32, 256>;

@compute @workgroup_size(256)
fn cs_compact_scan_local(@builtin(global_invocation_id) gid: vec3<u32>,
                          @builtin(local_invocation_id) lid: vec3<u32>,
                          @builtin(workgroup_id) wgid: vec3<u32>) {
  let i = gid.x;
  let li = lid.x;

  var alive: u32 = 0u;
  if (i < cu.high_water) {
    let p = particles_in[i];
    if (p.life > 0.0 && p.age < p.life) { alive = 1u; }
  }
  shared_scan[li] = alive;
  workgroupBarrier();

  // Hillis-Steele inclusive scan, 8 steps (log2(256)).
  var off: u32 = 1u;
  loop {
    if (off >= COMPACT_WG) { break; }
    let v = select(0u, shared_scan[li - off], li >= off);
    workgroupBarrier();
    shared_scan[li] = shared_scan[li] + v;
    workgroupBarrier();
    off = off * 2u;
  }

  if (i < cu.high_water) {
    scan_local_offsets[i] = shared_scan[li];
  }
  if (li == COMPACT_WG - 1u) {
    partial_sums[wgid.x] = shared_scan[li];
  }
}
