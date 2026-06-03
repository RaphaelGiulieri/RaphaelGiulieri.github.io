// Icosphere — recursively-subdivided icosahedron. Returns interleaved
// vertex data (position x3, normal x3 = 6 floats per vertex) and a u16/u32
// index buffer. Subdivision=5 yields ~10k verts, =4 ~2.5k, =3 ~640.

export function makeIcosphere(subdivisions = 5) {
    const t = (1 + Math.sqrt(5)) / 2;
    let verts = [
        [-1,  t,  0], [ 1,  t,  0], [-1, -t,  0], [ 1, -t,  0],
        [ 0, -1,  t], [ 0,  1,  t], [ 0, -1, -t], [ 0,  1, -t],
        [ t,  0, -1], [ t,  0,  1], [-t,  0, -1], [-t,  0,  1],
    ].map(v => normalise(v));

    let faces = [
        [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
        [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
        [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
        [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
    ];

    const mid = new Map();
    function midpoint(a, b) {
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (mid.has(key)) return mid.get(key);
        const pa = verts[a], pb = verts[b];
        const m = normalise([(pa[0]+pb[0])*0.5, (pa[1]+pb[1])*0.5, (pa[2]+pb[2])*0.5]);
        const idx = verts.length;
        verts.push(m);
        mid.set(key, idx);
        return idx;
    }
    for (let s = 0; s < subdivisions; s++) {
        const next = [];
        for (const [a, b, c] of faces) {
            const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
            next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
        }
        faces = next;
        mid.clear();
    }

    const vertexData = new Float32Array(verts.length * 6);
    for (let i = 0; i < verts.length; i++) {
        const v = verts[i];
        vertexData[i*6    ] = v[0]; vertexData[i*6 + 1] = v[1]; vertexData[i*6 + 2] = v[2];
        vertexData[i*6 + 3] = v[0]; vertexData[i*6 + 4] = v[1]; vertexData[i*6 + 5] = v[2];
    }

    const idxCount = faces.length * 3;
    const Idx = idxCount > 65535 ? Uint32Array : Uint16Array;
    const indexData = new Idx(idxCount);
    for (let i = 0; i < faces.length; i++) {
        indexData[i*3    ] = faces[i][0];
        indexData[i*3 + 1] = faces[i][1];
        indexData[i*3 + 2] = faces[i][2];
    }

    return {
        vertexData,
        indexData,
        vertexCount: verts.length,
        indexCount: idxCount,
        indexFormat: Idx === Uint16Array ? 'uint16' : 'uint32',
    };
}

function normalise(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0]/l, v[1]/l, v[2]/l];
}
