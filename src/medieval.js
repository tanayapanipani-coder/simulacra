import * as THREE from 'three';
import { clothTex, steelTex } from './textures.js?v=1295735';

// Dress Sim for Crownfall: a medieval look on the shared modern avatar,
// without changing the avatar itself (the Simulacra page uses it as is).
//   - a wine gown under a dark green velvet bodice laced in gold, with an
//     embroidered V-neck, long sleeves with embroidered bands and a full
//     skirt, painted on her own surface in the shader so it fits and moves
//     exactly (skin of the face, neck and hands, and hair untouched);
//   - puffed sleeve-heads, peplum tabs and the skirt's fall as meshes on
//     her bones;
//   - a thin gold circlet with a jewel on her brow.

// Colours of the gown, in linear light (after the reference: a wine gown
// under a dark green velvet bodice, gold-laced, with embroidered bands).
const WINE = [0.13, 0.018, 0.042];
const GREEN = [0.012, 0.075, 0.04];
const glslVec = (c) => `vec3(${c.map((v) => v.toFixed(3)).join(', ')})`;

// Helpers placed at the top of the fragment shader.
const RECOLOR_HEAD = /* glsl */ `
varying vec3 vBindPos;
uniform vec3 uShoulder;
uniform vec3 uWrist;
uniform float uWaist;
uniform float uBust;
const vec3 WINE = ${glslVec(WINE)};
const vec3 GREEN = ${glslVec(GREEN)};
const vec3 GOLD = vec3(0.55, 0.36, 0.09);
// Embroidered braid: gold ground with red and green diamonds.
vec3 embroidery(vec2 p) {
  vec2 q = fract(p * 0.55) - 0.5;
  float d = abs(q.x) + abs(q.y);
  return d < 0.2 ? vec3(0.38, 0.03, 0.04) : d < 0.3 ? vec3(0.02, 0.12, 0.06) : GOLD;
}
`;

const RECOLOR = /* glsl */ `
#include <map_fragment>
bool painted = true;
{
  // Everything is painted on her own surface, so it fits and moves with
  // her exactly. Positions are in the bind pose, in the model's centimetres
  // (x across, y up, z forward); the right side mirrors the left.
  vec3 bp = vBindPos;
  bp.x = abs(bp.x);
  vec3 c0 = diffuseColor.rgb;
  float lum0 = dot(c0, vec3(0.2126, 0.7152, 0.0722));
  float shade = clamp(lum0 * 1.4, 0.4, 1.1);
  vec3 armDir = uWrist - uShoulder;
  float armLen = length(armDir);
  float along = dot(bp - uShoulder, armDir) / (armLen * armLen);
  float across = length(bp - uShoulder - armDir * along);
  bool onArm = along > 0.04 && along < 0.975 && across < 10.0;
  bool front = bp.z > -2.0;
  if (onArm) {
    // Wine sleeves with an embroidered band on the upper arm and at the cuff.
    bool band = (along > 0.4 && along < 0.47) || along > 0.92;
    diffuseColor.rgb = band ? embroidery(vec2(along * armLen, atan(bp.z, bp.y) * 6.0)) * shade : WINE * shade;
  } else if (bp.y < uWaist && bp.x < 24.0) {
    // Below the waist: the skirt's wine cloth (the skirt mesh is the same).
    diffuseColor.rgb = WINE * clamp(lum0 * 1.6, 0.7, 1.05);
  } else if (bp.y < uBust + 9.0 && bp.x < 24.0) {
    float vTop = uBust - 10.0;
    float vHalf = (bp.y - vTop) * 0.4;
    if (front && bp.y > vTop && bp.x < vHalf) {
      // The deep V of the bodice: a wine panel edged with embroidery.
      diffuseColor.rgb = bp.x > vHalf - 1.8 ? embroidery(bp.xy) * shade : WINE * shade;
    } else if (front && bp.x < 1.7) {
      // Gold lacing criss-crossing up the front.
      float zig = abs(fract(bp.y * 0.4) - 0.5) * 2.0;
      diffuseColor.rgb = abs(bp.x / 1.7 - zig) < 0.28 ? GOLD * shade : GREEN * 0.4 * shade;
    } else {
      diffuseColor.rgb = GREEN * shade;
    }
  } else if (bp.y < uShoulder.y + 5.0 && bp.x > 7.5 && bp.x < 17.0 && !onArm) {
    // The bodice's shoulder straps.
    diffuseColor.rgb = GREEN * shade;
  } else {
    painted = false;
  }
}
if (!painted) {
  vec3 c = diffuseColor.rgb;
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  if (sat > 0.16 && c.g > c.r * 1.08 && c.g > c.b * 1.12) {
    // What is left of the shirt (above the bodice): the gown's wine.
    diffuseColor.rgb = WINE * clamp(lum * 1.15, 0.3, 1.2);
  } else if (sat > 0.1 && c.b > c.r * 1.08 && c.b >= c.g * 0.95) {
    diffuseColor.rgb = WINE * clamp(lum * 1.6, 0.5, 1.1);
  }
}
`;

