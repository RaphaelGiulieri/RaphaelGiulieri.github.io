#version 300 es
// Fullscreen quad — used to drive the simulation pass over every texel of the position+velocity textures.

in vec2 a_quad;
out vec2 v_uv;
void main() {
    v_uv = a_quad * 0.5 + 0.5;
    gl_Position = vec4(a_quad, 0.0, 1.0);
}
