import * as THREE from 'three';
import { buildRanger, RANGER_PALETTES } from './ranger.js?v=76b5cfd';
import { createRig } from './rig.js?v=76b5cfd';
import { leatherTex, steelRough, steelTex, woodTex } from './textures.js?v=76b5cfd';

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
  const kind = type === 'A' ? 'archer' : type === 'S' ? 'sword' : 'king';
  const figure = buildRanger({ kind, palette: RANGER_PALETTES[side === 0 ? 0 : 1], pose: 'mini' });
  // The monarch stands just a little taller than the court around it.
  figure.scale.setScalar(kind === 'king' ? MINI_SCALE * 1.05 : MINI_SCALE);
  group.add(figure);
  group.traverse((obj) => {
    if (obj.isMesh) obj.userData.mini = true;
  });
  return group;
}

// Shared, textured materials for the player's own weapons.
let weaponMats = null;
function wm() {
  if (weaponMats) return weaponMats;
  const steelMap = steelTex();
  weaponMats = {
    blade: new THREE.MeshStandardMaterial({ color: 0xd0d4da, metalness: 0.96, roughness: 0.18, map: steelMap, roughnessMap: steelRough() }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x55575d, metalness: 0.85, roughness: 0.42, map: steelMap }),
    brass: new THREE.MeshStandardMaterial({ color: 0x8c6d36, metalness: 0.8, roughness: 0.4, map: steelMap }),
    grip: new THREE.MeshStandardMaterial({ color: 0x2a1c13, roughness: 0.8, map: leatherTex() }),
    wood: new THREE.MeshStandardMaterial({ color: 0x3e2a1b, roughness: 0.65, map: woodTex() }),
    woodPale: new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.7, map: woodTex() }),
    string: new THREE.MeshStandardMaterial({ color: 0x2e2822, roughness: 0.9 }),
    feather: new THREE.MeshStandardMaterial({ color: 0x8e8880, roughness: 0.9, side: THREE.DoubleSide }),
    featherDark: new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 0.9, side: THREE.DoubleSide }),
  };
  return weaponMats;
}

export function createBattleSword() {
  // A knightly longsword. Grip at the origin, blade along -Z, edges along ±X.
  const group = new THREE.Group();
  const m = wm();
  add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.02, 0.2, 10), m.grip)).rotation.x = Math.PI / 2;
  group.children[0].position.z = -0.02;
  for (const z of [-0.08, 0.04]) {
    const ring = add(group, new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, 5, 12), m.steelDark));
    ring.position.z = z;
  }
  const pommel = add(group, new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 8), m.steelDark));
  pommel.scale.set(1, 0.55, 1);
  pommel.rotation.x = Math.PI / 2;
  pommel.position.z = 0.1;
  // A straight cross with flared, down-turned ends.
  const cross = add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.26, 8), m.steelDark));
  cross.rotation.z = Math.PI / 2;
  cross.position.z = -0.13;
  for (const sx of [-1, 1]) {
    const end = add(group, new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), m.steelDark));
    end.position.set(sx * 0.13, 0, -0.13);
  }
  // Blade profile: x across the blade, y toward the point; a long gentle taper
  // into a sharp point, bevelled so the light runs down the edges.
  const shape = new THREE.Shape();
  shape.moveTo(-0.028, 0);
  shape.lineTo(0.028, 0);
  shape.lineTo(0.022, 0.6);
  shape.quadraticCurveTo(0.016, 0.7, 0, 0.78);
  shape.quadraticCurveTo(-0.016, 0.7, -0.022, 0.6);
  shape.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.004,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.006,
    bevelSegments: 1,
    curveSegments: 6,
  });
  bladeGeo.translate(0, 0, -0.002);
  bladeGeo.rotateX(-Math.PI / 2);
  const blade = add(group, new THREE.Mesh(bladeGeo, m.blade));
  blade.position.z = -0.14;
  // The fuller: a dark groove down both faces.
  for (const sy of [-1, 1]) {
    const fuller = add(group, new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.002, 0.5), m.steelDark));
    fuller.position.set(0, sy * 0.0055, -0.42);
  }
  // Faint edge lines; combat brightens them while a swing leads with the edge.
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, emissive: 0xbfd4ff, emissiveIntensity: 0.15, metalness: 0.9, roughness: 0.15 });
  for (const side of [-1, 1]) {
    const edge = add(group, new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.003, 0.58), edgeMat));
    edge.position.set(side * 0.031, 0, -0.43);
    edge.rotation.y = side * 0.01;
  }
  group.userData.edgeMat = edgeMat;
  group.userData.tip = new THREE.Vector3(0, 0, -0.92);
  group.userData.base = new THREE.Vector3(0, 0, -0.14);
  return group;
}

