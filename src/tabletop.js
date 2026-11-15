import * as THREE from 'three';
import { GOLD, SIDE_NAME, options } from './rules.js?v=17c8dff';
import { createMiniature, metal, standard } from './pieces.js?v=17c8dff';
import { makeTextSprite, paintText, setSpriteText } from './text.js?v=17c8dff';

export const TOP = 0.4;
export const SQ = TOP / 5;

export function squareLocal(r, c, target = new THREE.Vector3()) {
  target.set((c - 2) * SQ, 0.034, (r - 2) * SQ);
  return target;
}

function boardTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const g = canvas.getContext('2d');
  g.fillStyle = '#1a1612';
  g.fillRect(0, 0, 1024, 1024);
  const cell = 1024 / 5;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const alt = (r + c) % 2 === 0;
      const x = c * cell;
      const y = r * cell;
      g.fillStyle = alt ? '#3a3128' : '#241e1a';
      g.fillRect(x + 8, y + 8, cell - 16, cell - 16);
      g.strokeStyle = 'rgba(214, 176, 96, 0.55)';
      g.lineWidth = 4;
      g.strokeRect(x + 10, y + 10, cell - 20, cell - 20);
      if (r === 2 && c === 2) {
        g.strokeStyle = 'rgba(232, 196, 120, 0.8)';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(x + cell / 2, y + cell / 2, cell * 0.22, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function shadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 20, 128, 128, 120);
  grd.addColorStop(0, 'rgba(0,0,0,0.45)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePanelMaterial(title, sub) {
  const tex = paintText(title, {
    width: 1024,
    height: 512,
    color: '#f6edd8',
    font: '700 84px Cinzel, Palatino, Georgia, serif',
    sub,
    subColor: '#e7d7a8',
    bg: 'rgba(18, 14, 12, 0.92)',
  });
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true });
}

const SIDE_HEX = ['#f0d48a', '#c9b6ff'];
const SIDE_GLOW = [0xffc94a, 0xa98bff];

/**
 * @param {THREE.Scene} scene
 * @param {object} [sfx] board sound hooks, called in sync with the pieces:
 *   onSlide(piece) when a piece starts moving, onLand(piece, kind) when it
 *   arrives (kind is 'place' or 'ping' for a takeover), onFall(piece) when a
 *   monarch hits the board.
 */