function findBone(model, test) {
  let hit = null;
  model.traverse((o) => {
    if (!hit && (o.isBone || o.type === 'Bone' || o.type === 'Object3D') && test(String(o.name).toLowerCase())) hit = o;
  });
  return hit;
}

function circlet() {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9a73e, metalness: 1, roughness: 0.25, emissive: 0x4a3008, emissiveIntensity: 0.4, map: steelTex() });
  const gem = new THREE.MeshStandardMaterial({ color: 0x7a0f2a, metalness: 0.2, roughness: 0.1, emissive: 0x5a0818, emissiveIntensity: 0.6 });
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.006, 6, 40), gold);
  band.rotation.x = Math.PI / 2;
  g.add(band);
  // Small points round the band, a taller one at the front with a jewel.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const front = i === 0;
    const h = front ? 0.04 : 0.018;
    const p = new THREE.Mesh(new THREE.ConeGeometry(front ? 0.009 : 0.006, h, 4), gold);
    p.position.set(Math.sin(a) * 0.098, h / 2, Math.cos(a) * 0.098);
    g.add(p);
  }
  const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), gem);
  jewel.position.set(0, 0.006, 0.104);
  g.add(jewel);
  return g;
}

const _Y = new THREE.Vector3(0, 1, 0);
// A mesh built along +Y (centred), stretched from point a to b.
function along(geoFn, mat, a, b, cover = 1, from = 0) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const m = new THREE.Mesh(geoFn(len * cover), mat);
  m.position.copy(a).addScaledVector(dir, from + cover / 2);
  m.quaternion.setFromUnitVectors(_Y, dir.normalize());
  return m;
}

// An ankle-length skirt from the waist, flaring, in soft folds, with a gold
// band at the hem.
function skirt(top, bottom) {
  const g = new THREE.Group();
  const len = top - bottom;
  // Same colour the shader gives everything below her waist, so the two
  // read as one cloth.
  const velvet = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide });
  velvet.color.setRGB(...WINE);
  // Hugging the waist at the top (her hips below are painted the same
  // cloth, so the skirt and body read as one), flaring to the hem.
  const geo = new THREE.CylinderGeometry(0.155, 0.38, len, 40, 8, true);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = (len / 2 - pos.getY(i)) / len;
    const a = Math.atan2(pos.getX(i), pos.getZ(i));
    const fold = 1 + Math.sin(a * 9) * 0.04 * k;
    pos.setX(i, pos.getX(i) * fold);
    pos.setZ(i, pos.getZ(i) * fold);
  }
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, velvet);
  body.position.y = -len / 2;
  g.add(body);
  // The bodice's peplum: green velvet tabs flaring over the top of the skirt.
  const green = new THREE.MeshStandardMaterial({ roughness: 0.75, side: THREE.DoubleSide });
  green.color.setRGB(...GREEN);
  const tabs = 9;
  for (let i = 0; i < tabs; i++) {
    const t0 = (i / tabs) * Math.PI * 2 + 0.03;
    const tab = new THREE.Mesh(new THREE.CylinderGeometry(0.162, 0.205, 0.1, 6, 1, true, t0, (Math.PI * 2) / tabs - 0.06), green);
    tab.position.y = -0.045;
    g.add(tab);
  }
  // A waist is wider than it is deep.
  g.scale.set(1, 1, 0.8);
  return g;
}

const steel = () => new THREE.MeshStandardMaterial({ color: 0xa4a8b0, metalness: 0.8, roughness: 0.35, envMapIntensity: 1.4, map: steelTex() });
const leather = () => new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.75, map: clothTex() });

/**
 * Dress a loaded avatar (from webxr/avatar.js). Safe to call more than
 * once; does nothing if the model or its bones are not there.
 */
