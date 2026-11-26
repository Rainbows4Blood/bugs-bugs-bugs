import './style.css';

// Collect errors so they can be inspected from the debug hook.
const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
const consoleError = console.error;
console.error = (...a) => {
  errors.push(a.map(String).join(' ').slice(0, 1800));
  consoleError.apply(console, a);
};

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MOON_DIR, FOG_COLOR, FOG_DENSITY, QUALITY, BEAT, MONUMENT, TOWER } from './config.js';
import { clamp, lerp, smoothstep, pulse, hit, keys, countBelow } from './core/util.js';
import { createPost } from './core/postfx.js';
import { createSky, createEnvironment } from './world/sky.js';
import { createBuilding } from './world/building.js';
import { createGround } from './world/ground.js';
import { createProps } from './world/props.js';
import { createCity } from './world/city.js';
import { createSign } from './world/sign.js';
import { createCircuitTexture } from './world/textures.js';
import { createSwarm } from './bugs/swarm.js';
import { createFlyers } from './bugs/flyers.js';
import { HeroBug } from './bugs/hero.js';
import { createEmbers, createBeacons, createShockwave } from './fx/fx.js';
import { createDirector } from './film/director.js';
import { createHud } from './film/hud.js';
import { createAudio, renderSoundtrack } from './film/audio.js';

// Options come from the query string, or from data-* attributes on <html>
// (handy when the file is opened from disk or embedded).
const params = new URLSearchParams(location.search);
for (const [k, v] of Object.entries(document.documentElement.dataset)) {
  if (k !== 'layout' && !params.has(k)) params.set(k, v);
}
const stage = document.getElementById('stage');
const canvas = document.getElementById('view');

// ---------------------------------------------------------------------------
// Renderer + quality tier
// ---------------------------------------------------------------------------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
} catch (err) {
  // no WebGL 2: say so instead of leaving a black box
  const note = document.createElement('p');
  note.className = 'no-webgl';
  note.textContent = 'This film needs WebGL 2, which is not available in this browser.';
  stage.appendChild(note);
  throw err;
}
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.info.autoReset = false;

function detectQuality() {
  const forced = params.get('quality');
  if (forced && QUALITY[forced]) return forced;
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) return 'potato';
  if (/Mali|Adreno|PowerVR|Apple GPU|Intel(?!.*Arc)/i.test(gpu)) return 'low';
  if (/Radeon\(TM\) (Graphics|\d{3}M)|Radeon Graphics|Iris|UHD/i.test(gpu)) return 'medium';
  return 'high';
}
const qualityName = detectQuality();
const quality = QUALITY[qualityName];

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
const U = {
  uTime: { value: 0 },
  uMoonDir: { value: MOON_DIR.clone() },
  uCorruption: { value: 0 },
  uFlash: { value: 0 },
  uFogColor: { value: FOG_COLOR.clone() },
  uFogDensity: { value: FOG_DENSITY },
  uSignCol: { value: new THREE.Color(0, 0, 0) },
  uPower: { value: 1 },
};

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG_COLOR.clone(), FOG_DENSITY);
const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 4000);

scene.add(createSky(U));
scene.environment = createEnvironment(renderer, U);
scene.environmentIntensity = 0.6;

const building = createBuilding(U);
const ground = createGround(U, quality, renderer);
const props = createProps(ground);
const city = createCity(U);
const sign = createSign(U);
scene.add(building.group, ground.mesh, props.group, city.group, sign.group);

const swarm = createSwarm(U, quality, { extraBoxes: props.carBoxes });
swarm.infection.forEach((data, i) => building.setInfection(i, data));
const infectionTimes = Float32Array.from(swarm.infection.flatMap((a) => Array.from(a))).sort();
swarm.setCamera(camera);
const flyers = createFlyers(U, quality);
const embers = createEmbers(U, quality, swarm.infection);
const beacons = createBeacons(U);
const shock = createShockwave();
scene.add(swarm.mesh, swarm.glow, flyers.mesh, flyers.glow, embers.mesh, beacons.group, shock.mesh);

// ---- the two characters ---------------------------------------------------
const GREEN = new THREE.Color(0.25, 1.0, 0.3);
const RED = new THREE.Color(1.0, 0.012, 0.004);

