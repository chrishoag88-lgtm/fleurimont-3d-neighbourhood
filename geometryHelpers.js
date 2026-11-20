import * as THREE from 'three';

/**
 * Samples ground elevation (in meters relative to baseElev) at world (x, z)
 * using bilinear interpolation over DATA.elevation.
 * Returns 0 safely if elevData is missing or invalid.
 */
export function sampleElevation(x, z, elevData) {
  if (!elevData || !elevData.values || !elevData.cols || !elevData.rows) {
    return 0;
  }
  const step = elevData.step || 70;
  const cols = elevData.cols;
  const rows = elevData.rows;

  let gx = (x - elevData.minX) / step;
  let gz = (z - elevData.minZ) / step;
  if (gx < 0) gx = 0;
  else if (gx > cols - 1) gx = cols - 1;
  if (gz < 0) gz = 0;
  else if (gz > rows - 1) gz = rows - 1;

  const c0 = Math.floor(gx);
  const r0 = Math.floor(gz);
  const c1 = Math.min(c0 + 1, cols - 1);
  const r1 = Math.min(r0 + 1, rows - 1);

  const tx = gx - c0;
  const tz = gz - r0;

  const vals = elevData.values;
  const v00 = vals[r0 * cols + c0] ?? 0;
  const v10 = vals[r0 * cols + c1] ?? 0;
  const v01 = vals[r1 * cols + c0] ?? 0;
  const v11 = vals[r1 * cols + c1] ?? 0;

  const v0 = v00 * (1 - tx) + v10 * tx;
  const v1 = v01 * (1 - tx) + v11 * tx;
  return v0 * (1 - tz) + v1 * tz;
}

/**
 * Merges an array of BufferGeometries (all sharing position/normal/uv attributes)
 * into a single non-indexed BufferGeometry to minimize WebGL draw calls.
 */
