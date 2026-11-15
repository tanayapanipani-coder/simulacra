import * as THREE from 'three';
import { FORE_LEN, SHIN_LEN, THIGH_LEN, UPPER_LEN } from './ranger.js?v=87486b8';

// Procedural joint rig for the combat rangers.
//
// Every frame the rig builds a target pose for the skeleton made by
// buildRanger(): Euler keyframes for the swordsman (shoulder, elbow and wrist
// are keyed separately so a swing folds and unfolds through each joint), and
// two-bone IK for the archer's draw. Legs always run through IK so the feet
// stay planted while the hips crouch, lunge or turn. Each joint then eases
// toward its target at its own rate, which gives the motion weight.

const HIP_Y = 0.92;
const ANKLE_Y = HIP_Y - THIGH_LEN - SHIN_LEN;
const ARM_REACH = UPPER_LEN + FORE_LEN;

const EULER_ORDER = { pelvis: 'YXZ', spine: 'YXZ', neck: 'YXZ' };
const FK_JOINTS = ['pelvis', 'spine', 'shoulderR', 'shoulderL', 'elbowR', 'elbowL', 'wristR', 'wristL'];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clamp01 = (v) => clamp(v, 0, 1);
const ease = (t) => t * t * (3 - 2 * t);
const rate = (k, dt) => 1 - Math.exp(-k * dt);

// ---------------------------------------------------------------- poses ---
// Angles in radians. Arms hang along -y at rest; negative shoulder x raises
// the arm forward, negative elbow x folds the forearm up. For the figure's
// right arm negative z swings it outward, positive z across the body.
// Feet are ankle positions in body space (y = 0 means planted).

const SWORD_GUARD = {
  pelvis: [0, -0.12, 0],
  spine: [0.1, -0.08, 0],
  shoulderR: [-0.55, 0, -0.18],
  elbowR: [-1.15, 0, 0],
  wristR: [0.75, 0, 0.15],
  shoulderL: [-0.75, 0, 0.12],
  elbowL: [-0.85, 0, 0],
  wristL: [0, 0, 0],
  lift: -0.06,
  footR: [-0.15, 0, -0.14],
  footL: [0.16, 0, 0.16],
  footYaw: [-0.25, 0.1],
};

// Overhead chop: sword cocked behind the head, then driven down through the
// shoulder while the elbow snaps straight and the wrist turns the edge over.
const CHOP_UP = {
  ...SWORD_GUARD,
  pelvis: [0, -0.25, 0],
  spine: [-0.2, -0.35, 0],
  shoulderR: [-2.75, 0.1, -0.35],
  elbowR: [-1.5, 0, 0],
  wristR: [-0.3, 0, 0],
  shoulderL: [-0.6, 0, 0.25],
  elbowL: [-1.0, 0, 0],
  lift: -0.04,
  footR: [-0.15, 0, -0.16],
  footL: [0.16, 0, 0.18],
  footYaw: [-0.3, 0.1],
};
const CHOP_DOWN = {
  ...SWORD_GUARD,
  pelvis: [0, 0.2, 0],
  spine: [0.4, 0.3, 0],
  shoulderR: [-0.5, 0.15, -0.05],
  elbowR: [-0.1, 0, 0],
  wristR: [0.9, 0, 0],
  shoulderL: [-0.35, 0, 0.45],
  elbowL: [-0.7, 0, 0],
  lift: -0.15,
  footR: [-0.17, 0, -0.26],
  footL: [0.18, 0, 0.34],
  footYaw: [-0.3, 0.1],
};

