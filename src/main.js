import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import {
  advanceTurn,
  createGame,
  inBounds,
  options,
  SIDE_NAME,
  TYPE_NAME,
} from './rules.js';
import { createTabletop, SQ, squareLocal } from './tabletop.js';
import { createCombat, INLINE_ARENA } from './combat.js';
import {
  isMuted,
  playCapture,
  playDefeat,
  playFanfare,
  playMove,
  playTick,
  resumeAudio,
  setMusicTension,
  startMusic,
  toggleMute,
} from './audio.js';

const $ = (id) => document.getElementById(id);
const titleEl = $('title');
const topbar = $('topbar');
const turnEl = $('turn');
const hintEl = $('hint');
const combatHud = $('combat-hud');
const heartsEl = $('hearts');
const objectiveEl = $('objective');
const meter = $('meter');
const meterBar = $('meter-bar');
const toastEl = $('toast');
const gameoverEl = $('gameover');
const goTitle = $('go-title');
const goSub = $('go-sub');
const placeHint = $('place-hint');
const fadeEl = $('fade');
const fadeText = $('fade-text');
const hurtEl = $('hurt');
const crosshair = $('crosshair');
const corner = $('corner');
const btnAr = $('btn-ar');
const btnVr = $('btn-vr');
const btnPlay = $('btn-play');
const btnAgain = $('btn-again');
const btnSound = $('btn-sound');
const btnYield = $('btn-yield');
const btnMove = $('btn-move');
const btnArMini = $('btn-ar-mini');
const btnVrMini = $('btn-vr-mini');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setClearColor(0x100e0c, 1);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x100e0c);

try {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
} catch (err) {
  console.warn('Environment map skipped', err);
}

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.05, 80);
camera.position.set(0, 1.22, 0.62);
scene.add(camera);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.04, 0);
controls.enableDamping = true;
controls.enablePan = false;
controls.maxPolarAngle = Math.PI / 2.2;
controls.minDistance = 0.28;
controls.maxDistance = 1.7;
controls.update();

scene.add(new THREE.HemisphereLight(0xfff1dc, 0x2a2218, 0.9));
const key = new THREE.DirectionalLight(0xfff4e0, 1.55);
key.position.set(0.7, 1.6, 0.8);
scene.add(key);
const rim = new THREE.DirectionalLight(0x9eb0ff, 0.35);
rim.position.set(-0.8, 0.6, -0.5);
scene.add(rim);

const tabletop = createTabletop(scene);
const { board, diorama, room, pickables } = tabletop;

const fadeMat = new THREE.MeshBasicMaterial({
  color: 0x07060a,
  transparent: true,
  opacity: 0,
  side: THREE.BackSide,
  depthTest: false,
  depthWrite: false,
});
const fadeSphere = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), fadeMat);
fadeSphere.renderOrder = 9999;
fadeSphere.frustumCulled = false;
fadeSphere.visible = false;
scene.add(fadeSphere);

const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.055, 0.072, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xe6c27a, side: THREE.DoubleSide }),
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const savedPos = new THREE.Vector3();
const savedQuat = new THREE.Quaternion();
const savedTarget = new THREE.Vector3();
let savedFov = camera.fov;
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _scale = new THREE.Vector3();

let game = createGame();
let menu = true;
let placing = false;
let xrKind = null;
let epoch = 0;
let pending = null;
let combatView = false;
let yaw = 0;
let pitch = 0;
let toastTimer = 0;
let hurtTimer = 0;
let hitTestSource = null;
let hitTestRequested = false;
let musicOn = false;
const keys = {};
const input = {
  primaryDown: false,
  primaryPressed: false,
  primaryReleased: false,
  slash: false,
};
let ptr = null;
let mouseMag = 0;
let dragSpeed = 0;

const controllers = [];
const POINTER_DROP = THREE.MathUtils.degToRad(-20);
const _aimOrigin = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _aimQuat = new THREE.Quaternion();
const _dropQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), POINTER_DROP);
if (navigator.xr) renderer.xr.enabled = true;

