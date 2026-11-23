import * as THREE from 'three';
import {
  sampleElevation,
  createPitchedRoofGeometry,
  createGableEndsGeometry,
  createRoofTrimGeometry,
  setWorldBoxUVs,
} from './geometryHelpers.js';

// The 5 hero residences within 100m are built by heroLandmarks.js (which imports our helpers & calls registerExternalEnterable)
const HERO_100M_IDS = new Set([
  827707358, // 2646 Rue des Cormiers
  827707311, // 2638 Rue des Cormiers
  827707339, // 2654 Rue des Cormiers
  827707342, // 2643 Rue des Cormiers
  827707441, // 387 Rue des Peupliers
]);

// Module-level registry so registerExternalEnterable() works regardless of call order relative to buildEnterable100mZone()
const externalEntries = [];
let activeZoneState = null;

// --- Deterministic PRNG ---
function makeRng(seed) {
  let s = (seed * 2654435761) >>> 0;
  if (s === 0) s = 1337;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// --- Shared Procedural Interior Textures & Materials (created once, reused across all 32 houses for 60 FPS) ---
let cachedAssets = null;

function makePixelCanvasTex(w, h, drawFn, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  drawFn(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function getSharedAssets(texLib) {
  if (cachedAssets) return cachedAssets;

  // 1. Honey Oak Hardwood Plank Texture (32x32)
  const oakTex = makePixelCanvasTex(32, 32, (ctx) => {
    const rng = makeRng(101);
    const cols = ['#b8864b', '#c4945a', '#a87840', '#c89b63', '#9e703c'];
    for (let y = 0; y < 32; y += 4) {
      const plankCol = cols[Math.floor(rng() * cols.length)];
      ctx.fillStyle = plankCol;
      ctx.fillRect(0, y, 32, 3);
      ctx.fillStyle = '#755029';
      ctx.fillRect(0, y + 3, 32, 1);
      // Staggered vertical plank joint
      const jx = (y * 3 + 7) % 32;
      ctx.fillRect(jx, y, 1, 4);
      // Subtle wood grain
      for (let gx = 0; gx < 32; gx += 2) {
        if (rng() < 0.35) {
          ctx.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.07)';
          ctx.fillRect(gx, y + (gx % 3), 2, 1);
        }
      }
    }
  });

  // 2. 12"x12" Warm Beige/Greige Ceramic Kitchen Tile Texture (32x32)
  const tileTex = makePixelCanvasTex(32, 32, (ctx) => {
    const rng = makeRng(202);
    const cols = ['#d5cbbf', '#cfc5b8', '#dcd3c7', '#c8beb2'];
    for (let ty = 0; ty < 32; ty += 8) {
      for (let tx = 0; tx < 32; tx += 8) {
        ctx.fillStyle = cols[Math.floor(rng() * cols.length)];
        ctx.fillRect(tx, ty, 7, 7);
        ctx.fillStyle = '#a39b90';
        ctx.fillRect(tx + 7, ty, 1, 8);
        ctx.fillRect(tx, ty + 7, 8, 1);
      }
    }
  });

  // 3. Woven Living Room Area Rug Texture (32x32)
  const rugTex = makePixelCanvasTex(32, 32, (ctx) => {
    ctx.fillStyle = '#dfd5c3';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#38526e';
    ctx.fillRect(2, 2, 28, 28);
    ctx.fillStyle = '#d6c8b2';
    ctx.fillRect(5, 5, 22, 22);
    ctx.fillStyle = '#a84a36';
    ctx.fillRect(8, 8, 16, 16);
    ctx.fillStyle = '#e5dccb';
    ctx.fillRect(11, 11, 10, 10);
    ctx.fillStyle = '#38526e';
    ctx.fillRect(14, 14, 4, 4);
  });
  rugTex.wrapS = THREE.ClampToEdgeWrapping;
  rugTex.wrapT = THREE.ClampToEdgeWrapping;

  // 4. Pixel-Art TV Screen Texture (32x20 — Quebec hockey rink / cozy broadcast)
  const tvTex = makePixelCanvasTex(32, 20, (ctx) => {
    ctx.fillStyle = '#cbe2f5';
    ctx.fillRect(0, 0, 32, 20);
    // Rink boards & blue/red lines
    ctx.fillStyle = '#254a80';
    ctx.fillRect(0, 0, 32, 5);
    ctx.fillStyle = '#d62f2f';
    ctx.fillRect(15, 5, 2, 15);
    ctx.fillStyle = '#2b6cb0';
    ctx.fillRect(8, 5, 1, 15);
    ctx.fillRect(23, 5, 1, 15);
    // Tiny players
    ctx.fillStyle = '#c81d25';
    ctx.fillRect(11, 10, 2, 3);
    ctx.fillRect(18, 12, 2, 3);
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(13, 13, 2, 3);
    ctx.fillRect(21, 9, 2, 3);
  });
  tvTex.wrapS = THREE.ClampToEdgeWrapping;
  tvTex.wrapT = THREE.ClampToEdgeWrapping;

  // 5. Framed Quebec Autumn Wall Art Texture (24x16)
  const artTex = makePixelCanvasTex(24, 16, (ctx) => {
    ctx.fillStyle = '#7cb3e0';
    ctx.fillRect(0, 0, 24, 9);
    ctx.fillStyle = '#538234';
    ctx.fillRect(0, 9, 24, 7);
    // Mont-Bellevue / Eastern Townships hills
    ctx.fillStyle = '#3d6930';
    ctx.fillRect(2, 6, 9, 4);
    ctx.fillRect(13, 5, 9, 5);
    // Autumn maple trees
    ctx.fillStyle = '#d95b26';
    ctx.fillRect(5, 7, 3, 4);
    ctx.fillStyle = '#e8a229';
    ctx.fillRect(16, 7, 3, 4);
  });
  artTex.wrapS = THREE.ClampToEdgeWrapping;
  artTex.wrapT = THREE.ClampToEdgeWrapping;

  // 6. Resident Voxel Face Texture (16x16)
  const faceTex = makePixelCanvasTex(16, 16, (ctx) => {
    ctx.fillStyle = '#ebbfa4';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#4a3525';
    ctx.fillRect(0, 0, 16, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(3, 7, 3, 2);
    ctx.fillRect(10, 7, 3, 2);
    ctx.fillStyle = '#254a70';
    ctx.fillRect(4, 7, 2, 2);
    ctx.fillRect(10, 7, 2, 2);
    ctx.fillStyle = '#a85f4b';
    ctx.fillRect(6, 12, 4, 1);
  });
  faceTex.wrapS = THREE.ClampToEdgeWrapping;
  faceTex.wrapT = THREE.ClampToEdgeWrapping;

  // --- Shared Interior & Exterior Materials ---
  // Real see-through window glass: clearly see IN from street & OUT from inside!
  const clearGlassMat = new THREE.MeshStandardMaterial({
    color: 0xaad0e6,
    roughness: 0.08,
    metalness: 0.22,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const patioGlassMat = new THREE.MeshStandardMaterial({
    color: 0xb6d8ec,
    roughness: 0.08,
    metalness: 0.20,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Interior walls & ceiling carry a subtle warm emissive fill so rooms are bright & visible through windows
  // in BOTH Day and Night without needing expensive per-house PointLights!
  const intWallPalettes = [0xeae6df, 0xddd7cd, 0xf2ede4, 0xd8dfd9];
  const intWallMats = intWallPalettes.map(
    (col) =>
      new THREE.MeshStandardMaterial({
        color: col,
        roughness: 0.90,
        emissive: 0xffe4bc,
        emissiveIntensity: 0.16,
      })
  );

  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0xf4f3ee,
    roughness: 0.94,
    emissive: 0xffe6c2,
    emissiveIntensity: 0.18,
  });

  const oakFloorMat = new THREE.MeshStandardMaterial({
    map: oakTex,
    color: 0xffffff,
    roughness: 0.65,
    emissive: 0xffd9a0,
    emissiveIntensity: 0.12,
  });

  const tileFloorMat = new THREE.MeshStandardMaterial({
    map: tileTex,
    color: 0xffffff,
    roughness: 0.52,
    emissive: 0xffe5c0,
    emissiveIntensity: 0.12,
  });

  const garageFloorMat = new THREE.MeshStandardMaterial({
    map: texLib?.concreteTex || null,
    color: 0x9c9e9a,
    roughness: 0.92,
    emissive: 0xd8d8cc,
    emissiveIntensity: 0.10,
  });

  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xf7f7f5,
    roughness: 0.50,
    emissive: 0xffe8c8,
    emissiveIntensity: 0.06,
  });

  const darkTrimMat = new THREE.MeshStandardMaterial({ color: 0x3b3d40, roughness: 0.65 });
  const foundMat = new THREE.MeshStandardMaterial({
    map: texLib?.foundationTex || texLib?.concreteTex || null,
    color: 0xc0c3be,
    roughness: 0.92,
  });
  const concreteMat = new THREE.MeshStandardMaterial({
    map: texLib?.concreteTex || null,
    color: 0xb6b8b4,
    roughness: 0.88,
  });

  // Exterior siding & brick palettes (shared)
  const sidingMats = (texLib?.sidingTextures || []).map(
    (t) => new THREE.MeshStandardMaterial({ map: t, color: 0xffffff, roughness: 0.74 })
  );
  if (sidingMats.length === 0) {
    sidingMats.push(new THREE.MeshStandardMaterial({ color: 0xe6e4dc, roughness: 0.74 }));
  }
  const brickMats = (texLib?.brickTextures || []).map(
    (t) => new THREE.MeshStandardMaterial({ map: t, color: 0xffffff, roughness: 0.86 })
  );
  if (brickMats.length === 0) {
    brickMats.push(new THREE.MeshStandardMaterial({ color: 0x9c4e3b, roughness: 0.86 }));
  }

  // Upper 2nd-floor window material (swaps to warm lit glow at Night)
  const upperWinMat = new THREE.MeshStandardMaterial({
    map: texLib?.windowTex || null,
    color: 0xffffff,
    roughness: 0.25,
    metalness: 0.22,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });

  // Door materials
  const doorPalettes = [0x8b3a32, 0x2f4f4f, 0x34495e, 0x5c4033, 0x465c4a, 0xd8d3c8];
  const doorMats = doorPalettes.map((col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.58 }));
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.75, roughness: 0.3 });

  // Furniture materials
  const sofaMats = [0x7e756b, 0x364d6b, 0x5b7364, 0x7a3b3e, 0x8f7e6a].map(
    (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.88, emissive: 0xffe4bc, emissiveIntensity: 0.08 })
  );
  const pillowMat = new THREE.MeshStandardMaterial({ color: 0xd9a74a, roughness: 0.85, emissive: 0xffe0a8, emissiveIntensity: 0.08 });
  const woodDarkMat = new THREE.MeshStandardMaterial({ color: 0x6e4728, roughness: 0.65, emissive: 0x4a2f16, emissiveIntensity: 0.08 });
  const woodOakMat = new THREE.MeshStandardMaterial({ color: 0xa66e3e, roughness: 0.62, emissive: 0x664020, emissiveIntensity: 0.08 });
  const cabWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.45, emissive: 0xffe8c8, emissiveIntensity: 0.10 });
  const counterDarkMat = new THREE.MeshStandardMaterial({ color: 0x3a3b3d, roughness: 0.35, metalness: 0.15 });
  const counterLightMat = new THREE.MeshStandardMaterial({ color: 0xe6e4df, roughness: 0.32 });
  const stainlessMat = new THREE.MeshStandardMaterial({ color: 0xc5cbd1, metalness: 0.65, roughness: 0.28 });
  const applianceWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.38 });
  const tvBodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5 });
  const rugMat = new THREE.MeshStandardMaterial({ map: rugTex, roughness: 0.92, emissive: 0xffe4bc, emissiveIntensity: 0.08 });
  const artMat = new THREE.MeshStandardMaterial({ map: artTex, roughness: 0.6, emissive: 0xffe4bc, emissiveIntensity: 0.10 });
  const plantPotMat = new THREE.MeshStandardMaterial({ color: 0xb55d38, roughness: 0.82 });
  const plantLeafMat = new THREE.MeshStandardMaterial({ color: 0x3e7d3b, roughness: 0.78 });
  const lampShadeMat = new THREE.MeshStandardMaterial({
    color: 0xfff3d6,
    emissive: 0xffcf78,
    emissiveIntensity: 0.75,
    roughness: 0.6,
  });
  const pendantBulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff8e6,
    emissive: 0xffd27a,
    emissiveIntensity: 0.95,
    roughness: 0.2,
  });
  const fireplaceBrickMat = new THREE.MeshStandardMaterial({ color: 0x8f4938, roughness: 0.88 });
  const fireGlowMat = new THREE.MeshStandardMaterial({
    color: 0xff9233,
    emissive: 0xff6a1a,
    emissiveIntensity: 1.4,
    roughness: 0.3,
  });

  // Upstairs bedroom, office & bathroom materials
  const porcelainMat = new THREE.MeshStandardMaterial({
    color: 0xf7f9fa,
    roughness: 0.24,
    metalness: 0.08,
    emissive: 0xffe8cc,
    emissiveIntensity: 0.08,
  });
  const mirrorMat = new THREE.MeshStandardMaterial({
    color: 0xb8d4e8,
    roughness: 0.06,
    metalness: 0.85,
  });
  const bedSheetMat = new THREE.MeshStandardMaterial({
    color: 0xf5f2eb,
    roughness: 0.88,
    emissive: 0xffe8c8,
    emissiveIntensity: 0.08,
  });
  const duvetMats = [0x3b5978, 0x5c7a67, 0x854247, 0x8c7a64, 0x4b5c7a].map(
    (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.88, emissive: 0xffe4bc, emissiveIntensity: 0.08 })
  );
  const bookMats = [0xb84032, 0x2e649c, 0x3b7a4a, 0xd69a32, 0x6f4a85].map(
    (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.8 })
  );

  // Resident materials
  const resFaceMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.72, emissive: 0xffe4bc, emissiveIntensity: 0.08 });
  const resSkinMat = new THREE.MeshStandardMaterial({ color: 0xebbfa4, roughness: 0.75 });
  const resHairMats = [0x3d2a1d, 0x6b4a2b, 0x1f1d1b, 0x8c6d46, 0x9c9ca0].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 })
  );
  const resShirtMats = [0xc94a38, 0x2f6ba8, 0x3e7d58, 0xd49635, 0x7b4c8c, 0xd8d3c8, 0xb8526e].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.82, emissive: 0xffe4bc, emissiveIntensity: 0.06 })
  );
  const resPantsMats = [0x2e435e, 0x3b3d42, 0x5c5346, 0x263242].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.88 })
  );

  // Backyard materials
  const deckWoodMat = new THREE.MeshStandardMaterial({
    map: texLib?.cedarPlankTex || texLib?.woodFenceTex || null,
    color: 0x9b7e5e,
    roughness: 0.84,
  });
  const bbqMat = new THREE.MeshStandardMaterial({ color: 0x26282a, roughness: 0.48, metalness: 0.45 });
  const patioTableMat = new THREE.MeshStandardMaterial({ color: 0x4b4e52, roughness: 0.55, metalness: 0.3 });
  const umbrellaMats = [0xc84b31, 0x2e5266, 0x3a6b4c, 0xd8cebe].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.78, side: THREE.DoubleSide })
  );
  const poolWallMat = new THREE.MeshStandardMaterial({ color: 0xb9b5ac, roughness: 0.45, metalness: 0.25 });
  const poolRimMat = new THREE.MeshStandardMaterial({ color: 0xdcdad2, roughness: 0.4 });
  const poolWaterMat = new THREE.MeshStandardMaterial({
    map: null,
    color: 0x3895c4,
    roughness: 0.16,
    metalness: 0.15,
  });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x7c7a75, roughness: 0.92 });
  const adirondackMat = new THREE.MeshStandardMaterial({ color: 0x39684b, roughness: 0.72 });
  const soilMat = new THREE.MeshStandardMaterial({
    map: texLib?.mulchTex || null,
    color: 0x4f3a28,
    roughness: 0.95,
  });
  const swingFrameMat = new THREE.MeshStandardMaterial({ color: 0x2e6ba8, roughness: 0.5, metalness: 0.35 });
  const swingSeatMat = new THREE.MeshStandardMaterial({ color: 0xd94132, roughness: 0.6 });

  // Christmas shared materials
  const xmasPineMat = new THREE.MeshStandardMaterial({ color: 0x1e5c2b, roughness: 0.85 });
  const xmasStarMat = new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xffcc33, emissiveIntensity: 1.6 });
  const xmasBulbMats = [0xff3b3b, 0x38d966, 0x3b8eff, 0xffd43b, 0xff59c7].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.3 })
  );

  // Roof materials (one per shingle texture so Winter swap updates all roofs in O(shingleCount)!)
  const shingleTexList = texLib?.shingleTextures?.length ? texLib.shingleTextures : [null];
  const roofMats = shingleTexList.map(
    (t) => new THREE.MeshStandardMaterial({ map: t, color: 0xffffff, roughness: 0.88 })
  );

  cachedAssets = {
    oakTex,
    tileTex,
    rugTex,
    tvTex,
    artTex,
    faceTex,
    clearGlassMat,
    patioGlassMat,
    intWallMats,
    ceilingMat,
    oakFloorMat,
    tileFloorMat,
    garageFloorMat,
    trimMat,
    darkTrimMat,
    foundMat,
    concreteMat,
    sidingMats,
    brickMats,
    upperWinMat,
    doorMats,
    brassMat,
    sofaMats,
    pillowMat,
    woodDarkMat,
    woodOakMat,
    cabWhiteMat,
    counterDarkMat,
    counterLightMat,
    stainlessMat,
    applianceWhiteMat,
    tvBodyMat,
    rugMat,
    artMat,
    plantPotMat,
    plantLeafMat,
    lampShadeMat,
    pendantBulbMat,
    fireplaceBrickMat,
    fireGlowMat,
    porcelainMat,
    mirrorMat,
    bedSheetMat,
    duvetMats,
    bookMats,
    resFaceMat,
    resSkinMat,
    resHairMats,
    resShirtMats,
    resPantsMats,
    deckWoodMat,
    bbqMat,
    patioTableMat,
    umbrellaMats,
    poolWallMat,
    poolRimMat,
    poolWaterMat,
    stoneMat,
    adirondackMat,
    soilMat,
    swingFrameMat,
    swingSeatMat,
    xmasPineMat,
    xmasStarMat,
    xmasBulbMats,
    roofMats,
    texLib,
  };
  return cachedAssets;
}

