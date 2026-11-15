import * as THREE from 'three';

export function paintText(text, {
  width = 1024,
  height = 256,
  color = '#f4ead8',
  font = '600 92px Cinzel, Palatino, Georgia, serif',
  sub = '',
  subColor = '#d9cbb0',
  bg = null,
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, width, height);
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, width, height);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.font = font;
  if (sub) {
    g.fillText(text, width / 2, height * 0.38, width * 0.94);
    g.font = '500 48px Outfit, Segoe UI, sans-serif';
    g.fillStyle = subColor;
    g.fillText(sub, width / 2, height * 0.72);
  } else {
    // Squeeze long labels to fit rather than clipping them.
    g.fillText(text, width / 2, height / 2, width * 0.94);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function makeTextSprite(text, color, scale = [0.18, 0.045]) {
  const tex = paintText(text, { color, width: 1024, height: 256, font: '600 100px Cinzel, Palatino, Georgia, serif' });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Mesh(new THREE.PlaneGeometry(scale[0], scale[1]), mat);
  sprite.userData.label = text;
  sprite.userData.color = color;
  sprite.userData.base = scale.slice();
  return sprite;
}

export function setSpriteText(sprite, text, color) {
  if (sprite.userData.label === text && sprite.userData.color === color) return;
  sprite.userData.label = text;
  sprite.userData.color = color;
  const prev = sprite.material.map;
  sprite.material.map = paintText(text, { color, width: 1024, height: 256, font: '600 100px Cinzel, Palatino, Georgia, serif' });
  sprite.material.needsUpdate = true;
  prev?.dispose();
}
