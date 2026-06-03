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
    await ps.addEmitter(new Emitter({
        position: [0, 0, 0],
        shape: shapes.sphere({ radius: 500, shell: true, thickness: 30 }),
        rate: 0,
        bursts: [{ time: 0, count: particleCount }],
        initial: {
            lifetime: { min: 1e9, max: 1e9 },
            speed:    { min: 0, max: 0 },
            size:     { min: 0.3, max: 0.9 },
            color:    [0.85, 0.85, 0.95, 1],
        },
        modules: [],
    }));
    return ps;
}
