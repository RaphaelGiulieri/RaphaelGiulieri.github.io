precision highp float;
varying vec2 vUv;

uniform float time;
uniform vec2 resolution;

// Wave parameters
uniform float waveSpeed;
uniform float waveScale;
uniform float waveHeight;
uniform float normalStrength;

// Colors
uniform vec3 deepColor;
uniform vec3 shallowColor;

// Lighting
uniform float sunReflection;
uniform vec3 sunDir;

// Skybox
uniform sampler2D skyboxTex;
uniform float skyboxLoaded;

// Camera - scroll controls dive depth
uniform float cameraHeight;  // Height above water (positive = above, negative = below)
uniform float cameraPitch;   // Look angle (0 = horizon, negative = look down)

#define PI 3.14159265359

// Gerstner wave height at world position
float getWaveHeight(vec2 pos, float t) {
    float height = 0.0;

    // Wave 1
    float k1 = 2.0 * PI / 4.0;
    float c1 = sqrt(9.8 / k1);
    vec2 d1 = normalize(vec2(1.0, 0.3));
    float f1 = k1 * (dot(d1, pos) - c1 * t * 0.8);
    height += (waveHeight / k1) * sin(f1);

    // Wave 2
    float k2 = 2.0 * PI / 2.5;
    float c2 = sqrt(9.8 / k2);
    vec2 d2 = normalize(vec2(0.8, 1.0));
    float f2 = k2 * (dot(d2, pos) - c2 * t * 1.2);
    height += (waveHeight * 0.7 / k2) * sin(f2);

    // Wave 3
    float k3 = 2.0 * PI / 1.5;
    float c3 = sqrt(9.8 / k3);
    vec2 d3 = normalize(vec2(-0.5, 0.8));
    float f3 = k3 * (dot(d3, pos) - c3 * t * 1.5);
    height += (waveHeight * 0.5 / k3) * sin(f3);

    // Wave 4
    float k4 = 2.0 * PI / 0.8;
    float c4 = sqrt(9.8 / k4);
    vec2 d4 = normalize(vec2(0.3, -0.6));
    float f4 = k4 * (dot(d4, pos) - c4 * t * 2.0);
    height += (waveHeight * 0.3 / k4) * sin(f4);

    return height;
}

// Calculate wave normal at world position
vec3 getWaveNormal(vec2 pos, float t) {
    vec2 n = vec2(0.0);

    // Wave 1
    float k1 = 2.0 * PI / 4.0;
    float c1 = sqrt(9.8 / k1);
    vec2 d1 = normalize(vec2(1.0, 0.3));
    float f1 = k1 * (dot(d1, pos) - c1 * t * 0.8);
    n += -d1 * waveHeight * sin(f1);

    // Wave 2
    float k2 = 2.0 * PI / 2.5;
    float c2 = sqrt(9.8 / k2);
    vec2 d2 = normalize(vec2(0.8, 1.0));
    float f2 = k2 * (dot(d2, pos) - c2 * t * 1.2);
    n += -d2 * waveHeight * 0.7 * sin(f2);

    // Wave 3
    float k3 = 2.0 * PI / 1.5;
    float c3 = sqrt(9.8 / k3);
    vec2 d3 = normalize(vec2(-0.5, 0.8));
    float f3 = k3 * (dot(d3, pos) - c3 * t * 1.5);
    n += -d3 * waveHeight * 0.5 * sin(f3);

    // Wave 4
    float k4 = 2.0 * PI / 0.8;
    float c4 = sqrt(9.8 / k4);
    vec2 d4 = normalize(vec2(0.3, -0.6));
    float f4 = k4 * (dot(d4, pos) - c4 * t * 2.0);
    n += -d4 * waveHeight * 0.3 * sin(f4);

    return normalize(vec3(n.x * normalStrength, 1.0, n.y * normalStrength));
}

// Sample skybox with equirectangular mapping
vec3 sampleSky(vec3 dir) {
    vec2 skyUV;
    skyUV.x = 0.5 + atan(dir.x, -dir.z) / (2.0 * PI);
    skyUV.y = 0.5 - asin(clamp(dir.y, -1.0, 1.0)) / PI;
    skyUV.x = fract(skyUV.x + time * 0.002); // Slow drift

    if (skyboxLoaded > 0.5) {
        return texture2D(skyboxTex, skyUV).rgb;
    } else {
        // Fallback gradient
        return mix(vec3(0.95, 0.6, 0.4), vec3(0.35, 0.55, 0.78), dir.y * 0.5 + 0.5);
    }
}

