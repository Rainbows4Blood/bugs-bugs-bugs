import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STRIPS, FACADES, TOWER, WING, MONUMENT, MANHOLES, TREES, LAMPS, BEAT, LOBBY_H, FLOOR_H } from '../config.js';
import { mulberry32 } from '../core/util.js';
import { facadeCell } from '../world/building.js';

// ---------------------------------------------------------------------------
// The swarm.
//
// Every bug's whole life is a pure function of time. Its route lives in the 2D
// "strip" space of the wall it is heading for (ground -> wall -> roof unfolded
// into one plane): spawn point, the spot where it reaches the wall, and where it
// ends up. The vertex shader evaluates that route, folds it back onto the
// building, builds an orientation frame from two samples along the path (so a
// bug pivots naturally over edges) and animates the legs. Nothing is simulated
// on the CPU, so the film can be scrubbed to any second instantly.
// ---------------------------------------------------------------------------

const WALL_SPEED = 0.4; // climbing speed relative to running speed

export const SWARM_GLSL = /* glsl */ `
uniform float uTime;
uniform vec4 uWallA[${STRIPS.length}];   // origin.x, origin.z, normal.x, normal.z
uniform vec4 uWallB[${STRIPS.length}];   // h1, w1, h2, usable half width
attribute vec4 iA;                       // P0.uv (spawn), P1.uv (reaches the wall)
attribute vec4 iB;                       // P2.uv (destination), spawn time, speed
attribute vec4 iC;                       // seed, size, strip index, idle radius

struct BugFrame { vec3 p; vec3 r; vec3 u; vec3 f; float s; float walk; };

vec2 swarmPath(float tt, out float walk) {
  vec2 P0 = iA.xy, P1 = iA.zw, P2 = iB.xy;
  float vA = iB.w, vB = iB.w * ${WALL_SPEED.toFixed(2)};
  vec2 dA = P1 - P0; float LA = max(length(dA), 0.001); dA /= LA;
  vec2 dB = P2 - P1; float LB = max(length(dB), 0.001); dB /= LB;
  float tA = LA / vA, tB = LB / vB;
  float seed = iC.x;
  vec2 p;
  if (tt < tA) {
    float s = tt * vA;
    float env = clamp(min(s, LA - s) / 9.0, 0.0, 1.0);
    float m = sin(s * 0.19 + seed * 37.0) * 1.5 + sin(s * 0.53 + seed * 91.0) * 0.6;
    p = P0 + dA * s + vec2(-dA.y, dA.x) * m * env;
    walk = s;
  } else if (tt < tA + tB) {
    float s = (tt - tA) * vB;
    float env = clamp(min(s, LB - s) / 4.0, 0.0, 1.0);
    float m = sin(s * 0.45 + seed * 53.0) * 1.0 + sin(s * 1.1 + seed * 13.0) * 0.35;
    p = P1 + dB * s + vec2(-dB.y, dB.x) * m * env;
    walk = LA + s;
  } else {
    // arrived: mill about on a slow Lissajous loop
    float ti = tt - tA - tB;
    float R = iC.w;
    float w1 = 0.34 + fract(seed * 7.13) * 0.5, w2 = 0.29 + fract(seed * 3.71) * 0.55;
    float f1 = seed * 20.0, f2 = seed * 33.0;
    p = P2 + R * vec2(sin(ti * w1 + f1) - sin(f1), sin(ti * w2 + f2) - sin(f2));
    walk = LA + LB + ti * R * 0.5;
  }
  return p;
}

vec3 stripToWorld(vec2 q, int wi, out vec3 nrm) {
  vec4 A = uWallA[wi];
  vec4 B = uWallB[wi];
  vec3 n = vec3(A.z, 0.0, A.w);
  if (q.y > -0.4) q.x = clamp(q.x, -B.w, B.w);
  vec3 base = vec3(A.x, 0.0, A.y) + vec3(A.w, 0.0, -A.z) * q.x;
  float v = q.y;
  vec3 p;
  if (v < 0.0) { nrm = vec3(0.0, 1.0, 0.0); p = base - n * v; }
  else if (v < B.x) { nrm = n; p = base + vec3(0.0, v, 0.0); }
  else if (v < B.x + B.y) { nrm = vec3(0.0, 1.0, 0.0); p = base + vec3(0.0, B.x, 0.0) - n * (v - B.x); }
  else if (v < B.x + B.y + B.z) { nrm = n; p = base + vec3(0.0, v - B.y, 0.0) - n * B.y; }
  else { nrm = vec3(0.0, 1.0, 0.0); p = base + vec3(0.0, B.x + B.z, 0.0) - n * (v - B.x - B.z); }
  return p;
}

BugFrame bugFrame() {
  BugFrame b;
  float tt = uTime - iB.z;
  float size = iC.y;
  int wi = int(iC.z + 0.5);
  float vA = iB.w;
  float tA = max(length(iA.zw - iA.xy), 0.001) / vA;
  float tB = max(length(iB.xy - iA.zw), 0.001) / (vA * ${WALL_SPEED.toFixed(2)});
  float spd = tt < tA ? vA : (tt < tA + tB ? vA * ${WALL_SPEED.toFixed(2)} : 1.0);
  // sample the path a little ahead and a little behind: the body spans the two points
  float dl = clamp(0.32 * size / spd, 0.015, 0.25);
  float wf, wr;
  vec2 qf = swarmPath(tt + dl, wf);
  vec2 qr = swarmPath(tt - dl, wr);
  vec3 nf, nr;
  vec3 pf = stripToWorld(qf, wi, nf);
  vec3 pr = stripToWorld(qr, wi, nr);
  vec3 fw = pf - pr;
  float fl = length(fw);
  fw = fl > 1e-5 ? fw / fl : vec3(0.0, 0.0, 1.0);
  vec3 up = normalize(nf + nr);
  float cv = max(0.0, -dot(fw, nr));          // > 0 while rounding an outside corner
  b.p = 0.5 * (pf + pr) + up * (0.015 + cv * fl * 0.72);
  up = normalize(up - fw * dot(up, fw));
  b.f = fw;
  b.u = up;
  b.r = cross(up, fw);
  b.s = size * smoothstep(0.0, 0.9, tt);
  b.walk = 0.5 * (wf + wr) * 5.6 / size;
  return b;
}

vec3 bugGlowColor(float seed) {
  float h = fract(seed * 13.7);
  if (h < 0.07) return vec3(1.0, 0.10, 0.04);
  return mix(vec3(0.12, 1.0, 0.24), vec3(0.62, 1.0, 0.14), fract(seed * 5.3) * fract(seed * 5.3));
}
`;

