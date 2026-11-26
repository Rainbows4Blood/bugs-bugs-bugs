// Small math helpers shared by every module.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const fract = (x) => x - Math.floor(x);

export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Linear remap of x from [a, b] to [c, d], clamped. */
export const remap = (x, a, b, c, d) => c + (d - c) * clamp((x - a) / (b - a));

export const easeInOut = (t) => t * t * (3 - 2 * t);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** 1 inside [a, b] with soft edges, 0 outside. */
export const pulse = (x, a, b, inT = 0.2, outT = 0.2) =>
  smoothstep(a, a + inT, x) * (1 - smoothstep(b - outT, b, x));

/** Sharp attack, exponential release: 0 before t0, 1 at t0, decaying with time constant tau. */
export const hit = (x, t0, tau) => (x < t0 ? 0 : Math.exp(-(x - t0) / tau));

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap stateless hash of a number to [0, 1). */
export function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Smooth 1D value noise in [-1, 1]. */
export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i + seed * 57.3), hash1(i + 1 + seed * 57.3), u) * 2 - 1;
}

/** Piecewise interpolation through [time, value] keys with smooth easing between them. */
export function keys(t, table, ease = easeInOut) {
  if (t <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (t <= table[i][0]) {
      const [t0, v0] = table[i - 1];
      const [t1, v1] = table[i];
      return lerp(v0, v1, ease((t - t0) / (t1 - t0)));
    }
  }
  return table[table.length - 1][1];
}

/** Number of entries in a sorted array that are <= x. */
export function countBelow(sorted, x) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
