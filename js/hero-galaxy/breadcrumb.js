// Builds + updates the <ol id="breadcrumb-list"> based on scene state.
// Click any non-active crumb to invoke the corresponding transition handler.

export function createBreadcrumb({ root, galaxyData, onCrumbClick }) {
    const ol = root.querySelector('#breadcrumb-list');
    if (!ol) throw new Error('no #breadcrumb-list');

    function render(state) {
        const items = [{ key: 'galaxy', label: 'Galaxy', active: state.level === 'galaxy' }];
        if (state.focusedSystemId) {
            const sys = galaxyData.systems.find(s => s.id === state.focusedSystemId);
            items.push({
                key: `system:${state.focusedSystemId}`,
                label: sys?.name || state.focusedSystemId,
                active: state.level === 'system',
            });
        }
        if (state.focusedPlanetId) {
            const sys = galaxyData.systems.find(s => s.id === state.focusedSystemId);
            const pl  = sys?.planets.find(p => p.id === state.focusedPlanetId);
            items.push({
                key: `planet:${state.focusedPlanetId}`,
                label: pl?.name || state.focusedPlanetId,
                active: state.level === 'planet',
            });
        }
        ol.innerHTML = items.map(it =>
            `<li class="${it.active ? 'is-active' : ''}" data-key="${it.key}">${escapeHtml(it.label)}</li>`
        ).join('');
        for (const li of ol.querySelectorAll('li')) {
            if (li.classList.contains('is-active')) continue;
            li.addEventListener('click', () => onCrumbClick(li.dataset.key));
        }
    }
    return { render };
}

function escapeHtml(s) {
    return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