// ---------------------------------------------------------------------------
// Low-poly bug (~280 triangles): the silhouette has to read at 6 px and still
// hold up when one runs right past the lens.
// ---------------------------------------------------------------------------
function buildBugGeometry() {
  const parts = [];
  const Y = new THREE.Vector3(0, 1, 0);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();

  /** anim(localPositionBeforeTransform) -> [phase, legWeight, antennaWeight] */
  const add = (geo, matrix, color, { glow = 0, shell = 0, anim = null } = {}) => {
    const n = geo.attributes.position.count;
    const aAnim = new Float32Array(n * 3);
    if (anim) {
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(geo.attributes.position, i);
        const a = anim(v);
        aAnim.set(a, i * 3);
      }
    }
    geo.applyMatrix4(matrix);
    const col = new Float32Array(n * 3);
    const mat = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      col.set(color, i * 3);
      mat[i * 2] = glow;
      mat[i * 2 + 1] = shell;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aAnim', new THREE.BufferAttribute(aAnim, 3));
    geo.setAttribute('aMat', new THREE.BufferAttribute(mat, 2));
    geo.deleteAttribute('uv');
    parts.push(geo);
  };

  const ellipsoid = (ws, hs, sx, sy, sz, x, y, z) => {
    const g = new THREE.SphereGeometry(1, ws, hs);
    m4.compose(new THREE.Vector3(x, y, z), q.identity(), new THREE.Vector3(sx, sy, sz));
    return [g, m4.clone()];
  };
  /** Tapered tube from a to b. Local -Y end sits at a, +Y end at b. */
  const segment = (a, b, r0, r1, sides) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, true);
    q.setFromUnitVectors(Y, dir.normalize());
    m4.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    return [g, m4.clone(), len];
  };

  const SHELL = [0.045, 0.05, 0.075];
  const PLATE = [0.075, 0.078, 0.095];
  const LIMB = [0.028, 0.028, 0.034];

  // abdomen (wing cases), slightly flattened underneath
  {
    const [g, m] = ellipsoid(8, 5, 0.19, 0.118, 0.31, 0, 0.14, -0.17);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0) pos.setY(i, pos.getY(i) * 0.5);
    add(g, m, SHELL, { shell: 1 });
  }
  // thorax
  add(...ellipsoid(6, 4, 0.148, 0.094, 0.135, 0, 0.125, 0.19), PLATE);
  // head
  add(...ellipsoid(5, 3, 0.1, 0.07, 0.086, 0, 0.105, 0.36), SHELL);
  // eyes
  for (const s of [-1, 1]) add(...ellipsoid(4, 2, 0.037, 0.037, 0.037, s * 0.062, 0.137, 0.405), [0, 0, 0], { glow: 1 });
  // mandibles
  for (const s of [-1, 1]) {
    const g = new THREE.ConeGeometry(0.02, 0.1, 4);
    q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)).premultiply(new THREE.Quaternion().setFromAxisAngle(Y, -s * 0.38));
    m4.compose(new THREE.Vector3(s * 0.04, 0.075, 0.455), q, new THREE.Vector3(1, 1, 1));
    add(g, m4.clone(), LIMB);
  }
  // antennae: two segments each, tips sway
  for (const s of [-1, 1]) {
    const a = new THREE.Vector3(s * 0.04, 0.15, 0.41);
    const b = new THREE.Vector3(s * 0.13, 0.255, 0.6);
    const c = new THREE.Vector3(s * 0.245, 0.245, 0.81);
    const [g1, m1, l1] = segment(a, b, 0.012, 0.009, 3);
    add(g1, m1, LIMB, { anim: (p) => [0, 0, (p.y / l1 + 0.5) * 0.45] });
    const [g2, m2, l2] = segment(b, c, 0.009, 0.004, 3);
    add(g2, m2, LIMB, { anim: (p) => [0, 0, 0.45 + (p.y / l2 + 0.5) * 0.55] });
  }
  // legs: femur up and out to the knee, tibia down to the ground. Tripod gait.
  const hipZ = [0.27, 0.17, 0.07];
  const kneeDz = [0.1, 0.0, -0.13];
  const footDz = [0.21, 0.01, -0.28];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const hip = new THREE.Vector3(s * 0.115, 0.1, hipZ[i]);
      const knee = new THREE.Vector3(s * 0.3, 0.215, hipZ[i] + kneeDz[i]);
      const foot = new THREE.Vector3(s * 0.43, 0.0, hipZ[i] + footDz[i]);
      const phase = (s > 0) === (i !== 1) ? 0 : Math.PI;
      const [g1, m1, l1] = segment(hip, knee, 0.028, 0.021, 3);
      add(g1, m1, LIMB, { anim: (p) => [phase, (p.y / l1 + 0.5) * 0.5, 0] });
      const [g2, m2, l2] = segment(knee, foot, 0.021, 0.008, 3);
      add(g2, m2, LIMB, { anim: (p) => [phase, 0.5 + (p.y / l2 + 0.5) * 0.5, 0] });
    }
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

