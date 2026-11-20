import * as THREE from 'three';
import { sampleElevation } from './geometryHelpers.js';

function makePixelTex(w, h, drawFn) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  drawFn(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const WHEEL_TEX = makePixelTex(8, 8, (ctx) => {
  ctx.fillStyle = '#181a1d';
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillStyle = '#2b2f36';
  ctx.fillRect(1, 1, 6, 6);
  ctx.fillStyle = '#8b95a3';
  ctx.fillRect(2, 2, 4, 4);
  ctx.fillStyle = '#4f5763';
  ctx.fillRect(3, 3, 2, 2);
});

const FACE_TEX = makePixelTex(16, 16, (ctx) => {
  ctx.fillStyle = '#ebbfa4';
  ctx.fillRect(0, 0, 16, 16);
  // Subtle cheek/chin pixel shading
  ctx.fillStyle = '#dfa98b';
  ctx.fillRect(0, 13, 16, 3);
  ctx.fillStyle = '#f2cbb2';
  ctx.fillRect(2, 6, 12, 4);
  // Hair fringe
  ctx.fillStyle = '#4a3525';
  ctx.fillRect(0, 0, 16, 4);
  ctx.fillRect(0, 4, 2, 2);
  ctx.fillRect(14, 4, 2, 2);
  // Eyebrows
  ctx.fillStyle = '#3b281a';
  ctx.fillRect(3, 6, 3, 1);
  ctx.fillRect(10, 6, 3, 1);
  // Crisp white+iris eyes
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(3, 8, 3, 2);
  ctx.fillRect(10, 8, 3, 2);
  ctx.fillStyle = '#254a70';
  ctx.fillRect(4, 8, 2, 2);
  ctx.fillRect(10, 8, 2, 2);
  // Nose & smile
  ctx.fillStyle = '#cc8e70';
  ctx.fillRect(7, 10, 2, 1);
  ctx.fillStyle = '#a85f4b';
  ctx.fillRect(6, 12, 4, 1);
});

const SHIRT_TEX = makePixelTex(16, 16, (ctx) => {
  ctx.fillStyle = '#e8eaed';
  ctx.fillRect(0, 0, 16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if ((x + y) % 3 === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.06)';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  // Collar & center zipper/placket
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(5, 0, 6, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(7, 2, 2, 13);
  ctx.fillRect(0, 14, 16, 2);
});

const JEANS_TEX = makePixelTex(8, 16, (ctx) => {
  ctx.fillStyle = '#d4dae2';
  ctx.fillRect(0, 0, 8, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 8; x++) {
      if ((x * 3 + y) % 4 === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, 8, 2); // belt
});

const BUS_WIN_TEX = makePixelTex(32, 8, (ctx) => {
  ctx.fillStyle = '#203040';
  ctx.fillRect(0, 0, 32, 8);
  ctx.fillStyle = '#476b8c';
  for (let x = 1; x < 31; x += 4) {
    ctx.fillRect(x, 1, 3, 6);
    ctx.fillStyle = '#7098bd';
    ctx.fillRect(x, 1, 1, 2);
    ctx.fillStyle = '#476b8c';
  }
});

const CAR_SNOW_MAT = new THREE.MeshStandardMaterial({ color: 0xf1f7fd, roughness: 0.85, metalness: 0.02 });

function makeVehicleMesh(kind, bodyColor) {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.45, metalness: 0.25 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x24384c,
    roughness: 0.2,
    metalness: 0.4,
    transparent: true,
    opacity: 0.62,
  });
  const wheelMat = new THREE.MeshStandardMaterial({ map: WHEEL_TEX, roughness: 0.85 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6d6, emissive: 0xffe8a3, emissiveIntensity: 0.25 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x991515, emissive: 0xff1e1e, emissiveIntensity: 0.25 });
  const driverHeadMat = new THREE.MeshStandardMaterial({ map: FACE_TEX, roughness: 0.75 });
  const driverShirtMat = new THREE.MeshStandardMaterial({ color: 0x3b6fa8, roughness: 0.85 });

  let len = 4.2, wid = 1.85, bodyH = 0.72, cabL = 2.0, cabH = 0.64, cabOff = -0.15;
  if (kind === 'suv') {
    len = 4.5; wid = 1.95; bodyH = 0.84; cabL = 2.8; cabH = 0.74; cabOff = -0.35;
  } else if (kind === 'pickup') {
    len = 5.0; wid = 2.0; bodyH = 0.86; cabL = 1.7; cabH = 0.74; cabOff = 0.55;
  } else if (kind === 'bus') {
    len = 8.8; wid = 2.4; bodyH = 2.25; cabL = 0; cabH = 0;
  }

  const snowGroup = new THREE.Group();
  snowGroup.visible = false;

  if (kind === 'bus') {
    const busBody = new THREE.Mesh(new THREE.BoxGeometry(len, bodyH, wid), bodyMat);
    busBody.position.y = 0.45 + bodyH / 2;
    busBody.castShadow = true;
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(len + 0.04, 0.2, wid + 0.04),
      new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.7 })
    );
    stripe.position.y = 1.48;
    const busWinMat = new THREE.MeshStandardMaterial({ map: BUS_WIN_TEX, roughness: 0.25, metalness: 0.3 });
    const winBand = new THREE.Mesh(new THREE.BoxGeometry(len - 0.5, 0.76, wid + 0.03), busWinMat);
    winBand.position.y = 2.12;
    const roofCap = new THREE.Mesh(
      new THREE.BoxGeometry(len - 0.3, 0.14, wid - 0.2),
      new THREE.MeshStandardMaterial({ color: 0xf6c945, roughness: 0.6 })
    );
    roofCap.position.y = 0.45 + bodyH + 0.07;
    const busSnow = new THREE.Mesh(new THREE.BoxGeometry(len - 0.5, 0.14, wid - 0.3), CAR_SNOW_MAT);
    busSnow.position.y = 0.45 + bodyH + 0.18;
    snowGroup.add(busSnow);
    group.add(busBody, stripe, winBand, roofCap, snowGroup);
  } else {
    const lower = new THREE.Mesh(new THREE.BoxGeometry(len, bodyH, wid), bodyMat);
    lower.position.y = 0.30 + bodyH / 2;
    lower.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(cabL, cabH, wid * 0.86), bodyMat);
    cabin.position.set(cabOff, 0.30 + bodyH + cabH / 2 - 0.02, 0);
    cabin.castShadow = true;
    const wind = new THREE.Mesh(new THREE.BoxGeometry(cabL + 0.04, cabH * 0.68, wid * 0.88), glassMat);
    wind.position.set(cabOff, 0.30 + bodyH + cabH / 2 - 0.02, 0);
    const bumper = new THREE.Mesh(
      new THREE.BoxGeometry(len + 0.12, 0.2, wid * 0.96),
      new THREE.MeshStandardMaterial({ color: 0x262a30, roughness: 0.8 })
    );
    bumper.position.y = 0.38;
    // Visible blocky driver inside cabin (left-hand drive in Quebec -> -Z side)
    const dTorso = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.32, 0.32), driverShirtMat);
    dTorso.position.set(cabOff + 0.1, 0.30 + bodyH + 0.15, -wid * 0.18);
    const dHead = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), driverHeadMat);
    dHead.position.set(cabOff + 0.12, 0.30 + bodyH + 0.42, -wid * 0.18);

    const roofSnow = new THREE.Mesh(new THREE.BoxGeometry(cabL - 0.16, 0.11, wid * 0.78), CAR_SNOW_MAT);
    roofSnow.position.set(cabOff, 0.30 + bodyH + cabH + 0.03, 0);
    snowGroup.add(roofSnow);
    const hoodLen = (len * 0.5 - (cabOff + cabL * 0.5)) * 0.75;
    if (hoodLen > 0.3) {
      const hoodSnow = new THREE.Mesh(new THREE.BoxGeometry(hoodLen, 0.09, wid * 0.78), CAR_SNOW_MAT);
      hoodSnow.position.set(cabOff + cabL * 0.5 + hoodLen * 0.55, 0.30 + bodyH + 0.04, 0);
      snowGroup.add(hoodSnow);
    }
    group.add(lower, cabin, wind, bumper, dTorso, dHead, snowGroup);
  }

  // Blocky Minecraft-style square wheels
  const wx = len * 0.31;
  const wz = wid * 0.48;
  const wheelGeo = new THREE.BoxGeometry(0.62, 0.62, 0.24);
  for (const x of [-wx, wx]) {
    for (const z of [-wz, wz]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(x, 0.31, z);
      group.add(w);
    }
  }

  // Headlights (+X front) & Brake lights (-X rear)
  const hlGeo = new THREE.BoxGeometry(0.1, 0.2, 0.32);
  for (const z of [-wid * 0.34, wid * 0.34]) {
    const hl = new THREE.Mesh(hlGeo, headMat);
    hl.position.set(len * 0.5 + 0.02, 0.68, z);
    const bl = new THREE.Mesh(hlGeo, brakeMat);
    bl.position.set(-len * 0.5 - 0.02, 0.72, z);
    group.add(hl, bl);
  }

  return { group, headMat, brakeMat, snowGroup };
}

