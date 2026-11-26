import * as THREE from 'three';
import { FACADES, TOWER, WING, LOBBY_H, FLOOR_H, ENTRANCE_X } from '../config.js';
import { GLSL_HASH, GLSL_SKY, GLSL_FOG } from '../core/glsl.js';
import { createScreenAtlas, createGlyphAtlas } from './textures.js';

// ---------------------------------------------------------------------------
// Curtain wall shader
//
// Every facade is a single quad. The shader lays out bays and floors, and for
// each pane of glass ray-casts into a virtual room behind it ("interior
// mapping"), so the offices have real parallax without any geometry. Each room
// also looks up *when* it gets infected (baked from the swarm's actual paths)
// and switches from office lighting to strobing, code rain and error screens.
// ---------------------------------------------------------------------------

const FACADE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vT;
varying float vDist;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
  vT = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));
  vec4 mv = viewMatrix * wp;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FACADE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec2 uSize;
uniform float uCols;
uniform float uRows;
uniform float uLobbyH;
uniform float uFloorH;
uniform float uSeed;
uniform vec4 uBand;
uniform vec2 uDoor;
uniform sampler2D uInf;
uniform sampler2D uScreens;
uniform sampler2D uGlyphs;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uMoonDir;
uniform float uCorruption;
uniform vec3 uSignCol;
uniform vec4 uSignRect;
uniform float uPower;

varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vT;
varying float vDist;

${GLSL_HASH}
${GLSL_SKY}
${GLSL_FOG}

vec3 skyRefl(vec3 r) {
  vec3 c = skyGradient(normalize(vec3(r.x, abs(r.y) * 0.9 + 0.02, r.z)), uCorruption);
  float m = max(dot(r, uMoonDir), 0.0);
  c += vec3(0.9, 0.95, 1.0) * pow(m, 1500.0) * 16.0 + vec3(0.10, 0.14, 0.26) * pow(m, 60.0);
  return c;
}

// Light in a room: rgb = colour, a = intensity. k is the infection progress 0..1.
vec4 roomLight(vec2 cell, float k, bool lobby) {
  vec3 rnd = hash32(cell * 1.37 + uSeed * 19.1);
  vec3 rnd2 = hash32(cell * 2.11 + uSeed * 7.7 + 5.0);
  float I = rnd.x < 0.54 ? 1.0 : (rnd.x < 0.84 ? 0.11 : 0.02);
  vec3 Lc = rnd.y < 0.40 ? vec3(1.0, 0.77, 0.50) : (rnd.y < 0.76 ? vec3(1.0, 0.93, 0.84) : vec3(0.68, 0.85, 1.0));
  if (rnd2.y > 0.94) Lc = vec3(0.30, 0.45, 1.0);
  if (lobby) { I = 0.9; Lc = vec3(1.0, 0.84, 0.60); }

  vec3 infCol = rnd2.z > 0.86 ? vec3(1.0, 0.06, 0.03) : vec3(0.10, 1.0, 0.20);
  float breathe = 0.62 + 0.38 * sin(uTime * (1.2 + rnd.z * 2.4) + rnd.y * 30.0);
  float strobe = step(0.42, hash12(cell + floor(uTime * 13.0) * 1.7 + uSeed));
  float trans = sin(clamp(k, 0.0, 1.0) * 3.14159265);
  Lc = mix(Lc, infCol, smoothstep(0.25, 0.9, k));
  I = mix(I, 0.62 * breathe, smoothstep(0.4, 1.0, k));
  I *= mix(1.0, strobe * 1.5, trans);
  I *= 1.0 - 0.85 * step(0.988, hash12(cell * 0.7 + floor(uTime * 7.0) + 3.0)) * step(0.99, k);
  return vec4(Lc, I * uPower);
}

