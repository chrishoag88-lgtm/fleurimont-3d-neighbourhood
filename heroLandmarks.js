import * as THREE from 'three';
import {
  sampleElevation,
  mergeGeometries,
  createExtrudedPolygonGeometry,
  createGroundPolygonGeometry,
  createRibbonGeometry,
  createPitchedRoofGeometry,
  createGableEndsGeometry,
  createRoofTrimGeometry,
  setWorldBoxUVs,
} from './geometryHelpers.js';
import {
  createHollowShell,
  populateHouseInterior,
  populateUpperFloor,
  populateDetailedBackyard,
  registerExternalEnterable,
} from './interiors.js';

function localOffsetToWorld(cx, cz, ang, lx, lz) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [cx + lx * c - lz * s, cz + lx * s + lz * c];
}

const heroWinterHandlers = [];
const heroChristmasGroups = [];
const heroNightHandlers = [];
const heroChimneyTops = [];
let heroSmokeGroup = null;
const heroSmokePuffs = [];
let heroSmokeGeo = null;

function registerHeroMaterialSwap(mat, summerProps, winterProps) {
  heroWinterHandlers.push((isWinter) => {
    const props = isWinter ? winterProps : summerProps;
    if ('map' in props && mat.map !== props.map) {
      mat.map = props.map;
      mat.needsUpdate = true;
    }
    if ('color' in props) {
      mat.color.setHex(props.color);
    }
    if ('roughness' in props) {
      mat.roughness = props.roughness;
    }
    if ('metalness' in props) {
      mat.metalness = props.metalness;
    }
    if ('opacity' in props) {
      mat.opacity = props.opacity;
    }
  });
}

function registerHeroNightHandler(fn) {
  heroNightHandlers.push(fn);
}

function registerHeroWindowMaterial(mat, texLib, nightIntensity = 0.72, nightColor = 0xffb84d) {
  const dayMap = mat.map || null;
  const dayColor = mat.color ? mat.color.getHex() : 0xffffff;
  const dayEmissive = mat.emissive ? mat.emissive.getHex() : 0x000000;
  const dayEmissiveIntensity = mat.emissiveIntensity || 0;
  const usesWindowTex = !!(texLib?.windowTex && dayMap === texLib.windowTex);
  registerHeroNightHandler((isNight) => {
    if (isNight) {
      if (usesWindowTex && texLib?.windowLitTex) {
        if (mat.map !== texLib.windowLitTex) {
          mat.map = texLib.windowLitTex;
          mat.needsUpdate = true;
        }
      }
      mat.emissive.setHex(nightColor);
      mat.emissiveIntensity = nightIntensity;
    } else {
      if (mat.map !== dayMap) {
        mat.map = dayMap;
        mat.needsUpdate = true;
      }
      if (mat.color) mat.color.setHex(dayColor);
      mat.emissive.setHex(dayEmissive);
      mat.emissiveIntensity = dayEmissiveIntensity;
    }
  });
}

function registerHeroGlowMaterial(mat, dayIntensity, nightIntensity, nightColor = null) {
  const dayColor = mat.emissive ? mat.emissive.getHex() : 0xffe4a0;
  registerHeroNightHandler((isNight) => {
    mat.emissiveIntensity = isNight ? nightIntensity : dayIntensity;
    if (nightColor !== null && mat.emissive) {
      mat.emissive.setHex(isNight ? nightColor : dayColor);
    }
  });
}

function registerHeroSignMaterial(mat, tex, nightIntensity = 0.82, nightColor = 0xfff2d6) {
  registerHeroNightHandler((isNight) => {
    if (isNight) {
      mat.emissiveMap = tex;
      mat.emissive.setHex(nightColor);
      mat.emissiveIntensity = nightIntensity;
      mat.needsUpdate = true;
    } else {
      mat.emissiveMap = null;
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
      mat.needsUpdate = true;
    }
  });
}

function resetHeroSmoke(scene) {
  heroChimneyTops.length = 0;
  heroSmokePuffs.length = 0;
  if (heroSmokeGroup && heroSmokeGroup.parent) {
    heroSmokeGroup.parent.remove(heroSmokeGroup);
  }
  heroSmokeGroup = new THREE.Group();
  heroSmokeGroup.visible = false;
  if (scene) scene.add(heroSmokeGroup);
}

function registerHeroChimney(scene, parentGroup, localX, localY, localZ) {
  parentGroup.updateMatrixWorld(true);
  const wp = new THREE.Vector3(localX, localY, localZ).applyMatrix4(parentGroup.matrixWorld);
  const idx = heroChimneyTops.length;
  heroChimneyTops.push([wp.x, wp.y, wp.z]);

  if (!heroSmokeGroup) {
    heroSmokeGroup = new THREE.Group();
    heroSmokeGroup.visible = false;
  }
  if (!heroSmokeGroup.parent && scene) {
    scene.add(heroSmokeGroup);
  }
  if (!heroSmokeGeo) {
    heroSmokeGeo = new THREE.BoxGeometry(0.46, 0.38, 0.46);
  }

  const puffsPerChimney = 8;
  for (let i = 0; i < puffsPerChimney; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: i % 2 === 0 ? 0xeef3f8 : 0xdbe3ec,
      transparent: true,
      opacity: 0.45,
      roughness: 1.0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(heroSmokeGeo, mat);
    mesh.position.set(wp.x, wp.y + 0.2, wp.z);
    heroSmokeGroup.add(mesh);
    const seed = idx * 17.3 + i * 2.71;
    heroSmokePuffs.push({
      mesh,
      mat,
      x: wp.x,
      y: wp.y,
      z: wp.z,
      phase: (i / puffsPerChimney + (idx * 0.19) % 1) % 1,
      speed: 0.19 + ((idx + i) % 3) * 0.02,
      driftX: 1.8 + (idx % 2) * 0.45,
      driftZ: 0.85 - (idx % 3) * 0.25,
      seed,
    });
  }
}

/**
 * Updates rising voxel smoke puffs above all hero chimneys (visible in Winter / Christmas Mode).
 */
export function updateHeroSmoke(dt, elapsedSec, isWinter) {
  if (!heroSmokeGroup) return;
  const show = !!isWinter;
  heroSmokeGroup.visible = show;
  if (!show) return;
  const tSec = Number.isFinite(elapsedSec) ? elapsedSec : 0;
  for (let i = 0; i < heroSmokePuffs.length; i++) {
    const p = heroSmokePuffs[i];
    const u = (tSec * p.speed + p.phase) % 1;
    const rise = u * 5.6;
    const curlX = Math.sin(tSec * 1.35 + p.seed) * 0.32 * u;
    const curlZ = Math.cos(tSec * 1.1 + p.seed * 1.3) * 0.26 * u;
    p.mesh.position.set(
      p.x + p.driftX * u * u + curlX,
      p.y + 0.18 + rise,
      p.z + p.driftZ * u * u + curlZ
    );
    const sc = 0.48 + u * 1.45;
    p.mesh.scale.set(sc, sc * 0.88, sc);
    p.mesh.rotation.y = tSec * 0.45 + p.seed;
    const fadeIn = Math.min(1, u / 0.12);
    const fadeOut = Math.pow(1 - u, 1.25);
    p.mat.opacity = 0.52 * fadeIn * fadeOut;
  }
}

/**
 * Toggles Winter Mode across hero landmarks (2646 Rue des Cormiers, École de la Samare, Parc Gilles-Charland patinoire).
 */
export function setWinterMode(isWinter) {
  for (let i = 0; i < heroWinterHandlers.length; i++) {
    heroWinterHandlers[i](!!isWinter);
  }
}

/**
 * Toggles Christmas Mode decorations across hero landmarks (2646 Rue des Cormiers, École de la Samare, Parc Gilles-Charland).
 */
export function setChristmasMode(isChristmas) {
  const show = !!isChristmas;
  for (let i = 0; i < heroChristmasGroups.length; i++) {
    heroChristmasGroups[i].visible = show;
  }
}

/**
 * Toggles Night Mode across hero landmarks (warm lit windows, glowing sconces/lamps/floodlights & illuminated signs).
 */
export function setNightMode(isNight) {
  const night = !!isNight;
  for (let i = 0; i < heroNightHandlers.length; i++) {
    heroNightHandlers[i](night);
  }
}

const XMAS_BULB_COLORS = [0xff2b2b, 0x22dd55, 0xffd22a, 0xfff3cc, 0x2d9cff];
let _xmasBulbMats = null;
let _xmasSharedMats = null;
function getXmasBulbMats() {
  if (!_xmasBulbMats) {
    _xmasBulbMats = XMAS_BULB_COLORS.map(
      (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.95, roughness: 0.3 })
    );
  }
  return _xmasBulbMats;
}

function getXmasSharedMats() {
  if (!_xmasSharedMats) {
    _xmasSharedMats = {
      snow: new THREE.MeshStandardMaterial({ color: 0xf4f8fc, roughness: 0.85 }),
      coal: new THREE.MeshStandardMaterial({ color: 0x1b1e23, roughness: 0.75 }),
      carrot: new THREE.MeshStandardMaterial({ color: 0xf2711c, roughness: 0.6 }),
      red: new THREE.MeshStandardMaterial({ color: 0xd61e1e, roughness: 0.45 }),
      white: new THREE.MeshStandardMaterial({ color: 0xf8f9fa, roughness: 0.45 }),
      pine: new THREE.MeshStandardMaterial({ color: 0x1b5e20, roughness: 0.85 }),
      twig: new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.9 }),
      goldGlow: new THREE.MeshStandardMaterial({
        color: 0xffe285,
        emissive: 0xffc438,
        emissiveIntensity: 1.05,
        roughness: 0.3,
      }),
      redGlow: new THREE.MeshStandardMaterial({
        color: 0xff3b3b,
        emissive: 0xff1e1e,
        emissiveIntensity: 1.25,
        roughness: 0.3,
      }),
      presentBoxes: [
        new THREE.MeshStandardMaterial({ color: 0xd62424, roughness: 0.5 }),
        new THREE.MeshStandardMaterial({ color: 0x1f8a42, roughness: 0.5 }),
        new THREE.MeshStandardMaterial({ color: 0x2463c4, roughness: 0.5 }),
        new THREE.MeshStandardMaterial({ color: 0xe6b422, roughness: 0.45 }),
      ],
      presentRibbons: [
        new THREE.MeshStandardMaterial({ color: 0xffd740, roughness: 0.35 }),
        new THREE.MeshStandardMaterial({ color: 0xe82c2c, roughness: 0.35 }),
        new THREE.MeshStandardMaterial({ color: 0xf5f7fa, roughness: 0.35 }),
        new THREE.MeshStandardMaterial({ color: 0xd61e1e, roughness: 0.35 }),
      ],
    };
  }
  return _xmasSharedMats;
}

function addChristmasStringLine(group, x0, y0, z0, x1, y1, z1, step = 0.65) {
  const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  const count = Math.max(2, Math.floor(len / step));
  const mats = getXmasBulbMats();
  const geo = new THREE.BoxGeometry(0.11, 0.11, 0.11);
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const bulb = new THREE.Mesh(geo, mats[i % mats.length]);
    bulb.position.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t);
    group.add(bulb);
  }
}

function addChristmasGarland(group, x0, y0, z0, x1, y1, z1) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz);
  const ang = Math.atan2(dz, dx);
  const sm = getXmasSharedMats();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.22, 0.22), sm.pine);
  bar.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  bar.rotation.y = -ang;
  group.add(bar);
  addChristmasStringLine(group, x0, y0 - 0.06, z0, x1, y1 - 0.06, z1, 0.48);
  // Festive red bows spaced along the pine garland
  const bowCount = Math.max(1, Math.floor(len / 1.8));
  for (let bi = 0; bi < bowCount; bi++) {
    const t = (bi + 0.5) / bowCount;
    const bow = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.28), sm.red);
    bow.position.set(x0 + dx * t, y0 + dy * t - 0.02, z0 + dz * t);
    bow.rotation.y = -ang;
    group.add(bow);
  }
}

function addChristmasWreath(group, x, y, z, rotY = 0, texLib = null) {
  const wGroup = new THREE.Group();
  wGroup.position.set(x, y, z);
  wGroup.rotation.y = rotY;
  const sm = getXmasSharedMats();
  const ringMat = texLib?.wreathTex
    ? new THREE.MeshStandardMaterial({ map: texLib.wreathTex, roughness: 0.75 })
    : sm.pine;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.08, 6, 12), ringMat);
  const bow = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.1), sm.red);
  bow.position.set(0, -0.26, 0.04);
  wGroup.add(ring, bow);
  group.add(wGroup);
}

function addVoxelSnowman(group, x, y, z, rotY = 0, scale = 1.0) {
  const sm = getXmasSharedMats();
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  g.scale.setScalar(scale);

  // 3-tier white snow body
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.68, 0.82), sm.snow);
  base.position.y = 0.34;
  base.castShadow = true;
  const mid = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.54, 0.62), sm.snow);
  mid.position.y = 0.92;
  mid.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.44), sm.snow);
  head.position.y = 1.38;
  head.castShadow = true;
  g.add(base, mid, head);

  // Red scarf around neck + hanging tail
  const scarfNeck = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.12, 0.50), sm.red);
  scarfNeck.position.y = 1.18;
  const scarfTail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.36, 0.09), sm.red);
  scarfTail.position.set(0.16, 0.98, 0.30);
  g.add(scarfNeck, scarfTail);

  // Carrot nose, coal eyes & buttons (facing +Z)
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.30), sm.carrot);
  nose.position.set(0, 1.38, 0.32);
  g.add(nose);
  for (const ex of [-0.11, 0.11]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.06), sm.coal);
    eye.position.set(ex, 1.46, 0.22);
    g.add(eye);
  }
  for (const by of [0.80, 0.96, 1.08]) {
    const btn = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.06), sm.coal);
    btn.position.set(0, by, 0.32);
    g.add(btn);
  }

  // Black top hat with red ribbon band
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.07, 0.62), sm.coal);
  brim.position.y = 1.62;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.08, 0.40), sm.red);
  band.position.y = 1.69;
  const crown = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.32, 0.38), sm.coal);
  crown.position.y = 1.88;
  g.add(brim, band, crown);

  // Twig arms
  for (const sgn of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 0.07), sm.twig);
    arm.position.set(sgn * 0.50, 1.00, 0);
    arm.rotation.z = sgn * 0.32;
    g.add(arm);
  }

  group.add(g);
}

function addCandyCane(group, x, y, z, rotY = 0, scale = 1.0) {
  const sm = getXmasSharedMats();
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  g.scale.setScalar(scale);

  // Vertical red-and-white striped shaft
  const segH = 0.22;
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, segH, 0.16),
      i % 2 === 0 ? sm.red : sm.white
    );
    seg.position.set(0, segH * 0.5 + i * segH, 0);
    seg.castShadow = true;
    g.add(seg);
  }
  // Curved voxel hook at top
  const hookCoords = [
    [0.08, 1.44, 0, true],
    [0.24, 1.54, 0, false],
    [0.40, 1.44, 0, true],
    [0.44, 1.26, 0, false],
  ];
  for (const [hx, hy, hz, isRed] of hookCoords) {
    const hSeg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.16), isRed ? sm.red : sm.white);
    hSeg.position.set(hx, hy, hz);
    g.add(hSeg);
  }
  group.add(g);
}

function addPresentBoxes(group, x, y, z, count = 4, rotY = 0) {
  const sm = getXmasSharedMats();
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  const specs = [
    [0.62, 0.44, 0.52, -0.78, 0.55, 0.2],
    [0.48, 0.54, 0.48, 0.72, 0.48, -0.35],
    [0.56, 0.36, 0.56, 0.12, 0.92, 0.15],
    [0.44, 0.42, 0.44, -0.45, -0.72, 0.4],
    [0.52, 0.48, 0.42, 0.65, -0.62, -0.2],
  ];
  const n = Math.min(count, specs.length);
  for (let i = 0; i < n; i++) {
    const [w, h, d, px, pz, ry] = specs[i];
    const boxGrp = new THREE.Group();
    boxGrp.position.set(px, h * 0.5, pz);
    boxGrp.rotation.y = ry;
    const bMat = sm.presentBoxes[i % sm.presentBoxes.length];
    const rMat = sm.presentRibbons[i % sm.presentRibbons.length];
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bMat);
    body.castShadow = true;
    const ribA = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, h + 0.03, 0.09), rMat);
    const ribB = new THREE.Mesh(new THREE.BoxGeometry(0.09, h + 0.03, d + 0.03), rMat);
    const bow = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.18), rMat);
    bow.position.y = h * 0.5 + 0.06;
    boxGrp.add(body, ribA, ribB, bow);
    g.add(boxGrp);
  }
  group.add(g);
}

function addGlowingLawnStar(group, x, y, z, rotY = 0, scale = 1.0) {
  const sm = getXmasSharedMats();
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  g.scale.setScalar(scale);

  const stake = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.05, 0.08), sm.coal);
  stake.position.y = 0.52;
  const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.05, 0.10), sm.goldGlow);
  vBar.position.y = 1.35;
  const hBar = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.16, 0.10), sm.goldGlow);
  hBar.position.y = 1.35;
  const dBar1 = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.14, 0.10), sm.goldGlow);
  dBar1.position.y = 1.35;
  dBar1.rotation.z = Math.PI / 4;
  const dBar2 = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.14, 0.10), sm.goldGlow);
  dBar2.position.y = 1.35;
  dBar2.rotation.z = -Math.PI / 4;
  g.add(stake, vBar, hBar, dBar1, dBar2);
  group.add(g);
}

function addGlowingReindeer(group, x, y, z, rotY = 0, scale = 1.0) {
  const sm = getXmasSharedMats();
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  g.scale.setScalar(scale);

  // Glowing warm-gold voxel reindeer silhouette (facing +Z)
  for (const [lx, lz] of [[-0.18, 0.36], [0.18, 0.36], [-0.18, -0.36], [0.18, -0.36]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.72, 0.09), sm.goldGlow);
    leg.position.set(lx, 0.36, lz);
    g.add(leg);
  }
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.96), sm.goldGlow);
  body.position.set(0, 0.84, 0);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.16, 0.12), sm.goldGlow);
  tail.position.set(0, 0.96, -0.52);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.48, 0.22), sm.goldGlow);
  neck.position.set(0, 1.18, 0.40);
  neck.rotation.x = 0.25;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.38), sm.goldGlow);
  head.position.set(0, 1.46, 0.56);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), sm.redGlow);
  nose.position.set(0, 1.46, 0.78);
  g.add(body, tail, neck, head, nose);
  for (const sgn of [-1, 1]) {
    const antlerMain = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.38, 0.06), sm.goldGlow);
    antlerMain.position.set(sgn * 0.16, 1.72, 0.48);
    antlerMain.rotation.z = -sgn * 0.35;
    const antlerTip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.06), sm.goldGlow);
    antlerTip.position.set(sgn * 0.24, 1.82, 0.54);
    antlerTip.rotation.z = sgn * 0.25;
    g.add(antlerMain, antlerTip);
  }
  group.add(g);
}

function addChristmasBanner(group, x, y, z, w, h, rotY, text, texLib) {
  const tex = texLib.makeBannerTexture(text, '#b81d24', '#ffe066', 384, 72);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    emissive: 0xffe8b0,
    emissiveMap: tex,
    emissiveIntensity: 0.65,
    roughness: 0.4,
  });
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.14), mat);
  board.position.set(x, y, z);
  board.rotation.y = rotY;
  group.add(board);
}

function addDecoratedChristmasTree(group, x, y, z, scale = 1.0, withPresents = true) {
  const tree = new THREE.Group();
  tree.position.set(x, y, z);
  tree.scale.setScalar(scale);
  const sm = getXmasSharedMats();
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.8, 0.32), sm.twig);
  trunk.position.y = 0.4;
  const pineMat = new THREE.MeshStandardMaterial({ color: 0x165224, roughness: 0.85 });
  const mats = getXmasBulbMats();
  const tiers = [
    [2.1, 1.1, 1.2],
    [1.6, 1.0, 2.05],
    [1.1, 0.95, 2.8],
    [0.62, 0.75, 3.45],
  ];
  tiers.forEach(([w, h, ty], ti) => {
    const tier = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), pineMat);
    tier.position.y = ty;
    tier.castShadow = true;
    tree.add(tier);
    const hw = w * 0.52;
    for (let bi = 0; bi < 4; bi++) {
      const ang = (bi * Math.PI) / 2;
      const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), mats[(ti + bi) % mats.length]);
      bulb.position.set(Math.cos(ang) * hw, ty, Math.sin(ang) * hw);
      tree.add(bulb);
    }
  });
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), sm.goldGlow);
  star.position.y = 4.05;
  tree.add(trunk, star);
  if (withPresents) {
    addPresentBoxes(tree, 0, 0, 0, 4, 0.3);
  }
  group.add(tree);
}

function getElevData(elevDataArg) {
  if (elevDataArg) return elevDataArg;
  if (typeof window !== 'undefined' && window.NEIGHBOURHOOD_DATA) {
    return window.NEIGHBOURHOOD_DATA.elevation || null;
  }
  return null;
}

function buildMiniVoxelCrown(cubes) {
  const geos = cubes.map(([w, h, d, x, y, z]) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g;
  });
  return mergeGeometries(geos);
}

function makeWorldBox(w, h, d, mat, uvScale = 1.0) {
  const geom = setWorldBoxUVs(new THREE.BoxGeometry(w, h, d), w, h, d, uvScale);
  return new THREE.Mesh(geom, mat);
}

function makeParkedCarMesh(bodyColor, snowRoofMat) {
  const car = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.42, metalness: 0.25 });
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x222a33, roughness: 0.25, metalness: 0.35 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x181a1d, roughness: 0.85 });
  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.56, 3.85), bodyMat);
  lower.position.y = 0.44;
  lower.castShadow = true;
  lower.receiveShadow = true;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.52, 2.05), cabinMat);
  cabin.position.set(0, 0.94, -0.1);
  cabin.castShadow = true;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.08, 1.92), snowRoofMat || bodyMat);
  cap.position.set(0, 1.22, -0.1);
  const wGeo = new THREE.BoxGeometry(0.18, 0.44, 0.44);
  for (const [wx, wz] of [[-0.86, 1.15], [0.86, 1.15], [-0.86, -1.15], [0.86, -1.15]]) {
    const w = new THREE.Mesh(wGeo, wheelMat);
    w.position.set(wx, 0.22, wz);
    car.add(w);
  }
  car.add(lower, cabin, cap);
  return car;
}

function addPlaygroundEquipment(group, cx, cz, subType, seed, elev = 0) {
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a6fb8, roughness: 0.5 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xd6392c, roughness: 0.45 });
  const yellowMat = new THREE.MeshStandardMaterial({ color: 0xf2b729, roughness: 0.45 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xc2c8ce, metalness: 0.65, roughness: 0.35 });

  if (subType === 'swing' || seed % 2 === 1) {
    const swing = new THREE.Group();
    swing.position.set(cx, elev, cz);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.12, 0.12), steelMat);
    bar.position.y = 2.6;
    swing.add(bar);
    for (const sx of [-2.1, 2.1]) {
      for (const sz of [-0.9, 0.9]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.10, 2.8, 0.10), frameMat);
        leg.position.set(sx, 1.35, sz * 0.5);
        leg.rotation.x = sz > 0 ? -0.32 : 0.32;
        swing.add(leg);
      }
    }
    for (const ox of [-0.9, 0.9]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 0.25), redMat);
      seat.position.set(ox, 0.65, 0);
      swing.add(seat);
      for (const cxOff of [-0.18, 0.18]) {
        const chain = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.95, 0.03), steelMat);
        chain.position.set(ox + cxOff, 1.62, 0);
        swing.add(chain);
      }
    }
    group.add(swing);
  } else {
    const structure = new THREE.Group();
    structure.position.set(cx, elev, cz);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 2.0), yellowMat);
    deck.position.y = 1.4;
    deck.castShadow = true;
    structure.add(deck);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.65, 1.1, 4), redMat);
    roof.position.y = 3.35;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    structure.add(roof);
    for (const px of [-0.88, 0.88]) {
      for (const pz of [-0.88, 0.88]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.9, 0.12), frameMat);
        post.position.set(px, 1.45, pz);
        structure.add(post);
      }
    }
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 2.4), yellowMat);
    slide.position.set(0, 0.82, 1.95);
    slide.rotation.x = 0.52;
    slide.castShadow = true;
    structure.add(slide);
    group.add(structure);
  }
}

function addSoccerGoal(group, x, z, rotY, elev = 0) {
  const goal = new THREE.Group();
  goal.position.set(x, elev, z);
  goal.rotation.y = rotY;
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf4f5f7, roughness: 0.4 });
  const netMat = new THREE.MeshStandardMaterial({
    color: 0xe6eaee,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
  });
  const w = 7.3;
  const h = 2.44;
  const d = 1.6;
  const postL = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, 0.12), postMat);
  postL.position.set(0, h / 2, -w / 2);
  const postR = postL.clone();
  postR.position.z = w / 2;
  const crossbar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, w), postMat);
  crossbar.position.set(0, h, 0);
  const netBack = new THREE.Mesh(new THREE.PlaneGeometry(w, h), netMat);
  netBack.rotation.y = Math.PI / 2;
  netBack.position.set(-d, h / 2, 0);
  goal.add(postL, postR, crossbar, netBack);
  group.add(goal);
}

/**
 * 1. Hero Residence: 2646 Rue des Cormiers + Surrounding Hero Homes (2638, 2654, 2643 Cormiers & 387 Peupliers)
 */
