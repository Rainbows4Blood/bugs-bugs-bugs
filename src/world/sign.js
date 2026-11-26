import * as THREE from 'three';
import { SIGN, BEAT } from '../config.js';
import { glyphGeometry, advance, CAP_HEIGHT } from '../core/font.js';
import { hash1, mulberry32, smoothstep, hit } from '../core/util.js';

// The big illuminated wordmark on the tower's crown. As the swarm reaches it the
// letters stutter, three of them scramble through garbage glyphs, and the sign
// settles - in emergency red - on a new word.

const BASE = 'OpenAI';
const FINAL = 'OopsAI';
const GARBAGE = '#?!%@$&X01<>/{}*=+';
const SWAPS = [
  { slot: 1, t0: 43.3, t1: 44.3 },
  { slot: 2, t0: 44.25, t1: 45.3 },
  { slot: 3, t0: 45.2, t1: BEAT.signOops },
];

function charAt(i, t) {
  const sw = SWAPS.find((s) => s.slot === i);
  if (!sw || t < sw.t0) return BASE[i];
  if (t >= sw.t1) return FINAL[i];
  return GARBAGE[Math.floor(hash1(Math.floor(t * 15) * 3.7 + i * 11.3) * GARBAGE.length)];
}

function levelAt(i, t) {
  if (t < 37) return 1;
  if (t < BEAT.signGlitch) return hash1(i * 5.1 + Math.floor(t * 9)) < 0.2 * smoothstep(37, BEAT.signGlitch, t) ? 0.12 : 1;
  if (t < BEAT.signOops) return hash1(i * 5.1 + Math.floor(t * 14)) < 0.36 ? 0.05 : 1;
  const k = t - BEAT.screech;
  if (k > 0 && k < 0.75) return 0.02;
  return hash1(i * 5.1 + Math.floor(t * 10)) < 0.055 ? 0.18 : 0.86 + 0.14 * Math.sin(t * 3 + i);
}

