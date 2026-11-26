import * as THREE from 'three';
import { BEAT, SIGN } from '../config.js';
import { lerp, smoothstep, easeInOut, easeOutCubic, hit, hash1, noise1 } from '../core/util.js';

// The shot list. Each shot is a function of its own normalised time `u` and
// fills in a camera rig (position, look-at, lens, focus). Everything else that
// varies over the film - alarm, power, glitch, lightning - is derived here too,
// so the whole piece is a function of one number: time.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const A = {
  est0: V(-47, 2.2, 134), est1: V(-34, 7.0, 106), estT0: V(-4, 20, 0), estT1: V(-3, 24.5, 0),
  mac0: V(-13.85, 1.74, 55.5), mac1: V(-14.2, 1.82, 55.2), macStop: V(-15.3, 1.68, 54.0),
  rev0: V(-16.9, 2.02, 52.5), rev1: V(-17.4, 2.3, 51.9), revT0: V(-12.8, 1.3, 61), revT1: V(-10.4, 0.7, 68),
  rid0: V(13, 10.5, 121), rid1: V(5, 5.2, 52), ridT0: V(-3, 1.5, 78), ridT1: V(-4, 6.5, 16),
  flo0: V(54, 40, 100), flo1: V(36, 25, 84), floT0: V(-5, 4, 34), floT1: V(-4, 15, 18),
  dro0: V(52, 66, 60), dro1: V(36, 61, 66), droT0: V(-2, 47, -6), droT1: V(-4, 50, 6),
  her0: V(-14, 1.5, 86), her1: V(-9, 2.3, 73), herT0: V(-4, 35, 14), herT1: V(-4, 41, 14),
};

export const SHOTS = [
  {
    name: 'establish', t0: 0, t1: BEAT.macro, near: 0.5,
    cam(u, t, ctx, r) {
      const e = easeInOut(u);
      r.pos.lerpVectors(A.est0, A.est1, e);
      r.tgt.lerpVectors(A.estT0, A.estT1, e);
      r.fov = lerp(38, 35, e);
      r.shake = 0.012;
    },
  },
  {
    name: 'macro', t0: BEAT.macro, t1: BEAT.reverse, near: 0.05,
    cam(u, t, ctx, r) {
      const e = easeInOut(u);
      r.pos.lerpVectors(A.mac0, A.mac1, e);
      r.tgt.copy(ctx.zero).lerp(A.macStop, 0.35);
      r.tgt.y = 1.67;
      r.fov = 27;
      r.focus = r.pos.distanceTo(ctx.zero);
      r.dof = 2.6;
      r.shake = 0.003;
    },
  },
  {
    name: 'reverse', t0: BEAT.reverse, t1: BEAT.flood, near: 0.05,
    cam(u, t, ctx, r) {
      const e = easeInOut(u);
      r.pos.lerpVectors(A.rev0, A.rev1, e);
      r.tgt.lerpVectors(A.revT0, A.revT1, e);
      r.fov = 37;
      // rack focus from the bug in the foreground to the street
      const pull = smoothstep(0.08, 0.3, u);
      r.focus = lerp(r.pos.distanceTo(ctx.zero), 17.5, pull);
      r.dof = lerp(2.4, 1.5, pull);
      r.shake = 0.006 + 0.05 * hit(t, BEAT.manhole, 0.25);
    },
  },
  {
    // skimming over the plaza at the swarm's own speed
    name: 'ride', t0: BEAT.flood, t1: BEAT.crane, near: 0.2,
    cam(u, t, ctx, r) {
      const e = u * u * (3 - 2 * u) * 0.6 + u * 0.4;
      r.pos.lerpVectors(A.rid0, A.rid1, e);
      r.tgt.lerpVectors(A.ridT0, A.ridT1, easeInOut(u));
      r.fov = lerp(52, 46, u);
      r.shake = 0.07;
    },
  },
  {
    name: 'flood', t0: BEAT.crane, t1: BEAT.climb, near: 0.5,
    cam(u, t, ctx, r) {
      const e = easeInOut(u);
      r.pos.lerpVectors(A.flo0, A.flo1, e);
      r.tgt.lerpVectors(A.floT0, A.floT1, e);
      r.fov = lerp(40, 37, e);
      r.shake = 0.03;
    },
  },
  {
    name: 'climb', t0: BEAT.climb, t1: BEAT.sign, near: 0.3,
    cam(u, t, ctx, r) {
      const e = easeInOut(u);
      r.pos.set(lerp(-27, -15, e), lerp(6.5, 36, e), lerp(31, 27.5, e));
      r.tgt.set(r.pos.x + 10, r.pos.y + lerp(8, 5.5, e), 16.3);
      r.fov = 46;
      r.shake = 0.03;
    },
  },
  {
    name: 'sign', t0: BEAT.sign, t1: BEAT.drone, near: 0.3,
    cam(u, t, ctx, r) {
      const e = easeInOut(u);
      const a = lerp(0.52, -0.6, e);
      const R = lerp(31, 25, e);
      r.pos.set(SIGN.x + Math.sin(a) * R, lerp(44.5, 40.2, e), SIGN.z + Math.cos(a) * R);
      r.tgt.set(SIGN.x, SIGN.y + 2.3, SIGN.z);
      r.fov = 38;
      r.shake = 0.03 + 0.12 * hit(t, BEAT.signOops, 0.3);
    },
  },
  {
    name: 'drone', t0: BEAT.drone, t1: BEAT.hero, near: 0.5,
    cam(u, t, ctx, r) {
      const e = easeInOut(u);
      r.pos.lerpVectors(A.dro0, A.dro1, e);
      r.tgt.lerpVectors(A.droT0, A.droT1, e);
      r.fov = 40;
      r.shake = 0.04 + 0.3 * ctx.stomp;
    },
  },
  {
    name: 'hero', t0: BEAT.hero, t1: BEAT.free, near: 0.3,
    cam(u, t, ctx, r) {
      const e = easeOutCubic(u);
      r.pos.lerpVectors(A.her0, A.her1, e);
      r.tgt.lerpVectors(A.herT0, A.herT1, e);
      r.tgt.lerp(ctx.head, 0.42); // tilt up with her when she rears
      r.fov = lerp(50, 46, e);
      r.shake = 0.02 + 0.2 * ctx.stomp + 0.9 * hit(t, BEAT.screech, 0.7);
    },
  },
];

