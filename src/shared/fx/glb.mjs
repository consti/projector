// A small glTF 2.0 binary reader for the toy models: enough to pull the
// single primitive, its vertex colours and the rig attribute out of a .glb
// written by scripts/build-models.mjs (or any other tool that keeps to one
// mesh with those attributes). Pure JS, so the preview renderer in Node and
// the effects in the renderer share it.

const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/**
 * @param {ArrayBuffer} buf
 * @returns {{ name, positions: Float32Array, normals: Float32Array|null, colors: Uint8Array|null,
 *   bones: Uint8Array|null, indices: Uint32Array, rig: Array, bounds: {min, max}, count: number }}
 */
export function parseGlb(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb');
  const total = dv.getUint32(8, true);
  let o = 12, json = null, bin = null;
  while (o < total) {
    const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
    const chunk = new Uint8Array(buf, o + 8, len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    o += 8 + len;
  }
  if (!json || !bin) throw new Error('glb without json/bin chunks');

  const accessor = (i) => {
    const a = json.accessors[i];
    const v = json.bufferViews[a.bufferView];
    const T = CT[a.componentType];
    const comps = SIZE[a.type];
    const off = bin.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0);
    if (v.byteStride && v.byteStride !== comps * T.BYTES_PER_ELEMENT) throw new Error('interleaved accessors are not supported');
    return { data: new T(bin.buffer, off, a.count * comps), comps, count: a.count, normalized: !!a.normalized, min: a.min, max: a.max };
  };

  const mesh = json.meshes[0];
  const prim = mesh.primitives[0];
  const A = prim.attributes;
  const pos = accessor(A.POSITION);
  const nrm = A.NORMAL != null ? accessor(A.NORMAL) : null;
  const col = A.COLOR_0 != null ? accessor(A.COLOR_0) : null;
  const bone = A._BONE != null ? accessor(A._BONE) : null;
  const idxA = prim.indices != null ? accessor(prim.indices) : null;
  const indices = idxA ? (idxA.data instanceof Uint32Array ? idxA.data : Uint32Array.from(idxA.data)) : Uint32Array.from({ length: pos.count }, (_, i) => i);

  // colours as rgb bytes whatever the file stored
  let colors = null;
  if (col) {
    colors = new Uint8Array(pos.count * 3);
    const d = col.data, c = col.comps, f = d instanceof Float32Array ? 255 : d instanceof Uint16Array ? 1 / 257 : 1;
    for (let i = 0; i < pos.count; i++) for (let k = 0; k < 3; k++) colors[i * 3 + k] = Math.max(0, Math.min(255, Math.round(d[i * c + k] * f)));
  }
  let bones = null;
  if (bone) {
    bones = new Uint8Array(pos.count * 4);
    const d = bone.data, c = bone.comps;
    for (let i = 0; i < pos.count; i++) for (let k = 0; k < Math.min(4, c); k++) bones[i * 4 + k] = d[i * c + k];
  }
  const node = (json.nodes || []).find((n) => n.mesh === 0) || {};
  const extras = node.extras || mesh.extras || {};
  return {
    name: mesh.name || node.name || 'mesh',
    positions: pos.data, normals: nrm ? nrm.data : null, colors, bones, indices,
    rig: extras.rig || [], extras,
    bounds: { min: pos.min || [0, 0, 0], max: pos.max || [0, 0, 0] },
    count: pos.count,
  };
}

/** The rig slots every toy shares; a model fills the ones it has. */
export const BONES = ['body', 'head', 'armL', 'armR', 'legL', 'legR', 'earL', 'earR'];