export function createSign(U) {
  const group = new THREE.Group();
  group.name = 'sign';
  const size = SIGN.cap / CAP_HEIGHT;
  const baseWidth = [...BASE].reduce((s, ch) => s + advance(ch, size), 0);
  const left = SIGN.x - baseWidth / 2;

  const side = new THREE.MeshStandardMaterial({ color: 0x0d0e12, roughness: 0.4, metalness: 0.85 });
  const letters = [...BASE].map((ch) => {
    const face = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mesh = new THREE.Mesh(glyphGeometry(ch, size, SIGN.depth), [face, side]);
    mesh.position.set(0, SIGN.y, SIGN.z);
    group.add(mesh);
    return { mesh, face, ch };
  });

  // centre of each letter in its resting layout (spark emitters)
  const centers = [];
  {
    let x = left;
    for (const ch of BASE) {
      const a = advance(ch, size);
      centers.push(x + a / 2);
      x += a;
    }
  }

  const light = new THREE.PointLight(0xffffff, 0, 70, 2);
  light.position.set(SIGN.x, SIGN.y + SIGN.cap * 0.5, SIGN.z + 7);
  group.add(light);

  // ---- sparks -------------------------------------------------------------
  const rnd = mulberry32(31337);
  const sp = { origin: [], vel: [], birth: [], life: [], loop: [] };
  const burst = (slot, time, n, power = 1, loop = 0) => {
    for (let k = 0; k < n; k++) {
      const x = centers[slot] + (rnd() - 0.5) * 3.2;
      const y = SIGN.y + rnd() * SIGN.cap;
      sp.origin.push(x, y, SIGN.z + SIGN.depth + 0.1);
      const a = rnd() * Math.PI * 2;
      const s = (1.5 + rnd() * 6.5) * power;
      sp.vel.push(Math.cos(a) * s * 0.8, 1.2 + Math.sin(a) * s * 0.6 + rnd() * 3, 1.5 + rnd() * 7 * power);
      sp.birth.push(time + rnd() * 0.22);
      sp.life.push(0.8 + rnd() * 1.3);
      sp.loop.push(loop);
    }
  };
  for (const sw of SWAPS) {
    burst(sw.slot, sw.t0, 40);
    burst(sw.slot, sw.t1, 70, 1.25);
  }
  for (let k = 0; k < 14; k++) burst(Math.floor(rnd() * 6), BEAT.signGlitch + rnd() * (BEAT.signOops - BEAT.signGlitch), 16, 0.8);
  for (let i = 0; i < 6; i++) burst(i, BEAT.signOops, 34, 1.5);
  // the damaged sign keeps spitting every few seconds
  for (let k = 0; k < 9; k++) burst(Math.floor(rnd() * 6), BEAT.signOops + 1 + rnd() * 6, 12, 0.8, 4 + rnd() * 4);

  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp.origin, 3));
  sparkGeo.setAttribute('aVel', new THREE.Float32BufferAttribute(sp.vel, 3));
  sparkGeo.setAttribute('aBirth', new THREE.Float32BufferAttribute(sp.birth, 1));
  sparkGeo.setAttribute('aLife', new THREE.Float32BufferAttribute(sp.life, 1));
  sparkGeo.setAttribute('aLoop', new THREE.Float32BufferAttribute(sp.loop, 1));
  const sparkMat = new THREE.ShaderMaterial({
    name: 'Sparks',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.uTime, uPx: { value: 1000 } },
    vertexShader: /* glsl */ `
      attribute vec3 aVel;
      attribute float aBirth;
      attribute float aLife;
      attribute float aLoop;
      uniform float uTime;
      uniform float uPx;
      varying vec3 vCol;
      void main() {
        float age = uTime - aBirth;
        if (aLoop > 0.0 && age > 0.0) age = mod(age, aLoop);
        float k = age / aLife;
        vec3 p = position + aVel * age + vec3(0.0, -4.9 * age * age, 0.0);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float alive = step(0.0, age) * step(k, 1.0);
        gl_PointSize = alive * clamp(uPx * 0.16 * (1.0 - 0.6 * k) / max(-mv.z, 0.1), 1.6, 12.0);
        vec3 hot = mix(vec3(1.0, 0.95, 0.75), vec3(1.0, 0.35, 0.05), smoothstep(0.0, 0.7, k));
        vCol = hot * alive * (1.0 - k * k) * 6.0;
        if (alive < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(vCol * max(0.0, 1.0 - d), 1.0);
      }
    `,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  group.add(sparks);

  const white = new THREE.Color(1.0, 0.96, 0.9);
  const red = new THREE.Color(1.0, 0.012, 0.02);
  const green = new THREE.Color(0.2, 1.0, 0.3);
  const c = new THREE.Color();
  const sum = new THREE.Color();

  return {
    group,
    text: (t) => letters.map((_, i) => charAt(i, t)).join(''),
    setViewport(heightPx, fovDeg) {
      sparkMat.uniforms.uPx.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    },
    update(state) {
      const t = state.time;
      const settled = t >= BEAT.signOops;
      const flash = hit(t, BEAT.signOops, 0.18);
      let x = left;
      sum.setRGB(0, 0, 0);
      letters.forEach((L, i) => {
        const ch = charAt(i, t);
        if (ch !== L.ch) {
          L.ch = ch;
          L.mesh.geometry = glyphGeometry(ch, size, SIGN.depth);
        }
        L.mesh.position.x = x;
        x += advance(ch, size);
        const scrambling = !settled && ch !== BASE[i] && ch !== FINAL[i];
        const level = levelAt(i, t) * state.power;
        if (settled) c.copy(red).multiplyScalar(1.45).lerp(white, Math.min(1, flash)).multiplyScalar(1 + flash * 1.5);
        else if (scrambling) c.copy(green).multiplyScalar(1.7);
        else c.copy(white).multiplyScalar(1.06);
        c.multiplyScalar(0.03 + 0.97 * level);
        L.face.color.copy(c);
        sum.add(c);
      });
      sum.multiplyScalar(1 / letters.length);
      U.uSignCol.value.copy(sum);
      light.color.copy(sum);
      const m = Math.max(sum.r, sum.g, sum.b);
      if (m > 0) light.color.multiplyScalar(1 / m);
      light.intensity = m * 120;
    },
  };
}
