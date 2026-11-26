import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Site layout (metres). The HQ faces +Z, towards the plaza and the street.
// ---------------------------------------------------------------------------
export const TOWER = { x0: -30, x1: 22, z0: -16, z1: 16, h: 46 };
export const WING = { x0: 22, x1: 52, z0: -13, z1: 13, h: 18 };
export const LOBBY_H = 6;
export const FLOOR_H = 4;

export const MOON_DIR = new THREE.Vector3(0.571, 0.375, -0.731).normalize();
export const FOG_COLOR = new THREE.Color(0.024, 0.022, 0.042);
export const FOG_DENSITY = 0.0042;

/** Rendered curtain-wall planes. `n` is the outward normal, `cols` the number of bays. */
export const FACADES = [
  { id: 'towerFront', n: [0, 0, 1], cx: -4, cz: 16, w: 52, h: 46, cols: 16, band: [4, 11, 9, 10], door: [7, 8] },
  { id: 'towerBack', n: [0, 0, -1], cx: -4, cz: -16, w: 52, h: 46, cols: 16 },
  { id: 'towerWest', n: [-1, 0, 0], cx: -30, cz: 0, w: 32, h: 46, cols: 10 },
  { id: 'towerEast', n: [1, 0, 0], cx: 22, cz: 0, w: 32, h: 46, cols: 10 },
  { id: 'wingFront', n: [0, 0, 1], cx: 37, cz: 13, w: 30, h: 18, cols: 10 },
  { id: 'wingBack', n: [0, 0, -1], cx: 37, cz: -13, w: 30, h: 18, cols: 10 },
  { id: 'wingEast', n: [1, 0, 0], cx: 52, cz: 0, w: 26, h: 18, cols: 8 },
];

/**
 * Crawl strips. Each one is the building surface "unfolded" along the path a bug
 * takes: ground (v < 0) -> wall (0..h1) -> roof (h1..h1+w1) -> upper wall (h2) -> roof.
 * `u` runs along the wall, left to right when seen from outside.
 */
export const STRIPS = [
  { facade: 0, ox: -4, oz: 16, n: [0, 0, 1], uHalf: 26, h1: 46, w1: 1e5, h2: 0, roof: 32, weight: 3.5 },
  { facade: 1, ox: -4, oz: -16, n: [0, 0, -1], uHalf: 26, h1: 46, w1: 1e5, h2: 0, roof: 32, weight: 0.8 },
  { facade: 2, ox: -30, oz: 0, n: [-1, 0, 0], uHalf: 16, h1: 46, w1: 1e5, h2: 0, roof: 52, weight: 1.2 },
  { facade: 4, ox: 37, oz: 13, n: [0, 0, 1], uHalf: 15, h1: 18, w1: 1e5, h2: 0, roof: 26, weight: 1.35 },
  { facade: 5, ox: 37, oz: -13, n: [0, 0, -1], uHalf: 15, h1: 18, w1: 1e5, h2: 0, roof: 26, weight: 0.4 },
  { facade: 6, ox: 52, oz: 0, n: [1, 0, 0], uHalf: 13, h1: 18, w1: 30, h2: 28, roof: 52, upperFacade: 3, weight: 1.5 },
];

/** Maps strip coordinates to a world position and surface normal (mirrors the GLSL). */
export function stripToWorld(strip, u, v, lift, outP, outN) {
  const nx = strip.n[0];
  const nz = strip.n[2];
  let x = strip.ox + nz * u;
  let z = strip.oz - nx * u;
  let y = 0;
  let wall = false;
  if (v < 0) {
    x -= nx * v;
    z -= nz * v;
  } else if (v < strip.h1) {
    y = v;
    wall = true;
  } else if (v < strip.h1 + strip.w1) {
    const d = v - strip.h1;
    y = strip.h1;
    x -= nx * d;
    z -= nz * d;
  } else if (v < strip.h1 + strip.w1 + strip.h2) {
    y = strip.h1 + (v - strip.h1 - strip.w1);
    x -= nx * strip.w1;
    z -= nz * strip.w1;
    wall = true;
  } else {
    const d = strip.w1 + (v - strip.h1 - strip.w1 - strip.h2);
    y = strip.h1 + strip.h2;
    x -= nx * d;
    z -= nz * d;
  }
  if (wall) {
    outP.set(x + nx * lift, y, z + nz * lift);
    outN.set(nx, 0, nz);
  } else {
    outP.set(x, y + lift, z);
    outN.set(0, 1, 0);
  }
  return outP;
}

