// The world the game is played in: a terrace high on a castle at sunset, overlooking a kingdom.
//
// In AR the player first meets Sim in their own room. When the game starts this whole world is
// drawn around them, solid, so the room is no longer seen: they are "in VR" without the headset
// having to switch modes (which would need another button press and drop the conversation).
//
// Everything is within 70 m, since the game's camera sees no further than 80. The terrace floor is
// at y = 0, the player's real floor.

import * as THREE from 'three';

const SUN = new THREE.Vector3(-0.55, 0.16, -0.82).normalize(); // low, ahead and to the left

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d');
  // Top of the image is straight up; the horizon is at half height.
  const sky = g.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#141a3a');
  sky.addColorStop(0.2, '#2c2a5e');
  sky.addColorStop(0.34, '#6b3f7a');
  sky.addColorStop(0.43, '#c45a5a');
  sky.addColorStop(0.48, '#f08a3c');
  sky.addColorStop(0.5, '#ffc15e');
  sky.addColorStop(0.52, '#7a4a52');
  sky.addColorStop(0.62, '#2a2238');
  sky.addColorStop(1, '#15121f');
  g.fillStyle = sky;
  g.fillRect(0, 0, 1024, 512);
  // The sun and its glow, where SUN points (equirectangular: u from the angle round, v from height).
  const u = (Math.atan2(SUN.x, -SUN.z) / (2 * Math.PI) + 0.5) * 1024;
  const v = (0.5 - Math.asin(SUN.y) / Math.PI) * 512;
  for (const [r, a] of [[260, 0.28], [130, 0.4], [60, 0.7]]) {
    const glow = g.createRadialGradient(u, v, 0, u, v, r);
    glow.addColorStop(0, `rgba(255, 214, 140, ${a})`);
    glow.addColorStop(1, 'rgba(255, 150, 80, 0)');
    g.fillStyle = glow;
    g.fillRect(u - r, v - r, r * 2, r * 2);
  }
  g.fillStyle = '#fff3d6';
  g.beginPath();
  g.arc(u, v, 13, 0, Math.PI * 2);
  g.fill();
  // Long thin clouds catching the light.
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 1024;
    const y = 150 + Math.random() * 95;
    const w = 60 + Math.random() * 170;
    const near = 1 - Math.min(1, Math.abs(x - u) / 420);
    g.fillStyle = `rgba(${200 + near * 55}, ${120 + near * 70}, ${110 + near * 20}, ${0.1 + near * 0.22})`;
    g.beginPath();
    g.ellipse(x, y, w, 3 + Math.random() * 5, 0, 0, Math.PI * 2);
    g.fill();
  }
  // A few early stars high up.
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.5})`;
    g.fillRect(Math.random() * 1024, Math.random() * 95, 1.3, 1.3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stoneTexture(base, joint) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? 0 : 255},${Math.random() < 0.5 ? 0 : 255},${Math.random() < 0.5 ? 0 : 255},${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 5, 2 + Math.random() * 5);
  }
  g.strokeStyle = joint;
  g.lineWidth = 3;
  for (let row = 0; row < 4; row++) {
    g.beginPath();
    g.moveTo(0, row * 64);
    g.lineTo(256, row * 64);
    g.stroke();
    for (let col = 0; col < 2; col++) {
      const x = col * 128 + (row % 2) * 64;
      g.beginPath();
      g.moveTo(x, row * 64);
      g.lineTo(x, row * 64 + 64);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Build the world. Returns the group to show or hide and a method to stand it around a player. */
export function createCastle() {
  const world = new THREE.Group();
  world.visible = false;
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })(); // the same kingdom every time

  // Sky: a dome drawn behind everything else.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(70, 40, 24), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false }));
  sky.renderOrder = -10;
  world.add(sky);

  // Sunset light: warm and low from the sun, cool fill from the opposite sky.
  const sun = new THREE.DirectionalLight(0xffb070, 1.5);
  sun.position.copy(SUN).multiplyScalar(30);
  world.add(sun, sun.target);
  world.add(new THREE.HemisphereLight(0x8a7ab8, 0x3a2a22, 0.3));

  const stone = new THREE.MeshStandardMaterial({ color: 0xa9a196, roughness: 0.95, map: stoneTexture('#9c958b', 'rgba(40,34,30,0.55)') });
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x7d766e, roughness: 0.95, map: stoneTexture('#8b847b', 'rgba(30,26,24,0.6)') });
  const roof = new THREE.MeshStandardMaterial({ color: 0x4a3044, roughness: 0.8 });

  const R = 4.4; // the terrace's radius
  // The terrace underfoot, and the tower it tops.
  const floorMat = stone.clone();
  floorMat.map = stone.map.clone();
  floorMat.map.repeat.set(5, 5);
  floorMat.color.set(0x7c766e);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.4, 48), floorMat);
  floor.position.y = -0.2;
  world.add(floor);
  const keepMat = darkStone.clone();
  keepMat.map = darkStone.map.clone();
  keepMat.map.repeat.set(10, 8);
  const keep = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.2, R + 1.4, 26, 48, 1, true), keepMat);
  keep.position.y = -13.4;
  world.add(keep);

  // Battlements round the sides and back; in front, where the view is, only a low balustrade, so
  // the kingdom is seen over it from standing height. (Angles: 0 is straight ahead, local -Z.)
  const OPEN = 1.15; // half-width of the open front, radians
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.75, 40, 1, true, Math.PI + OPEN, 2 * Math.PI - 2 * OPEN), Object.assign(darkStone.clone(), { side: THREE.DoubleSide }));
  wall.position.y = 0.375;
  world.add(wall);
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.5, 24, 1, true, Math.PI - OPEN, 2 * OPEN), Object.assign(darkStone.clone(), { side: THREE.DoubleSide }));
  rail.position.y = 0.25;
  world.add(rail);
  const cope = new THREE.Mesh(new THREE.TorusGeometry(R, 0.06, 6, 30, 2 * OPEN), stone);
  cope.rotation.set(Math.PI / 2, 0, Math.PI / 2 - OPEN);
  cope.position.y = 0.5;
  world.add(cope);
  const merlonCount = 26;
  const merlons = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.5, 0.38), darkStone, merlonCount);
  const m4 = new THREE.Matrix4();
  let placed = 0;
  for (let i = 0; i < merlonCount; i++) {
    const a = OPEN + 0.12 + (i / (merlonCount - 1)) * (2 * Math.PI - 2 * OPEN - 0.24);
    m4.makeRotationY(-a).setPosition(Math.sin(a) * (R - 0.08), 1.0, -Math.cos(a) * (R - 0.08));
    merlons.setMatrixAt(placed++, m4);
  }
  world.add(merlons);
  // A tower at each end of the open front, framing the view, with a banner.
  for (const side of [-1, 1]) {
    const a = side * (OPEN + 0.2);
    const x = Math.sin(a) * (R + 0.5);
    const z = -Math.cos(a) * (R + 0.5);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 16, 18), darkStone);
    tower.position.set(x, -3, z);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.25, 2.2, 18), roof);
    cap.position.set(x, 6.1, z);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.5), new THREE.MeshStandardMaterial({ color: side < 0 ? 0x9c7a26 : 0x57357f, side: THREE.DoubleSide, roughness: 0.85 }));
    banner.position.set(x - Math.sin(a) * 1.02, 2.6, z + Math.cos(a) * 1.02);
    banner.rotation.y = -a + Math.PI;
    world.add(tower, cap, banner);
  }

  // Two turrets behind the player's shoulders and banners, so the terrace reads as part of a castle.
  for (const side of [-1, 1]) {
    const a = Math.PI + side * 0.62; // behind, left and right
    const x = Math.sin(a) * (R + 0.4);
    const z = -Math.cos(a) * (R + 0.4);
    const turret = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 7, 20), darkStone);
    turret.position.set(x, 3.3, z);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.6, 20), roof);
    cap.position.set(x, 8.1, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 6), darkStone);
    pole.position.set(x, 10.2, z);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), new THREE.MeshStandardMaterial({ color: side < 0 ? 0xc79a2e : 0x6a3fa0, side: THREE.DoubleSide, roughness: 0.8 }));
    flag.position.set(x + 0.56, 10.75, z);
    world.add(turret, cap, pole, flag);
  }
  // Braziers either side of where the board stands: warm light on the players.
  for (const side of [-1, 1]) {
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 1.1, 8), new THREE.MeshStandardMaterial({ color: 0x2a2420, metalness: 0.6, roughness: 0.5 }));
    stand.position.set(side * 2.7, 0.55, -1.6);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.14, 0.2, 12), stand.material);
    bowl.position.set(side * 2.7, 1.18, -1.6);
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 8), new THREE.MeshBasicMaterial({ color: 0xffa238, toneMapped: false }));
    fire.position.set(side * 2.7, 1.42, -1.6);
    fire.userData.flame = side;
    const glow = new THREE.PointLight(0xff8a3a, 2.4, 7, 1.6);
    glow.position.set(side * 2.7, 1.6, -1.6);
    world.add(stand, bowl, fire, glow);
  }

  // The kingdom, far below: land to the horizon, a river catching the sun, fields, villages with
  // lit windows, a walled town, another castle on a hill, and ranges of hills against the sky.
  const realm = new THREE.Group();
  world.add(realm);
  const land = new THREE.Mesh(new THREE.CircleGeometry(69, 48), new THREE.MeshStandardMaterial({ color: 0x2c3a2a, roughness: 1 }));
  land.rotation.x = -Math.PI / 2;
  land.position.y = -26;
  realm.add(land);
  const patchGeo = new THREE.PlaneGeometry(1, 1);
  patchGeo.rotateX(-Math.PI / 2);
  const fields = new THREE.InstancedMesh(patchGeo, new THREE.MeshStandardMaterial({ roughness: 1 }), 150);
  const col = new THREE.Color();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  for (let i = 0; i < 150; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 12 + rnd() * 50;
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
    scl.set(2.5 + rnd() * 6, 1, 2 + rnd() * 5);
    fields.setMatrixAt(i, m4.compose(pos.set(Math.sin(a) * r, -25.95 + i * 0.0004, -Math.cos(a) * r), quat, scl));
    fields.setColorAt(i, col.setHSL(0.14 + rnd() * 0.16, 0.35 + rnd() * 0.25, 0.09 + rnd() * 0.09));
  }
  realm.add(fields);
  const river = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-60, 0, -40), new THREE.Vector3(-36, 0, -50), new THREE.Vector3(-18, 0, -40), new THREE.Vector3(2, 0, -49), new THREE.Vector3(20, 0, -37), new THREE.Vector3(42, 0, -46), new THREE.Vector3(62, 0, -36)]), 60, 1.5, 3), new THREE.MeshBasicMaterial({ color: 0xffb46a, toneMapped: false }));
  river.scale.y = 0.02;
  river.position.y = -25.9;
  realm.add(river);

  const houseGeo = new THREE.BoxGeometry(1, 1, 1);
  const houses = new THREE.InstancedMesh(houseGeo, new THREE.MeshStandardMaterial({ color: 0xb9a78e, roughness: 0.9 }), 260);
  const roofs = new THREE.InstancedMesh(new THREE.ConeGeometry(0.8, 0.7, 4), new THREE.MeshStandardMaterial({ color: 0x7a3b2a, roughness: 0.9 }), 260);
  const lights = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ color: 0xffc45a, toneMapped: false, side: THREE.DoubleSide }), 260);
  let n = 0;
  const village = (cx, cz, count, spread) => {
    for (let i = 0; i < count && n < 260; i++, n++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * spread;
      const x = cx + Math.sin(a) * r;
      const z = cz + Math.cos(a) * r;
      const w = 0.7 + rnd() * 0.7;
      const h = 0.6 + rnd() * 0.7;
      const turn = rnd() * Math.PI;
      quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn);
      houses.setMatrixAt(n, m4.compose(pos.set(x, -26 + h / 2, z), quat, scl.set(w, h, w * (0.8 + rnd() * 0.6))));
      quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn + Math.PI / 4);
      roofs.setMatrixAt(n, m4.compose(pos.set(x, -26 + h + 0.33, z), quat, scl.set(w * 1.05, 1, w * 1.05)));
      // A lit window on the side facing the castle.
      const toCastle = Math.atan2(-x, -z);
      quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), toCastle);
      lights.setMatrixAt(n, m4.compose(pos.set(x + Math.sin(toCastle) * w * 0.6, -26 + h * 0.55, z + Math.cos(toCastle) * w * 0.6), quat, scl.set(1, 1, 1)));
    }
  };
  village(-8, -36, 60, 6);
  village(16, -44, 45, 5);
  village(-28, -48, 40, 5);
  village(32, -32, 30, 4);
  village(-22, -30, 25, 3.5);
  village(4, -57, 40, 6);
  village(-44, -36, 20, 3);
  houses.count = roofs.count = lights.count = n;
  realm.add(houses, roofs, lights);

  // The walled town below, with its own keep, and a rival castle on a far hill.
  const townWall = new THREE.Mesh(new THREE.TorusGeometry(7.5, 0.35, 6, 40), darkStone);
  townWall.rotation.x = Math.PI / 2;
  townWall.scale.z = 3;
  townWall.position.set(-8, -25.5, -36);
  realm.add(townWall);
  const fortress = (x, y, z, s) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 3), darkStone);
    body.position.y = 1.2;
    g.add(body);
    for (const [tx, tz] of [[-2, -1.5], [2, -1.5], [-2, 1.5], [2, 1.5]]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.65, 3.6, 10), darkStone);
      t.position.set(tx, 1.8, tz);
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.4, 10), roof);
      c.position.set(tx, 4.3, tz);
      g.add(t, c);
    }
    const tall = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 6, 10), darkStone);
    tall.position.y = 3;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1, 2, 10), roof);
    cap.position.y = 7;
    g.add(tall, cap);
    g.position.set(x, y, z);
    g.scale.setScalar(s);
    realm.add(g);
  };
  fortress(-8, -26, -36, 1.1);
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x26332a, roughness: 1 });
  // A broad flat-topped hill for the rival castle to stand on.
  const farHill = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 15, 9, 14), hillMat);
  farHill.position.set(27, -21.5, -52);
  realm.add(farHill);
  fortress(27, -17.1, -52, 1.6);
  // Hills ringing the horizon, darker and bluer with distance.
  for (let ring = 0; ring < 2; ring++) {
    const mat = new THREE.MeshBasicMaterial({ color: ring ? 0x2b2440 : 0x3a2f45, fog: false });
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + ring * 0.14;
      const r = 58 + ring * 8;
      const h = 5 + rnd() * (ring ? 13 : 7);
      const hill = new THREE.Mesh(new THREE.ConeGeometry(10 + rnd() * 9, h, 7), mat);
      hill.position.set(Math.sin(a) * r, -26 + h / 2, -Math.cos(a) * r);
      realm.add(hill);
    }
  }
  // Dark woods scattered between the fields.
  const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(0.7, 1.8, 6), new THREE.MeshStandardMaterial({ color: 0x1f3324, roughness: 1 }), 320);
  for (let i = 0; i < 320; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 10 + rnd() * 48;
    const s = 0.7 + rnd() * 0.9;
    quat.identity();
    trees.setMatrixAt(i, m4.compose(pos.set(Math.sin(a) * r, -26 + 0.9 * s, -Math.cos(a) * r), quat, scl.set(s, s, s)));
  }
  realm.add(trees);

  // The land is 26 m down in its own coordinates. Raise it and tip it up toward the horizon (a
  // valley rising away from the castle), so that villages 30 to 60 m out are in view over the rail.
  realm.rotation.x = 0.14;
  realm.position.y = 19;

  const flames = [];
  world.traverse((o) => { if (o.userData.flame) flames.push(o); });

  return {
    world,
    /**
     * Stand the world around a player: the terrace centred a little in front of them, turned so
     * the open view (and the sunset) lies the way they are facing.
     */
    placeAround(x, floorY, z, forwardX, forwardZ) {
      world.rotation.y = Math.atan2(-forwardX, -forwardZ);
      world.position.set(x + forwardX * 1.6, floorY, z + forwardZ * 1.6);
      world.updateMatrixWorld(true);
    },
    /** Flicker the braziers. */
    update(time) {
      for (const f of flames) {
        f.scale.y = 1 + Math.sin(time * 9 + f.userData.flame) * 0.14 + Math.sin(time * 23) * 0.06;
        f.rotation.y = time * 2;
      }
    },
  };
}
