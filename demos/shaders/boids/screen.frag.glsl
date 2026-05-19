#version 300 es
// Screen composite: read trail texture, add bg colour, draw the cursor.
// Centralising final composition here makes future post-effects easy to plug
// in (bloom, colour grading, vignette, density-driven distortion).

precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_trail;
uniform vec2  u_res;
uniform vec2  u_cursor;
uniform int   u_hasMouse;
uniform int   u_cursorMode;     // 0 = prey, 1 = predator
uniform float u_fearDist;

const vec3 BG = vec3(0.047, 0.039, 0.027);

void main() {
    vec3 trail = texture(u_trail, v_uv).rgb;
    vec3 col = BG + trail;

    if (u_hasMouse == 1) {
        // v_uv.y = 0 is bottom in GL convention; mouseY uses a top-origin
        // convention. Flip Y so the cursor lands where the actual pointer is.
        vec2 pix = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;
        float d = distance(pix, u_cursor);
        if (u_cursorMode == 1) {
            // Predator: bright red dot + faint fear-radius ring
            float dot_  = smoothstep(5.5, 4.5, d);
            float ring  = smoothstep(1.2, 0.0, abs(d - u_fearDist)) * 0.18;
            col = mix(col, vec3(1.0, 0.24, 0.12), max(dot_, ring));
        } else {
            // Prey: amber dot
            float dot_ = smoothstep(5.5, 4.5, d);
            col = mix(col, vec3(1.0, 0.71, 0.35), dot_);
        }
    }
    fragColor = vec4(col, 1.0);
}
