import * as THREE from 'three';

// Low-poly "steel ranger" figure shared by the board miniatures and the
// combat soldiers. Built in figure units: feet at y = 0, helm spike ~1.96.
// Front of the figure faces +z. The figure's right side is -x.

const matCache = new Map();

function flat(color, { metalness = 0.18, roughness = 0.62, emissive = 0x000000, emissiveIntensity = 0, side } = {}) {
  const key = `${color}|${metalness}|${roughness}|${emissive}|${emissiveIntensity}|${side ?? ''}`;
  let mat = matCache.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color,
      metalness,
      roughness,
      emissive,
      emissiveIntensity,
      flatShading: true,
      envMapIntensity: 0.75,
      side: side ?? THREE.FrontSide,
    });
    matCache.set(key, mat);
  }
  return mat;
}

function part(parent, geo, mat, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(p[0], p[1], p[2]);
  m.rotation.set(r[0], r[1], r[2]);
  m.scale.set(s[0], s[1], s[2]);
  parent.add(m);
  return m;
}

function extrude(points, depth) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

// Ragged hem on an open-ended cylinder (cloth skirts and capes).
function raggedHem(geo, radialSegments, amount) {
  const pos = geo.attributes.position;
  const ring = radialSegments + 1;
  for (let i = 0; i < ring; i++) {
    const k = i % radialSegments;
    const idx = ring + i;
    const drop = (k % 2 ? amount : amount * 0.25) + ((k * 37) % 5) * amount * 0.12;
    pos.setY(idx, pos.getY(idx) - drop);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export const RANGER_PALETTES = [
  // Gold court
  {
    steel: 0xbdbab3,
    steelDark: 0x807d78,
    cloth: 0x66635f,
    clothDark: 0x4a4845,
    tabard: 0xdedbd4,
    visor: 0x0b0a0a,
    emblem: 0xd08a0c,
    band: 0xf2d48a,
    sash: 0x8d2434,
    bandEmissive: 0x5a3d12,
  },
  // Violet court
  {
    steel: 0xb5b7bf,
    steelDark: 0x7a7c86,
    cloth: 0x5f616b,
    clothDark: 0x44464e,
    tabard: 0xd9dbe2,
    visor: 0x0a0a0d,
    emblem: 0x1450c8,
    band: 0xb9b2f0,
    sash: 0x3a2378,
    bandEmissive: 0x2a2150,
  },
];

function crownGeo(depth = 0.008) {
  return extrude(
    [
      [-0.055, 0],
      [0.055, 0],
      [0.06, 0.05],
      [0.03, 0.024],
      [0, 0.058],
      [-0.03, 0.024],
      [-0.06, 0.05],
    ],
    depth,
  );
}

// Leg chain: hip (this group) -> knee -> ankle. Hip pivot sits at the top of
// the thigh; the knee pivot is the knee cap, the ankle pivot the top of the
// sabaton, so bending any joint folds the armour plates around it.
export const THIGH_LEN = 0.44;
export const SHIN_LEN = 0.36;

function buildLeg(m) {
  const leg = new THREE.Group();
  part(leg, new THREE.CylinderGeometry(0.08, 0.07, 0.38, 6), m.clothDark, [0, -0.2, 0]);
  const knee = new THREE.Group();
  knee.position.y = -THIGH_LEN;
  leg.add(knee);
  part(knee, new THREE.OctahedronGeometry(0.075, 0), m.steel, [0, 0, 0.05], [0, Math.PI / 4, 0], [1.1, 1, 0.85]);
  part(knee, new THREE.CylinderGeometry(0.08, 0.068, 0.3, 6), m.steel, [0, -0.19, 0]);
  part(knee, new THREE.CylinderGeometry(0.088, 0.088, 0.045, 6), m.steelDark, [0, -0.06, 0]);
  part(knee, new THREE.CylinderGeometry(0.082, 0.082, 0.045, 6), m.steelDark, [0, -0.33, 0]);
  const ankle = new THREE.Group();
  ankle.position.y = -SHIN_LEN;
  knee.add(ankle);
  part(ankle, new THREE.BoxGeometry(0.15, 0.13, 0.24), m.steelDark, [0, -0.055, 0.025]);
  part(ankle, new THREE.BoxGeometry(0.13, 0.08, 0.1), m.steelDark, [0, -0.08, 0.17], [0.25, 0, 0]);
  return { leg, knee, ankle };
}

export const UPPER_LEN = 0.27;
export const FORE_LEN = 0.25;

function buildArm(m, side, heavyShoulder) {
  // side: -1 = figure's right (-x), +1 = figure's left (+x)
  const arm = new THREE.Group();
  part(arm, new THREE.CylinderGeometry(0.062, 0.056, 0.27, 6), m.clothDark, [0, -0.13, 0]);
  if (heavyShoulder) {
    part(arm, new THREE.IcosahedronGeometry(0.16, 0), m.steel, [side * 0.03, 0.01, 0], [0.2, 0.3, side * 0.35], [1.1, 0.72, 1.05]);
    part(arm, new THREE.IcosahedronGeometry(0.135, 0), m.steel, [side * 0.06, -0.08, 0.01], [0.5, 0.1, side * 0.55], [1.0, 0.55, 1.0]);
  } else {
    part(arm, new THREE.OctahedronGeometry(0.1, 0), m.cloth, [side * 0.02, 0.0, 0], [0, Math.PI / 4, 0], [1, 0.7, 1]);
  }
  const fore = new THREE.Group();
  fore.position.y = -UPPER_LEN;
  arm.add(fore);
  part(fore, new THREE.OctahedronGeometry(0.055, 0), m.steelDark, [0, 0, 0]);
  part(fore, new THREE.CylinderGeometry(0.07, 0.058, 0.18, 6), m.steelDark, [0, -0.11, 0]);
  part(fore, new THREE.CylinderGeometry(0.085, 0.085, 0.05, 6), m.steel, [0, -0.035, 0]);
  part(fore, new THREE.DodecahedronGeometry(0.068, 0), m.steelDark, [0, -0.25, 0.005], [0.3, 0.2, 0], [1, 1.1, 1]);
  const hand = new THREE.Object3D();
  hand.position.y = -FORE_LEN;
  fore.add(hand);
  return { arm, fore, hand };
}

function buildHelm(m, eyeColor) {
  const head = new THREE.Group();
  part(head, new THREE.CylinderGeometry(0.07, 0.08, 0.1, 6), m.clothDark, [0, 0.0, 0]);
  part(head, new THREE.CylinderGeometry(0.15, 0.156, 0.18, 8), m.steel, [0, 0.1, 0]);
  part(head, new THREE.CylinderGeometry(0.07, 0.15, 0.09, 8), m.steel, [0, 0.235, 0]);
  part(head, new THREE.ConeGeometry(0.07, 0.13, 8), m.steel, [0, 0.345, 0]);
  // Brow peak running up the front ridge.
  part(head, new THREE.ConeGeometry(0.035, 0.2, 3), m.steel, [0, 0.27, 0.105], [-0.42, Math.PI, 0], [1, 1, 0.8]);
  // T-visor, wrapped around the two front facets of the helm.
  const visorMat = new THREE.MeshBasicMaterial({ color: m.visorColor, side: THREE.DoubleSide });
  part(head, new THREE.CylinderGeometry(0.158, 0.158, 0.062, 2, 1, true, -Math.PI / 4, Math.PI / 2), visorMat, [0, 0.128, 0]);
  part(head, new THREE.CylinderGeometry(0.159, 0.159, 0.11, 2, 1, true, -0.27, 0.54), visorMat, [0, 0.055, 0]);
  if (eyeColor) {
    const eye = new THREE.MeshBasicMaterial({ color: eyeColor });
    part(head, new THREE.BoxGeometry(0.03, 0.02, 0.01), eye, [-0.045, 0.13, 0.15], [0, -0.35, 0]);
    part(head, new THREE.BoxGeometry(0.03, 0.02, 0.01), eye, [0.045, 0.13, 0.15], [0, 0.35, 0]);
  }
  return head;
}

function buildBow(m, scale = 1) {
  const bow = new THREE.Group();
  // Half-profile of a recurve: u is outward (belly), v is up. Grip at origin.
  const half = [
    [0.0, 0.0],
    [0.03, 0.16],
    [0.12, 0.42],
    [0.095, 0.6],
    [-0.04, 0.74],
    [-0.02, 0.84],
    [0.04, 0.92],
  ];
  const pts = [];
  for (let i = half.length - 1; i > 0; i--) pts.push(new THREE.Vector3(half[i][0], -half[i][1], 0));
  for (const [u, v] of half) pts.push(new THREE.Vector3(u, v, 0));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
  part(bow, new THREE.TubeGeometry(curve, 26, 0.028, 4, false), m.steel, [0, 0, 0], [0, 0, 0], [1, 1, 0.75]);
  part(bow, new THREE.CylinderGeometry(0.042, 0.042, 0.06, 6), m.steelDark, [0.005, 0.1, 0]);
  part(bow, new THREE.CylinderGeometry(0.042, 0.042, 0.06, 6), m.steelDark, [0.005, -0.1, 0]);
  const string = part(bow, new THREE.CylinderGeometry(0.006, 0.006, 1.48, 4), m.steelDark, [-0.045, 0, 0]);
  bow.userData.string = string;
  bow.scale.setScalar(scale);
  return bow;
}

function buildArrow(m, length = 0.42) {
  const a = new THREE.Group();
  part(a, new THREE.CylinderGeometry(0.008, 0.008, length, 4), m.steelDark, [0, 0, 0]);
  part(a, new THREE.OctahedronGeometry(0.045, 0), m.tabardMat, [0, length / 2 + 0.03, 0], [0, 0, 0], [0.6, 1.4, 0.15]);
  part(a, new THREE.OctahedronGeometry(0.04, 0), m.tabardMat, [0, -length / 2 + 0.04, 0], [0, 0, 0], [0.7, 1.3, 0.12]);
  return a;
}

function buildQuiver(m) {
  const q = new THREE.Group();
  part(q, new THREE.CylinderGeometry(0.08, 0.068, 0.5, 6), m.sash, [0, 0, 0]);
  part(q, new THREE.CylinderGeometry(0.092, 0.092, 0.07, 6), m.steelDark, [0, 0.22, 0]);
  part(q, new THREE.CylinderGeometry(0.075, 0.075, 0.04, 6), m.steelDark, [0, -0.2, 0]);
  const fan = [
    [-0.035, 0.0, -0.12],
    [0.0, 0.025, 0.0],
    [0.035, 0.0, 0.12],
    [-0.015, -0.03, -0.05],
    [0.02, -0.03, 0.07],
  ];
  for (const [x, z, tilt] of fan) {
    const arrow = new THREE.Group();
    part(arrow, new THREE.CylinderGeometry(0.008, 0.008, 0.2, 4), m.steelDark, [0, 0.1, 0]);
    part(arrow, new THREE.OctahedronGeometry(0.06, 0), m.steel, [0, 0.24, 0], [0, Math.PI / 4, 0], [0.75, 1.35, 0.14]);
    arrow.position.set(x, 0.23, z);
    arrow.rotation.set(z * 1.5, 0, tilt);
    q.add(arrow);
  }
  return q;
}

function buildSword(m) {
  // Blade along +y, grip centred on the origin.
  const s = new THREE.Group();
  part(s, new THREE.CylinderGeometry(0.022, 0.022, 0.16, 6), m.clothDark, [0, 0, 0]);
  part(s, new THREE.OctahedronGeometry(0.038, 0), m.steelDark, [0, -0.1, 0]);
  part(s, new THREE.BoxGeometry(0.26, 0.035, 0.05), m.steelDark, [0, 0.095, 0]);
  part(s, new THREE.OctahedronGeometry(0.03, 0), m.steel, [0.135, 0.095, 0]);
  part(s, new THREE.OctahedronGeometry(0.03, 0), m.steel, [-0.135, 0.095, 0]);
  part(s, new THREE.CylinderGeometry(0.04, 0.036, 0.72, 4), m.steel, [0, 0.47, 0], [0, Math.PI / 4, 0], [1, 1, 0.28]);
  part(s, new THREE.ConeGeometry(0.036, 0.15, 4), m.steel, [0, 0.905, 0], [0, Math.PI / 4, 0], [1, 1, 0.28]);
  return s;
}

function buildShield(m) {
  const g = new THREE.Group();
  const outline = [
    [-0.21, 0.22],
    [0.21, 0.22],
    [0.21, 0.02],
    [0.14, -0.17],
    [0, -0.31],
    [-0.14, -0.17],
    [-0.21, 0.02],
  ];
  part(g, extrude(outline, 0.045), m.steel, [0, 0, 0]);
  const inner = outline.map(([x, y]) => [x * 0.8, y * 0.8 + 0.005]);
  part(g, extrude(inner, 0.02), m.tabardMat, [0, 0, 0.026]);
  part(g, crownGeo(0.012), m.emblem, [0, -0.04, 0.04], [0, 0, 0], [1.5, 1.5, 1]);
  return g;
}

function materialsFor(palette) {
  return {
    steel: flat(palette.steel, { metalness: 0.32, roughness: 0.48 }),
    steelDark: flat(palette.steelDark, { metalness: 0.28, roughness: 0.55 }),
    cloth: flat(palette.cloth, { metalness: 0.05, roughness: 0.8 }),
    clothDark: flat(palette.clothDark, { metalness: 0.05, roughness: 0.8 }),
    clothDouble: flat(palette.cloth, { metalness: 0.05, roughness: 0.8, side: THREE.DoubleSide }),
    tabardMat: flat(palette.tabard, { metalness: 0.08, roughness: 0.7 }),
    emblem: flat(palette.emblem, { metalness: 0.2, roughness: 0.45, emissive: palette.emblem, emissiveIntensity: 0.12 }),
    band: flat(palette.band, { metalness: 0.85, roughness: 0.28, emissive: palette.bandEmissive, emissiveIntensity: 0.3 }),
    sash: flat(palette.sash, { metalness: 0.05, roughness: 0.75 }),
    sashDouble: flat(palette.sash, { metalness: 0.05, roughness: 0.75, side: THREE.DoubleSide }),
    visorColor: palette.visor,
  };
}

/**
 * Build a ranger figure.
 *
 * The figure is a real joint hierarchy so the combat rig can bend it:
 *
 *   root
 *    └ body
 *       └ pelvis (hips, y 0.92) ── skirt, belt, tabard
 *          ├ legR / legL (hip)  └ knee └ ankle
 *          └ spine (waist)     ── chest, bandolier, cowl, cape, quiver
 *             ├ neck (head)
 *             └ armR / armL (shoulder) └ fore (elbow) └ hand (wrist)
 *
 * @param {object} opts
 * @param {'archer'|'sword'} opts.kind
 * @param {object} opts.palette  one of RANGER_PALETTES (or compatible)
 * @param {'mini'|'soldier'} opts.pose  mini = static display pose on an octagonal base;
 *   soldier = rest pose with weapons in the hands, animated by rig.js.
 * @param {number} [opts.eyeColor]  glowing eyes behind the visor (soldier pose)
 */
export function buildRanger({ kind, palette, pose = 'mini', eyeColor = null }) {
  const m = materialsFor(palette);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const isMini = pose === 'mini';

  if (isMini) {
    part(root, new THREE.CylinderGeometry(0.4, 0.44, 0.09, 8), m.band, [0, 0.045, 0], [0, Math.PI / 8, 0]);
    part(root, new THREE.CylinderGeometry(0.34, 0.4, 0.04, 8), m.steel, [0, 0.11, 0], [0, Math.PI / 8, 0]);
    body.position.y = 0.13;
  }

  // Hips
  const pelvis = new THREE.Group();
  pelvis.position.y = 0.92;
  body.add(pelvis);

  const right = buildLeg(m);
  const left = buildLeg(m);
  right.leg.position.set(-0.115, 0, 0);
  left.leg.position.set(0.115, 0, 0);
  pelvis.add(right.leg, left.leg);

  part(pelvis, new THREE.CylinderGeometry(0.19, 0.185, 0.07, 8), m.steelDark, [0, 0.03, 0], [0, 0, 0], [1, 1, 0.8]);
  part(pelvis, new THREE.BoxGeometry(0.085, 0.06, 0.03), m.steel, [0, 0.03, 0.155]);
  part(pelvis, new THREE.BoxGeometry(0.045, 0.03, 0.035), m.clothDark, [0, 0.03, 0.16]);
  for (const sx of [-1, 1]) {
    part(pelvis, new THREE.BoxGeometry(0.085, 0.1, 0.07), m.clothDark, [sx * 0.185, -0.04, 0.06], [0, sx * 0.35, 0]);
    part(pelvis, new THREE.BoxGeometry(0.09, 0.03, 0.075), m.steelDark, [sx * 0.185, 0.01, 0.06], [0, sx * 0.35, 0]);
  }

  // Coat skirt with a ragged hem
  const skirt = raggedHem(new THREE.CylinderGeometry(0.19, 0.3, 0.46, 8, 1, true), 8, 0.08);
  part(pelvis, skirt, m.clothDouble, [0, -0.19, 0], [0, Math.PI / 8, 0], [1, 1, 0.8]);

  // Tabard with crown emblem
  const tabard = new THREE.Group();
  tabard.position.set(0, 0.03, 0.165);
  tabard.rotation.x = -0.2;
  pelvis.add(tabard);
  part(
    tabard,
    extrude(
      [
        [-0.09, 0],
        [0.09, 0],
        [0.09, -0.36],
        [0, -0.49],
        [-0.09, -0.36],
      ],
      0.016,
    ),
    m.tabardMat,
  );
  part(tabard, crownGeo(), m.emblem, [0, -0.27, 0.01], [0, 0, 0], [1.35, 1.35, 1]);

  // Waist / chest
  const spine = new THREE.Group();
  spine.position.y = 0.03;
  pelvis.add(spine);
  part(spine, new THREE.CylinderGeometry(0.17, 0.16, 0.18, 8), m.clothDark, [0, 0.09, 0], [0, 0, 0], [1, 1, 0.78]);
  part(spine, new THREE.CylinderGeometry(0.225, 0.17, 0.4, 8), m.cloth, [0, 0.35, 0], [0, 0, 0], [1, 1, 0.72]);
  part(spine, new THREE.BoxGeometry(0.13, 0.1, 0.03), m.steel, [-0.085, 0.32, 0.14], [0.12, -0.25, 0.3]);
  part(spine, new THREE.BoxGeometry(0.11, 0.09, 0.03), m.steel, [0.095, 0.2, 0.13], [0.1, 0.25, -0.2]);

  // Bandolier strap with diamond buckles (figure's left shoulder to right hip)
  part(spine, new THREE.BoxGeometry(0.06, 0.56, 0.03), m.clothDark, [0, 0.285, 0.155], [0.12, 0, -0.505]);
  const buckle = new THREE.TorusGeometry(0.032, 0.009, 4, 4);
  part(spine, buckle, m.steel, [0.068, 0.41, 0.175], [0.1, 0, 0]);
  part(spine, buckle, m.steel, [-0.058, 0.19, 0.17], [0.1, 0, 0]);

  // Cowl / scarf
  part(spine, new THREE.TorusGeometry(0.14, 0.07, 5, 8), m.sash, [0, 0.57, 0], [Math.PI / 2, 0, Math.PI / 8], [1, 0.85, 1]);
  part(spine, new THREE.TorusGeometry(0.115, 0.05, 5, 8), m.sash, [0, 0.63, -0.01], [Math.PI / 2 - 0.15, 0, 0], [1, 0.85, 1]);
  part(spine, new THREE.ConeGeometry(0.12, 0.22, 4), m.sash, [0.04, 0.45, 0.12], [Math.PI, 0, 0.35], [1, 1, 0.35]);

  // Head on a neck joint
  const neck = buildHelm(m, eyeColor);
  neck.position.y = 0.61;
  spine.add(neck);

  // Arms
  const armR = buildArm(m, -1, true);
  const armL = buildArm(m, 1, kind === 'sword');
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
    const quiver = buildQuiver(m);
    quiver.position.set(-0.13, 0.37, -0.19);
    quiver.rotation.set(-0.15, 0, 0.42);
    spine.add(quiver);
    joints.quiver = quiver;
  } else {
    // A short cloak down the back.
    const cape = raggedHem(new THREE.CylinderGeometry(0.21, 0.32, 0.86, 8, 1, true, Math.PI / 2, Math.PI), 8, 0.07);
    joints.cape = part(spine, cape, m.sashDouble, [0, 0.11, -0.02], [0.06, 0, 0], [1, 1, 0.85]);
  }

  if (isMini) {
    poseMini(root, kind, m, armR, armL);
  } else {
    armSoldier(kind, m, joints);
  }

  root.userData.joints = joints;
  root.userData.limbs = {
    legL: left.leg,
    legR: right.leg,
    armL: armL.arm,
    armR: armR.arm,
    foreL: armL.fore,
    foreR: armR.fore,
  };
  return root;
}

// Static display pose for the board miniatures. Weapons are placed in figure
// space and then attached to the hands so they keep that placement.
function poseMini(root, kind, m, right, left) {
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
    const sword = buildSword(m);
    place(sword, right.hand, handPos(right.hand).add(new THREE.Vector3(0, 0.02, 0.02)), [-0.12, 0, 0.18]);
    const shield = buildShield(m);
    place(shield, left.hand, handPos(left.hand).add(new THREE.Vector3(0.03, 0.02, 0.07)), [0, 0.35, 0]);
  }
}

// Combat soldier: weapons live in the hand (wrist) frames so every shoulder,
// elbow and wrist rotation carries them. The bow is the exception: it is
// steered by the rig in spine space so it always faces the target, while the
// string and nocked arrow follow the drawing hand.
function armSoldier(kind, m, j) {
  if (kind === 'sword') {
    const sword = buildSword(m);
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

  const stringMat = m.steelDark;
  const strGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 4);
  j.stringTop = part(bow, strGeo, stringMat);
  j.stringBot = part(bow, strGeo, stringMat);
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