export function buildHero2646Cormiers(scene, texLib, b2646, elevDataArg = null) {
  heroWinterHandlers.length = 0;
  heroChristmasGroups.length = 0;
  heroNightHandlers.length = 0;
  resetHeroSmoke(scene);
  const elevData = getElevData(elevDataArg);
  const elev = sampleElevation(b2646.obbCx, b2646.obbCz, elevData);

  const root = new THREE.Group();
  root.position.set(b2646.obbCx, elev, b2646.obbCz);
  root.rotation.y = -b2646.ang;

  const whiteSiding = new THREE.MeshStandardMaterial({
    map: texLib.sidingTextures[0],
    color: 0xf4f5f2,
    roughness: 0.72,
  });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.52 });
  const taupeMat = new THREE.MeshStandardMaterial({ color: 0x7e7870, roughness: 0.7 });
  const darkTrimMat = new THREE.MeshStandardMaterial({ color: 0x3b3733, roughness: 0.65 });
  const concreteMat = new THREE.MeshStandardMaterial({ map: texLib.concreteTex, color: 0xb4b6b2, roughness: 0.9 });
  const foundMat = new THREE.MeshStandardMaterial({
    map: texLib.foundationTex || texLib.concreteTex,
    color: 0xc2c5c0,
    roughness: 0.92,
  });
  const shingleMat = new THREE.MeshStandardMaterial({ map: texLib.shingleTextures[0], roughness: 0.88 });
  registerHeroMaterialSwap(
    shingleMat,
    { map: texLib.shingleTextures[0], color: 0xffffff, roughness: 0.88 },
    { map: texLib.snowRoofTex, color: 0xeef5fc, roughness: 0.82 }
  );
  const windowMat = new THREE.MeshStandardMaterial({
    map: texLib.windowTex,
    color: 0xffffff,
    roughness: 0.25,
    metalness: 0.22,
  });
  registerHeroWindowMaterial(windowMat, texLib, 0.72, 0xffb84d);
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x26394a,
    roughness: 0.15,
    metalness: 0.45,
  });
  registerHeroWindowMaterial(glassMat, texLib, 0.62, 0xffb84d);
  const snowCarCapMat = new THREE.MeshStandardMaterial({
    color: 0x3a4048,
    roughness: 0.45,
  });
  registerHeroMaterialSwap(
    snowCarCapMat,
    { map: null, color: 0x3a4048, roughness: 0.45 },
    { map: texLib.snowTex, color: 0xeef5fc, roughness: 0.85 }
  );

  // Concrete foundation plinth extended 1.5m below grade with world-scaled foundationTex
  const foundation = makeWorldBox(8.6, 1.92, 9.6, foundMat);
  foundation.position.set(0, -0.54, -1.7);
  foundation.castShadow = true;
  foundation.receiveShadow = true;
  root.add(foundation);

  // Main 2-storey white horizontal vinyl cottage mass:
  // BOTH 1st floor (y=0.42..3.15) AND 2nd floor (y=3.29..5.72) are HOLLOW & ENTERABLE with wooden staircase & see-through windows!
  const mainH = 5.3;
  const groundH2646 = 2.73;
  const upperH2646 = mainH - groundH2646 - 0.14; // 2.43m -> upperCeilingY = 5.72m flush with mainRoof
  const [wCx2646, wCz2646] = localOffsetToWorld(b2646.obbCx, b2646.obbCz, b2646.ang, 0, -1.7);
  const shell2646 = createHollowShell({
    d: 8.5,
    w: 9.5,
    floorY: 0.42,
    groundH: groundH2646,
    upperH: upperH2646,
    stairSide: -1,
    includeRoof: false,
    includeFoundation: false,
    includeFrontSteps: false,
    frontDoorZ: 2.95, // aligns with doorZ = 1.25 (1.25 - (-1.7) = 2.95)
    frontDoorW: 1.48,
    frontDoorH: 2.25,
    backDoorZ: -0.5, // aligns with z = -2.2 directly onto backyard wooden deck
    backDoorW: 1.85,
    backDoorH: 2.20,
    frontWindows: [{ z: -2.5, w: 2.65, yBottom: 1.08, h: 1.56 }], // aligns with front bay window at z = -4.2
    backWindows: [
      { z: -2.4, w: 2.0, yBottom: 1.22, h: 1.38 },
      { z: 2.3, w: 1.8, yBottom: 1.12, h: 1.44 },
    ],
    sideWindows: {
      negZ: [
        { x: 1.4, w: 1.65, yBottom: 1.12, h: 1.42 },
        { x: -1.6, w: 1.55, yBottom: 1.12, h: 1.42 },
      ],
      posZ: [{ x: -1.8, w: 1.5, yBottom: 1.12, h: 1.42 }],
    },
    upperFrontWindows: [
      { z: 2.95, w: 1.55, yBottom: 3.68, h: 1.35 }, // above front portico at z = 1.25
      { z: -2.5, w: 2.05, yBottom: 3.68, h: 1.35 }, // into 2nd-floor front bay at z = -4.2
    ],
    upperBackWindows: [
      { z: -1.8, w: 1.85, yBottom: 3.72, h: 1.32 },
      { z: 2.0, w: 1.85, yBottom: 3.72, h: 1.32 },
    ],
    exteriorMat: whiteSiding,
    upperExteriorMat: whiteSiding,
    trimMat,
    seed: 2646,
    texLib,
    worldTransform: { cx: wCx2646, cz: wCz2646, ang: b2646.ang, elev },
  });
  shell2646.group.position.set(0, 0, -1.7);
  root.add(shell2646.group);

  const int2646 = populateHouseInterior(shell2646.group, {
    w: 9.5,
    d: 8.5,
    floorY: 0.42,
    groundH: groundH2646,
    seed: 2646,
    style: 'cottage_2s',
    frontDoorZ: 2.95,
    backDoorZ: -0.5,
    stairSide: shell2646.stairSide,
    stairwell: shell2646.stairwell,
    texLib,
  });
  const up2646 = populateUpperFloor(shell2646.group, {
    w: 9.5,
    d: 8.5,
    upperFloorY: shell2646.upperFloorY,
    upperH: upperH2646,
    seed: 2646,
    stairSide: shell2646.stairSide,
    stairwell: shell2646.stairwell,
    texLib,
  });

  registerExternalEnterable({
    id: b2646.id || 827707358,
    label: '2646 Rue des Cormiers',
    cx: wCx2646,
    cz: wCz2646,
    ang: b2646.ang,
    cosA: Math.cos(b2646.ang),
    sinA: Math.sin(b2646.ang),
    halfD: 4.25,
    halfW: 4.75,
    floorY: elev + 0.42,
    ceilingY: elev + 0.42 + groundH2646,
    hasUpperFloor: shell2646.hasUpperFloor,
    upperFloorY: elev + shell2646.upperFloorY,
    upperCeilingY: elev + shell2646.upperCeilingY,
    stair: shell2646.stair
      ? { ...shell2646.stair, y0: elev + shell2646.stair.y0, y1: elev + shell2646.stair.y1 }
      : null,
    stairwell: shell2646.stairwell,
    wallColliders: shell2646.wallColliders,
    doors: shell2646.doors,
    residents: [...int2646.residents, ...up2646.residents],
    tvScreens: [...int2646.tvScreens, ...up2646.tvScreens],
    interiorLights: [...int2646.interiorLights, ...up2646.interiorLights],
    christmasGroups: [shell2646.christmasGroup, int2646.christmasGroup],
  });

  // Side-gable main roof + white fascia & rake trim
  const mainRoofH = 2.45;
  const mainRoof = new THREE.Mesh(createPitchedRoofGeometry(8.5, 9.5, mainRoofH, false, 0.38), shingleMat);
  mainRoof.position.set(0, 0.42 + mainH, -1.7);
  mainRoof.castShadow = true;
  mainRoof.receiveShadow = true;
  const mainTrim = new THREE.Mesh(createRoofTrimGeometry(8.5, 9.5, mainRoofH, false, 0.38), trimMat);
  mainTrim.position.copy(mainRoof.position);
  root.add(mainRoof, mainTrim);

  const mainGables = new THREE.Mesh(createGableEndsGeometry(8.5, 9.5, mainRoofH), whiteSiding);
  mainGables.position.set(0, 0.42 + mainH, -1.7);
  mainGables.castShadow = true;
  root.add(mainGables);

  // Brick chimney on 2646 rear/side ridge + concrete cap & flue pot
  const chim2646BrickMat = new THREE.MeshStandardMaterial({
    map: texLib.brickTextures[3] || texLib.brickTextures[0],
    color: 0xa64d3a,
    roughness: 0.86,
  });
  const chim2646 = makeWorldBox(0.84, 2.3, 0.84, chim2646BrickMat, 1.8);
  chim2646.position.set(-1.2, 7.6, -4.4);
  chim2646.castShadow = true;
  const chim2646Cap = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.14, 0.98), concreteMat);
  chim2646Cap.position.set(-1.2, 8.82, -4.4);
  const chim2646Flue = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.42), darkTrimMat);
  chim2646Flue.position.set(-1.2, 8.98, -4.4);
  root.add(chim2646, chim2646Cap, chim2646Flue);
  registerHeroChimney(scene, root, -1.2, 9.08, -4.4);

  // Right (North, -Z) projecting 2-storey front-gabled bay (BOTH 1st & 2nd floors are hollow w/ see-through windows!)
  const bayD = 2.0;
  const bayW = 4.3;
  const bayZ = -4.2;
  const bayX = 4.1;
  const heroClearGlassMat = new THREE.MeshStandardMaterial({
    color: 0xaad0e6,
    roughness: 0.08,
    metalness: 0.22,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Hollow 1st-floor bay projection cheeks + knee-wall + header + piers framing the wide see-through bay window
  const bayCheekL = makeWorldBox(0.88, mainH, 0.24, whiteSiding);
  bayCheekL.position.set(4.68, 0.42 + mainH / 2, bayZ - bayW * 0.5 + 0.12);
  const bayCheekR = makeWorldBox(0.88, mainH, 0.24, whiteSiding);
  bayCheekR.position.set(4.68, 0.42 + mainH / 2, bayZ + bayW * 0.5 - 0.12);
  const bayApron = makeWorldBox(0.22, 0.66, bayW, whiteSiding);
  bayApron.position.set(4.99, 0.42 + 0.33, bayZ);
  const bayMidBand = makeWorldBox(0.22, 1.04, bayW, whiteSiding);
  bayMidBand.position.set(4.99, 2.65 + 0.52, bayZ);
  const bayTopHeader = makeWorldBox(0.22, 0.69, bayW, whiteSiding);
  bayTopHeader.position.set(4.99, 5.03 + 0.345, bayZ);
  const bayPierL = makeWorldBox(0.22, 1.57, 0.90, whiteSiding);
  bayPierL.position.set(4.99, 1.86, bayZ - 1.70);
  const bayPierR = makeWorldBox(0.22, 1.57, 0.90, whiteSiding);
  bayPierR.position.set(4.99, 1.86, bayZ + 1.70);
  // 2nd-floor bay piers flanking the 1.8m see-through master-bedroom window
  const bayUpPierL = makeWorldBox(0.22, 1.35, 1.25, whiteSiding);
  bayUpPierL.position.set(4.99, 4.355, bayZ - 1.525);
  const bayUpPierR = makeWorldBox(0.22, 1.35, 1.25, whiteSiding);
  bayUpPierR.position.set(4.99, 4.355, bayZ + 1.525);
  const bayFloorExt = new THREE.Mesh(
    new THREE.BoxGeometry(0.92, 0.12, bayW - 0.48),
    new THREE.MeshStandardMaterial({ color: 0xba8b54, roughness: 0.7 })
  );
  bayFloorExt.position.set(4.66, 0.38, bayZ);
  const bayUpFloorExt = new THREE.Mesh(
    new THREE.BoxGeometry(0.92, 0.14, bayW - 0.48),
    new THREE.MeshStandardMaterial({ color: 0xba8b54, roughness: 0.7 })
  );
  bayUpFloorExt.position.set(4.66, 3.22, bayZ);
  // 2nd-floor bay see-through window glass + white trim + louvered shutters
  const bayUpGlass = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.35, 1.80), heroClearGlassMat);
  bayUpGlass.position.set(5.06, 4.355, bayZ);
  const bayUpSill = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 1.98), trimMat);
  bayUpSill.position.set(5.10, 3.66, bayZ);
  const bayUpHead = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.08, 1.96), trimMat);
  bayUpHead.position.set(5.10, 5.05, bayZ);
  root.add(
    bayCheekL, bayCheekR, bayApron, bayMidBand, bayTopHeader,
    bayPierL, bayPierR, bayUpPierL, bayUpPierR,
    bayFloorExt, bayUpFloorExt, bayUpGlass, bayUpSill, bayUpHead
  );
  for (const sgn of [-1, 1]) {
    // Shutters flanking 2nd-floor bay window & right front 2nd-floor window
    const shBay = new THREE.Mesh(new THREE.BoxGeometry(0.10, 1.45, 0.40), taupeMat);
    shBay.position.set(5.12, 4.355, bayZ + sgn * 1.12);
    const shRight = new THREE.Mesh(new THREE.BoxGeometry(0.10, 1.45, 0.40), taupeMat);
    shRight.position.set(4.28, 4.355, 1.25 + sgn * 1.00);
    root.add(shBay, shRight);
  }

  const bayRoof = new THREE.Mesh(createPitchedRoofGeometry(bayW, bayD + 1.8, 1.55, false, 0.32), shingleMat);
  bayRoof.rotation.y = Math.PI / 2;
  bayRoof.position.set(bayX - 0.5, 0.42 + mainH, bayZ);
  bayRoof.castShadow = true;
  const bayTrim = new THREE.Mesh(createRoofTrimGeometry(bayW, bayD + 1.8, 1.55, false, 0.32), trimMat);
  bayTrim.rotation.y = Math.PI / 2;
  bayTrim.position.copy(bayRoof.position);
  root.add(bayRoof, bayTrim);

  const bayGable = new THREE.Mesh(createGableEndsGeometry(bayW, bayD + 1.8, 1.55), whiteSiding);
  bayGable.rotation.y = Math.PI / 2;
  bayGable.position.set(bayX - 0.5, 0.42 + mainH, bayZ);
  root.add(bayGable);

  // Window helper with detailed windowTex + crisp white sill/frame + louvered grey-taupe shutters
  const addWindow = (parent, wx, wy, wz, ww, wh, shutters = true, shutterMat = taupeMat, rotY = 0) => {
    const wg = new THREE.Group();
    wg.position.set(wx, wy, wz);
    wg.rotation.y = rotY;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.14, wh + 0.16, ww + 0.16), trimMat);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, ww + 0.24), trimMat);
    sill.position.set(0.03, -(wh * 0.5 + 0.06), 0);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.16, wh, ww), windowMat);
    pane.position.set(0.01, 0, 0);
    wg.add(frame, sill, pane);
    if (shutters) {
      for (const sgn of [-1, 1]) {
        const sh = new THREE.Mesh(new THREE.BoxGeometry(0.10, wh + 0.12, 0.40), shutterMat);
        sh.position.set(0.02, 0, sgn * (ww * 0.5 + 0.30));
        const louver = new THREE.Mesh(new THREE.BoxGeometry(0.12, wh - 0.14, 0.26), darkTrimMat);
        louver.position.set(0.025, 0, sgn * (ww * 0.5 + 0.30));
        wg.add(sh, louver);
      }
    }
    parent.add(wg);
  };

  // Projecting 3-pane SEE-THROUGH Bay Window on 1st floor of front bay (x = 5.10, y = 1.85, z = bayZ)
  const bayWinX = bayX + bayD * 0.5;
  const bayFrameBase = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 2.52), trimMat);
  bayFrameBase.position.set(bayWinX + 0.16, 1.04, bayZ);
  const bayWinRoofCap = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.14, 2.58), shingleMat);
  bayWinRoofCap.position.set(bayWinX + 0.18, 2.70, bayZ);
  const bayWinCenterPane = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.54, 1.28), heroClearGlassMat);
  bayWinCenterPane.position.set(bayWinX + 0.34, 1.86, bayZ);
  root.add(bayFrameBase, bayWinRoofCap, bayWinCenterPane);
  for (const sgn of [-1, 1]) {
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.58, 0.08), trimMat);
    mullion.position.set(bayWinX + 0.32, 1.86, bayZ + sgn * 0.64);
    const sidePaneBox = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.54, 0.56), heroClearGlassMat);
    sidePaneBox.position.set(bayWinX + 0.16, 1.86, bayZ + sgn * 0.90);
    sidePaneBox.rotation.y = sgn * 0.52;
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.58, 0.42), taupeMat);
    sh.position.set(bayWinX + 0.03, 1.85, bayZ + sgn * 1.48);
    root.add(mullion, sidePaneBox, sh);
  }

  // Front Entry Stepped Concrete Stoop + Planters + Gabled Portico (door itself is auto-opening inside shell2646!)
  const doorZ = 1.25;
  const stoop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.95, 2.1), concreteMat);
  stoop.position.set(4.95, -0.525, doorZ);
  stoop.receiveShadow = true;
  const lowerStep = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.24, 1.9), concreteMat);
  lowerStep.position.set(5.95, 0.12, doorZ);
  root.add(stoop, lowerStep);

  for (const sgn of [-1, 1]) {
    const planter = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.32), darkTrimMat);
    planter.position.set(4.65, 0.62, doorZ + sgn * 0.88);
    root.add(planter);
  }

  const porticoRoof = new THREE.Mesh(createPitchedRoofGeometry(2.1, 1.6, 0.72, false, 0.2), shingleMat);
  porticoRoof.rotation.y = Math.PI / 2;
  porticoRoof.position.set(5.0, 2.8, doorZ);
  porticoRoof.castShadow = true;
  const porticoTrim = new THREE.Mesh(createRoofTrimGeometry(2.1, 1.6, 0.72, false, 0.2), trimMat);
  porticoTrim.rotation.y = Math.PI / 2;
  porticoTrim.position.copy(porticoRoof.position);
  const porticoGable = new THREE.Mesh(createGableEndsGeometry(2.1, 1.6, 0.72), trimMat);
  porticoGable.rotation.y = Math.PI / 2;
  porticoGable.position.copy(porticoRoof.position);
  const porticoFrieze = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 1.95), trimMat);
  porticoFrieze.position.set(5.58, 2.7, doorZ);
  root.add(porticoRoof, porticoTrim, porticoGable, porticoFrieze);
  for (const pz of [doorZ - 0.85, doorZ + 0.85]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.4, 0.18), trimMat);
    post.position.set(5.55, 1.62, pz);
    post.castShadow = true;
    root.add(post);
  }

  // Attached Single-Storey Open Carport
  const cpW = 3.85;
  const cpD = 8.4;
  const cpZ = 4.95;
  const cpFloorMat = new THREE.MeshStandardMaterial({ map: texLib.drivewayTex, roughness: 0.9 });
  registerHeroMaterialSwap(
    cpFloorMat,
    { map: texLib.drivewayTex, color: 0xffffff, roughness: 0.9 },
    { map: texLib.snowRoadTex, color: 0xdde7f0, roughness: 0.86 }
  );
  const cpFloor = new THREE.Mesh(new THREE.BoxGeometry(cpD, 0.12, cpW), cpFloorMat);
  cpFloor.position.set(0, 0.04, cpZ);
  cpFloor.receiveShadow = true;
  root.add(cpFloor);

  const cpRoof = new THREE.Mesh(createPitchedRoofGeometry(cpW, cpD, 1.15, false, 0.28), shingleMat);
  cpRoof.rotation.y = Math.PI / 2;
  cpRoof.position.set(0, 2.85, cpZ);
  cpRoof.castShadow = true;
  const cpTrim = new THREE.Mesh(createRoofTrimGeometry(cpW, cpD, 1.15, false, 0.28), trimMat);
  cpTrim.rotation.y = Math.PI / 2;
  cpTrim.position.copy(cpRoof.position);
  root.add(cpRoof, cpTrim);

  const cpGable = new THREE.Mesh(createGableEndsGeometry(cpW, cpD, 1.15), whiteSiding);
  cpGable.rotation.y = Math.PI / 2;
  cpGable.position.set(0, 2.85, cpZ);
  root.add(cpGable);

  const cpBeam = new THREE.Mesh(new THREE.BoxGeometry(cpD, 0.26, 0.22), trimMat);
  cpBeam.position.set(0, 2.74, cpZ + cpW * 0.5 - 0.11);
  root.add(cpBeam);
  for (const px of [-3.9, 0, 3.9]) {
    const cpost = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.7, 0.18), trimMat);
    cpost.position.set(px, 1.35, cpZ + cpW * 0.5 - 0.12);
    cpost.castShadow = true;
    root.add(cpost);
  }

  // Street hockey net + basketball hoop inside rear of carport
  const netMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.5 });
  const hockeyNet = new THREE.Mesh(new THREE.BoxGeometry(0.65, 1.05, 1.45), netMat);
  hockeyNet.position.set(-2.6, 0.53, cpZ - 0.6);
  const bballPole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.4, 0.1), darkTrimMat);
  bballPole.position.set(-2.9, 1.2, cpZ + 0.9);
  const bballBoard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 1.05), trimMat);
  bballBoard.position.set(-2.84, 2.35, cpZ + 0.9);
  root.add(hockeyNet, bballPole, bballBoard);

  // Galvanized steel chain-link ("Frost") carport return fence & double gate (matches May 2024 Street View)
  const galvSteelMat = new THREE.MeshStandardMaterial({ color: 0xbac4ce, metalness: 0.65, roughness: 0.36 });
  const frostMeshMat = new THREE.MeshStandardMaterial({
    map: texLib.chainLinkTex,
    color: 0xffffff,
    metalness: 0.5,
    roughness: 0.4,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
  });
  const addHeroChainLinkSpan = (x, z, len, h, rotY = 0) => {
    const fg = new THREE.Group();
    fg.position.set(x, 0, z);
    fg.rotation.y = rotY;
    const panelGeo = new THREE.PlaneGeometry(len, h - 0.08);
    const uv = panelGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len * 0.9, uv.getY(i) * (h - 0.08) * 0.9);
    const panel = new THREE.Mesh(panelGeo, frostMeshMat);
    panel.position.y = h * 0.5;
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.055, 0.055), galvSteelMat);
    topRail.position.y = h - 0.03;
    const botRail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.04), galvSteelMat);
    botRail.position.y = 0.08;
    fg.add(panel, topRail, botRail);
    const postCount = Math.max(2, Math.round(len / 1.9) + 1);
    for (let pi = 0; pi < postCount; pi++) {
      const px = -len * 0.5 + (pi / (postCount - 1)) * len;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, h + 0.06, 6), galvSteelMat);
      post.position.set(px, (h + 0.06) * 0.5, 0);
      fg.add(post);
    }
    root.add(fg);
  };
  addHeroChainLinkSpan(-4.2, cpZ, cpW + 0.3, 1.55, Math.PI / 2);
  addHeroChainLinkSpan(-4.2, -7.6, 2.3, 1.55, Math.PI / 2);

  // Sculpted 3-tier cedar hedges using hedgeTex + world-scaled UVs
  const hedgeMat = new THREE.MeshStandardMaterial({ map: texLib.hedgeTex, color: 0xffffff, roughness: 0.92 });
  registerHeroMaterialSwap(
    hedgeMat,
    { map: texLib.hedgeTex, color: 0xffffff, roughness: 0.92 },
    { map: texLib.hedgeTex, color: 0x9db8a8, roughness: 0.88 }
  );
  const addSculptedHedge = (parent, cx, cz, len, thick, height, rotY = 0) => {
    const hg = new THREE.Group();
    hg.position.set(cx, 0, cz);
    hg.rotation.y = rotY;
    const base = makeWorldBox(len, height * 0.48, thick, hedgeMat);
    base.position.y = height * 0.24;
    const mid = makeWorldBox(Math.max(0.4, len - 0.18), height * 0.34, thick * 0.90, hedgeMat);
    mid.position.y = height * 0.65;
    const top = makeWorldBox(Math.max(0.3, len - 0.42), height * 0.22, thick * 0.68, hedgeMat);
    top.position.y = height * 0.91;
    base.castShadow = true;
    mid.castShadow = true;
    base.receiveShadow = true;
    hg.add(base, mid, top);
    parent.add(hg);
  };
  addSculptedHedge(root, -2.5, -8.8, 18.5, 1.28, 2.45);
  addSculptedHedge(root, -2.0, 8.9, 20.0, 1.32, 2.35);

  // Ornamental bush beside 2646 south hedge end (matches May 2024 Street View)
  const bushCrownMat = new THREE.MeshStandardMaterial({ map: texLib.leafDeciduousTex, color: 0x6ba64f, roughness: 0.88 });
  registerHeroMaterialSwap(
    bushCrownMat,
    { map: texLib.leafDeciduousTex, color: 0x6ba64f, roughness: 0.88 },
    { map: texLib.snowTex, color: 0xddeaf5, roughness: 0.85 }
  );
  const shrubMat = new THREE.MeshStandardMaterial({ map: texLib.leafDeciduousTex, color: 0x8cc26e, roughness: 0.88 });
  registerHeroMaterialSwap(
    shrubMat,
    { map: texLib.leafDeciduousTex, color: 0x8cc26e, roughness: 0.88 },
    { map: texLib.snowTex, color: 0xddeaf5, roughness: 0.85 }
  );
  const smallBushGeo = buildMiniVoxelCrown([
    [0.95, 0.72, 0.95, 0, 0.42, 0],
    [0.68, 0.48, 0.68, 0, 0.96, 0],
  ]);

  // Front foundation garden bed using mulchTex + hostas + shrubs + crabapple tree
  const mulchMat = new THREE.MeshStandardMaterial({
    map: texLib.mulchTex || texLib.concreteTex,
    color: 0xffffff,
    roughness: 0.95,
  });
  registerHeroMaterialSwap(
    mulchMat,
    { map: texLib.mulchTex || texLib.concreteTex, color: 0xffffff, roughness: 0.95 },
    { map: texLib.snowTex, color: 0xe6eff8, roughness: 0.88 }
  );
  const mulchBed = makeWorldBox(1.6, 0.12, 5.2, mulchMat);
  mulchBed.position.set(5.75, 0.06, -4.1);
  root.add(mulchBed);

  const shrubGeo = buildMiniVoxelCrown([
    [0.52, 0.45, 0.52, 0, 0.22, 0],
    [0.36, 0.36, 0.36, 0.22, 0.45, 0.12],
    [0.36, 0.34, 0.36, -0.18, 0.42, -0.14],
  ]);
  for (const sz of [-5.8, -4.7, -3.5, -2.4]) {
    const shrub = new THREE.Mesh(shrubGeo, shrubMat);
    shrub.position.set(5.8, 0.12, sz);
    shrub.castShadow = true;
    root.add(shrub);
  }
  // Hostas in front foundation bed
  for (const [hx, hz] of [[6.22, -5.2], [6.25, -4.0], [6.22, -2.8]]) {
    const hosta = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.28, 0.46), bushCrownMat);
    hosta.position.set(hx, 0.22, hz);
    root.add(hosta);
  }

  // Ornamental crabapple tree on 2646 right front lawn in circular mulch ring
  const crabMulch = makeWorldBox(1.25, 0.08, 1.25, mulchMat);
  crabMulch.position.set(9.2, 0.04, -4.5);
  const barkMat = new THREE.MeshStandardMaterial({ map: texLib.barkTex, color: 0xffffff, roughness: 0.9 });
  const frontTrunk = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.55, 0.24), barkMat);
  frontTrunk.position.set(9.2, 0.78, -4.5);
  const frontCrownGeo = buildMiniVoxelCrown([
    [1.15, 0.82, 1.15, 0, 0, 0],
    [0.85, 0.72, 0.85, 0.72, -0.06, 0.12],
    [0.85, 0.72, 0.85, -0.72, -0.04, -0.10],
    [0.85, 0.72, 0.85, 0.10, -0.06, 0.72],
    [0.85, 0.72, 0.85, -0.10, -0.06, -0.72],
    [0.92, 0.75, 0.92, 0, 0.68, 0],
  ]);
  const frontCrown = new THREE.Mesh(frontCrownGeo, bushCrownMat);
  frontCrown.position.set(9.2, 2.05, -4.5);
  frontCrown.castShadow = true;
  root.add(crabMulch, frontTrunk, frontCrown);

  // Concrete driveway curb edgings on both sides of 2646 double driveway
  for (const dz of [0.85, 6.25]) {
    const dwCurb = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.14, 0.16), concreteMat);
    dwCurb.position.set(9.8, 0.07, dz);
    root.add(dwCurb);
  }

  // Backyard cabanon shed + circular blue above-ground pool
  const cabanon = makeWorldBox(2.8, 2.35, 3.2, whiteSiding);
  cabanon.position.set(-12.2, 1.02, -4.5);
  cabanon.castShadow = true;
  const cabanonRoof = new THREE.Mesh(createPitchedRoofGeometry(2.8, 3.2, 0.85, false, 0.2), shingleMat);
  cabanonRoof.position.set(-12.2, 2.2, -4.5);
  cabanonRoof.castShadow = true;
  const cabanonTrim = new THREE.Mesh(createRoofTrimGeometry(2.8, 3.2, 0.85, false, 0.2), trimMat);
  cabanonTrim.position.copy(cabanonRoof.position);
  root.add(cabanon, cabanonRoof, cabanonTrim);

  const poolWall = new THREE.Mesh(
    new THREE.CylinderGeometry(2.45, 2.45, 1.35, 20),
    new THREE.MeshStandardMaterial({ color: 0xd9dde0, roughness: 0.65 })
  );
  poolWall.position.set(-11.2, 0.58, 2.4);
  poolWall.castShadow = true;
  const poolWaterMat = new THREE.MeshStandardMaterial({ color: 0x1b8ce0, roughness: 0.18, metalness: 0.15 });
  registerHeroMaterialSwap(
    poolWaterMat,
    { map: null, color: 0x1b8ce0, roughness: 0.18 },
    { map: texLib.winterIceTex, color: 0xd8ecfa, roughness: 0.22 }
  );
  const poolWater = new THREE.Mesh(new THREE.CylinderGeometry(2.34, 2.34, 1.37, 20), poolWaterMat);
  poolWater.position.set(-11.2, 0.58, 2.4);
  root.add(poolWall, poolWater);

  // --- 2646 Finer Street View Details ---
  // House number plaque ("2646") + TWO symmetric carriage sconces beside front door
  const numTex = texLib.makeBannerTexture('2646', '#1e2328', '#f5f6f7', 128, 64);
  const numPlaque = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.28, 0.54),
    new THREE.MeshStandardMaterial({ map: numTex, roughness: 0.4 })
  );
  numPlaque.position.set(4.32, 2.25, 0.18);
  root.add(numPlaque);
  const bulbGlowMat = new THREE.MeshStandardMaterial({ color: 0xffe4a0, emissive: 0xffb84d, emissiveIntensity: 0.35 });
  registerHeroGlowMaterial(bulbGlowMat, 0.35, 1.9, 0xffca66);
  for (const sz of [0.48, 2.02]) {
    const sconceBody = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.24, 0.14), darkTrimMat);
    sconceBody.position.set(4.34, 1.98, sz);
    const sconceBulb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.1), bulbGlowMat);
    sconceBulb.position.set(4.37, 1.92, sz);
    root.add(sconceBody, sconceBulb);
  }

  // Vertical gutter downspouts on front corners
  for (const [gx, gz, gh] of [
    [4.28, -6.32, 5.4],
    [5.12, -6.32, 5.4],
    [4.28, 2.98, 5.4],
  ]) {
    const pipe = new THREE.Mesh(new THREE.BoxGeometry(0.09, gh, 0.09), trimMat);
    pipe.position.set(gx, gh / 2 + 0.2, gz);
    const elbow = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.09), trimMat);
    elbow.position.set(gx + 0.12, 0.22, gz);
    root.add(pipe, elbow);
  }

  // Stone garden edging + colourful micro-voxel flowers in front mulch bed
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.9 });
  for (const bz of [-6.75, -1.45]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.18, 0.14), stoneMat);
    edge.position.set(5.75, 0.09, bz);
    root.add(edge);
  }
  const frontEdge = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 5.4), stoneMat);
  frontEdge.position.set(6.54, 0.09, -4.1);
  root.add(frontEdge);

  const flowerCols = [0xe84a5f, 0xf7b731, 0x9b59b6, 0xff7eb6];
  const flowerMats = flowerCols.map((c) => {
    const fm = new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, transparent: true, opacity: 1.0 });
    registerHeroMaterialSwap(fm, { color: c, opacity: 1.0 }, { color: 0xeef5fc, opacity: 0.0 });
    return fm;
  });
  for (let fi = 0; fi < 8; fi++) {
    const fz = -6.2 + fi * 0.6;
    const fx = 6.15 + (fi % 2) * 0.18;
    const fHead = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), flowerMats[fi % flowerMats.length]);
    fHead.position.set(fx, 0.24, fz);
    root.add(fHead);
  }

  // Angled stone walkway from front stoop to driveway
  for (let wi = 0; wi < 4; wi++) {
    const t = wi / 3;
    const paver = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, 0.85), stoneMat);
    paver.position.set(6.35 + t * 1.35, 0.04, 1.35 + t * 1.15);
    paver.rotation.y = -0.35;
    paver.receiveShadow = true;
    root.add(paver);
  }

  // Backyard wooden deck + patio chairs behind 2646
  const deckWoodMat = new THREE.MeshStandardMaterial({ color: 0x8f6039, roughness: 0.82 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.18, 4.4), deckWoodMat);
  deck.position.set(-6.15, 0.36, -2.2);
  deck.receiveShadow = true;
  root.add(deck);
  for (const [dx, dz] of [
    [-7.9, -4.2],
    [-7.9, -0.2],
    [-4.4, -4.2],
    [-4.4, -0.2],
  ]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.14), deckWoodMat);
    post.position.set(dx, 0.18, dz);
    root.add(post);
  }
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x2c6b9e, roughness: 0.6 });
  for (const cz of [-3.1, -1.3]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.62), chairMat);
    seat.position.set(-6.4, 0.72, cz);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.58, 0.62), chairMat);
    back.position.set(-6.68, 1.0, cz);
    root.add(seat, back);
  }
  // Propane BBQ grill + patio table + colorful umbrella on 2646's rear wooden deck
  const bbqBody = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.92, 0.95), darkTrimMat);
  bbqBody.position.set(-5.1, 0.88, -3.7);
  bbqBody.castShadow = true;
  const bbqLid = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.28, 0.88),
    new THREE.MeshStandardMaterial({ color: 0xc2c8ce, metalness: 0.65, roughness: 0.32 })
  );
  bbqLid.position.set(-5.1, 1.46, -3.7);
  const patioTbl = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.07, 10), trimMat);
  patioTbl.position.set(-6.05, 1.08, -2.2);
  const patioStem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.72, 6), darkTrimMat);
  patioStem.position.set(-6.05, 0.72, -2.2);
  const umbPole2646 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.25, 6), darkTrimMat);
  umbPole2646.position.set(-6.05, 1.56, -2.2);
  const umbTop2646 = new THREE.Mesh(
    new THREE.ConeGeometry(1.22, 0.52, 8),
    new THREE.MeshStandardMaterial({ color: 0xc84b31, roughness: 0.65 })
  );
  umbTop2646.position.set(-6.05, 2.74, -2.2);
  umbTop2646.castShadow = true;
  root.add(bbqBody, bbqLid, patioTbl, patioStem, umbPole2646, umbTop2646);

  // --- Shared Helpers for Neighboring Standalone Hero Residences ---
  const allBuildings = (typeof window !== 'undefined' && window.NEIGHBOURHOOD_DATA?.buildings) || [];
  const findHeroRec = (id, fb) => allBuildings.find((b) => b.id === id) || fb;
  const darkShingleMat = new THREE.MeshStandardMaterial({
    map: texLib.shingleTextures[1] || texLib.shingleTextures[0],
    color: 0x685546,
    roughness: 0.88,
  });
  registerHeroMaterialSwap(
    darkShingleMat,
    { map: texLib.shingleTextures[1] || texLib.shingleTextures[0], color: 0x685546, roughness: 0.88 },
    { map: texLib.snowRoofTex, color: 0xeef5fc, roughness: 0.84 }
  );
  const mossShingleMat = new THREE.MeshStandardMaterial({
    map: texLib.shingleTextures[2] || texLib.shingleTextures[0],
    color: 0x6b7362,
    roughness: 0.88,
  });
  registerHeroMaterialSwap(
    mossShingleMat,
    { map: texLib.shingleTextures[2] || texLib.shingleTextures[0], color: 0x6b7362, roughness: 0.88 },
    { map: texLib.snowRoofTex, color: 0xeef5fc, roughness: 0.84 }
  );
  const deciduousLeafMat = new THREE.MeshStandardMaterial({
    map: texLib.leafDeciduousTex,
    color: 0x5ca342,
    roughness: 0.88,
  });
  registerHeroMaterialSwap(
    deciduousLeafMat,
    { map: texLib.leafDeciduousTex, color: 0x5ca342, roughness: 0.88 },
    { map: texLib.snowTex, color: 0xddeaf5, roughness: 0.85 }
  );
  const globeMapleMat = new THREE.MeshStandardMaterial({
    map: texLib.leafDeciduousTex,
    color: 0x7bc248,
    roughness: 0.86,
  });
  registerHeroMaterialSwap(
    globeMapleMat,
    { map: texLib.leafDeciduousTex, color: 0x7bc248, roughness: 0.86 },
    { map: texLib.snowTex, color: 0xddeaf5, roughness: 0.85 }
  );
  const crimsonMapleMat = new THREE.MeshStandardMaterial({
    map: texLib.leafDeciduousTex,
    color: 0xb04856,
    roughness: 0.88,
  });
  registerHeroMaterialSwap(
    crimsonMapleMat,
    { map: texLib.leafDeciduousTex, color: 0xb04856, roughness: 0.88 },
    { map: texLib.snowTex, color: 0xddeaf5, roughness: 0.85 }
  );
  const spruceNeedlesMat = new THREE.MeshStandardMaterial({
    map: texLib.leafConiferTex,
    color: 0x3b6640,
    roughness: 0.9,
  });
  registerHeroMaterialSwap(
    spruceNeedlesMat,
    { map: texLib.leafConiferTex, color: 0x3b6640, roughness: 0.9 },
    { map: texLib.leafConiferTex, color: 0xb6d0d8, roughness: 0.86 }
  );
  const lilacFlowerMat = new THREE.MeshStandardMaterial({
    map: texLib.leafDeciduousTex,
    color: 0xb486cf,
    roughness: 0.85,
  });
  registerHeroMaterialSwap(
    lilacFlowerMat,
    { map: texLib.leafDeciduousTex, color: 0xb486cf, roughness: 0.85 },
    { map: texLib.snowTex, color: 0xddeaf5, roughness: 0.85 }
  );

  // =========================================================================
  // HERO NEIGHBOUR 1: 2638 Rue des Cormiers (id=827707311)
  // =========================================================================
  const rec2638 = findHeroRec(827707311, { obbCx: -1.13, obbCz: -21.36, ang: 6.1824 });
  const elev2638 = sampleElevation(rec2638.obbCx, rec2638.obbCz, elevData);
  const g2638 = new THREE.Group();
  g2638.position.set(rec2638.obbCx, elev2638, rec2638.obbCz);
  g2638.rotation.y = -rec2638.ang;

  const blueGreySiding = new THREE.MeshStandardMaterial({
    map: texLib.sidingTextures[2] || texLib.sidingTextures[1],
    color: 0xd2dfe9,
    roughness: 0.72,
  });
  const blueGreyTrimMat = new THREE.MeshStandardMaterial({ color: 0xe6edf2, roughness: 0.6 });

  const f2638A = makeWorldBox(9.1, 1.9, 6.75, foundMat);
  f2638A.position.set(0.0, -0.5, -2.0);
  const f2638B = makeWorldBox(6.8, 1.9, 4.05, foundMat);
  f2638B.position.set(-1.15, -0.5, 3.35);
  g2638.add(f2638A, f2638B);

  // North 2-storey projecting mass (x: -4.53..4.54, z: -5.35..1.35): HOLLOW 1st & 2nd floors + wooden stairs!
  const groundH2638 = 2.55;
  const upperH2638 = 2.16; // upperFloorY = 3.14, upperCeilingY = 5.30
  const [wCx2638, wCz2638] = localOffsetToWorld(rec2638.obbCx, rec2638.obbCz, rec2638.ang, 0.0, -2.0);
  const shell2638 = createHollowShell({
    d: 9.07,
    w: 6.70,
    floorY: 0.45,
    groundH: groundH2638,
    upperH: upperH2638,
    stairSide: -1,
    includeRoof: false,
    includeFoundation: false,
    includeFrontSteps: true,
    frontDoorZ: 1.85,
    frontDoorW: 1.44,
    frontDoorH: 2.20,
    backDoorZ: 0.35,
    backDoorW: 1.80,
    backDoorH: 2.18,
    frontWindows: [{ z: -1.1, w: 2.35, yBottom: 1.08, h: 1.38 }],
    upperFrontWindows: [
      { z: -1.4, w: 1.35, yBottom: 3.55, h: 1.25 },
      { z: 1.6, w: 1.45, yBottom: 3.55, h: 1.25 },
    ],
    exteriorMat: blueGreySiding,
    upperExteriorMat: blueGreySiding,
    trimMat,
    seed: 2638,
    texLib,
    worldTransform: { cx: wCx2638, cz: wCz2638, ang: rec2638.ang, elev: elev2638 },
  });
  shell2638.group.position.set(0.0, 0, -2.0);
  g2638.add(shell2638.group);

  const int2638 = populateHouseInterior(shell2638.group, {
    w: 6.70,
    d: 9.07,
    floorY: 0.45,
    groundH: groundH2638,
    seed: 2638,
    style: 'cottage_2s',
    frontDoorZ: 1.85,
    backDoorZ: 0.35,
    stairSide: shell2638.stairSide,
    stairwell: shell2638.stairwell,
    texLib,
  });
  const up2638 = populateUpperFloor(shell2638.group, {
    w: 6.70,
    d: 9.07,
    upperFloorY: shell2638.upperFloorY,
    upperH: upperH2638,
    seed: 2638,
    stairSide: shell2638.stairSide,
    stairwell: shell2638.stairwell,
    texLib,
  });
  const back2638 = populateDetailedBackyard(shell2638.group, {
    w: 6.70,
    d: 9.07,
    floorY: 0.45,
    backDoorZ: 0.35,
    seed: 2638,
    texLib,
  });
  registerExternalEnterable({
    id: 827707311,
    label: '2638 Rue des Cormiers',
    cx: wCx2638,
    cz: wCz2638,
    ang: rec2638.ang,
    cosA: Math.cos(rec2638.ang),
    sinA: Math.sin(rec2638.ang),
    halfD: 9.07 * 0.5,
    halfW: 6.70 * 0.5,
    floorY: elev2638 + 0.45,
    ceilingY: elev2638 + 0.45 + groundH2638,
    hasUpperFloor: shell2638.hasUpperFloor,
    upperFloorY: elev2638 + shell2638.upperFloorY,
    upperCeilingY: elev2638 + shell2638.upperCeilingY,
    stair: shell2638.stair
      ? { ...shell2638.stair, y0: elev2638 + shell2638.stair.y0, y1: elev2638 + shell2638.stair.y1 }
      : null,
    stairwell: shell2638.stairwell,
    wallColliders: shell2638.wallColliders,
    doors: shell2638.doors,
    residents: [...int2638.residents, ...up2638.residents],
    tvScreens: [...int2638.tvScreens, ...up2638.tvScreens],
    interiorLights: [...int2638.interiorLights, ...up2638.interiorLights],
    christmasGroups: [shell2638.christmasGroup, int2638.christmasGroup, back2638.christmasGroup],
  });

  const roof2638 = new THREE.Mesh(createPitchedRoofGeometry(9.07, 6.70, 2.35, false, 0.35), darkShingleMat);
  roof2638.position.set(0.0, 5.30, -2.0);
  roof2638.castShadow = true;
  const trim2638 = new THREE.Mesh(createRoofTrimGeometry(9.07, 6.70, 2.35, false, 0.35), trimMat);
  trim2638.position.copy(roof2638.position);
  const gables2638 = new THREE.Mesh(createGableEndsGeometry(9.07, 6.70, 2.35), blueGreySiding);
  gables2638.position.copy(roof2638.position);
  const chim2638 = makeWorldBox(0.75, 1.85, 0.75, darkTrimMat);
  chim2638.position.set(0.8, 6.95, -4.4);
  g2638.add(roof2638, trim2638, gables2638, chim2638);
  registerHeroChimney(scene, g2638, 0.8, 7.95, -4.4);

  // South recessed wing + open carport/garage bay + sweeping sloped roof + shed dormer
  const southWall2638 = makeWorldBox(6.73, 2.85, 4.0, blueGreySiding);
  southWall2638.position.set(-1.15, 0.45 + 1.425, 3.35);
  southWall2638.castShadow = true;
  const garageBay2638 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.15, 2.85), glassMat);
  garageBay2638.position.set(2.22, 1.45, 3.35);
  const sweepSlope2638 = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.18, 4.35), darkShingleMat);
  sweepSlope2638.position.set(-0.6, 3.85, 3.35);
  sweepSlope2638.rotation.z = -0.34;
  sweepSlope2638.castShadow = true;
  const dormerBody2638 = makeWorldBox(2.5, 1.35, 2.6, blueGreySiding);
  dormerBody2638.position.set(1.25, 4.75, 3.15);
  const dormerRoof2638 = new THREE.Mesh(createPitchedRoofGeometry(2.6, 2.7, 0.55, false, 0.16), darkShingleMat);
  dormerRoof2638.rotation.y = Math.PI / 2;
  dormerRoof2638.position.set(1.25, 5.42, 3.15);
  g2638.add(southWall2638, garageBay2638, sweepSlope2638, dormerBody2638, dormerRoof2638);

  // Corner boards & dormer window on 2638 (1st & 2nd-floor main windows are real see-through cutouts!)
  for (const cz of [-5.28, 1.28]) {
    const cornerB = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.9, 0.18), blueGreyTrimMat);
    cornerB.position.set(4.52, 2.90, cz);
    g2638.add(cornerB);
  }
  addWindow(g2638, 2.52, 4.75, 3.15, 1.15, 0.82, false);
  // Trash bins & curved front cedar hedge (leaving front entry walkway open) + red wheelbarrow
  for (const tz of [4.85, 5.5]) {
    const tbin = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 0.55), darkTrimMat);
    tbin.position.set(2.9, 0.42, tz);
    g2638.add(tbin);
  }
  addSculptedHedge(g2638, 6.8, -3.1, 4.2, 1.25, 1.72, -0.15);
  const wbTray2638 = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.36, 0.56), new THREE.MeshStandardMaterial({ color: 0xc42c24, roughness: 0.55 }));
  wbTray2638.position.set(8.6, 0.42, 6.4);
  const wbWheel2638 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.12), darkTrimMat);
  wbWheel2638.position.set(9.08, 0.16, 6.4);
  g2638.add(wbTray2638, wbWheel2638);

  const xmas2638 = new THREE.Group();
  xmas2638.visible = false;
  addChristmasStringLine(xmas2638, 4.88, 4.95, -5.2, 4.88, 4.95, 1.2, 0.52);
  addChristmasStringLine(xmas2638, 2.62, 5.42, 1.85, 2.62, 5.95, 3.15, 0.45);
  addChristmasStringLine(xmas2638, 2.62, 5.95, 3.15, 2.62, 5.42, 4.45, 0.45);
  addChristmasStringLine(xmas2638, 3.3, 2.55, 1.25, 3.3, 2.55, 5.4, 0.55);
  addChristmasGarland(xmas2638, 2.34, 2.68, 1.85, 2.34, 2.68, 4.85);
  addChristmasWreath(xmas2638, 2.26, 1.85, 3.35, Math.PI / 2, texLib);
  addCandyCane(xmas2638, 5.15, 0, 1.75, Math.PI / 2, 0.95);
  addCandyCane(xmas2638, 5.15, 0, 4.95, Math.PI / 2, 0.95);
  addGlowingReindeer(xmas2638, 7.8, 0, -2.8, Math.PI * 0.35, 1.0);
  g2638.add(xmas2638);
  heroChristmasGroups.push(xmas2638);
  scene.add(g2638);

  // =========================================================================
  // HERO NEIGHBOUR 2: 2654 Rue des Cormiers (id=827707339)
  // =========================================================================
  const rec2654 = findHeroRec(827707339, { obbCx: 0.71, obbCz: 19.57, ang: 6.2324 });
  const elev2654 = sampleElevation(rec2654.obbCx, rec2654.obbCz, elevData);
  const g2654 = new THREE.Group();
  g2654.position.set(rec2654.obbCx, elev2654, rec2654.obbCz);
  g2654.rotation.y = -rec2654.ang;

  const greyHorizSiding = new THREE.MeshStandardMaterial({
    map: texLib.sidingTextures[1] || texLib.sidingTextures[0],
    color: 0xd6dce0,
    roughness: 0.74,
  });
  const warmTaupeVert = new THREE.MeshStandardMaterial({
    map: texLib.sidingTextures[5] || texLib.sidingTextures[3],
    color: 0xb69c84,
    roughness: 0.76,
  });

  const f2654A = makeWorldBox(11.0, 2.1, 9.5, foundMat);
  f2654A.position.set(0.0, -0.45, -1.83);
  const f2654B = makeWorldBox(8.2, 2.1, 3.7, foundMat);
  f2654B.position.set(-1.35, -0.45, 4.73);
  g2654.add(f2654A, f2654B);

  // North projecting wing (x: -5.47..5.49, z: -6.56..2.90): HOLLOW enterable ground floor w/ see-through windows!
  const groundH2654 = 2.75;
  const [wCx2654, wCz2654] = localOffsetToWorld(rec2654.obbCx, rec2654.obbCz, rec2654.ang, 0.01, -1.83);
  const shell2654 = createHollowShell({
    d: 10.96,
    w: 9.46,
    floorY: 0.60,
    groundH: groundH2654,
    upperH: 0,
    includeRoof: false,
    includeFoundation: false,
    includeFrontSteps: true,
    frontDoorZ: 2.55,
    frontDoorW: 1.48,
    frontDoorH: 2.24,
    backDoorZ: -0.6,
    backDoorW: 1.85,
    backDoorH: 2.20,
    frontWindows: [
      { z: -1.75, w: 2.35, yBottom: 1.25, h: 1.42 },
      { z: 0.65, w: 1.75, yBottom: 1.25, h: 1.42 },
    ],
    exteriorMat: greyHorizSiding,
    trimMat,
    seed: 2654,
    texLib,
    worldTransform: { cx: wCx2654, cz: wCz2654, ang: rec2654.ang, elev: elev2654 },
  });
  shell2654.group.position.set(0.01, 0, -1.83);
  g2654.add(shell2654.group);

  const int2654 = populateHouseInterior(shell2654.group, {
    w: 9.46,
    d: 10.96,
    floorY: 0.60,
    groundH: groundH2654,
    seed: 2654,
    style: 'bungalow',
    frontDoorZ: 2.55,
    backDoorZ: -0.6,
    texLib,
  });
  const back2654 = populateDetailedBackyard(shell2654.group, {
    w: 9.46,
    d: 10.96,
    floorY: 0.60,
    backDoorZ: -0.6,
    seed: 2654,
    texLib,
  });
  registerExternalEnterable({
    id: 827707339,
    label: '2654 Rue des Cormiers',
    cx: wCx2654,
    cz: wCz2654,
    ang: rec2654.ang,
    cosA: Math.cos(rec2654.ang),
    sinA: Math.sin(rec2654.ang),
    halfD: 10.96 * 0.5,
    halfW: 9.46 * 0.5,
    floorY: elev2654 + 0.60,
    ceilingY: elev2654 + 0.60 + groundH2654,
    wallColliders: shell2654.wallColliders,
    doors: shell2654.doors,
    residents: int2654.residents,
    tvScreens: int2654.tvScreens,
    interiorLights: int2654.interiorLights,
    christmasGroups: [shell2654.christmasGroup, int2654.christmasGroup, back2654.christmasGroup],
  });

  // Upper frieze band (y=3.35..4.25) with warm taupe front accent beneath main roof
  const upperBand2654 = makeWorldBox(10.96, 0.90, 9.46, greyHorizSiding);
  upperBand2654.position.set(0.01, 3.35 + 0.45, -1.83);
  upperBand2654.castShadow = true;
  const frontAccent2654 = makeWorldBox(0.16, 0.90, 9.48, warmTaupeVert);
  frontAccent2654.position.set(5.43, 3.35 + 0.45, -1.83);
  g2654.add(upperBand2654, frontAccent2654);
  const roof2654 = new THREE.Mesh(createPitchedRoofGeometry(10.96, 9.46, 2.15, false, 0.35), shingleMat);
  roof2654.position.set(0.01, 4.25, -1.83);
  roof2654.castShadow = true;
  const trim2654 = new THREE.Mesh(createRoofTrimGeometry(10.96, 9.46, 2.15, false, 0.35), trimMat);
  trim2654.position.copy(roof2654.position);
  const gables2654 = new THREE.Mesh(createGableEndsGeometry(10.96, 9.46, 2.15), greyHorizSiding);
  gables2654.position.copy(roof2654.position);
  g2654.add(roof2654, trim2654, gables2654);

  // South recessed entry wing (x: -5.45..2.73, z: 2.90..6.55) + steps
  const south2654 = makeWorldBox(8.18, 3.65, 3.65, greyHorizSiding);
  south2654.position.set(-1.36, 0.6 + 1.825, 4.72);
  south2654.castShadow = true;
  const southRoof2654 = new THREE.Mesh(createPitchedRoofGeometry(9.6, 3.65, 1.45, false, 0.3), shingleMat);
  southRoof2654.position.set(-0.65, 4.25, 4.72);
  southRoof2654.castShadow = true;
  const entryDoor2654 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.08, 1.32), darkTrimMat);
  entryDoor2654.position.set(2.75, 1.68, 4.55);
  const doorGlass2654 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.45, 0.55), windowMat);
  doorGlass2654.position.set(2.76, 1.75, 4.55);
  g2654.add(south2654, southRoof2654, entryDoor2654, doorGlass2654);
  for (let si = 0; si < 3; si++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 1.65), concreteMat);
    step.position.set(2.95 + si * 0.42, 0.52 - si * 0.18, 4.55);
    step.receiveShadow = true;
    g2654.add(step);
  }

  // Towering ~8.5m multi-tier White Spruce on 2654 SE front lawn + north ornamental shrub + mulch bed
  const mulch2654 = makeWorldBox(1.4, 0.12, 5.4, mulchMat);
  mulch2654.position.set(6.2, 0.06, -3.5);
  const spruceGroup = new THREE.Group();
  spruceGroup.position.set(8.8, 0.0, 3.2);
  const spTrunk = new THREE.Mesh(new THREE.BoxGeometry(0.42, 2.2, 0.42), barkMat);
  spTrunk.position.y = 1.1;
  spruceGroup.add(spTrunk);
  for (const [sw, sh, sy] of [
    [3.8, 1.65, 1.45],
    [3.3, 1.65, 2.75],
    [2.7, 1.55, 4.05],
    [2.1, 1.5, 5.25],
    [1.45, 1.35, 6.35],
    [0.85, 1.15, 7.35],
    [0.42, 0.9, 8.15],
  ]) {
    const tier = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sw), spruceNeedlesMat);
    tier.position.y = sy;
    tier.castShadow = true;
    tier.receiveShadow = true;
    spruceGroup.add(tier);
  }
  const northShrub2654 = new THREE.Mesh(smallBushGeo, shrubMat);
  northShrub2654.scale.set(1.25, 1.35, 1.25);
  northShrub2654.position.set(7.6, 0.02, -4.2);
  const lilac2654 = new THREE.Mesh(frontCrownGeo, lilacFlowerMat);
  lilac2654.scale.setScalar(1.25);
  lilac2654.position.set(8.5, 1.25, 11.2);
  lilac2654.castShadow = true;
  g2654.add(mulch2654, spruceGroup, northShrub2654, lilac2654);

  const xmas2654 = new THREE.Group();
  xmas2654.visible = false;
  addChristmasStringLine(xmas2654, 5.82, 4.2, -6.4, 5.82, 4.2, 2.8, 0.52);
  addChristmasStringLine(xmas2654, 4.35, 4.2, 2.9, 4.35, 4.2, 6.5, 0.52);
  addChristmasGarland(xmas2654, 2.9, 2.85, 3.45, 2.9, 2.85, 5.65);
  addChristmasWreath(xmas2654, 2.86, 1.95, 4.55, Math.PI / 2, texLib);
  addCandyCane(xmas2654, 4.45, 0, 3.55, Math.PI / 2, 0.95);
  addCandyCane(xmas2654, 4.45, 0, 5.55, Math.PI / 2, 0.95);
  addGlowingLawnStar(xmas2654, 7.2, 0, -1.5, Math.PI / 2, 1.05);
  // Festive spiral lights, golden star & wrapped presents on 2654's towering SE White Spruce
  const spruceStar = new THREE.Mesh(new THREE.OctahedronGeometry(0.36, 0), getXmasSharedMats().goldGlow);
  spruceStar.position.set(8.8, 8.95, 3.2);
  xmas2654.add(spruceStar);
  for (const [sw, sy] of [[3.9, 1.45], [3.4, 2.75], [2.8, 4.05], [2.2, 5.25], [1.55, 6.35], [0.95, 7.35]]) {
    const r = sw * 0.52;
    addChristmasStringLine(xmas2654, 8.8 - r, sy, 3.2 - r, 8.8 + r, sy, 3.2 - r, 0.72);
    addChristmasStringLine(xmas2654, 8.8 + r, sy, 3.2 - r, 8.8 + r, sy, 3.2 + r, 0.72);
    addChristmasStringLine(xmas2654, 8.8 + r, sy, 3.2 + r, 8.8 - r, sy, 3.2 + r, 0.72);
    addChristmasStringLine(xmas2654, 8.8 - r, sy, 3.2 + r, 8.8 - r, sy, 3.2 - r, 0.72);
  }
  addPresentBoxes(xmas2654, 8.8, 0, 3.2, 5, 0.4);
  g2654.add(xmas2654);
  heroChristmasGroups.push(xmas2654);
  scene.add(g2654);

  // =========================================================================
  // HERO NEIGHBOUR 3: 2643 Rue des Cormiers (id=827707342)
  // =========================================================================
  const rec2643 = findHeroRec(827707342, { obbCx: 41.34, obbCz: -2.11, ang: 3.0608 });
  const elev2643 = sampleElevation(rec2643.obbCx, rec2643.obbCz, elevData);
  const g2643 = new THREE.Group();
  g2643.position.set(rec2643.obbCx, elev2643, rec2643.obbCz);
  g2643.rotation.y = -rec2643.ang;

  const creamBrickMat = new THREE.MeshStandardMaterial({
    map: texLib.brickTextures[0],
    color: 0xe3d8c3,
    roughness: 0.85,
  });
  const garageDoorMat = new THREE.MeshStandardMaterial({
    map: texLib.garageDoorTex || null,
    color: 0xf4f5f2,
    roughness: 0.6,
  });

  // Left/North 2-storey Garage Wing (x: -5.46..5.47, z: 1.55..5.34)
  const garBase2643 = makeWorldBox(10.93, 4.35, 3.79, creamBrickMat, 1.8);
  garBase2643.position.set(0.0, 0.675, 3.45);
  garBase2643.castShadow = true;
  const garUpper2643 = makeWorldBox(10.93, 2.8, 3.79, whiteSiding);
  garUpper2643.position.set(0.0, 2.85 + 1.4, 3.45);
  garUpper2643.castShadow = true;
  const garRoof2643 = new THREE.Mesh(createPitchedRoofGeometry(10.93, 3.85, 2.05, false, 0.35), darkShingleMat);
  garRoof2643.position.set(0.0, 5.65, 3.45);
  garRoof2643.castShadow = true;
  const garTrim2643 = new THREE.Mesh(createRoofTrimGeometry(10.93, 3.85, 2.05, false, 0.35), trimMat);
  garTrim2643.position.copy(garRoof2643.position);
  const garDoor2643 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.15, 2.55), garageDoorMat);
  garDoor2643.position.set(5.48, 1.15, 3.45);
  g2643.add(garBase2643, garUpper2643, garRoof2643, garTrim2643, garDoor2643);
  addWindow(g2643, 5.49, 4.35, 2.85, 0.72, 1.32, false);
  addWindow(g2643, 5.49, 4.35, 3.95, 0.72, 1.32, false);

  // Center Entry Tower + South Split-Level Living Wing: unified HOLLOW enterable ground floor (x:-5.45..4.25, z:-5.35..1.55)
  const groundH2643 = 2.75;
  const [wCx2643, wCz2643] = localOffsetToWorld(rec2643.obbCx, rec2643.obbCz, rec2643.ang, -0.6, -1.90);
  const shell2643 = createHollowShell({
    d: 9.7,
    w: 6.90,
    floorY: 0.42,
    groundH: groundH2643,
    upperH: 0,
    includeRoof: false,
    includeFoundation: false,
    includeFrontSteps: false,
    frontDoorZ: 2.05, // aligns with z = 0.15 on towerStoop2643
    frontDoorW: 1.44,
    frontDoorH: 2.24,
    backDoorZ: -0.8,
    backDoorW: 1.85,
    backDoorH: 2.20,
    frontWindows: [{ z: -0.95, w: 2.85, yBottom: 1.12, h: 1.48 }], // huge living room picture window at z = -2.85
    exteriorMat: whiteSiding,
    trimMat,
    seed: 2643,
    texLib,
    worldTransform: { cx: wCx2643, cz: wCz2643, ang: rec2643.ang, elev: elev2643 },
  });
  shell2643.group.position.set(-0.6, 0, -1.90);
  g2643.add(shell2643.group);

  const int2643 = populateHouseInterior(shell2643.group, {
    w: 6.90,
    d: 9.7,
    floorY: 0.42,
    groundH: groundH2643,
    seed: 2643,
    style: 'splitlevel',
    frontDoorZ: 2.05,
    backDoorZ: -0.8,
    texLib,
  });
  const back2643 = populateDetailedBackyard(shell2643.group, {
    w: 6.90,
    d: 9.7,
    floorY: 0.42,
    backDoorZ: -0.8,
    seed: 2643,
    texLib,
  });
  registerExternalEnterable({
    id: 827707342,
    label: '2643 Rue des Cormiers',
    cx: wCx2643,
    cz: wCz2643,
    ang: rec2643.ang,
    cosA: Math.cos(rec2643.ang),
    sinA: Math.sin(rec2643.ang),
    halfD: 9.7 * 0.5,
    halfW: 6.90 * 0.5,
    floorY: elev2643 + 0.42,
    ceilingY: elev2643 + 0.42 + groundH2643,
    wallColliders: shell2643.wallColliders,
    doors: shell2643.doors,
    residents: int2643.residents,
    tvScreens: int2643.tvScreens,
    interiorLights: int2643.interiorLights,
    christmasGroups: [shell2643.christmasGroup, int2643.christmasGroup, back2643.christmasGroup],
  });

  // Upper Cathedral-Gable Entry Tower above hollow ground floor (y=3.17..5.80)
  const towerUpper2643 = makeWorldBox(10.93, 2.63, 2.66, creamBrickMat, 1.8);
  towerUpper2643.position.set(0.0, 3.17 + 1.315, 0.22);
  towerUpper2643.castShadow = true;
  const towerPier2643 = makeWorldBox(0.45, 3.17, 0.45, creamBrickMat, 1.8);
  towerPier2643.position.set(5.22, 1.585, 1.32);
  const towerStoop2643 = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.36, 2.65), concreteMat);
  towerStoop2643.position.set(4.95, 0.18, 0.22);
  const towerGableRoof = new THREE.Mesh(createPitchedRoofGeometry(2.66, 5.8, 1.55, false, 0.28), darkShingleMat);
  towerGableRoof.rotation.y = Math.PI / 2;
  towerGableRoof.position.set(2.57, 5.8, 0.22);
  towerGableRoof.castShadow = true;
  const towerGableTrim = new THREE.Mesh(createRoofTrimGeometry(2.66, 5.8, 1.55, false, 0.28), trimMat);
  towerGableTrim.rotation.y = Math.PI / 2;
  towerGableTrim.position.copy(towerGableRoof.position);
  const towerGableFace = new THREE.Mesh(createGableEndsGeometry(2.66, 5.8, 1.55, 0.45), creamBrickMat);
  towerGableFace.rotation.y = Math.PI / 2;
  towerGableFace.position.copy(towerGableRoof.position);
  g2643.add(
    towerUpper2643, towerPier2643, towerStoop2643,
    towerGableRoof, towerGableTrim, towerGableFace
  );
  // Twin tall cathedral windows in front peak
  addWindow(g2643, 5.49, 4.45, -0.32, 0.78, 1.95, false);
  addWindow(g2643, 5.49, 4.45, 0.56, 0.78, 1.95, false);

  // Right/South Recessed Split-Level Living Wing foundation, frieze band, pilaster, chimney & roof
  const wingFound2643 = makeWorldBox(9.7, 1.9, 6.90, foundMat);
  wingFound2643.position.set(-0.6, -0.53, -1.90);
  const wingFrieze2643 = makeWorldBox(9.7, 0.68, 4.24, whiteSiding);
  wingFrieze2643.position.set(-0.6, 3.17 + 0.34, -3.23);
  wingFrieze2643.castShadow = true;
  const wingPilaster2643 = makeWorldBox(0.6, 3.85, 0.65, creamBrickMat, 1.8);
  wingPilaster2643.position.set(4.02, 1.92, -5.08);
  const chim2643 = makeWorldBox(0.95, 6.7, 0.75, creamBrickMat, 1.8);
  chim2643.position.set(2.4, 3.35, -5.45);
  chim2643.castShadow = true;
  registerHeroChimney(scene, g2643, 2.4, 6.78, -5.45);
  const wingRoof2643 = new THREE.Mesh(createPitchedRoofGeometry(9.7, 4.24, 1.85, false, 0.32), darkShingleMat);
  wingRoof2643.position.set(-0.6, 3.85, -3.23);
  wingRoof2643.castShadow = true;
  const wingTrim2643 = new THREE.Mesh(createRoofTrimGeometry(9.7, 4.24, 1.85, false, 0.32), trimMat);
  wingTrim2643.position.copy(wingRoof2643.position);
  g2643.add(wingFound2643, wingFrieze2643, wingPilaster2643, chim2643, wingRoof2643, wingTrim2643);

  // 2643 Landscaping: rounded north driveway hedge, trash bin, long low south side hedge & ~11m Sugar Maple
  addSculptedHedge(g2643, 7.2, 6.5, 4.6, 1.4, 1.85, 0.08);
  addSculptedHedge(g2643, 1.5, -8.4, 8.6, 1.25, 1.45, 0.04);
  const bin2643 = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.92, 0.58), darkTrimMat);
  bin2643.position.set(5.8, 0.46, 5.55);
  g2643.add(bin2643);

  const sugarMaple = new THREE.Group();
  sugarMaple.position.set(-1.5, 0.0, -9.6);
  const smTrunk = new THREE.Mesh(new THREE.BoxGeometry(0.55, 4.2, 0.55), barkMat);
  smTrunk.position.y = 2.1;
  smTrunk.castShadow = true;
  const smCrownGeo = buildMiniVoxelCrown([
    [5.4, 3.8, 5.4, 0, 5.8, 0],
    [4.4, 3.4, 4.4, 2.4, 5.3, 0.8],
    [4.4, 3.4, 4.4, -2.2, 5.5, -0.6],
    [4.0, 3.2, 4.0, 0.4, 7.4, -0.3],
  ]);
  const smCrown = new THREE.Mesh(smCrownGeo, deciduousLeafMat);
  smCrown.castShadow = true;
  sugarMaple.add(smTrunk, smCrown);
  g2643.add(sugarMaple);

  // Porch sconce at 2643 entry
  const sconce2643 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.12), bulbGlowMat);
  sconce2643.position.set(4.42, 2.05, 0.92);
  g2643.add(sconce2643);

  const xmas2643 = new THREE.Group();
  xmas2643.visible = false;
  addChristmasStringLine(xmas2643, 5.65, 5.65, 1.6, 5.65, 5.65, 5.2, 0.52);
  addChristmasStringLine(xmas2643, 5.65, 5.8, -1.1, 5.65, 7.25, 0.22, 0.48);
  addChristmasStringLine(xmas2643, 5.65, 7.25, 0.22, 5.65, 5.8, 1.55, 0.48);
  addChristmasStringLine(xmas2643, 4.48, 3.85, -5.3, 4.48, 3.85, -1.1, 0.52);
  addChristmasGarland(xmas2643, 5.45, 2.75, -1.0, 5.45, 2.75, 1.45);
  addChristmasWreath(xmas2643, 4.44, 2.88, 0.15, Math.PI / 2, texLib);
  addVoxelSnowman(xmas2643, 7.2, 0, -2.8, Math.PI / 2, 1.05);
  addCandyCane(xmas2643, 5.85, 0, -0.75, Math.PI / 2, 0.95);
  addCandyCane(xmas2643, 5.85, 0, 1.2, Math.PI / 2, 0.95);
  addGlowingReindeer(xmas2643, 7.4, 0, -5.2, Math.PI * 0.65, 1.0);
  g2643.add(xmas2643);
  heroChristmasGroups.push(xmas2643);
  scene.add(g2643);

  // World-space crushed-gravel driveway for 2643 Cormiers
  const gravelMat = new THREE.MeshStandardMaterial({
    map: texLib.gravelTex || texLib.concreteTex,
    color: 0xd8dad6,
    roughness: 0.94,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  registerHeroMaterialSwap(
    gravelMat,
    { map: texLib.gravelTex || texLib.concreteTex, color: 0xd8dad6, roughness: 0.94 },
    { map: texLib.snowRoadTex, color: 0xdde7f0, roughness: 0.86 }
  );
  const dw2643Geo = createRibbonGeometry([[37.61, -4.81], [22.07, -3.79]], 3.7, 0.056, 6, elevData);
  if (dw2643Geo) {
    const dw2643Mesh = new THREE.Mesh(dw2643Geo, gravelMat);
    dw2643Mesh.receiveShadow = true;
    scene.add(dw2643Mesh);
  }

  // World-space red fire hydrant ringed with hostas + small yellow sign at 2643 SW corner (Cormiers & Peupliers)
  const hydX = 26.8, hydZ = 17.5;
  const hydElev = sampleElevation(hydX, hydZ, elevData);
  const hydrantGrp = new THREE.Group();
  hydrantGrp.position.set(hydX, hydElev, hydZ);
  const hydRed = new THREE.MeshStandardMaterial({ color: 0xd42222, roughness: 0.4 });
  const hydBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.78, 8), hydRed);
  hydBody.position.y = 0.42;
  hydBody.castShadow = true;
  const hydCap = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.18, 0.16, 8), hydRed);
  hydCap.position.y = 0.88;
  const hydNoz = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.14), hydRed);
  hydNoz.position.y = 0.56;
  hydrantGrp.add(hydBody, hydCap, hydNoz);
  for (let hi = 0; hi < 6; hi++) {
    const ha = (hi / 6) * Math.PI * 2;
    const hosta = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.20, 0.28), bushCrownMat);
    hosta.position.set(Math.cos(ha) * 0.34, 0.1, Math.sin(ha) * 0.34);
    hydrantGrp.add(hosta);
  }
  const hydSignPost = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.9, 0.06), concreteMat);
  hydSignPost.position.set(-0.65, 0.95, -0.35);
  const hydSignPlate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.38, 0.04), new THREE.MeshStandardMaterial({ color: 0xf4c424, roughness: 0.45 }));
  hydSignPlate.position.set(-0.65, 1.75, -0.35);
  hydrantGrp.add(hydSignPost, hydSignPlate);
  scene.add(hydrantGrp);

  // =========================================================================
  // HERO NEIGHBOUR 4: 387 Rue des Peupliers Quadruplex (id=827707441)
  // =========================================================================
  const rec387 = findHeroRec(827707441, { obbCx: 80.07, obbCz: -3.10, ang: 6.2524 });
  const elev387 = sampleElevation(rec387.obbCx, rec387.obbCz, elevData);
  const g387 = new THREE.Group();
  g387.position.set(rec387.obbCx, elev387, rec387.obbCz);
  g387.rotation.y = -rec387.ang;

  const redBrickMat = new THREE.MeshStandardMaterial({
    map: texLib.brickTextures[3] || texLib.brickTextures[0],
    color: 0xa04c38,
    roughness: 0.84,
  });
  const forestTrimMat = new THREE.MeshStandardMaterial({ color: 0x264c36, roughness: 0.58 });

  // Foundation plinths + exact L-notched footprint (main x:-5.8..5.8, z:-3.8..7.7 + NE wing x:-2.9..5.8, z:-7.7..-3.8)
  const f387A = makeWorldBox(11.65, 1.95, 11.55, foundMat);
  f387A.position.set(0.0, -0.5, 1.95);
  const f387B = makeWorldBox(8.75, 1.95, 3.95, foundMat);
  f387B.position.set(1.45, -0.5, -5.75);
  g387.add(f387A, f387B);

  // Hollow enterable 1st & 2nd-floor quadruplex units (y=0.45..5.35) + wooden stairs!
  const groundH387 = 2.65;
  const upperH387 = 2.11; // upperFloorY = 3.24, upperCeilingY = 5.35 flush with vinylTopA
  const [wCx387, wCz387] = localOffsetToWorld(rec387.obbCx, rec387.obbCz, rec387.ang, 0.0, 1.95);
  const shell387 = createHollowShell({
    d: 11.6,
    w: 11.5,
    floorY: 0.45,
    groundH: groundH387,
    upperH: upperH387,
    stairSide: -1,
    includeRoof: false,
    includeFoundation: false,
    includeFrontSteps: true,
    frontDoorZ: 1.5,
    frontDoorW: 1.48,
    frontDoorH: 2.24,
    backDoorZ: 2.85,
    backDoorW: 1.85,
    backDoorH: 2.20,
    frontWindows: [
      { z: -2.8, w: 2.2, yBottom: 1.15, h: 1.42 },
      { z: 3.8, w: 2.0, yBottom: 1.15, h: 1.42 },
    ],
    sideWindows: {
      posZ: [
        { x: -3.2, w: 1.8, yBottom: 1.15, h: 1.42 },
        { x: 0.2, w: 2.1, yBottom: 1.15, h: 1.42 },
        { x: 3.4, w: 1.8, yBottom: 1.15, h: 1.42 },
      ],
      negZ: [{ x: -1.5, w: 1.8, yBottom: 1.15, h: 1.42 }],
    },
    upperFrontWindows: [
      { z: -3.15, w: 1.45, yBottom: 3.55, h: 1.3 },
      { z: 0.45, w: 1.45, yBottom: 3.55, h: 1.3 },
      { z: 3.25, w: 1.45, yBottom: 3.55, h: 1.3 },
    ],
    upperSideWindows: {
      posZ: [
        { x: -3.4, w: 1.45, yBottom: 3.55, h: 1.3 },
        { x: 0.0, w: 1.45, yBottom: 3.55, h: 1.3 },
        { x: 3.4, w: 1.45, yBottom: 3.55, h: 1.3 },
      ],
      negZ: [{ x: -1.5, w: 1.5, yBottom: 3.55, h: 1.3 }],
    },
    exteriorMat: redBrickMat,
    upperExteriorMat: redBrickMat,
    trimMat: forestTrimMat,
    seed: 387,
    texLib,
    worldTransform: { cx: wCx387, cz: wCz387, ang: rec387.ang, elev: elev387 },
  });
  shell387.group.position.set(0.0, 0, 1.95);
  g387.add(shell387.group);

  const int387 = populateHouseInterior(shell387.group, {
    w: 11.5,
    d: 11.6,
    floorY: 0.45,
    groundH: groundH387,
    seed: 387,
    style: 'quadruplex',
    frontDoorZ: 1.5,
    backDoorZ: 2.85,
    stairSide: shell387.stairSide,
    stairwell: shell387.stairwell,
    texLib,
  });
  const up387 = populateUpperFloor(shell387.group, {
    w: 11.5,
    d: 11.6,
    upperFloorY: shell387.upperFloorY,
    upperH: upperH387,
    seed: 387,
    stairSide: shell387.stairSide,
    stairwell: shell387.stairwell,
    texLib,
  });
  const back387 = populateDetailedBackyard(shell387.group, {
    w: 11.5,
    d: 11.6,
    floorY: 0.45,
    backDoorZ: 2.85,
    seed: 387,
    texLib,
    skipPool: true,
  });
  registerExternalEnterable({
    id: 827707441,
    label: '387 Rue des Peupliers',
    cx: wCx387,
    cz: wCz387,
    ang: rec387.ang,
    cosA: Math.cos(rec387.ang),
    sinA: Math.sin(rec387.ang),
    halfD: 11.6 * 0.5,
    halfW: 11.5 * 0.5,
    floorY: elev387 + 0.45,
    ceilingY: elev387 + 0.45 + groundH387,
    hasUpperFloor: shell387.hasUpperFloor,
    upperFloorY: elev387 + shell387.upperFloorY,
    upperCeilingY: elev387 + shell387.upperCeilingY,
    stair: shell387.stair
      ? { ...shell387.stair, y0: elev387 + shell387.stair.y0, y1: elev387 + shell387.stair.y1 }
      : null,
    stairwell: shell387.stairwell,
    wallColliders: shell387.wallColliders,
    doors: shell387.doors,
    residents: [...int387.residents, ...up387.residents],
    tvScreens: [...int387.tvScreens, ...up387.tvScreens],
    interiorLights: [...int387.interiorLights, ...up387.interiorLights],
    christmasGroups: [shell387.christmasGroup, int387.christmasGroup, back387.christmasGroup],
  });

  const brickLowerB = makeWorldBox(8.7, 4.9, 3.9, redBrickMat, 1.8);
  brickLowerB.position.set(1.45, 0.45 + 2.45, -5.75);
  brickLowerB.castShadow = true;
  brickLowerB.receiveShadow = true;
  const vinylTopA = makeWorldBox(11.6, 2.5, 11.5, whiteSiding);
  vinylTopA.position.set(0.0, 5.35 + 1.25, 1.95);
  vinylTopA.castShadow = true;
  const vinylTopB = makeWorldBox(8.7, 2.5, 3.9, whiteSiding);
  vinylTopB.position.set(1.45, 5.35 + 1.25, -5.75);
  vinylTopB.castShadow = true;
  g387.add(brickLowerB, vinylTopA, vinylTopB);

  // Moss-grey hip roofs + white eave fascia + South & East white front pediment gables
  const hipRoofA = new THREE.Mesh(createPitchedRoofGeometry(11.6, 11.5, 2.45, true, 0.42), mossShingleMat);
  hipRoofA.position.set(0.0, 7.85, 1.95);
  hipRoofA.castShadow = true;
  const hipTrimA = new THREE.Mesh(createRoofTrimGeometry(11.6, 11.5, 2.45, true, 0.42), trimMat);
  hipTrimA.position.copy(hipRoofA.position);
  const hipRoofB = new THREE.Mesh(createPitchedRoofGeometry(8.7, 4.2, 1.85, true, 0.38), mossShingleMat);
  hipRoofB.position.set(1.45, 7.85, -5.75);
  const pedSouthRoof = new THREE.Mesh(createPitchedRoofGeometry(4.4, 2.8, 1.25, false, 0.25), mossShingleMat);
  pedSouthRoof.position.set(0.0, 7.85, 6.5);
  const pedSouthFace = new THREE.Mesh(createGableEndsGeometry(4.4, 2.8, 1.25), whiteSiding);
  pedSouthFace.position.set(0.0, 7.85, 6.5);
  const pedEastRoof = new THREE.Mesh(createPitchedRoofGeometry(4.4, 2.8, 1.25, false, 0.25), mossShingleMat);
  pedEastRoof.rotation.y = Math.PI / 2;
  pedEastRoof.position.set(4.5, 7.85, 1.8);
  const pedEastFace = new THREE.Mesh(createGableEndsGeometry(4.4, 2.8, 1.25), whiteSiding);
  pedEastFace.rotation.y = Math.PI / 2;
  pedEastFace.position.set(4.5, 7.85, 1.8);
  g387.add(hipRoofA, hipTrimA, hipRoofB, pedSouthRoof, pedSouthFace, pedEastRoof, pedEastFace);

  // Forest-green trimmed windows on South (Rue des Peupliers), East (Rue Allard), and West walls
  const addQuadWin = (wx, wy, wz, ww, wh, rotY = 0) => {
    addWindow(g387, wx, wy, wz, ww, wh, false, forestTrimMat, rotY);
    const gTr = new THREE.Mesh(new THREE.BoxGeometry(0.16, wh + 0.22, ww + 0.22), forestTrimMat);
    gTr.position.set(wx, wy, wz);
    gTr.rotation.y = rotY;
    g387.add(gTr);
  };
  for (const wx of [-3.4, 0.0, 3.4]) {
    addQuadWin(wx, 6.6, 7.72, 1.45, 1.3, -Math.PI / 2);
  }
  for (const ez of [-4.6, -1.2, 2.4, 5.2]) {
    addQuadWin(5.82, 6.6, ez, 1.35, 1.3, 0);
  }
  addQuadWin(5.82, 3.85, -4.6, 1.35, 1.3, 0);

  // Stacked SW Corner Balconies (x: -7.5..-5.8, z: 2.6..7.4) with brick pier & white railings
  const pier387 = makeWorldBox(0.62, 5.65, 0.62, redBrickMat);
  pier387.position.set(-7.22, 2.82, 7.12);
  pier387.castShadow = true;
  g387.add(pier387);
  for (const by of [2.65, 5.25]) {
    const deckB = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.16, 4.8), trimMat);
    deckB.position.set(-6.68, by, 5.0);
    deckB.castShadow = true;
    const railF = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.92, 4.8), trimMat);
    railF.position.set(-7.52, by + 0.54, 5.0);
    const railS = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.92, 0.08), trimMat);
    railS.position.set(-6.68, by + 0.54, 7.36);
    const patDoor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.05, 1.65), windowMat);
    patDoor.position.set(-5.82, by + 1.05, 4.8);
    g387.add(deckB, railF, railS, patDoor);
  }

  // Signature Trees beside 387 Peupliers: Globe Maple (SE), Crimson King Maple (NE), Pyramidal Cedar + hedge (W)
  const globeTrunk = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.9, 0.45), barkMat);
  globeTrunk.position.set(5.2, 0.95, 11.4);
  const globeCrownGeo = buildMiniVoxelCrown([
    [4.4, 3.2, 4.4, 0, 3.6, 0],
    [5.2, 2.2, 3.6, 0, 3.4, 0],
    [3.6, 2.2, 5.2, 0, 3.4, 0],
    [3.2, 1.2, 3.2, 0, 5.1, 0],
  ]);
  const globeCrown = new THREE.Mesh(globeCrownGeo, globeMapleMat);
  globeCrown.position.set(5.2, 0.0, 11.4);
  globeCrown.castShadow = true;

  const crimTrunk = new THREE.Mesh(new THREE.BoxGeometry(0.38, 2.2, 0.38), barkMat);
  crimTrunk.position.set(9.8, 1.1, -3.0);
  const crimCrown = new THREE.Mesh(globeCrownGeo, crimsonMapleMat);
  crimCrown.scale.setScalar(0.85);
  crimCrown.position.set(9.8, 0.4, -3.0);
  crimCrown.castShadow = true;

  const xmas387 = new THREE.Group();
  xmas387.visible = false;
  // Upper & lower SW stacked balcony string lights + red-bow garlands
  addChristmasStringLine(xmas387, -7.55, 6.22, 2.6, -7.55, 6.22, 7.4, 0.48);
  addChristmasStringLine(xmas387, -7.55, 6.22, 7.4, -5.8, 6.22, 7.4, 0.48);
  addChristmasStringLine(xmas387, -7.55, 3.62, 2.6, -7.55, 3.62, 7.4, 0.48);
  addChristmasGarland(xmas387, -7.58, 3.6, 2.7, -7.58, 3.6, 7.3);
  // South & East main eaves + white pediment gable peaks
  addChristmasStringLine(xmas387, -5.85, 7.82, 7.75, 5.85, 7.82, 7.75, 0.6);
  addChristmasStringLine(xmas387, 5.88, 7.82, -7.6, 5.88, 7.82, 7.75, 0.6);
  addChristmasStringLine(xmas387, -2.2, 7.85, 7.95, 0.0, 9.1, 7.95, 0.45);
  addChristmasStringLine(xmas387, 0.0, 9.1, 7.95, 2.2, 7.85, 7.95, 0.45);
  addChristmasStringLine(xmas387, 5.95, 7.85, -0.4, 5.95, 9.1, 1.8, 0.45);
  addChristmasStringLine(xmas387, 5.95, 9.1, 1.8, 5.95, 7.85, 4.0, 0.45);
  addChristmasWreath(xmas387, -5.9, 1.85, 4.8, -Math.PI / 2, texLib);
  // Snowman, candy canes & glowing star on SE/East green lawn
  addVoxelSnowman(xmas387, 7.4, 0, 8.2, 0.35, 1.05);
  addCandyCane(xmas387, 6.3, 0, 7.6, 0, 0.95);
  addCandyCane(xmas387, 8.4, 0, 7.6, Math.PI, 0.95);
  addGlowingLawnStar(xmas387, 7.8, 0, 2.2, Math.PI / 2, 1.05);
  g387.add(globeTrunk, globeCrown, crimTrunk, crimCrown, xmas387);
  heroChristmasGroups.push(xmas387);
  scene.add(g387);

  // World-space South Asphalt Parking Pad + 2 Bright-Red Compact Cars + Pyramidal Cedar on W Edge
  const lot387Pts = [[72.5, 4.5], [83.2, 4.5], [83.4, 17.2], [72.5, 17.2]];
  const lot387Mat = new THREE.MeshStandardMaterial({
    map: texLib.asphaltTex,
    color: 0xc2c6ca,
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  registerHeroMaterialSwap(
    lot387Mat,
    { map: texLib.asphaltTex, color: 0xc2c6ca, roughness: 0.9 },
    { map: texLib.snowRoadTex, color: 0xdce6f0, roughness: 0.86 }
  );
  const lot387Mesh = new THREE.Mesh(createGroundPolygonGeometry(lot387Pts, 0.052, 0.14, elevData), lot387Mat);
  lot387Mesh.receiveShadow = true;
  scene.add(lot387Mesh);

  for (const [cx, cz, col, ry] of [
    [75.4, 8.8, 0xd82b2b, 0.04],
    [79.2, 8.8, 0xc82428, -0.02],
  ]) {
    const car = makeParkedCarMesh(col, snowCarCapMat);
    car.position.set(cx, sampleElevation(cx, cz, elevData) + 0.05, cz);
    car.rotation.y = ry;
    scene.add(car);
  }
  const pyrCedarX = 71.0, pyrCedarZ = 14.8;
  const pyrCedarGrp = new THREE.Group();
  pyrCedarGrp.position.set(pyrCedarX, sampleElevation(pyrCedarX, pyrCedarZ, elevData), pyrCedarZ);
  for (const [pw, ph, py] of [[1.4, 1.5, 0.75], [1.1, 1.4, 2.1], [0.7, 1.2, 3.3], [0.35, 0.8, 4.2]]) {
    const cTier = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pw), hedgeMat);
    cTier.position.y = py;
    cTier.castShadow = true;
    pyrCedarGrp.add(cTier);
  }
  addSculptedHedge(pyrCedarGrp, -2.5, 0.6, 5.2, 1.15, 1.35);
  scene.add(pyrCedarGrp);

  // Target pin marker above 2646 Rue des Cormiers
  const pinGroup = new THREE.Group();
  pinGroup.position.set(0, 11.5, 0);
  const pinHead = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.3, 0),
    new THREE.MeshStandardMaterial({ color: 0xe22c2c, emissive: 0x550808, roughness: 0.3 })
  );
  pinHead.position.y = 1.8;
  const pinStem = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1.8, 8),
    new THREE.MeshStandardMaterial({ color: 0xe22c2c, emissive: 0x440606, roughness: 0.3 })
  );
  pinStem.rotation.x = Math.PI;
  pinStem.position.y = 0.5;
  pinGroup.add(pinHead, pinStem);
  root.add(pinGroup);

  // Christmas Mode decorations for 2646 Rue des Cormiers (hidden by default)
  const xmas2646 = new THREE.Group();
  xmas2646.visible = false;
  // Main eave, front bay eave & gable peak, bay window trim, portico gable peak, carport eave & gable peak
  addChristmasStringLine(xmas2646, 4.45, 5.65, -2.0, 4.45, 5.65, 3.05, 0.52);
  addChristmasStringLine(xmas2646, 5.25, 5.65, -6.35, 5.25, 5.65, -2.05, 0.52);
  addChristmasStringLine(xmas2646, 5.25, 5.65, -6.35, 5.25, 7.22, -4.2, 0.46);
  addChristmasStringLine(xmas2646, 5.25, 7.22, -4.2, 5.25, 5.65, -2.05, 0.46);
  addChristmasStringLine(xmas2646, 5.56, 2.74, -5.42, 5.56, 2.74, -2.98, 0.44);
  addChristmasStringLine(xmas2646, 5.74, 2.82, 0.22, 5.74, 3.54, 1.25, 0.4);
  addChristmasStringLine(xmas2646, 5.74, 3.54, 1.25, 5.74, 2.82, 2.28, 0.4);
  addChristmasStringLine(xmas2646, 4.25, 2.75, 3.05, 4.25, 2.75, 6.85, 0.52);
  addChristmasStringLine(xmas2646, 4.25, 2.85, 3.05, 4.25, 4.0, 4.95, 0.48);
  addChristmasStringLine(xmas2646, 4.25, 4.0, 4.95, 4.25, 2.85, 6.85, 0.48);
  // Red-bow pine garlands & front door wreath
  addChristmasGarland(xmas2646, 5.65, 2.72, 0.35, 5.65, 2.72, 2.15);
  addChristmasGarland(xmas2646, 4.22, 2.66, 3.15, 4.22, 2.66, 6.75);
  addChristmasWreath(xmas2646, 5.72, 3.08, 1.25, Math.PI / 2, texLib);
  // Decorated tree w/ wrapped presents, cute voxel snowman, giant candy canes, glowing reindeer & lawn star
  addDecoratedChristmasTree(xmas2646, 8.8, 0.0, -1.6, 0.98, true);
  addVoxelSnowman(xmas2646, 7.6, 0.0, -3.5, Math.PI / 2, 1.05);
  addCandyCane(xmas2646, 6.35, 0.0, 0.35, Math.PI / 2, 0.95);
  addCandyCane(xmas2646, 6.35, 0.0, 2.2, Math.PI / 2, 0.95);
  addGlowingReindeer(xmas2646, 8.4, 0.0, -5.8, Math.PI * 0.42, 1.0);
  addGlowingLawnStar(xmas2646, 7.2, 0.0, -6.4, Math.PI / 2, 0.95);
  root.add(xmas2646);
  heroChristmasGroups.push(xmas2646);

  scene.add(root);
  return { root, pinGroup, setWinterMode, setChristmasMode, setNightMode };
}

