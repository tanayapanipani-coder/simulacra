import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js?v=87486b8';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js?v=87486b8';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js?v=87486b8';
import {
  advanceTurn,
  createGame,
  inBounds,
  options,
  SIDE_NAME,
  TYPE_NAME,
} from './rules.js?v=87486b8';
import { createTabletop, SQ, squareLocal } from './tabletop.js?v=87486b8';
import { createCombat, INLINE_ARENA } from './combat.js?v=87486b8';
import { chooseMove } from './ai.js?v=87486b8';
import { createSim } from './sim.js?v=87486b8';
import { cleanCode, makeCode, openRoom } from './net.js?v=87486b8';
import { VERSION } from './version.js?v=87486b8';
import {
  isMuted,
  playDefeat,
  playSfx,
  playTick,
  resumeAudio,
  setMusicTension,
  startMusic,
  toggleMute,
} from './audio.js?v=87486b8';

const $ = (id) => document.getElementById(id);
const versionEl = $('version');
if (versionEl) versionEl.textContent = `v${VERSION}`;
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
const btnLeave = $('btn-leave');
const btnResign = $('btn-resign');
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
let hostDealt = false;
let opponentQuit = false;

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
    remoteFight = null;
    applySnapshot(msg.state);
    return;
  }
  if (msg.t === 'leave') {
    opponentHere = false;
    remoteFight = null;
    opponentQuit = true;
    toast(`${SIDE_NAME[1 - mySide]} left the game. Tap Leave online to play the computer.`);
    updateHUD();
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
  } else if (msg.kind === 'resign') {
    remoteFight = null;
    applySnapshot(msg.after);
    toast(`${SIDE_NAME[1 - mySide]} resigned — you win!`);
    playSfx('victory');
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
    opponentQuit = false;
    if (mySide === 0) {
      // First time in: the host deals a fresh board. If the other player is
      // rejoining after a drop, the game carries on: they get the board as
      // it stands.
      if (!hostDealt) {
        hostDealt = true;
        restart();
      }
      online.send({ t: 'state', state: snapshot() });
    }
    startOnlineGame();
    toast(`Connected — you are ${SIDE_NAME[mySide]}.`);
    updateHUD();
  } else if (state === 'disconnected') {
    opponentHere = false;
    remoteFight = null;
    // A deliberate Leave has already been announced.
    if (!opponentQuit) toast('The other player dropped out. They can rejoin with the same code.');
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
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
// Soft-edged sun shadows in the duels (only the sun casts them).
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// Render the headset's periphery at lower resolution: free frame time on Quest.
renderer.xr.setFoveation(1);
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
  // Who each side is, for the floating turn label in AR/VR.
  sideTag: (side) => (online
    ? (side === mySide ? ' (you)' : ' (opponent)')
    : vsComputer && side === COMPUTER_SIDE ? ' (computer)' : ''),
  // The 3D result panel is for AR/VR; the flat screen uses the card.
  show3DEnd: () => renderer.xr.isPresenting,
});
const { board, diorama, room, pickables } = tabletop;

