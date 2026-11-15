import * as THREE from 'three';
import { clashBlurb } from './rules.js?v=2eb7fa6';
import {
  createArrowMesh,
  createBattleBow,
  createBattleShield,
  createBattleSword,
  createSoldier,
  setBowString,
} from './pieces.js?v=2eb7fa6';
import { playArrow, playDeflect, playHit, playHurt, playWhoosh } from './audio.js?v=2eb7fa6';
import { bowGrip, fist, isTracked, pinch, swordGrip, wrist } from './handgrip.js?v=2eb7fa6';
import { createWarZone, makeSkyEnvironment } from './war.js?v=2eb7fa6';
import { startWarAmbience, stopWarAmbience } from './audio.js?v=2eb7fa6';

export const INLINE_ARENA = { x: 0, y: -40, z: 0, eye: 1.62 };

const TUNING = {
  meleeQuota: 6,
  meleeSpeed: 2.65,
  archerCount: 4,
  archerInterval: 3.05,
  hearts: 5,
  enemyArrowSpeed: 8.2,
  playerArrowSpeed: 22,
  swordRange: 2.45,
};

const _forward = new THREE.Vector3(0, 0, -1);
const _tip = new THREE.Vector3();
const _base = new THREE.Vector3();
const _prevTip = new THREE.Vector3();
const _prevBase = new THREE.Vector3();
const _player = new THREE.Vector3();
const _local = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _shotOrigin = new THREE.Vector3();
const _swordTip = new THREE.Vector3(0, 0, -0.9);
const _swordBase = new THREE.Vector3(0, 0, -0.14);
const _look = new THREE.Vector3();
const _lookQ = new THREE.Quaternion();
const _gripPos = new THREE.Vector3();
const _gripQuat = new THREE.Quaternion();
const _pinchPt = new THREE.Vector3();
const _nockW = new THREE.Vector3();
const _nockL = new THREE.Vector3();
const _tipW = new THREE.Vector3();
const _prevTipW = new THREE.Vector3();
const _gripW = new THREE.Vector3();
const _wristL = new THREE.Vector3();
const _y = new THREE.Vector3();
const _fwdW = new THREE.Vector3();
const _zW = new THREE.Vector3();
const _xW = new THREE.Vector3();
const _pullW = new THREE.Vector3();
const _upW = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _vel = new THREE.Vector3();
const _edge = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _body = new THREE.Vector3();
const _X = new THREE.Vector3(1, 0, 0);
const _Z = new THREE.Vector3(0, 0, 1);

// The sword's rest pose: blade upright in front, tilted a little forward, with
// an edge (local X) turned to face forward so a chop leads with the edge.
// spin: about the blade, pitch: blade from forward (-Z) up toward +Y, lean:
// tip toward the centre of view.
function swordPose(out, pitch, lean, spin = Math.PI / 2) {
  _q1.setFromAxisAngle(_Z, spin);
  _q2.setFromAxisAngle(_X, pitch);
  out.setFromAxisAngle(_Z, lean).multiply(_q2).multiply(_q1);
  return out;
}
const SWORD_UP = 1.25;
// Swordsmen start swinging this far out, and a cut lands within this reach.
const SWING_FROM = 5.5;
const SWORD_REACH = 1.75;
const _lockOrigin = new THREE.Vector3();
const _lockDir = new THREE.Vector3();
const _lockTo = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _bowAimL = new THREE.Vector3();
const _negZ = new THREE.Vector3(0, 0, -1);
const _home = new THREE.Vector3();
const LOCK_Y = 1.15;
const _aimWorld = new THREE.Vector3();

function distPointSeg(p, a, b) {
  _ab.subVectors(b, a);
  _ap.subVectors(p, a);
  const ab2 = _ab.lengthSq();
  const t = ab2 < 1e-6 ? 0 : Math.max(0, Math.min(1, _ap.dot(_ab) / ab2));
  _closest.copy(a).addScaledVector(_ab, t);
  return _closest.distanceTo(p);
}

function paletteForEnemy(attackerSide) {
  if (attackerSide === 0) {
    return { side: 1, cloth: 0x3a2a68, metal: 0xc8c4e4, emissive: 0x221848, skin: 0x8d6a52 };
  }
  return { side: 0, cloth: 0x6a3a28, metal: 0xf0d090, emissive: 0x4a3010, skin: 0x8d6a52 };
}