function addClassroomWindowBay(group, x0, z0, x1, z1, count, baseY, winH, mats, options = {}) {
  const {
    infillH = 0.72,
    addPilasters = true,
    pilasterMat = mats.brickMat,
    winCenterY = baseY + 2.45,
  } = options;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1.2 || count <= 0) return;
  const ang = Math.atan2(dz, dx);
  const nx = dz / len;
  const nz = -dx / len;
  const bayW = len / count;
  const winW = Math.min(bayW * 0.74, 2.25);

  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const wx = x0 + dx * t + nx * 0.08;
    const wz = z0 + dz * t + nz * 0.08;

    // Outer white frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.16, winH + 0.14, 0.18), mats.whiteFrameMat);
    frame.position.set(wx, winCenterY, wz);
    frame.rotation.y = -ang;
    group.add(frame);

    // Dark glass pane
    const glass = new THREE.Mesh(new THREE.BoxGeometry(winW, winH, 0.21), mats.glassMat);
    glass.position.set(wx, winCenterY, wz);
    glass.rotation.y = -ang;
    group.add(glass);

    // Crisp vertical & horizontal white mullions
    for (const mx of [-winW * 0.22, winW * 0.22]) {
      const vMul = new THREE.Mesh(new THREE.BoxGeometry(0.06, winH + 0.04, 0.24), mats.whiteFrameMat);
      vMul.position.set(wx + Math.cos(ang) * mx, winCenterY, wz + Math.sin(ang) * mx);
      vMul.rotation.y = -ang;
      group.add(vMul);
    }
    const hMul = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.04, 0.06, 0.24), mats.whiteFrameMat);
    hMul.position.set(wx, winCenterY + winH * 0.14, wz);
    hMul.rotation.y = -ang;
    group.add(hMul);

    // Dark infill panel below window sill
    if (infillH > 0) {
      const infill = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.12, infillH, 0.16), mats.infillMat);
      infill.position.set(wx, winCenterY - winH / 2 - infillH / 2 - 0.04, wz);
      infill.rotation.y = -ang;
      group.add(infill);
    }

    // Brick pilaster between bays
    if (addPilasters && i > 0) {
      const pt = i / count;
      const px = x0 + dx * pt + nx * 0.1;
      const pz = z0 + dz * pt + nz * 0.1;
      const pilaster = new THREE.Mesh(new THREE.BoxGeometry(0.36, 4.35, 0.22), pilasterMat);
      pilaster.position.set(px, baseY + 2.18, pz);
      pilaster.rotation.y = -ang;
      pilaster.castShadow = true;
      group.add(pilaster);
    }
  }
}