/** Patient zero: walks along the top of the stone sign, stops, wakes up. */
const zero = new HeroBug({ size: 0.56, circuit: createCircuitTexture(3), glow: GREEN, label: 'BUG-0x01' });
zero.surface = (u, v, lift, P, N) => {
  P.set(MONUMENT.x0 + v, MONUMENT.h + lift, 54 + u);
  N.set(0, 1, 0);
};
const zeroS = (t) =>
  keys(t, [[6.9, 0.8], [10.5, 5.6], [17, 5.6], [19.5, 7.8]], (u) => 1 - (1 - u) * (1 - u));

/** The queen: up the back of the tower, across the roof, to the front edge. */
const queen = new HeroBug({ size: 28, circuit: createCircuitTexture(8), glow: GREEN, label: 'QUEEN', stride: 0.5 });
const QH = TOWER.h;
const QD = TOWER.z1 - TOWER.z0;
queen.surface = (u, v, lift, P, N) => {
  const x = -4 - u;
  if (v < 0) {
    P.set(x, lift, TOWER.z0 + v);
    N.set(0, 1, 0);
  } else if (v < QH) {
    P.set(x, v, TOWER.z0 - lift);
    N.set(0, 0, -1);
  } else if (v < QH + QD) {
    P.set(x, QH + lift, TOWER.z0 + (v - QH));
    N.set(0, 1, 0);
  } else {
    P.set(x, QH - (v - QH - QD), TOWER.z1 + lift);
    N.set(0, 0, 1);
  }
};
const QUEEN_START = -46;
// ends with her thorax over the front edge and her front feet on the facade
const queenV = (t) => keys(t, [[39, QUEEN_START], [44, -3], [50.4, 50], [56.4, 73.2]]);
queen.path.v0 = QUEEN_START;
const queenLight = new THREE.PointLight(0x4dff6a, 0, 130, 2);
scene.add(zero.root, queen.root, queenLight);

// ---- lights -----------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0x2a3b66, 0x0a0806, 0.9));
const moon = new THREE.DirectionalLight(0x9fb6ff, 1.25);
moon.position.copy(MOON_DIR).multiplyScalar(200);
scene.add(moon);
const glowWarm = new THREE.Color(1.0, 0.82, 0.6);
const glowSick = new THREE.Color(0.18, 1.0, 0.3);
const glowLights = [
  [-4, 13, 30, 520],
  [37, 8, 26, 260],
].map(([x, y, z, power]) => {
  const l = new THREE.PointLight(0xffffff, power, 95, 2);
  l.position.set(x, y, z);
  l.userData.power = power;
  scene.add(l);
  return l;
});

// ---------------------------------------------------------------------------
// Film machinery
// ---------------------------------------------------------------------------
const post = createPost(renderer, scene, camera, quality);
const director = createDirector(camera);
const audio = createAudio();

const controls = new OrbitControls(camera, canvas);
controls.enabled = false;
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 0.8;
controls.maxDistance = 280;
controls.maxPolarAngle = 2.0;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.4;
controls.target.set(-4, 26, 4);

// When the film sits inside a scrolling page it must not swallow the page's
// scroll: wheel-zoom only applies to the standalone page or in fullscreen, and
// vertical swipes pass through until the viewer takes the camera.
const embedded = document.documentElement.dataset.layout === 'embed';
const syncInput = () => {
  const immersive = !embedded || !!document.fullscreenElement;
  controls.enableZoom = immersive;
  canvas.style.touchAction = immersive || controls.enabled ? 'none' : 'pan-y';
};
document.addEventListener('fullscreenchange', syncInput);
syncInput();

const state = {
  time: Number(params.get('t') ?? 0),
  dt: 0,
  corruption: 0,
  alarm: 0,
  power: 1,
  flash: 0,
  glitch: 0,
  aberration: 0,
  scan: 0,
  exposure: 1,
  fade: 1,
  titleCard: 0,
  cinematic: true,
  pulseK: -1,
};
let playing = !params.has('pause');
let freeCam = params.has('free');
let userTouched = false;
let wasCinematic = true;

controls.addEventListener('start', () => {
  userTouched = true;
  controls.autoRotate = false;
});