export const CUTS = [...SHOTS.slice(1).map((s) => s.t0), BEAT.free];

export function createDirector(camera) {
  const rig = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 40, focus: 10, dof: 0, shake: 0 };
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const calm = reduceMotion ? 0.3 : 1;

  return {
    rig,
    shotAt(t) {
      for (let i = SHOTS.length - 1; i >= 0; i--) if (t >= SHOTS[i].t0) return SHOTS[i];
      return SHOTS[0];
    },

    /** Film-wide parameters, all pure functions of time. */
    curves(state) {
      const t = state.time;
      const k = t - BEAT.screech;
      state.alarm = smoothstep(BEAT.alarm, BEAT.alarm + 0.7, t);
      state.power = k > 0.05 && k < 0.75 ? 0.04 : 1;
      state.flash =
        hit(t, BEAT.screech, 0.55) + 0.45 * hit(t, BEAT.signOops, 0.25) +
        (k > 2.5 ? Math.max(0, noise1(t * 1.7, 5) - 0.62) * 2.2 : 0);

      let g = 0;
      for (const c of CUTS) g = Math.max(g, 0.6 * Math.max(0, 1 - Math.abs(t - c) / 0.1));
      g = Math.max(g, 0.5 * hit(t, BEAT.eyesRed, 0.14));
      g = Math.max(g, 0.3 * hit(t, BEAT.manhole, 0.12));
      if (t > BEAT.signGlitch && t < BEAT.signOops) g = Math.max(g, 0.03 + (hash1(Math.floor(t * 7)) > 0.8 ? 0.16 : 0));
      g = Math.max(g, 0.6 * hit(t, BEAT.signOops, 0.22));
      g = Math.max(g, 1.0 * hit(t, BEAT.screech, 0.8));
      // background unease once the building starts to go
      if (hash1(Math.floor(t * 3.1) + 0.5) > 0.9) g = Math.max(g, 0.22 * state.corruption);
      state.glitch = g * calm;

      state.aberration = 0.0014 + 0.0018 * state.corruption + 0.012 * hit(t, BEAT.screech, 0.9) * calm;
      state.scan = 0.3 * smoothstep(44, 60, t);
      state.exposure = 1 + 0.5 * hit(t, BEAT.screech, 0.35) * calm;
      state.fade = smoothstep(0, 1.6, t) * (1 - smoothstep(BEAT.loop - 1.4, BEAT.loop - 0.1, t));
      state.titleCard = smoothstep(BEAT.title, BEAT.title + 0.35, t) * (1 - smoothstep(BEAT.free - 0.6, BEAT.free, t));
      state.cinematic = t < BEAT.free;
      // the pulse spreads out across the ground
      state.pulseK = k;
    },

    /** Poses the camera for time t. Returns the rig so the caller can set focus. */
    pose(state, ctx) {
      const t = Math.min(state.time, BEAT.free - 1e-3);
      const shot = this.shotAt(t);
      const u = (t - shot.t0) / (shot.t1 - shot.t0);
      rig.dof = 0;
      rig.focus = 20;
      rig.shake = 0;
      shot.cam(u, t, ctx, rig);
      const s = rig.shake * calm;
      if (s > 0) {
        rig.pos.x += noise1(t * 7.1, 1) * s;
        rig.pos.y += noise1(t * 8.3, 2) * s;
        rig.pos.z += noise1(t * 6.7, 3) * s * 0.6;
        const d = rig.pos.distanceTo(rig.tgt) * 0.012 * s * 6;
        rig.tgt.x += noise1(t * 9.1, 4) * d;
        rig.tgt.y += noise1(t * 10.3, 5) * d;
      }
      camera.position.copy(rig.pos);
      camera.lookAt(rig.tgt);
      if (camera.fov !== rig.fov || camera.near !== shot.near) {
        camera.fov = rig.fov;
        camera.near = shot.near;
        camera.updateProjectionMatrix();
      }
      return rig;
    },
  };
}