// Sim: the Simulacra character standing across the board, playing Violet and coaching, with a
// live voice when an OpenAI key has been given. She is there whenever you play the computer.
const sim = createSim({
  scene,
  board,
  getCamera: () => (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera),
  getGame: () => game,
  human: 0,
  say: (text) => toast(text),
});
const simPlays = () => vsComputer && !online;
let simGreeted = -1;
function simGreet() {
  if (!simPlays() || simGreeted === epoch || game.phase !== 'play') return;
  simGreeted = epoch;
  sim.gameStarted();
}
const boardCopy = () => game.board.map((row) => row.slice());
// A hint by herself when you have been looking at the board for a while on your turn.
let thinkingSince = 0;
let hintedFor = -1;
setInterval(() => {
  const yours = simPlays() && !menu && !placing && game.phase === 'play' && game.turn !== COMPUTER_SIDE && !combatView;
  const stamp = `${epoch}:${game.moveNo || 1}`;
  if (!yours) {
    thinkingSince = 0;
    return;
  }
  if (!thinkingSince || hintedFor !== stamp && thinkingSince.stamp !== stamp) thinkingSince = { at: performance.now(), stamp };
  if (hintedFor !== stamp && performance.now() - thinkingSince.at > 45000) {
    hintedFor = stamp;
    sim.offerHint(game);
  }
}, 1000);
async function talkToSim() {
  const status = $('sim-status');
  if (!(await sim.canGoLive())) {
    status.textContent = sim.canSpeak() ? 'No key: Sim will talk with the browser’s built-in voice and coach you as you play. She cannot hear you without a key.' : 'No key, and this browser has no built-in voice: Sim will coach in text.';
    return;
  }
  status.textContent = 'Connecting Sim’s voice…';
  const live = await sim.startVoice();
  status.textContent = live ? 'Sim’s voice is live: just talk to her.' : `Live voice could not start (${sim.voiceProblem() || 'unknown reason'}). She will still speak her coaching, but cannot hear you. Open “Voice log” for details.`;
  $('btn-sim').textContent = live ? 'Sim: voice on' : 'Talk to Sim';
  if (live) {
    simGreeted = -1;
    if (!menu) simGreet();
    else sim.hello(); // so you hear her before you start
  }
  return live;
}
// Starting a game switches her voice on if there is a key and it is not on yet: nobody should have
// to remember a separate button. The microphone prompt comes before any AR session, where it would be hidden.
async function voiceThenStart(start) {
  unlockAudio();
  if (sim.voiceState() !== 'live' && sim.voiceState() !== 'connecting' && (await sim.canGoLive())) await talkToSim();
  start();
}
setInterval(() => {
  const el = $('sim-log');
  if (el && !el.hidden) el.textContent = `voice: ${sim.voiceState()}${sim.voiceProblem() ? ' (' + sim.voiceProblem() + ')' : ''}; heard her on the call: ${sim.heardHer() ? 'yes' : 'not yet'}\n` + sim.voiceLog().slice(-40).join('\n');
}, 500);

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
const _boardPlane = new THREE.Plane();
const _pickUp = new THREE.Vector3();
const _boardHit = new THREE.Vector3();
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
let floorBased = false;
let placing = false;
let xrKind = null;
let needSeat = false;
const _seatQ = new THREE.Quaternion();
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
  block: false,
};
let ptr = null;
let mouseMag = 0;
let dragSpeed = 0;

