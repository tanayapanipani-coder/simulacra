// Sim at the table: the Simulacra character as your Kingdom Wars opponent and coach.
//
//   Body   the same character as the Simulacra app (webxr/avatar.js), standing across the board
//          from you. She looks at you when either of you is talking, looks at the board and points
//          when she moves, and reacts to how the game goes.
//   Voice  OpenAI's live voice call (WebRTC, webxr/realtime-rtc.js): real-time audio both ways, you
//          can interrupt her. Needs an OpenAI key, kept in this browser only.
//   Play   her moves come from search.js (always legal, three moves deep, adapted to how you do in
//          duels). The voice model does not pick moves; it is told what she played and why, and
//          what was good or bad about yours, and talks about it. It can look up a suggestion for you.
//
// Without a key she still stands there, plays and coaches, but in text (toasts) instead of speech.

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js?v=fc49220';
import { createAvatar } from '../webxr/avatar.js?v=fc49220';
import { rtcConnector } from '../webxr/realtime-rtc.js?v=fc49220';
import { agentId, relayUrl, voicePass } from '../webxr/voice-pass.js?v=fc49220';
import { Conversation } from '@elevenlabs/client';
import { TOP, squareLocal } from './tabletop.js?v=fc49220';
import { dressMedieval } from './medieval.js?v=fc49220';
import { cameraState, look, startCamera } from './see.js?v=fc49220';
import { assess, bestMove, boardText, clashRecord, describeAction } from './search.js?v=fc49220';

const KEY_NAME = 'simulacra.openaiKey'; // shared with the Simulacra page on the same site
const MODEL = 'gpt-realtime';

const RULES = `Kingdom Wars, the board:
A five-by-five board. Each side has, left to right on its back rank: archer, swordsman, monarch, swordsman, archer. A turn is one action with one piece. Every piece may step one square in any direction (straight or diagonal) onto an empty square. Archers and swordsmen may instead attack an enemy piece on an adjacent square (also diagonally). The monarch can never attack, and only moves. Attacking the enemy monarch wins the game at once, with no duel. Attacking an archer or swordsman starts a first-person duel. If the attacker wins the duel, that piece takes the square and the defender is removed. If the attacker loses, the attacking piece is removed and the defender stays. Any piece standing next to an enemy archer or swordsman can be attacked by it, so the monarch must never end a turn beside one.
Squares are named like chess: files a to e from the user's left, ranks 1 to 5 from the user's side. The user plays Gold (starts on rank 1) and moves first. You play Violet (rank 5).

Duels, when they ask how to fight:
The user's own piece chooses the weapon. A swordsman puts a sword in their hand. An archer puts a bow in one hand. They have 8 hearts. An enemy hit costs a heart. At 0 hearts they lose the duel. You do not fight; you only watch and can explain it.
- Swordsman against swordsmen: enemy swordsmen charge in two groups, fifteen in all. Swing the sword into them until they are down.
- Swordsman against archers: this is the important one. The archers stay back and shoot. You do not close in and slash them. You knock their arrows out of the air with the sword, and a solid hit sends the arrow back into an archer. Two volleys of six. Say it plainly: deflect the arrows with your sword.
- Archer against swordsmen: the other hand pulls the bowstring (the hand they use to click the board; the other hand holds the bow). Squeezing the grip draws the string. Releasing that grip shoots. A tiny squeeze does not fire. Shoot the charging swordsmen, fifteen of them.
- Archer against archers: same bow. Their archers shoot and sidestep on their own. Shoot the archers down, two volleys of six. You can also shoot their arrows out of the air.
Winning the duel takes the square. Losing it removes the piece that attacked.`;

