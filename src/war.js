import * as THREE from 'three';
import { playBoom } from './audio.js?v=7a596fa';

// A battlefield that surrounds the duels.
//
// In AR the arena's sky and ground are hidden, so this is laid over the
// player's real room: a scorched, cracked floor that fades into the room's
// own floor, fires with drifting smoke and embers, barricades, broken
// shields and war banners, and catapult fireballs that arc in over the enemy
// lines and burst nearby. In VR and on a flat screen the same effects sit in
// the night arena.
//
// Everything lives in the combat group's space: the player stands at the
// origin and the enemies come from -Z. Effects keep a clear lane in front
// and a clear circle around the player.

function canvasTexture(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

let shared = null;
function textures() {
  if (shared) return shared;
  const puff = canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
  const flame = canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s * 0.62, 0, s / 2, s * 0.62, s * 0.5);
    grad.addColorStop(0, 'rgba(255,250,210,1)');
    grad.addColorStop(0.25, 'rgba(255,190,70,0.95)');
    grad.addColorStop(0.6, 'rgba(230,80,20,0.55)');
    grad.addColorStop(1, 'rgba(120,20,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(s / 2, s * 0.6, s * 0.32, s * 0.48, 0, 0, Math.PI * 2);
    g.fill();
  });
  // Scorched earth: dark blotches and cracks, fading to clear at the rim so
  // the real floor shows through in AR.
  const scorch = canvasTexture(512, (g, s) => {
    const c = s / 2;
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * c * 0.95;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      const rad = rand(10, 46);
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      const tone = Math.floor(rand(18, 48));
      grad.addColorStop(0, `rgba(${tone + 14},${tone},${tone - 6},0.55)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    g.strokeStyle = 'rgba(10,6,4,0.65)';
    for (let i = 0; i < 40; i++) {
      let x = c + rand(-c, c) * 0.8;
      let y = c + rand(-c, c) * 0.8;
      g.lineWidth = rand(1, 3);
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += rand(-26, 26);
        y += rand(-26, 26);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // Glowing cinders.
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(255,${Math.floor(rand(90, 160))},40,${rand(0.3, 0.7)})`;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * c * 0.85;
      g.fillRect(c + Math.cos(a) * r, c + Math.sin(a) * r, 2, 2);
    }
    g.globalCompositeOperation = 'destination-in';
    const fade = g.createRadialGradient(c, c, c * 0.55, c, c, c);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, s, s);
  });
  const banner = [0, 1].map((side) =>
    canvasTexture(128, (g, s) => {
      g.fillStyle = side === 0 ? '#8d2434' : '#3a2378';
      g.fillRect(0, 0, s, s);
      g.fillStyle = side === 0 ? '#e6c27a' : '#c9b6ff';
      g.fillRect(0, 0, s, 10);
      g.beginPath();
      g.moveTo(30, 88);
      g.lineTo(30, 58);
      g.lineTo(46, 70);
      g.lineTo(56, 42);
      g.lineTo(64, 66);
      g.lineTo(74, 40);
      g.lineTo(84, 70);
      g.lineTo(98, 54);
      g.lineTo(98, 88);
      g.closePath();
      g.fill();
    }),
  );
  shared = { puff, flame, scorch, banner };
  return shared;
}