void main() {
    vec2 uv = vUv;
    float t = time * waveSpeed;
    float aspect = resolution.x / resolution.y;

    // Camera setup - positioned above water, looking toward horizon
    // Allow very low heights for swimming position (0.02 = just above surface)
    float camHeight = max(cameraHeight, 0.02);
    vec3 camPos = vec3(0.0, camHeight, 0.0);

    // Camera looks forward (along +Z), with pitch controlling up/down angle
    // pitch < 0 means looking down toward water
    // pitch = 0 means looking at horizon
    float pitch = cameraPitch;

    // Build camera basis vectors
    // Forward is tilted by pitch angle
    vec3 camForward = normalize(vec3(0.0, sin(pitch), cos(pitch)));
    vec3 camRight = vec3(1.0, 0.0, 0.0);
    vec3 camUp = cross(camForward, camRight); // Up is perpendicular to forward and right

    // Screen coordinates: uv.y = 0 at bottom, 1 at top (WebGL convention)
    // We want top of screen to show sky/horizon, bottom to show water below
    vec2 screenPos = (uv - 0.5) * 2.0;
    screenPos.x *= aspect;

    // Build ray direction
    float fov = 1.0;
    vec3 rayDir = normalize(
        camForward * fov +
        camRight * screenPos.x +
        camUp * screenPos.y  // positive screenPos.y = look up
    );

    // Ray-plane intersection with water at y=0
    // camPos.y + t * rayDir.y = 0  =>  t = -camPos.y / rayDir.y
    float tHit = -camPos.y / rayDir.y;

    vec3 color;

    // If ray points up (rayDir.y > 0) or doesn't hit water (tHit < 0), show sky
    if (rayDir.y > 0.0 || tHit < 0.0) {
        color = sampleSky(rayDir);
    } else {
        // Ray hits water
        vec3 hitPos = camPos + rayDir * tHit;

        // Clamp max distance to avoid precision issues
        float dist = length(hitPos.xz);
        if (dist > 500.0) {
            // Too far - blend to horizon
            color = sampleSky(vec3(rayDir.x, 0.05, rayDir.z));
        } else {
            vec2 oceanPos = hitPos.xz * waveScale;

            // Get wave properties
            float waveH = getWaveHeight(oceanPos, t);
            vec3 normal = getWaveNormal(oceanPos, t);

            // View direction (from water toward camera)
            vec3 viewDir = -rayDir;

            // Fresnel effect
            float NdotV = max(dot(normal, viewDir), 0.0);
            float fresnel = pow(1.0 - NdotV, 4.0);
            fresnel = mix(0.04, 1.0, fresnel);

            // Distance-based fog
            float distFade = 1.0 - exp(-dist * 0.008);

            // Sky reflection
            vec3 reflectDir = reflect(rayDir, normal);
            // Ensure reflection samples above horizon
            reflectDir.y = max(reflectDir.y, 0.05);
            vec3 skyReflection = sampleSky(reflectDir);

            // Water color - gets deeper with distance
            vec3 waterColor = mix(shallowColor, deepColor, distFade);

            // Combine water and sky reflection
            color = mix(waterColor, skyReflection, fresnel);

            // Fog toward horizon
            vec3 horizonColor = mix(
                vec3(0.3, 0.5, 0.6),
                sampleSky(vec3(0.0, 0.1, 1.0)),
                0.6
            );
            color = mix(color, horizonColor, distFade * 0.8);

            // Sun specular
            vec3 sunDirection = normalize(sunDir);
            vec3 halfVec = normalize(sunDirection + viewDir);
            float spec = pow(max(dot(normal, halfVec), 0.0), 256.0);
            float specBroad = pow(max(dot(normal, halfVec), 0.0), 32.0);
            float glitter = (spec * 2.0 + specBroad * 0.2) * sunReflection;
            glitter *= (1.0 - distFade * 0.9);
            color += vec3(1.0, 0.95, 0.85) * glitter;
        }
    }

    gl_FragColor = vec4(color, 1.0);
}