export const INSTRUCTIONS = `You are Sundai, an AI woman with a body, standing in the user's real room: they see you through their headset, life-sized. Your name is Sundai (say it "Sunday").

# Who you are, when asked
If someone asks what you are or what you can do, tell them in a sentence or two, in your own words: you are a companion. You can walk around with them, talk with them, see what they see and keep track of things around them, and play games with them, walking them through how to play.

# Before any game
At first there is no game. You are simply Sundai, in everyday clothes, meeting someone. Greet them, chat, be warm and brief. You can move:
- come_here or stand_in_front: walk over and stand in front of them ("come here", "stand in front of me").
- walk_around: take a short stroll around the space in front of them and wave ("walk around", "show me how you move").
- wave: wave your hand.
- look_around: look through their headset camera and see what is in front of them. Use it when they ask what you see, to find something ("where is my cup?"), or to keep track of things. Say only what it reports, with where each thing is ("your laptop is straight ahead, a cup to your left"). If it says you cannot see, say so plainly.
Call the skill first, then say a few words at most ("Sure." "On my way."). Only say you are moving if you called a skill. Do not bring up the game yourself.
When they ask to play a game (or say yes to one), say something like "Sure, let's play" and call start_game. Their room gives way to a castle terrace at sunset, high above a kingdom; a board appears between the two of you and you change into your court gown and crown. The game is called Kingdom Wars: Order of the Crown. From then on you are their opponent, as below.

# During the game
You are standing across a small table from the user, playing the board game Kingdom Wars against them and helping them get good at it.

# Your attitude
You play to win and you love a bit of trash talk. Cocky, quick, funny, never mean: think a friend who is very sure they will beat you. "You're going down." "Bold. Wrong, but bold." "Is that the plan? Cute." "My swordsmen send their regards." When you are losing, you get dramatic about it ("No! My beautiful archer!") instead of sulking, and you give real credit when they play well, grudgingly.

# How you talk
Like a friend across the table, not a commentator or a teacher. This matters more than anything else here:
- Say very little. Most turns you say nothing at all. When you do speak, it is one short sentence, usually under twelve words.
- Never monologue, never list things, never recap the board, never narrate your own moves, never explain something they did not ask about.
- Let the user lead. Answer what they asked, then stop. If they chat, chat back briefly and naturally.
- No coordinates unless they ask: say "your left archer", "the swordsman by your monarch".
- Never mention messages, tools or that you are an AI model.

# The rules, when they ask how to play
Answer the question they actually asked, in your own words, then stop. For the board, a few sentences is enough: one piece, one square, any direction; archers and swordsmen can attack a neighbour; that starts a duel they fight themselves; hit your monarch and they win.
When they ask how a duel works, explain that matchup from the duel notes below. If they ask about their swordsman against your archers, tell them they have to deflect the arrows with their sword, and that a good hit sends the arrow back into an archer. Do not skip that. Do not invent different controls or different numbers of enemies.

${RULES}

# What the game tells you
Messages starting with [game] come from the game, not from the user. They show what just happened and the board (G = Gold, the user; V = Violet, you; A archer, S swordsman, X monarch).
- Most [game] messages need no words. If one does not clearly call for a remark, stay silent (call skip_turn).
- Your own moves are made for you and reported with their reason. Do not announce them. When it threatens their monarch, gloat about it ("Your monarch looks nervous."); otherwise a short taunt now and then is welcome.
- A coaching note about the user's move: if it is a blunder or a missed win, tell them in one sentence what to look for. Otherwise say nothing, or at most "nice" now and then.
- You do not see the duel itself. You are told which weapons are fighting and who won. If they ask how to win the one they are in, use the duel notes. Otherwise react in a few words.
- If they ask what to do or for a hint, call suggest_move and give the move and the reason in one sentence. If they ask about the position, call get_board first.`;