export function createWarZone(group) {
  const tex = textures();
  const root = new THREE.Group();
  group.add(root);

  // Scorched battlefield floor.
  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(8, 48),
    new THREE.MeshBasicMaterial({ map: tex.scorch, transparent: true, depthWrite: false }),
  );
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.y = 0.012;
  scorch.renderOrder = 1;
  root.add(scorch);

  // ------------------------------------------------------------- props --
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 0.85, flatShading: true });
  const charred = new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 0.95, flatShading: true });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.5, metalness: 0.6, flatShading: true });

  function barricade(x, z, yaw) {
    // Cheval de frise: a log with crossed sharpened stakes.
    const b = new THREE.Group();
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.6, 6), wood);
    log.rotation.z = Math.PI / 2;
    log.position.y = 0.32;
    b.add(log);
    for (let i = 0; i < 4; i++) {
      for (const s of [-1, 1]) {
        const stake = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.95, 5), i % 2 ? charred : wood);
        stake.position.set(-0.6 + i * 0.4, 0.32, 0);
        stake.rotation.set(s * 0.8, 0, 0);
        stake.translateY(0.25);
        b.add(stake);
      }
    }
    b.position.set(x, 0, z);
    b.rotation.y = yaw;
    root.add(b);
  }
  barricade(-3.4, -2.4, 0.5);
  barricade(3.6, -2.0, -0.4);
  barricade(-4.2, 1.6, 1.3);
  barricade(4.0, 2.2, -1.2);

  // Broken shields and a fallen spear on the ground.
  for (let i = 0; i < 7; i++) {
    const a = rand(0, Math.PI * 2);
    const r = rand(2.2, 5.5);
    const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 10, 1, false, 0, rand(3.4, 6.2)), i % 2 ? steel : wood);
    shield.position.set(Math.sin(a) * r, 0.03, Math.cos(a) * r);
    shield.rotation.set(rand(-0.25, 0.25), rand(0, 6.28), rand(-0.25, 0.25));
    root.add(shield);
  }
  for (let i = 0; i < 4; i++) {
    const spear = new THREE.Group();
    spear.add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.8, 5), wood));
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.18, 4), steel);
    head.position.y = 0.99;
    spear.add(head);
    const a = rand(0, Math.PI * 2);
    const r = rand(2.5, 6);
    spear.position.set(Math.sin(a) * r, 0.6, Math.cos(a) * r);
    spear.rotation.set(rand(0.5, 0.9), rand(0, 6.28), 0);
    root.add(spear);
  }

  // War banners on poles, Gold and Violet, waving.
  const banners = [];
  [[-2.6, -4.2, 0], [2.8, -4.6, 1], [-5.4, -0.6, 0], [5.2, -0.2, 1], [-3.0, 4.4, 1], [3.2, 4.0, 0]].forEach(([x, z, side]) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 2.6, 6), wood);
    pole.position.set(x, 1.3, z);
    root.add(pole);
    const geo = new THREE.PlaneGeometry(0.7, 0.95, 8, 4);
    const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex.banner[side], side: THREE.DoubleSide, roughness: 0.9 }));
    geo.translate(0.35, 0, 0);
    cloth.position.set(x + 0.03, 2.05, z);
    cloth.rotation.y = Math.atan2(-x, -z) + Math.PI / 2;
    root.add(cloth);
    banners.push({ geo, base: geo.attributes.position.array.slice(), phase: rand(0, 6) });
  });

  // ------------------------------------------------------------- fires --
  const fires = [];
  const fireLights = [];
  const firePlaces = [[-3.9, -3.2], [4.3, -3.5], [-5.2, 0.9], [5.0, 1.2], [-2.2, 5.0], [2.6, 5.4], [0.0, -6.6]];
  firePlaces.forEach(([x, z], i) => {
    const logs = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.7, 5), charred);
      log.rotation.set(Math.PI / 2, (k / 3) * Math.PI, 0);
      log.position.y = 0.06;
      logs.add(log);
    }
    logs.position.set(x, 0, z);
    root.add(logs);
    const flames = [];
    for (let k = 0; k < 3; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.flame, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.position.set(x + rand(-0.12, 0.12), 0.45, z + rand(-0.12, 0.12));
      root.add(s);
      flames.push({ s, phase: rand(0, 6), size: rand(0.6, 0.9) });
    }
    fires.push({ x, z, flames, smokeT: rand(0, 1) });
    if (i < 3) {
      const light = new THREE.PointLight(0xff7a30, 6, 9, 2);
      light.position.set(x, 0.9, z);
      root.add(light);
      fireLights.push({ light, phase: rand(0, 6) });
    }
  });

  // ------------------------------------------------------------- smoke --
  const smoke = [];
  for (let i = 0; i < 46; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.puff, color: 0x3a3632, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false;
    root.add(s);
    smoke.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, grow: 1, peak: 0.35 });
  }
  let smokeNext = 0;
  function puff(x, y, z, { size = 0.6, grow = 1.6, life = 4, rise = 0.45, peak = 0.35, color = 0x3a3632 } = {}) {
    const p = smoke[smokeNext];
    smokeNext = (smokeNext + 1) % smoke.length;
    p.s.position.set(x, y, z);
    p.s.scale.setScalar(size);
    p.s.material.color.setHex(color);
    p.s.visible = true;
    p.life = 0;
    p.max = life;
    p.vx = rand(-0.15, 0.15) + 0.12; // a light breeze
    p.vy = rise;
    p.vz = rand(-0.15, 0.15);
    p.grow = grow;
    p.peak = peak;
  }

  // ------------------------------------------------------------ embers --
  const EMBERS = 160;
  const emberPos = new Float32Array(EMBERS * 3);
  const emberVel = new Float32Array(EMBERS * 3);
  const emberLife = new Float32Array(EMBERS);
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
  const embers = new THREE.Points(
    emberGeo,
    new THREE.PointsMaterial({ color: 0xffa040, size: 0.05, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  embers.frustumCulled = false;
  root.add(embers);
  let emberNext = 0;
  function ember(x, y, z, speed = 1) {
    const i = emberNext;
    emberNext = (emberNext + 1) % EMBERS;
    emberPos.set([x, y, z], i * 3);
    emberVel.set([rand(-0.3, 0.3) * speed, rand(0.5, 1.4) * speed, rand(-0.3, 0.3) * speed], i * 3);
    emberLife[i] = rand(1.5, 3.5);
  }
  for (let i = 0; i < EMBERS; i++) emberPos[i * 3 + 1] = -50;

  // --------------------------------------------------------- artillery --
  const flash = new THREE.PointLight(0xffa050, 0, 14, 2);
  root.add(flash);
  const blasts = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.flame, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    s.visible = false;
    root.add(s);
    blasts.push({ s, t: 1 });
  }
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), new THREE.MeshStandardMaterial({ color: 0x3a2a20, emissive: 0xff5a10, emissiveIntensity: 1.4, flatShading: true }));
  const rockGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.flame, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  rockGlow.scale.setScalar(0.9);
  const shot = new THREE.Group();
  shot.add(rock, rockGlow);
  shot.visible = false;
  root.add(shot);
  const flight = { t: 0, dur: 1.6, from: new THREE.Vector3(), to: new THREE.Vector3(), height: 6, active: false };
  let nextShot = 2.5;

  function launch() {
    // From far behind the enemy lines to a spot around the player, never in
    // the clear circle where the player stands.
    const a = rand(-1.9, 1.9);
    const r = rand(3.6, 7.5);
    flight.to.set(Math.sin(a) * r, 0, -Math.cos(a) * r);
    flight.from.set(rand(-10, 10), 5, -22);
    flight.height = rand(5, 8);
    flight.dur = rand(1.4, 2.0);
    flight.t = 0;
    flight.active = true;
    shot.visible = true;
  }

  function explode(at) {
    const b = blasts.find((x) => x.t >= 1) || blasts[0];
    b.t = 0;
    b.s.position.set(at.x, 0.6, at.z);
    b.s.visible = true;
    flash.position.set(at.x, 1.2, at.z);
    flash.intensity = 40;
    for (let i = 0; i < 6; i++) puff(at.x + rand(-0.4, 0.4), 0.3, at.z + rand(-0.4, 0.4), { size: 0.9, grow: 2.4, life: rand(3, 5), rise: 0.6, peak: 0.55, color: 0x2a2622 });
    for (let i = 0; i < 26; i++) ember(at.x, 0.2, at.z, 3.2);
    playBoom(Math.min(1, 5 / Math.hypot(at.x, at.z)));
  }

  // ------------------------------------------------------------ update --
  let time = 0;
  let isAR = false;
  function update(dt) {
    if (!root.visible) return;
    time += dt;

    for (const f of fires) {
      for (const fl of f.flames) {
        const k = 1 + Math.sin(time * 13 + fl.phase) * 0.12 + Math.sin(time * 23 + fl.phase * 2) * 0.08;
        fl.s.scale.set(fl.size * 0.8 * k, fl.size * 1.25 * k, 1);
      }
      f.smokeT -= dt;
      if (f.smokeT <= 0) {
        f.smokeT = rand(0.55, 0.9);
        puff(f.x + rand(-0.1, 0.1), 1.0, f.z + rand(-0.1, 0.1), { size: 0.55, grow: 1.7, life: rand(4, 6), rise: 0.5, peak: isAR ? 0.3 : 0.4 });
      }
      if (Math.random() < dt * 9) ember(f.x, 0.6, f.z, 0.8);
    }
    for (const fl of fireLights) {
      fl.light.intensity = 5 + Math.sin(time * 11 + fl.phase) * 1.2 + Math.sin(time * 27 + fl.phase) * 0.8;
    }

    for (const p of smoke) {
      if (!p.s.visible) continue;
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) {
        p.s.visible = false;
        continue;
      }
      p.s.position.x += p.vx * dt;
      p.s.position.y += p.vy * dt;
      p.s.position.z += p.vz * dt;
      p.s.scale.multiplyScalar(1 + p.grow * dt * 0.35);
      p.s.material.opacity = Math.sin(Math.PI * k) * p.peak;
    }

    for (let i = 0; i < EMBERS; i++) {
      if (emberLife[i] <= 0) continue;
      emberLife[i] -= dt;
      const j = i * 3;
      emberVel[j] += Math.sin(time * 2 + i) * dt * 0.4;
      emberVel[j + 1] -= dt * 0.15;
      emberPos[j] += emberVel[j] * dt;
      emberPos[j + 1] += emberVel[j + 1] * dt;
      emberPos[j + 2] += emberVel[j + 2] * dt;
      if (emberLife[i] <= 0) emberPos[j + 1] = -50;
    }
    emberGeo.attributes.position.needsUpdate = true;

    for (const b of banners) {
      const pos = b.geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = b.base[i * 3];
        pos.setZ(i, Math.sin(time * 3 + b.phase + x * 6) * 0.08 * x + Math.sin(time * 5.3 + x * 9) * 0.02 * x);
      }
      pos.needsUpdate = true;
    }

    nextShot -= dt;
    if (nextShot <= 0 && !flight.active) {
      launch();
      nextShot = rand(3.5, 6.5);
    }
    if (flight.active) {
      flight.t += dt;
      const k = Math.min(1, flight.t / flight.dur);
      shot.position.lerpVectors(flight.from, flight.to, k);
      shot.position.y = flight.from.y * (1 - k) + Math.sin(Math.PI * k) * flight.height;
      rock.rotation.x += dt * 6;
      if (Math.random() < dt * 30) puff(shot.position.x, shot.position.y, shot.position.z, { size: 0.3, grow: 1.2, life: 1.4, rise: 0.1, peak: 0.25 });
      if (k >= 1) {
        flight.active = false;
        shot.visible = false;
        explode(flight.to);
      }
    }
    for (const b of blasts) {
      if (b.t >= 1) continue;
      b.t = Math.min(1, b.t + dt / 0.6);
      const s = 0.6 + b.t * 3.2;
      b.s.scale.set(s, s, 1);
      b.s.material.opacity = (1 - b.t) ** 1.5;
      if (b.t >= 1) b.s.visible = false;
    }
    flash.intensity *= Math.exp(-dt * 7);
  }

  return {
    root,
    update,
    setAR(on) {
      isAR = on;
      // Over a real room the scorch is lighter so the floor still reads.
      scorch.material.opacity = on ? 0.75 : 1;
    },
    reset() {
      nextShot = 2.5;
      flight.active = false;
      shot.visible = false;
      for (const p of smoke) p.s.visible = false;
      for (let i = 0; i < EMBERS; i++) {
        emberLife[i] = 0;
        emberPos[i * 3 + 1] = -50;
      }
      for (const b of blasts) {
        b.t = 1;
        b.s.visible = false;
      }
      flash.intensity = 0;
    },
  };
}
