import * as THREE from 'three';
import { buildRanger, RANGER_PALETTES } from './ranger.js';
import { createRig } from './rig.js';

const MINI_SCALE = 0.045;

export function standard(color, roughness = 0.55) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.06,
    envMapIntensity: 0.55,
  });
}

export function metal(color, emissive = 0x000000) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 0.28,
    metalness: 0.88,
    roughness: 0.26,
    envMapIntensity: 1.15,
  });
}

function add(group, mesh) {
  group.add(mesh);
  return mesh;
}

export function createMiniature(type, side) {
  const group = new THREE.Group();
  const gold = side === 0;
  const primary = metal(gold ? 0xf2d48a : 0xd5d2f4, gold ? 0x5a3d12 : 0x2a2150);
  const accent = metal(gold ? 0xffe6a6 : 0xf2ecff, gold ? 0x7a5418 : 0x3d2c78);
  accent.emissiveIntensity = 0.55;
  const cloth = standard(gold ? 0x8d2434 : 0x2a1858, 0.62);
  const leather = standard(gold ? 0x4a301c : 0x241c28, 0.72);
  const dark = metal(gold ? 0x6e5428 : 0x6a6790, 0x000000);

  if (type === 'S' || type === 'A') {
    const figure = buildRanger({
      kind: type === 'A' ? 'archer' : 'sword',
      palette: RANGER_PALETTES[gold ? 0 : 1],
      pose: 'mini',
    });
    figure.scale.setScalar(MINI_SCALE);
    group.add(figure);
    group.traverse((obj) => {
      if (obj.isMesh) obj.userData.mini = true;
    });
    return group;
  }

  const base = add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.023, 0.007, 18), primary));
  base.position.y = 0.0035;
  const ring = add(group, new THREE.Mesh(new THREE.TorusGeometry(0.0175, 0.0024, 6, 20), accent));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.0072;

  buildMonarch(group, { primary, accent, cloth, leather, dark });

  group.traverse((obj) => {
    if (obj.isMesh) obj.userData.mini = true;
  });
  return group;
}

function buildMonarch(group, m) {
  const robe = add(group, new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.042, 8), m.cloth));
  robe.position.y = 0.03;
  const trim = add(group, new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.002, 6, 16), m.primary));
  trim.rotation.x = Math.PI / 2;
  trim.position.y = 0.022;
  const torso = add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.018, 8), m.primary));
  torso.position.y = 0.048;
  const head = add(group, new THREE.Mesh(new THREE.SphereGeometry(0.0074, 10, 8), m.leather));
  head.position.y = 0.064;
  const crown = add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.007, 0.008, 6), m.accent));
  crown.position.y = 0.074;
  for (let i = 0; i < 4; i++) {
    const prong = add(group, new THREE.Mesh(new THREE.ConeGeometry(0.0022, 0.008, 4), m.accent));
    const a = (i / 4) * Math.PI * 2;
    prong.position.set(Math.cos(a) * 0.006, 0.08, Math.sin(a) * 0.006);
  }
  const jewel = add(group, new THREE.Mesh(new THREE.OctahedronGeometry(0.0032, 0), standard(0x9ad7ff, 0.2)));
  jewel.position.y = 0.086;
  const cape = add(group, new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.04, 7, 1, true), m.cloth));
  cape.position.set(0, 0.034, -0.004);
  cape.rotation.x = 0.15;
  const scepter = add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.0014, 0.0014, 0.03, 5), m.primary));
  scepter.position.set(0.012, 0.05, 0.006);
  scepter.rotation.z = -0.35;
  const orb = add(group, new THREE.Mesh(new THREE.SphereGeometry(0.0035, 8, 6), m.accent));
  orb.position.set(0.017, 0.064, 0.008);
}

export function createBattleSword(hex = 0xf0d090) {
  const group = new THREE.Group();
  const bladeMat = metal(hex, 0x3a2a10);
  bladeMat.emissiveIntensity = 0.55;
  const gripMat = standard(0x3a2416, 0.62);
  const grip = add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.2, 8), gripMat));
  grip.rotation.x = Math.PI / 2;
  grip.position.z = -0.02;
  const pommel = add(group, new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), bladeMat));
  pommel.position.z = 0.09;
  const guard = add(group, new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.028, 0.045), bladeMat));
  guard.position.z = -0.13;
  const blade = add(group, new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.012, 0.62), bladeMat));
  blade.position.z = -0.46;
  const fuller = add(group, new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.014, 0.48), metal(0xfff4d2, 0x6a5018)));
  fuller.position.z = -0.44;
  const tip = add(group, new THREE.Mesh(new THREE.ConeGeometry(0.034, 0.12, 4), bladeMat));
  tip.rotation.x = Math.PI / 2;
  tip.position.z = -0.82;
  group.userData.tip = new THREE.Vector3(0, 0, -0.9);
  group.userData.base = new THREE.Vector3(0, 0, -0.14);
  return group;
}

