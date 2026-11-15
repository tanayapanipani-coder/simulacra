let ctx = null;
let noiseBuf = null;
let music = null;
let muted = false;
let tension = false;

let bus = null;
function ac() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Every sound goes through one master bus: a gain that lifts the effects
// well above the voice and the war ambience, into a limiter so loud moments
// (a clang over the drums) never clip. Headset speakers are quiet, so the
// old levels were easy to miss.
function out() {
  const c = ac();
  if (!bus) {
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    limiter.connect(c.destination);
    bus = c.createGain();
    bus.gain.value = 2.6;
    bus.connect(limiter);
  }
  return bus;
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
  g.connect(out());
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
  g.connect(out());
  src.start(now);
  src.stop(now + 0.2);
}

// A blow landing on armour: a heavy thud with a short metallic crunch.
export function playHit() {
  playTone(92, 0.22, 'sine', 0.3, 42);
  bandNoise('bandpass', 1800, 600, 0.12, 0.16, 1.2);
  ring([620, 1490, 2310], 0.25, 0.05);
}

// An arrow's flight through the air: band-limited noise (the rush of air)
// over a thin whistle and a low flutter (the shaft). `arriving` builds up,
// sweeps from one ear to the other and drops in pitch as it passes you (the
// Doppler fall); otherwise it starts close and falls away into the distance.
// Shots and incoming arrows share it, so they sound like the same arrows.
function airWhoosh({ arriving, dur, level = 1 }) {
  if (muted) return;
  const c = ac();
  const t = c.currentTime;
  const side = Math.random() < 0.5 ? -1 : 1;
  const pan = c.createStereoPanner ? c.createStereoPanner() : null;
  if (pan) {
    pan.pan.setValueAtTime(arriving ? -0.9 * side : 0, t);
    pan.pan.linearRampToValueAtTime(arriving ? 0.9 * side : 0.25 * side, t + dur);
    pan.connect(out());
  }
  const dest = pan || out();
  const peakAt = arriving ? dur * 0.45 : dur * 0.08;
  const { src } = noise();
  src.loop = true; // the stored noise is shorter than the flight
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 2.2;
  bp.frequency.setValueAtTime(arriving ? 2400 : 4200, t);
  bp.frequency.linearRampToValueAtTime(4200, t + peakAt);
  bp.frequency.exponentialRampToValueAtTime(900, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.34 * level, t + peakAt);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  src.start(t);
  src.stop(t + dur + 0.05);
  for (const [type, from, to, amp] of [['sine', 2100, 980, 0.05], ['triangle', 240, 120, 0.07]]) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.setValueAtTime(from, t + peakAt);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(amp * level, t + peakAt);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(og);
    og.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

// A string released: a low pluck, then the arrow whooshing away through the air.
export function playArrow(volume = 1) {
  if (muted) return;
  stopBowStretch();
  playTone(118, 0.22, 'triangle', 0.16 * volume, 92);
  playTone(236, 0.12, 'sine', 0.06 * volume, 180);
  airWhoosh({ arriving: false, dur: 0.55, level: volume });
}

// An arrow coming at you: the same whoosh, building as it comes and passing your ear.
export function playArrowIncoming() {
  airWhoosh({ arriving: true, dur: 0.62 });
}

// The bowstring being drawn: a creak of the limbs and a fibrous strain of
// the string, louder the faster you pull and deeper as the bow bends. Call
// every frame with the current draw (0..1); silent when you hold or let go.
let stretch = null;
let lastDraw = 0;
export function bowStretch(draw, dt) {
  if (muted || !ctx) {
    lastDraw = draw;
    return;
  }
  const rate = dt > 0 ? (draw - lastDraw) / dt : 0;
  lastDraw = draw;
  const level = rate > 0.05 ? Math.min(1, rate * 0.9) * (0.35 + 0.65 * draw) : 0;
  if (!stretch && level <= 0) return;
  const c = ac();
  if (!stretch) {
    const { src } = noise();
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    const creak = c.createOscillator();
    creak.type = 'sawtooth';
    const creakF = c.createBiquadFilter();
    creakF.type = 'lowpass';
    creakF.frequency.value = 700;
    // A slow wobble makes the creak uneven, like wood under load.
    const wob = c.createOscillator();
    wob.frequency.value = 23;
    const wobG = c.createGain();
    wobG.gain.value = 0.5;
    const creakAmp = c.createGain();
    creakAmp.gain.value = 0.5;
    wob.connect(wobG);
    wobG.connect(creakAmp.gain);
    const g = c.createGain();
    g.gain.value = 0.0001;
    src.connect(bp);
    bp.connect(g);
    creak.connect(creakF);
    creakF.connect(creakAmp);
    creakAmp.connect(g);
    g.connect(out());
    src.start();
    creak.start();
    wob.start();
    stretch = { src, creak, wob, bp, g };
  }
  const t = c.currentTime;
  stretch.bp.frequency.setTargetAtTime(500 + draw * 1400, t, 0.03);
  stretch.creak.frequency.setTargetAtTime(70 + draw * 60, t, 0.03);
  stretch.g.gain.setTargetAtTime(Math.max(0.0001, level * 0.22), t, 0.05);
  if (level <= 0) stopBowStretch();
}
export function stopBowStretch() {
  if (!stretch || !ctx) return;
  const s = stretch;
  stretch = null;
  const t = ctx.currentTime;
  s.g.gain.setTargetAtTime(0.0001, t, 0.04);
  for (const node of [s.src, s.creak, s.wob]) node.stop(t + 0.25);
}

// Steel on steel: inharmonic ringing partials struck hard, with a bright
// scrape. Used when blades meet and when a blow rings off the shield.
function ring(partials, dur, gain, delay = 0) {
  if (muted) return;
  const c = ac();
  const now = c.currentTime + delay;
  partials.forEach((f, i) => {
    const o = c.createOscillator();
    o.type = i === 0 ? 'triangle' : 'sine';
    o.frequency.value = f * (0.995 + Math.random() * 0.01);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain / (1 + i * 0.35), now + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur * (1 - i * 0.12));
    o.connect(g);
    g.connect(out());
    o.start(now);
    o.stop(now + dur + 0.05);
  });
}