function setRayFromController(controller) {
  controller.updateWorldMatrix(true, false);
  controller.getWorldPosition(_aimOrigin);
  controller.getWorldQuaternion(_aimQuat);
  _aimDir.set(0, 0, -1).applyQuaternion(_dropQuat).applyQuaternion(_aimQuat).normalize();
  raycaster.set(_aimOrigin, _aimDir);
}

for (let i = 0; i < 2; i++) {
  const controller = renderer.xr.getController(i);
  controller.addEventListener('connected', (event) => {
    controller.userData.connected = true;
    controller.userData.handedness = event.data.handedness;
    controller.userData.inputSource = event.data;
    if (!controller.getObjectByName('laser')) {
      const mount = new THREE.Group();
      mount.name = 'laser';
      mount.rotation.x = POINTER_DROP;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0, -1),
        ]),
        new THREE.LineBasicMaterial({ color: 0xe6c27a }),
      );
      line.scale.z = 0.5;
      mount.add(line);
      controller.add(mount);
    }
  });
  controller.addEventListener('disconnected', () => {
    controller.userData.connected = false;
  });
  controller.addEventListener('selectstart', () => {
    input.primaryDown = true;
    input.primaryPressed = true;
  });
  controller.addEventListener('selectend', () => {
    input.primaryDown = false;
    input.primaryReleased = true;
  });
  controller.addEventListener('select', () => {
    if (game.phase !== 'combat') onXRSelect(controller);
  });
  scene.add(controller);
  controllers.push(controller);
}

const hands = [];
const handModels = [];
const handFactory = new XRHandModelFactory();
const _indexTip = new THREE.Vector3();
const _thumbTip = new THREE.Vector3();
const _pinch = new THREE.Vector3();
const _piecePos = new THREE.Vector3();
const _holdPoint = new THREE.Vector3();
let heldPiece = null;

for (let i = 0; i < 2; i++) {
  const hand = renderer.xr.getHand(i);
  hand.userData.pinching = false;
  hand.addEventListener('connected', (event) => {
    hand.userData.inputSource = event.data;
  });
  const model = handFactory.createHandModel(hand, 'spheres');
  hand.add(model);
  scene.add(hand);
  hands.push(hand);
  handModels.push(model);
}

const combat = createCombat({
  scene,
  camera,
  renderer,
  hooks: {
    onView: onCombatView,
    caption: setCaption,
    fade: setFade,
    hud: onCombatHud,
    hurt: flashHurt,
    haptic,
    rightHand: () => findHand('right'),
    leftHand: () => findHand('left'),
  },
});

tabletop.refresh(game);
updateHUD();
detectXR();

function findHand(which) {
  let fallback = null;
  for (const controller of controllers) {
    if (!controller.userData.connected) continue;
    if (controller.userData.handedness === which) return controller;
    fallback = controller;
  }
  return which === 'right' ? fallback : null;
}

function haptic(strength) {
  for (const controller of controllers) {
    const gamepad = controller.userData.inputSource?.gamepad;
    const actuator = gamepad?.hapticActuators?.[0] || gamepad?.vibrationActuator;
    if (!actuator) continue;
    if (actuator.pulse) actuator.pulse(strength, 36);
    else actuator.playEffect?.('dual-rumble', { duration: 36, strongMagnitude: strength, weakMagnitude: strength });
  }
}

function unlockAudio() {
  resumeAudio();
  if (!musicOn) {
    startMusic();
    musicOn = true;
  }
}

function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2200);
}

function setCaption(text) {
  fadeText.textContent = text || '';
}

function setFade(opacity, color) {
  const value = Math.max(0, Math.min(1, opacity));
  fadeEl.style.opacity = String(value);
  fadeMat.opacity = value;
  fadeMat.color.set(color || '#07060a');
  fadeSphere.visible = value > 0.02;
}

function flashHurt() {
  hurtEl.style.opacity = '1';
  clearTimeout(hurtTimer);
  hurtTimer = setTimeout(() => {
    hurtEl.style.opacity = '0';
  }, 220);
}

