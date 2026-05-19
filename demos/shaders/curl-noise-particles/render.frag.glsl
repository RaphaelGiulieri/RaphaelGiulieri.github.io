#version 300 es
// Per-particle fragment shader: draw a soft circular point with a vermilion → amber palette
// over the particle's age, plus depth-based fade so distant particles read softer.

precision highp float;
in float v_age;
in float v_depth;
out vec4 fragColor;

void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;

    float core   = 1.0 - smoothstep(0.0, 0.30, r2);
    float halo   = 1.0 - smoothstep(0.20, 1.0, r2);

    vec3 cool = vec3(1.00, 0.42, 0.15);
    vec3 warm = vec3(1.00, 0.85, 0.55);
    vec3 col  = mix(cool, warm, smoothstep(0.0, 1.0, v_age));

    float depthFade = clamp(1.0 - (v_depth - 8.0) / 26.0, 0.15, 1.0);
    float a = (core * 1.0 + halo * 0.45) * depthFade;
    vec3 emitted = col * (core * 2.4 + halo * 0.6);
    fragColor = vec4(emitted, a);
}
