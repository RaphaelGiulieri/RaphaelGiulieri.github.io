// eval_bound.wgsl — Bound struct + scalar/color evaluators.
//
// A Bound is a uniform-buffer-friendly serialization of the JS-side
// `Bound` value (see particles/core/bound.js). The eval_bound /
// eval_bound_color functions dispatch on source_id; per-particle and
// system sources are populated, audio source IDs return 0 (Phase 3 fills).

struct Bound {
    source_id:      u32,    //  0=const, 1..N=per-particle/system, 50..M=audio
    constant_value: f32,
    smooth_factor:  f32,    //  >0 enables smoothing
    multiplier:     f32,
    range_min:      f32,
    range_max:      f32,
    curve_id:       u32,    //  0 = no curve, else 1-based layer in curve LUT
    gradient_id:    u32,    //  0 = no gradient, else 1-based layer in gradient LUT
    flags:          u32,    //  bit 0 = normalise_auto; bits 1-4 = smoothing_slot;
                            //  bit 5 = first_frame; bits 6-7 = reduce_mode
    _pad0:          u32,
    _pad1:          u32,
    _pad2:          u32,
    _pad3:          u32,
    _pad4:          u32,
    _pad5:          u32,
    _pad6:          u32,    // pad to 64 bytes (16 floats total)
}

// Source IDs (must match bound-codegen.js's BOUND_SOURCE_ID table)
const BSRC_CONST:  u32 = 0u;
const BSRC_LIFE:   u32 = 1u;   // age / life ∈ [0,1]
const BSRC_AGE:    u32 = 2u;   // raw age in seconds
const BSRC_SPEED:  u32 = 3u;   // |vel|
const BSRC_POSY:   u32 = 4u;   // pos.y
const BSRC_RADIAL: u32 = 5u;   // |pos|
const BSRC_RANDOM: u32 = 6u;   // stable_rand ∈ [0,1)
const BSRC_TIME:   u32 = 7u;   // u.time
const BSRC_FRAME:  u32 = 8u;   // u.frame_idx as f32
// Audio source IDs (50..) — Phase 3 populates. For now, all return 0.
const BSRC_AUDIO_BASE: u32 = 50u;

// Audio source values, indexed by (source_id - BSRC_AUDIO_BASE). 128 slots
// packed as 32 vec4s for WGSL uniform alignment. Zero-filled when no
// AudioFeed is attached.
@group(0) @binding(1) var<uniform> audio_uniforms: array<vec4<f32>, 32>;

fn raw_source_value(b: Bound, p: Particle) -> f32 {
    switch (b.source_id) {
        case 0u:  { return b.constant_value; }
        case 1u:  { return select(0.0, p.age / p.life, p.life > 0.0); }
        case 2u:  { return p.age; }
        case 3u:  { return length(p.vel); }
        case 4u:  { return p.pos.y; }
        case 5u:  { return length(p.pos); }
        case 6u:  { return p.stable_rand; }
        case 7u:  { return u.time; }
        case 8u:  { return f32(u.frame_idx); }
        default:  {
            if (b.source_id < BSRC_AUDIO_BASE) { return 0.0; }
            let slot = b.source_id - BSRC_AUDIO_BASE;
            if (slot >= 128u) { return 0.0; }
            let vec_idx = slot / 4u;
            let comp_idx = slot % 4u;
            return audio_uniforms[vec_idx][comp_idx];
        }
    }
}

// Apply normalise + range remap. flags bit 0 = normalise_auto.
fn apply_normalise(raw: f32, b: Bound) -> f32 {
    if ((b.flags & 1u) == 0u) { return raw; }   // normalise disabled
    let span = b.range_max - b.range_min;
    if (span == 0.0) { return 0.0; }
    return (raw - b.range_min) / span;
}

// Smoothing state buffers — per-particle, per-Bound slot. 16 slots × f32
// per particle (matches 4-bit smoothing_slot field). firstFrame_state is a
// u32 bitfield per particle; bit k = "slot k has been seeded with raw on this particle".
@group(1) @binding(2) var<storage, read_write> smoothing_state:  array<f32>;
@group(1) @binding(3) var<storage, read_write> firstFrame_state: array<u32>;

// Curve / gradient LUTs at group(2) bindings 1-3.
@group(2) @binding(1) var curve_lut:    texture_2d_array<f32>;
@group(2) @binding(2) var lut_sampler:  sampler;
@group(2) @binding(3) var gradient_lut: texture_2d_array<f32>;

fn apply_curve(value: f32, curve_id: u32) -> f32 {
    if (curve_id == 0u) { return value; }
    let t = clamp(value, 0.0, 1.0);
    // r32float curves are unfilterable; we point-sample. Linear interpolation
    // between adjacent taps is done in WGSL.
    let f = t * 255.0;
    let i0 = u32(floor(f));
    let i1 = min(i0 + 1u, 255u);
    let frac = f - f32(i0);
    let layer = i32(curve_id) - 1;
    let v0 = textureLoad(curve_lut, vec2<i32>(i32(i0), 0), layer, 0).r;
    let v1 = textureLoad(curve_lut, vec2<i32>(i32(i1), 0), layer, 0).r;
    return mix(v0, v1, frac);
}

fn eval_bound(b: Bound, p: Particle, i: u32) -> f32 {
    let raw = raw_source_value(b, p);
    var v = apply_normalise(raw, b);
    v = apply_curve(v, b.curve_id);
    v = v * b.multiplier;
    if (b.smooth_factor > 0.0) {
        let slot = (b.flags >> 1u) & 0xFu;
        let buf_idx = i * 16u + slot;
        let mask = 1u << slot;
        let first = (firstFrame_state[i] & mask) == 0u;
        var v_smooth: f32;
        if (first) {
            v_smooth = v;
            firstFrame_state[i] = firstFrame_state[i] | mask;
        } else {
            let alpha = 1.0 - exp(-u.dt / b.smooth_factor);
            v_smooth = smoothing_state[buf_idx] + (v - smoothing_state[buf_idx]) * alpha;
        }
        smoothing_state[buf_idx] = v_smooth;
        v = v_smooth;
    }
    return v;
}

fn eval_bound_color(b: Bound, p: Particle, i: u32) -> vec4<f32> {
    if (b.gradient_id == 0u) {
        // Constant rgba — packed in (constant_value, multiplier, range_min, range_max).
        return vec4<f32>(b.constant_value, b.multiplier, b.range_min, b.range_max);
    }
    let raw = raw_source_value(b, p);
    let t = clamp(apply_normalise(raw, b), 0.0, 1.0);
    let uv = vec2<f32>(t, 0.5);
    let layer = i32(b.gradient_id) - 1;
    return textureSampleLevel(gradient_lut, lut_sampler, uv, layer, 0.0);
}
