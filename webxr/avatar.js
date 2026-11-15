// The character's body: the bundled Rocketbox adult, fitted to real height with her feet on the
// ground, with a procedural walk, arms at her sides, gestures, head look, jaw and blink.
// Used by the Simulacra WebXR page and by Crownfall. The caller owns where she stands and what she
// looks at; this module only turns that into a pose.
//
//   const avatar = createAvatar({ THREE, FBXLoader, scene, assetBase: './avatar/' });
//   await avatar.load();
//   avatar.animate(dt, { x, y, z, yaw, speed01, gesture, metres }, voiceLevel, lookAtVec3);

export function createAvatar({ THREE, FBXLoader, scene, assetBase = './avatar/', height: wantedHeight = 1.7, placeholder = false, lite = false }) {
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);


const avatarRoot = new THREE.Group();
avatarRoot.visible = false;
scene.add(avatarRoot);

// A soft contact shadow: the cheapest cue that the feet are on the real floor.
const shadowCanvas = document.createElement('canvas');
shadowCanvas.width = shadowCanvas.height = 128;
const shadowCtx = shadowCanvas.getContext('2d');
const shadowFade = shadowCtx.createRadialGradient(64, 64, 6, 64, 64, 64);
shadowFade.addColorStop(0, 'rgba(0,0,0,0.5)');
shadowFade.addColorStop(1, 'rgba(0,0,0,0)');
shadowCtx.fillStyle = shadowFade;
shadowCtx.fillRect(0, 0, 128, 128);
const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(0.95, 0.95),
  new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }),
);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = 0.006;
avatarRoot.add(shadow);

const BONES = {
  hips: ['bip01 pelvis', 'hips'],
  head: ['bip01 head', 'head'],
  lUpperArm: ['bip01 l upperarm', 'leftarm'],
  lForearm: ['bip01 l forearm', 'leftforearm'],
  rUpperArm: ['bip01 r upperarm', 'rightarm'],
  rForearm: ['bip01 r forearm', 'rightforearm'],
  lThigh: ['bip01 l thigh', 'leftupleg'],
  lCalf: ['bip01 l calf', 'leftleg'],
  lFoot: ['bip01 l foot', 'leftfoot'],
  rThigh: ['bip01 r thigh', 'rightupleg'],
  rCalf: ['bip01 r calf', 'rightleg'],
  rFoot: ['bip01 r foot', 'rightfoot'],
};
const boneKey = (name) => {
  let n = String(name).toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const colon = n.lastIndexOf(':');
  if (colon >= 0) n = n.substring(colon + 1);
  return n.replace(/^mixamorig/, '');
};

const body = { sit: 0, thigh: 0.42, model: null, modelY: 0, ready: false, bones: {}, rest: {}, leg: 0.85, phase: 0, walk: 0, headYaw: 0, headPitch: 0, gesture: '', gestureT: 0, jaw: [], blink: [], blinkAt: 2, jawNow: 0, kind: 'none' };

function setWorldQuaternion(bone, q) {
  bone.parent.getWorldQuaternion(q2);
  bone.quaternion.copy(q2.invert().multiply(q));
  bone.updateMatrixWorld(true);
}
function turn(key, axis, radians) {
  const b = body.bones[key];
  if (!b || radians === 0) return;
  b.getWorldQuaternion(q1);
  setWorldQuaternion(b, new THREE.Quaternion().setFromAxisAngle(axis, radians).multiply(q1));
}
/** Swing an upper arm so the arm hangs at the side instead of the model's A/T pose. */
function hang(upper, lower, side) {
  const u = body.bones[upper];
  const l = body.bones[lower];
  if (!u || !l) return;
  const current = l.getWorldPosition(new THREE.Vector3()).sub(u.getWorldPosition(new THREE.Vector3())).normalize();
  const wanted = new THREE.Vector3(side.x * 0.13, -1, side.z * 0.13).normalize();
  const axis = new THREE.Vector3().crossVectors(current, wanted);
  const sin = axis.length();
  if (sin < 1e-4) return;
  turn(upper, axis.normalize(), Math.atan2(sin, current.dot(wanted)));
}