// ---------------------------------------------------------------------------
// Route planning (runs once at start-up)
// ---------------------------------------------------------------------------
function segHitsBox(ax, az, bx, bz, x0, x1, z0, z1) {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dz, az - z0) && clip(dz, z1 - az) && t0 <= t1;
}

function segHitsCircle(ax, az, bx, bz, cx, cz, r) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / l2)) : 0;
  const px = ax + dx * t - cx;
  const pz = az + dz * t - cz;
  return px * px + pz * pz < r * r;
}

/** Obstacles a straight ground run must not cross. `extra` adds static rectangles (cars). */
function makeBlocked(extraBoxes) {
  const boxes = [
    [TOWER.x0 + 0.35, TOWER.x1 - 0.35, TOWER.z0 + 0.35, TOWER.z1 - 0.35],
    [WING.x0 - 0.5, WING.x1 - 0.35, WING.z0 + 0.35, WING.z1 - 0.35],
    [MONUMENT.x0 - 1.3, MONUMENT.x1 + 1.3, MONUMENT.z0 - 1.3, MONUMENT.z1 + 1.3],
    ...extraBoxes,
  ];
  const circles = [...TREES.map(([x, z]) => [x, z, 1.9]), ...LAMPS.map(([x, z]) => [x, z, 0.7])];
  return (ax, az, bx, bz) => {
    for (const b of boxes) if (segHitsBox(ax, az, bx, bz, b[0], b[1], b[2], b[3])) return true;
    for (const c of circles) if (segHitsCircle(ax, az, bx, bz, c[0], c[1], c[2])) return true;
    return false;
  };
}

