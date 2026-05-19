/* =====================================================
   OCEAN SURFACE SHADER
   Full-screen WebGL shader for ocean with 3D perspective
   Loads GLSL from external files for easier editing
   ===================================================== */

class OceanSurfaceShader {
    constructor(canvas, debugConfig) {
        this.canvas = canvas;
        this.debugConfig = debugConfig;
        this.gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

        if (!this.gl) {
            console.warn('WebGL not supported for ocean surface shader');
            return;
        }

        this.time = 0;
        this.program = null;
        this.buffer = null;
        this.ready = false;
        this.skyboxTexture = null;
        this.skyboxLoaded = false;

        // Camera state - controlled by scroll
        this.cameraHeight = 3.0;   // Height above water
        this.cameraPitch = -0.15;  // Looking slightly down toward horizon

        this.init();
    }

    async init() {
        const gl = this.gl;

        try {
            // Load shader sources from external files
            const [vertexSource, fragmentSource] = await Promise.all([
                fetch('js/shaders/ocean-surface.vert.glsl').then(r => r.text()),
                fetch('js/shaders/ocean-surface.frag.glsl').then(r => r.text())
            ]);

            this.program = this.createProgram(vertexSource, fragmentSource);

            if (!this.program) {
                console.error('Failed to create ocean surface shader program');
                return;
            }

            // Create fullscreen quad
            const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
            this.buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

            // Load skybox texture
            this.loadSkyboxTexture('assets/skybox/sky_06_2k.png');

            this.resize();
            window.addEventListener('resize', () => this.resize());

            this.ready = true;
            console.log('Ocean surface shader loaded successfully');

        } catch (error) {
            console.error('Failed to load ocean surface shaders:', error);
        }
    }

    loadSkyboxTexture(url) {
        const gl = this.gl;

        this.skyboxTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.skyboxTexture);

        // Placeholder pixel while loading
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
            new Uint8Array([128, 128, 128, 255]));

        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            gl.bindTexture(gl.TEXTURE_2D, this.skyboxTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            this.skyboxLoaded = true;
            console.log('Ocean surface skybox texture loaded');
        };
        image.onerror = () => {
            console.warn('Failed to load skybox texture for ocean surface');
        };
        image.src = url;
    }

    createProgram(vertexSource, fragmentSource) {
        const gl = this.gl;

        const vertexShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertexShader, vertexSource);
        gl.compileShader(vertexShader);

        if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
            console.error('Ocean surface vertex shader error:', gl.getShaderInfoLog(vertexShader));
            return null;
        }

        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragmentShader, fragmentSource);
        gl.compileShader(fragmentShader);

        if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
            console.error('Ocean surface fragment shader error:', gl.getShaderInfoLog(fragmentShader));
            return null;
        }

        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Ocean surface program link error:', gl.getProgramInfoLog(program));
            return null;
        }

        return program;
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        // Full viewport sizing
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        if (this.gl) {
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    // Update camera based on scroll progress within this zone
    // Returns the current phase for transition handling
    updateCamera(scrollProgress) {
        // scrollProgress: 0 = top of zone, 1 = bottom
        //
        // REVISED PHASES - align to horizon much earlier:
        // Phase 1 (0-0.15): High above water, tilted down looking at waves
        // Phase 2 (0.15-0.30): Descend toward surface, still looking down
        // Phase 3 (0.30-0.45): Level out to horizontal as we approach surface
        // Phase 4 (0.45-0.70): SWIMMING - at sea level, horizon centered (LOCK POINT)
        // Phase 5 (0.70-1.0): Transition - bubbles/blur overlay

        let phase = 1;

        if (scrollProgress < 0.15) {
            // Phase 1: High above, looking down at the ocean
            phase = 1;
            const t = scrollProgress / 0.15;
            this.cameraHeight = 2.0 - t * 1.2; // 2.0 to 0.8
            this.cameraPitch = -0.25 - t * 0.15; // -0.25 to -0.4 (tilt down)
        } else if (scrollProgress < 0.30) {
            // Phase 2: Getting closer to surface, still looking at waves
            phase = 2;
            const t = (scrollProgress - 0.15) / 0.15;
            this.cameraHeight = 0.8 - t * 0.6; // 0.8 to 0.2
            this.cameraPitch = -0.4; // Keep looking down at waves
        } else if (scrollProgress < 0.45) {
            // Phase 3: Near surface, level out to horizontal
            phase = 3;
            const t = (scrollProgress - 0.30) / 0.15;
            this.cameraHeight = 0.2 - t * 0.15; // 0.2 to 0.05
            this.cameraPitch = -0.4 + t * 0.4; // -0.4 to 0.0 (level out to horizon)
        } else if (scrollProgress < 0.70) {
            // Phase 4: SWIMMING POSITION - head at water level, horizon in center
            // This is the LOCK POINT - camera stays perfectly aligned here
            phase = 4;
            this.cameraHeight = 0.05; // Just above water
            this.cameraPitch = 0.0; // Looking at horizon (sky top half, water bottom half)
        } else {
            // Phase 5: Transition - bubbles and blur take over
            phase = 5;
            this.cameraHeight = 0.05;
            this.cameraPitch = 0.0;
        }

        return { phase, progress: scrollProgress };
    }

    render(deltaTime) {
        if (!this.ready || !this.gl || !this.program) return;

        this.time += deltaTime;

        const gl = this.gl;
        const config = this.debugConfig;

        gl.useProgram(this.program);

        // Set up attributes
        const position = gl.getAttribLocation(this.program, 'position');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

        // Set uniforms
        gl.uniform1f(gl.getUniformLocation(this.program, 'time'), this.time);
        gl.uniform2f(gl.getUniformLocation(this.program, 'resolution'), this.canvas.width, this.canvas.height);

        // Wave parameters
        gl.uniform1f(gl.getUniformLocation(this.program, 'waveSpeed'), config.waveSpeed);
        gl.uniform1f(gl.getUniformLocation(this.program, 'waveScale'), config.waveScale);
        gl.uniform1f(gl.getUniformLocation(this.program, 'waveHeight'), config.waveHeight);
        gl.uniform1f(gl.getUniformLocation(this.program, 'normalStrength'), config.normalStrength);

        // Colors
        gl.uniform3f(gl.getUniformLocation(this.program, 'deepColor'),
            config.deepColor.r, config.deepColor.g, config.deepColor.b);
        gl.uniform3f(gl.getUniformLocation(this.program, 'shallowColor'),
            config.shallowColor.r, config.shallowColor.g, config.shallowColor.b);

        // Lighting
        gl.uniform1f(gl.getUniformLocation(this.program, 'sunReflection'), config.sunReflection);
        // Convert angle/height to direction using the global function
        const sunDir = getSunDirection();
        gl.uniform3f(gl.getUniformLocation(this.program, 'sunDir'),
            sunDir.x, sunDir.y, sunDir.z);

        // Camera uniforms
        gl.uniform1f(gl.getUniformLocation(this.program, 'cameraHeight'), this.cameraHeight);
        gl.uniform1f(gl.getUniformLocation(this.program, 'cameraPitch'), this.cameraPitch);

        // Skybox texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.skyboxTexture);
        gl.uniform1i(gl.getUniformLocation(this.program, 'skyboxTex'), 0);
        gl.uniform1f(gl.getUniformLocation(this.program, 'skyboxLoaded'), this.skyboxLoaded ? 1.0 : 0.0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
}