/** Scale to a real adult's height, put the feet on the ground, and turn the model to face local +Z. */
function fitAvatar(model, kind) {
  const found = {};
  model.traverse((o) => {
    const k = boneKey(o.name);
    if (!(k in found)) found[k] = o;
    if (o.isMesh) {
      o.frustumCulled = false; // skinned bounds are unreliable once bones are posed
      if (o.morphTargetDictionary) {
        for (const name in o.morphTargetDictionary) {
          const n = name.toLowerCase();
          if (n.includes('jawopen')) body.jaw.push([o, o.morphTargetDictionary[name]]);
          else if (n.includes('eyeblinkleft') || n.includes('eyeblinkright')) body.blink.push([o, o.morphTargetDictionary[name]]);
        }
      }
    }
  });
  for (const key in BONES) for (const name of BONES[key]) if (found[name] && !body.bones[key]) body.bones[key] = found[name];

  avatarRoot.add(model);
  model.updateMatrixWorld(true);
  const b = body.bones;
  const pos = (o) => o.getWorldPosition(new THREE.Vector3());

  // Upright: some exports are Z-up. The head must be above the feet along Y.
  if (b.head && b.lFoot) {
    const spine = pos(b.head).sub(pos(b.lFoot));
    if (Math.abs(spine.z) > Math.abs(spine.y)) model.rotation.x += spine.z > 0 ? -Math.PI / 2 : Math.PI / 2;
    else if (spine.y < 0) model.rotation.x += Math.PI;
    model.updateMatrixWorld(true);
  }
  // Facing: with the character's own left and right known, forward is up x right.
  if (b.lThigh && b.rThigh) {
    const right = pos(b.rThigh).sub(pos(b.lThigh));
    const fwd = new THREE.Vector3().crossVectors(UP, right);
    model.rotation.y -= Math.atan2(fwd.x, fwd.z);
    model.updateMatrixWorld(true);
  }
  // Height and feet from the mesh itself (bones stop at the ankle and the top of the neck).
  const box = new THREE.Box3().setFromObject(model, true);
  const height = box.max.y - box.min.y;
  const target = wantedHeight || 1.7;
  if (height > 0.01) model.scale.multiplyScalar(target / height);
  model.updateMatrixWorld(true);
  box.setFromObject(model, true);
  model.position.x -= (box.min.x + box.max.x) / 2;
  model.position.z -= (box.min.z + box.max.z) / 2;
  model.position.y -= box.min.y;
  model.updateMatrixWorld(true);

  for (const key in b) body.rest[key] = b[key].quaternion.clone();
  body.ready = !!(b.lThigh && b.rThigh && b.lCalf && b.rCalf);
  if (body.ready && b.lFoot) {
    const len = pos(b.lThigh).distanceTo(pos(b.lCalf)) + pos(b.lCalf).distanceTo(pos(b.lFoot));
    if (len > 0.3 && len < 1.4) body.leg = len;
    const thigh = pos(b.lThigh).distanceTo(pos(b.lCalf));
    if (thigh > 0.15 && thigh < 0.7) body.thigh = thigh;
  }
  body.model = model;
  body.modelY = model.position.y;
  body.kind = kind;
}

/** A plain mannequin, used only if the bundled character fails to load. Obviously a stand-in. */
function placeholderAvatar() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x6f8fb5, roughness: 0.8 });
  const part = (geo, y) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    g.add(m);
    return m;
  };
  part(new THREE.CapsuleGeometry(0.17, 0.5, 6, 16), 1.12);
  part(new THREE.SphereGeometry(0.115, 20, 16), 1.6);
  part(new THREE.CapsuleGeometry(0.075, 0.68, 4, 12), 0.42).position.x = -0.1;
  part(new THREE.CapsuleGeometry(0.075, 0.68, 4, 12), 0.42).position.x = 0.1;
  const nose = part(new THREE.ConeGeometry(0.03, 0.08, 8), 1.6);
  nose.position.z = 0.13;
  nose.rotation.x = Math.PI / 2;
  avatarRoot.add(g);
  body.kind = 'placeholder';
}

