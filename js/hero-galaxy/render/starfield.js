// Stationary star particles in a huge surrounding shell. Reuses the
// vendored particle engine. NOTE: createParticleSystem in this engine creates
// its own device; passing the canvas hands it over. Since our mesh pipeline
// already owns the canvas's webgpu context, we run the starfield in its own
// pass (engine encodes + submits internally). The engine clears the swap
// target, so we sequence: starfield clears + draws stars → then our mesh
// pass with loadOp:'load' preserves stars beneath the meshes.

export async function mountStarfield({ canvas, particleCount = 20000 }) {
    const { createParticleSystem, Emitter, shapes } = await import('../../particles/index.js');
    const ps = await createParticleSystem({
        canvas,
        backend: 'webgpu',
        maxParticles: Math.max(particleCount + 2000, 22000),
        blend: 'additive',
    });
    // Three nested shells at different radii break the visible angular
    // banding that a single shell produces — combined they look like a
    // genuine 3D cloud rather than samples on a sphere surface.
    const layers = [
        { radius: 900,  thickness: 160, count: Math.floor(particleCount * 0.55), sizeMin: 0.18, sizeMax: 0.45, color: [0.85, 0.85, 0.95, 1] },
        { radius: 1400, thickness: 220, count: Math.floor(particleCount * 0.30), sizeMin: 0.14, sizeMax: 0.32, color: [0.80, 0.82, 1.00, 1] },
        { radius: 2000, thickness: 280, count: Math.floor(particleCount * 0.15), sizeMin: 0.10, sizeMax: 0.22, color: [0.92, 0.86, 0.82, 1] },
    ];
    for (const L of layers) {
        await ps.addEmitter(new Emitter({
            position: [0, 0, 0],
            shape: shapes.sphere({ radius: L.radius, shell: true, thickness: L.thickness }),
            rate: 0,
            bursts: [{ time: 0, count: L.count }],
            initial: {
                lifetime: { min: 1e9, max: 1e9 },
                speed:    { min: 0, max: 0 },
                size:     { min: L.sizeMin, max: L.sizeMax },
                color:    L.color,
            },
            modules: [],
        }));
    }
    return ps;
}
