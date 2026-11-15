import * as THREE from 'three';

// Procedural surface textures for a gritty, realistic look: brushed and
// scratched steel, riveted mail, woven cloth, grained leather and wood,
// stone and churned mud. Painted once on small canvases (128-256 px), shared
// by every material and tiled, so they cost a few hundred KB of GPU memory
// and nothing to download.

const cache = new Map();

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvasTex(key, size, draw, { srgb = true, repeat = 1 } = {}) {
  const k = `${key}|${srgb}`;
  if (cache.has(k)) return cache.get(k);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  draw(g, size, rand(key.length * 7919 + size));
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  cache.set(k, tex);
  return tex;
}

function noise(g, size, r, count, minR, maxR, light, dark) {
  for (let i = 0; i < count; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = minR + r() * (maxR - minR);
    const a = r() < 0.5 ? light : dark;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(${a},${a},${a},${0.08 + r() * 0.12})`);
    grad.addColorStop(1, `rgba(${a},${a},${a},0)`);
    g.fillStyle = grad;
    // Draw wrapped so the texture tiles.
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
  }
}

/** Brushed, scratched, slightly pitted steel (grey; tint with material colour). */
export function steelTex() {
  return canvasTex('steel', 256, (g, s, r) => {
    g.fillStyle = '#b8b8b8';
    g.fillRect(0, 0, s, s);
    // Brushing: long faint streaks.
    for (let i = 0; i < 320; i++) {
      const y = r() * s;
      const c = 150 + Math.floor(r() * 80);
      g.strokeStyle = `rgba(${c},${c},${c},0.18)`;
      g.lineWidth = 0.5 + r();
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(s, y + (r() - 0.5) * 6);
      g.stroke();
    }
    noise(g, s, r, 70, 6, 28, 200, 60);
    // Scratches and nicks.
    for (let i = 0; i < 60; i++) {
      const x = r() * s;
      const y = r() * s;
      const len = 6 + r() * 30;
      const a = r() * Math.PI;
      g.strokeStyle = r() < 0.5 ? 'rgba(235,235,235,0.5)' : 'rgba(40,40,40,0.45)';
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
    // Rust and grime spots.
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(${90 + Math.floor(r() * 40)},${55 + Math.floor(r() * 25)},${30 + Math.floor(r() * 15)},${0.08 + r() * 0.12})`;
      g.beginPath();
      g.arc(r() * s, r() * s, 2 + r() * 9, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** Roughness map to pair with steelTex: polished patches and worn edges. */
export function steelRough() {
  return canvasTex('steelRough', 128, (g, s, r) => {
    g.fillStyle = '#6a6a6a';
    g.fillRect(0, 0, s, s);
    noise(g, s, r, 60, 4, 20, 150, 40);
  }, { srgb: false });
}

/** Riveted chainmail rings. */
export function mailTex() {
  return canvasTex('mail', 128, (g, s) => {
    g.fillStyle = '#1c1c1d';
    g.fillRect(0, 0, s, s);
    const step = 8;
    for (let row = 0; row <= s / step + 1; row++) {
      for (let col = 0; col <= s / step + 1; col++) {
        const x = col * step + (row % 2 ? step / 2 : 0);
        const y = row * step * 0.8;
        g.strokeStyle = '#8c8d90';
        g.lineWidth = 2.2;
        g.beginPath();
        g.ellipse(x, y, step * 0.42, step * 0.34, 0, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = 'rgba(230,230,230,0.55)';
        g.lineWidth = 0.8;
        g.beginPath();
        g.ellipse(x, y - 0.6, step * 0.38, step * 0.28, 0, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
      }
    }
  }, { repeat: 3 });
}

/** Woven wool / linen, slightly worn and dirty. */
export function clothTex() {
  return canvasTex('cloth', 128, (g, s, r) => {
    g.fillStyle = '#9a9a9a';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 2) {
      g.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.06})`;
      g.fillRect(i, 0, 1, s);
      g.fillStyle = `rgba(0,0,0,${0.06 + r() * 0.06})`;
      g.fillRect(0, i, s, 1);
    }
    noise(g, s, r, 40, 6, 24, 180, 40);
  }, { repeat: 2 });
}

/** Grained, creased leather. */
export function leatherTex() {
  return canvasTex('leather', 128, (g, s, r) => {
    g.fillStyle = '#8a8a8a';
    g.fillRect(0, 0, s, s);
    noise(g, s, r, 140, 2, 8, 170, 50);
    for (let i = 0; i < 30; i++) {
      g.strokeStyle = 'rgba(30,30,30,0.25)';
      g.lineWidth = 0.7;
      g.beginPath();
      const x = r() * s;
      const y = r() * s;
      g.moveTo(x, y);
      g.quadraticCurveTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 30, x + (r() - 0.5) * 40, y + (r() - 0.5) * 40);
      g.stroke();
    }
  }, { repeat: 2 });
}

/** Wood grain running along the texture's V axis. */
export function woodTex() {
  return canvasTex('wood', 128, (g, s, r) => {
    g.fillStyle = '#8f8f8f';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) {
      const x = r() * s;
      const c = 60 + Math.floor(r() * 110);
      g.strokeStyle = `rgba(${c},${c},${c},0.35)`;
      g.lineWidth = 0.5 + r() * 2;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + (r() - 0.5) * 10, s * 0.33, x + (r() - 0.5) * 10, s * 0.66, x, s);
      g.stroke();
    }
    noise(g, s, r, 12, 3, 8, 40, 40);
  }, { repeat: 1 });
}

/** Dressed stone blocks with mortar lines, chips and weathering. */
export function stoneTex() {
  return canvasTex('stone', 256, (g, s, r) => {
    g.fillStyle = '#8a8580';
    g.fillRect(0, 0, s, s);
    const rows = 6;
    const h = s / rows;
    for (let row = 0; row < rows; row++) {
      let x = row % 2 ? -h * 0.6 : 0;
      while (x < s) {
        const w = h * (1.1 + r() * 0.9);
        const c = 105 + Math.floor(r() * 55);
        g.fillStyle = `rgb(${c},${c - 4},${c - 9})`;
        g.fillRect(x + 1.5, row * h + 1.5, w - 3, h - 3);
        x += w;
      }
    }
    noise(g, s, r, 160, 3, 16, 200, 30);
    g.strokeStyle = 'rgba(25,22,20,0.55)';
    g.lineWidth = 2;
    for (let row = 0; row <= rows; row++) {
      g.beginPath();
      g.moveTo(0, row * h);
      g.lineTo(s, row * h);
      g.stroke();
    }
  }, { repeat: 1 });
}

/** Churned mud and gravel for the ground (grey; multiplied by vertex colour). */
export function mudTex() {
  return canvasTex('mud', 256, (g, s, r) => {
    g.fillStyle = '#9a9a9a';
    g.fillRect(0, 0, s, s);
    noise(g, s, r, 260, 4, 30, 190, 50);
    for (let i = 0; i < 500; i++) {
      const c = 60 + Math.floor(r() * 140);
      g.fillStyle = `rgba(${c},${c},${c},0.55)`;
      g.beginPath();
      g.arc(r() * s, r() * s, 0.6 + r() * 2.2, 0, Math.PI * 2);
      g.fill();
    }
  }, { repeat: 1 });
}

/** A bump map from any of the above (same canvas, linear colour space). */
export function asBump(tex) {
  const key = `bump|${tex.uuid}`;
  if (cache.has(key)) return cache.get(key);
  const b = tex.clone();
  b.colorSpace = THREE.NoColorSpace;
  b.needsUpdate = true;
  cache.set(key, b);
  return b;
}