export function makePedestrianMesh(shirtCol, pantsCol, hasBackpack = false, packCol = 0x2a66c2, hairCol = 0x4a3525) {
  const root = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xebbfa4, roughness: 0.78 });
  const faceMat = new THREE.MeshStandardMaterial({ map: FACE_TEX, roughness: 0.78 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hairCol, roughness: 0.85 });
  const shirtMat = new THREE.MeshStandardMaterial({ map: SHIRT_TEX, color: shirtCol, roughness: 0.82 });
  const pantsMat = new THREE.MeshStandardMaterial({ map: JEANS_TEX, color: pantsCol, roughness: 0.88 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.9 });

  // Sharpened Minecraft-style proportions with hands, shoes & collar
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.56, 0.40), shirtMat);
  torso.position.y = 1.04;
  torso.castShadow = true;

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), [
    faceMat,
    hairMat,
    hairMat,
    skinMat,
    hairMat,
    hairMat,
  ]);
  head.position.y = 1.49;
  head.castShadow = true;

  const legL = new THREE.Group();
  legL.position.set(0, 0.76, -0.10);
  const pantL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.50, 0.18), pantsMat);
  pantL.position.y = -0.25;
  const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.19), shoeMat);
  shoeL.position.set(0.02, -0.56, 0);
  legL.add(pantL, shoeL);

  const legR = new THREE.Group();
  legR.position.set(0, 0.76, 0.10);
  const pantR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.50, 0.18), pantsMat);
  pantR.position.y = -0.25;
  const shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.19), shoeMat);
  shoeR.position.set(0.02, -0.56, 0);
  legR.add(pantR, shoeR);

  const armL = new THREE.Group();
  armL.position.set(0, 1.28, -0.28);
  const sleeveL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.40, 0.16), shirtMat);
  sleeveL.position.y = -0.17;
  const handL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), skinMat);
  handL.position.y = -0.44;
  armL.add(sleeveL, handL);

  const armR = new THREE.Group();
  armR.position.set(0, 1.28, 0.28);
  const sleeveR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.40, 0.16), shirtMat);
  sleeveR.position.y = -0.17;
  const handR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), skinMat);
  handR.position.y = -0.44;
  armR.add(sleeveR, handR);

  root.add(torso, head, legL, legR, armL, armR);
  if (hasBackpack) {
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.38, 0.30),
      new THREE.MeshStandardMaterial({ map: SHIRT_TEX, color: packCol, roughness: 0.78 })
    );
    pack.position.set(-0.22, 1.06, 0);
    const strapL = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.38, 0.05), shoeMat);
    strapL.position.set(-0.02, 1.08, -0.12);
    const strapR = strapL.clone();
    strapR.position.z = 0.12;
    root.add(pack, strapL, strapR);
  }
  return { root, legL, legR, armL, armR };
}