// Diagonal slash: arm raised high and wide on the right, swept down and
// across to the left hip.
const SLASH_UP = {
  ...SWORD_GUARD,
  pelvis: [0, -0.3, 0],
  spine: [-0.05, -0.5, 0],
  shoulderR: [-1.9, 0.5, -1.1],
  elbowR: [-1.6, 0, 0],
  wristR: [-0.1, 0, 0.7],
  shoulderL: [-0.55, 0, 0.3],
  elbowL: [-1.0, 0, 0],
  lift: -0.05,
};
const SLASH_DOWN = {
  ...SWORD_GUARD,
  pelvis: [0, 0.3, 0],
  spine: [0.3, 0.55, 0],
  shoulderR: [-1.0, -0.7, 0.4],
  elbowR: [-0.2, 0, 0],
  wristR: [0.5, 0, -0.5],
  shoulderL: [-0.3, 0, 0.5],
  elbowL: [-0.65, 0, 0],
  lift: -0.14,
  footR: [-0.17, 0, -0.24],
  footL: [0.18, 0, 0.3],
  footYaw: [-0.35, 0.15],
};
const SWINGS = [
  [CHOP_UP, CHOP_DOWN],
  [SLASH_UP, SLASH_DOWN],
];

const ARCHER_STANCE = {
  pelvis: [0, -0.75, 0],
  spine: [0.04, -0.2, 0],
  shoulderR: [-0.2, 0, -0.1],
  elbowR: [-0.6, 0, 0],
  wristR: [0, 0, 0],
  shoulderL: [-0.3, 0, 0.1],
  elbowL: [-0.4, 0, 0],
  wristL: [0, 0, 0],
  lift: -0.05,
  footR: [-0.12, 0, -0.17],
  footL: [0.1, 0, 0.19],
  footYaw: [-0.95, -0.55],
};

const DEATH = {
  pelvis: [0.1, 0, 0],
  spine: [-0.4, 0, 0.1],
  shoulderR: [-0.5, 0, -1.0],
  elbowR: [-0.35, 0, 0],
  wristR: [0.3, 0, 0],
  shoulderL: [-0.5, 0, 1.0],
  elbowL: [-0.35, 0, 0],
  wristL: [0, 0, 0],
  lift: -0.33,
  footYaw: [-0.2, 0.2],
};

function blend(a, b, t) {
  const out = {};
  for (const key in a) {
    const va = a[key];
    const vb = b[key] ?? va;
    if (Array.isArray(va)) out[key] = va.map((x, i) => x + (vb[i] - x) * t);
    else out[key] = va + (vb - va) * t;
  }
  for (const key in b) if (!(key in out)) out[key] = b[key];
  return out;
}

function copyPose(p) {
  const out = {};
  for (const key in p) out[key] = Array.isArray(p[key]) ? p[key].slice() : p[key];
  return out;
}

// ------------------------------------------------------------------ IK ---
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _basis = new THREE.Matrix4();

/**
 * Analytic two-bone IK. The limb hangs along -y at rest; its middle joint
 * bends about local x. Writes the root joint's local rotation into outQ and
 * returns the middle joint's bend angle. The middle joint points toward
 * `pole`. With `flexForward` the far bone swings toward local +z (elbows),
 * otherwise toward -z (knees).
 */
function solveTwoBone(root, target, L1, L2, pole, flexForward, outQ) {
  _d.subVectors(target, root);
  let dist = _d.length();
  if (dist < 1e-5) {
    _d.set(0, -1, 0);
    dist = 1e-5;
  } else {
    _d.divideScalar(dist);
  }
  dist = clamp(dist, Math.abs(L1 - L2) + 1e-3, (L1 + L2) * 0.999);
  const a = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
  const bend = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2), -1, 1));

  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-8) _p.set(_d.y, -_d.x, 0).addScaledVector(_d, 0);
  if (_p.lengthSq() < 1e-8) _p.set(1, 0, 0);
  _p.normalize();

  _u.copy(_d).multiplyScalar(Math.cos(a)).addScaledVector(_p, Math.sin(a));
  _w.copy(_d).multiplyScalar(Math.sin(a)).addScaledVector(_p, -Math.cos(a));
  _y.copy(_u).negate();
  if (!flexForward) _w.negate();
  _x.crossVectors(_y, _w);
  _basis.makeBasis(_x, _y, _w);
  outQ.setFromRotationMatrix(_basis);
  return bend;
}

// ------------------------------------------------------------- scratch ---
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qFoot = new THREE.Quaternion();
const _xAxis = new THREE.Vector3(1, 0, 0);
const _yAxis = new THREE.Vector3(0, 1, 0);
const _up = new THREE.Vector3(0, 1, 0);
const _foot = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _target = new THREE.Vector3();
const _aimL = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _handT = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _nock = new THREE.Vector3();
const _arrowDir = new THREE.Vector3();
const _grip = new THREE.Vector3(0.035, 0, 0);
const _mid = new THREE.Vector3();

