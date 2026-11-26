import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/util.js';
import { SIGN, LAMPS } from '../config.js';

// The airborne half of the invasion. Like the crawlers, every flyer follows a
// closed-form flight path evaluated in the vertex shader: it spirals in out of
// the dark and settles into an orbit - around the sign, around the tower, or,
// moth-like, around a street lamp.

const FLY_GLSL = /* glsl */ `
uniform float uTime;
attribute vec4 iF1;   // kind, orbit radius, start angle, angular speed
attribute vec4 iF2;   // spawn time, orbit height, seed, size
attribute vec3 iF3;   // orbit centre

vec3 flyPos(float t) {
  float tt = t - iF2.x;
  float a = clamp(tt / 11.0, 0.0, 1.0);
  float e = 1.0 - (1.0 - a) * (1.0 - a) * (1.0 - a);
  float seed = iF2.z;
  float ang = iF1.z + iF1.w * tt * mix(0.25, 1.0, e);
  vec3 p;
  if (iF1.x < 0.5) {
    // swarming the sign: flattened loops just in front of the facade
    float rx = mix(150.0, iF1.y, e);
    float ry = mix(46.0, iF1.y * 0.3, e);
    p = iF3 + vec3(cos(ang) * rx,
                   sin(ang * 1.3 + seed * 6.0) * ry + (1.0 - e) * 34.0,
                   1.4 + (1.0 + sin(ang * 0.7 + seed * 9.0)) * mix(55.0, 2.6, e));
  } else if (iF1.x < 1.5) {
    // circling the tower
    float r = mix(240.0, iF1.y, e);
    p = iF3 + vec3(cos(ang) * r * 1.25, mix(95.0, iF2.y, e) + sin(tt * 0.7 + seed * 10.0) * 2.5, sin(ang) * r);
  } else {
    // moths at a lamp
    float r = mix(70.0, iF1.y, e);
    p = iF3 + vec3(cos(ang) * r, mix(26.0, iF2.y, e) + sin(tt * 2.1 + seed * 10.0) * 0.5, sin(ang) * r);
  }
  p += vec3(sin(tt * 2.3 + seed * 20.0), sin(tt * 3.1 + seed * 40.0), sin(tt * 2.7 + seed * 60.0)) * 0.45;
  return p;
}
`;

