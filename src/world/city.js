import * as THREE from 'three';
import { GLSL_HASH, GLSL_FOG } from '../core/glsl.js';
import { mulberry32 } from '../core/util.js';
import { BEAT } from '../config.js';

// The surrounding city: a few hundred instanced blocks with procedural lit
// windows, dissolving into the fog. When the queen screams, a blackout wave
// rolls outwards from the HQ, and some windows come back the wrong colour.

export function createCity(U) {
  const rnd = mulberry32(777);
  const lots = [];
  const LOT = 38;
  for (let gx = -15; gx <= 15; gx++) {
    for (let gz = -15; gz <= 15; gz++) {
      const cx = gx * LOT + (rnd() - 0.5) * 9;
      const cz = gz * LOT + (rnd() - 0.5) * 9;
      const r = Math.hypot(cx + 1, cz - 6);
      if (r > 575) continue;
      // the HQ block and the streets around it
      if (cx > -124 && cx < 122 && cz > -98 && cz < 112) continue;
      // open corridor in front of the HQ, so wide shots are unobstructed
      if (cz > 60 && cz < 250 && Math.abs(cx + 4) < 62 + (cz - 60) * 0.45) continue;
      if (rnd() < 0.1) continue;
      let h = 13 + rnd() * rnd() * 40;
      // downtown rises behind the HQ
      const downtown = Math.max(0, Math.min(1, (-cz - 110) / 220)) * (0.5 + 0.5 * Math.max(0, 1 - Math.abs(cx + 30) / 420));
      if (rnd() < 0.2 + 0.55 * downtown) h += (30 + rnd() * 150) * (0.35 + 0.65 * downtown);
      const w = 19 + rnd() * 14;
      const d = 19 + rnd() * 14;
      lots.push({ x: cx, z: cz, w, d, h, seed: rnd() });
    }
  }

  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const seeds = new Float32Array(lots.length);
  lots.forEach((l, i) => (seeds[i] = l.seed));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));

  const material = new THREE.ShaderMaterial({
    name: 'City',
    uniforms: {
      uTime: U.uTime,
      uFogColor: U.uFogColor,
      uFogDensity: U.uFogDensity,
      uMoonDir: U.uMoonDir,
      uPulseT: { value: BEAT.screech },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      varying vec3 vLocal;
      varying vec3 vHalf;
      varying vec3 vNrm;
      varying float vSeed;
      varying float vDist;
      varying float vFromHQ;
      void main() {
        vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vLocal = position * sc;
        vHalf = sc * 0.5;
        vNrm = normal;
        vSeed = aSeed;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vFromHQ = length(instanceMatrix[3].xz);
        vec4 mv = viewMatrix * wp;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform vec3 uMoonDir;
      uniform float uPulseT;
      varying vec3 vLocal;
      varying vec3 vHalf;
      varying vec3 vNrm;
      varying float vSeed;
      varying float vDist;
      varying float vFromHQ;
      ${GLSL_HASH}
      ${GLSL_FOG}
      void main() {
        vec3 n = normalize(vNrm);
        vec3 col = vec3(0.011, 0.012, 0.017) + vec3(0.012, 0.016, 0.03) * max(dot(n, uMoonDir), 0.0);
        if (abs(n.y) < 0.5) {
          bool xFace = abs(n.x) > 0.5;
          vec2 uv = xFace ? vec2(vLocal.z + vHalf.z, vLocal.y) : vec2(vLocal.x + vHalf.x, vLocal.y);
          vec2 g = uv / vec2(3.3, 3.7);
          vec2 id = floor(g);
          vec2 f = fract(g);
          float face = n.x * 1.0 + n.z * 2.0;
          vec3 r = hash32(id + vSeed * 91.0 + face * 13.0);
          float px = max(fwidth(g.x), fwidth(g.y));
          float sharp = 1.0 - smoothstep(0.25, 0.9, px);
          float win = step(0.24, f.x) * step(f.x, 0.76) * step(0.30, f.y) * step(f.y, 0.72);
          win = mix(0.22, win, sharp);
          float litProb = 0.07 + 0.17 * fract(vSeed * 7.7);
          float lit = step(1.0 - litProb, r.x);
          vec3 wc = mix(vec3(1.0, 0.74, 0.44), vec3(0.72, 0.86, 1.0), step(0.62, r.y));

          // blackout rolling out from the HQ, then a sickly return
          float after = uTime - (uPulseT + 0.15 + vFromHQ * 0.0042);
          float on = 1.0 - smoothstep(0.0, 0.2, after);
          float back = smoothstep(1.0 + r.z * 5.0, 1.4 + r.z * 5.0, after) * step(0.55, r.x);
          vec3 sick = r.z > 0.78 ? vec3(1.0, 0.07, 0.03) : vec3(0.12, 1.0, 0.24);
          float flick = 0.55 + 0.45 * step(0.3, hash12(id + floor(uTime * 8.0) * 0.37 + vSeed));
          col += (wc * lit * on * 0.6 + sick * back * flick * 0.6) * win;
        }
        col = applyFog(col, vDist, uFogColor, uFogDensity);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.InstancedMesh(geo, material, lots.length);
  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  lots.forEach((l, i) => {
    pos.set(l.x, 0, l.z);
    scl.set(l.w, l.h, l.d);
    m4.compose(pos, quat, scl);
    mesh.setMatrixAt(i, m4);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.name = 'city';

  // aviation lights on the tall ones
  const tall = lots.filter((l) => l.h > 62);
  const lp = new Float32Array(tall.length * 3);
  const ls = new Float32Array(tall.length);
  tall.forEach((l, i) => {
    lp.set([l.x, l.h + 2.5, l.z], i * 3);
    ls[i] = l.seed;
  });
  const lightGeo = new THREE.BufferGeometry();
  lightGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  lightGeo.setAttribute('aSeed', new THREE.BufferAttribute(ls, 1));
  const lights = new THREE.Points(
    lightGeo,
    new THREE.ShaderMaterial({
      name: 'CityBeacons',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: U.uTime, uFogDensity: U.uFogDensity, uPulseT: { value: BEAT.screech } },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform float uFogDensity;
        uniform float uPulseT;
        varying float vI;
        void main() {
          vec4 mv = viewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          gl_PointSize = clamp(900.0 / dist, 2.0, 7.0);
          float blink = pow(max(0.0, sin(uTime * (0.9 + aSeed) + aSeed * 40.0)), 8.0);
          float alive = 1.0 - smoothstep(0.0, 0.2, uTime - (uPulseT + 0.15 + length(position.xz) * 0.0042));
          vI = (0.15 + blink) * exp(-uFogDensity * uFogDensity * dist * dist * 0.6) * alive;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vI;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          gl_FragColor = vec4(vec3(1.0, 0.07, 0.03) * vI * max(0.0, 1.0 - d) * 2.5, 1.0);
        }
      `,
    }),
  );
  lights.frustumCulled = false;

  const group = new THREE.Group();
  group.name = 'cityGroup';
  group.add(mesh, lights);
  return { group, count: lots.length };
}