function makeDogMesh(furColor = 0xb8844c) {
  const dog = new THREE.Group();
  const furMat = new THREE.MeshStandardMaterial({ color: furColor, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.24, 0.24), furMat);
  body.position.y = 0.28;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), furMat);
  head.position.set(0.32, 0.38, 0);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.08), furMat);
  tail.position.set(-0.32, 0.38, 0);
  tail.rotation.z = 0.45;
  for (const lx of [-0.18, 0.18]) {
    for (const lz of [-0.07, 0.07]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.08), furMat);
      leg.position.set(lx, 0.09, lz);
      dog.add(leg);
    }
  }
  dog.add(body, head, tail);
  return dog;
}

/**
 * 20m Spatial Hash Grid Collider for buildings, cedar hedges, tree trunks,
 * overgrown bushes, and parked cars.
 */
export function createCollider(DATA, obstacles = null) {
  const CELL = 20;
  const grid = new Map();
  let queryStamp = 0;

  const cellKey = (cx, cz) => (cx + 256) * 1024 + (cz + 256);

  const insertItem = (item, minX, maxX, minZ, maxZ) => {
    const cx0 = Math.floor(minX / CELL);
    const cx1 = Math.floor(maxX / CELL);
    const cz0 = Math.floor(minZ / CELL);
    const cz1 = Math.floor(maxZ / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = cellKey(cx, cz);
        let bucket = grid.get(k);
        if (!bucket) {
          bucket = [];
          grid.set(k, bucket);
        }
        bucket.push(item);
      }
    }
  };

  const addOBB = (x, z, hw, hd, cos, sin, category) => {
    const rBound = Math.hypot(hw, hd);
    const item = { kind: 'obb', category, x, z, hw, hd, cos, sin, rBound, _stamp: 0 };
    insertItem(item, x - rBound, x + rBound, z - rBound, z + rBound);
  };

  const addCircle = (x, z, r, category) => {
    if (r <= 0) return;
    const item = { kind: 'circle', category, x, z, r, _stamp: 0 };
    insertItem(item, x - r, x + r, z - r, z + r);
  };

  // All 2,307+ buildings (including hero 2646, Samare, Galvin)
  if (DATA && Array.isArray(DATA.buildings)) {
    for (const b of DATA.buildings) {
      if (b.obbCx == null || b.obbCz == null) continue;
      const hw = (b.d || 4) * 0.5;
      const hd = (b.w || 4) * 0.5;
      const ang = b.ang || 0;
      addOBB(b.obbCx, b.obbCz, hw, hd, Math.cos(ang), Math.sin(ang), 'building');
    }
  }

  if (obstacles) {
    if (Array.isArray(obstacles.trees)) {
      for (const [x, z, r] of obstacles.trees) {
        addCircle(x, z, r, 'tree');
      }
    }
    if (Array.isArray(obstacles.bushes)) {
      for (const [x, z, r] of obstacles.bushes) {
        addCircle(x, z, r, 'bush');
      }
    }
    if (Array.isArray(obstacles.hedges)) {
      for (const [x, z, hw, hd, ry] of obstacles.hedges) {
        addOBB(x, z, hw, hd, Math.cos(ry), -Math.sin(ry), 'hedge');
      }
    }
    if (Array.isArray(obstacles.parkedCars)) {
      for (const [x, z, hw, hd, ry] of obstacles.parkedCars) {
        addOBB(x, z, hw, hd, Math.cos(ry), -Math.sin(ry), 'parkedCar');
      }
    }
  }

  function resolveItem(item, px, pz, radius) {
    if (item.kind === 'circle') {
      const dx = px - item.x;
      const dz = pz - item.z;
      const minD = item.r + radius;
      const dSq = dx * dx + dz * dz;
      if (dSq >= minD * minD) return null;
      const d = Math.sqrt(dSq);
      if (d > 1e-6) {
        const push = minD - d;
        return [px + (dx / d) * push, pz + (dz / d) * push];
      }
      return [px + minD, pz];
    }

    // OBB
    const dx = px - item.x;
    const dz = pz - item.z;
    const maxR = item.rBound + radius;
    if (dx * dx + dz * dz >= maxR * maxR) return null;

    const u = dx * item.cos + dz * item.sin;
    const v = -dx * item.sin + dz * item.cos;
    const cu = Math.max(-item.hw, Math.min(item.hw, u));
    const cv = Math.max(-item.hd, Math.min(item.hd, v));
    const du = u - cu;
    const dv = v - cv;
    const dSq = du * du + dv * dv;
    if (dSq >= radius * radius) return null;

    let nu = 0;
    let nv = 0;
    let push = 0;
    if (dSq > 1e-8) {
      const d = Math.sqrt(dSq);
      nu = du / d;
      nv = dv / d;
      push = radius - d;
    } else {
      const penU = item.hw - Math.abs(u);
      const penV = item.hd - Math.abs(v);
      if (penU < penV) {
        nu = u >= 0 ? 1 : -1;
        push = penU + radius;
      } else {
        nv = v >= 0 ? 1 : -1;
        push = penV + radius;
      }
    }
    const pushX = item.cos * nu * push - item.sin * nv * push;
    const pushZ = item.sin * nu * push + item.cos * nv * push;
    return [px + pushX, pz + pushZ];
  }

  function resolveCircle(x, z, radius = 0.42) {
    let px = x;
    let pz = z;
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      const stamp = ++queryStamp;
      const cx0 = Math.floor((px - radius - 2) / CELL);
      const cx1 = Math.floor((px + radius + 2) / CELL);
      const cz0 = Math.floor((pz - radius - 2) / CELL);
      const cz1 = Math.floor((pz + radius + 2) / CELL);
      let moved = false;
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const bucket = grid.get(cellKey(cx, cz));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const item = bucket[i];
            if (item._stamp === stamp) continue;
            item._stamp = stamp;
            const res = resolveItem(item, px, pz, radius);
            if (res) {
              px = res[0];
              pz = res[1];
              hit = true;
              moved = true;
            }
          }
        }
      }
      if (!moved) break;
    }
    return { x: px, z: pz, hit };
  }

  function isBlocked(x, z, radius = 0.42, categories = null) {
    const stamp = ++queryStamp;
    const cx0 = Math.floor((x - radius - 2) / CELL);
    const cx1 = Math.floor((x + radius + 2) / CELL);
    const cz0 = Math.floor((z - radius - 2) / CELL);
    const cz1 = Math.floor((z + radius + 2) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const bucket = grid.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const item = bucket[i];
          if (item._stamp === stamp) continue;
          item._stamp = stamp;
          if (categories && !categories.includes(item.category)) continue;
          if (resolveItem(item, x, z, radius)) return true;
        }
      }
    }
    return false;
  }

  return { resolveCircle, isBlocked };
}