export function mergeGeometries(geos) {
  if (!geos || geos.length === 0) return null;
  const nonIndexed = [];
  let totalVerts = 0;

  for (let i = 0; i < geos.length; i++) {
    const g = geos[i];
    if (!g || !g.attributes.position) continue;
    const ng = g.index ? g.toNonIndexed() : g;
    if (!ng.attributes.normal) ng.computeVertexNormals();
    if (!ng.attributes.uv) {
      const count = ng.attributes.position.count;
      ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    totalVerts += ng.attributes.position.count;
    nonIndexed.push(ng);
  }

  if (totalVerts === 0) return null;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  let offset3 = 0;
  let offset2 = 0;
  for (let i = 0; i < nonIndexed.length; i++) {
    const g = nonIndexed[i];
    const pos = g.attributes.position.array;
    const nrm = g.attributes.normal.array;
    const uv = g.attributes.uv.array;

    positions.set(pos, offset3);
    normals.set(nrm, offset3);
    uvs.set(uv, offset2);

    offset3 += pos.length;
    offset2 += uv.length;
    if (g !== geos[i]) g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Creates a terrain mesh over [minX, maxX] x [minZ, maxZ] with grid spacing `cellSize`.
 * Supports either smooth heightfield vertices or quantized stepped micro-voxel terraces
 * (when `quantizeY > 0`).
 *
 * Accepts either an options object or positional args (size, cellSize, elevData, uvScale).
 */
export function createSteppedTerrainGeometry(optsOrSize = 2000, cellSizeArg = 8, elevDataArg = null, uvScaleArg = 0.25) {
  let minX = -1000;
  let maxX = 1000;
  let minZ = -1000;
  let maxZ = 1000;
  let cellSize = 8;
  let quantizeY = 0;
  let elevData = null;
  let uvScale = 0.25;

  if (typeof optsOrSize === 'object' && optsOrSize !== null) {
    const half = (optsOrSize.size ?? 2000) * 0.5;
    minX = optsOrSize.minX ?? -half;
    maxX = optsOrSize.maxX ?? half;
    minZ = optsOrSize.minZ ?? -half;
    maxZ = optsOrSize.maxZ ?? half;
    cellSize = optsOrSize.cellSize ?? 8;
    quantizeY = optsOrSize.quantizeY ?? 0;
    elevData = optsOrSize.elevData ?? null;
    uvScale = optsOrSize.uvScale ?? 0.25;
  } else {
    const half = (optsOrSize ?? 2000) * 0.5;
    minX = -half;
    maxX = half;
    minZ = -half;
    maxZ = half;
    cellSize = cellSizeArg;
    elevData = elevDataArg;
    uvScale = uvScaleArg;
  }

  const cols = Math.max(1, Math.round((maxX - minX) / cellSize));
  const rows = Math.max(1, Math.round((maxZ - minZ) / cellSize));
  const dx = (maxX - minX) / cols;
  const dz = (maxZ - minZ) / rows;

  if (quantizeY > 0) {
    // Stepped micro-voxel terrain with vertical skirts between height transitions
    const heights = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      const cz = minZ + (r + 0.5) * dz;
      for (let c = 0; c < cols; c++) {
        const cx = minX + (c + 0.5) * dx;
        const h = sampleElevation(cx, cz, elevData);
        heights[r * cols + c] = Math.round(h / quantizeY) * quantizeY;
      }
    }

    const positions = [];
    const normals = [];
    const uvs = [];

    const pushQuad = (ax, ay, az, bx, by, bz, cx, cy, cz, dxp, dyp, dzp, nx, ny, nz, u0, v0, u1, v1) => {
      positions.push(
        ax, ay, az, bx, by, bz, cx, cy, cz,
        ax, ay, az, cx, cy, cz, dxp, dyp, dzp
      );
      for (let k = 0; k < 6; k++) normals.push(nx, ny, nz);
      uvs.push(u0, v0, u0, v1, u1, v1, u0, v0, u1, v1, u1, v0);
    };

    for (let r = 0; r < rows; r++) {
      const z0 = minZ + r * dz;
      const z1 = z0 + dz;
      for (let c = 0; c < cols; c++) {
        const x0 = minX + c * dx;
        const x1 = x0 + dx;
        const h = heights[r * cols + c];

        // Top face (+Y)
        pushQuad(
          x0, h, z0,
          x0, h, z1,
          x1, h, z1,
          x1, h, z0,
          0, 1, 0,
          x0 * uvScale, z0 * uvScale, x1 * uvScale, z1 * uvScale
        );

        // East skirt (+X) if neighbor is lower
        if (c + 1 < cols) {
          const hn = heights[r * cols + (c + 1)];
          if (hn < h) {
            pushQuad(
              x1, h, z0,
              x1, h, z1,
              x1, hn, z1,
              x1, hn, z0,
              1, 0, 0,
              z0 * uvScale, h * uvScale, z1 * uvScale, hn * uvScale
            );
          } else if (hn > h) {
            pushQuad(
              x1, hn, z1,
              x1, hn, z0,
              x1, h, z0,
              x1, h, z1,
              -1, 0, 0,
              z0 * uvScale, hn * uvScale, z1 * uvScale, h * uvScale
            );
          }
        }

        // South skirt (+Z) if neighbor is lower
        if (r + 1 < rows) {
          const hn = heights[(r + 1) * cols + c];
          if (hn < h) {
            pushQuad(
              x1, h, z1,
              x0, h, z1,
              x0, hn, z1,
              x1, hn, z1,
              0, 0, 1,
              x0 * uvScale, h * uvScale, x1 * uvScale, hn * uvScale
            );
          } else if (hn > h) {
            pushQuad(
              x0, hn, z1,
              x1, hn, z1,
              x1, h, z1,
              x0, h, z1,
              0, 0, -1,
              x0 * uvScale, hn * uvScale, x1 * uvScale, h * uvScale
            );
          }
        }
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.computeBoundingSphere();
    return geom;
  }

  // Smooth subdivided terrain mesh
  const vCols = cols + 1;
  const vRows = rows + 1;
  const vertCount = vCols * vRows;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);

  let vi = 0;
  let ui = 0;
  for (let r = 0; r < vRows; r++) {
    const z = minZ + r * dz;
    for (let c = 0; c < vCols; c++) {
      const x = minX + c * dx;
      const y = sampleElevation(x, z, elevData);
      positions[vi++] = x;
      positions[vi++] = y;
      positions[vi++] = z;
      uvs[ui++] = x * uvScale;
      uvs[ui++] = z * uvScale;
    }
  }

  const indices = new Uint32Array(cols * rows * 6);
  let ii = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * vCols + c;
      const b = a + 1;
      const d = (r + 1) * vCols + c;
      const e = d + 1;
      // Winding for +Y normal
      indices[ii++] = a;
      indices[ii++] = d;
      indices[ii++] = b;
      indices[ii++] = b;
      indices[ii++] = d;
      indices[ii++] = e;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

/**
 * Subdivides a 2D polyline or closed polygon perimeter so no segment exceeds maxSegLen.
 */
function subdividePoints2D(pts, maxSegLen = 8, closed = false) {
  if (!pts || pts.length < 2) return pts || [];
  const out = [];
  const count = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.push([a[0], a[1]]);
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (dist > maxSegLen) {
      const steps = Math.ceil(dist / maxSegLen);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  if (!closed) {
    const last = pts[pts.length - 1];
    out.push([last[0], last[1]]);
  }
  return out;
}

/**
 * Creates a terrain-conforming horizontal polygon geometry in XZ at `yOffset` above
 * `sampleElevation(x, z, elevData)`. Subdivides perimeter edges (~8m) and large interior
 * triangles (~10m) when `elevData` is provided so parks, woods, and lots hug slopes.
 */
export function createGroundPolygonGeometry(pts, yOffset = 0.02, uvScale = 0.08, elevData = null) {
  if (!pts || pts.length < 3) return null;

  if (!elevData) {
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0], -pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      shape.lineTo(pts[i][0], -pts[i][1]);
    }
    shape.closePath();

    const geom = new THREE.ShapeGeometry(shape);
    geom.rotateX(-Math.PI / 2);
    geom.translate(0, yOffset, 0);

    const pos = geom.attributes.position;
    const uv = geom.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, pos.getX(i) * uvScale, pos.getZ(i) * uvScale);
    }
    return geom;
  }

  const subPts = subdividePoints2D(pts, 4.5, true);
  const contour = subPts.map(([x, z]) => new THREE.Vector2(x, -z));
  if (THREE.ShapeUtils.isClockWise(contour)) {
    contour.reverse();
  }
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  if (!faces || faces.length === 0) return null;

  // Subdivide any triangle (>5m edge) so interior follows sloped terrain cleanly
  const maxEdgeSq = 5 * 5;
  const tris = [];
  const splitTri = (ax, az, bx, bz, cx, cz, depth) => {
    if (depth < 4) {
      const dAB = (bx - ax) * (bx - ax) + (bz - az) * (bz - az);
      const dBC = (cx - bx) * (cx - bx) + (cz - bz) * (cz - bz);
      const dCA = (ax - cx) * (ax - cx) + (az - cz) * (az - cz);
      const maxD = Math.max(dAB, dBC, dCA);
      if (maxD > maxEdgeSq) {
        if (maxD === dAB) {
          const mx = (ax + bx) * 0.5;
          const mz = (az + bz) * 0.5;
          splitTri(ax, az, mx, mz, cx, cz, depth + 1);
          splitTri(mx, mz, bx, bz, cx, cz, depth + 1);
          return;
        }
        if (maxD === dBC) {
          const mx = (bx + cx) * 0.5;
          const mz = (bz + cz) * 0.5;
          splitTri(ax, az, bx, bz, mx, mz, depth + 1);
          splitTri(ax, az, mx, mz, cx, cz, depth + 1);
          return;
        }
        const mx = (cx + ax) * 0.5;
        const mz = (cz + az) * 0.5;
        splitTri(ax, az, bx, bz, mx, mz, depth + 1);
        splitTri(mx, mz, bx, bz, cx, cz, depth + 1);
        return;
      }
    }
    tris.push(ax, az, bx, bz, cx, cz);
  };

  for (let i = 0; i < faces.length; i++) {
    const [ia, ib, ic] = faces[i];
    const a = contour[ia];
    const b = contour[ib];
    const c = contour[ic];
    // Convert back from Shape (x, -z) to world (x, z)
    splitTri(a.x, -a.y, b.x, -b.y, c.x, -c.y, 0);
  }

  const positions = new Float32Array((tris.length / 2) * 3);
  const uvs = new Float32Array(tris.length);
  let pi = 0;
  let ui = 0;
  for (let i = 0; i < tris.length; i += 2) {
    const x = tris[i];
    const z = tris[i + 1];
    positions[pi++] = x;
    positions[pi++] = sampleElevation(x, z, elevData) + yOffset;
    positions[pi++] = z;
    uvs[ui++] = x * uvScale;
    uvs[ui++] = z * uvScale;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Extrudes a 2D XZ polygon vertically from yBase to yBase + height.
 */
export function createExtrudedPolygonGeometry(pts, height, yBase = 0) {
  if (!pts || pts.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], -pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i][0], -pts[i][1]);
  }
  shape.closePath();

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geom.rotateX(-Math.PI / 2);
  geom.translate(0, yBase, 0);
  return geom;
}

