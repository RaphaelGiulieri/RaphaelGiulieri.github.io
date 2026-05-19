#version 300 es
// Fade pass: read previous trail texture, multiply by u_fade, write to next.
// Operating on a 16-bit float buffer means there's no 8-bit alpha quantization
// residue — pixels reach exact zero.

precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_trail;
uniform float u_fade;

void main() {
    vec4 c = texture(u_trail, v_uv);
    fragColor = c * u_fade;
}
