// The character's body: the bundled Rocketbox adult, fitted to real height with her feet on the
// ground, with a procedural walk, arms at her sides, gestures, head look, jaw and blink.
// Used by the Simulacra WebXR page and by Crownfall. The caller owns where she stands and what she
// looks at; this module only turns that into a pose.
//
//   const avatar = createAvatar({ THREE, FBXLoader, scene, assetBase: './avatar/' });
//   await avatar.load();
//   avatar.animate(dt, { x, y, z, yaw, speed01, gesture, metres }, voiceLevel, lookAtVec3);

export function createAvatar({ THREE, FBXLoader, scene, assetBase = './avatar/', height: wantedHeight = 1.7, placeholder = false, lite = false, mocap = true }) {
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
  // Which way the head bone's own axes point when the face looks straight ahead (she faces +Z here),
  // so the gaze can be steered whatever pose a recorded motion has put the head in.
  if (b.head) {
    avatarRoot.updateMatrixWorld(true);
    const face = new THREE.Vector3(0, 0, 1).applyQuaternion(avatarRoot.getWorldQuaternion(new THREE.Quaternion()));
    body.headForward = face.applyQuaternion(b.head.getWorldQuaternion(new THREE.Quaternion()).invert());
  }
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
    const map = (name, srgb, size = 1024) => {
      let t;
      if (!lite) t = tex.load(assetBase + name);
      else {
        t = new THREE.Texture();
        new THREE.ImageLoader().load(assetBase + name, (img) => {
          const c = document.createElement('canvas');
          c.width = c.height = size;
          c.getContext('2d').drawImage(img, 0, 0, size, size);
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
            else if (name.includes('head')) m = new THREE.MeshStandardMaterial({ map: map('f006_head_color.png', true, 2048), normalMap: map('f006_head_normal.png', false, 1024), roughness: 0.62 });
            else m = new THREE.MeshStandardMaterial({ map: map('f006_body_color.png', true), ...(lite ? {} : { normalMap: map('f006_body_normal.png', false) }), roughness: 0.8 });
            m.name = old.name;
            made[name] = m;
            return m;
          };
          model.traverse((o) => {
            if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(material) : material(o.material);
          });
          fitAvatar(model, 'rocketbox');
          if (mocap) loadMocap(model).catch((e) => console.warn('motion capture not loaded; using the simple built-in motion', e));
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

// ---------------------------------------------------------------- recorded human motion

// Motion-capture clips from the Rocketbox library, recorded for this character's own skeleton
// (see backend/tools/convert-animations.mjs). Standing still she cycles through idle takes
// (breathing, shifting weight, looking around); walking plays a real gait at the pace she is
// actually moving; a wave, nod, shrug or head shake is a real one; and while her voice is sounding
// she gestures the way a person talking does. Everything cross-fades, so nothing snaps.
async function loadMocap(model) {
  const [meta, bin] = await Promise.all([
    fetch(assetBase + 'animations.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error('animations.json ' + r.status)))),
    fetch(assetBase + 'animations.bin').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('animations.bin ' + r.status)))),
  ]);
  const mixer = new THREE.AnimationMixer(model);
  const byRole = {};
  const all = [];
  const nb = meta.bones.length;
  for (const c of meta.clips) {
    const times = new Float32Array(c.frames);
    for (let f = 0; f < c.frames; f++) times[f] = f / meta.fps;
    const packed = new Int16Array(bin, c.quats, c.frames * nb * 4);
    const tracks = [];
    for (let b = 0; b < nb; b++) {
      const values = new Float32Array(c.frames * 4);
      for (let f = 0; f < c.frames; f++) for (let k = 0; k < 4; k++) values[f * 4 + k] = packed[(f * nb + b) * 4 + k] / 32767;
      tracks.push(new THREE.QuaternionKeyframeTrack(meta.bones[b] + '.quaternion', times, values));
    }
    tracks.push(new THREE.VectorKeyframeTrack('Bip01.position', times, new Float32Array(bin.slice(c.root, c.root + c.frames * 12))));
    const clip = new THREE.AnimationClip(c.name, (c.frames - 1) / meta.fps, tracks);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.enabled = true;
    action.setEffectiveWeight(0);
    action.play();
    const entry = { name: c.name, role: c.role, action, duration: clip.duration, speed: c.speed, weight: 0, target: 0 };
    all.push(entry);
    (byRole[c.role] = byRole[c.role] || []).push(entry);
  }
  if (!byRole.idle || !byRole.walk) throw new Error('the animation pack has no idle or walk');
  body.mocap = { mixer, all, byRole, base: null, baseRole: '', baseFor: 0, shot: null, talk: 0, pointT: -1 };
}

function playMocap(dt, a, level, pointAt) {
  const m = body.mocap;
  if (body.model) body.model.position.y = body.modelY; // the seated clips carry their own height
  const pick = (role, not) => {
    const list = m.byRole[role] || m.byRole.idle;
    const others = list.length > 1 ? list.filter((e) => e !== not) : list;
    return others[Math.floor(Math.random() * others.length)];
  };

  // What she is doing underneath any gesture: sitting, walking, talking, or simply standing.
  const sounding = level > 0.05;
  m.talk += ((sounding ? 1 : 0) - m.talk) * Math.min(1, dt * (sounding ? 5 : 1.1));
  const role = a.sitting ? 'sit' : a.speed01 > 0.08 ? 'walk' : m.talk > 0.5 && m.byRole.talk ? 'talk' : 'idle';
  m.baseFor += dt;
  // A new take when what she is doing changes, and a different take of the same thing before the
  // current one runs out, so that standing still never loops visibly.
  if (role !== m.baseRole || (role !== 'walk' && m.base && m.baseFor > m.base.duration - 0.7)) {
    const next = pick(role, role === m.baseRole ? m.base : null);
    if (next !== m.base || role !== m.baseRole) {
      if (next !== m.base) next.action.time = role === 'idle' && !m.baseRole ? Math.random() * next.duration * 0.5 : 0;
      m.base = next;
    }
    m.baseRole = role;
    m.baseFor = m.base.action.time;
  }
  if (role === 'walk') m.base.action.timeScale = Math.max(0.6, Math.min(1.5, (a.speed01 * 0.9) / (m.base.speed || 1.2)));

  // A gesture on top: the whole recorded take, faded in and out.
  if (a.gesture === 'point') m.pointT = 0;
  else if (a.gesture && m.byRole[a.gesture] && !a.sitting) {
    const take = pick(a.gesture, m.shot ? m.shot.entry : null);
    take.action.time = 0;
    take.action.timeScale = 1;
    m.shot = { entry: take, t: 0 };
  }
  let over = 0;
  if (m.shot) {
    m.shot.t += dt;
    const left = m.shot.entry.duration - m.shot.t;
    over = Math.min(1, m.shot.t / 0.3, Math.max(0, left / 0.45));
    if (left <= 0 || a.speed01 > 0.08) {
      if (a.speed01 > 0.08) over = 0;
      if (left <= 0 || over === 0) m.shot = m.shot && left > 0 && over > 0 ? m.shot : null;
    }
  }

  let total = 0;
  for (const e of m.all) {
    e.target = m.shot && e === m.shot.entry ? over : e === m.base ? 1 - over : 0;
    const rate = dt / (e.role === 'walk' || m.baseRole === 'walk' ? 0.22 : 0.4);
    e.weight += Math.max(-rate, Math.min(rate, e.target - e.weight));
    total += e.weight;
  }
  for (const e of m.all) e.action.setEffectiveWeight(total > 0 ? e.weight / total : e === m.base ? 1 : 0);
  m.mixer.update(dt);

  // Reaching toward a spot (a square on a board): turn the recorded arm pose toward it and back.
  if (m.pointT >= 0) {
    m.pointT += dt;
    const ease = Math.min(1, m.pointT * 4) * Math.min(1, Math.max(0, (1.8 - m.pointT) * 4));
    const u = body.bones.rUpperArm;
    const l = body.bones.rForearm;
    if (u && l && pointAt && ease > 0) {
      const from = u.getWorldPosition(new THREE.Vector3());
      const current = l.getWorldPosition(new THREE.Vector3()).sub(from).normalize();
      const want = pointAt.clone().sub(from).normalize();
      const axis = new THREE.Vector3().crossVectors(current, want);
      const sin = axis.length();
      if (sin > 1e-4) turn('rUpperArm', axis.normalize(), Math.atan2(sin, current.dot(want)) * ease);
    }
    if (m.pointT > 1.8) m.pointT = -1;
  }
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
  const forward = new THREE.Vector3(Math.sin(a.yaw), 0, -Math.cos(a.yaw));
  const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
  const left = right.clone().negate();
  let nod = 0;
  let shake = 0;
  // Recorded human motion when it has loaded; the simple built-in motion until then, or without it.
  if (body.mocap) playMocap(dt, a, level, pointAt);
  else {
  for (const key in body.bones) body.bones[key].quaternion.copy(body.rest[key]);
  avatarRoot.updateMatrixWorld(true);
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
  } // end of the built-in motion

  // With recorded motion the head already moves by itself: steer its actual facing most of the way
  // toward what she is looking at, within what a neck can do, so she holds eye contact while the
  // rest of her body idles, talks or waves.
  if (body.mocap && body.bones.head && body.headForward) {
    const head = body.bones.head;
    const headPos = head.getWorldPosition(new THREE.Vector3());
    const now = body.headForward.clone().applyQuaternion(head.getWorldQuaternion(q1)).normalize();
    const want = lookAt.clone().sub(headPos).normalize();
    // Not further round than about 65 degrees from the way her body faces, and not craning up or down.
    const bodyYaw = Math.atan2(forward.x, forward.z);
    let yaw = Math.atan2(want.x, want.z) - bodyYaw;
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    const walkingAway = Math.abs(yaw) > 1.6;
    yaw = walkingAway ? 0 : Math.max(-1.1, Math.min(1.1, yaw));
    const pitch = walkingAway ? 0 : Math.max(-0.45, Math.min(0.45, Math.asin(Math.max(-1, Math.min(1, want.y)))));
    want.set(Math.sin(bodyYaw + yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(bodyYaw + yaw) * Math.cos(pitch));
    body.gaze = body.gaze || now.clone();
    body.gaze.lerp(want, Math.min(1, dt * 5)).normalize();
    const fix = new THREE.Quaternion().setFromUnitVectors(now, now.clone().lerp(body.gaze, 0.8).normalize());
    setWorldQuaternion(head, fix.multiply(head.getWorldQuaternion(q1)));
  } else if (body.bones.head) {
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