/**
 * Builds a terrain-conforming ribbon mesh along a polyline in XZ at `yOffset` above
 * `sampleElevation(x, z, elevData)`, subdividing segments every ~8m and adding circular joint caps.
 */
export function createRibbonGeometry(pts, width, yOffset = 0.045, uvTileLen = 8, elevData = null) {
  if (!pts || pts.length < 2) return null;
  const subPts = elevData ? subdividePoints2D(pts, 8, false) : pts;
  const halfW = width * 0.5;
  const positions = [];
  const uvs = [];
  let accumDist = 0;

  const getY = (x, z) => (elevData ? sampleElevation(x, z, elevData) + yOffset : yOffset);

  const pushTri = (ax, az, bx, bz, cx, cz, ua, va, ub, vb, uc, vc) => {
    positions.push(ax, getY(ax, az), az, bx, getY(bx, bz), bz, cx, getY(cx, cz), cz);
    uvs.push(ua, va, ub, vb, uc, vc);
  };

  // Joint / end cap disc at vertex i+1 (and vertex 0), offset 5mm below strip to avoid z-fighting
  const pushCapTri = (ax, az, bx, bz, cx, cz, ua, va, ub, vb, uc, vc) => {
    positions.push(ax, getY(ax, az) - 0.005, az, bx, getY(bx, bz) - 0.005, bz, cx, getY(cx, cz) - 0.005, cz);
    uvs.push(ua, va, ub, vb, uc, vc);
  };

  for (let i = 0; i < subPts.length - 1; i++) {
    const [x0, z0] = subPts[i];
    const [x1, z1] = subPts[i + 1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.02) continue;

    // Right-hand perpendicular in XZ (+X East, +Z South)
    const nx = (-dz / len) * halfW;
    const nz = (dx / len) * halfW;

    const u0 = accumDist / uvTileLen;
    const u1 = (accumDist + len) / uvTileLen;
    accumDist += len;

    const l0x = x0 - nx, l0z = z0 - nz;
    const r0x = x0 + nx, r0z = z0 + nz;
    const l1x = x1 - nx, l1z = z1 - nz;
    const r1x = x1 + nx, r1z = z1 + nz;

    // Winding order for +Y normal: (l0, r1, l1) and (l0, r0, r1)
    pushTri(l0x, l0z, r1x, r1z, l1x, l1z, u0, 0, u1, 1, u1, 0);
    pushTri(l0x, l0z, r0x, r0z, r1x, r1z, u0, 0, u0, 1, u1, 1);

    const capSteps = 8;
    const addCap = (cx, cz) => {
      for (let s = 0; s < capSteps; s++) {
        const a0 = (s / capSteps) * Math.PI * 2;
        const a1 = ((s + 1) / capSteps) * Math.PI * 2;
        const p0x = cx + Math.cos(a0) * halfW;
        const p0z = cz + Math.sin(a0) * halfW;
        const p1x = cx + Math.cos(a1) * halfW;
        const p1z = cz + Math.sin(a1) * halfW;
        pushCapTri(
          cx,
          cz,
          p1x,
          p1z,
          p0x,
          p0z,
          cx / uvTileLen,
          cz / uvTileLen,
          p1x / uvTileLen,
          p1z / uvTileLen,
          p0x / uvTileLen,
          p0z / uvTileLen
        );
      }
    };
    if (i === 0) addCap(x0, z0);
    if (i === subPts.length - 2) {
      addCap(x1, z1);
    } else {
      const [x2, z2] = subPts[i + 2];
      const dx2 = x2 - x1;
      const dz2 = z2 - z1;
      const len2 = Math.hypot(dx2, dz2);
      if (len2 >= 0.02) {
        const dot = (dx * dx2 + dz * dz2) / (len * len2);
        const turnAng = Math.acos(Math.max(-1, Math.min(1, dot)));
        if (turnAng > 0.12) addCap(x1, z1);
      }
    }
  }

  if (positions.length === 0) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Creates a pitched gable or hip roof prism centered at (0, 0, 0) in local coords
 * where X = depth (front-to-back) and Z = width (along street), extruded up along +Y.
 * UVs are scaled in world meters for crisp pixel-art shingle tiling.
 */
export function createPitchedRoofGeometry(depth, width, ridgeHeight, isHip = false, overhang = 0.35, uvScale = 0.28) {
  const hd = depth * 0.5 + overhang;
  const hw = width * 0.5 + overhang;
  const ridgeHalfW = isHip ? Math.max(0.2, hw - hd * 0.72) : hw;
  const slopeLen = Math.hypot(hd, ridgeHeight);

  const positions = [];
  const uvs = [];

  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz, u0, v0, u1, v1, u2, v2) => {
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    uvs.push(u0, v0, u1, v1, u2, v2);
  };

  const vSlope = slopeLen * uvScale;
  const uMin = -hw * uvScale;
  const uMax = hw * uvScale;
  const uRidgeMin = -ridgeHalfW * uvScale;
  const uRidgeMax = ridgeHalfW * uvScale;

  // Front slope (+X eave to ridge)
  tri(hd, 0, -hw, 0, ridgeHeight, -ridgeHalfW, 0, ridgeHeight, ridgeHalfW, uMin, 0, uRidgeMin, vSlope, uRidgeMax, vSlope);
  tri(hd, 0, -hw, 0, ridgeHeight, ridgeHalfW, hd, 0, hw, uMin, 0, uRidgeMax, vSlope, uMax, 0);

  // Back slope (-X eave to ridge)
  tri(-hd, 0, hw, 0, ridgeHeight, ridgeHalfW, 0, ridgeHeight, -ridgeHalfW, uMax, 0, uRidgeMax, vSlope, uRidgeMin, vSlope);
  tri(-hd, 0, hw, 0, ridgeHeight, -ridgeHalfW, -hd, 0, -hw, uMax, 0, uRidgeMin, vSlope, uMin, 0);

  // Side slopes (-Z and +Z) only for hip roofs; gable ends are filled separately with wall siding
  if (isHip) {
    const sideSlope = Math.hypot(hw - ridgeHalfW, ridgeHeight) * uvScale;
    tri(-hd, 0, -hw, 0, ridgeHeight, -ridgeHalfW, hd, 0, -hw, -hd * uvScale, 0, 0, sideSlope, hd * uvScale, 0);
    tri(hd, 0, hw, 0, ridgeHeight, ridgeHalfW, -hd, 0, hw, hd * uvScale, 0, 0, sideSlope, -hd * uvScale, 0);
  }

  // Soffit underside cap
  tri(-hd, 0, -hw, hd, 0, -hw, hd, 0, hw, 0, 0, hd * uvScale, 0, hd * uvScale, hw * uvScale);
  tri(-hd, 0, -hw, hd, 0, hw, -hd, 0, hw, 0, 0, hd * uvScale, hw * uvScale, 0, hw * uvScale);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Creates the two triangular gable wall faces at z = -width/2 and z = +width/2
 * with world-scaled UVs to match extruded wall siding/brick.
 */
export function createGableEndsGeometry(depth, width, ridgeHeight, uvScale = 0.25) {
  const hd = depth * 0.5;
  const hw = width * 0.5;
  const positions = [
    // -Z gable triangle
    -hd, 0, -hw, 0, ridgeHeight, -hw, hd, 0, -hw,
    // +Z gable triangle
    hd, 0, hw, 0, ridgeHeight, hw, -hd, 0, hw,
  ];
  const uSpan = hd * uvScale;
  const vTop = ridgeHeight * uvScale;
  const uvs = [
    -uSpan, 0, 0, vTop, uSpan, 0,
    uSpan, 0, 0, vTop, -uSpan, 0,
  ];
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Scales BoxGeometry UVs so each face tiles in world meters * uvScale
 * (matching createExtrudedPolygonGeometry for siding/brick/cedar textures).
 */
export function setWorldBoxUVs(geom, w, h, d, uvScale = 1.0) {
  const uv = geom.attributes.uv;
  if (!uv) return geom;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (i < 8) {
      uv.setXY(i, u * d * uvScale, v * h * uvScale);
    } else if (i < 16) {
      uv.setXY(i, u * w * uvScale, v * d * uvScale);
    } else {
      uv.setXY(i, u * w * uvScale, v * h * uvScale);
    }
  }
  uv.needsUpdate = true;
  return geom;
}

/**
 * Creates crisp aluminum fascia boards, gable rake trim & ridge cap matching createPitchedRoofGeometry.
 */
export function createRoofTrimGeometry(depth, width, ridgeHeight, isHip = false, overhang = 0.35) {
  const hd = depth * 0.5 + overhang;
  const hw = width * 0.5 + overhang;
  const ridgeHalfW = isHip ? Math.max(0.2, hw - hd * 0.72) : hw;
  const parts = [];

  // Front (+X) & back (-X) eave fascia boards
  for (const sgn of [-1, 1]) {
    const eave = new THREE.BoxGeometry(0.06, 0.16, hw * 2 + 0.04);
    eave.translate(sgn * hd, -0.02, 0);
    parts.push(eave);
  }

  // Ridge cap along roof peak
  const ridgeCap = new THREE.BoxGeometry(0.14, 0.09, ridgeHalfW * 2 + 0.04);
  ridgeCap.translate(0, ridgeHeight + 0.015, 0);
  parts.push(ridgeCap);

  if (isHip) {
    // Side eave fascias (-Z / +Z)
    for (const sgn of [-1, 1]) {
      const sideEave = new THREE.BoxGeometry(hd * 2 + 0.04, 0.16, 0.06);
      sideEave.translate(0, -0.02, sgn * hw);
      parts.push(sideEave);
    }
  } else {
    // Slanted gable rake trim boards along both -Z and +Z gable triangles
    const slopeLen = Math.hypot(hd, ridgeHeight) + 0.08;
    const pitchAng = Math.atan2(ridgeHeight, hd);
    for (const sgn of [-1, 1]) {
      const rakeZ = sgn * Math.max(0.2, hw - 0.14);
      const fRake = new THREE.BoxGeometry(slopeLen, 0.16, 0.14);
      fRake.rotateZ(-pitchAng);
      fRake.translate(hd * 0.5, ridgeHeight * 0.5 - 0.02, rakeZ);
      parts.push(fRake);

      const bRake = new THREE.BoxGeometry(slopeLen, 0.16, 0.14);
      bRake.rotateZ(pitchAng);
      bRake.translate(-hd * 0.5, ridgeHeight * 0.5 - 0.02, rakeZ);
      parts.push(bRake);
    }
  }

  return mergeGeometries(parts);
}
