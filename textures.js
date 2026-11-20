import * as THREE from 'three';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function toTex(canvas, repeatX = 1, repeatY = 1, srgb = true) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createTextureLibrary() {
  const rng = makeRng(264609);

  // 1. Soft Lush Mowed-Lawn Quebec Pixel Grass (64x64 with subtle mower-band shading)
  const [gc, gctx] = makeCanvas(64, 64);
  const grassPalette = ['#568e38', '#5e983e', '#4e8433', '#65a044', '#4a7e30'];
  for (let y = 0; y < 64; y++) {
    const band = (y >> 3) & 1;
    for (let x = 0; x < 64; x++) {
      const r = rng();
      let idx = r < 0.38 ? 0 : r < 0.68 ? 1 : r < 0.86 ? 2 : r < 0.96 ? 3 : 4;
      if (band === 1 && r < 0.35) idx = 1;
      else if (band === 0 && r < 0.25) idx = 2;
      gctx.fillStyle = grassPalette[idx];
      gctx.fillRect(x, y, 1, 1);
    }
  }
  const grassTex = toTex(gc, 1, 1);

  // 2. Crisp Icy-White & Pale-Blue Pixel Snow (32x32)
  const [snc, snctx] = makeCanvas(32, 32);
  const snowPalette = ['#f4f8fc', '#ebf3fb', '#ffffff', '#ddeaf6', '#cfe0f0'];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const r = rng();
      const idx = r < 0.42 ? 0 : r < 0.72 ? 1 : r < 0.88 ? 2 : r < 0.96 ? 3 : 4;
      snctx.fillStyle = snowPalette[idx];
      snctx.fillRect(x, y, 1, 1);
    }
  }
  const snowTex = toTex(snc, 1, 1);

  // 3. Weathered Sun-Bleached Fleurimont Quebec Asphalt (64x64 pixel-art: grey aggregate, repair patch, tar-sealed alligator cracks)
  const [ac, actx] = makeCanvas(64, 64);
  const asphaltPalette = ['#878b88', '#919592', '#7d817e', '#999d9a', '#717572'];
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const r = rng();
      const idx = r < 0.34 ? 0 : r < 0.62 ? 1 : r < 0.82 ? 2 : r < 0.92 ? 3 : 4;
      actx.fillStyle = asphaltPalette[idx];
      actx.fillRect(x, y, 1, 1);
    }
  }
  // Subtle darker asphalt repair patch with tar-sealed seam
  const patchX = 12, patchY = 20, patchW = 16, patchH = 11;
  actx.fillStyle = '#494d52';
  actx.fillRect(patchX - 1, patchY - 1, patchW + 2, patchH + 2);
  for (let py = patchY; py < patchY + patchH; py++) {
    for (let px = patchX; px < patchX + patchW; px++) {
      actx.fillStyle = rng() < 0.45 ? '#666a6f' : rng() < 0.8 ? '#707479' : '#5b5f64';
      actx.fillRect(px, py, 1, 1);
    }
  }
  // Realistic tar-sealed alligator crack network
  const drawCrack = (sx, sy, len, dxBias, dyBias) => {
    let cx = sx;
    let cy = sy;
    for (let s = 0; s < len; s++) {
      const wx = (cx + 64) & 63;
      const wy = (cy + 64) & 63;
      actx.fillStyle = s % 3 === 0 ? '#3e4247' : '#494d52';
      actx.fillRect(wx, wy, 1, 1);
      if (s > 3 && s % 6 === 0) {
        // Branching alligator cracklet
        let bx = cx;
        let by = cy;
        const bdx = rng() < 0.5 ? 1 : -1;
        const bdy = rng() < 0.5 ? 1 : -1;
        for (let b = 0; b < 5; b++) {
          actx.fillStyle = '#494d52';
          actx.fillRect((bx + 64) & 63, (by + 64) & 63, 1, 1);
          bx += rng() < 0.7 ? bdx : 0;
          by += rng() < 0.7 ? bdy : 0;
        }
      }
      cx += rng() < 0.65 ? dxBias : (rng() < 0.5 ? 1 : -1);
      cy += rng() < 0.65 ? dyBias : (rng() < 0.5 ? 1 : -1);
    }
  };
  drawCrack(4, 8, 22, 1, 0);
  drawCrack(34, 42, 24, 1, 1);
  drawCrack(48, 10, 18, 0, 1);
  const asphaltTex = toTex(ac, 1, 1);

  // 4. Weathered Medium-Grey Residential Driveway Asphalt (32x32)
  const [dc, dctx] = makeCanvas(32, 32);
  const drivePalette = ['#686c71', '#72767b', '#5f6368', '#7b7f84'];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const r = rng();
      const idx = r < 0.40 ? 0 : r < 0.72 ? 1 : r < 0.90 ? 2 : 3;
      dctx.fillStyle = drivePalette[idx];
      dctx.fillRect(x, y, 1, 1);
    }
  }
  const drivewayTex = toTex(dc, 1, 1);

  // 5. Salted/Plowed Wintry Asphalt with Snowy Edges (32x32)
  const [src, srctx] = makeCanvas(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      // Road V runs across width (0..1 -> y=0..31); snowy banks on edges
      const edgeDist = Math.min(y, 31 - y);
      if (edgeDist <= 2 || (edgeDist <= 4 && rng() < 0.6)) {
        srctx.fillStyle = rng() < 0.65 ? '#eef5fc' : '#d6e4f2';
      } else if (edgeDist <= 6 && rng() < 0.35) {
        srctx.fillStyle = '#9aa8b6';
      } else {
        const r = rng();
        srctx.fillStyle = r < 0.08 ? '#cad4de' : r < 0.50 ? '#434951' : r < 0.80 ? '#3a4047' : '#4d545d';
      }
      srctx.fillRect(x, y, 1, 1);
    }
  }
  const snowRoadTex = toTex(src, 1, 1);

  // 6. Weathered Sidewalk / Curb Stone Pavers (64x64 pixel-art: staining, moss/dirt edges, expansion joints)
  const [cc, cctx] = makeCanvas(64, 64);
  const concPalette = ['#c1c4c1', '#c9ccc9', '#b5b8b5', '#d0d2cf', '#a6aaa6'];
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const r = rng();
      const idx = r < 0.36 ? 0 : r < 0.64 ? 1 : r < 0.84 ? 2 : r < 0.94 ? 3 : 4;
      cctx.fillStyle = concPalette[idx];
      cctx.fillRect(x, y, 1, 1);
    }
  }
  // Weathered damp/oil staining patches
  for (let s = 0; s < 5; s++) {
    const sx = Math.floor(rng() * 54);
    const sy = Math.floor(rng() * 54);
    const sw = 5 + Math.floor(rng() * 8);
    const sh = 4 + Math.floor(rng() * 7);
    for (let yy = sy; yy < sy + sh; yy++) {
      for (let xx = sx; xx < sx + sw; xx++) {
        if (rng() < 0.55) {
          cctx.fillStyle = rng() < 0.5 ? '#a1a5a1' : '#969a96';
          cctx.fillRect(xx & 63, yy & 63, 1, 1);
        }
      }
    }
  }
  // Expansion joints
  cctx.fillStyle = '#7e827f';
  cctx.fillRect(0, 31, 64, 1);
  cctx.fillRect(31, 0, 1, 31);
  cctx.fillRect(63, 32, 1, 32);
  cctx.fillStyle = '#adb1ae';
  cctx.fillRect(0, 32, 64, 1);
  // Subtle moss & dirt pixels along expansion joints and edges
  for (let i = 0; i < 64; i++) {
    if (rng() < 0.35) {
      cctx.fillStyle = rng() < 0.55 ? '#6d7f5e' : '#857c68';
      cctx.fillRect(i, 30 + (rng() < 0.5 ? 0 : 2), 1, 1);
    }
    if (rng() < 0.28) {
      cctx.fillStyle = rng() < 0.6 ? '#768866' : '#89806c';
      cctx.fillRect(i < 32 ? 30 : 62, i, 1, 1);
    }
    if (rng() < 0.25) {
      cctx.fillStyle = rng() < 0.5 ? '#6d7f5e' : '#8b826f';
      cctx.fillRect(i, rng() < 0.5 ? 0 : 63, 1, 1);
    }
  }
  const concreteTex = toTex(cc, 1, 1);

  // 7. Crisp Pixel-Art Fleurimont Brick Facades (4 palettes, 64x64 with mortar & brick weathering)
  const brickSpecs = [
    { bricks: ['#e2d7c2', '#d5c8b0', '#eae0cd', '#c8ba9f'], mortar: '#aba08d', mortarDark: '#948977' },
    { bricks: ['#c9a682', '#b99570', '#d3b28e', '#ab8762'], mortar: '#968370', mortarDark: '#7f6e5c' },
    { bricks: ['#5a5d60', '#4b4e52', '#676a6e', '#3e4145'], mortar: '#35383b', mortarDark: '#2b2e31' },
    { bricks: ['#964b3a', '#823e30', '#a35644', '#733528'], mortar: '#847870', mortarDark: '#6e635c' },
  ];
  const brickTextures = brickSpecs.map((spec) => {
    const [bc, bctx] = makeCanvas(64, 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        bctx.fillStyle = rng() < 0.28 ? spec.mortarDark : spec.mortar;
        bctx.fillRect(x, y, 1, 1);
      }
    }
    const rows = 16;
    const cols = 8;
    const rh = 4;
    const cw = 8;
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * 4;
      for (let c = -1; c <= cols; c++) {
        const bx = c * cw + offset;
        const by = r * rh;
        const baseCol = spec.bricks[(r * 7 + c * 13 + 100) % spec.bricks.length];
        bctx.fillStyle = baseCol;
        bctx.fillRect(bx + 1, by + 1, cw - 1, rh - 1);
        // Subtle per-brick weathering specks
        for (let s = 0; s < 2; s++) {
          if (rng() < 0.55) {
            bctx.fillStyle = spec.bricks[(r * 3 + c * 5 + s + 101) % spec.bricks.length];
            bctx.fillRect(bx + 1 + Math.floor(rng() * (cw - 1)), by + 1 + Math.floor(rng() * (rh - 1)), 1, 1);
          }
        }
      }
    }
    return toTex(bc, 0.25, 0.25);
  });

  // 8. Crisp Pixel-Art Horizontal Vinyl Siding & Accent Cladding (6 palettes, 64x64 with subtle weathering)
  const sidingSpecs = [
    { base: '#f3f4f1', hi: '#fbfcf9', shadow: '#d5d9d3', grime: '#e6e9e3' },
    { base: '#eae2cf', hi: '#f4ede0', shadow: '#c8beaa', grime: '#dcd4c0' },
    { base: '#c8d2da', hi: '#d8e1e8', shadow: '#9faab3', grime: '#b8c3cc' },
    { base: '#7c8e9e', hi: '#8ea0b0', shadow: '#5c6c7b', grime: '#6d7f8f' },
    { base: '#9ea89c', hi: '#aeb8ac', shadow: '#798477', grime: '#8c968a' },
    { base: '#a88768', hi: '#b8987a', shadow: '#83664b', grime: '#977758' },
  ];
  const sidingTextures = sidingSpecs.map((spec) => {
    const [sc, sctx] = makeCanvas(64, 64);
    sctx.fillStyle = spec.base;
    sctx.fillRect(0, 0, 64, 64);
    for (let p = 0; p < 16; p++) {
      const y = p * 4;
      sctx.fillStyle = spec.hi;
      sctx.fillRect(0, y, 64, 1);
      sctx.fillStyle = spec.shadow;
      sctx.fillRect(0, y + 3, 64, 1);
      // Subtle weathering / rain-streak specks on plank faces
      for (let x = 0; x < 64; x++) {
        if (rng() < 0.14) {
          sctx.fillStyle = spec.grime;
          sctx.fillRect(x, y + 1 + (rng() < 0.5 ? 0 : 1), 1, 1);
        }
      }
    }
    return toTex(sc, 0.25, 0.25);
  });

  // 9. Crisp Pixel-Art Roof Shingles (3 palettes, 32x32) + snowRoofTex
  const shingleSpecs = [
    { base: '#6b6761', dark: '#524e49', light: '#7d7871' },
    { base: '#383b40', dark: '#27292d', light: '#484c53' },
    { base: '#5d4a3d', dark: '#46362c', light: '#705a4b' },
  ];
  const shingleTextures = shingleSpecs.map((spec) => {
    const [rc, rctx] = makeCanvas(32, 32);
    rctx.fillStyle = spec.base;
    rctx.fillRect(0, 0, 32, 32);
    for (let r = 0; r < 8; r++) {
      const shift = (r % 2) * 4;
      for (let c = 0; c < 4; c++) {
        const sx = (c * 8 + shift) % 32;
        const sy = r * 4;
        rctx.fillStyle = (r + c) % 3 === 0 ? spec.dark : (r + c) % 2 === 0 ? spec.light : spec.base;
        rctx.fillRect(sx, sy, 7, 3);
      }
      rctx.fillStyle = spec.dark;
      rctx.fillRect(0, r * 4 + 3, 32, 1);
    }
    return toTex(rc, 1, 1);
  });

  const [srcf, srctf] = makeCanvas(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const r = rng();
      if (y % 4 === 3 && r < 0.25) {
        srctf.fillStyle = '#c5d6e6';
      } else {
        srctf.fillStyle = r < 0.45 ? '#eef5fc' : r < 0.80 ? '#ffffff' : '#dceaf7';
      }
      srctf.fillRect(x, y, 1, 1);
    }
  }
  const snowRoofTex = toTex(srcf, 1, 1);

  // 10. Sharpened Minecraft-Style Leaf, Bark & Cedar Hedge Pixel Blocks (32x32)
  const [ldc, ldctx] = makeCanvas(32, 32);
  const decPalette = ['#377b2a', '#4a9838', '#225219', '#61b249', '#193d12', '#74c658'];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const cluster = ((x >> 2) * 7 + (y >> 2) * 13 + (x >> 3)) % 6;
      const r = rng();
      let idx = r < 0.24 ? 0 : r < 0.48 ? 1 : r < 0.70 ? 2 : r < 0.86 ? 3 : r < 0.95 ? 4 : 5;
      if ((cluster === 0 || cluster === 5) && r < 0.55) idx = r < 0.25 ? 5 : 3;
      if ((cluster === 2 || cluster === 4) && r < 0.50) idx = 4;
      ldctx.fillStyle = decPalette[idx];
      ldctx.fillRect(x, y, 1, 1);
    }
  }
  const leafDeciduousTex = toTex(ldc, 1, 1);

  const [lcc, lcctx] = makeCanvas(32, 32);
  const conPalette = ['#204d29', '#2d6637', '#133219', '#3b7e47', '#0e2412', '#4c9457'];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const needle = (x + y * 2) % 5 === 0;
      const tip = (x * 3 + y) % 11 === 0;
      const r = rng();
      let idx = r < 0.26 ? 0 : r < 0.52 ? 1 : r < 0.76 ? 2 : r < 0.89 ? 3 : r < 0.96 ? 4 : 5;
      if (needle && r < 0.55) idx = 4;
      else if (tip && r < 0.65) idx = 5;
      lcctx.fillStyle = conPalette[idx];
      lcctx.fillRect(x, y, 1, 1);
    }
  }
  const leafConiferTex = toTex(lcc, 1, 1);

  const [bkc, bkctx] = makeCanvas(32, 32);
  const barkPalette = ['#5b422d', '#473220', '#6d5139', '#342316', '#7b5d43'];
  for (let x = 0; x < 32; x++) {
    const deepGroove = x % 5 === 0;
    const ridgeHi = x % 5 === 2;
    for (let y = 0; y < 32; y++) {
      const r = rng();
      let idx = deepGroove ? (r < 0.7 ? 3 : 1) : ridgeHi ? (r < 0.45 ? 4 : 2) : (r < 0.55 ? 0 : 1);
      bkctx.fillStyle = barkPalette[idx];
      bkctx.fillRect(x, y, 1, 1);
    }
  }
  // Bark knots
  const knots = [[9, 10], [22, 23]];
  for (const [kx, ky] of knots) {
    bkctx.fillStyle = '#2d1e12';
    bkctx.fillRect(kx, ky, 3, 4);
    bkctx.fillStyle = '#7b5d43';
    bkctx.fillRect(kx - 1, ky + 1, 1, 2);
    bkctx.fillRect(kx + 3, ky + 1, 1, 2);
  }
  const barkTex = toTex(bkc, 1, 1);

  const [hgc, hgctx] = makeCanvas(32, 32);
  const hedgePalette = ['#2d6227', '#3c7b33', '#1c4218', '#529646', '#132f10'];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const sprig = ((x >> 1) * 5 + (y >> 1) * 9) % 7;
      const r = rng();
      let idx = r < 0.28 ? 0 : r < 0.54 ? 1 : r < 0.78 ? 2 : r < 0.92 ? 3 : 4;
      if (sprig === 0 && r < 0.5) idx = 3;
      if (sprig === 4 && r < 0.5) idx = 4;
      hgctx.fillStyle = hedgePalette[idx];
      hgctx.fillRect(x, y, 1, 1);
    }
  }
  const hedgeTex = toTex(hgc, 1, 1);

  // 11. Quebec ARRÊT Sign Texture (Octagonal pixel-art, 64x64)
  const [stc, stctx] = makeCanvas(64, 64);
  stctx.clearRect(0, 0, 64, 64);
  const drawOct = (r, fill) => {
    stctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) * Math.PI) / 4;
      const px = Math.round(32 + Math.cos(a) * r);
      const py = Math.round(32 + Math.sin(a) * r);
      if (i === 0) stctx.moveTo(px, py);
      else stctx.lineTo(px, py);
    }
    stctx.closePath();
    stctx.fillStyle = fill;
    stctx.fill();
  };
  drawOct(30, '#ffffff');
  drawOct(27, '#cc1f24');
  stctx.fillStyle = '#ffffff';
  stctx.font = 'bold 14px monospace';
  stctx.textAlign = 'center';
  stctx.textBaseline = 'middle';
  stctx.fillText('ARRÊT', 32, 33);
  const arretTex = toTex(stc, 1, 1);
  arretTex.wrapS = THREE.ClampToEdgeWrapping;
  arretTex.wrapT = THREE.ClampToEdgeWrapping;

  // 12. Pixel-Art Soccer Field Texture (128x64)
  const [sfc, sfctx] = makeCanvas(128, 64);
  for (let i = 0; i < 16; i++) {
    sfctx.fillStyle = i % 2 === 0 ? '#3f833b' : '#478f42';
    sfctx.fillRect(i * 8, 0, 8, 64);
  }
  sfctx.strokeStyle = '#f2f7f2';
  sfctx.lineWidth = 1;
  sfctx.strokeRect(5.5, 4.5, 117, 55);
  sfctx.beginPath();
  sfctx.moveTo(64.5, 4);
  sfctx.lineTo(64.5, 60);
  sfctx.stroke();
  sfctx.beginPath();
  sfctx.arc(64, 32, 9, 0, Math.PI * 2);
  sfctx.stroke();
  sfctx.strokeRect(5.5, 17.5, 14, 29);
  sfctx.strokeRect(108.5, 17.5, 14, 29);
  const soccerTex = toTex(sfc, 1, 1);
  soccerTex.wrapS = THREE.ClampToEdgeWrapping;
  soccerTex.wrapT = THREE.ClampToEdgeWrapping;

  // 13. Pixel-Art Tennis Court Texture (64x128)
  const [tc, tctx] = makeCanvas(64, 128);
  tctx.fillStyle = '#2d6c47';
  tctx.fillRect(0, 0, 64, 128);
  tctx.fillStyle = '#285a8f';
  tctx.fillRect(8, 11, 48, 106);
  tctx.strokeStyle = '#ffffff';
  tctx.lineWidth = 1;
  tctx.strokeRect(8.5, 11.5, 47, 105);
  tctx.strokeRect(13.5, 11.5, 37, 105);
  tctx.beginPath();
  tctx.moveTo(8, 64.5);
  tctx.lineTo(56, 64.5);
  tctx.moveTo(13, 34.5);
  tctx.lineTo(51, 34.5);
  tctx.moveTo(13, 93.5);
  tctx.lineTo(51, 93.5);
  tctx.moveTo(32.5, 34);
  tctx.lineTo(32.5, 94);
  tctx.stroke();
  const tennisTex = toTex(tc, 1, 1);
  tennisTex.wrapS = THREE.ClampToEdgeWrapping;
  tennisTex.wrapT = THREE.ClampToEdgeWrapping;

  // 14. Pixel-Art Outdoor Patinoire / Hockey Rink Floor Texture (128x64)
  const [rkc, rkctx] = makeCanvas(128, 64);
  rkctx.fillStyle = '#bfc4c8';
  rkctx.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 240; i++) {
    rkctx.fillStyle = rng() < 0.5 ? '#b4b9bd' : '#c9ced2';
    rkctx.fillRect(Math.floor(rng() * 128), Math.floor(rng() * 64), 1, 1);
  }
  rkctx.fillStyle = '#c42b2b';
  rkctx.fillRect(11, 2, 1, 60);
  rkctx.fillRect(116, 2, 1, 60);
  rkctx.fillRect(64, 2, 2, 60);
  rkctx.fillStyle = '#2359a8';
  rkctx.fillRect(44, 2, 2, 60);
  rkctx.fillRect(82, 2, 2, 60);
  rkctx.strokeStyle = '#2359a8';
  rkctx.lineWidth = 1;
  rkctx.beginPath();
  rkctx.arc(64, 32, 9, 0, Math.PI * 2);
  rkctx.stroke();
  const rinkTex = toTex(rkc, 1, 1);
  rinkTex.wrapS = THREE.ClampToEdgeWrapping;
  rinkTex.wrapT = THREE.ClampToEdgeWrapping;

  // 15. Pixel-Art Frozen Winter Ice Rink Texture (128x64)
  const [wic, wictx] = makeCanvas(128, 64);
  wictx.fillStyle = '#dff0fa';
  wictx.fillRect(0, 0, 128, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 128; x++) {
      const r = rng();
      if (r < 0.18) {
        wictx.fillStyle = '#eef8fe';
        wictx.fillRect(x, y, 2, 1);
      } else if (r < 0.30) {
        wictx.fillStyle = '#cce3f4';
        wictx.fillRect(x, y, 1, 1);
      }
    }
  }
  // Crisp hockey lines frozen beneath the ice
  wictx.fillStyle = 'rgba(204, 42, 42, 0.78)';
  wictx.fillRect(11, 2, 1, 60);
  wictx.fillRect(116, 2, 1, 60);
  wictx.fillRect(64, 2, 2, 60);
  wictx.fillStyle = 'rgba(35, 95, 180, 0.78)';
  wictx.fillRect(44, 2, 2, 60);
  wictx.fillRect(82, 2, 2, 60);
  wictx.strokeStyle = 'rgba(35, 95, 180, 0.78)';
  wictx.lineWidth = 1;
  wictx.beginPath();
  wictx.arc(64, 32, 9, 0, Math.PI * 2);
  wictx.stroke();
  const winterIceTex = toTex(wic, 1, 1);
  winterIceTex.wrapS = THREE.ClampToEdgeWrapping;
  winterIceTex.wrapT = THREE.ClampToEdgeWrapping;

  // 16. Worn Earthy Park Trail / Dirt Path Texture (32x32 pixel-art)
  const [dpc, dpctx] = makeCanvas(32, 32);
  const dirtPalette = ['#7d6a54', '#705e49', '#8a765f', '#645441', '#96846e'];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const edgeDist = Math.min(y, 31 - y);
      if (edgeDist === 0 || (edgeDist <= 2 && rng() < 0.45)) {
        dpctx.fillStyle = rng() < 0.6 ? '#4e7d3a' : '#5b8a44';
      } else {
        const r = rng();
        dpctx.fillStyle = dirtPalette[r < 0.36 ? 0 : r < 0.66 ? 1 : r < 0.84 ? 2 : r < 0.94 ? 3 : 4];
      }
      dpctx.fillRect(x, y, 1, 1);
    }
  }
  // Small trail pebbles
  for (let p = 0; p < 10; p++) {
    dpctx.fillStyle = rng() < 0.5 ? '#9e978e' : '#574a3b';
    dpctx.fillRect(Math.floor(rng() * 32), 3 + Math.floor(rng() * 26), 1, 1);
  }
  const dirtPathTex = toTex(dpc, 1, 1);

  // 17. Weathered / Rusted Dark Metal Texture (32x32 pixel-art)
  const [rmc, rmctx] = makeCanvas(32, 32);
  const metalPalette = ['#32373d', '#3b4148', '#292d32', '#444b53'];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const r = rng();
      rmctx.fillStyle = metalPalette[r < 0.42 ? 0 : r < 0.72 ? 1 : r < 0.90 ? 2 : 3];
      rmctx.fillRect(x, y, 1, 1);
    }
  }
  // Rust spots & streaks
  for (let rs = 0; rs < 28; rs++) {
    const rx = Math.floor(rng() * 32);
    const ry = Math.floor(rng() * 32);
    rmctx.fillStyle = rng() < 0.55 ? '#6e3f27' : '#854b2c';
    rmctx.fillRect(rx, ry, 1, 1);
    if (rng() < 0.45) {
      rmctx.fillStyle = '#573320';
      rmctx.fillRect(rx, (ry + 1) & 31, 1, 1);
    }
  }
  const rustMetalTex = toTex(rmc, 1, 1);

  // 18. Quebec No-Parking Sign Texture (white with red circle-slash P, 64x64)
  const [npc, npctx] = makeCanvas(64, 64);
  npctx.fillStyle = '#f6f7f5';
  npctx.fillRect(0, 0, 64, 64);
  npctx.strokeStyle = '#1e2226';
  npctx.lineWidth = 2;
  npctx.strokeRect(2, 2, 60, 60);
  npctx.fillStyle = '#111417';
  npctx.font = 'bold 30px Arial, sans-serif';
  npctx.textAlign = 'center';
  npctx.textBaseline = 'middle';
  npctx.fillText('P', 32, 33);
  npctx.strokeStyle = '#cc1f24';
  npctx.lineWidth = 6;
  npctx.beginPath();
  npctx.arc(32, 32, 22, 0, Math.PI * 2);
  npctx.stroke();
  npctx.beginPath();
  npctx.moveTo(16, 48);
  npctx.lineTo(48, 16);
  npctx.stroke();
  const noParkingTex = toTex(npc, 1, 1);
  noParkingTex.wrapS = THREE.ClampToEdgeWrapping;
  noParkingTex.wrapT = THREE.ClampToEdgeWrapping;

  // 19. Quebec School Zone 30 Sign Texture (fluorescent yellow-green, 64x64)
  const [szc, szctx] = makeCanvas(64, 64);
  szctx.fillStyle = '#c8e622';
  szctx.fillRect(0, 0, 64, 64);
  szctx.strokeStyle = '#111417';
  szctx.lineWidth = 2;
  szctx.strokeRect(2, 2, 60, 60);
  szctx.fillStyle = '#111417';
  szctx.textAlign = 'center';
  szctx.textBaseline = 'middle';
  szctx.font = 'bold 26px Arial, sans-serif';
  szctx.fillText('30', 32, 23);
  szctx.font = 'bold 10px Arial, sans-serif';
  szctx.fillText('ZONE', 32, 42);
  szctx.fillText('SCOLAIRE', 32, 53);
  const schoolZoneTex = toTex(szc, 1, 1);
  schoolZoneTex.wrapS = THREE.ClampToEdgeWrapping;
  schoolZoneTex.wrapT = THREE.ClampToEdgeWrapping;

  // 20. Christmas Shopfront Display Window (64x64 pixel-art)
  const [cwc, cwctx] = makeCanvas(64, 64);
  // Warm golden illuminated interior
  cwctx.fillStyle = '#e8ad3c';
  cwctx.fillRect(0, 0, 64, 64);
  cwctx.fillStyle = '#f8cb5e';
  cwctx.fillRect(5, 5, 54, 54);
  cwctx.fillStyle = '#ffe896';
  cwctx.fillRect(12, 14, 40, 38);
  // Window frame
  cwctx.fillStyle = '#6e191d';
  cwctx.fillRect(0, 0, 64, 4);
  cwctx.fillRect(0, 60, 64, 4);
  cwctx.fillRect(0, 0, 4, 64);
  cwctx.fillRect(60, 0, 4, 64);
  // Red & green holiday banner across top
  for (let x = 4; x < 60; x += 4) {
    cwctx.fillStyle = ((x >> 2) % 2 === 0) ? '#c92027' : '#1f6e31';
    cwctx.fillRect(x, 4, 4, 6);
    cwctx.fillStyle = '#f5d04c';
    cwctx.fillRect(x + 1, 10, 2, 1);
  }
  // Mini decorated Christmas tree
  const treeRows = [
    [24, 18, 2], [23, 20, 4], [22, 22, 6],
    [20, 24, 10], [19, 27, 12], [18, 30, 14],
    [16, 33, 18], [15, 37, 20], [14, 41, 22], [13, 45, 24],
  ];
  for (const [tx, ty, tw] of treeRows) {
    cwctx.fillStyle = '#1d5c27';
    cwctx.fillRect(tx, ty, tw, 3);
    cwctx.fillStyle = '#2c7838';
    cwctx.fillRect(tx + 1, ty, Math.max(1, tw - 3), 2);
  }
  // Tree trunk & golden star
  cwctx.fillStyle = '#5c3a21';
  cwctx.fillRect(23, 48, 4, 8);
  cwctx.fillStyle = '#ffe14d';
  cwctx.fillRect(24, 14, 2, 4);
  cwctx.fillRect(23, 15, 4, 2);
  // Ornaments on tree
  const ornaments = [[23, 23, '#e0282f'], [27, 28, '#ffe14d'], [21, 31, '#3b8beb'], [29, 36, '#e0282f'], [19, 39, '#ffe14d'], [25, 42, '#e0282f'], [32, 44, '#3b8beb']];
  for (const [ox, oy, oc] of ornaments) {
    cwctx.fillStyle = oc;
    cwctx.fillRect(ox, oy, 2, 2);
  }
  // Wrapped red & gold gifts on right
  cwctx.fillStyle = '#c92027';
  cwctx.fillRect(40, 44, 10, 12);
  cwctx.fillStyle = '#f5d04c';
  cwctx.fillRect(44, 44, 2, 12);
  cwctx.fillRect(40, 49, 10, 2);
  cwctx.fillStyle = '#1f6e31';
  cwctx.fillRect(49, 48, 8, 8);
  cwctx.fillStyle = '#e0282f';
  cwctx.fillRect(52, 48, 2, 8);
  cwctx.fillRect(49, 51, 8, 2);
  // Snowflakes
  const flakes = [[9, 18], [52, 19], [10, 32], [45, 28], [54, 34]];
  for (const [fx, fy] of flakes) {
    cwctx.fillStyle = '#ffffff';
    cwctx.fillRect(fx, fy, 3, 1);
    cwctx.fillRect(fx + 1, fy - 1, 1, 3);
  }
  const christmasShopWindowTex = toTex(cwc, 1, 1);
  christmasShopWindowTex.wrapS = THREE.ClampToEdgeWrapping;
  christmasShopWindowTex.wrapT = THREE.ClampToEdgeWrapping;

  // 21. Christmas Holiday Sign Texture ("JOYEUX NOËL" / "SPÉCIAL FÊTES", 64x32)
  const [csc, csctx] = makeCanvas(64, 32);
  csctx.fillStyle = '#b81d24';
  csctx.fillRect(0, 0, 64, 32);
  csctx.strokeStyle = '#1e632b';
  csctx.lineWidth = 3;
  csctx.strokeRect(1.5, 1.5, 61, 29);
  csctx.strokeStyle = '#f2c94c';
  csctx.lineWidth = 1;
  csctx.strokeRect(3.5, 3.5, 57, 25);
  csctx.textAlign = 'center';
  csctx.textBaseline = 'middle';
  csctx.font = 'bold 9px Arial, sans-serif';
  csctx.fillStyle = '#4a0b0e';
  csctx.fillText('JOYEUX NOËL', 33, 12, 54);
  csctx.fillStyle = '#ffffff';
  csctx.fillText('JOYEUX NOËL', 32, 11, 54);
  csctx.font = 'bold 7px Arial, sans-serif';
  csctx.fillStyle = '#4a0b0e';
  csctx.fillText('SPÉCIAL FÊTES', 33, 23, 54);
  csctx.fillStyle = '#ffe478';
  csctx.fillText('SPÉCIAL FÊTES', 32, 22, 54);
  const christmasSignTex = toTex(csc, 1, 1);
  christmasSignTex.wrapS = THREE.ClampToEdgeWrapping;
  christmasSignTex.wrapT = THREE.ClampToEdgeWrapping;

  // 22. Evergreen Door Wreath with Red Berries & Bow (32x32 pixel-art, transparent background)
  const [wrc, wrctx] = makeCanvas(32, 32);
  wrctx.clearRect(0, 0, 32, 32);
  const wreathGreens = ['#1d5222', '#2a6d2e', '#37853b', '#153d18'];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - 15.5;
      const dy = y - 14.5;
      const dist = Math.hypot(dx, dy);
      if (dist >= 6.5 && dist <= 12.5) {
        const r = rng();
        wrctx.fillStyle = wreathGreens[r < 0.3 ? 0 : r < 0.65 ? 1 : r < 0.85 ? 2 : 3];
        wrctx.fillRect(x, y, 1, 1);
      }
    }
  }
  // Red holly berries & gold accents
  const berries = [[15, 4], [22, 7], [25, 14], [22, 21], [9, 21], [6, 14], [9, 7], [19, 5], [12, 5]];
  for (const [bx, by] of berries) {
    wrctx.fillStyle = '#d92626';
    wrctx.fillRect(bx, by, 2, 2);
    wrctx.fillStyle = '#ff6666';
    wrctx.fillRect(bx, by, 1, 1);
  }
  // Red bow at bottom
  wrctx.fillStyle = '#c91c22';
  wrctx.fillRect(10, 22, 5, 4);
  wrctx.fillRect(17, 22, 5, 4);
  wrctx.fillStyle = '#ef3339';
  wrctx.fillRect(14, 22, 4, 4);
  wrctx.fillStyle = '#b0161c';
  wrctx.fillRect(12, 26, 2, 4);
  wrctx.fillRect(18, 26, 2, 4);
  const wreathTex = toTex(wrc, 1, 1);
  wreathTex.wrapS = THREE.ClampToEdgeWrapping;
  wreathTex.wrapT = THREE.ClampToEdgeWrapping;

  // 23. Crisp Quebec Casement / Double-Hung Residential Window (64x64, ClampToEdgeWrapping)
  const [wc, wctx] = makeCanvas(64, 64);
  wctx.fillStyle = '#f2f3f0';
  wctx.fillRect(0, 0, 64, 64);
  wctx.fillStyle = '#d1d5d2';
  wctx.fillRect(0, 61, 64, 3);
  wctx.fillRect(2, 2, 60, 60);
  // Glass panes with sky reflection gradient & subtle interior curtain hints
  for (let y = 4; y < 60; y++) {
    for (let x = 4; x < 60; x++) {
      const sheen = (60 - y) * 0.65 + (60 - x) * 0.35;
      let col = sheen > 56 ? '#4c7291' : sheen > 36 ? '#3a5b77' : '#29435c';
      if (x >= 7 && x <= 14 && y >= 8 && y <= 54 && (x + y) % 3 === 0) col = '#4a647a';
      if (x >= 50 && x <= 57 && y >= 8 && y <= 54 && (x + y) % 3 === 0) col = '#4a647a';
      wctx.fillStyle = col;
      wctx.fillRect(x, y, 1, 1);
    }
  }
  // Crisp white vinyl frame + central vertical mullion + horizontal transom bar
  wctx.fillStyle = '#f5f6f3';
  wctx.fillRect(0, 0, 64, 4);
  wctx.fillRect(0, 60, 64, 4);
  wctx.fillRect(0, 0, 4, 64);
  wctx.fillRect(60, 0, 4, 64);
  wctx.fillRect(31, 4, 2, 56);
  wctx.fillRect(4, 23, 56, 2);
  wctx.fillStyle = '#d6dad7';
  wctx.fillRect(3, 59, 58, 1);
  wctx.fillRect(4, 25, 56, 1);
  const windowTex = toTex(wc, 1, 1);
  windowTex.wrapS = THREE.ClampToEdgeWrapping;
  windowTex.wrapT = THREE.ClampToEdgeWrapping;

  // 23b. Warm Glowing Lit Residential Window at Night (64x64, ClampToEdgeWrapping)
  const [wlc, wlctx] = makeCanvas(64, 64);
  // Dark window frame at night
  wlctx.fillStyle = '#36302a';
  wlctx.fillRect(0, 0, 64, 64);
  wlctx.fillStyle = '#26211d';
  wlctx.fillRect(2, 2, 60, 60);
  // Warm golden-amber lit interior panes with subtle lamp glow gradient & shaded top-left pane for realism
  for (let y = 4; y < 60; y++) {
    for (let x = 4; x < 60; x++) {
      const isTopLeft = x < 31 && y < 23;
      const isCurtainEdge = (x >= 4 && x <= 10) || (x >= 53 && x <= 59);
      let col;
      if (isTopLeft) {
        // Partially shaded/dimmed upper-left pane for lived-in night realism
        col = y > 16 ? '#8c6533' : (y % 4 === 0 ? '#3f3428' : '#4e3f2d');
      } else {
        // Warm glowing interior lamp pool (#ffd47a / #ffe7a8)
        const distCenter = Math.hypot(x - 36, y - 40);
        if (distCenter < 14) col = '#fff0bd';
        else if (distCenter < 24) col = '#ffe7a8';
        else if (distCenter < 35) col = '#ffd47a';
        else col = '#ebb457';
        if (isCurtainEdge && (x + y) % 2 === 0) col = '#c98f3e';
      }
      wlctx.fillStyle = col;
      wlctx.fillRect(x, y, 1, 1);
    }
  }
  // Crisp dark outer frame + central vertical mullion + horizontal transom bar (muntins)
  wlctx.fillStyle = '#322c26';
  wlctx.fillRect(0, 0, 64, 4);
  wlctx.fillRect(0, 60, 64, 4);
  wlctx.fillRect(0, 0, 4, 64);
  wlctx.fillRect(60, 0, 4, 64);
  wlctx.fillRect(30, 4, 4, 56);
  wlctx.fillRect(4, 22, 56, 3);
  // Inner subtle highlight on sill
  wlctx.fillStyle = '#5a4d3f';
  wlctx.fillRect(3, 59, 58, 1);
  const windowLitTex = toTex(wlc, 1, 1);
  windowLitTex.wrapS = THREE.ClampToEdgeWrapping;
  windowLitTex.wrapT = THREE.ClampToEdgeWrapping;

  // 24. Insulated White Quebec Sectional Garage Door (64x64, ClampToEdgeWrapping)
  const [gdc, gdctx] = makeCanvas(64, 64);
  gdctx.fillStyle = '#eff1ee';
  gdctx.fillRect(0, 0, 64, 64);
  gdctx.strokeStyle = '#c4c8c4';
  gdctx.lineWidth = 2;
  gdctx.strokeRect(1, 1, 62, 62);
  // 4 horizontal sectional panels with raised bevel rectangles
  for (let row = 0; row < 4; row++) {
    const ry = row * 16;
    gdctx.fillStyle = '#d0d4d0';
    gdctx.fillRect(2, ry + 15, 60, 1);
    gdctx.fillStyle = '#ffffff';
    gdctx.fillRect(2, ry + 1, 60, 1);
    for (let col = 0; col < 4; col++) {
      const rx = 5 + col * 14;
      if (row === 0) {
        // Top row of 4 transom glass panes with white mullions
        gdctx.fillStyle = '#cfd4d0';
        gdctx.fillRect(rx, ry + 4, 12, 8);
        gdctx.fillStyle = '#263c50';
        gdctx.fillRect(rx + 1, ry + 5, 10, 6);
        gdctx.fillStyle = '#40607c';
        gdctx.fillRect(rx + 1, ry + 5, 5, 3);
      } else {
        gdctx.fillStyle = '#dfe3df';
        gdctx.fillRect(rx, ry + 4, 12, 8);
        gdctx.fillStyle = '#f8f9f7';
        gdctx.fillRect(rx + 1, ry + 5, 10, 6);
      }
    }
  }
  const garageDoorTex = toTex(gdc, 1, 1);
  garageDoorTex.wrapS = THREE.ClampToEdgeWrapping;
  garageDoorTex.wrapT = THREE.ClampToEdgeWrapping;

  // 25. Pale Crushed Limestone Gravel Driveway Texture (32x32)
  const [grc, grctx] = makeCanvas(32, 32);
  const gravelPalette = ['#b7bbb6', '#c6cac5', '#a4a8a3', '#d2d5d0', '#969a95'];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const r = rng();
      grctx.fillStyle = gravelPalette[r < 0.34 ? 0 : r < 0.62 ? 1 : r < 0.82 ? 2 : r < 0.94 ? 3 : 4];
      grctx.fillRect(x, y, 1, 1);
    }
  }
  const gravelTex = toTex(grc, 1, 1);

  // 26. Warm Horizontal Caramel-Cedar Wood Planks (64x64, repeat = 0.25)
  const [cpc, cpctx] = makeCanvas(64, 64);
  cpctx.fillStyle = '#bf8152';
  cpctx.fillRect(0, 0, 64, 64);
  for (let p = 0; p < 16; p++) {
    const py = p * 4;
    cpctx.fillStyle = p % 3 === 0 ? '#b07244' : p % 3 === 1 ? '#bf8152' : '#cb8e60';
    cpctx.fillRect(0, py, 64, 3);
    cpctx.fillStyle = '#7c4b28';
    cpctx.fillRect(0, py + 3, 64, 1);
    for (let x = 0; x < 64; x++) {
      if (rng() < 0.18) {
        cpctx.fillStyle = rng() < 0.5 ? '#a2673c' : '#d59a6d';
        cpctx.fillRect(x, py + (rng() < 0.5 ? 1 : 2), 2, 1);
      }
    }
  }
  const cedarPlankTex = toTex(cpc, 0.25, 0.25);

  // 27. Smooth Parged Grey Foundation Concrete (32x32, repeat = 0.35)
  const [fnc, fnctx] = makeCanvas(32, 32);
  const foundPalette = ['#9ea29e', '#a8aca8', '#919591', '#b0b4b0'];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const r = rng();
      fnctx.fillStyle = foundPalette[r < 0.38 ? 0 : r < 0.70 ? 1 : r < 0.90 ? 2 : 3];
      fnctx.fillRect(x, y, 1, 1);
    }
  }
  const foundationTex = toTex(fnc, 0.35, 0.35);

  // 28. Creamy-White Quebec Paper Birch Bark (32x32)
  const [bbc, bbctx] = makeCanvas(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      bbctx.fillStyle = rng() < 0.62 ? '#eeebe3' : '#e1ddd3';
      bbctx.fillRect(x, y, 1, 1);
    }
  }
  for (let d = 0; d < 26; d++) {
    const dx = Math.floor(rng() * 28);
    const dy = Math.floor(rng() * 32);
    const len = 2 + Math.floor(rng() * 6);
    bbctx.fillStyle = rng() < 0.65 ? '#3d3832' : '#635b52';
    bbctx.fillRect(dx, dy, len, 1);
  }
  bbctx.fillStyle = '#332e29';
  bbctx.fillRect(10, 12, 3, 2);
  bbctx.fillRect(21, 24, 4, 2);
  const birchBarkTex = toTex(bbc, 1, 1);

  // 29. Sun-Bleached Silver-Grey Hydro-Québec Utility Pole Wood (32x32)
  const [pwc, pwctx] = makeCanvas(32, 32);
  const polePalette = ['#9a9891', '#8b8981', '#a8a69e', '#75736b'];
  for (let x = 0; x < 32; x++) {
    const groove = x % 4 === 0;
    for (let y = 0; y < 32; y++) {
      const r = rng();
      pwctx.fillStyle = groove ? (r < 0.7 ? polePalette[3] : polePalette[1]) : polePalette[r < 0.4 ? 0 : r < 0.7 ? 1 : 2];
      pwctx.fillRect(x, y, 1, 1);
    }
  }
  const poleWoodTex = toTex(pwc, 1, 1);

  // 30. Deep Woodland Moss, Pine Needles & Leaf Litter (32x32)
  const [ffc, ffctx] = makeCanvas(32, 32);
  const forestPalette = ['#3d5a2b', '#4b6135', '#584834', '#314923', '#6b573e'];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const r = rng();
      ffctx.fillStyle = forestPalette[r < 0.30 ? 0 : r < 0.56 ? 1 : r < 0.78 ? 2 : r < 0.90 ? 3 : 4];
      ffctx.fillRect(x, y, 1, 1);
    }
  }
  const forestFloorTex = toTex(ffc, 1, 1);

  // 31. Rich Dark Cedar Garden Mulch (32x32)
  const [mlc, mlctx] = makeCanvas(32, 32);
  const mulchPalette = ['#493424', '#3c2a1d', '#573f2c', '#2e2015'];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const r = rng();
      mlctx.fillStyle = mulchPalette[r < 0.38 ? 0 : r < 0.70 ? 1 : r < 0.90 ? 2 : 3];
      mlctx.fillRect(x, y, 1, 1);
    }
  }
  const mulchTex = toTex(mlc, 1, 1);

  // 32. Galvanized Steel Chain-Link ("Frost") Diamond Wire Mesh (32x32 alpha cutout)
  const makeChainLink = (wireCol, glintCol, shadeCol) => {
    const [cc, cctx] = makeCanvas(32, 32);
    cctx.clearRect(0, 0, 32, 32);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const d1 = (x + y) % 8;
        const d2 = (x - y + 32) % 8;
        if (d1 === 0 || d2 === 0) {
          cctx.fillStyle = (d1 === 0 && d2 === 0) ? glintCol : ((x + y) % 16 === 0 ? shadeCol : wireCol);
          cctx.fillRect(x, y, 1, 1);
        }
      }
    }
    return toTex(cc, 1, 1);
  };
  const chainLinkTex = makeChainLink('#b6c2ce', '#eef5fc', '#7b8794');
  const blackChainLinkTex = makeChainLink('#282e35', '#4c5560', '#161a1f');

  // 33. Ornamental Steel / Aluminum Vertical Picket Fence & Railing (32x32 alpha cutout)
  const [ipc, ipctx] = makeCanvas(32, 32);
  ipctx.clearRect(0, 0, 32, 32);
  ipctx.fillStyle = '#e8edf2';
  ipctx.fillRect(0, 1, 32, 2);   // top rail
  ipctx.fillRect(0, 28, 32, 2);  // bottom rail
  for (let x = 2; x < 32; x += 4) {
    ipctx.fillStyle = '#dfe5eb';
    ipctx.fillRect(x, 1, 1, 29); // vertical steel pickets
    ipctx.fillStyle = '#ffffff';
    ipctx.fillRect(x, 0, 1, 1);  // picket finial tip
  }
  const ironPicketTex = toTex(ipc, 1, 1);

  // 34. Vertical Weathered Cedar / Pressure-Treated Wood Privacy Fence (32x32)
  const [wfc, wfctx] = makeCanvas(32, 32);
  const woodBoardCols = ['#9c7856', '#8f6c4c', '#a6825f', '#846243', '#967252'];
  for (let bx = 0; bx < 32; bx += 4) {
    const base = woodBoardCols[Math.floor(rng() * woodBoardCols.length)];
    wfctx.fillStyle = base;
    wfctx.fillRect(bx, 0, 3, 32);
    // Plank seam shadow
    wfctx.fillStyle = '#4e3927';
    wfctx.fillRect(bx + 3, 0, 1, 32);
    // Subtle wood grain streaks
    for (let gy = 0; gy < 32; gy++) {
      if (rng() < 0.25) {
        wfctx.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.06)';
        wfctx.fillRect(bx + (gy % 3), gy, 1, 2);
      }
    }
  }
  // Horizontal rail shadow bands
  wfctx.fillStyle = 'rgba(40,26,14,0.22)';
  wfctx.fillRect(0, 5, 32, 2);
  wfctx.fillRect(0, 25, 32, 2);
  const woodFenceTex = toTex(wfc, 1, 1);

  return {
    grassTex,
    snowTex,
    asphaltTex,
    drivewayTex,
    snowRoadTex,
    concreteTex,
    brickTextures,
    sidingTextures,
    shingleTextures,
    snowRoofTex,
    leafDeciduousTex,
    leafConiferTex,
    barkTex,
    hedgeTex,
    arretTex,
    soccerTex,
    tennisTex,
    rinkTex,
    winterIceTex,
    dirtPathTex,
    rustMetalTex,
    noParkingTex,
    schoolZoneTex,
    christmasShopWindowTex,
    christmasSignTex,
    wreathTex,
    windowTex,
    windowLitTex,
    garageDoorTex,
    gravelTex,
    cedarPlankTex,
    foundationTex,
    birchBarkTex,
    poleWoodTex,
    forestFloorTex,
    mulchTex,
    chainLinkTex,
    blackChainLinkTex,
    ironPicketTex,
    woodFenceTex,
    makeBannerTexture(text, bg, fg, w = 256, h = 64) {
      const [c, ctx] = makeCanvas(w, h);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      // Subtle top bevel & bottom shade for crisp storefront fascia
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(0, 0, w, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, h - 3, w, 3);
      // Sharp outer border
      ctx.strokeStyle = fg;
      ctx.lineWidth = 3;
      ctx.strokeRect(3.5, 3.5, w - 7, h - 7);
      // Crisp text with subtle pixel drop-shadow for readability
      ctx.font = `bold ${Math.floor(h * 0.46)}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.fillText(text, Math.round(w / 2) + 2, Math.round(h / 2) + 3, w - 22);
      ctx.fillStyle = fg;
      ctx.fillText(text, Math.round(w / 2), Math.round(h / 2) + 1, w - 22);
      const t = toTex(c, 1, 1);
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    },
  };
}