// Helper: Box mesh with world-scaled UVs
function makeWorldBox(sx, sy, sz, mat, uvScale = 0.5) {
  const g = setWorldBoxUVs(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, uvScale);
  return new THREE.Mesh(g, mat);
}

// Helper: convert local (u, v) in a building OBB to world [wx, wz]
function localToWorld(cx, cz, cosA, sinA, u, v) {
  return [cx + cosA * u - sinA * v, cz + sinA * u + cosA * v];
}

// Helper: convert local wall segments into world-space OBB colliders [wx, wz, halfLen, halfThick, rotY, minY?, maxY?]
// Matches simulation.js createCollider: addOBB(wx, wz, halfLen, halfThick, Math.cos(rotY), -Math.sin(rotY), 'wall', minY, maxY)
export function wallSegmentsToWorldColliders(wallSegments, cx, cz, ang, elev = 0) {
  const cosA = Math.cos(ang);
  const sinA = Math.sin(ang);
  const out = [];
  for (const seg of wallSegments) {
    const [wx, wz] = localToWorld(cx, cz, cosA, sinA, seg.lx, seg.lz);
    const rotY = seg.axis === 'X' ? -ang : -ang - Math.PI * 0.5;
    if (seg.minY != null && seg.maxY != null) {
      out.push([wx, wz, seg.halfLen, seg.halfThick, rotY, elev + seg.minY, elev + seg.maxY]);
    } else {
      out.push([wx, wz, seg.halfLen, seg.halfThick, rotY]);
    }
  }
  return out;
}

/**
 * Builds one real hollow wall along either:
 *   axis === 'Z' (front +X or back -X wall, spanning local Z from spanMin..spanMax at x = wallPos)
 *   axis === 'X' (side -Z or +Z wall, spanning local X from spanMin..spanMax at z = wallPos)
 * with actual cutout openings for doors & windows!
 */
function buildCutoutWall({
  group,
  axis,
  wallPos,
  outSign,
  spanMin,
  spanMax,
  yBottom,
  yTop,
  openings,
  wallThick,
  extMat,
  intMat,
  trimMat,
  glassMat,
  wallSegmentsOut,
}) {
  const sorted = [...openings].sort((a, b) => a.center - b.center);
  const extT = wallThick * 0.55;
  const intT = wallThick * 0.45;
  const extOff = outSign * (wallThick * 0.5 - extT * 0.5);
  const intOff = -outSign * (wallThick * 0.5 - intT * 0.5);

  const addWallRect = (s0, s1, y0, y1) => {
    const len = s1 - s0;
    const h = y1 - y0;
    if (len < 0.04 || h < 0.04) return;
    const sMid = (s0 + s1) * 0.5;
    const yMid = (y0 + y1) * 0.5;

    if (axis === 'Z') {
      const mExt = makeWorldBox(extT, h, len, extMat, 0.35);
      mExt.position.set(wallPos + extOff, yMid, sMid);
      mExt.castShadow = true;
      mExt.receiveShadow = true;
      const mInt = new THREE.Mesh(new THREE.BoxGeometry(intT, h, len), intMat);
      mInt.position.set(wallPos + intOff, yMid, sMid);
      mInt.receiveShadow = true;
      group.add(mExt, mInt);
    } else {
      const mExt = makeWorldBox(len, h, extT, extMat, 0.35);
      mExt.position.set(sMid, yMid, wallPos + extOff);
      mExt.castShadow = true;
      mExt.receiveShadow = true;
      const mInt = new THREE.Mesh(new THREE.BoxGeometry(len, h, intT), intMat);
      mInt.position.set(sMid, yMid, wallPos + intOff);
      mInt.receiveShadow = true;
      group.add(mExt, mInt);
    }
  };

  const addWindowAssembly = (s0, s1, y0, y1) => {
    const w = s1 - s0;
    const h = y1 - y0;
    const sMid = (s0 + s1) * 0.5;
    const yMid = (y0 + y1) * 0.5;
    const frameD = wallThick + 0.05;
    const fT = 0.08;

    const wg = new THREE.Group();
    if (axis === 'Z') {
      wg.position.set(wallPos, yMid, sMid);
      // Top & bottom frame + exterior sill
      const topF = new THREE.Mesh(new THREE.BoxGeometry(frameD, fT, w + 0.14), trimMat);
      topF.position.y = h * 0.5 + fT * 0.3;
      const botF = new THREE.Mesh(new THREE.BoxGeometry(frameD + 0.06, fT, w + 0.18), trimMat);
      botF.position.set(outSign * 0.02, -h * 0.5 - fT * 0.3, 0);
      // Left & right jambs
      const lF = new THREE.Mesh(new THREE.BoxGeometry(frameD, h, fT), trimMat);
      lF.position.z = -w * 0.5 - fT * 0.25;
      const rF = new THREE.Mesh(new THREE.BoxGeometry(frameD, h, fT), trimMat);
      rF.position.z = w * 0.5 + fT * 0.25;
      // Thin crisp muntin cross
      const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.03, h, 0.035), trimMat);
      const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, w), trimMat);
      hBar.position.y = 0.08;
      // Real transparent see-through glass pane
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
      glass.rotation.y = Math.PI * 0.5;
      wg.add(topF, botF, lF, rF, vBar, hBar, glass);
    } else {
      wg.position.set(sMid, yMid, wallPos);
      const topF = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, fT, frameD), trimMat);
      topF.position.y = h * 0.5 + fT * 0.3;
      const botF = new THREE.Mesh(new THREE.BoxGeometry(w + 0.18, fT, frameD + 0.06), trimMat);
      botF.position.set(0, -h * 0.5 - fT * 0.3, outSign * 0.02);
      const lF = new THREE.Mesh(new THREE.BoxGeometry(fT, h, frameD), trimMat);
      lF.position.x = -w * 0.5 - fT * 0.25;
      const rF = new THREE.Mesh(new THREE.BoxGeometry(fT, h, frameD), trimMat);
      rF.position.x = w * 0.5 + fT * 0.25;
      const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.035, h, 0.03), trimMat);
      const hBar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, 0.03), trimMat);
      hBar.position.y = 0.08;
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
      wg.add(topF, botF, lF, rF, vBar, hBar, glass);
    }
    group.add(wg);
  };

  const addDoorFrame = (s0, s1, y0, y1) => {
    const w = s1 - s0;
    const h = y1 - y0;
    const sMid = (s0 + s1) * 0.5;
    const yMid = (y0 + y1) * 0.5;
    const frameD = wallThick + 0.04;
    const fT = 0.08;
    if (axis === 'Z') {
      const topF = new THREE.Mesh(new THREE.BoxGeometry(frameD, fT, w + 0.16), trimMat);
      topF.position.set(wallPos, y1 + fT * 0.35, sMid);
      const lF = new THREE.Mesh(new THREE.BoxGeometry(frameD, h, fT), trimMat);
      lF.position.set(wallPos, yMid, s0 - fT * 0.35);
      const rF = new THREE.Mesh(new THREE.BoxGeometry(frameD, h, fT), trimMat);
      rF.position.set(wallPos, yMid, s1 + fT * 0.35);
      group.add(topF, lF, rF);
    } else {
      const topF = new THREE.Mesh(new THREE.BoxGeometry(w + 0.16, fT, frameD), trimMat);
      topF.position.set(sMid, y1 + fT * 0.35, wallPos);
      const lF = new THREE.Mesh(new THREE.BoxGeometry(fT, h, frameD), trimMat);
      lF.position.set(s0 - fT * 0.35, yMid, wallPos);
      const rF = new THREE.Mesh(new THREE.BoxGeometry(fT, h, frameD), trimMat);
      rF.position.set(s1 + fT * 0.35, yMid, wallPos);
      group.add(topF, lF, rF);
    }
  };

  // Build visual wall segments around ALL openings (doors + windows)
  let cursor = spanMin;
  for (const op of sorted) {
    const o0 = Math.max(spanMin + 0.12, op.center - op.width * 0.5);
    const o1 = Math.min(spanMax - 0.12, op.center + op.width * 0.5);
    if (o1 <= o0 + 0.1) continue;
    if (o0 > cursor) addWallRect(cursor, o0, yBottom, yTop);
    if (op.yMin > yBottom + 0.03) addWallRect(o0, o1, yBottom, op.yMin);
    if (op.yMax < yTop - 0.03) addWallRect(o0, o1, op.yMax, yTop);
    if (op.kind === 'window') {
      addWindowAssembly(o0, o1, op.yMin, op.yMax);
    } else {
      addDoorFrame(o0, o1, op.yMin, op.yMax);
    }
    cursor = Math.max(cursor, o1);
  }
  if (cursor < spanMax) addWallRect(cursor, spanMax, yBottom, yTop);

  // Build thin wall collider segments split ONLY around walkable door/patio openings
  const doorOpenings = sorted.filter((op) => op.kind === 'door' || op.kind === 'patio');
  let colCursor = spanMin;
  const halfThick = Math.max(0.14, wallThick * 0.55);
  const pushColSeg = (a, b) => {
    const len = b - a;
    if (len < 0.12) return;
    const mid = (a + b) * 0.5;
    wallSegmentsOut.push({
      axis,
      lx: axis === 'Z' ? wallPos : mid,
      lz: axis === 'Z' ? mid : wallPos,
      halfLen: len * 0.5,
      halfThick,
    });
  };
  for (const op of doorOpenings) {
    const gap0 = op.center - op.width * 0.5;
    const gap1 = op.center + op.width * 0.5;
    if (gap0 > colCursor) pushColSeg(colCursor, gap0);
    colCursor = Math.max(colCursor, gap1);
  }
  if (colCursor < spanMax) pushColSeg(colCursor, spanMax);
}

/**
 * 1. Reusable Hollow Building Shell Builder
 * Builds a hollow 1-storey or 2-storey house shell around (0, 0) in local OBB coords (d along X, w along Z)
 * with actual cutout openings for front door, back patio door, and see-through windows.
 */
