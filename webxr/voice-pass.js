// Where the live voice gets its credential when no key has been typed into the page.
//
// sim-config.json at the root of the site can carry either or both of:
//   "pass" + "expires_at"  a voice pass published with the site and refreshed on a schedule
//                          (relay/refresh-pass.sh). It only starts live voice calls and expires
//                          within two hours.
//   "tokenUrl"             a relay (relay/worker.js) that hands out ten-minute passes on request.
// Either way no OpenAI key is ever in the page.

const places = () => [new URL('sim-config.json', document.baseURI).href, new URL('../sim-config.json', document.baseURI).href];
let found = '';

async function readConfig() {
  for (const url of found ? [found] : places()) {
    try {
      const res = await fetch(url + '?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' });
      if (!res.ok) continue;
      const cfg = await res.json();
      if (cfg && typeof cfg === 'object') {
        found = url;
        return cfg;
      }
    } catch (e) { /* not there */ }
  }
  return {};
}
const fresh = (cfg) => typeof cfg.pass === 'string' && cfg.pass && Number(cfg.expires_at) > Date.now() / 1000 + 45;
const relay = (cfg) => (typeof cfg.tokenUrl === 'string' && /^https?:\/\//.test(cfg.tokenUrl) ? cfg.tokenUrl : '');

/** The public ElevenLabs agent this site talks to, or '' (see relay/README.md). An agent id is not a secret. */
export async function agentId(which = 'agentId') {
  const cfg = await readConfig();
  return typeof cfg[which] === 'string' && /^agent_\w+$/.test(cfg[which]) ? cfg[which] : '';
}

let configured = null;
/** Truthy if this site can start the live voice without a key (looked up once). */
export function relayUrl() {
  if (!configured) configured = readConfig().then((cfg) => (fresh(cfg) ? 'published pass' : relay(cfg)));
  return configured;
}

/** A credential for starting a live voice call now. Throws with a plain reason if there is none. */
export async function voicePass() {
  const cfg = await readConfig(); // read again: the published pass is replaced every hour
  if (fresh(cfg)) return cfg.pass;
  const url = relay(cfg);
  if (!url) throw new Error(cfg.pass ? "the site's voice pass has expired and has not been refreshed yet" : 'no voice pass or relay is set up for this site');
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.value) throw new Error('the voice relay refused: ' + (data.error || res.status));
  return data.value;
}