function onCombatHud(info) {
  if (!info) {
    combatHud.classList.add('hidden');
    crosshair.classList.add('hidden');
    return;
  }
  combatHud.classList.remove('hidden');
  const hearts = Math.max(0, info.hearts);
  heartsEl.textContent = `${'♥'.repeat(hearts)}${'♡'.repeat(Math.max(0, info.max - hearts))}`;
  objectiveEl.textContent = info.objective || '';
  meter.classList.toggle('hidden', !info.showMeter);
  meterBar.style.width = `${Math.round((info.draw || 0) * 100)}%`;
  crosshair.classList.toggle('hidden', renderer.xr.isPresenting || game.phase !== 'combat');
}

function onCombatView(enter) {
  if (enter === combatView) return;
  combatView = enter;
  if (enter) {
    savedPos.copy(camera.position);
    savedQuat.copy(camera.quaternion);
    savedTarget.copy(controls.target);
    savedFov = camera.fov;
    controls.enabled = false;
    scene.fog = new THREE.Fog(0x120e0c, 7, 21);
    if (!renderer.xr.isPresenting) {
      camera.fov = 72;
      camera.updateProjectionMatrix();
      camera.position.set(INLINE_ARENA.x, INLINE_ARENA.y + INLINE_ARENA.eye, INLINE_ARENA.z);
      yaw = 0;
      pitch = 0;
      camera.rotation.order = 'YXZ';
      camera.rotation.set(pitch, yaw, 0);
    }
    setMusicTension(true);
  } else {
    scene.fog = null;
    setMusicTension(false);
    if (document.pointerLockElement) document.exitPointerLock();
    if (!renderer.xr.isPresenting) {
      camera.fov = savedFov;
      camera.updateProjectionMatrix();
      camera.position.copy(savedPos);
      camera.quaternion.copy(savedQuat);
      controls.target.copy(savedTarget);
      controls.enabled = !menu;
      controls.update();
    }
  }
  applyScenery();
  updateHUD();
}

function applyScenery() {
  if (combatView) {
    board.visible = false;
    diorama.visible = false;
    room.visible = false;
    return;
  }
  if (xrKind === 'ar') {
    diorama.visible = false;
    room.visible = false;
    board.visible = !placing;
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
  } else if (xrKind === 'vr') {
    diorama.visible = false;
    room.visible = true;
    board.visible = true;
    scene.background = new THREE.Color(0x100e0c);
    renderer.setClearColor(0x100e0c, 1);
  } else {
    diorama.visible = true;
    room.visible = false;
    board.visible = true;
    scene.background = new THREE.Color(0x100e0c);
    renderer.setClearColor(0x100e0c, 1);
  }
}

function updateHUD() {
  const fighting = game.phase === 'combat';
  titleEl.classList.toggle('hidden', !menu);
  topbar.classList.toggle('hidden', menu || fighting);
  corner.classList.toggle('hidden', menu);
  placeHint.classList.toggle('hidden', !(placing && xrKind === 'ar'));
  btnMove.classList.toggle('hidden', !(xrKind === 'ar' && !placing && !fighting));
  btnArMini.classList.toggle('hidden', xrKind === 'ar');
  btnVrMini.classList.toggle('hidden', xrKind === 'vr');
  turnEl.textContent = game.phase === 'over'
    ? (game.draw ? 'Stalemate' : `${SIDE_NAME[game.winner]} wins`)
    : `${SIDE_NAME[game.turn]}'s turn`;
  turnEl.classList.toggle('gold', game.turn === 0);
  turnEl.classList.toggle('violet', game.turn === 1);
  if (placing) hintEl.textContent = 'Point at a table, then tap to place the court.';
  else if (!game.selected) {
    hintEl.textContent = xrKind === 'ar'
      ? 'Aim at your piece and tap.'
      : xrKind === 'vr'
        ? 'Pinch a piece between thumb and finger, or point and pull the trigger.'
        : 'Click one of your pieces.';
  } else hintEl.textContent = 'Green moves. Red strikes. The monarch only steps.';
  btnSound.textContent = isMuted() ? 'Sound off' : 'Sound on';
}

