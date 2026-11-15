import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js?v=487fd51';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js?v=487fd51';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js?v=487fd51';
import {
  advanceTurn,
  createGame,
  inBounds,
  options,
  SIDE_NAME,
  TYPE_NAME,
} from './rules.js?v=487fd51';
import { createTabletop, SQ, squareLocal } from './tabletop.js?v=487fd51';
import { createCombat, INLINE_ARENA } from './combat.js?v=487fd51';
import { chooseMove } from './ai.js?v=487fd51';
import { cleanCode, makeCode, openRoom } from './net.js?v=487fd51';
import {
  isMuted,
  playDefeat,
  playSfx,
  playTick,
  resumeAudio,
  setMusicTension,
  startMusic,
  toggleMute,
} from './audio.js?v=487fd51';

const $ = (id) => document.getElementById(id);
const titleEl = $('title');
const netStatus = $('net-status');
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
const lastMoveEl = $('last-move');
let turnShown = null;
// What was just played, shown under the turn pill, and a running move count.
let lastMove = '';
let fallEpoch = -1;
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
const btnOpponent = $('btn-opponent');
// You play Gold; the computer plays Violet unless switched to two players.
const COMPUTER_SIDE = 1;
let vsComputer = true;
let aiTimer = 0;
function computersTurn() {
  return vsComputer && !online && game.phase === 'play' && game.turn === COMPUTER_SIDE;
}

// ---------------------------------------------------------------- online --
// Two players on two devices: the room's creator plays Gold, the joiner
// Violet. Each side only moves on its own turn; the other side's moves,
// clash results and restarts arrive over the connection. Every action
// carries the board as it stands afterwards, so the two devices can never
// drift apart.
let online = null;
let mySide = null;
let opponentHere = false;
let applyingRemote = false;
let remoteFight = null;

function snapshot() {
  return {
    board: game.board.map((row) => row.map((p) => (p ? { id: p.id, type: p.type, side: p.side } : null))),
    turn: game.turn,
    phase: game.phase === 'combat' ? 'play' : game.phase,
    winner: game.winner,
    draw: game.draw,
    moveNo: game.moveNo || 1,
    fallen: game.fallen || null,
    lastMove,
  };
}

function sameAs(s) {
  const a = snapshot();
  return JSON.stringify([a.board, a.turn, a.phase, a.moveNo]) === JSON.stringify([s.board, s.turn, s.phase, s.moveNo]);
}

function applySnapshot(s) {
  game.board = s.board.map((row) => row.map((p) => (p ? { ...p } : null)));
  game.turn = s.turn;
  game.phase = s.phase;
  game.winner = s.winner;
  game.draw = s.draw;
  game.moveNo = s.moveNo;
  game.fallen = s.fallen;
  game.selected = null;
  lastMove = s.lastMove || lastMove;
  tabletop.refresh(game);
  updateHUD();
  if (game.phase === 'over') showGameOver();
  else hideGameOver();
}

function sendAction(kind, extra = {}) {
  if (!online || applyingRemote) return;
  online.send({ t: 'action', kind, ...extra, after: snapshot() });
}

function remote(fn, after) {
  applyingRemote = true;
  try {
    fn();
  } finally {
    applyingRemote = false;
  }
  if (after && !sameAs(after)) applySnapshot(after);
}

function onNetMessage(msg) {
  if (msg.t === 'state') {
    applySnapshot(msg.state);
    return;
  }
  if (msg.t !== 'action') return;
  // If the boards ever disagree about the piece being moved, skip the replay
  // and take the sender's board as it stands after the action.
  if ((msg.kind === 'move' || msg.kind === 'strike' || msg.kind === 'clash') && msg.after && !game.board[msg.from?.r]?.[msg.from?.c]) {
    remoteFight = null;
    applySnapshot(msg.after);
    return;
  }
  if (msg.kind === 'move') {
    remote(() => {
      game.selected = msg.from;
      doMove(msg.to.r, msg.to.c);
    }, msg.after);
  } else if (msg.kind === 'fighting') {
    const attacker = game.board[msg.from.r]?.[msg.from.c];
    const defender = game.board[msg.to.r]?.[msg.to.c];
    remoteFight = msg;
    if (attacker && defender) {
      lastMove = `${describe(attacker)} attacks your ${TYPE_NAME[defender.type]} on ${squareName(msg.to.r, msg.to.c)} — clash in progress…`;
    }
    game.selected = null;
    tabletop.refresh(game);
    updateHUD();
  } else if (msg.kind === 'clash') {
    remoteFight = null;
    remote(() => {
      pending = { from: msg.from, to: msg.to, defending: false };
      game.phase = 'combat';
      finishCombat(!!msg.win);
    }, msg.after);
  } else if (msg.kind === 'strike') {
    remote(() => {
      game.selected = msg.from;
      doAttack(msg.to.r, msg.to.c);
    }, msg.after);
  } else if (msg.kind === 'restart') {
    remoteFight = null;
    remote(() => restart(), msg.after);
  }
}

