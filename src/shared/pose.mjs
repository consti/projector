// The body as the effects see it. MediaPipe's 33 pose landmarks are reduced to
// the joints that can plausibly push something, grouped so the operator can
// choose between "hands only", "arms" and "the whole body".
//
// Shared between the phone page (which draws the skeleton it is sending) and
// the control window (which turns the same landmarks into interactors).

export const LM = {
  nose: 0, leftEye: 2, rightEye: 5, leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16, leftIndex: 19, rightIndex: 20,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28, leftFoot: 31, rightFoot: 32,
};

/** Bones to draw, as landmark index pairs. */
export const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32],
  [0, 7], [0, 8],
];

/**
 * Where a person pushes from, per mode. Each entry is either a joint
 * (`[index, radiusScale, strength]`) or a limb segment
 * (`{ seg: [a, b], radiusScale, strength }`) that is filled with circles along
 * its length so a sweeping forearm shoves everything in its path, not just what
 * is under the wrist.
 */
export const PARTS = {
  hands: [
    [LM.leftWrist, 1.0, 1.25], [LM.rightWrist, 1.0, 1.25],
  ],
  arms: [
    [LM.nose, 1.1, 0.8],
    [LM.leftWrist, 1.0, 1.25], [LM.rightWrist, 1.0, 1.25],
    { seg: [LM.leftShoulder, LM.leftElbow], radiusScale: 0.7, strength: 0.9 },
    { seg: [LM.leftElbow, LM.leftWrist], radiusScale: 0.7, strength: 1.1 },
    { seg: [LM.rightShoulder, LM.rightElbow], radiusScale: 0.7, strength: 0.9 },
    { seg: [LM.rightElbow, LM.rightWrist], radiusScale: 0.7, strength: 1.1 },
  ],
  body: [
    [LM.nose, 1.1, 0.8],
    [LM.leftWrist, 1.0, 1.25], [LM.rightWrist, 1.0, 1.25],
    { seg: [LM.leftShoulder, LM.leftElbow], radiusScale: 0.7, strength: 0.9 },
    { seg: [LM.leftElbow, LM.leftWrist], radiusScale: 0.7, strength: 1.1 },
    { seg: [LM.rightShoulder, LM.rightElbow], radiusScale: 0.7, strength: 0.9 },
    { seg: [LM.rightElbow, LM.rightWrist], radiusScale: 0.7, strength: 1.1 },
    { seg: [LM.leftHip, LM.leftKnee], radiusScale: 0.8, strength: 0.8 },
    { seg: [LM.leftKnee, LM.leftAnkle], radiusScale: 0.7, strength: 0.9 },
    { seg: [LM.rightHip, LM.rightKnee], radiusScale: 0.8, strength: 0.8 },
    { seg: [LM.rightKnee, LM.rightAnkle], radiusScale: 0.7, strength: 0.9 },
    { torso: true, radiusScale: 1.4, strength: 0.6 },
  ],
};

export const PART_OPTIONS = [['hands', 'Hands'], ['arms', 'Head and arms'], ['body', 'Whole body']];

/** Landmark colours for the debug drawings, one per person. */
export const PERSON_COLORS = ['#ff375f', '#00d4ff', '#ffd60a', '#34c759', '#bf5af2', '#ff9f0a'];

/**
 * Unpack the flat `[x, y, vis, x, y, vis, ...]` array a phone sends into
 * `[[x, y, vis], ...]`, or pass through an already-unpacked list.
 */
export function unpackPose(p) {
  if (!p || !p.length) return [];
  if (Array.isArray(p[0])) return p;
  const out = [];
  for (let i = 0; i + 2 < p.length; i += 3) out.push([p[i], p[i + 1], p[i + 2]]);
  return out;
}