function showGameOver() {
  goTitle.textContent = game.draw ? 'The court is locked' : 'The monarch is captured';
  goSub.textContent = game.draw
    ? 'Neither side can move.'
    : `${SIDE_NAME[game.winner]} takes the court.`;
  gameoverEl.classList.remove('hidden');
  updateHUD();
}

function hideGameOver() {
  gameoverEl.classList.add('hidden');
}

function settle(info) {
  if (info?.skipped != null && !info.draw) toast(`${SIDE_NAME[info.skipped]} has no move`);
  tabletop.refresh(game);
  updateHUD();
  if (game.phase === 'over') showGameOver();
}

function doMove(r, c) {
  const from = game.selected;
  const piece = game.board[from.r][from.c];
  game.board[r][c] = piece;
  game.board[from.r][from.c] = null;
  playMove();
  settle(advanceTurn(game));
}

function finishCombat(win) {
  const { from, to } = pending || {};
  const attacker = from && game.board[from.r][from.c];
  if (win && attacker) {
    game.board[to.r][to.c] = attacker;
    game.board[from.r][from.c] = null;
    playCapture();
    toast(`${SIDE_NAME[attacker.side]} ${TYPE_NAME[attacker.type]} takes the square`);
  } else if (attacker) {
    const name = `${SIDE_NAME[attacker.side]} ${TYPE_NAME[attacker.type]}`;
    game.board[from.r][from.c] = null;
    playDefeat();
    toast(`${name} falls`);
  }
  game.phase = 'play';
  pending = null;
  settle(advanceTurn(game));
}

function doAttack(r, c) {
  const from = game.selected;
  const attacker = game.board[from.r][from.c];
  const defender = game.board[r][c];
  if (defender.type === 'X') {
    game.board[r][c] = attacker;
    game.board[from.r][from.c] = null;
    game.selected = null;
    game.phase = 'over';
    game.winner = attacker.side;
    game.draw = false;
    playFanfare();
    tabletop.refresh(game);
    showGameOver();
    return;
  }
  const token = ++epoch;
  pending = { from: { r: from.r, c: from.c }, to: { r, c } };
  game.selected = null;
  game.phase = 'combat';
  tabletop.refresh(game);
  updateHUD();
  combat.start({
    attackerType: attacker.type,
    defenderType: defender.type,
    attackerSide: attacker.side,
  }).then((result) => {
    if (token !== epoch || result === 'abort') return;
    finishCombat(result === true);
  });
}

function handlePick(data) {
  if (menu || placing) return;
  if (game.phase === 'over') {
    if (data?.action === 'again') restart();
    return;
  }
  if (game.phase !== 'play') return;
  if (!data || data.action) {
    game.selected = null;
    tabletop.refresh(game);
    updateHUD();
    return;
  }
  if (data.id && data.side === game.turn) {
    if (game.selected && game.selected.r === data.r && game.selected.c === data.c) game.selected = null;
    else {
      game.selected = { r: data.r, c: data.c };
      playTick();
    }
    tabletop.refresh(game);
    updateHUD();
    return;
  }
  if (!game.selected || data.r == null) {
    game.selected = null;
    tabletop.refresh(game);
    updateHUD();
    return;
  }
  const opt = options(game, game.selected.r, game.selected.c);
  if (opt.moves.some((m) => m.r === data.r && m.c === data.c)) doMove(data.r, data.c);
  else if (opt.attacks.some((m) => m.r === data.r && m.c === data.c)) doAttack(data.r, data.c);
}

function findData(object) {
  let node = object;
  while (node) {
    const data = node.userData;
    if (data && (data.id || data.marker || data.action)) return data;
    node = node.parent;
  }
  return null;
}

function pickWithRay() {
  const hits = raycaster.intersectObjects(pickables, true);
  const found = [];
  for (const hit of hits) {
    const data = findData(hit.object);
    if (!data) continue;
    const dup = found.some((item) => (
      (item.id && item.id === data.id)
      || (item.marker && data.marker && item.r === data.r && item.c === data.c)
      || (item.action && data.action)
    ));
    if (!dup) found.push(data);
  }
  if (!found.length) return null;
  if (game.selected) {
    const behind = found.filter((item) => !(
      item.id && item.r === game.selected.r && item.c === game.selected.c
    ));
    const marker = behind.find((item) => item.marker);
    if (marker) return marker;
    const enemy = behind.find((item) => item.id && item.side !== game.turn);
    if (enemy) return enemy;
  }
  return found[0];
}