export function createHollowShell(opts = {}) {
  const {
    d = 9.0,
    w = 12.0,
    floorY = 0.38,
    groundH = 2.75,
    upperH = 0,
    roofH = 1.85,
    isHip = false,
    wallThick = 0.24,
    frontDoorW = 1.48,
    frontDoorH = 2.25,
    backDoorW = 1.85,
    backDoorH = 2.20,
    hasBackDoor = true,
    isGarage = false,
    includeRoof = true,
    includeFoundation = true,
    includeFrontSteps = true,
    includeUpperWindows = true,
    seed = 1,
    texLib = null,
    worldTransform = null,
  } = opts;

  const assets = getSharedAssets(texLib);
  const rng = makeRng(seed);
  const group = new THREE.Group();

  const halfD = d * 0.5;
  const halfW = w * 0.5;
  const ceilingY = floorY + groundH;

  const extMat =
    opts.exteriorMat ||
    (seed % 3 === 0
      ? assets.brickMats[seed % assets.brickMats.length]
      : assets.sidingMats[seed % assets.sidingMats.length]);
  const upperExtMat =
    opts.upperExteriorMat ||
    (upperH > 0 && seed % 2 === 0
      ? assets.sidingMats[(seed + 1) % assets.sidingMats.length]
      : extMat);
  const intWallMat = opts.interiorWallMat || assets.intWallMats[seed % assets.intWallMats.length];
  const trimMat = opts.trimMat || assets.trimMat;
  const roofMat = opts.roofMat || assets.roofMats[seed % assets.roofMats.length];

  // Clamp door Z positions safely inside the walls
  const maxDoorZ = Math.max(0, halfW - 1.5);
  const defaultFrontZ = opts.frontDoorZ !== undefined ? opts.frontDoorZ : Math.min(maxDoorZ, Math.max(-maxDoorZ, w > 9 ? -w * 0.22 : 0));
  const defaultBackZ = opts.backDoorZ !== undefined ? opts.backDoorZ : Math.min(maxDoorZ, Math.max(-maxDoorZ, w > 9 ? w * 0.16 : 0));

  // 1. Concrete Foundation Plinth extending 1.5m below grade (prevents hillside floating)
  if (includeFoundation) {
    const foundTotalH = floorY + 1.5;
    const found = makeWorldBox(d + 0.08, foundTotalH, w + 0.08, assets.foundMat, 0.4);
    found.position.set(0, -1.5 + foundTotalH * 0.5, 0);
    found.castShadow = true;
    found.receiveShadow = true;
    group.add(found);
  }

  // 2. Interior Floor Slab (front oak hardwood + rear ceramic kitchen tile, or concrete for garage)
  const innerD = Math.max(1.5, d - wallThick * 1.8);
  const innerW = Math.max(1.5, w - wallThick * 1.8);
  if (isGarage) {
    const gFloor = makeWorldBox(innerD, 0.08, innerW, assets.garageFloorMat, 0.5);
    gFloor.position.set(0, floorY - 0.04, 0);
    gFloor.receiveShadow = true;
    group.add(gFloor);
  } else {
    const frontZoneD = innerD * 0.52;
    const backZoneD = innerD - frontZoneD;
    const frontFloor = makeWorldBox(frontZoneD, 0.08, innerW, assets.oakFloorMat, 0.55);
    frontFloor.position.set(innerD * 0.5 - frontZoneD * 0.5, floorY - 0.04, 0);
    frontFloor.receiveShadow = true;

    const backFloor = makeWorldBox(backZoneD, 0.08, innerW, assets.tileFloorMat, 0.65);
    backFloor.position.set(-innerD * 0.5 + backZoneD * 0.5, floorY - 0.04, 0);
    backFloor.receiveShadow = true;
    group.add(frontFloor, backFloor);
  }

  // 3. Interior Ceiling Slab at ceilingY (+ Stairwell Cutout & Wooden Staircase for 2-Storey Homes!)
  const hasUpperFloor = upperH > 0.2 && !isGarage;
  const slabThick = 0.14;
  const upperFloorY = hasUpperFloor ? ceilingY + slabThick : null;
  const upperCeilingY = hasUpperFloor ? upperFloorY + upperH : null;

  let stair = null;
  let stairwell = null;
  let stairSide = 0;

  if (hasUpperFloor) {
    // Place staircase along one side wall clear of front/back doors (entry-hall side by default)
    stairSide = opts.stairSide === 1 || opts.stairSide === -1 ? opts.stairSide : defaultFrontZ <= 0 ? -1 : 1;
    const stairW = Math.min(1.18, Math.max(0.96, w * 0.13));
    const stairRun = Math.min(3.55, Math.max(2.6, d - 3.1));
    const uStart = Math.min(halfD - 1.45, stairRun * 0.5);
    const uEnd = Math.max(-halfD + 1.45, uStart - stairRun);
    const vMin = stairSide < 0 ? -halfW + wallThick + 0.04 : halfW - wallThick - 0.04 - stairW;
    const vMax = vMin + stairW;

    stair = {
      axis: 'x',
      start: uStart,
      end: uEnd,
      crossMin: vMin,
      crossMax: vMax,
      y0: floorY,
      y1: upperFloorY,
    };
    stairwell = {
      uMin: Math.min(uStart, uEnd) - 0.12,
      uMax: Math.max(uStart, uEnd) + 0.12,
      vMin: vMin - 0.04,
      vMax: vMax + 0.04,
    };

    // Build 1st-floor ceiling + 2nd-floor oak hardwood floor from 4 slabs surrounding the rectangular stairwell cutout
    const inUMin = -halfD + 0.04;
    const inUMax = halfD - 0.04;
    const inVMin = -halfW + 0.04;
    const inVMax = halfW - 0.04;
    const addFloorCeilingPiece = (u0, u1, v0, v1) => {
      const lenU = u1 - u0;
      const lenV = v1 - v0;
      if (lenU < 0.06 || lenV < 0.06) return;
      const mu = (u0 + u1) * 0.5;
      const mv = (v0 + v1) * 0.5;
      // White 1st-floor ceiling underside
      const cMesh = new THREE.Mesh(new THREE.BoxGeometry(lenU, 0.06, lenV), assets.ceilingMat);
      cMesh.position.set(mu, ceilingY + 0.03, mv);
      cMesh.receiveShadow = true;
      // Warm honey oak 2nd-floor hardwood top
      const fMesh = makeWorldBox(lenU, 0.08, lenV, assets.oakFloorMat, 0.55);
      fMesh.position.set(mu, ceilingY + 0.10, mv);
      fMesh.receiveShadow = true;
      group.add(cMesh, fMesh);
    };

    addFloorCeilingPiece(stairwell.uMax, inUMax, inVMin, inVMax); // Front of stairwell
    addFloorCeilingPiece(inUMin, stairwell.uMin, inVMin, inVMax); // Back of stairwell
    addFloorCeilingPiece(stairwell.uMin, stairwell.uMax, inVMin, stairwell.vMin); // -Z beside stairwell
    addFloorCeilingPiece(stairwell.uMin, stairwell.uMax, stairwell.vMax, inVMax); // +Z beside stairwell

    // Build Interior Wooden Staircase (13 treads + risers + stringers + handrail & balusters)
    const nSteps = 13;
    const totalRise = upperFloorY - floorY;
    const stepRise = totalRise / nSteps;
    const stepRun = (uEnd - uStart) / nSteps; // negative (rising toward -X)
    const absRun = Math.abs(stepRun);
    const vMid = (vMin + vMax) * 0.5;

    for (let s = 0; s < nSteps; s++) {
      const treadY = floorY + (s + 1) * stepRise;
      const treadU = uStart + (s + 0.5) * stepRun;
      // Oak tread
      const tread = new THREE.Mesh(new THREE.BoxGeometry(absRun + 0.04, 0.055, stairW), assets.woodOakMat);
      tread.position.set(treadU, treadY - 0.025, vMid);
      tread.receiveShadow = true;
      // White riser
      const riser = new THREE.Mesh(new THREE.BoxGeometry(0.035, stepRise, stairW - 0.02), trimMat);
      riser.position.set(uStart + s * stepRun, treadY - stepRise * 0.5, vMid);
      group.add(tread, riser);
    }

    // Sloped dark-wood stringers on both sides of the staircase
    const runLen = Math.hypot(Math.abs(uEnd - uStart), totalRise);
    const slopeAng = Math.atan2(totalRise, Math.abs(uEnd - uStart)); // rises as X decreases -> +Z rotation
    const midU = (uStart + uEnd) * 0.5;
    const midY = (floorY + upperFloorY) * 0.5;
    for (const sv of [vMin + 0.03, vMax - 0.03]) {
      const stringer = new THREE.Mesh(new THREE.BoxGeometry(runLen + 0.1, 0.22, 0.06), assets.woodDarkMat);
      stringer.position.set(midU, midY - 0.12, sv);
      stringer.rotation.z = -slopeAng;
      group.add(stringer);
    }

    // Open-side handrail + balusters + newel posts (on the side facing room center)
    const railV = stairSide < 0 ? vMax - 0.04 : vMin + 0.04;
    const railH = 0.88;
    const handrail = new THREE.Mesh(new THREE.BoxGeometry(runLen + 0.16, 0.065, 0.075), assets.woodDarkMat);
    handrail.position.set(midU, midY + railH, railV);
    handrail.rotation.z = -slopeAng;
    group.add(handrail);

    // Bottom & top newel posts
    const botNewel = new THREE.Mesh(new THREE.BoxGeometry(0.09, railH + 0.14, 0.09), assets.woodDarkMat);
    botNewel.position.set(uStart + 0.04, floorY + (railH + 0.14) * 0.5, railV);
    const topNewel = new THREE.Mesh(new THREE.BoxGeometry(0.09, railH + 0.14, 0.09), assets.woodDarkMat);
    topNewel.position.set(uEnd - 0.04, upperFloorY + (railH + 0.14) * 0.5, railV);
    group.add(botNewel, topNewel);

    // Vertical balusters along the stair run
    for (let b = 1; b < nSteps; b += 2) {
      const bu = uStart + (b + 0.5) * stepRun;
      const by = floorY + (b + 1) * stepRise;
      const bal = new THREE.Mesh(new THREE.BoxGeometry(0.035, railH, 0.035), trimMat);
      bal.position.set(bu, by + railH * 0.5, railV);
      group.add(bal);
    }

    // 2nd-floor stairwell safety guardrail along the open long edge & front (bottom-end) edge,
    // leaving the top-end edge (uEnd) completely open to walk onto the 2nd floor!
    const guardH = 0.90;
    const guardV = stairSide < 0 ? stairwell.vMax + 0.04 : stairwell.vMin - 0.04;
    const longGuardLen = stairwell.uMax - stairwell.uMin;
    const longGuardMidU = (stairwell.uMax + stairwell.uMin) * 0.5;
    const longTopRail = new THREE.Mesh(new THREE.BoxGeometry(longGuardLen + 0.08, 0.06, 0.07), assets.woodDarkMat);
    longTopRail.position.set(longGuardMidU, upperFloorY + guardH, guardV);
    const longMidRail = new THREE.Mesh(new THREE.BoxGeometry(longGuardLen, 0.04, 0.04), trimMat);
    longMidRail.position.set(longGuardMidU, upperFloorY + guardH * 0.48, guardV);
    group.add(longTopRail, longMidRail);
    const nGuardPosts = Math.max(3, Math.round(longGuardLen / 0.75) + 1);
    for (let gp = 0; gp < nGuardPosts; gp++) {
      const pu = stairwell.uMin + (gp / (nGuardPosts - 1)) * longGuardLen;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.045, guardH, 0.045), trimMat);
      post.position.set(pu, upperFloorY + guardH * 0.5, guardV);
      group.add(post);
    }
    // End guardrail at uMax (above bottom of stairs)
    const endGuardLen = stairwell.vMax - stairwell.vMin;
    const endTopRail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, endGuardLen + 0.08), assets.woodDarkMat);
    endTopRail.position.set(stairwell.uMax + 0.04, upperFloorY + guardH, vMid);
    const endMidRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, endGuardLen), trimMat);
    endMidRail.position.set(stairwell.uMax + 0.04, upperFloorY + guardH * 0.48, vMid);
    const cornerPost = new THREE.Mesh(new THREE.BoxGeometry(0.08, guardH + 0.06, 0.08), assets.woodDarkMat);
    cornerPost.position.set(stairwell.uMax + 0.04, upperFloorY + (guardH + 0.06) * 0.5, guardV);
    group.add(endTopRail, endMidRail, cornerPost);
  } else {
    const ceilSlab = new THREE.Mesh(new THREE.BoxGeometry(d - 0.04, slabThick, w - 0.04), assets.ceilingMat);
    ceilSlab.position.set(0, ceilingY + 0.05, 0);
    ceilSlab.receiveShadow = true;
    group.add(ceilSlab);
  }

  // 4. Plan Cutout Openings for all 4 walls
  const winBottom = floorY + 0.82;
  const winTop = Math.min(ceilingY - 0.25, floorY + 2.28);

  const frontOpenings = [
    { center: defaultFrontZ, width: frontDoorW, yMin: floorY, yMax: floorY + frontDoorH, kind: 'door' },
  ];
  if (Array.isArray(opts.frontWindows)) {
    for (const fw of opts.frontWindows) {
      frontOpenings.push({
        center: fw.z,
        width: fw.w,
        yMin: fw.yBottom ?? winBottom,
        yMax: (fw.yBottom ?? winBottom) + (fw.h ?? 1.44),
        kind: 'window',
      });
    }
  } else if (!isGarage) {
    // Auto-place a wide living-room picture window on the wide side of the front door + optional secondary window
    const spacePos = halfW - (defaultFrontZ + frontDoorW * 0.5);
    const spaceNeg = (defaultFrontZ - frontDoorW * 0.5) - (-halfW);
    if (spacePos >= 2.2) {
      const picW = Math.min(2.9, spacePos - 1.0);
      const picZ = defaultFrontZ + frontDoorW * 0.5 + spacePos * 0.5;
      frontOpenings.push({ center: picZ, width: picW, yMin: winBottom, yMax: winTop, kind: 'window' });
    }
    if (spaceNeg >= 2.1) {
      const w2 = Math.min(2.2, spaceNeg - 0.9);
      const z2 = -halfW + spaceNeg * 0.5;
      frontOpenings.push({ center: z2, width: w2, yMin: winBottom, yMax: winTop, kind: 'window' });
    }
  }

  const backOpenings = [];
  if (hasBackDoor && !isGarage) {
    backOpenings.push({
      center: defaultBackZ,
      width: backDoorW,
      yMin: floorY,
      yMax: floorY + backDoorH,
      kind: 'patio',
    });
  }
  if (Array.isArray(opts.backWindows)) {
    for (const bw of opts.backWindows) {
      backOpenings.push({
        center: bw.z,
        width: bw.w,
        yMin: bw.yBottom ?? winBottom,
        yMax: (bw.yBottom ?? winBottom) + (bw.h ?? 1.38),
        kind: 'window',
      });
    }
  } else if (!isGarage) {
    const bSpaceNeg = (defaultBackZ - backDoorW * 0.5) - (-halfW);
    const bSpacePos = halfW - (defaultBackZ + backDoorW * 0.5);
    if (bSpaceNeg >= 2.2) {
      const kw = Math.min(2.4, bSpaceNeg - 0.95);
      backOpenings.push({ center: -halfW + bSpaceNeg * 0.5, width: kw, yMin: floorY + 1.02, yMax: winTop, kind: 'window' });
    }
    if (bSpacePos >= 2.2) {
      const kw = Math.min(2.2, bSpacePos - 0.95);
      backOpenings.push({ center: halfW - bSpacePos * 0.5, width: kw, yMin: floorY + 0.92, yMax: winTop, kind: 'window' });
    }
  }

  // Side windows (-Z and +Z walls)
  const buildSideWinList = (customList) => {
    if (Array.isArray(customList)) {
      return customList.map((sw) => ({
        center: sw.x,
        width: sw.w,
        yMin: sw.yBottom ?? winBottom,
        yMax: (sw.yBottom ?? winBottom) + (sw.h ?? 1.35),
        kind: 'window',
      }));
    }
    const list = [];
    if (d >= 7.2) {
      list.push({ center: d * 0.22, width: 1.65, yMin: winBottom + 0.08, yMax: winTop, kind: 'window' });
      list.push({ center: -d * 0.22, width: 1.55, yMin: winBottom + 0.08, yMax: winTop, kind: 'window' });
    } else if (d >= 4.5) {
      list.push({ center: 0, width: 1.55, yMin: winBottom + 0.08, yMax: winTop, kind: 'window' });
    }
    return list;
  };
  const negZOpenings = buildSideWinList(opts.sideWindows?.negZ);
  const posZOpenings = buildSideWinList(opts.sideWindows?.posZ);

  const wallSegments = [];

  // Build all 4 hollow cutout walls
  buildCutoutWall({
    group,
    axis: 'Z',
    wallPos: halfD - wallThick * 0.5,
    outSign: 1,
    spanMin: -halfW,
    spanMax: halfW,
    yBottom: floorY,
    yTop: ceilingY,
    openings: frontOpenings,
    wallThick,
    extMat,
    intMat: intWallMat,
    trimMat,
    glassMat: assets.clearGlassMat,
    wallSegmentsOut: wallSegments,
  });
  buildCutoutWall({
    group,
    axis: 'Z',
    wallPos: -halfD + wallThick * 0.5,
    outSign: -1,
    spanMin: -halfW,
    spanMax: halfW,
    yBottom: floorY,
    yTop: ceilingY,
    openings: backOpenings,
    wallThick,
    extMat,
    intMat: intWallMat,
    trimMat,
    glassMat: assets.clearGlassMat,
    wallSegmentsOut: wallSegments,
  });
  buildCutoutWall({
    group,
    axis: 'X',
    wallPos: -halfW + wallThick * 0.5,
    outSign: -1,
    spanMin: -halfD + wallThick,
    spanMax: halfD - wallThick,
    yBottom: floorY,
    yTop: ceilingY,
    openings: negZOpenings,
    wallThick,
    extMat,
    intMat: intWallMat,
    trimMat,
    glassMat: assets.clearGlassMat,
    wallSegmentsOut: wallSegments,
  });
  buildCutoutWall({
    group,
    axis: 'X',
    wallPos: halfW - wallThick * 0.5,
    outSign: 1,
    spanMin: -halfD + wallThick,
    spanMax: halfD - wallThick,
    yBottom: floorY,
    yTop: ceilingY,
    openings: posZOpenings,
    wallThick,
    extMat,
    intMat: intWallMat,
    trimMat,
    glassMat: assets.clearGlassMat,
    wallSegmentsOut: wallSegments,
  });

  // 5. Auto-Opening Front Swinging Door (+X wall)
  const doors = [];
  const doorMat = assets.doorMats[seed % assets.doorMats.length];
  const frontPivot = new THREE.Group();
  const frontLeafW = frontDoorW - 0.08;
  const frontLeafH = frontDoorH - 0.04;
  // Hinge at z = defaultFrontZ - frontDoorW/2 + 0.04, swings INWARD (-X)
  frontPivot.position.set(halfD - wallThick * 0.5, floorY, defaultFrontZ - frontDoorW * 0.5 + 0.04);
  const fDoorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.07, frontLeafH, frontLeafW), doorMat);
  fDoorPanel.position.set(0, frontLeafH * 0.5, frontLeafW * 0.5);
  fDoorPanel.castShadow = true;
  // Decorative glass lite in upper front door
  const fDoorGlass = new THREE.Mesh(new THREE.PlaneGeometry(frontLeafW * 0.55, 0.58), assets.clearGlassMat);
  fDoorGlass.rotation.y = Math.PI * 0.5;
  fDoorGlass.position.set(0.042, frontLeafH * 0.72, frontLeafW * 0.5);
  const fKnob = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.06), assets.brassMat);
  fKnob.position.set(0, 1.02, frontLeafW - 0.14);
  frontPivot.add(fDoorPanel, fDoorGlass, fKnob);
  group.add(frontPivot);

  const frontDoorRec = {
    type: 'swing',
    pivot: frontPivot,
    baseRotY: 0,
    openDir: -1, // rotates leaf from +Z toward -X (inward!)
    localX: halfD,
    localZ: defaultFrontZ,
    wx: 0,
    wz: 0,
    openT: 0,
  };
  doors.push(frontDoorRec);

  // 6. Auto-Opening Back Sliding Glass Patio Door (-X wall)
  if (hasBackDoor && !isGarage) {
    const panelW = backDoorW * 0.5;
    const panelH = backDoorH - 0.06;
    const backX = -halfD + wallThick * 0.5;

    const makePatioPanel = (zPos, xOff) => {
      const pg = new THREE.Group();
      pg.position.set(backX + xOff, floorY + panelH * 0.5 + 0.02, zPos);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(panelW - 0.12, panelH - 0.14), assets.patioGlassMat);
      glass.rotation.y = Math.PI * 0.5;
      const tBar = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.07, panelW), trimMat);
      tBar.position.y = panelH * 0.5 - 0.035;
      const bBar = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.07, panelW), trimMat);
      bBar.position.y = -panelH * 0.5 + 0.035;
      const lBar = new THREE.Mesh(new THREE.BoxGeometry(0.055, panelH, 0.07), trimMat);
      lBar.position.z = -panelW * 0.5 + 0.035;
      const rBar = new THREE.Mesh(new THREE.BoxGeometry(0.055, panelH, 0.07), trimMat);
      rBar.position.z = panelW * 0.5 - 0.035;
      pg.add(glass, tBar, bBar, lBar, rBar);
      return pg;
    };

    // Fixed panel on +Z half, sliding panel on -Z half (slides smoothly toward +Z to open!)
    const fixedPanel = makePatioPanel(defaultBackZ + panelW * 0.5, -0.025);
    const slidingPanel = makePatioPanel(defaultBackZ - panelW * 0.5, 0.03);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.24, 0.04), assets.darkTrimMat);
    handle.position.set(0, -0.06, -panelW * 0.5 + 0.12);
    slidingPanel.add(handle);
    group.add(fixedPanel, slidingPanel);

    doors.push({
      type: 'slide',
      panel: slidingPanel,
      closedZ: defaultBackZ - panelW * 0.5,
      slideDir: 1,
      doorW: backDoorW,
      localX: -halfD,
      localZ: defaultBackZ,
      wx: 0,
      wz: 0,
      openT: 0,
    });
  }

  // 7. Front Stoop & Entry Steps (+X outside front door) + Porch Light Sconce
  if (includeFrontSteps && floorY > 0.08) {
    const stoopW = frontDoorW + 0.7;
    const stoopD = 1.15;
    const stoop = makeWorldBox(stoopD, floorY + 0.35, stoopW, assets.concreteMat, 0.5);
    stoop.position.set(halfD + stoopD * 0.5, (floorY - 0.35) * 0.5, defaultFrontZ);
    stoop.receiveShadow = true;
    const step1 = makeWorldBox(0.45, Math.max(0.18, floorY * 0.55), stoopW * 0.92, assets.concreteMat, 0.5);
    step1.position.set(halfD + stoopD + 0.22, Math.max(0.09, floorY * 0.275), defaultFrontZ);
    step1.receiveShadow = true;
    group.add(stoop, step1);
  }

  // Porch sconce beside front door
  const sconceHousing = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.24, 0.14), assets.darkTrimMat);
  sconceHousing.position.set(halfD + 0.07, floorY + 1.92, defaultFrontZ + frontDoorW * 0.5 + 0.28);
  const sconceBulb = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.14, 0.10), assets.pendantBulbMat);
  sconceBulb.position.set(halfD + 0.10, floorY + 1.88, defaultFrontZ + frontDoorW * 0.5 + 0.28);
  group.add(sconceHousing, sconceBulb);

  // 8. Hollow 2nd Storey Exterior Walls with Cutout See-Through Windows + 2nd-Floor Ceiling
  let roofBaseY = ceilingY + 0.12;
  if (hasUpperFloor) {
    const upWinBot = upperFloorY + Math.min(0.78, upperH * 0.30);
    const upWinTop = Math.min(upperCeilingY - 0.22, upWinBot + Math.min(1.32, upperH * 0.52));

    const makeAutoUpperWindows = (span, customList, isSide = false) => {
      if (Array.isArray(customList)) {
        return customList.map((uw) => ({
          center: isSide ? uw.x : uw.z,
          width: uw.w,
          yMin: uw.yBottom ?? upWinBot,
          yMax: (uw.yBottom ?? upWinBot) + (uw.h ?? (upWinTop - upWinBot)),
          kind: 'window',
        }));
      }
      if (!includeUpperWindows) return [];
      const list = [];
      if (isSide) {
        if (span >= 7.2) {
          list.push({ center: span * 0.22, width: 1.42, yMin: upWinBot, yMax: upWinTop, kind: 'window' });
          list.push({ center: -span * 0.22, width: 1.38, yMin: upWinBot, yMax: upWinTop, kind: 'window' });
        } else if (span >= 4.5) {
          list.push({ center: 0, width: 1.4, yMin: upWinBot, yMax: upWinTop, kind: 'window' });
        }
      } else {
        const nWins = Math.max(2, Math.min(4, Math.floor(span / 3.3)));
        for (let i = 0; i < nWins; i++) {
          const wz = -span * 0.5 + ((i + 0.5) / nWins) * span;
          list.push({ center: wz, width: Math.min(1.55, span / nWins - 1.15), yMin: upWinBot, yMax: upWinTop, kind: 'window' });
        }
      }
      return list;
    };

    const upFrontOpens = makeAutoUpperWindows(w, opts.upperFrontWindows, false);
    const upBackOpens = makeAutoUpperWindows(w, opts.upperBackWindows, false);
    const upNegZOpens = makeAutoUpperWindows(d, opts.upperSideWindows?.negZ, true);
    const upPosZOpens = makeAutoUpperWindows(d, opts.upperSideWindows?.posZ, true);

    const dummyUpperSegs = [];
    buildCutoutWall({
      group,
      axis: 'Z',
      wallPos: halfD - wallThick * 0.5,
      outSign: 1,
      spanMin: -halfW,
      spanMax: halfW,
      yBottom: upperFloorY,
      yTop: upperCeilingY,
      openings: upFrontOpens,
      wallThick,
      extMat: upperExtMat,
      intMat: intWallMat,
      trimMat,
      glassMat: assets.clearGlassMat,
      wallSegmentsOut: dummyUpperSegs,
    });
    buildCutoutWall({
      group,
      axis: 'Z',
      wallPos: -halfD + wallThick * 0.5,
      outSign: -1,
      spanMin: -halfW,
      spanMax: halfW,
      yBottom: upperFloorY,
      yTop: upperCeilingY,
      openings: upBackOpens,
      wallThick,
      extMat: upperExtMat,
      intMat: intWallMat,
      trimMat,
      glassMat: assets.clearGlassMat,
      wallSegmentsOut: dummyUpperSegs,
    });
    buildCutoutWall({
      group,
      axis: 'X',
      wallPos: -halfW + wallThick * 0.5,
      outSign: -1,
      spanMin: -halfD + wallThick,
      spanMax: halfD - wallThick,
      yBottom: upperFloorY,
      yTop: upperCeilingY,
      openings: upNegZOpens,
      wallThick,
      extMat: upperExtMat,
      intMat: intWallMat,
      trimMat,
      glassMat: assets.clearGlassMat,
      wallSegmentsOut: dummyUpperSegs,
    });
    buildCutoutWall({
      group,
      axis: 'X',
      wallPos: halfW - wallThick * 0.5,
      outSign: 1,
      spanMin: -halfD + wallThick,
      spanMax: halfD - wallThick,
      yBottom: upperFloorY,
      yTop: upperCeilingY,
      openings: upPosZOpens,
      wallThick,
      extMat: upperExtMat,
      intMat: intWallMat,
      trimMat,
      glassMat: assets.clearGlassMat,
      wallSegmentsOut: dummyUpperSegs,
    });

    // Add 2nd-floor-only exterior wall colliders across the 1st-floor doorway gaps so upstairs is fully enclosed!
    const upHalfThick = Math.max(0.14, wallThick * 0.55);
    wallSegments.push({
      axis: 'Z',
      lx: halfD - wallThick * 0.5,
      lz: defaultFrontZ,
      halfLen: frontDoorW * 0.5,
      halfThick: upHalfThick,
      minY: upperFloorY,
      maxY: upperCeilingY,
    });
    if (hasBackDoor && !isGarage) {
      wallSegments.push({
        axis: 'Z',
        lx: -halfD + wallThick * 0.5,
        lz: defaultBackZ,
        halfLen: backDoorW * 0.5,
        halfThick: upHalfThick,
        minY: upperFloorY,
        maxY: upperCeilingY,
      });
    }

    // 2nd-floor ceiling slab right under the roof
    const upperCeilSlab = new THREE.Mesh(new THREE.BoxGeometry(d - 0.04, 0.12, w - 0.04), assets.ceilingMat);
    upperCeilSlab.position.set(0, upperCeilingY + 0.04, 0);
    upperCeilSlab.receiveShadow = true;
    group.add(upperCeilSlab);

    roofBaseY = upperCeilingY + 0.10;
  }

  // 9. Pitched Roof + Gable Ends + White Fascia Trim + Optional Chimney
  const christmasGroup = new THREE.Group();
  christmasGroup.visible = false;
  group.add(christmasGroup);

  if (includeRoof) {
    const overhang = 0.36;
    const roofMesh = new THREE.Mesh(createPitchedRoofGeometry(d, w, roofH, isHip, overhang), roofMat);
    roofMesh.position.y = roofBaseY;
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;

    const trimMesh = new THREE.Mesh(createRoofTrimGeometry(d, w, roofH, isHip, overhang), trimMat);
    trimMesh.position.y = roofBaseY;
    group.add(roofMesh, trimMesh);

    if (!isHip) {
      const gables = new THREE.Mesh(createGableEndsGeometry(d, w, roofH), upperExtMat);
      gables.position.y = roofBaseY;
      gables.castShadow = true;
      group.add(gables);
    }

    // Front-eave Christmas string lights
    const bulbSpacing = 0.78;
    const eaveX = halfD + overhang + 0.03;
    const eaveY = roofBaseY - 0.06;
    const nBulbs = Math.max(4, Math.floor((w + overhang * 2) / bulbSpacing));
    for (let i = 0; i <= nBulbs; i++) {
      const bz = -(halfW + overhang) + (i / nBulbs) * (w + overhang * 2);
      const bMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.11, 0.11),
        assets.xmasBulbMats[(i + seed) % assets.xmasBulbMats.length]
      );
      bMesh.position.set(eaveX, eaveY, bz);
      christmasGroup.add(bMesh);
    }
  }

  // Compute world-space door triggers & wall colliders if worldTransform was supplied
  let wallColliders = [];
  if (worldTransform) {
    const cosA = Math.cos(worldTransform.ang);
    const sinA = Math.sin(worldTransform.ang);
    for (const dr of doors) {
      const [wx, wz] = localToWorld(worldTransform.cx, worldTransform.cz, cosA, sinA, dr.localX, dr.localZ);
      dr.wx = wx;
      dr.wz = wz;
    }
    wallColliders = wallSegmentsToWorldColliders(
      wallSegments,
      worldTransform.cx,
      worldTransform.cz,
      worldTransform.ang,
      worldTransform.elev || 0
    );
  }

  return {
    group,
    doors,
    wallSegments,
    wallColliders,
    floorY,
    ceilingY,
    hasUpperFloor,
    upperFloorY,
    upperCeilingY,
    stair,
    stairwell,
    stairSide,
    frontDoorZ: defaultFrontZ,
    backDoorZ: defaultBackZ,
    christmasGroup,
    roofMats: [roofMat],
    rngUsed: rng(),
  };
}