function generateRoutes(count, seed, extraBoxes) {
  const rnd = mulberry32(seed);
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 0.87;
  const blocked = makeBlocked(extraBoxes);
  const iA = new Float32Array(count * 4);
  const iB = new Float32Array(count * 4);
  const iC = new Float32Array(count * 4);
  const totalWeight = STRIPS.reduce((s, x) => s + x.weight, 0);

  // which manholes can feed which strip (must be out in front of the wall)
  const holeUV = STRIPS.map((S) =>
    MANHOLES.map((m) => {
      const dx = m.x - S.ox;
      const dz = m.z - S.oz;
      return { u: dx * S.n[2] - dz * S.n[0], v: -(dx * S.n[0] + dz * S.n[2]), open: m.open };
    }).filter((h) => h.v < -6),
  );

  for (let i = 0; i < count; i++) {
    let done = false;
    for (let attempt = 0; attempt < 60 && !done; attempt++) {
      // strip
      let w = rnd() * totalWeight;
      let si = 0;
      while (w > STRIPS[si].weight && si < STRIPS.length - 1) w -= STRIPS[si++].weight;
      const S = STRIPS[si];
      const tx = S.n[2];
      const tz = -S.n[0];
      const toWorld = (u, v) => [S.ox + tx * u - S.n[0] * v, S.oz + tz * u - S.n[2] * v];

      const role = rnd();
      const speed = 5.2 + rnd() * 2.6;
      let u1;
      let v1;
      let p1u;
      let p1v;
      let idle;
      const usable = S.uHalf - 0.8;
      if (role < 0.27) {
        // stays on the ground in front of this wall
        // (far enough out that its idle loop never touches the wall)
        idle = 1.2 + rnd() * 3.2;
        v1 = -(2 * idle + 0.9 + Math.pow(rnd(), 0.8) * 46);
        u1 = (rnd() * 2 - 1) * (S.uHalf + 16);
        p1u = u1;
        p1v = v1;
      } else {
        u1 = (rnd() * 2 - 1) * usable;
        if (role < 0.85) {
          // lives on a wall
          if (S.h2 > 0 && rnd() < 0.62) v1 = S.h1 + S.w1 + 0.6 + rnd() * (S.h2 - 1.0);
          else v1 = 0.6 + rnd() * (S.h1 - 1.0);
          idle = 0.5 + rnd() * 1.5;
        } else {
          // heads for a roof
          if (S.h2 > 0) {
            v1 = rnd() < 0.55 ? S.h1 + 1.5 + rnd() * (S.w1 - 3.5) : S.h1 + S.w1 + S.h2 + 1.2 + rnd() * 5;
          } else {
            v1 = S.h1 + 1.2 + rnd() * Math.min(S.roof - 4.5, 4.2);
          }
          u1 = (rnd() * 2 - 1) * (S.uHalf - 2);
          idle = 0.5 + rnd() * 1.2;
        }
        p1u = Math.max(-usable, Math.min(usable, u1 + gauss() * 5));
        p1v = 0;
        // keep clear of the entrance portal
        if (si === 0) {
          if (Math.abs(p1u) < 4.2) p1u = (p1u < 0 ? -1 : 1) * (4.3 + rnd() * 2.5);
          if (v1 < 5.6 && Math.abs(u1) < 4.2) u1 = (u1 < 0 ? -1 : 1) * (4.3 + rnd() * 3);
        }
      }

      // where does it come from, and when
      let u0;
      let v0;
      let t0;
      const holes = holeUV[si];
      if (holes.length && rnd() < 0.36) {
        const h = holes[Math.floor(rnd() * holes.length)];
        const a = rnd() * Math.PI * 2;
        const r = rnd() * 0.45;
        u0 = h.u + Math.cos(a) * r;
        v0 = h.v + Math.sin(a) * r;
        t0 = h.open + 0.12 + Math.min(34, -Math.log(1 - rnd() * 0.985) * 7.5);
      } else {
        const climber = role >= 0.27;
        const arrive = climber ? 20.5 + 27 * Math.pow(rnd(), 1.55) : 16.5 + 33 * Math.pow(rnd(), 1.2);
        // Nothing may be near the plaza before the first manhole blows: the tide
        // starts at least 100 m out, and no earlier than the macro shot.
        const tMin = 10.2 + rnd() * 2.4;
        const D = Math.max(100, Math.min(200, speed * (arrive - tMin)));
        t0 = Math.max(tMin, arrive - D / speed);
        const th = (rnd() * 2 - 1) * 1.2;
        // direction in strip space: straight out from the wall is -v
        u0 = p1u + Math.sin(th) * D;
        v0 = p1v - Math.cos(th) * D;
      }
      if (v0 > -2) continue;

      const [ax, az] = toWorld(u0, v0);
      const [bx, bz] = toWorld(p1u, p1v);
      if (blocked(ax, az, bx, bz)) continue;
      // ground destinations must not sit inside an obstacle either
      if (role < 0.27 && blocked(bx - 1.5, bz, bx + 1.5, bz)) continue;

      const size = rnd() < 0.03 ? 1.25 + rnd() * 0.6 : 0.5 + rnd() * rnd() * 0.6;
      iA.set([u0, v0, p1u, p1v], i * 4);
      iB.set([u1, v1, t0, speed], i * 4);
      iC.set([rnd(), size, si, idle], i * 4);
      done = true;
    }
    if (!done) {
      // could not place it: park it far in the future so it never appears
      iA.set([0, -100, 0, -50], i * 4);
      iB.set([0, -50, 1e6, 6], i * 4);
      iC.set([0.5, 0.5, 0, 1], i * 4);
    }
  }
  return { iA, iB, iC };
}