export function createTabletop(scene, sfx = {}) {
  const board = new THREE.Group();
  scene.add(board);

  const bodyMat = standard(0x221c18, 0.78);
  bodyMat.color.set(0x2a221c);
  const body = new THREE.Mesh(new THREE.BoxGeometry(TOP + 0.045, 0.024, TOP + 0.045), bodyMat);
  body.position.y = 0.012;
  board.add(body);

  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(TOP, TOP),
    new THREE.MeshStandardMaterial({
      map: boardTexture(),
      roughness: 0.72,
      metalness: 0.08,
    }),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.0245;
  board.add(top);

  const brass = metal(0xc6a15a, 0x3a2a10);
  const rimH = 0.012;
  const rimY = 0.028;
  const outer = TOP / 2 + 0.02;
  const rimGeoLong = new THREE.BoxGeometry(TOP + 0.05, rimH, 0.012);
  const rimGeoShort = new THREE.BoxGeometry(0.012, rimH, TOP + 0.028);
  const rimZ = new THREE.Mesh(rimGeoLong, brass);
  const rimZ2 = new THREE.Mesh(rimGeoLong, brass);
  const rimX = new THREE.Mesh(rimGeoShort, brass);
  const rimX2 = new THREE.Mesh(rimGeoShort, brass);
  rimZ.position.set(0, rimY, outer);
  rimZ2.position.set(0, rimY, -outer);
  rimX.position.set(outer, rimY, 0);
  rimX2.position.set(-outer, rimY, 0);
  board.add(rimZ, rimZ2, rimX, rimX2);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.78, 0.78),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.001;
  board.add(shadow);

  const goldLabel = makeTextSprite('GOLD', '#f0d48a', [0.14, 0.035]);
  goldLabel.position.set(0, 0.05, TOP / 2 + 0.055);
  const violetLabel = makeTextSprite('VIOLET', '#c9b6ff', [0.14, 0.035]);
  violetLabel.position.set(0, 0.05, -(TOP / 2 + 0.055));
  goldLabel.raycast = () => {};
  violetLabel.raycast = () => {};
  board.add(goldLabel, violetLabel);
  const labelScale = [0.14, 0.035];

  // Whose move it is, floating over the board in that side's colour, plus a
  // glowing bar along that side's edge. Both pulse when the turn changes.
  const turnSprite = makeTextSprite("Gold's move", SIDE_HEX[0], [0.3, 0.075]);
  // Beyond the far edge, clear of the board, so it never hides the pieces.
  turnSprite.position.set(0, 0.1, -(TOP / 2 + 0.16));
  turnSprite.raycast = () => {};
  board.add(turnSprite);
  const turnBars = [0, 1].map((side) => {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(TOP + 0.05, 0.006, 0.02),
      new THREE.MeshBasicMaterial({ color: SIDE_GLOW[side], transparent: true, opacity: 0.9 }),
    );
    bar.position.set(0, 0.037, side === 0 ? TOP / 2 + 0.02 : -(TOP / 2 + 0.02));
    bar.raycast = () => {};
    board.add(bar);
    return bar;
  });
  let turnPulse = 0;
  let shownTurn = null;
  const sideLabels = [goldLabel, violetLabel];

  // Game-over panel: a plaque with the result and a Play again button under
  // it. It floats over the middle of the board and turns to face the player
  // every frame (see update).
  const endPanel = new THREE.Group();
  endPanel.position.set(0, 0.2, 0);
  endPanel.visible = false;
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.16), makePanelMaterial('The monarch falls', ''));
  plaque.position.y = 0.06;
  const again = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.05, 0.014),
    metal(0xf0d48a, 0x5a4010),
  );
  again.position.set(0, -0.06, 0.01);
  again.userData.action = 'again';
  // The label is printed on the button's front face, so it stays centred on
  // the button from any angle.
  const againLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.17, 0.045),
    new THREE.MeshBasicMaterial({
      map: paintText('PLAY AGAIN', { width: 512, height: 128, color: '#2a2114', font: '700 64px Cinzel, Palatino, Georgia, serif' }),
      transparent: true,
    }),
  );
  againLabel.position.set(0, 0, 0.0075);
  againLabel.raycast = () => {};
  again.add(againLabel);
  endPanel.add(plaque, again);
  board.add(endPanel);

  const pieceShadowTex = shadowTexture();
  const meshes = new Map();
  const pickables = [];
  let markers = [];
  const clock = { t: 0 };

  const moveMat = new THREE.MeshStandardMaterial({
    color: 0x9ee7d2,
    emissive: 0x1d6a58,
    emissiveIntensity: 0.7,
    transparent: true,
    opacity: 0.9,
    roughness: 0.35,
    metalness: 0.1,
  });
  const attackMat = new THREE.MeshStandardMaterial({
    color: 0xff6a62,
    emissive: 0x8a1c24,
    emissiveIntensity: 0.8,
    transparent: true,
    opacity: 0.92,
    roughness: 0.3,
    metalness: 0.15,
  });
  const discGeo = new THREE.BoxGeometry(0.072, 0.01, 0.072);

  function clearMarkers() {
    for (const m of markers) {
      board.remove(m);
      if (m.userData.decor) {
        m.geometry.dispose();
        m.material.dispose();
      }
    }
    markers = [];
  }

  function addMarker(r, c, kind) {
    const mesh = new THREE.Mesh(discGeo, kind === 'attack' ? attackMat : moveMat);
    squareLocal(r, c, mesh.position);
    mesh.position.y = 0.03;
    mesh.userData.marker = kind;
    mesh.userData.r = r;
    mesh.userData.c = c;
    board.add(mesh);
    markers.push(mesh);
  }

  function refresh(state) {
    const alive = new Set();
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const piece = state.board[r][c];
        if (!piece) continue;
        alive.add(piece.id);
        let mesh = meshes.get(piece.id);
        const dest = squareLocal(r, c);
        if (!mesh) {
          mesh = createMiniature(piece.type, piece.side);
          const blob = new THREE.Mesh(
            new THREE.PlaneGeometry(0.05, 0.05),
            new THREE.MeshBasicMaterial({ map: pieceShadowTex, transparent: true, depthWrite: false }),
          );
          blob.rotation.x = -Math.PI / 2;
          blob.position.y = 0.001;
          mesh.add(blob);
          const pick = new THREE.Mesh(
            new THREE.CylinderGeometry(0.032, 0.032, 0.09, 8),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
          );
          pick.position.y = 0.045;
          mesh.add(pick);
          mesh.userData = {
            id: piece.id,
            type: piece.type,
            side: piece.side,
            r,
            c,
            pop: 1,
            seed: Math.random() * 10,
          };
          mesh.position.copy(dest);
          mesh.rotation.y = piece.side === GOLD ? Math.PI : 0;
          board.add(mesh);
          meshes.set(piece.id, mesh);
        } else if (!mesh.userData.slay) {
          mesh.userData.r = r;
          mesh.userData.c = c;
          mesh.userData.type = piece.type;
          mesh.userData.side = piece.side;
          if (mesh.position.distanceTo(dest) > 0.004 && !mesh.userData.tween && !mesh.userData.held) {
            mesh.userData.tween = {
              from: mesh.position.clone(),
              to: dest.clone(),
              t: 0,
              dur: 0.42,
            };
            mesh.userData.landKind = state.takeover === piece.id ? 'ping' : 'place';
            sfx.onSlide?.(piece);
            const dx = dest.x - mesh.position.x;
            const dz = dest.z - mesh.position.z;
            if (dx * dx + dz * dz > 0.0001) mesh.rotation.y = Math.atan2(dx, dz);
          }
          // On a new game every piece walks home, then turns to face the
          // other side.
          if (state.reset) mesh.userData.faceHome = true;
        }
      }
    }

    for (const [id, mesh] of meshes) {
      if (!alive.has(id) && !mesh.userData.slay) mesh.userData.slay = 0.001;
    }

    // A new game stands any fallen monarch back up.
    for (const [id, mesh] of meshes) {
      if (mesh.userData.fall && state.fallen?.id !== id) {
        mesh.quaternion.copy(mesh.userData.fall.q0);
        mesh.userData.fall = null;
      }
    }

    // A struck monarch topples away from whoever hit it, and stays down.
    if (state.fallen && meshes.has(state.fallen.id)) {
      const mesh = meshes.get(state.fallen.id);
      if (!mesh.userData.fall) {
        const from = squareLocal(state.fallen.by.r, state.fallen.by.c);
        const away = new THREE.Vector3().subVectors(mesh.position, from).setY(0);
        if (away.lengthSq() < 1e-8) away.set(0, 0, 1);
        away.normalize();
        // Rotating about (up x away) tips the top of the piece toward `away`.
        const axisWorld = new THREE.Vector3(0, 1, 0).cross(away).normalize();
        mesh.userData.fall = { t: 0, axis: axisWorld, base: mesh.position.clone(), q0: mesh.quaternion.clone(), landed: false };
        const attackerMesh = [...meshes.values()].find((m) => m.userData.r === state.fallen.by.r && m.userData.c === state.fallen.by.c);
        if (attackerMesh) attackerMesh.userData.pop = 1;
      }
    }

    clearMarkers();
    if (state.phase === 'play' && state.selected && state.board[state.selected.r]?.[state.selected.c]) {
      const selPiece = state.board[state.selected.r][state.selected.c];
      const sel = meshes.get(selPiece.id);
      if (sel) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.026, 0.003, 8, 20),
          metal(state.turn === GOLD ? 0xf0d48a : 0xc9b6ff, 0x443010),
        );
        ring.rotation.x = Math.PI / 2;
        squareLocal(state.selected.r, state.selected.c, ring.position);
        ring.position.y = 0.032;
        ring.userData.decor = true;
        board.add(ring);
        markers.push(ring);
      }
      const opt = options(state, state.selected.r, state.selected.c);
      for (const m of opt.moves) addMarker(m.r, m.c, 'move');
      for (const m of opt.attacks) addMarker(m.r, m.c, 'attack');
    }

    const over = state.phase === 'over';
    const lead = over ? (state.draw ? null : state.winner) : state.turn;
    const turnColor = lead == null ? '#e8e2d6' : SIDE_HEX[lead];
    const turnText = over
      ? (state.draw ? 'Stalemate' : `${SIDE_NAME[state.winner]} wins!`)
      : `Move ${state.moveNo || 1} · ${SIDE_NAME[state.turn]}${sfx.sideTag?.(state.turn) || ''} to move`;
    const key = `${state.phase}|${lead}|${state.moveNo || 1}`;
    if (key !== shownTurn) {
      shownTurn = key;
      turnPulse = 1;
    }
    for (const side of [0, 1]) {
      // During play only the mover's edge glows; at the end both edges take
      // the winner's colour.
      const bar = turnBars[side];
      bar.visible = over ? lead != null : side === state.turn;
      bar.material.color.setHex(SIDE_GLOW[over && lead != null ? lead : side]);
      sideLabels[side].material.opacity = over || side === state.turn ? 1 : 0.35;
    }
    turnSprite.userData.base = over ? [0.42, 0.105] : [0.38, 0.095];
    turnSprite.position.y = over ? 0.16 : 0.1;
    const selId = state.selected && state.board[state.selected.r]?.[state.selected.c]?.id;
    for (const mesh of meshes.values()) mesh.userData.chosen = mesh.userData.id === selId;

    setSpriteText(turnSprite, turnText, turnColor);

    // When a monarch falls, the end panel waits until it has hit the board.
    const falling = state.fallen && !meshes.get(state.fallen.id)?.userData.fall?.landed;
    endPanel.visible = state.phase === 'over' && !falling && (sfx.show3DEnd?.() ?? true);
    endWanted = state.phase === 'over' && !falling;
    if (state.phase === 'over') {
      const title = state.draw ? 'The court is locked' : `${SIDE_NAME[state.winner]} wins!`;
      const sub = state.draw ? 'Neither side can move' : `${SIDE_NAME[state.winner]} takes the court`;
      const prev = plaque.material;
      plaque.material = makePanelMaterial(title, sub);
      prev.map?.dispose();
      prev.dispose();
    }

    rebuildPickables();
  }

  function rebuildPickables() {
    pickables.length = 0;
    for (const mesh of meshes.values()) {
      if (!mesh.userData.slay) pickables.push(mesh);
    }
    for (const m of markers) {
      if (!m.userData.decor) pickables.push(m);
    }
    if (endPanel.visible) pickables.push(again);
    pickables.push(top);
  }

  const _viewer = new THREE.Vector3();
  /**
   * @param {number} dt
   * @param {THREE.Vector3} [viewerWorld] the player's head, so the game-over
   *   panel can face them
   */
  let endWanted = false;
  function update(dt, viewerWorld) {
    // Show or hide the 3D result panel as the player enters or leaves AR/VR.
    const endShow = endWanted && (sfx.show3DEnd?.() ?? true);
    if (endShow !== endPanel.visible) {
      endPanel.visible = endShow;
      rebuildPickables();
    }
    if (endPanel.visible && viewerWorld) {
      board.updateWorldMatrix(true, false);
      endPanel.lookAt(_viewer.copy(viewerWorld));
      // Press feedback on the button.
      const press = again.userData.pressT ? Math.max(0, 1 - (performance.now() / 1000 - again.userData.pressT) / 0.2) : 0;
      again.position.z = 0.01 - press * 0.006;
    }
    clock.t += dt;
    turnPulse = Math.max(0, turnPulse - dt * 1.6);
    // Pop the turn label when the move changes hands, then keep it breathing.
    const beat = 1 + Math.sin((1 - turnPulse) * Math.PI) * 0.35 * (turnPulse > 0 ? 1 : 0);
    const [bw, bh] = turnSprite.userData.base || [0.3, 0.075];
    turnSprite.scale.set(bw * beat, bh * beat, 1);
    turnSprite.material.opacity = 0.85 + 0.15 * Math.sin(clock.t * 3);
    for (const bar of turnBars) bar.material.opacity = Math.min(1, 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(clock.t * 4)) + turnPulse * 0.3);
    for (let side = 0; side < 2; side++) {
      const label = sideLabels[side];
      const active = label.material.opacity > 0.5;
      const s = active ? 1.25 + 0.06 * Math.sin(clock.t * 4) : 1;
      label.scale.set(labelScale[0] * s, labelScale[1] * s, 1);
    }
    const pulse = 1 + Math.sin(clock.t * 5) * 0.08;
    for (const m of markers) {
      if (m.userData.marker) m.scale.set(pulse, 1, pulse);
    }
    for (const mesh of meshes.values()) {
      const data = mesh.userData;
      if (data.tween) {
        data.tween.t += dt;
        const k = Math.min(1, data.tween.t / data.tween.dur);
        const e = 1 - (1 - k) ** 3;
        mesh.position.lerpVectors(data.tween.from, data.tween.to, e);
        if (k >= 1) {
          data.tween = null;
          sfx.onLand?.({ id: data.id, type: data.type, side: data.side }, data.landKind || 'place');
          data.landKind = null;
        }
      } else if (data.fall) {
        // Topple about the base, overshoot a little, and settle on its side.
        const f = data.fall;
        f.t += dt;
        const k = Math.min(1, f.t / 0.55);
        let ang = (Math.PI / 2) * k * k;
        if (k >= 1) {
          const b = Math.min(1, (f.t - 0.55) / 0.35);
          ang = Math.PI / 2 - Math.sin(b * Math.PI) * 0.12 * (1 - b);
          if (!f.landed) {
            f.landed = true;
            endWanted = true;
            endPanel.visible = sfx.show3DEnd?.() ?? true;
            rebuildPickables();
            sfx.onFall?.({ id: data.id, type: data.type, side: data.side });
          }
        }
        mesh.quaternion.setFromAxisAngle(f.axis, ang).multiply(f.q0);
        mesh.position.copy(f.base);
        mesh.position.y = f.base.y + Math.sin(ang) * 0.012;
      } else if (!data.slay && !data.held) {
        const base = squareLocal(data.r, data.c);
        mesh.position.x = base.x;
        mesh.position.z = base.z;
        mesh.position.y = base.y + Math.sin(clock.t * 2.2 + data.seed) * 0.0016;
      }
      if (data.faceHome && !data.tween && !data.fall && !data.held && !data.slay) {
        const home = data.side === GOLD ? Math.PI : 0;
        const delta = Math.atan2(Math.sin(home - mesh.rotation.y), Math.cos(home - mesh.rotation.y));
        if (Math.abs(delta) < 0.01) {
          mesh.rotation.y = home;
          data.faceHome = false;
        } else {
          mesh.rotation.y += delta * (1 - Math.exp(-9 * dt));
        }
      }
      if (data.pop) {
        data.pop = Math.max(0, data.pop - dt * 1.8);
      }
      if (data.slay) {
        data.slay += dt;
        const k = Math.min(1, data.slay / 0.55);
        mesh.scale.setScalar(1 - k);
        mesh.position.y -= dt * 0.02;
        mesh.rotation.z = k * 1.2;
        if (k >= 1) {
          board.remove(mesh);
          meshes.delete(data.id);
        }
      } else {
        const pop = data.pop ? 1 + Math.sin((1 - data.pop) * Math.PI) * 0.18 : 1;
        const chosen = data.chosen ? 1.1 : 1;
        mesh.scale.setScalar(pop * chosen);
      }
    }
  }

  const diorama = new THREE.Group();
  scene.add(diorama);
  const felt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.5, 0.045, 48),
    standard(0x241910, 0.92),
  );
  felt.position.y = -0.025;
  diorama.add(felt);
  const legGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.7, 8);
  const legMat = standard(0x1a1410, 0.8);
  for (const [x, z] of [[0.22, 0.22], [0.22, -0.22], [-0.22, 0.22], [-0.22, -0.22]]) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x, -0.38, z);
    diorama.add(leg);
  }

  const room = buildRoom();
  room.visible = false;
  scene.add(room);

  refresh({
    board: Array.from({ length: 5 }, () => Array(5).fill(null)),
    turn: GOLD,
    phase: 'play',
    selected: null,
    winner: null,
    draw: false,
  });

  return {
    board,
    diorama,
    room,
    pickables,
    refresh,
    update,
    again,
    turnSprite,
    TOP,
  };
}

