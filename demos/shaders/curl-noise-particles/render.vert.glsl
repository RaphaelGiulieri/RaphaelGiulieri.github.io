#version 300 es
// Per-particle vertex shader: read this particle's position from the position texture,
// project it, and size the point inverse-proportional to depth so close particles look bigger.

in float a_index;
uniform sampler2D u_position;
uniform mat4 u_viewProj;
uniform float u_pointBase;
uniform float u_aspect;

out float v_age;
out float v_depth;

void main() {
    int idx = int(a_index);
    ivec2 dims = textureSize(u_position, 0);
    int x = idx % dims.x;
    int y = idx / dims.x;
    vec4 p = texelFetch(u_position, ivec2(x, y), 0);
    vec4 clip = u_viewProj * vec4(p.xyz, 1.0);
    gl_Position = clip;
    v_age = p.w;
    float depth = max(0.001, clip.w);
    v_depth = depth;
    gl_PointSize = u_pointBase / depth;
}