function buildFlyerGeometry() {
  const parts = [];
  const tag = (g, color, wing, glow) => {
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const info = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      col.set(color, i * 3);
      info[i * 2] = wing;
      info[i * 2 + 1] = glow;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aWing', new THREE.BufferAttribute(info, 2));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  const body = new THREE.SphereGeometry(1, 7, 5);
  body.scale(0.11, 0.09, 0.3);
  tag(body, [0.03, 0.035, 0.05], 0, 0);
  // firefly lantern at the tip of the abdomen
  const tail = new THREE.SphereGeometry(0.075, 6, 4);
  tail.translate(0, -0.01, -0.27);
  tag(tail, [0, 0, 0], 0, 1);
  const head = new THREE.SphereGeometry(1, 6, 4);
  head.scale(0.085, 0.075, 0.09);
  head.translate(0, 0.01, 0.33);
  tag(head, [0.03, 0.03, 0.04], 0, 0);
  for (const s of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.035, 5, 3);
    eye.translate(s * 0.05, 0.035, 0.38);
    tag(eye, [0, 0, 0], 0, 1);
  }
  // wings: a leaf-shaped fan, hinged along the body
  for (const s of [-1, 1]) {
    const g = new THREE.BufferGeometry();
    const P = [
      0, 0.07, 0.14, s * 0.3, 0.07, 0.17, s * 0.56, 0.07, 0.0,
      0, 0.07, 0.14, s * 0.56, 0.07, 0.0, s * 0.46, 0.07, -0.2,
      0, 0.07, 0.14, s * 0.46, 0.07, -0.2, s * 0.1, 0.07, -0.22,
    ];
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(27).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    tag(g, [0.004, 0.008, 0.005], 1, 0.004); // wings stay dark: a flicker, not a flag
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

export function createFlyers(U, quality) {
  const count = quality.flyers;
  const rnd = mulberry32(4242);
  const f1 = new Float32Array(count * 4);
  const f2 = new Float32Array(count * 4);
  const f3 = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = rnd();
    const dir = rnd() < 0.5 ? -1 : 1;
    const size = 0.5 + rnd() * 0.45;
    if (r < 0.46) {
      // sign
      f1.set([0, 4 + rnd() * 13, rnd() * 6.283, dir * (0.7 + rnd() * 1.1)], i * 4);
      f2.set([31 + rnd() * 13, 0, rnd(), size], i * 4);
      f3.set([SIGN.x, SIGN.y + SIGN.cap * 0.5, SIGN.z + 0.8], i * 3);
    } else if (r < 0.82) {
      // tower vortex
      f1.set([1, 31 + rnd() * 17, rnd() * 6.283, dir * (0.28 + rnd() * 0.3)], i * 4);
      f2.set([23 + rnd() * 26, 21 + rnd() * 40, rnd(), size], i * 4);
      f3.set([-4, 0, 0], i * 3);
    } else {
      // lamp moths
      const lamp = LAMPS[Math.floor(rnd() * 6)];
      f1.set([2, 0.55 + rnd() * 1.3, rnd() * 6.283, dir * (2.6 + rnd() * 3)], i * 4);
      f2.set([19 + rnd() * 20, 6.3 + rnd() * 1.2, rnd(), size * 0.7], i * 4);
      f3.set([lamp[0], 0, lamp[1]], i * 3);
    }
  }

  const base = buildFlyerGeometry();
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  for (const name of ['position', 'normal', 'color', 'aWing']) geometry.setAttribute(name, base.attributes[name]);
  geometry.setAttribute('iF1', new THREE.InstancedBufferAttribute(f1, 4));
  geometry.setAttribute('iF2', new THREE.InstancedBufferAttribute(f2, 4));
  geometry.setAttribute('iF3', new THREE.InstancedBufferAttribute(f3, 3));
  geometry.instanceCount = count;

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.0,
    envMapIntensity: 0.3,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 aWing;
        varying vec2 vFlyGlow;
        ${FLY_GLSL}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `float flyT = uTime - iF2.x;
        vec3 fp = flyPos(uTime);
        vec3 ff = normalize(flyPos(uTime + 0.06) - flyPos(uTime - 0.06) + vec3(0.0, 0.0, 1e-4));
        vec3 fr = normalize(cross(vec3(0.0, 1.0, 0.0), ff));
        vec3 fu = cross(ff, fr);
        // wing beat: fold the wing about the body axis
        float beat = sin(uTime * 58.0 + iF2.z * 90.0) * 0.95;
        vec3 lp = position;
        float span = abs(lp.x) * aWing.x;
        lp.y += span * sin(beat);
        lp.x *= mix(1.0, cos(beat), aWing.x);
        vec3 objectNormal = fr * normal.x + fu * normal.y + ff * normal.z;`,
      )
      .replace(
        '#include <begin_vertex>',
        `float fs = iF2.w * smoothstep(0.0, 1.5, flyT);
        vec3 transformed = fp + (fr * lp.x + fu * lp.y + ff * lp.z) * fs;
        vFlyGlow = vec2(aWing.y, iF2.z);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vFlyGlow;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += mix(vec3(0.12, 1.0, 0.24), vec3(0.6, 1.0, 0.15), fract(vFlyGlow.y * 5.3)) * vFlyGlow.x * 2.6;`,
      );
  };
  material.customProgramCacheKey = () => 'flyers';

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'flyers';

  // glow points
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  glowGeo.setAttribute('iF1', new THREE.BufferAttribute(f1, 4));
  glowGeo.setAttribute('iF2', new THREE.BufferAttribute(f2, 4));
  glowGeo.setAttribute('iF3', new THREE.BufferAttribute(f3, 3));
  const glowMat = new THREE.ShaderMaterial({
    name: 'FlyerGlow',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.uTime, uPx: { value: 1000 }, uFogDensity: U.uFogDensity },
    vertexShader: /* glsl */ `
      ${FLY_GLSL}
      uniform float uPx;
      uniform float uFogDensity;
      varying vec3 vCol;
      void main() {
        vec3 p = flyPos(uTime);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = max(-mv.z, 0.01);
        float s = iF2.w * smoothstep(0.0, 1.5, uTime - iF2.x);
        float px = uPx * s * 0.24 / dist;
        gl_PointSize = clamp(px, 1.8, 13.0);
        float fog = exp(-uFogDensity * uFogDensity * dist * dist);
        vCol = mix(vec3(0.12, 1.0, 0.24), vec3(0.6, 1.0, 0.15), fract(iF2.z * 5.3)) * fog * min(1.0, px / 1.8) * step(0.001, s);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = max(0.0, 1.0 - d);
        gl_FragColor = vec4(vCol * a * a * 0.6, 1.0);
      }
    `,
  });
  const glow = new THREE.Points(glowGeo, glowMat);
  glow.frustumCulled = false;

  return {
    mesh,
    glow,
    count,
    setFraction(fraction) {
      const n = Math.max(1, Math.round(count * fraction));
      geometry.instanceCount = n;
      glowGeo.setDrawRange(0, n);
    },
    setViewport(heightPx, fovDeg) {
      glowMat.uniforms.uPx.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    },
  };
}
