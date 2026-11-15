// "See what you see": Sundai looks through the headset's outward camera and names the things in
// front of the player, and remembers where she last saw each one (item tracking).
//
// Recognition runs in the browser itself (TensorFlow.js with the COCO-SSD model: about 80 everyday
// things such as chair, cup, laptop, phone, bottle, book, backpack, person), so no key or server is
// involved and no picture leaves the device. The recogniser is only downloaded the first time she
// is asked to look.
//
// It needs the browser to offer an outward-facing camera. Where it does not (or offers only an
// avatar or selfie camera, which is not what the player sees), she says she cannot see right now.

let video = null;
let label = '';
let problem = '';
let model = null;
let loading = null;
const seen = new Map(); // thing -> { where, at }

/** Ask for the outward camera. Call from a tap, before any AR session hides the permission prompt. */
export async function startCamera() {
  if (video || problem) return !!video;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 } } });
    label = (stream.getVideoTracks()[0] && stream.getVideoTracks()[0].label) || 'camera';
    if (/avatar|selfie|virtual|front/i.test(label) && !/passthrough|back|environment|world/i.test(label)) {
      stream.getTracks().forEach((t) => t.stop());
      problem = `the only camera offered ("${label}") does not show what the player sees`;
      return false;
    }
    const v = document.createElement('video');
    v.srcObject = stream;
    v.muted = true;
    v.playsInline = true;
    await v.play();
    video = v;
    // Fetch the recogniser now, in the background, so her first look is quick.
    loading = loading || Promise.all([import('@tensorflow/tfjs'), import('@tensorflow-models/coco-ssd')]).then(([, coco]) => coco.load({ base: 'lite_mobilenet_v2' }));
    loading.catch(() => { loading = null; });
    return true;
  } catch (e) {
    problem = 'no camera is available here (' + ((e && e.message) || e) + ')';
    return false;
  }
}

export const cameraState = () => (video ? 'on: ' + label : problem || 'not started');

const side = (x) => (x < 0.36 ? 'to their left' : x > 0.64 ? 'to their right' : 'straight ahead of them');
const ago = (ms) => (ms < 8000 ? 'just now' : ms < 90000 ? Math.round(ms / 1000) + ' seconds ago' : Math.round(ms / 60000) + ' minutes ago');

/**
 * Look now. Returns what she can tell the player: the things in view and roughly where, plus
 * things seen earlier that are not in view any more. With `find`, says where that thing was last seen.
 */
export async function look(find = '') {
  if (!video && !(await startCamera())) return { can_see: false, reason: problem || 'the camera could not be started', say: 'Tell the user honestly that you cannot see through their headset right now.' };
  try {
    if (!model) {
      loading = loading || Promise.all([import('@tensorflow/tfjs'), import('@tensorflow-models/coco-ssd')]).then(([, coco]) => coco.load({ base: 'lite_mobilenet_v2' }));
      model = await loading;
    }
    const found = await model.detect(video, 12, 0.58); // only what it is fairly sure of: better to say less than to invent things
    const now = Date.now();
    const w = video.videoWidth || 640;
    const things = found.map((p) => ({ thing: p.class, where: side((p.bbox[0] + p.bbox[2] / 2) / w), sure: Math.round(p.score * 100) + '%' }));
    for (const t of things) seen.set(t.thing, { where: t.where, at: now });
    const earlier = [...seen.entries()].filter(([thing]) => !things.some((t) => t.thing === thing)).map(([thing, s]) => ({ thing, last_seen: s.where + ', ' + ago(now - s.at) }));
    const out = { can_see: true, in_view_now: things, seen_earlier: earlier, note: 'Directions are from the user\'s point of view when you looked. Only mention what is listed.' };
    if (find) {
      const key = find.toLowerCase().replace(/^(the|my|a|an) /, '').trim();
      const hit = [...seen.entries()].find(([thing]) => thing.includes(key) || key.includes(thing));
      out.asked_about = hit ? { thing: hit[0], last_seen: hit[1].where + ', ' + ago(now - hit[1].at) } : { thing: find, last_seen: 'not seen yet' };
    }
    return out;
  } catch (e) {
    loading = null;
    return { can_see: false, reason: 'the recogniser could not be loaded or run (' + ((e && e.message) || e) + ')', say: 'Tell the user you could not look just now.' };
  }
}
