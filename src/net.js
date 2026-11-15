// Online play for two people on two devices.
//
// The devices connect directly to each other over WebRTC using PeerJS. Its
// free public broker only introduces the two browsers (by room code); moves
// then travel device to device. The player who creates the room plays Gold,
// the one who joins plays Violet.

const PEERJS_LOCAL = './vendor/peerjs.min.js?v=1eff359';
const PEERJS_CDN = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js?v=1eff359';
const ID_PREFIX = 'crownfall-v1-';
// No 0/O, 1/I/L, so codes are easy to read aloud and type in a headset.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

let peerLib = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      s.remove();
      reject(new Error(`Could not load ${src}`));
    };
    document.head.appendChild(s);
  });
}

async function loadPeer() {
  if (peerLib) return peerLib;
  if (!window.Peer) {
    try {
      await loadScript(PEERJS_LOCAL);
    } catch {
      await loadScript(PEERJS_CDN);
    }
  }
  if (!window.Peer) throw new Error('Online play is unavailable (PeerJS did not load).');
  peerLib = window.Peer;
  return peerLib;
}

export function makeCode() {
  let code = '';
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  return code;
}

export function cleanCode(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

/**
 * Create or join a room.
 * @param {object} opts
 * @param {'host'|'join'} opts.role
 * @param {string} opts.code
 * @param {(msg:object)=>void} opts.onMessage
 * @param {(state:'waiting'|'connected'|'disconnected'|'error', detail?:string)=>void} opts.onStatus
 * @returns {Promise<{send:(msg:object)=>void, close:()=>void, side:number, code:string}>}
 */
export async function openRoom({ role, code, onMessage, onStatus }) {
  const Peer = await loadPeer();
  const hostId = ID_PREFIX + code;
  const peer = role === 'host' ? new Peer(hostId) : new Peer();
  let conn = null;
  let closed = false;

  function attach(c) {
    if (conn && conn !== c) conn.close();
    conn = c;
    c.on('open', () => onStatus('connected'));
    c.on('data', (data) => {
      try {
        onMessage(typeof data === 'string' ? JSON.parse(data) : data);
      } catch (err) {
        console.warn('Bad message', err);
      }
    });
    c.on('close', () => {
      if (conn === c && !closed) onStatus('disconnected');
    });
    c.on('error', (err) => onStatus('error', err?.message || String(err)));
  }

  await new Promise((resolve, reject) => {
    peer.on('open', () => resolve());
    peer.on('error', (err) => {
      const type = err?.type || '';
      if (type === 'unavailable-id') reject(new Error('That room code is already in use. Create a new game.'));
      else if (type === 'peer-unavailable') onStatus('error', 'No game with that code. Check the code and that the other player is still waiting.');
      else if (type === 'network' || type === 'server-error' || type === 'socket-error') reject(new Error('Could not reach the matchmaking server. Check the internet connection.'));
      else onStatus('error', err?.message || String(err));
    });
  });

  if (role === 'host') {
    onStatus('waiting');
    peer.on('connection', (c) => attach(c));
  } else {
    attach(peer.connect(hostId, { reliable: true }));
  }

  return {
    side: role === 'host' ? 0 : 1,
    code,
    send(msg) {
      if (conn?.open) conn.send(JSON.stringify(msg));
    },
    close() {
      closed = true;
      conn?.close();
      peer.destroy();
    },
  };
}
