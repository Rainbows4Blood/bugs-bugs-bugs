import * as THREE from 'three';
import { GLSL_HASH, GLSL_NOISE, GLSL_SKY } from '../core/glsl.js';

/** Night-sky dome: gradient, stars, an oversized cinematic moon and drifting clouds. */
export function createSky(U) {
  const material = new THREE.ShaderMaterial({
    name: 'Sky',
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uTime: U.uTime,
      uMoonDir: U.uMoonDir,
      uCorruption: U.uCorruption,
      uFlash: U.uFlash,
      uFogColor: U.uFogColor,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        // rotation only: the dome follows the camera and sits at the far plane
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform float uTime;
      uniform vec3 uMoonDir;
      uniform float uCorruption;
      uniform float uFlash;
      uniform vec3 uFogColor;
      ${GLSL_HASH}
      ${GLSL_NOISE}
      ${GLSL_SKY}

      void main() {
        vec3 d = normalize(vDir);
        vec3 col = skyGradient(d, uCorruption);

        // stars
        vec2 sp = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * 105.0;
        vec2 sid = floor(sp);
        vec2 sf = fract(sp) - 0.5;
        vec2 sr = hash22(sid);
        float star = step(0.905, sr.x) * smoothstep(0.12, 0.0, length(sf - (sr - 0.5) * 0.5));
        float tw = 0.65 + 0.35 * sin(uTime * (1.5 + sr.y * 4.0) + sr.x * 90.0);
        col += vec3(0.75, 0.83, 1.0) * star * tw * (0.2 + 1.7 * sr.y * sr.y) * smoothstep(0.03, 0.32, d.y);

        // moon
        float md = dot(d, uMoonDir);
        vec3 mu = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
        vec3 mv = cross(uMoonDir, mu);
        vec2 mp = vec2(dot(d, mu), dot(d, mv)) / 0.031;
        float mr = length(mp);
        float disc = (1.0 - smoothstep(0.94, 1.0, mr)) * step(0.0, md);
        float crater = 1.0 - 0.4 * smoothstep(0.40, 0.72, fbm(mp * 1.8 + 4.0));
        vec3 moon = vec3(1.0, 0.97, 0.90) * crater * (1.0 - 0.35 * mr * mr) * 3.4;
        col += vec3(0.20, 0.27, 0.46) * pow(max(md, 0.0), 900.0) * 1.0;
        col += vec3(0.032, 0.046, 0.095) * pow(max(md, 0.0), 42.0);
        col = mix(col, moon, disc);

        // clouds
        float up = smoothstep(0.0, 0.16, d.y);
        if (up > 0.0) {
          vec2 cp = d.xz / (d.y + 0.14) * 1.15 + uTime * vec2(0.010, 0.0035);
          float cl = fbm(cp) * 0.7 + fbm(cp * 2.7 + 9.0) * 0.3;
          cl = smoothstep(0.44, 0.80, cl) * up;
          vec3 cc = vec3(0.015, 0.017, 0.032);
          cc += vec3(0.20, 0.25, 0.40) * pow(max(md, 0.0), 7.0);
          cc += vec3(0.07, 0.038, 0.028) * exp(-d.y * 6.0);
          cc = mix(cc, cc * vec3(0.7, 1.3, 0.75) + vec3(0.0, 0.028, 0.006), uCorruption);
          cc += vec3(0.2, 1.0, 0.3) * uFlash * (0.3 + 0.7 * vnoise(cp * 3.0 + uTime * 2.0));
          col = mix(col, cc, cl * 0.82 * (1.0 - disc * 0.55));
        }

        col = mix(col, uFogColor, smoothstep(0.03, -0.05, d.y));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  return mesh;
}

/**
 * A tiny environment map for PBR reflections: the sky plus a few bright cards
 * standing in for city light, so glossy bug shells pick up glints.
 */
export function createEnvironment(renderer, U) {
  const envScene = new THREE.Scene();
  envScene.add(createSky(U));
  const card = (color, intensity, x, y, z, sx, sy) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(sx, sy),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  };
  card(0xffd9a8, 6, 30, 6, 30, 26, 5); // warm street light
  card(0xffe6c4, 5, -34, 9, 22, 20, 6);
  card(0x9db8ff, 7, -20, 26, -34, 9, 9); // moon
  card(0xfff1dd, 3, 0, 14, -42, 60, 22); // lit facade
  card(0x7f9bff, 1.2, 40, 20, -10, 30, 30);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0.035, 0.1, 100).texture;
  pmrem.dispose();
  return env;
}