function loadAvatar() {
  return new Promise((resolve) => {
    if (placeholder) {
      placeholderAvatar();
      return resolve();
    }
    const tex = new THREE.TextureLoader();
    // `lite` (headsets and phones): the 4K textures are drawn down to 1K and the normal maps are
    // left out. On a standalone headset the full set costs more memory and frame time than it shows.
    const map = (name, srgb) => {
      let t;
      if (!lite) t = tex.load(assetBase + name);
      else {
        t = new THREE.Texture();
        new THREE.ImageLoader().load(assetBase + name, (img) => {
          const c = document.createElement('canvas');
          c.width = c.height = 1024;
          c.getContext('2d').drawImage(img, 0, 0, 1024, 1024);
          t.image = c;
          t.needsUpdate = true;
        });
      }
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    // The file names the artist's own texture paths; those are replaced below, so do not fetch them.
    const quiet = new THREE.LoadingManager();
    quiet.setURLModifier((url) => (/\.fbx$/i.test(url) ? url : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'));
    new FBXLoader(quiet).load(
      assetBase + 'RocketboxAdult.fbx',
      (model) => {
        try {
          // The FBX refers to textures by the artist's file paths; bind the bundled ones by material name.
          const made = {};
          const material = (old) => {
            const name = String(old.name || '').toLowerCase();
            if (made[name]) return made[name];
            let m;
            if (name.includes('opacity')) m = new THREE.MeshStandardMaterial({ map: map('f006_opacity_color.png', true), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.75 });
            else if (name.includes('head')) m = new THREE.MeshStandardMaterial({ map: map('f006_head_color.png', true), ...(lite ? {} : { normalMap: map('f006_head_normal.png', false) }), roughness: 0.7 });
            else m = new THREE.MeshStandardMaterial({ map: map('f006_body_color.png', true), ...(lite ? {} : { normalMap: map('f006_body_normal.png', false) }), roughness: 0.8 });
            m.name = old.name;
            made[name] = m;
            return m;
          };
          model.traverse((o) => {
            if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(material) : material(o.material);
          });
          fitAvatar(model, 'rocketbox');
        } catch (e) {
          console.warn('avatar setup failed, using the placeholder', e);
          placeholderAvatar();
        }
        resolve();
      },
      undefined,
      (e) => {
        console.warn('avatar failed to load, using the placeholder', e);
        placeholderAvatar();
        resolve();
      },
    );
  });
}

/**
 * Pose the character for this frame.
 *   a       { x, y, z } feet position in three.js space; yaw (radians, 0 faces three -Z, positive
 *           turns toward +X); speed01 (0..1 of walking speed); gesture ('' or wave | nod |
 *           shake_head | shrug | point, set for one frame to start it); metres moved this frame;
 *           sitting (true while seated)
 *   level   0..1 loudness of her voice right now (drives the jaw)
 *   lookAt  THREE.Vector3 the head turns toward (the user's eyes, or something she is attending to)
 *   pointAt optional THREE.Vector3 the 'point' gesture reaches toward
 */
function animate(dt, a, level, lookAt, pointAt) {
  const metres = a.metres || 0;
  avatarRoot.position.set(a.x, a.y, a.z);
  avatarRoot.rotation.y = Math.PI - a.yaw; // protocol yaw 0 faces +z (three -Z); the model faces local +Z
  avatarRoot.updateMatrixWorld(true);
  if (a.gesture) {
    body.gesture = a.gesture;
    body.gestureT = 0;
  }

  // Mouth and eyes.
  body.jawNow += (level - body.jawNow) * Math.min(1, dt * 18);
  for (const [mesh, i] of body.jaw) mesh.morphTargetInfluences[i] = body.jawNow * 0.8;
  body.blinkAt -= dt;
  const blink = body.blinkAt < 0.12 ? 1 : 0;
  if (body.blinkAt < 0) body.blinkAt = 2.5 + Math.random() * 3;
  for (const [mesh, i] of body.blink) mesh.morphTargetInfluences[i] = blink;

  if (!body.ready) return;
  for (const key in body.bones) body.bones[key].quaternion.copy(body.rest[key]);
  avatarRoot.updateMatrixWorld(true);

  const forward = new THREE.Vector3(Math.sin(a.yaw), 0, -Math.cos(a.yaw));
  const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
  const left = right.clone().negate();
  hang('lUpperArm', 'lForearm', left);
  hang('rUpperArm', 'rForearm', right);
  turn('lForearm', right, 0.24);
  turn('rForearm', right, 0.24);

  // Sitting: thighs level, shins down, hips lowered by a thigh's length so the feet stay on the floor,
  // hands resting on the lap. Blended in and out over about half a second.
  body.sit = (body.sit || 0) + Math.max(-dt * 2.2, Math.min(dt * 2.2, (a.sitting ? 1 : 0) - (body.sit || 0)));
  const sit = body.sit * body.sit * (3 - 2 * body.sit);
  if (body.model) body.model.position.y = body.modelY - sit * (body.thigh || 0.42) * 0.96;
  if (sit > 0.001) {
    turn('lThigh', right, 1.5 * sit);
    turn('rThigh', right, 1.5 * sit);
    turn('lCalf', right, -1.5 * sit);
    turn('rCalf', right, -1.5 * sit);
    // Hands down onto the lap, not held out in front.
    turn('lUpperArm', right, 0.12 * sit);
    turn('rUpperArm', right, 0.12 * sit);
    turn('lForearm', right, 0.5 * sit);
    turn('rForearm', right, 0.5 * sit);
  }

  // Walk cycle driven by the ground actually covered, so the feet do not slide.
  const moving = a.speed01 > 0.06 ? 1 : 0;
  body.walk += Math.max(-dt * 4, Math.min(dt * 4, moving - body.walk));
  const swing = 0.42 * Math.max(0.35, Math.min(1.2, a.speed01));
  body.phase += (2 * Math.PI * metres) / Math.max(0.25, 4 * body.leg * Math.sin(swing));
  const s = Math.sin(body.phase);
  const c = Math.cos(body.phase);
  turn('lThigh', right, s * swing * body.walk);
  turn('rThigh', right, -s * swing * body.walk);
  turn('lCalf', right, -Math.max(0, c) * 0.6 * body.walk);
  turn('rCalf', right, -Math.max(0, -c) * 0.6 * body.walk);
  turn('lUpperArm', right, -s * swing * 0.6 * body.walk);
  turn('rUpperArm', right, s * swing * 0.6 * body.walk);

  // Gestures.
  let nod = 0;
  let shake = 0;
  if (body.gesture) {
    body.gestureT += dt;
    const t = body.gestureT;
    const ease = Math.min(1, t * 4) * Math.min(1, Math.max(0, (1.8 - t) * 4));
    if (body.gesture === 'wave') {
      turn('rUpperArm', forward, -1.9 * ease);
      turn('rForearm', forward, -(0.9 + Math.sin(t * 11) * 0.4) * ease);
    } else if (body.gesture === 'shrug') {
      turn('lUpperArm', forward, 0.35 * ease);
      turn('rUpperArm', forward, -0.35 * ease);
      turn('lForearm', right, 0.9 * ease);
      turn('rForearm', right, 0.9 * ease);
    } else if (body.gesture === 'point') {
      // Reach the right arm out toward a spot (a square on a board, say), then let it fall.
      const shoulder = body.bones.rUpperArm ? body.bones.rUpperArm.getWorldPosition(new THREE.Vector3()) : null;
      if (shoulder && pointAt) {
        const want = pointAt.clone().sub(shoulder).normalize();
        const hangs = new THREE.Vector3(right.x * 0.13, -1, right.z * 0.13).normalize();
        const axis = new THREE.Vector3().crossVectors(hangs, want);
        const sin = axis.length();
        if (sin > 1e-4) turn('rUpperArm', axis.normalize(), Math.atan2(sin, hangs.dot(want)) * ease);
        turn('rForearm', right, -0.24 * ease); // straighten the elbow
      }
    } else if (body.gesture === 'nod') nod = Math.sin(t * 9) * 0.22 * ease;
    else if (body.gesture === 'shake_head') shake = Math.sin(t * 9) * 0.35 * ease;
    if (t > 1.8) body.gesture = '';
  }

  // Look at the user (or straight ahead while walking somewhere else).
  if (body.bones.head) {
    const headPos = body.bones.head.getWorldPosition(new THREE.Vector3());
    const to = lookAt.clone().sub(headPos);
    let yaw = Math.atan2(to.x, to.z) - Math.atan2(forward.x, forward.z);
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    let pitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
    if (Math.abs(yaw) > 1.3) {
      yaw = 0;
      pitch = 0;
    }
    const k = Math.min(1, dt * 6);
    body.headYaw += (Math.max(-1, Math.min(1, yaw)) * 0.75 - body.headYaw) * k;
    body.headPitch += (Math.max(-0.4, Math.min(0.4, pitch)) * 0.7 - body.headPitch) * k;
    turn('head', UP, body.headYaw + shake);
    // About the head's own right axis a positive turn tilts the face up.
    turn('head', right.clone().applyAxisAngle(UP, body.headYaw), body.headPitch - nod);
  }
}

return { root: avatarRoot, body, load: loadAvatar, animate };
}
