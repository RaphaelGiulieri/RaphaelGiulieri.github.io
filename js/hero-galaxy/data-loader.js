// Loads data/hero-galaxy.json + cross-references projects.json so each moon
// carries the real project title and cover path. Validates required keys; an
// unresolved projectId logs a warning and the moon stays renderable with a
// placeholder name (still navigable, just less informative).

const GALAXY_URL = new URL('../../data/hero-galaxy.json', import.meta.url);
const PROJECTS_URL = new URL('../../data/projects.json', import.meta.url);

export async function loadGalaxyData() {
    const [galaxyRes, projectsRes] = await Promise.all([
        fetch(GALAXY_URL), fetch(PROJECTS_URL),
    ]);
    if (!galaxyRes.ok)  throw new Error(`galaxy json ${galaxyRes.status}`);
    if (!projectsRes.ok) throw new Error(`projects json ${projectsRes.status}`);
    const galaxy   = await galaxyRes.json();
    const projects = await projectsRes.json();
    if (!Array.isArray(galaxy.systems) || galaxy.systems.length === 0) {
        throw new Error('galaxy.systems is missing or empty');
    }
    const byId = new Map(projects.projects.map(p => [p.id, p]));

    for (const sys of galaxy.systems) {
        for (const planet of sys.planets) {
            for (const moon of planet.moons || []) {
                const proj = byId.get(moon.projectId);
                if (proj) {
                    moon.title = proj.title;
                    moon.cover = proj.cover;
                } else {
                    console.warn('[hero-galaxy] unresolved projectId:', moon.projectId);
                    moon.title = moon.projectId;
                    moon.cover = null;
                }
            }
        }
    }
    return galaxy;
}

// Hex like "#ff4b1f" → [r, g, b, a] in [0,1]
export function parseAccent(hex, a = 1) {
    const m = hex.replace('#', '');
    return [
        parseInt(m.substr(0, 2), 16) / 255,
        parseInt(m.substr(2, 2), 16) / 255,
        parseInt(m.substr(4, 2), 16) / 255,
        a,
    ];
}
