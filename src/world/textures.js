import * as THREE from 'three';
import { mulberry32 } from '../core/util.js';

// All textures in the film are painted here with the 2D canvas API at start-up;
// nothing is loaded over the network.

const MONO = '"Cascadia Mono", "JetBrains Mono", Consolas, "SF Mono", Menlo, monospace';
const SANS = '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

/**
 * 4x2 atlas of monitor contents. Top row is what the offices show on a normal
 * night, bottom row is what they show once the bugs are in.
 */
export function createScreenAtlas() {
  const TW = 256;
  const TH = 160;
  const c = makeCanvas(TW * 4, TH * 2);
  const g = c.getContext('2d');
  const rnd = mulberry32(11);
  const tile = (i, fn) => {
    g.save();
    g.translate((i % 4) * TW, Math.floor(i / 4) * TH);
    g.beginPath();
    g.rect(0, 0, TW, TH);
    g.clip();
    fn();
    g.restore();
  };

  // 0: chat window
  tile(0, () => {
    g.fillStyle = '#12151b';
    g.fillRect(0, 0, TW, TH);
    g.fillStyle = '#1b1f28';
    g.fillRect(0, 0, 54, TH);
    g.fillStyle = '#2c3340';
    for (let i = 0; i < 7; i++) rr(g, 7, 12 + i * 17, 26 + rnd() * 14, 7, 3);
    for (let i = 0; i < 5; i++) {
      const y = 12 + i * 26;
      if (i % 2 === 0) {
        g.fillStyle = '#3a4252';
        rr(g, 150 + rnd() * 30, y, 70 - rnd() * 20, 14, 7);
      } else {
        g.fillStyle = '#cfd6e2';
        rr(g, 66, y, 110 + rnd() * 60, 5, 2);
        rr(g, 66, y + 9, 70 + rnd() * 80, 5, 2);
      }
    }
    g.fillStyle = '#242a35';
    rr(g, 64, TH - 24, TW - 74, 16, 8);
    g.fillStyle = '#e9edf3';
    g.beginPath();
    g.arc(TW - 20, TH - 16, 5, 0, Math.PI * 2);
    g.fill();
  });

  // 1: code editor
  tile(1, () => {
    g.fillStyle = '#0d1117';
    g.fillRect(0, 0, TW, TH);
    g.fillStyle = '#161b22';
    g.fillRect(0, 0, TW, 14);
    g.fillStyle = '#30363d';
    rr(g, 6, 3, 58, 9, 2);
    const cols = ['#ff7b72', '#79c0ff', '#a5d6ff', '#d2a8ff', '#7ee787', '#c9d1d9', '#ffa657'];
    for (let i = 0; i < 15; i++) {
      const y = 21 + i * 9;
      g.fillStyle = '#3b434d';
      g.fillRect(6, y, 8, 4);
      let x = 22 + Math.floor(rnd() * 4) * 10;
      const n = 1 + Math.floor(rnd() * 5);
      for (let k = 0; k < n; k++) {
        const w = 10 + rnd() * 42;
        g.fillStyle = cols[Math.floor(rnd() * cols.length)];
        g.fillRect(x, y, w, 4);
        x += w + 5;
      }
    }
  });

  // 2: metrics dashboard (bright)
  tile(2, () => {
    g.fillStyle = '#b9c2cf';
    g.fillRect(0, 0, TW, TH);
    g.fillStyle = '#dfe5ee';
    rr(g, 8, 8, 116, 68, 6);
    rr(g, 132, 8, 116, 68, 6);
    rr(g, 8, 84, 240, 68, 6);
    g.fillStyle = '#2f6bff';
    for (let i = 0; i < 9; i++) {
      const h = 10 + rnd() * 44;
      g.fillRect(16 + i * 12, 68 - h, 8, h);
    }
    g.strokeStyle = '#10b981';
    g.lineWidth = 3;
    g.beginPath();
    for (let i = 0; i <= 10; i++) {
      const x = 140 + i * 10;
      const y = 60 - i * 3.4 - rnd() * 10;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = '#111827';
    g.font = `700 30px ${SANS}`;
    g.fillText('99.99%', 18, 128);
    g.fillStyle = '#9aa4b2';
    g.font = `600 11px ${SANS}`;
    g.fillText('UPTIME', 18, 144);
    g.fillStyle = '#d7dde6';
    for (let i = 0; i < 4; i++) rr(g, 150, 96 + i * 13, 60 + rnd() * 30, 6, 3);
  });

  // 3: terminal
  tile(3, () => {
    g.fillStyle = '#050607';
    g.fillRect(0, 0, TW, TH);
    g.font = `600 11px ${MONO}`;
    const lines = [
      ['$ pytest -q', '#e5e7eb'],
      ['........................', '#4ade80'],
      ['1337 passed in 4.20s', '#4ade80'],
      ['$ git push origin main', '#e5e7eb'],
      ['Everything up-to-date', '#9ca3af'],
      ['$ deploy --prod', '#e5e7eb'],
      ['ok  all systems nominal', '#4ade80'],
      ['$ _', '#e5e7eb'],
    ];
    lines.forEach(([s, col], i) => {
      g.fillStyle = col;
      g.fillText(s, 10, 22 + i * 17);
    });
  });

  // 4: ERROR
  tile(4, () => {
    const grad = g.createLinearGradient(0, 0, 0, TH);
    grad.addColorStop(0, '#ff2a1a');
    grad.addColorStop(1, '#8f0500');
    g.fillStyle = grad;
    g.fillRect(0, 0, TW, TH);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.font = `900 62px ${SANS}`;
    g.fillText('ERROR', TW / 2, 88);
    g.font = `700 14px ${MONO}`;
    g.fillText('0xDEADBEEF  unhandled bug', TW / 2, 118);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillRect(40, 132, TW - 80, 4);
  });

  // 5: blue screen
  tile(5, () => {
    g.fillStyle = '#0b4fd6';
    g.fillRect(0, 0, TW, TH);
    g.fillStyle = '#ffffff';
    g.textAlign = 'left';
    g.font = `300 64px ${SANS}`;
    g.fillText(':(', 20, 70);
    g.font = `600 13px ${SANS}`;
    g.fillText('Your building ran into a bug', 20, 98);
    g.fillText('and needs to restart.', 20, 114);
    g.font = `600 10px ${MONO}`;
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillText('Stop code: BUGS_BUGS_BUGS', 20, 140);
  });

  // 6: bug pictogram
  tile(6, () => {
    g.fillStyle = '#020a03';
    g.fillRect(0, 0, TW, TH);
    g.shadowColor = '#39ff14';
    g.shadowBlur = 14;
    g.strokeStyle = '#5dff3a';
    g.fillStyle = '#5dff3a';
    g.lineWidth = 6;
    g.lineCap = 'round';
    const cx = TW / 2;
    const cy = TH / 2 + 4;
    for (const s of [-1, 1]) {
      for (let i = -1; i <= 1; i++) {
        g.beginPath();
        g.moveTo(cx + s * 22, cy + i * 20);
        g.lineTo(cx + s * 50, cy + i * 30 - 4);
        g.lineTo(cx + s * 62, cy + i * 30 + 12);
        g.stroke();
      }
      g.beginPath();
      g.moveTo(cx + s * 8, cy - 44);
      g.quadraticCurveTo(cx + s * 16, cy - 66, cx + s * 34, cy - 66);
      g.stroke();
    }
    g.beginPath();
    g.ellipse(cx, cy + 6, 26, 38, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(cx, cy - 38, 15, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = '#020a03';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx, cy - 22);
    g.lineTo(cx, cy + 42);
    g.moveTo(cx - 24, cy);
    g.lineTo(cx + 24, cy);
    g.moveTo(cx - 22, cy + 18);
    g.lineTo(cx + 22, cy + 18);
    g.stroke();
  });

  // 7: glitch / 404
  tile(7, () => {
    g.fillStyle = '#0a0a0a';
    g.fillRect(0, 0, TW, TH);
    const bars = ['#00ff9c', '#ff0066', '#00c2ff', '#ffe600', '#ffffff', '#39ff14', '#7a00ff'];
    for (let i = 0; i < 34; i++) {
      g.fillStyle = bars[Math.floor(rnd() * bars.length)];
      g.globalAlpha = 0.35 + rnd() * 0.65;
      g.fillRect(rnd() * TW - 30, rnd() * TH, 20 + rnd() * 150, 2 + rnd() * 9);
    }
    g.globalAlpha = 1;
    g.textAlign = 'center';
    g.font = `900 78px ${SANS}`;
    g.fillStyle = '#ff0066';
    g.fillText('404', TW / 2 - 4, 106);
    g.fillStyle = '#00e5ff';
    g.fillText('404', TW / 2 + 4, 110);
    g.fillStyle = '#ffffff';
    g.fillText('404', TW / 2, 108);
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** 16x16 grid of glyphs for the code rain that takes over infected windows. */
export function createGlyphAtlas() {
  const N = 16;
  const S = 32;
  const c = makeCanvas(N * S, N * S);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  const chars =
    '0123456789ABCDEFXZ<>{}[]()/\\|=+-*&^%$#@!?;:~_' +
    'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
  const rnd = mulberry32(5);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 25px ${MONO}`;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const ch = chars[Math.floor(rnd() * chars.length)];
      g.fillText(ch, x * S + S / 2, y * S + S / 2 + 1);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export const ERROR_LINES = [
  'NullPointerException',
  'undefined is not a function',
  'Segmentation fault (core dumped)',
  'TypeError: bug is not defined',
  '404 Not Found',
  '0xDEADBEEF',
  'off-by-one',
  'race condition detected',
  'CONFLICT (content): merge conflict',
  'TODO: fix later',
  'works on my machine',
  'stack overflow',
  'NaN',
  'Uncaught (in promise)',
  'panic: runtime error',
  'ECONNRESET',
  'heisenbug',
  'memory leak',
  'deadlock',
  'git push --force',
  'rm -rf /',
  'sudo make it work',
  '// this should never happen',
  'kernel panic',
  'infinite loop',
  'cannot read properties of null',
  '500 Internal Server Error',
  'it compiled yesterday',
  'legacy code',
  'no tests found',
  'CORS error',
  'npm ERR!',
];

/** Atlas of error messages: 4 columns x 8 rows, drawn white so the shader can tint them. */
export function createErrorAtlas() {
  const COLS = 4;
  const ROWS = 8;
  const CW = 512;
  const CH = 64;
  const c = makeCanvas(COLS * CW, ROWS * CH);
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < COLS * ROWS; i++) {
    const s = ERROR_LINES[i % ERROR_LINES.length];
    let size = 34;
    g.font = `700 ${size}px ${MONO}`;
    const w = g.measureText(s).width;
    if (w > CW - 28) {
      size = Math.floor((size * (CW - 28)) / w);
      g.font = `700 ${size}px ${MONO}`;
    }
    g.fillText(s, (i % COLS) * CW + CW / 2, Math.floor(i / COLS) * CH + CH / 2 + 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return { texture: tex, cols: COLS, rows: ROWS, aspect: CW / CH };
}

/** Glowing PCB traces for the shells of the hero bugs. Returns an emissive map. */
export function createCircuitTexture(seed = 3) {
  const S = 512;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const GRID = 16;
  const step = S / GRID;
  g.shadowColor = '#fff';
  for (let i = 0; i < 46; i++) {
    let x = Math.floor(rnd() * GRID);
    let y = Math.floor(rnd() * GRID);
    const bright = 150 + Math.floor(rnd() * 105);
    g.strokeStyle = `rgb(${bright},${bright},${bright})`;
    g.fillStyle = g.strokeStyle;
    g.lineWidth = 2 + rnd() * 2.2;
    g.shadowBlur = 4;
    g.beginPath();
    g.moveTo(x * step + step / 2, y * step + step / 2);
    let dir = Math.floor(rnd() * 4);
    const segs = 2 + Math.floor(rnd() * 5);
    for (let k = 0; k < segs; k++) {
      const len = 1 + Math.floor(rnd() * 4);
      const dx = [1, 0, -1, 0][dir];
      const dy = [0, 1, 0, -1][dir];
      // 45 degree chamfers, like a real board
      if (k > 0 && rnd() < 0.5) {
        x += dx;
        y += [1, -1][Math.floor(rnd() * 2)] * (dx !== 0 ? 1 : 0);
      }
      x += dx * len;
      y += dy * len;
      g.lineTo(x * step + step / 2, y * step + step / 2);
      dir = (dir + (rnd() < 0.5 ? 1 : 3)) % 4;
    }
    g.stroke();
    g.beginPath();
    g.arc(x * step + step / 2, y * step + step / 2, g.lineWidth * 1.7, 0, Math.PI * 2);
    g.fill();
  }
  // centre seam between the wing cases
  g.shadowBlur = 8;
  g.strokeStyle = '#fff';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(S / 2, 0);
  g.lineTo(S / 2, S);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Compound-eye facets: bright hexagonal cells with dark seams. */
export function createEyeTexture() {
  const S = 256;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = '#2a2a2a';
  g.fillRect(0, 0, S, S);
  const r = 9;
  const dx = r * Math.sqrt(3);
  const dy = r * 1.5;
  for (let row = -1; row * dy < S + r; row++) {
    for (let col = -1; col * dx < S + dx; col++) {
      const cx = col * dx + (row % 2 ? dx / 2 : 0);
      const cy = row * dy;
      const grad = g.createRadialGradient(cx - 2, cy - 2, 0, cx, cy, r);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.7, '#bdbdbd');
      grad.addColorStop(1, '#6a6a6a');
      g.fillStyle = grad;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        g.lineTo(cx + Math.cos(a) * (r - 1.3), cy + Math.sin(a) * (r - 1.3));
      }
      g.closePath();
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.anisotropy = 4;
  return tex;
}

/** Soft round sprite used for glows. */
export function createGlowTexture() {
  const S = 128;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
