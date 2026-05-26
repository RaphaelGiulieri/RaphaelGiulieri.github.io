// spawn_descriptor.wgsl — per-emitter uniform bound at @group(0) @binding(1)
// when used standalone with cs_spawn (production rebinds via custom layout).
// 144 bytes after WGSL alignment padding. Packed by spawn-descriptor.js.

struct SpawnDescriptor {
  // Header (16B)
  spawn_count:    u32,
  base_slot:      u32,
  emitter_id:     u32,
  spawn_idx_base: u32,
  // Geometry (32B)
  position:       vec3<f32>,
  shape_id:       u32,
  shape_params:   vec4<f32>,
  // Direction override (32B)
  direction_mode: u32,
  _pad0:          u32,
  _pad1:          u32,
  _pad2:          u32,
  direction_axis: vec3<f32>,
  direction_half_angle: f32,
  // Range fields: [min, max] each (32B)
  speed:          vec2<f32>,
  life:           vec2<f32>,
  size:           vec2<f32>,
  rot:            vec2<f32>,
  // Misc (16B)
  avel:           vec2<f32>,
  _pad3:          vec2<f32>,
  // Color (16B)
  color:          vec4<f32>,
}
@group(0) @binding(1) var<uniform> spawn: SpawnDescriptor;