export function createBattleShield(hex = 0xf0d090) {
  const group = new THREE.Group();
  const face = metal(hex, 0x2a2010);
  const disc = add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.045, 16), face));
  disc.rotation.x = Math.PI / 2;
  const boss = add(group, new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), metal(0xfff1c4, 0x5a4010)));
  boss.position.z = -0.04;
  const rim = add(group, new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.02, 6, 18), metal(0x8d7340)));
  group.position.z = -0.05;
  return group;
}

export function createBattleBow(hex = 0xf0d090) {
  const group = new THREE.Group();
  const wood = standard(0x6a4324, 0.55);
  const accent = metal(hex, 0x3a2a10);
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, -0.58, 0.08),
    new THREE.Vector3(0, 0, -0.32),
    new THREE.Vector3(0, 0.58, 0.08),
  );
  const limb = add(group, new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.014, 6, false), wood));
  const wrap = add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), accent));
  // The string is two segments from the limb tips to the nock point, so it
  // bends to wherever it is drawn from (see setBowString).
  const strGeo = new THREE.CylinderGeometry(0.004, 0.004, 1, 4);
  const stringTop = add(group, new THREE.Mesh(strGeo, accent));
  const stringBot = add(group, new THREE.Mesh(strGeo, accent));
  const nock = createArrowMesh(hex);
  group.add(nock);
  group.userData.stringTop = stringTop;
  group.userData.stringBot = stringBot;
  group.userData.tipTop = new THREE.Vector3(0, 0.58, 0.08);
  group.userData.tipBot = new THREE.Vector3(0, -0.58, 0.08);
  group.userData.grip = new THREE.Vector3(0, 0, -0.02);
  group.userData.nock = nock;
  group.userData.restZ = 0.08;
  setBowString(group, new THREE.Vector3(0, 0, 0.08));
  return group;
}

const _segDir = new THREE.Vector3();
const _segUp = new THREE.Vector3(0, 1, 0);
function segment(mesh, a, b) {
  _segDir.subVectors(b, a);
  const len = Math.max(1e-4, _segDir.length());
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(_segUp, _segDir.divideScalar(len));
}

const _arrowAxis = new THREE.Vector3(0, 0, -1);
const _arrowDir = new THREE.Vector3();
/**
 * Pull the bow string to `nockLocal` (bow space) and lay the nocked arrow from
 * there through the grip. Arrow meshes point down -Z with the nock at +0.34.
 */
export function setBowString(bow, nockLocal) {
  const d = bow.userData;
  segment(d.stringTop, d.tipTop, nockLocal);
  segment(d.stringBot, d.tipBot, nockLocal);
  _arrowDir.subVectors(d.grip, nockLocal);
  if (_arrowDir.lengthSq() < 1e-6) _arrowDir.set(0, 0, -1);
  _arrowDir.normalize();
  d.nock.quaternion.setFromUnitVectors(_arrowAxis, _arrowDir);
  d.nock.position.copy(nockLocal).addScaledVector(_arrowDir, 0.34);
}

export function createArrowMesh(hex = 0xe8d2a0) {
  const group = new THREE.Group();
  const shaft = add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.72, 5), standard(0x8b5a32, 0.5)));
  shaft.rotation.x = Math.PI / 2;
  const head = add(group, new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 5), metal(hex, 0x33240e)));
  head.rotation.x = Math.PI / 2;
  head.position.z = -0.4;
  const fletchMat = standard(0xf2efe6, 0.45);
  for (const rot of [0, 2.1, 4.2]) {
    const f = add(group, new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 0.12), fletchMat));
    f.position.set(0, 0, 0.28);
    f.rotation.z = rot;
  }
  return group;
}

export function createSoldier(kind, colors) {
  const side = colors.side ?? (colors.metal === 0xf0d090 ? 0 : 1);
  const figure = buildRanger({
    kind: kind === 'sword' ? 'sword' : 'archer',
    palette: RANGER_PALETTES[side],
    pose: 'soldier',
    eyeColor: kind === 'archer' ? 0xffe2a8 : 0xff5a3c,
  });
  createRig(figure);
  return figure;
}