const controllers = [];
let triggerHand = null;
let clickHand = null;
try { clickHand = localStorage.getItem('crownfall.clickHand'); } catch { /* keep the default */ }
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
        new THREE.LineBasicMaterial({ color: 0xe6c27a, depthTest: false, depthWrite: false, transparent: true }),
      );
      line.renderOrder = 20;
      line.scale.z = 0.5;
      mount.add(line);
      controller.add(mount);
    }
  });
  controller.addEventListener('disconnected', () => {
    controller.userData.connected = false;
  });
  controller.addEventListener('selectstart', () => {
    // Any press in the headset (re)starts the sound: browsers keep audio
    // suspended until the player has pressed something.
    unlockAudio();
    controller.userData.selecting = true;
    if (!triggerHand) triggerHand = controller;
    input.primaryDown = true;
    input.primaryPressed = true;
  });
  controller.addEventListener('squeezestart', () => {
    unlockAudio();
    controller.userData.squeezing = true;
  });
  controller.addEventListener('squeezeend', () => {
    controller.userData.squeezing = false;
  });
  controller.addEventListener('selectend', () => {
    controller.userData.selecting = false;
    input.primaryDown = false;
    input.primaryReleased = true;
    const hand = controller;
    queueMicrotask(() => { if (triggerHand === hand) triggerHand = null; });
  });
  controller.addEventListener('select', () => {
    if (triggerHand !== controller) return;
    triggerHand = null;
    const hand = controller.userData.handedness;
    if (hand === 'left' || hand === 'right') {
      clickHand = hand;
      try { localStorage.setItem('crownfall.clickHand', hand); } catch { /* not stored */ }
    }
    if (game.phase !== 'combat') onXRSelect(controller);
    else if (exitPlaque.visible) {
      // In a duel the trigger belongs to the weapon, except on the Exit plaque.
      setRayFromController(controller);
      if (raycaster.intersectObject(exitPlaque, false).length) exitXR();
    }
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
    // Trigger or grip button: either one holds the bow string.
    rightSelecting: () => !!(findHand('right')?.userData.selecting || findHand('right')?.userData.squeezing),
    leftSelecting: () => !!(findHand('left')?.userData.selecting || findHand('left')?.userData.squeezing),
    clickHand: () => clickHand,
    lock: (on) => crosshair.classList.toggle('locked', on),
    floorBased: () => floorBased && renderer.xr.isPresenting,
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
    // Warm battlefield haze that softens the far ruins; none in AR.
    scene.fog = xrKind === 'ar' && renderer.xr.isPresenting ? null : new THREE.FogExp2(0x5e4635, 0.024);
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
  btnLeave.classList.toggle('hidden', !online);
  btnResign.classList.toggle('hidden', !online || game.phase !== 'play');
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
  // In AR/VR the 3D panel over the board shows the result; the card is for
  // the flat screen.
  if (renderer.xr.isPresenting) {
    hideGameOver();
    updateHUD();
    return;
  }
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
  if (info?.draw && simPlays()) sim.gameOver(null);
  tabletop.refresh(game);
  updateHUD();
  if (game.phase === 'over') showGameOver();
  scheduleComputer();
}

// The computer's turn, played straight after yours: as soon as your piece
// has landed it flashes the move it picked (its piece selected with the
// green and red squares) and plays it.
function scheduleComputer() {
  clearTimeout(aiTimer);
  if (!computersTurn()) return;
  const token = epoch;
  aiTimer = setTimeout(() => {
    if (token !== epoch || !computersTurn()) return;
    const action = sim.chooseMove(game) || chooseMove(game);
    if (!action) return;
    game.selected = { r: action.from.r, c: action.from.c };
    playTick();
    tabletop.refresh(game);
    updateHUD();
    aiTimer = setTimeout(() => {
      if (token !== epoch || !computersTurn()) return;
      const before = boardCopy();
      const strike = action.attack && before[action.to.r][action.to.c]?.type === 'X';
      if (action.attack) doAttack(action.to.r, action.to.c);
      else doMove(action.to.r, action.to.c);
      // A duel is announced by doAttack and a win by the game-over report; a plain move or strike here.
      if (action.reason && !action.attack && !strike) sim.sheMoved(before, action);
    }, 220);
  }, 380);
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
  const simNote = simPlays() && piece.side !== COMPUTER_SIDE ? sim.userMoved(game.board, { from: { r: from.r, c: from.c }, to: { r, c }, attack: false }) : null;
  game.board[r][c] = piece;
  game.board[from.r][from.c] = null;
  lastMove = `${describe(piece)} ${squareName(from.r, from.c)} → ${squareName(r, c)}`;
  game.moveNo = (game.moveNo || 1) + 1;
  settle(advanceTurn(game));
  sim.tell(simNote);
  sendAction('move', { from: { r: from.r, c: from.c }, to: { r, c } });
}

function finishCombat(result) {
  const { from, to, defending, duel } = pending || {};
  if (duel) sim.duelEnded(duel.humanType, duel.foeType, !!result);
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
    if (simPlays()) sim.gameOver(attacker.side);
    sendAction('strike', { from: { r: from.r, c: from.c }, to: { r, c } });
    return;
  }
  if (online && !applyingRemote) online.send({ t: 'action', kind: 'fighting', from: { r: from.r, c: from.c }, to: { r, c } });
  const token = ++epoch;
  const defending = vsComputer && attacker.side === COMPUTER_SIDE;
  const duel = simPlays() ? (defending ? { humanType: defender.type, foeType: attacker.type } : { humanType: attacker.type, foeType: defender.type }) : null;
  if (duel) sim.duelStarting(duel.humanType, duel.foeType, defending);
  pending = { from: { r: from.r, c: from.c }, to: { r, c }, defending, duel };
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
  if (data?.action === 'exit') {
    exitXR();
    return;
  }
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

// An Exit button beside the board in AR and VR: point at it and pull the trigger, or pinch.
const exitPlaque = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const g = canvas.getContext('2d');
  g.fillStyle = '#8f1f1f';
  g.beginPath();
  g.roundRect(4, 4, 504, 184, 40);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#f0d48a';
  g.stroke();
  g.fillStyle = '#fff4dc';
  g.font = '700 96px Cinzel, Palatino, Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('EXIT', 256, 100);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.05), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }));
  // On the player's left, just off the board, tilted up toward them.
  mesh.position.set(-0.31, 0.05, 0.16);
  mesh.rotation.set(-0.9, 0.35, 0);
  mesh.userData.action = 'exit';
  mesh.visible = false;
  board.add(mesh);
  return mesh;
})();
function exitXR() {
  const session = renderer.xr.getSession();
  if (session) session.end().catch(() => {});
}

