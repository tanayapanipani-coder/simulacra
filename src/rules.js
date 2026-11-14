export const SIZE = 5;
export const GOLD = 0;
export const VIOLET = 1;
export const SIDE_NAME = ['Gold', 'Violet'];
export const TYPE_NAME = { A: 'Archer', S: 'Swordsman', X: 'Monarch' };

const LINE = ['A', 'S', 'X', 'S', 'A'];

export function createGame() {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let c = 0; c < SIZE; c++) {
    board[0][c] = { id: `V${c}`, type: LINE[c], side: VIOLET };
    board[4][c] = { id: `G${c}`, type: LINE[c], side: GOLD };
  }
  return {
    board,
    turn: GOLD,
    phase: 'play',
    winner: null,
    selected: null,
    draw: false,
  };
}

export function inBounds(r, c) {
  return r >= 0 && c >= 0 && r < SIZE && c < SIZE;
}

export function options(state, r, c) {
  const piece = state.board[r]?.[c];
  const moves = [];
  const attacks = [];
  if (!piece || piece.side !== state.turn) return { piece, moves, attacks };
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const occ = state.board[nr][nc];
      if (!occ) moves.push({ r: nr, c: nc });
      else if (occ.side !== piece.side && piece.type !== 'X') attacks.push({ r: nr, c: nc });
    }
  }
  return { piece, moves, attacks };
}

export function hasAction(state) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (state.board[r][c]?.side !== state.turn) continue;
      const opt = options(state, r, c);
      if (opt.moves.length || opt.attacks.length) return true;
    }
  }
  return false;
}

export function advanceTurn(state) {
  state.selected = null;
  state.turn = state.turn === GOLD ? VIOLET : GOLD;
  if (!hasAction(state)) {
    const stuck = state.turn;
    state.turn = stuck === GOLD ? VIOLET : GOLD;
    if (!hasAction(state)) {
      state.phase = 'over';
      state.draw = true;
      state.winner = null;
      return { skipped: stuck, draw: true };
    }
    return { skipped: stuck, draw: false };
  }
  return { skipped: null, draw: false };
}

export function clashBlurb(attackerType, defenderType) {
  const a = TYPE_NAME[attackerType];
  const d = TYPE_NAME[defenderType];
  if (attackerType === 'S' && defenderType === 'S') {
    return `${a} meets ${d}. Cut the charge down.`;
  }
  if (attackerType === 'S' && defenderType === 'A') {
    return `${a} meets ${d}. Knock their arrows back into them.`;
  }
  if (attackerType === 'A' && defenderType === 'S') {
    return `${a} meets ${d}. Loose arrows into the rush.`;
  }
  return `${a} meets ${d}. Shoot their shafts from the air, then fell them.`;
}