vec3 codeRain(vec2 l, vec2 cell, float lod) {
  vec2 g = l / 0.21;
  vec2 gi = floor(g);
  vec2 gf = fract(g);
  float cs = hash12(vec2(gi.x * 1.31 + cell.x * 17.0, cell.y * 5.3 + uSeed));
  float speed = 5.0 + cs * 9.0;
  float dist = mod(uTime * speed + cs * 57.0 + gi.y, 26.0);
  float bright = exp(-dist * 0.24) * step(0.18, cs);
  float gid = floor(hash12(gi * 0.731 + floor(uTime * (1.5 + cs * 5.0) + cs * 9.0) * 0.173) * 255.99);
  vec2 guv = (vec2(mod(gid, 16.0), floor(gid / 16.0)) + gf) / 16.0;
  float gl = textureLod(uGlyphs, guv, lod).r;
  vec3 c = mix(vec3(0.05, 1.0, 0.22), vec3(0.75, 1.0, 0.80), smoothstep(0.7, 1.0, bright));
  return c * gl * bright;
}

vec3 interior(vec2 l, vec2 cell, vec3 Vt, float bayW, float cellH, float sill, float head,
              float k, bool lobby, vec4 RL, float pxm) {
  vec3 rnd = hash32(cell * 1.37 + uSeed * 19.1);
  vec3 rnd2 = hash32(cell * 2.11 + uSeed * 7.7 + 5.0);
  vec3 Lc = RL.rgb;
  float I = RL.a;

  // roller blinds, pulled down by a random amount
  float gyN = (l.y - sill) / (cellH - head - sill);
  float blind = (!lobby && rnd2.y < 0.26) ? 0.22 + rnd2.z * 0.5 : 0.0;
  if (gyN > 1.0 - blind) {
    float slat = 0.62 + 0.38 * step(0.45, fract(l.y / 0.075));
    return vec3(0.34, 0.33, 0.30) * slat * (0.03 + Lc * I * 0.55);
  }

  float y0 = lobby ? 0.0 : 0.10;
  float y1 = cellH - (lobby ? 0.62 : 0.24);
  float depth = lobby ? 10.0 : 4.6 + rnd2.x * 2.4;
  vec3 d = Vt;
  d.z = min(d.z, -0.03);
  vec3 o = vec3(l, 0.0);
  // offices are one bay wide; the lobby is a single hall the length of the facade
  float xL = lobby ? -cell.x * bayW : 0.0;
  float xR = lobby ? (uCols - cell.x) * bayW : bayW;
  float tx = d.x > 0.0 ? (xR - o.x) / max(d.x, 1e-4) : (o.x - xL) / max(-d.x, 1e-4);
  float ty = d.y > 0.0 ? (y1 - o.y) / max(d.y, 1e-4) : (o.y - y0) / max(-d.y, 1e-4);
  float tz = depth / -d.z;
  float t = min(tz, min(tx, ty));
  vec3 h = o + d * t;
  float dz = clamp(-h.z / depth, 0.0, 1.0);

  vec3 base;
  vec3 emis = vec3(0.0);
  if (t == tz) {
    // back wall
    vec2 b = vec2(h.x / bayW, (h.y - y0) / (y1 - y0));
    if (lobby) {
      // position along the whole hall: decides which bay of the back wall we hit
      float gx = h.x / bayW + cell.x;
      b.x = fract(gx);
      rnd = hash32(vec2(floor(gx), 0.0) * 1.37 + uSeed * 19.1);
      rnd2 = hash32(vec2(floor(gx), 0.0) * 2.11 + uSeed * 7.7 + 5.0);
      base = vec3(0.40, 0.25, 0.14) * (0.78 + 0.22 * step(0.5, fract(h.x / 0.32)));
      if (b.y < 0.17) base = vec3(0.05, 0.045, 0.04);
      emis = vec3(1.0, 0.8, 0.55) * step(abs(b.y - 0.175), 0.008) * 2.5 * uPower * (1.0 - k);
    } else {
      base = mix(vec3(0.55, 0.56, 0.60), vec3(0.30, 0.34, 0.44), rnd2.x);
      if (b.y < 0.26) base = vec3(0.07, 0.065, 0.065);
    }
    bool big = rnd.z < (lobby ? 0.45 : 0.42);
    vec2 s0 = big ? vec2(0.13, 0.36) : vec2(0.29, 0.28);
    vec2 s1 = big ? vec2(0.87, 0.85) : vec2(0.71, 0.53);
    bool hasScreen = big || !lobby;
    vec2 su = (b - s0) / (s1 - s0);
    if (hasScreen && su.x > 0.0 && su.x < 1.0 && su.y > 0.0 && su.y < 1.0) {
      float tile = floor(rnd2.x * 3.999) + (k > 0.5 ? 4.0 : 0.0);
      vec2 tuv = vec2((mod(tile, 4.0) + su.x) / 4.0, (floor(tile / 4.0) + (1.0 - su.y)) / 2.0);
      float slod = clamp(log2(pxm * 256.0 / ((s1.x - s0.x) * bayW)) + 0.6, 0.0, 6.0);
      vec3 sc = textureLod(uScreens, tuv, slod).rgb;
      float on = max(step(rnd.x, 0.66), step(0.5, k));
      float flick = k > 0.5 ? 0.7 + 0.3 * step(0.3, hash12(cell + floor(uTime * 9.0) * 0.31)) : 1.0;
      emis = sc * on * flick * 1.4 * uPower;
      base = vec3(0.012);
    }
  } else if (t == ty) {
    if (d.y > 0.0) {
      // ceiling with recessed light panels
      base = vec3(0.62);
      vec2 cf = abs(fract(vec2(h.x / 1.3, -h.z / 1.6)) - 0.5);
      emis = Lc * I * step(cf.x, 0.30) * step(cf.y, 0.22) * mix(1.7, 0.7, k);
    } else {
      base = lobby ? vec3(0.22, 0.20, 0.18) : vec3(0.11, 0.12, 0.15);
    }
  } else {
    base = vec3(0.45, 0.46, 0.50) * (lobby ? 0.8 : 1.0);
  }
  return base * Lc * I * mix(0.95, 0.4, dz) + emis;
}