// ---------------------------------------------------------------------------
// Things on the plaza
// ---------------------------------------------------------------------------
export const ENTRANCE_X = -4;

/** Low stone sign at the plaza edge; patient zero walks along its top. */
export const MONUMENT = { x0: -21, x1: -12.4, z0: 53.5, z1: 54.5, h: 1.5 };

export const LAMPS = [
  [-22, 30], [14, 30], [-22, 47], [14, 47], [-22, 64], [14, 64], [-52, 40], [44, 50],
];

/** Manholes the first wave pours out of: x, z, opening time. */
export const MANHOLES = [
  { x: -8.5, z: 67.5, open: 12.7 },
  { x: 26, z: 60, open: 14.0 },
  { x: -42, z: 42, open: 15.0 },
  { x: 60, z: 34, open: 15.4 },
  { x: 8, z: -46, open: 14.5 },
];

/** Parked cars on the front street (4.5 m long, parallel to the kerb). */
export const CARS = [
  { x: -54, z: 76.8, color: 0x1a1d24, dir: 1 },
  { x: -34, z: 76.8, color: 0x7a1717, dir: 1 },
  { x: 37, z: 76.8, color: 0xc9ced4, dir: 1 },
  { x: 57, z: 76.8, color: 0x14233d, dir: 1 },
  { x: 14, z: 87.3, color: 0x26262a, dir: -1 },
];

/** The sign on the tower's crown band. */
export const SIGN = { x: -4, y: 39.8, z: 16.32, cap: 4.5, depth: 0.6 };

export const TREES = [
  [-36, 58], [-36, 40], [-36, 24], [30, 62], [30, 44],
  [-62, 62], [-64, 20], [-66, -20], [66, 60], [70, 14], [72, -22],
  [-30, -40], [10, -42], [44, -38],
];

// ---------------------------------------------------------------------------
// The film: beat times in seconds
// ---------------------------------------------------------------------------
export const BEAT = {
  macro: 7.5, // cut to patient zero
  eyesRed: 11.0, // it wakes up
  reverse: 11.9, // reverse angle: the street
  manhole: 12.7, // first cover blows
  flood: 15.6, // riding in with the tide
  crane: 22.6, // high wide: the tide hits the building
  climb: 27.0, // on the facade
  alarm: 36.0, // beacons on
  sign: 40.0, // around the sign
  signGlitch: 42.4,
  signOops: 46.3, // sign settles on its new text
  drone: 49.2, // roof: the queen arrives
  hero: 55.6, // low wide
  screech: 58.2, // the pulse
  title: 61.2,
  free: 66.0, // camera handed to the viewer
  loop: 104.0, // restart if nobody touched anything
};

/**
 * Quality tiers. `pixels` is a budget of rendered pixels: small viewports get
 * the full device pixel ratio, large ones are capped rather than melting the GPU.
 */
export const QUALITY = {
  potato: { bugs: 2600, flyers: 140, embers: 90, pixels: 0.14e6, reflect: 0, dof: false, msaa: 0 },
  low: { bugs: 5200, flyers: 260, embers: 120, pixels: 0.9e6, reflect: 0.4, dof: false, msaa: 0 },
  medium: { bugs: 9500, flyers: 420, embers: 170, pixels: 1.6e6, reflect: 0.5, dof: true, msaa: 4 },
  high: { bugs: 14000, flyers: 640, embers: 220, pixels: 3.3e6, reflect: 0.6, dof: true, msaa: 4 },
  ultra: { bugs: 22000, flyers: 1000, embers: 280, pixels: 8.3e6, reflect: 0.85, dof: true, msaa: 4 },
};
