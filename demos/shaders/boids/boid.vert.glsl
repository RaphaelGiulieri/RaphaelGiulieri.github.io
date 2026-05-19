#version 300 es
// Boid splat: each boid is one instance of a 3-vertex template triangle.
// Per-instance attributes (position, velocity, type, fear/hunt/flash) drive
// vertex placement + colour.

in vec2 a_corner;        // template corner: (1, 0) head, (-0.5, 0.5) left, (-0.5, -0.5) right
in vec2 a_pos;           // per-instance: world position (pixel space)
in vec2 a_vel;           // per-instance: velocity
in vec4 a_state;         // per-instance: (type, fear, hunt, flash)
out vec4 v_state;
uniform vec2 u_res;

void main() {
    vec2 dir = length(a_vel) > 0.0001 ? normalize(a_vel) : vec2(1.0, 0.0);
    vec2 right = vec2(-dir.y, dir.x);
    float scale = a_state.x > 0.5 ? 14.0 : 9.0;
    vec2 local = a_corner * scale;
    vec2 worldXY = a_pos + dir * local.x + right * local.y;
    vec2 ndc = (worldXY / u_res) * 2.0 - 1.0;
    ndc.y = -ndc.y;
    gl_Position = vec4(ndc, 0.0, 1.0);
    v_state = a_state;
}