function addGymClerestoryAndPilasters(group, gymPts, schoolElev, mats) {
  for (let i = 0; i < gymPts.length; i++) {
    const [x0, z0] = gymPts[i];
    const [x1, z1] = gymPts[(i + 1) % gymPts.length];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const count = Math.max(3, Math.floor(len / 3.4));
    addClassroomWindowBay(group, x0, z0, x1, z1, count, schoolElev, 1.25, mats, {
      infillH: 0,
      addPilasters: false,
      winCenterY: schoolElev + 6.45,
    });
    // Tall gym brick pilasters at corners & mid-span
    const dx = x1 - x0;
    const dz = z1 - z0;
    const ang = Math.atan2(dz, dx);
    const nx = dz / len;
    const nz = -dx / len;
    for (const pt of [0.02, 0.34, 0.66, 0.98]) {
      const px = x0 + dx * pt + nx * 0.12;
      const pz = z0 + dz * pt + nz * 0.12;
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.48, 7.3, 0.26), mats.brickMat);
      pil.position.set(px, schoolElev + 3.65, pz);
      pil.rotation.y = -ang;
      pil.castShadow = true;
      group.add(pil);
    }
  }
}

function addSchoolRooftopDetails(group, schoolElev, mats) {
  const addHvac = (x, y, z, w, h, d, rotY = -0.1) => {
    const unit = new THREE.Group();
    unit.position.set(x, y, z);
    unit.rotation.y = rotY;
    const curb = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.24, d + 0.2), mats.parapetMat);
    curb.position.y = 0.12;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.hvacMat);
    body.position.y = 0.24 + h / 2;
    body.castShadow = true;
    const louver = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, h * 0.55, d + 0.04), mats.infillMat);
    louver.position.y = 0.24 + h * 0.52;
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.22, 10), mats.parapetMat);
    fan.position.set(w * 0.22, 0.24 + h + 0.11, 0);
    const snowCap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.07, d + 0.04), mats.roofSnowCapMat);
    snowCap.position.y = 0.24 + h + 0.035;
    unit.add(curb, body, louver, fan, snowCap);
    group.add(unit);
  };

  const addVent = (x, y, z, r = 0.24, h = 0.65) => {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, h, 8), mats.hvacMat);
    stem.position.set(x, y + h / 2, z);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 1.65, 0.22, 8), mats.parapetMat);
    cap.position.set(x, y + h + 0.11, z);
    group.add(stem, cap);
  };

  const addSkylight = (x, y, z, w, d, rotY = -0.1) => {
    const sky = new THREE.Group();
    sky.position.set(x, y, z);
    sky.rotation.y = rotY;
    const curb = new THREE.Mesh(new THREE.BoxGeometry(w, 0.28, d), mats.whiteFrameMat);
    curb.position.y = 0.14;
    const pane = new THREE.Mesh(new THREE.BoxGeometry(w - 0.18, 0.14, d - 0.18), mats.skylightMat);
    pane.position.y = 0.32;
    sky.add(curb, pane);
    group.add(sky);
  };

  const mainRoofY = schoolElev + 5.41;
  addHvac(271.5, mainRoofY, 226.5, 2.6, 1.05, 1.9);
  addHvac(252.5, mainRoofY, 248.5, 2.4, 0.95, 1.8);
  addHvac(298.0, mainRoofY, 248.5, 2.8, 1.1, 2.0);
  addHvac(275.0, mainRoofY, 252.5, 2.2, 0.9, 1.7);

  for (const [vx, vz] of [
    [268.0, 232.0],
    [244.0, 251.0],
    [262.0, 246.0],
    [289.0, 244.0],
    [306.0, 252.0],
    [282.0, 256.0],
  ]) {
    addVent(vx, mainRoofY, vz);
  }

  addSkylight(271.2, mainRoofY, 240.0, 3.8, 1.8);
  addSkylight(258.0, mainRoofY, 250.0, 3.2, 1.5);
  addSkylight(291.5, mainRoofY, 251.0, 3.4, 1.5);

  const gymRoofY = schoolElev + 8.41;
  addHvac(240.0, gymRoofY, 266.0, 3.1, 1.25, 2.2);
  addHvac(248.5, gymRoofY, 271.0, 2.7, 1.1, 2.0);
  addVent(235.5, gymRoofY, 272.0, 0.28, 0.8);
  addVent(252.0, gymRoofY, 264.5, 0.28, 0.8);
  addSkylight(243.5, gymRoofY, 268.5, 5.2, 1.4);
}