// In a duel the board (and its Exit plaque) is out of sight, so the plaque
// is set down at the player's lower left when the fight starts, larger, and
// facing them: point at it and pull the trigger (or pinch) to leave.
const _exitHome = { position: exitPlaque.position.clone(), rotation: exitPlaque.rotation.clone() };
const _exitFwd = new THREE.Vector3();
function placeExitPlaque() {
  const fighting = renderer.xr.isPresenting && combatView;
  if (fighting && exitPlaque.parent === board) {
    const cam = renderer.xr.getCamera();
    cam.getWorldPosition(_cam);
    cam.getWorldDirection(_exitFwd);
    _exitFwd.y = 0;
    if (_exitFwd.lengthSq() < 1e-4) _exitFwd.set(0, 0, -1);
    _exitFwd.normalize();
    const left = new THREE.Vector3(_exitFwd.z, 0, -_exitFwd.x);
    scene.add(exitPlaque);
    exitPlaque.position.copy(_cam).addScaledVector(_exitFwd, 0.6).addScaledVector(left, 0.45);
    exitPlaque.position.y -= 0.42;
    exitPlaque.scale.setScalar(2);
    exitPlaque.rotation.set(-0.9, 0.35, 0);
  } else if (!fighting && exitPlaque.parent !== board) {
    board.add(exitPlaque);
    exitPlaque.position.copy(_exitHome.position);
    exitPlaque.rotation.copy(_exitHome.rotation);
    exitPlaque.scale.setScalar(1);
  }
}

// The on-screen Exit: leaves AR/VR, or (on a screen) gives up any duel in
// progress, leaves an online room and goes back to the start menu.
$('btn-exit').addEventListener('click', () => {
  if (renderer.xr.isPresenting) {
    exitXR();
    return;
  }
  if (game.phase === 'combat') btnYield.click();
  if (online) leaveOnline(true);
  menu = true;
  updateHUD();
});