/**
 * Helper: Build an articulated voxel indoor resident (head, torso, arms, legs)
 * in casual indoor Quebec clothing.
 */
function makeIndoorResident(assets, seed, pose = 'standing') {
  const rng = makeRng(seed);
  const root = new THREE.Group();

  const hairMat = assets.resHairMats[Math.floor(rng() * assets.resHairMats.length)];
  const shirtMat = assets.resShirtMats[Math.floor(rng() * assets.resShirtMats.length)];
  const pantsMat = assets.resPantsMats[Math.floor(rng() * assets.resPantsMats.length)];

  // Legs (pivoted at hip y = 0.72)
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(0, 0.72, -0.10);
  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.72, 0.17), pantsMat);
  leftLeg.position.y = -0.36;
  leftLegPivot.add(leftLeg);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0, 0.72, 0.10);
  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.72, 0.17), pantsMat);
  rightLeg.position.y = -0.36;
  rightLegPivot.add(rightLeg);

  // Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.56, 0.38), shirtMat);
  torso.position.y = 1.00;

  // Arms (pivoted at shoulder y = 1.24)
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(0, 1.24, -0.26);
  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.52, 0.14), shirtMat);
  leftArm.position.y = -0.24;
  const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), assets.resSkinMat);
  leftHand.position.y = -0.52;
  leftArmPivot.add(leftArm, leftHand);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0, 1.24, 0.26);
  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.52, 0.14), shirtMat);
  rightArm.position.y = -0.24;
  const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), assets.resSkinMat);
  rightHand.position.y = -0.52;
  rightArmPivot.add(rightArm, rightHand);

  // Head + Hair cap (facing +X in resident local space)
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.44, 0);
  const headMats = [
    assets.resFaceMat, // +X face
    hairMat,           // -X back
    hairMat,           // +Y top
    assets.resSkinMat, // -Y chin
    assets.resSkinMat, // +Z side
    assets.resSkinMat, // -Z side
  ];
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.30, 0.30), headMats);
  headPivot.add(head);

  root.add(leftLegPivot, rightLegPivot, torso, leftArmPivot, rightArmPivot, headPivot);

  if (pose === 'seated') {
    // Seated pose: lower body onto chair/sofa & swing legs forward (+X)
    leftLegPivot.rotation.z = Math.PI * 0.45;
    rightLegPivot.rotation.z = Math.PI * 0.45;
    root.position.y = -0.32;
  }

  return {
    root,
    leftLegPivot,
    rightLegPivot,
    leftArmPivot,
    rightArmPivot,
    headPivot,
    torso,
  };
}