function addMainEntrancePlaza(group, schoolElev, elevData, mats) {
  const ent = new THREE.Group();
  ent.position.set(271.5, schoolElev, 214.4);
  ent.rotation.y = -0.1;

  // Recessed dark vestibule + double glass doors with white frames & push bars
  const recess = new THREE.Mesh(new THREE.BoxGeometry(5.2, 3.1, 0.6), mats.infillMat);
  recess.position.set(0, 1.6, 0.15);
  ent.add(recess);
  for (const dx of [-1.05, 1.05]) {
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.5, 0.14), mats.whiteFrameMat);
    doorFrame.position.set(dx, 1.35, -0.12);
    const doorGlass = new THREE.Mesh(new THREE.BoxGeometry(1.65, 2.25, 0.18), mats.glassMat);
    doorGlass.position.set(dx, 1.35, -0.13);
    const pushBar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.22), mats.steelMat);
    pushBar.position.set(dx + (dx < 0 ? 0.55 : -0.55), 1.25, -0.18);
    ent.add(doorFrame, doorGlass, pushBar);
  }

  // Entrance concrete landing + 4 steps
  const landing = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.55, 2.2), mats.concreteMat);
  landing.position.set(0, 0.28, -1.2);
  landing.receiveShadow = true;
  ent.add(landing);
  for (let s = 0; s < 3; s++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.14, 0.42), mats.concreteMat);
    step.position.set(0.6, 0.07 + (2 - s) * 0.14, -2.5 - s * 0.42);
    step.receiveShadow = true;
    ent.add(step);
  }

  // Accessibility ramp with metal handrails on the west side of the landing
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.16, 1.35), mats.concreteMat);
  ramp.position.set(-4.1, 0.26, -1.35);
  ramp.rotation.z = -0.11;
  ramp.receiveShadow = true;
  ent.add(ramp);
  for (const rz of [-0.62, 0.62]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.06, 0.06), mats.steelMat);
    rail.position.set(-4.1, 1.05, -1.35 + rz);
    rail.rotation.z = -0.11;
    ent.add(rail);
    for (const rx of [-2.0, 0, 2.0]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, 0.06), mats.steelMat);
      post.position.set(-4.1 + rx, 0.65 - rx * 0.11, -1.35 + rz);
      ent.add(post);
    }
  }
  group.add(ent);

  // Front planter beds flanking entrance
  for (const [px, pz] of [
    [264.0, 216.2],
    [279.0, 217.6],
  ]) {
    const pElev = sampleElevation(px, pz, elevData);
    const planter = new THREE.Group();
    planter.position.set(px, pElev, pz);
    planter.rotation.y = -0.1;
    const box = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.48, 1.5), mats.brickMat);
    box.position.y = 0.24;
    box.castShadow = true;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(3.55, 0.08, 1.65), mats.concreteMat);
    cap.position.y = 0.52;
    const soil = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.08, 1.2), mats.planterShrubMat);
    soil.position.y = 0.5;
    planter.add(box, cap, soil);
    for (const sx of [-1.0, 0, 1.0]) {
      const shrub = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.55, 0.75), mats.planterShrubMat);
      shrub.position.set(sx, 0.78, 0);
      shrub.castShadow = true;
      planter.add(shrub);
    }
    group.add(planter);
  }

  // Wooden benches along the front diagonal walkway (not in the NE parking lot)
  for (const [bx, bz, rot] of [
    [259.6, 231.2, 0.72],
    [262.6, 235.2, 0.72],
  ]) {
    const bElev = sampleElevation(bx, bz, elevData);
    const bench = new THREE.Group();
    bench.position.set(bx, bElev, bz);
    bench.rotation.y = rot;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.52), mats.woodMat);
    seat.position.y = 0.45;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.42, 0.07), mats.woodMat);
    back.position.set(0, 0.72, -0.22);
    back.rotation.x = -0.15;
    for (const lx of [-0.78, 0.78]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.48), mats.parapetMat);
      leg.position.set(lx, 0.225, 0);
      bench.add(leg);
    }
    bench.add(seat, back);
    group.add(bench);
  }
}

function addSchoolyardMarkingsAndHoops(group, elevData, mats) {
  const ang = 0.0987; // Aligned with school & rear asphalt yard

  const addPaintedLine = (cx, cz, w, d, rotY, mat) => {
    const y = sampleElevation(cx, cz, elevData) + 0.155;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), mat);
    strip.position.set(cx, y, cz);
    strip.rotation.y = rotY;
    strip.receiveShadow = true;
    group.add(strip);
  };

  const addFourSquare = (cx, cz, size = 4.0) => {
    const half = size / 2;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    // Outer border
    addPaintedLine(cx - s * half, cz + c * half, size, 0.1, -ang, mats.yellowLineMat);
    addPaintedLine(cx + s * half, cz - c * half, size, 0.1, -ang, mats.yellowLineMat);
    addPaintedLine(cx - c * half, cz - s * half, 0.1, size, -ang, mats.yellowLineMat);
    addPaintedLine(cx + c * half, cz + s * half, 0.1, size, -ang, mats.yellowLineMat);
    // Inner cross
    addPaintedLine(cx, cz, size, 0.08, -ang, mats.whiteLineMat);
    addPaintedLine(cx, cz, 0.08, size, -ang, mats.whiteLineMat);
  };

  addFourSquare(260.0, 274.5, 3.8);
  addFourSquare(264.8, 275.0, 3.8);

  // Hopscotch grid
  const hx0 = 266.0;
  const hz0 = 283.5;
  for (let step = 0; step < 6; step++) {
    const ox = Math.cos(ang) * step * 0.85;
    const oz = Math.sin(ang) * step * 0.85;
    const isDouble = step === 2 || step === 4;
    if (isDouble) {
      for (const side of [-0.42, 0.42]) {
        addPaintedLine(hx0 + ox - Math.sin(ang) * side, hz0 + oz + Math.cos(ang) * side, 0.72, 0.72, -ang, mats.yellowLineMat);
      }
    } else {
      addPaintedLine(hx0 + ox, hz0 + oz, 0.72, 0.72, -ang, mats.whiteLineMat);
    }
  }

  // 2 Basketball Court Keys + 4 Basketball Hoops
  const addBasketballHoop = (hx, hz, facingAng) => {
    const hElev = sampleElevation(hx, hz, elevData);
    const hoop = new THREE.Group();
    hoop.position.set(hx, hElev, hz);
    hoop.rotation.y = facingAng;

    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.45, 0.14), mats.steelMat);
    pole.position.set(0, 1.725, 0);
    pole.castShadow = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.95), mats.steelMat);
    arm.position.set(0, 3.05, 0.45);
    const backboard = new THREE.Mesh(new THREE.BoxGeometry(1.55, 1.05, 0.06), mats.whiteFrameMat);
    backboard.position.set(0, 3.25, 0.92);
    backboard.castShadow = true;
    const shooterBox = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.42, 0.07), mats.orangeMat);
    shooterBox.position.set(0, 3.12, 0.93);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.028, 6, 12), mats.orangeMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, 2.98, 1.2);
    const net = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.13, 0.42, 10, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xf4f6f8, transparent: true, opacity: 0.72, side: THREE.DoubleSide })
    );
    net.position.set(0, 2.77, 1.2);
    hoop.add(pole, arm, backboard, shooterBox, rim, net);
    group.add(hoop);
  };

  const addBasketballCourt = (cx, cz) => {
    const halfLen = 10.5;
    const halfWid = 6.0;
    const nx = -Math.sin(ang);
    const nz = Math.cos(ang);
    const ux = Math.cos(ang);
    const uz = Math.sin(ang);

    // Sidelines & baselines
    addPaintedLine(cx - ux * halfWid, cz - uz * halfWid, 0.1, halfLen * 2, -ang, mats.whiteLineMat);
    addPaintedLine(cx + ux * halfWid, cz + uz * halfWid, 0.1, halfLen * 2, -ang, mats.whiteLineMat);
    addPaintedLine(cx - nx * halfLen, cz - nz * halfLen, halfWid * 2, 0.1, -ang, mats.whiteLineMat);
    addPaintedLine(cx + nx * halfLen, cz + nz * halfLen, halfWid * 2, 0.1, -ang, mats.whiteLineMat);
    addPaintedLine(cx, cz, halfWid * 2, 0.08, -ang, mats.whiteLineMat);

    // 2 Painted Keys (north & south ends of the court)
    for (const dir of [-1, 1]) {
      const keyDepth = 4.2;
      const keyW = 3.6;
      const kx = cx + nx * dir * (halfLen - keyDepth / 2);
      const kz = cz + nz * dir * (halfLen - keyDepth / 2);
      addPaintedLine(kx - ux * (keyW / 2), kz - uz * (keyW / 2), 0.1, keyDepth, -ang, mats.yellowLineMat);
      addPaintedLine(kx + ux * (keyW / 2), kz + uz * (keyW / 2), 0.1, keyDepth, -ang, mats.yellowLineMat);
      addPaintedLine(
        cx + nx * dir * (halfLen - keyDepth),
        cz + nz * dir * (halfLen - keyDepth),
        keyW,
        0.1,
        -ang,
        mats.yellowLineMat
      );
      const hx = cx + nx * dir * (halfLen + 0.3);
      const hz = cz + nz * dir * (halfLen + 0.3);
      addBasketballHoop(hx, hz, dir === 1 ? Math.PI - ang : -ang);
    }
  };

  addBasketballCourt(274.5, 281.5);
  addBasketballCourt(293.5, 283.3);
}

function addBicycleRacks(group, elevData, mats) {
  for (const [rx, rz] of [
    [221.5, 260.0],
    [221.0, 266.0],
    [220.5, 272.0],
    [220.0, 278.0],
  ]) {
    const rElev = sampleElevation(rx, rz, elevData);
    const rack = new THREE.Group();
    rack.position.set(rx, rElev, rz);
    rack.rotation.y = -0.1;
    for (const bz of [-0.32, 0.32]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 0.06), mats.steelMat);
      rail.position.set(0, 0.03, bz);
      rack.add(rail);
    }
    for (let i = -2; i <= 2; i++) {
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 6, 12, Math.PI), mats.steelMat);
      loop.position.set(i * 0.52, 0.35, 0);
      loop.rotation.y = Math.PI / 2;
      rack.add(loop);
    }
    group.add(rack);
  }
}

function addRichGravelPlayground(group, cx, cz, variant, elevData, mats) {
  const baseElev = sampleElevation(cx, cz, elevData);
  const pg = new THREE.Group();
  pg.position.set(cx, baseElev, cz);
  pg.rotation.y = variant === 0 ? -0.1 : 0.08;

  const blueMat = new THREE.MeshStandardMaterial({ color: 0x2a6fb8, roughness: 0.5 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xd6392c, roughness: 0.45 });
  const yellowMat = new THREE.MeshStandardMaterial({ color: 0xf2b729, roughness: 0.45 });
  const greenMat = new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.5 });

  // 1. Multi-platform slide & bridge structure
  const multi = new THREE.Group();
  multi.position.set(-3.2, 0, -2.5);
  for (const [dx, dh, dw] of [
    [0, 1.5, 2.0],
    [3.4, 1.9, 2.0],
  ]) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(dw, 0.16, dw), yellowMat);
    deck.position.set(dx, dh, 0);
    deck.castShadow = true;
    multi.add(deck);
    for (const px of [-0.88, 0.88]) {
      for (const pz of [-0.88, 0.88]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, dh + 1.5, 0.12), blueMat);
        post.position.set(dx + px, (dh + 1.5) / 2, pz);
        multi.add(post);
      }
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.55, 1.0, 4), redMat);
    roof.position.set(dx, dh + 1.9, 0);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    multi.add(roof);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 1.1), greenMat);
  bridge.position.set(1.7, 1.68, 0);
  bridge.rotation.z = 0.18;
  const slide1 = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.12, 2.5), yellowMat);
  slide1.position.set(0, 0.85, 2.0);
  slide1.rotation.x = 0.52;
  slide1.castShadow = true;
  const slide2 = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.12, 2.8), redMat);
  slide2.position.set(3.4, 1.05, 2.15);
  slide2.rotation.x = 0.56;
  slide2.castShadow = true;
  multi.add(bridge, slide1, slide2);
  pg.add(multi);

  // 2. A-Frame Swings
  addPlaygroundEquipment(pg, 4.2, -3.2, 'swing', 1, 0);

  // 3. Climbing Frame (arch / monkey bars)
  const climber = new THREE.Group();
  climber.position.set(-4.2, 0, 3.6);
  for (const lz of [-0.55, 0.55]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.09, 0.09), greenMat);
    rail.position.set(0, 2.15, lz);
    climber.add(rail);
    for (const lx of [-1.5, 1.5]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.15, 0.1), blueMat);
      leg.position.set(lx, 1.075, lz);
      climber.add(leg);
    }
  }
  for (let r = -1.2; r <= 1.2; r += 0.4) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.1), mats.steelMat);
    rung.position.set(r, 2.15, 0);
    climber.add(rung);
  }
  pg.add(climber);

  // 4. Seesaw
  const seesaw = new THREE.Group();
  seesaw.position.set(2.5, 0, 3.8);
  const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 0.65, 8), mats.steelMat);
  pivot.position.y = 0.325;
  const plank = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 0.32), redMat);
  plank.position.y = 0.65;
  plank.rotation.z = 0.16;
  seesaw.add(pivot, plank);
  pg.add(seesaw);

  // 5. Picnic Table
  const table = new THREE.Group();
  table.position.set(5.8, 0, 2.8);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.85), mats.woodMat);
  top.position.y = 0.74;
  for (const bz of [-0.68, 0.68]) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.07, 0.32), mats.woodMat);
    bench.position.set(0, 0.42, bz);
    table.add(bench);
  }
  for (const lx of [-0.7, 0.7]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.74, 1.35), mats.parapetMat);
    leg.position.set(lx, 0.37, 0);
    table.add(leg);
  }
  table.add(top);
  pg.add(table);

  group.add(pg);
}

function addChainLinkFence(group, pts, height, elevData, closed = false, gateIndices = new Set(), mats) {
  const count = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < count; i++) {
    if (gateIndices.has(i)) continue;
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    const segLen = Math.hypot(x1 - x0, z1 - z0);
    if (segLen < 0.5) continue;
    const steps = Math.max(1, Math.round(segLen / 3.5));
    const ang = Math.atan2(z1 - z0, x1 - x0);

    for (let s = 0; s < steps; s++) {
      const t0 = s / steps;
      const t1 = (s + 1) / steps;
      const px0 = x0 + (x1 - x0) * t0;
      const pz0 = z0 + (z1 - z0) * t0;
      const px1 = x0 + (x1 - x0) * t1;
      const pz1 = z0 + (z1 - z0) * t1;
      const e0 = sampleElevation(px0, pz0, elevData);
      const e1 = sampleElevation(px1, pz1, elevData);
      const subLen = Math.hypot(px1 - px0, pz1 - pz0);

      // Post
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, height, 6), mats.steelMat);
      post.position.set(px0, e0 + height / 2, pz0);
      group.add(post);

      // Top & bottom tubular rails + world-scaled diamond wire mesh panel
      const midE = (e0 + e1) / 2;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(subLen, 0.055, 0.055), mats.steelMat);
      rail.position.set((px0 + px1) / 2, midE + height - 0.04, (pz0 + pz1) / 2);
      rail.rotation.y = -ang;
      const botRail = new THREE.Mesh(new THREE.BoxGeometry(subLen, 0.04, 0.04), mats.steelMat);
      botRail.position.set((px0 + px1) / 2, midE + 0.08, (pz0 + pz1) / 2);
      botRail.rotation.y = -ang;
      const pGeo = new THREE.PlaneGeometry(subLen, height - 0.12);
      const pUv = pGeo.attributes.uv;
      for (let ui = 0; ui < pUv.count; ui++) {
        pUv.setXY(ui, pUv.getX(ui) * subLen * 0.85, pUv.getY(ui) * (height - 0.12) * 0.85);
      }
      const panel = new THREE.Mesh(pGeo, mats.chainLinkMat);
      panel.position.set((px0 + px1) / 2, midE + height / 2, (pz0 + pz1) / 2);
      panel.rotation.y = -ang;
      group.add(rail, botRail, panel);
    }
    const endE = sampleElevation(x1, z1, elevData);
    const endPost = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, height, 6), mats.steelMat);
    endPost.position.set(x1, endE + height / 2, z1);
    group.add(endPost);
  }
}

function addDropOffLoopAndParkingDetails(group, texLib, elevData, mats) {
  // Yellow curb / no-parking stripes around NW bus/parent loop & NE parking lot
  const addCurbStripe = (x0, z0, x1, z1, width = 0.28) => {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const ang = Math.atan2(dz, dx);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const y = sampleElevation(cx, cz, elevData) + 0.075;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, width), mats.yellowLineMat);
    stripe.position.set(cx, y, cz);
    stripe.rotation.y = -ang;
    group.add(stripe);
  };

  addCurbStripe(218.6, 206.6, 258.9, 210.1);
  addCurbStripe(217.1, 223.8, 257.5, 227.4);
  addCurbStripe(299.4, 226.6, 322.7, 228.7);
  addCurbStripe(322.7, 228.7, 320.7, 260.3);

  // "ACCÈS RÉSERVÉ" & One-way arrow signs
  const accesTex = texLib.makeBannerTexture('ACCÈS RÉSERVÉ', '#f4f6f8', '#c81e1e', 256, 96);
  const oneWayTex = texLib.makeBannerTexture('➜ SENS UNIQUE', '#004f9e', '#ffffff', 256, 72);
  const addSignPost = (x, z, tex, w, h, rotY) => {
    const e = sampleElevation(x, z, elevData);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.7, 6), mats.steelMat);
    post.position.set(x, e + 1.35, z);
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.05),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 })
    );
    board.position.set(x, e + 2.45, z);
    board.rotation.y = rotY;
    group.add(post, board);
  };

  addSignPost(254.2, 207.4, accesTex, 1.05, 0.45, 0.1);
  addSignPost(300.8, 222.8, accesTex, 1.05, 0.45, -0.2);
  addSignPost(256.8, 201.8, oneWayTex, 1.15, 0.36, 0.0);
  addSignPost(217.5, 211.0, oneWayTex, 1.15, 0.36, Math.PI / 2);
  addSignPost(292.0, 206.5, oneWayTex, 1.15, 0.36, -0.3);

  // Tall slender metal light standards around NW drop-off loop & NE parking lot
  const schoolLampLensMat = new THREE.MeshStandardMaterial({
    color: 0xfff3d1,
    emissive: 0xffe4a0,
    emissiveIntensity: 0.25,
  });
  registerHeroGlowMaterial(schoolLampLensMat, 0.25, 1.9, 0xffe49e);
  for (const [lx, lz, rot] of [
    [219.0, 206.5, 0.1],
    [238.5, 208.5, 0.1],
    [258.5, 210.5, 0.1],
    [238.0, 225.5, -Math.PI + 0.1],
    [303.5, 222.5, -0.4],
    [322.0, 241.0, -Math.PI / 2],
  ]) {
    const lElev = sampleElevation(lx, lz, elevData);
    const light = new THREE.Group();
    light.position.set(lx, lElev, lz);
    light.rotation.y = rot;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 6.4, 8), mats.parapetMat);
    pole.position.y = 3.2;
    pole.castShadow = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.1), mats.parapetMat);
    arm.position.set(0, 6.35, 0.5);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.58), mats.parapetMat);
    head.position.set(0, 6.35, 1.05);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.45), schoolLampLensMat);
    lens.position.set(0, 6.29, 1.05);
    light.add(pole, arm, head, lens);
    group.add(light);
  }
}

/**
 * 2. Hero Landmark: École Primaire de la Samare (3000 Rue du Chalumeau)
 */