const hud = createHud(stage, {
  replay: () => seek(0),
  pause: () => setPlaying(!playing),
  free: () => setFree(!freeCam),
  sound: () => hud.setSound(audio.toggle()),
  full: () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else stage.requestFullscreen?.().catch(() => {});
  },
  seek: (t) => seek(t),
});
if (params.get('hud') === '0') hud.setVisible(false);
hud.setFree(freeCam);
hud.setPaused(!playing);

function seek(t) {
  state.time = clamp(t, 0, BEAT.loop + 600);
  if (t < BEAT.free) {
    userTouched = false;
    controls.autoRotate = true;
    if (freeCam && !params.has('free')) setFree(false);
  }
  audio.resync();
}
function setPlaying(on) {
  playing = on;
  hud.setPaused(!on);
}
function setFree(on) {
  freeCam = on;
  hud.setFree(on);
  if (on) userTouched = true;
}

// Keyboard shortcuts. They must never get in the way of the host page: no
// modifier combos, nothing while typing, and - when embedded - only while the
// pointer or focus is on the film.
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (embedded && !stage.matches(':hover') && !stage.contains(document.activeElement)) return;
  const key = e.key.toLowerCase();
  if (key === ' ') setPlaying(!playing);
  else if (key === 'r') seek(0);
  else if (key === 'f') setFree(!freeCam);
  else if (key === 'm') hud.setSound(audio.toggle());
  else if (key === 'h') hud.setVisible(hud.root.style.display === 'none');
  else if (key === 'arrowright') seek(state.time + 5);
  else if (key === 'arrowleft') seek(state.time - 5);
  else return;
  e.preventDefault();
});

// ---------------------------------------------------------------------------
// Sizing + adaptive resolution
// ---------------------------------------------------------------------------
let pixelRatio = 1;
let viewH = 720;
let dynScale = 1; // multiplies the resolution when frames run long
let swarmFraction = 1; // and, as a last resort, the swarm is thinned