/**
 * 2. Reusable House Interior Populator
 * Furnishes the hollow ground floor with authentic Fleurimont Quebec living room, kitchen, dining room,
 * warm pendant lights, optional indoor Christmas tree, and 1-3 animated indoor residents!
 */
export function populateHouseInterior(group, opts = {}) {
  const {
    w = 12.0,
    d = 9.0,
    floorY = 0.38,
    groundH = 2.75,
    seed = 1,
    style = 'bungalow_vinyl',
    frontDoorZ = 0,
    backDoorZ = 0,
    stairSide = 0,
    stairwell = null,
    isGarage = false,
    texLib = null,
  } = opts;

  const assets = getSharedAssets(texLib);
  const rng = makeRng(seed * 31 + 7);
  const ceilingY = floorY + groundH;
  const halfD = d * 0.5;
  const halfW = w * 0.5;
  const wallMargin = 0.35;

  const residents = [];
  const tvScreens = [];
  const interiorLights = [];
  const christmasGroup = new THREE.Group();
  christmasGroup.visible = false;
  group.add(christmasGroup);

  // Garage interior (workbench, shelves, shop light, tinkering resident)
  if (isGarage || style === 'garage_shed') {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.90, Math.min(3.2, w - 1.4)), assets.woodDarkMat);
    bench.position.set(-halfD + 0.78, floorY + 0.45, 0);
    const toolBox = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.32, 0.72), assets.resShirtMats[0]);
    toolBox.position.set(-halfD + 0.78, floorY + 1.06, -0.6);
    const shopLight = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 1.6), assets.pendantBulbMat);
    shopLight.position.set(0, ceilingY - 0.12, 0);
    group.add(bench, toolBox, shopLight);

    const res = makeIndoorResident(assets, seed * 17 + 1, 'standing');
    res.root.position.set(-halfD + 1.65, floorY, 0.2);
    res.root.rotation.y = Math.PI; // facing -X workbench
    group.add(res.root);
    residents.push({ ...res, activity: 'cook', phase: rng() * 6.28, baseY: floorY });
    return { residents, tvScreens, interiorLights, christmasGroup };
  }

  const intWallMat = assets.intWallMats[seed % assets.intWallMats.length];
  const sofaMat = assets.sofaMats[seed % assets.sofaMats.length];
  const cabMat = seed % 2 === 0 ? assets.woodOakMat : assets.cabWhiteMat;
  const counterMat = seed % 2 === 0 ? assets.counterDarkMat : assets.counterLightMat;
  const fridgeMat = seed % 3 === 0 ? assets.applianceWhiteMat : assets.stainlessMat;

  // Determine which Z side is the living room (opposite the front door & staircase so entry & stairs are wide open!)
  const livingSign = stairSide !== 0 ? -stairSide : frontDoorZ <= 0 ? 1 : -1;
  // Kitchen on opposite Z side from staircase (if present) or back patio door
  const kitchenSign = stairSide !== 0 ? -stairSide : backDoorZ >= 0 ? -1 : 1;

  // --- A. Partial Interior Partition Wall with Wide Open Archway (>= 2.8m wide) ---
  const archW = Math.max(2.8, Math.min(4.6, w * 0.44));
  const wingW = Math.max(0.4, (w - 0.5 - archW) * 0.5);
  if (wingW > 0.65) {
    for (const sgn of [-1, 1]) {
      // Never block the interior staircase on stairSide!
      if (stairwell && sgn === stairSide) continue;
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.16, groundH, wingW), intWallMat);
      wing.position.set(0, floorY + groundH * 0.5, sgn * (halfW - 0.26 - wingW * 0.5));
      group.add(wing);
    }
    if (!stairwell) {
      const archHeader = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, archW + 0.1), intWallMat);
      archHeader.position.set(0, ceilingY - 0.21, 0);
      group.add(archHeader);
    }
  }

  // --- B. Living Room (Front half, x > 0.3) ---
  const livCenterX = Math.max(1.3, halfD * 0.50);
  const livCenterZ = livingSign * Math.min(halfW - 1.85, Math.max(1.2, w * 0.22));

  // Woven area rug
  const rugW = Math.min(2.8, w * 0.28);
  const rugD = Math.min(2.2, d * 0.26);
  const rug = new THREE.Mesh(new THREE.BoxGeometry(rugD, 0.025, rugW), assets.rugMat);
  rug.position.set(livCenterX, floorY + 0.014, livCenterZ);
  group.add(rug);

  // 3-Seat Sofa (facing the side wall TV or front window)
  const sofaGroup = new THREE.Group();
  const sofaLen = Math.min(2.35, w * 0.25);
  const sofaBase = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.42, sofaLen), sofaMat);
  sofaBase.position.y = 0.21;
  const sofaBack = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.52, sofaLen), sofaMat);
  sofaBack.position.set(-0.31, 0.62, 0);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.28, 0.20), sofaMat);
  armL.position.set(0, 0.48, -sofaLen * 0.5 + 0.10);
  const armR = armL.clone();
  armR.position.z = sofaLen * 0.5 - 0.10;
  const pillow1 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, 0.30), assets.pillowMat);
  pillow1.position.set(-0.14, 0.54, -sofaLen * 0.30);
  const pillow2 = pillow1.clone();
  pillow2.position.z = sofaLen * 0.30;
  sofaGroup.add(sofaBase, sofaBack, armL, armR, pillow1, pillow2);

  // Place sofa near the rear of living room facing +X (toward front window & TV console on side)
  const sofaX = Math.max(0.75, livCenterX - 1.05);
  sofaGroup.position.set(sofaX, floorY, livCenterZ);
  group.add(sofaGroup);

  // Coffee table in front of sofa
  const coffeeTbl = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.40, 1.15), assets.woodDarkMat);
  coffeeTbl.position.set(sofaX + 1.05, floorY + 0.20, livCenterZ);
  group.add(coffeeTbl);

  // TV Console + Glowing Animated TV along the side wall (or front-side corner so it doesn't block window!)
  const tvWallZ = livingSign * (halfW - wallMargin - 0.32);
  const tvX = livCenterX + 0.35;
  const tvConsole = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.54, 0.46), assets.woodDarkMat);
  tvConsole.position.set(tvX, floorY + 0.27, tvWallZ);
  const tvFrame = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.76, 0.08), assets.tvBodyMat);
  tvFrame.position.set(tvX, floorY + 0.96, tvWallZ);
  const tvMat = new THREE.MeshStandardMaterial({
    map: assets.tvTex,
    emissive: 0x8cc8ff,
    emissiveMap: assets.tvTex,
    emissiveIntensity: 0.95,
    roughness: 0.25,
  });
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 0.66), tvMat);
  tvScreen.position.set(tvX, floorY + 0.96, tvWallZ - livingSign * 0.045);
  if (livingSign > 0) tvScreen.rotation.y = Math.PI;
  group.add(tvConsole, tvFrame, tvScreen);
  tvScreens.push({ mat: tvMat, phase: rng() * 10 });

  // Cozy Floor Lamp + Potted Houseplant in living room corner
  const lampX = halfD - wallMargin - 0.55;
  const lampZ = livingSign * (halfW - wallMargin - 0.55);
  const lampPole = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.48, 0.08), assets.woodDarkMat);
  lampPole.position.set(lampX, floorY + 0.74, lampZ);
  const lampShade = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.32, 0.38), assets.lampShadeMat);
  lampShade.position.set(lampX, floorY + 1.56, lampZ);
  group.add(lampPole, lampShade);

  // Potted plant near front window
  const plantX = halfD - wallMargin - 0.48;
  const plantZ = livCenterZ - livingSign * 1.15;
  const pot = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.32), assets.plantPotMat);
  pot.position.set(plantX, floorY + 0.17, plantZ);
  const leaves = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.68, 0.52), assets.plantLeafMat);
  leaves.position.set(plantX, floorY + 0.66, plantZ);
  group.add(pot, leaves);

  // Framed Quebec Wall Art on partition wing or side wall
  const artFrame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.66, 0.96), assets.woodDarkMat);
  artFrame.position.set(0.12, floorY + 1.62, livingSign * (halfW - 1.15));
  const artCanvas = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.56), assets.artMat);
  artCanvas.rotation.y = Math.PI * 0.5;
  artCanvas.position.set(0.155, floorY + 1.62, livingSign * (halfW - 1.15));
  group.add(artFrame, artCanvas);

  // Optional brick fireplace with glowing embers on side wall opposite living room (skip if staircase is on that wall!)
  if (seed % 2 === 1 && w >= 10 && (!stairwell || -livingSign !== stairSide)) {
    const fpX = 0.95;
    const fpZ = -livingSign * (halfW - wallMargin - 0.25);
    const fpBody = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.25, 0.45), assets.fireplaceBrickMat);
    fpBody.position.set(fpX, floorY + 0.625, fpZ);
    const fpMantel = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.12, 0.54), assets.woodDarkMat);
    fpMantel.position.set(fpX, floorY + 1.28, fpZ);
    const fpFire = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.42, 0.12), assets.fireGlowMat);
    fpFire.position.set(fpX, floorY + 0.34, fpZ + livingSign * 0.20);
    group.add(fpBody, fpMantel, fpFire);
  }

  // --- C. Kitchen & Dining Room (Rear half, x < -0.3) ---
  const kitWallZ = kitchenSign * (halfW - wallMargin - 0.36);
  const backWallX = -halfD + wallMargin + 0.36;

  // L-shaped lower cabinets + countertop along side kitchen wall
  const cabLenX = Math.min(3.2, Math.max(1.8, halfD - 0.9));
  const cabMidX = -halfD + wallMargin + cabLenX * 0.5 + 0.1;
  const lowerCab = new THREE.Mesh(new THREE.BoxGeometry(cabLenX, 0.86, 0.64), cabMat);
  lowerCab.position.set(cabMidX, floorY + 0.43, kitWallZ);
  const counterTop = new THREE.Mesh(new THREE.BoxGeometry(cabLenX + 0.06, 0.07, 0.70), counterMat);
  counterTop.position.set(cabMidX, floorY + 0.895, kitWallZ);
  // Upper cabinets
  const upperCab = new THREE.Mesh(new THREE.BoxGeometry(cabLenX * 0.85, 0.72, 0.38), cabMat);
  upperCab.position.set(cabMidX, floorY + 1.88, kitWallZ + kitchenSign * 0.12);
  group.add(lowerCab, counterTop, upperCab);

  // Stove / Range embedded in kitchen run
  const stoveX = cabMidX - 0.35;
  const stove = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.92, 0.68), assets.stainlessMat);
  stove.position.set(stoveX, floorY + 0.46, kitWallZ - kitchenSign * 0.02);
  const stoveTop = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.04, 0.62), assets.tvBodyMat);
  stoveTop.position.set(stoveX, floorY + 0.93, kitWallZ - kitchenSign * 0.02);
  const potOnStove = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.15, 8), assets.stainlessMat);
  potOnStove.position.set(stoveX, floorY + 1.02, kitWallZ - kitchenSign * 0.05);
  group.add(stove, stoveTop, potOnStove);

  // Refrigerator at the back kitchen corner
  const fridge = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.82, 0.80), fridgeMat);
  fridge.position.set(backWallX + 0.1, floorY + 0.91, kitWallZ - kitchenSign * 0.92);
  const fridgeHandle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.05), assets.darkTrimMat);
  fridgeHandle.position.set(backWallX + 0.51, floorY + 1.15, kitWallZ - kitchenSign * 0.92);
  group.add(fridge, fridgeHandle);

  // Dining Table + 4 Chairs (on the dining side opposite kitchen, keeping patio doorway clear)
  const dinX = Math.min(-1.2, -halfD * 0.42);
  const dinZ = -kitchenSign * Math.min(halfW - 1.75, Math.max(1.1, w * 0.22));
  const tblTop = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.08, 0.96), assets.woodOakMat);
  tblTop.position.set(dinX, floorY + 0.76, dinZ);
  group.add(tblTop);
  for (const [lx, lz] of [[-0.62, -0.38], [0.62, -0.38], [-0.62, 0.38], [0.62, 0.38]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.74, 0.08), assets.woodDarkMat);
    leg.position.set(dinX + lx, floorY + 0.37, dinZ + lz);
    group.add(leg);
  }
  const chairOffsets = [
    [-0.36, -0.68, 0],
    [0.36, -0.68, 0],
    [-0.36, 0.68, Math.PI],
    [0.36, 0.68, Math.PI],
  ];
  for (const [cxOff, czOff, rot] of chairOffsets) {
    const ch = new THREE.Group();
    ch.position.set(dinX + cxOff, floorY, dinZ + czOff);
    ch.rotation.y = rot;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.42), assets.woodOakMat);
    seat.position.y = 0.44;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.06), assets.woodDarkMat);
    back.position.set(0, 0.68, -0.19);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.36), assets.woodDarkMat);
    legs.position.y = 0.21;
    ch.add(seat, back, legs);
    group.add(ch);
  }

  // --- D. Warm Ceiling Pendant Lights (living room + dining room + kitchen) ---
  const pendantCoords = [
    [livCenterX, livCenterZ],
    [dinX, dinZ],
    [cabMidX, kitWallZ - kitchenSign * 0.9],
  ];
  for (const [px, pz] of pendantCoords) {
    const cord = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.36, 0.04), assets.darkTrimMat);
    cord.position.set(px, ceilingY - 0.18, pz);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.20, 0.26), assets.pendantBulbMat);
    bulb.position.set(px, ceilingY - 0.38, pz);
    group.add(cord, bulb);
  }

  // --- E. Indoor Christmas Tree visible right through the front living room window! ---
  const xmasX = halfD - wallMargin - 0.72;
  const xmasZ = livCenterZ + livingSign * 0.35;
  const treeG = new THREE.Group();
  treeG.position.set(xmasX, floorY, xmasZ);
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.38, 0.20), assets.woodDarkMat);
  trunk.position.y = 0.19;
  treeG.add(trunk);
  const tiers = [
    [1.05, 0.55, 0.62],
    [0.82, 0.52, 1.06],
    [0.56, 0.48, 1.48],
    [0.32, 0.38, 1.84],
  ];
  tiers.forEach(([tw, th, ty], ti) => {
    const tMesh = new THREE.Mesh(new THREE.BoxGeometry(tw, th, tw), assets.xmasPineMat);
    tMesh.position.y = ty;
    treeG.add(tMesh);
    for (let bi = 0; bi < 4; bi++) {
      const a = (bi / 4) * Math.PI * 2 + ti * 0.6;
      const bulb = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.09, 0.09),
        assets.xmasBulbMats[(ti + bi + seed) % assets.xmasBulbMats.length]
      );
      bulb.position.set(Math.cos(a) * tw * 0.52, ty, Math.sin(a) * tw * 0.52);
      treeG.add(bulb);
    }
  });
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), assets.xmasStarMat);
  star.position.y = 2.12;
  treeG.add(star);
  christmasGroup.add(treeG);

  // --- F. 1–3 Animated Indoor Residents doing lively activities! ---
  // Resident 1: Cooking / stirring at the kitchen stove
  const chef = makeIndoorResident(assets, seed * 41 + 3, 'standing');
  chef.root.position.set(stoveX, floorY, kitWallZ - kitchenSign * 0.72);
  chef.root.rotation.y = kitchenSign > 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
  group.add(chef.root);
  residents.push({
    ...chef,
    activity: 'cook',
    phase: rng() * 6.28,
    baseY: floorY,
  });

  // Resident 2: Sitting on the sofa watching TV!
  const watcher = makeIndoorResident(assets, seed * 53 + 11, 'seated');
  watcher.root.position.set(sofaX + 0.06, floorY - 0.26, livCenterZ);
  watcher.root.rotation.y = livingSign > 0 ? -Math.PI * 0.28 : Math.PI * 0.28;
  group.add(watcher.root);
  residents.push({
    ...watcher,
    activity: 'sofa',
    phase: rng() * 6.28,
    baseY: floorY - 0.26,
  });

  // Resident 3 (on medium/larger houses): Walking gently between living room & kitchen/dining OR dining chat
  if (w >= 10.5 || seed % 2 === 0) {
    if (seed % 3 === 0) {
      // Seated at dining table chatting
      const diner = makeIndoorResident(assets, seed * 67 + 19, 'seated');
      diner.root.position.set(dinX - 0.36, floorY - 0.28, dinZ - 0.68);
      diner.root.rotation.y = -Math.PI * 0.5; // facing +Z toward table
      group.add(diner.root);
      residents.push({
        ...diner,
        activity: 'dine',
        phase: rng() * 6.28,
        baseY: floorY - 0.28,
      });
    } else {
      // Gently strolling along central archway corridor between living & dining!
      const walker = makeIndoorResident(assets, seed * 71 + 23, 'standing');
      const walkZ = 0;
      const minX = Math.max(-halfD + 1.5, -1.6);
      const maxX = Math.min(halfD - 1.5, 1.8);
      walker.root.position.set(0, floorY, walkZ);
      group.add(walker.root);
      residents.push({
        ...walker,
        activity: 'walk',
        phase: rng() * 6.28,
        baseY: floorY,
        walkZ,
        minX,
        maxX,
        speed: 0.45 + rng() * 0.2,
      });
    }
  }

  return {
    residents,
    tvScreens,
    interiorLights,
    christmasGroup,
  };
}