export function buildEcoleDeLaSamare(scene, texLib, schoolBuilding, pitches, playgrounds, elevDataArg = null) {
  const elevData = getElevData(elevDataArg);
  const schoolElev = sampleElevation(schoolBuilding.obbCx ?? 272, schoolBuilding.obbCz ?? 248, elevData);

  const group = new THREE.Group();
  const schoolBrickMat = new THREE.MeshStandardMaterial({
    map: texLib.brickTextures[0],
    color: 0xe8e2d6,
    roughness: 0.85,
  });
  const parapetMat = new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.72 });
  const flatRoofMat = new THREE.MeshStandardMaterial({ color: 0x54575c, roughness: 0.92 });
  registerHeroMaterialSwap(
    flatRoofMat,
    { map: null, color: 0x54575c, roughness: 0.92 },
    { map: texLib.snowRoofTex, color: 0xeef5fc, roughness: 0.85 }
  );
  const roofSnowCapMat = new THREE.MeshStandardMaterial({
    color: 0x8d959e,
    roughness: 0.65,
    transparent: true,
    opacity: 0.0,
  });
  registerHeroMaterialSwap(
    roofSnowCapMat,
    { color: 0x8d959e, opacity: 0.0 },
    { color: 0xeef5fc, opacity: 0.96 }
  );
  const schoolGlassMat = new THREE.MeshStandardMaterial({
    color: 0x243a4f,
    roughness: 0.18,
    metalness: 0.5,
  });
  registerHeroWindowMaterial(schoolGlassMat, texLib, 0.68, 0xffb84d);
  const whiteFrameMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.42 });
  const infillMat = new THREE.MeshStandardMaterial({ color: 0x343a40, roughness: 0.68 });
  const hvacMat = new THREE.MeshStandardMaterial({ color: 0xb6bec6, metalness: 0.45, roughness: 0.42 });
  const skylightMat = new THREE.MeshStandardMaterial({ color: 0x9ac6e2, roughness: 0.2, metalness: 0.2 });
  registerHeroWindowMaterial(skylightMat, texLib, 0.48, 0xffc66d);
  const concreteMat = new THREE.MeshStandardMaterial({ map: texLib.concreteTex, color: 0xd8dce0, roughness: 0.88 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x9e6a3b, roughness: 0.78 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xc2c8ce, metalness: 0.65, roughness: 0.35 });
  const orangeMat = new THREE.MeshStandardMaterial({ color: 0xe55b1d, roughness: 0.45 });
  const planterShrubMat = new THREE.MeshStandardMaterial({
    map: texLib.leafDeciduousTex,
    color: 0x3d6e3a,
    roughness: 0.88,
  });
  registerHeroMaterialSwap(
    planterShrubMat,
    { map: texLib.leafDeciduousTex, color: 0x3d6e3a, roughness: 0.88 },
    { map: texLib.snowTex, color: 0xe2edf7, roughness: 0.86 }
  );
  const yellowLineMat = new THREE.MeshStandardMaterial({
    color: 0xf4c41c,
    roughness: 0.65,
    transparent: true,
    opacity: 0.95,
  });
  registerHeroMaterialSwap(
    yellowLineMat,
    { color: 0xf4c41c, opacity: 0.95 },
    { color: 0xd7e3ee, opacity: 0.22 }
  );
  const whiteLineMat = new THREE.MeshStandardMaterial({
    color: 0xf4f6f8,
    roughness: 0.65,
    transparent: true,
    opacity: 0.95,
  });
  registerHeroMaterialSwap(
    whiteLineMat,
    { color: 0xf4f6f8, opacity: 0.95 },
    { color: 0xd7e3ee, opacity: 0.22 }
  );
  const chainLinkMat = new THREE.MeshStandardMaterial({
    map: texLib.chainLinkTex || null,
    color: 0xffffff,
    metalness: 0.55,
    roughness: 0.4,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
  });

  const mats = {
    brickMat: schoolBrickMat,
    parapetMat,
    roofSnowCapMat,
    glassMat: schoolGlassMat,
    whiteFrameMat,
    infillMat,
    hvacMat,
    skylightMat,
    concreteMat,
    woodMat,
    steelMat,
    orangeMat,
    planterShrubMat,
    yellowLineMat,
    whiteLineMat,
    chainLinkMat,
  };

  // Main extruded 1-storey wings with 1.5m foundation extension
  const pts = schoolBuilding.pts;
  const bodyH = 4.3;
  const bodyGeom = createExtrudedPolygonGeometry(pts, bodyH + 1.75, schoolElev - 1.5);
  const bodyMesh = new THREE.Mesh(bodyGeom, schoolBrickMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  // Dark charcoal upper parapet band
  const parapetGeom = createExtrudedPolygonGeometry(pts, 0.85, schoolElev + 0.25 + bodyH);
  const parapetMesh = new THREE.Mesh(parapetGeom, parapetMat);
  parapetMesh.castShadow = true;
  group.add(parapetMesh);

  // Flat roof cap
  const roofCap = new THREE.Mesh(createGroundPolygonGeometry(pts, schoolElev + 0.25 + bodyH + 0.86, 0.08, null), flatRoofMat);
  roofCap.receiveShadow = true;
  group.add(roofCap);

  // Taller Gymnasium Block on Southwest corner
  const gymPts = [
    [257.43, 261.02],
    [255.57, 279.7],
    [230.09, 277.17],
    [231.96, 258.45],
  ];
  const gymBody = new THREE.Mesh(createExtrudedPolygonGeometry(gymPts, 7.2 + 1.75, schoolElev - 1.5), schoolBrickMat);
  gymBody.castShadow = true;
  gymBody.receiveShadow = true;
  const gymParapet = new THREE.Mesh(createExtrudedPolygonGeometry(gymPts, 0.95, schoolElev + 7.45), parapetMat);
  gymParapet.castShadow = true;
  const gymRoof = new THREE.Mesh(createGroundPolygonGeometry(gymPts, schoolElev + 8.41, 0.08, null), flatRoofMat);
  group.add(gymBody, gymParapet, gymRoof);

  // Crisp white-mullioned classroom window bays + dark infill panels + brick pilasters on ALL wings
  const wingWindowSegments = [
    [275.84, 219.01, 286.38, 220.05, 3],
    [284.66, 237.4, 314.14, 240.32, 9],
    [314.14, 240.32, 312.19, 259.86, 6],
    [312.19, 259.86, 289.56, 257.62, 7],
    [288.92, 264.14, 257.43, 261.02, 10],
    [227.8, 258.04, 229.39, 242.12, 5],
    [229.39, 242.12, 243.39, 243.51, 4],
    [243.94, 237.97, 265.0, 240.06, 7],
    [265.2, 238.1, 267.58, 214.14, 7],
  ];
  for (const [x0, z0, x1, z1, count] of wingWindowSegments) {
    addClassroomWindowBay(group, x0, z0, x1, z1, count, schoolElev, 1.55, mats);
  }
  addGymClerestoryAndPilasters(group, gymPts, schoolElev, mats);
  addSchoolRooftopDetails(group, schoolElev, mats);
  addMainEntrancePlaza(group, schoolElev, elevData, mats);

  // North Main Entrance Canopy + "ÉCOLE DE LA SAMARE" Sign
  const signTex = texLib.makeBannerTexture('ÉCOLE DE LA SAMARE', '#2b323b', '#f5f6f7', 512, 72);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.4, 2.8), parapetMat);
  canopy.position.set(271.5, schoolElev + 3.65, 213.8);
  canopy.rotation.y = -0.1;
  canopy.castShadow = true;
  const schoolSignMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.45 });
  registerHeroSignMaterial(schoolSignMat, signTex, 0.72, 0xfff0d0);
  const schoolSign = new THREE.Mesh(
    new THREE.BoxGeometry(5.6, 0.72, 0.14),
    schoolSignMat
  );
  schoolSign.position.set(271.5, schoolElev + 3.9, 212.45);
  schoolSign.rotation.y = -0.1;
  group.add(canopy, schoolSign);

  // Flagpoles + Micro-Voxel Purple Ornamental Crabapple Tree
  for (const [fx, fz, col] of [
    [259.0, 224.0, 0x003da5],
    [262.0, 224.3, 0xd80621],
  ]) {
    const fElev = sampleElevation(fx, fz, elevData);
    const fp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 7.5, 0.12), steelMat);
    fp.position.set(fx, fElev + 3.75, fz);
    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.95, 0.05),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.65 })
    );
    flag.position.set(fx + 0.75, fElev + 6.8, fz);
    group.add(fp, flag);
  }

  const crabElev = sampleElevation(254.0, 222.0, elevData);
  const crabTrunk = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 1.8, 0.32),
    new THREE.MeshStandardMaterial({ map: texLib.barkTex, color: 0xffffff, roughness: 0.9 })
  );
  crabTrunk.position.set(254.0, crabElev + 0.9, 222.0);
  const crabCrownMat = new THREE.MeshStandardMaterial({
    map: texLib.leafDeciduousTex,
    color: 0xa64e6c,
    roughness: 0.85,
  });
  registerHeroMaterialSwap(
    crabCrownMat,
    { map: texLib.leafDeciduousTex, color: 0xa64e6c, roughness: 0.85 },
    { map: texLib.snowTex, color: 0xddeaf5, roughness: 0.85 }
  );
  const crabCrownGeo = buildMiniVoxelCrown([
    [1.1, 0.9, 1.1, 0, 0, 0],
    [0.9, 0.85, 0.9, 0.95, -0.05, 0],
    [0.9, 0.85, 0.9, -0.95, -0.05, 0],
    [0.9, 0.85, 0.9, 0, -0.05, 0.95],
    [0.9, 0.85, 0.9, 0, -0.05, -0.95],
    [1.0, 0.85, 1.0, 0, 0.82, 0],
  ]);
  const crabCrown = new THREE.Mesh(crabCrownGeo, crabCrownMat);
  crabCrown.position.set(254.0, crabElev + 2.35, 222.0);
  crabCrown.castShadow = true;
  group.add(crabTrunk, crabCrown);

  // Rear Asphalt Schoolyard Markings, 4 Basketball Hoops, & 4 West Bicycle Racks
  addSchoolyardMarkingsAndHoops(group, elevData, mats);
  addBicycleRacks(group, elevData, mats);
  addDropOffLoopAndParkingDetails(group, texLib, elevData, mats);

  // Soccer Field + Chain-Link Perimeter Fencing + 2 Team Player Benches
  const soccerPitch = pitches.find((p) => p.sport === 'soccer');
  if (soccerPitch) {
    const spts = soccerPitch.pts;
    const dx = spts[1][0] - spts[0][0];
    const dz = spts[1][1] - spts[0][1];
    const lenA = Math.hypot(dx, dz);
    const lenB = Math.hypot(spts[2][0] - spts[1][0], spts[2][1] - spts[1][1]);
    const ang = Math.atan2(dz, dx);
    const fieldGeo = new THREE.PlaneGeometry(lenA, lenB);
    fieldGeo.rotateX(-Math.PI / 2);
    const fieldMat = new THREE.MeshStandardMaterial({ map: texLib.soccerTex, roughness: 0.9 });
    registerHeroMaterialSwap(
      fieldMat,
      { map: texLib.soccerTex, color: 0xffffff, roughness: 0.9 },
      { map: texLib.snowTex, color: 0xeef5fc, roughness: 0.88 }
    );
    const fieldElev = sampleElevation(soccerPitch.cx, soccerPitch.cz, elevData);
    const fieldMesh = new THREE.Mesh(fieldGeo, fieldMat);
    fieldMesh.position.set(soccerPitch.cx, fieldElev + 0.05, soccerPitch.cz);
    fieldMesh.rotation.y = -ang;
    fieldMesh.receiveShadow = true;
    group.add(fieldMesh);

    const ux = Math.cos(ang);
    const uz = Math.sin(ang);
    const halfGoalSpan = (lenA > lenB ? lenA : lenB) * 0.44;
    if (lenA >= lenB) {
      const gx1 = soccerPitch.cx - ux * halfGoalSpan;
      const gz1 = soccerPitch.cz - uz * halfGoalSpan;
      const gx2 = soccerPitch.cx + ux * halfGoalSpan;
      const gz2 = soccerPitch.cz + uz * halfGoalSpan;
      addSoccerGoal(group, gx1, gz1, -ang + Math.PI, sampleElevation(gx1, gz1, elevData));
      addSoccerGoal(group, gx2, gz2, -ang, sampleElevation(gx2, gz2, elevData));
    } else {
      const vx = -uz, vz = ux;
      const gx1 = soccerPitch.cx - vx * halfGoalSpan;
      const gz1 = soccerPitch.cz - vz * halfGoalSpan;
      const gx2 = soccerPitch.cx + vx * halfGoalSpan;
      const gz2 = soccerPitch.cz + vz * halfGoalSpan;
      addSoccerGoal(group, gx1, gz1, -ang - Math.PI / 2, sampleElevation(gx1, gz1, elevData));
      addSoccerGoal(group, gx2, gz2, -ang + Math.PI / 2, sampleElevation(gx2, gz2, elevData));
    }

    // Chain-link perimeter fence around soccer field (open gate on west edge)
    addChainLinkFence(group, spts, 2.2, elevData, true, new Set(), mats);

    // 2 Team Player Benches beside the soccer pitch
    for (const [bx, bz] of [
      [325.0, 251.0],
      [323.8, 273.0],
    ]) {
      const bElev = sampleElevation(bx, bz, elevData);
      const teamBench = new THREE.Group();
      teamBench.position.set(bx, bElev, bz);
      teamBench.rotation.y = -ang;
      const plank = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.08, 0.45), steelMat);
      plank.position.y = 0.45;
      const back = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.35, 0.06), steelMat);
      back.position.set(0, 0.72, -0.2);
      for (const lx of [-1.5, 0, 1.5]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.42), parapetMat);
        leg.position.set(lx, 0.225, 0);
        teamBench.add(leg);
      }
      teamBench.add(plank, back);
      group.add(teamBench);
    }
  }

  // Rear schoolyard border chain-link fence
  addChainLinkFence(
    group,
    [
      [201.93, 302.58],
      [237.36, 306.02],
      [326.85, 309.95],
    ],
    1.85,
    elevData,
    false,
    new Set(),
    mats
  );

  // Richer 2 SE Gravel Playgrounds
  const gravelPlaygrounds = playgrounds.filter(
    (pg) => Math.hypot(pg.cx - 280, pg.cz - 290) < 60 && pg.surface === 'gravel'
  );
  gravelPlaygrounds.forEach((pg, idx) => {
    addRichGravelPlayground(group, pg.cx, pg.cz, idx, elevData, mats);
  });

  // Christmas Mode decorations for École de la Samare (hidden by default)
  const xmasSchool = new THREE.Group();
  xmasSchool.visible = false;
  addChristmasGarland(xmasSchool, 268.0, schoolElev + 3.52, 212.2, 275.0, schoolElev + 3.52, 212.9);
  addChristmasGarland(xmasSchool, 276.0, schoolElev + 5.15, 219.1, 286.2, schoolElev + 5.15, 220.1);
  addChristmasWreath(xmasSchool, 271.5, schoolElev + 2.05, 214.25, -0.1, texLib);
  addChristmasStringLine(xmasSchool, 267.5, schoolElev + 5.2, 214.0, 276.2, schoolElev + 5.2, 214.9, 0.7);
  addChristmasStringLine(xmasSchool, 284.7, schoolElev + 5.2, 237.3, 314.1, schoolElev + 5.2, 240.2, 0.8);
  addChristmasStringLine(xmasSchool, 231.9, schoolElev + 8.25, 258.4, 257.4, schoolElev + 8.25, 260.9, 0.8);
  addChristmasStringLine(xmasSchool, 265.2, schoolElev + 5.2, 238.1, 267.6, schoolElev + 5.2, 214.1, 0.85);
  const schoolTreeElev = sampleElevation(266.0, 221.5, elevData);
  addDecoratedChristmasTree(xmasSchool, 266.0, schoolTreeElev, 221.5, 1.2, true);
  // Giant candy canes flanking main entrance + glowing stars & reindeer on front plaza
  addCandyCane(xmasSchool, 268.2, sampleElevation(268.2, 211.0, elevData), 211.0, 0.1, 1.15);
  addCandyCane(xmasSchool, 274.8, sampleElevation(274.8, 211.7, elevData), 211.7, Math.PI + 0.1, 1.15);
  addGlowingReindeer(xmasSchool, 263.0, sampleElevation(263.0, 220.5, elevData), 220.5, -0.4, 1.1);
  addGlowingLawnStar(xmasSchool, 278.5, sampleElevation(278.5, 215.5, elevData), 215.5, -0.1, 1.15);
  group.add(xmasSchool);
  heroChristmasGroups.push(xmasSchool);

  scene.add(group);
}

/**
 * 3. Parks Detail: Parc Gilles-Charland (Patinoire, Tennis Courts, Bleachers, Picnic Tables) & Playgrounds
 */
