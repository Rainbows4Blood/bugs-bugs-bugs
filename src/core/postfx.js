import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GLSL_HASH } from './glsl.js';

// Pipeline: scene (HDR, MSAA) -> depth of field -> bloom -> grade/glitch/tone map.

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Renders the scene into its own multisampled HDR target (with a depth texture)
 * and resolves it into the composer chain, applying a gather-style bokeh blur
 * when depth of field is switched on.
 */
class ScenePass extends Pass {
  constructor(scene, camera, { msaa, dof }) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = true;
    this.dofAvailable = dof;
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      samples: msaa,
      depthTexture: dof ? new THREE.DepthTexture(4, 4, THREE.UnsignedIntType) : null,
    });
    this.material = new THREE.ShaderMaterial({
      name: 'SceneResolve',
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      defines: dof ? { USE_DOF: 1 } : {},
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uFocus: { value: 10 },
        uFocusScale: { value: 0 },
        uMaxBlur: { value: 12 },
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform vec2 uTexel;
        uniform float uNear;
        uniform float uFar;
        uniform float uFocus;
        uniform float uFocusScale;
        uniform float uMaxBlur;
        varying vec2 vUv;

        #ifdef USE_DOF
        float viewDist(vec2 uv) {
          return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
        }
        float blurSize(float depth) {
          float coc = clamp((1.0 / uFocus - 1.0 / depth) * uFocusScale, -1.0, 1.0);
          return abs(coc) * uMaxBlur;
        }
        #endif

        void main() {
          vec3 color = texture2D(tColor, vUv).rgb;
          #ifdef USE_DOF
          if (uFocusScale > 0.0) {
            float centerDepth = viewDist(vUv);
            float centerSize = blurSize(centerDepth);
            float tot = 1.0;
            float radius = 0.8;
            float grow = uMaxBlur * uMaxBlur / 150.0;   // ~75 taps whatever the radius
            for (float ang = 0.0; radius < uMaxBlur; ang += 2.39996323) {
              vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uTexel * radius;
              vec3 sc = texture2D(tColor, tc).rgb;
              float sd = viewDist(tc);
              float ss = blurSize(sd);
              if (sd > centerDepth) ss = clamp(ss, 0.0, centerSize * 2.0);
              float m = smoothstep(radius - 0.5, radius + 0.5, ss);
              color += mix(color / tot, sc, m);
              tot += 1.0;
              radius += grow / radius;
            }
            color /= tot;
          }
          #endif
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setSize(w, h) {
    this.target.setSize(w, h);
    this.material.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.material.uniforms.uMaxBlur.value = THREE.MathUtils.clamp((h / 720) * 11, 5, 18);
  }

  /** focus: distance in metres; strength 0 disables the effect. */
  setFocus(focus, strength) {
    const u = this.material.uniforms;
    u.uFocus.value = focus;
    u.uFocusScale.value = this.dofAvailable ? strength : 0;
  }

  render(renderer, writeBuffer) {
    const u = this.material.uniforms;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}

const FinalShader = {
  name: 'Final',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGlitch: { value: 0 },
    uAberration: { value: 0.0018 },
    uVignette: { value: 1 },
    uGrain: { value: 0.026 },
    uScan: { value: 0 },
    uFade: { value: 1 },
    uExposure: { value: 1 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: FS_VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGlitch;
    uniform float uAberration;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uScan;
    uniform float uFade;
    uniform float uExposure;
    uniform vec3 uTint;
    uniform float uAspect;
    varying vec2 vUv;
    ${GLSL_HASH}

    void main() {
      vec2 uv = vUv;
      float g = uGlitch;
      float tick = floor(uTime * 24.0);

      // digital tearing: displaced scanline bands and a few shifted blocks
      if (g > 0.002) {
        float band = floor(uv.y * 34.0 + hash11(tick) * 7.0);
        float n = hash12(vec2(band, tick));
        uv.x += step(1.0 - g * 0.5, n) * (hash12(vec2(band * 1.7, tick + 3.0)) - 0.5) * 0.14 * g;
        vec2 blk = floor(uv * vec2(11.0, 6.0));
        float bn = hash12(blk + tick * 0.37);
        uv += step(1.0 - g * 0.14, bn) * (hash22(blk + tick) - 0.5) * 0.07 * g;
      }

      // lens chromatic aberration, stronger towards the corners
      vec2 dir = uv - 0.5;
      float ab = uAberration * (0.5 + 2.4 * dot(dir, dir)) + g * 0.011;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ab).b;

      float vig = smoothstep(1.02, 0.32, length(dir * vec2(1.0, 1.0 / max(uAspect, 1.0) + 0.42)));
      col *= mix(1.0, vig, uVignette);
      col *= uTint * (uFade * uExposure);

      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>

      // display-referred finishing: scanlines and film grain
      float scan = 0.5 + 0.5 * sin(gl_FragCoord.y * 2.2);
      gl_FragColor.rgb *= 1.0 - uScan * 0.16 * scan;
      float grain = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 913.0) - 0.5;
      gl_FragColor.rgb += grain * uGrain * uFade;
      gl_FragColor.a = 1.0;
    }
  `,
};

export function createPost(renderer, scene, camera, quality) {
  const composer = new EffectComposer(renderer);
  const scenePass = new ScenePass(scene, camera, { msaa: quality.msaa, dof: quality.dof });
  composer.addPass(scenePass);

  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.42, 1.0);
  composer.addPass(bloom);

  const final = new ShaderPass(FinalShader);
  composer.addPass(final);

  return {
    composer,
    scenePass,
    bloom,
    final,
    setSize(w, h, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(w, h);
      final.uniforms.uAspect.value = w / h;
    },
    render() {
      composer.render();
    },
  };
}
