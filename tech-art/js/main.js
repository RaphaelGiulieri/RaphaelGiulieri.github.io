/* =====================================================
   RAPHAEL GIULIERI — Portfolio JavaScript
   Vertical Journey: Sky → Sea → Depths
   ===================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // =========================================
    // GLOBAL STATE
    // =========================================
    const state = {
        scrollY: 0,
        scrollProgress: 0,
        currentZone: 'sky',
        zones: ['sky', 'overlook', 'surface', 'aquarium', 'bunker', 'mine'],
        mouse: { x: 0.5, y: 0.5 },
        time: 0,
        isUnderwater: false
    };

    // =========================================
    // WEBGL ENVIRONMENT RENDERER
    // =========================================
    class EnvironmentRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

            if (!this.gl) {
                console.warn('WebGL not supported');
                return;
            }

            this.programs = {};
            this.time = 0;
            this.init();
        }

        init() {
            const gl = this.gl;

            // Texture storage
            this.textures = {};
            this.skyboxLoaded = false;

            // Load skybox texture
            this.loadTexture('skybox', 'assets/skybox/sky_06_2k.png');

            // Shared vertex shader for fullscreen quads
            this.vertexShader = `
                attribute vec2 position;
                varying vec2 vUv;
                void main() {
                    vUv = position * 0.5 + 0.5;
                    gl_Position = vec4(position, 0.0, 1.0);
                }
            `;

            // Skybox shader - renders equirectangular HDR with parallax
            // This shader is for the HERO section - no camera pitch, just static sky view
            this.programs.skybox = this.createProgram(this.vertexShader, `
                precision highp float;
                varying vec2 vUv;
                uniform float time;
                uniform vec2 resolution;
                uniform float scrollProgress;
                uniform vec2 mouse;
                uniform sampler2D skyboxTex;
                uniform float skyboxLoaded;

                void main() {
                    vec2 uv = vUv;
                    vec3 color;

                    // Screen-space sampling for continuity across zones
                    vec2 skyUV;

                    // Horizontal: wider FOV, slow drift animation
                    float hFov = 0.7;
                    float hCenter = 0.5 + time * 0.001; // Slow drift only
                    skyUV.x = hCenter + (uv.x - 0.5) * hFov;
                    skyUV.x = fract(skyUV.x);

                    // Vertical: fixed view - no pitch adjustment for hero/window
                    float vFov = 0.4;
                    float vBase = 0.3; // Center in cloud/horizon region
                    skyUV.y = vBase - (uv.y - 0.5) * vFov;
                    skyUV.y = clamp(skyUV.y, 0.05, 0.55);

                    if (skyboxLoaded > 0.5) {
                        color = texture2D(skyboxTex, skyUV).rgb;
                    } else {
                        // Fallback gradient while loading
                        vec3 skyTop = vec3(0.35, 0.55, 0.78);
                        vec3 skyBot = vec3(0.95, 0.6, 0.4);
                        color = mix(skyBot, skyTop, uv.y);
                    }

                    // Subtle vignette only
                    float vignette = 1.0 - length((uv - 0.5) * 1.5) * 0.1;
                    color *= vignette;

                    gl_FragColor = vec4(color, 1.0);
                }
            `);

            // Ocean surface shader with Gerstner waves
            this.programs.ocean = this.createProgram(this.vertexShader, `
                precision highp float;
                varying vec2 vUv;
                uniform float time;
                uniform vec2 resolution;
                uniform float scrollProgress;
                uniform vec2 mouse;

                // Gerstner wave
                vec3 gerstnerWave(vec2 coord, float steepness, float wavelength, vec2 direction, float time) {
                    float k = 2.0 * 3.14159 / wavelength;
                    float c = sqrt(9.8 / k);
                    vec2 d = normalize(direction);
                    float f = k * (dot(d, coord) - c * time);
                    float a = steepness / k;

                    return vec3(
                        d.x * (a * cos(f)),
                        a * sin(f),
                        d.y * (a * cos(f))
                    );
                }

                // Simplex noise for foam
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

                float snoise(vec2 v) {
                    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                                        -0.577350269189626, 0.024390243902439);
                    vec2 i = floor(v + dot(v, C.yy));
                    vec2 x0 = v - i + dot(i, C.xx);
                    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                    vec4 x12 = x0.xyxy + C.xxzz;
                    x12.xy -= i1;
                    i = mod289(i);
                    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
                    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
                    m = m*m; m = m*m;
                    vec3 x = 2.0 * fract(p * C.www) - 1.0;
                    vec3 h = abs(x) - 0.5;
                    vec3 ox = floor(x + 0.5);
                    vec3 a0 = x - ox;
                    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
                    vec3 g;
                    g.x = a0.x * x0.x + h.x * x0.y;
                    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                    return 130.0 * dot(m, g);
                }

                void main() {
                    vec2 uv = vUv;
                    vec2 p = (uv - 0.5) * 2.0;
                    p.x *= resolution.x / resolution.y;

                    // Ocean plane position
                    vec2 oceanUV = uv * 4.0 + vec2(time * 0.05, 0.0);

                    // Multiple Gerstner waves
                    vec3 wave = vec3(0.0);
                    wave += gerstnerWave(oceanUV, 0.15, 4.0, vec2(1.0, 0.3), time * 0.8);
                    wave += gerstnerWave(oceanUV, 0.1, 2.5, vec2(0.8, 1.0), time * 1.2);
                    wave += gerstnerWave(oceanUV, 0.08, 1.5, vec2(-0.5, 0.8), time * 1.5);
                    wave += gerstnerWave(oceanUV, 0.05, 0.8, vec2(0.3, -0.6), time * 2.0);

                    // Height for this pixel
                    float height = wave.y;

                    // Normal approximation
                    float eps = 0.01;
                    vec3 waveX = gerstnerWave(oceanUV + vec2(eps, 0.0), 0.15, 4.0, vec2(1.0, 0.3), time * 0.8);
                    vec3 waveZ = gerstnerWave(oceanUV + vec2(0.0, eps), 0.15, 4.0, vec2(1.0, 0.3), time * 0.8);
                    vec3 normal = normalize(vec3(wave.y - waveX.y, eps * 2.0, wave.y - waveZ.y));

                    // Deep ocean color
                    vec3 deepColor = vec3(0.02, 0.08, 0.15);
                    vec3 shallowColor = vec3(0.0, 0.4, 0.5);
                    vec3 foamColor = vec3(0.9, 0.95, 1.0);

                    // Base water color based on view angle
                    float fresnel = pow(1.0 - abs(normal.y), 3.0);
                    vec3 waterColor = mix(deepColor, shallowColor, fresnel * 0.5);

                    // Sky reflection (simplified)
                    vec3 skyReflect = vec3(0.4, 0.55, 0.7) * fresnel * 0.5;
                    waterColor += skyReflect;

                    // Sun reflection
                    vec2 sunDir = normalize(vec2(0.3, 0.5));
                    float sunReflect = pow(max(0.0, dot(normal.xz, sunDir)), 32.0);
                    waterColor += vec3(1.0, 0.9, 0.7) * sunReflect * 0.6;

                    // Foam on wave peaks
                    float foam = smoothstep(0.1, 0.2, height);
                    foam += snoise(oceanUV * 8.0 + time * 0.5) * 0.3 * foam;
                    foam = clamp(foam, 0.0, 1.0);
                    waterColor = mix(waterColor, foamColor, foam * 0.4);

                    // Edge foam (shoreline effect)
                    float edgeFoam = snoise(oceanUV * 12.0 + time * 0.3);
                    edgeFoam = smoothstep(0.6, 0.8, edgeFoam) * (1.0 - abs(p.y));
                    waterColor = mix(waterColor, foamColor, edgeFoam * 0.3);

                    // Caustics (subtle)
                    float caustic = snoise(oceanUV * 6.0 + time * 0.2);
                    caustic = pow(abs(caustic), 2.0) * 0.2;
                    waterColor += vec3(0.0, 0.5, 0.6) * caustic;

                    // Depth fade at edges
                    float vignette = 1.0 - length(p) * 0.3;
                    waterColor *= vignette;

                    gl_FragColor = vec4(waterColor, 1.0);
                }
            `);

            // Underwater/Aquarium background shader
            this.programs.underwater = this.createProgram(this.vertexShader, `
                precision highp float;
                varying vec2 vUv;
                uniform float time;
                uniform vec2 resolution;

                // Noise functions
                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

                float snoise(vec2 v) {
                    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                                        -0.577350269189626, 0.024390243902439);
                    vec2 i = floor(v + dot(v, C.yy));
                    vec2 x0 = v - i + dot(i, C.xx);
                    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                    vec4 x12 = x0.xyxy + C.xxzz;
                    x12.xy -= i1;
                    i = mod289(i);
                    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
                    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
                    m = m*m; m = m*m;
                    vec3 x = 2.0 * fract(p * C.www) - 1.0;
                    vec3 h = abs(x) - 0.5;
                    vec3 ox = floor(x + 0.5);
                    vec3 a0 = x - ox;
                    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
                    vec3 g;
                    g.x = a0.x * x0.x + h.x * x0.y;
                    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                    return 130.0 * dot(m, g);
                }

                // Caustics
                float caustic(vec2 uv, float t) {
                    float c = 0.0;
                    for (float i = 1.0; i < 4.0; i++) {
                        float power = pow(2.0, i);
                        c += (1.0 / power) * snoise(uv * power * 2.0 + t * 0.3);
                    }
                    return c;
                }

                void main() {
                    vec2 uv = vUv;
                    vec2 p = (uv - 0.5) * 2.0;
                    p.x *= resolution.x / resolution.y;

                    // Deep ocean gradient
                    vec3 deepBlue = vec3(0.01, 0.03, 0.08);
                    vec3 midBlue = vec3(0.02, 0.08, 0.18);

                    float depth = uv.y;
                    vec3 color = mix(deepBlue, midBlue, depth * 0.5);

                    // Caustics from above
                    float t = time * 0.5;
                    float c1 = caustic(uv * 2.0, t);
                    float c2 = caustic(uv * 3.0 + 0.5, t * 1.3);
                    float caustics = (c1 + c2 * 0.5) * 0.5 + 0.5;
                    caustics = pow(caustics, 2.0);

                    // Caustics stronger at top (light from surface)
                    float causticStrength = smoothstep(0.3, 1.0, uv.y) * 0.4;
                    color += vec3(0.0, 0.4, 0.6) * caustics * causticStrength;

                    // Floating particles
                    for (float i = 0.0; i < 15.0; i++) {
                        vec2 particlePos = vec2(
                            fract(sin(i * 123.456) * 1000.0),
                            fract(sin(i * 789.012) * 1000.0 + time * 0.02 * (0.5 + fract(sin(i * 456.789) * 1000.0)))
                        );
                        float d = length(uv - particlePos);
                        float glow = smoothstep(0.02, 0.0, d);
                        color += vec3(0.0, 0.5, 0.8) * glow * 0.3;
                    }

                    // Depth fog
                    float fog = 1.0 - smoothstep(0.0, 1.0, uv.y);
                    color = mix(color, deepBlue, fog * 0.5);

                    // Vignette
                    float vignette = 1.0 - length(p) * 0.3;
                    color *= vignette;

                    gl_FragColor = vec4(color, 1.0);
                }
            `);

            // Create fullscreen quad
            const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
            this.buffer = this.gl.createBuffer();
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);

            this.resize();
            window.addEventListener('resize', () => this.resize());
        }

        createProgram(vertexSource, fragmentSource) {
            const gl = this.gl;

            const vertexShader = gl.createShader(gl.VERTEX_SHADER);
            gl.shaderSource(vertexShader, vertexSource);
            gl.compileShader(vertexShader);

            if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
                console.error('Vertex shader error:', gl.getShaderInfoLog(vertexShader));
            }

            const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
            gl.shaderSource(fragmentShader, fragmentSource);
            gl.compileShader(fragmentShader);

            if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
                console.error('Fragment shader error:', gl.getShaderInfoLog(fragmentShader));
            }

            const program = gl.createProgram();
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragmentShader);
            gl.linkProgram(program);

            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                console.error('Program link error:', gl.getProgramInfoLog(program));
            }

            return program;
        }

        loadTexture(name, url) {
            const gl = this.gl;
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);

            // Placeholder pixel while loading (bright pink for debugging)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array([255, 0, 255, 255]));

            this.textures[name] = texture;

            const image = new Image();
            // Don't set crossOrigin for local files - it can cause issues
            // image.crossOrigin = 'anonymous';

            image.onload = () => {
                console.log(`Image loaded: ${name}, size: ${image.width}x${image.height}`);

                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

                // For equirectangular skybox, we want horizontal wrap, vertical clamp
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

                if (name === 'skybox') {
                    this.skyboxLoaded = true;
                    console.log('Skybox texture ready!');
                }
            };

            image.onerror = (e) => {
                console.error(`Failed to load texture: ${url}`, e);
            };

            console.log(`Loading texture: ${url}`);
            image.src = url;
        }

        isPowerOf2(value) {
            return (value & (value - 1)) === 0;
        }

        resize() {
            this.canvas.width = window.innerWidth * window.devicePixelRatio;
            this.canvas.height = window.innerHeight * window.devicePixelRatio;
            this.canvas.style.width = window.innerWidth + 'px';
            this.canvas.style.height = window.innerHeight + 'px';
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }

        render(programName, uniforms = {}) {
            const gl = this.gl;
            const program = this.programs[programName];
            if (!program) return;

            gl.useProgram(program);

            // Set up attributes
            const position = gl.getAttribLocation(program, 'position');
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.enableVertexAttribArray(position);
            gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

            // Set common uniforms
            gl.uniform1f(gl.getUniformLocation(program, 'time'), this.time);
            gl.uniform2f(gl.getUniformLocation(program, 'resolution'), this.canvas.width, this.canvas.height);

            // Bind textures
            if (programName === 'skybox') {
                gl.activeTexture(gl.TEXTURE0);
                if (this.textures.skybox) {
                    gl.bindTexture(gl.TEXTURE_2D, this.textures.skybox);
                }
                gl.uniform1i(gl.getUniformLocation(program, 'skyboxTex'), 0);
                // Always try to use texture - it will show placeholder if not loaded
                gl.uniform1f(gl.getUniformLocation(program, 'skyboxLoaded'), this.skyboxLoaded ? 1.0 : 0.0);
            }

            // Set custom uniforms
            for (const [key, value] of Object.entries(uniforms)) {
                const location = gl.getUniformLocation(program, key);
                if (Array.isArray(value)) {
                    if (value.length === 2) gl.uniform2f(location, value[0], value[1]);
                    else if (value.length === 3) gl.uniform3f(location, value[0], value[1], value[2]);
                } else {
                    gl.uniform1f(location, value);
                }
            }

            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        update(deltaTime) {
            this.time += deltaTime;
        }
    }

    // =========================================
    // FISH BOIDS SYSTEM
    // =========================================
    class FishBoids {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.fish = [];
            this.fishCount = 40;
            this.mouse = { x: 0, y: 0, active: false };

            this.init();
        }

        init() {
            this.resize();

            for (let i = 0; i < this.fishCount; i++) {
                this.fish.push({
                    x: Math.random() * this.canvas.width,
                    y: Math.random() * this.canvas.height,
                    vx: (Math.random() - 0.5) * 2,
                    vy: (Math.random() - 0.5) * 2,
                    size: Math.random() * 8 + 4,
                    hue: 180 + Math.random() * 40, // Blue-cyan range
                    speed: 0.5 + Math.random() * 0.5,
                    tailPhase: Math.random() * Math.PI * 2
                });
            }

            window.addEventListener('resize', () => this.resize());
        }

        resize() {
            const rect = this.canvas.parentElement.getBoundingClientRect();
            this.canvas.width = rect.width * window.devicePixelRatio;
            this.canvas.height = rect.height * window.devicePixelRatio;
            this.canvas.style.width = rect.width + 'px';
            this.canvas.style.height = rect.height + 'px';
            this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        }

        setMouse(x, y, active) {
            this.mouse = { x, y, active };
        }

        update(time) {
            const cohesionRange = 150;
            const separationRange = 30;
            const alignmentRange = 100;

            for (let i = 0; i < this.fish.length; i++) {
                const fish = this.fish[i];

                let avgX = 0, avgY = 0;
                let avgVx = 0, avgVy = 0;
                let sepX = 0, sepY = 0;
                let neighbors = 0;

                // Boid rules
                for (let j = 0; j < this.fish.length; j++) {
                    if (i === j) continue;

                    const other = this.fish[j];
                    const dx = other.x - fish.x;
                    const dy = other.y - fish.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    // Separation
                    if (dist < separationRange && dist > 0) {
                        sepX -= dx / dist;
                        sepY -= dy / dist;
                    }

                    // Cohesion and alignment
                    if (dist < cohesionRange) {
                        avgX += other.x;
                        avgY += other.y;
                        avgVx += other.vx;
                        avgVy += other.vy;
                        neighbors++;
                    }
                }

                if (neighbors > 0) {
                    // Cohesion
                    avgX /= neighbors;
                    avgY /= neighbors;
                    fish.vx += (avgX - fish.x) * 0.001;
                    fish.vy += (avgY - fish.y) * 0.001;

                    // Alignment
                    avgVx /= neighbors;
                    avgVy /= neighbors;
                    fish.vx += (avgVx - fish.vx) * 0.02;
                    fish.vy += (avgVy - fish.vy) * 0.02;
                }

                // Separation
                fish.vx += sepX * 0.05;
                fish.vy += sepY * 0.05;

                // Mouse avoidance/attraction
                if (this.mouse.active) {
                    const dx = this.mouse.x - fish.x;
                    const dy = this.mouse.y - fish.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < 150) {
                        // Flee from mouse
                        fish.vx -= (dx / dist) * 0.3;
                        fish.vy -= (dy / dist) * 0.3;
                    }
                }

                // Edge avoidance (soft boundaries)
                const margin = 50;
                const w = this.canvas.width / window.devicePixelRatio;
                const h = this.canvas.height / window.devicePixelRatio;

                if (fish.x < margin) fish.vx += 0.1;
                if (fish.x > w - margin) fish.vx -= 0.1;
                if (fish.y < margin) fish.vy += 0.1;
                if (fish.y > h - margin) fish.vy -= 0.1;

                // Speed limit
                const speed = Math.sqrt(fish.vx * fish.vx + fish.vy * fish.vy);
                const maxSpeed = 2 * fish.speed;
                if (speed > maxSpeed) {
                    fish.vx = (fish.vx / speed) * maxSpeed;
                    fish.vy = (fish.vy / speed) * maxSpeed;
                }

                // Minimum speed
                const minSpeed = 0.5 * fish.speed;
                if (speed < minSpeed && speed > 0) {
                    fish.vx = (fish.vx / speed) * minSpeed;
                    fish.vy = (fish.vy / speed) * minSpeed;
                }

                // Damping
                fish.vx *= 0.99;
                fish.vy *= 0.99;

                // Update position
                fish.x += fish.vx;
                fish.y += fish.vy;

                // Wrap around
                if (fish.x < -20) fish.x = w + 20;
                if (fish.x > w + 20) fish.x = -20;
                if (fish.y < -20) fish.y = h + 20;
                if (fish.y > h + 20) fish.y = -20;

                // Tail animation
                fish.tailPhase += 0.2 * fish.speed;
            }
        }

        draw(time) {
            const ctx = this.ctx;
            const w = this.canvas.width / window.devicePixelRatio;
            const h = this.canvas.height / window.devicePixelRatio;

            ctx.clearRect(0, 0, w, h);

            for (const fish of this.fish) {
                const angle = Math.atan2(fish.vy, fish.vx);
                const tailWag = Math.sin(fish.tailPhase) * 0.3;

                ctx.save();
                ctx.translate(fish.x, fish.y);
                ctx.rotate(angle);

                // Fish body glow
                const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, fish.size * 2);
                gradient.addColorStop(0, `hsla(${fish.hue}, 80%, 60%, 0.3)`);
                gradient.addColorStop(1, 'transparent');
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(0, 0, fish.size * 2, 0, Math.PI * 2);
                ctx.fill();

                // Fish body
                ctx.fillStyle = `hsla(${fish.hue}, 70%, 50%, 0.8)`;
                ctx.beginPath();
                ctx.ellipse(0, 0, fish.size, fish.size * 0.4, 0, 0, Math.PI * 2);
                ctx.fill();

                // Tail
                ctx.fillStyle = `hsla(${fish.hue}, 60%, 45%, 0.7)`;
                ctx.beginPath();
                ctx.moveTo(-fish.size * 0.8, 0);
                ctx.lineTo(-fish.size * 1.5, -fish.size * 0.4 + tailWag * fish.size);
                ctx.lineTo(-fish.size * 1.5, fish.size * 0.4 + tailWag * fish.size);
                ctx.closePath();
                ctx.fill();

                // Eye
                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.beginPath();
                ctx.arc(fish.size * 0.4, -fish.size * 0.1, fish.size * 0.12, 0, Math.PI * 2);
                ctx.fill();

                ctx.restore();
            }
        }
    }

    // =========================================
    // CRYSTAL PARTICLES
    // =========================================
    class CrystalParticles {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.particles = [];
            this.particleCount = 50;

            this.init();
        }

        init() {
            this.resize();

            for (let i = 0; i < this.particleCount; i++) {
                this.particles.push({
                    x: Math.random() * this.canvas.width,
                    y: Math.random() * this.canvas.height,
                    vx: (Math.random() - 0.5) * 0.2,
                    vy: -Math.random() * 0.3 - 0.1, // Float upward
                    size: Math.random() * 3 + 1,
                    alpha: Math.random() * 0.5 + 0.2,
                    hue: 35 + Math.random() * 20, // Amber range
                    twinkle: Math.random() * Math.PI * 2
                });
            }

            window.addEventListener('resize', () => this.resize());
        }

        resize() {
            const rect = this.canvas.parentElement.getBoundingClientRect();
            this.canvas.width = rect.width * window.devicePixelRatio;
            this.canvas.height = rect.height * window.devicePixelRatio;
            this.canvas.style.width = rect.width + 'px';
            this.canvas.style.height = rect.height + 'px';
            this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        }

        update(time) {
            const w = this.canvas.width / window.devicePixelRatio;
            const h = this.canvas.height / window.devicePixelRatio;

            for (const p of this.particles) {
                p.x += p.vx;
                p.y += p.vy;
                p.twinkle += 0.05;

                // Wrap around
                if (p.y < -10) {
                    p.y = h + 10;
                    p.x = Math.random() * w;
                }
                if (p.x < -10) p.x = w + 10;
                if (p.x > w + 10) p.x = -10;
            }
        }

        draw(time) {
            const ctx = this.ctx;
            const w = this.canvas.width / window.devicePixelRatio;
            const h = this.canvas.height / window.devicePixelRatio;

            ctx.clearRect(0, 0, w, h);

            for (const p of this.particles) {
                const twinkleAlpha = p.alpha * (0.5 + 0.5 * Math.sin(p.twinkle));

                // Glow
                const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 4);
                gradient.addColorStop(0, `hsla(${p.hue}, 80%, 60%, ${twinkleAlpha})`);
                gradient.addColorStop(0.5, `hsla(${p.hue}, 70%, 50%, ${twinkleAlpha * 0.3})`);
                gradient.addColorStop(1, 'transparent');

                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size * 4, 0, Math.PI * 2);
                ctx.fill();

                // Core
                ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, ${twinkleAlpha + 0.2})`;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // =========================================
    // SCROLL ZONE MANAGER
    // =========================================
    class ZoneManager {
        constructor() {
            this.zones = document.querySelectorAll('.zone');
            this.depthIndicator = document.querySelector('.depth-indicator');
            this.depthMarkers = document.querySelectorAll('.depth-marker');
            this.currentZone = 'sky';

            this.init();
        }

        init() {
            // Intersection observer for zone changes
            const options = {
                root: null,
                rootMargin: '-30% 0px -30% 0px',
                threshold: 0
            };

            this.observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const zone = entry.target.dataset.zone;
                        this.setCurrentZone(zone);
                    }
                });
            }, options);

            this.zones.forEach(zone => this.observer.observe(zone));
        }

        setCurrentZone(zone) {
            if (this.currentZone === zone) return;

            this.currentZone = zone;
            state.currentZone = zone;

            // Update body class
            document.body.className = `zone-active-${zone}`;

            // Update depth markers
            this.depthMarkers.forEach(marker => {
                marker.classList.toggle('active',
                    marker.classList.contains(zone) ||
                    this.isZonePassed(marker.dataset.label?.toLowerCase(), zone)
                );
            });
        }

        isZonePassed(markerZone, currentZone) {
            const order = ['sky', 'surface', 'ocean', 'deep', 'abyss'];
            const zoneMap = {
                'sky': 0,
                'overlook': 0,
                'surface': 1,
                'aquarium': 2,
                'bunker': 3,
                'mine': 4
            };

            const markerIndex = order.indexOf(markerZone);
            const currentIndex = zoneMap[currentZone] || 0;

            return markerIndex < currentIndex;
        }

        updateScroll(scrollY) {
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;
            const progress = Math.min(1, Math.max(0, scrollY / docHeight));

            state.scrollProgress = progress;

            // Update depth indicator position
            if (this.depthIndicator) {
                this.depthIndicator.style.top = `${progress * 100}%`;
            }

            // Check if underwater (past surface zone)
            const surfaceZone = document.querySelector('.zone-surface');
            if (surfaceZone) {
                const surfaceRect = surfaceZone.getBoundingClientRect();
                state.isUnderwater = surfaceRect.top < window.innerHeight * 0.5;
            }
        }
    }

    // =========================================
    // SKYBOX PARALLAX (Window View)
    // =========================================
    // WebGL-based window skybox - uses same shader logic as hero for perfect sync
    class SkyboxParallax {
        constructor(element) {
            this.element = element;
            this.canvas = document.createElement('canvas');
            this.gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
            this.element.appendChild(this.canvas);
            this.program = null;
            this.buffer = null;
            this.texture = null;
            this.textureLoaded = false;
            this.time = 0;

            if (!this.gl) {
                console.warn('WebGL not supported for window skybox');
                return;
            }

            this.init();
        }

        init() {
            const gl = this.gl;

            // Simple vertex shader - just pass through local UVs
            const vertexShader = `
                attribute vec2 position;
                varying vec2 vUv;

                void main() {
                    vUv = position * 0.5 + 0.5;
                    gl_Position = vec4(position, 0.0, 1.0);
                }
            `;

            // Fragment shader - sample skybox based on screen position
            // MUST use IDENTICAL formula as hero shader for perfect sync
            const fragmentShader = `
                precision highp float;
                varying vec2 vUv;
                uniform float time;
                uniform sampler2D skyboxTex;
                uniform float skyboxLoaded;
                uniform vec4 screenRect; // left, top, right, bottom in screen UV (0-1)

                void main() {
                    // Convert local UV to screen UV that matches hero shader convention
                    // Hero shader: uv.y=1 at top, uv.y=0 at bottom (WebGL convention)
                    // screenRect: y values are in DOM space (0=top, 1=bottom)
                    // We need to convert to hero's convention

                    float screenX = mix(screenRect.x, screenRect.z, vUv.x);
                    // screenRect.y = DOM top (small value), screenRect.w = DOM bottom (larger value)
                    // vUv.y=1 (GL top) should map to 1.0 - screenRect.y (hero top)
                    // vUv.y=0 (GL bottom) should map to 1.0 - screenRect.w (hero bottom)
                    float domY = mix(screenRect.y, screenRect.w, 1.0 - vUv.y);
                    float heroY = 1.0 - domY; // Convert DOM coords to hero coords

                    vec2 uv = vec2(screenX, heroY);

                    // IDENTICAL formula as hero shader
                    vec2 skyUV;

                    float hFov = 0.7;
                    float hCenter = 0.5 + time * 0.001;
                    skyUV.x = hCenter + (uv.x - 0.5) * hFov;
                    skyUV.x = fract(skyUV.x);

                    float vFov = 0.4;
                    float vBase = 0.3;
                    skyUV.y = vBase - (uv.y - 0.5) * vFov;
                    skyUV.y = clamp(skyUV.y, 0.05, 0.55);

                    vec3 color;
                    if (skyboxLoaded > 0.5) {
                        color = texture2D(skyboxTex, skyUV).rgb;
                    } else {
                        // Fallback gradient
                        vec3 skyTop = vec3(0.35, 0.55, 0.78);
                        vec3 skyBot = vec3(0.95, 0.6, 0.4);
                        color = mix(skyBot, skyTop, uv.y);
                    }

                    // Subtle vignette
                    float vignette = 1.0 - length((uv - 0.5) * 1.5) * 0.1;
                    color *= vignette;

                    gl_FragColor = vec4(color, 1.0);
                }
            `;

            // Compile shaders
            const vs = gl.createShader(gl.VERTEX_SHADER);
            gl.shaderSource(vs, vertexShader);
            gl.compileShader(vs);
            if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
                console.error('Window skybox vertex shader error:', gl.getShaderInfoLog(vs));
                return;
            }

            const fs = gl.createShader(gl.FRAGMENT_SHADER);
            gl.shaderSource(fs, fragmentShader);
            gl.compileShader(fs);
            if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
                console.error('Window skybox fragment shader error:', gl.getShaderInfoLog(fs));
                return;
            }

            this.program = gl.createProgram();
            gl.attachShader(this.program, vs);
            gl.attachShader(this.program, fs);
            gl.linkProgram(this.program);
            if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
                console.error('Window skybox program link error:', gl.getProgramInfoLog(this.program));
                return;
            }

            // Create fullscreen quad
            const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
            this.buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

            // Load texture
            this.texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array([128, 128, 128, 255]));

            const image = new Image();
            image.crossOrigin = 'anonymous';
            const self = this;
            image.onload = function() {
                const ctx = self.gl;
                ctx.bindTexture(ctx.TEXTURE_2D, self.texture);
                ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, image);
                ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.REPEAT);
                ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
                ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR);
                ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);
                self.textureLoaded = true;
                console.log('Window skybox WebGL texture loaded');
            };
            image.onerror = function() {
                console.error('Failed to load window skybox texture');
            };
            image.src = 'assets/skybox/sky_06_2k.png';

            this.resize();
            window.addEventListener('resize', () => this.resize());
        }

        resize() {
            const rect = this.element.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
            if (this.gl) {
                this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            }
        }

        update(scrollProgress, time) {
            if (!this.gl || !this.program) return;

            const gl = this.gl;
            // Convert time from ms to seconds to match hero shader
            this.time = time / 1000;

            // Get window position in screen space (0-1)
            const rect = this.element.getBoundingClientRect();
            const screenW = window.innerWidth;
            const screenH = window.innerHeight;

            // Screen UV: (0,0) at top-left, (1,1) at bottom-right
            const left = rect.left / screenW;
            const top = rect.top / screenH;
            const right = rect.right / screenW;
            const bottom = rect.bottom / screenH;

            gl.useProgram(this.program);

            // Set up attributes
            const position = gl.getAttribLocation(this.program, 'position');
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.enableVertexAttribArray(position);
            gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

            // Set uniforms
            gl.uniform1f(gl.getUniformLocation(this.program, 'time'), this.time);
            gl.uniform4f(gl.getUniformLocation(this.program, 'screenRect'), left, top, right, bottom);

            // Texture
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            gl.uniform1i(gl.getUniformLocation(this.program, 'skyboxTex'), 0);
            gl.uniform1f(gl.getUniformLocation(this.program, 'skyboxLoaded'), this.textureLoaded ? 1.0 : 0.0);

            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
    }

    // =========================================
    // OCEAN SCENE SKYBOX (3D plane behind cube)
    // =========================================
    // WebGL skybox for ocean scene - renders on a 3D plane inside camera rig
    class OceanSkybox {
        constructor(container) {
            this.container = container;
            this.canvas = document.createElement('canvas');
            this.gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
            this.container.appendChild(this.canvas);
            this.program = null;
            this.buffer = null;
            this.texture = null;
            this.textureLoaded = false;
            this.time = 0;

            if (!this.gl) {
                console.warn('WebGL not supported for ocean skybox');
                return;
            }

            this.init();
        }

        init() {
            const gl = this.gl;

            // Simple vertex shader
            const vertexShader = `
                attribute vec2 position;
                varying vec2 vUv;

                void main() {
                    vUv = position * 0.5 + 0.5;
                    gl_Position = vec4(position, 0.0, 1.0);
                }
            `;

            // Fragment shader - sample skybox using screen-space coordinates
            // IDENTICAL formula as hero shader for perfect sync
            const fragmentShader = `
                precision highp float;
                varying vec2 vUv;
                uniform float time;
                uniform sampler2D skyboxTex;
                uniform float skyboxLoaded;
                uniform vec4 screenRect; // left, top, right, bottom in DOM space (0-1)

                void main() {
                    // Convert local UV to screen-space coordinates matching hero shader
                    float screenX = mix(screenRect.x, screenRect.z, vUv.x);
                    float domY = mix(screenRect.y, screenRect.w, 1.0 - vUv.y);
                    float heroY = 1.0 - domY;
                    vec2 uv = vec2(screenX, heroY);

                    vec2 skyUV;

                    // IDENTICAL to hero shader
                    float hFov = 0.7;
                    float hCenter = 0.5 + time * 0.001;
                    skyUV.x = hCenter + (uv.x - 0.5) * hFov;
                    skyUV.x = fract(skyUV.x);

                    float vFov = 0.4;
                    float vBase = 0.3;
                    skyUV.y = vBase - (uv.y - 0.5) * vFov;
                    skyUV.y = clamp(skyUV.y, 0.05, 0.55);

                    vec3 color;
                    if (skyboxLoaded > 0.5) {
                        color = texture2D(skyboxTex, skyUV).rgb;
                    } else {
                        vec3 skyTop = vec3(0.35, 0.55, 0.78);
                        vec3 skyBot = vec3(0.95, 0.6, 0.4);
                        color = mix(skyBot, skyTop, uv.y);
                    }

                    gl_FragColor = vec4(color, 1.0);
                }
            `;

            // Compile shaders
            const vs = gl.createShader(gl.VERTEX_SHADER);
            gl.shaderSource(vs, vertexShader);
            gl.compileShader(vs);
            if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
                console.error('Ocean skybox vertex shader error:', gl.getShaderInfoLog(vs));
                return;
            }

            const fs = gl.createShader(gl.FRAGMENT_SHADER);
            gl.shaderSource(fs, fragmentShader);
            gl.compileShader(fs);
            if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
                console.error('Ocean skybox fragment shader error:', gl.getShaderInfoLog(fs));
                return;
            }

            this.program = gl.createProgram();
            gl.attachShader(this.program, vs);
            gl.attachShader(this.program, fs);
            gl.linkProgram(this.program);
            if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
                console.error('Ocean skybox program link error:', gl.getProgramInfoLog(this.program));
                return;
            }

            // Create fullscreen quad
            const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
            this.buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

            // Load texture
            this.texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array([128, 128, 128, 255]));

            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.onload = () => {
                gl.bindTexture(gl.TEXTURE_2D, this.texture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                this.textureLoaded = true;
                console.log('Ocean skybox WebGL texture loaded');
            };
            image.src = 'assets/skybox/sky_06_2k.png';

            this.resize();
            window.addEventListener('resize', () => this.resize());
        }

        resize() {
            const rect = this.container.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            // Use a reasonable resolution - the plane is large but we don't need massive resolution
            this.canvas.width = Math.min(rect.width * dpr, 2048);
            this.canvas.height = Math.min(rect.height * dpr, 2048);
            if (this.gl) {
                this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            }
        }

        render(time) {
            if (!this.gl || !this.program) return;

            const gl = this.gl;
            this.time = time;

            gl.useProgram(this.program);

            // Set up attributes
            const position = gl.getAttribLocation(this.program, 'position');
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.enableVertexAttribArray(position);
            gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

            // Set uniforms
            gl.uniform1f(gl.getUniformLocation(this.program, 'time'), this.time);

            // Calculate screen rect for this canvas
            const rect = this.canvas.getBoundingClientRect();
            const screenLeft = rect.left / window.innerWidth;
            const screenTop = rect.top / window.innerHeight;
            const screenRight = rect.right / window.innerWidth;
            const screenBottom = rect.bottom / window.innerHeight;
            gl.uniform4f(gl.getUniformLocation(this.program, 'screenRect'),
                screenLeft, screenTop, screenRight, screenBottom);

            // Texture
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            gl.uniform1i(gl.getUniformLocation(this.program, 'skyboxTex'), 0);
            gl.uniform1f(gl.getUniformLocation(this.program, 'skyboxLoaded'), this.textureLoaded ? 1.0 : 0.0);

            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
    }

    // =========================================
    // SPLASH EFFECT
    // =========================================
    class SplashEffect {
        constructor(container) {
            this.container = container;
            this.particles = [];
            this.isActive = false;
        }

        trigger() {
            if (this.isActive) return;
            this.isActive = true;

            // Create splash particles
            for (let i = 0; i < 20; i++) {
                const particle = document.createElement('div');
                particle.className = 'splash-particle';
                particle.style.cssText = `
                    position: absolute;
                    width: ${4 + Math.random() * 8}px;
                    height: ${4 + Math.random() * 8}px;
                    background: rgba(150, 200, 255, 0.8);
                    border-radius: 50%;
                    left: ${30 + Math.random() * 40}%;
                    top: 50%;
                    pointer-events: none;
                    animation: splashParticle 1s ease-out forwards;
                    --tx: ${(Math.random() - 0.5) * 200}px;
                    --ty: ${-50 - Math.random() * 150}px;
                `;
                this.container.appendChild(particle);
                this.particles.push(particle);
            }

            // Water distortion overlay
            const distortion = this.container.parentElement.querySelector('.water-distortion');
            if (distortion) {
                distortion.classList.add('active');
                setTimeout(() => distortion.classList.remove('active'), 1500);
            }

            // Cleanup
            setTimeout(() => {
                this.particles.forEach(p => p.remove());
                this.particles = [];
                this.isActive = false;
            }, 1500);
        }
    }

    // =========================================
    // DEBUG PANEL FOR OCEAN CUBE
    // =========================================
    const debugConfig = {
        // Cube size
        cubeSize: 1000,
        // Camera/scroll parameters
        startY: 350,
        endY: -250,
        distanceZ: 250,
        perspective: 1200,
        smoothing: 0.15,
        // Ocean surface shader parameters
        waveSpeed: 0.8,
        waveScale: 8.0,
        waveHeight: 0.3,
        normalStrength: 2.0,
        deepColor: { r: 0.02, g: 0.08, b: 0.15 },
        shallowColor: { r: 0.0, g: 0.4, b: 0.5 },
        sunReflection: 1.0,
        sunAngle: 45,      // Azimuth in degrees (0-360, 0=front, 90=right)
        sunHeight: 45,     // Elevation in degrees (0=horizon, 90=overhead)
        // Skybox plane parameters
        skyboxPlaneSize: 6000,
        skyboxPlaneZ: -1200,
        // Toggle
        showDebug: true
    };

    // Convert sun angle/height to direction vector (global for shader access)
    window.getSunDirection = function() {
        const azimuth = debugConfig.sunAngle * Math.PI / 180;
        const elevation = debugConfig.sunHeight * Math.PI / 180;
        return {
            x: Math.sin(azimuth) * Math.cos(elevation),
            y: Math.sin(elevation),
            z: Math.cos(azimuth) * Math.cos(elevation)
        };
    };

    function createDebugPanel() {
        const panel = document.createElement('div');
        panel.id = 'debug-panel';
        panel.innerHTML = `
            <style>
                #debug-panel {
                    position: fixed;
                    top: 10px;
                    right: 10px;
                    width: 340px;
                    max-height: 90vh;
                    overflow-y: auto;
                    background: rgba(0, 0, 0, 0.85);
                    border: 1px solid rgba(0, 200, 255, 0.3);
                    border-radius: 8px;
                    padding: 15px;
                    font-family: monospace;
                    font-size: 12px;
                    color: #fff;
                    z-index: 99999;
                    backdrop-filter: blur(10px);
                }
                #debug-panel.collapsed {
                    width: auto;
                    max-height: none;
                    overflow: visible;
                }
                #debug-panel.collapsed .debug-content {
                    display: none;
                }
                #debug-panel h3 {
                    margin: 0 0 10px 0;
                    color: #0cf;
                    font-size: 14px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: pointer;
                }
                #debug-panel h3 span {
                    font-size: 10px;
                    opacity: 0.6;
                }
                .debug-section {
                    margin-bottom: 15px;
                    padding-bottom: 10px;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                }
                .debug-section h4 {
                    margin: 0 0 8px 0;
                    color: #f4a644;
                    font-size: 11px;
                    text-transform: uppercase;
                }
                .debug-row {
                    display: flex;
                    align-items: center;
                    margin-bottom: 6px;
                    gap: 8px;
                }
                .debug-row label {
                    flex: 0 0 80px;
                    color: #aaa;
                    font-size: 10px;
                }
                .debug-row input[type="range"] {
                    flex: 1;
                    height: 4px;
                    -webkit-appearance: none;
                    background: rgba(255,255,255,0.2);
                    border-radius: 2px;
                    cursor: pointer;
                }
                .debug-row input[type="range"]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    width: 12px;
                    height: 12px;
                    background: #0cf;
                    border-radius: 50%;
                    cursor: pointer;
                }
                .debug-row .value {
                    flex: 0 0 45px;
                    text-align: right;
                    color: #0cf;
                    font-size: 10px;
                }
                .debug-info {
                    background: rgba(0,200,255,0.1);
                    padding: 8px;
                    border-radius: 4px;
                    margin-top: 10px;
                }
                .debug-info div {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 3px;
                }
                .debug-info span:last-child {
                    color: #0cf;
                }
                #debug-panel button {
                    background: rgba(0,200,255,0.2);
                    border: 1px solid rgba(0,200,255,0.4);
                    color: #fff;
                    padding: 5px 10px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 10px;
                    margin-right: 5px;
                }
                #debug-panel button:hover {
                    background: rgba(0,200,255,0.4);
                }
            </style>
            <h3 onclick="this.parentElement.classList.toggle('collapsed')">
                Ocean Cube Debug <span>[click to toggle]</span>
            </h3>
            <div class="debug-content">
                <div class="debug-section">
                    <h4>Cube Size</h4>
                    <div class="debug-row">
                        <label>Size (px)</label>
                        <input type="range" id="dbg-cubeSize" min="100" max="2000" step="10" value="${debugConfig.cubeSize}">
                        <span class="value" id="dbg-cubeSize-val">${debugConfig.cubeSize}</span>
                    </div>
                    <div class="debug-row">
                        <label>Perspective</label>
                        <input type="range" id="dbg-perspective" min="400" max="3000" step="50" value="${debugConfig.perspective}">
                        <span class="value" id="dbg-perspective-val">${debugConfig.perspective}</span>
                    </div>
                </div>
                <div class="debug-section">
                    <h4>Camera Motion</h4>
                    <div class="debug-row">
                        <label>Start Y</label>
                        <input type="range" id="dbg-startY" min="0" max="800" step="10" value="${debugConfig.startY}">
                        <span class="value" id="dbg-startY-val">${debugConfig.startY}</span>
                    </div>
                    <div class="debug-row">
                        <label>End Y</label>
                        <input type="range" id="dbg-endY" min="-600" max="0" step="10" value="${debugConfig.endY}">
                        <span class="value" id="dbg-endY-val">${debugConfig.endY}</span>
                    </div>
                    <div class="debug-row">
                        <label>Distance Z</label>
                        <input type="range" id="dbg-distanceZ" min="100" max="1000" step="10" value="${debugConfig.distanceZ}">
                        <span class="value" id="dbg-distanceZ-val">${debugConfig.distanceZ}</span>
                    </div>
                    <div class="debug-row">
                        <label>Smoothing</label>
                        <input type="range" id="dbg-smoothing" min="0.01" max="0.5" step="0.01" value="${debugConfig.smoothing}">
                        <span class="value" id="dbg-smoothing-val">${debugConfig.smoothing}</span>
                    </div>
                </div>
                <div class="debug-section">
                    <h4>Ocean Shader</h4>
                    <div class="debug-row">
                        <label>Wave Speed</label>
                        <input type="range" id="dbg-waveSpeed" min="0.1" max="5" step="0.1" value="${debugConfig.waveSpeed}">
                        <span class="value" id="dbg-waveSpeed-val">${debugConfig.waveSpeed}</span>
                    </div>
                    <div class="debug-row">
                        <label>Wave Scale</label>
                        <input type="range" id="dbg-waveScale" min="1" max="20" step="0.5" value="${debugConfig.waveScale}">
                        <span class="value" id="dbg-waveScale-val">${debugConfig.waveScale}</span>
                    </div>
                    <div class="debug-row">
                        <label>Wave Height</label>
                        <input type="range" id="dbg-waveHeight" min="0.01" max="0.5" step="0.01" value="${debugConfig.waveHeight}">
                        <span class="value" id="dbg-waveHeight-val">${debugConfig.waveHeight}</span>
                    </div>
                    <div class="debug-row">
                        <label>Normal Strength</label>
                        <input type="range" id="dbg-normalStrength" min="0.1" max="10" step="0.1" value="${debugConfig.normalStrength}">
                        <span class="value" id="dbg-normalStrength-val">${debugConfig.normalStrength}</span>
                    </div>
                    <div class="debug-row">
                        <label>Sun Intensity</label>
                        <input type="range" id="dbg-sunReflection" min="0" max="3" step="0.1" value="${debugConfig.sunReflection}">
                        <span class="value" id="dbg-sunReflection-val">${debugConfig.sunReflection}</span>
                    </div>
                    <div class="debug-row">
                        <label>Sun Angle</label>
                        <input type="range" id="dbg-sunAngle" min="0" max="360" step="5" value="${debugConfig.sunAngle}">
                        <span class="value" id="dbg-sunAngle-val">${debugConfig.sunAngle}°</span>
                    </div>
                    <div class="debug-row">
                        <label>Sun Height</label>
                        <input type="range" id="dbg-sunHeight" min="5" max="90" step="5" value="${debugConfig.sunHeight}">
                        <span class="value" id="dbg-sunHeight-val">${debugConfig.sunHeight}°</span>
                    </div>
                </div>
                <div class="debug-section">
                    <div class="debug-section-title">Skybox Plane</div>
                    <div class="debug-row">
                        <label>Plane Size</label>
                        <input type="range" id="dbg-skyboxPlaneSize" min="1000" max="20000" step="500" value="${debugConfig.skyboxPlaneSize}">
                        <span class="value" id="dbg-skyboxPlaneSize-val">${debugConfig.skyboxPlaneSize}</span>
                    </div>
                    <div class="debug-row">
                        <label>Plane Z</label>
                        <input type="range" id="dbg-skyboxPlaneZ" min="-5000" max="0" step="100" value="${debugConfig.skyboxPlaneZ}">
                        <span class="value" id="dbg-skyboxPlaneZ-val">${debugConfig.skyboxPlaneZ}</span>
                    </div>
                </div>
                <div class="debug-info">
                    <div><span>Current Y:</span><span id="dbg-info-currentY">0</span></div>
                    <div><span>Rotation:</span><span id="dbg-info-rotation">0°</span></div>
                    <div><span>Progress:</span><span id="dbg-info-progress">0%</span></div>
                </div>
                <div style="margin-top: 10px;">
                    <button onclick="copyDebugConfig()">Copy Config</button>
                    <button onclick="resetDebugConfig()">Reset</button>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // Setup event listeners for all sliders
        const sliders = ['cubeSize', 'perspective', 'startY', 'endY', 'distanceZ', 'smoothing',
                         'waveSpeed', 'waveScale', 'waveHeight', 'normalStrength', 'sunReflection',
                         'sunAngle', 'sunHeight', 'skyboxPlaneSize', 'skyboxPlaneZ'];
        sliders.forEach(key => {
            const slider = document.getElementById(`dbg-${key}`);
            const valueEl = document.getElementById(`dbg-${key}-val`);
            if (slider && valueEl) {
                slider.addEventListener('input', (e) => {
                    const val = parseFloat(e.target.value);
                    debugConfig[key] = val;
                    // Add degree symbol for angle values
                    if (key === 'sunAngle' || key === 'sunHeight') {
                        valueEl.textContent = val + '°';
                    } else {
                        valueEl.textContent = val;
                    }
                    applyDebugConfig();
                });
            }
        });
    }

    function applyDebugConfig() {
        // Apply cube size
        const cube = document.getElementById('ocean-cube');
        const scene = document.getElementById('ocean-scene');
        if (cube) {
            const size = debugConfig.cubeSize;
            const halfSize = size / 2;
            cube.style.width = `${size}px`;
            cube.style.height = `${size}px`;

            // Update all faces
            const faces = cube.querySelectorAll('.cube-face');
            faces.forEach(face => {
                face.style.width = `${size}px`;
                face.style.height = `${size}px`;
            });

            // Update transforms for faces
            const top = cube.querySelector('.cube-top');
            const front = cube.querySelector('.cube-front');
            const bottom = cube.querySelector('.cube-bottom');
            const left = cube.querySelector('.cube-left');
            const right = cube.querySelector('.cube-right');
            const back = cube.querySelector('.cube-back');

            if (top) top.style.transform = `rotateX(90deg) translateZ(${halfSize}px)`;
            if (front) front.style.transform = `translateZ(${halfSize}px)`;
            if (bottom) bottom.style.transform = `rotateX(-90deg) translateZ(${halfSize}px)`;
            if (left) left.style.transform = `rotateY(-90deg) translateZ(${halfSize}px)`;
            if (right) right.style.transform = `rotateY(90deg) translateZ(${halfSize}px)`;
            if (back) back.style.transform = `rotateY(180deg) translateZ(${halfSize}px)`;
        }

        // Apply perspective
        if (scene) {
            scene.style.perspective = `${debugConfig.perspective}px`;
        }

        // Apply skybox plane settings
        const skyboxPlane = document.getElementById('skybox-sphere');
        if (skyboxPlane) {
            const size = debugConfig.skyboxPlaneSize;
            const z = debugConfig.skyboxPlaneZ;
            skyboxPlane.style.width = `${size}px`;
            skyboxPlane.style.height = `${size}px`;
            skyboxPlane.style.transform = `translate(-50%, -50%) translateZ(${z}px)`;
        }
    }

    function updateDebugInfo(currentY, rotation, progress) {
        const yEl = document.getElementById('dbg-info-currentY');
        const rotEl = document.getElementById('dbg-info-rotation');
        const progEl = document.getElementById('dbg-info-progress');
        if (yEl) yEl.textContent = currentY.toFixed(1);
        if (rotEl) rotEl.textContent = rotation.toFixed(1) + '°';
        if (progEl) progEl.textContent = (progress * 100).toFixed(1) + '%';
    }

    window.copyDebugConfig = function() {
        const config = JSON.stringify(debugConfig, null, 2);
        navigator.clipboard.writeText(config).then(() => {
            alert('Config copied to clipboard!');
        });
    };

    window.resetDebugConfig = function() {
        debugConfig.cubeSize = 400;
        debugConfig.startY = 350;
        debugConfig.endY = -250;
        debugConfig.distanceZ = 250;
        debugConfig.perspective = 1200;
        debugConfig.smoothing = 0.15;
        // Ocean shader defaults
        debugConfig.waveSpeed = 1.0;
        debugConfig.waveScale = 4.0;
        debugConfig.waveHeight = 0.15;
        debugConfig.foamThreshold = 0.6;
        debugConfig.foamIntensity = 0.4;
        debugConfig.sunReflection = 0.6;
        debugConfig.causticScale = 6.0;
        debugConfig.causticIntensity = 0.2;
        // Skybox plane defaults
        debugConfig.skyboxPlaneSize = 6000;
        debugConfig.skyboxPlaneZ = -1200;

        // Update sliders
        const sliderKeys = ['cubeSize', 'perspective', 'startY', 'endY', 'distanceZ', 'smoothing',
                           'waveSpeed', 'waveScale', 'waveHeight', 'foamThreshold', 'foamIntensity',
                           'sunReflection', 'causticScale', 'causticIntensity',
                           'skyboxPlaneSize', 'skyboxPlaneZ'];
        sliderKeys.forEach(key => {
            const slider = document.getElementById(`dbg-${key}`);
            const valueEl = document.getElementById(`dbg-${key}-val`);
            if (slider && valueEl) {
                slider.value = debugConfig[key];
                valueEl.textContent = debugConfig[key];
            }
        });
        applyDebugConfig();
    };

    // Create debug panel on load and apply initial config
    createDebugPanel();
    applyDebugConfig();

    // =========================================
    // OCEAN CUBE 3D CONTROLLER - GLASS ELEVATOR
    // =========================================
    // OCEAN SURFACE - Full-screen 3D perspective ocean
    // =========================================
    class OceanSurface {
        constructor() {
            this.canvas = document.getElementById('ocean-surface-canvas');
            this.depthLabel = document.getElementById('depth-label');
            this.transitionOverlay = document.getElementById('underwater-transition');
            this.surfaceShader = null;
            this.currentPhase = 1;
            this.transitionTriggered = false;

            // Scroll lock state - simpler approach
            // Instead of complex virtual scroll, we map the progress to pause at swimming position
            this.lockProgress = 0.45; // Where camera aligns with horizon
            this.transitionStart = 0.55; // When transition begins
            this.rawProgress = 0;

            this.init();
        }

        init() {
            if (this.canvas) {
                // Initialize WebGL shader for ocean surface
                this.surfaceShader = new OceanSurfaceShader(this.canvas, debugConfig);
                window.addEventListener('resize', () => {
                    if (this.surfaceShader) {
                        this.surfaceShader.resize();
                    }
                });
            }
        }

        // Called with scroll progress through the surface zone (0 to 1)
        updateScroll(surfaceProgress) {
            this.rawProgress = surfaceProgress;

            // Remap progress to create a "pause" at the swimming position
            // Progress 0-0.3: Normal descent (maps to shader 0-0.45)
            // Progress 0.3-0.5: Stay at swimming position (shader stays at 0.45)
            // Progress 0.5-1.0: Transition (maps to shader 0.45-1.0)
            let effectiveProgress;

            if (surfaceProgress < 0.30) {
                // Normal descent - map 0-0.3 to 0-0.45
                effectiveProgress = (surfaceProgress / 0.30) * 0.45;
            } else if (surfaceProgress < 0.50) {
                // Paused at swimming position
                effectiveProgress = 0.45;
            } else {
                // Transition phase - map 0.5-1.0 to 0.45-1.0
                const t = (surfaceProgress - 0.50) / 0.50;
                effectiveProgress = 0.45 + t * 0.55;
            }

            let phaseInfo = { phase: 1, progress: effectiveProgress };

            if (this.surfaceShader) {
                phaseInfo = this.surfaceShader.updateCamera(effectiveProgress);
            }

            this.currentPhase = phaseInfo.phase;

            // Update depth label based on phase
            if (this.depthLabel) {
                if (phaseInfo.phase === 1) {
                    this.depthLabel.textContent = 'Above Surface';
                    this.depthLabel.style.opacity = 1;
                } else if (phaseInfo.phase === 2) {
                    this.depthLabel.textContent = 'Descending';
                    this.depthLabel.style.opacity = 1;
                } else if (phaseInfo.phase === 3) {
                    this.depthLabel.textContent = 'Near Surface';
                    this.depthLabel.style.opacity = 1;
                } else if (phaseInfo.phase === 4) {
                    this.depthLabel.textContent = 'Sea Level';
                    this.depthLabel.style.opacity = 1;
                } else {
                    // Phase 5 - transitioning underwater
                    this.depthLabel.textContent = 'Diving...';
                    const fadeT = (effectiveProgress - 0.7) / 0.15;
                    this.depthLabel.style.opacity = Math.max(0, 1 - fadeT);
                }
            }

            // Handle underwater transition overlay - starts at phase 5 (70% effective progress)
            if (this.transitionOverlay) {
                if (phaseInfo.phase >= 5) {
                    // Phase 5: Transition - show bubbles and blur
                    if (!this.transitionTriggered) {
                        this.transitionOverlay.classList.add('active');
                        this.transitionTriggered = true;
                    }

                    // Progress through phase 5 (effective 0.70 to 1.0)
                    const transitionT = (effectiveProgress - 0.70) / 0.30;

                    // Add fading class after bubbles have risen a bit (fade to black)
                    if (transitionT > 0.4) {
                        this.transitionOverlay.classList.add('fading');
                    }
                } else {
                    // Not in transition yet - remove overlay
                    this.transitionOverlay.classList.remove('active', 'fading');
                    this.transitionTriggered = false;
                }
            }

            return { effectiveProgress, phase: phaseInfo.phase };
        }

        render(deltaTime) {
            if (this.surfaceShader) {
                this.surfaceShader.render(deltaTime);
            }
        }

        // Check if we should hide the ocean canvas (fully transitioned)
        shouldHide() {
            return this.currentPhase >= 5 && this.transitionTriggered;
        }
    }

    // =========================================
    // INITIALIZATION
    // =========================================

    // Environment renderer
    const envCanvas = document.getElementById('environment-canvas');
    let envRenderer = null;
    if (envCanvas) {
        envRenderer = new EnvironmentRenderer(envCanvas);
    }

    // Ocean Surface (full-screen 3D perspective)
    const oceanCanvas = document.getElementById('ocean-surface-canvas');
    let oceanSurface = null;
    if (oceanCanvas) {
        oceanSurface = new OceanSurface();
    }

    // Zone manager
    const zoneManager = new ZoneManager();

    // Fish boids
    const aquariumCanvas = document.getElementById('aquarium-canvas');
    let fishBoids = null;
    if (aquariumCanvas) {
        fishBoids = new FishBoids(aquariumCanvas);
    }

    // Crystal particles
    const crystalCanvas = document.getElementById('crystal-particles');
    let crystalParticles = null;
    if (crystalCanvas) {
        crystalParticles = new CrystalParticles(crystalCanvas);
    }

    // Skybox parallax
    const skyboxView = document.getElementById('skybox-view');
    let skyboxParallax = null;
    if (skyboxView) {
        skyboxParallax = new SkyboxParallax(skyboxView);
    }

    // Ocean scene skybox removed - using environment-canvas instead

    // Splash effect
    const splashContainer = document.getElementById('splash-effects');
    let splashEffect = null;
    if (splashContainer) {
        splashEffect = new SplashEffect(splashContainer);
    }

    // Track if splash has been triggered
    let splashTriggered = false;

    // =========================================
    // EVENT LISTENERS
    // =========================================

    // Scroll handling
    let ticking = false;

    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(() => {
                const scrollY = window.pageYOffset;
                zoneManager.updateScroll(scrollY);

                // Update ocean surface - extends beyond surface zone for longer experience
                if (oceanSurface) {
                    const overlookZone = document.querySelector('.zone-overlook');
                    const surfaceZone = document.querySelector('.zone-surface');
                    const aquariumZone = document.querySelector('.zone-aquarium');

                    if (surfaceZone && overlookZone) {
                        const overlookRect = overlookZone.getBoundingClientRect();
                        const surfaceRect = surfaceZone.getBoundingClientRect();
                        const viewportHeight = window.innerHeight;

                        // Ocean becomes visible when overlook is 50% scrolled through
                        // and stays visible until aquarium zone is mostly visible
                        const overlookProgress = 1 - (overlookRect.bottom / (overlookRect.height + viewportHeight));
                        const startThreshold = 0.4; // Start showing ocean at 40% through overlook

                        // Calculate extended progress:
                        // - Overlook 40-100% maps to ocean 0-0.2
                        // - Surface 0-100% maps to ocean 0.2-0.9
                        // - Aquarium 0-30% maps to ocean 0.9-1.0
                        let oceanProgress = 0;
                        let isOceanVisible = false;

                        if (overlookProgress >= startThreshold && surfaceRect.top > 0) {
                            // In overlook zone, after threshold - fade in ocean
                            const t = (overlookProgress - startThreshold) / (1 - startThreshold);
                            oceanProgress = t * 0.2;
                            isOceanVisible = true;
                        } else if (surfaceRect.top <= viewportHeight && surfaceRect.bottom > 0) {
                            // In surface zone
                            const surfaceProgress = 1 - (surfaceRect.bottom / (surfaceRect.height + viewportHeight));
                            oceanProgress = 0.2 + surfaceProgress * 0.7;
                            isOceanVisible = true;
                        } else if (surfaceRect.bottom <= 0 && aquariumZone) {
                            // Past surface zone, in aquarium - fade out
                            const aquariumRect = aquariumZone.getBoundingClientRect();
                            const aquariumProgress = 1 - (aquariumRect.bottom / (aquariumRect.height + viewportHeight));
                            if (aquariumProgress < 0.3) {
                                oceanProgress = 0.9 + aquariumProgress * 0.33;
                                isOceanVisible = true;
                            }
                        }

                        // Toggle canvas visibility
                        if (oceanSurface.canvas) {
                            oceanSurface.canvas.classList.toggle('visible', isOceanVisible);
                        }

                        if (isOceanVisible) {
                            oceanSurface.updateScroll(Math.min(1, oceanProgress));
                        }
                    }
                }

                // Trigger splash when crossing surface
                if (!splashTriggered && state.isUnderwater && splashEffect) {
                    splashEffect.trigger();
                    splashTriggered = true;
                }
                if (!state.isUnderwater) {
                    splashTriggered = false;
                }

                ticking = false;
            });
            ticking = true;
        }
    });

    // Mouse tracking
    document.addEventListener('mousemove', (e) => {
        state.mouse.x = e.clientX / window.innerWidth;
        state.mouse.y = e.clientY / window.innerHeight;

        // Update fish boids mouse position
        if (fishBoids && aquariumCanvas) {
            const rect = aquariumCanvas.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom) {
                fishBoids.setMouse(
                    (e.clientX - rect.left),
                    (e.clientY - rect.top),
                    true
                );
            } else {
                fishBoids.setMouse(0, 0, false);
            }
        }
    });

    // =========================================
    // NAVIGATION
    // =========================================
    const nav = document.getElementById('nav');
    let navLastScrollY = 0;

    window.addEventListener('scroll', () => {
        const currentScrollY = window.pageYOffset;

        if (currentScrollY > 100) {
            nav?.classList.add('scrolled');
        } else {
            nav?.classList.remove('scrolled');
        }

        navLastScrollY = currentScrollY;
    });

    // Smooth scroll for nav links
    document.querySelectorAll('.nav-link, .nav-logo, .mobile-nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            const href = link.getAttribute('href');
            if (href && href.startsWith('#')) {
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth' });
                    document.querySelector('.mobile-nav')?.classList.remove('open');
                }
            }
        });
    });

    // Mobile nav toggle
    const navToggle = document.querySelector('.nav-toggle');
    const mobileNav = document.querySelector('.mobile-nav');

    navToggle?.addEventListener('click', () => {
        mobileNav?.classList.toggle('open');
    });

    // =========================================
    // CREATURE HOVER INTERACTIONS
    // =========================================
    document.querySelectorAll('.creature').forEach(creature => {
        creature.addEventListener('mouseenter', () => {
            creature.classList.add('active');
        });

        creature.addEventListener('mouseleave', () => {
            creature.classList.remove('active');
        });
    });

    // =========================================
    // POSTER HOVER EFFECTS
    // =========================================
    document.querySelectorAll('.poster').forEach(poster => {
        poster.addEventListener('mouseenter', () => {
            poster.classList.add('hovered');
        });

        poster.addEventListener('mouseleave', () => {
            poster.classList.remove('hovered');
        });
    });

    // =========================================
    // SCREEN HOVER EFFECTS
    // =========================================
    document.querySelectorAll('.screen').forEach(screen => {
        screen.addEventListener('mouseenter', () => {
            screen.classList.add('hovered');
        });

        screen.addEventListener('mouseleave', () => {
            screen.classList.remove('hovered');
        });
    });

    // =========================================
    // ANIMATION LOOP
    // =========================================
    let lastTime = performance.now();

    function animate(currentTime) {
        const deltaTime = (currentTime - lastTime) / 1000;
        lastTime = currentTime;
        state.time = currentTime;

        // Update environment renderer
        if (envRenderer) {
            envRenderer.update(deltaTime);

            // Render based on current zone
            const gl = envRenderer.gl;
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);

            // Render skybox for sky and overlook zones
            // Surface zone has its own ocean canvas that renders on top
            if (state.currentZone === 'sky' || state.currentZone === 'overlook') {
                envRenderer.render('skybox', {
                    scrollProgress: state.scrollProgress,
                    mouse: [state.mouse.x, state.mouse.y]
                });
            } else if (state.currentZone === 'surface') {
                // Surface zone: ocean canvas renders on top, keep env canvas dark
                gl.clearColor(0.02, 0.05, 0.08, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);
            } else if (state.currentZone === 'aquarium' || state.currentZone === 'bunker') {
                envRenderer.render('underwater', {
                    scrollProgress: state.scrollProgress
                });
            }
        }

        // Update skybox parallax (gallery window)
        if (skyboxParallax) {
            skyboxParallax.update(state.scrollProgress, currentTime);
        }

        // Render ocean surface shader when visible (controlled by .visible class)
        if (oceanSurface && oceanSurface.canvas) {
            if (oceanSurface.canvas.classList.contains('visible')) {
                oceanSurface.render(deltaTime);
            }
        }

        // Update fish boids
        if (fishBoids && (state.currentZone === 'aquarium' || state.currentZone === 'bunker' || state.currentZone === 'surface')) {
            fishBoids.update(currentTime);
            fishBoids.draw(currentTime);
        }

        // Update crystal particles
        if (crystalParticles && state.currentZone === 'mine') {
            crystalParticles.update(currentTime);
            crystalParticles.draw(currentTime);
        }

        requestAnimationFrame(animate);
    }

    // Start animation loop
    requestAnimationFrame(animate);

    // =========================================
    // SCROLL ANIMATIONS (INTERSECTION OBSERVER)
    // =========================================
    const animateOnScroll = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.poster, .screen, .contact-link, .section-label').forEach(el => {
        animateOnScroll.observe(el);
    });

    // =========================================
    // MAGNETIC BUTTONS
    // =========================================
    if (window.matchMedia('(pointer: fine)').matches) {
        const magneticElements = document.querySelectorAll('.nav-cta, .contact-link');

        magneticElements.forEach(el => {
            el.addEventListener('mousemove', (e) => {
                const rect = el.getBoundingClientRect();
                const x = e.clientX - rect.left - rect.width / 2;
                const y = e.clientY - rect.top - rect.height / 2;

                el.style.transform = `translate(${x * 0.1}px, ${y * 0.1}px)`;
            });

            el.addEventListener('mouseleave', () => {
                el.style.transform = '';
            });
        });
    }

    console.log('🌊 Portfolio initialized - Vertical Journey');
});