export function buildParksDetail(scene, texLib, pitches, playgrounds, leisureProps, elevDataArg = null) {
  const elevData = getElevData(elevDataArg);
  const group = new THREE.Group();
  const boardMat = new THREE.MeshStandardMaterial({ color: 0xf4f5f6, roughness: 0.55 });
  const redCapMat = new THREE.MeshStandardMaterial({ color: 0xc22727, roughness: 0.55 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x454a50, metalness: 0.65, roughness: 0.4 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xc2c8ce, metalness: 0.65, roughness: 0.35 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x9c744c, roughness: 0.85 });
  const aluMat = new THREE.MeshStandardMaterial({ color: 0xc4cad0, metalness: 0.6, roughness: 0.35 });
  const binGreenMat = new THREE.MeshStandardMaterial({ color: 0x246b3a, roughness: 0.6 });
  const windscreenMat = new THREE.MeshStandardMaterial({
    color: 0x1e5c35,
    roughness: 0.82,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
  });
  const chainLinkMat = new THREE.MeshStandardMaterial({
    map: texLib.chainLinkTex || null,
    color: 0xffffff,
    metalness: 0.55,
    roughness: 0.4,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
  });
  const dirtPathMat = new THREE.MeshStandardMaterial({
    map: texLib.dirtPathTex || null,
    color: texLib.dirtPathTex ? 0xd8cdb8 : 0x8b765d,
    roughness: 0.94,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  registerHeroMaterialSwap(
    dirtPathMat,
    { map: texLib.dirtPathTex || null, color: texLib.dirtPathTex ? 0xd8cdb8 : 0x8b765d, roughness: 0.94 },
    { map: texLib.snowTex, color: 0xeaf2fa, roughness: 0.88 }
  );
  const sentierGlaceMat = new THREE.MeshStandardMaterial({
    map: texLib.dirtPathTex || null,
    color: texLib.dirtPathTex ? 0xcbbda4 : 0x7d654d,
    roughness: 0.92,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  registerHeroMaterialSwap(
    sentierGlaceMat,
    { map: texLib.dirtPathTex || null, color: texLib.dirtPathTex ? 0xcbbda4 : 0x7d654d, roughness: 0.92, metalness: 0.0 },
    { map: texLib.winterIceTex, color: 0xeaf6ff, roughness: 0.14, metalness: 0.15 }
  );
  const parkMats = { steelMat, chainLinkMat };
  const parkLampMat = new THREE.MeshStandardMaterial({
    color: 0xfff2cc,
    emissive: 0xffdf91,
    emissiveIntensity: 0.25,
  });
  registerHeroGlowMaterial(parkLampMat, 0.25, 1.9, 0xffe49e);
  const floodLampMat = new THREE.MeshStandardMaterial({
    color: 0xfff5d6,
    emissive: 0xffe49e,
    emissiveIntensity: 0.3,
  });
  registerHeroGlowMaterial(floodLampMat, 0.3, 2.1, 0xfff0b8);

  const addParkLamp = (x, z) => {
    const e = sampleElevation(x, z, elevData);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 4.2, 6), postMat);
    pole.position.set(x, e + 2.1, z);
    const globe = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.32), parkLampMat);
    globe.position.set(x, e + 4.3, z);
    group.add(pole, globe);
  };

  const addParkBenchAndBin = (x, z, rotY = 0) => {
    const e = sampleElevation(x, z, elevData);
    const b = new THREE.Group();
    b.position.set(x, e, z);
    b.rotation.y = rotY;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.08, 0.48), woodMat);
    seat.position.y = 0.44;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.38, 0.07), woodMat);
    back.position.set(0, 0.72, -0.2);
    for (const lx of [-0.75, 0.75]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.44, 0.44), postMat);
      leg.position.set(lx, 0.22, 0);
      b.add(leg);
    }
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.78, 8), binGreenMat);
    bin.position.set(1.35, 0.39, 0);
    b.add(seat, back, bin);
    group.add(b);
  };

  const addParkSign = (x, z, title, rotY = 0) => {
    const e = sampleElevation(x, z, elevData);
    const tex = texLib.makeBannerTexture(title, '#1e4d2b', '#f5f6f0', 320, 72);
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.85, 0.16),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 })
    );
    board.position.set(x, e + 1.65, z);
    board.rotation.y = rotY;
    for (const px of [-1.25, 1.25]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.1, 0.14), woodMat);
      p.position.set(x + Math.cos(rotY) * px, e + 1.05, z - Math.sin(rotY) * px);
      group.add(p);
    }
    group.add(board);
  };

  // Smooth terrain-conforming path ribbon (subdivided every ~4m so paths never clip or float on hills)
  const addPathStrip = (pts, width, mat) => {
    if (!pts || pts.length < 2) return;
    const subPts = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const segLen = Math.hypot(x1 - x0, z1 - z0);
      const steps = Math.max(1, Math.ceil(segLen / 4.0));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        subPts.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]);
      }
    }
    const geo = createRibbonGeometry(subPts, width, 0.072, 4, elevData);
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  // Helper: map terrain-conforming polygon geometry UVs cleanly onto [0..1, 0..1] along oriented axes
  const remapPolyUVs = (geom, cx, cz, ux, uz, vx, vz, spanU, spanV) => {
    const pos = geom.attributes.position;
    const uv = geom.attributes.uv;
    if (!pos || !uv) return;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - cx;
      const dz = pos.getZ(i) - cz;
      const u = (dx * ux + dz * uz) / spanU + 0.5;
      const v = (dx * vx + dz * vz) / spanV + 0.5;
      uv.setXY(i, u, v);
    }
    uv.needsUpdate = true;
  };

  // Outdoor Hockey Rink / Patinoire (169154918) at Parc Gilles-Charland — terrain-conforming with zero grass clipping
  const rink = pitches.find((p) => p.kind === 'ice_rink');
  if (rink) {
    const pts = rink.pts;
    const rinkMat = new THREE.MeshStandardMaterial({
      map: texLib.rinkTex,
      roughness: 0.82,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    registerHeroMaterialSwap(
      rinkMat,
      { map: texLib.rinkTex, color: 0xffffff, roughness: 0.82, metalness: 0.0 },
      { map: texLib.winterIceTex, color: 0xffffff, roughness: 0.14, metalness: 0.12 }
    );
    // Subdivided terrain-hugging rink floor grid (18x8 cells, rounded corners) so zero interior terrain mounds ever poke through
    const rAng = -0.083;
    const ux = Math.cos(rAng), uz = Math.sin(rAng);
    const vx = -uz, vz = ux;
    const halfL = 25.3, halfW = 11.1, cornerR = 5.4;
    const cols = 18, rows = 8;
    const rPos = [], rUvs = [], rIdx = [];
    const clampRounded = (lu, lv) => {
      const iu = Math.max(0, Math.abs(lu) - (halfL - cornerR));
      const iv = Math.max(0, Math.abs(lv) - (halfW - cornerR));
      const d = Math.hypot(iu, iv);
      if (d > cornerR) {
        const sc = cornerR / d;
        return [
          Math.sign(lu) * ((halfL - cornerR) + iu * sc),
          Math.sign(lv) * ((halfW - cornerR) + iv * sc),
        ];
      }
      return [lu, lv];
    };
    for (let r = 0; r <= rows; r++) {
      const vFrac = r / rows;
      const rawV = (vFrac - 0.5) * (halfW * 2);
      for (let c = 0; c <= cols; c++) {
        const uFrac = c / cols;
        const rawU = (uFrac - 0.5) * (halfL * 2);
        const [lu, lv] = clampRounded(rawU, rawV);
        const wx = rink.cx + ux * lu + vx * lv;
        const wz = rink.cz + uz * lu + vz * lv;
        const wy = sampleElevation(wx, wz, elevData) + 0.11;
        rPos.push(wx, wy, wz);
        rUvs.push(lu / (halfL * 2) + 0.5, lv / (halfW * 2) + 0.5);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * (cols + 1) + c;
        const b = a + 1;
        const d = (r + 1) * (cols + 1) + c;
        const e = d + 1;
        rIdx.push(a, d, b, b, d, e);
      }
    }
    const floorGeo = new THREE.BufferGeometry();
    floorGeo.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
    floorGeo.setAttribute('uv', new THREE.Float32BufferAttribute(rUvs, 2));
    floorGeo.setIndex(rIdx);
    floorGeo.computeVertexNormals();
    const floor = new THREE.Mesh(floorGeo, rinkMat);
    floor.receiveShadow = true;
    group.add(floor);

    // Perimeter dasher boards (white + red cap rail) + tall galvanized steel chain-link safety fencing behind both goal ends
    for (let i = 0; i < pts.length; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[(i + 1) % pts.length];
      const segLen = Math.hypot(x1 - x0, z1 - z0);
      if (segLen < 0.2) continue;
      const mx = (x0 + x1) * 0.5;
      const mz = (z0 + z1) * 0.5;
      const mElev = sampleElevation(mx, mz, elevData);
      const ang = Math.atan2(z1 - z0, x1 - x0);
      const board = new THREE.Mesh(new THREE.BoxGeometry(segLen + 0.08, 1.32, 0.16), boardMat);
      board.position.set(mx, mElev + 0.56, mz);
      board.rotation.y = -ang;
      board.castShadow = true;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(segLen + 0.1, 0.1, 0.2), redCapMat);
      cap.position.set(mx, mElev + 1.24, mz);
      cap.rotation.y = -ang;
      group.add(board, cap);

      // Tall galvanized chain-link protective mesh above boards at both curved goal ends (matches May 2024 Street View)
      const isGoalEnd = mx < -168.5 || mx > -133.5;
      if (isGoalEnd) {
        const netH = 2.05;
        const pGeo = new THREE.PlaneGeometry(segLen, netH);
        const pUv = pGeo.attributes.uv;
        for (let ui = 0; ui < pUv.count; ui++) pUv.setXY(ui, pUv.getX(ui) * segLen * 0.85, pUv.getY(ui) * netH * 0.85);
        const netPanel = new THREE.Mesh(pGeo, chainLinkMat);
        netPanel.position.set(mx, mElev + 1.28 + netH * 0.5, mz);
        netPanel.rotation.y = -ang;
        const topBar = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.055, 0.055), steelMat);
        topBar.position.set(mx, mElev + 1.28 + netH, mz);
        topBar.rotation.y = -ang;
        const endPost = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, netH + 0.1, 6), steelMat);
        endPost.position.set(x0, sampleElevation(x0, z0, elevData) + 1.28 + netH * 0.5, z0);
        group.add(netPanel, topBar, endPost);
      }
    }

    // 4 Tall Rink Corner Floodlight Poles
    for (const [fx, fz] of [
      [-175.8, -206.0],
      [-127.0, -202.2],
      [-174.5, -225.2],
      [-126.2, -221.5],
    ]) {
      const fe = sampleElevation(fx, fz, elevData);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 7.2, 6), postMat);
      pole.position.set(fx, fe + 3.6, fz);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.28, 0.36), floodLampMat);
      lamp.position.set(fx, fe + 7.2, fz);
      group.add(pole, lamp);
    }

    // 2 Hockey Goal Cages + 2 Player Benches inside Patinoire
    for (const [gx, gz, rotY] of [
      [-171.0, -215.6, 0.08],
      [-131.0, -212.2, Math.PI + 0.08],
    ]) {
      const ge = sampleElevation(gx, gz, elevData);
      const goal = new THREE.Group();
      goal.position.set(gx, ge + 0.08, gz);
      goal.rotation.y = rotY;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.22, 1.83), redCapMat);
      frame.position.set(0, 0.61, 0);
      const net = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 1.18, 1.78),
        new THREE.MeshStandardMaterial({ color: 0xeef2f5, transparent: true, opacity: 0.45 })
      );
      net.position.set(-0.42, 0.6, 0);
      goal.add(frame, net);
      group.add(goal);
    }
    for (const [bx, bz] of [
      [-158.0, -203.8],
      [-144.0, -202.6],
    ]) {
      const be = sampleElevation(bx, bz, elevData);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.45, 0.55), woodMat);
      bench.position.set(bx, be + 0.24, bz);
      bench.rotation.y = 0.08;
      group.add(bench);
    }
  }

  // Two Lit Acrylic Tennis Courts at Parc Gilles-Charland — terrain-conforming + diamond-mesh fences + dual windscreens
  const tennisCourts = pitches.filter((p) => p.sport === 'tennis');
  const tennisMat = new THREE.MeshStandardMaterial({
    map: texLib.tennisTex,
    roughness: 0.8,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  registerHeroMaterialSwap(
    tennisMat,
    { map: texLib.tennisTex, color: 0xffffff, roughness: 0.8 },
    { map: texLib.snowTex, color: 0xeaf2fa, roughness: 0.88 }
  );
  for (const tc of tennisCourts) {
    const p = tc.pts;
    const dx01 = p[1][0] - p[0][0], dz01 = p[1][1] - p[0][1];
    const dx03 = p[3][0] - p[0][0], dz03 = p[3][1] - p[0][1];
    const lenA = Math.hypot(dx01, dz01);
    const lenB = Math.hypot(dx03, dz03);
    const ang = Math.atan2(dz01, dx01);
    const courtW = Math.min(lenA, lenB);
    const tcElev = sampleElevation(tc.cx, tc.cz, elevData);

    const tcGeo = createGroundPolygonGeometry(p, 0.088, 0.04, elevData);
    if (tcGeo) {
      const ux = dx01 / (lenA || 1), uz = dz01 / (lenA || 1);
      const vx = dx03 / (lenB || 1), vz = dz03 / (lenB || 1);
      remapPolyUVs(tcGeo, tc.cx, tc.cz, ux, uz, vx, vz, lenA, lenB);
      const courtMesh = new THREE.Mesh(tcGeo, tennisMat);
      courtMesh.receiveShadow = true;
      group.add(courtMesh);
    }

    const netRot = lenA < lenB ? -ang : -(ang - Math.PI / 2);
    const net = new THREE.Mesh(
      new THREE.BoxGeometry(courtW * 0.82, 0.92, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x202428, transparent: true, opacity: 0.78 })
    );
    net.position.set(tc.cx, tcElev + 0.48, tc.cz);
    net.rotation.y = netRot;
    const netTape = new THREE.Mesh(new THREE.BoxGeometry(courtW * 0.82, 0.08, 0.08), boardMat);
    netTape.position.set(tc.cx, tcElev + 0.94, tc.cz);
    netTape.rotation.y = netRot;
    group.add(net, netTape);

    // Chain-link perimeter fence + dark green windscreens on both baseline ends
    addChainLinkFence(group, p, 3.0, elevData, true, new Set([3]), parkMats);
    for (const [iA, iB] of [[0, 1], [2, 3]]) {
      const [wx0, wz0] = p[iA];
      const [wx1, wz1] = p[iB];
      const wLen = Math.hypot(wx1 - wx0, wz1 - wz0);
      const wAng = Math.atan2(wz1 - wz0, wx1 - wx0);
      const wElev = sampleElevation((wx0 + wx1) / 2, (wz0 + wz1) / 2, elevData);
      const ws = new THREE.Mesh(new THREE.PlaneGeometry(wLen, 2.2), windscreenMat);
      ws.position.set((wx0 + wx1) / 2, wElev + 1.35, (wz0 + wz1) / 2);
      ws.rotation.y = -wAng;
      group.add(ws);
    }

    for (const pt of p) {
      const pElev = sampleElevation(pt[0], pt[1], elevData);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 6.2, 0.14), postMat);
      pole.position.set(pt[0], pElev + 3.1, pt[1]);
      const flood = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.25, 0.35), floodLampMat);
      flood.position.set(pt[0], pElev + 6.2, pt[1]);
      group.add(pole, flood);
    }
  }
  addParkBenchAndBin(-230.5, -309.0, 0.22);

  // Hero Chalet du Parc Gilles-Charland (2515 Chemin Galvin, id=827183579)
  const chaletX = -184.6, chaletZ = -233.5, chaletAng = 1.7508;
  const chaletElev = sampleElevation(chaletX, chaletZ, elevData);
  const chaletGrp = new THREE.Group();
  chaletGrp.position.set(chaletX, chaletElev, chaletZ);
  chaletGrp.rotation.y = -chaletAng;

  const chStoneMat = new THREE.MeshStandardMaterial({ map: texLib.brickTextures[0], color: 0xd8cfc0, roughness: 0.88 });
  const chSidingMat = new THREE.MeshStandardMaterial({ map: texLib.sidingTextures[0], color: 0xf4f5f0, roughness: 0.72 });
  const chRoofMat = new THREE.MeshStandardMaterial({ map: texLib.shingleTextures[1] || texLib.shingleTextures[0], color: 0x52565c, roughness: 0.88 });
  registerHeroMaterialSwap(
    chRoofMat,
    { map: texLib.shingleTextures[1] || texLib.shingleTextures[0], color: 0x52565c, roughness: 0.88 },
    { map: texLib.snowRoofTex, color: 0xeef5fc, roughness: 0.84 }
  );
  const chTrimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.52 });
  const chGreenMat = new THREE.MeshStandardMaterial({ color: 0x1e4d2b, roughness: 0.58 });
  const chWinMat = new THREE.MeshStandardMaterial({ map: texLib.windowTex, color: 0xffffff, roughness: 0.25, metalness: 0.22 });
  registerHeroWindowMaterial(chWinMat, texLib, 0.72, 0xffb84d);
  const chBrickChimMat = new THREE.MeshStandardMaterial({
    map: texLib.brickTextures[3] || texLib.brickTextures[0],
    color: 0x9c4e3b,
    roughness: 0.86,
  });

  const chFound = makeWorldBox(9.8, 1.8, 15.0, new THREE.MeshStandardMaterial({ map: texLib.foundationTex || texLib.concreteTex, color: 0xb6bbb6, roughness: 0.92 }));
  chFound.position.set(0, -0.55, 0);
  const chLower = makeWorldBox(9.7, 1.9, 14.9, chStoneMat, 1.8);
  chLower.position.set(0, 0.35 + 0.95, 0);
  chLower.castShadow = true;
  chLower.receiveShadow = true;
  const chUpper = makeWorldBox(9.7, 1.75, 14.9, chSidingMat);
  chUpper.position.set(0, 2.25 + 0.875, 0);
  chUpper.castShadow = true;
  const chRoof = new THREE.Mesh(createPitchedRoofGeometry(9.7, 14.9, 2.15, true, 0.65), chRoofMat);
  chRoof.position.set(0, 4.0, 0);
  chRoof.castShadow = true;
  const chRoofTrim = new THREE.Mesh(createRoofTrimGeometry(9.7, 14.9, 2.15, true, 0.65), chTrimMat);
  chRoofTrim.position.copy(chRoof.position);
  // Brick chimney on Chalet du Parc Gilles-Charland
  const chChim = makeWorldBox(0.88, 2.4, 0.88, chBrickChimMat, 1.8);
  chChim.position.set(-1.4, 5.55, -2.6);
  chChim.castShadow = true;
  const chChimCap = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.14, 1.02), chTrimMat);
  chChimCap.position.set(-1.4, 6.82, -2.6);
  const chChimFlue = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.22, 0.44), postMat);
  chChimFlue.position.set(-1.4, 6.96, -2.6);
  chaletGrp.add(chFound, chLower, chUpper, chRoof, chRoofTrim, chChim, chChimCap, chChimFlue);
  registerHeroChimney(scene, chaletGrp, -1.4, 7.08, -2.6);

  // Covered front veranda facing rink/parking (+X side) with timber columns, skate benches & chalet banner
  const verandaDeck = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.36, 13.8), new THREE.MeshStandardMaterial({ map: texLib.concreteTex, color: 0xc2c6c2, roughness: 0.9 }));
  verandaDeck.position.set(5.95, 0.18, 0);
  verandaDeck.receiveShadow = true;
  const verandaRoof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 14.4), chRoofMat);
  verandaRoof.position.set(6.0, 3.25, 0);
  verandaRoof.rotation.z = -0.18;
  verandaRoof.castShadow = true;
  chaletGrp.add(verandaDeck, verandaRoof);
  for (const pz of [-6.4, -2.2, 2.2, 6.4]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.85, 0.18), woodMat);
    post.position.set(6.85, 1.72, pz);
    post.castShadow = true;
    chaletGrp.add(post);
  }
  // Double entrance doors + chalet windows + municipal banner sign + skate benches + bike rack
  const chDoor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.25, 1.95), chGreenMat);
  chDoor.position.set(4.88, 1.48, 0);
  const chDoorPane = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.55, 1.45), chWinMat);
  chDoorPane.position.set(4.9, 1.65, 0);
  const chSignTex = texLib.makeBannerTexture('CHALET • PARC GILLES-CHARLAND', '#1e4d2b', '#f5f6f0', 440, 68);
  const chSignMat = new THREE.MeshStandardMaterial({ map: chSignTex, roughness: 0.45 });
  registerHeroSignMaterial(chSignMat, chSignTex, 0.72, 0xfff0d0);
  const chSign = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.62, 5.4), chSignMat);
  chSign.position.set(7.1, 3.05, 0);
  chaletGrp.add(chDoor, chDoorPane, chSign);
  // Warm veranda sconces flanking chalet double doors
  for (const sz of [-1.45, 1.45]) {
    const chSconce = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 0.14), parkLampMat);
    chSconce.position.set(4.96, 2.35, sz);
    chaletGrp.add(chSconce);
  }
  for (const wz of [-4.6, 4.6]) {
    const winF = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.25, 1.75), chGreenMat);
    winF.position.set(4.88, 2.2, wz);
    const winP = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.05, 1.55), chWinMat);
    winP.position.set(4.9, 2.2, wz);
    const benchS = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 2.2), woodMat);
    benchS.position.set(5.55, 0.58, wz);
    chaletGrp.add(winF, winP, benchS);
  }
  for (const rz of [-4.6, 0, 4.6]) {
    const rWin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 1.5), chWinMat);
    rWin.position.set(-4.88, 2.2, rz);
    chaletGrp.add(rWin);
  }
  // Black steel bike rack outside chalet
  for (let bi = 0; bi < 5; bi++) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 6, 10, Math.PI), postMat);
    hoop.position.set(7.8, 0.08, 3.2 + bi * 0.52);
    chaletGrp.add(hoop);
  }
  // Christmas Mode decorations for Chalet du Parc Gilles-Charland (hidden by default)
  const xmasChalet = new THREE.Group();
  xmasChalet.visible = false;
  // Multicolor string lights around chalet eaves & front veranda roof
  addChristmasStringLine(xmasChalet, 5.45, 3.96, -7.8, 5.45, 3.96, 7.8, 0.6);
  addChristmasStringLine(xmasChalet, -5.45, 3.96, -7.8, -5.45, 3.96, 7.8, 0.65);
  addChristmasStringLine(xmasChalet, -5.45, 3.96, -7.8, 5.45, 3.96, -7.8, 0.65);
  addChristmasStringLine(xmasChalet, -5.45, 3.96, 7.8, 5.45, 3.96, 7.8, 0.65);
  addChristmasStringLine(xmasChalet, 7.26, 3.02, -7.1, 7.26, 3.02, 7.1, 0.55);
  // Red-bow pine garlands & festive "JOYEUX NOËL" banner on veranda + door wreath
  addChristmasGarland(xmasChalet, 7.12, 2.74, -6.4, 7.12, 2.74, -2.2);
  addChristmasGarland(xmasChalet, 7.12, 2.74, 2.2, 7.12, 2.74, 6.4);
  addChristmasBanner(xmasChalet, 7.22, 3.68, 0, 3.8, 0.62, Math.PI / 2, '★ JOYEUX NOËL ★', texLib);
  addChristmasWreath(xmasChalet, 5.02, 1.85, 0, Math.PI / 2, texLib);
  // Cute voxel snowman beside the chalet + giant candy canes + glowing lawn star
  addVoxelSnowman(xmasChalet, 8.6, 0, -4.6, Math.PI / 2, 1.15);
  addCandyCane(xmasChalet, 7.5, 0, -1.6, Math.PI / 2, 1.05);
  addCandyCane(xmasChalet, 7.5, 0, 1.6, Math.PI / 2, 1.05);
  addGlowingLawnStar(xmasChalet, 8.8, 0, -7.2, Math.PI / 2, 1.1);
  chaletGrp.add(xmasChalet);
  heroChristmasGroups.push(xmasChalet);
  group.add(chaletGrp);

  // Parc Gilles-Charland: Cohesive Terrain-Hugging Walkways + Lit Sentier Glacé Wooded Trail + Signage
  addPathStrip(
    [[-199.0, -246.0], [-192.0, -238.0], [-185.0, -229.0], [-180.0, -217.0], [-177.0, -206.0]],
    2.4,
    dirtPathMat
  );
  addPathStrip(
    [[-192.0, -242.0], [-195.0, -258.0], [-199.0, -270.0]],
    2.2,
    dirtPathMat
  );
  addPathStrip(
    [[-209.0, -286.0], [-218.0, -296.0], [-227.0, -304.0]],
    2.2,
    dirtPathMat
  );
  // Lit Sentier Glacé curving smoothly into the northern woods
  addPathStrip(
    [[-191.0, -258.0], [-188.5, -278.0], [-190.5, -305.0], [-194.5, -335.0], [-205.0, -355.0]],
    2.6,
    sentierGlaceMat
  );
  for (const [lx, lz] of [
    [-195.0, -244.0],
    [-193.0, -264.0],
    [-187.5, -284.0],
    [-190.0, -312.0],
    [-194.0, -338.0],
    [-216.0, -294.0],
  ]) {
    addParkLamp(lx, lz);
  }
  addParkSign(-195.5, -242.5, 'PARC GILLES-CHARLAND', -0.45);
  addParkBenchAndBin(-192.5, -252.0, -0.2);
  addParkBenchAndBin(-208.0, -274.0, 0.75);
  addParkBenchAndBin(-193.0, -288.0, -1.4);

  // Full-Scale Multi-Tower Playground Complex inside Parc Gilles-Charland's main curved playground (-200.0, -282.4)
  const addLargePlaygroundComplex = (cx, cz) => {
    const e0 = sampleElevation(cx, cz, elevData);
    const pg = new THREE.Group();
    pg.position.set(cx, e0, cz);
    const blueM = new THREE.MeshStandardMaterial({ color: 0x2468b2, roughness: 0.48 });
    const redM = new THREE.MeshStandardMaterial({ color: 0xd6392c, roughness: 0.45 });
    const yelM = new THREE.MeshStandardMaterial({ color: 0xf2b729, roughness: 0.45 });
    const grnM = new THREE.MeshStandardMaterial({ color: 0x2e8b47, roughness: 0.5 });

    // Tower 1 (North-West, higher deck) + Tower 2 (South-East) linked by suspension bridge
    for (const [tx, tz, hDeck, roofC] of [[-2.8, -1.2, 1.85, redM], [2.6, 0.8, 1.45, blueM]]) {
      const deck = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 2.4), yelM);
      deck.position.set(tx, hDeck, tz);
      deck.castShadow = true;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.0, 1.3, 4), roofC);
      roof.position.set(tx, hDeck + 2.35, tz);
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      pg.add(deck, roof);
      for (const [px, pz] of [[-1.08, -1.08], [1.08, -1.08], [-1.08, 1.08], [1.08, 1.08]]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, hDeck + 1.85, 0.14), blueM);
        post.position.set(tx + px, (hDeck + 1.85) * 0.5, tz + pz);
        pg.add(post);
      }
      // Side safety panels
      const panel = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.85, 0.1), grnM);
      panel.position.set(tx, hDeck + 0.52, tz - 1.08);
      pg.add(panel);
    }
    // Suspension bridge between towers
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.14, 1.25), woodMat);
    bridge.position.set(-0.1, 1.65, -0.2);
    bridge.rotation.y = -0.35;
    bridge.rotation.z = -0.09;
    bridge.castShadow = true;
    // Double yellow slide off Tower 1 + red slide off Tower 2
    const slide1 = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 3.2), yelM);
    slide1.position.set(-2.8, 1.0, 1.2);
    slide1.rotation.x = 0.56;
    slide1.castShadow = true;
    const slide2 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 2.6), redM);
    slide2.position.set(4.5, 0.82, 0.8);
    slide2.rotation.z = -0.52;
    slide2.castShadow = true;
    // Overhead monkey bars beside Tower 2
    const mbTop = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 0.9), steelMat);
    mbTop.position.set(1.2, 2.35, -3.4);
    for (const mx of [-0.4, 2.8]) {
      for (const mz of [-3.8, -3.0]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.35, 0.1), grnM);
        leg.position.set(mx, 1.18, mz);
        pg.add(leg);
      }
    }
    // See-saw + 2 colorful spring riders
    const seesaw = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 0.3), redM);
    seesaw.position.set(-4.2, 0.65, 4.2);
    seesaw.rotation.z = 0.14;
    const fulcrum = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.55, 0.35), steelMat);
    fulcrum.position.set(-4.2, 0.28, 4.2);
    pg.add(bridge, slide1, slide2, mbTop, seesaw, fulcrum);
    for (const [rx, rz, col] of [[-1.0, 5.2, yelM], [1.4, 5.4, blueM]]) {
      const spring = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.45, 6), steelMat);
      spring.position.set(rx, 0.22, rz);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.38, 0.32), col);
      seat.position.set(rx, 0.56, rz);
      pg.add(spring, seat);
    }
    group.add(pg);
  };
  addLargePlaygroundComplex(-200.0, -282.4);

  // Parc Gilles-Charland: Iconic 4-ft galvanized steel chain-link playground fence along Chemin Galvin
  addChainLinkFence(
    group,
    [[-193.0, -181.6], [-170.0, -179.4]],
    1.28,
    elevData,
    false,
    new Set(),
    parkMats
  );
  addChainLinkFence(
    group,
    [[-162.5, -178.7], [-128.0, -175.8]],
    1.28,
    elevData,
    false,
    new Set(),
    parkMats
  );

  // Parc Ducharme (-209, -512), Parc Bibeau (419, -923), & Parc Walter-Camden (517, 334)
  const otherParks = [
    [-209, -512, 'PARC DUCHARME', 0.35],
    [419, -923, 'PARC BIBEAU', -0.2],
    [517, 334, 'PARC WALTER-CAMDEN', -0.15],
  ];
  for (const [px, pz, title, rot] of otherParks) {
    addParkSign(px, pz, title, rot);
    addPathStrip(
      [
        [px - 8, pz - 4],
        [px, pz + 3],
        [px + 10, pz + 7],
      ],
      2.2,
      dirtPathMat
    );
    addParkBenchAndBin(px - 3, pz + 4, rot);
    addParkBenchAndBin(px + 6, pz + 6, rot + 0.4);
    addParkLamp(px - 6, pz + 1);
    addParkLamp(px + 8, pz + 8);
    addChainLinkFence(
      group,
      [
        [px - 10, pz - 6],
        [px + 10, pz - 6],
        [px + 10, pz + 10],
      ],
      1.35,
      elevData,
      false,
      new Set(),
      parkMats
    );
  }

  // Leisure props (picnic tables & bleachers)
  for (const prop of leisureProps) {
    const pElev = sampleElevation(prop.x, prop.z, elevData);
    if (prop.kind === 'picnic_table') {
      const pt = new THREE.Group();
      pt.position.set(prop.x, pElev, prop.z);
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.85), woodMat);
      top.position.y = 0.74;
      top.castShadow = true;
      const bench1 = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.07, 0.3), woodMat);
      bench1.position.set(0, 0.44, 0.65);
      const bench2 = bench1.clone();
      bench2.position.z = -0.65;
      const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.74, 1.3), postMat);
      leg1.position.set(-0.65, 0.37, 0);
      const leg2 = leg1.clone();
      leg2.position.x = 0.65;
      pt.add(top, bench1, bench2, leg1, leg2);
      group.add(pt);
    } else if (prop.kind === 'bleachers') {
      const bl = new THREE.Group();
      bl.position.set(prop.x, pElev, prop.z);
      for (let tier = 0; tier < 3; tier++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.08, 0.42), aluMat);
        plank.position.set(0, 0.42 + tier * 0.4, tier * 0.55);
        plank.castShadow = true;
        bl.add(plank);
      }
      group.add(bl);
    }
  }

  // Park Playgrounds (skip main curved Parc Gilles-Charland playground which has our full multi-tower complex)
  for (const pg of playgrounds) {
    if (Math.hypot(pg.cx - 280, pg.cz - 290) < 60) continue;
    if (Math.hypot(pg.cx - (-200.0), pg.cz - (-282.4)) < 6) continue;
    addPlaygroundEquipment(group, pg.cx, pg.cz, pg.sub, pg.id, sampleElevation(pg.cx, pg.cz, elevData));
  }

  // Christmas Mode decorations for Parc Gilles-Charland (hidden by default)
  const xmasPark = new THREE.Group();
  xmasPark.visible = false;
  const parkTreeElev = sampleElevation(-191.5, -245.5, elevData);
  addDecoratedChristmasTree(xmasPark, -191.5, parkTreeElev, -245.5, 1.4, true);
  // Glowing reindeer & lawn star beside the Parc Gilles-Charland Christmas tree + candy canes by park sign
  addGlowingReindeer(xmasPark, -188.6, sampleElevation(-188.6, -247.0, elevData), -247.0, 0.65, 1.15);
  addGlowingLawnStar(xmasPark, -194.2, sampleElevation(-194.2, -247.5, elevData), -247.5, -0.35, 1.15);
  addCandyCane(xmasPark, -197.2, sampleElevation(-197.2, -243.2, elevData), -243.2, -0.45, 1.05);
  addCandyCane(xmasPark, -193.8, sampleElevation(-193.8, -241.8, elevData), -241.8, Math.PI - 0.45, 1.05);
  const rinkY = (rink ? sampleElevation(rink.cx, rink.cz, elevData) : parkTreeElev) + 1.28;
  addChristmasGarland(xmasPark, -172.5, rinkY, -205.5, -130.5, rinkY, -202.0);
  addChristmasStringLine(xmasPark, -172.5, rinkY, -226.0, -130.5, rinkY, -222.5, 0.85);
  const signElev = sampleElevation(-194, -240, elevData);
  addChristmasGarland(xmasPark, -195.4, signElev + 2.15, -240.6, -192.6, signElev + 2.15, -239.4);
  group.add(xmasPark);
  heroChristmasGroups.push(xmasPark);

  scene.add(group);
}

/**
 * 4. Commercial Signage & Authentic Rue King Est Storefronts
 */
