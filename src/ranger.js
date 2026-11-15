import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js?v=af4bf79';
import { asBump, clothTex, leatherTex, mailTex, steelRough, steelTex, stoneTex, woodTex } from './textures.js?v=af4bf79';

// Battle-worn medieval soldiers, shared by the board miniatures and the
// duel enemies. Realistic proportions and materials: smooth-shaded plate over
// riveted mail, great helms, quilted gambesons, leather and dark wood, with
// muted faction colours (Gold: deep crimson and tarnished gold; Violet:
// midnight blue and dull silver).
//
// Built in figure units (feet at y = 0, about 1.9 tall), front toward +z, the
// figure's right side toward -x. The skeleton is a real joint hierarchy the
// combat rig bends (see rig.js):
//
//   root
//    └ body
//       └ pelvis (hips, y 0.92) ── faulds, belt, skirt
//          ├ legR / legL (hip)  └ knee └ ankle
//          └ spine (waist)     ── torso, gorget, cloak, quiver
//             ├ neck (head)
//             └ armR / armL (shoulder) └ fore (elbow) └ hand (wrist)

export const THIGH_LEN = 0.44;
export const SHIN_LEN = 0.36;
export const UPPER_LEN = 0.27;
export const FORE_LEN = 0.25;

export const RANGER_PALETTES = [
  // Gold court: deep crimson cloth, tarnished-gold trim.
  {
    steel: 0x8e9197,
    steelDark: 0x45474d,
    cloth: 0x5a1614,
    clothDark: 0x2e0c0b,
    trim: 0x9c7b3a,
    gambeson: 0x4c2b22,
    leather: 0x3a281b,
    field: '#5c1513',
    charge: '#a8843f',
  },
  // Violet court: midnight-blue cloth, dull-silver trim.
  {
    steel: 0x878c94,
    steelDark: 0x3d4047,
    cloth: 0x1c2040,
    clothDark: 0x0e1022,
    trim: 0x9ea4ae,
    gambeson: 0x24273a,
    leather: 0x2c2620,
    field: '#1b1f3e',
    charge: '#a3a9b3',
  },
];

// ------------------------------------------------------------- helpers ---
function part(parent, geo, mat, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(p[0], p[1], p[2]);
  m.rotation.set(r[0], r[1], r[2]);
  m.scale.set(s[0], s[1], s[2]);
  parent.add(m);
  return m;
}

