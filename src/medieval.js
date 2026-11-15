import * as THREE from 'three';
import { clothTex, steelTex } from './textures.js?v=acdcee8';

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
}
