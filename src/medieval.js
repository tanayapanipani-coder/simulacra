import * as THREE from 'three';
import { clothTex, steelTex } from './textures.js?v=0ab6170';

// Dress Sim for Crownfall: a medieval look on the shared modern avatar,
// without changing the avatar itself (the Simulacra page uses it as is).
//   - her mint shirt is dyed a deep burgundy velvet and her jeans dark
//     leather, in the shader, by hue, so skin, hair and trims are untouched;
//   - a long hooded cloak with a gold clasp hangs from her shoulders;
//   - a thin gold circlet with a jewel sits on her brow.
// Cloak and circlet ride on her neck and head bones, so they follow her
// as she turns, nods and gestures.

const RECOLOR = /* glsl */ `
#include <map_fragment>
{
  vec3 c = diffuseColor.rgb;
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  if (sat > 0.16 && c.g > c.r * 1.08 && c.g > c.b * 1.12) {
    // The shirt: burgundy velvet, keeping the cloth's folds and shading.
    diffuseColor.rgb = vec3(0.3, 0.025, 0.045) * clamp(lum * 1.15, 0.2, 1.2);
  } else if (sat > 0.1 && c.b > c.r * 1.08 && c.b >= c.g * 0.95) {
    // The jeans: dark brown riding leather.
    diffuseColor.rgb = vec3(0.13, 0.075, 0.04) * clamp(lum * 2.2, 0.3, 1.5);
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

function cloak(height) {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0x3a2448, roughness: 0.95, map: clothTex(), side: THREE.DoubleSide });
  const lining = new THREE.MeshStandardMaterial({ color: 0x5a1218, roughness: 0.9, map: clothTex(), side: THREE.BackSide });
  const len = height * 0.72;
  // The back half of a flared cylinder, open at the front, hung from the
  // shoulders; a turned-back hood lies on the shoulders.
  const geo = new THREE.CylinderGeometry(0.17, 0.36, len, 24, 6, true, Math.PI / 2, Math.PI);
  // Let the hem fall in soft folds.
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = (len / 2 - y) / len; // 0 at the top, 1 at the hem
    const a = Math.atan2(pos.getX(i), pos.getZ(i));
    const fold = Math.sin(a * 7) * 0.025 * k;
    pos.setX(i, pos.getX(i) * (1 + fold));
    pos.setZ(i, pos.getZ(i) * (1 + fold));
  }
  geo.computeVertexNormals();
  const outer = new THREE.Mesh(geo, cloth);
  outer.position.y = -len / 2;
  g.add(outer);
  const inner = new THREE.Mesh(geo, lining);
  inner.position.y = -len / 2;
  inner.scale.setScalar(0.985);
  g.add(inner);
  // Behind the neck (the model faces +Z).
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.035, 8, 20, Math.PI), cloth);
  hood.rotation.set(-Math.PI / 2, 0, 0);
  hood.position.set(0, -0.03, -0.035);
  g.add(hood);
  // Gold clasps at the collarbones, joined by a chain.
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9a73e, metalness: 1, roughness: 0.3 });
  for (const s of [-1, 1]) {
    const clasp = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), gold);
    clasp.scale.set(1, 1, 0.5);
    clasp.position.set(s * 0.12, -0.04, 0.07);
    g.add(clasp);
  }
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.24, 5), gold);
  chain.rotation.z = Math.PI / 2;
  chain.position.set(0, -0.05, 0.075);
  g.add(chain);
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
  const velvet = new THREE.MeshStandardMaterial({ color: 0x4a0c14, roughness: 0.85, map: clothTex(), side: THREE.DoubleSide });
  const geo = new THREE.CylinderGeometry(0.125, 0.34, len, 32, 6, true);
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
  const gold = new THREE.MeshStandardMaterial({ color: 0xc89a3a, metalness: 0.9, roughness: 0.35 });
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.345, 0.35, 0.035, 32, 1, true), gold);
  hem.position.y = -len + 0.03;
  g.add(hem);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.013, 6, 32), new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.7 }));
  belt.rotation.x = Math.PI / 2;
  g.add(belt);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.035, 0.01), gold);
  buckle.position.set(0, 0, 0.135);
  g.add(buckle);
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

  // Dye the body's clothes (not the head or hair).
  model.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const name = String(m?.name || '').toLowerCase();
      if (!m || name.includes('head') || name.includes('opacity') || m.userData.medieval) continue;
      m.userData.medieval = true;
      m.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', RECOLOR);
      };
      m.customProgramCacheKey = () => 'medieval-dye';
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
  const height = Math.max(1.4, headP.y + 0.15);
  // The model faces +Z in the avatar's own space.
  const place = (obj, p, bone) => {
    obj.position.copy(p);
    root.add(obj);
    obj.updateMatrixWorld(true);
    bone.attach(obj);
  };
  const c = circlet();
  place(c, headP.clone().add(new THREE.Vector3(0, 0.15, 0.0)), head);
  const k = cloak(height);
  place(k, neckP.clone().add(new THREE.Vector3(0, -0.02, -0.03)), neck);

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
  // Arm armour: a steel pauldron on each shoulder, rerebrace and couter on
  // the upper arm, and a vambrace with a leather strap on the forearm.
  for (const s of ['l', 'r']) {
    const upper = b[s + 'UpperArm'];
    const fore = b[s + 'Forearm'];
    const hand = findBone(model, (n) => n.endsWith(`${s} hand`) || n.endsWith(s === 'l' ? 'lefthand' : 'righthand'));
    if (!upper || !fore) continue;
    const sh = local(upper);
    const el = local(fore);
    const wr = hand ? local(hand) : el.clone().add(el.clone().sub(sh).multiplyScalar(0.9));
    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), metal);
    pauldron.scale.set(0.82, 0.68, 0.88);
    const out = new THREE.Vector3(sh.x - neckP.x, 0, 0).normalize();
    place(pauldron, sh.clone().add(new THREE.Vector3(out.x * 0.02, 0.025, 0)), upper);
    const lame = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.035, 16, 1, true), metal);
    place(lame, sh.clone().add(new THREE.Vector3(out.x * 0.02, -0.03, 0)), upper);
    const rere = along((h) => new THREE.CylinderGeometry(0.052, 0.056, h, 14), metal, sh, el, 0.5, 0.42);
    root.add(rere);
    rere.updateMatrixWorld(true);
    upper.attach(rere);
    const couter = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), metal);
    place(couter, el, fore);
    const vamb = along((h) => new THREE.CylinderGeometry(0.047, 0.04, h, 14), metal, el, wr, 0.78, 0.12);
    root.add(vamb);
    vamb.updateMatrixWorld(true);
    fore.attach(vamb);
    for (const t of [0.3, 0.75]) {
      const strap = along((h) => new THREE.CylinderGeometry(0.05, 0.05, h, 14, 1, true), hide, el, wr, 0.04, 0.12 + t * 0.78 - 0.02);
      root.add(strap);
      strap.updateMatrixWorld(true);
      fore.attach(strap);
    }
  }
}