/**
 * 2b. Reusable 2nd-Floor Upstairs Interior Populator
 * Furnishes the 2nd floor of two-storey Fleurimont homes (keeping the stairwell opening & top landing clear!):
 * - Master Bedroom (queen bed w/ headboard, pillows, duvet, nightstands + warm lamps, dresser, rug)
 * - 2nd Bedroom / Home Office (desk + chair + glowing monitor + lamp + bookshelf + optional twin bed)
 * - Upstairs Bathroom (ceramic tile floor, vanity + mirror + sink, toilet, bathtub)
 * - Open-doorway partition walls, warm ceiling pendant lights, and an animated upstairs resident!
 */
export function populateUpperFloor(group, opts = {}) {
  const {
    w = 12.0,
    d = 9.0,
    upperFloorY = 3.25,
    upperH = 2.55,
    seed = 1,
    stairSide = -1,
    stairwell = null,
    texLib = null,
  } = opts;

  const assets = getSharedAssets(texLib);
  const rng = makeRng(seed * 59 + 19);
  const halfD = d * 0.5;
  const halfW = w * 0.5;
  const wallMargin = 0.36;
  const upperCeilingY = upperFloorY + upperH;

  const residents = [];
  const tvScreens = [];
  const interiorLights = [];

  const intWallMat = assets.intWallMats[(seed + 1) % assets.intWallMats.length];
  const duvetMat = assets.duvetMats[seed % assets.duvetMats.length];
  const duvetMat2 = assets.duvetMats[(seed + 2) % assets.duvetMats.length];

  // Main rooms sit on the opposite Z side from the stairwell (`mainSign`), with a clear landing & hallway
  const mainSign = stairSide <= 0 ? 1 : -1;

  // --- A. Open-Doorway Interior Partition Walls ---
  // Divide front Master Bedroom (+X) from rear Bathroom/Office (-X) on mainSign side, leaving wide open doorways!
  const partLenZ = Math.max(1.2, halfW - 1.55);
  if (partLenZ > 1.0) {
    const midPart = new THREE.Mesh(new THREE.BoxGeometry(0.14, upperH, partLenZ), intWallMat);
    midPart.position.set(0.15, upperFloorY + upperH * 0.5, mainSign * (halfW - 0.26 - partLenZ * 0.5));
    group.add(midPart);
  }
  // Short hall partition separating landing from master bedroom with wide open 1.5m doorway
  const hallPartLenX = Math.max(1.0, halfD - 2.1);
  if (hallPartLenX > 0.9) {
    const hallPart = new THREE.Mesh(new THREE.BoxGeometry(hallPartLenX, upperH, 0.14), intWallMat);
    hallPart.position.set(halfD - 0.28 - hallPartLenX * 0.5, upperFloorY + upperH * 0.5, mainSign * 0.65);
    group.add(hallPart);
  }

  // --- B. Master Bedroom (Front +X, mainSign side — overlooking the street!) ---
  const mbX = Math.max(1.35, halfD * 0.52);
  const mbZ = mainSign * Math.min(halfW - 1.75, Math.max(1.65, w * 0.26));

  // Woven bedroom rug
  const bedRug = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.024, 2.4), assets.rugMat);
  bedRug.position.set(mbX, upperFloorY + 0.012, mbZ);
  group.add(bedRug);

  // Queen Bed (headboard against side wall `mainSign * halfW`, facing toward hallway/window)
  const bedG = new THREE.Group();
  const bedWallZ = mainSign * (halfW - wallMargin - 1.08);
  bedG.position.set(mbX, upperFloorY, bedWallZ);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.30, 2.02), assets.woodDarkMat);
  frame.position.y = 0.15;
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.60, 0.22, 1.94), assets.bedSheetMat);
  mattress.position.y = 0.38;
  const duvet = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.16, 1.38), duvetMat);
  duvet.position.set(0, 0.44, -mainSign * 0.26);
  const headboard = new THREE.Mesh(new THREE.BoxGeometry(1.74, 1.02, 0.12), assets.woodDarkMat);
  headboard.position.set(0, 0.54, mainSign * 0.96);
  const pilL = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.15, 0.34), assets.bedSheetMat);
  pilL.position.set(-0.38, 0.55, mainSign * 0.72);
  const pilR = pilL.clone();
  pilR.position.x = 0.38;
  bedG.add(frame, mattress, duvet, headboard, pilL, pilR);
  group.add(bedG);

  // Nightstands + Warm Glowing Bedside Lamps flanking the headboard
  for (const nsOff of [-1.14, 1.14]) {
    const nsX = mbX + nsOff;
    if (nsX > halfD - 0.55 || nsX < 0.55) continue;
    const nsZ = mainSign * (halfW - wallMargin - 0.32);
    const ns = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.46), assets.woodOakMat);
    ns.position.set(nsX, upperFloorY + 0.26, nsZ);
    const lBase = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.22, 0.10), assets.woodDarkMat);
    lBase.position.set(nsX, upperFloorY + 0.62, nsZ);
    const lShade = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.24), assets.lampShadeMat);
    lShade.position.set(nsX, upperFloorY + 0.78, nsZ);
    group.add(ns, lBase, lShade);
  }

  // Dresser against front-ish / partition wall
  const dresser = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.84, 1.32), assets.woodOakMat);
  dresser.position.set(0.55, upperFloorY + 0.42, mainSign * (halfW - 1.55));
  group.add(dresser);

  // --- C. Upstairs Bathroom (Rear -X, mainSign side) ---
  const bathMinX = -halfD + wallMargin;
  const bathW = Math.min(2.6, halfW * 0.45);
  const bathD = Math.min(2.8, halfD * 0.55);
  const bathCenterX = bathMinX + bathD * 0.5;
  const bathCenterZ = mainSign * (halfW - wallMargin - bathW * 0.5);

  // Ceramic tile floor zone in bathroom
  const bathTile = makeWorldBox(bathD, 0.025, bathW, assets.tileFloorMat, 0.7);
  bathTile.position.set(bathCenterX, upperFloorY + 0.012, bathCenterZ);
  group.add(bathTile);

  // Bathtub against rear wall (-X)
  const tubX = -halfD + wallMargin + 0.42;
  const tubZ = mainSign * (halfW - wallMargin - 0.88);
  const tubOuter = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.54, 1.58), assets.porcelainMat);
  tubOuter.position.set(tubX, upperFloorY + 0.27, tubZ);
  const tubFaucet = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.24, 0.12), assets.stainlessMat);
  tubFaucet.position.set(tubX, upperFloorY + 0.64, tubZ + mainSign * 0.65);
  group.add(tubOuter, tubFaucet);

  // Vanity Cabinet + Sink + Wall Mirror + Light Bar
  const vanX = bathCenterX + 0.52;
  const vanZ = mainSign * (halfW - wallMargin - 0.30);
  const vanity = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.80, 0.50), assets.cabWhiteMat);
  vanity.position.set(vanX, upperFloorY + 0.40, vanZ);
  const sinkBasin = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.36), assets.porcelainMat);
  sinkBasin.position.set(vanX, upperFloorY + 0.82, vanZ);
  const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.68, 0.04), assets.mirrorMat);
  mirror.position.set(vanX, upperFloorY + 1.44, mainSign * (halfW - wallMargin - 0.04));
  const mirrorLight = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.09, 0.10), assets.pendantBulbMat);
  mirrorLight.position.set(vanX, upperFloorY + 1.86, mainSign * (halfW - wallMargin - 0.08));
  group.add(vanity, sinkBasin, mirror, mirrorLight);

  // Toilet
  const toiX = bathCenterX - 0.15;
  const toiZ = mainSign * (halfW - wallMargin - bathW + 0.42);
  const toiBowl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.40, 0.48), assets.porcelainMat);
  toiBowl.position.set(toiX, upperFloorY + 0.20, toiZ);
  const toiTank = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.18), assets.porcelainMat);
  toiTank.position.set(toiX, upperFloorY + 0.56, toiZ - mainSign * 0.18);
  group.add(toiBowl, toiTank);

  // --- D. 2nd Bedroom / Home Office (Clear of Stairwell — Front/Center on stairSide or Rear-Center!) ---
  // Place desk + glowing monitor + bookshelf cleanly in front of the stairwell (u > stairwell.uMax + 0.45)
  // or in the rear center opposite the bathroom if stairwell leaves less front room
  const frontClearStart = stairwell ? stairwell.uMax + 0.45 : 0.6;
  const useFrontOffice = halfD - frontClearStart >= 1.35;
  const offX = useFrontOffice ? halfD - wallMargin - 0.42 : -halfD + wallMargin + 0.55;
  const offZ = useFrontOffice ? stairSide * Math.min(halfW - 1.35, Math.max(0.85, w * 0.22)) : 0;

  // Wooden Desk + Office Chair + Glowing Computer Monitor
  const desk = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.74, 1.32), assets.woodOakMat);
  desk.position.set(offX, upperFloorY + 0.37, offZ);
  const monStand = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.18, 0.18), assets.tvBodyMat);
  monStand.position.set(offX + (useFrontOffice ? 0.10 : -0.10), upperFloorY + 0.83, offZ);
  const monFrame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.68), assets.tvBodyMat);
  monFrame.position.set(offX + (useFrontOffice ? 0.12 : -0.12), upperFloorY + 1.08, offZ);
  const monMat = new THREE.MeshStandardMaterial({
    map: assets.tvTex,
    emissive: 0x99d0ff,
    emissiveMap: assets.tvTex,
    emissiveIntensity: 0.95,
    roughness: 0.25,
  });
  const monScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.60, 0.35), monMat);
  monScreen.rotation.y = useFrontOffice ? -Math.PI * 0.5 : Math.PI * 0.5;
  monScreen.position.set(offX + (useFrontOffice ? 0.08 : -0.08), upperFloorY + 1.08, offZ);
  tvScreens.push({ mat: monMat, phase: rng() * 10 });

  // Desk lamp
  const dLamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.16), assets.lampShadeMat);
  dLamp.position.set(offX, upperFloorY + 0.88, offZ + 0.48);

  // Office Chair
  const chairX = offX + (useFrontOffice ? -0.64 : 0.64);
  const oChair = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), assets.sofaMats[1]);
  oChair.position.set(chairX, upperFloorY + 0.23, offZ);
  const oChairBack = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.46), assets.sofaMats[1]);
  oChairBack.position.set(chairX + (useFrontOffice ? -0.20 : 0.20), upperFloorY + 0.66, offZ);
  group.add(desk, monStand, monFrame, monScreen, dLamp, oChair, oChairBack);

  // Bookshelf with colorful voxel books beside office
  const shelfZ = stairSide * (halfW - wallMargin - 0.26);
  const shelfX = useFrontOffice ? halfD - 1.15 : -halfD + 1.15;
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.88, 1.56, 0.34), assets.woodDarkMat);
  shelf.position.set(shelfX, upperFloorY + 0.78, shelfZ);
  group.add(shelf);
  for (let row = 0; row < 3; row++) {
    for (let bi = 0; bi < 4; bi++) {
      const bk = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.24, 0.22),
        assets.bookMats[(row * 4 + bi + seed) % assets.bookMats.length]
      );
      bk.position.set(shelfX - 0.26 + bi * 0.17, upperFloorY + 0.42 + row * 0.42, shelfZ - stairSide * 0.08);
      group.add(bk);
    }
  }

  // Optional Twin Bed in 2nd bedroom area if house is wide enough and rear-center is free
  if (w >= 11.5 && useFrontOffice) {
    const tbX = -halfD + wallMargin + 0.95;
    const tbZ = 0.0;
    const tbFrame = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.28, 1.05), assets.woodOakMat);
    tbFrame.position.set(tbX, upperFloorY + 0.14, tbZ);
    const tbMatt = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.20, 0.98), assets.bedSheetMat);
    tbMatt.position.set(tbX, upperFloorY + 0.36, tbZ);
    const tbDuv = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.14, 1.00), duvetMat2);
    tbDuv.position.set(tbX + 0.22, upperFloorY + 0.42, tbZ);
    const tbPil = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.56), assets.bedSheetMat);
    tbPil.position.set(tbX - 0.65, upperFloorY + 0.52, tbZ);
    group.add(tbFrame, tbMatt, tbDuv, tbPil);
  }

  // --- E. Warm Upstairs Ceiling Pendant Lights ---
  const upPendants = [
    [mbX, mbZ],
    [bathCenterX, bathCenterZ],
    [offX + (useFrontOffice ? -0.5 : 0.5), offZ],
    [0, 0],
  ];
  for (const [px, pz] of upPendants) {
    const cord = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.04), assets.darkTrimMat);
    cord.position.set(px, upperCeilingY - 0.14, pz);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.24), assets.pendantBulbMat);
    bulb.position.set(px, upperCeilingY - 0.30, pz);
    group.add(cord, bulb);
  }

  // --- F. Animated Upstairs Resident (working at home office desk!) ---
  const worker = makeIndoorResident(assets, seed * 83 + 29, 'seated');
  worker.root.position.set(chairX, upperFloorY - 0.26, offZ);
  worker.root.rotation.y = useFrontOffice ? 0 : Math.PI; // face desk & glowing monitor
  group.add(worker.root);
  residents.push({
    ...worker,
    activity: 'desk',
    phase: rng() * 6.28,
    baseY: upperFloorY - 0.26,
  });

  return {
    residents,
    tvScreens,
    interiorLights,
  };
}