function buildRoom() {
  const room = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(4.2, 40),
    standard(0x2a2118, 0.9),
  );
  floor.rotation.x = -Math.PI / 2;
  room.add(floor);
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(1.15, 28),
    standard(0x4a2030, 0.85),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.005, -0.85);
  room.add(rug);
  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.58, 0.06, 28),
    standard(0x3d2a1c, 0.62),
  );
  table.position.set(0, 0.93, -0.85);
  room.add(table);
  const pillarGeo = new THREE.CylinderGeometry(0.12, 0.14, 2.4, 8);
  const pillarMat = standard(0x2c2824, 0.8);
  for (const [x, z] of [[1.8, -2.2], [-1.8, -2.2], [1.8, 0.6], [-1.8, 0.6]]) {
    const p = new THREE.Mesh(pillarGeo, pillarMat);
    p.position.set(x, 1.2, z);
    room.add(p);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff9a55 }));
    flame.position.set(x, 2.45, z);
    room.add(flame);
    const light = new THREE.PointLight(0xff8a4a, 3.2, 3.5, 2);
    light.position.set(x, 2.4, z);
    room.add(light);
  }
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(5.5, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x14110f, side: THREE.BackSide }),
  );
  dome.position.y = 1.2;
  room.add(dome);
  return room;
}
