#version 300 es
// Boid splat fragment — colours each boid by type + state.

precision highp float;
in vec4 v_state;
out vec4 fragColor;

void main() {
    float type  = v_state.x;
    float fear  = v_state.y;
    float hunt  = v_state.z;
    float flash = v_state.w;

    vec3 col;
    if (type > 0.5) {
        // Predator: deep vermilion → bright red as hunt-level rises, white-hot on a kill flash.
        col = mix(vec3(0.78, 0.16, 0.08), vec3(1.0, 0.28, 0.12), hunt);
        col = mix(col, vec3(1.0, 0.90, 0.70), flash);
    } else {
        // Prey: amber when calm, brighter when fleeing.
        col = mix(vec3(0.86, 0.71, 0.43), vec3(1.0, 0.83, 0.35), fear);
    }
    fragColor = vec4(col, 1.0);
}