function resize() {
  const w = Math.max(2, stage.clientWidth);
  const h = Math.max(2, stage.clientHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  pixelRatio = Math.max(0.3, Math.min(dpr, Math.sqrt(quality.pixels / (w * h))) * dynScale);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  post.setSize(w, h, pixelRatio);
  ground.setSize(w * pixelRatio, h * pixelRatio);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  viewH = h * pixelRatio;
}
new ResizeObserver(resize).observe(stage);
resize();

// Frame intervals lie (a throttled or background tab looks exactly like a slow
// GPU), so load is measured with a GPU timer query where the browser has one.
const gpuTimer = (() => {
  const gl = renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  let active = null;
  let pending = null;
  return {
    available: !!ext,
    get busy() {
      return !!(active || pending);
    },
    begin() {
      if (!ext || active || pending) return;
      active = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
    },
    end() {
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending = active;
      active = null;
    },
    /** Returns the GPU time of a finished frame in ms, or null if none is ready. */
    poll() {
      if (!pending || !gl.getQueryParameter(pending, gl.QUERY_RESULT_AVAILABLE)) return null;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const ms = gl.getQueryParameter(pending, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(pending);
      pending = null;
      return disjoint ? null : ms;
    },
  };
})();

const perf = { avg: 10, gpu: gpuTimer.available, slow: 0, fast: 0, cooldown: 90 };
function adapt(dt) {
  if (params.has('fixed')) return;
  let ms = gpuTimer.poll();
  if (!gpuTimer.available) {
    // fallback: trust the frame interval only when it looks like real rendering
    ms = dt > 0.012 && dt < 0.07 ? dt * 1000 * 0.75 : null;
  }
  if (ms === null) return;
  perf.avg = lerp(perf.avg, ms, 0.1);
  if (perf.cooldown-- > 0) return;
  perf.slow = perf.avg > 14 ? perf.slow + 1 : 0;
  perf.fast = perf.avg < 7.5 ? perf.fast + 1 : 0;
  if (perf.slow > 25 && dynScale > 0.5) {
    dynScale = Math.max(0.5, dynScale * 0.87);
    perf.slow = 0;
    perf.cooldown = 45;
    resize();
  } else if (perf.slow > 25 && swarmFraction > 0.4) {
    swarmFraction = Math.max(0.4, swarmFraction * 0.75);
    swarm.setFraction(swarmFraction);
    flyers.setFraction(swarmFraction);
    perf.slow = 0;
    perf.cooldown = 45;
  } else if (perf.fast > 240 && dynScale < 1) {
    dynScale = Math.min(1, dynScale * 1.1);
    perf.fast = 0;
    perf.cooldown = 90;
    resize();
  }
}

// ---------------------------------------------------------------------------
// Per-frame update: everything below is derived from state.time
// ---------------------------------------------------------------------------
const ctx = { zero: new THREE.Vector3(), head: queen.headWorld, stomp: 0 };
const tmpColor = new THREE.Color();
const eyeColor = new THREE.Color();
const fogSick = new THREE.Color(0.022, 0.05, 0.036);

function update(dt) {
  const t = state.time;
  state.dt = dt;
  state.corruption = countBelow(infectionTimes, t) / infectionTimes.length;
  director.curves(state);
  if (userTouched || freeCam) state.fade = smoothstep(0, 1.6, t);

  U.uTime.value = t;
  U.uCorruption.value = state.corruption;
  U.uPower.value = state.power;
  U.uFlash.value = state.flash;
  tmpColor.copy(FOG_COLOR).lerp(fogSick, state.corruption * 0.8);
  U.uFogColor.value.copy(tmpColor);
  scene.fog.color.copy(tmpColor);

  // patient zero
  const zs = zeroS(t);
  const woke = t >= BEAT.eyesRed;
  eyeColor.copy(woke ? RED : GREEN);
  zero.setEyes(eyeColor, (woke ? 1.8 : 1.5) + 4 * hit(t, BEAT.eyesRed, 0.2));
  zero.update(t, zs, {
    twitch: pulse(t, 10.45, 11.5, 0.15, 0.4),
    open: 0.8 * pulse(t, BEAT.eyesRed, 11.9, 0.1, 0.4),
  });
  ctx.zero.copy(zero.body.position);
  ctx.zero.y += 0.1;

  // the queen
  const qv = queenV(t);
  const qSpeed = Math.abs(queenV(t + 0.05) - queenV(t - 0.05)) / 0.1;
  const rear = pulse(t, 57.6, 61.0, 0.6, 1.5);
  queen.root.visible = t > 38.8;
  queen.update(t, qv - QUEEN_START, {
    pitch: -0.2 * smoothstep(56.4, 57.6, t) * (1 - rear),
    rear,
    open: clamp(pulse(t, 58.0, 60.6, 0.2, 0.9) + 0.15 * smoothstep(56, 57, t)),
    twitch: hit(t, BEAT.screech, 0.6),
    speed: qSpeed,
  });
  queen.setEyes(RED, 1.7 + 4 * hit(t, BEAT.screech, 0.7));
  queen.shell.emissiveIntensity = 1.5 + 2.5 * hit(t, BEAT.screech, 0.8) + 0.4 * Math.sin(t * 3);
  ctx.stomp = queen.root.visible ? queen.stomp : 0;
  queenLight.position.copy(queen.headWorld);
  queenLight.intensity = queen.root.visible ? 2600 + 9000 * hit(t, BEAT.screech, 0.5) : 0;

  shock.update(queen.headWorld, state.pulseK);

  // building glow spilling onto the plaza
  tmpColor.copy(glowWarm).lerp(glowSick, state.corruption);
  for (const l of glowLights) {
    l.color.copy(tmpColor);
    l.intensity = l.userData.power * state.power * (1 - 0.3 * state.corruption);
  }

  sign.update(state); // first: the ground copies the sign's colour for its spill light
  building.update(state);
  ground.update(state);
  props.update(state);
  beacons.update(state);

  // camera
  const cinematic = t < BEAT.free && !freeCam;
  if (cinematic) {
    const rig = director.pose(state, ctx);
    post.scenePass.setFocus(rig.focus, rig.dof);
    if (controls.enabled) {
      controls.enabled = false;
      syncInput();
    }
  } else {
    if (wasCinematic) {
      // the last cut of the film: to a slow orbit the viewer can take over
      if (t >= BEAT.free) {
        camera.position.set(-40, 31, 97);
        controls.target.set(-4, 26, 4);
      } else {
        // taken over mid-shot: keep looking where the shot was looking
        controls.target.copy(director.rig.tgt);
      }
      camera.near = 0.5;
      camera.fov = 42;
      camera.updateProjectionMatrix();
    }
    if (!controls.enabled) {
      controls.enabled = true;
      syncInput();
    }
    controls.update(dt > 0 ? dt : undefined);
    if (camera.position.y < 1.3) {
      camera.position.y = 1.3; // never dip below the plaza
      camera.lookAt(controls.target);
    }
    post.scenePass.setFocus(20, 0);
  }
  wasCinematic = cinematic;
  state.cinematic = cinematic;

  swarm.setViewport(viewH, camera.fov);
  flyers.setViewport(viewH, camera.fov);
  sign.setViewport(viewH, camera.fov);

  const f = post.final.uniforms;
  f.uTime.value = t;
  f.uGlitch.value = state.glitch;
  f.uAberration.value = state.aberration;
  f.uScan.value = state.scan;
  f.uFade.value = state.fade;
  f.uExposure.value = state.exposure;
  post.bloom.strength = 0.38 + 0.4 * hit(t, BEAT.screech, 0.5);

  // the console only "sees" patient zero until the first manhole blows
  const seen = countBelow(swarm.spawnTimes, t) + Math.round(flyers.count * smoothstep(19, 50, t));
  const bugs = t < 8.6 ? 0 : Math.round(lerp(1, Math.max(1, seen), smoothstep(BEAT.manhole, BEAT.manhole + 3.5, t)));
  hud.update(state, { bugs });
  audio.update(state, playing, ctx);
}

let benchmarking = false;
function render() {
  renderer.info.reset();
  if (!benchmarking) gpuTimer.begin();
  post.render();
  if (!benchmarking) gpuTimer.end();
}

let visible = true;
new IntersectionObserver((entries) => (visible = entries[0].isIntersecting), { threshold: 0.01 }).observe(stage);

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!visible) return;
  if (playing) {
    state.time += dt;
    if (state.time >= BEAT.loop && !userTouched && !freeCam) seek(0);
    adapt(dt);
  }
  update(playing ? dt : 0);
  render();
});