/**
 * When does each window get overrun? Walk every climber's wall leg and note the
 * moment it first crosses each window cell; a cell turns once two bugs have been
 * through. Returns one Float32Array of times per facade.
 */
function bakeInfection(routes, count) {
  const { iA, iB, iC } = routes;
  const first = FACADES.map((f) => new Float32Array(f.cols * (1 + Math.round((f.h - LOBBY_H) / FLOOR_H))).fill(Infinity));
  const second = first.map((a) => new Float32Array(a.length).fill(Infinity));
  const note = (fi, lx, y, time) => {
    const c = facadeCell(FACADES[fi], lx, y);
    if (time < first[fi][c]) {
      second[fi][c] = first[fi][c];
      first[fi][c] = time;
    } else if (time < second[fi][c]) {
      second[fi][c] = time;
    }
  };
  for (let i = 0; i < count; i++) {
    const t0 = iB[i * 4 + 2];
    if (t0 > 1e5) continue;
    const p1u = iA[i * 4 + 2];
    const p1v = iA[i * 4 + 3];
    if (p1v < -0.01) continue; // ground dweller
    const u1 = iB[i * 4];
    const v1 = iB[i * 4 + 1];
    const speed = iB[i * 4 + 3];
    const seed = iC[i * 4];
    const S = STRIPS[Math.round(iC[i * 4 + 2])];
    const LA = Math.hypot(p1u - iA[i * 4], p1v - iA[i * 4 + 1]);
    const LB = Math.max(Math.hypot(u1 - p1u, v1 - p1v), 0.001);
    const dx = (u1 - p1u) / LB;
    const dy = (v1 - p1v) / LB;
    const tWall = t0 + LA / speed;
    const vB = speed * WALL_SPEED;
    const lim = S.uHalf - 0.45;
    for (let s = 0; s <= LB; s += 0.45) {
      const env = Math.max(0, Math.min(1, Math.min(s, LB - s) / 4));
      const m = Math.sin(s * 0.45 + seed * 53) * 1.0 + Math.sin(s * 1.1 + seed * 13) * 0.35;
      const u = Math.max(-lim, Math.min(lim, p1u + dx * s - dy * m * env));
      const v = p1v + dy * s + dx * m * env;
      const time = tWall + s / vB;
      if (v >= 0 && v < S.h1) note(S.facade, u, v, time);
      else if (S.h2 > 0 && v >= S.h1 + S.w1 && v < S.h1 + S.w1 + S.h2) note(S.upperFacade, u, v - S.w1, time);
    }
  }
  const rnd = mulberry32(99);
  return first.map((a, fi) => {
    const def = FACADES[fi];
    const out = new Float32Array(a.length);
    for (let c = 0; c < a.length; c++) {
      const row = Math.floor(c / def.cols);
      const y = row === 0 ? 3 : LOBBY_H + (row - 0.5) * FLOOR_H;
      // whatever the swarm missed goes down with the queen's pulse, top floors first
      const fallback = BEAT.screech + 0.2 + ((def.h - y) / def.h) * 0.9 + rnd() * 0.5;
      const t = Number.isFinite(second[fi][c]) ? second[fi][c] : first[fi][c] + 1.5;
      out[c] = Math.min(Number.isFinite(t) ? t + 0.25 : Infinity, fallback);
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
export function createSwarm(U, quality, { extraBoxes = [] } = {}) {
  const count = quality.bugs;
  const routes = generateRoutes(count, 20261125, extraBoxes);
  const infection = bakeInfection(routes, count);

  const wallA = STRIPS.map((S) => new THREE.Vector4(S.ox, S.oz, S.n[0], S.n[2]));
  const wallB = STRIPS.map((S) => new THREE.Vector4(S.h1, S.w1, S.h2, S.uHalf - 0.45));

  // ---- bodies -------------------------------------------------------------
  const base = buildBugGeometry();
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  for (const name of ['position', 'normal', 'color', 'aAnim', 'aMat']) geometry.setAttribute(name, base.attributes[name]);
  geometry.setAttribute('iA', new THREE.InstancedBufferAttribute(routes.iA, 4));
  geometry.setAttribute('iB', new THREE.InstancedBufferAttribute(routes.iB, 4));
  geometry.setAttribute('iC', new THREE.InstancedBufferAttribute(routes.iC, 4));
  geometry.instanceCount = count;

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.3,
    metalness: 0.25,
    envMapIntensity: 1.4,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uWallA = { value: wallA };
    shader.uniforms.uWallB = { value: wallB };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aAnim;
        attribute vec2 aMat;
        varying vec3 vBugLocal;
        varying vec3 vBugGlow;
        varying vec3 vBugMat;
        ${SWARM_GLSL}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `BugFrame bf = bugFrame();
        vec3 objectNormal = bf.r * normal.x + bf.u * normal.y + bf.f * normal.z;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 lp = position;
        float ph = bf.walk + aAnim.x;
        lp.z += aAnim.y * 0.10 * sin(ph);
        lp.y += aAnim.y * 0.065 * max(0.0, cos(ph));
        lp.x += aAnim.z * 0.05 * sin(uTime * 5.0 + iC.x * 50.0);
        lp.y += aAnim.z * 0.04 * sin(uTime * 3.7 + iC.x * 70.0) + (1.0 - aAnim.y) * 0.008 * sin(ph * 2.0);
        vec3 transformed = bf.p + (bf.r * lp.x + bf.u * lp.y + bf.f * lp.z) * bf.s;
        vBugLocal = position;
        vBugGlow = bugGlowColor(iC.x);
        vBugMat = vec3(aMat, iC.x);
        vColor.rgb *= 0.75 + 0.6 * fract(iC.x * 29.3);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        varying vec3 vBugLocal;
        varying vec3 vBugGlow;
        varying vec3 vBugMat;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float pulse = 0.7 + 0.3 * sin(uTime * 4.0 + vBugMat.z * 60.0);
          float lines = 0.0;
          if (vBugMat.y > 0.5) {
            float f = abs(fract(vBugLocal.z * 8.0 + 0.25) - 0.5);
            lines = (1.0 - smoothstep(0.03, 0.09, f)) * 0.8 + (1.0 - smoothstep(0.008, 0.026, abs(vBugLocal.x)));
            lines *= smoothstep(0.10, 0.17, vBugLocal.y);
          }
          totalEmissiveRadiance += vBugGlow * (vBugMat.x * 5.0 + lines * 1.1) * pulse;
        }`,
      );
  };
  material.customProgramCacheKey = () => 'swarm-body';

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'swarm';
  // The wet ground mirrors the scene with a second, blurrier render. A third of
  // the swarm is plenty there, and the swarm is the most expensive thing drawn.
  let drawCount = count;
  let mainCamera = null;
  mesh.onBeforeRender = (renderer, scene, cam) => {
    geometry.instanceCount = cam === mainCamera || !mainCamera ? drawCount : Math.ceil(drawCount * 0.34);
  };

  // ---- eye glow -----------------------------------------------------------
  // One additive point per bug so the swarm still reads as thousands of eyes
  // when the bodies shrink to a few pixels.
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  glowGeo.setAttribute('iA', new THREE.BufferAttribute(routes.iA, 4));
  glowGeo.setAttribute('iB', new THREE.BufferAttribute(routes.iB, 4));
  glowGeo.setAttribute('iC', new THREE.BufferAttribute(routes.iC, 4));
  const glowMat = new THREE.ShaderMaterial({
    name: 'SwarmGlow',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: U.uTime,
      uWallA: { value: wallA },
      uWallB: { value: wallB },
      uPx: { value: 1000 },
      uFogDensity: U.uFogDensity,
    },
    vertexShader: /* glsl */ `
      ${SWARM_GLSL}
      uniform float uPx;
      uniform float uFogDensity;
      varying vec3 vCol;
      void main() {
        BugFrame b = bugFrame();
        vec3 wp = b.p + (b.f * 0.40 + b.u * 0.14) * b.s;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        mv.z += 0.3 * b.s;                         // pull in front of the head
        gl_Position = projectionMatrix * mv;
        float dist = max(-mv.z, 0.01);
        float px = uPx * b.s * 0.3 / dist;
        gl_PointSize = clamp(px, 2.1, 48.0);
        float fog = exp(-uFogDensity * uFogDensity * dist * dist);
        float pulse = 0.7 + 0.3 * sin(uTime * 4.0 + iC.x * 60.0);
        // far away the bodies vanish, so the eyes carry the swarm: keep them lit
        float far = mix(1.0, 2.4, smoothstep(35.0, 130.0, dist));
        vCol = bugGlowColor(iC.x) * pulse * fog * far * min(1.0, px / 1.4) * step(0.001, b.s);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = max(0.0, 1.0 - d);
        gl_FragColor = vec4(vCol * (a * a * 1.15), 1.0);
      }
    `,
  });
  const glow = new THREE.Points(glowGeo, glowMat);
  glow.frustumCulled = false;
  glow.name = 'swarmGlow';

  const spawnTimes = Float32Array.from({ length: count }, (_, i) => routes.iB[i * 4 + 2])
    .filter((t) => t < 1e5)
    .sort();

  return {
    mesh,
    glow,
    count,
    infection,
    spawnTimes,
    /** Draw only the first `fraction` of the swarm (it is randomly ordered, so this thins it evenly). */
    setFraction(fraction) {
      drawCount = Math.max(1, Math.round(count * fraction));
      geometry.instanceCount = drawCount;
      glowGeo.setDrawRange(0, drawCount);
    },
    setCamera(cam) {
      mainCamera = cam;
    },
    setViewport(heightPx, fovDeg) {
      glowMat.uniforms.uPx.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    },
  };
}