function pickAt(x, y) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((x - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((y - rect.top) / rect.height) * 2 + 1;
  scene.updateMatrixWorld(true);
  raycaster.setFromCamera(ndc, camera);
  handlePick(pickWithRay());
}

function onXRSelect(controller) {
  if (placing) {
    placeBoard();
    return;
  }
  setRayFromController(controller);
  handlePick(pickWithRay());
}

function placeBoard() {
  if (reticle.visible) {
    reticle.matrix.decompose(board.position, board.quaternion, _scale);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(board.quaternion);
    board.position.addScaledVector(up, 0.004);
  } else {
    const camObj = renderer.xr.getCamera();
    camObj.getWorldPosition(_cam);
    camObj.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    board.position.copy(_cam).addScaledVector(_fwd, 0.75);
    board.position.y -= 0.35;
    const face = Math.atan2(-_fwd.x, -_fwd.z);
    board.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), face);
  }
  placing = false;
  menu = false;
  applyScenery();
  updateHUD();
  toast('The court is set.');
}

function beginPlacement() {
  placing = true;
  menu = false;
  board.visible = false;
  applyScenery();
  updateHUD();
}

async function enterXR(kind) {
  unlockAudio();
  if (!navigator.xr) {
    toast('This browser has no WebXR.');
    return;
  }
  const mode = kind === 'ar' ? 'immersive-ar' : 'immersive-vr';
  const supported = await navigator.xr.isSessionSupported(mode).catch(() => false);
  if (!supported) {
    toast(kind === 'ar' ? 'AR is not available on this device.' : 'VR is not available on this device.');
    return;
  }
  const current = renderer.xr.getSession();
  if (current) await current.end();
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType(kind === 'vr' ? 'local-floor' : 'local');
  const init = kind === 'ar'
    ? {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor', 'hand-tracking'],
      domOverlay: { root: document.getElementById('overlay') },
    }
    : { optionalFeatures: ['local-floor', 'hand-tracking'] };
  try {
    const session = await navigator.xr.requestSession(mode, init);
    xrKind = kind;
    hitTestSource = null;
    hitTestRequested = false;
    session.addEventListener('end', onSessionEnd);
    await renderer.xr.setSession(session);
    if (kind === 'vr') {
      placing = false;
      menu = false;
      board.position.set(0, 0.96, -0.85);
      board.quaternion.identity();
    } else {
      beginPlacement();
    }
    applyScenery();
    updateHUD();
  } catch (err) {
    console.warn(err);
    toast('The XR session was blocked.');
    xrKind = null;
    applyScenery();
  }
}

function onSessionEnd() {
  releaseHeld(false);
  const wasFighting = combatView;
  xrKind = null;
  placing = false;
  hitTestSource = null;
  hitTestRequested = false;
  if (!wasFighting) {
    board.position.set(0, 0, 0);
    board.quaternion.identity();
  } else {
    camera.position.set(INLINE_ARENA.x, INLINE_ARENA.y + INLINE_ARENA.eye, INLINE_ARENA.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(0, 0, 0);
    yaw = 0;
    pitch = 0;
  }
  applyScenery();
  updateHUD();
}

function restart() {
  releaseHeld(false);
  epoch += 1;
  combat.abort();
  game = createGame();
  pending = null;
  hideGameOver();
  tabletop.refresh(game);
  updateHUD();
  toast('The court is set.');
}

function movePlayer(dt) {
  if (!combatView || renderer.xr.isPresenting) return;
  const speed = 2.5 * dt;
  _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _fwd.y = 0;
  if (_fwd.lengthSq() > 1e-6) _fwd.normalize();
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _right.y = 0;
  if (_right.lengthSq() > 1e-6) _right.normalize();
  if (keys.KeyW || keys.ArrowUp) camera.position.addScaledVector(_fwd, speed);
  if (keys.KeyS || keys.ArrowDown) camera.position.addScaledVector(_fwd, -speed);
  if (keys.KeyD || keys.ArrowRight) camera.position.addScaledVector(_right, speed);
  if (keys.KeyA || keys.ArrowLeft) camera.position.addScaledVector(_right, -speed);
  const dx = camera.position.x - INLINE_ARENA.x;
  const dz = camera.position.z - INLINE_ARENA.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 2.1) {
    camera.position.x = INLINE_ARENA.x + (dx / dist) * 2.1;
    camera.position.z = INLINE_ARENA.z + (dz / dist) * 2.1;
  }
}

