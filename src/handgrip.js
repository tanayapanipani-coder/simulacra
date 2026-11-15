import * as THREE from 'three';

// Turns WebXR hand-tracking joints into weapon grips.
//
// A closed fist holds a handle along the line of the knuckles: from the
// little-finger knuckle toward the index knuckle. A sword blade leaves the top
// of the fist along that line (tilted a little toward the fingers, the way a
// wrist naturally cocks a blade forward); a bow's limbs run along it, with
// the belly of the bow facing where the fingers point.

const _wrist = new THREE.Vector3();
const _index = new THREE.Vector3();
const _middle = new THREE.Vector3();
const _pinky = new THREE.Vector3();
const _indexTip = new THREE.Vector3();
const _thumbTip = new THREE.Vector3();
const _knuckles = new THREE.Vector3();
const _fingers = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

function jointPos(hand, name, out) {
  const j = hand?.joints?.[name];
  if (!j || j.visible === false) return null;
  return j.getWorldPosition(out);
}

/** True when the hand is tracked and its main joints are visible. */
export function isTracked(hand) {
  return !!(hand?.joints?.wrist && hand.joints.wrist.visible !== false && hand.joints['index-finger-phalanx-proximal']);
}

function readFist(hand) {
  if (!jointPos(hand, 'wrist', _wrist)) return false;
  if (!jointPos(hand, 'index-finger-phalanx-proximal', _index)) return false;
  if (!jointPos(hand, 'middle-finger-phalanx-proximal', _middle)) return false;
  if (!jointPos(hand, 'pinky-finger-phalanx-proximal', _pinky)) return false;
  _knuckles.subVectors(_index, _pinky);
  _fingers.subVectors(_middle, _wrist);
  if (_knuckles.lengthSq() < 1e-6 || _fingers.lengthSq() < 1e-6) return false;
  _knuckles.normalize();
  _fingers.normalize();
  return true;
}

/**
 * Pose a sword (blade along local -Z, grip at the origin) in the fist.
 * Writes world position and quaternion; returns false if the hand is lost.
 */
export function swordGrip(hand, outPos, outQuat) {
  if (!readFist(hand)) return false;
  // Blade direction: out of the top of the fist, cocked toward the fingers.
  _z.copy(_knuckles).addScaledVector(_fingers, 0.35).normalize().negate(); // local +Z = toward pommel
  // Blade width lies in the plane of the fingers so the edge leads a swing.
  _x.copy(_fingers).addScaledVector(_z, -_fingers.dot(_z)).normalize();
  _y.crossVectors(_z, _x);
  _m.makeBasis(_x, _y, _z);
  outQuat.setFromRotationMatrix(_m);
  // Centre of the fist: between the knuckles and the wrist, toward the palm.
  outPos.copy(_wrist).lerp(_middle, 0.62);
  outPos.addScaledVector(_y, -0.0);
  return true;
}

/**
 * Pose a bow (limbs along local Y, belly toward local -Z, string on +Z) in the
 * bow hand. Returns false if the hand is lost.
 */
export function bowGrip(hand, outPos, outQuat) {
  if (!readFist(hand)) return false;
  _y.copy(_knuckles);
  _z.copy(_fingers).addScaledVector(_y, -_fingers.dot(_y)).normalize().negate(); // +Z back toward the archer
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  outQuat.setFromRotationMatrix(_m);
  outPos.copy(_wrist).lerp(_middle, 0.62);
  return true;
}

/** Pinch between thumb and index tips: { distance, point } or null. */
export function pinch(hand, outPoint) {
  if (!jointPos(hand, 'index-finger-tip', _indexTip)) return null;
  if (!jointPos(hand, 'thumb-tip', _thumbTip)) return null;
  outPoint.copy(_indexTip).add(_thumbTip).multiplyScalar(0.5);
  return _indexTip.distanceTo(_thumbTip);
}

const _palm = new THREE.Vector3();
const _tip = new THREE.Vector3();
/**
 * A closed fist: the four fingertips curled in near the palm. Returns the
 * grab point (the middle knuckle) in `outPoint`, or false.
 */
export function fist(hand, outPoint) {
  if (!readFist(hand)) return false;
  _palm.copy(_wrist).lerp(_middle, 0.55);
  let curled = 0;
  for (const name of ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip']) {
    if (jointPos(hand, name, _tip) && _tip.distanceTo(_palm) < 0.075) curled += 1;
  }
  if (curled < 3) return false;
  outPoint.copy(_middle);
  return true;
}

/** Wrist position, for swing speed and shield placement. */
export function wrist(hand, out) {
  return jointPos(hand, 'wrist', out);
}