// Blades meeting, or an arrow knocked aside: a bright, short metallic clink
// (lighter and higher than a full clang).
export function playClink() {
  if (muted) return;
  const base = 2300 + Math.random() * 500;
  ring([base, base * 1.48, base * 2.12, base * 2.9], 0.38, 0.12);
  bandNoise('highpass', 8000, 4000, 0.04, 0.16, 0.7);
}

export function playClang() {
  if (muted) return;
  const base = 900 + Math.random() * 250;
  ring([base, base * 2.32, base * 3.71, base * 5.13, base * 6.8], 0.9, 0.16);
  bandNoise('highpass', 6000, 2500, 0.09, 0.2, 0.7);
  playTone(180, 0.08, 'sine', 0.12, 90);
}

// A man's voice, roughly: a buzzing sawtooth with vibrato through two vowel
// formants. 'cry' is a low, rising battle shout from the wave; 'fear' a
// higher, falling cry when a comrade goes down.
export function playShout(kind = 'cry') {
  if (muted) return;
  const c = ac();
  const now = c.currentTime;
  const fear = kind === 'fear';
  const dur = fear ? 0.55 : 0.8;
  const voices = fear ? 1 : 3;
  for (let v = 0; v < voices; v++) {
    const t = now + v * 0.06;
    // Men's voices: a low chest pitch, a touch higher in fright but never shrill.
    const base = (fear ? 150 : 92) * (0.92 + Math.random() * 0.16);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * (fear ? 1.15 : 0.9), t);
    o.frequency.linearRampToValueAtTime(base * (fear ? 0.8 : 1.12), t + dur);
    const vib = c.createOscillator();
    vib.frequency.value = 5.5 + Math.random() * 2;
    const vibG = c.createGain();
    vibG.gain.value = base * 0.03;
    vib.connect(vibG);
    vibG.connect(o.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(fear ? 0.07 : 0.06, t + 0.06);
    g.gain.setValueAtTime(fear ? 0.07 : 0.06, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // Open-throated vowels ("hah", "rah") with a low chest resonance under them.
    for (const [f, q] of fear ? [[240, 2], [620, 4], [1050, 5]] : [[190, 2], [560, 4], [950, 5], [2400, 6]]) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      o.connect(bp);
      bp.connect(g);
    }
    g.connect(out());
    // Breath and grit on top of the tone, so it is a roar and not a note.
    const rough = noise().src;
    rough.loop = true;
    const rf = c.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = fear ? 900 : 700;
    rf.Q.value = 1.2;
    const rg = c.createGain();
    rg.gain.setValueAtTime(0.0001, t);
    rg.gain.exponentialRampToValueAtTime(fear ? 0.03 : 0.04, t + 0.05);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    rough.connect(rf);
    rf.connect(rg);
    rg.connect(out());
    rough.start(t);
    rough.stop(t + dur + 0.05);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }
}