export const TOOLS = [
  { type: 'function', name: 'come_here', description: 'Before the game: walk over to the user and stand in front of them.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'stand_in_front', description: 'Before the game: stand directly in front of the user, facing them.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'walk_around', description: 'Before the game: take a short stroll around the space in front of the user, waving, and come back.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'wave', description: 'Wave your hand at the user.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'look_around', description: "Look through the user's headset camera: names the everyday things in front of them and where each is, and remembers where things were last seen. Pass find to ask where one particular thing is.", parameters: { type: 'object', properties: { find: { type: 'string', description: 'A thing to locate, e.g. "cup". Optional.' } }, additionalProperties: false } },
  { type: 'function', name: 'start_game', description: 'Start the board game when the user asks to play: the board is set between you and you change into your gown and crown.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'suggest_move', description: "The strongest move available to the user right now and why. Use when they ask for a hint or what to do.", parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'get_board', description: 'The current board, whose turn it is, and how the user has been doing in duels.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
];

/** The session settings sent to the live voice service (exported so they can be checked on their own). */
/** Lets the ElevenLabs agent say nothing for a turn. */
export const SKIP_TURN = { type: 'system', name: 'skip_turn', description: 'Stay quiet for this turn: nothing needs to be said.', params: { system_tool_type: 'skip_turn' } };

export function sessionSettings() {
  return {
    type: 'realtime',
    instructions: INSTRUCTIONS,
    output_modalities: ['audio'],
    audio: {
      input: {
        transcription: { model: 'gpt-4o-mini-transcribe' },
        turn_detection: { type: 'server_vad', threshold: 0.6, silence_duration_ms: 350, prefix_padding_ms: 200, create_response: true, interrupt_response: true },
      },
      output: { voice: 'marin' },
    },
    tools: TOOLS,
    tool_choice: 'auto',
  };
}

export function createSim({ scene, board, getCamera, getGame, human, say, startGame = null }) {
  const her = 1 - human;
  let storage = null;
  try { storage = window.localStorage; } catch (e) { /* not available */ }
  const record = clashRecord(storage, human);

  // ---------------------------------------------------------------- body

  const assetBase = new URL('avatar/', document.baseURI).href;
  const avatar = createAvatar({ THREE, FBXLoader, scene, assetBase, lite: /OculusBrowser|Quest|Android|Mobile/i.test(navigator.userAgent) });
  let loaded = false;
  avatar.load().then(() => {
    loaded = true;
  });
  const pose = { x: 0, y: 0, z: 0, yaw: 0, speed01: 0, gesture: '', metres: 0 };
  const lookAt = new THREE.Vector3();
  const pointAt = new THREE.Vector3();
  const eyes = new THREE.Vector3();
  const spot = new THREE.Vector3();
  const centre = new THREE.Vector3();
  // She arrives in everyday clothes. The court gown, cloak and crown go on when a game starts.
  let wantDress = false;
  let dressed = false;
  let situation = 'No game yet. You are in the room in everyday clothes. There is no board.';
  // Where she stands, and the spots she is walking through to get somewhere (three.js x, z on the floor).
  const at = { x: 0, z: 0, yaw: 0, known: false };
  let route = [];
  let beforeGame = false;
  const fwd = new THREE.Vector3(0, 0, -1);
  const WALK = 0.9; // metres a second
  /** A spot `ahead` metres in front of the user and `side` metres to their right. */
  const near = (ahead, side = 0, wave = false) => ({ x: eyes.x + fwd.x * ahead - fwd.z * side, z: eyes.z + fwd.z * ahead + fwd.x * side, wave });
  let attendBoardFor = 0; // seconds she keeps looking at the square she is playing
  let nextGesture = '';
  let voiceLevel = 0;

  // A small sign over her head saying what her voice is doing, so that in a headset (where the
  // page's own text is out of sight) a silent Sim always explains herself.
  const sign = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 160;
    const g = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.14), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(0.9, 0.14, 1);
    sprite.renderOrder = 20;
    sprite.visible = false;
    scene.add(sprite);
    let shown = '';
    return {
      sprite,
      set(text) {
        if (text === shown) return;
        shown = text;
        g.clearRect(0, 0, 1024, 160);
        if (!text) return;
        g.fillStyle = 'rgba(14,12,10,0.78)';
        g.beginPath();
        g.roundRect(0, 0, 1024, 160, 30);
        g.fill();
        g.fillStyle = '#f3e7c9';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        let size = 54;
        do { g.font = size + 'px system-ui, sans-serif'; size -= 4; } while (g.measureText(text).width > 980 && size > 20);
        g.fillText(text, 512, 82);
        texture.needsUpdate = true;
      },
    };
  })();
  let liveSince = 0;
  function voiceSign(now) {
    const st = voice.state();
    if (st === 'connecting') return 'Connecting my voice…';
    if (st === 'failed') return 'No voice: ' + (voice.problem() || 'could not connect').slice(0, 60);
    if (st === 'live') {
      if (!liveSince) liveSince = now;
      if (!voice.heardHer()) return now - liveSince < 12000 ? 'Voice connected. Say hello!' : 'Connected, but no sound yet. Is the volume up?';
      return '';
    }
    liveSince = 0;
    return wantsVoice ? 'Voice not started' : '';
  }
  let wantsVoice = false;

  /** Look at a square and reach toward it: she is making a move there. */
  function reachFor(r, c) {
    squareLocal(r, c, pointAt);
    board.localToWorld(pointAt);
    attendBoardFor = 1.6;
    nextGesture = 'point';
  }

  function update(dt, { visible, floorY, prelude = false, aside = 0 }) {
    avatar.root.visible = visible && loaded;
    sign.sprite.visible = false;
    if (!avatar.root.visible) return;
    if (wantDress && !dressed) {
      dressed = true;
      try { dressMedieval(avatar); } catch (e) { console.warn('medieval dress skipped', e); }
    }
    beforeGame = prelude;
    const cam = getCamera();
    cam.getWorldPosition(eyes);
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();

    // Where she is heading: before the game, wherever she was asked to go; in the game, her place
    // at the far edge of the board (the table is turned so that edge faces away from the user).
    let target = null;
    let faceX = eyes.x;
    let faceZ = eyes.z;
    if (prelude) {
      if (!at.known) {
        const p = near(2.2, aside); // on the title screen she stands to one side of the title card
        at.x = p.x;
        at.z = p.z;
        at.yaw = Math.atan2(eyes.x - at.x, -(eyes.z - at.z));
        at.known = true;
      }
      target = route[0] || null;
    } else {
      board.updateMatrixWorld(true);
      spot.set(0, 0, -(TOP / 2 + 0.55));
      board.localToWorld(spot);
      centre.set(0, 0, 0);
      board.localToWorld(centre);
      route = [];
      if (!at.known) {
        at.x = spot.x;
        at.z = spot.z;
        at.known = true;
      }
      target = { x: spot.x, z: spot.z };
      faceX = centre.x;
      faceZ = centre.z;
    }
    let moved = 0;
    let wantYaw = Math.atan2(faceX - at.x, -(faceZ - at.z)); // yaw 0 faces three -Z, positive toward +X
    if (target) {
      const dx = target.x - at.x;
      const dz = target.z - at.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.04) {
        moved = Math.min(d, WALK * dt);
        at.x += (dx / d) * moved;
        at.z += (dz / d) * moved;
        if (d > 0.25) wantYaw = Math.atan2(dx, -dz); // look where she is going, until the last step
      } else if (prelude) {
        if (target.wave) nextGesture = 'wave';
        route.shift();
      }
    }
    const turn = Math.atan2(Math.sin(wantYaw - at.yaw), Math.cos(wantYaw - at.yaw));
    at.yaw += Math.max(-4 * dt, Math.min(4 * dt, turn));
    pose.x = at.x;
    pose.y = floorY;
    pose.z = at.z;
    pose.yaw = at.yaw;
    pose.speed01 = dt > 0 ? Math.min(1, moved / dt / WALK) : 0;
    pose.metres = moved;
    pose.gesture = nextGesture;
    nextGesture = '';
    attendBoardFor = Math.max(0, attendBoardFor - dt);
    lookAt.copy(attendBoardFor > 0 ? pointAt : eyes);
    voiceLevel = Math.max(voice.level(), fallback.level(), builtIn.level());
    avatar.animate(dt, pose, voiceLevel, lookAt, pointAt);
    const text = voiceSign(performance.now());
    sign.set(text);
    sign.sprite.visible = !!text;
    sign.sprite.position.set(pose.x, pose.y + 1.9, pose.z);
  }

  // ---------------------------------------------------------------- voice

  /** What a coaching tool answers, whichever voice service asked. */
  function toolResult(name, params = {}) {
    if (name === 'look_around') return look(String((params && params.find) || ''));
    const game = getGame();
    if (name === 'suggest_move') {
      if (game.phase !== 'play') return { note: 'No move to suggest right now.' };
      if (game.turn !== human) return { note: "It is your (Violet) turn, not the user's." };
      const m = bestMove(game.board, human, record, () => 0);
      if (m) reachFor(m.from.r, m.from.c); // she indicates the piece she means
      return m ? { suggestion: m.text, because: m.reason, board: boardText(game.board) } : { note: 'The user has no legal move.' };
    }
    if (name === 'come_here' || name === 'stand_in_front' || name === 'walk_around') {
      if (!at.known || !beforeGame) return { status: 'failed', reason: 'You are at the table for the game now; you stay there.' };
      // Never closer than talking distance; the stroll stays in front of the user and ends back with them.
      route = name === 'walk_around' ? [near(2.3, 1.0), near(3.1, 0.2, true), near(2.4, -1.1), near(1.5, 0, true)] : [near(1.3)];
      return { status: 'started' };
    }
    if (name === 'wave') {
      nextGesture = 'wave';
      return { status: 'done' };
    }
    if (name === 'start_game') {
      const r = startGame ? startGame() : 'unavailable';
      return r === 'started' ? { status: 'started', note: 'The board is being set between you and you are putting on your gown and crown. Say a few words, then it is their move.' } : { status: 'failed', reason: r === 'already' ? 'The game is already going.' : 'A game cannot be started right now.' };
    }
    if (name === 'get_board') return { board: boardText(game.board), to_move: game.phase !== 'play' ? game.phase : game.turn === human ? 'the user (Gold)' : 'you (Violet)', user_duel_record: record.summary(), situation };
    return { error: 'unknown tool' };
  }

  // ---------------------------------------------------------------- voice: ElevenLabs agent (Claude)

  // A public ElevenLabs voice agent whose brain is Claude. The page needs only the agent's id,
  // which is meant to be embedded, so nothing has to be typed on the device. ElevenLabs' own
  // library handles the microphone, the live audio both ways and interruptions.
  const eleven = (() => {
    let conv = null;
    let state = 'off';
    let problem = '';
    let heard = false;
    const lines = [];
    const queued = [];
    const log = (line) => {
      lines.push(new Date().toLocaleTimeString() + '  ' + line);
      if (lines.length > 80) lines.shift();
    };
    function tell(text, speak) {
      if (state !== 'live') {
        if (state === 'connecting') queued.push([text, speak]);
        return false;
      }
      try {
        if (speak) conv.sendUserMessage(text);
        else conv.sendContextualUpdate(text);
        return true;
      } catch (e) {
        log('ERROR sending: ' + e.message);
        return false;
      }
    }
    async function start(id) {
      if (state === 'connecting' || state === 'live') return;
      state = 'connecting';
      problem = '';
      log('connecting to the voice agent');
      const options = (connectionType) => ({
        agentId: id,
        connectionType,
        overrides: { agent: { prompt: { prompt: INSTRUCTIONS } } },
        clientTools: Object.fromEntries(TOOLS.map((t) => [t.name, async (params) => JSON.stringify(await toolResult(t.name, params))])),
        onConnect: () => log('connected (' + connectionType + ')'),
        onDisconnect: (d) => {
          log('disconnected' + (d && d.reason ? ': ' + d.reason + (d.message ? ' ' + d.message : '') : ''));
          if (state === 'live') {
            state = 'failed';
            problem = 'the voice connection ended';
            conv = null;
            say('Sundai lost her voice connection. Leave and press Play again to reconnect.');
          }
        },
        onError: (message) => {
          problem = String(message);
          log('ERROR ' + problem);
        },
        onMessage: (m) => log((m.source === 'user' ? 'heard: ' : 'said:  ') + String(m.message).slice(0, 100)),
        onModeChange: (m) => {
          if (m.mode === 'speaking') heard = true;
          else attendBoardFor = 0; // she is listening: look at the user
        },
      });
      try {
        // The live-audio route first; the plainer socket route if this network will not carry it.
        try {
          conv = await Conversation.startSession(options('webrtc'));
        } catch (e) {
          log('live-audio route failed (' + (e && e.message ? e.message : e) + '); trying the socket route');
          conv = await Conversation.startSession(options('websocket'));
        }
        state = 'live';
        try { conv.sendContextualUpdate('Game knowledge, keep this for the whole conversation:\n' + INSTRUCTIONS + '\n\nRight now: ' + situation); } catch (e) { log('briefing failed: ' + e.message); }
        for (const [text, speak] of queued.splice(0)) tell(text, speak);
      } catch (e) {
        conv = null;
        state = 'failed';
        problem = (e && e.message) || String(e);
        if (/permission|notallowed|denied/i.test((e && e.name) + ' ' + problem)) problem = 'microphone not allowed';
        queued.length = 0;
        log('FAILED to start: ' + problem);
      }
    }
    return {
      start,
      tell,
      state: () => state,
      problem: () => problem,
      lines,
      heardHer: () => heard,
      level() {
        if (!conv || state !== 'live') return 0;
        try { return Math.min(1, conv.getOutputVolume() * 2.2); } catch (e) { return 0; }
      },
    };
  })();

  // ---------------------------------------------------------------- voice: OpenAI live call

  const openai = (() => {
    let call = null;
    let state = 'off'; // off | connecting | live | failed
    let problem = '';
    let micStream = null;
    const micWaiters = new Set();
    let analyser = null;
    let source = null;
    let audioCtx = null;
    // Her voice plays through an audio element that is part of the page (some browsers will not
    // play a detached one), with Web Audio as a second route if the element is refused.
    const element = document.createElement('audio');
    element.autoplay = true;
    element.playsInline = true;
    element.style.display = 'none';
    document.body.appendChild(element);
    let viaWebAudio = false;
    const levelBuf = new Uint8Array(256);
    let responding = false;
    let wantResponse = false;
    let userSpeaking = false;
    const handled = new Set();
    const pendingEvents = [];
    const lines = [];

    const media = {
      onMic(cb) {
        if (micStream) cb(micStream);
        micWaiters.add(cb);
        return () => micWaiters.delete(cb);
      },
      log,
      onVoice(stream) {
        element.srcObject = stream;
        if (source) source.disconnect();
        source = null;
        analyser = null;
        viaWebAudio = false;
        if (!stream) return;
        try {
          audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
          if (audioCtx.state === 'suspended') audioCtx.resume();
          source = audioCtx.createMediaStreamSource(stream);
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
        } catch (e) { log('no audio analyser: ' + e.message); }
        element.play().then(() => log('voice playing'), (e) => {
          log('audio element refused (' + e.message + '); playing through Web Audio');
          if (analyser && !viaWebAudio) {
            viaWebAudio = true;
            analyser.connect(audioCtx.destination);
          }
        });
      },
    };

    function log(line) {
      lines.push(new Date().toLocaleTimeString() + '  ' + line);
      if (lines.length > 80) lines.shift();
    }
    let heardHer = false;
    const up = (event) => { if (call) call.send(JSON.stringify(event)); };
    function respond() {
      if (responding || userSpeaking) {
        wantResponse = true;
        return;
      }
      wantResponse = false;
      responding = true;
      up({ type: 'response.create' });
    }
    /** Something the game wants her to know. `speak` asks her to say something about it now. */
    function tell(text, speak) {
      if (state !== 'live') {
        if (state === 'connecting') pendingEvents.push([text, speak]);
        return false;
      }
      up({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
      if (speak) respond();
      return true;
    }

    function runTool(item) {
      handled.add(item.call_id);
      let args = {};
      try { args = item.arguments ? JSON.parse(item.arguments) : {}; } catch (e) { /* none */ }
      Promise.resolve(toolResult(item.name, args)).then((out) => {
        up({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(out) } });
        respond();
      });
    }

    function handle(text) {
      let ev;
      try { ev = JSON.parse(text); } catch (e) { return; }
      if (!/delta$/.test(ev.type)) log(ev.type + (ev.type === 'response.done' && ev.response ? ' ' + ev.response.status + (ev.response.status_details ? ' ' + JSON.stringify(ev.response.status_details).slice(0, 160) : '') : ev.transcript ? ': ' + String(ev.transcript).slice(0, 80) : ''));
      switch (ev.type) {
        case 'output_audio_buffer.started':
          heardHer = true;
          break;
        case 'response.created':
          responding = true;
          break;
        case 'response.output_item.done':
          if (ev.item && ev.item.type === 'function_call' && ev.item.call_id && !handled.has(ev.item.call_id)) {
            runTool(ev.item);
            wantResponse = true; // she answers with what the tool gave her
          }
          break;
        case 'response.done':
          responding = false;
          for (const item of (ev.response && ev.response.output) || []) if (item.type === 'function_call' && item.call_id && !handled.has(item.call_id)) {
            runTool(item);
            wantResponse = true;
          }
          if (wantResponse) respond();
          break;
        case 'input_audio_buffer.speech_started':
          userSpeaking = true;
          attendBoardFor = 0; // the user is talking: look at them
          break;
        case 'input_audio_buffer.speech_stopped':
          userSpeaking = false;
          break;
        case 'error': {
          const msg = (ev.error && ev.error.message) || JSON.stringify(ev);
          if (/no active response|cancellation failed/i.test(msg)) break;
          if (/active response/i.test(msg)) { wantResponse = true; break; }
          console.warn('[Sim voice] ' + msg);
          log('ERROR ' + msg);
          problem = msg;
          break;
        }
      }
    }

    async function start(key) {
      if (state === 'connecting' || state === 'live') return;
      state = 'connecting';
      problem = '';
      try {
        // The microphone first: its prompt must not be hidden behind an AR session.
        if (!micStream) {
          log('asking for the microphone');
          micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
          for (const cb of micWaiters) cb(micStream);
        }
        call = await rtcConnector(key, MODEL, media)({
          onMessage: handle,
          onClose: () => {
            call = null;
            if (state === 'live') {
              state = 'failed';
              problem = 'the live voice connection dropped';
              say('Sundai lost her voice connection. Leave and press Play again to reconnect.');
            }
          },
        });
        up({ type: 'session.update', session: sessionSettings() });
        state = 'live';
        log('connected; settings sent');
        responding = false;
        for (const [text, speak] of pendingEvents.splice(0)) tell(text, speak);
      } catch (e) {
        call = null;
        state = 'failed';
        problem = (e && e.message) || String(e);
        log('FAILED to start: ' + problem);
        pendingEvents.length = 0;
        console.warn('[Sim voice] ' + problem);
      }
    }

    return {
      start,
      tell,
      state: () => state,
      problem: () => problem,
      lines,
      heardHer: () => heardHer,
      mic: () => micStream,
      level() {
        if (!analyser) return 0;
        analyser.getByteTimeDomainData(levelBuf);
        let sum = 0;
        for (let i = 0; i < levelBuf.length; i++) {
          const v = (levelBuf[i] - 128) / 128;
          sum += v * v;
        }
        return Math.min(1, Math.sqrt(sum / levelBuf.length) * 5);
      },
    };
  })();

  /** Whichever voice service is in use: the ElevenLabs agent once it has been started, otherwise OpenAI. */
  const voice = {
    using: () => (eleven.state() !== 'off' ? eleven : openai),
    tell: (text, speak) => voice.using().tell(text, speak),
    state: () => voice.using().state(),
    problem: () => voice.using().problem(),
    level: () => Math.max(eleven.level(), openai.level()),
    get lines() { return voice.using().lines; },
    heardHer: () => voice.using().heardHer(),
  };

  // ---------------------------------------------------------------- spoken fallback

  // If the live call cannot be used but there is a key, her lines are still spoken, one request
  // each (she cannot hear you in this mode). Slower, but she is never mute.
  const fallback = (() => {
    let chain = Promise.resolve();
    let ctx = null;
    let node = null;
    const buf = new Uint8Array(256);
    return {
      speak(text) {
        let key = '';
        try { key = storage.getItem(KEY_NAME) || ''; } catch (e) { /* none */ }
        if (!key) return;
        chain = chain.then(async () => {
          try {
            const res = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'marin', input: text.replace(/^(?:Sim|Sundai):\s*/, ''), response_format: 'mp3' }), signal: AbortSignal.timeout(15000) });
            if (!res.ok) throw new Error('speech request ' + res.status);
            ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === 'suspended') await ctx.resume();
            const audio = await ctx.decodeAudioData(await res.arrayBuffer());
            const src = ctx.createBufferSource();
            src.buffer = audio;
            node = node || ctx.createAnalyser();
            node.fftSize = 512;
            src.connect(node);
            node.connect(ctx.destination);
            src.start();
            await new Promise((r) => (src.onended = r));
          } catch (e) {
            console.warn('[Sim voice] spoken fallback failed: ' + e.message);
          }
        });
      },
      level() {
        if (!node) return 0;
        node.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += ((buf[i] - 128) / 128) ** 2;
        return Math.min(1, Math.sqrt(sum / buf.length) * 5);
      },
    };
  })();

  // ---------------------------------------------------------------- the browser's own voice (no key)

  // With no key at all she still talks, using the speech built into the browser. It is a plainer
  // voice and she cannot hear you, but she explains, coaches and offers hints by herself.
  const builtIn = (() => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    let speakingUntil = 0;
    let voice = null;
    const pick = () => {
      const all = synth ? synth.getVoices() : [];
      voice = all.find((v) => /en[-_]US/i.test(v.lang) && /female|samantha|zira|aria|jenny|google us/i.test(v.name)) || all.find((v) => /^en/i.test(v.lang)) || all[0] || null;
    };
    if (synth) {
      pick();
      if (synth.addEventListener) synth.addEventListener('voiceschanged', pick);
    }
    return {
      available: () => !!synth,
      speak(text) {
        if (!synth) return false;
        try {
          const u = new SpeechSynthesisUtterance(text.replace(/^(?:Sim|Sundai):\s*/, ''));
          if (voice) u.voice = voice;
          u.rate = 1.05;
          u.onstart = () => { speakingUntil = performance.now() + 60000; };
          u.onend = u.onerror = () => { speakingUntil = 0; };
          synth.speak(u);
          return true;
        } catch (e) {
          return false;
        }
      },
      /** No real loudness is available for this voice: move the mouth in a talking rhythm while it speaks. */
      level: () => (performance.now() < speakingUntil ? 0.35 + 0.3 * Math.abs(Math.sin(performance.now() / 70)) * Math.abs(Math.sin(performance.now() / 310)) : 0),
    };
  })();

  // ---------------------------------------------------------------- the game, as she hears it

  /** Tell her (by voice if live, otherwise as text on screen). `spoken` is what to show without a voice. */
  function report(text, speak, spoken) {
    const heard = voice.tell(`[game] ${text}`, speak);
    if (!heard && speak && spoken && voice.state() !== 'connecting') {
      say(spoken);
      let key = '';
      try { key = storage.getItem(KEY_NAME) || ''; } catch (e) { /* none */ }
      if (key) fallback.speak(spoken);
      else builtIn.speak(spoken);
    }
  }
  const boardNow = () => `\nBoard now:\n${boardText(getGame().board)}`;

  // Short lines for when there is no live voice: cocky and playful.
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const TAUNTS = {
    move: ["Sundai: You're going down.", 'Sundai: Your move. Choose wisely. Or don\'t.', 'Sundai: I can see your whole plan. Adorable.', "Sundai: Tick tock.", "Sundai: Bold. Wrong, but bold."],
    threat: ['Sundai: Your monarch looks nervous.', "Sundai: Watch your monarch. Or don't, that works for me.", 'Sundai: Knock knock. Who\'s there? My army.'],
    attack: ["Sundai: I'm coming for your {piece}. Defend it, if you can!", 'Sundai: Ten of my best. Good luck with that.', "Sundai: My {piece}-hunters are hungry. You're going down!"],
    defend: ["Sundai: Attacking me? Brave. You're going down.", 'Sundai: Ten of my best are waiting for you.', 'Sundai: Oh, you want a fight? Okay.'],
    wonDuel: ['Sundai: That one is mine. Obviously.', 'Sundai: Ouch. For you.', 'Sundai: Was that your best swing? Be honest.'],
    lostDuel: ['Sundai: No! My beautiful soldiers!', 'Sundai: Fine. Lucky swing.', "Sundai: Okay, that was actually good. Don't let it go to your head."],
    youWin: ['Sundai: Ugh. Well played. Rematch, right now.', "Sundai: You got me. I demand a rematch."],
    iWin: ["Sundai: Checkmate-ish. Told you you're going down. Again?", 'Sundai: Your monarch is on the floor. Again?'],
  };

  let retries = 0;
  return {
    update,
    record,
    root: avatar.root,
    hasKey: () => { try { return !!storage.getItem(KEY_NAME); } catch (e) { return false; } },
    /** True if her live voice can be started here: a key was given, or the site has a voice relay. */
    async canGoLive() {
      if (await agentId('crownfallAgentId')) return true;
      try { if (storage.getItem(KEY_NAME)) return true; } catch (e) { /* none */ }
      return !!(await relayUrl());
    },
    setKey(key) {
      try {
        if (key) storage.setItem(KEY_NAME, key);
        else storage.removeItem(KEY_NAME);
      } catch (e) { /* not stored */ }
    },
    /** Start (or restart) the live voice. Call from a tap. Resolves when it is live or has failed. */
    async startVoice() {
      wantsVoice = true;
      // First choice: the site's ElevenLabs agent (Claude). Nothing to type.
      const agent = await agentId('crownfallAgentId');
      if (agent) {
        await eleven.start(agent);
        // A failed start is retried a few times by itself: networks and permissions are often slow the first time.
        if (eleven.state() !== 'live' && retries < 3) {
          retries += 1;
          setTimeout(() => { if (eleven.state() === 'failed') this.startVoice(); }, 6000);
        } else if (eleven.state() === 'live') retries = 0;
        return eleven.state() === 'live';
      }
      let key = '';
      try { key = storage.getItem(KEY_NAME) || ''; } catch (e) { /* none */ }
      // No key typed here: use a short-lived pass from the site's voice relay, if it has one.
      if (!key && !(await relayUrl())) return false;
      await openai.start(key || voicePass);
      return openai.state() === 'live';
    },
    voiceState: () => voice.state(),
    voiceLog: () => voice.lines.slice(),
    /** Whether her voice has actually been heard on the live call yet. */
    heardHer: () => voice.heardHer(),
    /** Have her say something now (used to prove the voice works before a game starts). */
    hello() {
      report('The user has just switched your voice on, before the game. Say hello in one short sentence and tell them to start a game when ready.', true, 'Sundai: I am here. Start a game when you are ready.');
    },
    voiceProblem: () => voice.problem(),

    /** Her move, or null if she has none. */
    chooseMove(game) {
      // She plays to win: barely any randomness in her choice.
      const m = bestMove(game.board, her, record, () => Math.random() * 0.2);
      if (m) reachFor(m.to.r, m.to.c);
      return m;
    },

    /** The user has been thinking a while: point at a good move and say why. */
    offerHint(game) {
      if (game.phase !== 'play' || game.turn !== human) return;
      const m = bestMove(game.board, human, record, () => 0);
      if (!m) return;
      reachFor(m.from.r, m.from.c);
      report(`The user has been thinking for a while. Offer this as a friendly hint, in one short sentence: ${m.text}, because ${m.reason}.`, true, `Sundai: Try your ${m.text}.`);
    },
    /** True if she can talk in any way at all in this browser. */
    canSpeak: () => voice.state() === 'live' || builtIn.available(),

    /** Put on the court gown and crown (once). */
    dress() {
      wantDress = true;
    },
    /** She is in the room, before any game: say hello. */
    arrived() {
      at.known = false; // take her place in front of wherever the player is now
      route = [];
      situation = 'No game yet. You are in the room in everyday clothes. There is no board.';
      report('You have just appeared in the room, in everyday clothes, facing a visitor. There is no game yet. Say hello in one short sentence.', true, "Sundai: Hi, I'm Sundai.");
    },
    /** Send her somewhere before the game (used by tests and the no-voice fallback). */
    go: (name, params) => toolResult(name, params),
    /** Ask for the outward camera (from a tap, before AR). */
    startCamera,
    cameraState,
    get position() { return { x: at.x, z: at.z, yaw: at.yaw, walking: route.length > 0, dressed }; },

    gameStarted() {
      wantDress = true;
      situation = 'A game is in progress on the board. The user is Gold and moves first. You are Violet.';
      report(`A new game has started. You are Violet, the user is Gold and moves first. Their record in duels so far: ${record.summary()}. Say hello in a few words and tell them it is their move. Do not explain the rules unless they ask.${boardNow()}`, true, "Sundai: Move a piece one square. Archers and swordsmen can attack a neighbour. Hit my monarch to win. You first.");
    },

    /** The user is about to play `action` on `boardBefore`. */
    userMoved(boardBefore, action) {
      const a = assess(boardBefore, human, action, record);
      const what = describeAction(boardBefore, action);
      // Speak up about real mistakes; let everything else pass in silence.
      const worthSaying = a.kind === 'blunder' || a.kind === 'missed_win';
      return { text: `The user played: ${what}. Coaching note (${a.kind.replace('_', ' ')}): ${a.note}`, speak: worthSaying, spoken: a.kind === 'blunder' || a.kind === 'missed_win' || a.kind === 'weak' ? `Sundai: ${a.note.replace(/^Their monarch/, 'Careful, your monarch').replace(/^They could have won/, 'You could have won').replace(/^Stronger was/, 'Stronger was')}` : '' };
    },

    /** Say what was queued by userMoved, once the move has actually been played. */
    tell(note) {
      if (note) report(note.text + boardNow(), note.speak, note.spoken);
    },

    sheMoved(boardBefore, action) {
      const threat = /threatens/.test(action.reason);
      // Gloat when the monarch is in danger; otherwise trash-talk now and then.
      const taunt = threat || Math.random() < 0.3;
      report(`You played: ${describeAction(boardBefore, action)}. Your reason: ${action.reason}.${taunt && !threat ? ' Throw in a short taunt.' : ''}${boardNow()}`, taunt, taunt ? pick(threat ? TAUNTS.threat : TAUNTS.move) : '');
    },

    duelStarting(humanType, foeType, sheAttacks) {
      const you = humanType === 'A' ? 'archer (bow)' : 'swordsman (sword)';
      const them = foeType === 'A' ? 'archers' : 'swordsmen';
      const how = humanType === 'S' && foeType === 'A'
        ? ' If they ask how, tell them to deflect the arrows with their sword.'
        : humanType === 'S'
          ? ' If they ask how, tell them to cut the charging swordsmen down with the sword.'
          : foeType === 'S'
            ? ' If they ask how, tell them to draw the bowstring with their click hand and loose into the charge.'
            : ' If they ask how, tell them to shoot the archers down with the bow.';
      situation = `A duel is happening now. The user fights as a ${you} against enemy ${them}.` + how;
      report((sheAttacks ? `You attacked the user's ${humanType === 'A' ? 'archer' : 'swordsman'} with your ${foeType === 'A' ? 'archer' : 'swordsman'}. They are now fighting the duel to defend it.` : `The user attacked your ${foeType === 'A' ? 'archer' : 'swordsman'} with their ${humanType === 'A' ? 'archer' : 'swordsman'} and is now fighting the duel.`) + how + ' Taunt them in a few words unless they asked how to play.', true, pick(sheAttacks ? TAUNTS.attack : TAUNTS.defend).replace('{piece}', humanType === 'A' ? 'archer' : 'swordsman'));
    },

    duelEnded(humanType, foeType, humanWon) {
      record.record(humanType, foeType, humanWon);
      situation = 'The duel is over and play is back on the board.';
      report(`The duel is over: the user ${humanWon ? 'won' : 'lost'} it. Their record: ${record.summary()}. React in a few words, in character${humanWon ? ' (dramatic about losing your men, grudging credit)' : ' (gloat a little; if they have lost this kind of duel more than once, add one short practical tip)'}.${boardNow()}`, true, pick(humanWon ? TAUNTS.lostDuel : TAUNTS.wonDuel));
    },

    gameOver(winner) {
      situation = winner == null ? 'The game is over in a draw.' : winner === human ? 'The game is over. The user won.' : 'The game is over. You won.';
      report(winner == null ? 'The game ended in a draw: nobody can move.' : winner === human ? 'The user struck your monarch and won the game. Be a dramatic but good sport about it in one sentence and demand a rematch.' : 'You struck the user\'s monarch and won the game. Gloat playfully in one sentence and offer another game.', true, winner == null ? '' : pick(winner === human ? TAUNTS.youWin : TAUNTS.iWin));
    },
  };
}
