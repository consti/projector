// Minimal glTF 2.0 binary writer: one mesh, one primitive, vertex colours,
// the rig as a custom _BONE attribute (bone id, weight, ambient occlusion),
// and the bone pivots in the node's extras.

const pad4 = (n) => (n + 3) & ~3;

function concat(parts) {
  let n = 0;
  for (const p of parts) n += pad4(p.byteLength);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), o); o += pad4(p.byteLength); }
  return out;
}

/**
 * @param {object} m  { name, positions: Float32Array, normals: Float32Array,
 *   colors: Uint8Array (rgb), bones: Uint8Array (id, weight, ao, 0), indices: Uint32Array,
 *   rig: [{ name, pivot }], extras: object }
 * @returns {Uint8Array} the .glb bytes
 */
export function writeGlb(m) {
  const n = m.positions.length / 3;
  const views = [];
  const accessors = [];
  const bufParts = [];
  let offset = 0;
  const add = (arr, componentType, type, count, opts = {}) => {
    const byteLength = arr.byteLength;
    views.push({ buffer: 0, byteOffset: offset, byteLength, ...(opts.target ? { target: opts.target } : {}) });
    bufParts.push(arr);
    offset += pad4(byteLength);
    accessors.push({ bufferView: views.length - 1, componentType, count, type, ...(opts.normalized ? { normalized: true } : {}), ...(opts.minmax || {}) });
    return accessors.length - 1;
  };
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
    const v = m.positions[i * 3 + c];
    if (v < min[c]) min[c] = v;
    if (v > max[c]) max[c] = v;
  }
  const aPos = add(m.positions, 5126, 'VEC3', n, { target: 34962, minmax: { min, max } });
  const aNrm = add(m.normals, 5126, 'VEC3', n, { target: 34962 });
  const aCol = add(m.colors, 5121, 'VEC3', n, { target: 34962, normalized: true });
  const aBone = add(m.bones, 5121, 'VEC4', n, { target: 34962, normalized: true });
  const aIdx = add(m.indices, 5125, 'SCALAR', m.indices.length, { target: 34963 });
  const bin = concat(bufParts);

  const json = {
    asset: { version: '2.0', generator: 'projector build-models' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: m.name, mesh: 0, extras: { rig: m.rig, ...(m.extras || {}) } }],
    meshes: [{ name: m.name, primitives: [{ attributes: { POSITION: aPos, NORMAL: aNrm, COLOR_0: aCol, _BONE: aBone }, indices: aIdx, material: 0, mode: 4 }] }],
    materials: [{ name: m.name, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 }, doubleSided: false }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: bin.byteLength }],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  if (jsonBytes.byteLength % 4) {
    const padded = new Uint8Array(pad4(jsonBytes.byteLength)).fill(0x20);
    padded.set(jsonBytes); jsonBytes = padded;
  }
  const total = 12 + 8 + jsonBytes.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.byteLength, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binOff = 20 + jsonBytes.byteLength;
  dv.setUint32(binOff, bin.byteLength, true); dv.setUint32(binOff + 4, 0x004e4942, true);
  out.set(bin, binOff + 8);
  return out;
}