export function createCombat({ scene, camera, renderer, hooks }) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  // The night arena's sky and ground are hidden in AR so the fight happens
  // in the player's real room, which the war zone turns into a battlefield.
  const arenaBackdrop = buildArena(group);
  const war = createWarZone(group);
  // A cheap disc that catches the soldiers' shadows around the fight.
  let quality = 'high';
  const shadowCatcher = new THREE.Mesh(
    new THREE.CircleGeometry(7, 32),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.42, depthWrite: false }),
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = 0.003;
  shadowCatcher.receiveShadow = true;
  group.add(shadowCatcher);
  // Steel reflects the smoky battlefield sky, not a studio.
  let battleEnv = null;
  let savedEnv = null;
  function useBattleEnv(on) {
    if (on) {
      if (!battleEnv) battleEnv = makeSkyEnvironment(renderer);
      if (!battleEnv) return;
      savedEnv = scene.environment;
      scene.environment = battleEnv;
    } else if (battleEnv && scene.environment === battleEnv) {
      scene.environment = savedEnv;
    }
  }
  function applyArenaMode() {
    const ar = !!hooks.isAR?.();
    // The catcher carries the soldiers' shadows on the real floor in AR and
    // on the battlefield in VR (the terrain itself doesn't take shadows).
    shadowCatcher.visible = ar || war.hasField();
    // Shadows are the first thing to go if the headset is struggling.
    if (arenaBackdrop.sun) arenaBackdrop.sun.castShadow = quality !== 'low';
    // The plain night arena only shows if the battlefield failed to load.
    for (const obj of arenaBackdrop) obj.visible = !ar && !war.hasField();
    war.setAR(ar);
  }
  war.onFieldLoaded(() => applyArenaMode());

  const sword = createBattleSword(0xf0d090);
  const bow = createBattleBow(0xf0d090);
  const shield = createBattleShield(0xd9d4f0);
  for (const w of [sword, bow, shield]) {
    w.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
  }
  sword.visible = false;
  bow.visible = false;
  shield.visible = false;

  const sparks = createSparks(group);

  // Lock-on marker: a ring that hangs on the enemy the bow is aimed at.
  const lockRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.025, 6, 32),
    new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.9, depthTest: false }),
  );
  lockRing.renderOrder = 10;
  lockRing.visible = false;
  group.add(lockRing);
  let locked = null;
  let autoDraw = false;
  let mousePull = false;
  const enemies = [];
  const arrows = [];
  let active = false;
  let mode = 'sword-melee';
  let attackerSide = 0;
  let phase = 'idle';
  let phaseT = 0;
  let hearts = TUNING.hearts;
  let kills = 0;
  let quota = TUNING.meleeQuota;
  let vulnerable = false;
  let spawnT = 0;
  let spawned = 0;
  let blocks = 0;
  let draw = 0;
  let reload = 0;
  let swingU = -1;
  let hot = 0;
  let hurtFlash = 0;
  let resultWin = false;
  let resolveFn = null;
  let weaponColor = 0xf0d090;
  let anchored = false;
  const handPrev = new THREE.Vector3();
  const handNow = new THREE.Vector3();
  let haveHandPrev = false;
  let scripted = false;
  let presented = false;
  // 'screen' (no XR), 'controller' (weapons on controllers) or 'hand'
  // (weapons posed from tracked hand joints every frame).
  let gripMode = 'screen';
  let stringHeld = false;
  let drawPeak = 0;
  let releaseWait = 0;
  const _peakNock = new THREE.Vector3();
  let pinching = false;
  let haveTipPrev = false;

  function trackedHand(which) {
    if (!renderer.xr.isPresenting) return null;
    const hand = hooks.trackedHand?.(which);
    return isTracked(hand) ? hand : null;
  }

  function wantedGripMode() {
    if (!renderer.xr.isPresenting) return 'screen';
    // The sword needs its hand; the bow needs the bow hand (left), and the
    // string is drawn by pinching with the right.
    if (usesSword() ? trackedHand('right') : trackedHand('left')) return 'hand';
    // Bow with both controllers: hold the bow in one, pull the string with the other.
    if (!usesSword() && hooks.leftGrip?.() && hooks.rightGrip?.() && hooks.leftHand?.()) return 'controller2';
    return 'controller';
  }

  function usesSword() {
    return mode === 'sword-melee' || mode === 'sword-deflect';
  }

  function clearActors() {
    for (const e of enemies) group.remove(e.mesh);
    for (const a of arrows) group.remove(a.mesh);
    enemies.length = 0;
    arrows.length = 0;
  }

  function setWeaponColor(side) {
    // Steel stays steel; the player's court shows on the shield's paint.
    weaponColor = side === 0 ? 0xf0d090 : 0xd5d0ff;
    shield.userData.setCourt?.(side);
  }

  function detachWeapons() {
    sword.removeFromParent();
    bow.removeFromParent();
    shield.removeFromParent();
    shield.scale.setScalar(1);
    sword.visible = false;
    bow.visible = false;
    shield.visible = false;
  }

  function attachWeapons() {
    detachWeapons();
    const weapon = usesSword() ? sword : bow;
    weapon.visible = true;
    weapon.scale.setScalar(1);
    gripMode = wantedGripMode();
    stringHeld = false;
    drawPeak = 0;
    pinching = false;
    haveTipPrev = false;
    if (gripMode === 'controller2') {
      scene.add(weapon);
      scripted = false;
      return;
    }
    if (gripMode === 'hand') {
      // Posed in world space from the hand joints each frame.
      scene.add(weapon);
      if (usesSword() && trackedHand('left')) {
        shield.visible = true;
        scene.add(shield);
      }
      scripted = false;
      return;
    }
    const right = hooks.rightHand?.();
    const left = hooks.leftHand?.();
    if (renderer.xr.isPresenting && (right || left)) {
      const hand = right || left;
      if (usesSword()) {
        // The controller is the hilt: the blade runs straight along its
        // handle (grip space -Z), upright when you hold it upright, with an
        // edge turned toward your knuckles so a natural chop leads with it.
        const grip = hooks.rightGrip?.() || hand;
        grip.add(weapon);
        weapon.position.set(0, 0, 0.03);
        weapon.quaternion.setFromAxisAngle(_Z, Math.PI / 2).multiply(_q1.setFromAxisAngle(_X, Math.PI / 6));
        if (left && left !== hand) {
          shield.visible = true;
          left.add(shield);
          shield.position.set(0, 0.02, -0.08);
          shield.rotation.set(0.2, 0, 0);
        }
      } else {
        hand.add(weapon);
        weapon.position.set(0.02, 0.04, -0.12);
        weapon.rotation.set(0, 0, 0);
      }
      scripted = false;
    } else {
      camera.add(weapon);
      if (usesSword()) {
        weapon.scale.setScalar(1);
        weapon.position.set(0.2, -0.3, -0.5);
        swordPose(weapon.quaternion, SWORD_UP, 0.18);
        // Shield low on the left; raised in front while blocking.
        camera.add(shield);
        shield.visible = true;
        shield.scale.setScalar(0.85);
      } else {
        weapon.scale.setScalar(0.55);
        weapon.position.set(0.1, -0.13, -0.45);
        weapon.rotation.set(0, 0, 0);
      }
      scripted = true;
    }
  }

  function anchor() {
    if (renderer.xr.isPresenting) {
      const cam = renderer.xr.getCamera();
      cam.getWorldPosition(_camPos);
      cam.getWorldDirection(_camDir);
      _camDir.y = 0;
      if (_camDir.lengthSq() < 1e-4) _camDir.set(0, 0, -1);
      _camDir.normalize();
      // On a floor-based reference space y = 0 is the real floor; otherwise
      // assume the head is 1.6 m up.
      const floorY = hooks.floorBased?.() ? 0 : _camPos.y - 1.6;
      group.position.set(_camPos.x, floorY, _camPos.z);
      group.rotation.y = Math.atan2(-_camDir.x, -_camDir.z);
    } else {
      group.position.set(INLINE_ARENA.x, INLINE_ARENA.y, INLINE_ARENA.z);
      group.rotation.set(0, 0, 0);
    }
    group.updateMatrixWorld(true);
    anchored = true;
  }

  function spawnSwordsman() {
    const mesh = createSoldier('sword', paletteForEnemy(attackerSide));
    // From the attacking end in a loose column: each new swordsman takes a
    // slightly different line, and later ones come on a little faster.
    spawned += 1;
    const a = [0, 0.22, -0.22][(spawned - 1) % 3] + (Math.random() - 0.5) * 0.1;
    const dist = 8.6;
    mesh.position.set(Math.sin(a) * dist, 0, -Math.cos(a) * dist);
    group.add(mesh);
    enemies.push({
      mesh,
      kind: 'sword',
      alive: true,
      windup: 0,
      swing: Math.floor(Math.random() * 2),
      seed: Math.random() * 10,
      dying: 0,
      speed: TUNING.meleeSpeed * (1 + Math.min(spawned - 1, 5) * 0.04),
    });
  }

  function spawnArchers() {
    const n = TUNING.archerCount;
    for (let i = 0; i < n; i++) {
      const mesh = createSoldier('archer', paletteForEnemy(attackerSide));
      const spread = 0.8;
      const a = -spread / 2 + (spread * i) / Math.max(1, n - 1);
      const dist = 7.4;
      mesh.position.set(Math.sin(a) * dist, 0, -Math.cos(a) * dist);
      group.add(mesh);
      enemies.push({
        mesh,
        kind: 'archer',
        alive: true,
        cooldown: 0.8 + i * 0.55,
        sinceShot: 9,
        seed: i,
        dying: 0,
      });
    }
  }

  function launchArrow(origin, dir, speed, extra) {
    const mesh = createArrowMesh(extra?.fromPlayer ? weaponColor : 0xd7c4a2);
    mesh.position.copy(origin);
    mesh.quaternion.setFromUnitVectors(_forward, dir);
    group.add(mesh);
    const arrow = {
      mesh,
      vel: dir.clone().multiplyScalar(speed),
      alive: true,
      age: 0,
      fromPlayer: !!extra?.fromPlayer,
      reflected: false,
      owner: extra?.owner ?? null,
      prev: origin.clone(),
    };
    arrows.push(arrow);
    return arrow;
  }

  function killEnemy(e, point) {
    if (!e.alive) return;
    e.alive = false;
    e.dying = 0.001;
    kills += 1;
    sparks.burst(point || e.mesh.position.clone().setY(1.2), 0xffe1b0, 10, 3.5);
    playHit();
    hooks.haptic?.(0.7);
    // Browsers refuse vibration until the page has been tapped.
    if (navigator.vibrate && navigator.userActivation?.isActive) navigator.vibrate(18);
  }

  // ------------------------------------------------------------ shield --
  // The shield is impenetrable: any strike or arrow it covers is stopped.
  // With controllers or hands it covers what it is held toward; on a flat
  // screen, raising it (right mouse button or Q) covers everything in front.
  const _shieldP = new THREE.Vector3();
  const _toFoe = new THREE.Vector3();
  const _toShield = new THREE.Vector3();
  let shieldUp = 0;

  function shieldReady() {
    return usesSword() && shield.parent && shield.visible;
  }

  function shieldPosLocal(out) {
    shield.getWorldPosition(out);
    return group.worldToLocal(out);
  }

  // Is the shield between the player and a threat at (x, y, z)?
  function shieldCovers(x, y, z) {
    if (!shieldReady()) return false;
    _toFoe.set(x - _player.x, 0, z - _player.z);
    if (scripted) {
      // Flat screen: a raised shield guards the front, ±55 degrees.
      if (shieldUp < 0.6) return false;
      const len = _toFoe.length() || 1;
      return (_look.x * _toFoe.x + _look.z * _toFoe.z) / len > 0.57;
    }
    shieldPosLocal(_shieldP);
    _toShield.set(_shieldP.x - _player.x, 0, _shieldP.z - _player.z);
    const reach = _toShield.length();
    if (reach < 0.12 || reach > 0.95) return false;
    // Held out toward the threat: within 40 degrees of its direction.
    return _toShield.dot(_toFoe) / (reach * (_toFoe.length() || 1)) > 0.77;
  }

  // Does an incoming arrow strike the shield this frame?
  function shieldStops(arrow) {
    if (!shieldReady()) return false;
    if (scripted) {
      return shieldUp >= 0.6 && arrow.mesh.position.distanceTo(_chest) < 1.1
        && shieldCovers(arrow.mesh.position.x, arrow.mesh.position.y, arrow.mesh.position.z);
    }
    shieldPosLocal(_shieldP);
    const from = arrow.prev || arrow.mesh.position;
    return distPointSeg(_shieldP, from, arrow.mesh.position) < 0.36;
  }

  function blockHit(x, y, z) {
    shieldPosLocal(_shieldP);
    sparks.burst(_shieldP.lengthSq() > 0 ? _shieldP : _local.set(x, y, z), 0xfff0c0, 12, 3);
    playDeflect();
    hooks.haptic?.(0.7);
    blocks += 1;
  }

  // A swordsman's cut that reaches the player: blocked by the shield (he
  // staggers back) or it hurts.
  function landBlow(e, dist) {
    if (shieldCovers(e.mesh.position.x, 1.25, e.mesh.position.z)) {
      blockHit(e.mesh.position.x, 1.25, e.mesh.position.z);
      e.windup = -0.55;
      e.mesh.position.x -= (_dir.x / dist) * 0.35;
      e.mesh.position.z -= (_dir.z / dist) * 0.35;
    } else {
      damagePlayer();
      e.windup = -0.28;
    }
    e.swing += 1;
  }

  // The swish of a swordsman's blade as it comes down, if he is near enough
  // to hear.
  function swingWhoosh(e, dist) {
    if (e.windup >= 0.42 && !e.whooshed) {
      e.whooshed = true;
      if (dist < 6) playWhoosh();
    }
    if (e.windup < 0.42) e.whooshed = false;
  }

  function damagePlayer() {
    if (!vulnerable || hurtFlash > 0) return;
    hearts -= 1;
    hurtFlash = 0.7;
    playHurt();
    hooks.haptic?.(1);
    hooks.hurt?.();
    if (navigator.vibrate && navigator.userActivation?.isActive) navigator.vibrate(40);
  }

  function reflectArrow(arrow, owner) {
    const target = new THREE.Vector3();
    if (owner?.alive) {
      owner.mesh.getWorldPosition(target);
      group.worldToLocal(target);
      target.y += 1.25;
    } else {
      target.set(_player.x, 1.2, _player.z - 6);
    }
    _dir.subVectors(target, arrow.mesh.position);
    if (_dir.lengthSq() < 0.001) _dir.set(0, 0, -1);
    _dir.normalize();
    arrow.vel.copy(_dir).multiplyScalar(16);
    arrow.reflected = true;
    arrow.fromPlayer = false;
    arrow.mesh.quaternion.setFromUnitVectors(_forward, _dir);
    sparks.burst(arrow.mesh.position, 0xfff2c8, 6, 2.4);
    playDeflect();
    hooks.haptic?.(0.45);
  }

  function objectiveText() {
    if (mode === 'sword-melee') return `Cut down the charge  ${kills}/${quota}`;
    if (mode === 'bow-melee') return `Loose into the rush  ${kills}/${quota}`;
    const aliveArchers = enemies.filter((e) => e.kind === 'archer' && e.alive).length;
    if (mode === 'sword-deflect') return `Deflect arrows into the archers  ${TUNING.archerCount - aliveArchers}/${TUNING.archerCount}`;
    return `Shoot the archers down  ${TUNING.archerCount - aliveArchers}/${TUNING.archerCount}`;
  }

  function checkEnd() {
    if (hearts <= 0) return 'lose';
    if (mode === 'sword-melee' || mode === 'bow-melee') {
      if (kills >= quota) return 'win';
    } else if (enemies.length && enemies.every((e) => e.kind !== 'archer' || !e.alive)) {
      return 'win';
    }
    return null;
  }

  function hud() {
    hooks.hud?.({
      hearts,
      max: TUNING.hearts,
      objective: phase === 'fight' ? objectiveText() : '',
      draw: usesSword() ? 0 : draw,
      showMeter: !usesSword() && phase === 'fight',
    });
  }

  function begin(cfg) {
    clearActors();
    mode = `${cfg.attackerType === 'S' ? 'sword' : 'bow'}-${cfg.defenderType === 'S' ? 'melee' : cfg.defenderType === 'A' && cfg.attackerType === 'S' ? 'deflect' : cfg.attackerType === 'A' && cfg.defenderType === 'A' ? 'duel' : 'melee'}`;
    if (cfg.attackerType === 'S' && cfg.defenderType === 'S') mode = 'sword-melee';
    else if (cfg.attackerType === 'S' && cfg.defenderType === 'A') mode = 'sword-deflect';
    else if (cfg.attackerType === 'A' && cfg.defenderType === 'S') mode = 'bow-melee';
    else mode = 'bow-duel';

    attackerSide = cfg.attackerSide;
    setWeaponColor(attackerSide);
    hearts = TUNING.hearts;
    kills = 0;
    quota = TUNING.meleeQuota;
    vulnerable = false;
    spawnT = 0;
    spawned = 0;
    blocks = 0;
    shieldUp = 0;
    draw = 0;
    reload = 0;
    swingU = -1;
    hot = 0;
    hurtFlash = 0;
    phase = 'intro';
    phaseT = 0;
    active = true;
    haveHandPrev = false;
    presented = renderer.xr.isPresenting;
    group.visible = true;
    war.reset();
    useBattleEnv(true);
    applyArenaMode();
    startWarAmbience();
    anchor();
    hooks.onView?.(true);
    attachWeapons();
    if (mode === 'sword-deflect' || mode === 'bow-duel') spawnArchers();
    hooks.caption?.(clashBlurb(cfg.attackerType, cfg.defenderType));
    hooks.fade?.(1, '#07060a');
    hud();
  }

  function finish(win) {
    if (!active || phase === 'result') return;
    resultWin = win;
    phase = 'result';
    phaseT = 0;
    vulnerable = false;
    hooks.caption?.(win ? 'The square is yours' : 'You are thrown back');
    if (win) playHit();
  }

  function teardown() {
    stopWarAmbience();
    setLock(null);
    autoDraw = false;
    mousePull = false;
    detachWeapons();
    clearActors();
    useBattleEnv(false);
    group.visible = false;
    anchored = false;
    active = false;
    hooks.fade?.(0, '#000');
    hooks.caption?.('');
    hooks.onView?.(false);
    hooks.hud?.(null);
  }

  function playerLocal() {
    const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    cam.getWorldPosition(_camPos);
    group.worldToLocal(_player.copy(_camPos));
  }

  function updateWeaponPose(dt, input) {
    const weapon = usesSword() ? sword : bow;
    if (!weapon.parent) return;

    if (usesSword() && scripted) {
      // Swung like a real sword, pivoting at the hand: wind up back over the
      // right shoulder, cut diagonally down through the centre with the edge
      // leading, follow through low on the left, then recover to the guard.
      // Each key: [pitch (blade from forward up toward vertical and back),
      // lean (tip toward centre), hand x, hand y].
      const GUARD = [SWORD_UP, 0.18, 0.2, -0.3];
      const WIND = [2.3, -0.35, 0.28, -0.16];
      // With the blade pointing down, a negative lean puts the tip to the left.
      const FOLLOW = [-0.75, -0.6, -0.06, -0.36];
      let a = GUARD;
      let b = GUARD;
      let t = 0;
      if (swingU >= 0) {
        swingU += dt / 0.55;
        const u = Math.min(1, swingU);
        if (u < 0.22) { a = GUARD; b = WIND; t = u / 0.22; t = t * (2 - t); }
        else if (u < 0.5) { a = WIND; b = FOLLOW; t = (u - 0.22) / 0.28; t = t * t * (3 - 2 * t); }
        else { a = FOLLOW; b = GUARD; t = (u - 0.5) / 0.5; t = t * t * (3 - 2 * t); }
        if (swingU >= 1) swingU = -1;
      }
      const mix = (i) => a[i] + (b[i] - a[i]) * t;
      swordPose(weapon.quaternion, mix(0), mix(1));
      weapon.position.set(mix(2), mix(3), -0.5);

      // Raise the shield across the front while blocking (right mouse button
      // or Q); it drops back to the lower left when released.
      shieldUp += ((input.block ? 1 : 0) - shieldUp) * (1 - Math.exp(-14 * dt));
      const u = shieldUp;
      shield.position.set(-0.3 + 0.2 * u, -0.36 + 0.24 * u, -0.52 + 0.08 * u);
      shield.rotation.set(-0.6 * (1 - u), 0.55 * (1 - u) + 0.08, 0.15 * (1 - u));
    }

    if (gripMode === 'hand') poseFromHands(dt);
    if (gripMode === 'controller2') poseFromControllers(dt);

    if (!usesSword()) {
      const nock = bow.userData.nock;
      if (!((gripMode === 'hand' || gripMode === 'controller2') && stringHeld)) {
        // Trigger or mouse draw: pull the string a full arm's length back.
        _nockL.set(0, 0, bow.userData.restZ + draw * 0.42);
      }
      // A gloved hand on the string while it is being drawn (your own hand
      // or controller is already there with hand tracking).
      const glove = bow.userData.glove;
      if (glove) {
        glove.visible = gripMode !== 'hand' && draw > 0.02;
        glove.position.copy(_nockL);
      }
      setBowString(bow, _nockL);
      if (nock) nock.visible = reload <= 0;
      if (gripMode === 'screen') {
        // Point the bow down the crosshair: at the locked enemy, or at a
        // point far along the view.
        weapon.position.set(0.1, -0.13, -0.45);
        if (locked?.alive) {
          _aimPoint.set(locked.mesh.position.x, LOCK_Y, locked.mesh.position.z);
          group.localToWorld(_aimPoint);
        } else {
          camera.getWorldPosition(_aimPoint);
          camera.getWorldDirection(_bowAimL);
          _aimPoint.addScaledVector(_bowAimL, 25);
        }
        camera.worldToLocal(_aimPoint);
        _bowAimL.subVectors(_aimPoint, weapon.position).normalize();
        weapon.quaternion.setFromUnitVectors(_negZ, _bowAimL);
      }
    }

    weapon.updateWorldMatrix(true, true);
    const tipLocal = weapon.userData.tip || _swordTip;
    const baseLocal = weapon.userData.base || _swordBase;
    _prevTip.copy(_tip);
    _prevBase.copy(_base);
    weapon.localToWorld(_tip.copy(tipLocal));
    weapon.localToWorld(_base.copy(baseLocal));
    group.worldToLocal(_tip);
    group.worldToLocal(_base);

    let speed = 0;
    const hand = hooks.rightHand?.() || hooks.leftHand?.();
    if (gripMode !== 'screen') {
      // Fling it like a real blade: what matters is how fast the tip moves,
      // so a wrist flick counts as much as a big arm swing.
      sword.localToWorld(_tipW.copy(_swordTip));
      if (haveTipPrev) speed = (_tipW.distanceTo(_prevTipW) / Math.max(dt, 0.001)) * 0.7;
      _prevTipW.copy(_tipW);
      haveTipPrev = true;
    } else if (hand && renderer.xr.isPresenting) {
      hand.getWorldPosition(handNow);
      if (haveHandPrev) speed = handNow.distanceTo(handPrev) / Math.max(dt, 0.001);
      handPrev.copy(handNow);
      haveHandPrev = true;
    }
    // In XR a swing only cuts when the edge leads: the blade tip has to move
    // along the edge direction, not flat-first.
    let edgeLead = 1;
    if (usesSword() && !scripted) {
      _vel.subVectors(_tip, _prevTip);
      const len = _vel.length();
      if (len > 1e-5) {
        sword.getWorldQuaternion(_q1);
        group.getWorldQuaternion(_q2).invert();
        _edge.set(1, 0, 0).applyQuaternion(_q1).applyQuaternion(_q2);
        edgeLead = Math.abs(_vel.dot(_edge)) / len;
      } else {
        edgeLead = 0;
      }
    }
    // On screen the cut is live while the blade travels from wind-up to
    // follow-through.
    const scriptedCut = swingU >= 0.22 && swingU < 0.5;
    if (usesSword() && ((speed > 1.85 && edgeLead > 0.55) || scriptedCut)) hot = 0.12;
    else hot = Math.max(0, hot - dt);
    if (sword.userData.edgeMat) sword.userData.edgeMat.emissiveIntensity = hot > 0 ? 3 : 0.5;

    if (input.slash && usesSword() && swingU < 0) {
      // Start the wind-up; the cut goes live on the downstroke.
      swingU = 0;
      setTimeout(() => { if (active) playWhoosh(); }, 110);
    }
  }

  function setLock(e) {
    if (locked === e) return;
    locked = e;
    lockRing.visible = !!e;
    hooks.lock?.(!!e);
  }

  // Where the bow is aimed, in arena space: the crosshair on a flat screen,
  // the controller's pointing ray, or the bow's own line with hand tracking.
  function bowAimRay(origin, dir) {
    if (gripMode === 'screen') {
      camera.getWorldPosition(origin);
      camera.getWorldDirection(dir);
    } else if (gripMode === 'hand' || gripMode === 'controller2') {
      bow.getWorldPosition(origin);
      dir.copy(_negZ).applyQuaternion(bow.getWorldQuaternion(_q1));
    } else {
      const ctrl = bow.parent || camera;
      ctrl.getWorldPosition(origin);
      dir.copy(_negZ).applyQuaternion(ctrl.getWorldQuaternion(_q1));
    }
    group.worldToLocal(origin);
    group.getWorldQuaternion(_q2).invert();
    dir.applyQuaternion(_q2).normalize();
  }

  // Lock onto the living enemy closest to the aim line (within a few
  // degrees), sticking with the current one until the aim drifts off it.
  function updateLock(dt) {
    if (usesSword() || phase !== 'fight') {
      setLock(null);
      return;
    }
    bowAimRay(_lockOrigin, _lockDir);
    let best = null;
    let bestAng = gripMode === 'screen' ? 0.175 : 0.12;
    for (const e of enemies) {
      if (!e.alive) continue;
      _lockTo.set(e.mesh.position.x, LOCK_Y, e.mesh.position.z).sub(_lockOrigin);
      let ang = _lockDir.angleTo(_lockTo);
      if (e === locked) ang -= 0.06;
      if (ang < bestAng) {
        bestAng = ang;
        best = e;
      }
    }
    setLock(best);
    if (locked) {
      lockRing.position.set(locked.mesh.position.x, LOCK_Y, locked.mesh.position.z);
      lockRing.lookAt(_lockOrigin.x, _lockOrigin.y, _lockOrigin.z);
      const pulse = 1 + Math.sin(phaseT * 9) * 0.08;
      lockRing.scale.setScalar(pulse);
    }
  }

  // Direction for a shot from `origin` (arena space): onto the locked enemy
  // if there is one, otherwise along `fallback`.
  function shotDir(origin, fallback, out) {
    if (locked?.alive) return out.set(locked.mesh.position.x, LOCK_Y, locked.mesh.position.z).sub(origin).normalize();
    return out.copy(fallback).normalize();
  }

  function fireArrow(origin, dir) {
    const arrow = launchArrow(origin, dir, TUNING.playerArrowSpeed * (0.75 + draw * 0.35), { fromPlayer: true });
    if (locked?.alive) arrow.target = locked;
    playArrow();
    draw = 0;
    drawPeak = 0;
    reload = 0.32;
  }

  // Pull the string with a hand or controller at `point` (world space):
  // grabbing it while within `radius` of the string or grip, drawing it back along the
  // bow, and letting go to shoot along the arrow, onto the lock if any.
  // Full draw is a little under a real archer's arm length.
  const FULL_DRAW = 0.45;
  let nearString = false;
  function pullString(point, pulling, radius, dt) {
    bow.localToWorld(_nockW.set(0, 0, bow.userData.restZ));
    bow.localToWorld(_gripW.copy(bow.userData.grip));
    // The hand can catch the string anywhere near it or the bow's grip, and
    // in either order: press then reach, or reach then press.
    const near = Math.min(point.distanceTo(_nockW), point.distanceTo(_gripW) + 0.05) < radius;
    if (near && !nearString && !stringHeld) hooks.haptic?.(0.12);
    nearString = near;
    if (pulling && !stringHeld && near) {
      stringHeld = true;
      drawPeak = 0;
      releaseWait = 0;
      hooks.haptic?.(0.35);
    }
    if (stringHeld && pulling) {
      releaseWait = 0;
      bow.worldToLocal(_nockL.copy(point));
      // The string only travels backward; keep it near the bow's centre line.
      _nockL.x = THREE.MathUtils.clamp(_nockL.x, -0.06, 0.06);
      _nockL.y = THREE.MathUtils.clamp(_nockL.y, -0.08, 0.08);
      _nockL.z = Math.max(bow.userData.restZ, _nockL.z);
      const was = draw;
      draw = THREE.MathUtils.clamp((_nockL.z - bow.userData.restZ) / FULL_DRAW, 0, 1);
      // Remember the deepest point of the pull, so a string that slips
      // forward as the fingers open still looses at full strength.
      if (draw >= drawPeak) {
        drawPeak = draw;
        _peakNock.copy(_nockL);
      }
      if (draw >= 1 && was < 1) hooks.haptic?.(0.5);
    }
    if (stringHeld && !pulling) {
      releaseWait += dt || 0.016;
      if (releaseWait < 0.06) return;
      releaseWait = 0;
      stringHeld = false;
      const power = Math.max(draw, drawPeak);
      if (drawPeak > draw) _nockL.copy(_peakNock);
      drawPeak = 0;
      if (power > 0.15) {
        draw = power;
        // Fly along the drawn arrow: from the nock through the grip.
        bow.localToWorld(_nockW.copy(_nockL));
        bow.localToWorld(_gripW.copy(bow.userData.grip));
        _aim.subVectors(_gripW, _nockW);
        group.getWorldQuaternion(_invQ);
        _aim.applyQuaternion(_invQ.invert());
        _aim.y = THREE.MathUtils.clamp(_aim.y, -0.35 * _aim.length(), 0.35 * _aim.length());
        _aim.normalize();
        const origin = _shotOrigin.copy(_gripW);
        group.worldToLocal(origin);
        fireArrow(origin, shotDir(origin, _aim, _aim));
      }
      draw = 0;
      _nockL.set(0, 0, bow.userData.restZ);
    }
    if (!stringHeld) {
      draw = Math.max(0, draw - dt * 3);
      if (draw <= 0) drawPeak = 0;
    }
  }

  // The string glows gold when the drawing hand can catch it, and brighter
  // while it is held.
  let stringMat = null;
  function glowString() {
    if (!stringMat) {
      stringMat = new THREE.MeshStandardMaterial({ color: 0xd8c39a, emissive: 0xffc860, emissiveIntensity: 0, roughness: 0.5 });
      bow.userData.stringTop.material = stringMat;
      bow.userData.stringBot.material = stringMat;
    }
    stringMat.emissiveIntensity = stringHeld ? 1.6 : nearString ? 0.9 : 0;
  }

  // Two controllers: the bow is held in the right one and the left one
  // pulls the string. Releasing the left grip is what looses the arrow.
  function poseFromControllers(dt) {
    const leftGrip = hooks.rightGrip?.();
    const leftRay = hooks.rightHand?.();
    if (!leftGrip || !leftRay) return;
    leftGrip.getWorldPosition(_gripPos);
    // The bow faces where the left controller points and stands upright,
    // leaning a little with the wrist's roll. (Following the controller's
    // handle tilted it 40-60 degrees forward on Quest controllers.)
    leftRay.getWorldQuaternion(_q2);
    _fwdW.copy(_negZ).applyQuaternion(_q2).normalize();
    _y.set(0, 1, 0).lerp(_upW.set(0, 1, 0).applyQuaternion(_q2), 0.3);
    _y.addScaledVector(_fwdW, -_y.dot(_fwdW));
    if (_y.lengthSq() < 1e-6) _y.set(0, 0, 1).addScaledVector(_fwdW, -_fwdW.z);
    _y.normalize();
    _zW.copy(_fwdW).negate();
    _xW.crossVectors(_y, _zW);
    _basis.makeBasis(_xW, _y, _zW);
    bow.quaternion.setFromRotationMatrix(_basis);
    bow.position.copy(_gripPos);
    bow.visible = true;
    bow.updateMatrixWorld(true);

    const rightGrip = hooks.leftGrip?.();
    const selecting = !!hooks.leftSelecting?.();
    if (rightGrip) {
      rightGrip.getWorldPosition(_pullW);
      pullString(_pullW, selecting, 0.3, dt);
    } else if (stringHeld) {
      pullString(_pullW, false, 0.3, dt);
    }
    glowString();
  }

  // Hand-tracking: put the weapon in the fist, and let the right hand pinch
  // the bow string, pull it back and let go to shoot.
  function poseFromHands(dt) {
    if (usesSword()) {
      const right = trackedHand('right');
      if (right && swordGrip(right, _gripPos, _gripQuat)) {
        sword.position.copy(_gripPos);
        sword.quaternion.copy(_gripQuat);
        sword.visible = true;
      } else {
        sword.visible = false;
        haveTipPrev = false;
      }
      const left = trackedHand('left');
      if (shield.parent && left && wrist(left, _wristL)) {
        // Strapped to the forearm, face toward where the hand points.
        if (bowGrip(left, _gripPos, _gripQuat)) {
          shield.position.copy(_wristL).lerp(_gripPos, 0.4);
          shield.quaternion.copy(_gripQuat);
          shield.visible = true;
        }
      } else if (shield.parent) {
        shield.visible = false;
      }
      return;
    }

    // Bow hand. Tracking blips keep the bow where it was for half a second
    // instead of dropping it.
    const left = trackedHand('left');
    if (left && bowGrip(left, _gripPos, _gripQuat)) {
      bowLostT = 0;
      // Upright with a little cant from the wrist; while drawing, the bow
      // lines up from the drawing hand through the bow hand, so the arrow
      // flies where the two hands point.
      _y.set(0, 1, 0).lerp(_upW.set(0, 1, 0).applyQuaternion(_gripQuat), 0.25);
      if (stringHeld) _fwdW.subVectors(_gripPos, lastPull).normalize();
      else _fwdW.copy(_negZ).applyQuaternion(_gripQuat);
      _y.addScaledVector(_fwdW, -_y.dot(_fwdW));
      if (_y.lengthSq() < 1e-6) _y.set(0, 0, 1);
      _y.normalize();
      _zW.copy(_fwdW).negate();
      _xW.crossVectors(_y, _zW);
      _basis.makeBasis(_xW, _y, _zW);
      _gripQuat.setFromRotationMatrix(_basis);
      // Smooth out tracking jitter; snap when the bow first appears.
      if (!bow.visible) {
        bow.position.copy(_gripPos);
        bow.quaternion.copy(_gripQuat);
      } else {
        bow.position.lerp(_gripPos, 1 - Math.exp(-35 * dt));
        bow.quaternion.slerp(_gripQuat, 1 - Math.exp(-(stringHeld ? 30 : 18) * dt));
      }
      bow.visible = true;
    } else {
      bowLostT += dt;
      if (bowLostT > 0.5) {
        bow.visible = false;
        stringHeld = false;
        return;
      }
    }
    bow.updateMatrixWorld(true);

    // Drawing hand: a pinch or a closed fist holds the string. Thresholds
    // are loose for tracking noise, and letting go only counts once it has
    // lasted 80 ms (or the hand has been lost for 0.35 s), so a flicker
    // never fires the arrow early.
    const right = trackedHand('right');
    let holding = false;
    if (right) {
      const gap = pinch(right, _pinchPt);
      if (gap != null) lastPull.copy(_pinchPt); // where the drawing hand is
      const pinched = gap != null && (pinching ? gap < 0.05 : gap < 0.028);
      pinching = pinched;
      if (pinched) {
        lastPull.copy(_pinchPt);
        holding = true;
      } else if (fist(right, _pinchPt)) {
        lastPull.copy(_pinchPt);
        holding = true;
      }
      handLostT = 0;
    } else {
      handLostT += dt;
    }
    if (holding) letGoT = 0;
    else letGoT += dt;
    const held = holding || (stringHeld && (right ? letGoT < 0.08 : handLostT < 0.35));
    pullString(lastPull, held, 0.18, dt);
    glowString();
  }
  let bowLostT = 0;
  let handLostT = 0;
  let letGoT = 0;
  const lastPull = new THREE.Vector3();

  function refreshLook() {
    const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    cam.getWorldDirection(_look);
    group.getWorldQuaternion(_lookQ);
    _look.applyQuaternion(_lookQ.invert());
    _look.y = 0;
    if (_look.lengthSq() < 1e-4) _look.set(0, 0, -1);
    else _look.normalize();
  }

  function inFront(point, range, minDot) {
    const dx = point.x - _player.x;
    const dy = point.y - _player.y;
    const dz = point.z - _player.z;
    if (Math.hypot(dx, dy, dz) > range) return false;
    const flat = Math.hypot(dx, dz) || 1;
    return (_look.x * dx + _look.z * dz) / flat > minDot;
  }

  function update(dt, input) {
    if (!active) return;
    const nowPresenting = renderer.xr.isPresenting;
    if (nowPresenting !== presented) {
      presented = nowPresenting;
      anchor();
      attachWeapons();
      applyArenaMode();
    }
    phaseT += dt;
    war.update(dt);
    sparks.update(dt);
    if (hurtFlash > 0) hurtFlash -= dt;

    if (phase === 'intro') {
      if (phaseT < 0.28) hooks.fade?.(1, '#07060a');
      else if (phaseT < 0.7) hooks.fade?.(Math.max(0, 1 - (phaseT - 0.28) / 0.4), '#07060a');
      else hooks.fade?.(0, '#000');
      if (phaseT > 0.85 && phaseT < 1.15) hooks.caption?.('Ready');
      if (phaseT >= 1.15 && phaseT < 1.4) hooks.caption?.('Fight');
      if (phaseT >= 1.4) {
        phase = 'fight';
        phaseT = 0;
        vulnerable = true;
        hooks.caption?.('');
        if (mode === 'sword-melee' || mode === 'bow-melee') {
          spawnSwordsman();
        }
      }
      hud();
      updateWeaponPose(dt, { slash: false });
      return;
    }

    if (phase === 'result') {
      let falling = false;
      for (const e of enemies) {
        if (!e.dying) continue;
        e.dying += dt;
        e.mesh.rotation.x = -Math.min(1.4, Math.max(0, e.dying - 0.12) * 2.6);
        e.mesh.userData.rig?.drive(dt, { action: 'die', t: e.dying });
        if (e.dying < 1.1) falling = true;
      }
      if (phaseT > 1.15 && !falling) {
        const win = resultWin;
        teardown();
        resolveFn?.(win);
        resolveFn = null;
      }
      return;
    }

    playerLocal();
    refreshLook();
    _chest.set(_player.x, _player.y - 0.35, _player.z);
    if (wantedGripMode() !== gripMode) attachWeapons();
    updateWeaponPose(dt, input);

    updateLock(dt);

    if (!usesSword() && gripMode !== 'hand') {
      const loose = () => {
        const nock = bow.userData.nock;
        const origin = _shotOrigin;
        if (nock) nock.getWorldPosition(origin);
        else bow.getWorldPosition(origin);
        group.worldToLocal(origin);
        if (gripMode === 'screen') {
          // Toward whatever sits under the crosshair, far down the view.
          camera.getWorldPosition(_aimPoint);
          camera.getWorldDirection(_aim);
          _aimPoint.addScaledVector(_aim, 25);
          group.worldToLocal(_aimPoint);
          _aim.subVectors(_aimPoint, origin);
        } else {
          bowAimRay(_lockOrigin, _aim);
          _aim.y = 0;
          if (_aim.lengthSq() < 1e-6) _aim.set(0, 0, -1);
        }
        fireArrow(origin, shotDir(origin, _aim.normalize(), _aim));
        autoDraw = false;
      };
      if (gripMode === 'screen') {
        // Hold to pull the arrow and string back yourself; let go to loose.
        // A quick click finishes the pull on its own and shoots.
        if (input.primaryPressed && reload <= 0 && !autoDraw) mousePull = true;
        if (mousePull) {
          if (input.primaryDown) {
            draw = Math.min(1, draw + dt / 0.7);
          } else {
            mousePull = false;
            if (draw >= 0.6) loose();
            else autoDraw = true;
          }
        }
        if (autoDraw) {
          draw = Math.min(1, draw + dt / 0.25);
          if (draw >= 1) loose();
        }
        if (!mousePull && !autoDraw) draw = Math.max(0, draw - dt * 3);
      } else if (gripMode === 'controller') {
        if (input.primaryDown) {
          draw = Math.min(1, draw + dt / 0.5);
          drawPeak = Math.max(drawPeak, draw);
        }
        if (input.primaryReleased) {
          const power = Math.max(draw, drawPeak);
          drawPeak = 0;
          if (power > 0.2) {
            draw = power;
            loose();
          } else draw = 0;
        } else if (!input.primaryDown) {
          draw = Math.max(0, draw - dt * 3);
          if (draw <= 0) drawPeak = 0;
        }
      }
    }
    if (!usesSword()) reload = Math.max(0, reload - dt);

    const melee = mode === 'sword-melee' || mode === 'bow-melee';
    if (melee) {
      // The first swordsman charges; the second appears 0.2 s behind him so
      // they come at the player together, and the rest keep coming
      // (1.8 s shrinking to 1.2 s), at most three on the field, and straight
      // away whenever the field is empty.
      spawnT += dt;
      const alive = enemies.filter((e) => e.alive && e.kind === 'sword').length;
      const gap = spawned <= 1 ? 0.2 : Math.max(1.2, 1.8 - (spawned - 2) * 0.15);
      if (spawned < quota && alive < 3 && (spawnT > gap || (alive === 0 && spawnT > 0.5))) {
        spawnSwordsman();
        spawnT = 0;
      }
    }

    for (const e of enemies) {
      if (e.dying) {
        e.dying += dt;
        // Knees buckle first, then the body topples back.
        e.mesh.rotation.x = -Math.min(1.4, Math.max(0, e.dying - 0.12) * 2.6);
        e.mesh.userData.rig?.drive(dt, { action: 'die', t: e.dying });
        if (e.dying > 0.8) {
          group.remove(e.mesh);
          e.dying = 0;
          e.mesh.visible = false;
        }
        continue;
      }
      if (!e.alive) continue;
      const rig = e.mesh.userData.rig;
      _dir.set(_player.x - e.mesh.position.x, 0, _player.z - e.mesh.position.z);
      const dist = Math.hypot(_dir.x, _dir.z) || 0.0001;
      const yaw = Math.atan2(_dir.x, _dir.z);
      const turn = Math.atan2(Math.sin(yaw - e.mesh.rotation.y), Math.cos(yaw - e.mesh.rotation.y));
      e.mesh.rotation.y += turn * (1 - Math.exp(-10 * dt));

      if (e.kind === 'sword') {
        const speed = e.speed || TUNING.meleeSpeed;
        if (dist > 1.2) {
          const step = speed * dt;
          e.mesh.position.x += (_dir.x / dist) * step;
          e.mesh.position.z += (_dir.z / dist) * step;
          if (dist < SWING_FROM) {
            // Charging in already swinging: cuts start well before he
            // reaches the player, and land only once he is within reach.
            e.windup += dt;
            rig?.drive(dt, { action: 'charge', t: e.windup, variant: e.swing, speed, look: _camPos });
            swingWhoosh(e, dist);
            if (e.windup > 0.62) {
              if (dist <= SWORD_REACH) landBlow(e, dist);
              else {
                e.windup = -0.2;
                e.swing += 1;
              }
            }
          } else {
            rig?.drive(dt, { action: 'run', speed, look: _camPos });
            e.windup = 0;
          }
        } else {
          e.windup += dt;
          rig?.drive(dt, { action: 'strike', t: e.windup, variant: e.swing, look: _camPos });
          swingWhoosh(e, dist);
          if (e.windup > 0.62) landBlow(e, dist);
        }
        if (hot > 0 && usesSword()) {
          const chest = _local.set(e.mesh.position.x, 1.25, e.mesh.position.z);
          if (scripted) {
            // Flat screen: the mouse cannot place the blade, so any swordsman
            // close in front is cut.
            const d0 = distPointSeg(chest, _base, _tip);
            const d1 = distPointSeg(chest, _prevBase, _prevTip);
            const blade = (d0 < 0.75 || d1 < 0.75) && _player.distanceTo(chest) < TUNING.swordRange;
            if (blade || inFront(chest, 2.15, 0.2)) killEnemy(e, chest);
          } else {
            // XR: the edge has to pass through the body, between hips and head.
            for (const y of [0.85, 1.2, 1.55]) {
              _body.set(e.mesh.position.x, y, e.mesh.position.z);
              const d = Math.min(distPointSeg(_body, _base, _tip), distPointSeg(_body, _prevBase, _prevTip));
              if (d < 0.5) {
                killEnemy(e, _body.clone());
                break;
              }
            }
          }
        }
      } else {
        group.localToWorld(_aimWorld.copy(_chest));
        const draw = e.cooldown < 0.7 ? 1 - Math.max(0, e.cooldown) / 0.7 : 0;
        e.sinceShot += dt;
        rig?.drive(dt, { action: 'archer', draw, sinceShot: e.sinceShot, aim: _aimWorld });
        e.cooldown -= dt;
        if (e.cooldown <= 0 && vulnerable) {
          const origin = _local;
          if (rig?.muzzle) group.worldToLocal(rig.muzzle.getWorldPosition(origin));
          else origin.set(e.mesh.position.x, 1.35, e.mesh.position.z);
          _aim.set(_chest.x - origin.x, _chest.y - origin.y, _chest.z - origin.z);
          _aim.x += (Math.random() - 0.5) * 0.25;
          _aim.normalize();
          const arrow = launchArrow(origin, _aim, TUNING.enemyArrowSpeed, { owner: e });
          arrow.owner = e;
          e.cooldown = TUNING.archerInterval * (0.85 + Math.random() * 0.3);
          e.sinceShot = 0;
          playArrow();
        }
      }
    }

    for (let i = arrows.length - 1; i >= 0; i--) {
      const arrow = arrows[i];
      if (!arrow.alive) {
        group.remove(arrow.mesh);
        arrows.splice(i, 1);
        continue;
      }
      arrow.age += dt;
      if (arrow.fromPlayer && arrow.target?.alive) {
        // Curve gently onto the locked enemy.
        _home.set(arrow.target.mesh.position.x, LOCK_Y, arrow.target.mesh.position.z).sub(arrow.mesh.position);
        const speed = arrow.vel.length();
        _home.normalize().multiplyScalar(speed);
        arrow.vel.lerp(_home, 1 - Math.exp(-10 * dt)).setLength(speed);
      }
      arrow.mesh.position.addScaledVector(arrow.vel, dt);
      _dir.copy(arrow.vel).normalize();
      arrow.mesh.quaternion.setFromUnitVectors(_forward, _dir);

      if (arrow.fromPlayer) {
        for (const e of enemies) {
          if (!e.alive) continue;
          const hitR = e.kind === 'archer' ? 1.05 : 1.2;
          _local.set(e.mesh.position.x, 1.15, e.mesh.position.z);
          const d = distPointSeg(_local, arrow.prev, arrow.mesh.position);
          if (d < hitR) {
            killEnemy(e, arrow.mesh.position.clone());
            arrow.alive = false;
          }
        }
        if (arrow.alive) {
          for (const other of arrows) {
            if (other === arrow || !other.alive || other.fromPlayer || other.reflected) continue;
            if (arrow.mesh.position.distanceTo(other.mesh.position) < 0.42) {
              other.alive = false;
              arrow.alive = false;
              sparks.burst(arrow.mesh.position, 0xfff6d2, 8, 3);
              playDeflect();
            }
          }
        }
      } else if (arrow.reflected) {
        for (const e of enemies) {
          if (!e.alive || e.kind !== 'archer') continue;
          if (arrow.mesh.position.distanceTo(_local.set(e.mesh.position.x, 1.25, e.mesh.position.z)) < 0.7) {
            killEnemy(e, arrow.mesh.position.clone());
            arrow.alive = false;
          }
        }
      } else if (hot > 0 && usesSword()) {
        const d0 = distPointSeg(arrow.mesh.position, _base, _tip);
        const d1 = distPointSeg(arrow.mesh.position, _prevBase, _prevTip);
        const close = arrow.mesh.position.distanceTo(_chest) < 1.5;
        if (d0 < 0.7 || d1 < 0.7 || (scripted && close && inFront(arrow.mesh.position, 1.6, 0.05))) {
          reflectArrow(arrow, arrow.owner);
        }
      }

      if (arrow.alive && !arrow.fromPlayer && !arrow.reflected && arrow.age > 0.12 && shieldStops(arrow)) {
        arrow.alive = false;
        blockHit(arrow.mesh.position.x, arrow.mesh.position.y, arrow.mesh.position.z);
      }
      if (arrow.alive && !arrow.fromPlayer && !arrow.reflected && arrow.age > 0.12) {
        if (arrow.mesh.position.distanceTo(_chest) < 0.38) {
          arrow.alive = false;
          sparks.burst(_chest, 0xff6a55, 8, 2);
          damagePlayer();
        }
      }

      if (arrow.age > 4 || arrow.mesh.position.length() > 30) arrow.alive = false;
      if (arrow.prev) arrow.prev.copy(arrow.mesh.position);
    }

    const end = checkEnd();
    if (end) finish(end === 'win');
    hud();
  }

  function start(cfg) {
    begin(cfg);
    return new Promise((resolve) => {
      resolveFn = resolve;
    });
  }

  function abort() {
    if (!active) return;
    teardown();
    resolveFn?.('abort');
    resolveFn = null;
  }

  function force(win) {
    if (!active) return;
    if (phase === 'intro') {
      phase = 'fight';
      vulnerable = true;
    }
    finish(win);
    phaseT = 10;
  }

  return {
    group,
    start,
    abort,
    update,
    force,
    isActive: () => active,
    setQuality(q) {
      quality = q;
      applyArenaMode();
    },
  };
}

