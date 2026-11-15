import { SIZE, inBounds } from './rules.js?v=e1feae8';

// A stronger player than ai.js, and the brains behind coaching.
//
// It searches three moves deep (mine, theirs, mine). A clash is not assumed won: the human fights
// every clash by hand, so each attack on an archer or swordsman is weighed by how often this
// particular human has been winning that kind of fight (see `odds`). That is how the opponent
// adapts to the player: beat it at sword-on-archer a few times and it stops offering you those.
//
// The same search run for the human's side gives the move to suggest, and comparing the human's
// actual move with it gives the things worth teaching (a missed win, a monarch left open).

export const squareName = (r, c) => `${'abcde'[c]}${5 - r}`;
const NAMES = { A: 'archer', S: 'swordsman', X: 'monarch' };

/** Every legal action for `side`. */
export function actionsFor(board, side) {
  const out = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (!p || p.side !== side) continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (!inBounds(nr, nc)) continue;
          const occ = board[nr][nc];
          if (!occ) out.push({ from: { r, c }, to: { r: nr, c: nc }, attack: false });
          else if (occ.side !== side && p.type !== 'X') out.push({ from: { r, c }, to: { r: nr, c: nc }, attack: true });
        }
      }
    }
  }
  return out;
}

function moved(board, a) {
  const next = board.map((row) => row.slice());
  next[a.to.r][a.to.c] = next[a.from.r][a.from.c];
  next[a.from.r][a.from.c] = null;
  return next;
}
function attackerLost(board, a) {
  const next = board.map((row) => row.slice());
  next[a.from.r][a.from.c] = null;
  return next;
}

function findMonarch(board, side) {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (board[r][c]?.side === side && board[r][c].type === 'X') return { r, c };
  return null;
}

/** Can `side` strike square (r, c) right now? */
export function canStrike(board, r, c, side) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const p = inBounds(r + dr, c + dc) ? board[r + dr][c + dc] : null;
      if (p && p.side === side && p.type !== 'X') return true;
    }
  }
  return false;
}

const WIN = 1000;

/** How good the position is for `side`, with nobody to move considered (the search handles tempo). */
function evaluate(board, side) {
  const foe = 1 - side;
  let score = 0;
  const mine = findMonarch(board, side);
  const theirs = findMonarch(board, foe);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (!p || p.type === 'X') continue;
      const target = p.side === side ? theirs : mine;
      const near = target ? 4 - Math.max(Math.abs(r - target.r), Math.abs(c - target.c)) : 0;
      score += (p.side === side ? 1 : -1) * (10 + near * 0.6);
    }
  }
  return score;
}

/**
 * Chance that an attack by `attacker` on `defender` succeeds.
 * `odds.human` is the side the human plays; `odds.rate(humanType, foeType)` is how often the human
 * wins a clash fought with that piece against that foe. With no human (two computers) it is 0.5.
 */
function attackSucceeds(attacker, defender, odds) {
  if (!odds || odds.human == null) return 0.5;
  if (attacker.side === odds.human) return odds.rate(attacker.type, defender.type);
  return 1 - odds.rate(defender.type, attacker.type);
}

function value(board, side, depth, odds) {
  const acts = actionsFor(board, side);
  if (!acts.length) return depth > 0 ? -value(board, 1 - side, depth - 1, odds) : evaluate(board, side);
  if (depth === 0) {
    // Whoever is to move can end it on the spot if a strike is on.
    for (const a of acts) if (a.attack && board[a.to.r][a.to.c].type === 'X') return WIN;
    return evaluate(board, side);
  }
  let best = -Infinity;
  for (const a of acts) best = Math.max(best, actionValue(board, side, a, depth, odds));
  return best;
}

function actionValue(board, side, a, depth, odds) {
  const target = board[a.to.r][a.to.c];
  if (a.attack && target.type === 'X') return WIN + depth; // sooner is better
  // What lies further off counts a little less, so a gain is taken now rather than "later".
  const LATER = 0.97;
  if (!a.attack) return LATER * -value(moved(board, a), 1 - side, depth - 1, odds);
  const p = attackSucceeds(board[a.from.r][a.from.c], target, odds);
  const gain = (target.side === side ? 0 : 10) * (2 * p - 1) * (1 - LATER); // the fight itself, taken now
  return gain + LATER * (p * -value(moved(board, a), 1 - side, depth - 1, odds) + (1 - p) * -value(attackerLost(board, a), 1 - side, depth - 1, odds));
}