/**
 * 3. Reusable Detailed Fleurimont Backyard Populator
 * Builds behind -X (-d/2): raised wood rear deck with railings & stairs aligned with back patio door,
 * patio table + chairs + umbrella, BBQ grill, plus varied features (round blue above-ground pool that
 * freezes in Winter, cabanon shed, raised vegetable beds, stone fire pit + chairs, or swing set).
 */
export function populateDetailedBackyard(group, opts = {}) {
  const {
    w = 12.0,
    d = 9.0,
    floorY = 0.38,
    backDoorZ = 0,
    seed = 1,
    texLib = null,
    skipDeck = false,
    skipPool = false,
    skipCabanon = false,
  } = opts;

  const assets = getSharedAssets(texLib);
  const rng = makeRng(seed * 97 + 13);
  const halfD = d * 0.5;
  const halfW = w * 0.5;
  const deckY = Math.max(0.24, floorY - 0.04);

  const christmasGroup = new THREE.Group();
  christmasGroup.visible = false;
  group.add(christmasGroup);

  // --- A. Raised Pressure-Treated Wood Rear Deck + Railings + Steps + Patio Furniture + BBQ ---
  if (!skipDeck) {
    const deckD = 3.2;
    const deckW = Math.min(5.2, Math.max(3.6, w * 0.48));
    const deckX = -halfD - deckD * 0.5;
    const deckZ = Math.max(-halfW + deckW * 0.5, Math.min(halfW - deckW * 0.5, backDoorZ));

    // Deck platform & support posts
    const platform = makeWorldBox(deckD, 0.14, deckW, assets.deckWoodMat, 0.6);
    platform.position.set(deckX, deckY - 0.07, deckZ);
    platform.castShadow = true;
    platform.receiveShadow = true;
    group.add(platform);

    const postH = deckY + 0.85;
    for (const px of [deckX - deckD * 0.45, deckX + deckD * 0.45]) {
      for (const pz of [deckZ - deckW * 0.45, deckZ + deckW * 0.45]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, postH, 0.14), assets.woodDarkMat);
        post.position.set(px, deckY - postH * 0.5, pz);
        group.add(post);
      }
    }

    // Railings on +Z, -Z, and rear -X (leaving a 1.4m stair opening in rear center)
    const railH = 0.92;
    const addRailRun = (x0, z0, x1, z1) => {
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.25) return;
      const mx = (x0 + x1) * 0.5;
      const mz = (z0 + z1) * 0.5;
      const isX = Math.abs(dx) >= Math.abs(dz);
      const topR = new THREE.Mesh(
        new THREE.BoxGeometry(isX ? len : 0.09, 0.08, isX ? 0.09 : len),
        assets.deckWoodMat
      );
      topR.position.set(mx, deckY + railH, mz);
      const midR = new THREE.Mesh(
        new THREE.BoxGeometry(isX ? len : 0.06, 0.06, isX ? 0.06 : len),
        assets.deckWoodMat
      );
      midR.position.set(mx, deckY + railH * 0.48, mz);
      group.add(topR, midR);

      // Corner & mid posts
      const nPosts = Math.max(2, Math.round(len / 1.1) + 1);
      for (let i = 0; i < nPosts; i++) {
        const t = i / (nPosts - 1);
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, railH, 0.08), assets.deckWoodMat);
        p.position.set(x0 + dx * t, deckY + railH * 0.5, z0 + dz * t);
        group.add(p);
      }
    };

    const rxBack = -halfD - deckD + 0.06;
    const rzMin = deckZ - deckW * 0.5 + 0.06;
    const rzMax = deckZ + deckW * 0.5 - 0.06;
    addRailRun(-halfD - 0.06, rzMin, rxBack, rzMin);
    addRailRun(-halfD - 0.06, rzMax, rxBack, rzMax);
    addRailRun(rxBack, rzMin, rxBack, deckZ - 0.72);
    addRailRun(rxBack, deckZ + 0.72, rxBack, rzMax);

    // Christmas deck railing string lights
    for (let i = 0; i < 6; i++) {
      const bz = rzMin + (i / 5) * (rzMax - rzMin);
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.09, 0.09),
        assets.xmasBulbMats[(i + seed) % assets.xmasBulbMats.length]
      );
      b.position.set(rxBack - 0.04, deckY + railH + 0.05, bz);
      christmasGroup.add(b);
    }

    // Wooden stairs from deck down to lawn at (rxBack, deckZ)
    const steps = 3;
    for (let s = 0; s < steps; s++) {
      const sy = deckY * (1 - (s + 0.5) / steps);
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 1.36), assets.deckWoodMat);
      step.position.set(-halfD - deckD - 0.18 - s * 0.34, sy, deckZ);
      group.add(step);
    }

    // Propane BBQ Grill on deck corner
    const bbqX = -halfD - 0.85;
    const bbqZ = deckZ - deckW * 0.5 + 0.65;
    const bbqBox = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.82, 0.92), assets.bbqMat);
    bbqBox.position.set(bbqX, deckY + 0.41, bbqZ);
    const bbqLid = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.28, 0.76), assets.bbqMat);
    bbqLid.position.set(bbqX, deckY + 0.96, bbqZ);
    const bbqHandle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.52), assets.stainlessMat);
    bbqHandle.position.set(bbqX - 0.28, deckY + 0.94, bbqZ);
    group.add(bbqBox, bbqLid, bbqHandle);

    // Patio Table + 3 Chairs + Colorful Umbrella on opposite side of deck
    const ptX = deckX - 0.1;
    const ptZ = deckZ + deckW * 0.22;
    const ptTop = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 8), assets.patioTableMat);
    ptTop.position.set(ptX, deckY + 0.74, ptZ);
    const ptPole = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.25, 0.07), assets.darkTrimMat);
    ptPole.position.set(ptX, deckY + 1.12, ptZ);
    const umbMat = assets.umbrellaMats[seed % assets.umbrellaMats.length];
    const umbCanopy = new THREE.Mesh(new THREE.ConeGeometry(1.32, 0.42, 8), umbMat);
    umbCanopy.position.set(ptX, deckY + 2.22, ptZ);
    umbCanopy.castShadow = true;
    group.add(ptTop, ptPole, umbCanopy);

    for (let ci = 0; ci < 3; ci++) {
      const ca = (ci / 3) * Math.PI * 2 + 0.4;
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.42), assets.patioTableMat);
      ch.position.set(ptX + Math.cos(ca) * 0.88, deckY + 0.23, ptZ + Math.sin(ca) * 0.88);
      group.add(ch);
    }
  }

  // --- B. Varied Fleurimont Backyard Features behind deck (-halfD - 4.8 .. -halfD - 9.0) ---
  const yardX = -halfD - 6.6;
  const featurePick = seed % 5;

  // 1. Above-ground Round Blue Pool (freezes to ice in Winter via shared poolWaterMat!)
  if (!skipPool && (featurePick === 0 || featurePick === 2)) {
    const poolR = 2.15 + (seed % 2) * 0.3;
    const poolX = yardX - 0.3;
    const poolZ = (seed % 2 === 0 ? -1 : 1) * Math.min(2.4, halfW * 0.45);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(poolR, poolR, 1.18, 16, 1, true), assets.poolWallMat);
    wall.position.set(poolX, 0.56, poolZ);
    wall.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(poolR + 0.08, poolR + 0.08, 0.09, 16), assets.poolRimMat);
    rim.position.set(poolX, 1.14, poolZ);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(poolR - 0.07, poolR - 0.07, 0.08, 16), assets.poolWaterMat);
    water.position.set(poolX, 1.06, poolZ);
    // Small pool ladder
    const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.25, 0.14), assets.stainlessMat);
    ladder.position.set(poolX + poolR + 0.12, 0.62, poolZ);
    group.add(wall, rim, water, ladder);
  }

  // 2. Cabanon (Quebec Backyard Shed)
  if (!skipCabanon && (featurePick === 0 || featurePick === 1 || featurePick === 3)) {
    const cabW = 2.4;
    const cabD = 2.8;
    const cabH = 2.15;
    const cabX = yardX - 0.8;
    const cabZ = (seed % 2 === 0 ? 1 : -1) * Math.min(3.4, halfW * 0.55);
    const cabMat = assets.sidingMats[(seed + 2) % assets.sidingMats.length];
    const cabRoofMat = assets.roofMats[seed % assets.roofMats.length];

    const cabBody = makeWorldBox(cabD, cabH + 0.6, cabW, cabMat, 0.4);
    cabBody.position.set(cabX, cabH * 0.5 - 0.3, cabZ);
    cabBody.castShadow = true;
    const cabDoor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.85, 1.15), assets.trimMat);
    cabDoor.position.set(cabX + cabD * 0.5 + 0.02, 0.92, cabZ);
    const cabRoof = new THREE.Mesh(createPitchedRoofGeometry(cabD, cabW, 0.85, false, 0.22), cabRoofMat);
    cabRoof.position.set(cabX, cabH, cabZ);
    cabRoof.castShadow = true;
    const cabGables = new THREE.Mesh(createGableEndsGeometry(cabD, cabW, 0.85), cabMat);
    cabGables.position.set(cabX, cabH, cabZ);
    group.add(cabBody, cabDoor, cabRoof, cabGables);
  }

  // 3. Stone Fire Pit + 3 Adirondack Chairs
  if (featurePick === 1 || featurePick === 4) {
    const fpX = yardX + 0.4;
    const fpZ = (seed % 2 === 0 ? -1 : 1) * Math.min(2.2, halfW * 0.4);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.72, 0.34, 10), assets.stoneMat);
    ring.position.set(fpX, 0.17, fpZ);
    const embers = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 8), assets.fireGlowMat);
    embers.position.set(fpX, 0.32, fpZ);
    group.add(ring, embers);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.2;
      const ac = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.64, 0.58), assets.adirondackMat);
      ac.position.set(fpX + Math.cos(a) * 1.55, 0.32, fpZ + Math.sin(a) * 1.55);
      ac.rotation.y = -a;
      group.add(ac);
    }
  }

  // 4. Raised Cedar Vegetable Garden Beds
  if (featurePick === 2 || featurePick === 3) {
    const gx = yardX + 0.8;
    const gz = (seed % 2 === 0 ? 1 : -1) * Math.min(2.4, halfW * 0.42);
    for (let bi = 0; bi < 2; bi++) {
      const bx = gx - bi * 1.5;
      const bed = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.36, 2.2), assets.deckWoodMat);
      bed.position.set(bx, 0.18, gz);
      const soil = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.08, 2.08), assets.soilMat);
      soil.position.set(bx, 0.35, gz);
      group.add(bed, soil);
      for (let pi = -2; pi <= 2; pi++) {
        const veg = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), assets.plantLeafMat);
        veg.position.set(bx + (pi % 2) * 0.18, 0.50, gz + pi * 0.40);
        group.add(veg);
      }
    }
  }

  // 5. Backyard Kids' Swing Set
  if (featurePick === 4) {
    const sx = yardX - 0.6;
    const sz = (seed % 2 === 0 ? 1 : -1) * Math.min(2.6, halfW * 0.45);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 2.8), assets.swingFrameMat);
    bar.position.set(sx, 2.25, sz);
    group.add(bar);
    for (const dz of [-1.35, 1.35]) {
      for (const dx of [-0.55, 0.55]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.4, 0.08), assets.swingFrameMat);
        leg.position.set(sx + dx * 0.5, 1.15, sz + dz);
        leg.rotation.z = dx > 0 ? 0.24 : -0.24;
        group.add(leg);
      }
    }
    for (const dz of [-0.52, 0.52]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.46), assets.swingSeatMat);
      seat.position.set(sx, 0.62, sz + dz);
      const rope = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.62, 0.03), assets.darkTrimMat);
      rope.position.set(sx, 1.43, sz + dz);
      group.add(seat, rope);
    }
  }

  return { christmasGroup, rngUsed: rng() };
}

/**
 * 4. Register an externally built enterable house (used by heroLandmarks.js for the 5 hero homes within 100m!)
 * Works safely whether called BEFORE or AFTER buildEnterable100mZone().
 */
export function registerExternalEnterable(entry) {
  if (!entry) return;
  const ang = entry.ang || 0;
  const cosA = entry.cosA ?? Math.cos(ang);
  const sinA = entry.sinA ?? Math.sin(ang);
  const normalized = {
    ...entry,
    ang,
    cosA,
    sinA,
  };

  // Ensure all doors have world (wx, wz) populated
  if (Array.isArray(normalized.doors)) {
    for (const dr of normalized.doors) {
      if (!dr.wx && !dr.wz && (dr.localX !== undefined || dr.localZ !== undefined)) {
        const [wx, wz] = localToWorld(normalized.cx, normalized.cz, cosA, sinA, dr.localX || 0, dr.localZ || 0);
        dr.wx = wx;
        dr.wz = wz;
      }
    }
  }

  externalEntries.push(normalized);

  // If buildEnterable100mZone() was already called, inject immediately into live arrays
  if (activeZoneState) {
    mergeExternalEntryIntoState(normalized, activeZoneState);
  }
}

function mergeExternalEntryIntoState(entry, state) {
  if (entry.id != null) {
    state.enterableIds.add(entry.id);
  }
  state.enterableBuildings.push({
    id: entry.id,
    label: entry.label || 'Residence',
    cx: entry.cx,
    cz: entry.cz,
    ang: entry.ang,
    cosA: entry.cosA,
    sinA: entry.sinA,
    halfD: entry.halfD,
    halfW: entry.halfW,
    floorY: entry.floorY,
    ceilingY: entry.ceilingY,
    hasUpperFloor: !!entry.hasUpperFloor,
    upperFloorY: entry.upperFloorY ?? null,
    upperCeilingY: entry.upperCeilingY ?? null,
    stair: entry.stair || null,
    stairwell: entry.stairwell || null,
  });
  if (Array.isArray(entry.wallColliders)) {
    for (const wc of entry.wallColliders) state.wallColliders.push(wc);
  }
  if (Array.isArray(entry.doors)) {
    for (const d of entry.doors) state.doors.push(d);
  }
  if (Array.isArray(entry.residents)) {
    for (const r of entry.residents) state.residents.push(r);
  }
  if (Array.isArray(entry.tvScreens)) {
    for (const t of entry.tvScreens) state.tvScreens.push(t);
  }
  if (Array.isArray(entry.interiorLights)) {
    for (const l of entry.interiorLights) state.interiorLights.push(l);
  }
  if (Array.isArray(entry.christmasGroups)) {
    for (const cg of entry.christmasGroups) state.christmasGroups.push(cg);
  } else if (entry.christmasGroup) {
    state.christmasGroups.push(entry.christmasGroup);
  }
  if (Array.isArray(entry.winterHandlers)) {
    for (const wh of entry.winterHandlers) state.winterHandlers.push(wh);
  }
  if (Array.isArray(entry.nightHandlers)) {
    for (const nh of entry.nightHandlers) state.nightHandlers.push(nh);
  }
}