/**
 * Builds directed traffic network & pedestrian simulator.
 */
export function createSimulation(scene, DATA, obstacles = null) {
  const collider = createCollider(DATA, obstacles);
  const simGroup = new THREE.Group();
  scene.add(simGroup);

  // --- 1. Build Road Graph ---
  const graphNodes = new Map(); // nid -> { id, x, z, outEdges: [], isStop: bool, isSignal: bool }
  const ensureNode = (nid, x, z) => {
    let gn = graphNodes.get(nid);
    if (!gn) {
      gn = { id: nid, x, z, outEdges: [], isStop: false, isSignal: false };
      graphNodes.set(nid, gn);
    }
    return gn;
  };

  const stopPts = DATA.stops.map((s) => [s.x, s.z]);
  const signalPts = DATA.signals.map((s) => [s.x, s.z]);
  const crosswalkPts = [
    ...DATA.crossings.map((c) => [c.x, c.z]),
    [263.5, 196.8],
    [191.0, 196.0],
    [109.0, 193.0],
  ];

  const allEdges = [];
  const drivableWays = DATA.roads.filter(
    (r) => r.type === 'primary' || r.type === 'tertiary' || r.type === 'residential' || r.id === 827462404
  );

  for (const r of drivableWays) {
    const isMajor = r.type === 'primary' || r.type === 'tertiary' || r.name === 'Rue Allard' || r.name === 'Rue du Chalumeau';
    const laneOff = r.type === 'primary' ? 2.6 : r.id === 827462404 ? 0.0 : 1.75;
    const speedLimit = r.type === 'primary' ? 13.5 : r.type === 'tertiary' ? 11.0 : 8.5;

    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i];
      const [bx, bz] = r.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.8) continue;
      if (Math.hypot(ax, az) > 1060 && Math.hypot(bx, bz) > 1060) continue;

      const nidA = r.nids[i];
      const nidB = r.nids[i + 1];
      const nA = ensureNode(nidA, ax, az);
      const nB = ensureNode(nidB, bx, bz);

      const addDirEdge = (fromN, toN) => {
        const dx = toN.x - fromN.x;
        const dz = toN.z - fromN.z;
        const elen = Math.hypot(dx, dz);
        const ux = dx / elen;
        const uz = dz / elen;
        const nx = -uz; // right-hand lane normal
        const nz = ux;
        const hasCross = crosswalkPts.find(([cx, cz]) => {
          const t = ((cx - fromN.x) * ux + (cz - fromN.z) * uz) / elen;
          if (t < 0.05 || t > 0.95) return false;
          const px = fromN.x + ux * (t * elen);
          const pz = fromN.z + uz * (t * elen);
          return Math.hypot(cx - px, cz - pz) < 6.0;
        });

        const edge = {
          from: fromN,
          to: toN,
          len: elen,
          ux,
          uz,
          nx,
          nz,
          laneOff,
          speedLimit,
          isMajor,
          name: r.name,
          crossPt: hasCross || null,
        };
        fromN.outEdges.push(edge);
        allEdges.push(edge);
      };

      addDirEdge(nA, nB);
      if (!r.oneway && r.id !== 827462404) {
        addDirEdge(nB, nA);
      }
    }
  }

  // Flag stop & traffic signal nodes
  for (const gn of graphNodes.values()) {
    if (stopPts.some(([sx, sz]) => Math.hypot(gn.x - sx, gn.z - sz) < 5.5)) {
      gn.isStop = true;
    } else if (gn.outEdges.length >= 3) {
      // Minor residential T-junctions also act as yield/stop nodes
      const hasMajor = gn.outEdges.some((e) => e.isMajor);
      if (!hasMajor && (gn.id % 3 === 0)) gn.isStop = true;
    }
    if (signalPts.some(([sx, sz]) => Math.hypot(gn.x - sx, gn.z - sz) < 8.0)) {
      gn.isSignal = true;
    }
  }

  // --- 2. Spawn 65 Moving Vehicles (including 2 Yellow School Buses) ---
  const vehicles = [];
  const palette = [0xdde1e6, 0x262d36, 0x7b8694, 0x1d4070, 0xa82a2a, 0x435748, 0x998771, 0x3b424d];
  const busTargetEdges = allEdges.filter(
    (e) => e.name === 'Rue du Chalumeau' || e.id === 827462404 || e.name === 'Rue Allard' || e.name === 'Rue des Cormiers'
  );
  const chalumeauEdges = allEdges.filter((e) => e.name === 'Rue du Chalumeau');

  for (let i = 0; i < 65; i++) {
    const isBus = i < 2 && busTargetEdges.length > 0;
    const kind = isBus ? 'bus' : i % 4 === 0 ? 'suv' : i % 6 === 0 ? 'pickup' : 'sedan';
    const col = isBus ? 0xf2b418 : palette[i % palette.length];
    const vMesh = makeVehicleMesh(kind, col);
    simGroup.add(vMesh.group);

    const startEdge = isBus
      ? (i === 0 && chalumeauEdges.length > 0 ? chalumeauEdges[0] : busTargetEdges[(i * 7) % busTargetEdges.length])
      : allEdges[(i * 19 + 5) % allEdges.length];

    vehicles.push({
      id: i,
      mesh: vMesh.group,
      headMat: vMesh.headMat,
      brakeMat: vMesh.brakeMat,
      snowGroup: vMesh.snowGroup,
      isBus,
      edge: startEdge,
      dist: Math.min(startEdge.len * 0.4, 2.0),
      speed: startEdge.speedLimit * 0.7,
      speedFactor: 0.82 + (i % 5) * 0.08,
      waitTimer: 0,
      pullOverCooldown: 18 + (i % 7) * 9,
      x: startEdge.from.x,
      z: startEdge.from.z,
      braking: false,
    });
  }

  // --- 3. Build Pedestrian Paths & Spawn 85 Articulated Pedestrians ---
  const pedRoutes = [];
  // Sidewalks & footways & school paths + quiet residential streets
  for (const r of DATA.roads) {
    if (r.pts.length < 2) continue;
    if (
      r.type === 'footway' ||
      r.type === 'path' ||
      r.type === 'cycleway' ||
      r.sidewalkSide !== 'none' ||
      r.name === 'Rue des Cormiers' ||
      r.name === 'Rue des Merisiers' ||
      r.name === 'Rue des Tilleuls' ||
      r.name === 'Rue du Chalumeau'
    ) {
      const off = r.type === 'footway' || r.type === 'path' || r.type === 'cycleway' ? 0 : r.width * 0.5 + 1.0;
      const pts = r.pts.map(([x, z], idx) => {
        if (off === 0) return [x, z];
        const next = r.pts[Math.min(idx + 1, r.pts.length - 1)];
        const prev = r.pts[Math.max(idx - 1, 0)];
        const dx = next[0] - prev[0];
        const dz = next[1] - prev[1];
        const l = Math.hypot(dx, dz) || 1;
        return [x + (-dz / l) * off, z + (dx / l) * off];
      });
      if (Math.hypot(pts[0][0], pts[0][1]) < 1050) {
        pedRoutes.push({ pts, name: r.name });
      }
    }
  }
  // Add explicit crosswalk, schoolyard, soccer pitch, patinoire & neighbourhood walking loops
  pedRoutes.push(
    { pts: [[257.5, 191.0], [263.5, 196.8], [265.2, 238.0], [257.5, 227.4], [257.5, 191.0]], name: 'École de la Samare' },
    { pts: [[245, 275], [295, 282], [320, 260], [345, 252], [320, 232], [245, 275]], name: 'Schoolyard' },
    { pts: [[332, 240], [368, 245], [362, 268], [335, 260], [332, 240]], name: 'Samare Soccer' },
    { pts: [[5.5, 2.8], [13.5, 3.2], [11.5, 1.2], [6.5, 4.5], [5.5, 2.8]], name: '2646 Street Hockey' },
    { pts: [[-18, 220], [18, -50], [15, -55], [-210, -78]], name: 'Rue des Cormiers Walk' },
    { pts: [[-175, -245], [-220, -290], [-250, -325], [-190, -270], [-175, -245]], name: 'Parc Gilles-Charland' },
    { pts: [[-162, -210], [-138, -216], [-142, -222], [-158, -206], [-162, -210]], name: 'Patinoire Play' }
  );

  const peds = [];
  const shirtCols = [0xd64545, 0x2d74c4, 0x359656, 0xe8a325, 0x8948b5, 0xf2f4f7, 0x2c3440];
  const pantsCols = [0x263547, 0x36393d, 0x5c4f41, 0x202833];
  const dogCols = [0xc28e54, 0x453428, 0xd8d2c8, 0x8c5530];

  for (let i = 0; i < 95; i++) {
    let route;
    let role = 'walker';
    if (i < 4) {
      route = pedRoutes.find((pr) => pr.name === 'Samare Soccer') || pedRoutes[0];
      role = 'jogger';
    } else if (i < 7) {
      route = pedRoutes.find((pr) => pr.name === '2646 Street Hockey') || pedRoutes[0];
      role = 'player';
    } else if (i < 11) {
      route = pedRoutes.find((pr) => pr.name === 'Patinoire Play') || pedRoutes[0];
      role = 'jogger';
    } else if (i < 24) {
      const schoolRoutes = pedRoutes.filter((pr) => pr.name.includes('Samare') || pr.name.includes('Schoolyard') || pr.name === 'Rue du Chalumeau');
      route = schoolRoutes[i % schoolRoutes.length] || pedRoutes[i % pedRoutes.length];
    } else if (i < 40) {
      const localRoutes = pedRoutes.filter((pr) => pr.name.includes('Cormiers') || pr.name.includes('Charland') || pr.name === 'Rue Allard');
      route = localRoutes[i % localRoutes.length] || pedRoutes[i % pedRoutes.length];
      if (i % 3 === 0) role = 'dogwalker';
      else if (i % 4 === 0) role = 'jogger';
    } else {
      route = pedRoutes[(i * 3) % pedRoutes.length];
      if (i % 7 === 0) role = 'dogwalker';
      else if (i % 6 === 0) role = 'jogger';
    }

    const isChild = i < 24 && role !== 'dogwalker';
    const pMesh = makePedestrianMesh(
      shirtCols[i % shirtCols.length],
      pantsCols[i % pantsCols.length],
      isChild && role !== 'player',
      shirtCols[(i + 3) % shirtCols.length]
    );
    if (isChild) pMesh.root.scale.setScalar(0.82);

    if (role === 'dogwalker') {
      const dog = makeDogMesh(dogCols[i % dogCols.length]);
      dog.position.set(0.35, 0, 0.55);
      pMesh.root.add(dog);
    }
    simGroup.add(pMesh.root);

    peds.push({
      ...pMesh,
      role,
      route: route.pts,
      segIdx: i % Math.max(1, route.pts.length - 1),
      dir: i % 2 === 0 ? 1 : -1,
      t: (i * 0.17) % 1,
      speed: role === 'jogger' ? 2.45 + (i % 3) * 0.22 : role === 'player' ? 1.8 : 1.15 + (i % 5) * 0.14,
      phase: i * 1.1,
      x: route.pts[0][0],
      z: route.pts[0][1],
    });
  }

  let simClock = 0;

  function chooseNextEdge(v) {
    const node = v.edge.to;
    const cands = node.outEdges.filter((e) => e.to !== v.edge.from);
    let nextPool = cands.length > 0 ? cands : node.outEdges;
    if (v.isBus) {
      const busPref = nextPool.filter(
        (e) => e.name === 'Rue Allard' || e.name === 'Rue du Chalumeau' || e.name === 'Rue des Cormiers' || e.name === 'Chemin Galvin'
      );
      if (busPref.length > 0) nextPool = busPref;
    }
    if (nextPool.length === 0) return v.edge;
    // Prefer continuing straight where possible
    nextPool.sort((a, b) => {
      const dotA = a.ux * v.edge.ux + a.uz * v.edge.uz;
      const dotB = b.ux * v.edge.ux + b.uz * v.edge.uz;
      return dotB - dotA;
    });
    const pick = Math.random() < 0.68 ? nextPool[0] : nextPool[Math.floor(Math.random() * nextPool.length)];
    return pick;
  }

  function update(dt, nightFactor, enabled, playerPos = null) {
    simGroup.visible = enabled;
    if (!enabled) return;
    const stepDt = Math.min(dt, 0.05);
    simClock += stepDt;
    const signalGreenNS = Math.floor(simClock / 12) % 2 === 0;

    // Update pedestrians first so vehicles know if a crosswalk/lane is occupied
    for (let pi = 0; pi < peds.length; pi++) {
      const p = peds[pi];
      if (p.route.length < 2) continue;
      const idx0 = p.segIdx;
      const idx1 = p.dir > 0 ? idx0 + 1 : idx0 - 1;
      if (idx1 < 0 || idx1 >= p.route.length) {
        p.dir *= -1;
        p.segIdx = Math.max(0, Math.min(p.route.length - 2, p.segIdx));
        continue;
      }
      const [ax, az] = p.route[idx0];
      const [bx, bz] = p.route[idx1];
      const segLen = Math.hypot(bx - ax, bz - az) || 1;
      p.t += (p.speed * stepDt) / segLen;
      if (p.t >= 1.0) {
        p.t = 0;
        p.segIdx = idx1;
        if (p.segIdx <= 0) p.dir = 1;
        if (p.segIdx >= p.route.length - 1) p.dir = -1;
      }
      let px = ax + (bx - ax) * p.t;
      let pz = az + (bz - az) * p.t;

      // Keep AI pedestrians out of buildings, trees, bushes, hedges, parked cars
      const colRes = collider.resolveCircle(px, pz, 0.36);
      px = colRes.x;
      pz = colRes.z;

      // Separate from other AI pedestrians (minDist = 0.7m)
      for (let pj = 0; pj < peds.length; pj++) {
        if (pj === pi) continue;
        const o = peds[pj];
        const dx = px - o.x;
        const dz = pz - o.z;
        const dSq = dx * dx + dz * dz;
        if (dSq > 1e-6 && dSq < 0.49) {
          const d = Math.sqrt(dSq);
          const push = (0.7 - d) * 0.5;
          px += (dx / d) * push;
          pz += (dz / d) * push;
        }
      }

      // Separate from playable character / street-walk player
      if (playerPos) {
        const dx = px - playerPos.x;
        const dz = pz - playerPos.z;
        const dSq = dx * dx + dz * dz;
        if (dSq > 1e-6 && dSq < 0.5625) {
          const d = Math.sqrt(dSq);
          const push = 0.75 - d;
          px += (dx / d) * push;
          pz += (dz / d) * push;
        }
      }

      // Keep clear of moving vehicles
      for (const v of vehicles) {
        const dx = px - v.x;
        const dz = pz - v.z;
        if (dx * dx + dz * dz > 36) continue;
        const ce = v.edge;
        const fwd = dx * ce.ux + dz * ce.uz;
        const lat = -dx * ce.uz + dz * ce.ux;
        const halfL = (v.isBus ? 4.4 : 2.3) + 0.4;
        const halfW = (v.isBus ? 1.25 : 1.0) + 0.4;
        if (Math.abs(fwd) < halfL && Math.abs(lat) < halfW) {
          const sign = lat >= 0 ? 1 : -1;
          const push = halfW - Math.abs(lat);
          px += -ce.uz * sign * push;
          pz += ce.ux * sign * push;
        }
      }

      p.x = px;
      p.z = pz;
      const py = sampleElevation(px, pz, DATA.elevation);
      p.root.position.set(px, py + 0.11, pz);
      p.root.rotation.y = -Math.atan2(bz - az, bx - ax);

      p.phase += stepDt * p.speed * 5.2;
      const swing = Math.sin(p.phase) * 0.52;
      p.legL.rotation.z = swing;
      p.legR.rotation.z = -swing;
      p.armL.rotation.z = -swing * 0.75;
      p.armR.rotation.z = swing * 0.75;
    }

    // Update vehicles with forward-corridor & intersection collision avoidance
    for (const v of vehicles) {
      const e = v.edge;
      const distToEnd = e.len - v.dist;

      if (v.waitTimer > 0) {
        v.waitTimer -= stepDt;
        v.speed = 0;
        v.braking = true;
      } else {
        let targetSpeed = e.speedLimit;
        v.braking = false;

        // 1. Check stop sign at end of edge
        if (e.to.isStop && distToEnd < 7.5) {
          if (distToEnd < 3.4) {
            v.waitTimer = 1.6;
            targetSpeed = 0;
          } else {
            targetSpeed = Math.min(targetSpeed, distToEnd * 0.85);
          }
          v.braking = true;
        }

        // 2. Check traffic signal on Rue King Est
        if (e.to.isSignal && distToEnd < 10.0) {
          const isEW = Math.abs(e.ux) > Math.abs(e.uz);
          const hasGreen = isEW ? !signalGreenNS : signalGreenNS;
          if (!hasGreen) {
            targetSpeed = distToEnd < 4.5 ? 0 : Math.min(targetSpeed, distToEnd * 0.7);
            v.braking = true;
          }
        }

        // 3. Check crosswalk pedestrian yield
        if (e.crossPt) {
          const dCross = Math.hypot(e.crossPt[0] - v.x, e.crossPt[1] - v.z);
          if (dCross < 8.5) {
            const pedNear = peds.some((p) => Math.hypot(p.x - e.crossPt[0], p.z - e.crossPt[1]) < 4.6);
            if (pedNear) {
              targetSpeed = 0;
              v.braking = true;
            }
          }
        }

        // 4. Forward corridor (0..12m ahead, |lat| < 1.85m) against playable character
        if (playerPos) {
          const dx = playerPos.x - v.x;
          const dz = playerPos.z - v.z;
          const fwd = dx * e.ux + dz * e.uz;
          const lat = -dx * e.uz + dz * e.ux;
          if (fwd > 0 && fwd < 12.0 && Math.abs(lat) < 1.85) {
            targetSpeed = fwd < 5.2 ? 0 : Math.min(targetSpeed, (fwd - 3.5) * 1.1);
            v.braking = true;
          }
        }

        // 5. Forward corridor against AI pedestrians
        for (const p of peds) {
          const dx = p.x - v.x;
          const dz = p.z - v.z;
          if (dx * dx + dz * dz > 169) continue;
          const fwd = dx * e.ux + dz * e.uz;
          const lat = -dx * e.uz + dz * e.ux;
          if (fwd > 0 && fwd < 11.5 && Math.abs(lat) < 1.85) {
            targetSpeed = fwd < 4.8 ? 0 : Math.min(targetSpeed, (fwd - 3.2) * 1.1);
            v.braking = true;
          }
        }

        // 6. Car-following + cross-traffic / intersection occupancy against all other vehicles
        const myHalfL = v.isBus ? 4.4 : 2.2;
        for (const other of vehicles) {
          if (other === v) continue;
          if (other.edge === e && other.dist > v.dist) {
            const gap = other.dist - v.dist - myHalfL * 0.5;
            if (gap < 10.5) {
              targetSpeed = gap < 6.2 ? 0 : Math.min(targetSpeed, other.speed * 0.8);
              v.braking = true;
            }
            continue;
          }
          const dx = other.x - v.x;
          const dz = other.z - v.z;
          if (dx * dx + dz * dz > 225) continue;
          const fwd = dx * e.ux + dz * e.uz;
          const lat = -dx * e.uz + dz * e.ux;
          if (fwd > 0.5 && fwd < 12.0 && Math.abs(lat) < 2.25) {
            // Break mutual intersection deadlocks deterministically
            const bothStopped = v.speed < 0.25 && other.speed < 0.25;
            const iHavePriority = (e.isMajor && !other.edge.isMajor) || (e.isMajor === other.edge.isMajor && v.id < other.id);
            if (bothStopped && iHavePriority && fwd > 3.6) continue;
            targetSpeed = fwd < 6.8 ? 0 : Math.min(targetSpeed, (fwd - 4.2) * 1.0);
            v.braking = true;
          }
        }

        // 7. Static parkedCars / buildings directly ahead in lane
        if (collider.isBlocked(v.x + e.ux * 3.8, v.z + e.uz * 3.8, 0.85, ['parkedCar', 'building'])) {
          targetSpeed = 0;
          v.braking = true;
        }

        const accel = targetSpeed < v.speed ? 12.0 : 5.5;
        v.speed += Math.sign(targetSpeed - v.speed) * Math.min(Math.abs(targetSpeed - v.speed), accel * stepDt);
        v.dist += v.speed * stepDt;

        if (v.dist >= e.len) {
          v.edge = chooseNextEdge(v);
          v.dist = 0.1;
        }
      }

      const ce = v.edge;
      v.x = ce.from.x + ce.ux * v.dist + ce.nx * ce.laneOff;
      v.z = ce.from.z + ce.uz * v.dist + ce.nz * ce.laneOff;
      const vy = sampleElevation(v.x, v.z, DATA.elevation);
      const yFront = sampleElevation(v.x + ce.ux * 2.0, v.z + ce.uz * 2.0, DATA.elevation);
      const yBack = sampleElevation(v.x - ce.ux * 2.0, v.z - ce.uz * 2.0, DATA.elevation);
      const pitch = Math.atan2(yFront - yBack, 4.0);
      v.mesh.position.set(v.x, vy + 0.05, v.z);
      v.mesh.rotation.y = -Math.atan2(ce.uz, ce.ux);
      v.mesh.rotation.z = pitch;

      v.headMat.emissiveIntensity = 0.25 + nightFactor * 2.2;
      v.brakeMat.emissiveIntensity = v.braking ? 2.4 : 0.25 + nightFactor * 0.7;
    }
  }

  function getDynamicObstacles() {
    return {
      vehicles: vehicles.map((v) => ({
        x: v.x,
        z: v.z,
        ux: v.edge.ux,
        uz: v.edge.uz,
        hw: v.isBus ? 4.4 : 2.3,
        hd: v.isBus ? 1.25 : 1.0,
      })),
      peds: peds.map((p) => ({ x: p.x, z: p.z, r: 0.38 })),
    };
  }

  function setWinterMode(isWinter) {
    const active = !!isWinter;
    for (const v of vehicles) {
      if (v.snowGroup) v.snowGroup.visible = active;
    }
  }

  return {
    update,
    setWinterMode,
    collider,
    getDynamicObstacles,
    getVehicleCoords() {
      return vehicles.map((v) => [v.x, v.z, v.isBus]);
    },
  };
}