function stretch(mesh, a, b) {
  _tmp.subVectors(b, a);
  const len = Math.max(1e-4, _tmp.length());
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(_yAxis, _tmp.divideScalar(len));
}

const ANCHOR = new THREE.Vector3(0.05, 0.56, 0.16); // chin, string hand at full draw
const QUIVER_REACH = new THREE.Vector3(-0.25, 0.72, -0.2);

/**
 * Attach a rig to a soldier built with buildRanger({ pose: 'soldier' }).
 * Call rig.drive(dt, state) once per frame. state.action is one of:
 *   'idle'   { look }
 *   'run'    { speed, look }               gait phase advances with speed
 *   'strike' { t, variant, look }          t < 0 recovery, 0..0.62 windup and cut
 *   'charge' { t, variant, speed, look }   running in while swinging
 *   'archer' { draw, sinceShot, aim }      draw 0..1, sinceShot seconds since release
 *   'die'    { t }
 * look / aim are world-space points.
 */
export function createRig(root) {
  const j = root.userData.joints;
  const kind = j.bow ? 'archer' : 'sword';
  const feet = {
    R: new THREE.Vector3(-0.12, 0, 0),
    L: new THREE.Vector3(0.12, 0, 0),
    yawR: 0,
    yawL: 0,
    liftR: 0,
    liftL: 0,
  };
  let lift = 0;
  let gait = Math.random() * Math.PI * 2;
  let breath = Math.random() * 10;
  let nocked = true;

  const targetQ = {};
  for (const name of [...FK_JOINTS, 'neck']) targetQ[name] = new THREE.Quaternion();

  function setFK(name, angles) {
    _e.set(angles[0], angles[1], angles[2], EULER_ORDER[name] || 'XYZ');
    targetQ[name].setFromEuler(_e);
  }

  function ease2(name, k, dt) {
    j[name].quaternion.slerp(targetQ[name], rate(k, dt));
  }

  function lookAt(worldPoint, weight, dt, k = 9) {
    if (worldPoint) {
      _target.copy(worldPoint);
      j.spine.worldToLocal(_target);
      _target.sub(j.neck.position);
      const yaw = clamp(Math.atan2(_target.x, _target.z), -1.25, 1.25);
      const flat = Math.hypot(_target.x, _target.z);
      const pitch = clamp(-Math.atan2(_target.y - 0.1, flat), -0.6, 0.5);
      _e.set(pitch * weight, yaw * weight, 0, 'YXZ');
    } else {
      _e.set(0, 0, 0, 'YXZ');
    }
    targetQ.neck.setFromEuler(_e);
    ease2('neck', k, dt);
  }

  function solveLegs() {
    j.pelvis.updateMatrix();
    for (const side of ['R', 'L']) {
      const sx = side === 'R' ? -1 : 1;
      const f = feet[side];
      _foot.set(f.x, ANKLE_Y + f.y + feet[`lift${side}`], f.z);
      // Foot target into pelvis space.
      _foot.sub(j.pelvis.position).applyQuaternion(_q.copy(j.pelvis.quaternion).invert());
      _hip.copy(j[`hip${side}`].position);
      _pole.set(sx * 0.2, 0, 1);
      const bend = solveTwoBone(_hip, _foot, THIGH_LEN, SHIN_LEN, _pole, false, j[`hip${side}`].quaternion);
      j[`knee${side}`].quaternion.setFromAxisAngle(_xAxis, bend);
      // Keep the sole level, turned to the foot's own yaw.
      _qFoot.setFromAxisAngle(_yAxis, feet[`yaw${side}`]);
      _q2.copy(j.pelvis.quaternion).multiply(j[`hip${side}`].quaternion).multiply(j[`knee${side}`].quaternion);
      j[`ankle${side}`].quaternion.copy(_q2.invert().multiply(_qFoot));
    }
  }

  function bodyAndLegs(pose, dt, { kBody = 10, kFeet = 10, gaitFeet = null } = {}) {
    setFK('pelvis', pose.pelvis);
    setFK('spine', pose.spine);
    ease2('pelvis', kBody, dt);
    ease2('spine', kBody, dt);
    lift += (pose.lift - lift) * rate(kBody, dt);
    j.pelvis.position.y = HIP_Y + lift;

    if (gaitFeet) {
      feet.R.set(gaitFeet.R[0], 0, gaitFeet.R[2]);
      feet.L.set(gaitFeet.L[0], 0, gaitFeet.L[2]);
      feet.liftR = gaitFeet.R[1];
      feet.liftL = gaitFeet.L[1];
    } else if (pose.footR) {
      const a = rate(kFeet, dt);
      feet.R.lerp(_tmp2.fromArray(pose.footR), a);
      feet.L.lerp(_tmp2.fromArray(pose.footL), a);
      feet.liftR += (0 - feet.liftR) * a;
      feet.liftL += (0 - feet.liftL) * a;
    }
    if (pose.footYaw) {
      const a = rate(gaitFeet ? 20 : kFeet, dt);
      feet.yawR += (pose.footYaw[0] - feet.yawR) * a;
      feet.yawL += (pose.footYaw[1] - feet.yawL) * a;
    }
    solveLegs();
  }

  function armsFK(pose, dt, k) {
    for (const name of ['shoulderR', 'shoulderL', 'elbowR', 'elbowL', 'wristR', 'wristL']) {
      setFK(name, pose[name]);
      ease2(name, name.startsWith('wrist') ? k * 1.2 : k, dt);
    }
  }

  function armIK(side, spineTarget, pole, dt, k) {
    const shoulder = j[`shoulder${side}`];
    const bend = solveTwoBone(shoulder.position, spineTarget, UPPER_LEN, FORE_LEN, pole, true, targetQ[`shoulder${side}`]);
    targetQ[`elbow${side}`].setFromAxisAngle(_xAxis, -bend);
    ease2(`shoulder${side}`, k, dt);
    ease2(`elbow${side}`, k, dt);
  }

  // ------------------------------------------------------------ sword ---
  function swordPose(state) {
    const [up, down] = SWINGS[(state.variant || 0) % SWINGS.length];
    const t = state.t ?? 0;
    if (t < 0) return blend(down, SWORD_GUARD, ease(clamp01(1 + t / 0.28)));
    if (t < 0.4) return blend(SWORD_GUARD, up, ease(t / 0.4));
    const s = clamp01((t - 0.4) / 0.2);
    return blend(up, down, s * s);
  }

  function runPose(dt, speed) {
    const stride = 0.36;
    gait += dt * ((Math.PI * 2 * speed) / (4 * stride));
    const c = Math.cos(gait);
    const s = Math.sin(gait);
    const pose = copyPose(SWORD_GUARD);
    pose.pelvis = [0.05, 0.12 * c, 0];
    pose.spine = [0.24, -0.15 * c, 0];
    pose.shoulderR = [-0.5 + 0.38 * c, 0, -0.2];
    pose.elbowR = [-1.15 - 0.2 * Math.max(0, -c), 0, 0];
    pose.shoulderL = [-0.75 - 0.18 * c, 0, 0.14];
    pose.lift = -0.07 + 0.03 * Math.cos(gait * 2);
    pose.footYaw = [0, 0];
    const footAt = (p, x) => {
      const sp = Math.sin(p);
      return [x, sp < 0 ? -sp * 0.17 : 0, stride * Math.cos(p)];
    };
    return { pose, gaitFeet: { R: footAt(gait, -0.12), L: footAt(gait + Math.PI, 0.12) }, s };
  }

  // ----------------------------------------------------------- archer ---
  function driveArcher(dt, state) {
    const draw = clamp01(state.draw ?? 0);
    const since = state.sinceShot ?? 99;
    // The bow stays trained on the target through the whole cycle: reaching
    // for an arrow and nocking happen with the bow already up. Only a short
    // recoil right after the release dips it.
    const recoil = since < 0.3 ? Math.sin((since / 0.3) * Math.PI) * 0.12 : 0;
    const raise = 1 - recoil;
    const pull = ease(clamp01((draw - 0.25) / 0.75));

    const pose = copyPose(ARCHER_STANCE);
    pose.spine = [0.04 + Math.sin(breath * 1.7) * 0.015, -0.2 - 0.3 * raise, 0];
    bodyAndLegs(pose, dt, { kBody: 7, kFeet: 6 });
    j.spine.updateWorldMatrix(true, false);

    if (state.aim) {
      _aimL.copy(state.aim);
      j.spine.worldToLocal(_aimL);
    } else {
      _aimL.set(0.9, 0.55, 0.5).multiplyScalar(8);
    }

    // Bow arm: the bow hand sits on the line from the anchor (chin) to the
    // target, as far out as the arm reaches, so the bow and the drawn arrow
    // point straight at the target.
    const shoulderL = j.shoulderL.position;
    _aimDir.subVectors(_aimL, ANCHOR).normalize();
    _tmp.subVectors(ANCHOR, shoulderL);
    const cd = _tmp.dot(_aimDir);
    const r = ARM_REACH * 0.96;
    const disc = cd * cd - _tmp.lengthSq() + r * r;
    const reachAlong = disc > 0 ? -cd + Math.sqrt(disc) : 0.5;
    _handT.copy(ANCHOR).addScaledVector(_aimDir, Math.max(0.35, reachAlong));
    _tmp.subVectors(_aimL, shoulderL).normalize().add(_tmp2.set(0, -1.1, 0)).normalize();
    _tmp.multiplyScalar(ARM_REACH * 0.8).add(shoulderL);
    _handT.lerp(_tmp, 1 - raise);
    _pole.set(0.3, -0.8, -0.3);
    armIK('L', _handT, _pole, dt, 12);
    setFK('wristL', [0, 0, 0]);
    ease2('wristL', 12, dt);

    // Steer the bow before the string hand so the nock point is current.
    j.wristL.updateWorldMatrix(true, false);
    placeBow(raise, _aimL);

    // String hand: follow-through, reach to the quiver, nock, then draw.
    let kR = 11;
    _pole.set(-0.35, 0.25, 0).addScaledVector(_aimDir, -0.6);
    j.bow.localToWorld(_nock.copy(j.nockRest));
    j.spine.worldToLocal(_nock);
    if (since < 0.28) {
      _handT.copy(ANCHOR).addScaledVector(_aimDir, -0.16).add(_tmp.set(-0.1, 0.05, 0));
      kR = 16;
      nocked = false;
    } else if (since < 0.85) {
      _handT.copy(QUIVER_REACH);
      _pole.set(-0.3, 1, 0.4);
      nocked = false;
    } else if (since < 1.3) {
      const t = ease(clamp01((since - 0.85) / 0.4));
      _handT.copy(QUIVER_REACH).lerp(_nock, t);
      _pole.lerp(_tmp.set(-0.3, 1, 0.4), 1 - t);
      nocked = since > 1.22;
    } else {
      _handT.copy(_nock).lerp(ANCHOR, pull);
      nocked = true;
    }
    armIK('R', _handT, _pole, dt, kR);
    setFK('wristR', [0, 0, 0]);
    ease2('wristR', 12, dt);

    lookAt(state.aim, 1, dt);
    j.wristR.updateWorldMatrix(true, false);
    updateString(since);
  }

  function placeBow(raise = 0, target = null) {
    const bow = j.bow;
    j.wristL.getWorldPosition(_tmp);
    j.spine.worldToLocal(_tmp);
    bow.position.copy(_tmp);
    // Raised, the bow faces straight from the bow hand at the target (spine
    // space); lowered (dying), it follows the bow arm. Limbs stay upright
    // with a slight cant.
    _bx.subVectors(_tmp, j.shoulderL.position).normalize();
    if (target) _tmp2.subVectors(target, _tmp).normalize();
    else _tmp2.subVectors(_tmp, ANCHOR).normalize();
    _bx.lerp(_tmp2, raise).normalize();
    _by.copy(_up).addScaledVector(_bx, -_up.dot(_bx)).normalize();
    _bz.crossVectors(_bx, _by);
    _by.applyAxisAngle(_bx, 0.12);
    _bz.crossVectors(_bx, _by);
    _basis.makeBasis(_bx, _by, _bz);
    bow.quaternion.setFromRotationMatrix(_basis);
    bow.updateMatrixWorld(true);
  }

  function updateString(since) {
    _nock.copy(j.nockRest);
    if (nocked) {
      j.wristR.getWorldPosition(_tmp);
      j.bow.worldToLocal(_tmp);
      // The string can only be pulled back, never pushed through the grip.
      if (_tmp.x < j.nockRest.x) _nock.copy(_tmp);
    }
    stretch(j.stringTop, j.bowTipTop, _nock);
    stretch(j.stringBot, j.bowTipBot, _nock);

    j.nockArrow.visible = nocked;
    j.handArrow.visible = !nocked && since > 0.62;
    _arrowDir.subVectors(_grip, _nock).normalize();
    _mid.copy(_nock).addScaledVector(_arrowDir, 0.39);
    j.nockArrow.position.copy(_mid);
    j.nockArrow.quaternion.setFromUnitVectors(_yAxis, _arrowDir);
    j.muzzle.position.copy(_nock).addScaledVector(_arrowDir, 0.82);
  }

  // ------------------------------------------------------------ drive ---
  function drive(dt, state = {}) {
    dt = Math.min(dt, 0.05);
    breath += dt;
    const action = state.action || 'idle';

    if (action === 'die') {
      const t = state.t ?? 0;
      bodyAndLegs(DEATH, dt, { kBody: 9 + t * 10 });
      armsFK(DEATH, dt, 8);
      _e.set(-0.55, 0, 0.2, 'YXZ');
      targetQ.neck.setFromEuler(_e);
      ease2('neck', 8, dt);
      if (kind === 'archer') {
        j.wristL.updateWorldMatrix(true, false);
        placeBow();
        nocked = false;
        updateString(0);
      }
      return;
    }

    if (kind === 'archer') {
      driveArcher(dt, state);
      return;
    }

    if (action === 'run') {
      const { pose, gaitFeet } = runPose(dt, state.speed ?? 2.5);
      bodyAndLegs(pose, dt, { kBody: 12, gaitFeet });
      armsFK(pose, dt, 12);
    } else if (action === 'charge') {
      // Running in while swinging: the legs keep the gait, the arms and torso
      // carry the sword cut.
      const { pose, gaitFeet } = runPose(dt, state.speed ?? 2.5);
      const cut = swordPose(state);
      for (const k of ['shoulderR', 'elbowR', 'wristR', 'shoulderL', 'elbowL', 'wristL']) pose[k] = cut[k];
      pose.spine = [Math.max(pose.spine[0], cut.spine[0] * 0.8 + 0.1), cut.spine[1], 0];
      const fast = (state.t ?? 0) > 0.38;
      bodyAndLegs(pose, dt, { kBody: 14, gaitFeet });
      armsFK(pose, dt, fast ? 34 : 15);
    } else if (action === 'strike') {
      const pose = swordPose(state);
      const fast = (state.t ?? 0) > 0.38;
      bodyAndLegs(pose, dt, { kBody: fast ? 20 : 11, kFeet: fast ? 18 : 9 });
      armsFK(pose, dt, fast ? 34 : 15);
    } else {
      const pose = copyPose(SWORD_GUARD);
      pose.spine = [0.1 + Math.sin(breath * 1.6) * 0.02, -0.08, 0];
      pose.shoulderR = [-0.55 + Math.sin(breath * 1.6 + 0.5) * 0.04, 0, -0.18];
      bodyAndLegs(pose, dt);
      armsFK(pose, dt, 10);
    }
    j.spine.updateWorldMatrix(true, false);
    lookAt(state.look, 0.85, dt);
  }

  const rig = { drive, joints: j, kind };
  if (j.muzzle) rig.muzzle = j.muzzle;
  root.userData.rig = rig;
  // Settle into the rest pose so the first rendered frame is already posed.
  for (let i = 0; i < 30; i++) drive(1 / 30, { action: kind === 'archer' ? 'archer' : 'idle' });
  return rig;
}