function pickWithRay() {
  if (exitPlaque.visible && raycaster.intersectObject(exitPlaque, false).length) return { action: 'exit' };
  if (game.phase === 'over') {
    const hits = raycaster.intersectObjects(pickables, true);
    for (const hit of hits) {
      const data = findData(hit.object);
      if (data?.action) return data;
    }
    return null;
  }
  // Only the board surface. Piece models are not tested, so one standing
  // in the ray cannot change which tile is chosen.
  const hit = raycaster.intersectObject(tabletop.boardTop, false)[0];
  if (!hit) return null;
  _boardHit.copy(hit.point);
  board.worldToLocal(_boardHit);
  const square = squareUnder(_boardHit.x, _boardHit.z);
  if (!square) return null;
  const piece = game.board[square.r][square.c];
  if (piece) return { id: piece.id, type: piece.type, side: piece.side, r: square.r, c: square.c };
  return { r: square.r, c: square.c, marker: true };
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

// The side this viewer plays. Their pieces go on the edge nearest them and
// the opponent's (the computer's, or the other player's) on the far edge.
function viewerSide() {
  return online && mySide != null ? mySide : vsComputer ? 1 - COMPUTER_SIDE : 0;
}

// Turn the board about its own centre so the viewer's row faces the point
// (x, z) in world space. Gold's row is the board's +Z edge.
const _boardUp = new THREE.Vector3(0, 1, 0);
function faceBoardToward(x, z) {
  const dx = x - board.position.x;
  const dz = z - board.position.z;
  if (dx * dx + dz * dz < 0.04) return false;
  board.quaternion.setFromAxisAngle(_boardUp, Math.atan2(dx, dz) + (viewerSide() === 1 ? Math.PI : 0));
  tabletop.setViewerSide?.(viewerSide());
  return true;
}

// After the viewer's side changes (joining or leaving an online game).
function reseat() {
  if (!renderer.xr.isPresenting) seatFlat();
  else if (!placing && !combatView) needSeat = true;
}

// On screen the camera sits on the +Z side of the table.
function seatFlat() {
  board.quaternion.setFromAxisAngle(_boardUp, viewerSide() === 1 ? Math.PI : 0);
  tabletop.setViewerSide?.(viewerSide());
}

function placeBoard() {
  if (reticle.visible) {
    // Take the spot from the hit test but not its spin, which is arbitrary:
    // the board is turned below so your side faces you.
    reticle.matrix.decompose(board.position, board.quaternion, _scale);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(board.quaternion);
    board.position.addScaledVector(up, 0.004);
    const cam = renderer.xr.getCamera();
    cam.getWorldPosition(_cam);
    if (!faceBoardToward(_cam.x, _cam.z)) board.quaternion.identity();
  } else {
    const camObj = renderer.xr.getCamera();
    camObj.getWorldPosition(_cam);
    camObj.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    board.position.copy(_cam).addScaledVector(_fwd, 0.75);
    board.position.y -= 0.35;
    faceBoardToward(_cam.x, _cam.z);
  }
  placing = false;
  menu = false;
  applyScenery();
  updateHUD();
  toast('The court is set.');
  simGreet();
}

// Once, from the headset pose: table in front of the face, your pieces on the
// near edge. Sim stays on the far edge.
function seatInFront(xrFrame) {
  if (!needSeat || !xrFrame) return;
  const ref = renderer.xr.getReferenceSpace();
  const pose = ref && xrFrame.getViewerPose(ref);
  if (!pose) return;
  const p = pose.transform.position;
  const o = pose.transform.orientation;
  _seatQ.set(o.x, o.y, o.z, o.w);
  _fwd.set(0, 0, -1).applyQuaternion(_seatQ);
  _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
  _fwd.normalize();
  board.position.set(p.x, floorBased ? 0.66 : p.y - 0.94, p.z).addScaledVector(_fwd, 0.9);
  faceBoardToward(p.x, p.z);
  needSeat = false;
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
  const init = kind === 'ar'
    ? {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor', 'hand-tracking'],
      domOverlay: { root: document.getElementById('overlay') },
    }
    : { optionalFeatures: ['local-floor', 'hand-tracking'] };
  try {
    const session = await navigator.xr.requestSession(mode, init);
    // Use the headset's own floor when it offers one, so the fights stand
    // on the real floor whatever the player's height or posture; fall back
    // to a 1.6 m eye height otherwise.
    floorBased = await session.requestReferenceSpace('local-floor').then(() => true, () => false);
    renderer.xr.setReferenceSpaceType(floorBased ? 'local-floor' : 'local');
    xrKind = kind;
    hitTestSource = null;
    hitTestRequested = false;
    session.addEventListener('end', onSessionEnd);
    renderer.xr.setFoveation(1);
    await renderer.xr.setSession(session);
    hideGameOver();
    if (kind === 'vr') {
      placing = false;
      menu = false;
      // Table height above the real floor, or below the eyes without one.
      board.position.set(0, floorBased ? 0.66 : -0.94, -0.85);
      board.quaternion.identity();
      needSeat = true;
      simGreet();
    } else {
      beginPlacement();
    }
    applyScenery();
    updateHUD();
  } catch (err) {
    console.warn(err);
    // Answering the microphone prompt can use up the tap that starting AR needs.
    toast(sim.voiceState() === 'live' ? 'Sim can hear you now. Press Enter AR once more.' : 'The XR session was blocked.');
    xrKind = null;
    applyScenery();
  }
}

function onSessionEnd() {
  releaseHeld(false);
  floorBased = false;
  const wasFighting = combatView;
  if (game.phase === 'over' && fallEpoch === -1) setTimeout(() => game.phase === 'over' && showGameOver(), 0);
  xrKind = null;
  placing = false;
  hitTestSource = null;
  hitTestRequested = false;
  if (!wasFighting) {
    board.position.set(0, 0, 0);
    seatFlat();
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
  if (!menu && !placing) setTimeout(simGreet, 0);
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
  for (const mesh of tabletop.figures) {
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

// Auto quality: if a headset can't hold its refresh rate in a duel for a few
// seconds, drop the sun's shadows. Never comes back up
// mid-session, so it doesn't oscillate.
let quality = 'high';
let avgFrame = 1 / 72;
let slowFor = 0;
function watchQuality(rawDt) {
  if (quality === 'low' || !renderer.xr.isPresenting || game.phase !== 'combat') {
    slowFor = 0;
    return;
  }
  avgFrame += (Math.min(rawDt, 0.1) - avgFrame) * 0.05;
  slowFor = avgFrame > 0.0175 ? slowFor + rawDt : Math.max(0, slowFor - rawDt);
  if (slowFor > 3) {
    quality = 'low';
    combat.setQuality('low');
    console.info('Crownfall: lowering quality to hold the frame rate');
  }
}

function frame(t, xrFrame) {
  const now = t || performance.now();
  const rawDt = last ? (now - last) / 1000 : 0.016;
  const dt = Math.min(0.05, rawDt);
  last = now;
  watchQuality(rawDt);
  if (!renderer.xr.isPresenting && controls.enabled) controls.update();

  const camObj = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  camObj.getWorldPosition(fadeSphere.position);

  for (const controller of controllers) {
    const laser = controller.getObjectByName('laser');
    if (!laser) continue;
    const hand = controller.userData.handedness;
    laser.visible = renderer.xr.isPresenting && game.phase !== 'combat' && (!clickHand || hand === clickHand);
    if (!laser.visible) continue;
    const line = laser.children[0];
    laser.updateWorldMatrix(true, false);
    laser.getWorldPosition(_aimOrigin);
    _aimDir.set(0, 0, -1).applyQuaternion(laser.getWorldQuaternion(_seatQ));
    raycaster.set(_aimOrigin, _aimDir);
    const hit = raycaster.intersectObject(tabletop.boardTop, false)[0];
    if (line) line.scale.z = hit ? Math.max(0.05, _aimOrigin.distanceTo(hit.point)) : 1.5;
  }
  tabletop.turnSprite.visible = renderer.xr.isPresenting && !combatView;
  placeExitPlaque();
  exitPlaque.visible = renderer.xr.isPresenting && !placing;

  updateHitTest(xrFrame);
  if (renderer.xr.isPresenting && xrKind === 'vr') seatInFront(xrFrame);
  movePlayer(dt);
  if (input.primaryPressed || mouseMag > 34 || dragSpeed > 32) input.slash = true;
  mouseMag = 0;
  dragSpeed = 0;

  tabletop.update(dt, fadeSphere.position);
  // Sim stands on the floor: the headset's own floor when it gives one, otherwise table height below the board.
  board.getWorldPosition(_simAt);
  sim.update(dt, { visible: simPlays() && board.visible && !combatView && !placing, floorY: renderer.xr.isPresenting && floorBased ? 0 : _simAt.y - 0.95 });
  updateHands();
  if (combat.isActive()) combat.update(dt, input);

  input.primaryPressed = false;
  input.primaryReleased = false;
  input.slash = false;
  renderer.render(scene, camera);
}

let last = 0;
const _simAt = new THREE.Vector3();
renderer.setAnimationLoop(frame);

function onResize() {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', onResize);
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());

// Right mouse button raises the shield in a sword clash.
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button === 2 && game.phase === 'combat') input.block = true;
});
window.addEventListener('pointerup', (event) => {
  if (event.button === 2) input.block = false;
});
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  ptr = { x: event.clientX, y: event.clientY, id: event.pointerId, dragged: false };
  if (game.phase === 'combat' && !renderer.xr.isPresenting) {
    input.primaryDown = true;
    input.primaryPressed = true;
    if (event.pointerType === 'mouse' && document.pointerLockElement !== renderer.domElement) {
      // Some browsers and embedded views refuse pointer lock; play on
      // without it rather than raising an error.
      try {
        renderer.domElement.requestPointerLock()?.catch?.(() => {});
      } catch {
        /* pointer lock unavailable */
      }
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
  if (event.code === 'KeyQ' && combatView) input.block = true;
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'KeyQ') input.block = false;
  keys[event.code] = false;
});