// Ragged, uneven hem on an open-ended cylinder (cloaks, skirts).
function raggedHem(geo, radialSegments, amount) {
  const pos = geo.attributes.position;
  const ring = radialSegments + 1;
  for (let i = 0; i < ring; i++) {
    const idx = ring + i;
    const drop = (i % 2 ? amount : amount * 0.3) + ((i * 37) % 5) * amount * 0.1;
    pos.setY(idx, pos.getY(idx) - drop);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Heraldry painted on a shield: the court's field with a chevron in its trim
// colour, worn and scuffed.
const heraldryCache = new Map();
function heraldry(palette) {
  if (heraldryCache.has(palette.field)) return heraldryCache.get(palette.field);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = palette.field;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = palette.charge;
  g.beginPath();
  g.moveTo(0, 175);
  g.lineTo(128, 70);
  g.lineTo(256, 175);
  g.lineTo(256, 215);
  g.lineTo(128, 110);
  g.lineTo(0, 215);
  g.closePath();
  g.fill();
  for (let i = 0; i < 140; i++) {
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? '15,12,10' : '200,190,170'},${0.15 + Math.random() * 0.25})`;
    g.lineWidth = 0.6 + Math.random();
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  heraldryCache.set(palette.field, tex);
  return tex;
}

// ----------------------------------------------------------- materials ---
const matCache = new Map();
function materialsFor(palette) {
  if (matCache.has(palette)) return matCache.get(palette);
  const steelMap = steelTex();
  const std = (opts) => new THREE.MeshStandardMaterial(opts);
  const m = {
    steel: std({ color: palette.steel, metalness: 0.62, roughness: 0.4, envMapIntensity: 1.5, map: steelMap, roughnessMap: steelRough() }),
    steelDark: std({ color: palette.steelDark, metalness: 0.6, roughness: 0.5, envMapIntensity: 1.4, map: steelMap }),
    steelDouble: std({ color: palette.steel, metalness: 0.62, roughness: 0.4, envMapIntensity: 1.5, map: steelMap, side: THREE.DoubleSide }),
    blade: std({ color: 0xc8ccd3, metalness: 0.95, roughness: 0.2, map: steelMap }),
    mail: std({ color: 0x8b8e93, metalness: 0.6, envMapIntensity: 1.4, roughness: 0.45, map: mailTex(), bumpMap: asBump(mailTex()), bumpScale: 1.6 }),
    cloth: std({ color: palette.cloth, roughness: 0.95, map: clothTex() }),
    clothDouble: std({ color: palette.cloth, roughness: 0.95, map: clothTex(), side: THREE.DoubleSide }),
    clothDark: std({ color: palette.clothDark, roughness: 0.95, map: clothTex() }),
    gambeson: std({ color: palette.gambeson, roughness: 0.92, map: clothTex() }),
    trim: std({ color: palette.trim, metalness: 0.75, roughness: 0.42, map: steelMap }),
    leather: std({ color: palette.leather, roughness: 0.78, map: leatherTex() }),
    leatherDark: std({ color: 0x1e1712, roughness: 0.82, map: leatherTex() }),
    wood: std({ color: 0x3a281a, roughness: 0.72, map: woodTex() }),
    feather: std({ color: 0x8a8580, roughness: 0.9, side: THREE.DoubleSide }),
    shield: std({ map: heraldry(palette), roughness: 0.7, metalness: 0.05 }),
    stone: std({ color: 0x4a4642, roughness: 0.92, map: stoneTex() }),
    string: std({ color: 0x2c2620, roughness: 0.9 }),
    slit: new THREE.MeshBasicMaterial({ color: 0x050404, side: THREE.DoubleSide }),
  };
  matCache.set(palette, m);
  return m;
}

// ---------------------------------------------------------------- legs ---
// Hip (this group) -> knee -> ankle. Mail chausses, plate cuisses, poleyns,
// greaves and sabatons for knights; soldiers' boots and hose for archers.
function buildLeg(m, S, armoured) {
  const leg = new THREE.Group();
  if (armoured) {
    part(leg, new THREE.CylinderGeometry(0.082, 0.072, 0.4, S), m.mail, [0, -0.2, 0]);
    part(leg, new THREE.CylinderGeometry(0.092, 0.08, 0.3, S, 1, true, -Math.PI / 2, Math.PI), m.steelDouble, [0, -0.19, 0]);
  } else {
    part(leg, new THREE.CylinderGeometry(0.08, 0.07, 0.4, S), m.gambeson, [0, -0.2, 0]);
  }
  const knee = new THREE.Group();
  knee.position.y = -THIGH_LEN;
  leg.add(knee);
  if (armoured) {
    part(knee, new THREE.SphereGeometry(0.068, S, Math.max(6, S * 0.6)), m.steel, [0, 0, 0.032], [0, 0, 0], [1, 0.85, 0.9]);
    part(knee, new THREE.CylinderGeometry(0.07, 0.059, 0.33, S), m.steel, [0, -0.19, 0]);
  } else {
    part(knee, new THREE.SphereGeometry(0.062, S, Math.max(6, S * 0.6)), m.gambeson, [0, 0, 0.012]);
    // Tall leather boots.
    part(knee, new THREE.CylinderGeometry(0.068, 0.06, 0.34, S), m.leather, [0, -0.19, 0]);
  }
  const ankle = new THREE.Group();
  ankle.position.y = -SHIN_LEN;
  knee.add(ankle);
  part(ankle, new THREE.SphereGeometry(0.07, S, Math.max(6, S * 0.6)), armoured ? m.steelDark : m.leather, [0, -0.06, 0.05], [0, 0, 0], [1, 0.62, 1.75]);
  part(ankle, new THREE.BoxGeometry(0.12, 0.03, 0.25), m.leatherDark, [0, -0.105, 0.04]);
  return { leg, knee, ankle };
}

// ---------------------------------------------------------------- arms ---
function buildArm(m, S, side, armoured) {
  // side: -1 = figure's right (-x), +1 = figure's left (+x)
  const arm = new THREE.Group();
  const cap = (r) => new THREE.SphereGeometry(r, S, Math.max(6, S * 0.6), 0, Math.PI * 2, 0, Math.PI * 0.6);
  if (armoured) {
    // Layered pauldron: a domed cap over two lames.
    part(arm, cap(0.14), m.steel, [side * 0.03, 0.03, 0], [0, 0, side * 0.32], [1.15, 0.85, 1.05]);
    part(arm, new THREE.CylinderGeometry(0.128, 0.134, 0.05, S, 1, true), m.steelDouble, [side * 0.03, -0.06, 0], [0, 0, side * 0.28]);
    part(arm, new THREE.CylinderGeometry(0.112, 0.118, 0.045, S, 1, true), m.steelDouble, [side * 0.035, -0.1, 0], [0, 0, side * 0.24]);
    part(arm, new THREE.CylinderGeometry(0.06, 0.055, 0.27, S), m.mail, [0, -0.13, 0]);
    part(arm, new THREE.CylinderGeometry(0.065, 0.058, 0.15, S), m.steel, [0, -0.17, 0]);
  } else {
    part(arm, cap(0.1), m.leather, [side * 0.02, 0.02, 0], [0, 0, side * 0.3], [1.1, 0.8, 1]);
    part(arm, new THREE.CylinderGeometry(0.066, 0.058, 0.27, S), m.gambeson, [0, -0.13, 0]);
  }
  const fore = new THREE.Group();
  fore.position.y = -UPPER_LEN;
  arm.add(fore);
  if (armoured) {
    part(fore, new THREE.SphereGeometry(0.058, S, Math.max(6, S * 0.6)), m.steel);
    part(fore, new THREE.CylinderGeometry(0.06, 0.06, 0.012, S), m.steel, [side * 0.05, 0, -0.01], [0, 0, Math.PI / 2]);
    part(fore, new THREE.CylinderGeometry(0.06, 0.05, 0.19, S), m.steel, [0, -0.12, 0]);
    part(fore, new THREE.CylinderGeometry(0.064, 0.055, 0.05, S), m.steelDark, [0, -0.215, 0]);
    part(fore, new THREE.SphereGeometry(0.055, S, Math.max(6, S * 0.6)), m.steelDark, [0, -0.255, 0.006], [0, 0, 0], [0.9, 1.15, 1.1]);
  } else {
    part(fore, new THREE.SphereGeometry(0.056, S, Math.max(6, S * 0.6)), m.gambeson);
    part(fore, new THREE.CylinderGeometry(0.058, 0.048, 0.19, S), m.leather, [0, -0.12, 0]);
    part(fore, new THREE.SphereGeometry(0.05, S, Math.max(6, S * 0.6)), m.leatherDark, [0, -0.255, 0.006], [0, 0, 0], [0.9, 1.15, 1.1]);
  }
  const hand = new THREE.Object3D();
  hand.position.y = -FORE_LEN;
  fore.add(hand);
  return { arm, fore, hand };
}

// ---------------------------------------------------------------- heads ---
function greatHelm(m, S, eyeColor, crest) {
  const head = new THREE.Group();
  part(head, new THREE.CylinderGeometry(0.13, 0.136, 0.27, S), m.steel, [0, 0.15, 0]);
  part(head, new THREE.SphereGeometry(0.13, S, Math.max(6, S / 2), 0, Math.PI * 2, 0, Math.PI / 2), m.steel, [0, 0.285, 0], [0, 0, 0], [1, 0.38, 1]);
  // The narrow sight: a dark slit with a faint ember glow behind it.
  part(head, new THREE.CylinderGeometry(0.1375, 0.1375, 0.022, S, 1, true, -1.0, 2.0), m.slit, [0, 0.19, 0]);
  if (eyeColor) {
    const glow = new THREE.MeshBasicMaterial({ color: eyeColor, side: THREE.DoubleSide });
    part(head, new THREE.CylinderGeometry(0.128, 0.128, 0.01, S, 1, true, -0.55, 1.1), glow, [0, 0.19, 0]);
  }
  part(head, new THREE.CylinderGeometry(0.1395, 0.1395, 0.03, S, 1, true, -1.25, 2.5), m.steelDark, [0, 0.215, 0]);
  part(head, new THREE.BoxGeometry(0.024, 0.27, 0.012), m.steelDark, [0, 0.15, 0.134]);
  // Breaths punched in the right cheek.
  for (let i = 0; i < 6; i++) {
    const a = -0.55 - (i % 3) * 0.13;
    const y = 0.07 + Math.floor(i / 3) * 0.035;
    part(head, new THREE.BoxGeometry(0.012, 0.018, 0.01), m.slit, [Math.sin(a) * 0.136, y, Math.cos(a) * 0.136], [0, a, 0]);
  }
  if (crest) {
    // A horsehair crest in the court's colour.
    part(head, new THREE.BoxGeometry(0.022, 0.07, 0.22), m.clothDark, [0, 0.33, -0.01]);
    part(head, new THREE.BoxGeometry(0.02, 0.05, 0.1), m.clothDark, [0, 0.3, -0.14], [0.6, 0, 0]);
  }
  return head;
}

function kettleHat(m, S) {
  const head = new THREE.Group();
  // Mail coif with a dark face opening, under a broad-brimmed iron hat.
  part(head, new THREE.SphereGeometry(0.115, S, Math.max(6, S * 0.6)), m.mail, [0, 0.12, 0], [0, 0, 0], [1, 1.12, 1.02]);
  part(head, new THREE.CylinderGeometry(0.1175, 0.1175, 0.1, S, 1, true, -0.75, 1.5), m.slit, [0, 0.12, 0]);
  part(head, new THREE.SphereGeometry(0.125, S, Math.max(6, S / 2), 0, Math.PI * 2, 0, Math.PI / 2), m.steel, [0, 0.175, 0], [0, 0, 0], [1, 0.8, 1]);
  part(head, new THREE.CylinderGeometry(0.13, 0.205, 0.045, S, 1, true), m.steelDouble, [0, 0.165, 0]);
  part(head, new THREE.TorusGeometry(0.205, 0.008, 4, S * 2), m.steelDark, [0, 0.142, 0], [Math.PI / 2, 0, 0]);
  return head;
}

// Royal regalia, the same bright gold for both courts so the monarch is
// unmistakable; the jewels are in the court's colour.
const regaliaCache = new Map();
function regalia(palette) {
  if (regaliaCache.has(palette)) return regaliaCache.get(palette);
  const gem = palette.field === '#5c1513' ? 0xc0182a : 0x2a4cd8;
  const r = {
    gold: new THREE.MeshStandardMaterial({ color: 0xe0ad3c, metalness: 1, roughness: 0.24, emissive: 0x6a4410, emissiveIntensity: 0.55, map: steelTex() }),
    gem: new THREE.MeshStandardMaterial({ color: gem, metalness: 0.2, roughness: 0.1, emissive: gem, emissiveIntensity: 0.6 }),
    ermine: new THREE.MeshStandardMaterial({ color: 0xece6da, roughness: 0.95, map: clothTex() }),
    spot: new THREE.MeshBasicMaterial({ color: 0x111111 }),
    glow: new THREE.MeshBasicMaterial({ color: palette.field === '#5c1513' ? 0xffc35a : 0xa98bff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  };
  regaliaCache.set(palette, r);
  return r;
}

// A tall, closed crown: a jewelled band, eight fleur points with pearls,
// two arches meeting under an orb and cross. About twice the height of the
// helm it sits on, so it reads from across the table.
function crown(r, S) {
  const c = new THREE.Group();
  const R = 0.17;
  part(c, new THREE.CylinderGeometry(R, R * 0.96, 0.1, S * 2, 1, true), r.gold, [0, 0.36, 0]);
  part(c, new THREE.TorusGeometry(R, 0.014, 6, S * 2), r.gold, [0, 0.31, 0], [Math.PI / 2, 0, 0]);
  part(c, new THREE.TorusGeometry(R * 1.01, 0.012, 6, S * 2), r.gold, [0, 0.41, 0], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = Math.sin(a) * R;
    const z = Math.cos(a) * R;
    // Alternate tall and short points.
    const h = i % 2 ? 0.1 : 0.17;
    part(c, new THREE.ConeGeometry(0.03, h, 4), r.gold, [x, 0.41 + h / 2, z], [0, a, 0]);
    part(c, new THREE.SphereGeometry(0.02, 8, 6), r.ermine, [x, 0.41 + h + 0.012, z]);
    // A jewel set in the band under each point.
    part(c, new THREE.SphereGeometry(0.022, 8, 6), r.gem, [Math.sin(a) * (R + 0.006), 0.36, Math.cos(a) * (R + 0.006)], [0, 0, 0], [1, 1.2, 0.6]);
  }
  // Arches and the orb and cross on top.
  for (const ry of [0, Math.PI / 2]) {
    part(c, new THREE.TorusGeometry(R * 0.92, 0.012, 6, S * 2, Math.PI), r.gold, [0, 0.41, 0], [0, ry, 0]);
  }
  part(c, new THREE.SphereGeometry(0.04, 12, 8), r.gold, [0, 0.41 + R * 0.92 + 0.03, 0]);
  part(c, new THREE.BoxGeometry(0.016, 0.09, 0.016), r.gold, [0, 0.41 + R * 0.92 + 0.11, 0]);
  part(c, new THREE.BoxGeometry(0.06, 0.016, 0.016), r.gold, [0, 0.41 + R * 0.92 + 0.12, 0]);
  // Oversized, growing up from where the band sits on the helm.
  const k = 1.35;
  c.scale.setScalar(k);
  c.position.y = 0.31 * (1 - k);
  return c;
}

// A gold sceptre with a jewelled head, along +y with the grip at the origin.
function sceptre(r) {
  const s = new THREE.Group();
  part(s, new THREE.CylinderGeometry(0.016, 0.02, 0.62, 8), r.gold, [0, 0.12, 0]);
  part(s, new THREE.SphereGeometry(0.045, 12, 8), r.gold, [0, 0.45, 0]);
  part(s, new THREE.SphereGeometry(0.03, 10, 8), r.gem, [0, 0.5, 0]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    part(s, new THREE.ConeGeometry(0.014, 0.07, 4), r.gold, [Math.sin(a) * 0.035, 0.52, Math.cos(a) * 0.035], [Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5]);
  }
  return s;
}

// ------------------------------------------------------------- weapons ---
function buildSword(m, S) {
  // Blade along +y, grip centred on the origin: a longsword with a fullered,
  // tapering blade, a straight cross and a disc pommel.
  const s = new THREE.Group();
  const blade = new THREE.Shape();
  blade.moveTo(-0.022, 0);
  blade.lineTo(0.022, 0);
  blade.lineTo(0.018, 0.6);
  blade.lineTo(0, 0.74);
  blade.lineTo(-0.018, 0.6);
  blade.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(blade, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0025, bevelSegments: 1 });
  bladeGeo.translate(0, 0, -0.003);
  part(s, bladeGeo, m.blade, [0, 0.11, 0]);
  part(s, new THREE.BoxGeometry(0.008, 0.5, 0.0105), m.steelDark, [0, 0.38, 0]);
  part(s, new THREE.CylinderGeometry(0.011, 0.011, 0.22, S), m.steelDark, [0, 0.095, 0], [0, 0, Math.PI / 2]);
  part(s, new THREE.CylinderGeometry(0.016, 0.018, 0.16, S), m.leatherDark, [0, 0, 0]);
  part(s, new THREE.SphereGeometry(0.028, S, Math.max(6, S * 0.6)), m.steelDark, [0, -0.1, 0], [0, 0, 0], [1, 0.8, 0.55]);
  return s;
}

function heaterShape(scale = 1) {
  const sh = new THREE.Shape();
  sh.moveTo(-0.22 * scale, 0.24 * scale);
  sh.lineTo(0.22 * scale, 0.24 * scale);
  sh.lineTo(0.22 * scale, 0.04 * scale);
  sh.quadraticCurveTo(0.2 * scale, -0.2 * scale, 0, -0.33 * scale);
  sh.quadraticCurveTo(-0.2 * scale, -0.2 * scale, -0.22 * scale, 0.04 * scale);
  sh.closePath();
  return sh;
}

function buildShield(m) {
  // A heater shield, face toward +z: painted wood in the court's colours with
  // an iron rim.
  const g = new THREE.Group();
  const geo = new THREE.ExtrudeGeometry(heaterShape(), { depth: 0.03, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 10 });
  geo.translate(0, 0, -0.015);
  // Map the painted heraldry across the face.
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + 0.23) / 0.46, (pos.getY(i) + 0.34) / 0.59);
  uv.needsUpdate = true;
  part(g, geo, m.shield);
  const pts = heaterShape(1.0).getPoints(24).map((p) => new THREE.Vector3(p.x, p.y, 0.02));
  part(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 60, 0.011, 5, true), m.steelDark);
  return g;
}

function buildBow(m, scale = 1) {
  // A dark-wood recurve. Grip at the origin, limbs along y, the belly toward
  // +x and the string on the -x side.
  const bow = new THREE.Group();
  const half = [[0.0, 0.0], [0.03, 0.16], [0.12, 0.42], [0.095, 0.6], [-0.04, 0.74], [-0.02, 0.84], [0.04, 0.92]];
  const pts = [];
  for (let i = half.length - 1; i > 0; i--) pts.push(new THREE.Vector3(half[i][0], -half[i][1], 0));
  for (const [u, v] of half) pts.push(new THREE.Vector3(u, v, 0));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
  part(bow, new THREE.TubeGeometry(curve, 40, 0.024, 7, false), m.wood, [0, 0, 0], [0, 0, 0], [1, 1, 0.7]);
  part(bow, new THREE.CylinderGeometry(0.036, 0.036, 0.16, 8), m.leatherDark, [0.004, 0, 0]);
  const string = part(bow, new THREE.CylinderGeometry(0.004, 0.004, 1.48, 4), m.string, [-0.045, 0, 0]);
  bow.userData.string = string;
  bow.scale.setScalar(scale);
  return bow;
}

function buildArrow(m, length = 0.42) {
  // Along +y, head at +y.
  const a = new THREE.Group();
  part(a, new THREE.CylinderGeometry(0.0065, 0.0065, length, 6), m.wood, [0, 0, 0]);
  part(a, new THREE.ConeGeometry(0.02, 0.075, 4), m.steelDark, [0, length / 2 + 0.035, 0], [0, Math.PI / 4, 0], [1, 1, 0.35]);
  for (let k = 0; k < 3; k++) {
    part(a, new THREE.BoxGeometry(0.0015, 0.09, 0.028), m.feather, [0, -length / 2 + 0.06, 0], [0, (k / 3) * Math.PI * 2, 0]).translateZ(0.016);
  }
  return a;
}

function buildQuiver(m, S) {
  const q = new THREE.Group();
  part(q, new THREE.CylinderGeometry(0.075, 0.062, 0.52, S), m.leather, [0, 0, 0]);
  part(q, new THREE.CylinderGeometry(0.08, 0.08, 0.05, S), m.leatherDark, [0, 0.22, 0]);
  part(q, new THREE.CylinderGeometry(0.068, 0.068, 0.035, S), m.leatherDark, [0, -0.2, 0]);
  const fan = [[-0.03, 0.0, -0.12], [0.0, 0.022, 0.0], [0.03, 0.0, 0.12], [-0.014, -0.025, -0.05], [0.018, -0.025, 0.07]];
  for (const [x, z, tilt] of fan) {
    const arrow = new THREE.Group();
    part(arrow, new THREE.CylinderGeometry(0.0065, 0.0065, 0.2, 5), m.wood, [0, 0.1, 0]);
    for (let k = 0; k < 3; k++) {
      part(arrow, new THREE.BoxGeometry(0.0015, 0.08, 0.026), m.feather, [0, 0.18, 0], [0, (k / 3) * Math.PI * 2, 0]).translateZ(0.014);
    }
    arrow.position.set(x, 0.23, z);
    arrow.rotation.set(z * 1.5, 0, tilt);
    q.add(arrow);
  }
  return q;
}

/**
 * Build a soldier.
 * @param {object} opts
 * @param {'archer'|'sword'|'king'} opts.kind
 * @param {object} opts.palette  one of RANGER_PALETTES
 * @param {'mini'|'soldier'} opts.pose  mini = a board piece on a stone plinth;
 *   soldier = rest pose with weapons in the hands, animated by rig.js.
 * @param {number} [opts.eyeColor]  a faint glow behind the visor (soldiers)
 */
export function buildRanger({ kind, palette, pose = 'mini', eyeColor = null }) {
  const m = materialsFor(palette);
  const isMini = pose === 'mini';
  // Fewer segments on the tiny board pieces; smooth enough up close in duels.
  const S = isMini ? 8 : 14;
  const armoured = kind !== 'archer';
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const r = kind === 'king' ? regalia(palette) : null;
  if (isMini) {
    // A dark stone plinth with a band of the court's metal; the monarch's is
    // rimmed in gold and ringed with a soft glow in the court's colour.
    part(root, new THREE.CylinderGeometry(0.4, 0.44, 0.09, 24), m.stone, [0, 0.045, 0]);
    part(root, new THREE.TorusGeometry(0.405, 0.018, 6, 32), r ? r.gold : m.trim, [0, 0.09, 0], [Math.PI / 2, 0, 0]);
    part(root, new THREE.CylinderGeometry(0.36, 0.4, 0.04, 24), m.stone, [0, 0.11, 0]);
    if (r) {
      part(root, new THREE.TorusGeometry(0.36, 0.016, 6, 32), r.gold, [0, 0.13, 0], [Math.PI / 2, 0, 0]);
      part(root, new THREE.RingGeometry(0.42, 0.62, 40), r.glow, [0, 0.02, 0], [-Math.PI / 2, 0, 0]);
    }
    body.position.y = 0.13;
  }

  // Hips
  const pelvis = new THREE.Group();
  pelvis.position.y = 0.92;
  body.add(pelvis);
  const right = buildLeg(m, S, armoured);
  const left = buildLeg(m, S, armoured);
  right.leg.position.set(-0.115, 0, 0);
  left.leg.position.set(0.115, 0, 0);
  pelvis.add(right.leg, left.leg);

  if (armoured) {
    part(pelvis, new THREE.CylinderGeometry(0.2, 0.215, 0.08, S), m.steel, [0, 0.0, 0], [0, 0, 0], [1, 1, 0.82]);
    part(pelvis, new THREE.CylinderGeometry(0.215, 0.235, 0.08, S), m.steelDark, [0, -0.07, 0], [0, 0, 0], [1, 1, 0.82]);
  }
  part(pelvis, new THREE.TorusGeometry(0.205, 0.018, 6, S * 2), m.leather, [0, 0.05, 0], [Math.PI / 2, 0, 0], [1, 0.82, 1]);
  part(pelvis, new THREE.BoxGeometry(0.05, 0.04, 0.015), m.trim, [0, 0.05, 0.172]);
  // Tabard skirt: front and back panels in the court's colour (a long robe
  // for the monarch, a quilted skirt for archers).
  if (kind === 'king') {
    // A full-length royal robe with an ermine hem.
    part(pelvis, new THREE.CylinderGeometry(0.22, 0.38, 0.9, S, 1, true), m.clothDouble, [0, -0.45, 0], [0, 0, 0], [1, 1, 0.85]);
    part(pelvis, new THREE.CylinderGeometry(0.385, 0.4, 0.08, S, 1, true), r.ermine, [0, -0.88, 0], [0, 0, 0], [1, 1, 0.86]);
    part(pelvis, new THREE.BoxGeometry(0.07, 0.86, 0.02), r.ermine, [0, -0.45, 0.25], [-0.16, 0, 0]);
  } else if (armoured) {
    for (const t0 of [-0.85, Math.PI - 0.85]) {
      part(pelvis, raggedHem(new THREE.CylinderGeometry(0.215, 0.29, 0.52, S, 1, true, t0, 1.7), S, 0.05), m.clothDouble, [0, -0.27, 0], [0, 0, 0], [1, 1, 0.84]);
    }
  } else {
    part(pelvis, raggedHem(new THREE.CylinderGeometry(0.2, 0.27, 0.38, S, 1, true), S, 0.03), m.gambeson, [0, -0.2, 0], [0, 0, 0], [1, 1, 0.84]);
  }

  // Torso
  const spine = new THREE.Group();
  spine.position.y = 0.03;
  pelvis.add(spine);
  if (armoured) {
    part(spine, new THREE.CylinderGeometry(0.17, 0.2, 0.46, S), m.mail, [0, 0.24, 0], [0, 0, 0], [1, 1, 0.78]);
    part(spine, new THREE.SphereGeometry(0.215, S, Math.max(8, S * 0.7)), m.steel, [0, 0.33, 0.01], [0, 0, 0], [1, 1.15, 0.72]);
    part(spine, new THREE.BoxGeometry(0.012, 0.28, 0.02), m.steelDark, [0, 0.32, 0.158]);
    part(spine, new THREE.CylinderGeometry(0.095, 0.13, 0.1, S), m.steel, [0, 0.57, 0]);
  } else {
    // Quilted gambeson under a leather jerkin.
    part(spine, new THREE.CylinderGeometry(0.19, 0.22, 0.5, S), m.gambeson, [0, 0.27, 0], [0, 0, 0], [1, 1, 0.8]);
    part(spine, new THREE.CylinderGeometry(0.2, 0.205, 0.32, S), m.leather, [0, 0.3, 0], [0, 0, 0], [1, 1, 0.82]);
    part(spine, new THREE.BoxGeometry(0.05, 0.6, 0.025), m.leatherDark, [0, 0.3, 0.16], [0.08, 0, -0.5]);
    part(spine, new THREE.CylinderGeometry(0.11, 0.16, 0.12, S), m.mail, [0, 0.55, 0]);
  }

  // Head on a neck joint
  const neck = kind === 'archer' ? kettleHat(m, S) : greatHelm(m, S, isMini ? null : eyeColor, kind === 'sword');
  if (r) {
    neck.add(crown(r, S));
    // An ermine mantle over the shoulders: white fur with black tails.
    part(spine, new THREE.CylinderGeometry(0.2, 0.33, 0.2, S * 2), r.ermine, [0, 0.52, 0], [0, 0, 0], [1, 1, 0.82]);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      part(spine, new THREE.BoxGeometry(0.018, 0.04, 0.01), r.spot, [Math.sin(a) * 0.29, 0.47, Math.cos(a) * 0.24], [0, a, 0]);
    }
  }
  neck.position.y = 0.61;
  spine.add(neck);

  // Arms
  const armR = buildArm(m, S, -1, armoured);
  const armL = buildArm(m, S, 1, armoured);
  armR.arm.position.set(-0.275, 0.51, 0);
  armL.arm.position.set(0.275, 0.51, 0);
  spine.add(armR.arm, armL.arm);

  const joints = {
    root,
    body,
    pelvis,
    spine,
    neck,
    hipR: right.leg,
    hipL: left.leg,
    kneeR: right.knee,
    kneeL: left.knee,
    ankleR: right.ankle,
    ankleL: left.ankle,
    shoulderR: armR.arm,
    shoulderL: armL.arm,
    elbowR: armR.fore,
    elbowL: armL.fore,
    wristR: armR.hand,
    wristL: armL.hand,
  };

  if (kind === 'archer') {
    const quiver = buildQuiver(m, S);
    quiver.position.set(-0.13, 0.37, -0.19);
    quiver.rotation.set(-0.15, 0, 0.42);
    spine.add(quiver);
    joints.quiver = quiver;
  } else {
    // A long cloak down the back, ragged at the hem.
    const len = kind === 'king' ? 1.4 : 1.02;
    const cloak = raggedHem(new THREE.CylinderGeometry(0.24, 0.36, len, S, 1, true, Math.PI / 2, Math.PI), S, 0.06);
    joints.cape = part(spine, cloak, m.clothDouble, [0, 0.58 - len / 2, -0.03], [0.05, 0, 0], [1, 1, 0.85]);
  }

  if (isMini) poseMini(root, kind, m, S, armR, armL, r);
  else armSoldier(kind, m, S, joints);

  // Fuse the rigid parts on each joint into one mesh per material: a knight
  // drops from ~70 draw calls to ~20, which is what keeps a standalone
  // headset at full frame rate with a whole army on screen.
  const keep = new Set();
  for (const v of Object.values(joints)) if (v && v.isObject3D) keep.add(v);
  if (joints.bow?.userData.string) keep.add(joints.bow.userData.string);
  mergeStatic(root, keep);

  // Every part casts and catches shadows in the duels.
  root.traverse((o) => {
    if (o.isMesh && o.material !== m.slit && !o.material.transparent) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  root.userData.joints = joints;
  root.userData.limbs = { legL: left.leg, legR: right.leg, armL: armL.arm, armR: armR.arm, foreL: armL.fore, foreR: armR.fore };
  return root;
}

const _attrs = ['position', 'normal', 'uv'];
const _rel = new THREE.Matrix4();
// Every mesh that isn't itself a moving part is baked into its nearest moving
// ancestor (a joint, a weapon, the root), one mesh per material there.
function mergeStatic(root, keep) {
  keep.add(root);
  root.updateMatrixWorld(true);
  const buckets = new Map();
  root.traverse((o) => {
    if (!o.isMesh || keep.has(o) || Array.isArray(o.material)) return;
    let anc = o.parent;
    while (!keep.has(anc)) anc = anc.parent;
    const key = anc.uuid + '|' + o.material.uuid;
    if (!buckets.has(key)) buckets.set(key, { anc, mat: o.material, list: [] });
    buckets.get(key).list.push(o);
  });
  for (const { anc, mat, list } of buckets.values()) {
    if (list.length < 2 && list[0].parent === anc) continue;
    const inv = anc.matrixWorld.clone().invert();
    const geos = list.map((c) => {
      const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!_attrs.includes(name)) g.deleteAttribute(name);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(_rel.multiplyMatrices(inv, c.matrixWorld));
      g.clearGroups();
      return g;
    });
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    for (const c of list) c.removeFromParent();
    anc.add(new THREE.Mesh(merged, mat));
  }
  // Drop groups left empty.
  const empties = [];
  root.traverse((o) => {
    if (o.type === 'Group' && !o.children.length && !keep.has(o)) empties.push(o);
  });
  for (const e of empties) e.removeFromParent();
}

// Static display pose for the board miniatures. Weapons are placed in figure
// space and then attached to the hands so they keep that placement.
function poseMini(root, kind, m, S, right, left, r) {
  right.arm.rotation.set(0, 0, -0.22);
  right.fore.rotation.set(-1.15, 0, 0.35);
  left.arm.rotation.set(0, 0, 0.16);
  left.fore.rotation.set(-1.05, 0, -0.2);
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const handPos = (h) => h.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
  const place = (obj, hand, pos, rot) => {
    obj.position.copy(pos);
    obj.rotation.set(rot[0], rot[1], rot[2]);
    root.add(obj);
    obj.updateMatrixWorld(true);
    hand.attach(obj);
  };

  if (kind === 'archer') {
    const bow = buildBow(m, 0.95);
    place(bow, left.hand, handPos(left.hand).add(new THREE.Vector3(0.02, 0, 0.02)), [0, 0, -0.1]);
    const arrow = buildArrow(m);
    place(arrow, right.hand, handPos(right.hand).add(new THREE.Vector3(0, 0.1, 0.02)), [0.1, 0, 0.15]);
    root.userData.bow = bow;
  } else {
    // The monarch holds a sceptre; everyone else a sword.
    const sword = r ? sceptre(r) : buildSword(m, S);
    place(sword, right.hand, handPos(right.hand).add(new THREE.Vector3(0, 0.02, 0.02)), [-0.12, 0, 0.18]);
    if (kind === 'sword') {
      const shield = buildShield(m);
      place(shield, left.hand, handPos(left.hand).add(new THREE.Vector3(0.03, 0.02, 0.07)), [0, 0.35, 0]);
    }
  }
}

// Combat soldier: weapons live in the hand (wrist) frames so every shoulder,
// elbow and wrist rotation carries them. The bow is the exception: it is
// steered by the rig in spine space so it always faces the target, while the
// string and nocked arrow follow the drawing hand.
function armSoldier(kind, m, S, j) {
  if (kind !== 'archer') {
    const sword = buildSword(m, S);
    // Blade along the hand's +z: forward when the arm hangs, upright once the
    // arm is raised in front of the body.
    sword.rotation.x = Math.PI / 2;
    sword.position.set(0, -0.01, 0.0);
    j.wristR.add(sword);
    j.sword = sword;

    const shield = buildShield(m);
    shield.rotation.x = Math.PI / 2;
    shield.position.set(0, -0.06, 0);
    j.wristL.add(shield);
    j.shield = shield;
    return;
  }

  const bow = buildBow(m, 0.95);
  bow.userData.string.visible = false;
  j.spine.add(bow);
  j.bow = bow;

  const strGeo = new THREE.CylinderGeometry(0.004, 0.004, 1, 4);
  j.stringTop = part(bow, strGeo, m.string);
  j.stringBot = part(bow, strGeo, m.string);
  j.bowTipTop = new THREE.Vector3(-0.04, 0.74, 0);
  j.bowTipBot = new THREE.Vector3(-0.04, -0.74, 0);
  j.nockRest = new THREE.Vector3(-0.045, 0, 0);

  j.nockArrow = buildArrow(m, 0.62);
  bow.add(j.nockArrow);

  j.handArrow = buildArrow(m, 0.62);
  j.handArrow.rotation.x = Math.PI / 2;
  j.handArrow.position.set(0, -0.02, 0.18);
  j.wristR.add(j.handArrow);

  j.muzzle = new THREE.Object3D();
  j.muzzle.position.set(0.2, 0, 0);
  bow.add(j.muzzle);
}
