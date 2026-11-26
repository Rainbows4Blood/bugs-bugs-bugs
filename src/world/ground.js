import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { GLSL_HASH, GLSL_NOISE, GLSL_SKY, GLSL_FOG } from '../core/glsl.js';
import { TOWER, WING, LAMPS, MANHOLES, ENTRANCE_X } from '../config.js';

// The whole ground is one quad: rain-wet stone plaza, asphalt streets with
// markings, puddles. It mirrors the scene through a planar reflection whose
// sharpness varies with wetness (the reflection target has mipmaps, and rougher
// patches sample blurrier mips).

const VERT = /* glsl */ `
uniform mat4 textureMatrix;
varying vec4 vUvP;
varying vec3 vWorld;
varying float vDist;
void main() {
  vUvP = textureMatrix * vec4(position, 1.0);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform vec3 color;
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uReflect;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec4 uLamps[${LAMPS.length}];
uniform vec3 uLampColor;
uniform vec3 uGlowColor;
uniform float uGlowAmt;
uniform vec3 uSignCol;
uniform vec3 uMoonDir;
uniform float uCorruption;
uniform vec4 uHoles[${MANHOLES.length}];
uniform vec3 uLedColor;
uniform vec4 uPulse;

varying vec4 vUvP;
varying vec3 vWorld;
varying float vDist;

${GLSL_HASH}
${GLSL_NOISE}
${GLSL_SKY}
${GLSL_FOG}

float sdBox(vec2 p, vec2 c, vec2 h) {
  vec2 d = abs(p - c) - h;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
// anti-aliased "x is inside [-w, w]"
float aaLine(float x, float w, float px) { return 1.0 - smoothstep(w - px, w + px, abs(x)); }

// white / yellow paint for a street running along 'a', with 'c' metres from its centre line
vec2 roadMarks(float a, float c, float px) {
  float yellow = aaLine(abs(c) - 0.18, 0.06, px);
  float dash = step(fract(a / 9.0), 0.36);
  float white = aaLine(abs(c) - 4.0, 0.06, px) * dash;
  white += aaLine(abs(c) - 7.5, 0.06, px);
  return vec2(white, yellow);
}

void main() {
  vec2 p = vWorld.xz;
  vec3 Vv = cameraPosition - vWorld;
  float dist = length(Vv);
  vec3 V = Vv / dist;
  vec2 fw = fwidth(p);
  float px = max(max(fw.x, fw.y), 0.002);
  float detail = 1.0 - smoothstep(0.15, 0.7, px);   // fades fine patterns in the distance

  // ---- zones -------------------------------------------------------------
  float sF = step(74.0, p.y) * step(p.y, 90.0);
  float sB = step(-78.0, p.y) * step(p.y, -62.0);
  float sE = step(86.0, p.x) * step(p.x, 102.0);
  float sW = step(-104.0, p.x) * step(p.x, -88.0);
  float street = min(sF + sB + sE + sW, 1.0);
  float crossing = step(1.5, sF + sB + sE + sW);
  float dBlock = -sdBox(p, vec2(-1.0, 6.0), vec2(87.0, 68.0));   // > 0 inside the HQ block
  float block = step(0.0, dBlock);

  vec3 alb;
  vec3 emis = vec3(0.0);
  float wetBias = 0.0;

  if (street > 0.5) {
    alb = vec3(0.028, 0.029, 0.033) * (0.8 + 0.4 * vnoise(p * 3.1));
    vec2 mk = vec2(0.0);
    if (crossing < 0.5) {
      if (sF > 0.5) mk = roadMarks(p.x, p.y - 82.0, px);
      else if (sB > 0.5) mk = roadMarks(p.x, p.y + 70.0, px);
      else if (sE > 0.5) mk = roadMarks(p.y, p.x - 94.0, px);
      else mk = roadMarks(p.y, p.x + 96.0, px);
      // zebra crossing in front of the entrance
      float zx = aaLine(p.x - ${ENTRANCE_X.toFixed(1)}, 4.6, px) * sF;
      float bars = step(fract((p.y - 74.6) / 1.3), 0.5) * step(75.2, p.y) * step(p.y, 88.8);
      mk = mix(mk, vec2(bars, 0.0), zx);
    }
    float wear = 0.55 + 0.45 * vnoise(p * 1.3 + 4.0);
    alb = mix(alb, vec3(0.42, 0.42, 0.40) * wear, mk.x * 0.85);
    alb = mix(alb, vec3(0.50, 0.36, 0.04) * wear, mk.y * 0.85);
    wetBias = 0.15;
  } else if (block > 0.5) {
    // stone pavers in running bond
    vec2 q = p / vec2(1.6, 0.8);
    q.x += 0.5 * mod(floor(q.y), 2.0);
    vec2 qi = floor(q);
    vec2 qf = fract(q);
    float tone = 0.80 + 0.34 * hash12(qi);
    vec2 je = min(qf, 1.0 - qf) * vec2(1.6, 0.8);
    float joint = (1.0 - smoothstep(0.012, 0.03 + px, min(je.x, je.y))) * detail;
    alb = vec3(0.098, 0.098, 0.108) * mix(1.0, tone, detail);
    // processional runner from the street to the doors
    float runner = aaLine(p.x - ${ENTRANCE_X.toFixed(1)}, 5.0, px) * step(16.0, p.y);
    alb *= mix(1.0, 1.32, runner);
    // bronze inlay strips across the plaza
    float inlay = aaLine(mod(p.y - 4.0, 12.0) - 6.0, 0.11, px) * step(16.5, p.y) * step(abs(p.x + 1.0), 80.0);
    alb = mix(alb, vec3(0.16, 0.10, 0.04), inlay * 0.8);
    alb = mix(alb, vec3(0.012), joint * 0.75);
    // kerb
    float kerb = 1.0 - smoothstep(0.0, 0.45, dBlock);
    alb = mix(alb, vec3(0.17, 0.17, 0.165), kerb * 0.9);
    // LED strips set into the paving, flanking the runner
    float led = aaLine(abs(p.x - ${ENTRANCE_X.toFixed(1)}) - 5.0, 0.045, px) * step(18.0, p.y) * step(p.y, 72.5);
    led *= step(fract(p.y / 3.0), 0.82);
    emis += uLedColor * led;
  } else {
    alb = vec3(0.016, 0.018, 0.02) * (0.7 + 0.6 * vnoise(p * 0.7));
    wetBias = -0.2;
  }

  // ---- manholes ----------------------------------------------------------
  for (int i = 0; i < ${MANHOLES.length}; i++) {
    vec4 H = uHoles[i];
    float d = length(p - H.xy);
    float inside = 1.0 - smoothstep(H.z - 0.02 - px, H.z + px, d);
    float rim = aaLine(d - H.z - 0.07, 0.07, px);
    alb = mix(alb, vec3(0.05, 0.05, 0.055), rim);
    alb = mix(alb, vec3(0.0), inside);
    emis += vec3(0.08, 1.0, 0.22) * H.w * (inside * (1.2 - 0.8 * d / H.z) + 0.35 * exp(-max(d - H.z, 0.0) * 0.9));
    wetBias -= inside * 2.0;
  }

  // shock ring racing outwards from the tower
  float pr = length(p - uPulse.xy) - uPulse.z;
  emis += vec3(0.25, 1.0, 0.4) * uPulse.w * exp(-pr * pr * 0.06);

  // ---- lighting ----------------------------------------------------------
  vec3 light = vec3(0.020, 0.027, 0.048) + vec3(0.06, 0.08, 0.14) * uMoonDir.y * 0.6;
  for (int i = 0; i < ${LAMPS.length}; i++) {
    vec4 L = uLamps[i];
    vec2 dl = p - L.xy;
    float d2 = dot(dl, dl) + L.z * L.z;
    light += uLampColor * (L.w * 105.0 * L.z / (d2 * sqrt(d2)));
  }
  float dB = min(sdBox(p, vec2(${((TOWER.x0 + TOWER.x1) / 2).toFixed(1)}, 0.0), vec2(${((TOWER.x1 - TOWER.x0) / 2).toFixed(1)}, ${((TOWER.z1 - TOWER.z0) / 2).toFixed(1)})),
                 sdBox(p, vec2(${((WING.x0 + WING.x1) / 2).toFixed(1)}, 0.0), vec2(${((WING.x1 - WING.x0) / 2).toFixed(1)}, ${((WING.z1 - WING.z0) / 2).toFixed(1)})));
  dB = max(dB, 0.0);
  light += uGlowColor * uGlowAmt * (1.5 * exp(-dB * 0.10) + 0.3 * exp(-dB * 0.028));
  // the sign washes the plaza in front of the tower
  vec2 ds = p - vec2(${ENTRANCE_X.toFixed(1)}, 30.0);
  light += uSignCol * 0.09 * exp(-dot(ds, ds) / 900.0) * step(16.0, p.y);

  // ---- wet reflection ----------------------------------------------------
  float wetN = fbm(p * 0.045 + 3.1);
  float puddle = smoothstep(0.50, 0.64, fbm(p * 0.09 + 11.0) + wetBias * 0.12);
  float gloss = mix(0.34, 1.0, puddle);
  vec3 refl;
  if (uReflect > 0.5) {
    vec2 nz = vec2(vnoise(p * 2.3), vnoise(p * 2.3 + 37.0)) - 0.5;
    vec2 uv = vUvP.xy / vUvP.w + nz * (0.012 * (1.0 - gloss) + 0.002);
    refl = textureLod(tDiffuse, uv, (1.0 - gloss) * 4.2 + 0.3).rgb;
  } else {
    refl = skyGradient(reflect(-V, vec3(0.0, 1.0, 0.0)), uCorruption);
  }
  float cosT = clamp(V.y, 0.0, 1.0);
  float F = 0.035 + 0.965 * pow(1.0 - cosT, 5.0);
  float reflK = clamp(F * mix(0.40, 1.0, puddle) * mix(0.7, 1.0, wetN), 0.0, 1.0);
  alb *= mix(1.0, 0.8, puddle);

  vec3 col = alb * light * (1.0 - 0.6 * reflK) + refl * reflK + emis;
  col = applyFog(col, vDist, uFogColor, uFogDensity);
  gl_FragColor = vec4(col + color * 0.0, 1.0);
}
`;