export function buildCommercialSigns(scene, texLib, buildings, elevDataArg = null) {
  const elevData = getElevData(elevDataArg);
  const group = new THREE.Group();

  const glassMat = new THREE.MeshStandardMaterial({ color: 0x223648, roughness: 0.16, metalness: 0.48 });
  registerHeroWindowMaterial(glassMat, texLib, 0.68, 0xffc05c);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.45 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xbcc3ca, metalness: 0.65, roughness: 0.35 });
  const concreteMat = new THREE.MeshStandardMaterial({ map: texLib.concreteTex, color: 0xc2c6ca, roughness: 0.88 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x9b683b, roughness: 0.8 });
  const hvacMat = new THREE.MeshStandardMaterial({ color: 0xb0b8c0, metalness: 0.45, roughness: 0.42 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2e3338, roughness: 0.7 });
  const bollardMat = new THREE.MeshStandardMaterial({ color: 0xe5b81b, roughness: 0.45 });
  const shrubMat = new THREE.MeshStandardMaterial({ map: texLib.leafDeciduousTex, color: 0x457b3f, roughness: 0.88 });
  registerHeroMaterialSwap(
    shrubMat,
    { map: texLib.leafDeciduousTex, color: 0x457b3f, roughness: 0.88 },
    { map: texLib.snowTex, color: 0xe2edf7, roughness: 0.86 }
  );

  // Closest point direction from building center to Rue King Est centerline (-888,-725)->(-335,-898)
  const dirToRueKing = (cx, cz) => {
    const ax = -888.4, az = -725.7;
    const bx = -335.4, bz = -898.2;
    const abx = bx - ax, abz = bz - az;
    const t = Math.max(0, Math.min(1, ((cx - ax) * abx + (cz - az) * abz) / (abx * abx + abz * abz)));
    const px = ax + abx * t;
    const pz = az + abz * t;
    const len = Math.hypot(px - cx, pz - cz) || 1;
    return [(px - cx) / len, (pz - cz) / len];
  };

  // Extract polygon edges facing Rue King Est, sorted longest-first
  const getKingFrontEdges = (b) => {
    const pts = b.pts;
    if (!pts || pts.length < 3) return [];
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[(i + 1) % pts.length];
      area += x0 * z1 - x1 * z0;
    }
    const sgn = area > 0 ? 1 : -1;
    const [kx, kz] = dirToRueKing(b.obbCx, b.obbCz);
    const edges = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[(i + 1) % pts.length];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 3.0) continue;
      const nx = (sgn * dz) / len;
      const nz = (sgn * -dx) / len;
      const dot = nx * kx + nz * kz;
      if (dot > 0.55) {
        edges.push({ len, midX: (x0 + x1) / 2, midZ: (z0 + z1) / 2, nx, nz, dot });
      }
    }
    edges.sort((a, c) => c.len * c.dot - a.len * a.dot);
    return edges;
  };

  const makeEdgeGroup = (edge, elev) => {
    const sg = new THREE.Group();
    sg.position.set(edge.midX, elev, edge.midZ);
    sg.rotation.y = Math.atan2(edge.nx, edge.nz);
    group.add(sg);
    return sg;
  };

  const addFascia = (sg, x, y, w, h, text, bg, fg, awningColor = null) => {
    const tex = texLib.makeBannerTexture(text, bg, fg, 384, 72);
    const signMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42 });
    registerHeroSignMaterial(signMat, tex, 0.8, 0xffffff);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.24), signMat);
    sign.position.set(x, y, 0.14);
    sg.add(sign);
    if (awningColor !== null) {
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.96, 0.22, 1.45),
        new THREE.MeshStandardMaterial({ color: awningColor, roughness: 0.65 })
      );
      awning.position.set(x, y - h * 0.62 - 0.35, 0.72);
      awning.rotation.x = 0.26;
      awning.castShadow = true;
      sg.add(awning);
    }
  };

  const addGlassStorefront = (sg, x, w, h, withDoors = true) => {
    const win = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.2), glassMat);
    win.position.set(x, h / 2 + 0.15, 0.12);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.14, 0.24), frameMat);
    frame.position.set(x, h + 0.2, 0.12);
    sg.add(win, frame);
    if (withDoors) {
      const vest = new THREE.Mesh(new THREE.BoxGeometry(Math.min(w * 0.45, 5.2), h * 0.92, 1.35), glassMat);
      vest.position.set(x, (h * 0.92) / 2, 0.68);
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(Math.min(w * 0.55, 6.2), 0.22, 1.65), frameMat);
      canopy.position.set(x, h * 0.92 + 0.11, 0.72);
      sg.add(vest, canopy);
    }
  };

  const addRooftopHvacs = (b, elev, roofY, count = 3) => {
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * 8.5;
      const hx = b.obbCx + Math.cos(b.ang + Math.PI / 2) * off;
      const hz = b.obbCz + Math.sin(b.ang + Math.PI / 2) * off;
      const unit = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.05, 2.0), hvacMat);
      unit.position.set(hx, elev + roofY + 0.52, hz);
      unit.rotation.y = -b.ang;
      unit.castShadow = true;
      const louver = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 2.06), darkMat);
      louver.position.set(hx, elev + roofY + 0.52, hz);
      louver.rotation.y = -b.ang;
      group.add(unit, louver);
    }
  };

  const addPylonSign = (x, z, title, bg, fg) => {
    const pElev = sampleElevation(x, z, elevData);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.42, 5.2, 0.42), darkMat);
    pole.position.set(x, pElev + 2.6, z);
    const tex = texLib.makeBannerTexture(title, bg, fg, 256, 96);
    const pylonMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 });
    registerHeroSignMaterial(pylonMat, tex, 0.85, 0xffffff);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 1.45, 0.35),
      pylonMat
    );
    box.position.set(x, pElev + 4.8, z);
    box.rotation.y = 0.32;
    group.add(pole, box);
  };

  const addCafeSet = (sg, x, z, umbrellaColor) => {
    const table = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.06, 10), frameMat);
    table.position.set(x, 0.74, z);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.74, 6), darkMat);
    stem.position.set(x, 0.37, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.3, 6), steelMat);
    pole.position.set(x, 1.15, z);
    const umb = new THREE.Mesh(
      new THREE.ConeGeometry(1.05, 0.48, 6),
      new THREE.MeshStandardMaterial({ color: umbrellaColor, roughness: 0.65 })
    );
    umb.position.set(x, 2.3, z);
    umb.castShadow = true;
    sg.add(table, stem, pole, umb);
    for (const cx of [-0.65, 0.65]) {
      const chair = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.44, 0.42), woodMat);
      chair.position.set(x + cx, 0.22, z);
      sg.add(chair);
    }
  };

  const addPromoBoardAndPosters = (sg, boardX, boardZ, promoText, bg, fg) => {
    const tex = texLib.makeBannerTexture(promoText, bg, fg, 192, 96);
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 1.15, 0.12),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 })
    );
    board.position.set(boardX, 0.62, boardZ);
    board.rotation.x = -0.15;
    sg.add(board);
    for (const px of [-3.2, 3.2]) {
      const poster = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 1.35, 0.06),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 })
      );
      poster.position.set(px, 1.75, 0.22);
      sg.add(poster);
    }
  };

  const byId = new Map(buildings.map((b) => [b.id, b]));

  // 1. 2140 Rue King Est (265699855, 2-storey plaza): 5 storefront bays + canopy + bollards + planters + HVACs + pylon
  const bPlaza = byId.get(265699855);
  if (bPlaza) {
    const elev = sampleElevation(bPlaza.obbCx, bPlaza.obbCz, elevData);
    const frontEdges = getKingFrontEdges(bPlaza).filter((e) => e.len >= 8.5);
    frontEdges.sort((a, c) => a.midX - c.midX);
    const tenants = [
      ['IRIS OPTOMÉTRIE', '#1a4c8a', '#ffffff', 0x153e70],
      ['PÂTISSERIE ALLIANCE', '#6b2c3b', '#f8e6c8', 0x55222e],
      ['COIFFURE LE 109', '#22262b', '#f3d27a', 0x1a1d21],
      ['PARÉ TANGUAY NOTAIRES', '#263849', '#e8d7a8', 0x1e2c3a],
      ['CLINIQUES & BUREAUX', '#1f5c52', '#ffffff', 0x18473f],
    ];
    frontEdges.slice(0, 5).forEach((edge, idx) => {
      const sg = makeEdgeGroup(edge, elev);
      const [title, bg, fg, awn] = tenants[idx % tenants.length];
      const bayW = Math.min(edge.len * 0.86, 13.5);
      addFascia(sg, 0, 4.1, bayW, 1.25, title, bg, fg, awn);
      addGlassStorefront(sg, 0, bayW * 0.9, 2.75, idx === 1 || idx === 4);
      // Overhanging walkway canopy + bollards + planter
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(edge.len * 0.95, 0.2, 2.2), frameMat);
      canopy.position.set(0, 3.2, 1.1);
      sg.add(canopy);
      for (const bx of [-bayW * 0.38, bayW * 0.38]) {
        const bol = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.95, 8), bollardMat);
        bol.position.set(bx, 0.48, 2.4);
        sg.add(bol);
      }
      const planter = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.2), concreteMat);
      planter.position.set(0, 0.25, 2.4);
      const bush = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.6, 0.85), shrubMat);
      bush.position.set(0, 0.72, 2.4);
      sg.add(planter, bush);
      if (idx === 1) {
        addCafeSet(sg, -2.8, 3.2, 0x6b2c3b);
        addCafeSet(sg, 2.8, 3.2, 0x6b2c3b);
      }
    });
    addRooftopHvacs(bPlaza, elev, 7.5, 5);
    addPylonSign(-802.0, -736.0, 'PLAZA 2140 • IRIS', '#1a4c8a', '#ffffff');
  }

  // 2. 2240 Rue King Est (44665821): IGA extra Couture + Rachelle Béry + Tower + 3 Cart Corrals + Planters + HVACs + Pylon
  const bIga = byId.get(44665821);
  if (bIga) {
    const elev = sampleElevation(bIga.obbCx, bIga.obbCz, elevData);
    const frontEdge = getKingFrontEdges(bIga)[0];
    if (frontEdge) {
      const sg = makeEdgeGroup(frontEdge, elev);
      // Tall red IGA entrance tower
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(11.5, 8.2, 2.4),
        new THREE.MeshStandardMaterial({ color: 0xd81f26, roughness: 0.55 })
      );
      tower.position.set(-6.0, 4.1, 0.4);
      tower.castShadow = true;
      sg.add(tower);
      addFascia(sg, -6.0, 6.4, 10.6, 2.0, 'IGA extra COUTURE', '#d81f26', '#ffffff', null);
      addFascia(sg, 11.0, 4.8, 10.0, 1.5, 'Rachelle Béry', '#2c7d3b', '#ffffff', 0x246630);
      addGlassStorefront(sg, -6.0, 10.2, 3.2, true);
      addGlassStorefront(sg, 11.0, 8.8, 3.0, false);
      // Sidewalk planters
      for (const px of [-14.0, 2.0, 18.0]) {
        const pot = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.55, 1.3), concreteMat);
        pot.position.set(px, 0.28, 2.3);
        const bush = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.65, 0.95), shrubMat);
        bush.position.set(px, 0.8, 2.3);
        sg.add(pot, bush);
      }
      // 3 shopping cart corrals in front parking lot
      for (const cx of [-20.0, 0.0, 20.0]) {
        const corral = new THREE.Group();
        corral.position.set(cx, 0, 14.0);
        for (const rx of [-1.1, 1.1]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.95, 4.2), steelMat);
          rail.position.set(rx, 0.48, 0);
          corral.add(rail);
        }
        for (let ci = -1.2; ci <= 1.2; ci += 0.8) {
          const cart = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 0.85), steelMat);
          cart.position.set(0, 0.43, ci);
          corral.add(cart);
        }
        sg.add(corral);
      }
      addPromoBoardAndPosters(sg, -1.5, 2.6, 'SPÉCIAUX', '#d81f26', '#ffffff');
    }
    addRooftopHvacs(bIga, elev, 5.8, 4);
    addPylonSign(-658.0, -792.0, 'IGA extra', '#d81f26', '#ffffff');
  }

  // 3. 2222 Rue King Est (265763441): Le Petit Dégustateur • Cantine + Menu Board + OUVERT + 4 Picnic Tables w/ Umbrellas
  const bDeg = byId.get(265763441) || buildings.find((b) => b.name?.includes('Petit Dégustateur'));
  if (bDeg) {
    const elev = sampleElevation(bDeg.obbCx, bDeg.obbCz, elevData);
    const frontEdge = getKingFrontEdges(bDeg)[0];
    if (frontEdge) {
      const sg = makeEdgeGroup(frontEdge, elev);
      addFascia(sg, 0, 4.3, 10.5, 1.35, 'LE PETIT DÉGUSTATEUR • CANTINE', '#c82026', '#ffdd33', 0xd83226);
      addGlassStorefront(sg, 0, 8.2, 2.7, true);
      const menuTex = texLib.makeBannerTexture('POUTINE • HOT-DOGS • BURGERS', '#1e2226', '#ffdd55', 256, 96);
      const menuBoard = new THREE.Mesh(
        new THREE.BoxGeometry(1.7, 1.15, 0.12),
        new THREE.MeshStandardMaterial({ map: menuTex, roughness: 0.45 })
      );
      menuBoard.position.set(-3.2, 1.9, 0.22);
      const ouvertTex = texLib.makeBannerTexture('OUVERT', '#181a1d', '#ff2d46', 128, 48);
      const ouvertMat = new THREE.MeshStandardMaterial({ map: ouvertTex, emissive: 0xaa1122, emissiveIntensity: 0.55 });
      registerHeroGlowMaterial(ouvertMat, 0.55, 1.85, 0xff2b3d);
      const ouvertSign = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.45, 0.12), ouvertMat);
      ouvertSign.position.set(2.8, 2.2, 0.22);
      sg.add(menuBoard, ouvertSign);
      addPromoBoardAndPosters(sg, 3.8, 2.0, '2/$8.99', '#ffdd33', '#c82026');
      // 4 outdoor picnic tables with umbrellas
      for (const [tx, tz, ucol] of [
        [-4.2, 3.2, 0xd81f26],
        [-1.4, 3.2, 0xf2b729],
        [1.4, 3.2, 0xd81f26],
        [4.2, 3.2, 0xf2b729],
      ]) {
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.08, 0.85), woodMat);
        top.position.set(tx, 0.74, tz);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.25, 6), steelMat);
        pole.position.set(tx, 1.12, tz);
        const umb = new THREE.Mesh(
          new THREE.ConeGeometry(1.15, 0.52, 6),
          new THREE.MeshStandardMaterial({ color: ucol, roughness: 0.65 })
        );
        umb.position.set(tx, 2.3, tz);
        umb.castShadow = true;
        sg.add(top, pole, umb);
      }
    }
  }

  // 4. Single-banner Rue King Est Businesses (2110, 2340, 2471, 2485, 2000, 2080, 2090)
  const singleStores = [
    [265699853, 'SUBWAY', '#008c15', '#ffcb05', 0x007211, 11.5, 4.7, 2],
    [825258956, 'PHARMACIE JEAN COUTU', '#0c4da2', '#ffffff', 0x0a3e84, 16.5, 5.1, 3],
    [824687826, 'CLINIQUE DENTAIRE JEAN BERNARD', '#0f7b7e', '#ffffff', 0x0c6366, 14.0, 4.6, 2],
    [824687825, 'FLORDECO • M. DOYON', '#1b2d52', '#f37021', 0x152340, 15.0, 5.1, 2],
    [1413923689, 'BOULANGERIE GEORGES', '#7d3a22', '#fff3d6', 0x612c19, 12.0, 4.6, 1],
    [827141026, 'CÉRAMIQUE FAGGION', '#3a424a', '#f2f4f7', 0x2b3138, 11.5, 4.6, 1],
    [827140881, 'LETTRAGE FOURNIER', '#1d4f91', '#ffdd33', 0x163d70, 12.0, 4.6, 1],
  ];
  for (const [bid, label, bg, fg, awn, sw, sy, hvacCount] of singleStores) {
    const b = byId.get(bid);
    if (!b) continue;
    const elev = sampleElevation(b.obbCx, b.obbCz, elevData);
    const frontEdge = getKingFrontEdges(b)[0];
    if (!frontEdge) continue;
    const sg = makeEdgeGroup(frontEdge, elev);
    const signW = Math.min(frontEdge.len * 0.85, sw);
    addFascia(sg, 0, sy, signW, 1.45, label, bg, fg, awn);
    addGlassStorefront(sg, 0, Math.min(frontEdge.len * 0.72, 9.0), 2.9, true);
    if (bid === 825258956) {
      // Glowing pharmacy cross on Jean Coutu
      const crossMat = new THREE.MeshStandardMaterial({ color: 0x1ea84a, emissive: 0x1ea84a, emissiveIntensity: 0.75 });
      registerHeroGlowMaterial(crossMat, 0.75, 1.85, 0x24d65c);
      const cV = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.35, 0.18), crossMat);
      const cH = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.45, 0.18), crossMat);
      cV.position.set(signW * 0.56, sy, 0.18);
      cH.position.set(signW * 0.56, sy, 0.18);
      sg.add(cV, cH);
      addPromoBoardAndPosters(sg, 4.2, 2.2, 'SOLDE', '#0c4da2', '#ffffff');
    } else if (bid === 265699853) {
      addCafeSet(sg, -3.2, 2.8, 0x008c15);
      addCafeSet(sg, 3.2, 2.8, 0x008c15);
    } else if (bid === 1413923689 || bid === 827141026 || bid === 827140881) {
      // Rolling service-bay shutters (half-open / closed)
      const isClosed = bid === 827141026;
      const shutter = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, isClosed ? 2.6 : 1.1, 0.16),
        steelMat
      );
      shutter.position.set(frontEdge.len * 0.34, isClosed ? 1.3 : 2.15, 0.14);
      sg.add(shutter);
    }
    addRooftopHvacs(b, elev, 5.4, hvacCount);
  }

  // Maison des aînés
  const bMaison = buildings.find((b) => b.name?.includes('Maison des aînés'));
  if (bMaison) {
    const elev = sampleElevation(bMaison.obbCx, bMaison.obbCz, elevData);
    const frontEdge = getKingFrontEdges(bMaison)[0];
    if (frontEdge) {
      const sg = makeEdgeGroup(frontEdge, elev);
      addFascia(sg, 0, 9.5, Math.min(frontEdge.len * 0.72, 12), 1.35, 'MAISON DES AÎNÉS', '#2f5866', '#ffffff', null);
    }
  }

  scene.add(group);
}

/**
 * 5. Hero Commercial Landmark: Renovated Dépanneur Galvin (May 2024 Street View Match) — 2785 Chemin Galvin
 */
export function buildDepanneurGalvin(scene, texLib, bGalvin, elevDataArg = null) {
  if (!bGalvin) return null;
  const elevData = getElevData(elevDataArg);
  const elev = sampleElevation(bGalvin.obbCx, bGalvin.obbCz, elevData);
  const group = new THREE.Group();

  const concreteMat = new THREE.MeshStandardMaterial({ map: texLib.concreteTex, color: 0xc2c5c0, roughness: 0.9 });
  const darkBrickMat = new THREE.MeshStandardMaterial({
    map: texLib.brickTextures[2] || texLib.brickTextures[0],
    color: 0xbab4ae,
    roughness: 0.88,
  });
  const cedarPlankMat = new THREE.MeshStandardMaterial({
    map: texLib.cedarPlankTex || texLib.sidingTextures[5],
    color: 0xe6b684,
    roughness: 0.74,
  });
  const silverMetalMat = new THREE.MeshStandardMaterial({ color: 0xd4d8dc, roughness: 0.42, metalness: 0.35 });
  const darkCharcoalMat = new THREE.MeshStandardMaterial({ color: 0x26292e, roughness: 0.65 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x45484e, roughness: 0.9 });
  registerHeroMaterialSwap(
    roofMat,
    { map: null, color: 0x45484e, roughness: 0.9 },
    { map: texLib.snowRoofTex, color: 0xeef5fc, roughness: 0.84 }
  );
  const porchRoofMat = new THREE.MeshStandardMaterial({ color: 0xc6cbd0, roughness: 0.45, metalness: 0.25 });
  registerHeroMaterialSwap(
    porchRoofMat,
    { map: null, color: 0xc6cbd0, roughness: 0.45, metalness: 0.25 },
    { map: texLib.snowRoofTex, color: 0xeef5fc, roughness: 0.84 }
  );
  const snowCarCapMat = new THREE.MeshStandardMaterial({ color: 0x353b42, roughness: 0.45 });
  registerHeroMaterialSwap(
    snowCarCapMat,
    { map: null, color: 0x353b42, roughness: 0.45 },
    { map: texLib.snowTex, color: 0xeef5fc, roughness: 0.85 }
  );
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1d2b36, roughness: 0.16, metalness: 0.45 });
  registerHeroWindowMaterial(glassMat, texLib, 0.72, 0xffbe55);
  const whiteTrimMat = new THREE.MeshStandardMaterial({ color: 0xf4f5f6, roughness: 0.55 });
  const woodDeckMat = new THREE.MeshStandardMaterial({ color: 0x9b6b43, roughness: 0.82 });

  // Sub-grade foundation plinth matching exact OSM 827183553 polygon
  const plinth = new THREE.Mesh(createExtrudedPolygonGeometry(bGalvin.pts, 1.5, elev - 1.5), concreteMat);
  group.add(plinth);

  // Local group oriented so +Z faces SSW onto Chemin Galvin (ang = 0.42)
  const frontGroup = new THREE.Group();
  frontGroup.position.set(bGalvin.obbCx, elev, bGalvin.obbCz);
  frontGroup.rotation.y = -bGalvin.ang;

  // 1. Left Lower Storage Wing (x: -11.3..-1.75, z: -4.66..5.92, h = 3.65m) in dark charcoal brick
  const storageBody = makeWorldBox(9.55, 3.65, 10.58, darkBrickMat, 1.8);
  storageBody.position.set(-6.52, 1.825, 0.63);
  storageBody.castShadow = true;
  storageBody.receiveShadow = true;
  const storageCap = new THREE.Mesh(new THREE.BoxGeometry(9.75, 0.26, 10.78), roofMat);
  storageCap.position.set(-6.52, 3.72, 0.63);
  const serviceDoor = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.15, 0.14), darkCharcoalMat);
  serviceDoor.position.set(-9.6, 1.08, 5.95);
  const extCabinet = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.55, 0.85), darkCharcoalMat);
  extCabinet.position.set(-4.6, 0.78, 6.32);
  const iceChest = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.95, 0.82), whiteTrimMat);
  iceChest.position.set(-3.0, 0.48, 6.32);
  frontGroup.add(storageBody, storageCap, serviceDoor, extCabinet, iceChest);

  // Rooftop Wood Terrace Deck on top of Left Wing
  const terraceDeck = makeWorldBox(8.6, 0.16, 9.4, woodDeckMat);
  terraceDeck.position.set(-6.5, 3.92, 0.6);
  const railFront = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.92, 0.10), woodDeckMat);
  railFront.position.set(-6.5, 4.42, 5.25);
  const railLeft = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.92, 9.4), woodDeckMat);
  railLeft.position.set(-10.75, 4.42, 0.6);
  const umbrella = new THREE.Mesh(
    new THREE.ConeGeometry(1.45, 0.65, 6),
    new THREE.MeshStandardMaterial({ color: 0x38618c, roughness: 0.7 })
  );
  umbrella.position.set(-6.2, 5.85, 2.2);
  const umbPole = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.9, 0.08), darkCharcoalMat);
  umbPole.position.set(-6.2, 4.9, 2.2);
  frontGroup.add(terraceDeck, railFront, railLeft, umbrella, umbPole);

  // 2. Center Main Storefront Mass (x: -1.75..11.27, z: -10.21..5.95, h = 6.2m)
  const mainLower = makeWorldBox(13.02, 3.6, 16.16, darkBrickMat, 1.8);
  mainLower.position.set(4.76, 1.8, -2.13);
  mainLower.castShadow = true;
  mainLower.receiveShadow = true;
  const mainUpper = makeWorldBox(13.02, 2.6, 16.16, cedarPlankMat);
  mainUpper.position.set(4.76, 3.6 + 1.3, -2.13);
  mainUpper.castShadow = true;
  const parapetBand = new THREE.Mesh(new THREE.BoxGeometry(13.36, 0.42, 16.48), silverMetalMat);
  parapetBand.position.set(4.76, 6.28, -2.13);
  const mainRoofCap = new THREE.Mesh(new THREE.BoxGeometry(13.15, 0.12, 16.25), roofMat);
  mainRoofCap.position.set(4.76, 6.46, -2.13);
  const hvac = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.85, 1.7), silverMetalMat);
  hvac.position.set(2.5, 6.9, -4.5);
  frontGroup.add(mainLower, mainUpper, parapetBand, mainRoofCap, hvac);

  // Right 2nd-storey cedar accent dormer/bumpout with corner window (visible in May 2024 photo)
  const rightDormer = makeWorldBox(3.2, 2.15, 4.3, cedarPlankMat);
  rightDormer.position.set(9.6, 4.95, 3.6);
  const dormerWin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.25, 1.55), glassMat);
  dormerWin.position.set(9.6, 4.95, 5.76);
  const dormerWinF = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.4, 0.12), darkCharcoalMat);
  dormerWinF.position.set(9.6, 4.95, 5.75);
  frontGroup.add(rightDormer, dormerWinF, dormerWin);

  // Illuminated "Dépanneur GALVIN" Sign + Green/Orange Shield Emblem + Light-Silver Eyebrow Canopy
  const signTex = texLib.makeBannerTexture('Dépanneur GALVIN', '#9e6b3f', '#ffffff', 512, 96);
  const galvinSignMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.35 });
  registerHeroSignMaterial(galvinSignMat, signTex, 0.9, 0xffe4a8);
  const signBoard = new THREE.Mesh(new THREE.BoxGeometry(6.8, 1.05, 0.16), galvinSignMat);
  signBoard.position.set(3.2, 5.15, 6.02);
  const emblem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.18, 0.14, 5),
    new THREE.MeshStandardMaterial({ color: 0x359648, roughness: 0.45 })
  );
  emblem.rotation.x = Math.PI / 2;
  emblem.position.set(-0.55, 5.15, 6.08);
  const eyebrowCanopy = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.32, 0.95), silverMetalMat);
  eyebrowCanopy.position.set(1.0, 3.55, 6.38);
  eyebrowCanopy.castShadow = true;
  frontGroup.add(signBoard, emblem, eyebrowCanopy);

  // Storefront Apron, Display Window w/ Vibrant Snack/Slushie Decal & Double Glass Entrance Doors
  const apron = new THREE.Mesh(new THREE.BoxGeometry(14.5, 0.16, 4.6), concreteMat);
  apron.position.set(3.5, 0.08, 8.2);
  apron.receiveShadow = true;
  const winFrame = new THREE.Mesh(new THREE.BoxGeometry(2.65, 2.35, 0.14), darkCharcoalMat);
  winFrame.position.set(-0.1, 1.72, 5.96);
  const posterTex = texLib.makeBannerTexture('SLUSH • SNACKS', '#e88224', '#1d2b36', 256, 128);
  const winPaneMat = new THREE.MeshStandardMaterial({ map: posterTex, roughness: 0.25 });
  registerHeroSignMaterial(winPaneMat, posterTex, 0.72, 0xffe4a8);
  const winPane = new THREE.Mesh(new THREE.BoxGeometry(2.42, 2.12, 0.16), winPaneMat);
  winPane.position.set(-0.1, 1.72, 5.98);
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(2.15, 2.48, 0.14), darkCharcoalMat);
  doorFrame.position.set(2.55, 1.48, 5.96);
  const doorGlass = new THREE.Mesh(new THREE.BoxGeometry(1.92, 2.28, 0.16), glassMat);
  doorGlass.position.set(2.55, 1.48, 5.98);
  const ouvertMat = new THREE.MeshStandardMaterial({ color: 0xff2b2b, emissive: 0xff1a1a, emissiveIntensity: 0.75 });
  registerHeroGlowMaterial(ouvertMat, 0.75, 2.1, 0xff2424);
  const ouvertSign = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.26, 0.18), ouvertMat);
  ouvertSign.position.set(0.55, 2.05, 6.02);
  frontGroup.add(apron, winFrame, winPane, doorFrame, doorGlass, ouvertSign);

  // 3. Right Covered Patio Projection (x: 3.70..10.50, z: 5.95..10.20) w/ Sloped Metal Roof & Cedar Slat Screen
  const patioW = 6.9;
  const patioD = 4.4;
  const porchGroup = new THREE.Group();
  porchGroup.position.set(7.1, 3.82, 8.15);
  porchGroup.rotation.x = 0.22;
  const porchRoof = new THREE.Mesh(new THREE.BoxGeometry(patioW, 0.16, patioD), porchRoofMat);
  porchRoof.castShadow = true;
  const porchFascia = new THREE.Mesh(new THREE.BoxGeometry(patioW + 0.08, 0.22, 0.12), silverMetalMat);
  porchFascia.position.set(0, -0.02, patioD * 0.5);
  porchGroup.add(porchRoof, porchFascia);
  for (let rx = -patioW * 0.45; rx <= patioW * 0.45; rx += 0.58) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, patioD), porchRoofMat);
    seam.position.set(rx, 0.06, 0);
    porchGroup.add(seam);
  }
  frontGroup.add(porchGroup);

  // Low charcoal knee walls, right cedar horizontal slat screen, steel posts & wooden picnic table
  const kneeR = makeWorldBox(0.32, 0.72, 3.85, darkBrickMat);
  kneeR.position.set(10.35, 0.36, 8.2);
  const kneeF = makeWorldBox(2.4, 0.72, 0.32, darkBrickMat);
  kneeF.position.set(9.2, 0.36, 10.05);
  for (const [px, pz, ph] of [[4.05, 9.95, 3.35], [10.35, 9.95, 3.35], [7.2, 9.95, 3.35]]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, ph, 0.16), darkCharcoalMat);
    p.position.set(px, ph * 0.5, pz);
    p.castShadow = true;
    frontGroup.add(p);
  }
  for (let si = 0; si < 5; si++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 3.7), cedarPlankMat);
    slat.position.set(10.35, 1.15 + si * 0.28, 8.2);
    frontGroup.add(slat);
  }
  const picnicTop = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.09, 0.85), woodDeckMat);
  picnicTop.position.set(6.2, 0.76, 8.3);
  for (const bz of [7.68, 8.92]) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.08, 0.28), woodDeckMat);
    bench.position.set(6.2, 0.44, bz);
    frontGroup.add(bench);
  }
  const patrolBin = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.92, 0.55), darkCharcoalMat);
  patrolBin.position.set(4.55, 0.46, 9.45);
  frontGroup.add(kneeR, kneeF, picnicTop, patrolBin);

  // 4. West Fence, Two Yellow-Green Commercial Dumpsters & Parked Cars in Stalls
  const westFence = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.45, 13.5), darkCharcoalMat);
  westFence.position.set(-15.0, 0.72, 9.2);
  westFence.castShadow = true;
  frontGroup.add(westFence);

  const dumpsterMat = new THREE.MeshStandardMaterial({ color: 0xb7c238, roughness: 0.72 });
  for (const dx of [-13.2, -10.8]) {
    const dBody = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.35, 1.45), dumpsterMat);
    dBody.position.set(dx, 0.68, 7.8);
    dBody.rotation.y = 0.08;
    dBody.castShadow = true;
    const dLid = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.14, 1.52), darkCharcoalMat);
    dLid.position.set(dx, 1.4, 7.8);
    dLid.rotation.y = 0.08;
    frontGroup.add(dBody, dLid);
  }

  // Yellow parking stall lines + 3 parked customer cars nose-in in front of storage wing
  const yellowLineMat = new THREE.MeshStandardMaterial({ color: 0xe8b923, roughness: 0.7 });
  for (const lx of [-8.8, -6.0, -3.2, -0.4, 2.4]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 4.6), yellowLineMat);
    line.position.set(lx, 0.065, 10.6);
    frontGroup.add(line);
  }
  for (const [cx, col] of [[-7.4, 0x3b444f], [-4.6, 0xedeff2], [-1.8, 0x245aa8]]) {
    const car = makeParkedCarMesh(col, snowCarCapMat);
    car.position.set(cx, 0.06, 10.5);
    car.rotation.y = Math.PI + (cx * 0.01);
    frontGroup.add(car);
  }

  // Christmas Mode decorations for Dépanneur Galvin (hidden by default)
  const xmasGalvin = new THREE.Group();
  xmasGalvin.visible = false;
  addChristmasStringLine(xmasGalvin, -1.8, 6.2, 6.18, 11.2, 6.2, 6.18, 0.55);
  addChristmasStringLine(xmasGalvin, 11.4, 6.2, -10.1, 11.4, 6.2, 6.1, 0.62);
  addChristmasStringLine(xmasGalvin, -1.8, 3.45, 6.86, 3.8, 3.45, 6.86, 0.48);
  addChristmasStringLine(xmasGalvin, 3.65, 3.3, 10.35, 10.55, 3.3, 10.35, 0.5);
  addChristmasStringLine(xmasGalvin, -10.75, 4.88, 5.25, -2.2, 4.88, 5.25, 0.58);
  // Red-bow pine garlands along eyebrow canopy & covered patio + festive "JOYEUX NOËL" banner
  addChristmasGarland(xmasGalvin, -1.75, 3.55, 6.9, 3.75, 3.55, 6.9);
  addChristmasGarland(xmasGalvin, 3.9, 3.28, 10.38, 10.4, 3.28, 10.38);
  addChristmasBanner(xmasGalvin, 7.1, 3.88, 10.42, 4.4, 0.72, 0, '★ JOYEUX NOËL ★', texLib);
  addChristmasWreath(xmasGalvin, 2.55, 1.85, 6.1, 0, texLib);
  // Decorated tree w/ wrapped presents + giant candy canes flanking entrance + glowing terrace star
  addDecoratedChristmasTree(xmasGalvin, 11.6, 0.05, 8.6, 0.98, true);
  addCandyCane(xmasGalvin, 1.25, 0.16, 6.45, 0, 0.95);
  addCandyCane(xmasGalvin, 3.8, 0.16, 6.45, Math.PI, 0.95);
  addGlowingLawnStar(xmasGalvin, -6.5, 4.0, 4.5, 0, 1.05);
  frontGroup.add(xmasGalvin);
  heroChristmasGroups.push(xmasGalvin);

  group.add(frontGroup);

  // 5. Weathered Pale-Grey Asphalt Parking Lot (aligned to building front & strictly off Chemin Galvin / Rue Allard)
  const toWorld = (lx, lz) => [
    +(bGalvin.obbCx + lx * Math.cos(bGalvin.ang) - lz * Math.sin(bGalvin.ang)).toFixed(2),
    +(bGalvin.obbCz + lx * Math.sin(bGalvin.ang) + lz * Math.cos(bGalvin.ang)).toFixed(2),
  ];
  const lotPts = [toWorld(-15.5, 4.5), toWorld(12.2, 4.5), toWorld(12.2, 20.5), toWorld(-15.5, 20.5)];
  const lotMat = new THREE.MeshStandardMaterial({
    map: texLib.asphaltTex,
    color: 0xc2c6ca,
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  registerHeroMaterialSwap(
    lotMat,
    { map: texLib.asphaltTex, color: 0xc2c6ca, roughness: 0.9 },
    { map: texLib.snowRoadTex, color: 0xdce6f0, roughness: 0.86 }
  );
  const lotMesh = new THREE.Mesh(createGroundPolygonGeometry(lotPts, 0.05, 0.14, elevData), lotMat);
  lotMesh.receiveShadow = true;
  group.add(lotMesh);

  // Corner Pylon Sign beside SE parking lot corner
  const [pylonX, pylonZ] = toWorld(11.6, 17.8);
  const pylonElev = sampleElevation(pylonX, pylonZ, elevData);
  const pylonPole = new THREE.Mesh(new THREE.BoxGeometry(0.26, 4.6, 0.26), darkCharcoalMat);
  pylonPole.position.set(pylonX, pylonElev + 2.3, pylonZ);
  const pylonTex = texLib.makeBannerTexture('DÉP. GALVIN • VOISIN', '#359648', '#ffffff', 256, 64);
  const pylonMat = new THREE.MeshStandardMaterial({ map: pylonTex, roughness: 0.4 });
  registerHeroSignMaterial(pylonMat, pylonTex, 0.85, 0xffffff);
  const pylonBox = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, 1.4, 0.35),
    pylonMat
  );
  pylonBox.position.set(pylonX, pylonElev + 4.9, pylonZ);
  pylonBox.rotation.y = 0.42;
  group.add(pylonPole, pylonBox);

  scene.add(group);
  return group;
}
