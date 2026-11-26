import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAMPS, TREES, MONUMENT, MANHOLES, CARS, BEAT, ENTRANCE_X } from '../config.js';
import { mulberry32, hash1, smoothstep } from '../core/util.js';
import { glyphGeometry, advance, CAP_HEIGHT } from '../core/font.js';

// Everything that dresses the plaza: light columns, trees, the stone sign,
// manhole covers, bollards and a few parked cars.

function lampLevel(i, t) {
  if (t > BEAT.screech) {
    const k = t - BEAT.screech;
    if (k < 0.9) return 0.02;
    return 0.22 + (hash1(i * 7.7 + Math.floor(t * 9)) > 0.4 ? 0.22 : 0);
  }
  const trouble = smoothstep(17, 34, t);
  return hash1(i * 13.1 + Math.floor(t * 11)) < trouble * 0.42 ? 0.12 : 1;
}

export function createProps(ground) {
  const group = new THREE.Group();
  group.name = 'props';
  const rnd = mulberry32(42);
  const metal = new THREE.MeshStandardMaterial({ color: 0x101115, roughness: 0.45, metalness: 0.8 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.55, metalness: 0.05 });

  // ---- light columns ------------------------------------------------------
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 6.2, 10);
  poleGeo.translate(0, 3.1, 0);
  const barGeo = new THREE.CylinderGeometry(0.15, 0.15, 1.3, 14);
  barGeo.translate(0, 6.85, 0);
  const capGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.08, 14);
  capGeo.translate(0, 7.54, 0);
  const lamps = LAMPS.map(([x, z], i) => {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(poleGeo, metal), new THREE.Mesh(barGeo, mat), new THREE.Mesh(capGeo, metal));
    g.position.set(x, 0, z);
    group.add(g);
    let light = null;
    if (i < 6) {
      light = new THREE.PointLight(0xffc98a, 150, 36, 2);
      light.position.set(x, 6.6, z);
      group.add(light);
    }
    return { mat, light };
  });
  const lampWarm = new THREE.Color(1.0, 0.72, 0.42);
  const lampSick = new THREE.Color(0.2, 1.0, 0.3);
  const lampColor = new THREE.Color();

  // ---- trees --------------------------------------------------------------
  {
    const trunks = [];
    const crowns = [];
    const planters = [];
    for (const [x, z] of TREES) {
      const h = 3.0 + rnd() * 1.4;
      const trunk = new THREE.CylinderGeometry(0.13, 0.22, h, 7);
      trunk.translate(x, h / 2 + 0.4, z);
      trunks.push(trunk);
      const blobs = 4 + Math.floor(rnd() * 3);
      for (let k = 0; k < blobs; k++) {
        const r = 1.3 + rnd() * 1.1;
        const blob = new THREE.IcosahedronGeometry(r, 1);
        blob.scale(1, 0.82 + rnd() * 0.3, 1);
        blob.translate(x + (rnd() - 0.5) * 2.4, h + 0.9 + rnd() * 2.2, z + (rnd() - 0.5) * 2.4);
        crowns.push(blob);
      }
      const planter = new THREE.BoxGeometry(3.0, 0.5, 3.0);
      planter.translate(x, 0.25, z);
      planters.push(planter);
    }
    group.add(new THREE.Mesh(mergeGeometries(trunks), new THREE.MeshStandardMaterial({ color: 0x17100b, roughness: 0.95 })));
    group.add(
      new THREE.Mesh(
        mergeGeometries(crowns),
        new THREE.MeshStandardMaterial({ color: 0x0d2114, roughness: 0.9, flatShading: true }),
      ),
    );
    group.add(new THREE.Mesh(mergeGeometries(planters), stone));
  }

  // ---- stone sign at the plaza edge ---------------------------------------
  {
    const w = MONUMENT.x1 - MONUMENT.x0;
    const d = MONUMENT.z1 - MONUMENT.z0;
    const granite = new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 0.5, metalness: 0.1 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, MONUMENT.h, d), granite);
    slab.position.set((MONUMENT.x0 + MONUMENT.x1) / 2, MONUMENT.h / 2, (MONUMENT.z0 + MONUMENT.z1) / 2);
    group.add(slab);
    const text = 'OpenAI';
    const size = 0.66 / CAP_HEIGHT;
    const total = [...text].reduce((s, ch) => s + advance(ch, size), 0);
    const faceMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.1, 1.9) });
    let x = (MONUMENT.x0 + MONUMENT.x1) / 2 - total / 2;
    for (const ch of text) {
      const m = new THREE.Mesh(glyphGeometry(ch, size, 0.05, 0), [faceMat, metal]);
      m.position.set(x, 0.42, MONUMENT.z1 + 0.012);
      group.add(m);
      x += advance(ch, size);
    }
  }

  // ---- manhole covers ------------------------------------------------------
  const coverGeo = new THREE.CylinderGeometry(0.66, 0.66, 0.07, 30);
  const coverMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.5, metalness: 0.85 });
  const ridgeGeo = new THREE.TorusGeometry(0.42, 0.03, 6, 26);
  ridgeGeo.rotateX(Math.PI / 2);
  ridgeGeo.translate(0, 0.04, 0);
  const covers = MANHOLES.map((m, i) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(coverGeo, coverMat), new THREE.Mesh(ridgeGeo, coverMat));
    group.add(g);
    const a = hash1(i * 3.3 + 1) * Math.PI * 2;
    // the first cover is thrown away from the plaza sign so the reverse shot sees it fly
    const angle = i === 0 ? 0.35 : a;
    return { g, m, dx: Math.cos(angle), dz: Math.sin(angle) };
  });
  const holeLights = [0, 1].map((i) => {
    const l = new THREE.PointLight(0x39ff5a, 0, 16, 2);
    l.position.set(MANHOLES[i].x, 0.6, MANHOLES[i].z);
    group.add(l);
    return l;
  });
  const AIR = 1.55;
  const axis = new THREE.Vector3();

  // ---- bollards ------------------------------------------------------------
  const bollardLight = new THREE.MeshBasicMaterial({ color: 0xffffff });
  {
    const xs = [];
    for (let x = -80; x <= 78; x += 4) if (Math.abs(x - ENTRANCE_X) > 6.5) xs.push(x);
    const body = new THREE.CylinderGeometry(0.13, 0.13, 0.85, 10);
    body.translate(0, 0.425, 0);
    const ring = new THREE.CylinderGeometry(0.145, 0.145, 0.07, 10);
    ring.translate(0, 0.74, 0);
    const bodies = new THREE.InstancedMesh(body, metal, xs.length);
    const rings = new THREE.InstancedMesh(ring, bollardLight, xs.length);
    const m4 = new THREE.Matrix4();
    xs.forEach((x, i) => {
      m4.makeTranslation(x, 0, 72.7);
      bodies.setMatrixAt(i, m4);
      rings.setMatrixAt(i, m4);
    });
    group.add(bodies, rings);
  }

  // ---- parked cars ---------------------------------------------------------
  const glass = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.08, metalness: 0.9 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.9 });
  const lowerGeo = new THREE.BoxGeometry(4.5, 0.62, 1.84);
  const cabinGeo = new THREE.BoxGeometry(2.5, 0.56, 1.66);
  {
    const p = cabinGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0) {
        p.setX(i, p.getX(i) * 0.74);
        p.setZ(i, p.getZ(i) * 0.88);
      }
    }
    cabinGeo.computeVertexNormals();
  }
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16);
  wheelGeo.rotateX(Math.PI / 2);
  const lampGeo = new THREE.BoxGeometry(0.06, 0.14, 0.42);
  const hazardGeo = new THREE.BoxGeometry(0.07, 0.1, 0.16);
  const cars = CARS.map((c, i) => {
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.3, metalness: 0.65 });
    const lower = new THREE.Mesh(lowerGeo, paint);
    lower.position.y = 0.6;
    const cabin = new THREE.Mesh(cabinGeo, glass);
    cabin.position.set(-0.15, 1.19, 0);
    g.add(lower, cabin);
    for (const sx of [-1.45, 1.45]) {
      for (const sz of [-0.86, 0.86]) {
        const wheel = new THREE.Mesh(wheelGeo, tyre);
        wheel.position.set(sx, 0.34, sz);
        g.add(wheel);
      }
    }
    const head = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const tail = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const hazard = new THREE.MeshBasicMaterial({ color: 0x000000 });
    for (const sz of [-0.6, 0.6]) {
      const h = new THREE.Mesh(lampGeo, head);
      h.position.set(2.26, 0.68, sz);
      const t = new THREE.Mesh(lampGeo, tail);
      t.position.set(-2.26, 0.72, sz);
      g.add(h, t);
    }
    for (const sx of [-2.26, 2.26]) {
      for (const sz of [-0.86, 0.86]) {
        const hz = new THREE.Mesh(hazardGeo, hazard);
        hz.position.set(sx, 0.52, sz);
        g.add(hz);
      }
    }
    g.position.set(c.x, 0, c.z);
    g.rotation.y = c.dir > 0 ? 0 : Math.PI;
    group.add(g);
    return { head, tail, hazard, alarmAt: 18.5 + i * 1.7 + hash1(i) * 2, rate: 1.5 + hash1(i + 9) * 0.5 };
  });

  return {
    group,
    carBoxes: CARS.map((c) => [c.x - 2.8, c.x + 2.8, c.z - 1.5, c.z + 1.5]),
    update(state) {
      const t = state.time;

      // lamps
      lampColor.copy(lampWarm).lerp(lampSick, smoothstep(BEAT.screech + 0.8, BEAT.screech + 1.4, t));
      ground.mesh.material.uniforms.uLampColor.value.copy(lampColor);
      lamps.forEach((lamp, i) => {
        const level = lampLevel(i, t);
        lamp.mat.color.copy(lampColor).multiplyScalar(0.15 + 3.4 * level);
        if (lamp.light) {
          lamp.light.color.copy(lampColor);
          lamp.light.intensity = 150 * level;
        }
        ground.lamps[i].w = level;
      });
      const bl = t > BEAT.screech ? 0.5 + 0.5 * Math.sin(t * 23) * Math.sin(t * 7) : 1;
      bollardLight.color.copy(lampColor).multiplyScalar(1.5 * bl * state.power);

      // manhole covers: rattle, launch, tumble, land
      covers.forEach((c, i) => {
        const k = t - c.m.open;
        const g = c.g;
        if (k < 0) {
          const r = smoothstep(-1.2, 0, k);
          g.position.set(c.m.x, 0.036 + r * 0.035 * Math.abs(Math.sin(t * 43)), c.m.z);
          g.rotation.set(r * 0.06 * Math.sin(t * 37), 0, r * 0.06 * Math.sin(t * 31));
        } else {
          const u = Math.min(k / AIR, 1);
          const kk = Math.min(k, AIR);
          const y = 0.036 + 0.5 * 9.81 * AIR * kk - 0.5 * 9.81 * kk * kk;
          g.position.set(c.m.x + c.dx * 3.1 * u, Math.max(0.036, y), c.m.z + c.dz * 3.1 * u);
          const settle = k > AIR ? Math.exp(-(k - AIR) * 5) * Math.sin((k - AIR) * 28) * 0.22 : 0;
          axis.set(-c.dz, 0, c.dx);
          g.quaternion.setFromAxisAngle(axis, u * Math.PI * 3 + settle);
        }
        const open = smoothstep(-0.05, 0.4, k);
        const glowLevel = open * (0.75 + 0.25 * Math.sin(t * 6 + i));
        ground.holes[i].w = glowLevel;
        if (i < holeLights.length) holeLights[i].intensity = 60 * glowLevel;
      });

      // car alarms
      for (const car of cars) {
        const k = t - car.alarmAt;
        const on = k > 0 && (k * car.rate) % 1 < 0.5;
        car.hazard.color.setRGB(on ? 3.2 : 0.02, on ? 1.3 : 0.008, 0);
        car.head.color.setRGB(on ? 2.4 : 0.03, on ? 2.4 : 0.03, on ? 2.2 : 0.03);
        car.tail.color.setRGB(on ? 2.0 : 0.12, 0.01, 0.01);
      }
    },
  };
}