function onNetStatus(state, detail) {
  if (state === 'waiting') {
    setOnlineMsg('Waiting for the other player to join…');
  } else if (state === 'connected') {
    opponentHere = true;
    if (mySide === 0) {
      // The host deals a fresh board and tells the guest.
      restart();
      online.send({ t: 'state', state: snapshot() });
    }
    startOnlineGame();
    toast(`Connected — you are ${SIDE_NAME[mySide]}.`);
    updateHUD();
  } else if (state === 'disconnected') {
    opponentHere = false;
    remoteFight = null;
    toast('The other player left. They can rejoin with the same code.');
    updateHUD();
  } else if (state === 'error') {
    setOnlineMsg(detail || 'Connection problem.');
    if (!opponentHere) toast(detail || 'Connection problem.');
  }
}

function onlineBlock() {
  if (!online) return null;
  if (!opponentHere) return 'Waiting for the other player to join.';
  if (remoteFight) return `${SIDE_NAME[1 - mySide]} is fighting a clash — wait for the result.`;
  if (game.phase === 'play' && game.turn !== mySide) return `It is ${SIDE_NAME[game.turn]}'s move — waiting for your opponent.`;
  return null;
}
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

// Board sounds are driven by the pieces themselves: the swipe when a piece
// starts sliding, a knock when it lands, a ping when it lands on a square it
// has taken, and the victory fanfare when a monarch hits the board.
const tabletop = createTabletop(scene, {
  onSlide: () => playSfx('swipe'),
  onLand: (_piece, kind) => playSfx(kind),
  onFall: () => onMonarchFallen(),
});
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
const grips = [];
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
    controller.userData.selecting = true;
    input.primaryDown = true;
    input.primaryPressed = true;
  });
  controller.addEventListener('selectend', () => {
    controller.userData.selecting = false;
    input.primaryDown = false;
    input.primaryReleased = true;
  });
  controller.addEventListener('select', () => {
    if (game.phase !== 'combat') onXRSelect(controller);
  });
  scene.add(controller);
  controllers.push(controller);
  // The grip pose runs along the controller's handle, where a hilt would
  // sit in the fist: the sword is mounted here so the blade continues
  // straight out of the controller.
  const grip = renderer.xr.getControllerGrip(i);
  scene.add(grip);
  grips.push(grip);
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
  hand.addEventListener('disconnected', () => {
    hand.userData.inputSource = null;
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
    rightGrip: () => grips[controllers.indexOf(findHand('right'))] || null,
    // Only a real left controller (not the right one standing in for it).
    leftGrip: () => {
      const left = controllers.find((c) => c.userData.connected && c.userData.handedness === 'left' && !c.userData.inputSource?.hand);
      return left ? grips[controllers.indexOf(left)] : null;
    },
    rightSelecting: () => !!findHand('right')?.userData.selecting,
    lock: (on) => crosshair.classList.toggle('locked', on),
    isAR: () => xrKind === 'ar' && renderer.xr.isPresenting,
    trackedHand: (which) => hands.find((h) => h.userData.inputSource?.handedness === which && h.userData.inputSource?.hand) || null,
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
    // Night fog belongs to the virtual arena; in AR it would tint the real room.
    scene.fog = xrKind === 'ar' && renderer.xr.isPresenting ? null : new THREE.Fog(0x120e0c, 7, 21);
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
  const falling = game.phase === 'over' && fallEpoch !== -1;
  turnEl.textContent = game.phase === 'over'
    ? (game.draw ? 'Stalemate' : falling ? 'The monarch falls…' : `${SIDE_NAME[game.winner]} wins!`)
    : `Move ${game.moveNo || 1} · ${SIDE_NAME[game.turn]}${online ? (game.turn === mySide ? ' (you)' : ' (opponent)') : vsComputer && game.turn === COMPUTER_SIDE ? ' (computer)' : ''} to move`;
  lastMoveEl.textContent = lastMove;
  lastMoveEl.classList.toggle('hidden', !lastMove || menu);
  const lead = game.phase === 'over' ? game.winner : game.turn;
  turnEl.classList.toggle('gold', lead === 0);
  turnEl.classList.toggle('violet', lead === 1);
  topbar.classList.toggle('gold', lead === 0);
  topbar.classList.toggle('violet', lead === 1);
  const who = SIDE_NAME[game.turn];
  if (placing) hintEl.textContent = 'Point at a table, then tap to place the court.';
  else if (computersTurn()) hintEl.textContent = `${who} (computer) is choosing a move…`;
  else if (online && onlineBlock() && game.phase === 'play') hintEl.textContent = onlineBlock();
  else if (game.phase === 'over') hintEl.textContent = game.draw ? 'Neither side can move.' : `${SIDE_NAME[game.winner]} has taken the monarch.`;
  else if (!game.selected) {
    hintEl.textContent = xrKind === 'ar'
      ? `${who}: aim at one of your pieces and tap.`
      : xrKind === 'vr'
        ? `${who}: pinch one of your pieces, or point and pull the trigger.`
        : `${who}: click one of your pieces.`;
  } else hintEl.textContent = `${who}: green moves, red strikes. The monarch only steps.`;
  flashTurn();
  btnSound.textContent = isMuted() ? 'Sound off' : 'Sound on';
  btnOpponent.classList.toggle('hidden', !!online);
  updateNetStatus();
}

// The turn pill at the top flashes whenever the move passes to the other
// side (or the game ends), so the change is never missed.
function flashTurn() {
  if (menu || game.phase === 'combat') return;
  const key = `${game.phase}|${game.turn}|${game.moveNo || 1}|${fallEpoch !== -1}`;
  if (key === turnShown) return;
  turnShown = key;
  topbar.classList.remove('flash');
  void topbar.offsetWidth;
  topbar.classList.add('flash');
}

function showGameOver() {
  gameoverEl.classList.toggle('gold', !game.draw && game.winner === 0);
  gameoverEl.classList.toggle('violet', !game.draw && game.winner === 1);
  goTitle.textContent = game.draw ? 'The court is locked' : `${SIDE_NAME[game.winner]} wins!`;
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
  scheduleComputer();
}

// The computer's turn: think briefly, show the move it has picked (its
// piece is selected with the green and red squares, like yours), then play.
function scheduleComputer() {
  clearTimeout(aiTimer);
  if (!computersTurn()) return;
  const token = epoch;
  aiTimer = setTimeout(() => {
    if (token !== epoch || !computersTurn()) return;
    const action = chooseMove(game);
    if (!action) return;
    game.selected = { r: action.from.r, c: action.from.c };
    playTick();
    tabletop.refresh(game);
    updateHUD();
    aiTimer = setTimeout(() => {
      if (token !== epoch || !computersTurn()) return;
      if (action.attack) doAttack(action.to.r, action.to.c);
      else doMove(action.to.r, action.to.c);
    }, 750);
  }, 650);
}

// Squares are named like chess: files a–e from Gold's left, ranks 1–5 from
// Gold's side of the board.
function squareName(r, c) {
  return `${'abcde'[c]}${5 - r}`;
}

function describe(piece) {
  return `${SIDE_NAME[piece.side]} ${TYPE_NAME[piece.type]}`;
}

function doMove(r, c) {
  const from = game.selected;
  const piece = game.board[from.r][from.c];
  game.board[r][c] = piece;
  game.board[from.r][from.c] = null;
  lastMove = `${describe(piece)} ${squareName(from.r, from.c)} → ${squareName(r, c)}`;
  game.moveNo = (game.moveNo || 1) + 1;
  settle(advanceTurn(game));
  sendAction('move', { from: { r: from.r, c: from.c }, to: { r, c } });
}

function finishCombat(result) {
  const { from, to, defending } = pending || {};
  // When you are defending, the clash is fought from your side: your win
  // means the attacker loses.
  const win = defending ? !result : result;
  const attacker = from && game.board[from.r][from.c];
  const defender = to && game.board[to.r][to.c];
  if (attacker) {
    lastMove = win
      ? `${describe(attacker)} takes ${defender ? describe(defender) : 'the square'} on ${squareName(to.r, to.c)}`
      : `${describe(attacker)} falls attacking ${squareName(to.r, to.c)}`;
    game.moveNo = (game.moveNo || 1) + 1;
  }
  if (win && attacker) {
    game.board[to.r][to.c] = attacker;
    game.board[from.r][from.c] = null;
    // The ping plays when the piece lands on the square it took.
    game.takeover = attacker.id;
  } else if (attacker) {
    game.board[from.r][from.c] = null;
    playDefeat();
  }
  game.phase = 'play';
  pending = null;
  settle(advanceTurn(game));
  game.takeover = null;
  if (from && to) sendAction('clash', { from, to, win });
}

function doAttack(r, c) {
  const from = game.selected;
  const attacker = game.board[from.r][from.c];
  const defender = game.board[r][c];
  if (defender.type === 'X') {
    // Any archer or swordsman striking the monarch ends the game: the monarch
    // topples onto the board, then the winner is announced.
    game.selected = null;
    game.phase = 'over';
    game.winner = attacker.side;
    game.draw = false;
    game.fallen = { id: defender.id, by: { r: from.r, c: from.c } };
    fallEpoch = epoch;
    lastMove = `${describe(attacker)} strikes the ${SIDE_NAME[defender.side]} Monarch on ${squareName(r, c)}`;
    playSfx('ping');
    tabletop.refresh(game);
    updateHUD();
    sendAction('strike', { from: { r: from.r, c: from.c }, to: { r, c } });
    return;
  }
  if (online && !applyingRemote) online.send({ t: 'action', kind: 'fighting', from: { r: from.r, c: from.c }, to: { r, c } });
  const token = ++epoch;
  const defending = vsComputer && attacker.side === COMPUTER_SIDE;
  pending = { from: { r: from.r, c: from.c }, to: { r, c }, defending };
  game.selected = null;
  game.phase = 'combat';
  tabletop.refresh(game);
  updateHUD();
  if (defending) {
    lastMove = `${describe(attacker)} attacks your ${TYPE_NAME[defender.type]} on ${squareName(r, c)} — defend it!`;
    toast(`Defend your ${TYPE_NAME[defender.type]}!`);
  }
  // You always fight with your own piece's weapon: as the attacker, or, when
  // the computer attacks, as the defender against the attacker's army.
  combat.start(defending
    ? { attackerType: defender.type, defenderType: attacker.type, attackerSide: defender.side }
    : { attackerType: attacker.type, defenderType: defender.type, attackerSide: attacker.side },
  ).then((result) => {
    if (token !== epoch || result === 'abort') return;
    finishCombat(result === true);
  });
}

function onMonarchFallen() {
  if (fallEpoch !== epoch || game.phase !== 'over') return;
  fallEpoch = -1;
  playSfx('victory');
  updateHUD();
  setTimeout(() => { if (game.phase === 'over') showGameOver(); }, 900);
}

function handlePick(data) {
  if (menu || placing) return;
  if (game.phase === 'over') {
    if (data?.action === 'again') pressAgain();
    return;
  }
  if (game.phase !== 'play') return;
  if (computersTurn()) {
    toast(`${SIDE_NAME[COMPUTER_SIDE]} (computer) is moving…`);
    return;
  }
  const blocked = onlineBlock();
  if (blocked) {
    toast(blocked);
    return;
  }
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
    if (data.id && data.side !== game.turn) {
      playSfx('illegal');
      toast(`It is ${SIDE_NAME[game.turn]}'s move.`);
    }
    game.selected = null;
    tabletop.refresh(game);
    updateHUD();
    return;
  }
  const opt = options(game, game.selected.r, game.selected.c);
  if (opt.moves.some((m) => m.r === data.r && m.c === data.c)) doMove(data.r, data.c);
  else if (opt.attacks.some((m) => m.r === data.r && m.c === data.c)) doAttack(data.r, data.c);
  else {
    playSfx('illegal');
    toast(`It is ${SIDE_NAME[game.turn]}'s move — pick a green or red square.`);
  }
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
  clearTimeout(aiTimer);
  epoch += 1;
  combat.abort();
  game = createGame();
  pending = null;
  hideGameOver();
  turnShown = null;
  lastMove = '';
  // Tells the board to turn every piece back to face the other side.
  game.reset = true;
  tabletop.refresh(game);
  game.reset = false;
  updateHUD();
  playSfx('start');
  toast('The court is set.');
  sendAction('restart');
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

// Play again: the button dips, then the court resets.
let againPressed = false;
function pressAgain() {
  if (againPressed) return;
  againPressed = true;
  tabletop.again.userData.pressT = performance.now() / 1000;
  playTick();
  setTimeout(() => {
    againPressed = false;
    if (game.phase === 'over') restart();
  }, 180);
}

const _againPos = new THREE.Vector3();
// With hand tracking, poke the button with a fingertip or pinch on it.
function pressAgainWithHands() {
  const button = tabletop.again;
  if (!button.parent?.visible) return;
  button.getWorldPosition(_againPos);
  for (const hand of hands) {
    const tip = hand.joints?.['index-finger-tip'];
    if (tip?.visible && tip.getWorldPosition(_indexTip).distanceTo(_againPos) < 0.045) {
      pressAgain();
      return;
    }
    const pinch = pinchPoint(hand);
    if (pinch && pinch.distance < 0.02 && pinch.point.distanceTo(_againPos) < 0.07) {
      pressAgain();
      return;
    }
  }
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
  // Hands stay visible in the duels too, so you can see them holding the
  // sword or drawing the bow.
  const showHands = renderer.xr.isPresenting;
  for (let i = 0; i < handModels.length; i++) handModels[i].visible = showHands;
  if (showHands && !combatView && game.phase === 'over') pressAgainWithHands();
  if (!showHands || combatView || game.phase !== 'play' || menu || placing || computersTurn() || onlineBlock()) {
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

  tabletop.update(dt, fadeSphere.position);
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
// ------------------------------------------------------- online panel --
const onlinePanel = $('online');
const onlineShare = $('online-share');
const onlineCodeEl = $('online-code');
const onlineMsg = $('online-msg');
const joinInput = $('join-code');
let onlineBusy = false;

function setOnlineMsg(text) {
  onlineMsg.textContent = text || '';
}

function showOnlinePanel(show) {
  onlinePanel.classList.toggle('hidden', !show);
  titleEl.classList.toggle('hidden', show || !menu);
}

function inviteLink(code) {
  return `${location.origin}${location.pathname}?join=${code}`;
}

function startOnlineGame() {
  showOnlinePanel(false);
  unlockAudio();
  menu = false;
  vsComputer = false;
  controls.enabled = true;
  updateHUD();
}

function updateNetStatus() {
  if (!online) {
    netStatus.classList.add('hidden');
    return;
  }
  netStatus.classList.remove('hidden');
  netStatus.classList.toggle('off', !opponentHere);
  netStatus.textContent = `Online · room ${online.code} · you are ${SIDE_NAME[mySide]} · ${opponentHere ? 'opponent connected' : 'waiting for opponent'}`;
}

async function goOnline(role, code) {
  if (onlineBusy) return;
  onlineBusy = true;
  online?.close();
  online = null;
  opponentHere = false;
  try {
    setOnlineMsg(role === 'host' ? 'Opening a room…' : `Joining ${code}…`);
    const room = await openRoom({ role, code, onMessage: onNetMessage, onStatus: onNetStatus });
    online = room;
    mySide = room.side;
    if (role === 'host') {
      onlineShare.classList.remove('hidden');
      onlineCodeEl.textContent = code;
      setOnlineMsg('Waiting for the other player to join…');
    }
    updateHUD();
  } catch (err) {
    setOnlineMsg(err.message || String(err));
  } finally {
    onlineBusy = false;
  }
}

$('btn-online').addEventListener('click', () => {
  unlockAudio();
  setOnlineMsg('');
  showOnlinePanel(true);
});
$('btn-online-back').addEventListener('click', () => showOnlinePanel(false));
$('btn-host').addEventListener('click', () => goOnline('host', makeCode()));
$('btn-join').addEventListener('click', () => {
  const code = cleanCode(joinInput.value);
  if (code.length < 4) {
    setOnlineMsg('Enter the code the other player sees.');
    return;
  }
  goOnline('join', code);
});
joinInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') $('btn-join').click();
});
$('btn-copy-link').addEventListener('click', async () => {
  const link = inviteLink(online?.code || onlineCodeEl.textContent);
  try {
    await navigator.clipboard.writeText(link);
    setOnlineMsg(`Link copied: ${link}`);
  } catch {
    setOnlineMsg(`Send this link: ${link}`);
  }
});
// Opening an invite link (…?join=CODE) goes straight to joining that game.
{
  const code = cleanCode(new URLSearchParams(location.search).get('join'));
  if (code) {
    joinInput.value = code;
    showOnlinePanel(true);
    goOnline('join', code);
  }
}

btnOpponent.addEventListener('click', () => {
  vsComputer = !vsComputer;
  btnOpponent.textContent = vsComputer ? 'Vs computer' : '2 players';
  toast(vsComputer ? `${SIDE_NAME[COMPUTER_SIDE]} is played by the computer.` : 'Two players: take turns on this device.');
  updateHUD();
  scheduleComputer();
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
    tabletop,
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
