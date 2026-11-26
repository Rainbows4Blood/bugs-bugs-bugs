import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from '../core/util.js';
import { createEyeTexture } from '../world/textures.js';

let eyeTexture = null;

// A fully articulated bug for the two characters that get close-ups: patient
// zero (half a metre long) and the queen (twenty-two metres). The body rides a
// path over an arbitrary surface; the six legs are solved with two-bone IK
// against footholds that are a pure function of distance travelled, so feet
// stay planted while the body moves over them and the whole thing can still be
// evaluated at any time without simulating.

const Y = new THREE.Vector3(0, 1, 0);
const HIP = [
  [0.19, 0.2, 0.27],
  [0.205, 0.2, 0.14],
  [0.19, 0.2, 0.01],
];
const REST = [
  [0.4, 0.42],
  [0.46, 0.06],
  [0.4, -0.3],
];
const L1 = 0.27;
const L2 = 0.35;
const DROP = -0.06; // the body rides low, close to the surface
const DUTY = 0.62; // fraction of the step cycle a foot spends on the ground

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const n1 = new THREE.Vector3();
const n2 = new THREE.Vector3();
const m4 = new THREE.Matrix4();

function chipLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#16181d';
  g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#7c838f';
  g.font = '700 30px Consolas, "Cascadia Mono", monospace';
  g.textAlign = 'center';
  g.fillText(text, 128, 88);
  g.font = '600 17px Consolas, "Cascadia Mono", monospace';
  g.fillStyle = '#596070';
  g.fillText('MADE IN PROD', 128, 122);
  g.fillText('REV 404', 128, 146);
  g.beginPath();
  g.arc(30, 32, 9, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class HeroBug {
  /**
   * @param {object} o
   * @param {number} o.size      body length in metres
   * @param {THREE.Texture} o.circuit  emissive trace texture for the shell
   * @param {THREE.Color} o.glow
   * @param {string} o.label     text printed on the thorax chip
   */
  constructor({ size, circuit, glow, label = 'BUG-0x01', stride = 0.5 }) {
    this.size = size;
    this.stride = stride;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.body.scale.setScalar(size);
    this.root.add(this.body);
    // all body parts hang in an inner group so ride height is one number
    this.torso = new THREE.Group();
    this.torso.position.y = DROP - 0.03;
    this.torso.scale.setScalar(1.22);
    this.body.add(this.torso);
    this.path = { u0: 0, v0: 0, du: 0, dv: 1 };
    this.surface = null;
    this.stomp = 0;
    this.headWorld = new THREE.Vector3();

    const shell = new THREE.MeshPhysicalMaterial({
      color: 0x06080e,
      roughness: 0.24,
      metalness: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0.14,
      emissive: glow.clone(),
      emissiveMap: circuit,
      emissiveIntensity: 1.6,
    });
    const hide = new THREE.MeshPhysicalMaterial({ color: 0x07090f, roughness: 0.28, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.2 });
    const chip = new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.55, metalness: 0.2 });
    const chipTop = new THREE.MeshStandardMaterial({ map: chipLabel(label), roughness: 0.5, metalness: 0.2 });
    const pin = new THREE.MeshStandardMaterial({ color: 0xbfc4cc, roughness: 0.22, metalness: 1 });
    const limb = new THREE.MeshStandardMaterial({ color: 0x090a0f, roughness: 0.33, metalness: 0.65 });
    this.shell = shell;
    eyeTexture ??= createEyeTexture();
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: eyeTexture });

    // abdomen: long axis along Z, tapering to the rear, circuit seam along the top
    {
      const g = new THREE.SphereGeometry(1, 44, 26);
      g.rotateX(Math.PI / 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i);
        const k = 1 - 0.26 * clamp(-z) * clamp(-z);
        const y = p.getY(i);
        p.setXYZ(i, p.getX(i) * k, (y < 0 ? y * 0.6 : y) * k, z);
      }
      g.computeVertexNormals();
      circuit.offset.set(0.75, 0);
      circuit.repeat.set(1, 1);
      const m = new THREE.Mesh(g, shell);
      m.scale.set(0.205, 0.13, 0.335);
      m.position.set(0, 0.285, -0.2);
      this.torso.add(m);
      this.abdomen = m;
    }
    // thorax: an IC package, pins and all
    {
      const m = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.1, 0.25, 3, 0.03), [chip, chip, chipTop, chip, chip, chip]);
      m.position.set(0, 0.268, 0.15);
      this.torso.add(m);
      const pins = [];
      for (const s of [-1, 1]) {
        for (let k = 0; k < 7; k++) {
          const g = new THREE.BoxGeometry(0.034, 0.012, 0.017);
          g.translate(s * 0.183, 0.252, 0.06 + k * 0.03);
          pins.push(g);
        }
      }
      this.torso.add(new THREE.Mesh(mergeGeometries(pins), pin));
      // neck and waist
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.08, 14), limb);
      neck.rotation.x = Math.PI / 2;
      neck.position.set(0, 0.258, 0.285);
      const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.09, 14), limb);
      waist.rotation.x = Math.PI / 2;
      waist.position.set(0, 0.268, 0.03);
      this.torso.add(neck, waist);
    }
    // head
    this.head = new THREE.Group();
    this.head.position.set(0, 0.252, 0.3);
    this.torso.add(this.head);
    {
      const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 30, 20), hide);
      skull.scale.set(0.105, 0.076, 0.096);
      skull.position.set(0, 0, 0.04);
      this.head.add(skull);
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.044, 22, 16), this.eyeMat);
        eye.position.set(s * 0.068, 0.03, 0.092);
        this.head.add(eye);
      }
      // mandibles
      const mg = new THREE.ConeGeometry(0.017, 0.12, 10);
      mg.rotateX(Math.PI / 2);
      mg.translate(0, 0, 0.06);
      this.mandibles = [-1, 1].map((s) => {
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.034, -0.03, 0.115);
        pivot.add(new THREE.Mesh(mg, limb));
        this.head.add(pivot);
        return { pivot, s };
      });
      // antennae: two joints each
      const a1 = new THREE.CylinderGeometry(0.0055, 0.008, 0.3, 8);
      a1.rotateX(Math.PI / 2);
      a1.translate(0, 0, 0.15);
      const a2 = new THREE.CylinderGeometry(0.002, 0.0055, 0.38, 8);
      a2.rotateX(Math.PI / 2);
      a2.translate(0, 0, 0.19);
      this.antennae = [-1, 1].map((s) => {
        const base = new THREE.Group();
        base.position.set(s * 0.046, 0.052, 0.095);
        const mid = new THREE.Group();
        mid.position.set(0, 0, 0.3);
        mid.add(new THREE.Mesh(a2, limb));
        base.add(new THREE.Mesh(a1, limb), mid);
        this.head.add(base);
        return { base, mid, s };
      });
    }

    // legs (placed in world space every frame)
    const femurGeo = new THREE.CylinderGeometry(0.03, 0.044, 1, 10);
    femurGeo.translate(0, 0.5, 0);
    const tibiaGeo = new THREE.CylinderGeometry(0.008, 0.031, 1, 10);
    tibiaGeo.translate(0, 0.5, 0);
    const jointGeo = new THREE.SphereGeometry(1, 12, 10);
    this.legs = [];
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const leg = {
          side: s,
          hip: new THREE.Vector3(s * HIP[i][0], HIP[i][1], HIP[i][2]),
          restX: s * REST[i][0],
          restZ: REST[i][1],
          phase: (s > 0) === (i !== 1) ? 0 : 0.5,
          index: i,
          femur: new THREE.Mesh(femurGeo, limb),
          tibia: new THREE.Mesh(tibiaGeo, limb),
          hipJoint: new THREE.Mesh(jointGeo, limb),
          kneeJoint: new THREE.Mesh(jointGeo, limb),
          foot: new THREE.Vector3(),
        };
        leg.hipJoint.scale.setScalar(0.042 * size);
        leg.kneeJoint.scale.setScalar(0.031 * size);
        this.root.add(leg.femur, leg.tibia, leg.hipJoint, leg.kneeJoint);
        this.legs.push(leg);
      }
    }

    this._pos = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._f = new THREE.Vector3();
  }

  setEyes(color, intensity) {
    this.eyeMat.color.copy(color).multiplyScalar(intensity);
  }

  /** World position and normal of a foothold for step `k` of a leg. */
  _foothold(leg, k, out, outN) {
    const lam = this.stride * this.size;
    const sMid = (k - leg.phase + DUTY / 2) * lam;
    const { u0, v0, du, dv } = this.path;
    const fx = leg.restX * this.size;
    const fz = leg.restZ * this.size;
    const u = u0 + du * (sMid + fz) - dv * fx;
    const v = v0 + dv * (sMid + fz) + du * fx;
    this.surface(u, v, 0, out, outN);
  }

  /**
   * @param {number} time
   * @param {number} s     distance travelled along the path (metres)
   * @param {object} pose  { pitch, rear, open, twitch, speed }
   */
  update(time, s, pose = {}) {
    const size = this.size;
    const { u0, v0, du, dv } = this.path;
    const pitch = pose.pitch ?? 0;
    const rear = pose.rear ?? 0;
    const open = pose.open ?? 0;
    const twitch = pose.twitch ?? 0;

    // ---- body frame: spans two points on the surface ----------------------
    const a = 0.3 * size;
    this.surface(u0 + du * (s + a), v0 + dv * (s + a), 0, v1, n1);
    this.surface(u0 + du * (s - a), v0 + dv * (s - a), 0, v2, n2);
    const f = this._f.subVectors(v1, v2);
    const fl = f.length();
    f.multiplyScalar(1 / fl);
    const up = this._u.addVectors(n1, n2).normalize();
    const cv = Math.max(0, -f.dot(n2));
    const pos = this._pos.addVectors(v1, v2).multiplyScalar(0.5).addScaledVector(up, cv * fl * 0.72);
    up.addScaledVector(f, -up.dot(f)).normalize();
    const right = this._r.crossVectors(up, f);

    // pitch about the hind hips (positive = nose up)
    const ang = pitch + rear * 0.62;
    if (ang !== 0) {
      v3.copy(pos).addScaledVector(f, -0.26 * size);
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      const fx = f.x * c + up.x * sn;
      const fy = f.y * c + up.y * sn;
      const fz = f.z * c + up.z * sn;
      up.set(up.x * c - f.x * sn, up.y * c - f.y * sn, up.z * c - f.z * sn);
      f.set(fx, fy, fz);
      pos.copy(v3).addScaledVector(f, 0.26 * size);
    }
    // breathing and a little weight shift while walking
    const lam = this.stride * size;
    pos.addScaledVector(up, (0.012 * Math.sin(time * 2.1) + 0.008 * Math.sin((s / lam) * Math.PI * 4)) * size);
    pos.addScaledVector(right, 0.01 * Math.sin((s / lam) * Math.PI * 2) * size);

    m4.makeBasis(right, up, f);
    this.body.quaternion.setFromRotationMatrix(m4);
    this.body.position.copy(pos);

    // ---- head, antennae, mandibles -----------------------------------------
    this.head.rotation.set(
      -0.05 + 0.06 * Math.sin(time * 1.3) - rear * 0.25,
      0.1 * Math.sin(time * 0.9 + 1.0) + twitch * 0.25 * Math.sin(time * 31),
      0,
    );
    for (const an of this.antennae) {
      const w = an.s;
      an.base.rotation.set(
        -0.72 + 0.13 * Math.sin(time * 2.1 + w) - rear * 0.35 + twitch * 0.3 * Math.sin(time * 41 + w),
        w * (0.5 + 0.16 * Math.sin(time * 1.7 + w * 2) + open * 0.35),
        0,
      );
      an.mid.rotation.x = 0.6 + 0.22 * Math.sin(time * 2.9 + w) + twitch * 0.4 * Math.sin(time * 53 + w * 2);
    }
    for (const md of this.mandibles) {
      const chew = 0.08 * Math.sin(time * 6.5) + twitch * 0.2 * Math.sin(time * 38);
      md.pivot.rotation.y = md.s * (-0.3 + chew + open * 0.75);
    }
    this.headWorld.copy(pos).addScaledVector(f, 0.42 * size).addScaledVector(up, 0.2 * size);

    // ---- legs ----------------------------------------------------------------
    const l1 = L1 * size;
    const l2 = L2 * size;
    let stomp = 0;
    for (const leg of this.legs) {
      // gait: planted for DUTY of the cycle, then swung to the next foothold
      const c = s / lam + leg.phase;
      const k = Math.floor(c);
      const ph = c - k;
      const foot = leg.foot;
      if (ph < DUTY) {
        this._foothold(leg, k, foot, n1);
        stomp = Math.max(stomp, 1 - ph / 0.2);
      } else {
        const t = (ph - DUTY) / (1 - DUTY);
        this._foothold(leg, k, v1, n1);
        this._foothold(leg, k + 1, v2, n2);
        foot.lerpVectors(v1, v2, t * t * (3 - 2 * t));
        n1.add(n2).normalize();
        foot.addScaledVector(n1, Math.sin(Math.PI * t) * 0.12 * size);
      }
      // hip in world space
      const hip = v1.copy(pos)
        .addScaledVector(right, leg.hip.x * size)
        .addScaledVector(up, leg.hip.y * size)
        .addScaledVector(f, leg.hip.z * size);
      // threat display: front legs come off the ground and paw the air
      if (rear > 0 && leg.index === 0) {
        v2.copy(hip)
          .addScaledVector(right, leg.side * 0.4 * size)
          .addScaledVector(f, (0.46 + 0.05 * Math.sin(time * 5.3 + leg.side)) * size)
          .addScaledVector(up, (0.2 + 0.07 * Math.sin(time * 6.1 + leg.side * 2)) * size);
        foot.lerp(v2, rear);
      }
      // two-bone IK, knee pushed up and outwards
      const dir = v2.subVectors(foot, hip);
      const d = clamp(dir.length(), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
      dir.normalize();
      const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(l1 * l1 - along * along, 0));
      const pole = v3.copy(up).multiplyScalar(0.8).addScaledVector(right, leg.side * 0.62);
      pole.addScaledVector(dir, -pole.dot(dir)).normalize();
      const knee = n2.copy(hip).addScaledVector(dir, along).addScaledVector(pole, h);
      const tip = n1.copy(hip).addScaledVector(dir, d);

      leg.hipJoint.position.copy(hip);
      leg.kneeJoint.position.copy(knee);
      // femur: hip -> knee
      v3.subVectors(knee, hip);
      let len = v3.length();
      leg.femur.position.copy(hip);
      leg.femur.quaternion.setFromUnitVectors(Y, v3.multiplyScalar(1 / len));
      leg.femur.scale.set(size, len, size);
      // tibia: knee -> foot
      v3.subVectors(tip, knee);
      len = v3.length();
      leg.tibia.position.copy(knee);
      leg.tibia.quaternion.setFromUnitVectors(Y, v3.multiplyScalar(1 / len));
      leg.tibia.scale.set(size, len, size);
    }
    this.stomp = clamp(stomp) * clamp((pose.speed ?? 0) / 2);
  }
}