btnPlay.addEventListener('click', () => voiceThenStart(() => {
  menu = false;
  controls.enabled = true;
  updateHUD();
  simGreet();
}));
$('btn-sim-log').addEventListener('click', () => {
  $('sim-log').hidden = !$('sim-log').hidden;
});
// Getting the key onto a headset, where pasting is awkward: the headset shows a short code, the
// computer that has the key types the code, and the key travels straight from one browser to the
// other (the same device-to-device link online play uses; the broker only ever sees the code).
let pairing = null;
const pairMsg = (text) => { $('pair-msg').textContent = text; };
const stopPairing = () => {
  if (pairing) pairing.close();
  pairing = null;
};
$('pair-receive').addEventListener('click', async () => {
  unlockAudio();
  stopPairing();
  const code = makeCode();
  pairMsg('Getting a code…');
  try {
    pairing = await openRoom({
      role: 'host',
      code: 'K' + code,
      onStatus: (state, detail) => {
        if (state === 'connected') pairMsg('The computer has connected. Waiting for the key…');
        else if (state === 'error') pairMsg(detail || 'Connection problem. Try again.');
      },
      onMessage: (msg) => {
        if (msg?.t !== 'key' || typeof msg.key !== 'string' || !/^sk-[\w-]{20,}$/.test(msg.key.trim())) {
          pairMsg('What arrived did not look like an OpenAI key (it should start with sk-).');
          pairing?.send({ t: 'key-bad' });
          return;
        }
        sim.setKey(msg.key.trim());
        pairing?.send({ t: 'key-ok' });
        $('pair-code').hidden = true;
        pairMsg('Key received and saved on this device.');
        setTimeout(stopPairing, 1500);
        talkToSim();
      },
    });
    $('pair-code').textContent = code;
    $('pair-code').hidden = false;
    pairMsg('On your computer, open this same page, open “Key is on another device?”, type this code and paste the key.');
  } catch (err) {
    pairMsg(err?.message || 'Could not get a code. Check the internet connection.');
  }
});
$('pair-send').addEventListener('click', async () => {
  const code = cleanCode($('pair-code-in').value).slice(0, 5);
  const key = $('pair-key').value.trim().replace(/^["']|["']$/g, '');
  if (code.length !== 5) return pairMsg('Type the 5-character code shown on the headset.');
  if (!/^sk-[\w-]{20,}$/.test(key)) return pairMsg('That does not look like an OpenAI key (it should start with sk-).');
  stopPairing();
  pairMsg('Connecting to the headset…');
  let delivered = false;
  const giveUp = setTimeout(() => { if (!delivered) pairMsg('No answer from the headset. Check the code, and that the headset is still showing it.'); }, 15000);
  try {
    pairing = await openRoom({
      role: 'join',
      code: 'K' + code,
      onStatus: (state, detail) => {
        if (state === 'connected') {
          pairing.send({ t: 'key', key });
          pairMsg('Sent. Waiting for the headset to confirm…');
        } else if (state === 'error') pairMsg(detail?.replace('No game with that code', 'No headset is showing that code').replace('the other player is still waiting', 'the headset is still showing it') || 'Connection problem.');
      },
      onMessage: (msg) => {
        if (msg?.t === 'key-ok') {
          delivered = true;
          clearTimeout(giveUp);
          $('pair-key').value = '';
          pairMsg('Delivered. The headset has the key now.');
          setTimeout(stopPairing, 1000);
        } else if (msg?.t === 'key-bad') pairMsg('The headset rejected it: not a valid-looking key.');
      },
    });
  } catch (err) {
    clearTimeout(giveUp);
    pairMsg(err?.message || 'Could not connect.');
  }
});
// A link can also carry the key (…/crownfall/#key=sk-…): it is saved and removed from the address at once.
{
  const m = /[#&]key=(sk-[\w-]{20,})/.exec(location.hash);
  if (m) {
    sim.setKey(m[1]);
    history.replaceState(null, '', location.pathname + location.search);
  }
}

// Sim's voice. The key is kept in this browser and sent only to OpenAI.
$('sim-key-save').addEventListener('click', () => {
  const key = $('sim-key').value.trim().replace(/^["']|["']$/g, '');
  if (key) sim.setKey(key);
  $('sim-key').value = '';
  unlockAudio();
  talkToSim();
});
$('btn-sim').addEventListener('click', () => {
  unlockAudio();
  talkToSim();
});
$('sim-build').textContent = 'Build ' + (typeof __BUILD__ === 'string' ? __BUILD__ : 'dev');
sim.canGoLive().then((can) => { if (can && !sim.hasKey()) $('sim-status').textContent = 'Sim’s live voice is ready: it starts when you start a game. No key needed.'; });
$('sim-status').textContent = sim.hasKey() ? 'A key is saved: her voice starts when you start a game.' : 'No key needed to play: Sim talks with the browser’s built-in voice and coaches you. Add an OpenAI key if you want to talk back to her.';
btnAr.addEventListener('click', () => voiceThenStart(() => enterXR('ar')));
btnVr.addEventListener('click', () => voiceThenStart(() => enterXR('vr')));
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
  tabletop.refresh(game);
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
    reseat();
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
// Back before anyone has joined closes the room, so local play works again.
$('btn-online-back').addEventListener('click', () => {
  if (online && !opponentHere) leaveOnline(false);
  showOnlinePanel(false);
});

function leaveOnline(tellOpponent = true) {
  if (online && tellOpponent && opponentHere) online.send({ t: 'leave' });
  online?.close();
  online = null;
  mySide = null;
  reseat();
  opponentHere = false;
  remoteFight = null;
  hostDealt = false;
  vsComputer = true;
  btnOpponent.textContent = 'Vs computer';
  onlineShare.classList.add('hidden');
  setOnlineMsg('');
  restart();
  toast('Back to playing on this device against the computer.');
}

$('btn-leave').addEventListener('click', () => {
  if (!online) return;
  if (window.confirm('Leave the online game?')) leaveOnline(true);
});

$('btn-resign').addEventListener('click', () => {
  if (!online || game.phase !== 'play' || remoteFight) return;
  if (!window.confirm('Resign this game?')) return;
  game.phase = 'over';
  game.winner = 1 - mySide;
  game.draw = false;
  game.selected = null;
  lastMove = `${SIDE_NAME[mySide]} resigned`;
  tabletop.refresh(game);
  showGameOver();
  sendAction('resign');
});
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
  tabletop.refresh(game);
  toast(vsComputer ? `${SIDE_NAME[COMPUTER_SIDE]} is played by the computer.` : 'Two players: take turns on this device.');
  updateHUD();
  scheduleComputer();
});

btnSound.addEventListener('click', () => {
  unlockAudio();
  const muted = toggleMute();
  try {
    localStorage.setItem('crownfall-muted', muted ? '1' : '0');
  } catch {
    /* storage unavailable: the setting just isn't remembered */
  }
  updateHUD();
});
// Restore the last sound setting.
try {
  if (localStorage.getItem('crownfall-muted') === '1' && !isMuted()) toggleMute();
} catch {
  /* storage unavailable */
}
btnSound.textContent = isMuted() ? 'Sound off' : 'Sound on';

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

// For automated checks and for poking at the game from the browser console.
window.crownfall = { THREE, get game() { return game; }, sim, camera, controls, pick: (data) => handlePick(data), get toast() { return toastEl.textContent; } };
