import * as THREE from 'three';
import {
  sampleElevation,
  createSteppedTerrainGeometry,
  mergeGeometries,
  createGroundPolygonGeometry,
  createExtrudedPolygonGeometry,
  createRibbonGeometry,
  createPitchedRoofGeometry,
  createGableEndsGeometry,
  setWorldBoxUVs,
  createRoofTrimGeometry,
} from './geometryHelpers.js';

function seededRand(seed) {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

function pointInPoly(px, pz, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1];
    const xj = pts[j][0], zj = pts[j][1];
    const intersect = (zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polyBBox(pts) {
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const [x, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return [minX, maxX, minZ, maxZ];
}

// --- Winter Mode & Christmas Mode Registry ---
const winterHandlers = [];
let christmasGroup = null;

function registerMaterialSwap(mat, summerProps, winterProps) {
  winterHandlers.push((isWinter) => {
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
  });
}

function registerWinterToggle(fn) {
  winterHandlers.push(fn);
}

/**
 * Toggles Winter Mode across all world terrain, roads, roofs, trees, hedges & grass tufts.
 */
export function setWinterMode(isWinter) {
  for (let i = 0; i < winterHandlers.length; i++) {
    winterHandlers[i](!!isWinter);
  }
}

/**
 * Toggles Christmas Mode (lights, garlands, wreaths, Christmas trees, festive shop windows) across the neighbourhood.
 */
export function setChristmasMode(isChristmas) {
  if (christmasGroup) {
    christmasGroup.visible = !!isChristmas;
  }
}

/**
 * Helper to build 7 finer-grained multi-species Minecraft-style tree & shrub prototypes.
 */
function buildVoxelTreePrototypes() {
  const makeCube = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g;
  };

  // 1. Mature Sugar / Silver Maple (~6.8m base height: flared roots + forked branches + 34-cube dome canopy)
  const decTrunkGeo = mergeGeometries([
    makeCube(0.76, 0.35, 0.76, 0, 0.175, 0),
    makeCube(0.56, 1.05, 0.56, 0, 0.75, 0),
    makeCube(0.48, 1.05, 0.48, 0.04, 1.75, -0.02),
    makeCube(0.40, 1.05, 0.40, -0.03, 2.75, 0.03),
    makeCube(0.28, 0.95, 0.28, 0.38, 3.35, 0.26),
    makeCube(0.26, 0.90, 0.26, -0.40, 3.25, -0.22),
    makeCube(0.24, 0.85, 0.24, -0.18, 3.40, 0.44),
  ]);

  const decCrownGeo = mergeGeometries([
    // Tier 1 (skirt of main domed canopy, finer 0.75-0.95m clusters)
    makeCube(1.05, 0.82, 1.05, 0, 3.65, 0),
    makeCube(0.92, 0.78, 0.92, 1.12, 3.55, 0.18),
    makeCube(0.92, 0.78, 0.92, -1.12, 3.55, -0.18),
    makeCube(0.92, 0.78, 0.92, 0.18, 3.55, 1.12),
    makeCube(0.92, 0.78, 0.92, -0.18, 3.55, -1.12),
    makeCube(0.82, 0.72, 0.82, 0.95, 3.48, 0.95),
    makeCube(0.82, 0.72, 0.82, -0.95, 3.48, -0.95),
    makeCube(0.82, 0.72, 0.82, -0.95, 3.48, 0.95),
    makeCube(0.82, 0.72, 0.82, 0.95, 3.48, -0.95),
    // Tier 2 (full lush mid-crown)
    makeCube(1.10, 0.85, 1.10, 0, 4.42, 0),
    makeCube(0.92, 0.82, 0.92, 1.30, 4.35, -0.20),
    makeCube(0.92, 0.82, 0.92, -1.30, 4.35, 0.20),
    makeCube(0.92, 0.82, 0.92, -0.20, 4.35, 1.30),
    makeCube(0.92, 0.82, 0.92, 0.20, 4.35, -1.30),
    makeCube(0.85, 0.78, 0.85, 1.05, 4.40, 1.02),
    makeCube(0.85, 0.78, 0.85, -1.05, 4.40, -1.02),
    makeCube(0.85, 0.78, 0.85, -1.02, 4.38, 1.05),
    makeCube(0.85, 0.78, 0.85, 1.02, 4.38, -1.05),
    // Tier 3 (upper rounded dome)
    makeCube(1.02, 0.82, 1.02, 0, 5.20, 0),
    makeCube(0.84, 0.76, 0.84, 0.96, 5.12, 0.24),
    makeCube(0.84, 0.76, 0.84, -0.96, 5.12, -0.24),
    makeCube(0.84, 0.76, 0.84, -0.24, 5.12, 0.96),
    makeCube(0.84, 0.76, 0.84, 0.24, 5.12, -0.96),
    makeCube(0.72, 0.70, 0.72, 0.72, 5.08, -0.68),
    makeCube(0.72, 0.70, 0.72, -0.72, 5.08, 0.68),
    // Tier 4 & Crown Peak
    makeCube(0.92, 0.75, 0.92, 0.12, 5.92, -0.08),
    makeCube(0.74, 0.70, 0.74, -0.58, 5.84, 0.28),
    makeCube(0.74, 0.70, 0.74, 0.56, 5.82, 0.34),
    makeCube(0.70, 0.65, 0.70, -0.10, 6.48, 0.05),
    makeCube(0.54, 0.52, 0.54, 0.30, 6.38, -0.24),
  ]);

  // 2. Full-Skirted Quebec White & Blue Spruce (6 irregular tiered whorls starting low at y=0.75m, ~6.6m tall)
  const conTrunkGeo = mergeGeometries([
    makeCube(0.46, 0.90, 0.46, 0, 0.45, 0),
    makeCube(0.38, 0.90, 0.38, 0, 1.35, 0),
    makeCube(0.30, 0.90, 0.30, 0, 2.25, 0),
  ]);

  const conCrownGeo = mergeGeometries([
    // Whorl 1 (wide low evergreen skirt near ground)
    makeCube(1.10, 0.78, 1.10, 0, 1.12, 0),
    makeCube(0.95, 0.72, 0.95, 1.05, 1.05, 0.10),
    makeCube(0.95, 0.72, 0.95, -1.05, 1.05, -0.10),
    makeCube(0.95, 0.72, 0.95, -0.10, 1.05, 1.05),
    makeCube(0.95, 0.72, 0.95, 0.10, 1.05, -1.05),
    makeCube(0.78, 0.66, 0.78, 0.85, 1.02, 0.85),
    makeCube(0.78, 0.66, 0.78, -0.85, 1.02, 0.85),
    makeCube(0.78, 0.66, 0.78, 0.85, 1.02, -0.85),
    makeCube(0.78, 0.66, 0.78, -0.85, 1.02, -0.85),
    // Whorl 2
    makeCube(1.02, 0.82, 1.02, 0, 1.92, 0),
    makeCube(0.86, 0.74, 0.86, 0.92, 1.88, -0.12),
    makeCube(0.86, 0.74, 0.86, -0.92, 1.88, 0.12),
    makeCube(0.86, 0.74, 0.86, 0.12, 1.88, 0.92),
    makeCube(0.86, 0.74, 0.86, -0.12, 1.88, -0.92),
    makeCube(0.70, 0.68, 0.70, 0.70, 1.84, 0.68),
    makeCube(0.70, 0.68, 0.70, -0.70, 1.84, -0.68),
    // Whorl 3
    makeCube(0.94, 0.82, 0.94, 0, 2.74, 0),
    makeCube(0.76, 0.74, 0.76, 0.74, 2.70, 0.15),
    makeCube(0.76, 0.74, 0.76, -0.74, 2.70, -0.15),
    makeCube(0.76, 0.74, 0.76, -0.15, 2.70, 0.74),
    makeCube(0.76, 0.74, 0.76, 0.15, 2.70, -0.74),
    // Whorl 4
    makeCube(0.84, 0.80, 0.84, 0, 3.56, 0),
    makeCube(0.64, 0.72, 0.64, 0.56, 3.52, -0.10),
    makeCube(0.64, 0.72, 0.64, -0.56, 3.52, 0.10),
    makeCube(0.64, 0.72, 0.64, 0.10, 3.52, 0.56),
    makeCube(0.64, 0.72, 0.64, -0.10, 3.52, -0.56),
    // Whorl 5
    makeCube(0.72, 0.78, 0.72, 0, 4.38, 0),
    makeCube(0.52, 0.68, 0.52, 0.36, 4.34, 0.24),
    makeCube(0.52, 0.68, 0.52, -0.36, 4.34, -0.24),
    // Whorl 6 & Tapered Leader Spire
    makeCube(0.58, 0.76, 0.58, 0, 5.18, 0),
    makeCube(0.42, 0.74, 0.42, 0, 5.90, 0),
    makeCube(0.24, 0.62, 0.24, 0, 6.50, 0),
  ]);

  // 3. Multi-Stem Quebec Paper Birch (3 splayed slender trunks + feathery 18-cube bright-green crown)
  const birchTrunkGeo = mergeGeometries([
    makeCube(0.24, 1.35, 0.24, 0, 0.67, 0),
    makeCube(0.20, 1.45, 0.20, 0.22, 1.75, 0.16),
    makeCube(0.18, 1.25, 0.18, 0.42, 2.75, 0.28),
    makeCube(0.19, 1.40, 0.19, -0.24, 1.70, -0.14),
    makeCube(0.17, 1.20, 0.17, -0.44, 2.65, -0.26),
    makeCube(0.18, 1.35, 0.18, -0.12, 1.85, 0.22),
  ]);
  const birchCrownGeo = mergeGeometries([
    makeCube(0.78, 0.68, 0.78, 0.45, 3.35, 0.28),
    makeCube(0.74, 0.66, 0.74, -0.46, 3.22, -0.26),
    makeCube(0.76, 0.68, 0.76, -0.14, 3.45, 0.45),
    makeCube(0.68, 0.62, 0.68, 0.88, 3.55, 0.08),
    makeCube(0.68, 0.62, 0.68, -0.82, 3.40, 0.12),
    makeCube(0.66, 0.60, 0.66, 0.15, 3.50, -0.68),
    makeCube(0.72, 0.64, 0.72, 0.40, 4.02, 0.30),
    makeCube(0.70, 0.64, 0.70, -0.42, 3.92, -0.22),
    makeCube(0.68, 0.62, 0.68, -0.08, 4.10, 0.36),
    makeCube(0.60, 0.58, 0.60, 0.65, 4.25, -0.18),
    makeCube(0.60, 0.58, 0.60, -0.62, 4.18, 0.22),
    makeCube(0.66, 0.60, 0.66, 0.05, 4.68, 0.06),
    makeCube(0.56, 0.54, 0.56, 0.36, 4.82, 0.22),
    makeCube(0.54, 0.52, 0.54, -0.34, 4.74, -0.20),
    makeCube(0.52, 0.50, 0.52, 0.02, 5.22, -0.02),
  ]);

  // 4. Sculpted Globe Maple / Catalpa (short sturdy trunk + ultra-dense 24-cube round manicured emerald sphere)
  const globeTrunkGeo = mergeGeometries([
    makeCube(0.42, 0.90, 0.42, 0, 0.45, 0),
    makeCube(0.36, 0.95, 0.36, 0, 1.35, 0),
  ]);
  const globeCrownGeo = mergeGeometries([
    makeCube(1.25, 0.95, 1.25, 0, 2.35, 0),
    makeCube(0.95, 0.90, 0.95, 0.78, 2.38, 0),
    makeCube(0.95, 0.90, 0.95, -0.78, 2.38, 0),
    makeCube(0.95, 0.90, 0.95, 0, 2.38, 0.78),
    makeCube(0.95, 0.90, 0.95, 0, 2.38, -0.78),
    makeCube(0.84, 0.84, 0.84, 0.62, 2.40, 0.62),
    makeCube(0.84, 0.84, 0.84, -0.62, 2.40, 0.62),
    makeCube(0.84, 0.84, 0.84, 0.62, 2.40, -0.62),
    makeCube(0.84, 0.84, 0.84, -0.62, 2.40, -0.62),
    makeCube(1.18, 0.90, 1.18, 0, 3.05, 0),
    makeCube(0.86, 0.82, 0.86, 0.65, 3.02, 0),
    makeCube(0.86, 0.82, 0.86, -0.65, 3.02, 0),
    makeCube(0.86, 0.82, 0.86, 0, 3.02, 0.65),
    makeCube(0.86, 0.82, 0.86, 0, 3.02, -0.65),
    makeCube(0.96, 0.72, 0.96, 0, 3.65, 0),
    makeCube(0.70, 0.62, 0.70, 0.42, 3.55, 0.42),
    makeCube(0.70, 0.62, 0.70, -0.42, 3.55, -0.42),
  ]);

  // 5. Columnar Pyramidal Cedar (dense upright architectural evergreen 0.95m x 4.2m planted by entries/hedges)
  const cedarColGeo = mergeGeometries([
    makeCube(0.92, 0.85, 0.92, 0, 0.45, 0),
    makeCube(0.84, 0.90, 0.84, 0, 1.32, 0),
    makeCube(0.74, 0.88, 0.74, 0, 2.20, 0),
    makeCube(0.60, 0.84, 0.60, 0, 3.04, 0),
    makeCube(0.44, 0.72, 0.44, 0, 3.78, 0),
    makeCube(0.28, 0.45, 0.28, 0, 4.30, 0),
  ]);

  // 6. Three distinct irregular bush/plant tiers (small plant, medium bush, big overgrown 9-cube bush)
  const smallPlantGeo = mergeGeometries([
    makeCube(0.40, 0.34, 0.40, 0, 0.17, 0),
    makeCube(0.32, 0.28, 0.32, 0.28, 0.14, 0.10),
    makeCube(0.30, 0.26, 0.30, -0.24, 0.13, -0.16),
    makeCube(0.28, 0.24, 0.28, -0.12, 0.12, 0.24),
  ]);

  const medBushGeo = mergeGeometries([
    makeCube(0.62, 0.56, 0.62, 0, 0.28, 0),
    makeCube(0.48, 0.48, 0.48, 0.38, 0.24, 0.16),
    makeCube(0.46, 0.46, 0.46, -0.34, 0.23, -0.22),
    makeCube(0.44, 0.42, 0.44, -0.18, 0.21, 0.36),
    makeCube(0.42, 0.44, 0.42, 0.22, 0.22, -0.34),
    makeCube(0.46, 0.40, 0.46, 0.05, 0.62, -0.04),
  ]);

  const overgrownBushGeo = mergeGeometries([
    makeCube(0.82, 0.72, 0.82, 0, 0.36, 0),
    makeCube(0.66, 0.62, 0.66, 0.54, 0.31, 0.18),
    makeCube(0.64, 0.58, 0.64, -0.52, 0.29, -0.22),
    makeCube(0.60, 0.56, 0.60, -0.22, 0.28, 0.52),
    makeCube(0.58, 0.54, 0.58, 0.28, 0.27, -0.50),
    makeCube(0.54, 0.52, 0.54, 0.42, 0.74, -0.12),
    makeCube(0.56, 0.56, 0.56, -0.28, 0.76, 0.22),
    makeCube(0.50, 0.48, 0.50, 0.08, 0.88, 0.06),
    makeCube(0.46, 0.42, 0.46, -0.48, 0.21, 0.38),
  ]);

  // 7. Wide Sprawling Overgrown Maple (for parks & mature backyards)
  const overgrownMapleTrunkGeo = mergeGeometries([
    makeCube(0.84, 0.45, 0.84, 0, 0.225, 0),
    makeCube(0.68, 1.05, 0.68, 0, 0.85, 0),
    makeCube(0.58, 1.05, 0.58, 0.05, 1.85, -0.04),
    makeCube(0.40, 1.05, 0.40, 0.52, 2.75, 0.34),
    makeCube(0.38, 1.05, 0.38, -0.56, 2.70, -0.30),
    makeCube(0.34, 0.95, 0.34, -0.22, 2.80, 0.58),
  ]);
  const overgrownMapleCrownGeo = mergeGeometries([
    makeCube(1.45, 1.05, 1.45, 0, 3.75, 0),
    makeCube(1.22, 0.95, 1.22, 1.50, 3.55, 0.45),
    makeCube(1.22, 0.95, 1.22, -1.50, 3.50, -0.45),
    makeCube(1.22, 0.95, 1.22, -0.45, 3.58, 1.50),
    makeCube(1.22, 0.95, 1.22, 0.45, 3.52, -1.50),
    makeCube(1.12, 0.92, 1.12, 1.30, 4.35, -0.68),
    makeCube(1.12, 0.92, 1.12, -1.30, 4.30, 0.68),
    makeCube(1.12, 0.92, 1.12, 0.68, 4.42, 1.20),
    makeCube(1.12, 0.92, 1.12, -0.68, 4.38, -1.20),
    makeCube(1.20, 0.92, 1.20, 0, 5.10, 0),
    makeCube(0.95, 0.84, 0.95, 0.90, 5.18, 0.26),
    makeCube(0.95, 0.84, 0.95, -0.90, 5.12, -0.26),
    makeCube(0.90, 0.80, 0.90, 0, 5.88, 0),
  ]);

  return {
    decTrunkGeo,
    decCrownGeo,
    conTrunkGeo,
    conCrownGeo,
    birchTrunkGeo,
    birchCrownGeo,
    globeTrunkGeo,
    globeCrownGeo,
    cedarColGeo,
    smallPlantGeo,
    medBushGeo,
    overgrownBushGeo,
    overgrownMapleTrunkGeo,
    overgrownMapleCrownGeo,
  };
}

/**
 * 1. Sloped Terrain, 1km Radius Ring, Woods, Parks, School Grounds, Playgrounds & Parking Lots
 */
export function buildGroundAndLanduse(scene, DATA, texLib) {
  winterHandlers.length = 0;
  const elevData = DATA.elevation;

  // Finely subdivided sloped terrain mesh with pixel-art grassTex / snowTex
  const baseGeo = createSteppedTerrainGeometry({
    minX: -1280,
    maxX: 1280,
    minZ: -1280,
    maxZ: 1280,
    cellSize: 8,
    quantizeY: 0,
    elevData,
    uvScale: 0.25,
  });
  const baseMat = new THREE.MeshStandardMaterial({
    map: texLib.grassTex,
    color: 0xffffff,
    roughness: 0.96,
  });
  registerMaterialSwap(
    baseMat,
    { map: texLib.grassTex, color: 0xffffff, roughness: 0.96 },
    { map: texLib.snowTex, color: 0xf4f9ff, roughness: 0.88 }
  );
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.receiveShadow = true;
  scene.add(baseMesh);

  // Terrain-conforming 1 km radius marker ring
  const ringPts = [];
  const ringSegs = 128;
  for (let i = 0; i <= ringSegs; i++) {
    const a = (i / ringSegs) * Math.PI * 2;
    ringPts.push([Math.cos(a) * 1000, Math.sin(a) * 1000]);
  }
  const ringGeo = createRibbonGeometry(ringPts, 3.6, 0.1, 10, elevData);
  const ringMesh = new THREE.Mesh(
    ringGeo || new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: 0x53a8ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  );
  scene.add(ringMesh);

  // Woods (yOffset = 0.025)
  const woodGeos = DATA.woods.map((pts) => createGroundPolygonGeometry(pts, 0.025, 0.18, elevData)).filter(Boolean);
  const woodMerged = mergeGeometries(woodGeos);
  if (woodMerged) {
    const woodMat = new THREE.MeshStandardMaterial({
      map: texLib.forestFloorTex || texLib.grassTex,
      color: 0x8ea878,
      roughness: 0.98,
    });
    registerMaterialSwap(
      woodMat,
      { map: texLib.forestFloorTex || texLib.grassTex, color: 0x8ea878, roughness: 0.98 },
      { map: texLib.snowTex, color: 0xdce8f4, roughness: 0.9 }
    );
    const m = new THREE.Mesh(woodMerged, woodMat);
    m.receiveShadow = true;
    scene.add(m);
  }

  // Parks use the high-resolution terrain grass directly so large park polygons never tent above hills or clip rinks/paths

  // School grounds (yOffset = 0.036)
  const sgGeos = DATA.schoolGrounds.map((s) => createGroundPolygonGeometry(s.pts, 0.036, 0.22, elevData)).filter(Boolean);
  const sgMerged = mergeGeometries(sgGeos);
  if (sgMerged) {
    const sgMat = new THREE.MeshStandardMaterial({
      map: texLib.grassTex,
      color: 0x96be7e,
      roughness: 0.94,
    });
    registerMaterialSwap(
      sgMat,
      { map: texLib.grassTex, color: 0x96be7e, roughness: 0.94 },
      { map: texLib.snowTex, color: 0xeef5fc, roughness: 0.88 }
    );
    const m = new THREE.Mesh(sgMerged, sgMat);
    m.receiveShadow = true;
    scene.add(m);
  }

  // Parking lots (yOffset = 0.11, including NE staff parking pad at École de la Samare)
  const extraStaffLot = [[274.0, 198.2], [297.5, 200.5], [296.0, 217.5], [272.5, 215.2]];
  const parkLotGeos = [
    ...DATA.parkings.map((p) => createGroundPolygonGeometry(p.pts, 0.11, 0.16, elevData)),
    createGroundPolygonGeometry(extraStaffLot, 0.11, 0.16, elevData),
  ].filter(Boolean);
  const parkLotMerged = mergeGeometries(parkLotGeos);
  if (parkLotMerged) {
    const lotMat = new THREE.MeshStandardMaterial({
      map: texLib.asphaltTex,
      color: 0xb0b5bc,
      roughness: 0.9,
    });
    registerMaterialSwap(
      lotMat,
      { map: texLib.asphaltTex, color: 0xb0b5bc, roughness: 0.9 },
      { map: texLib.snowRoadTex, color: 0xdce6f0, roughness: 0.86 }
    );
    const m = new THREE.Mesh(parkLotMerged, lotMat);
    m.receiveShadow = true;
    scene.add(m);
  }

  // Playgrounds (asphalt schoolyard yOffset=0.13 vs gravel play pads yOffset=0.12)
  const asphaltPgGeos = [];
  const gravelPgGeos = [];
  for (const pg of DATA.playgrounds) {
    const g = createGroundPolygonGeometry(pg.pts, pg.surface === 'asphalt' ? 0.13 : 0.12, 0.18, elevData);
    if (!g) continue;
    if (pg.surface === 'asphalt') asphaltPgGeos.push(g);
    else gravelPgGeos.push(g);
  }
  const asphaltPgMerged = mergeGeometries(asphaltPgGeos);
  if (asphaltPgMerged) {
    const apgMat = new THREE.MeshStandardMaterial({
      map: texLib.asphaltTex,
      color: 0x767b82,
      roughness: 0.9,
    });
    registerMaterialSwap(
      apgMat,
      { map: texLib.asphaltTex, color: 0x767b82, roughness: 0.9 },
      { map: texLib.snowRoadTex, color: 0xd8e2ec, roughness: 0.86 }
    );
    const m = new THREE.Mesh(asphaltPgMerged, apgMat);
    m.receiveShadow = true;
    scene.add(m);
  }
  const gravelPgMerged = mergeGeometries(gravelPgGeos);
  if (gravelPgMerged) {
    const gpgMat = new THREE.MeshStandardMaterial({
      map: texLib.concreteTex,
      color: 0xc8b898,
      roughness: 0.96,
    });
    registerMaterialSwap(
      gpgMat,
      { map: texLib.concreteTex, color: 0xc8b898, roughness: 0.96 },
      { map: texLib.snowTex, color: 0xe6eff8, roughness: 0.9 }
    );
    const m = new THREE.Mesh(gravelPgMerged, gpgMat);
    m.receiveShadow = true;
    scene.add(m);
  }

  return { ringMesh, setWinterMode, setChristmasMode };
}

/**
 * 2. Terrain-Conforming Road Network, Rolled Curbs, Sidewalks, Markings, Crosswalks & Residential Driveways
 */
export function buildRoadNetwork(scene, DATA, texLib) {
  const elevData = DATA.elevation;
  const localGeos = [];
  const collectorGeos = [];
  const pathGeos = [];
  const curbGeos = [];
  const sidewalkGeos = [];
  const yellowLineGeos = [];
  const whiteLineGeos = [];

  const offsetPolyline = (pts, offset) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      let nx = 0, nz = 0;
      if (i < pts.length - 1) {
        const dx = pts[i + 1][0] - pts[i][0];
        const dz = pts[i + 1][1] - pts[i][1];
        const l = Math.hypot(dx, dz) || 1;
        nx += -dz / l;
        nz += dx / l;
      }
      if (i > 0) {
        const dx = pts[i][0] - pts[i - 1][0];
        const dz = pts[i][1] - pts[i - 1][1];
        const l = Math.hypot(dx, dz) || 1;
        nx += -dz / l;
        nz += dx / l;
      }
      const nl = Math.hypot(nx, nz) || 1;
      out.push([pts[i][0] + (nx / nl) * offset, pts[i][1] + (nz / nl) * offset]);
    }
    return out;
  };

  for (const r of DATA.roads) {
    const isCollector = r.type === 'primary' || r.type === 'tertiary' || r.name === 'Rue Allard' || r.name === 'Rue du Chalumeau';
    const isPath = r.type === 'footway' || r.type === 'path' || r.type === 'cycleway' || r.type === 'track' || r.type === 'steps';

    const yRoad = isCollector ? 0.058 : isPath ? 0.078 : 0.055;
    let ribbonPts = r.pts;
    if (isPath && r.pts.length >= 2) {
      // Subdivide long park/footway segments every ~5m so paths smoothly hug terrain hills without dipping underground
      ribbonPts = [r.pts[0]];
      for (let pi = 0; pi < r.pts.length - 1; pi++) {
        const [ax, az] = r.pts[pi], [bx, bz] = r.pts[pi + 1];
        const segLen = Math.hypot(bx - ax, bz - az);
        const subs = Math.max(1, Math.ceil(segLen / 5.0));
        for (let si = 1; si <= subs; si++) {
          const t = si / subs;
          ribbonPts.push([ax + (bx - ax) * t, az + (bz - az) * t]);
        }
      }
    }
    const g = createRibbonGeometry(ribbonPts, r.width, yRoad, 8, elevData);
    if (g) {
      if (isPath || r.type === 'service') pathGeos.push(g);
      else if (isCollector) collectorGeos.push(g);
      else localGeos.push(g);
    }

    // Centerlines on collectors, arterial & Rue des Peupliers
    if (r.hasCenterline || r.name === 'Rue des Peupliers') {
      const yg = createRibbonGeometry(r.pts, 0.16, 0.068, 4, elevData);
      if (yg) yellowLineGeos.push(yg);
      if (r.type === 'primary') {
        for (const off of [-3.5, 3.5]) {
          for (let i = 0; i < r.pts.length - 1; i++) {
            const p0 = r.pts[i], p1 = r.pts[i + 1];
            const segL = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
            const steps = Math.floor(segL / 8);
            const dx = (p1[0] - p0[0]) / (segL || 1);
            const dz = (p1[1] - p0[1]) / (segL || 1);
            const nx = -dz * off, nz = dx * off;
            for (let s = 0; s < steps; s++) {
              const a = [p0[0] + dx * (s * 8) + nx, p0[1] + dz * (s * 8) + nz];
              const b = [p0[0] + dx * (s * 8 + 3.2) + nx, p0[1] + dz * (s * 8 + 3.2) + nz];
              const wg = createRibbonGeometry([a, b], 0.13, 0.068, 3, elevData);
              if (wg) whiteLineGeos.push(wg);
            }
          }
        }
      }
    }

    // Curbs & Sidewalks on drivable streets
    if (!isPath && r.type !== 'service') {
      const half = r.width * 0.5;
      for (const side of [-1, 1]) {
        const curbPts = offsetPolyline(r.pts, side * (half + 0.12));
        const cg = createRibbonGeometry(curbPts, 0.24, 0.095, 6, elevData);
        if (cg) curbGeos.push(cg);
      }

      const swSides = [];
      if (r.sidewalkSide === 'both') swSides.push(-1, 1);
      else if (r.sidewalkSide === 'right' || r.sidewalkSide === 'east' || r.sidewalkSide === 'south') {
        const p0 = r.pts[0];
        const p1 = r.pts[r.pts.length - 1];
        const dx = p1[0] - p0[0];
        const dz = p1[1] - p0[1];
        const rnx = -dz, rnz = dx;
        if (r.sidewalkSide === 'right') swSides.push(1);
        else if (r.sidewalkSide === 'east') swSides.push(rnx >= 0 ? 1 : -1);
        else if (r.sidewalkSide === 'south') swSides.push(rnz >= 0 ? 1 : -1);
      } else if (r.sidewalkSide === 'left') {
        swSides.push(-1);
      }

      for (const sgn of swSides) {
        const swPts = offsetPolyline(r.pts, sgn * (half + 1.05));
        const swg = createRibbonGeometry(swPts, 1.55, 0.13, 4, elevData);
        if (swg) sidewalkGeos.push(swg);
      }
    }
  }

  // White Stop Bars & Zebra Crosswalks (including Rue des Peupliers / Rue des Cormiers & Rue Allard)
  const stopBarList = [
    ...DATA.stops.map((st) => {
      if (st.x >= 96 && st.x <= 105 && st.z >= 17 && st.z <= 25) {
        return { x: 94.5, z: 22.8, angle: 0.0 };
      }
      const ux = Math.cos(st.angle), uz = Math.sin(st.angle);
      return { x: st.x - ux * 5.5, z: st.z - uz * 5.5, angle: st.angle };
    }),
    { x: 24.5, z: 24.1, angle: 0.04 }, // Rue des Peupliers west stop bar
  ];
  for (const st of stopBarList) {
    const ux = Math.cos(st.angle);
    const uz = Math.sin(st.angle);
    const nx = -uz;
    const nz = ux;
    const bar = createRibbonGeometry(
      [[st.x - nx * 0.2, st.z - nz * 0.2], [st.x - nx * 3.1, st.z - nz * 3.1]],
      0.42,
      0.068,
      2,
      elevData
    );
    if (bar) whiteLineGeos.push(bar);
  }

  const extraCrossings = [
    ...DATA.crossings,
    { x: 263.5, z: 196.8, angle: 0.1 },
    { x: 191.0, z: 196.0, angle: 0.05 },
    { x: 109.0, z: 193.0, angle: 0.05 },
  ];
  for (const cr of extraCrossings) {
    const ux = Math.cos(cr.angle);
    const uz = Math.sin(cr.angle);
    const nx = -uz;
    const nz = ux;
    for (let s = -3; s <= 3; s++) {
      const off = s * 0.95;
      const a = [cr.x + ux * off - nx * 3.4, cr.z + uz * off - nz * 3.4];
      const b = [cr.x + ux * off + nx * 3.4, cr.z + uz * off + nz * 3.4];
      const stripe = createRibbonGeometry([a, b], 0.45, 0.068, 2, elevData);
      if (stripe) whiteLineGeos.push(stripe);
    }
  }

  const addMerged = (geos, mat, receiveShadow = true) => {
    const mGeo = mergeGeometries(geos);
    if (!mGeo) return;
    const mesh = new THREE.Mesh(mGeo, mat);
    mesh.receiveShadow = receiveShadow;
    scene.add(mesh);
  };

  const localMat = new THREE.MeshStandardMaterial({ map: texLib.asphaltTex, color: 0xffffff, roughness: 0.92 });
  const collectorMat = new THREE.MeshStandardMaterial({ map: texLib.asphaltTex, color: 0xebeef0, roughness: 0.9 });
  const pathMat = new THREE.MeshStandardMaterial({ map: texLib.drivewayTex, color: 0x9aa0a6, roughness: 0.94 });
  const curbMat = new THREE.MeshStandardMaterial({
    map: texLib.concreteTex,
    color: 0xc8cbc8,
    roughness: 0.88,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const sidewalkMat = new THREE.MeshStandardMaterial({
    map: texLib.concreteTex,
    color: 0xd4d6d2,
    roughness: 0.86,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  registerMaterialSwap(
    localMat,
    { map: texLib.asphaltTex, color: 0xffffff, roughness: 0.92 },
    { map: texLib.snowRoadTex, color: 0xe2ebf4, roughness: 0.85 }
  );
  registerMaterialSwap(
    collectorMat,
    { map: texLib.asphaltTex, color: 0xebeef0, roughness: 0.9 },
    { map: texLib.snowRoadTex, color: 0xd8e2ec, roughness: 0.85 }
  );
  registerMaterialSwap(
    pathMat,
    { map: texLib.drivewayTex, color: 0x9aa0a6, roughness: 0.94 },
    { map: texLib.snowTex, color: 0xe4eef8, roughness: 0.9 }
  );
  registerMaterialSwap(
    curbMat,
    { map: texLib.concreteTex, color: 0xc8cbc8, roughness: 0.88 },
    { map: texLib.snowTex, color: 0xeaf2fa, roughness: 0.88 }
  );
  registerMaterialSwap(
    sidewalkMat,
    { map: texLib.concreteTex, color: 0xd4d6d2, roughness: 0.86 },
    { map: texLib.snowTex, color: 0xe6eff8, roughness: 0.88 }
  );

  addMerged(localGeos, localMat);
  addMerged(collectorGeos, collectorMat);
  addMerged(pathGeos, pathMat);
  addMerged(curbGeos, curbMat);
  addMerged(sidewalkGeos, sidewalkMat);
  addMerged(
    yellowLineGeos,
    new THREE.MeshStandardMaterial({
      color: 0xe6b422,
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    false
  );
  addMerged(
    whiteLineGeos,
    new THREE.MeshStandardMaterial({
      color: 0xf1f3f5,
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
    false
  );

  // Residential Driveways (skip bespoke hero 2643 gravel driveway and 387 Peupliers South lot)
  const dwGeos = [];
  for (const b of DATA.buildings) {
    if (!b.driveway || b.id === 827707342 || b.id === 827707441) continue;
    const [x0, z0, x1, z1, w] = b.driveway;
    const dg = createRibbonGeometry([[x0, z0], [x1, z1]], w, 0.053, 4, elevData);
    if (dg) dwGeos.push(dg);
  }
  const dwMat = new THREE.MeshStandardMaterial({ map: texLib.drivewayTex, color: 0xc8ccd0, roughness: 0.92 });
  registerMaterialSwap(
    dwMat,
    { map: texLib.drivewayTex, color: 0xc8ccd0, roughness: 0.92 },
    { map: texLib.snowRoadTex, color: 0xdde7f0, roughness: 0.86 }
  );
  addMerged(dwGeos, dwMat);
}

/**
 * 3. Batched Geometry for ~2,305 Surrounding Buildings on Sloped Terrain + Spatial Click Index
 */
export function buildNeighborhoodBuildings(scene, DATA, texLib) {
  const elevData = DATA.elevation;
  const HERO_SKIP_IDS = new Set([
    827707358, // 2646 Rue des Cormiers
    827707311, // 2638 Rue des Cormiers
    827707339, // 2654 Rue des Cormiers
    827707342, // 2643 Rue des Cormiers
    827707441, // 387 Rue des Peupliers
    169345734, // École de la Samare
    827183553, // Dépanneur Galvin
    827183579, // Chalet du Parc Gilles-Charland
  ]);

  const foundationGeos = [];
  const brickBuckets = [[], [], [], []];
  const sidingBuckets = [[], [], [], [], [], []];
  const shingleBuckets = [[], [], []];
  const accentBuckets = [[], [], [], []]; // shutters & front doors (taupe, forest green, slate navy, burgundy)
  const woodAccentGeos = []; // verandas, decks, backyard fences
  const flatRoofGeos = [];
  const windowGeos = [];
  const garageDoorGeos = [];
  const roofTrimGeos = [];
  const trimGeos = [];
  const railingGeos = [];
  const sconceGeos = [];
  const flowerBoxFlowerGeos = [];
  const binBlueGeos = [];
  const binGreenGeos = [];
  const binBlackGeos = [];
  const ventStackGeos = [];
  const dirtPatchGeos = [];

  const tmpMat4 = new THREE.Matrix4();
  const tmpQuat = new THREE.Quaternion();
  const tmpPos = new THREE.Vector3();
  const tmpScale = new THREE.Vector3(1, 1, 1);
  const upAxis = new THREE.Vector3(0, 1, 0);

  const transformAndPush = (geom, x, y, z, rotY, targetArr) => {
    tmpQuat.setFromAxisAngle(upAxis, rotY);
    tmpPos.set(x, y, z);
    tmpMat4.compose(tmpPos, tmpQuat, tmpScale);
    geom.applyMatrix4(tmpMat4);
    targetArr.push(geom);
  };

  const boxWorldUV = (w, h, d) => setWorldBoxUVs(new THREE.BoxGeometry(w, h, d), w, h, d, 1.0);

  // Intersect line v = vQuery with polygon edges in local (u, v) coords; returns max u (front face) or null
  const getPolyFrontU = (localPts, vQuery) => {
    let bestU = -1e9;
    for (let i = 0; i < localPts.length; i++) {
      const [u0, v0] = localPts[i];
      const [u1, v1] = localPts[(i + 1) % localPts.length];
      if ((v0 <= vQuery && v1 >= vQuery) || (v1 <= vQuery && v0 >= vQuery)) {
        const dv = v1 - v0;
        if (Math.abs(dv) > 1e-5) {
          const t = (vQuery - v0) / dv;
          const uHit = u0 + t * (u1 - u0);
          if (uHit > bestU) bestU = uHit;
        } else {
          const uHit = Math.max(u0, u1);
          if (uHit > bestU) bestU = uHit;
        }
      }
    }
    return bestU > -1e8 ? bestU : null;
  };

  // Safe front-wall placement: confirms local polygon wall is continuous across [-halfW, +halfW]
  const getFlatFrontU = (localPts, vQuery, halfW, fallbackU) => {
    const uC = getPolyFrontU(localPts, vQuery);
    if (uC === null) return fallbackU;
    if (halfW <= 0.15) return uC;
    const uL = getPolyFrontU(localPts, vQuery - halfW * 0.72);
    const uR = getPolyFrontU(localPts, vQuery + halfW * 0.72);
    if (uL === null || uR === null) return null;
    if (Math.max(uC, uL, uR) - Math.min(uC, uL, uR) > 0.42) return null;
    return uC;
  };

  // Intersect line u = uQuery with polygon edges in local (u, v); returns extremal v on sideSign (+1/-1)
  const getPolySideV = (localPts, uQuery, sideSign, fallbackV) => {
    let bestV = sideSign > 0 ? -1e9 : 1e9;
    let found = false;
    for (let i = 0; i < localPts.length; i++) {
      const [u0, v0] = localPts[i];
      const [u1, v1] = localPts[(i + 1) % localPts.length];
      if ((u0 <= uQuery && u1 >= uQuery) || (u1 <= uQuery && u0 >= uQuery)) {
        const du = u1 - u0;
        const vHit = Math.abs(du) > 1e-5 ? v0 + ((uQuery - u0) / du) * (v1 - v0) : (sideSign > 0 ? Math.max(v0, v1) : Math.min(v0, v1));
        if ((sideSign > 0 && vHit > bestV) || (sideSign < 0 && vHit < bestV)) {
          bestV = vHit;
          found = true;
        }
      }
    }
    return found ? bestV : sideSign * fallbackV;
  };

  // Scan polygon v-extent along a slice u = uQuery (returns [vMin, vMax] or null)
  const sliceVExtent = (localPts, uQuery) => {
    let vMin = 1e9, vMax = -1e9;
    for (let i = 0; i < localPts.length; i++) {
      const [u0, v0] = localPts[i];
      const [u1, v1] = localPts[(i + 1) % localPts.length];
      if ((u0 <= uQuery && u1 >= uQuery) || (u1 <= uQuery && u0 >= uQuery)) {
        const du = u1 - u0;
        if (Math.abs(du) > 1e-5) {
          const vh = v0 + ((uQuery - u0) / du) * (v1 - v0);
          if (vh < vMin) vMin = vh;
          if (vh > vMax) vMax = vh;
        } else {
          vMin = Math.min(vMin, v0, v1);
          vMax = Math.max(vMax, v0, v1);
        }
      }
    }
    return vMax > vMin + 0.5 ? [vMin, vMax] : null;
  };

  for (const b of DATA.buildings) {
    if (HERO_SKIP_IDS.has(b.id) || b.style === 'hero_2646' || b.style === 'school_samare') continue;

    const elev = sampleElevation(b.obbCx, b.obbCz, elevData);
    const isHillyTilleuls = b.street && (b.street.includes('Tilleuls') || b.street.includes('Châteaumont'));
    const foundH = b.style === 'garage_shed' ? 0.14 : isHillyTilleuls ? 0.65 : 0.34;
    const cosA = Math.cos(b.ang);
    const sinA = Math.sin(b.ang);
    const toWorld = (u, v) => [b.obbCx + cosA * u - sinA * v, b.obbCz + sinA * u + cosA * v];
    const localPts = b.pts.map(([x, z]) => [
      cosA * (x - b.obbCx) + sinA * (z - b.obbCz),
      -sinA * (x - b.obbCx) + cosA * (z - b.obbCz),
    ]);
    const fillRatio = b.area / Math.max(1, b.w * b.d);

    let wallH = 3.5;
    let roofH = 1.8;
    let isHip = false;
    let isFlat = false;
    let wallBucket = sidingBuckets[b.cidx % 6];

    if (b.style === 'garage_shed') {
      wallH = 2.45;
      roofH = 0.85;
      wallBucket = sidingBuckets[b.cidx % 2];
    } else if (b.style === 'barn') {
      wallH = 4.6;
      roofH = 2.2;
      wallBucket = brickBuckets[3];
    } else if (b.style === 'modular') {
      wallH = 2.95;
      roofH = 1.05;
      wallBucket = sidingBuckets[(b.cidx * 3) % 5];
    } else if (b.style === 'bungalow_brick') {
      wallH = 3.25 + (b.cidx % 3) * 0.2;
      roofH = 1.7 + (b.cidx % 2) * 0.35;
      isHip = b.cidx % 3 === 0;
      wallBucket = brickBuckets[b.cidx % 4];
    } else if (b.style === 'bungalow_vinyl') {
      wallH = 3.25 + (b.cidx % 3) * 0.2;
      roofH = 1.65 + (b.cidx % 2) * 0.3;
      isHip = b.cidx % 4 === 0;
      wallBucket = sidingBuckets[b.cidx % 6];
    } else if (b.style === 'cottage_1_5s') {
      wallH = 3.95;
      roofH = 2.45;
      wallBucket = (b.cidx % 2 === 0) ? sidingBuckets[b.cidx % 6] : brickBuckets[b.cidx % 4];
    } else if (b.style === 'splitlevel') {
      wallH = 4.65;
      roofH = 1.75;
      isHip = b.cidx % 3 === 1;
      wallBucket = sidingBuckets[(b.cidx + 2) % 6];
    } else if (b.style === 'cottage_2s') {
      wallH = 5.35 + (b.cidx % 3) * 0.22;
      roofH = 2.2 + (b.cidx % 2) * 0.35;
      isHip = b.cidx % 5 === 0;
      wallBucket = (b.cidx % 3 === 0) ? brickBuckets[b.cidx % 4] : sidingBuckets[b.cidx % 6];
    } else if (b.style === 'quadruplex') {
      wallH = 6.1;
      roofH = 1.95;
      isHip = true;
      wallBucket = brickBuckets[3];
    } else if (b.style === 'apartments') {
      wallH = 8.4;
      roofH = 0.5;
      isFlat = true;
      wallBucket = brickBuckets[b.cidx % 4];
    } else if (b.style === 'commercial') {
      wallH = b.id === 265699855 ? 7.4 : b.amenity === 'social_facility' ? 9.2 : 4.6;
      roofH = 0.45;
      isFlat = true;
      wallBucket = brickBuckets[b.cidx % 4];
    } else if (b.style === 'semidetached') {
      wallH = 5.65;
      roofH = 1.95;
      isHip = true;
      wallBucket = sidingBuckets[b.cidx % 2];
    }

    // Foundation plinth extended 1.5m down so no house ever floats on a hillside
    const yBase = elev - 1.5;
    const foundTotalH = foundH + 1.5;
    const fg = createExtrudedPolygonGeometry(b.pts, foundTotalH, yBase);
    if (fg) foundationGeos.push(fg);

    // Main wall body: authentic Quebec two-tone brick + horizontal vinyl siding for split-levels, 2s cottages & quadruplexes
    const wallBaseY = elev + foundH;
    let upperWallBucket = wallBucket;
    if (b.style === 'splitlevel') {
      const lowerH = 2.25;
      const wgLow = createExtrudedPolygonGeometry(b.pts, lowerH, wallBaseY);
      if (wgLow) brickBuckets[b.cidx % 4].push(wgLow);
      const wgUp = createExtrudedPolygonGeometry(b.pts, wallH - lowerH, wallBaseY + lowerH);
      if (wgUp) wallBucket.push(wgUp);
    } else if (b.style === 'cottage_2s' && b.cidx % 2 === 0) {
      const lowerH = 2.75;
      upperWallBucket = sidingBuckets[(b.cidx + 1) % 6];
      const wgLow = createExtrudedPolygonGeometry(b.pts, lowerH, wallBaseY);
      if (wgLow) brickBuckets[b.cidx % 4].push(wgLow);
      const wgUp = createExtrudedPolygonGeometry(b.pts, wallH - lowerH, wallBaseY + lowerH);
      if (wgUp) upperWallBucket.push(wgUp);
    } else if (b.style === 'semidetached' || b.style === 'quadruplex') {
      const lowerH = b.style === 'quadruplex' ? 3.2 : 2.9;
      upperWallBucket = sidingBuckets[b.cidx % 2];
      const brickIdx = b.cidx % 2 === 0 ? 3 : 1;
      const wgLow = createExtrudedPolygonGeometry(b.pts, lowerH, wallBaseY);
      if (wgLow) brickBuckets[brickIdx].push(wgLow);
      const wgUp = createExtrudedPolygonGeometry(b.pts, wallH - lowerH, wallBaseY + lowerH);
      if (wgUp) upperWallBucket.push(wgUp);
    } else {
      const wg = createExtrudedPolygonGeometry(b.pts, wallH, wallBaseY);
      if (wg) wallBucket.push(wg);
    }

    const roofY = wallBaseY + wallH;
    const rotY = -b.ang;
    const shingleIdx = (b.style === 'quadruplex' || b.style === 'semidetached') ? 1 : (b.cidx * 7) % 3;
    const shingleBucket = shingleBuckets[shingleIdx];
    const accentBucket = accentBuckets[b.cidx % 4];
    const gableBucket = b.style === 'bungalow_brick' ? sidingBuckets[b.cidx % 6] : upperWallBucket;

    let isFrontGable = false;
    if (isFlat) {
      const rg = createGroundPolygonGeometry(b.pts, roofY + 0.02, 0.08, null);
      if (rg) flatRoofGeos.push(rg);
      // Crisp parapet coping trim around flat roofs
      for (let i = 0; i < localPts.length; i++) {
        const [u0, v0] = localPts[i];
        const [u1, v1] = localPts[(i + 1) % localPts.length];
        const sLen = Math.hypot(u1 - u0, v1 - v0);
        if (sLen < 1.2) continue;
        const [wx, wz] = toWorld((u0 + u1) * 0.5, (v0 + v1) * 0.5);
        const sAng = Math.atan2(v1 - v0, u1 - u0);
        transformAndPush(new THREE.BoxGeometry(sLen + 0.12, 0.22, 0.22), wx, roofY + 0.11, wz, rotY - sAng, trimGeos);
      }
    } else {
      isFrontGable = !isHip && b.style === 'cottage_2s' && b.cidx % 3 === 1 && b.w < 13 && b.d < 13;

      const emitPitchedRoof = (cx, cy, cz, depthR, widthR, heightR, hipR, rAng, gBucket) => {
        const rg = createPitchedRoofGeometry(depthR, widthR, heightR, hipR, 0.34);
        transformAndPush(rg, cx, cy, cz, rAng, shingleBucket);
        const rTrim = createRoofTrimGeometry(depthR, widthR, heightR, hipR, 0.34);
        if (rTrim) transformAndPush(rTrim, cx, cy, cz, rAng, roofTrimGeos);
        if (!hipR) {
          const gg = createGableEndsGeometry(depthR, widthR, heightR);
          transformAndPush(gg, cx, cy, cz, rAng, gBucket);
        }
      };

      // Handle L-shaped cottages/bungalows cleanly so roofs don't overhang open lawn
      let handledL = false;
      if (fillRatio < 0.85 && localPts.length >= 6 && b.w > 7 && b.d > 7) {
        const frontSpan = sliceVExtent(localPts, b.d * 0.28);
        const backSpan = sliceVExtent(localPts, -b.d * 0.28);
        if (frontSpan && backSpan) {
          const fw = frontSpan[1] - frontSpan[0];
          const bw = backSpan[1] - backSpan[0];
          if (bw > b.w * 0.82 && fw < b.w * 0.72 && fw > 3.2) {
            const dMain = b.d * 0.54;
            const dWing = b.d * 0.52;
            const [mx, mz] = toWorld(-b.d * 0.5 + dMain * 0.5, (backSpan[0] + backSpan[1]) * 0.5);
            const [wx, wz] = toWorld(b.d * 0.5 - dWing * 0.5, (frontSpan[0] + frontSpan[1]) * 0.5);
            emitPitchedRoof(mx, roofY, mz, dMain, bw, roofH, isHip, rotY, gableBucket);
            emitPitchedRoof(wx, roofY, wz, fw, dWing + 0.6, Math.max(1.2, roofH * 0.82), false, rotY + Math.PI / 2, gableBucket);
            handledL = true;
          } else if (fw > b.w * 0.82 && bw < b.w * 0.72 && bw > 3.2) {
            const dMain = b.d * 0.54;
            const dWing = b.d * 0.52;
            const [mx, mz] = toWorld(b.d * 0.5 - dMain * 0.5, (frontSpan[0] + frontSpan[1]) * 0.5);
            const [wx, wz] = toWorld(-b.d * 0.5 + dWing * 0.5, (backSpan[0] + backSpan[1]) * 0.5);
            emitPitchedRoof(mx, roofY, mz, dMain, fw, roofH, isHip, rotY, gableBucket);
            emitPitchedRoof(wx, roofY, wz, bw, dWing + 0.6, Math.max(1.2, roofH * 0.82), false, rotY + Math.PI / 2, gableBucket);
            handledL = true;
          }
        }
      }

      if (!handledL) {
        if (isFrontGable) {
          emitPitchedRoof(b.obbCx, roofY, b.obbCz, b.w, b.d, roofH, false, rotY + Math.PI / 2, gableBucket);
        } else {
          emitPitchedRoof(b.obbCx, roofY, b.obbCz, b.d, b.w, roofH, isHip, rotY, gableBucket);
        }
      }

      // Quadruplex & Semidetached front triangular pediment gable above central portico
      if ((b.style === 'semidetached' || b.style === 'quadruplex') && b.w > 9.5) {
        const pedW = Math.min(5.2, b.w * 0.34);
        const pedU = getFlatFrontU(localPts, 0, pedW * 0.3, b.d * 0.5) ?? (b.d * 0.5);
        const [px, pz] = toWorld(pedU - 0.6, 0);
        emitPitchedRoof(px, roofY + 0.02, pz, pedW, 1.8, 1.35, false, rotY + Math.PI / 2, upperWallBucket);
      }

      // Projecting 2-storey front-gabled bay on ~40% of 2-storey rectangular cottages
      if (b.style === 'cottage_2s' && fillRatio > 0.88 && b.cidx % 2 === 0 && b.w > 8.2 && !isFrontGable) {
        const bayW = Math.min(4.2, b.w * 0.42);
        const bayD = 1.45;
        const baySign = (b.cidx % 4 === 0) ? -1 : 1;
        const bayV = baySign * (b.w * 0.25);
        const bayU = getFlatFrontU(localPts, bayV, bayW * 0.4, b.d * 0.5) ?? (b.d * 0.5);
        const [bx, bz] = toWorld(bayU + bayD * 0.35, bayV);
        const bayBox = boxWorldUV(bayD, wallH, bayW);
        transformAndPush(bayBox, bx, wallBaseY + wallH * 0.5, bz, rotY, upperWallBucket);
        emitPitchedRoof(bx - cosA * 0.25, roofY, bz - sinA * 0.25, bayW, bayD + 1.2, 1.35, false, rotY + Math.PI / 2, upperWallBucket);
      }

      // 1.5-Storey Quebec Cottages: 2 front roof dormers on ~70% + covered veranda on living/entry side only
      if (b.style === 'cottage_1_5s' && b.w > 7.5 && b.cidx % 10 < 7) {
        for (const dv of [-b.w * 0.24, b.w * 0.24]) {
          const dWallU = getPolyFrontU(localPts, dv) ?? (b.d * 0.5);
          const [dx, dz] = toWorld(dWallU * 0.44, dv);
          const dBox = boxWorldUV(1.75, 1.35, 1.55);
          transformAndPush(dBox, dx, roofY + 0.68, dz, rotY, upperWallBucket);
          emitPitchedRoof(dx, roofY + 1.36, dz, 1.65, 1.85, 0.65, false, rotY + Math.PI / 2, upperWallBucket);
          const [dwx, dwz] = toWorld(dWallU * 0.44 + 0.88, dv);
          transformAndPush(new THREE.BoxGeometry(0.12, 0.86, 0.92), dwx, roofY + 0.68, dwz, rotY, windowGeos);
        }
      }

      // Brick chimney on ~45% of houses
      if (b.style !== 'garage_shed' && b.cidx % 9 < 4) {
        const chSign = b.cidx % 2 === 0 ? 1 : -1;
        const sideExt = Math.min(b.w * 0.34, Math.abs(getPolySideV(localPts, 0, chSign, b.w * 0.5)) - 0.55);
        if (sideExt > 1.2) {
          const [chx, chz] = toWorld(-b.d * 0.12, chSign * sideExt);
          transformAndPush(
            boxWorldUV(0.75, roofH + 1.15, 0.75),
            chx,
            roofY + (roofH + 1.15) * 0.5 - 0.15,
            chz,
            rotY,
            brickBuckets[3]
          );
        }
      }

      // Gable attic vents / louvers on pitched gable ends (~50% of houses)
      if (!isHip && !handledL && b.style !== 'garage_shed' && b.cidx % 2 === 0) {
        if (isFrontGable) {
          for (const gSgn of [-1, 1]) {
            const [vx, vz] = toWorld(gSgn * (b.d * 0.5 + 0.05), 0);
            transformAndPush(new THREE.BoxGeometry(0.10, 0.42, 0.55), vx, roofY + roofH * 0.52, vz, rotY, trimGeos);
            transformAndPush(new THREE.BoxGeometry(0.12, 0.30, 0.42), vx, roofY + roofH * 0.52, vz, rotY, accentBucket);
          }
        } else {
          for (const gSgn of [-1, 1]) {
            const [vx, vz] = toWorld(0, gSgn * (b.w * 0.5 + 0.05));
            transformAndPush(new THREE.BoxGeometry(0.55, 0.42, 0.10), vx, roofY + roofH * 0.52, vz, rotY, trimGeos);
            transformAndPush(new THREE.BoxGeometry(0.42, 0.30, 0.12), vx, roofY + roofH * 0.52, vz, rotY, accentBucket);
          }
        }
      }

      // Vertical corner trim / gutter downspouts on polygon outer corners
      if (b.style !== 'garage_shed' && b.style !== 'barn') {
        for (let ci = 0; ci < b.pts.length && ci < 8; ci++) {
          const [px, pz] = b.pts[ci];
          transformAndPush(new THREE.BoxGeometry(0.14, wallH, 0.14), px, wallBaseY + wallH * 0.5, pz, rotY, trimGeos);
        }
      }
    }

    // Symmetrical Quebec Duplex/Quadruplex Facade (semidetached & quadruplex): brick piers, twin balconies, central portico
    if ((b.style === 'quadruplex' || b.style === 'semidetached') && b.w > 9.5) {
      const cU = getPolyFrontU(localPts, 0) ?? (b.d * 0.5);
      for (const bv of [-b.w * 0.32, b.w * 0.32]) {
        const bU = getPolyFrontU(localPts, bv) ?? cU;
        const [bx, bz] = toWorld(bU + 0.72, bv);
        // Balcony slab + crisp white aluminum picket railing + masonry brick support pier at outer corner
        transformAndPush(new THREE.BoxGeometry(1.45, 0.18, 2.85), bx, wallBaseY + 2.85, bz, rotY, foundationGeos);
        transformAndPush(new THREE.BoxGeometry(1.42, 0.92, 0.08), bx, wallBaseY + 3.40, bz + (bv > 0 ? 1.38 : -1.38), rotY, trimGeos);
        transformAndPush(new THREE.BoxGeometry(0.08, 0.92, 2.85), bx + cosA * 0.68, wallBaseY + 3.40, bz + sinA * 0.68, rotY, trimGeos);
        const [pierX, pierZ] = toWorld(bU + 1.25, bv + (bv > 0 ? 1.25 : -1.25));
        transformAndPush(boxWorldUV(0.45, 2.85, 0.45), pierX, wallBaseY + 1.42, pierZ, rotY, brickBuckets[3]);
      }
      // Central gabled portico + dual front doors
      const [px, pz] = toWorld(cU + 0.65, 0);
      transformAndPush(new THREE.BoxGeometry(1.3, 0.32, 3.6), px, elev + 0.16, pz, rotY, foundationGeos);
      const qPortico = createPitchedRoofGeometry(3.8, 1.4, 1.05, false, 0.18);
      transformAndPush(qPortico, px, wallBaseY + 2.8, pz, rotY + Math.PI / 2, shingleBucket);
      const qTrim = createRoofTrimGeometry(3.8, 1.4, 1.05, false, 0.18);
      if (qTrim) transformAndPush(qTrim, px, wallBaseY + 2.8, pz, rotY + Math.PI / 2, roofTrimGeos);
      for (const dv of [-0.85, 0.85]) {
        const [dx, dz] = toWorld(cU + 0.03, dv);
        transformAndPush(new THREE.BoxGeometry(0.14, 2.1, 0.92), dx, wallBaseY + 1.05, dz, rotY, accentBucket);
      }
    }

    // Authentic Polygon-Snapped Windows, Garage Doors, Porch Stoops & Storefronts
    if (b.style !== 'garage_shed' && b.style !== 'barn') {
      const hasShutters = b.style !== 'commercial' && b.style !== 'apartments' && b.style !== 'semidetached' && b.style !== 'quadruplex' && b.cidx % 9 < 5;

      // Align garage & living sides strictly with actual OSM/build_data driveway side!
      let garSide = (b.cidx % 2 === 0) ? -1 : 1;
      if (b.driveway) {
        const dSide = -(b.driveway[0] - b.obbCx) * sinA + (b.driveway[1] - b.obbCz) * cosA;
        garSide = dSide >= 0 ? 1 : -1;
      }
      const livSide = -garSide;

      const rows = wallH > 5.0 ? 2 : 1;

      if (b.style === 'commercial') {
        let commSign = 1;
        if (b.obbCz < -600) {
          const dotSW = cosA * -0.35 + sinA * 0.94;
          if (dotSW < 0) commSign = -1;
        }
        const commFx = commSign * (b.d * 0.5 + 0.04);
        const cols = Math.max(3, Math.floor(b.w / 3.8));
        for (let c = 0; c < cols; c++) {
          const wz = ((c + 0.5) / cols - 0.5) * (b.w * 0.86);
          const uSnap = commSign > 0 ? (getPolyFrontU(localPts, wz) ?? commFx) : commFx;
          const [wx, wzWorld] = toWorld(commSign > 0 ? uSnap + 0.04 : commFx, wz);
          transformAndPush(new THREE.BoxGeometry(0.14, 2.35, 2.45), wx, wallBaseY + 1.45, wzWorld, rotY, windowGeos);
          if (wallH > 6.5) {
            transformAndPush(new THREE.BoxGeometry(0.14, 1.45, 2.15), wx, wallBaseY + 4.85, wzWorld, rotY, windowGeos);
          }
        }
        const [cx, cz] = toWorld(commSign * (b.d * 0.5 + 0.84), 0);
        transformAndPush(new THREE.BoxGeometry(1.6, 0.28, Math.min(b.w * 0.5, 6.5)), cx, wallBaseY + 3.15, cz, rotY, accentBucket);
        const [hx, hz] = toWorld(-commSign * b.d * 0.15, (b.cidx % 3 - 1) * 2.5);
        transformAndPush(new THREE.BoxGeometry(1.8, 0.85, 1.8), hx, roofY + 0.42, hz, rotY, trimGeos);
      } else {
        // Place front windows snapped onto actual polygon wall surface + projecting white window sills
        const addFrontWin = (vPos, wy, winH, winW, allowShutters) => {
          const uWall = getFlatFrontU(localPts, vPos, winW * 0.5, b.d * 0.5);
          if (uWall === null) return;
          const [lwx, lwzW] = toWorld(uWall + 0.04, vPos);
          transformAndPush(new THREE.BoxGeometry(0.14, winH, winW), lwx, wy, lwzW, rotY, windowGeos);
          const [silX, silZ] = toWorld(uWall + 0.09, vPos);
          transformAndPush(new THREE.BoxGeometry(0.16, 0.09, winW + 0.22), silX, wy - winH * 0.5 - 0.03, silZ, rotY, trimGeos);
          if (allowShutters) {
            for (const sgn of [-1, 1]) {
              const sv = vPos + sgn * (winW * 0.5 + 0.21);
              const uSh = getPolyFrontU(localPts, sv);
              if (uSh !== null && Math.abs(uSh - uWall) < 0.25) {
                const [sx, sz] = toWorld(uSh + 0.04, sv);
                transformAndPush(new THREE.BoxGeometry(0.08, winH + 0.06, 0.30), sx, wy, sz, rotY, accentBucket);
              }
            }
          }
          return uWall;
        };

        for (let r = 0; r < rows; r++) {
          const wy = wallBaseY + (r === 0 ? 1.72 : 4.12);
          if (r === 0 && b.w > 7.5 && b.style !== 'quadruplex' && b.style !== 'semidetached') {
            const lwz = livSide * (b.w * 0.25);
            const isBay = b.cidx % 3 === 0;
            const winW = isBay ? 2.25 : 1.95;
            const uLiv = getFlatFrontU(localPts, lwz, winW * 0.5, b.d * 0.5);
            if (uLiv !== null) {
              const [lwx, lwzW] = toWorld(uLiv + (isBay ? 0.22 : 0.04), lwz);
              if (isBay) {
                transformAndPush(new THREE.BoxGeometry(0.42, 1.38, winW + 0.20), lwx, wy, lwzW, rotY, trimGeos);
                const bayRoof = createPitchedRoofGeometry(0.55, winW + 0.35, 0.38, true, 0.08);
                transformAndPush(bayRoof, lwx + cosA * 0.06, wy + 0.69, lwzW + sinA * 0.06, rotY, shingleBucket);
                transformAndPush(new THREE.BoxGeometry(0.46, 1.22, winW), lwx, wy, lwzW, rotY, windowGeos);
              } else {
                addFrontWin(lwz, wy, 1.24, winW, hasShutters);
              }

              // Window flower boxes under ground-floor front windows (~30% of cottages/bungalows)
              if (b.cidx % 10 < 3 && (b.style.includes('cottage') || b.style.includes('bungalow'))) {
                const [fbx, fbz] = toWorld(uLiv + 0.20, lwz);
                transformAndPush(boxWorldUV(0.32, 0.26, winW * 0.92), fbx, wy - 0.78, fbz, rotY, woodAccentGeos);
                for (const flOff of [-0.55, 0, 0.55]) {
                  const [flx, flz] = toWorld(uLiv + 0.22, lwz + flOff);
                  transformAndPush(new THREE.BoxGeometry(0.22, 0.22, 0.24), flx, wy - 0.58, flz, rotY, flowerBoxFlowerGeos);
                }
              }
            }
            if (!b.driveway || b.cidx % 4 === 1) {
              addFrontWin(-livSide * (b.w * 0.30), wy, 1.12, 1.05, hasShutters);
            }
          } else {
            const cols = Math.max(2, Math.min(4, Math.floor(b.w / 3.2)));
            for (let c = 0; c < cols; c++) {
              const jitter = ((b.cidx + c * 7) % 5 - 2) * 0.10;
              const wz = ((c + 0.5) / cols - 0.5) * (b.w * 0.72) + jitter;
              addFrontWin(wz, wy, 1.16, 1.12, hasShutters && c % 2 === 0);
            }
          }
        }

        // Basement soupirail foundation windows along concrete plinth
        if (foundH >= 0.32 && b.w > 7.0) {
          for (const bv of [-b.w * 0.28, b.w * 0.28]) {
            const bFrontU = getFlatFrontU(localPts, bv, 0.45, b.d * 0.5);
            if (bFrontU !== null) {
              const [bwx, bwz] = toWorld(bFrontU + 0.04, bv);
              transformAndPush(new THREE.BoxGeometry(0.12, 0.32, 0.85), bwx, elev + foundH * 0.55, bwz, rotY, windowGeos);
            }
          }
        }
      }

      // 1.5-Storey covered front veranda confined ONLY to living/entry side (never blocking garage!)
      if (b.style === 'cottage_1_5s' && b.w > 7.5 && fillRatio > 0.86) {
        const verW = b.w * 0.48;
        const verCenterV = livSide * (b.w * 0.22);
        const verU = getFlatFrontU(localPts, verCenterV, verW * 0.4, b.d * 0.5) ?? (b.d * 0.5);
        const [vx, vz] = toWorld(verU + 0.85, verCenterV);
        transformAndPush(boxWorldUV(1.75, 0.22, verW), vx, wallBaseY + 0.08, vz, rotY, woodAccentGeos);
        const verRoof = createPitchedRoofGeometry(1.85, verW + 0.3, 0.58, false, 0.15);
        transformAndPush(verRoof, vx, wallBaseY + 2.65, vz, rotY, shingleBucket);
        const verTrim = createRoofTrimGeometry(1.85, verW + 0.3, 0.58, false, 0.15);
        if (verTrim) transformAndPush(verTrim, vx, wallBaseY + 2.65, vz, rotY, roofTrimGeos);
        for (const pv of [-verW * 0.42, 0, verW * 0.42]) {
          const [px, pz] = toWorld(verU + 1.55, verCenterV + pv);
          transformAndPush(new THREE.BoxGeometry(0.14, 2.55, 0.14), px, wallBaseY + 1.38, pz, rotY, trimGeos);
        }
      }

      // Garage door + stepped concrete porch with matte-black aluminum railings + coloured front door + portico + bins
      if (b.driveway && b.w > 7.5 && b.style !== 'modular' && b.style !== 'semidetached' && b.style !== 'quadruplex') {
        const gz = garSide * (b.w * 0.26);
        const garU = getFlatFrontU(localPts, gz, 1.35, b.d * 0.5);
        if (garU !== null) {
          const [gx, gzWorld] = toWorld(garU + 0.04, gz);
          transformAndPush(new THREE.BoxGeometry(0.14, 2.22, 2.75), gx, wallBaseY + 1.11, gzWorld, rotY, garageDoorGeos);
          transformAndPush(new THREE.BoxGeometry(0.10, 2.34, 2.94), gx - cosA * 0.02, wallBaseY + 1.15, gzWorld - sinA * 0.02, rotY, trimGeos);

          // 3-colour municipal wheeled bins (bacs roulants)
          if (b.cidx % 4 !== 3) {
            const [bx1, bz1] = toWorld(garU + 0.52, gz + garSide * 1.65);
            transformAndPush(new THREE.BoxGeometry(0.52, 0.92, 0.58), bx1, elev + 0.46, bz1, rotY, binBlueGeos);
            if (b.cidx % 2 === 0) {
              const [bx2, bz2] = toWorld(garU + 0.52, gz + garSide * 2.32);
              transformAndPush(new THREE.BoxGeometry(0.48, 0.82, 0.52), bx2, elev + 0.41, bz2, rotY, binGreenGeos);
            }
            if (b.cidx % 3 === 0) {
              const [bx3, bz3] = toWorld(garU - 0.25, gz + garSide * 1.65);
              transformAndPush(new THREE.BoxGeometry(0.52, 0.92, 0.58), bx3, elev + 0.46, bz3, rotY, binBlackGeos);
            }
          }
        }

        const entryZ = (b.cidx % 5 === 0) ? 0.0 : -garSide * Math.min(1.6, b.w * 0.08);
        const entryU = getFlatFrontU(localPts, entryZ, 0.55, b.d * 0.5) ?? (b.d * 0.5);
        const [dx, dz] = toWorld(entryU + 0.03, entryZ);
        transformAndPush(new THREE.BoxGeometry(0.14, 2.05, 0.96), dx, wallBaseY + 1.04, dz, rotY, accentBucket);

        // Warm porch light sconce beside front entry door
        const [scx, scz] = toWorld(entryU + 0.09, entryZ + (entryZ >= 0 ? -0.68 : 0.68));
        transformAndPush(new THREE.BoxGeometry(0.16, 0.24, 0.16), scx, wallBaseY + 1.82, scz, rotY, sconceGeos);

        // Concrete front walkway connecting front steps toward driveway
        const walkLen = Math.max(1.2, Math.abs(gz - entryZ));
        const walkMidZ = (gz + entryZ) * 0.5;
        const [wkx, wkz] = toWorld(entryU + 1.65, walkMidZ);
        transformAndPush(new THREE.BoxGeometry(0.95, 0.10, walkLen), wkx, elev + 0.05, wkz, rotY, foundationGeos);

        // Open attached carport ONLY on rectangular lots (~14% of bungalows/cottages) on garSide
        if (fillRatio > 0.90 && b.cidx % 7 === 0 && (b.style.includes('bungalow') || b.style.includes('cottage'))) {
          const cpSign = garSide;
          const cpW = 3.4;
          const cpD = Math.min(7.2, b.d * 0.85);
          const cpV = cpSign * (b.w * 0.5 + cpW * 0.5);
          const [cpx, cpz] = toWorld(0, cpV);
          const cpRoof = createPitchedRoofGeometry(cpW, cpD, 0.85, false, 0.22);
          transformAndPush(cpRoof, cpx, wallBaseY + 2.65, cpz, rotY + Math.PI / 2, shingleBucket);
          const cpTrim = createRoofTrimGeometry(cpW, cpD, 0.85, false, 0.22);
          if (cpTrim) transformAndPush(cpTrim, cpx, wallBaseY + 2.65, cpz, rotY + Math.PI / 2, roofTrimGeos);
          for (const cpu of [-cpD * 0.42, 0, cpD * 0.42]) {
            const [px, pz] = toWorld(cpu, cpSign * (b.w * 0.5 + cpW - 0.16));
            transformAndPush(new THREE.BoxGeometry(0.16, 2.65, 0.16), px, wallBaseY + 1.32, pz, rotY, trimGeos);
          }
        }

        // Stepped concrete porch landing + lower step + matte-black aluminum railings
        const [px1, pz1] = toWorld(entryU + 0.58, entryZ);
        transformAndPush(
          new THREE.BoxGeometry(1.15, foundH + 0.35, 1.75),
          px1,
          elev + (foundH + 0.35) * 0.5 - 0.15,
          pz1,
          rotY,
          foundationGeos
        );
        const [stepX, stepZ] = toWorld(entryU + 1.32, entryZ);
        transformAndPush(new THREE.BoxGeometry(0.45, 0.22, 1.55), stepX, elev + 0.11, stepZ, rotY, foundationGeos);
        const porchRailBucket = b.cidx % 5 < 3 ? trimGeos : railingGeos;
        for (const rv of [-0.82, 0.82]) {
          const [rx, rz] = toWorld(entryU + 0.58, entryZ + rv);
          transformAndPush(new THREE.BoxGeometry(1.1, 0.08, 0.06), rx, wallBaseY + 0.78, rz, rotY, porchRailBucket);
          transformAndPush(new THREE.BoxGeometry(1.1, 0.05, 0.05), rx, wallBaseY + 0.14, rz, rotY, porchRailBucket);
          for (const bxOff of [-0.48, -0.24, 0, 0.24, 0.48]) {
            transformAndPush(new THREE.BoxGeometry(0.05, 0.68, 0.05), rx + cosA * bxOff, wallBaseY + 0.46, rz + sinA * bxOff, rotY, porchRailBucket);
          }
        }

        // Dark mulch patch along front foundation
        if (b.cidx % 3 !== 0) {
          const patchV = livSide * (b.w * 0.24);
          const patchU = getFlatFrontU(localPts, patchV, b.w * 0.16, b.d * 0.5);
          if (patchU !== null) {
            const [dpx, dpz] = toWorld(patchU + 0.45, patchV);
            transformAndPush(new THREE.BoxGeometry(0.85, 0.06, b.w * 0.32), dpx, elev + 0.03, dpz, rotY, dirtPatchGeos);
          }
        }

        if (b.style !== 'cottage_1_5s' && b.cidx % 5 < 3) {
          const pRoof = createPitchedRoofGeometry(1.75, 1.25, 0.55, false, 0.15);
          transformAndPush(pRoof, px1, wallBaseY + 2.45, pz1, rotY + Math.PI / 2, shingleBucket);
          const pTrim = createRoofTrimGeometry(1.75, 1.25, 0.55, false, 0.15);
          if (pTrim) transformAndPush(pTrim, px1, wallBaseY + 2.45, pz1, rotY + Math.PI / 2, roofTrimGeos);
          for (const pv of [-0.65, 0.65]) {
            const [postX, postZ] = toWorld(entryU + 1.05, entryZ + pv);
            transformAndPush(new THREE.BoxGeometry(0.12, 2.15, 0.12), postX, wallBaseY + 1.35, postZ, rotY, trimGeos);
          }
        }

        // Front stoop flower pots (~65% of homes)
        if (b.cidx % 10 < 7) {
          const [fpx, fpz] = toWorld(entryU + 0.92, entryZ + 0.68);
          transformAndPush(new THREE.BoxGeometry(0.32, 0.34, 0.32), fpx, elev + foundH + 0.20, fpz, rotY, accentBuckets[3]);
          transformAndPush(new THREE.BoxGeometry(0.28, 0.26, 0.28), fpx, elev + foundH + 0.48, fpz, rotY, flowerBoxFlowerGeos);
        }
      }

      // Backyard wooden patio deck + optional laundry line on ~45% of detached lots
      if (b.driveway && b.style !== 'modular' && b.cidx % 9 < 4) {
        const deckV = (b.cidx % 2 === 0 ? 1 : -1) * (b.w * 0.15);
        const [dkx, dkz] = toWorld(-b.d * 0.5 - 1.65, deckV);
        transformAndPush(boxWorldUV(3.2, 0.42, 3.8), dkx, elev + 0.25, dkz, rotY, woodAccentGeos);
        if (b.cidx % 2 === 0) {
          const [lx, lz] = toWorld(-b.d * 0.5 - 2.6, deckV);
          transformAndPush(new THREE.BoxGeometry(0.06, 0.06, 2.6), lx, elev + 1.95, lz, rotY, trimGeos);
          for (const lv of [-1.25, 1.25]) {
            const [lpx, lpz] = toWorld(-b.d * 0.5 - 2.6, deckV + lv);
            transformAndPush(new THREE.BoxGeometry(0.08, 1.65, 0.08), lpx, elev + 1.15, lpz, rotY, trimGeos);
          }
        }
      }

      // Wall-mounted mini-split heat pump / AC condenser (~55%) + Hydro-Québec electric meter (~70%) snapped to side polygon wall
      if (b.style !== 'commercial' && b.style !== 'apartments') {
        const utilSide = (b.cidx % 2 === 0) ? -1 : 1;
        if (b.cidx % 11 < 6) {
          const sideV = getPolySideV(localPts, -b.d * 0.15, utilSide, b.w * 0.5);
          const [acx, acz] = toWorld(-b.d * 0.15, sideV + utilSide * 0.20);
          transformAndPush(new THREE.BoxGeometry(0.78, 0.58, 0.36), acx, wallBaseY + 0.72, acz, rotY, trimGeos);
          transformAndPush(new THREE.BoxGeometry(0.42, 0.42, 0.38), acx - cosA * 0.08, wallBaseY + 0.72, acz - sinA * 0.08, rotY, railingGeos);
        }
        if (b.cidx % 10 < 7) {
          const sideV = getPolySideV(localPts, b.d * 0.18, utilSide, b.w * 0.5);
          const [emx, emz] = toWorld(b.d * 0.18, sideV + utilSide * 0.10);
          transformAndPush(new THREE.BoxGeometry(0.30, 0.38, 0.18), emx, wallBaseY + 1.45, emz, rotY, trimGeos);
          transformAndPush(new THREE.BoxGeometry(0.07, 1.45, 0.07), emx - cosA * 0.14, wallBaseY + 0.72, emz - sinA * 0.14, rotY, ventStackGeos);
        }
        if (!isFlat && b.cidx % 10 < 7) {
          const [vsx, vsz] = toWorld(-b.d * 0.18, -utilSide * (b.w * 0.22));
          transformAndPush(new THREE.BoxGeometry(0.11, 0.62, 0.11), vsx, roofY + roofH * 0.55 + 0.25, vsz, rotY, ventStackGeos);
        }
        if (!isFlat && b.cidx % 4 === 0) {
          const [sdx, sdz] = toWorld(-b.d * 0.35, utilSide * (b.w * 0.42));
          transformAndPush(new THREE.BoxGeometry(0.62, 0.62, 0.14), sdx, roofY + 0.25, sdz, rotY + 0.5, trimGeos);
        }
      }

      // (Residential & commercial fences are built collision-checked in buildSuburbanDetailsAndTrees)

      // Side wall windows (+Z and -Z faces snapped onto exact polygon side face)
      if (b.d > 6.5) {
        for (const sgn of [-1, 1]) {
          for (const uOff of [-b.d * 0.22, b.d * 0.22]) {
            const sideV = getPolySideV(localPts, uOff, sgn, b.w * 0.5);
            const [sx, sz] = toWorld(uOff, sideV + sgn * 0.04);
            transformAndPush(new THREE.BoxGeometry(1.06, 1.18, 0.14), sx, wallBaseY + 1.75, sz, rotY, windowGeos);
          }
        }
      }
    }
  }

  const pickableMeshes = [];
  const spawnBucket = (geos, mat, castShadow = true) => {
    const merged = mergeGeometries(geos);
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    scene.add(mesh);
    pickableMeshes.push(mesh);
  };

  spawnBucket(
    foundationGeos,
    new THREE.MeshStandardMaterial({ map: texLib.foundationTex || texLib.concreteTex, color: 0xaab0ab, roughness: 0.92 })
  );
  texLib.brickTextures.forEach((tex, i) => {
    spawnBucket(brickBuckets[i], new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  });
  texLib.sidingTextures.forEach((tex, i) => {
    spawnBucket(sidingBuckets[i], new THREE.MeshStandardMaterial({ map: tex, roughness: 0.74 }));
  });
  texLib.shingleTextures.forEach((tex, i) => {
    const shMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88 });
    registerMaterialSwap(
      shMat,
      { map: tex, color: 0xffffff, roughness: 0.88 },
      { map: texLib.snowRoofTex, color: 0xeef5fc, roughness: 0.82 }
    );
    spawnBucket(shingleBuckets[i], shMat);
  });

  const accentColors = [0x6b625a, 0x2f4d3b, 0x2b4159, 0x7a2b2b];
  accentColors.forEach((col, i) => {
    spawnBucket(accentBuckets[i], new THREE.MeshStandardMaterial({ color: col, roughness: 0.65 }), false);
  });
  spawnBucket(woodAccentGeos, new THREE.MeshStandardMaterial({ map: texLib.barkTex, color: 0xb89674, roughness: 0.88 }));

  const flatRoofMat = new THREE.MeshStandardMaterial({ color: 0x4b4e53, roughness: 0.92 });
  registerMaterialSwap(
    flatRoofMat,
    { map: null, color: 0x4b4e53, roughness: 0.92 },
    { map: texLib.snowRoofTex, color: 0xeef5fc, roughness: 0.85 }
  );
  spawnBucket(flatRoofGeos, flatRoofMat);
  spawnBucket(
    windowGeos,
    new THREE.MeshStandardMaterial({ map: texLib.windowTex || null, color: 0xffffff, roughness: 0.22, metalness: 0.28 }),
    false
  );
  spawnBucket(
    garageDoorGeos,
    new THREE.MeshStandardMaterial({ map: texLib.garageDoorTex || null, color: 0xffffff, roughness: 0.48, metalness: 0.15 }),
    false
  );
  spawnBucket(roofTrimGeos, new THREE.MeshStandardMaterial({ color: 0xf2f4f2, roughness: 0.52 }), false);
  spawnBucket(trimGeos, new THREE.MeshStandardMaterial({ color: 0xeaebea, roughness: 0.6 }), false);
  spawnBucket(railingGeos, new THREE.MeshStandardMaterial({ color: 0x24282e, metalness: 0.55, roughness: 0.42 }), false);
  spawnBucket(
    sconceGeos,
    new THREE.MeshStandardMaterial({ color: 0xffe4a0, emissive: 0xffb84d, emissiveIntensity: 0.65, roughness: 0.3 }),
    false
  );
  spawnBucket(binBlueGeos, new THREE.MeshStandardMaterial({ color: 0x1c65b8, roughness: 0.65 }), false);
  spawnBucket(binGreenGeos, new THREE.MeshStandardMaterial({ color: 0x3a6b35, roughness: 0.65 }), false);
  spawnBucket(binBlackGeos, new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.65 }), false);
  spawnBucket(
    ventStackGeos,
    new THREE.MeshStandardMaterial({
      map: texLib.rustMetalTex || null,
      color: 0x2b2f35,
      metalness: 0.45,
      roughness: 0.72,
    }),
    false
  );
  const dirtMerged = mergeGeometries(dirtPatchGeos);
  if (dirtMerged) {
    const dirtMesh = new THREE.Mesh(
      dirtMerged,
      new THREE.MeshStandardMaterial({
        map: texLib.mulchTex || texLib.dirtPathTex || texLib.concreteTex,
        color: 0xffffff,
        roughness: 0.96,
      })
    );
    dirtMesh.receiveShadow = true;
    scene.add(dirtMesh);
    registerWinterToggle((isWinter) => {
      dirtMesh.visible = !isWinter;
    });
  }
  const fbFlowerMerged = mergeGeometries(flowerBoxFlowerGeos);
  if (fbFlowerMerged) {
    const fbFlowerMesh = new THREE.Mesh(
      fbFlowerMerged,
      new THREE.MeshStandardMaterial({ color: 0xe85a7a, roughness: 0.8 })
    );
    scene.add(fbFlowerMesh);
    registerWinterToggle((isWinter) => {
      fbFlowerMesh.visible = !isWinter;
    });
  }

  return pickableMeshes;
}

/**
 * 4. Instanced Quebec Details: Cedar Hedges, Backyard Pools, Parked Cars, Utility Poles,
 *    Streetlights, ARRÊT Signs, Hydrants, Bus Stops, Micro-Voxel Grass Tufts & Minecraft Trees
 */
export function buildSuburbanDetailsAndTrees(scene, DATA, texLib) {
  const elevData = DATA.elevation;
  const rand = seededRand(2646);
  const dummy = new THREE.Object3D();
  const HERO_SKIP_IDS = new Set([827707358, 827707311, 827707339, 827707342, 827707441, 169345734, 827183553, 827183579]);

  // Precompute all hardscape, driveway, playground & building OBBs FIRST for zero-clipping placement
  const parkingBoxes = DATA.parkings.map((p) => ({ pts: p.pts, bbox: polyBBox(p.pts) }));
  for (const extraPts of [
    [[125.0, -170.5], [157.5, -157.5], [150.0, -136.5], [118.5, -151.0]], // Dépanneur Galvin lot + aprons
    [[71.2, 3.5], [84.2, 3.5], [84.2, 18.5], [71.2, 18.5]],                 // 387 Rue des Peupliers South lot
    [[21.5, -6.4], [38.5, -7.2], [38.5, -2.0], [21.5, -1.2]],               // 2643 Cormiers crushed-gravel driveway
  ]) {
    parkingBoxes.push({ pts: extraPts, bbox: polyBBox(extraPts) });
  }
  const pgBoxes = DATA.playgrounds.map((p) => ({ pts: p.pts, bbox: polyBBox(p.pts) }));
  const roadBoxes = DATA.roads.map((r) => ({
    pts: r.pts,
    hw: (r.width || 7) * 0.5 + (r.sidewalkSide && r.sidewalkSide !== 'none' ? 2.15 : 0.45),
    bbox: polyBBox(r.pts),
  }));
  const drivewaySegs = [];
  const buildingOBBs = [];
  for (const b of DATA.buildings) {
    if (b.driveway && b.id !== 827707441) drivewaySegs.push(b.driveway);
    if (b.obbCx != null && b.obbCz != null) {
      const cos = Math.cos(b.ang || 0);
      const sin = Math.sin(b.ang || 0);
      const hd = (b.d || 4) * 0.5;
      const hw = (b.w || 4) * 0.5;
      buildingOBBs.push({ x: b.obbCx, z: b.obbCz, hd, hw, cos, sin, rBound: Math.hypot(hd, hw) });
    }
  }

  const isClearOfHardscape = (tx, tz, roadPad = 0.25) => {
    for (let i = 0; i < parkingBoxes.length; i++) {
      const pb = parkingBoxes[i];
      if (tx >= pb.bbox[0] - roadPad && tx <= pb.bbox[1] + roadPad && tz >= pb.bbox[2] - roadPad && tz <= pb.bbox[3] + roadPad && pointInPoly(tx, tz, pb.pts)) {
        return false;
      }
    }
    for (let i = 0; i < pgBoxes.length; i++) {
      const pg = pgBoxes[i];
      if (tx >= pg.bbox[0] - roadPad && tx <= pg.bbox[1] + roadPad && tz >= pg.bbox[2] - roadPad && tz <= pg.bbox[3] + roadPad && pointInPoly(tx, tz, pg.pts)) {
        return false;
      }
    }
    for (let i = 0; i < roadBoxes.length; i++) {
      const rb = roadBoxes[i];
      const hw = rb.hw + roadPad;
      if (tx < rb.bbox[0] - hw || tx > rb.bbox[1] + hw || tz < rb.bbox[2] - hw || tz > rb.bbox[3] + hw) continue;
      for (let j = 0; j < rb.pts.length - 1; j++) {
        const [x0, z0] = rb.pts[j], [x1, z1] = rb.pts[j + 1];
        const dx = x1 - x0, dz = z1 - z0;
        const l2 = dx * dx + dz * dz;
        if (l2 < 1e-4) continue;
        let t = ((tx - x0) * dx + (tz - z0) * dz) / l2;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        if (Math.hypot(tx - (x0 + t * dx), tz - (z0 + t * dz)) < hw) return false;
      }
    }
    return true;
  };

  const isClearForProp = (tx, tz, pad = 1.4, checkBuildings = true) => {
    if (!isClearOfHardscape(tx, tz, Math.max(0.2, pad * 0.45))) return false;
    for (let i = 0; i < drivewaySegs.length; i++) {
      const [x0, z0, x1, z1, dw] = drivewaySegs[i];
      const dx = x1 - x0, dz = z1 - z0;
      const l2 = dx * dx + dz * dz;
      if (l2 < 1e-4) continue;
      let t = ((tx - x0) * dx + (tz - z0) * dz) / l2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      if (Math.hypot(tx - (x0 + t * dx), tz - (z0 + t * dz)) < dw * 0.5 + pad * 0.65) return false;
    }
    if (checkBuildings) {
      for (let i = 0; i < buildingOBBs.length; i++) {
        const o = buildingOBBs[i];
        const dx = tx - o.x, dz = tz - o.z;
        const maxR = o.rBound + pad;
        if (dx * dx + dz * dz > maxR * maxR) continue;
        const u = dx * o.cos + dz * o.sin;
        const v = -dx * o.sin + dz * o.cos;
        if (Math.abs(u) < o.hd + pad && Math.abs(v) < o.hw + pad) return false;
      }
    }
    return true;
  };

  // --- A. Sculpted Rounded-Top Cedar Hedges (haies de cèdres), collected BEFORE instantiation ---
  const hedgeTransforms = [];
  const tryPushHedge = (hx, hz, ry, len, height, depth = 1.05) => {
    if (Math.hypot(hx, hz) > 1045) return;
    const ux = Math.cos(-ry), uz = Math.sin(-ry);
    const half = len * 0.42;
    if (!isClearForProp(hx, hz, 0.35, true)) return;
    if (!isClearForProp(hx + ux * half, hz + uz * half, 0.35, true)) return;
    if (!isClearForProp(hx - ux * half, hz - uz * half, 0.35, true)) return;
    hedgeTransforms.push({ x: hx, z: hz, ry, sx: len, sy: height, sz: depth });
  };

  for (const b of DATA.buildings) {
    if (HERO_SKIP_IDS.has(b.id)) continue;
    if (!['cottage_2s', 'cottage_1_5s', 'bungalow_brick', 'bungalow_vinyl', 'splitlevel', 'semidetached'].includes(b.style)) {
      continue;
    }
    const hVal = rand();
    if (hVal > 0.80) continue;
    const fx = Math.cos(b.ang), fz = Math.sin(b.ang);
    const sx = -fz, sz = fx;
    const len = 13.5 + rand() * 7.5;
    const height = 1.85 + rand() * 0.65;
    const sideOff = b.w * 0.5 + 3.0 + rand() * 1.4;
    if (hVal < 0.48) {
      const sgn = rand() < 0.5 ? -1 : 1;
      tryPushHedge(
        b.obbCx - fx * 2.5 + sx * (sgn * sideOff),
        b.obbCz - fz * 2.5 + sz * (sgn * sideOff),
        -b.ang,
        len,
        height,
        1.08
      );
    } else {
      tryPushHedge(
        b.obbCx - fx * (b.d * 0.5 + 10.5),
        b.obbCz - fz * (b.d * 0.5 + 10.5),
        -b.ang + Math.PI / 2,
        b.w + 4.5,
        height,
        1.08
      );
    }
    // Side-yard front hedge return
    if (b.driveway && rand() < 0.42) {
      const retSgn = rand() < 0.5 ? -1 : 1;
      tryPushHedge(
        b.obbCx + fx * (b.d * 0.18) + sx * (retSgn * (b.w * 0.5 + 2.2)),
        b.obbCz + fz * (b.d * 0.18) + sz * (retSgn * (b.w * 0.5 + 2.2)),
        -b.ang + Math.PI / 2,
        2.6 + rand() * 1.3,
        1.55 + rand() * 0.45,
        0.92
      );
    }
  }
  if (hedgeTransforms.length > 0) {
    const hBot = new THREE.BoxGeometry(1.0, 0.64, 1.0);
    hBot.translate(0, -0.18, 0);
    const hMid = new THREE.BoxGeometry(0.98, 0.22, 0.84);
    hMid.translate(0, 0.25, 0);
    const hTop = new THREE.BoxGeometry(0.94, 0.14, 0.60);
    hTop.translate(0, 0.43, 0);
    const hGeo = mergeGeometries([hBot, hMid, hTop]);
    const huv = hGeo.attributes.uv;
    for (let i = 0; i < huv.count; i++) huv.setXY(i, huv.getX(i) * 4.0, huv.getY(i) * 1.5);
    huv.needsUpdate = true;

    const hMat = new THREE.MeshStandardMaterial({
      map: texLib.hedgeTex,
      color: 0xffffff,
      roughness: 0.94,
    });
    registerMaterialSwap(
      hMat,
      { map: texLib.hedgeTex, color: 0xffffff, roughness: 0.94 },
      { map: texLib.hedgeTex, color: 0x9db8a8, roughness: 0.88 }
    );
    const hInst = new THREE.InstancedMesh(hGeo, hMat, hedgeTransforms.length);
    hInst.castShadow = true;
    hInst.receiveShadow = true;
    hedgeTransforms.forEach((ht, i) => {
      const elev = sampleElevation(ht.x, ht.z, elevData);
      dummy.position.set(ht.x, elev + ht.sy * 0.5 - 0.15, ht.z);
      dummy.rotation.set(0, ht.ry, 0);
      dummy.scale.set(ht.sx, ht.sy + 0.15, ht.sz);
      dummy.updateMatrix();
      hInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(hInst);
  }

  // --- A1b. Authentic Fleurimont Steel Chain-Link ("Frost"), Black Steel Picket & Wood Privacy Fences + Bollards ---
  const galvFenceSegs = [];
  const blackFrostSegs = [];
  const ironPicketSegs = [];
  const woodFenceSegs = [];
  const retainingWallSegs = [];
  const fenceObstacles = [];

  const pushFenceSpan = (bucket, x0, z0, x1, z1, height, skipPropCheck = false) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1.2) return;
    const mx = (x0 + x1) * 0.5;
    const mz = (z0 + z1) * 0.5;
    if (Math.hypot(mx, mz) > 1040) return;
    if (!skipPropCheck) {
      if (!isClearForProp(mx, mz, 0.35, true)) return;
      if (!isClearForProp(x0 + (x1 - x0) * 0.18, z0 + (z1 - z0) * 0.18, 0.3, true)) return;
      if (!isClearForProp(x0 + (x1 - x0) * 0.82, z0 + (z1 - z0) * 0.82, 0.3, true)) return;
    }
    const ry = -Math.atan2(z1 - z0, x1 - x0);
    bucket.push({ x: mx, z: mz, len, h: height, ry });
    fenceObstacles.push([mx, mz, len * 0.5, 0.22, ry]);
  };

  for (const b of DATA.buildings) {
    if (HERO_SKIP_IDS.has(b.id) || b.style === 'garage_shed' || b.style === 'barn' || b.style === 'commercial' || b.style === 'apartments') continue;
    const fRoll = rand();
    if (fRoll > 0.84) continue; // ~84% of homes have a side-yard return fence/gate and/or backyard fence

    // Quebec Fleurimont mix from Street View: 45% galvanized Frost, 19% black Frost, 14% black steel picket, 22% wood privacy
    const bucket =
      fRoll < 0.38 ? galvFenceSegs
        : fRoll < 0.54 ? blackFrostSegs
          : fRoll < 0.66 ? ironPicketSegs
            : woodFenceSegs;
    const fH = bucket === woodFenceSegs ? 1.72 : bucket === ironPicketSegs ? 1.28 : 1.48;

    const fx = Math.cos(b.ang), fz = Math.sin(b.ang);
    const sx = -fz, sz = fx;
    const sideExt = b.w * 0.5 + 2.8 + (b.cidx % 3) * 0.45;
    const backD = 8.2 + (b.cidx % 4) * 1.4;
    const retU = -b.d * 0.22;
    const rearU = -b.d * 0.5 - backD;

    const pt = (u, v) => [b.obbCx + fx * u + sx * v, b.obbCz + fz * u + sz * v];

    // 1. Street-visible side-yard return fences/gates from house walls out to side property lines
    for (const sgn of [-1, 1]) {
      const [ax, az] = pt(retU, sgn * (b.w * 0.5 + 0.25));
      const [bx, bz] = pt(retU, sgn * sideExt);
      pushFenceSpan(bucket, ax, az, bx, bz, fH);
    }

    // 2. Backyard side & rear perimeter fence enclosure
    for (const sgn of [-1, 1]) {
      const [ax, az] = pt(retU, sgn * sideExt);
      const [bx, bz] = pt(rearU, sgn * sideExt);
      pushFenceSpan(bucket, ax, az, bx, bz, fH);
    }
    const [rx0, rz0] = pt(rearU, -sideExt);
    const [rx1, rz1] = pt(rearU, sideExt);
    pushFenceSpan(bucket, rx0, rz0, rx1, rz1, fH);
  }

  // Commercial Rue King Est rear/residential-facing retaining walls + galvanized chain-link fences (May 2024 Street View)
  for (const pk of DATA.parkings) {
    if (!pk.pts || pk.pts.length < 4) continue;
    const cz = pk.pts.reduce((s, q) => s + q[1], 0) / pk.pts.length;
    if (cz > -550) continue;
    for (let i = 0; i < pk.pts.length; i++) {
      const [x0, z0] = pk.pts[i];
      const [x1, z1] = pk.pts[(i + 1) % pk.pts.length];
      // Place retaining wall + chain-link along south/rear residential edges (z > cz + 4)
      if ((z0 + z1) * 0.5 < cz + 4) continue;
      const segLen = Math.hypot(x1 - x0, z1 - z0);
      if (segLen < 6) continue;
      const mx = (x0 + x1) * 0.5, mz = (z0 + z1) * 0.5;
      if (!isClearOfHardscape(mx, mz, 0.1)) {
        // Still allow right on parking lot perimeter edge as long as it's not on a road
        let nearRoad = false;
        for (let r = 0; r < roadBoxes.length; r++) {
          const rb = roadBoxes[r];
          if (mx >= rb.bbox[0] - rb.hw && mx <= rb.bbox[1] + rb.hw && mz >= rb.bbox[2] - rb.hw && mz <= rb.bbox[3] + rb.hw) {
            nearRoad = true;
            break;
          }
        }
        if (nearRoad) continue;
      }
      const ry = -Math.atan2(z1 - z0, x1 - x0);
      retainingWallSegs.push({ x: mx, z: mz, len: segLen, h: 1.15, ry });
      galvFenceSegs.push({ x: mx, z: mz, len: segLen, h: 1.65, ry, yOff: 1.15 });
      fenceObstacles.push([mx, mz, segLen * 0.5, 0.35, ry]);
    }
  }

  // Instantiate all 4 fence styles with crisp world-scaled panels + tubular/wood posts & top rails
  const spawnFenceStyle = (segs, panelMat, postMat, postThickness = 0.07, panelThick = 0.04, isSolidWood = false) => {
    if (segs.length === 0) return;
    const pGeo = isSolidWood ? new THREE.BoxGeometry(1, 1, panelThick) : new THREE.PlaneGeometry(1, 1);
    const pInst = new THREE.InstancedMesh(pGeo, panelMat, segs.length);
    pInst.castShadow = isSolidWood;
    pInst.receiveShadow = true;

    const railGeo = new THREE.BoxGeometry(1, 0.06, 0.06);
    const railInst = new THREE.InstancedMesh(railGeo, postMat, segs.length);

    // Collect post positions along every fence span (~every 3.0m)
    const posts = [];
    segs.forEach((sg, i) => {
      const baseElev = sampleElevation(sg.x, sg.z, elevData) + (sg.yOff || 0);
      dummy.position.set(sg.x, baseElev + sg.h * 0.5, sg.z);
      dummy.rotation.set(0, sg.ry, 0);
      dummy.scale.set(sg.len, sg.h - 0.06, 1);
      dummy.updateMatrix();
      pInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(sg.x, baseElev + sg.h - 0.03, sg.z);
      dummy.rotation.set(0, sg.ry, 0);
      dummy.scale.set(sg.len, 1, 1);
      dummy.updateMatrix();
      railInst.setMatrixAt(i, dummy.matrix);

      const pCount = Math.max(2, Math.min(8, Math.round(sg.len / 3.0) + 1));
      const cR = Math.cos(-sg.ry), sR = Math.sin(-sg.ry);
      for (let pi = 0; pi < pCount; pi++) {
        const off = -sg.len * 0.5 + (pi / (pCount - 1)) * sg.len;
        posts.push([sg.x + cR * off, baseElev, sg.z + sR * off, sg.h + 0.06]);
      }
    });
    scene.add(pInst, railInst);

    if (posts.length > 0) {
      const postGeo = new THREE.BoxGeometry(postThickness, 1, postThickness);
      const postInst = new THREE.InstancedMesh(postGeo, postMat, posts.length);
      posts.forEach(([px, py, pz, ph], idx) => {
        dummy.position.set(px, py + ph * 0.5, pz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, ph, 1);
        dummy.updateMatrix();
        postInst.setMatrixAt(idx, dummy.matrix);
      });
      scene.add(postInst);
    }
  };

  const galvPanelTex = texLib.chainLinkTex.clone();
  galvPanelTex.needsUpdate = true;
  galvPanelTex.repeat.set(4.5, 1.3);
  const galvPostMat = new THREE.MeshStandardMaterial({ color: 0xbac4ce, metalness: 0.65, roughness: 0.36 });
  const galvPanelMat = new THREE.MeshStandardMaterial({
    map: galvPanelTex,
    color: 0xffffff,
    metalness: 0.52,
    roughness: 0.4,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
  });
  spawnFenceStyle(galvFenceSegs, galvPanelMat, galvPostMat, 0.065, 0.04, false);

  const blackFrostTex = texLib.blackChainLinkTex.clone();
  blackFrostTex.needsUpdate = true;
  blackFrostTex.repeat.set(4.5, 1.3);
  const blackSteelPostMat = new THREE.MeshStandardMaterial({ color: 0x22272e, metalness: 0.55, roughness: 0.42 });
  const blackFrostMat = new THREE.MeshStandardMaterial({
    map: blackFrostTex,
    color: 0xffffff,
    metalness: 0.45,
    roughness: 0.45,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
  });
  spawnFenceStyle(blackFrostSegs, blackFrostMat, blackSteelPostMat, 0.065, 0.04, false);

  const ironTex = texLib.ironPicketTex.clone();
  ironTex.needsUpdate = true;
  ironTex.repeat.set(4.0, 1.0);
  const ironPicketMat = new THREE.MeshStandardMaterial({
    map: ironTex,
    color: 0x262c34,
    metalness: 0.62,
    roughness: 0.36,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
  });
  spawnFenceStyle(ironPicketSegs, ironPicketMat, blackSteelPostMat, 0.075, 0.04, false);

  const woodFMat = new THREE.MeshStandardMaterial({
    map: texLib.woodFenceTex || texLib.barkTex,
    color: 0xffffff,
    roughness: 0.88,
  });
  const woodPostMat = new THREE.MeshStandardMaterial({ color: 0x7a5b3e, roughness: 0.9 });
  spawnFenceStyle(woodFenceSegs, woodFMat, woodPostMat, 0.11, 0.09, true);

  if (retainingWallSegs.length > 0) {
    const rwMat = new THREE.MeshStandardMaterial({ map: texLib.foundationTex || texLib.concreteTex, color: 0xc2c6c2, roughness: 0.92 });
    const rwInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.42), rwMat, retainingWallSegs.length);
    rwInst.castShadow = true;
    rwInst.receiveShadow = true;
    retainingWallSegs.forEach((rw, i) => {
      const e = sampleElevation(rw.x, rw.z, elevData);
      dummy.position.set(rw.x, e + rw.h * 0.5, rw.z);
      dummy.rotation.set(0, rw.ry, 0);
      dummy.scale.set(rw.len, rw.h, 1);
      dummy.updateMatrix();
      rwInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(rwInst);
  }

  // Chemin Galvin reflective black-and-yellow bike-lane bollards (May 2024 Street View)
  const bikeBollards = [];
  for (const r of DATA.roads) {
    if (!r.name || !r.name.includes('Galvin') || !r.pts || r.pts.length < 2) continue;
    const hw = (r.width || 8) * 0.5 - 1.15;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [x0, z0] = r.pts[i], [x1, z1] = r.pts[i + 1];
      const segLen = Math.hypot(x1 - x0, z1 - z0);
      if (segLen < 12) continue;
      const ux = (x1 - x0) / segLen, uz = (z1 - z0) / segLen;
      const nx = -uz, nz = ux;
      for (let d = 8; d < segLen - 8; d += 22) {
        const bx = x0 + ux * d + nx * hw;
        const bz = z0 + uz * d + nz * hw;
        if (Math.hypot(bx, bz) < 1020) bikeBollards.push([bx, bz]);
      }
    }
  }
  if (bikeBollards.length > 0) {
    const bolPostInst = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.055, 0.065, 0.88, 6),
      new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.55 }),
      bikeBollards.length
    );
    const bolBandInst = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.062, 0.062, 0.24, 6),
      new THREE.MeshStandardMaterial({ color: 0xf4c824, emissive: 0x664d00, emissiveIntensity: 0.25, roughness: 0.35 }),
      bikeBollards.length
    );
    bikeBollards.forEach(([bx, bz], i) => {
      const e = sampleElevation(bx, bz, elevData);
      dummy.position.set(bx, e + 0.44, bz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bolPostInst.setMatrixAt(i, dummy.matrix);
      dummy.position.set(bx, e + 0.68, bz);
      dummy.updateMatrix();
      bolBandInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(bolPostInst, bolBandInst);
  }

  // --- A2. Backyard Cabanon Sheds (~25% of detached lots, strictly clear of roads/buildings) ---
  const cabCoords = [];
  for (const b of DATA.buildings) {
    if (HERO_SKIP_IDS.has(b.id) || !b.driveway || b.style === 'modular') continue;
    if (rand() > 0.25) continue;
    const fx = Math.cos(b.ang), fz = Math.sin(b.ang);
    const sx = -fz, sz = fx;
    const side = (b.cidx % 2 === 0 ? 1 : -1) * (b.w * 0.4);
    const cx = b.obbCx - fx * (b.d * 0.5 + 8.5) + sx * side;
    const cz = b.obbCz - fz * (b.d * 0.5 + 8.5) + sz * side;
    if (Math.hypot(cx, cz) < 1020 && isClearForProp(cx, cz, 1.5, true)) {
      cabCoords.push({ x: cx, z: cz, ry: -b.ang });
    }
  }
  if (cabCoords.length > 0) {
    const cabWallGeo = setWorldBoxUVs(new THREE.BoxGeometry(2.6, 2.0, 2.9), 2.6, 2.0, 2.9, 1.0);
    const cabRoofGeo = createPitchedRoofGeometry(2.6, 2.9, 0.75, false, 0.18);
    const cabWallMat = new THREE.MeshStandardMaterial({ map: texLib.sidingTextures[1], roughness: 0.75 });
    const cabRoofMat = new THREE.MeshStandardMaterial({ map: texLib.shingleTextures[1], roughness: 0.88 });
    registerMaterialSwap(
      cabRoofMat,
      { map: texLib.shingleTextures[1], color: 0xffffff, roughness: 0.88 },
      { map: texLib.snowRoofTex, color: 0xeef5fc, roughness: 0.82 }
    );
    const cwInst = new THREE.InstancedMesh(cabWallGeo, cabWallMat, cabCoords.length);
    const crInst = new THREE.InstancedMesh(cabRoofGeo, cabRoofMat, cabCoords.length);
    cwInst.castShadow = true;
    crInst.castShadow = true;
    cabCoords.forEach((cc, i) => {
      const elev = sampleElevation(cc.x, cc.z, elevData);
      dummy.position.set(cc.x, elev + 1.0, cc.z);
      dummy.rotation.set(0, cc.ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      cwInst.setMatrixAt(i, dummy.matrix);
      dummy.position.set(cc.x, elev + 2.0, cc.z);
      dummy.updateMatrix();
      crInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(cwInst, crInst);
  }

  // --- B. Circular Blue Above-Ground Backyard Pools ---
  const poolCoords = [];
  for (const b of DATA.buildings) {
    if (HERO_SKIP_IDS.has(b.id)) continue;
    if (!['cottage_2s', 'cottage_1_5s', 'bungalow_brick', 'bungalow_vinyl', 'splitlevel'].includes(b.style)) continue;
    if (rand() > 0.14) continue;
    const fx = Math.cos(b.ang), fz = Math.sin(b.ang);
    const px = b.obbCx - fx * (b.d * 0.5 + 7.2);
    const pz = b.obbCz - fz * (b.d * 0.5 + 7.2);
    if (Math.hypot(px, pz) < 1020 && isClearForProp(px, pz, 2.2, true)) {
      poolCoords.push([px, pz, 2.2 + rand() * 0.7]);
    }
  }
  if (poolCoords.length > 0) {
    const pWall = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1.2, 16),
      new THREE.MeshStandardMaterial({ color: 0xd8dce0, roughness: 0.65 }),
      poolCoords.length
    );
    const pWaterMat = new THREE.MeshStandardMaterial({ color: 0x1a90e8, roughness: 0.16, metalness: 0.15 });
    registerMaterialSwap(
      pWaterMat,
      { map: null, color: 0x1a90e8, roughness: 0.16 },
      { map: texLib.winterIceTex, color: 0xd8ecfa, roughness: 0.25 }
    );
    const pWater = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.94, 0.94, 1.22, 16),
      pWaterMat,
      poolCoords.length
    );
    poolCoords.forEach(([x, z, r], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev + 0.55, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(r, 1, r);
      dummy.updateMatrix();
      pWall.setMatrixAt(i, dummy.matrix);
      pWater.setMatrixAt(i, dummy.matrix);
    });
    scene.add(pWall, pWater);
  }

  // --- C. Multi-Part Parked Vehicles (Wheels, Bumpers, Cabin Glass & Winter Snow Caps) ---
  const parkedVehicles = [];
  const carColors = [0xd4d8dc, 0x2e3540, 0x7b8590, 0x1e3c68, 0x9c2828, 0x3b4d3e, 0xe8eaed, 0x5c534a];
  for (const b of DATA.buildings) {
    if (!b.driveway || HERO_SKIP_IDS.has(b.id)) continue;
    if (rand() > 0.34) continue;
    const [x0, z0, x1, z1] = b.driveway;
    const t = 0.25 + rand() * 0.40;
    parkedVehicles.push({
      x: x0 + (x1 - x0) * t,
      z: z0 + (z1 - z0) * t,
      ry: -Math.atan2(z1 - z0, x1 - x0),
      col: carColors[Math.floor(rand() * carColors.length)],
    });
  }
  for (let i = 0; i < 10; i++) {
    parkedVehicles.push({
      x: 277 + (i % 5) * 3.1,
      z: 205 + Math.floor(i / 5) * 6.5,
      ry: Math.PI / 2,
      col: carColors[i % carColors.length],
    });
  }

  // Commercial Parking Lot Details: white stall lines, light standards, landscaped islands & ~55 parked customer cars
  const stallTransforms = [];
  const parkLightCoords = [];
  const parkIslandTransforms = [];
  const parkLotTreeCoords = [];
  let commercialCarsAdded = 0;

  for (const pk of DATA.parkings) {
    const pts = pk.pts;
    if (!pts || pts.length < 3) continue;
    let cx = 0, cz = 0;
    for (const [x, z] of pts) { cx += x; cz += z; }
    cx /= pts.length; cz /= pts.length;
    if (Math.hypot(cx, cz) > 1060) continue;

    // Principal axis from longest edge
    let bestLen = 0, bestAng = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len > bestLen) { bestLen = len; bestAng = Math.atan2(z1 - z0, x1 - x0); }
    }
    const cosP = Math.cos(bestAng), sinP = Math.sin(bestAng);
    const nxP = -sinP, nzP = cosP;
    const isKingEst = cz < -500;

    // Sample interior grid along principal axis
    const uSpan = Math.min(bestLen * 0.42, 42);
    for (let u = -uSpan; u <= uSpan; u += 2.75) {
      for (const rowV of (isKingEst ? [-8.5, 8.5] : [0])) {
        const sx = cx + cosP * u + nxP * rowV;
        const sz = cz + sinP * u + nzP * rowV;
        if (!pointInPoly(sx, sz, pts)) continue;
        stallTransforms.push({ x: sx, z: sz, ry: -bestAng });
        if (isKingEst && commercialCarsAdded < 58 && rand() < 0.56) {
          const carX = sx + cosP * 1.35;
          const carZ = sz + sinP * 1.35;
          if (pointInPoly(carX, carZ, pts)) {
            parkedVehicles.push({
              x: carX,
              z: carZ,
              ry: -bestAng + Math.PI / 2,
              col: carColors[Math.floor(rand() * carColors.length)],
            });
            commercialCarsAdded++;
          }
        }
      }
    }

    // Landscaped concrete islands & light standards in commercial lots
    if (isKingEst || bestLen > 24) {
      for (const iu of [-uSpan * 0.55, 0, uSpan * 0.55]) {
        const ix = cx + cosP * iu;
        const iz = cz + sinP * iu;
        if (!pointInPoly(ix, iz, pts)) continue;
        if (iu === 0) {
          parkLightCoords.push([ix, iz]);
        } else {
          parkIslandTransforms.push({ x: ix, z: iz, ry: -bestAng });
          parkLotTreeCoords.push([ix, iz]);
        }
      }
    }
  }

  if (stallTransforms.length > 0) {
    const stallInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.14, 0.03, 4.8),
      new THREE.MeshStandardMaterial({ color: 0xf1f3f5, roughness: 0.7 }),
      stallTransforms.length
    );
    stallTransforms.forEach((st, i) => {
      const elev = sampleElevation(st.x, st.z, elevData);
      dummy.position.set(st.x, elev + 0.125, st.z);
      dummy.rotation.set(0, st.ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      stallInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(stallInst);
  }
  if (parkLightCoords.length > 0) {
    const plPole = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.18, 8.2, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x3b4046, metalness: 0.6, roughness: 0.4 }),
      parkLightCoords.length
    );
    const plHead = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.4, 0.18, 0.45),
      new THREE.MeshStandardMaterial({ color: 0xfff0c2, emissive: 0xffd278, emissiveIntensity: 0.45 }),
      parkLightCoords.length
    );
    parkLightCoords.forEach(([x, z], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev + 4.1, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      plPole.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, elev + 8.25, z);
      dummy.updateMatrix();
      plHead.setMatrixAt(i, dummy.matrix);
    });
    scene.add(plPole, plHead);
  }
  if (parkIslandTransforms.length > 0) {
    const islInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2.4, 0.24, 4.6),
      new THREE.MeshStandardMaterial({ map: texLib.concreteTex, color: 0xc2c5c2, roughness: 0.9 }),
      parkIslandTransforms.length
    );
    parkIslandTransforms.forEach((isl, i) => {
      const elev = sampleElevation(isl.x, isl.z, elevData);
      dummy.position.set(isl.x, elev + 0.12, isl.z);
      dummy.rotation.set(0, isl.ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      islInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(islInst);
  }
  if (parkedVehicles.length > 0) {
    const bodyGeo = new THREE.BoxGeometry(4.2, 0.72, 1.82);
    const cabinGeo = new THREE.BoxGeometry(1.96, 0.52, 1.48);
    const glassGeo = new THREE.BoxGeometry(2.04, 0.40, 1.52);
    const wbParts = [
      (() => { const g = new THREE.BoxGeometry(4.32, 0.20, 1.76); g.translate(0, -0.22, 0); return g; })(),
    ];
    for (const wx of [-1.32, 1.32]) {
      for (const wz of [-0.88, 0.88]) {
        const g = new THREE.BoxGeometry(0.58, 0.58, 0.22);
        g.translate(wx, -0.27, wz);
        wbParts.push(g);
      }
    }
    const wheelBumperGeo = mergeGeometries(wbParts);
    const carSnowGeo = mergeGeometries([
      (() => { const g = new THREE.BoxGeometry(1.86, 0.11, 1.38); g.translate(-0.14, 0.88, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(1.05, 0.08, 1.52); g.translate(1.38, 0.39, 0); return g; })(),
    ]);

    const bodyInst = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.35 }), parkedVehicles.length);
    const cabinInst = new THREE.InstancedMesh(cabinGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.35 }), parkedVehicles.length);
    const glassInst = new THREE.InstancedMesh(glassGeo, new THREE.MeshStandardMaterial({ color: 0x243442, roughness: 0.2, metalness: 0.55 }), parkedVehicles.length);
    const wbInst = new THREE.InstancedMesh(wheelBumperGeo, new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.85 }), parkedVehicles.length);
    const carSnowInst = new THREE.InstancedMesh(carSnowGeo, new THREE.MeshStandardMaterial({ color: 0xf1f7fd, roughness: 0.86 }), parkedVehicles.length);
    carSnowInst.visible = false;
    bodyInst.castShadow = true;

    const tmpCol = new THREE.Color();
    parkedVehicles.forEach((pv, i) => {
      const elev = sampleElevation(pv.x, pv.z, elevData);
      dummy.position.set(pv.x, elev + 0.56, pv.z);
      dummy.rotation.set(0, pv.ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bodyInst.setMatrixAt(i, dummy.matrix);
      wbInst.setMatrixAt(i, dummy.matrix);
      carSnowInst.setMatrixAt(i, dummy.matrix);
      tmpCol.setHex(pv.col);
      bodyInst.setColorAt(i, tmpCol);
      cabinInst.setColorAt(i, tmpCol);

      dummy.position.set(pv.x - Math.cos(pv.ry) * 0.14, elev + 1.16, pv.z + Math.sin(pv.ry) * 0.14);
      dummy.updateMatrix();
      cabinInst.setMatrixAt(i, dummy.matrix);
      glassInst.setMatrixAt(i, dummy.matrix);
    });
    if (bodyInst.instanceColor) bodyInst.instanceColor.needsUpdate = true;
    if (cabinInst.instanceColor) cabinInst.instanceColor.needsUpdate = true;
    scene.add(bodyInst, cabinInst, glassInst, wbInst, carSnowInst);
    registerWinterToggle((isWinter) => {
      carSnowInst.visible = !!isWinter;
    });
  }

  // --- D. Hydro-Québec Utility Poles, Transformers, Guy-Wires, Multi-Strand Sagging Cables, Streetlights & Street Wear ---
  const polePlacements = [];
  const wireSegments = [];
  const hydrantPlacements = [];
  const manholePlacements = [];
  const drainPlacements = [];
  const patchPlacements = [];
  const curbWeedPlacements = [];

  for (const r of DATA.roads) {
    if (r.type !== 'residential' && r.type !== 'tertiary' && r.type !== 'primary') continue;
    let accum = 0;
    const spacing = r.type === 'primary' ? 38 : 48;
    let prevPole = null;
    const isOlderStreet = !r.name || /Cormiers|Peupliers|Chalumeau|Allard|Tilleuls|King/i.test(r.name);
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [x0, z0] = r.pts[i];
      const [x1, z1] = r.pts[i + 1];
      const segLen = Math.hypot(x1 - x0, z1 - z0);
      if (segLen < 1) continue;
      const ux = (x1 - x0) / segLen;
      const uz = (z1 - z0) / segLen;
      const nx = -uz, nz = ux;
      const roadAng = -Math.atan2(uz, ux);

      // Manhole covers & curbside storm drains
      if (segLen > 12 && Math.hypot(x0, z0) < 1020) {
        const mx = x0 + ux * (segLen * 0.5) + nx * (rand() < 0.5 ? 0.4 : -0.4);
        const mz = z0 + uz * (segLen * 0.5) + nz * (rand() < 0.5 ? 0.4 : -0.4);
        manholePlacements.push([mx, mz]);
        const dSgn = rand() < 0.5 ? 1 : -1;
        drainPlacements.push([
          x0 + ux * (segLen * 0.35) + nx * dSgn * ((r.width || 7) * 0.5 - 0.35),
          z0 + uz * (segLen * 0.35) + nz * dSgn * ((r.width || 7) * 0.5 - 0.35),
          roadAng,
        ]);
      }

      // Curbside weeds along older residential streets (tar/patch repairs are baked into asphaltTex)
      for (let pd = 6; pd < segLen - 4; pd += 18) {
        if (isOlderStreet && rand() < 0.35) {
          const wSgn = rand() < 0.5 ? 1 : -1;
          const wx = x0 + ux * pd + nx * wSgn * ((r.width || 7) * 0.5 + 0.08);
          const wz = z0 + uz * pd + nz * wSgn * ((r.width || 7) * 0.5 + 0.08);
          if (Math.hypot(wx, wz) < 1020) {
            curbWeedPlacements.push([wx, wz, 0.55 + rand() * 0.45, rand() < 0.30 ? 1 : 0]);
          }
        }
      }

      let d = i === 0 ? 18 : (spacing - (accum % spacing)) % spacing;
      while (d < segLen) {
        const px = x0 + ux * d + nx * (r.width * 0.5 + 1.1);
        const pz = z0 + uz * d + nz * (r.width * 0.5 + 1.1);
        const tooClose = polePlacements.some((o) => Math.hypot(px - o.x, pz - o.z) < 28);
        if (Math.hypot(px, pz) < 1030 && !tooClose) {
          const curPole = { x: px, z: pz, outX: nx, outZ: nz, ry: -Math.atan2(nz, nx), elev: sampleElevation(px, pz, elevData) };
          polePlacements.push(curPole);
          if (prevPole && Math.hypot(curPole.x - prevPole.x, curPole.z - prevPole.z) < 62) {
            // 3 parallel/sagging overhead cables between consecutive poles
            for (const wOff of [-0.72, 0.0, 0.72]) {
              const ax = prevPole.x + prevPole.outX * wOff * 0.25 - prevPole.outZ * wOff;
              const ay = prevPole.elev + (wOff === 0 ? 8.15 : 8.38);
              const az = prevPole.z + prevPole.outZ * wOff * 0.25 + prevPole.outX * wOff;
              const bx = curPole.x + curPole.outX * wOff * 0.25 - curPole.outZ * wOff;
              const by = curPole.elev + (wOff === 0 ? 8.15 : 8.38);
              const bz = curPole.z + curPole.outZ * wOff * 0.25 + curPole.outX * wOff;
              const sag = wOff === 0 ? 0.55 : 0.38;
              const segs = 4;
              for (let s = 0; s < segs; s++) {
                const t0 = s / segs, t1 = (s + 1) / segs;
                const sag0 = sag * 4 * t0 * (1 - t0);
                const sag1 = sag * 4 * t1 * (1 - t1);
                wireSegments.push(
                  ax + (bx - ax) * t0, ay + (by - ay) * t0 - sag0, az + (bz - az) * t0,
                  ax + (bx - ax) * t1, ay + (by - ay) * t1 - sag1, az + (bz - az) * t1
                );
              }
            }
          }
          prevPole = curPole;
          if (polePlacements.length % 2 === 0) {
            hydrantPlacements.push({ x: px - nx * 0.35, z: pz - nz * 0.35 });
          }
        }
        d += spacing;
      }
      accum += segLen;
    }
  }
  // Angled overhead drop wires from utility poles to nearby house eaves
  for (let i = 0; i < polePlacements.length; i++) {
    const p = polePlacements[i];
    let bestB = null, bestD = 26;
    for (let j = 0; j < DATA.buildings.length; j++) {
      const b = DATA.buildings[j];
      if (b.style === 'garage_shed') continue;
      const d = Math.hypot(b.obbCx - p.x, b.obbCz - p.z);
      if (d < bestD) { bestD = d; bestB = b; }
    }
    if (bestB) {
      const bElev = sampleElevation(bestB.obbCx, bestB.obbCz, elevData);
      const eaveY = bElev + (bestB.style === 'cottage_2s' ? 5.6 : 3.8);
      wireSegments.push(p.x, p.elev + 7.9, p.z, bestB.obbCx, eaveY, bestB.obbCz);
    }
  }

  if (wireSegments.length > 0) {
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wireSegments, 3));
    const wireLines = new THREE.LineSegments(
      wireGeo,
      new THREE.LineBasicMaterial({ color: 0x1d2228, transparent: true, opacity: 0.65 })
    );
    scene.add(wireLines);
  }

  // Instantiate manhole covers, storm drains, asphalt repair patches & curbside weeds
  if (manholePlacements.length > 0) {
    const manholeInst = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.45, 0.45, 0.04, 10),
      new THREE.MeshStandardMaterial({ color: 0x3b3f44, metalness: 0.6, roughness: 0.55 }),
      manholePlacements.length
    );
    manholePlacements.forEach(([x, z], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev + 0.055, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      manholeInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(manholeInst);
  }
  if (drainPlacements.length > 0) {
    const drainInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.68, 0.04, 0.44),
      new THREE.MeshStandardMaterial({ color: 0x2c3035, metalness: 0.55, roughness: 0.6 }),
      drainPlacements.length
    );
    drainPlacements.forEach(([x, z, ry], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev + 0.055, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      drainInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(drainInst);
  }
  if (curbWeedPlacements.length > 0) {
    const cwInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.18, 0.20, 0.18),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 }),
      curbWeedPlacements.length
    );
    const col = new THREE.Color();
    curbWeedPlacements.forEach(([x, z, sc, isDandelion], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev + 0.12 * sc, z);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      cwInst.setMatrixAt(i, dummy.matrix);
      col.setHex(isDandelion ? 0xf5d63d : 0x5c9c42);
      cwInst.setColorAt(i, col);
    });
    if (cwInst.instanceColor) cwInst.instanceColor.needsUpdate = true;
    scene.add(cwInst);
    registerWinterToggle((isWinter) => {
      cwInst.visible = !isWinter;
    });
  }

  let lampBulbMesh = null;
  if (polePlacements.length > 0) {
    const woodPoleMat = new THREE.MeshStandardMaterial({
      map: texLib.poleWoodTex || texLib.barkTex,
      color: 0xffffff,
      roughness: 0.92,
    });
    const metalArmMat = new THREE.MeshStandardMaterial({ color: 0x9aa2aa, metalness: 0.65, roughness: 0.35 });
    const poleInst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 8.8, 0.24), woodPoleMat, polePlacements.length);
    const armInst = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.1, 0.1), metalArmMat, polePlacements.length);
    const crossInst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 1.9), woodPoleMat, polePlacements.length);
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff0c2, emissive: 0xffc864, emissiveIntensity: 0.05 });
    lampBulbMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.12, 0.25), bulbMat, polePlacements.length);

    const transformerPoles = polePlacements.filter((_, idx) => idx % 3 === 0);
    const guyPoles = polePlacements.filter((_, idx) => idx % 4 === 0);
    const transformerInst = transformerPoles.length > 0
      ? new THREE.InstancedMesh(
          new THREE.CylinderGeometry(0.26, 0.26, 0.85, 8),
          new THREE.MeshStandardMaterial({ color: 0x7d848b, metalness: 0.4, roughness: 0.55 }),
          transformerPoles.length
        )
      : null;
    const guyGuardInst = guyPoles.length > 0
      ? new THREE.InstancedMesh(
          new THREE.BoxGeometry(0.10, 2.3, 0.10),
          new THREE.MeshStandardMaterial({ color: 0xf2c929, roughness: 0.5 }),
          guyPoles.length
        )
      : null;

    polePlacements.forEach((p, i) => {
      const elev = sampleElevation(p.x, p.z, elevData);
      dummy.position.set(p.x, elev + 4.4, p.z);
      dummy.rotation.set(0, p.ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poleInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(p.x, elev + 8.4, p.z);
      dummy.updateMatrix();
      crossInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(p.x - p.outX * 0.95, elev + 7.2, p.z - p.outZ * 0.95);
      dummy.updateMatrix();
      armInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(p.x - p.outX * 1.95, elev + 7.12, p.z - p.outZ * 1.95);
      dummy.updateMatrix();
      lampBulbMesh.setMatrixAt(i, dummy.matrix);
    });
    if (transformerInst) {
      transformerPoles.forEach((p, i) => {
        dummy.position.set(p.x + p.outX * 0.32, p.elev + 6.45, p.z + p.outZ * 0.32);
        dummy.rotation.set(0, p.ry, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        transformerInst.setMatrixAt(i, dummy.matrix);
      });
      scene.add(transformerInst);
    }
    if (guyGuardInst) {
      guyPoles.forEach((p, i) => {
        dummy.position.set(p.x + p.outX * 0.85, p.elev + 1.05, p.z + p.outZ * 0.85);
        dummy.rotation.set(0, p.ry, -0.35);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        guyGuardInst.setMatrixAt(i, dummy.matrix);
      });
      scene.add(guyGuardInst);
    }
    scene.add(poleInst, crossInst, armInst, lampBulbMesh);
  }

  if (hydrantPlacements.length > 0) {
    const hydInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.28, 0.72, 0.28),
      new THREE.MeshStandardMaterial({ color: 0xd12626, roughness: 0.45 }),
      hydrantPlacements.length
    );
    hydrantPlacements.forEach((h, i) => {
      const elev = sampleElevation(h.x, h.z, elevData);
      dummy.position.set(h.x, elev + 0.36, h.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      hydInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(hydInst);
  }

  // Quebec ARRÊT Stop Signs + Blue Street-Name Blades (DATA.stops) — double-faced BoxGeometry so never mirrored
  if (DATA.stops.length > 0) {
    const postInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.08, 2.7, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x9aa2a8, metalness: 0.65, roughness: 0.4 }),
      DATA.stops.length
    );
    const signEdgeMat = new THREE.MeshStandardMaterial({ color: 0x6c7278, metalness: 0.5, roughness: 0.5 });
    const signFaceMat = new THREE.MeshStandardMaterial({ map: texLib.arretTex, transparent: true, alphaTest: 0.4 });
    const signInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.75, 0.75, 0.04),
      [signEdgeMat, signEdgeMat, signEdgeMat, signEdgeMat, signFaceMat, signFaceMat],
      DATA.stops.length
    );
    const bladeInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.92, 0.20, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x0e4d92, roughness: 0.45 }),
      DATA.stops.length
    );
    DATA.stops.forEach((st, i) => {
      let sx, sz, ry;
      if (st.x >= 96 && st.x <= 105 && st.z >= 17 && st.z <= 25) {
        sx = 94.5;
        sz = 26.2;
        ry = Math.PI / 2;
      } else {
        const ux = Math.cos(st.angle), uz = Math.sin(st.angle);
        const nx = -uz, nz = ux;
        sx = st.x - ux * 5.5 - nx * 4.2;
        sz = st.z - ux * 5.5 * 0 - uz * 5.5 - nz * 4.2;
        ry = -st.angle + Math.PI / 2;
      }
      const elev = sampleElevation(sx, sz, elevData);
      dummy.position.set(sx, elev + 1.35, sz);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      postInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(sx, elev + 2.15, sz);
      dummy.updateMatrix();
      signInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(sx, elev + 2.66, sz);
      dummy.updateMatrix();
      bladeInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(postInst, signInst, bladeInst);
  }

  // STS Bus Stop Signs + Benches & Trash/Recycling Bins
  if (DATA.busStops.length > 0) {
    const bsInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.08, 2.4, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x16539e, roughness: 0.4 }),
      DATA.busStops.length
    );
    const bsHead = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.45, 0.62, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x0c63c4, roughness: 0.45 }),
      DATA.busStops.length
    );
    const bsBenchGeo = mergeGeometries([
      (() => { const g = new THREE.BoxGeometry(1.6, 0.08, 0.48); g.translate(0, 0.46, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(1.6, 0.42, 0.08); g.translate(0, 0.72, -0.22); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.10, 0.46, 0.44); g.translate(-0.68, 0.23, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.10, 0.46, 0.44); g.translate(0.68, 0.23, 0); return g; })(),
    ]);
    const bsBenchInst = new THREE.InstancedMesh(
      bsBenchGeo,
      new THREE.MeshStandardMaterial({ color: 0x6e543c, roughness: 0.85 }),
      DATA.busStops.length
    );
    const bsBinInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.45, 0.78, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x225a38, roughness: 0.7 }),
      DATA.busStops.length
    );
    DATA.busStops.forEach((bs, i) => {
      const elev = sampleElevation(bs.x, bs.z, elevData);
      dummy.position.set(bs.x, elev + 1.2, bs.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bsInst.setMatrixAt(i, dummy.matrix);
      dummy.position.set(bs.x, elev + 2.25, bs.z);
      dummy.updateMatrix();
      bsHead.setMatrixAt(i, dummy.matrix);

      dummy.position.set(bs.x + 1.35, elev, bs.z + 0.35);
      dummy.updateMatrix();
      bsBenchInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(bs.x - 0.85, elev + 0.39, bs.z + 0.25);
      dummy.updateMatrix();
      bsBinInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(bsInst, bsHead, bsBenchInst, bsBinInst);
  }

  // No-Parking & Zone Scolaire 30 Signs along Rue du Chalumeau, Rue des Peupliers, and Rue Allard
  const streetSigns = [];
  for (const r of DATA.roads) {
    if (!r.name) continue;
    const isSchoolSt = /Chalumeau/i.test(r.name);
    const isNoParkSt = /Peupliers|Allard|Chalumeau/i.test(r.name);
    if (!isSchoolSt && !isNoParkSt) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [x0, z0] = r.pts[i], [x1, z1] = r.pts[i + 1];
      const segLen = Math.hypot(x1 - x0, z1 - z0);
      if (segLen < 18) continue;
      const ux = (x1 - x0) / segLen, uz = (z1 - z0) / segLen;
      const nx = -uz, nz = ux;
      const d = segLen * 0.45;
      const sgn = i % 2 === 0 ? 1 : -1;
      const sx = x0 + ux * d + nx * sgn * ((r.width || 7) * 0.5 + 0.75);
      const sz = z0 + uz * d + nz * sgn * ((r.width || 7) * 0.5 + 0.75);
      if (Math.hypot(sx, sz) < 1030) {
        streetSigns.push({
          x: sx,
          z: sz,
          ry: -Math.atan2(uz, ux),
          isSchool: isSchoolSt && i % 2 === 0,
        });
      }
    }
  }
  if (streetSigns.length > 0) {
    const ssPost = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.06, 2.45, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x9aa2a8, metalness: 0.65, roughness: 0.4 }),
      streetSigns.length
    );
    const noParkSigns = streetSigns.filter((s) => !s.isSchool);
    const schoolSigns = streetSigns.filter((s) => s.isSchool);
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.5 });

    streetSigns.forEach((s, i) => {
      const elev = sampleElevation(s.x, s.z, elevData);
      dummy.position.set(s.x, elev + 1.22, s.z);
      dummy.rotation.set(0, s.ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      ssPost.setMatrixAt(i, dummy.matrix);
    });
    scene.add(ssPost);

    if (noParkSigns.length > 0) {
      const npMat = new THREE.MeshStandardMaterial({ map: texLib.noParkingTex || texLib.arretTex, transparent: true, alphaTest: 0.4 });
      const npInst = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.45, 0.60, 0.04),
        [edgeMat, edgeMat, edgeMat, edgeMat, npMat, npMat],
        noParkSigns.length
      );
      noParkSigns.forEach((s, i) => {
        const elev = sampleElevation(s.x, s.z, elevData);
        dummy.position.set(s.x, elev + 2.15, s.z);
        dummy.rotation.set(0, s.ry, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        npInst.setMatrixAt(i, dummy.matrix);
      });
      scene.add(npInst);
    }
    if (schoolSigns.length > 0) {
      const scMat = new THREE.MeshStandardMaterial({ map: texLib.schoolZoneTex || texLib.arretTex, transparent: true, alphaTest: 0.4 });
      const scInst = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.55, 0.68, 0.04),
        [edgeMat, edgeMat, edgeMat, edgeMat, scMat, scMat],
        schoolSigns.length
      );
      schoolSigns.forEach((s, i) => {
        const elev = sampleElevation(s.x, s.z, elevData);
        dummy.position.set(s.x, elev + 2.15, s.z);
        dummy.rotation.set(0, s.ry, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        scInst.setMatrixAt(i, dummy.matrix);
      });
      scene.add(scInst);
    }
  }

  // Parked Scooters near Dépanneur Galvin, Parc Gilles-Charland, Rue King Est, and residential driveways
  const scooterCoords = [
    [-198, -225, 0.4], [-196.8, -224.2, 0.2], // Parc Gilles-Charland
    [258, 212, -0.1], [259.2, 212.2, 0.0],   // École de la Samare
    [-742, -772, 0.6], [-740.5, -771, 0.5],  // Rue King Est
    [-462, -498, -0.3], [-460.8, -497, -0.2], // Ch. Galvin / Dépanneur area
  ];
  for (const b of DATA.buildings) {
    if (!b.driveway || b.style === 'garage_shed' || rand() > 0.08) continue;
    const [dx0, dz0, dx1, dz1] = b.driveway;
    scooterCoords.push([dx0 + (dx1 - dx0) * 0.25, dz0 + (dz1 - dz0) * 0.25, -b.ang]);
  }
  if (scooterCoords.length > 0) {
    const scGeo = mergeGeometries([
      (() => { const g = new THREE.BoxGeometry(0.85, 0.12, 0.22); g.translate(0, 0.18, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.10, 0.78, 0.10); g.translate(0.35, 0.56, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.08, 0.08, 0.44); g.translate(0.35, 0.94, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.24, 0.24, 0.12); g.translate(-0.34, 0.12, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.24, 0.24, 0.12); g.translate(0.34, 0.12, 0); return g; })(),
    ]);
    const scooterInst = new THREE.InstancedMesh(
      scGeo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.4, roughness: 0.45 }),
      scooterCoords.length
    );
    const scCols = [0xe23636, 0x2a76d2, 0xf2b729, 0x2fb865, 0x282c32];
    const col = new THREE.Color();
    scooterCoords.forEach(([x, z, ry], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      scooterInst.setMatrixAt(i, dummy.matrix);
      col.setHex(scCols[i % scCols.length]);
      scooterInst.setColorAt(i, col);
    });
    if (scooterInst.instanceColor) scooterInst.instanceColor.needsUpdate = true;
    scene.add(scooterInst);
  }

  // --- E. Curated Lawns, Foundation Mulch Beds, Hostas, Hydrangeas & Backyard Life ---
  const grassPositions = [];
  const flowerPositions = [];
  const shrubPositions = [];
  const hostaPositions = [];
  const hydrangeaPositions = [];
  const lilacPositions = [];
  const foundBeds = [];
  const patioUmbrellas = [];
  const trampolines = [];
  const gardenBeds = [];
  const sidePavers = [];
  const mailboxes = [];
  const bbqGrills = [];
  const firePits = [];
  const backyardSwings = [];
  const clotheslines = [];
  const deckChairs = [];
  const treeMulchBeds = [];
  const birdbaths = [];
  const trellises = [];

  // Subtle variegated hosta rings around fire hydrants (like Rue des Cormiers / Rue des Peupliers)
  for (let i = 0; i < hydrantPlacements.length; i++) {
    if (i % 2 !== 0) continue;
    const h = hydrantPlacements[i];
    for (let k = 0; k < 4; k++) {
      const ang = (k / 4) * Math.PI * 2 + 0.4;
      hostaPositions.push([h.x + Math.cos(ang) * 0.42, h.z + Math.sin(ang) * 0.42, 0.72]);
    }
  }

  for (const b of DATA.buildings) {
    if (HERO_SKIP_IDS.has(b.id) || b.style === 'commercial' || b.style === 'apartments') continue;
    const fx = Math.cos(b.ang), fz = Math.sin(b.ang);
    const sx = -fz, sz = fx;

    // Front dark-mulch foundation garden beds with hostas, shrubs, hydrangeas & occasional purple lilac
    if (b.style !== 'garage_shed' && rand() < 0.82) {
      let garSide = (b.cidx % 2 === 0) ? -1 : 1;
      if (b.driveway) {
        const dSide = (b.driveway[0] - b.obbCx) * sx + (b.driveway[1] - b.obbCz) * sz;
        garSide = dSide >= 0 ? 1 : -1;
      }
      const bedSide = -garSide;
      const bedW = Math.min(5.2, Math.max(2.4, b.w * 0.42));
      const fbx = b.obbCx + fx * (b.d * 0.5 + 0.75) + sx * (bedSide * b.w * 0.24);
      const fbz = b.obbCz + fz * (b.d * 0.5 + 0.75) + sz * (bedSide * b.w * 0.24);
      if (Math.hypot(fbx, fbz) < 1040 && isClearForProp(fbx, fbz, 0.4, false)) {
        foundBeds.push([fbx, fbz, -b.ang, 1.35, bedW]);
        // Hosta mounds + neat shrubs + hydrangea cluster inside mulch bed
        for (let k = -1; k <= 1; k++) {
          const px = fbx + sx * (k * bedW * 0.30);
          const pz = fbz + sz * (k * bedW * 0.30);
          if (k === 0 && rand() < 0.65) {
            hydrangeaPositions.push([px, pz, 0.8 + rand() * 0.3, Math.floor(rand() * 3)]);
          } else if (rand() < 0.78) {
            hostaPositions.push([px, pz, 0.85 + rand() * 0.3]);
          } else {
            shrubPositions.push([px, pz, 0.68 + rand() * 0.28]);
          }
        }
      }
      // Corner purple lilac bush on ~15% of front lawns
      if (rand() < 0.15) {
        const lx = b.obbCx + fx * (b.d * 0.5 + 2.6) + sx * (bedSide * (b.w * 0.48 + 0.8));
        const lz = b.obbCz + fz * (b.d * 0.5 + 2.6) + sz * (bedSide * (b.w * 0.48 + 0.8));
        if (Math.hypot(lx, lz) < 1030 && isClearForProp(lx, lz, 0.9, true)) {
          lilacPositions.push([lx, lz, 0.82 + rand() * 0.35]);
        }
      }
    }

    // Side-yard details in the spaces between houses (stepping stones, neat shrubs)
    if (b.driveway && b.style !== 'garage_shed') {
      const sideSgn = (b.cidx % 2 === 0) ? 1 : -1;
      const sideDist = b.w * 0.5 + 1.55 + rand() * 1.05;
      if (rand() < 0.78) {
        for (let stepU = -b.d * 0.42; stepU <= b.d * 0.42; stepU += 1.25) {
          const px = b.obbCx + fx * stepU + sx * (sideSgn * sideDist);
          const pz = b.obbCz + fz * stepU + sz * (sideSgn * sideDist);
          if (Math.hypot(px, pz) < 1030 && isClearForProp(px, pz, 0.5, true)) sidePavers.push([px, pz, -b.ang]);
        }
      }
      for (const sSide of [-1, 1]) {
        if (rand() < 0.75) {
          const count = rand() < 0.45 ? 2 : 1;
          for (let k = 0; k < count; k++) {
            const shx = b.obbCx + fx * ((rand() - 0.5) * b.d * 0.75) + sx * (sSide * (b.w * 0.5 + 0.95 + rand() * 0.5));
            const shz = b.obbCz + fz * ((rand() - 0.5) * b.d * 0.75) + sz * (sSide * (b.w * 0.5 + 0.95 + rand() * 0.5));
            if (Math.hypot(shx, shz) < 1030 && isClearForProp(shx, shz, 0.65, true)) {
              shrubPositions.push([shx, shz, 0.74 + rand() * 0.45]);
            }
          }
        }
      }

      // Curbside mailbox tucked safely 1.8m–2.3m back on residential lawn beside driveway (never in roadway!)
      if (rand() < 0.48) {
        const [x0, z0, x1, z1, dw] = b.driveway;
        const dLen = Math.hypot(x1 - x0, z1 - z0) || 1;
        const uBx = (x0 - x1) / dLen;
        const uBz = (z0 - z1) / dLen;
        const dNx = -uBz;
        const dNz = uBx;
        const mSide = (b.cidx % 2 === 0 ? 1 : -1);
        const mx = x1 + uBx * 2.15 + dNx * mSide * ((dw || 3.4) * 0.5 + 0.75);
        const mz = z1 + uBz * 2.15 + dNz * mSide * ((dw || 3.4) * 0.5 + 0.75);
        if (Math.hypot(mx, mz) < 1030 && isClearForProp(mx, mz, 0.85, true)) {
          mailboxes.push([mx, mz, -b.ang]);
        }
      }

      // Backyard patio umbrella, BBQ grill, fire pit, deck chairs, kids' swing set, clothesline, trampoline & raised garden bed
      if (b.style !== 'modular') {
        const patioSgn = (b.cidx % 2 === 0 ? 1 : -1);
        if (rand() < 0.34) {
          const ux = b.obbCx - fx * (b.d * 0.5 + 2.2) + sx * (patioSgn * b.w * 0.16);
          const uz = b.obbCz - fz * (b.d * 0.5 + 2.2) + sz * (patioSgn * b.w * 0.16);
          if (Math.hypot(ux, uz) < 1020) patioUmbrellas.push([ux, uz]);
        }
        if (rand() < 0.42) {
          const bx = b.obbCx - fx * (b.d * 0.5 + 1.4) + sx * (patioSgn * b.w * 0.28);
          const bz = b.obbCz - fz * (b.d * 0.5 + 1.4) + sz * (patioSgn * b.w * 0.28);
          if (Math.hypot(bx, bz) < 1020) bbqGrills.push([bx, bz, -b.ang]);
        }
        if (rand() < 0.22) {
          const fpx = b.obbCx - fx * (b.d * 0.5 + 7.2) - sx * (patioSgn * b.w * 0.15);
          const fpz = b.obbCz - fz * (b.d * 0.5 + 7.2) - sz * (patioSgn * b.w * 0.15);
          if (Math.hypot(fpx, fpz) < 1020 && isClearForProp(fpx, fpz, 0.8, true)) firePits.push([fpx, fpz]);
        }
        if (rand() < 0.36) {
          for (const cOff of [-0.65, 0.65]) {
            const dcx = b.obbCx - fx * (b.d * 0.5 + 2.5) + sx * (patioSgn * b.w * 0.08 + cOff);
            const dcz = b.obbCz - fz * (b.d * 0.5 + 2.5) + sz * (patioSgn * b.w * 0.08 + cOff);
            if (Math.hypot(dcx, dcz) < 1020) deckChairs.push([dcx, dcz, -b.ang + Math.PI]);
          }
        }
        if (rand() < 0.18) {
          const swx = b.obbCx - fx * (b.d * 0.5 + 9.2) - sx * (patioSgn * b.w * 0.22);
          const swz = b.obbCz - fz * (b.d * 0.5 + 9.2) - sz * (patioSgn * b.w * 0.22);
          if (Math.hypot(swx, swz) < 1020 && isClearForProp(swx, swz, 1.4, true)) backyardSwings.push([swx, swz, -b.ang]);
        }
        if (rand() < 0.20) {
          const clx = b.obbCx - fx * (b.d * 0.5 + 5.6) + sx * (patioSgn * b.w * 0.32);
          const clz = b.obbCz - fz * (b.d * 0.5 + 5.6) + sz * (patioSgn * b.w * 0.32);
          if (Math.hypot(clx, clz) < 1020 && isClearForProp(clx, clz, 1.0, true)) clotheslines.push([clx, clz, -b.ang]);
        }
        if (rand() < 0.12) {
          const tx = b.obbCx - fx * (b.d * 0.5 + 8.5) - sx * (patioSgn * b.w * 0.25);
          const tz = b.obbCz - fz * (b.d * 0.5 + 8.5) - sz * (patioSgn * b.w * 0.25);
          if (Math.hypot(tx, tz) < 1020 && isClearForProp(tx, tz, 1.8, true)) trampolines.push([tx, tz]);
        }
        if (rand() < 0.28) {
          const gx = b.obbCx - fx * (b.d * 0.5 + 6.2) + sx * ((rand() - 0.5) * b.w * 0.5);
          const gz = b.obbCz - fz * (b.d * 0.5 + 6.2) + sz * ((rand() - 0.5) * b.w * 0.5);
          if (Math.hypot(gx, gz) < 1020 && isClearForProp(gx, gz, 0.9, true)) gardenBeds.push([gx, gz, -b.ang]);
        }
        if (rand() < 0.16) {
          const bbx = b.obbCx + fx * (b.d * 0.5 + 3.8) - sx * (patioSgn * b.w * 0.22);
          const bbz = b.obbCz + fz * (b.d * 0.5 + 3.8) - sz * (patioSgn * b.w * 0.22);
          if (Math.hypot(bbx, bbz) < 1025 && isClearForProp(bbx, bbz, 0.8, true)) birdbaths.push([bbx, bbz]);
        }
        if (rand() < 0.22) {
          const trx = b.obbCx - fx * (b.d * 0.5 + 0.6) - sx * (patioSgn * b.w * 0.34);
          const trz = b.obbCz - fz * (b.d * 0.5 + 0.6) - sz * (patioSgn * b.w * 0.34);
          if (Math.hypot(trx, trz) < 1025 && isClearForProp(trx, trz, 0.5, false)) trellises.push([trx, trz, -b.ang]);
        }
      }
    }
  }

  // Instantiate backyard patio umbrellas, trampolines, raised garden beds, side pavers & mailboxes
  if (patioUmbrellas.length > 0) {
    const uPole = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.10, 2.35, 0.10),
      new THREE.MeshStandardMaterial({ color: 0xd0d4d8, roughness: 0.5 }),
      patioUmbrellas.length
    );
    const uTop = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.45, 0.55, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 }),
      patioUmbrellas.length
    );
    const uCols = [0xc93838, 0x2a66a8, 0xd99b26, 0x2e7d4f, 0xe8e2d5];
    const col = new THREE.Color();
    patioUmbrellas.forEach(([x, z], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev + 1.4, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      uPole.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, elev + 2.55, z);
      dummy.updateMatrix();
      uTop.setMatrixAt(i, dummy.matrix);
      col.setHex(uCols[i % uCols.length]);
      uTop.setColorAt(i, col);
    });
    if (uTop.instanceColor) uTop.instanceColor.needsUpdate = true;
    scene.add(uPole, uTop);
  }
  if (trampolines.length > 0) {
    const trMat = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1.85, 1.85, 0.22, 16),
      new THREE.MeshStandardMaterial({ color: 0x214a8a, roughness: 0.7 }),
      trampolines.length
    );
    const trNet = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1.85, 1.85, 1.35, 16, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x1c2026, transparent: true, opacity: 0.42, side: THREE.DoubleSide }),
      trampolines.length
    );
    trampolines.forEach(([x, z], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev + 0.65, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      trMat.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, elev + 1.35, z);
      dummy.updateMatrix();
      trNet.setMatrixAt(i, dummy.matrix);
    });
    scene.add(trMat, trNet);
  }
  if (gardenBeds.length > 0) {
    const gbBox = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.3, 0.34, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x7a5c3e, roughness: 0.9 }),
      gardenBeds.length
    );
    const gbCrop = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.05, 0.28, 1.9),
      new THREE.MeshStandardMaterial({ map: texLib.leafDeciduousTex, color: 0x70b84c, roughness: 0.88 }),
      gardenBeds.length
    );
    gardenBeds.forEach(([x, z, ry], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev + 0.17, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      gbBox.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, elev + 0.36, z);
      dummy.updateMatrix();
      gbCrop.setMatrixAt(i, dummy.matrix);
    });
    scene.add(gbBox, gbCrop);
  }
  if (sidePavers.length > 0) {
    const pvInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.62, 0.08, 0.62),
      new THREE.MeshStandardMaterial({ map: texLib.concreteTex, color: 0xbcbeb8, roughness: 0.9 }),
      sidePavers.length
    );
    sidePavers.forEach(([x, z, ry], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev + 0.04, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      pvInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(pvInst);
  }
  if (mailboxes.length > 0) {
    const mbPost = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.10, 1.05, 0.10),
      new THREE.MeshStandardMaterial({ color: 0x5c4635, roughness: 0.9 }),
      mailboxes.length
    );
    const mbBox = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.42, 0.24, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x24282e, roughness: 0.55 }),
      mailboxes.length
    );
    mailboxes.forEach(([x, z, ry], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev + 0.52, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mbPost.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, elev + 1.10, z);
      dummy.updateMatrix();
      mbBox.setMatrixAt(i, dummy.matrix);
    });
    scene.add(mbPost, mbBox);
  }
  // Instantiate backyard BBQ grills, fire pits, kids' swing sets, clotheslines, deck chairs
  if (bbqGrills.length > 0) {
    const bbqBody = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.95, 0.92, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.5, metalness: 0.45 }),
      bbqGrills.length
    );
    const bbqLid = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.62, 0.28, 0.48),
      new THREE.MeshStandardMaterial({ color: 0xbcc4cc, roughness: 0.3, metalness: 0.75 }),
      bbqGrills.length
    );
    bbqGrills.forEach(([x, z, ry], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev + 0.46, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bbqBody.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, elev + 1.04, z);
      dummy.updateMatrix();
      bbqLid.setMatrixAt(i, dummy.matrix);
    });
    scene.add(bbqBody, bbqLid);
  }
  if (firePits.length > 0) {
    const fpRing = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.65, 0.72, 0.30, 8),
      new THREE.MeshStandardMaterial({ color: 0x7b7872, roughness: 0.92 }),
      firePits.length
    );
    const fpEmber = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.55, 0.16, 0.55),
      new THREE.MeshStandardMaterial({ color: 0xd94b1e, emissive: 0x6b1d05, roughness: 0.8 }),
      firePits.length
    );
    firePits.forEach(([x, z], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev + 0.15, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      fpRing.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, elev + 0.20, z);
      dummy.updateMatrix();
      fpEmber.setMatrixAt(i, dummy.matrix);
    });
    scene.add(fpRing, fpEmber);
  }
  if (deckChairs.length > 0) {
    const dcGeo = mergeGeometries([
      (() => { const g = new THREE.BoxGeometry(0.68, 0.38, 0.62); g.translate(0, 0.19, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.68, 0.56, 0.14); g.translate(0, 0.56, -0.24); return g; })(),
    ]);
    const dcInst = new THREE.InstancedMesh(
      dcGeo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 }),
      deckChairs.length
    );
    const dcCols = [0x2a66a8, 0xc93838, 0xe8e2d5, 0x2e7d4f, 0xd99b26];
    const col = new THREE.Color();
    deckChairs.forEach(([x, z, ry], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      dcInst.setMatrixAt(i, dummy.matrix);
      col.setHex(dcCols[i % dcCols.length]);
      dcInst.setColorAt(i, col);
    });
    if (dcInst.instanceColor) dcInst.instanceColor.needsUpdate = true;
    scene.add(dcInst);
  }
  if (backyardSwings.length > 0) {
    const swWoodGeo = mergeGeometries([
      (() => { const g = new THREE.BoxGeometry(0.14, 0.14, 3.2); g.translate(0, 2.25, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.12, 2.35, 0.12); g.translate(-0.65, 1.15, -1.5); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.12, 2.35, 0.12); g.translate(0.65, 1.15, -1.5); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.12, 2.35, 0.12); g.translate(-0.65, 1.15, 1.5); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.12, 2.35, 0.12); g.translate(0.65, 1.15, 1.5); return g; })(),
    ]);
    const swSeatGeo = mergeGeometries([
      (() => { const g = new THREE.BoxGeometry(0.28, 0.08, 0.48); g.translate(0, 0.65, -0.65); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.28, 0.08, 0.48); g.translate(0, 0.65, 0.65); return g; })(),
    ]);
    const swWoodInst = new THREE.InstancedMesh(
      swWoodGeo,
      new THREE.MeshStandardMaterial({ color: 0x8f6b48, roughness: 0.88 }),
      backyardSwings.length
    );
    const swSeatInst = new THREE.InstancedMesh(
      swSeatGeo,
      new THREE.MeshStandardMaterial({ color: 0xd6392c, roughness: 0.55 }),
      backyardSwings.length
    );
    backyardSwings.forEach(([x, z, ry], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      swWoodInst.setMatrixAt(i, dummy.matrix);
      swSeatInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(swWoodInst, swSeatInst);
  }
  if (clotheslines.length > 0) {
    const clGeo = mergeGeometries([
      (() => { const g = new THREE.BoxGeometry(0.08, 2.3, 0.08); g.translate(0, 1.15, -1.8); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.08, 2.3, 0.08); g.translate(0, 1.15, 1.8); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.95, 0.06, 0.06); g.translate(0, 2.25, -1.8); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.95, 0.06, 0.06); g.translate(0, 2.25, 1.8); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.03, 0.03, 3.6); g.translate(-0.35, 2.25, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.03, 0.03, 3.6); g.translate(0.35, 2.25, 0); return g; })(),
    ]);
    const clInst = new THREE.InstancedMesh(
      clGeo,
      new THREE.MeshStandardMaterial({ color: 0xb0b8c0, metalness: 0.55, roughness: 0.45 }),
      clotheslines.length
    );
    clotheslines.forEach(([x, z, ry], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      clInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(clInst);
  }

  const parkEdgeDirt = [];
  for (const pk of DATA.parks) {
    const [minX, maxX, minZ, maxZ] = polyBBox(pk.pts);
    for (let t = 0; t < 700; t++) {
      const tx = minX + rand() * (maxX - minX);
      const tz = minZ + rand() * (maxZ - minZ);
      if (!pointInPoly(tx, tz, pk.pts)) continue;
      if (DATA.pitches.some((p) => Math.hypot(tx - p.cx, tz - p.cz) < 22)) continue;
      grassPositions.push([tx, tz, 0.9 + rand() * 0.65]);
      if (rand() < 0.42) flowerPositions.push([tx + 0.4, tz - 0.3]);
    }
    for (let i = 0; i < pk.pts.length; i += 2) {
      const [px, pz] = pk.pts[i];
      if (Math.hypot(px, pz) < 1040) parkEdgeDirt.push([px, pz, rand() * Math.PI]);
    }
  }
  if (parkEdgeDirt.length > 0) {
    const pedInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.6, 0.05, 1.1),
      new THREE.MeshStandardMaterial({
        map: texLib.dirtPathTex || texLib.concreteTex,
        color: 0x826d56,
        roughness: 0.96,
      }),
      parkEdgeDirt.length
    );
    parkEdgeDirt.forEach(([x, z, ry], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev + 0.04, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(0.8 + rand() * 0.7, 1, 0.8 + rand() * 0.7);
      dummy.updateMatrix();
      pedInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(pedInst);
    registerWinterToggle((isWinter) => {
      pedInst.visible = !isWinter;
    });
  }
  const woodBoxes = DATA.woods.map((pts) => ({ pts, bbox: polyBBox(pts) }));
  for (const wb of woodBoxes) {
    const [minX, maxX, minZ, maxZ] = wb.bbox;
    const cx0 = Math.max(minX, -1040), cx1 = Math.min(maxX, 1040);
    const cz0 = Math.max(minZ, -1040), cz1 = Math.min(maxZ, 1040);
    if (cx0 >= cx1 || cz0 >= cz1) continue;
    for (let t = 0; t < 260; t++) {
      const tx = cx0 + rand() * (cx1 - cx0);
      const tz = cz0 + rand() * (cz1 - cz0);
      if (pointInPoly(tx, tz, wb.pts)) {
        grassPositions.push([tx, tz, 1.0 + rand() * 0.7]);
      }
    }
  }
  if (birdbaths.length > 0) {
    const bbGeo = mergeGeometries([
      (() => { const g = new THREE.CylinderGeometry(0.12, 0.18, 0.72, 8); g.translate(0, 0.36, 0); return g; })(),
      (() => { const g = new THREE.CylinderGeometry(0.42, 0.30, 0.12, 10); g.translate(0, 0.76, 0); return g; })(),
    ]);
    const bbInst = new THREE.InstancedMesh(
      bbGeo,
      new THREE.MeshStandardMaterial({ map: texLib.concreteTex, color: 0xd8dcd8, roughness: 0.85 }),
      birdbaths.length
    );
    birdbaths.forEach(([x, z], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bbInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(bbInst);
  }
  if (trellises.length > 0) {
    const trGeo = mergeGeometries([
      (() => { const g = new THREE.BoxGeometry(0.08, 2.05, 0.08); g.translate(0, 1.02, -0.55); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.08, 2.05, 0.08); g.translate(0, 1.02, 0.55); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.06, 0.08, 1.25); g.translate(0, 1.95, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.06, 0.08, 1.15); g.translate(0, 1.35, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.06, 0.08, 1.15); g.translate(0, 0.75, 0); return g; })(),
    ]);
    const trInst = new THREE.InstancedMesh(
      trGeo,
      new THREE.MeshStandardMaterial({ color: 0x8e7052, roughness: 0.88 }),
      trellises.length
    );
    trellises.forEach(([x, z, ry], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      trInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(trInst);
  }

  // Forest-floor moss & sparse woodland tufts in Parc Walter-Camden, woods & park margins (~20% subtle density)
  for (let t = 0; t < 160; t++) {
    const tx = 195 + rand() * 485;
    const tz = 312 + rand() * 368;
    if (!DATA.pitches.some((p) => Math.hypot(tx - p.cx, tz - p.cz) < 28) && isClearForProp(tx, tz, 1.0, true)) {
      grassPositions.push([tx, tz, 1.0 + rand() * 0.65]);
    }
  }

  // Subtle sparse verge tufts & roadside dandelions along rural/wooded ditches
  const targetSubdivPattern = /Diamants|Rubis|Topazes|Mélèzes|Frênes|Tilleuls|Bureau|Huot|Pelland/i;
  for (const r of DATA.roads) {
    if (r.type !== 'residential' && r.type !== 'tertiary') continue;
    const isPriority = r.name && targetSubdivPattern.test(r.name);
    const stepD = isPriority ? 18 : 34;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [x0, z0] = r.pts[i], [x1, z1] = r.pts[i + 1];
      const segLen = Math.hypot(x1 - x0, z1 - z0);
      if (segLen < 8) continue;
      const ux = (x1 - x0) / segLen, uz = (z1 - z0) / segLen;
      const nx = -uz, nz = ux;
      for (let d = 5; d < segLen - 5; d += stepD) {
        if (rand() > 0.45) continue;
        const sgn = rand() < 0.5 ? -1 : 1;
        const vx = x0 + ux * d + nx * sgn * ((r.width || 7) * 0.5 + 2.4 + rand() * 1.4);
        const vz = z0 + uz * d + nz * sgn * ((r.width || 7) * 0.5 + 2.4 + rand() * 1.4);
        if (Math.hypot(vx, vz) > 1030) continue;
        grassPositions.push([vx, vz, 0.85 + rand() * 0.45]);
        if (rand() < 0.25) flowerPositions.push([vx + (rand() - 0.5) * 0.6, vz + (rand() - 0.5) * 0.6]);
      }
    }
  }

  const inCharlandCore = (x, z) => x >= -260 && x <= -120 && z >= -340 && z <= -174;
  const cleanGrass = grassPositions.filter(([x, z]) => !inCharlandCore(x, z) && isClearForProp(x, z, 1.1, true));
  const cleanFlowers = flowerPositions.filter(([x, z]) => !inCharlandCore(x, z) && isClearForProp(x, z, 1.1, true));

  // Instantiate curated dark-mulch foundation beds, variegated hostas, hydrangeas & purple lilacs
  if (foundBeds.length > 0) {
    const fbInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.08, 1),
      new THREE.MeshStandardMaterial({ map: texLib.mulchTex || texLib.barkTex, color: 0xffffff, roughness: 0.96 }),
      foundBeds.length
    );
    foundBeds.forEach(([x, z, ry, dBed, wBed], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev + 0.04, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(dBed, 1, wBed);
      dummy.updateMatrix();
      fbInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(fbInst);
    registerWinterToggle((isWinter) => {
      fbInst.visible = !isWinter;
    });
  }

  if (hostaPositions.length > 0) {
    const hLeafGeo = mergeGeometries([
      (() => { const g = new THREE.BoxGeometry(0.46, 0.16, 0.46); g.translate(0, 0.08, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.30, 0.18, 0.30); g.translate(0.12, 0.12, -0.08); return g; })(),
    ]);
    const hCenterGeo = new THREE.BoxGeometry(0.20, 0.20, 0.20);
    hCenterGeo.translate(0, 0.14, 0);
    const hLeafInst = new THREE.InstancedMesh(
      hLeafGeo,
      new THREE.MeshStandardMaterial({ map: texLib.leafDeciduousTex, color: 0x62a844, roughness: 0.88 }),
      hostaPositions.length
    );
    const hCenterInst = new THREE.InstancedMesh(
      hCenterGeo,
      new THREE.MeshStandardMaterial({ color: 0xdcebb0, roughness: 0.85 }),
      hostaPositions.length
    );
    hostaPositions.forEach(([x, z, sc], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev, z);
      dummy.rotation.set(0, i * 0.9, 0);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      hLeafInst.setMatrixAt(i, dummy.matrix);
      hCenterInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(hLeafInst, hCenterInst);
    registerWinterToggle((isWinter) => {
      hLeafInst.visible = !isWinter;
      hCenterInst.visible = !isWinter;
    });
  }

  if (hydrangeaPositions.length > 0) {
    const hyLeafGeo = new THREE.BoxGeometry(0.76, 0.46, 0.76);
    hyLeafGeo.translate(0, 0.23, 0);
    const hyBloomGeo = mergeGeometries([
      (() => { const g = new THREE.BoxGeometry(0.24, 0.22, 0.24); g.translate(0, 0.52, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.20, 0.18, 0.20); g.translate(0.22, 0.46, 0.14); return g; })(),
      (() => { const g = new THREE.BoxGeometry(0.20, 0.18, 0.20); g.translate(-0.20, 0.47, -0.16); return g; })(),
    ]);
    const hyLeafInst = new THREE.InstancedMesh(
      hyLeafGeo,
      new THREE.MeshStandardMaterial({ map: texLib.leafDeciduousTex, color: 0x458034, roughness: 0.88 }),
      hydrangeaPositions.length
    );
    const hyBloomInst = new THREE.InstancedMesh(
      hyBloomGeo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 }),
      hydrangeaPositions.length
    );
    const hyCols = [0x7aa8e8, 0xf2f4f0, 0xe89eb8];
    const col = new THREE.Color();
    hydrangeaPositions.forEach(([x, z, sc, cIdx], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev, z);
      dummy.rotation.set(0, i * 1.1, 0);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      hyLeafInst.setMatrixAt(i, dummy.matrix);
      hyBloomInst.setMatrixAt(i, dummy.matrix);
      col.setHex(hyCols[cIdx % hyCols.length]);
      hyBloomInst.setColorAt(i, col);
    });
    if (hyBloomInst.instanceColor) hyBloomInst.instanceColor.needsUpdate = true;
    scene.add(hyLeafInst, hyBloomInst);
    registerWinterToggle((isWinter) => {
      hyLeafInst.visible = !isWinter;
      hyBloomInst.visible = !isWinter;
    });
  }

  if (cleanGrass.length > 0) {
    const t1 = new THREE.BoxGeometry(0.32, 0.28, 0.08);
    const t2 = new THREE.BoxGeometry(0.08, 0.28, 0.32);
    const tuftGeo = mergeGeometries([t1, t2]);
    const tuftMat = new THREE.MeshStandardMaterial({
      map: texLib.leafDeciduousTex,
      color: 0xffffff,
      roughness: 0.9,
    });
    const tuftInst = new THREE.InstancedMesh(tuftGeo, tuftMat, cleanGrass.length);
    const gCols = [0x58963c, 0x64a446, 0x4b8532, 0x6fb04e];
    const col = new THREE.Color();
    cleanGrass.forEach(([x, z, sc], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev + 0.14 * sc, z);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      tuftInst.setMatrixAt(i, dummy.matrix);
      col.setHex(gCols[i % gCols.length]);
      tuftInst.setColorAt(i, col);
    });
    if (tuftInst.instanceColor) tuftInst.instanceColor.needsUpdate = true;
    scene.add(tuftInst);
    registerWinterToggle((isWinter) => {
      tuftInst.visible = !isWinter;
    });
  }

  if (cleanFlowers.length > 0) {
    const flGeo = new THREE.BoxGeometry(0.20, 0.16, 0.20);
    const flMat = new THREE.MeshStandardMaterial({ color: 0xf7dc4f, roughness: 0.85 });
    const flInst = new THREE.InstancedMesh(flGeo, flMat, cleanFlowers.length);
    cleanFlowers.forEach(([x, z], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev + 0.09, z);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      flInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(flInst);
    registerWinterToggle((isWinter) => {
      flInst.visible = !isWinter;
    });
  }

  // Helper to ensure forest/woodland/verge trees never overlap buildings, pitches, driveways, or roads
  const isClearForForest = (tx, tz) => {
    for (let i = 0; i < DATA.pitches.length; i++) {
      const p = DATA.pitches[i];
      if (Math.hypot(tx - p.cx, tz - p.cz) < 28) return false;
    }
    return isClearForProp(tx, tz, 1.4, true);
  };

  // --- F. 7-Species Mature Quebec Micro-Voxel Trees & Curated Shrubs ---
  const deciduousPos = [];
  const coniferPos = [];
  const birchPos = [];
  const globePos = [];
  const crimsonPos = [];
  const cedarColPos = [];
  const overgrownMaplePos = [];

  for (const [ix, iz] of parkLotTreeCoords) {
    globePos.push([ix, iz, 0.88]);
    shrubPositions.push([ix + 0.6, iz + 0.6, 0.68]);
    shrubPositions.push([ix - 0.6, iz - 0.6, 0.68]);
  }

  // Lush dense natural woods / boisé strips (step = 6.2m)
  for (const wb of woodBoxes) {
    const [minX, maxX, minZ, maxZ] = wb.bbox;
    const cx0 = Math.max(minX, -1080);
    const cx1 = Math.min(maxX, 1080);
    const cz0 = Math.max(minZ, -1080);
    const cz1 = Math.min(maxZ, 1080);
    if (cx0 >= cx1 || cz0 >= cz1) continue;
    const step = 6.2;
    for (let gx = cx0; gx <= cx1; gx += step) {
      for (let gz = cz0; gz <= cz1; gz += step) {
        const tx = gx + (rand() - 0.5) * step * 0.85;
        const tz = gz + (rand() - 0.5) * step * 0.85;
        if (Math.hypot(tx, tz) > 1075) continue;
        if (!pointInPoly(tx, tz, wb.pts)) continue;
        if (!isClearForProp(tx, tz, 0.8, true)) continue;
        const sc = 1.05 + rand() * 0.62;
        const rType = rand();
        if (rType < 0.42) coniferPos.push([tx, tz, sc]);
        else if (rType < 0.80) deciduousPos.push([tx, tz, sc]);
        else if (rType < 0.92) birchPos.push([tx, tz, sc * 0.95]);
        else overgrownMaplePos.push([tx, tz, sc]);
      }
    }
  }

  // Thick mixed Quebec forest across Parc Walter-Camden & behind École de la Samare
  const denseForestZones = [
    { minX: 195, maxX: 680, minZ: 312, maxZ: 680, step: 5.2 },
    { minX: 385, maxX: 720, minZ: 215, maxZ: 490, step: 5.4 },
  ];
  for (const zDef of denseForestZones) {
    for (let gx = zDef.minX; gx <= zDef.maxX; gx += zDef.step) {
      for (let gz = zDef.minZ; gz <= zDef.maxZ; gz += zDef.step) {
        const tx = gx + (rand() - 0.5) * zDef.step * 0.85;
        const tz = gz + (rand() - 0.5) * zDef.step * 0.85;
        if (Math.hypot(tx, tz) > 1060) continue;
        if (!isClearForForest(tx, tz)) continue;
        const sc = 1.1 + rand() * 0.62;
        const rType = rand();
        if (rType < 0.44) coniferPos.push([tx, tz, sc]);
        else if (rType < 0.80) deciduousPos.push([tx, tz, sc]);
        else if (rType < 0.92) birchPos.push([tx, tz, sc * 0.95]);
        else overgrownMaplePos.push([tx, tz, sc]);
        if (rand() < 0.45) shrubPositions.push([tx + (rand() - 0.5) * 2.4, tz + (rand() - 0.5) * 2.4, 0.85 + rand() * 0.5]);
      }
    }
  }

  // Rich wooded canopy inside neighbourhood parks (especially Parc Gilles-Charland boisé & Parc Ducharme)
  for (const pk of DATA.parks) {
    const [minX, maxX, minZ, maxZ] = polyBBox(pk.pts);
    const count = pk.id === 169143105 ? 240 : 145;
    for (let t = 0; t < count; t++) {
      const tx = minX + rand() * (maxX - minX);
      const tz = minZ + rand() * (maxZ - minZ);
      if (!pointInPoly(tx, tz, pk.pts)) continue;
      if (DATA.pitches.some((p) => Math.hypot(tx - p.cx, tz - p.cz) < 23)) continue;
      if (!isClearForProp(tx, tz, 1.0, true)) continue;
      const sc = 1.0 + rand() * 0.62;
      const rType = rand();
      if (rType < 0.34) coniferPos.push([tx, tz, sc]);
      else if (rType < 0.72) deciduousPos.push([tx, tz, sc]);
      else if (rType < 0.86) overgrownMaplePos.push([tx, tz, sc]);
      else birchPos.push([tx, tz, sc * 0.94]);
    }
  }

  for (const b of DATA.buildings) {
    if (HERO_SKIP_IDS.has(b.id) || b.style === 'garage_shed' || b.style === 'commercial') continue;
    const fx = Math.cos(b.ang), fz = Math.sin(b.ang);
    const sx = -fz, sz = fx;

    // Signature Fleurimont pyramidal cedars flanking quadruplex/cottage front entrances (~20% of homes)
    if (b.style === 'semidetached' || b.style === 'quadruplex' || (b.driveway && b.cidx % 5 === 2)) {
      for (const csgn of [-1, 1]) {
        if (b.style !== 'semidetached' && b.style !== 'quadruplex' && csgn > 0) continue;
        const cx = b.obbCx + fx * (b.d * 0.5 + 1.3) + sx * (csgn * Math.min(2.2, b.w * 0.22));
        const cz = b.obbCz + fz * (b.d * 0.5 + 1.3) + sz * (csgn * Math.min(2.2, b.w * 0.22));
        if (Math.hypot(cx, cz) < 1035 && isClearForProp(cx, cz, 0.5, true)) {
          cedarColPos.push([cx, cz, 0.85 + rand() * 0.28]);
        }
      }
    }

    // 1 curated front-yard accent tree on ~72% of detached homes (strictly clear of driveways, sidewalks & buildings)
    if (rand() < 0.72) {
      let livSide = (b.cidx % 2 === 0) ? 1 : -1;
      if (b.driveway) {
        const dSide = (b.driveway[0] - b.obbCx) * sx + (b.driveway[1] - b.obbCz) * sz;
        livSide = dSide >= 0 ? -1 : 1;
      }
      const side = livSide * (b.w * 0.42 + 1.6);
      const tx = b.obbCx + fx * (b.d * 0.5 + 3.4 + rand() * 3.0) + sx * side;
      const tz = b.obbCz + fz * (b.d * 0.5 + 3.4 + rand() * 3.0) + sz * side;
      if (Math.hypot(tx, tz) < 1035 && isClearForProp(tx, tz, 1.5, true)) {
        const sc = 0.95 + rand() * 0.50;
        const rType = rand();
        if (rType < 0.26) globePos.push([tx, tz, sc]);
        else if (rType < 0.48) coniferPos.push([tx, tz, sc]);
        else if (rType < 0.68) deciduousPos.push([tx, tz, sc * 1.08]);
        else if (rType < 0.84) birchPos.push([tx, tz, sc]);
        else crimsonPos.push([tx, tz, sc]);
        if (rand() < 0.70) treeMulchBeds.push([tx, tz, -b.ang]);
      }
    }

    // 2–4 mature backyard & boundary trees (matching dense Fleurimont aerial tree canopy)
    const backCount = 2 + (rand() < 0.55 ? 1 : 0) + (rand() < 0.30 ? 1 : 0);
    for (let bt = 0; bt < backCount; bt++) {
      const side = (rand() - 0.5) * b.w * 1.45;
      const tx = b.obbCx - fx * (b.d * 0.5 + 5.2 + rand() * 9.5) + sx * side;
      const tz = b.obbCz - fz * (b.d * 0.5 + 5.2 + rand() * 9.5) + sz * side;
      if (Math.hypot(tx, tz) > 1045 || !isClearForProp(tx, tz, 1.2, true)) continue;
      const sc = 1.05 + rand() * 0.58;
      const rType = rand();
      if (rType < 0.36) coniferPos.push([tx, tz, sc]);
      else if (rType < 0.74) deciduousPos.push([tx, tz, sc]);
      else if (rType < 0.88) overgrownMaplePos.push([tx, tz, sc]);
      else if (rType < 0.96) birchPos.push([tx, tz, sc * 0.95]);
      else crimsonPos.push([tx, tz, sc]);
    }
  }

  // Roadside verges, cul-de-sacs & sparse subdivisions (strictly clear of curbs, sidewalks, driveways & buildings)
  for (const r of DATA.roads) {
    if (r.type !== 'residential' && r.type !== 'tertiary') continue;
    const isPriority = r.name && targetSubdivPattern.test(r.name);
    const treeStep = isPriority ? 14 : 24;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [x0, z0] = r.pts[i], [x1, z1] = r.pts[i + 1];
      const segLen = Math.hypot(x1 - x0, z1 - z0);
      if (segLen < 6) continue;
      const ux = (x1 - x0) / segLen, uz = (z1 - z0) / segLen;
      const nx = -uz, nz = ux;
      for (let d = 5; d < segLen - 4; d += treeStep) {
        for (const sgn of [-1, 1]) {
          if (!isPriority && rand() > 0.5) continue;
          const tx = x0 + ux * d + nx * sgn * ((r.width || 7) * 0.5 + 3.4 + rand() * 3.0);
          const tz = z0 + uz * d + nz * sgn * ((r.width || 7) * 0.5 + 3.4 + rand() * 3.0);
          if (Math.hypot(tx, tz) > 1050 || !isClearForForest(tx, tz)) continue;
          const sc = 0.95 + rand() * 0.55;
          const rType = rand();
          if (rType < 0.34) coniferPos.push([tx, tz, sc]);
          else if (rType < 0.72) deciduousPos.push([tx, tz, sc]);
          else if (rType < 0.86) birchPos.push([tx, tz, sc]);
          else globePos.push([tx, tz, sc * 0.92]);
        }
      }
    }
    for (const endPt of [r.pts[0], r.pts[r.pts.length - 1]]) {
      if (Math.hypot(endPt[0], endPt[1]) > 1040) continue;
      for (let a = 0; a < 4; a++) {
        const ang = (a / 4) * Math.PI * 2 + rand() * 0.8;
        const dist = (r.width || 7) * 0.5 + 4.5 + rand() * 2.5;
        const tx = endPt[0] + Math.cos(ang) * dist;
        const tz = endPt[1] + Math.sin(ang) * dist;
        if (!isClearForForest(tx, tz)) continue;
        const sc = 0.95 + rand() * 0.5;
        if (rand() < 0.45) birchPos.push([tx, tz, sc]);
        else deciduousPos.push([tx, tz, sc]);
      }
    }
  }

  // Mulched stone rings around front-yard trees
  if (treeMulchBeds.length > 0) {
    const tmInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.75, 0.10, 1.75),
      new THREE.MeshStandardMaterial({ map: texLib.mulchTex || null, color: texLib.mulchTex ? 0xffffff : 0x4a3828, roughness: 0.96 }),
      treeMulchBeds.length
    );
    const stoneRingInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2.15, 0.08, 2.15),
      new THREE.MeshStandardMaterial({ map: texLib.concreteTex, color: 0x9aa09c, roughness: 0.92 }),
      treeMulchBeds.length
    );
    treeMulchBeds.forEach(([x, z, ry], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev + 0.06, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      tmInst.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, elev + 0.03, z);
      dummy.updateMatrix();
      stoneRingInst.setMatrixAt(i, dummy.matrix);
    });
    scene.add(tmInst, stoneRingInst);
    registerWinterToggle((isWinter) => {
      tmInst.visible = !isWinter;
      stoneRingInst.visible = !isWinter;
    });
  }

  // Organic clustered spruce & maple groves along Rue des Peupliers + sidewalk/curb-edge bushes (clear of driveways)
  const peupliersGroves = [
    [29.5, 13.8, 'con', 1.15], [32.4, 15.1, 'con', 0.95], [35.2, 13.2, 'dec', 1.15],
    [48.5, 14.5, 'con', 1.25], [52.1, 13.4, 'con', 1.05], [56.0, 31.8, 'over', 1.12],
    [68.4, 15.0, 'con', 1.10], [72.2, 31.6, 'birch', 0.98], [79.5, 31.2, 'dec', 1.20],
    [84.2, 31.8, 'con', 1.22], [91.4, 30.8, 'over', 1.10],
  ];
  for (const [gx, gz, kind, sc] of peupliersGroves) {
    if (!isClearForProp(gx, gz, 0.8, true)) continue;
    if (kind === 'con') coniferPos.push([gx, gz, sc]);
    else if (kind === 'over') overgrownMaplePos.push([gx, gz, sc]);
    else if (kind === 'birch') birchPos.push([gx, gz, sc]);
    else deciduousPos.push([gx, gz, sc]);
  }
  for (const r of DATA.roads) {
    if (r.type !== 'residential') continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [x0, z0] = r.pts[i], [x1, z1] = r.pts[i + 1];
      const segLen = Math.hypot(x1 - x0, z1 - z0);
      if (segLen < 12) continue;
      const ux = (x1 - x0) / segLen, uz = (z1 - z0) / segLen;
      const nx = -uz, nz = ux;
      for (let d = 10; d < segLen - 8; d += 30) {
        if (rand() < 0.35) {
          const sgn = rand() < 0.5 ? 1 : -1;
          const sx = x0 + ux * d + nx * sgn * ((r.width || 7) * 0.5 + 1.8);
          const sz = z0 + uz * d + nz * sgn * ((r.width || 7) * 0.5 + 1.8);
          if (Math.hypot(sx, sz) < 1030 && isClearForForest(sx, sz)) {
            shrubPositions.push([sx, sz, 0.70 + rand() * 0.35]);
          }
        }
      }
    }
  }

  const {
    decTrunkGeo,
    decCrownGeo,
    conTrunkGeo,
    conCrownGeo,
    birchTrunkGeo,
    birchCrownGeo,
    globeTrunkGeo,
    globeCrownGeo,
    cedarColGeo,
    smallPlantGeo,
    medBushGeo,
    overgrownBushGeo,
    overgrownMapleTrunkGeo,
    overgrownMapleCrownGeo,
  } = buildVoxelTreePrototypes();
  const trunkMat = new THREE.MeshStandardMaterial({ map: texLib.barkTex, color: 0xffffff, roughness: 0.94 });
  const birchTrunkMat = new THREE.MeshStandardMaterial({
    map: texLib.birchBarkTex || texLib.concreteTex,
    color: 0xffffff,
    roughness: 0.9,
  });
  const decMat = new THREE.MeshStandardMaterial({ map: texLib.leafDeciduousTex, color: 0xffffff, roughness: 0.88 });
  const conMat = new THREE.MeshStandardMaterial({ map: texLib.leafConiferTex, color: 0xffffff, roughness: 0.9 });

  registerMaterialSwap(
    decMat,
    { map: texLib.leafDeciduousTex, color: 0xffffff, roughness: 0.88 },
    { map: texLib.snowTex, color: 0xddeaf5, roughness: 0.85 }
  );
  registerMaterialSwap(
    conMat,
    { map: texLib.leafConiferTex, color: 0xffffff, roughness: 0.9 },
    { map: texLib.leafConiferTex, color: 0xc6d8e8, roughness: 0.86 }
  );

  // Build collision obstacles export (includes hedges AND all steel/wood fences)
  const obstacles = {
    trees: [],
    bushes: [],
    hedges: [
      ...hedgeTransforms.map((ht) => [ht.x, ht.z, ht.sx * 0.5, ht.sz * 0.5, ht.ry]),
      ...fenceObstacles,
    ],
    parkedCars: parkedVehicles.map((pv) => [pv.x, pv.z, 2.1, 0.91, pv.ry]),
  };

  // Split shrubs into 3 organic, asymmetric tiers
  const smallPlants = [];
  const medBushes = [];
  const overgrownBushes = [];
  for (let i = 0; i < shrubPositions.length; i++) {
    const [bx, bz, bsc] = shrubPositions[i];
    const jx = bx + (rand() - 0.5) * 0.40;
    const jz = bz + (rand() - 0.5) * 0.40;
    const tier = rand();
    if (tier < 0.36) smallPlants.push([jx, jz, bsc * (0.75 + rand() * 0.42)]);
    else if (tier < 0.74) medBushes.push([jx, jz, bsc * (0.8 + rand() * 0.48)]);
    else overgrownBushes.push([jx, jz, bsc * (0.85 + rand() * 0.55)]);
  }

  const spawnBushTier = (list, geo, baseRadius) => {
    if (list.length === 0 || !geo) return;
    const shInst = new THREE.InstancedMesh(geo, decMat, list.length);
    shInst.castShadow = true;
    const sCols = [0x94d474, 0x82c464, 0xa2dc7e, 0x6ea854, 0x8bc86c];
    const col = new THREE.Color();
    const winterCol = new THREE.Color(0xddeaf5);
    list.forEach(([x, z, sc], i) => {
      const elev = sampleElevation(x, z, elevData);
      const sx = sc * (0.78 + rand() * 0.44);
      const sy = sc * (0.72 + rand() * 0.48);
      const sz = sc * (0.78 + rand() * 0.44);
      dummy.position.set(x, elev, z);
      dummy.rotation.set((rand() - 0.5) * 0.14, rand() * Math.PI * 2, (rand() - 0.5) * 0.14);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      shInst.setMatrixAt(i, dummy.matrix);
      col.setHex(sCols[i % sCols.length]);
      shInst.setColorAt(i, col);
      if (baseRadius > 0) {
        obstacles.bushes.push([x, z, baseRadius * Math.max(sx, sz)]);
      }
    });
    if (shInst.instanceColor) shInst.instanceColor.needsUpdate = true;
    scene.add(shInst);
    registerWinterToggle((isWinter) => {
      for (let i = 0; i < list.length; i++) {
        col.setHex(sCols[i % sCols.length]);
        shInst.setColorAt(i, isWinter ? winterCol : col);
      }
      if (shInst.instanceColor) shInst.instanceColor.needsUpdate = true;
    });
  };

  spawnBushTier(smallPlants, smallPlantGeo, 0);
  spawnBushTier(medBushes, medBushGeo, 0.58);
  spawnBushTier(overgrownBushes, overgrownBushGeo, 0.85);

  // Purple flowering lilac bushes
  if (lilacPositions.length > 0 && globeCrownGeo) {
    const lInst = new THREE.InstancedMesh(medBushGeo || overgrownBushGeo, decMat, lilacPositions.length);
    lInst.castShadow = true;
    const lCols = [0xa876cc, 0xb886da, 0x9464b8];
    const col = new THREE.Color();
    const winterCol = new THREE.Color(0xddeaf5);
    lilacPositions.forEach(([x, z, sc], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev, z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.set(sc * 1.4, sc * 1.4, sc * 1.4);
      dummy.updateMatrix();
      lInst.setMatrixAt(i, dummy.matrix);
      col.setHex(lCols[i % lCols.length]);
      lInst.setColorAt(i, col);
      obstacles.bushes.push([x, z, 0.72 * sc]);
    });
    if (lInst.instanceColor) lInst.instanceColor.needsUpdate = true;
    scene.add(lInst);
    registerWinterToggle((isWinter) => {
      for (let i = 0; i < lilacPositions.length; i++) {
        col.setHex(lCols[i % lCols.length]);
        lInst.setColorAt(i, isWinter ? winterCol : col);
      }
      if (lInst.instanceColor) lInst.instanceColor.needsUpdate = true;
    });
  }

  // Multi-Stem Paper Birch
  if (birchPos.length > 0 && birchTrunkGeo && birchCrownGeo) {
    const btrInst = new THREE.InstancedMesh(birchTrunkGeo, birchTrunkMat, birchPos.length);
    const bcrInst = new THREE.InstancedMesh(birchCrownGeo, decMat, birchPos.length);
    bcrInst.castShadow = true;
    const bCols = [0xcaf09c, 0xd8f5ac, 0xb8e28c];
    const col = new THREE.Color();
    const winterCol = new THREE.Color(0xddeaf5);
    birchPos.forEach(([x, z, sc], i) => {
      const elev = sampleElevation(x, z, elevData);
      const sx = sc * (0.85 + rand() * 0.35);
      const sy = sc * (0.88 + rand() * 0.38);
      const sz = sc * (0.85 + rand() * 0.35);
      dummy.position.set(x, elev, z);
      dummy.rotation.set((rand() - 0.5) * 0.12, rand() * Math.PI * 2, (rand() - 0.5) * 0.12);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      btrInst.setMatrixAt(i, dummy.matrix);
      bcrInst.setMatrixAt(i, dummy.matrix);
      col.setHex(bCols[i % bCols.length]);
      bcrInst.setColorAt(i, col);
      obstacles.trees.push([x, z, 0.34 * Math.max(sx, sz)]);
    });
    if (bcrInst.instanceColor) bcrInst.instanceColor.needsUpdate = true;
    scene.add(btrInst, bcrInst);
    registerWinterToggle((isWinter) => {
      for (let i = 0; i < birchPos.length; i++) {
        col.setHex(bCols[i % bCols.length]);
        bcrInst.setColorAt(i, isWinter ? winterCol : col);
      }
      if (bcrInst.instanceColor) bcrInst.instanceColor.needsUpdate = true;
    });
  }

  // Sculpted Globe Maple / Catalpa (manicured bright emerald front-yard spheres)
  if (globePos.length > 0 && globeTrunkGeo && globeCrownGeo) {
    const gtrInst = new THREE.InstancedMesh(globeTrunkGeo, trunkMat, globePos.length);
    const gcrInst = new THREE.InstancedMesh(globeCrownGeo, decMat, globePos.length);
    gcrInst.castShadow = true;
    const gCols = [0x9ee06e, 0x8ed462, 0xb2ea7c, 0x7ec656];
    const col = new THREE.Color();
    const winterCol = new THREE.Color(0xddeaf5);
    globePos.forEach(([x, z, sc], i) => {
      const elev = sampleElevation(x, z, elevData);
      const sx = sc * (0.86 + rand() * 0.32);
      const sy = sc * (0.86 + rand() * 0.32);
      const sz = sc * (0.86 + rand() * 0.32);
      dummy.position.set(x, elev, z);
      dummy.rotation.set((rand() - 0.5) * 0.08, rand() * Math.PI * 2, (rand() - 0.5) * 0.08);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      gtrInst.setMatrixAt(i, dummy.matrix);
      gcrInst.setMatrixAt(i, dummy.matrix);
      col.setHex(gCols[i % gCols.length]);
      gcrInst.setColorAt(i, col);
      obstacles.trees.push([x, z, 0.36 * Math.max(sx, sz)]);
    });
    if (gcrInst.instanceColor) gcrInst.instanceColor.needsUpdate = true;
    scene.add(gtrInst, gcrInst);
    registerWinterToggle((isWinter) => {
      for (let i = 0; i < globePos.length; i++) {
        col.setHex(gCols[i % gCols.length]);
        gcrInst.setColorAt(i, isWinter ? winterCol : col);
      }
      if (gcrInst.instanceColor) gcrInst.instanceColor.needsUpdate = true;
    });
  }

  // Burgundy Crimson King Maple / Ornamental Purple Plum
  if (crimsonPos.length > 0 && globeTrunkGeo && globeCrownGeo) {
    const ctrInst = new THREE.InstancedMesh(globeTrunkGeo, trunkMat, crimsonPos.length);
    const ccrInst = new THREE.InstancedMesh(globeCrownGeo, decMat, crimsonPos.length);
    ccrInst.castShadow = true;
    const crCols = [0x7c2d3e, 0x8c3749, 0x682433];
    const col = new THREE.Color();
    const winterCol = new THREE.Color(0xddeaf5);
    crimsonPos.forEach(([x, z, sc], i) => {
      const elev = sampleElevation(x, z, elevData);
      const sx = sc * (0.88 + rand() * 0.36);
      const sy = sc * (0.90 + rand() * 0.42);
      const sz = sc * (0.88 + rand() * 0.36);
      dummy.position.set(x, elev, z);
      dummy.rotation.set((rand() - 0.5) * 0.12, rand() * Math.PI * 2, (rand() - 0.5) * 0.12);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      ctrInst.setMatrixAt(i, dummy.matrix);
      ccrInst.setMatrixAt(i, dummy.matrix);
      col.setHex(crCols[i % crCols.length]);
      ccrInst.setColorAt(i, col);
      obstacles.trees.push([x, z, 0.36 * Math.max(sx, sz)]);
    });
    if (ccrInst.instanceColor) ccrInst.instanceColor.needsUpdate = true;
    scene.add(ctrInst, ccrInst);
    registerWinterToggle((isWinter) => {
      for (let i = 0; i < crimsonPos.length; i++) {
        col.setHex(crCols[i % crCols.length]);
        ccrInst.setColorAt(i, isWinter ? winterCol : col);
      }
      if (ccrInst.instanceColor) ccrInst.instanceColor.needsUpdate = true;
    });
  }

  // Columnar Pyramidal Cedars flanking duplex entries & driveways
  if (cedarColPos.length > 0 && cedarColGeo) {
    const ccInst = new THREE.InstancedMesh(cedarColGeo, conMat, cedarColPos.length);
    ccInst.castShadow = true;
    const ccCols = [0xb8dcba, 0xc8e8ca, 0xa8cca8];
    const col = new THREE.Color();
    const winterCol = new THREE.Color(0xc6d8e8);
    cedarColPos.forEach(([x, z, sc], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev, z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      ccInst.setMatrixAt(i, dummy.matrix);
      col.setHex(ccCols[i % ccCols.length]);
      ccInst.setColorAt(i, col);
      obstacles.trees.push([x, z, 0.42 * sc]);
    });
    if (ccInst.instanceColor) ccInst.instanceColor.needsUpdate = true;
    scene.add(ccInst);
    registerWinterToggle((isWinter) => {
      for (let i = 0; i < cedarColPos.length; i++) {
        col.setHex(ccCols[i % ccCols.length]);
        ccInst.setColorAt(i, isWinter ? winterCol : col);
      }
      if (ccInst.instanceColor) ccInst.instanceColor.needsUpdate = true;
    });
  }

  const decCols = [0x8cd064, 0x9cdc72, 0x7ec058, 0xa6e27c, 0x72b44e];
  const conCols = [0xb8dcb8, 0xc6e8c8, 0xa4cab0, 0x7aa3a8]; // includes ~25% silvery-blue Colorado Blue Spruce!

  if (deciduousPos.length > 0 && decTrunkGeo && decCrownGeo) {
    const trInst = new THREE.InstancedMesh(decTrunkGeo, trunkMat, deciduousPos.length);
    const crInst = new THREE.InstancedMesh(decCrownGeo, decMat, deciduousPos.length);
    crInst.castShadow = true;
    const col = new THREE.Color();
    const winterCol = new THREE.Color(0xddeaf5);
    deciduousPos.forEach(([x, z, sc], i) => {
      const elev = sampleElevation(x, z, elevData);
      const sx = Math.max(0.75, Math.min(1.65, sc * (0.85 + rand() * 0.42)));
      const sy = Math.max(0.78, Math.min(1.68, sc * (0.88 + rand() * 0.44)));
      const sz = Math.max(0.75, Math.min(1.65, sc * (0.85 + rand() * 0.42)));
      dummy.position.set(x, elev, z);
      dummy.rotation.set((rand() - 0.5) * 0.14, rand() * Math.PI * 2, (rand() - 0.5) * 0.14);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      trInst.setMatrixAt(i, dummy.matrix);
      crInst.setMatrixAt(i, dummy.matrix);
      col.setHex(decCols[i % decCols.length]);
      crInst.setColorAt(i, col);
      obstacles.trees.push([x, z, 0.42 * Math.max(sx, sz)]);
    });
    if (crInst.instanceColor) crInst.instanceColor.needsUpdate = true;
    scene.add(trInst, crInst);

    registerWinterToggle((isWinter) => {
      for (let i = 0; i < deciduousPos.length; i++) {
        if (isWinter) {
          crInst.setColorAt(i, winterCol);
        } else {
          col.setHex(decCols[i % decCols.length]);
          crInst.setColorAt(i, col);
        }
      }
      if (crInst.instanceColor) crInst.instanceColor.needsUpdate = true;
    });
  }

  if (coniferPos.length > 0 && conTrunkGeo && conCrownGeo) {
    const trInst = new THREE.InstancedMesh(conTrunkGeo, trunkMat, coniferPos.length);
    const crInst = new THREE.InstancedMesh(conCrownGeo, conMat, coniferPos.length);
    crInst.castShadow = true;
    const col = new THREE.Color();
    const winterCol = new THREE.Color(0xc6d8e8);
    coniferPos.forEach(([x, z, sc], i) => {
      const elev = sampleElevation(x, z, elevData);
      const sx = Math.max(0.75, Math.min(1.65, sc * (0.82 + rand() * 0.42)));
      const sy = Math.max(0.78, Math.min(1.68, sc * (0.85 + rand() * 0.46)));
      const sz = Math.max(0.75, Math.min(1.65, sc * (0.82 + rand() * 0.42)));
      dummy.position.set(x, elev, z);
      dummy.rotation.set((rand() - 0.5) * 0.12, rand() * Math.PI * 2, (rand() - 0.5) * 0.12);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      trInst.setMatrixAt(i, dummy.matrix);
      crInst.setMatrixAt(i, dummy.matrix);
      col.setHex(conCols[i % conCols.length]);
      crInst.setColorAt(i, col);
      obstacles.trees.push([x, z, 0.42 * Math.max(sx, sz)]);
    });
    if (crInst.instanceColor) crInst.instanceColor.needsUpdate = true;
    scene.add(trInst, crInst);

    registerWinterToggle((isWinter) => {
      for (let i = 0; i < coniferPos.length; i++) {
        if (isWinter) {
          crInst.setColorAt(i, winterCol);
        } else {
          col.setHex(conCols[i % conCols.length]);
          crInst.setColorAt(i, col);
        }
      }
      if (crInst.instanceColor) crInst.instanceColor.needsUpdate = true;
    });
  }

  if (overgrownMaplePos.length > 0 && overgrownMapleTrunkGeo && overgrownMapleCrownGeo) {
    const trInst = new THREE.InstancedMesh(overgrownMapleTrunkGeo, trunkMat, overgrownMaplePos.length);
    const crInst = new THREE.InstancedMesh(overgrownMapleCrownGeo, decMat, overgrownMaplePos.length);
    crInst.castShadow = true;
    const col = new THREE.Color();
    const winterCol = new THREE.Color(0xddeaf5);
    overgrownMaplePos.forEach(([x, z, sc], i) => {
      const elev = sampleElevation(x, z, elevData);
      const sx = Math.max(0.80, Math.min(1.75, sc * (0.85 + rand() * 0.38)));
      const sy = Math.max(0.80, Math.min(1.75, sc * (0.84 + rand() * 0.40)));
      const sz = Math.max(0.80, Math.min(1.75, sc * (0.85 + rand() * 0.38)));
      dummy.position.set(x, elev, z);
      dummy.rotation.set((rand() - 0.5) * 0.14, rand() * Math.PI * 2, (rand() - 0.5) * 0.14);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      trInst.setMatrixAt(i, dummy.matrix);
      crInst.setMatrixAt(i, dummy.matrix);
      col.setHex(decCols[i % decCols.length]);
      crInst.setColorAt(i, col);
      obstacles.trees.push([x, z, 0.48 * Math.max(sx, sz)]);
    });
    if (crInst.instanceColor) crInst.instanceColor.needsUpdate = true;
    scene.add(trInst, crInst);
    registerWinterToggle((isWinter) => {
      for (let i = 0; i < overgrownMaplePos.length; i++) {
        col.setHex(decCols[i % decCols.length]);
        crInst.setColorAt(i, isWinter ? winterCol : col);
      }
      if (crInst.instanceColor) crInst.instanceColor.needsUpdate = true;
    });
  }

  // --- G. Christmas Mode Group (Hidden by default; toggled via setChristmasMode) ---
  christmasGroup = new THREE.Group();
  christmasGroup.visible = false;

  const xmasBulbs = []; // [x, y, z, colIdx]
  const xmasGarlands = []; // [x, y, z, ry, len]
  const xmasWreaths = []; // [x, y, z, ry]
  const xmasTrees = []; // [x, z, sc]
  const xmasShopWindows = []; // [x, y, z, ry]
  const xmasShopSigns = []; // [x, y, z, ry]

  // 1. House eaves, porches, doors, front-yard Christmas trees & balconies
  for (const b of DATA.buildings) {
    if (HERO_SKIP_IDS.has(b.id) || b.style === 'hero_2646' || b.style === 'school_samare' || b.style === 'garage_shed' || b.style === 'barn') continue;
    const elev = sampleElevation(b.obbCx, b.obbCz, elevData);
    const fx = Math.cos(b.ang), fz = Math.sin(b.ang);
    const sx = -fz, sz = fx;
    const rotY = -b.ang;

    if (b.style === 'commercial') {
      let commSign = 1;
      if (b.obbCz < -600 && fx * -0.35 + fz * 0.94 < 0) commSign = -1;
      const wallH = b.id === 265699855 ? 7.4 : b.amenity === 'social_facility' ? 9.2 : 4.6;
      const foundH = 0.34;
      const eaveY = elev + foundH + wallH;
      const frontU = commSign * (b.d * 0.5 + 0.16);

      // Commercial shopfront eaves lights & garland
      const spanW = Math.min(b.w * 0.85, 22);
      for (let v = -spanW * 0.5; v <= spanW * 0.5; v += 1.1) {
        xmasBulbs.push([b.obbCx + fx * frontU + sx * v, eaveY - 0.12, b.obbCz + fz * frontU + sz * v, Math.floor(rand() * 5)]);
      }
      xmasGarlands.push([b.obbCx + fx * (frontU + 0.08), elev + foundH + 3.05, b.obbCz + fz * (frontU + 0.08), rotY, Math.min(b.w * 0.55, 8)]);
      xmasWreaths.push([b.obbCx + fx * (frontU + 0.06), elev + foundH + 1.75, b.obbCz + fz * (frontU + 0.06), rotY]);

      // Decorated shop windows & holiday signs
      for (const wv of [-b.w * 0.25, b.w * 0.25]) {
        xmasShopWindows.push([b.obbCx + fx * (frontU + 0.05) + sx * wv, elev + foundH + 1.45, b.obbCz + fz * (frontU + 0.05) + sz * wv, rotY]);
      }
      xmasShopSigns.push([b.obbCx + fx * (frontU + 0.15), elev + foundH + 3.45, b.obbCz + fz * (frontU + 0.15), rotY]);

      // Outdoor Christmas tree in front of commercial shops
      xmasTrees.push([b.obbCx + fx * commSign * (b.d * 0.5 + 3.2) + sx * (b.w * 0.32), b.obbCz + fz * commSign * (b.d * 0.5 + 3.2) + sz * (b.w * 0.32), 1.25]);
      continue;
    }

    const foundH = (b.street && (b.street.includes('Tilleuls') || b.street.includes('Châteaumont'))) ? 0.65 : 0.34;
    const wallH = b.style === 'cottage_2s' ? 5.45 : b.style === 'quadruplex' ? 6.1 : b.style === 'apartments' ? 8.4 : b.style === 'splitlevel' ? 4.35 : 3.35;
    const eaveY = elev + foundH + wallH;

    // House front eaves lights (~75% of homes)
    if (b.cidx % 4 !== 3) {
      const eaveStep = 1.15;
      for (let v = -b.w * 0.46; v <= b.w * 0.46; v += eaveStep) {
        xmasBulbs.push([
          b.obbCx + fx * (b.d * 0.5 + 0.16) + sx * v,
          eaveY - 0.08,
          b.obbCz + fz * (b.d * 0.5 + 0.16) + sz * v,
          (Math.floor((v + 20) * 2) + b.cidx) % 5,
        ]);
      }
    }

    // Quadruplex balconies garland & lights
    if (b.style === 'quadruplex') {
      for (const bv of [-b.w * 0.42, b.w * 0.42]) {
        const gx = b.obbCx + fx * (b.d * 0.5 + 1.2) + sx * bv;
        const gz = b.obbCz + fz * (b.d * 0.5 + 1.2) + sz * bv;
        xmasGarlands.push([gx, elev + foundH + 3.35, gz, rotY, 2.2]);
        xmasBulbs.push([gx, elev + foundH + 3.45, gz, 2]);
      }
    }

    // Porch garland & door wreath (~60% of residential homes)
    if (b.driveway && b.cidx % 5 < 3) {
      const livSide = (b.cidx % 2 === 0) ? 1 : -1;
      const garSide = -livSide;
      const entryZ = (b.cidx % 5 === 0) ? 0.0 : -garSide * (b.w * 0.08);
      const wx = b.obbCx + fx * (b.d * 0.5 + 0.14) + sx * entryZ;
      const wz = b.obbCz + fz * (b.d * 0.5 + 0.14) + sz * entryZ;
      xmasWreaths.push([wx, elev + foundH + 1.45, wz, rotY]);
      xmasGarlands.push([wx + fx * 0.45, elev + foundH + 2.28, wz + fz * 0.45, rotY, 1.5]);
    }

    // Decorated front-yard Christmas tree (~24% of detached homes)
    if (b.driveway && b.cidx % 4 === 1) {
      const side = (b.cidx % 2 === 0 ? 1 : -1) * (b.w * 0.35 + 1.2);
      const tx = b.obbCx + fx * (b.d * 0.5 + 3.4) + sx * side;
      const tz = b.obbCz + fz * (b.d * 0.5 + 3.4) + sz * side;
      if (Math.hypot(tx, tz) < 1030) xmasTrees.push([tx, tz, 0.85 + rand() * 0.35]);
    }
  }

  // 2. Park Christmas trees (Parc Gilles-Charland, Parc Ducharme, Parc Bibeau, Parc Walter-Camden)
  for (const pk of DATA.parks) {
    if (!pk.pts || pk.pts.length === 0) continue;
    let cx = 0, cz = 0;
    for (const [px, pz] of pk.pts) { cx += px; cz += pz; }
    cx /= pk.pts.length; cz /= pk.pts.length;
    xmasTrees.push([cx + 4, cz + 4, 1.55]);
  }

  // 3. Streetlamp pole & overhead cable lights (every 2nd pole & mid-span)
  for (let i = 0; i < polePlacements.length; i += 2) {
    const p = polePlacements[i];
    xmasBulbs.push([p.x - p.outX * 0.5, p.elev + 7.28, p.z - p.outZ * 0.5, i % 5]);
    xmasBulbs.push([p.x - p.outX * 1.4, p.elev + 7.28, p.z - p.outZ * 1.4, (i + 2) % 5]);
    xmasBulbs.push([p.x, p.elev + 5.2, p.z, (i + 1) % 5]);
  }

  // 4. Lights on ~18% of front-yard conifers
  for (let i = 0; i < coniferPos.length; i += 6) {
    const [tx, tz, sc] = coniferPos[i];
    if (Math.hypot(tx, tz) > 750) continue;
    const tElev = sampleElevation(tx, tz, elevData);
    for (let k = 0; k < 5; k++) {
      const ang = k * 1.3;
      const rad = (1.1 - k * 0.16) * sc;
      xmasBulbs.push([tx + Math.cos(ang) * rad, tElev + (2.0 + k * 0.72) * sc, tz + Math.sin(ang) * rad, (i + k) % 5]);
    }
  }

  // 5. Add bulbs onto every decorated Christmas tree
  for (let i = 0; i < xmasTrees.length; i++) {
    const [tx, tz, sc] = xmasTrees[i];
    const tElev = sampleElevation(tx, tz, elevData);
    for (let k = 0; k < 8; k++) {
      const ang = k * 0.95;
      const rad = (1.15 - k * 0.11) * sc;
      xmasBulbs.push([tx + Math.cos(ang) * rad, tElev + (1.7 + k * 0.52) * sc, tz + Math.sin(ang) * rad, (i + k) % 5]);
    }
  }

  // Instantiate all Christmas meshes into christmasGroup
  if (xmasBulbs.length > 0) {
    const bulbGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const bulbInst = new THREE.InstancedMesh(bulbGeo, bulbMat, xmasBulbs.length);
    const xmasPalette = [0xff2b2b, 0x22e048, 0xffd028, 0xfff0c2, 0x2ea0ff];
    const col = new THREE.Color();
    xmasBulbs.forEach(([x, y, z, cIdx], i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bulbInst.setMatrixAt(i, dummy.matrix);
      col.setHex(xmasPalette[cIdx % 5]);
      bulbInst.setColorAt(i, col);
    });
    if (bulbInst.instanceColor) bulbInst.instanceColor.needsUpdate = true;
    christmasGroup.add(bulbInst);
  }

  if (xmasGarlands.length > 0) {
    const gGeo = new THREE.BoxGeometry(0.24, 0.24, 1.0);
    const gMat = new THREE.MeshStandardMaterial({ map: texLib.hedgeTex, color: 0x266b32, roughness: 0.85 });
    const gInst = new THREE.InstancedMesh(gGeo, gMat, xmasGarlands.length);
    xmasGarlands.forEach(([x, y, z, ry, len], i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, len);
      dummy.updateMatrix();
      gInst.setMatrixAt(i, dummy.matrix);
    });
    christmasGroup.add(gInst);
  }

  if (xmasWreaths.length > 0) {
    const wGeo = new THREE.BoxGeometry(0.10, 0.65, 0.65);
    const wMat = texLib.wreathTex
      ? new THREE.MeshStandardMaterial({ map: texLib.wreathTex, transparent: true, alphaTest: 0.35 })
      : new THREE.MeshStandardMaterial({ color: 0x1e6b2e, roughness: 0.8 });
    const wInst = new THREE.InstancedMesh(wGeo, wMat, xmasWreaths.length);
    xmasWreaths.forEach(([x, y, z, ry], i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      wInst.setMatrixAt(i, dummy.matrix);
    });
    christmasGroup.add(wInst);
  }

  if (xmasTrees.length > 0 && conTrunkGeo && conCrownGeo) {
    const xtTrunk = new THREE.InstancedMesh(conTrunkGeo, trunkMat, xmasTrees.length);
    const xtCrown = new THREE.InstancedMesh(
      conCrownGeo,
      new THREE.MeshStandardMaterial({ map: texLib.leafConiferTex, color: 0x2e7d3c, roughness: 0.85 }),
      xmasTrees.length
    );
    const xtStar = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.28, 0),
      new THREE.MeshBasicMaterial({ color: 0xffd738 }),
      xmasTrees.length
    );
    xmasTrees.forEach(([x, z, sc], i) => {
      const elev = sampleElevation(x, z, elevData);
      dummy.position.set(x, elev, z);
      dummy.rotation.set(0, i * 0.7, 0);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      xtTrunk.setMatrixAt(i, dummy.matrix);
      xtCrown.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, elev + 6.45 * sc, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      xtStar.setMatrixAt(i, dummy.matrix);
    });
    christmasGroup.add(xtTrunk, xtCrown, xtStar);
  }

  if (xmasShopWindows.length > 0) {
    const swGeo = new THREE.BoxGeometry(0.16, 1.85, 2.25);
    const swMat = texLib.christmasShopWindowTex
      ? new THREE.MeshBasicMaterial({ map: texLib.christmasShopWindowTex })
      : new THREE.MeshBasicMaterial({ color: 0xffd275 });
    const swInst = new THREE.InstancedMesh(swGeo, swMat, xmasShopWindows.length);
    xmasShopWindows.forEach(([x, y, z, ry], i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      swInst.setMatrixAt(i, dummy.matrix);
    });
    christmasGroup.add(swInst);
  }

  if (xmasShopSigns.length > 0) {
    const ssGeo = new THREE.BoxGeometry(0.14, 0.85, 2.6);
    const ssMat = texLib.christmasSignTex
      ? new THREE.MeshBasicMaterial({ map: texLib.christmasSignTex })
      : new THREE.MeshBasicMaterial({ color: 0xd82222 });
    const ssInst = new THREE.InstancedMesh(ssGeo, ssMat, xmasShopSigns.length);
    xmasShopSigns.forEach(([x, y, z, ry], i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      ssInst.setMatrixAt(i, dummy.matrix);
    });
    christmasGroup.add(ssInst);
  }

  scene.add(christmasGroup);

  return { lampBulbMesh, setWinterMode, setChristmasMode, obstacles };
}