void main() {
  vec3 N = normalize(vN);
  vec3 T = normalize(vT);
  vec3 B = vec3(0.0, 1.0, 0.0);
  vec3 V = normalize(vWorld - cameraPosition);
  vec2 pm = vUv * uSize;
  vec2 fw = fwidth(pm);
  float pxm = max(fw.x, fw.y);

  float bayW = uSize.x / uCols;
  float ci = clamp(floor(pm.x / bayW), 0.0, uCols - 1.0);
  float lx = pm.x - ci * bayW;
  float row, ly, cellH, sill, head;
  bool lobby = pm.y < uLobbyH;
  if (lobby) {
    row = 0.0; ly = pm.y; cellH = uLobbyH; sill = 0.35; head = 0.75;
  } else {
    row = clamp(floor((pm.y - uLobbyH) / uFloorH), 0.0, uRows - 2.0);
    ly = pm.y - uLobbyH - row * uFloorH;
    row += 1.0; cellH = uFloorH; sill = 0.95; head = 0.32;
  }
  vec2 cell = vec2(ci, row);
  vec2 l = vec2(lx, ly);

  float tinf = texture2D(uInf, (cell + 0.5) / vec2(uCols, uRows)).r;
  float k = clamp((uTime - tinf) / 2.4, 0.0, 1.0);

  // analytically anti-aliased glass coverage
  float ax = max(fw.x, 0.003);
  float ay = max(fw.y, 0.003);
  float gx = smoothstep(0.08 - ax, 0.08 + ax, lx) * (1.0 - smoothstep(bayW - 0.08 - ax, bayW - 0.08 + ax, lx));
  gx *= smoothstep(0.035 - ax, 0.035 + ax, abs(lx - bayW * 0.5));
  float gy = smoothstep(sill - ay, sill + ay, ly) * (1.0 - smoothstep(cellH - head - ay, cellH - head + ay, ly));
  float glass = gx * gy;
  bool band = ci >= uBand.x && ci <= uBand.y && row >= uBand.z && row <= uBand.w;
  if (band) glass = 0.0;

  vec4 RL = roomLight(cell, k, lobby);
  float F = 0.04 + 0.96 * pow(1.0 - clamp(dot(-V, N), 0.0, 1.0), 5.0);
  vec3 prnd = hash32(cell * 3.3 + floor(lx / (bayW * 0.5)) * 7.0 + uSeed);
  vec3 Nr = normalize(N + T * (prnd.x - 0.5) * 0.045 + B * (prnd.y - 0.5) * 0.045);
  vec3 refl = skyRefl(reflect(V, Nr));
  float moonL = max(dot(N, uMoonDir), 0.0);

  // mullions, spandrel glass, solid band
  vec3 frame = vec3(0.020, 0.022, 0.026) + vec3(0.022, 0.030, 0.055) * moonL + vec3(0.006, 0.008, 0.013);
  frame += RL.rgb * RL.a * 0.012;
  vec3 spandrel = vec3(0.008, 0.011, 0.017) + refl * (0.18 + 0.82 * F) * 0.8 + RL.rgb * RL.a * 0.006;
  vec3 opaque = mix(frame, spandrel, gx * (1.0 - gy));
  if (band) {
    float jx = (0.5 - abs(fract(pm.x / (bayW * 0.5)) - 0.5)) * bayW * 0.5;
    float jy = (0.5 - abs(fract((pm.y - uLobbyH) / 2.0) - 0.5)) * 2.0;
    float joint = 1.0 - smoothstep(0.012, 0.03 + pxm, min(jx, jy));
    opaque = vec3(0.013, 0.014, 0.017) + vec3(0.016, 0.022, 0.04) * moonL + refl * 0.035;
    opaque = mix(opaque, vec3(0.003), joint * 0.85);
  }

  vec3 win = vec3(0.0);
  if (glass > 0.001) {
    vec3 Vt = vec3(dot(V, T), dot(V, B), dot(V, N));
    vec3 c = interior(l, cell, Vt, bayW, cellH, sill, head, k, lobby, RL, pxm);
    if (k > 0.0) {
      vec3 rnd2 = hash32(cell * 2.11 + uSeed * 7.7 + 5.0);
      float glod = clamp(log2(pxm * 32.0 / 0.21) + 0.3, 0.0, 5.0);
      float rainAmt = smoothstep(0.45, 1.0, k) * (rnd2.z > 0.86 ? 0.25 : 1.0);
      c += codeRain(l, cell, glod) * rainAmt * 1.7 * uPower;
      vec2 bq = floor(l / vec2(0.5, 0.28));
      float gb = step(0.88, hash12(bq + cell * 3.1 + floor(uTime * 11.0) * 0.61));
      vec3 gc = mix(vec3(0.1, 1.0, 0.3), vec3(1.0, 0.1, 0.5), step(0.5, hash12(bq + 9.0)));
      c += gb * gc * sin(k * 3.14159265) * 1.8;
    }
    win = c * (1.0 - F) * vec3(0.84, 0.94, 1.0) + refl * F;
  }
  vec3 col = mix(opaque, win, glass);

  // entrance: door transom
  if (lobby && ci >= uDoor.x && ci <= uDoor.y) {
    float bar = 1.0 - smoothstep(0.06, 0.08 + ay, abs(ly - 2.8));
    col = mix(col, frame, bar * gx);
  }

  // light spilling from the sign onto the wall behind it
  if (uSignRect.z > 0.0) {
    vec2 dd = abs(pm - uSignRect.xy) - uSignRect.zw;
    float ds = length(max(dd, 0.0));
    float spill = exp(-ds * 0.5) * 0.9 + exp(-ds * 0.12) * 0.1;
    col += uSignCol * spill * (band ? 0.10 : 0.018);
  }

  col = applyFog(col, vDist, uFogColor, uFogDensity);
  gl_FragColor = vec4(col, 1.0);
}
`;

function rowsOf(def) {
  return 1 + Math.round((def.h - LOBBY_H) / FLOOR_H);
}

/** Index of the window cell at local x (metres from the facade centre) and height y. */
export function facadeCell(def, lx, y) {
  const rows = rowsOf(def);
  const col = Math.min(def.cols - 1, Math.max(0, Math.floor(((lx + def.w / 2) / def.w) * def.cols)));
  const row = y < LOBBY_H ? 0 : Math.min(rows - 1, 1 + Math.floor((y - LOBBY_H) / FLOOR_H));
  return row * def.cols + col;
}

export function createBuilding(U) {
  const group = new THREE.Group();
  group.name = 'hq';

  const screens = createScreenAtlas();
  const glyphs = createGlyphAtlas();

  // ---- facades -----------------------------------------------------------
  const facades = FACADES.map((def, i) => {
    const rows = rowsOf(def);
    const infData = new Float32Array(def.cols * rows).fill(1e9);
    const infTex = new THREE.DataTexture(infData, def.cols, rows, THREE.RedFormat, THREE.FloatType);
    infTex.minFilter = infTex.magFilter = THREE.NearestFilter;
    infTex.needsUpdate = true;

    const material = new THREE.ShaderMaterial({
      name: `Facade:${def.id}`,
      vertexShader: FACADE_VERT,
      fragmentShader: FACADE_FRAG,
      uniforms: {
        uTime: U.uTime,
        uFogColor: U.uFogColor,
        uFogDensity: U.uFogDensity,
        uMoonDir: U.uMoonDir,
        uCorruption: U.uCorruption,
        uSignCol: U.uSignCol,
        uPower: U.uPower,
        uSize: { value: new THREE.Vector2(def.w, def.h) },
        uCols: { value: def.cols },
        uRows: { value: rows },
        uLobbyH: { value: LOBBY_H },
        uFloorH: { value: FLOOR_H },
        uSeed: { value: 1 + i * 3.17 },
        uBand: { value: new THREE.Vector4(...(def.band ?? [-1, -1, -1, -1])) },
        uDoor: { value: new THREE.Vector2(...(def.door ?? [-1, -1])) },
        uSignRect: { value: new THREE.Vector4(26, 42, 11.6, 2.5).multiplyScalar(i === 0 ? 1 : -1) },
        uInf: { value: infTex },
        uScreens: { value: screens },
        uGlyphs: { value: glyphs },
      },
    });

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(def.w, def.h), material);
    mesh.position.set(def.cx, def.h / 2, def.cz);
    mesh.rotation.y = Math.atan2(def.n[0], def.n[2]);
    mesh.name = def.id;
    group.add(mesh);
    return { def, rows, mesh, material, infData, infTex };
  });

  // ---- structure ---------------------------------------------------------
  const metal = new THREE.MeshStandardMaterial({ color: 0x0c0d11, roughness: 0.45, metalness: 0.75 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x0e0f13, roughness: 0.95, metalness: 0.0 });
  const unit = new THREE.MeshStandardMaterial({ color: 0x22252b, roughness: 0.6, metalness: 0.55 });

  const box = (mat, w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };

  for (const b of [TOWER, WING]) {
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    box(roofMat, w - 0.04, 0.4, d - 0.04, cx, b.h - 0.2, cz); // roof slab, top face at b.h
    // flush metal coping around the roof edge
    box(metal, w, 0.05, 0.45, cx, b.h + 0.005, b.z1 - 0.225);
    box(metal, w, 0.05, 0.45, cx, b.h + 0.005, b.z0 + 0.225);
    box(metal, 0.45, 0.05, d, b.x0 + 0.225, b.h + 0.005, cz);
    box(metal, 0.45, 0.05, d, b.x1 - 0.225, b.h + 0.005, cz);
  }
  // corner posts hide the seams between facade quads
  const post = (x, z, h) => box(metal, 0.34, h, 0.34, x, h / 2, z);
  post(TOWER.x0, TOWER.z1, TOWER.h);
  post(TOWER.x1, TOWER.z1, TOWER.h);
  post(TOWER.x0, TOWER.z0, TOWER.h);
  post(TOWER.x1, TOWER.z0, TOWER.h);
  post(WING.x1, WING.z1, WING.h);
  post(WING.x1, WING.z0, WING.h);

  // entrance portal
  const portalW = 6.9;
  box(metal, 0.36, 5.0, 0.55, ENTRANCE_X - portalW / 2, 2.5, TOWER.z1 + 0.2);
  box(metal, 0.36, 5.0, 0.55, ENTRANCE_X + portalW / 2, 2.5, TOWER.z1 + 0.2);
  box(metal, portalW + 0.36, 0.42, 0.55, ENTRANCE_X, 5.0, TOWER.z1 + 0.2);
  const portalLight = new THREE.MeshBasicMaterial({ color: 0xffffff });
  box(portalLight, portalW - 0.5, 0.07, 0.1, ENTRANCE_X, 4.76, TOWER.z1 + 0.4);

  // rooftop plant (kept clear of the centre, where something large will walk)
  const units = [
    [-24, -6, 5, 2.2, 3.4], [-24.4, 3, 4, 1.8, 3], [-23, 9.6, 2.4, 1.4, 2.4],
    [15.5, -7, 5, 2.4, 3.6], [16.5, 2, 3.2, 1.6, 3.2], [14.5, 9, 3, 1.3, 2.4],
  ];
  const fanGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.16, 20);
  for (const [x, z, w, h, d] of units) {
    box(unit, w, h, d, x, TOWER.h + h / 2, z);
    const n = Math.max(1, Math.round(w / 1.7));
    for (let k = 0; k < n; k++) {
      const fan = new THREE.Mesh(fanGeo, metal);
      fan.position.set(x - w / 2 + (w / n) * (k + 0.5), TOWER.h + h + 0.08, z);
      group.add(fan);
    }
  }
  // antenna mast with an aviation light
  const mastX = -26;
  const mastZ = -11.5;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.2, 15, 10), metal);
  mast.position.set(mastX, TOWER.h + 7.5, mastZ);
  group.add(mast);
  for (let k = 0; k < 3; k++) box(metal, 2.4 - k * 0.6, 0.07, 0.07, mastX, TOWER.h + 8 + k * 2.2, mastZ);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), beaconMat);
  beacon.position.set(mastX, TOWER.h + 15.2, mastZ);
  group.add(beacon);
  // satellite dishes
  const dishGeo = new THREE.SphereGeometry(1.5, 24, 10, 0, Math.PI * 2, 0, 0.95);
  for (const [x, z, ry] of [[17, -12.5, 0.6], [12.6, -12.8, -0.4]]) {
    const dish = new THREE.Mesh(dishGeo, new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide }));
    dish.position.set(x, TOWER.h + 2.5, z);
    dish.rotation.set(-2.2, ry, 0);
    group.add(dish);
    box(metal, 0.14, 1.6, 0.14, x, TOWER.h + 0.8, z);
  }

  // skylights on the low wing (flush, so the swarm can run across them)
  const skyMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const skyGeo = new THREE.PlaneGeometry(5.2, 6.4);
  for (const x of [29.5, 37, 44.5]) {
    for (const z of [-5.2, 5.2]) {
      const s = new THREE.Mesh(skyGeo, skyMat);
      s.rotation.x = -Math.PI / 2;
      s.position.set(x, WING.h + 0.012, z);
      group.add(s);
      // glazing bars
      box(metal, 5.3, 0.03, 0.09, x, WING.h + 0.02, z);
      box(metal, 0.09, 0.03, 6.5, x - 1.3, WING.h + 0.02, z);
      box(metal, 0.09, 0.03, 6.5, x + 1.3, WING.h + 0.02, z);
    }
  }

  const warm = new THREE.Color(1.0, 0.82, 0.58);
  const sick = new THREE.Color(0.12, 1.0, 0.24);
  const alarm = new THREE.Color(1.0, 0.08, 0.04);
  const tmp = new THREE.Color();

  return {
    group,
    facades,
    /** Uploads baked infection times (seconds) for one facade. */
    setInfection(index, data) {
      facades[index].infData.set(data);
      facades[index].infTex.needsUpdate = true;
    },
    update(state) {
      const t = state.time;
      const c = state.corruption;
      const power = state.power;
      // skylights and the portal light go the same way as the rooms
      const flick = c > 0.05 && c < 0.98 ? 0.75 + 0.25 * Math.sin(t * 37) * Math.sin(t * 5.3) : 1;
      tmp.copy(warm).lerp(sick, c).multiplyScalar((1.05 - 0.25 * c) * flick * power);
      skyMat.color.copy(tmp);
      tmp.copy(warm).lerp(alarm, state.alarm).multiplyScalar((2.4 + 1.2 * state.alarm * Math.sin(t * 9)) * power);
      portalLight.color.copy(tmp);
      // aviation light: slow blink, frantic once the alarm is on
      const rate = state.alarm > 0.5 ? 5.5 : 1.1;
      const blink = Math.pow(Math.max(0, Math.sin(t * rate)), 6);
      beaconMat.color.setRGB(0.25 + 5.5 * blink, 0.02 + 0.3 * blink, 0.01);
    },
  };
}
