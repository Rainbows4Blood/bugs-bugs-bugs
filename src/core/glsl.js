// GLSL snippets shared between materials.

export const GLSL_HASH = /* glsl */ `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
`;

export const GLSL_NOISE = /* glsl */ `
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;

// Night-sky gradient. Used by the sky dome and (cheaply) by glass reflections so
// that what the building mirrors matches what is actually overhead.
export const GLSL_SKY = /* glsl */ `
vec3 skyGradient(vec3 d, float corruption) {
  float h = d.y;
  vec3 zen = vec3(0.0035, 0.006, 0.019);
  vec3 mid = vec3(0.011, 0.015, 0.042);
  vec3 hor = vec3(0.060, 0.046, 0.084);
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.2, h));
  c = mix(c, zen, smoothstep(0.14, 0.8, h));
  // warm light pollution hugging the horizon, stronger towards downtown
  float glow = exp(-max(h, 0.0) * 8.0);
  float az = atan(d.z, d.x);
  c += vec3(0.085, 0.040, 0.020) * glow * (0.55 + 0.45 * sin(az * 2.0 + 0.9));
  // the sky sours as the building is taken over
  c = mix(c, c * vec3(0.72, 1.18, 0.78) + vec3(0.0, 0.012, 0.002) * glow, corruption);
  return c;
}
`;

// Exponential-squared fog matching THREE.FogExp2.
export const GLSL_FOG = /* glsl */ `
vec3 applyFog(vec3 col, float dist, vec3 fogColor, float density) {
  float f = 1.0 - exp(-density * density * dist * dist);
  return mix(col, fogColor, f);
}
`;
