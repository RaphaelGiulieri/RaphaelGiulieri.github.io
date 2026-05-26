// spawn-descriptor.js — pack an emitter's per-frame spawn intent into the
// 144-byte SpawnDescriptor uniform buffer used by cs_spawn.

export const SHAPE_ID = {
  point:  0,
  sphere: 1,
  cone:   2,
  box:    3,
  ring:   4,
  line:   5,
  disc:   6,
};

export const DIR_MODE = {
  none:    0,
  outward: 1,
  inward:  2,
  fixed:   3,
  cone:    4,
};

export const SPAWN_DESCRIPTOR_BYTES = 144;

// Pack `fields` into the 144B SpawnDescriptor layout starting at byteOffset.
// All ranges are [min, max]; pass [v, v] for scalars.
export function packSpawnDescriptor(buffer, byteOffset, fields) {
  const u = new Uint32Array(buffer, byteOffset, SPAWN_DESCRIPTOR_BYTES / 4);
  const f = new Float32Array(buffer, byteOffset, SPAWN_DESCRIPTOR_BYTES / 4);
  // Header
  u[0] = fields.spawn_count >>> 0;
  u[1] = fields.base_slot >>> 0;
  u[2] = fields.emitter_id >>> 0;
  u[3] = fields.spawn_idx_base >>> 0;
  // Geometry: position vec3 + shape_id u32 (16B aligned)
  f[4] = fields.position[0]; f[5] = fields.position[1]; f[6] = fields.position[2];
  u[7] = fields.shape_id >>> 0;
  f[8]  = fields.shape_params[0]; f[9]  = fields.shape_params[1];
  f[10] = fields.shape_params[2]; f[11] = fields.shape_params[3];
  // Direction-override: u32 mode + 3 u32 pads, then vec3 axis + f32 half_angle
  u[12] = fields.direction_mode >>> 0;
  u[13] = 0; u[14] = 0; u[15] = 0;
  f[16] = fields.direction_axis[0]; f[17] = fields.direction_axis[1]; f[18] = fields.direction_axis[2];
  f[19] = fields.direction_half_angle ?? 0;
  // Ranges
  f[20] = fields.speed[0]; f[21] = fields.speed[1];
  f[22] = fields.life[0];  f[23] = fields.life[1];
  f[24] = fields.size[0];  f[25] = fields.size[1];
  f[26] = fields.rot[0];   f[27] = fields.rot[1];
  f[28] = fields.avel[0];  f[29] = fields.avel[1];
  f[30] = 0; f[31] = 0;
  // Color
  f[32] = fields.color[0]; f[33] = fields.color[1]; f[34] = fields.color[2]; f[35] = fields.color[3];
}
