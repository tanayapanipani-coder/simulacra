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