function updateHitTest(frame) {
  if (!(placing && xrKind === 'ar' && frame)) {
    if (!placing) reticle.visible = false;
    return;
  }
  const session = renderer.xr.getSession();
  if (!hitTestRequested && session) {
    hitTestRequested = true;
    session.requestReferenceSpace('viewer').then((space) => {
      session.requestHitTestSource({ space }).then((source) => {
        hitTestSource = source;
      }).catch((err) => console.warn(err));
    }).catch((err) => console.warn(err));
  }
  if (!hitTestSource) return;
  const hits = frame.getHitTestResults(hitTestSource);
  if (!hits.length) {
    reticle.visible = false;
    return;
  }
  const pose = hits[0].getPose(renderer.xr.getReferenceSpace());
  if (!pose) return;
  reticle.visible = true;
  reticle.matrix.fromArray(pose.transform.matrix);
}

function pinchPoint(hand) {
  const indexTip = hand.joints?.['index-finger-tip'];
  const thumbTip = hand.joints?.['thumb-tip'];
  if (!indexTip?.visible || !thumbTip?.visible) return null;
  indexTip.getWorldPosition(_indexTip);
  thumbTip.getWorldPosition(_thumbTip);
  _pinch.copy(_indexTip).add(_thumbTip).multiplyScalar(0.5);
  return { distance: _indexTip.distanceTo(_thumbTip), point: _pinch };
}

function nearestOwnPiece(point) {
  let best = null;
  let bestD = 0.05;
  for (const mesh of tabletop.pickables) {
    if (!mesh.userData?.id || mesh.userData.slay) continue;
    if (mesh.userData.side !== game.turn) continue;
    mesh.getWorldPosition(_piecePos);
    _piecePos.y += 0.035;
    const distance = _piecePos.distanceTo(point);
    if (distance < bestD) {
      bestD = distance;
      best = mesh;
    }
  }
  return best;
}

function pulseInput(source, strength) {
  const gamepad = source?.gamepad;
  const actuator = gamepad?.hapticActuators?.[0] || gamepad?.vibrationActuator;
  if (!actuator) return;
  if (actuator.pulse) actuator.pulse(strength, 28);
  else actuator.playEffect?.('dual-rumble', { duration: 28, strongMagnitude: strength, weakMagnitude: strength });
}

function grabPiece(hand, mesh) {
  mesh.userData.held = true;
  mesh.userData.tween = null;
  heldPiece = { mesh, hand, from: { r: mesh.userData.r, c: mesh.userData.c } };
  game.selected = { r: mesh.userData.r, c: mesh.userData.c };
  tabletop.refresh(game);
  updateHUD();
  playTick();
  pulseInput(hand.userData.inputSource, 0.45);
}

function releaseHeld(commit) {
  if (!heldPiece) return;
  const { mesh, from } = heldPiece;
  heldPiece = null;
  mesh.userData.held = false;
  const drop = squareUnder(mesh.position.x, mesh.position.z);
  const opt = options(game, from.r, from.c);
  const same = drop && drop.r === from.r && drop.c === from.c;
  const move = drop && opt.moves.some((m) => m.r === drop.r && m.c === drop.c);
  const attack = drop && opt.attacks.some((m) => m.r === drop.r && m.c === drop.c);
  if (commit && drop && !same && (move || attack)) {
    game.selected = from;
    if (move) doMove(drop.r, drop.c);
    else doAttack(drop.r, drop.c);
    return;
  }
  mesh.userData.tween = {
    from: mesh.position.clone(),
    to: squareLocal(mesh.userData.r, mesh.userData.c),
    t: 0,
    dur: 0.28,
  };
  game.selected = null;
  tabletop.refresh(game);
  updateHUD();
}

