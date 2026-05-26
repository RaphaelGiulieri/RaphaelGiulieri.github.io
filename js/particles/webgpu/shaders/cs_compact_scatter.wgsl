// cs_compact_scatter.wgsl — Pass C of stream compaction.
// For each alive particle, dest = global_offsets[wgid] + scan_local_offsets[i] - 1
// (inclusive scan offsets are 1-based; -1 makes them 0-based dest indices).
// Writes to particles_out tightly packed in [0, alive_count).

struct CompactUniforms {
  max_particles: u32,
  high_water: u32,
  num_workgroups: u32,
  _pad: u32,
}

@group(0) @binding(0) var<storage, read>       particles_in:        array<Particle>;
@group(0) @binding(1) var<storage, read_write> particles_out:       array<Particle>;
@group(0) @binding(2) var<storage, read>       scan_local_offsets:  array<u32>;
@group(0) @binding(3) var<storage, read>       global_offsets:      array<u32>;
@group(0) @binding(4) var<uniform>             cu:                   CompactUniforms;
// Per-emitter alive counter (Phase 2.5 follow-up): each scattered alive
// particle atomicAdds at index = its emitter_id. CPU mirrors via async
// readback every 60 frames so demo.html's countAlive(i) is O(1) instead
// of an O(N) Proxy walk that froze rAF at 1M particles.
@group(0) @binding(5) var<storage, read_write> alive_by_emitter:    array<atomic<u32>>;

@compute @workgroup_size(256)
fn cs_compact_scatter(@builtin(global_invocation_id) gid: vec3<u32>,
                       @builtin(workgroup_id) wgid: vec3<u32>) {
  let i = gid.x;
  if (i >= cu.high_water) { return; }
  let p = particles_in[i];
  if (!(p.life > 0.0 && p.age < p.life)) { return; }
  let local = scan_local_offsets[i];
  let dest = global_offsets[wgid.x] + local - 1u;
  particles_out[dest] = p;
  // Per-emitter alive bookkeeping: bounds-check against array length
  // (set to MAX_EMITTERS at allocation time; defensive against any
  // emitter_id corruption).
  let n = arrayLength(&alive_by_emitter);
  if (p.emitter_id < n) {
    atomicAdd(&alive_by_emitter[p.emitter_id], 1u);
  }
}