function buildArena(group) {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(16, 40),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(6.2, 6.45, 40),
    new THREE.MeshStandardMaterial({ color: 0x6a5438, roughness: 0.6, metalness: 0.2 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(22, 28, 16),
    new THREE.MeshBasicMaterial({ color: 0x140e0c, side: THREE.BackSide }),
  );
  group.add(sky);
  const backdrop = [ground, ring, sky];

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xf6f1e4 }),
  );
  moon.position.set(-5, 8.5, -9);
  group.add(moon);
  backdrop.push(moon);

  // Warm, smoky daylight: a low sun (matching the sky) and a dusty fill.
  const hemi = new THREE.HemisphereLight(0xd0a57c, 0x3a2a1c, 1.15);
  group.add(hemi);
  const moonLight = new THREE.DirectionalLight(0xffb878, 2.4);
  moonLight.position.set(-4.5, 3.6, -8.6);
  // A low sun throws long shadows from the attackers toward the player.
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(1024, 1024);
  const sc = moonLight.shadow.camera;
  sc.left = -7;
  sc.right = 7;
  sc.top = 5;
  sc.bottom = -5;
  sc.near = 1;
  sc.far = 24;
  moonLight.shadow.bias = -0.0008;
  moonLight.shadow.normalBias = 0.03;
  moonLight.target.position.set(0, 0, -2);
  group.add(moonLight, moonLight.target);

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const x = Math.sin(a) * 5.4;
    const z = -Math.cos(a) * 5.4;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.07, 1.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.8 }),
    );
    pole.position.set(x, 0.75, z);
    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff8a3c }),
    );
    flame.position.set(x, 1.55, z);
    group.add(pole, flame);
  }

  for (let i = 0; i < 6; i++) {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.25 + (i % 3) * 0.12, 0),
      new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.9 }),
    );
    const a = i * 1.3;
    rock.position.set(Math.sin(a) * (3 + (i % 3)), 0.18, -2.2 - (i % 4));
    rock.rotation.set(i, i * 0.4, 0);
    group.add(rock);
    backdrop.push(rock);
  }
  // A soft warm fill from behind the player so the attackers' armour and
  // faces read against the low sun (no shadows; cheap).
  const fill = new THREE.DirectionalLight(0xffd2a6, 0.85);
  fill.position.set(2.5, 3, 6);
  group.add(fill);
  backdrop.sun = moonLight;
  return backdrop;
}

function createSparks(parent) {
  const geo = new THREE.SphereGeometry(0.045, 4, 3);
  const items = [];
  return {
    burst(pos, color, n, speed) {
      for (let i = 0; i < n; i++) {
        let s = items.find((item) => !item.alive);
        if (!s) {
          const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
          parent.add(mesh);
          s = { mesh, vel: new THREE.Vector3(), life: 0, alive: false };
          items.push(s);
        }
        s.mesh.material.color.set(color);
        s.mesh.position.copy(pos);
        s.vel.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(speed);
        s.life = 0.22 + Math.random() * 0.18;
        s.alive = true;
        s.mesh.visible = true;
      }
    },
    update(dt) {
      for (const s of items) {
        if (!s.alive) continue;
        s.life -= dt;
        s.vel.y -= 6 * dt;
        s.mesh.position.addScaledVector(s.vel, dt);
        const k = Math.max(0.05, s.life * 3);
        s.mesh.scale.setScalar(k);
        if (s.life <= 0) {
          s.alive = false;
          s.mesh.visible = false;
        }
      }
    },
  };
}