function squareUnder(x, z) {
  const c = Math.round(x / SQ + 2);
  const r = Math.round(z / SQ + 2);
  if (!inBounds(r, c)) return null;
  const cx = (c - 2) * SQ;
  const cz = (r - 2) * SQ;
  if (Math.hypot(x - cx, z - cz) > SQ * 0.65) return null;
  return { r, c };
}

function updateHands() {
  const showHands = renderer.xr.isPresenting && !combatView;
  for (let i = 0; i < handModels.length; i++) handModels[i].visible = showHands;
  if (!showHands || game.phase !== 'play' || menu || placing) {
    if (heldPiece) releaseHeld(false);
    return;
  }
  board.updateWorldMatrix(true, false);
  for (const hand of hands) {
    const pinch = pinchPoint(hand);
    if (!pinch) {
      if (heldPiece?.hand === hand) releaseHeld(true);
      hand.userData.pinching = false;
      continue;
    }
    const wasPinching = hand.userData.pinching;
    const pinching = wasPinching ? pinch.distance < 0.034 : pinch.distance < 0.02;
    hand.userData.pinching = pinching;
    if (pinching && !wasPinching && !heldPiece) {
      const mesh = nearestOwnPiece(pinch.point);
      if (mesh) grabPiece(hand, mesh);
    }
    if (!pinching && wasPinching && heldPiece?.hand === hand) releaseHeld(true);
    if (heldPiece?.hand === hand && pinching) {
      _holdPoint.copy(pinch.point);
      board.worldToLocal(_holdPoint);
      heldPiece.mesh.position.copy(_holdPoint);
      heldPiece.mesh.position.y -= 0.028;
      heldPiece.mesh.rotation.x = 0;
      heldPiece.mesh.rotation.z = 0;
    }
  }
}

function frame(t, xrFrame) {
  const now = t || performance.now();
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
  last = now;
  if (!renderer.xr.isPresenting && controls.enabled) controls.update();

  const camObj = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  camObj.getWorldPosition(fadeSphere.position);

  for (const controller of controllers) {
    const laser = controller.getObjectByName('laser');
    if (laser) laser.visible = renderer.xr.isPresenting && game.phase !== 'combat';
  }
  tabletop.turnSprite.visible = renderer.xr.isPresenting && !combatView;

  updateHitTest(xrFrame);
  movePlayer(dt);
  if (input.primaryPressed || mouseMag > 34 || dragSpeed > 32) input.slash = true;
  mouseMag = 0;
  dragSpeed = 0;

  tabletop.update(dt);
  updateHands();
  if (combat.isActive()) combat.update(dt, input);

  input.primaryPressed = false;
  input.primaryReleased = false;
  input.slash = false;
  renderer.render(scene, camera);
}

let last = 0;
renderer.setAnimationLoop(frame);

function onResize() {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', onResize);
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  ptr = { x: event.clientX, y: event.clientY, id: event.pointerId, dragged: false };
  if (game.phase === 'combat' && !renderer.xr.isPresenting) {
    input.primaryDown = true;
    input.primaryPressed = true;
    if (event.pointerType === 'mouse' && document.pointerLockElement !== renderer.domElement) {
      renderer.domElement.requestPointerLock();
    }
  }
});

renderer.domElement.addEventListener('pointermove', (event) => {
  if (!ptr || event.pointerId !== ptr.id) return;
  if (game.phase !== 'combat' || renderer.xr.isPresenting) return;
  if (document.pointerLockElement === renderer.domElement) return;
  const dx = event.clientX - ptr.x;
  const dy = event.clientY - ptr.y;
  ptr.x = event.clientX;
  ptr.y = event.clientY;
  if (Math.abs(dx) + Math.abs(dy) < 2) return;
  ptr.dragged = true;
  dragSpeed += Math.hypot(dx, dy);
  yaw -= dx * 0.0055;
  pitch -= dy * 0.0055;
  pitch = Math.max(-1.15, Math.min(1.15, pitch));
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
});

