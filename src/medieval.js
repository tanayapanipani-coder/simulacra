import * as THREE from 'three';
import { clothTex, steelTex } from './textures.js?v=af4bf79';

// Dress Sim for Crownfall: a medieval look on the shared modern avatar,
// without changing the avatar itself (the Simulacra page uses it as is).
//   - a wine gown under a dark green velvet bodice laced in gold, with an
//     embroidered V-neck, long sleeves with embroidered bands and a full
//     skirt, painted on her own surface in the shader so it fits and moves
//     exactly (skin of the face, neck and hands, and hair untouched);
//   - puffed sleeve-heads and the skirt's fall as meshes on
//     her bones;
//   - a gold crown with a jewel on her brow.

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
const vec3 LINEN = vec3(0.62, 0.57, 0.48);
// A soft 0..1 step, a few millimetres wide, so garment edges never alias.
float edge(float v, float at) {
  float w = max(fwidth(v), 0.08);
  return smoothstep(at - w, at + w, v);
}
// Embroidered braid: gold ground with red and green diamonds, antialiased.
vec3 embroidery(vec2 p) {
  vec2 q = fract(p * 0.55) - 0.5;
  float d = abs(q.x) + abs(q.y);
  float w = max(fwidth(d), 0.02);
  vec3 c = mix(vec3(0.38, 0.03, 0.04), vec3(0.02, 0.12, 0.06), smoothstep(0.2 - w, 0.2 + w, d));
  return mix(c, GOLD, smoothstep(0.3 - w, 0.3 + w, d));
}
// Cloth: an even colour with a fine weave and a slow, faint mottling, so
// every garment reads as one continuous fabric.
vec3 cloth(vec3 col, vec3 p, float weaveScale) {
  float weave = 0.5 + 0.5 * sin(p.x * weaveScale) * sin(p.y * weaveScale);
  float mottle = 0.5 + 0.5 * sin(p.x * 0.31 + p.y * 0.17) * sin(p.y * 0.23 - p.z * 0.29);
  return col * (0.93 + 0.07 * weave) * (0.95 + 0.1 * mottle);
}
`;

const RECOLOR = /* glsl */ `
#include <map_fragment>
{
  // The whole gown is painted on her own surface, so it fits and moves
  // with her exactly. Positions are in the bind pose, in the model's
  // centimetres (x across, y up, z forward); the right side mirrors the
  // left. Only her face, neck, hands and hair keep their own colours.
  vec3 p = vBindPos;
  vec3 bp = p;
  bp.x = abs(bp.x);
  vec3 c0 = diffuseColor.rgb;
  float mx = max(c0.r, max(c0.g, c0.b));
  float mn = min(c0.r, min(c0.g, c0.b));
  float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
  float lum = dot(c0, vec3(0.2126, 0.7152, 0.0722));
  bool skin = c0.r > c0.g * 1.05 && c0.g > c0.b * 1.02 && sat > 0.12;
  vec3 armDir = uWrist - uShoulder;
  float armLen = length(armDir);
  float along = dot(bp - uShoulder, armDir) / (armLen * armLen);
  float across = length(bp - uShoulder - armDir * along);
  bool onArm = along > 0.04 && along < 0.975 && across < 10.0;
  bool torso = bp.x < 24.0 && !onArm;
  float back = 1.0 - edge(bp.z, -2.0);           // 1 on her back
  // The bodice's top edge: under the bust in front, high across the back.
  float bodiceTop = mix(uBust + 9.0, uShoulder.y + 30.0, back);
  vec3 col = c0;
  if (onArm) {
    // Plum sleeve; embroidered bands on the upper arm and at the cuff,
    // each edged with a thin gold line.
    float l = along * armLen;
    float b0 = edge(l, 0.4 * armLen) * (1.0 - edge(l, 0.47 * armLen));
    float b1 = edge(l, 0.92 * armLen);
    vec3 emb = embroidery(vec2(l, atan(bp.z, bp.y) * 6.0));
    col = mix(cloth(WINE, p, 7.0), emb, max(b0, b1));
  } else if (torso && bp.y < uWaist) {
    // Below the waist: the skirt.
    col = cloth(WINE, p, 7.0);
    // Gold piping where the bodice meets the skirt.
    col = mix(col, GOLD, edge(bp.y, uWaist - 0.9));
  } else if (torso && bp.y < bodiceTop) {
    float vTop = uBust - 10.0;
    float vHalf = (bp.y - vTop) * 0.4;
    float inV = (1.0 - back) * edge(bp.y, vTop) * (1.0 - edge(bp.y, uBust + 9.0)) * (1.0 - edge(bp.x, vHalf));
    float vEdge = inV * edge(bp.x, vHalf - 1.8);
    vec3 bodice = cloth(GREEN, p, 9.0);
    // Boning: faint vertical seams every few centimetres.
    bodice *= 0.94 + 0.06 * smoothstep(0.0, 0.25, abs(fract(bp.x / 4.5) - 0.5));
    // Gold lacing up the front, below the V.
    float zig = abs(fract(bp.y * 0.4) - 0.5) * 2.0;
    float lace = (1.0 - back) * (1.0 - edge(bp.x, 1.7)) * (1.0 - edge(bp.y, vTop + 0.5));
    float cord = 1.0 - edge(abs(bp.x / 1.7 - zig), 0.28);
    bodice = mix(bodice, mix(GREEN * 0.35, GOLD, cord), lace);
    col = mix(bodice, cloth(WINE, p, 7.0), inV);
    col = mix(col, embroidery(bp.xy), vEdge);
    // Gold piping along the bodice's top edge.
    col = mix(col, GOLD, (1.0 - back) * (1.0 - inV) * edge(bp.y, bodiceTop - 0.8));
  } else if (torso && back < 0.5 && bp.x > 7.5 && bp.x < 16.5 && bp.y < uShoulder.y + 5.0 && !skin) {
    // Shoulder straps, piped at both edges.
    col = cloth(GREEN, p, 9.0);
    col = mix(col, GOLD, 1.0 - edge(bp.x, 8.3) + edge(bp.x, 15.7));
  } else if (!skin && back < 0.5 && lum > 0.3 && sat < 0.18) {
    // The white collar becomes the chemise's linen edge.
    col = cloth(LINEN, p, 14.0);
  } else if (!skin) {
    // Anything else of the old clothes: the gown's plum.
    col = cloth(WINE, p, 7.0);
  }
  diffuseColor.rgb = col;
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
  // A crown, not a circlet: a broad gold band with tall points all round, the front one tallest.
  gold.side = THREE.DoubleSide;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.101, 0.098, 0.032, 40, 1, true), gold);
  g.add(band);
  for (const y of [-0.016, 0.016]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(y > 0 ? 0.101 : 0.098, 0.004, 6, 40), gold);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = y;
    g.add(rim);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const h = i === 0 ? 0.07 : i % 2 === 0 ? 0.055 : 0.038;
    const p = new THREE.Mesh(new THREE.ConeGeometry(0.014, h, 4), gold);
    p.position.set(Math.sin(a) * 0.1, 0.016 + h / 2, Math.cos(a) * 0.1);
    g.add(p);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), i % 2 === 0 ? gem : gold);
    tip.position.set(Math.sin(a) * 0.1, 0.016 + h, Math.cos(a) * 0.1);
    g.add(tip);
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
  const velvet = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide });
  velvet.color.setRGB(...WINE);
  // A bell: snug at the waist, rounding out over the hips (covering them),
  // then falling in an even flare to the hem.
  const prof = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; // 0 at the waist, 1 at the hem
    const y = -t * len;
    const hips = Math.min(1, t / 0.16);
    const r = 0.135 + 0.065 * Math.sin((hips * Math.PI) / 2) + 0.18 * Math.max(0, t - 0.16) / 0.84;
    prof.push(new THREE.Vector2(r, y));
  }
  const geo = new THREE.LatheGeometry(prof.reverse(), 48);
  geo.translate(0, len / 2, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = (len / 2 - pos.getY(i)) / len;
    const a = Math.atan2(pos.getX(i), pos.getZ(i));
    const fold = 1 + Math.sin(a * 9) * 0.035 * Math.max(0, k - 0.2);
    pos.setX(i, pos.getX(i) * fold);
    pos.setZ(i, pos.getZ(i) * fold);
  }
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, velvet);
  body.position.y = -len / 2;
  g.add(body);
  // Nearly round: deep enough behind to cover the hips.
  g.scale.set(1, 1, 0.95);
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
      m.customProgramCacheKey = () => 'medieval-gown-6';
      // The modern clothes' folds and seams live in the normal map; the
      // gown is smooth cloth, so leave them out.
      m.normalMap = null;
      m.roughness = 0.85;
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
    // From the waist, starting inside her (her hips are painted the same
    // cloth), so the skirt grows smoothly out of her hips.
    const top = hipsP.y + 0.1;
    place(skirt(top, ankle + 0.05), new THREE.Vector3(hipsP.x, top, hipsP.z), b.hips);
  }
  // Puffed wine sleeve-heads at the shoulders, as in a court gown; the rest
  // of each sleeve is painted on the arm.
  // Exactly the sleeve's cloth, so puff and sleeve read as one.
  const puffMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  puffMat.color.setRGB(...WINE);
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
