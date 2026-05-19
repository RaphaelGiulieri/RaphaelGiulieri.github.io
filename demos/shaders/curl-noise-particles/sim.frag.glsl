#version 300 es
precision highp float;
in vec2 v_uv;
layout(location = 0) out vec4 outPos;
layout(location = 1) out vec4 outVel;

uniform sampler2D u_position;
uniform sampler2D u_velocity;
uniform float u_time;
uniform float u_dt;
uniform int   u_mode;
uniform float u_damping;
// Galaxy params
uniform float u_g_omega;
uniform float u_g_kr;
uniform float u_g_ky;
// Lorenz params
uniform float u_l_scale;
uniform float u_l_offset;
uniform float u_l_speed;
// Vortex params
uniform float u_v_speed;
uniform float u_v_pos;
uniform float u_v_ydamp;
// Curl params
uniform float u_c_freq;
uniform float u_c_amp;
uniform float u_c_tspeed;
// Containment
uniform float u_bound_r;
uniform float u_bound_k;
// Viscosity (how fast stored velocity tracks the field's target velocity)
uniform float u_field_speed;
// Debug
uniform int   u_debugForceZeroVel;

//#include noise.glsl

// Galaxy: rigid-body rotation around Y + linear inward pull + y-damping.
// Linear in position → mathematically a stable closed spiral on the disk plane.
vec3 galaxyField(vec3 p) {
    return vec3(
        u_g_omega * (-p.z) - u_g_kr * p.x,
                           - u_g_ky * p.y,
        u_g_omega * ( p.x) - u_g_kr * p.z
    );
}

// Lorenz attractor as a velocity field. Particles converge on the iconic butterfly manifold.
vec3 lorenzField(vec3 p) {
    vec3 q = p * u_l_scale + vec3(0.0, 0.0, u_l_offset);
    float sigma = 10.0, rho = 28.0, beta = 8.0/3.0;
    vec3 d = vec3(
        sigma * (q.y - q.x),
        q.x * (rho - q.z) - q.y,
        q.x * q.y - beta * q.z
    );
    return d * u_l_speed;
}

// Two counter-rotating vortices at ±X, with weak attraction to the y=0 plane.
vec3 vortexField(vec3 p) {
    vec3 c1 = vec3( u_v_pos, 0.0, 0.0);
    vec3 c2 = vec3(-u_v_pos, 0.0, 0.0);
    vec3 d1 = p - c1, d2 = p - c2;
    float r1 = max(length(d1.xz), 0.5), r2 = max(length(d2.xz), 0.5);
    vec3 t1 = vec3(-d1.z, 0.0, d1.x) / r1;
    vec3 t2 = vec3( d2.z, 0.0, -d2.x) / r2;
    vec3 v1 = t1 * (u_v_speed / (0.7 + r1 * 0.5));
    vec3 v2 = t2 * (u_v_speed / (0.7 + r2 * 0.5));
    return v1 + v2 + vec3(0.0, -p.y * u_v_ydamp, 0.0);
}

// Curl of multi-octave 4D simplex noise — divergence-free turbulence.
vec3 curlField(vec3 p, float t) {
    vec3 vel = curlNoise(p * u_c_freq,             t * u_c_tspeed) * u_c_amp;
    vel    += curlNoise(p * (u_c_freq * 2.2) + 13.0, t * (u_c_tspeed * 0.78)) * (u_c_amp * 0.4);
    return vel;
}

void main() {
    vec4 prevPos = texture(u_position, v_uv);
    vec3 pos = prevPos.xyz;
    float age = prevPos.w;
    vec3 vel = texture(u_velocity, v_uv).xyz;
    if (u_debugForceZeroVel == 1) vel = vec3(0.0);

    // Target velocity from the chosen flow field.
    vec3 target;
    if      (u_mode == 0) target = galaxyField(pos);
    else if (u_mode == 1) target = lorenzField(pos);
    else if (u_mode == 2) target = vortexField(pos);
    else                  target = curlField(pos, u_time);

    // Soft spherical containment biases the target inward when particles escape.
    float r = length(pos);
    if (r > u_bound_r) target -= pos / max(r, 0.001) * (r - u_bound_r) * u_bound_k * 2.0;

    // Stored velocity approaches the target with viscosity rate u_field_speed.
    //   u_field_speed = 0  → particles ignore the field and coast on inertia
    //   u_field_speed → ∞ → particles snap to the target
    float blend = 1.0 - exp(-u_field_speed * u_dt);
    vel = mix(vel, target, blend);

    // Independent damping (velocity decay regardless of field).
    vel *= exp(-u_damping * u_dt);

    pos += vel * u_dt;

    age = mod(age + u_dt * 0.6, 1.0);

    outPos = vec4(pos, age);
    outVel = vec4(vel, 0.0);
}