window.addEventListener('pointerup', (event) => {
  if (input.primaryDown && game.phase === 'combat') {
    input.primaryDown = false;
    input.primaryReleased = true;
  }
  if (!ptr || event.pointerId !== ptr.id) return;
  const dx = event.clientX - ptr.x;
  const dy = event.clientY - ptr.y;
  const dragged = ptr.dragged || dx * dx + dy * dy > 49;
  ptr = null;
  if (renderer.xr.isPresenting || menu || placing || game.phase === 'combat' || dragged) return;
  pickAt(event.clientX, event.clientY);
});

document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== renderer.domElement || !combatView) return;
  yaw -= event.movementX * 0.0022;
  pitch -= event.movementY * 0.0022;
  pitch = Math.max(-1.15, Math.min(1.15, pitch));
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
  mouseMag += Math.hypot(event.movementX, event.movementY);
});

window.addEventListener('keydown', (event) => {
  keys[event.code] = true;
  if (event.repeat) return;
  if ((event.code === 'Space' || event.code === 'KeyF') && combatView) input.slash = true;
});
window.addEventListener('keyup', (event) => {
  keys[event.code] = false;
});

btnPlay.addEventListener('click', () => {
  unlockAudio();
  menu = false;
  controls.enabled = true;
  updateHUD();
});
btnAr.addEventListener('click', () => enterXR('ar'));
btnVr.addEventListener('click', () => enterXR('vr'));
btnArMini.addEventListener('click', () => enterXR('ar'));
btnVrMini.addEventListener('click', () => enterXR('vr'));
btnAgain.addEventListener('click', () => {
  unlockAudio();
  restart();
});
btnMove.addEventListener('click', () => beginPlacement());
btnYield.addEventListener('click', () => {
  if (game.phase === 'combat') combat.force(false);
});
btnSound.addEventListener('click', () => {
  unlockAudio();
  toggleMute();
  updateHUD();
});

async function detectXR() {
  if (!navigator.xr) {
    btnAr.disabled = true;
    btnVr.disabled = true;
    btnArMini.disabled = true;
    btnVrMini.disabled = true;
    return;
  }
  const ar = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  const vr = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
  btnAr.disabled = !ar;
  btnVr.disabled = !vr;
  btnArMini.disabled = !ar;
  btnVrMini.disabled = !vr;
}

if (false) {
  window.__crownfall = {
    get game() { return game; },
    refresh: () => tabletop.refresh(game),
    win: () => combat.force(true),
    lose: () => combat.force(false),
    // Start a clash directly, e.g. __crownfall.duel('S', 'A') for sword vs archers.
    duel: (attackerType = 'S', defenderType = 'S', attackerSide = 0) =>
      combat.start({ attackerType, defenderType, attackerSide }),
    restart,
    probe(r, c) {
      const p = this.screenOf(r, c);
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((p.x - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((p.y - rect.top) / rect.height) * 2 + 1;
      scene.updateMatrixWorld(true);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(pickables, true).slice(0, 8).map((hit) => ({
        d: Number(hit.distance.toFixed(3)),
        marker: hit.object.userData.marker || hit.object.parent?.userData?.marker || null,
        id: hit.object.userData.id || hit.object.parent?.userData?.id || null,
        kind: hit.object.type,
        x: Number(hit.point.x.toFixed(3)),
        y: Number(hit.point.y.toFixed(3)),
        z: Number(hit.point.z.toFixed(3)),
      }));
      const tiles = pickables.filter((obj) => obj.userData.marker).map((obj) => ({
        r: obj.userData.r,
        c: obj.userData.c,
        x: Number(obj.position.x.toFixed(3)),
        z: Number(obj.position.z.toFixed(3)),
      }));
      return { hits, tiles };
    },
    screenOf(r, c) {
      const v = new THREE.Vector3((c - 2) * 0.08, 0.034, (r - 2) * 0.08);
      board.updateWorldMatrix(true, false);
      board.localToWorld(v);
      camera.updateMatrixWorld();
      v.project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return {
        x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
      };
    },
  };
}
