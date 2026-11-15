let ctx = null;
let noiseBuf = null;
let music = null;
let muted = false;
let tension = false;

function ac() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function resumeAudio() {
  ac();
}

function masterGain(peak, dur) {
  const c = ac();
  const g = c.createGain();
  const now = c.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(muted ? 0.0001 : peak, now + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  g.connect(c.destination);
  return { c, g, now };
}

export function playTone(freq, dur, type, gain, slideTo) {
  if (muted) return;
  const { c, g, now } = masterGain(gain, dur);
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, now);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), now + dur * 0.9);
  o.connect(g);
  o.start(now);
  o.stop(now + dur + 0.02);
}

function noise() {
  const c = ac();
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.35), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  return { c, src };
}

export function playWhoosh() {
  if (muted) return;
  const { c, src } = noise();
  const now = c.currentTime;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(1400, now);
  f.frequency.exponentialRampToValueAtTime(240, now + 0.16);
  f.Q.value = 0.6;
  const g = c.createGain();
  g.gain.setValueAtTime(0.11, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  src.connect(f);
  f.connect(g);
  g.connect(c.destination);
  src.start(now);
  src.stop(now + 0.2);
}

export function playHit() {
  playTone(140, 0.12, 'square', 0.05, 60);
  playTone(420, 0.08, 'triangle', 0.04, 180);
}

export function playArrow() {
  playTone(640, 0.09, 'triangle', 0.04, 220);
}

export function playDeflect() {
  playTone(880, 0.1, 'square', 0.045, 1320);
  playTone(220, 0.14, 'triangle', 0.04, 90);
}

export function playHurt() {
  playTone(196, 0.22, 'sawtooth', 0.05, 70);
}

export function playTick() {
  playTone(520, 0.05, 'sine', 0.03);
}

export function playMove() {
  if (muted) return;
  const { c, src } = noise();
  const now = c.currentTime;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 420;
  const g = c.createGain();
  g.gain.setValueAtTime(0.06, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  src.connect(f);
  f.connect(g);
  g.connect(c.destination);
  src.start(now);
  src.stop(now + 0.1);
}

export function playFanfare() {
  const notes = [523, 659, 784, 1046];
  notes.forEach((n, i) => {
    setTimeout(() => playTone(n, 0.28, 'triangle', 0.05), i * 120);
  });
}

export function playDefeat() {
  playTone(311, 0.25, 'triangle', 0.05, 180);
  setTimeout(() => playTone(196, 0.4, 'sine', 0.05, 90), 140);
}

export function playCapture() {
  playTone(392, 0.1, 'triangle', 0.04);
  setTimeout(() => playTone(523, 0.16, 'triangle', 0.045), 90);
}

export function startMusic() {
  const c = ac();
  if (music) return;
  const g = c.createGain();
  g.gain.value = muted ? 0 : 0.016;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 380;
  const o1 = c.createOscillator();
  const o2 = c.createOscillator();
  const o3 = c.createOscillator();
  o1.type = 'sawtooth';
  o2.type = 'sawtooth';
  o3.type = 'triangle';
  o1.frequency.value = 82.4;
  o2.frequency.value = 83.1;
  o3.frequency.value = 164.8;
  const g3 = c.createGain();
  g3.gain.value = 0.25;
  o1.connect(filter);
  o2.connect(filter);
  o3.connect(g3);
  g3.connect(filter);
  filter.connect(g);
  g.connect(c.destination);
  o1.start();
  o2.start();
  o3.start();
  music = { g, filter };
  tension = false;
}

export function setMusicTension(on) {
  if (!music || !ctx) return;
  tension = on;
  const now = ctx.currentTime;
  music.filter.frequency.linearRampToValueAtTime(on ? 980 : 380, now + 0.45);
  if (!muted) music.g.gain.linearRampToValueAtTime(on ? 0.028 : 0.016, now + 0.45);
}

export function toggleMute() {
  muted = !muted;
  if (music && ctx) {
    music.g.gain.cancelScheduledValues(ctx.currentTime);
    music.g.gain.linearRampToValueAtTime(muted ? 0 : tension ? 0.028 : 0.016, ctx.currentTime + 0.05);
  }
  return muted;
}

export function isMuted() {
  return muted;
}

// ---------------------------------------------------------------------------
// Board sound events, organised the way chess.com links sounds to moves: each
// board event has its own sound, and it plays in sync with the piece's
// animation rather than when the click happens.
//   swipe     the piece starts sliding to its new square
//   place     the piece lands (a quiet move)
//   ping      the piece lands on a square it has taken (a takeover)
//   turn      the move passes to the other side
//   illegal   you tried something that is not allowed
//   start     a new game is set up
//   victory   a monarch has fallen
// All sounds are synthesised here; no audio files are loaded.

function bandNoise(type, from, to, dur, gain, q = 0.7) {
  if (muted) return;
  const { c, src } = noise();
  const now = c.currentTime;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(from, now);
  f.frequency.exponentialRampToValueAtTime(to, now + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(gain, now + dur * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(f);
  f.connect(g);
  g.connect(c.destination);
  src.start(now);
  src.stop(now + dur + 0.02);
}

function bell(freq, dur, gain, delay = 0) {
  if (muted) return;
  const c = ac();
  const now = c.currentTime + delay;
  // A struck bell: a fundamental plus inharmonic partials that die faster.
  for (const [mult, amp, decay] of [[1, 1, 1], [2.76, 0.42, 0.55], [5.4, 0.2, 0.3]]) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq * mult;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain * amp, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur * decay);
    o.connect(g);
    g.connect(c.destination);
    o.start(now);
    o.stop(now + dur + 0.05);
  }
}

function knock(freq, gain) {
  if (muted) return;
  // Wooden piece set down on a board: a short pitched thump plus a click.
  playTone(freq, 0.07, 'sine', gain, freq * 0.55);
  bandNoise('bandpass', 2600, 1200, 0.03, gain * 0.9, 1.4);
}

export function playSwipe() {
  bandNoise('bandpass', 700, 2600, 0.2, 0.07, 0.9);
}

export function playPlace() {
  knock(190, 0.16);
}

export function playPing() {
  knock(170, 0.12);
  bell(1318.5, 0.75, 0.07, 0.015);
}

export function playTurn(side) {
  // Gold and Violet each get their own soft two-note cue.
  const [a, b] = side === 0 ? [659.3, 880] : [587.3, 784];
  bell(a, 0.35, 0.025);
  bell(b, 0.4, 0.022, 0.09);
}

export function playIllegal() {
  playTone(150, 0.12, 'square', 0.03, 110);
}

export function playStart() {
  bell(523.3, 0.4, 0.03);
  bell(784, 0.5, 0.03, 0.12);
}

export function playVictory() {
  // Rising fanfare that resolves on a held major chord.
  const run = [523.3, 659.3, 784, 1046.5];
  run.forEach((n, i) => setTimeout(() => playTone(n, 0.22, 'triangle', 0.05), i * 110));
  setTimeout(() => {
    for (const n of [523.3, 659.3, 784, 1046.5]) playTone(n, 1.1, 'triangle', 0.035);
    bell(1046.5, 1.4, 0.05);
  }, run.length * 110 + 40);
}

const SFX = {
  swipe: playSwipe,
  place: playPlace,
  ping: playPing,
  turn: playTurn,
  illegal: playIllegal,
  start: playStart,
  victory: playVictory,
};

export function playSfx(event, arg) {
  SFX[event]?.(arg);
}

// ---------------------------------------------------------------------------
// War ambience for the duels: a catapult boom, and a distant battle (war
// drums, clashing steel, the odd horn) looping underneath the fight.

export function playBoom(near = 1) {
  if (muted) return;
  const g = Math.max(0.15, Math.min(1, near));
  // Low thump that drops in pitch, plus a crackling noise tail.
  playTone(90, 0.55, 'sine', 0.22 * g, 34);
  playTone(60, 0.8, 'triangle', 0.12 * g, 28);
  bandNoise('lowpass', 1600, 180, 0.9, 0.16 * g, 0.5);
}

let warTimer = 0;
let warBeat = 0;
export function startWarAmbience() {
  stopWarAmbience();
  warBeat = 0;
  warTimer = setInterval(() => {
    if (muted) return;
    warBeat += 1;
    // War drums: a heavy beat with a lighter answer, at a march tempo.
    if (warBeat % 4 === 0) playTone(70, 0.35, 'sine', 0.09, 45);
    if (warBeat % 4 === 2) playTone(95, 0.22, 'sine', 0.05, 60);
    // Distant steel on steel.
    if (Math.random() < 0.18) {
      bandNoise('bandpass', 4200 + Math.random() * 1500, 2600, 0.08, 0.035, 6);
      playTone(1800 + Math.random() * 900, 0.12, 'triangle', 0.012);
    }
    // A horn across the field now and then.
    if (Math.random() < 0.012) {
      playTone(147, 1.3, 'sawtooth', 0.018, 140);
      setTimeout(() => playTone(196, 1.0, 'sawtooth', 0.015, 185), 500);
    }
  }, 160);
}

export function stopWarAmbience() {
  clearInterval(warTimer);
  warTimer = 0;
}