export function playDeflect() {
  playClang();
}

// Taking a blow: a man's short grunt over the thud of the hit.
export function playHurt() {
  if (muted) return;
  playTone(85, 0.26, 'sine', 0.26, 45);
  bandNoise('lowpass', 700, 160, 0.22, 0.18, 0.7);
  const c = ac();
  const t = c.currentTime + 0.03;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(118, t);
  o.frequency.exponentialRampToValueAtTime(78, t + 0.26);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.11, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
  for (const [f, q] of [[210, 2], [520, 4], [880, 5]]) {
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = q;
    o.connect(bp);
    bp.connect(g);
  }
  g.connect(out());
  o.start(t);
  o.stop(t + 0.32);
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
  g.connect(out());
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
  g.connect(out());
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
  g.connect(out());
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
    g.connect(out());
    o.start(now);
    o.stop(now + dur + 0.05);
  }
}

function knock(freq, gain) {
  if (muted) return;
  // Wooden piece set down on a board: a short pitched thump plus a click.
  playTone(freq, 0.09, 'sine', gain, freq * 0.55);
  bandNoise('bandpass', 2600, 1200, 0.03, gain * 0.9, 1.4);
}

export function playSwipe() {
  // A piece sliding across the board: a quick, airy swipe.
  bandNoise('bandpass', 600, 3200, 0.24, 0.22, 0.9);
}

export function playPlace() {
  knock(190, 0.24);
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

// Brass: detuned saws through a filter that opens as the note swells.
function brass(freq, start, dur, gain) {
  if (muted) return;
  const c = ac();
  const t = c.currentTime + start;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(freq * 1.5, t);
  f.frequency.linearRampToValueAtTime(freq * 6, t + Math.min(0.6, dur * 0.4));
  f.frequency.linearRampToValueAtTime(freq * 3, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.35, dur * 0.3));
  g.gain.setValueAtTime(gain, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  f.connect(g);
  g.connect(out());
  for (const d of [-0.006, 0.006]) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq * (1 + d);
    o.connect(f);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

// A timpani stroke: a pitched boom that sags, with a skin slap.
function timpani(freq, start, gain) {
  if (muted) return;
  const c = ac();
  const t = c.currentTime + start;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq * 1.15, t);
  o.frequency.exponentialRampToValueAtTime(freq, t + 0.08);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  o.connect(g);
  g.connect(out());
  o.start(t);
  o.stop(t + 1.2);
  setTimeout(() => bandNoise('lowpass', 1200, 300, 0.12, gain * 0.6, 0.6), start * 1000);
}

// A crash cymbal: a long, bright noise wash.
function cymbal(start, gain) {
  setTimeout(() => {
    bandNoise('highpass', 9000, 4000, 2.2, gain, 0.4);
    bandNoise('bandpass', 5200, 3000, 1.4, gain * 0.6, 1.5);
  }, start * 1000);
}

// The monarch falls: about five seconds of score. A timpani roll builds
// under low brass in D minor, the full band swells, then a crash and a
// final D-major chord ring out over the board.
export function playVictory() {
  if (muted) return;
  // Timpani roll, accelerating and growing.
  for (let i = 0; i < 14; i++) {
    const t = 1.6 * (1 - Math.pow(1 - i / 14, 1.6));
    timpani(i % 2 ? 73.4 : 55, t, 0.18 + i * 0.022);
  }
  // Low brass: D minor, rising a step, then the swell.
  brass(73.4, 0.0, 1.1, 0.07);
  brass(110, 0.05, 1.1, 0.05);
  brass(146.8, 0.1, 1.1, 0.045);
  brass(82.4, 1.0, 0.8, 0.07);
  brass(123.5, 1.0, 0.8, 0.05);
  brass(174.6, 1.05, 0.8, 0.045);
  // The big hit: crash, timpani, and the full chord resolving to major.
  timpani(73.4, 1.85, 0.6);
  timpani(55, 1.85, 0.45);
  cymbal(1.85, 0.32);
  for (const [n, g] of [[73.4, 0.08], [146.8, 0.06], [185, 0.05], [220, 0.05], [293.7, 0.045], [370, 0.035], [440, 0.03]]) {
    brass(n, 1.85, 3.2, g);
  }
  setTimeout(() => {
    bell(587.3, 2.4, 0.08);
    bell(880, 2.2, 0.06, 0.12);
    bell(1174.7, 2.0, 0.05, 0.24);
  }, 1900);
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