// Debug hooks used while developing (seek, camera placement, GPU benchmark) and
// by scripts/render-mp4.mjs, which steps the film frame by frame.
// Available on the dev server, or anywhere with ?debug.
if (import.meta.env.DEV || params.has('debug')) window.__bugs = {
  state, renderer, scene, camera, controls, post, quality, qualityName, errors, swarm, director, perf,
  seek,
  play: () => setPlaying(true),
  pause: () => setPlaying(false),
  free: setFree,
  cam(px, py, pz, tx, ty, tz, fov) {
    setFree(true);
    wasCinematic = false;
    camera.position.set(px, py, pz);
    controls.target.set(tx, ty, tz);
    if (fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    controls.autoRotate = false;
    controls.update();
  },
  frame(t) {
    if (t !== undefined) state.time = t;
    update(0);
    render();
  },
  /** Offline render of the soundtrack between two film times; resolves to an AudioBuffer. */
  soundtrack(from = 0, to = BEAT.free, sampleRate = 48000) {
    const keep = state.time;
    const at = (t) => {
      state.time = t;
      update(0);
      return [state, ctx];
    };
    return renderSoundtrack({ from, to, sampleRate, at }).finally(() => {
      state.time = keep;
      update(0);
    });
  },
  /** Average GPU ms per frame over n back-to-back frames starting at time t. */
  async bench(t, n = 12) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    if (t !== undefined) state.time = t;
    for (let i = 0; i < 200 && gpuTimer.busy; i++) {
      gpuTimer.poll();
      await wait(8);
    }
    benchmarking = true;
    for (let i = 0; i < 4; i++) {
      update(0);
      render();
    }
    gpuTimer.begin();
    for (let i = 0; i < n; i++) {
      state.time += 1 / 60;
      update(0);
      render();
    }
    gpuTimer.end();
    benchmarking = false;
    for (let i = 0; i < 400; i++) {
      await wait(8);
      const ms = gpuTimer.poll();
      if (ms !== null) return +(ms / n).toFixed(2);
    }
    return null;
  },
  info() {
    return {
      quality: qualityName,
      pixelRatio,
      dynScale,
      gpuMs: +perf.avg.toFixed(1),
      gpuTimer: gpuTimer.available,
      calls: renderer.info.render.calls,
      tris: renderer.info.render.triangles,
    };
  },
};
console.log(`[bugs] quality=${qualityName}`);