/**
 * 5. Build ALL 27 Neighboring Enterable Houses/Garages within 100m of (0,0)
 * (excluding the 5 hero IDs built by heroLandmarks.js) and unify them with any
 * externally registered hero enterables.
 */
export function buildEnterable100mZone(scene, DATA, texLib, elevData = null) {
  const assets = getSharedAssets(texLib);
  const resolvedElev = elevData || DATA?.elevation || null;

  const state = {
    enterableBuildings: [],
    wallColliders: [],
    enterableIds: new Set(HERO_100M_IDS),
    pickableMeshes: [],
    doors: [],
    residents: [],
    tvScreens: [],
    interiorLights: [],
    christmasGroups: [],
    winterHandlers: [],
    nightHandlers: [],
  };
  activeZoneState = state;

  const rootGroup = new THREE.Group();
  rootGroup.name = 'enterable-100m-zone';
  scene.add(rootGroup);

  const buildings = Array.isArray(DATA?.buildings) ? DATA.buildings : [];

  for (let idx = 0; idx < buildings.length; idx++) {
    const b = buildings[idx];
    if (Math.hypot(b.cx, b.cz) > 100) continue;
    if (HERO_100M_IDS.has(b.id)) continue;

    const elev = sampleElevation(b.obbCx, b.obbCz, resolvedElev);
    const isGarage = b.style === 'garage_shed';
    const localFloorY = isGarage ? 0.14 : 0.36;
    const groundH = isGarage ? 2.45 : 2.75;
    let upperH = 0;
    let roofH = 1.75;
    let isHip = false;

    if (isGarage) {
      roofH = 0.85;
    } else if (b.style === 'cottage_2s') {
      upperH = 2.65;
      roofH = 2.15;
      isHip = b.cidx % 5 === 0;
    } else if (b.style === 'splitlevel') {
      upperH = 2.40;
      roofH = 1.75;
      isHip = b.cidx % 3 === 1;
    } else if (b.style === 'cottage_1_5s') {
      upperH = 2.30;
      roofH = 2.20;
    } else if (b.style === 'bungalow_brick') {
      roofH = 1.75;
      isHip = b.cidx % 3 === 0;
    } else {
      roofH = 1.68;
      isHip = b.cidx % 4 === 0;
    }

    const seed = (b.id % 9973) + idx * 13 + 7;
    const d = Math.max(4.8, b.d || 9.0);
    const w = Math.max(5.2, b.w || 11.5);
    const ang = b.ang || 0;
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);

    // Choose authentic Quebec exterior materials matching b.style
    let exteriorMat = assets.sidingMats[(b.cidx || seed) % assets.sidingMats.length];
    let upperExteriorMat = exteriorMat;
    if (b.style === 'bungalow_brick') {
      exteriorMat = assets.brickMats[(b.cidx || seed) % assets.brickMats.length];
      upperExteriorMat = exteriorMat;
    } else if (b.style === 'splitlevel' || (b.style === 'cottage_2s' && seed % 2 === 0)) {
      exteriorMat = assets.brickMats[(b.cidx || seed) % assets.brickMats.length];
      upperExteriorMat = assets.sidingMats[((b.cidx || seed) + 1) % assets.sidingMats.length];
    }

    const shell = createHollowShell({
      d,
      w,
      floorY: localFloorY,
      groundH,
      upperH,
      roofH,
      isHip,
      isGarage,
      hasBackDoor: !isGarage,
      exteriorMat,
      upperExteriorMat,
      seed,
      texLib,
      worldTransform: { cx: b.obbCx, cz: b.obbCz, ang, elev },
    });

    shell.group.position.set(b.obbCx, elev, b.obbCz);
    shell.group.rotation.y = -ang;
    rootGroup.add(shell.group);

    // Populate furnished ground-floor interior & animated residents (keeping staircase clear if 2-storey!)
    const interior = populateHouseInterior(shell.group, {
      w,
      d,
      floorY: localFloorY,
      groundH,
      seed,
      style: b.style,
      frontDoorZ: shell.frontDoorZ,
      backDoorZ: shell.backDoorZ,
      stairSide: shell.stairSide,
      stairwell: shell.stairwell,
      isGarage,
      texLib,
    });

    // Populate furnished 2nd floor (bedrooms, home office, bathroom, warm lights, animated resident) for 2-storey homes!
    let upperInterior = null;
    if (shell.hasUpperFloor) {
      upperInterior = populateUpperFloor(shell.group, {
        w,
        d,
        upperFloorY: shell.upperFloorY,
        upperH,
        seed,
        stairSide: shell.stairSide,
        stairwell: shell.stairwell,
        texLib,
      });
    }

    // Populate detailed Fleurimont backyard (skip for standalone garage)
    if (!isGarage) {
      const backyard = populateDetailedBackyard(shell.group, {
        w,
        d,
        floorY: localFloorY,
        backDoorZ: shell.backDoorZ,
        seed,
        texLib,
      });
      state.christmasGroups.push(backyard.christmasGroup);
    }

    const label = b.hn
      ? `${b.hn} ${b.street || 'Fleurimont'}`
      : b.street
        ? `Maison ${b.street}`
        : `Résidence #${b.id}`;

    const worldStair = shell.stair
      ? {
          ...shell.stair,
          y0: elev + shell.stair.y0,
          y1: elev + shell.stair.y1,
        }
      : null;

    state.enterableIds.add(b.id);
    state.enterableBuildings.push({
      id: b.id,
      label,
      cx: b.obbCx,
      cz: b.obbCz,
      ang,
      cosA,
      sinA,
      halfD: d * 0.5,
      halfW: w * 0.5,
      floorY: elev + localFloorY,
      ceilingY: elev + localFloorY + groundH,
      hasUpperFloor: shell.hasUpperFloor,
      upperFloorY: shell.hasUpperFloor ? elev + shell.upperFloorY : null,
      upperCeilingY: shell.hasUpperFloor ? elev + shell.upperCeilingY : null,
      stair: worldStair,
      stairwell: shell.stairwell,
    });

    for (const wc of shell.wallColliders) state.wallColliders.push(wc);
    for (const dr of shell.doors) state.doors.push(dr);
    for (const r of interior.residents) state.residents.push(r);
    for (const tv of interior.tvScreens) state.tvScreens.push(tv);
    if (upperInterior) {
      for (const r of upperInterior.residents) state.residents.push(r);
      for (const tv of upperInterior.tvScreens) state.tvScreens.push(tv);
    }
    state.christmasGroups.push(shell.christmasGroup, interior.christmasGroup);
    state.pickableMeshes.push(shell.group);
  }

  // Merge any hero enterable houses already registered before buildEnterable100mZone() was called
  for (const ext of externalEntries) {
    mergeExternalEntryIntoState(ext, state);
  }

  // --- Unified Per-Frame Update: Auto-Opening Doors + Animated Indoor Residents + TV Glow ---
  function updateInteriors(dt, elapsedSec, playerPos, isNight = false) {
    const safeDt = Math.min(dt || 0.016, 0.1);
    const px = playerPos ? playerPos.x : 1e6;
    const pz = playerPos ? playerPos.z : 1e6;

    // 1. Auto-opening front swinging doors & back sliding patio doors (trigger radius = 2.8m)
    for (let i = 0; i < state.doors.length; i++) {
      const dr = state.doors[i];
      const dist = Math.hypot(px - dr.wx, pz - dr.wz);
      const target = dist < 2.8 ? 1 : 0;
      if (Math.abs(target - dr.openT) > 0.001) {
        dr.openT += (target - dr.openT) * Math.min(1, safeDt * 7.5);
        if (dr.type === 'swing' && dr.pivot) {
          dr.pivot.rotation.y = (dr.baseRotY || 0) + (dr.openDir ?? -1) * dr.openT * 1.48;
        } else if (dr.type === 'slide' && dr.panel) {
          dr.panel.position.z = dr.closedZ + (dr.slideDir ?? 1) * dr.openT * ((dr.doorW || 1.8) * 0.46);
        }
      }
    }

    // 2. Animated Indoor Residents (cooking, watching TV, dining, strolling)
    for (let i = 0; i < state.residents.length; i++) {
      const r = state.residents[i];
      const t = elapsedSec + (r.phase || 0);
      if (r.activity === 'cook') {
        // Stirring pot with right arm + subtle head look
        r.rightArmPivot.rotation.z = 0.85 + Math.sin(t * 4.2) * 0.25;
        r.rightArmPivot.rotation.x = Math.cos(t * 4.2) * 0.18;
        r.leftArmPivot.rotation.z = 0.35 + Math.sin(t * 1.8) * 0.08;
        r.headPivot.rotation.y = Math.sin(t * 1.1) * 0.22;
      } else if (r.activity === 'sofa') {
        // Relaxed head nod & occasional arm gesture watching TV
        r.headPivot.rotation.y = Math.sin(t * 0.9) * 0.18;
        r.headPivot.rotation.z = Math.sin(t * 1.4) * 0.06;
        r.rightArmPivot.rotation.z = 0.32 + Math.max(0, Math.sin(t * 0.7)) * 0.35;
        r.leftArmPivot.rotation.z = 0.22;
      } else if (r.activity === 'dine') {
        // Chatting & eating at dining table
        r.headPivot.rotation.y = Math.sin(t * 1.5) * 0.28;
        r.rightArmPivot.rotation.z = 0.65 + Math.sin(t * 2.6) * 0.22;
        r.leftArmPivot.rotation.z = 0.45;
      } else if (r.activity === 'desk') {
        // Typing at home office desk & glancing at glowing monitor
        r.headPivot.rotation.y = Math.sin(t * 0.85) * 0.16;
        r.headPivot.rotation.z = -0.06 + Math.sin(t * 1.6) * 0.04;
        r.rightArmPivot.rotation.z = 0.88 + Math.sin(t * 6.5) * 0.08;
        r.leftArmPivot.rotation.z = 0.88 + Math.cos(t * 6.2) * 0.08;
      } else if (r.activity === 'walk') {
        // Gentle ping-pong stroll between living room & dining/kitchen
        const span = (r.maxX - r.minX) * 0.5;
        const mid = (r.maxX + r.minX) * 0.5;
        const s = Math.sin(t * (r.speed || 0.5));
        const vel = Math.cos(t * (r.speed || 0.5));
        r.root.position.x = mid + s * span;
        r.root.rotation.y = vel >= 0 ? 0 : Math.PI;
        const stride = Math.sin(t * 4.8) * 0.42;
        r.leftLegPivot.rotation.z = stride;
        r.rightLegPivot.rotation.z = -stride;
        r.leftArmPivot.rotation.z = -stride * 0.75;
        r.rightArmPivot.rotation.z = stride * 0.75;
        r.headPivot.rotation.y = Math.sin(t * 1.2) * 0.15;
      }
    }

    // 3. Subtle animated TV screen glow
    const tvBase = isNight ? 1.35 : 0.92;
    for (let i = 0; i < state.tvScreens.length; i++) {
      const tv = state.tvScreens[i];
      tv.mat.emissiveIntensity = tvBase + Math.sin(elapsedSec * 3.1 + tv.phase) * 0.14;
    }
  }

  // --- Mode Toggles: Night / Winter / Christmas ---
  function setNightMode(isNight) {
    // Warm cozy indoor lighting boost so every room glows warmly through see-through windows at Night!
    for (const m of assets.intWallMats) {
      m.emissiveIntensity = isNight ? 0.54 : 0.16;
    }
    assets.ceilingMat.emissiveIntensity = isNight ? 0.58 : 0.18;
    assets.oakFloorMat.emissiveIntensity = isNight ? 0.38 : 0.12;
    assets.tileFloorMat.emissiveIntensity = isNight ? 0.38 : 0.12;
    assets.pendantBulbMat.emissiveIntensity = isNight ? 2.2 : 0.95;
    assets.lampShadeMat.emissiveIntensity = isNight ? 1.75 : 0.75;
    assets.bedSheetMat.emissiveIntensity = isNight ? 0.30 : 0.08;
    assets.porcelainMat.emissiveIntensity = isNight ? 0.28 : 0.08;
    for (const dm of assets.duvetMats) {
      dm.emissiveIntensity = isNight ? 0.26 : 0.08;
    }

    // Upper 2nd-floor windows glow warmly at Night
    if (isNight) {
      if (assets.texLib?.windowLitTex && assets.upperWinMat.map !== assets.texLib.windowLitTex) {
        assets.upperWinMat.map = assets.texLib.windowLitTex;
        assets.upperWinMat.needsUpdate = true;
      }
      assets.upperWinMat.emissive.setHex(0xffb84d);
      assets.upperWinMat.emissiveIntensity = 0.72;
    } else {
      if (assets.texLib?.windowTex && assets.upperWinMat.map !== assets.texLib.windowTex) {
        assets.upperWinMat.map = assets.texLib.windowTex;
        assets.upperWinMat.needsUpdate = true;
      }
      assets.upperWinMat.emissive.setHex(0x000000);
      assets.upperWinMat.emissiveIntensity = 0;
    }

    // Boost Christmas bulbs at Night
    for (const bm of assets.xmasBulbMats) {
      bm.emissiveIntensity = isNight ? 2.1 : 1.3;
    }

    for (const nh of state.nightHandlers) nh(isNight);
  }

  function setWinterMode(isWinter) {
    // Swap all house & cabanon roofs to snow roof texture
    const shingles = assets.texLib?.shingleTextures || [];
    assets.roofMats.forEach((rm, i) => {
      const targetMap = isWinter ? assets.texLib?.snowRoofTex || null : shingles[i] || null;
      if (rm.map !== targetMap) {
        rm.map = targetMap;
        rm.needsUpdate = true;
      }
      rm.color.setHex(isWinter ? 0xeef5fc : 0xffffff);
      rm.roughness = isWinter ? 0.82 : 0.88;
    });

    // Freeze backyard above-ground pools into winter ice!
    if (isWinter) {
      assets.poolWaterMat.map = assets.texLib?.winterIceTex || null;
      assets.poolWaterMat.color.setHex(0xd4eaf7);
      assets.poolWaterMat.roughness = 0.25;
      assets.poolWaterMat.needsUpdate = true;
    } else {
      assets.poolWaterMat.map = null;
      assets.poolWaterMat.color.setHex(0x3895c4);
      assets.poolWaterMat.roughness = 0.16;
      assets.poolWaterMat.needsUpdate = true;
    }

    for (const wh of state.winterHandlers) wh(isWinter);
  }

  function setChristmasMode(isChristmas) {
    for (let i = 0; i < state.christmasGroups.length; i++) {
      state.christmasGroups[i].visible = !!isChristmas;
    }
  }

  return {
    enterableBuildings: state.enterableBuildings,
    wallColliders: state.wallColliders,
    enterableIds: state.enterableIds,
    pickableMeshes: state.pickableMeshes,
    updateInteriors,
    setNightMode,
    setWinterMode,
    setChristmasMode,
  };
}