export function dressMedieval(avatar) {
  const model = avatar?.body?.model;
  if (!model || model.userData.medieval) return;
  model.userData.medieval = true;

  // Where the left arm runs in the bind pose (the right mirrors it), from
  // the skeleton's own bind matrices.
  const arm = { shoulder: new THREE.Vector3(17.2, 138, -6.1), wrist: new THREE.Vector3(52.4, 106.3, 3.1), waist: 103, bust: 127 };
  let pelvisY = 92.3;
  let spineY = 128.9;
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.skeleton.bones.forEach((bone, i) => {
      const n = bone.name.toLowerCase().replace(/_/g, ' ');
      const at = () => new THREE.Vector3().setFromMatrixPosition(o.skeleton.boneInverses[i].clone().invert());
      if (n.endsWith('l upperarm')) arm.shoulder.copy(at());
      if (n.endsWith('l hand')) arm.wrist.copy(at());
      if (n.endsWith('pelvis')) pelvisY = at().y;
      if (n.endsWith('spine2')) spineY = at().y;
    });
  });
  // The waistline a little above the hip joint; the bodice runs up to just
  // under the bust.
  arm.waist = pelvisY + (spineY - pelvisY) * 0.29;
  arm.bust = spineY - 2;
  arm.shoulder.x = Math.abs(arm.shoulder.x);
  arm.wrist.x = Math.abs(arm.wrist.x);

  // Dye the body's clothes (not the head or hair).
  model.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const name = String(m?.name || '').toLowerCase();
      if (!m || name.includes('head') || name.includes('opacity') || m.userData.medieval) continue;
      m.userData.medieval = true;
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uShoulder = { value: arm.shoulder };
        shader.uniforms.uWrist = { value: arm.wrist };
        shader.uniforms.uWaist = { value: arm.waist };
        shader.uniforms.uBust = { value: arm.bust };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vBindPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBindPos = (bindMatrix * vec4(position, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\n' + RECOLOR_HEAD)
          .replace('#include <map_fragment>', RECOLOR);
      };
      m.customProgramCacheKey = () => 'medieval-gown-2';
      m.needsUpdate = true;
    }
  });

  const root = avatar.root;
  root.updateMatrixWorld(true);
  const head = avatar.body.bones.head || findBone(model, (n) => n.endsWith('head'));
  const neck = findBone(model, (n) => n.endsWith('neck')) || head;
  if (!head || !neck) return;
  const inv = root.matrixWorld.clone().invert();
  const local = (o) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
  const headP = local(head);
  const neckP = local(neck);
  // The model faces +Z in the avatar's own space.
  const place = (obj, p, bone) => {
    obj.position.copy(p);
    root.add(obj);
    obj.updateMatrixWorld(true);
    bone.attach(obj);
  };
  const c = circlet();
  place(c, headP.clone().add(new THREE.Vector3(0, 0.15, 0.0)), head);

  const b = avatar.body.bones;
  const metal = steel();
  const hide = leather();
  // An ankle-length skirt over the legs, belted at the waist.
  if (b.hips && b.lFoot) {
    const hipsP = local(b.hips);
    const ankle = Math.min(local(b.lFoot).y, b.rFoot ? local(b.rFoot).y : 9);
    const top = hipsP.y + 0.1;
    place(skirt(top, ankle + 0.05), new THREE.Vector3(hipsP.x, top, hipsP.z), b.hips);
  }
  // Puffed wine sleeve-heads at the shoulders, as in a court gown; the rest
  // of each sleeve is painted on the arm.
  const puffMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  puffMat.color.setRGB(WINE[0] * 1.25, WINE[1] * 1.25, WINE[2] * 1.25);
  for (const s of ['l', 'r']) {
    const upper = b[s + 'UpperArm'];
    const fore = b[s + 'Forearm'];
    if (!upper || !fore) continue;
    const sh = local(upper);
    const el = local(fore);
    const puff = along(() => new THREE.SphereGeometry(0.066, 20, 14), puffMat, sh, el, 0.34, 0.0);
    puff.scale.set(1, 1.55, 1);
    root.add(puff);
    puff.updateMatrixWorld(true);
    upper.attach(puff);
  }
  // Riding boots: a leather shaft up the calf and a foot with a toe cap.
  for (const s of ['l', 'r']) {
    const foot = b[s + 'Foot'];
    const calf = b[s + 'Calf'];
    if (!foot || !calf) continue;
    const f = local(foot);
    const knee = local(calf);
    const shaft = along((h) => new THREE.CylinderGeometry(0.062, 0.056, h, 14), hide, new THREE.Vector3(f.x, Math.max(0.02, f.y - 0.04), f.z), knee, 0.72);
    root.add(shaft);
    shaft.updateMatrixWorld(true);
    calf.attach(shaft);
    const boot = new THREE.Group();
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.03, 0.25), new THREE.MeshStandardMaterial({ color: 0x1c120a, roughness: 0.9 }));
    sole.position.set(0, -f.y + 0.015, 0.045);
    const upper = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), hide);
    upper.scale.set(0.82, 0.75, 2.1);
    upper.position.set(0, -f.y + 0.06, 0.05);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal);
    cap.rotation.x = Math.PI / 2;
    cap.scale.set(1, 1, 0.9);
    cap.position.set(0, -f.y + 0.05, 0.15);
    boot.add(sole, upper, cap);
    place(boot, f, foot);
  }

}
