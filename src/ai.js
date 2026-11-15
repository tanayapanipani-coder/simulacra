import { SIZE, inBounds, options } from './rules.js?v=39b44d6';

// Computer opponent for the side whose turn it is in `state`.
//
// It looks one move ahead: every legal move and attack is scored, assuming
// an attack wins its clash, and the best is played (with a little randomness
// so games differ). In order of weight it:
//   - strikes the enemy monarch whenever it can (that ends the game),
//   - never leaves its own monarch where an enemy piece could strike it,
//     and rescues it (take the threat, or step away) when it is threatened,
//   - takes pieces when it can,
//   - otherwise closes in on the enemy monarch while avoiding squares an
//     enemy piece could attack next turn.

function each(board, fn) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c]) fn(board[r][c], r, c);
    }
  }
}

function find(board, side, type) {
  let at = null;
  each(board, (p, r, c) => {
    if (p.side === side && p.type === type) at = { r, c };
  });
  return at;
}

// Can any `bySide` archer or swordsman strike square (r, c)? Every piece
// except the monarch attacks the eight neighbouring squares.
function attacked(board, r, c, bySide) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const p = board[nr][nc];
      if (p && p.side === bySide && p.type !== 'X') return true;
    }
  }
  return false;
}

function dist(a, b) {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
}

function apply(board, action) {
  const next = board.map((row) => row.slice());
  next[action.to.r][action.to.c] = next[action.from.r][action.from.c];
  next[action.from.r][action.from.c] = null;
  return next;
}

/**
 * Pick an action for `state.turn`.
 * @returns {{from:{r,c}, to:{r,c}, attack:boolean} | null}
 */
export function chooseMove(state, rng = Math.random) {
  const me = state.turn;
  const foe = me === 0 ? 1 : 0;
  const board = state.board;
  const actions = [];
  each(board, (piece, r, c) => {
    if (piece.side !== me) return;
    const opt = options(state, r, c);
    for (const to of opt.moves) actions.push({ from: { r, c }, to, attack: false });
    for (const to of opt.attacks) actions.push({ from: { r, c }, to, attack: true });
  });
  if (!actions.length) return null;

  const myKing = find(board, me, 'X');
  const foeKing = find(board, foe, 'X');
  const inDanger = myKing && attacked(board, myKing.r, myKing.c, foe);

  let best = null;
  let bestScore = -Infinity;
  for (const a of actions) {
    const mover = board[a.from.r][a.from.c];
    const target = board[a.to.r][a.to.c];
    let score = rng() * 6;

    if (a.attack && target?.type === 'X') score += 100000;

    const after = apply(board, a);
    const kingNow = mover.type === 'X' ? a.to : myKing;
    const kingExposed = kingNow && attacked(after, kingNow.r, kingNow.c, foe);
    if (kingExposed) score -= 5000;
    else if (inDanger) score += 600;

    if (a.attack && target) {
      score += 70 + (target.type === 'A' ? 8 : 0);
    }
    if (mover.type !== 'X') {
      // Close in on the enemy monarch.
      if (foeKing) score += (dist(a.from, foeKing) - dist(a.to, foeKing)) * 9;
      // Do not stand where an enemy piece can strike next turn.
      if (attacked(after, a.to.r, a.to.c, foe)) score -= 22;
    } else if (!inDanger) {
      // The monarch stays home unless it has to run.
      score -= 12;
    }

    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}
