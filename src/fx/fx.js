import * as THREE from 'three';
import { FACADES, TOWER, WING } from '../config.js';
import { mulberry32 } from '../core/util.js';
import { facadeCell } from '../world/building.js';
import { createErrorAtlas } from '../world/textures.js';

// ---------------------------------------------------------------------------
// Error messages boiling off the infected facade like embers.
// ---------------------------------------------------------------------------
export function createEmbers(U, quality, infection) {
  const atlas = createErrorAtlas();
  const count = quality.embers;
  const rnd = mulberry32(606);
  const e1 = new Float32Array(count * 4);
  const e2 = new Float32Array(count * 4);
  const e3 = new Float32Array(count * 3);
  const pick = [0, 0, 0, 0, 0, 2, 3, 4, 4, 6];
  for (let i = 0; i < count; i++) {
    const fi = pick[Math.floor(rnd() * pick.length)];
    const def = FACADES[fi];
    const lx = (rnd() - 0.5) * def.w * 0.94;
    const y = (fi === 3 ? 20 : 3) + rnd() * (def.h - (fi === 3 ? 21 : 4));
    const tx = def.n[2];
    const tz = -def.n[0];
    e1.set([def.cx + tx * lx + def.n[0] * 0.5, y, def.cz + tz * lx + def.n[2] * 0.5, Math.floor(rnd() * atlas.cols * atlas.rows)], i * 4);
    const tInf = infection[fi][facadeCell(def, lx, y)];
    e2.set([tInf + 0.6 + rnd() * 9, 4.5 + rnd() * 4, rnd(), 0.34 + rnd() * 0.42], i * 4);
    e3.set(def.n, i * 3);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.attributes.position);
  geometry.setAttribute('uv', quad.attributes.uv);
  geometry.setAttribute('iE1', new THREE.InstancedBufferAttribute(e1, 4));
  geometry.setAttribute('iE2', new THREE.InstancedBufferAttribute(e2, 4));
  geometry.setAttribute('iE3', new THREE.InstancedBufferAttribute(e3, 3));
  geometry.instanceCount = count;

  const material = new THREE.ShaderMaterial({
    name: 'Embers',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: U.uTime,
      uAtlas: { value: atlas.texture },
      uGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
      uAspect: { value: atlas.aspect },
      uFogDensity: U.uFogDensity,
    },
    vertexShader: /* glsl */ `
      attribute vec4 iE1;
      attribute vec4 iE2;
      attribute vec3 iE3;
      uniform float uTime;
      uniform vec2 uGrid;
      uniform float uAspect;
      uniform float uFogDensity;
      varying vec2 vUv;
      varying vec4 vCol;
      void main() {
        float age = uTime - iE2.x;
        float life = iE2.y;
        float cyc = floor(age / life);
        float ph = fract(age / life);
        float seed = fract(iE2.z + cyc * 0.37);
        vec3 o = iE1.xyz + iE3 * (0.5 + ph * 4.5)
               + vec3(sin(ph * 5.0 + seed * 30.0) * 1.3, ph * (5.0 + 6.0 * fract(seed * 7.0)), 0.0);
        vec4 mv = viewMatrix * vec4(o, 1.0);
        mv.xy += position.xy * vec2(uAspect, 1.0) * iE2.w * (0.75 + 0.5 * ph);
        gl_Position = projectionMatrix * mv;
        float tile = mod(iE1.w + cyc * 5.0, uGrid.x * uGrid.y);
        vec2 cell = vec2(mod(tile, uGrid.x), floor(tile / uGrid.x));
        vUv = vec2((cell.x + uv.x) / uGrid.x, 1.0 - (cell.y + 1.0 - uv.y) / uGrid.y);
        float alpha = smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(0.55, 1.0, ph)) * step(0.0, age);
        float dist = -mv.z;
        alpha *= exp(-uFogDensity * uFogDensity * dist * dist);
        vec3 c = fract(seed * 3.3) > 0.8 ? vec3(1.0, 0.12, 0.06)
               : (fract(seed * 5.7) > 0.85 ? vec3(1.0, 0.72, 0.1) : vec3(0.2, 1.0, 0.3));
        vCol = vec4(c * 1.15, alpha);
        if (alpha <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      varying vec2 vUv;
      varying vec4 vCol;
      void main() {
        float a = texture2D(uAtlas, vUv).a;
        gl_FragColor = vec4(vCol.rgb * a * vCol.a, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'embers';
  return { mesh };
}

// ---------------------------------------------------------------------------
// Rotating alarm beacons on the roof corners.
// ---------------------------------------------------------------------------
export function createBeacons(U) {
  const group = new THREE.Group();
  group.name = 'beacons';
  const LEN = 34;
  const cone = new THREE.ConeGeometry(3.4, LEN, 24, 1, true);
  cone.translate(0, -LEN / 2, 0); // apex at the origin
  cone.rotateZ(Math.PI / 2); // axis along +X
  const beamMat = new THREE.ShaderMaterial({
    name: 'Beam',
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uAmount: { value: 0 }, uLen: { value: LEN } },
    vertexShader: /* glsl */ `
      uniform float uLen;
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vT = length(position) / uLen;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAmount;
      varying float vT;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float facing = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float fall = pow(1.0 - clamp(vT, 0.0, 1.0), 1.7);
        gl_FragColor = vec4(vec3(1.0, 0.07, 0.03) * facing * fall * uAmount * 0.9, 1.0);
      }
    `,
  });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const housing = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5, metalness: 0.7 });
  const spots = [
    [TOWER.x0 + 1.3, TOWER.h, TOWER.z1 - 1.3],
    [TOWER.x1 - 1.3, TOWER.h, TOWER.z1 - 1.3],
    [TOWER.x0 + 1.3, TOWER.h, TOWER.z0 + 1.3],
    [TOWER.x1 - 1.3, TOWER.h, TOWER.z0 + 1.3],
    [WING.x1 - 1.3, WING.h, WING.z1 - 1.3],
  ];
  const heads = spots.map(([x, y, z], i) => {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.5, 14), housing);
    base.position.set(x, y + 0.25, z);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), lampMat);
    lamp.position.set(x, y + 0.72, z);
    const spin = new THREE.Group();
    spin.position.set(x, y + 0.72, z);
    const a = new THREE.Mesh(cone, beamMat);
    a.rotation.z = -0.1;
    const b = new THREE.Mesh(cone, beamMat);
    b.rotation.set(0, Math.PI, -0.1);
    spin.add(a, b);
    spin.visible = false;
    group.add(base, lamp, spin);
    return { spin, phase: i * 1.3 };
  });
  const lights = [spots[0], spots[1]].map(([x, y, z]) => {
    const l = new THREE.PointLight(0xff1a0a, 0, 60, 2);
    l.position.set(x, y + 1.5, z + 1.5);
    group.add(l);
    return l;
  });

  return {
    group,
    update(state) {
      const amt = state.alarm * state.power;
      beamMat.uniforms.uAmount.value = amt;
      lampMat.color.setRGB(0.05 + 6 * amt, 0.02 + 0.3 * amt, 0.01);
      heads.forEach((h) => {
        h.spin.visible = amt > 0.01;
        h.spin.rotation.y = state.time * 2.6 + h.phase;
      });
      lights.forEach((l, i) => {
        l.intensity = amt * (260 + 200 * Math.sin(state.time * 2.6 + i * 2));
      });
    },
  };
}

// ---------------------------------------------------------------------------
// The queen's scream: an expanding shell of corrupted air.
// ---------------------------------------------------------------------------
export function createShockwave() {
  const material = new THREE.ShaderMaterial({
    name: 'Shockwave',
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uAmount: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAmount;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.5);
        gl_FragColor = vec4(mix(vec3(0.2, 1.0, 0.35), vec3(0.85, 1.0, 0.9), rim) * rim * uAmount, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.name = 'shockwave';
  return {
    mesh,
    /** k: seconds since the scream. */
    update(center, k) {
      const life = 1.9;
      if (k < 0 || k > life) {
        mesh.visible = false;
        return 0;
      }
      const u = k / life;
      mesh.visible = true;
      mesh.position.copy(center);
      const radius = 4 + k * 88;
      mesh.scale.setScalar(radius);
      material.uniforms.uAmount.value = (1 - u) * (1 - u) * 2.6;
      return radius;
    },
  };
}