export function createBattleShield() {
  // A heater shield held on the forearm: painted wood (the player's Gold
  // court), an iron rim and a central boss, face toward -Z.
  const group = new THREE.Group();
  const m = wm();
  const outline = new THREE.Shape();
  outline.moveTo(-0.27, 0.3);
  outline.quadraticCurveTo(0, 0.34, 0.27, 0.3);
  outline.lineTo(0.27, 0.05);
  outline.quadraticCurveTo(0.25, -0.24, 0, -0.42);
  outline.quadraticCurveTo(-0.25, -0.24, -0.27, 0.05);
  outline.closePath();
  const geo = new THREE.ExtrudeGeometry(outline, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 10 });
  geo.translate(0, 0, -0.015);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, 1 - (pos.getX(i) + 0.28) / 0.56, (pos.getY(i) + 0.43) / 0.78);
  uv.needsUpdate = true;
  const face = new THREE.MeshStandardMaterial({ map: shieldHeraldry(0), roughness: 0.68, metalness: 0.05 });
  group.userData.setCourt = (side) => {
    face.map = shieldHeraldry(side);
  };
  add(group, new THREE.Mesh(geo, [face, m.wood]));
  const rimPts = outline.getPoints(20).map((p) => new THREE.Vector3(p.x, p.y, -0.025));
  add(group, new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts, true), 70, 0.013, 6, true), m.steelDark));
  const boss = add(group, new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.steelDark));
  boss.rotation.x = -Math.PI / 2;
  boss.position.set(0, 0.04, -0.025);
  group.position.z = -0.05;
  return group;
}

const heraldryTex = [];
function shieldHeraldry(side) {
  if (heraldryTex[side]) return heraldryTex[side];
  const [field, charge] = side === 0 ? ['#5c1513', '#a8843f'] : ['#1b1f3e', '#a3a9b3'];
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = field;
  g.fillRect(0, 0, 256, 256);
  // A chevron and three roundels in the court's metal: simple, heraldic.
  g.fillStyle = charge;
  g.beginPath();
  g.moveTo(0, 170);
  g.lineTo(128, 80);
  g.lineTo(256, 170);
  g.lineTo(256, 205);
  g.lineTo(128, 115);
  g.lineTo(0, 205);
  g.closePath();
  g.fill();
  for (const [x, y] of [[70, 50], [186, 50], [128, 200]]) {
    g.beginPath();
    g.arc(x, y, 17, 0, Math.PI * 2);
    g.fill();
  }
  // Battle damage: scrapes, chips and grime.
  for (let i = 0; i < 220; i++) {
    g.strokeStyle = `rgba(${Math.random() < 0.6 ? '20,14,10' : '190,175,150'},${0.12 + Math.random() * 0.3})`;
    g.lineWidth = 0.5 + Math.random() * 1.5;
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 40);
    g.stroke();
  }
  const grime = g.createRadialGradient(128, 128, 40, 128, 128, 190);
  grime.addColorStop(0, 'rgba(0,0,0,0)');
  grime.addColorStop(1, 'rgba(20,12,6,0.55)');
  g.fillStyle = grime;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  heraldryTex[side] = tex;
  return tex;
}

export function createBattleBow(hex = 0xf0d090) {
  const group = new THREE.Group();
  const m = wm();
  // A dark-wood recurve: limbs bending away from the archer, tips curling
  // back toward the string.
  const half = [[0, 0], [-0.02, 0.12], [-0.1, 0.3], [-0.09, 0.44], [0.03, 0.54], [0.08, 0.58]];
  const pts = [];
  for (let i = half.length - 1; i > 0; i--) pts.push(new THREE.Vector3(0, -half[i][1], half[i][0]));
  for (const [z, y] of half) pts.push(new THREE.Vector3(0, y, z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
  add(group, new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.017, 8, false), m.wood)).scale.set(0.7, 1, 1);
  add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.13, 10), m.grip));
  for (const y of [-0.07, 0.07]) add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.01, 10), m.brass)).position.y = y;
  const accent = m.string;
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
  // A gloved drawing hand that sits on the string while it is pulled back.
  const glove = new THREE.Group();
  const leather = m.grip;
  add(glove, new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.085, 0.06), leather)).position.set(0.03, -0.02, 0.03);
  for (let i = 0; i < 3; i++) {
    const finger = add(glove, new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.02, 0.05), leather));
    finger.position.set(-0.004, 0.022 - i * 0.022, 0.0);
  }
  glove.visible = false;
  group.add(glove);
  group.userData.glove = glove;
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
  // Points down -Z with the nock at +0.36: ash shaft, steel bodkin, fletching.
  const group = new THREE.Group();
  const m = wm();
  const shaft = add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.72, 6), m.woodPale));
  shaft.rotation.x = Math.PI / 2;
  const head = add(group, new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.09, 4), m.steelDark));
  head.rotation.x = -Math.PI / 2;
  head.position.z = -0.4;
  const fletch = hex === 0xd7c4a2 ? m.featherDark : m.feather;
  for (const rot of [0, 2.1, 4.2]) {
    const f = add(group, new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.0015, 0.11), fletch));
    f.position.set(0, 0, 0.28);
    f.rotation.z = rot;
    f.translateX(0.014);
  }
  add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.02, 6), m.string)).rotation.x = Math.PI / 2;
  group.children[group.children.length - 1].position.z = 0.355;
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