/** Why a move is good, in words a coach would use. */
function reasonFor(board, side, a, score) {
  const foe = 1 - side;
  const mover = board[a.from.r][a.from.c];
  const target = board[a.to.r][a.to.c];
  if (a.attack && target.type === 'X') return 'it strikes the monarch and wins the game';
  const mine = findMonarch(board, side);
  const inDanger = mine && canStrike(board, mine.r, mine.c, foe);
  const after = a.attack ? moved(board, a) : moved(board, a);
  const mineAfter = findMonarch(after, side);
  if (inDanger && mineAfter && !canStrike(after, mineAfter.r, mineAfter.c, foe)) return a.attack ? 'it removes the piece threatening the monarch' : mover.type === 'X' ? 'the monarch was under attack and steps out of reach' : 'it shields the monarch from the attack';
  if (a.attack) return `it attacks their ${NAMES[target.type]}, a fight worth taking`;
  const theirs = findMonarch(after, foe);
  if (theirs && mover.type !== 'X' && canStrike(after, theirs.r, theirs.c, side)) return score >= WIN / 2 ? 'it threatens the monarch and they cannot escape' : 'it threatens their monarch, so they must respond';
  if (mover.type === 'X') return 'it moves the monarch somewhere safer';
  return 'it brings a piece closer to their monarch without leaving it open to attack';
}

/**
 * The best action for `side`, or null if it has none.
 * @returns {{from, to, attack, score, reason, text} | null}
 */
export function bestMove(board, side, odds = null, rng = Math.random, depth = 3) {
  const acts = actionsFor(board, side);
  if (!acts.length) return null;
  let best = null;
  for (const a of acts) {
    const score = actionValue(board, side, a, depth, odds) + rng() * 0.4;
    if (!best || score > best.score) best = { ...a, score };
  }
  best.reason = reasonFor(board, side, best, best.score);
  best.text = describeAction(board, best);
  return best;
}

export function describeAction(board, a) {
  const mover = board[a.from.r][a.from.c];
  const target = board[a.to.r][a.to.c];
  return a.attack
    ? `${NAMES[mover.type]} on ${squareName(a.from.r, a.from.c)} attacks the ${NAMES[target.type]} on ${squareName(a.to.r, a.to.c)}`
    : `${NAMES[mover.type]} from ${squareName(a.from.r, a.from.c)} to ${squareName(a.to.r, a.to.c)}`;
}

/**
 * What a coach should say about the move `side` just chose (`a`, on `board` before it is played).
 * @returns {{kind: 'missed_win'|'blunder'|'weak'|'good'|'best', note: string, better?: object}}
 */
export function assess(board, side, a, odds = null) {
  const foe = 1 - side;
  const best = bestMove(board, side, odds, () => 0);
  const acts = actionsFor(board, side);
  const strike = acts.find((x) => x.attack && board[x.to.r][x.to.c].type === 'X');
  const same = (x) => x.from.r === a.from.r && x.from.c === a.from.c && x.to.r === a.to.r && x.to.c === a.to.c;
  if (strike && !same(strike)) return { kind: 'missed_win', note: `They could have won at once: ${describeAction(board, strike)}.`, better: strike };
  if (a.attack && board[a.to.r][a.to.c].type === 'X') return { kind: 'best', note: 'They struck the monarch.' };
  const after = moved(board, a);
  const mine = findMonarch(after, side);
  if (mine && canStrike(after, mine.r, mine.c, foe) && !a.attack) {
    return { kind: 'blunder', note: `Their monarch on ${squareName(mine.r, mine.c)} can now be struck.`, better: best };
  }
  const score = actionValue(board, side, a, 3, odds);
  const gap = best.score - score;
  if (same(best) || gap < 1.5) return { kind: same(best) ? 'best' : 'good', note: same(best) ? 'That was the strongest move.' : 'A sound move.' };
  return { kind: gap > 8 ? 'blunder' : 'weak', note: `Stronger was ${best.text}, because ${best.reason}.`, better: best };
}

/** The board as text a language model can read. Gold is at the bottom (rank 1), Violet at the top. */
export function boardText(board) {
  const rows = [];
  for (let r = 0; r < SIZE; r++) {
    let line = `${5 - r} `;
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      line += p ? ` ${p.side === 0 ? 'G' : 'V'}${p.type}` : '  .';
    }
    rows.push(line);
  }
  rows.push('    a  b  c  d  e');
  return rows.join('\n');
}

/**
 * How often the human wins each kind of clash, remembered between games.
 * Starts from a mild guess (the human wins 6 in 10) that real results quickly replace.
 */
export function clashRecord(storage, human) {
  const KEY = 'crownfall.clashes';
  let data = {};
  try {
    data = JSON.parse(storage?.getItem(KEY) || '{}') || {};
  } catch {
    data = {};
  }
  const rate = (humanType, foeType) => {
    const d = data[humanType + foeType] || { w: 0, n: 0 };
    return (d.w + 3) / (d.n + 5);
  };
  return {
    human,
    rate,
    record(humanType, foeType, humanWon) {
      const d = (data[humanType + foeType] ||= { w: 0, n: 0 });
      d.n += 1;
      if (humanWon) d.w += 1;
      try {
        storage?.setItem(KEY, JSON.stringify(data));
      } catch { /* not remembered beyond this visit */ }
    },
    summary() {
      const parts = [];
      for (const key of Object.keys(data)) parts.push(`${NAMES[key[0]]} against ${NAMES[key[1]]}: won ${data[key].w} of ${data[key].n}`);
      return parts.length ? parts.join('; ') : 'no fights yet';
    },
  };
}