export function createGround(U, quality, renderer) {
  const lamps = LAMPS.map(([x, z]) => new THREE.Vector4(x, z, 6.8, 1));
  const holes = MANHOLES.map((m) => new THREE.Vector4(m.x, m.z, 0.62, 0));
  const uniforms = {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    uReflect: { value: quality.reflect > 0 ? 1 : 0 },
    uFogColor: { value: U.uFogColor.value },
    uFogDensity: { value: U.uFogDensity.value },
    uLamps: { value: lamps },
    uLampColor: { value: new THREE.Color(1.0, 0.72, 0.42) },
    uGlowColor: { value: new THREE.Color(1.0, 0.85, 0.65) },
    uGlowAmt: { value: 1 },
    uSignCol: { value: new THREE.Color(0, 0, 0) },
    uMoonDir: { value: U.uMoonDir.value },
    uCorruption: { value: 0 },
    uHoles: { value: holes },
    uLedColor: { value: new THREE.Color(0.9, 0.72, 0.5) },
    uPulse: { value: new THREE.Vector4(-4, 0, 0, 0) },
  };

  const geometry = new THREE.PlaneGeometry(3600, 3600);
  let mesh;
  let target = null;
  if (quality.reflect > 0) {
    mesh = new Reflector(geometry, {
      clipBias: 0.003,
      textureWidth: 512,
      textureHeight: 512,
      multisample: 0,
      shader: { name: 'WetGround', uniforms, vertexShader: VERT, fragmentShader: FRAG },
    });
    target = mesh.getRenderTarget();
    target.texture.generateMipmaps = true;
    target.texture.minFilter = THREE.LinearMipmapLinearFilter;
  } else {
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    black.needsUpdate = true;
    uniforms.tDiffuse.value = black;
    uniforms.color.value = new THREE.Color(0);
    mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ name: 'WetGround', uniforms, vertexShader: VERT, fragmentShader: FRAG }));
  }
  mesh.rotation.x = -Math.PI / 2;
  mesh.name = 'ground';
  mesh.frustumCulled = false;

  const u = mesh.material.uniforms;
  const warmGlow = new THREE.Color(1.0, 0.85, 0.65);
  const sickGlow = new THREE.Color(0.14, 1.0, 0.26);
  const ledWarm = new THREE.Color(0.9, 0.72, 0.5);
  const ledSick = new THREE.Color(0.14, 1.2, 0.28);

  return {
    mesh,
    lamps,
    holes,
    setSize(w, h) {
      if (target) target.setSize(Math.max(64, Math.round(w * quality.reflect)), Math.max(64, Math.round(h * quality.reflect)));
    },
    update(state) {
      u.uTime.value = state.time;
      u.uCorruption.value = state.corruption;
      u.uGlowColor.value.copy(warmGlow).lerp(sickGlow, state.corruption);
      u.uGlowAmt.value = (1.0 - 0.25 * state.corruption) * state.power;
      u.uSignCol.value.copy(U.uSignCol.value);
      u.uFogColor.value.copy(U.uFogColor.value);
      const flick = state.corruption > 0.02 ? 0.8 + 0.2 * Math.sin(state.time * 31.0) * Math.sin(state.time * 7.1) : 1;
      u.uLedColor.value.copy(ledWarm).lerp(ledSick, state.corruption).multiplyScalar(flick * state.power);
      // ring on the ground, in step with the shockwave in the air
      const k = state.pulseK ?? -1;
      const live = k > 0 && k < 3.2;
      u.uPulse.value.set(-4, 14, 4 + k * 88, live ? 2.2 * Math.pow(1 - k / 3.2, 1.5) : 0);
    },
  };
}
