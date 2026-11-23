import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createTextureLibrary } from './textures.js';
import { sampleElevation } from './geometryHelpers.js';
import {
  buildHero2646Cormiers,
  buildEcoleDeLaSamare,
  buildParksDetail,
  buildCommercialSigns,
  buildDepanneurGalvin,
  setWinterMode as heroSetWinterMode,
  setChristmasMode as heroSetChristmasMode,
  setNightMode as heroSetNightMode,
  updateHeroSmoke,
} from './heroLandmarks.js';
import {
  buildGroundAndLanduse,
  buildRoadNetwork,
  buildNeighborhoodBuildings,
  buildSuburbanDetailsAndTrees,
  setWinterMode as worldSetWinterMode,
  setChristmasMode as worldSetChristmasMode,
  setNightMode as worldSetNightMode,
  updateChimneySmoke,
} from './worldBuilders.js';
import { createSimulation, makePedestrianMesh } from './simulation.js';

const DATA = window.NEIGHBOURHOOD_DATA;
if (!DATA) {
  throw new Error('neighbourhood_data.js failed to load');
}

// Update header stats
document.getElementById('stats-line').textContent =
  `${DATA.buildings.length.toLocaleString()} buildings • ${DATA.roads.length} road segments • 1 km radius`;

// --- 1. Scene, Renderer, Camera & Controls ---
const container = document.getElementById('canvas-container');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec2eb);
scene.fog = new THREE.FogExp2(0x9bc8e8, 0.00046);

// --- 1b. Procedural Sky Gradient Dome, Blocky Sun & Drifting Minecraft Clouds ---
const skyUniforms = {
  uTopColor: { value: new THREE.Color(0x3a82d4) },
  uHorizonColor: { value: new THREE.Color(0xc2e2fa) },
};
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(2400, 28, 16),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uTopColor;
      uniform vec3 uHorizonColor;
      varying vec3 vWorldPos;
      void main() {
        float h = clamp(normalize(vWorldPos).y, 0.0, 1.0);
        vec3 col = mix(uHorizonColor, uTopColor, pow(h, 0.58));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
);
scene.add(skyDome);

const sunDiscMat = new THREE.MeshBasicMaterial({ color: 0xfff4c2, fog: false });
const sunDisc = new THREE.Mesh(new THREE.BoxGeometry(58, 58, 6), sunDiscMat);
scene.add(sunDisc);

// Drifting blocky Minecraft-style cumulus clouds
const CLOUD_COUNT = 85;
const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, fog: false });
const cloudMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cloudMat, CLOUD_COUNT * 3);
cloudMesh.frustumCulled = false;
const clouds = [];
const cloudDummy = new THREE.Object3D();
for (let i = 0; i < CLOUD_COUNT; i++) {
  const cx = (Math.random() - 0.5) * 2400;
  const cz = (Math.random() - 0.5) * 2400;
  const cy = 235 + (i % 5) * 14;
  const w = 36 + Math.random() * 58;
  const d = 24 + Math.random() * 38;
  const h = 7 + Math.random() * 5;
  clouds.push({ cx, cy, cz, w, h, d, spd: 2.2 + (i % 4) * 0.65 });
}
scene.add(cloudMesh);

// Crisp starry night sky starfield (~450 stars across upper sky dome)
const STAR_COUNT = 450;
const starPositions = new Float32Array(STAR_COUNT * 3);
const starColors = new Float32Array(STAR_COUNT * 3);
const starPalette = [
  new THREE.Color(0xffffff),
  new THREE.Color(0xdbe8ff),
  new THREE.Color(0xfff1d6),
  new THREE.Color(0xc4dbff),
];
for (let i = 0; i < STAR_COUNT; i++) {
  const az = Math.random() * Math.PI * 2;
  const el = 0.08 + Math.pow(Math.random(), 0.72) * (Math.PI * 0.41);
  const r = 1880 + Math.random() * 140;
  starPositions[i * 3] = Math.cos(el) * Math.cos(az) * r;
  starPositions[i * 3 + 1] = Math.sin(el) * r;
  starPositions[i * 3 + 2] = Math.cos(el) * Math.sin(az) * r;
  const c = starPalette[i % starPalette.length];
  const bright = 0.72 + Math.random() * 0.28;
  starColors[i * 3] = c.r * bright;
  starColors[i * 3 + 1] = c.g * bright;
  starColors[i * 3 + 2] = c.b * bright;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
const starMat = new THREE.PointsMaterial({
  size: 9.5,
  sizeAttenuation: true,
  vertexColors: true,
  transparent: true,
  opacity: 0.94,
  depthWrite: false,
  fog: false,
});
const stars = new THREE.Points(starGeo, starMat);
stars.frustumCulled = false;
stars.visible = false;
scene.add(stars);

const camera = new THREE.PerspectiveCamera(54, window.innerWidth / window.innerHeight, 0.4, 3400);
// Initial view: Street-side oblique angle framing 2646 Rue des Cormiers from Rue des Cormiers
camera.position.set(27, 11.5, 16);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.maxPolarAngle = Math.PI * 0.488;
orbit.minDistance = 4;
orbit.maxDistance = 1650;
orbit.target.set(0, 2.5, 0);
orbit.update();

// --- 2. Lighting (Sun/Moon + Sky Hemisphere + Ambient + Shadow Frustum) ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.08);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xdff0ff, 0x677a54, 0.92);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff5e0, 2.25);
sunLight.position.set(160, 210, 120);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 20;
sunLight.shadow.camera.far = 750;
const shadowSpan = 165;
sunLight.shadow.camera.left = -shadowSpan;
sunLight.shadow.camera.right = shadowSpan;
sunLight.shadow.camera.top = shadowSpan;
sunLight.shadow.camera.bottom = -shadowSpan;
sunLight.shadow.bias = -0.0004;
scene.add(sunLight);
scene.add(sunLight.target);

// --- 3. Build Textures, Terrain, Roads, Landmarks, Buildings & Simulation ---
const texLib = createTextureLibrary();
const { ringMesh } = buildGroundAndLanduse(scene, DATA, texLib);
ringMesh.visible = false;
buildRoadNetwork(scene, DATA, texLib);
const pickableBuildingMeshes = buildNeighborhoodBuildings(scene, DATA, texLib);

const b2646 = DATA.buildings.find((b) => b.id === 827707358);
const hero2646 = buildHero2646Cormiers(scene, texLib, b2646, DATA.elevation);
pickableBuildingMeshes.push(hero2646.root);

const bSamare = DATA.buildings.find((b) => b.id === 169345734);
if (bSamare) {
  buildEcoleDeLaSamare(scene, texLib, bSamare, DATA.pitches, DATA.playgrounds, DATA.elevation);
}
buildParksDetail(scene, texLib, DATA.pitches, DATA.playgrounds, DATA.leisureProps, DATA.elevation);
buildCommercialSigns(scene, texLib, DATA.buildings, DATA.elevation);

const bGalvin = DATA.buildings.find((b) => b.id === 827183553);
const galvinMesh = buildDepanneurGalvin(scene, texLib, bGalvin, DATA.elevation);
if (galvinMesh) pickableBuildingMeshes.push(galvinMesh);

const { lampBulbMesh, obstacles } = buildSuburbanDetailsAndTrees(scene, DATA, texLib);
const simulation = createSimulation(scene, DATA, obstacles);
const collider = simulation.collider;
const elevAt = (x, z) => sampleElevation(x, z, DATA.elevation);

function resolvePlayerCollisions(x, z, radius = 0.42) {
  let px = x;
  let pz = z;
  const staticRes = collider.resolveCircle(px, pz, radius);
  px = staticRes.x;
  pz = staticRes.z;

  if (chkTraffic.checked) {
    const dyn = simulation.getDynamicObstacles();
    for (const v of dyn.vehicles) {
      const dx = px - v.x;
      const dz = pz - v.z;
      if (dx * dx + dz * dz > 36) continue;
      const fwd = dx * v.ux + dz * v.uz;
      const lat = -dx * v.uz + dz * v.ux;
      const cf = Math.max(-v.hw, Math.min(v.hw, fwd));
      const cl = Math.max(-v.hd, Math.min(v.hd, lat));
      const df = fwd - cf;
      const dl = lat - cl;
      const dSq = df * df + dl * dl;
      if (dSq < radius * radius) {
        let nf = 0, nl = 0, push = 0;
        if (dSq > 1e-8) {
          const d = Math.sqrt(dSq);
          nf = df / d;
          nl = dl / d;
          push = radius - d;
        } else {
          nl = lat >= 0 ? 1 : -1;
          push = v.hd - Math.abs(lat) + radius;
        }
        px += v.ux * nf * push - v.uz * nl * push;
        pz += v.uz * nf * push + v.ux * nl * push;
      }
    }
    for (const p of dyn.peds) {
      const dx = px - p.x;
      const dz = pz - p.z;
      const minD = radius + p.r;
      const dSq = dx * dx + dz * dz;
      if (dSq > 1e-6 && dSq < minD * minD) {
        const d = Math.sqrt(dSq);
        const push = minD - d;
        px += (dx / d) * push;
        pz += (dz / d) * push;
      }
    }
  }
  return { x: px, z: pz };
}

// --- 3b. Playable Little 3rd-Person Character ---
const playerChar = makePedestrianMesh(0xd93838, 0x243b5c, true, 0x2b6cb0);
playerChar.root.visible = false;
playerChar.root.position.set(16.5, elevAt(16.5, 6.0), 6.0);
scene.add(playerChar.root);
const charState = {
  x: 16.5,
  y: elevAt(16.5, 6.0),
  z: 6.0,
  velY: 0,
  facing: Math.PI,
  phase: 0,
};

// --- 4. Camera Modes (Orbit, Street Walk, Drone Fly) & Bookmarks ---
let camMode = 'orbit';
const keysDown = new Set();
let walkYaw = Math.PI * 0.92;
let walkPitch = -0.05;
let isDraggingLook = false;
let lastMouseX = 0;
let lastMouseY = 0;
let glideAnim = null;

const withElev = (x, yOff, z) => [x, elevAt(x, z) + yOff, z];
const LANDMARKS = {
  home2646: { pos: withElev(27, 11.5, 16), target: withElev(0, 2.5, 0), walkPos: withElev(17, 1.72, 10) },
  cormiersStreet: { pos: withElev(20, 2.3, 18), target: withElev(0, 2.4, -1.5), walkPos: withElev(18.5, 1.72, 8) },
  samare: { pos: withElev(262, 28, 148), target: withElev(272, 3, 248), walkPos: withElev(264, 1.72, 195) },
  charland: { pos: withElev(-168, 34, -148), target: withElev(-198, 2, -255), walkPos: withElev(-178, 1.72, -225) },
  ducharme: { pos: withElev(-165, 42, -430), target: withElev(-208, 2, -512), walkPos: withElev(-195, 1.72, -485) },
  tilleuls: { pos: withElev(-265, 22, 390), target: withElev(-335, 3, 455), walkPos: withElev(-310, 1.72, 425) },
  kingEst: { pos: withElev(-740, 48, -660), target: withElev(-810, 4, -745), walkPos: withElev(-770, 1.72, -720) },
  overview: { pos: [40, 740, 790], target: withElev(0, 0, -40), walkPos: withElev(18, 1.72, 0) },
};

function jumpTo(pos, target) {
  if (camMode === 'char') {
    charState.x = pos[0];
    charState.z = pos[2];
    charState.y = elevAt(charState.x, charState.z);
    charState.velY = 0;
    const dir = new THREE.Vector3(target[0] - pos[0], 0, target[2] - pos[2]);
    if (dir.lengthSq() > 0.01) {
      walkYaw = Math.atan2(dir.x, dir.z);
      charState.facing = -Math.atan2(dir.z, dir.x);
    }
    return;
  }
  if (camMode === 'orbit') {
    glideAnim = {
      startPos: camera.position.clone(),
      endPos: new THREE.Vector3(...pos),
      startTgt: orbit.target.clone(),
      endTgt: new THREE.Vector3(...target),
      t: 0,
    };
  } else {
    const camY = camMode === 'walk' ? elevAt(pos[0], pos[2]) + 1.72 : pos[1];
    camera.position.set(pos[0], camY, pos[2]);
    const dir = new THREE.Vector3(target[0] - pos[0], target[1] - camY, target[2] - pos[2]).normalize();
    walkYaw = Math.atan2(dir.x, dir.z);
    walkPitch = Math.asin(Math.max(-0.9, Math.min(0.9, dir.y)));
  }
}

document.querySelectorAll('.lm-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lm-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const lm = LANDMARKS[btn.dataset.lm];
    if (!lm) return;
    if (camMode === 'walk' || camMode === 'char') {
      jumpTo(lm.walkPos, lm.target);
    } else {
      jumpTo(lm.pos, lm.target);
    }
  });
});

function setCameraMode(mode) {
  camMode = mode;
  glideAnim = null;
  playerChar.root.visible = mode === 'char';
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  const hint = document.getElementById('controls-hint');

  if (mode === 'char') {
    orbit.enabled = false;
    const tx = Math.abs(camera.position.x) < 1100 ? orbit.target.x : 16.5;
    const tz = Math.abs(camera.position.z) < 1100 ? orbit.target.z : 6.0;
    if (Math.hypot(charState.x - tx, charState.z - tz) > 40) {
      charState.x = tx;
      charState.z = tz;
    }
    charState.y = elevAt(charState.x, charState.z);
    charState.velY = 0;
    walkYaw = Math.atan2(Math.cos(-charState.facing), Math.sin(-charState.facing));
    walkPitch = 0.32;
    hint.textContent = 'Little Character • W/S: Walk • A/D: Turn • Q/E: Strafe • Shift: Sprint • Space: Jump • Stop & Drag: Look';
  } else if (mode === 'orbit') {
    orbit.enabled = true;
    const camGround = elevAt(camera.position.x, camera.position.z);
    if (camera.position.y < camGround + 3) {
      camera.position.y = camGround + 11.5;
    }
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    orbit.target.copy(camera.position).addScaledVector(forward, 25);
    const tgtGround = elevAt(orbit.target.x, orbit.target.z);
    orbit.target.y = Math.max(tgtGround, Math.min(tgtGround + 12, orbit.target.y));
    orbit.update();
    hint.textContent = 'Left-drag: Orbit • Right-drag: Pan • Scroll: Zoom • Click building: Inspect';
  } else if (mode === 'walk') {
    orbit.enabled = false;
    camera.position.y = elevAt(camera.position.x, camera.position.z) + 1.72;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    walkYaw = Math.atan2(forward.x, forward.z);
    walkPitch = -0.02;
    hint.textContent = 'Eye-level 1.7m • WASD / Arrows: Walk • Drag mouse: Look around • Shift: Jog';
  } else {
    orbit.enabled = false;
    const camGround = elevAt(camera.position.x, camera.position.z);
    if (camera.position.y < camGround + 4) camera.position.y = camGround + 18;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    walkYaw = Math.atan2(forward.x, forward.z);
    walkPitch = Math.asin(Math.max(-0.9, Math.min(0.9, forward.y)));
    hint.textContent = 'Drone Fly • WASD: Move • Q/E: Up/Down • Drag mouse: Look • Shift: Boost';
  }
}

document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => setCameraMode(btn.dataset.mode));
});

const isCharMoving = () =>
  keysDown.has('KeyW') ||
  keysDown.has('KeyS') ||
  keysDown.has('KeyA') ||
  keysDown.has('KeyD') ||
  keysDown.has('KeyQ') ||
  keysDown.has('KeyE') ||
  keysDown.has('ArrowUp') ||
  keysDown.has('ArrowDown') ||
  keysDown.has('ArrowLeft') ||
  keysDown.has('ArrowRight');

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  keysDown.add(e.code);
});
window.addEventListener('keyup', (e) => keysDown.delete(e.code));
window.addEventListener('blur', () => {
  keysDown.clear();
  isDraggingLook = false;
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  if (camMode !== 'orbit' && e.button === 0) {
    isDraggingLook = true;
  }
});
window.addEventListener('pointerup', () => {
  isDraggingLook = false;
});
window.addEventListener('pointermove', (e) => {
  if (isDraggingLook && camMode !== 'orbit') {
    if (camMode === 'char' && isCharMoving()) return;
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    walkYaw -= dx * 0.0042;
    walkPitch = Math.max(-1.4, Math.min(1.4, walkPitch - dy * 0.0042));
  }
});

// --- 5. Time-of-Day Daylight, Day/Night Mode, Winter Mode & Layer Controls ---
const timeSlider = document.getElementById('time-slider');
const timeDisplay = document.getElementById('time-display');
const modeDayBtn = document.getElementById('mode-day');
const modeNightBtn = document.getElementById('mode-night');
const chkWinter = document.getElementById('chk-winter');
const winterToggleLabel = document.querySelector('.winter-toggle');
const winterPill = document.querySelector('.winter-pill');
const chkChristmas = document.getElementById('chk-christmas');
const christmasToggleLabel = document.querySelector('.christmas-toggle');
const christmasPill = document.querySelector('.christmas-pill');
let nightFactor = 0;
let isNightMode = false;
let isWinter = false;
let isChristmas = false;

function updateDaylight(hour) {
  const hh = Math.floor(hour);
  const mm = Math.round((hour - hh) * 60);
  timeDisplay.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

  const isNight = hour >= 19.5 || hour < 6.2;
  isNightMode = isNight;
  if (modeDayBtn) modeDayBtn.classList.toggle('active', !isNight);
  if (modeNightBtn) modeNightBtn.classList.toggle('active', isNight);

  // Sun elevation arc (06:00 sunrise -> 12:30 noon -> 19:30 sunset) or high moonlight rim at night
  const dayProgress = (hour - 6.0) / 13.5; // 0..1
  const elev = Math.sin(Math.max(0.02, Math.min(0.98, dayProgress)) * Math.PI) * 1.15;
  const azim = (dayProgress - 0.5) * 2.4 + 0.35;
  const dist = 260;
  if (isNight) {
    sunLight.userData.offset = new THREE.Vector3(-140, 185, -125);
  } else {
    sunLight.userData.offset = new THREE.Vector3(
      Math.sin(azim) * Math.cos(elev) * dist,
      Math.max(12, Math.sin(elev) * dist),
      Math.cos(azim) * Math.cos(elev) * dist
    );
  }

  // Night / dusk factor (0 in bright afternoon, 1 at true night)
  nightFactor = isNight
    ? 1
    : hour > 18.0
      ? Math.min(1, (hour - 18.0) / 1.5)
      : hour < 7.5
        ? Math.min(1, (7.5 - hour) / 1.3)
        : 0;
  const goldenFactor = isNight
    ? 0
    : Math.max(
        hour > 16.5 && hour < 19.5 ? 1 - Math.abs(hour - 18.1) / 1.6 : 0,
        hour < 8.5 ? 1 - Math.abs(hour - 6.9) / 1.6 : 0
      );

  const dayTop = isWinter ? new THREE.Color(0x8ca9c4) : new THREE.Color(0x3a82d4);
  const dayHor = isWinter ? new THREE.Color(0xd5e3ef) : new THREE.Color(0xc2e2fa);
  const goldenTop = new THREE.Color(0x4a5991);
  const goldenHor = isWinter ? new THREE.Color(0xe0bcb6) : new THREE.Color(0xf5aa78);
  const nightTop = isWinter ? new THREE.Color(0x0a1324) : new THREE.Color(0x050914);
  const nightHor = isWinter ? new THREE.Color(0x0f1a30) : new THREE.Color(0x091022);

  const topCol = dayTop.clone().lerp(goldenTop, goldenFactor * 0.7).lerp(nightTop, nightFactor);
  const horCol = dayHor.clone().lerp(goldenHor, goldenFactor * 0.72).lerp(nightHor, nightFactor);
  skyUniforms.uTopColor.value.copy(topCol);
  skyUniforms.uHorizonColor.value.copy(horCol);

  scene.background.copy(horCol);
  scene.fog.color.copy(horCol);
  scene.fog.density = (isWinter ? 0.00058 : 0.00044) + nightFactor * (isWinter ? 0.00038 : 0.00034);

  cloudMat.color.copy(
    new THREE.Color(isWinter ? 0xe8eff7 : 0xffffff)
      .lerp(new THREE.Color(0xffcfa8), goldenFactor * 0.65)
      .lerp(new THREE.Color(isWinter ? 0x1e2c45 : 0x162036), nightFactor * 0.92)
  );
  cloudMat.opacity = isNight ? (isWinter ? 0.36 : 0.28) : isWinter ? 0.92 : 0.86 - nightFactor * 0.35;
  sunDiscMat.color.copy(new THREE.Color(0xfff5c4).lerp(new THREE.Color(0xff9c54), goldenFactor));
  sunDisc.visible = !isNight && nightFactor < 0.85;
  stars.visible = isNight;

  const daySunCol = new THREE.Color(isWinter ? 0xf5f8ff : 0xfff5e0).lerp(
    new THREE.Color(isWinter ? 0xffb38a : 0xff9f59),
    goldenFactor * 0.85
  );
  const moonCol = new THREE.Color(isWinter ? 0xb4ccf5 : 0x9ab8e8);
  sunLight.color.copy(daySunCol).lerp(moonCol, nightFactor);
  sunLight.intensity = isNight
    ? isWinter ? 0.42 : 0.34
    : Math.max(0.35, (isWinter ? 1.85 : 2.25) * (1 - nightFactor * 0.8));

  const dayHemiSky = new THREE.Color(isWinter ? 0xddebf7 : 0xdff0ff);
  const nightHemiSky = new THREE.Color(isWinter ? 0x4b6899 : 0x354d7a);
  const dayHemiGnd = new THREE.Color(isWinter ? 0x9fb2c4 : 0x677a54);
  const nightHemiGnd = new THREE.Color(isWinter ? 0x223047 : 0x121926);
  hemiLight.color.copy(dayHemiSky).lerp(nightHemiSky, nightFactor);
  hemiLight.groundColor.copy(dayHemiGnd).lerp(nightHemiGnd, nightFactor);
  hemiLight.intensity = isNight
    ? isWinter ? 0.32 : 0.24
    : (isWinter ? 1.05 : 0.92) * (1 - nightFactor * 0.68) + 0.16;

  ambientLight.color.setHex(isNight ? (isWinter ? 0x2b3e60 : 0x1f2f4d) : 0xffffff);
  ambientLight.intensity = isNight ? (isWinter ? 0.16 : 0.12) : isWinter ? 0.10 : 0.08;

  worldSetNightMode(isNight);
  heroSetNightMode(isNight);

  if (lampBulbMesh) {
    lampBulbMesh.material.emissiveIntensity = isNight
      ? 2.2 + (isChristmas ? 0.25 : 0)
      : 0.15 + nightFactor * 2.05;
  }
}

if (modeDayBtn) {
  modeDayBtn.addEventListener('click', () => {
    timeSlider.value = '14.5';
    updateDaylight(14.5);
  });
}
if (modeNightBtn) {
  modeNightBtn.addEventListener('click', () => {
    timeSlider.value = '22.0';
    updateDaylight(22.0);
  });
}
timeSlider.addEventListener('input', () => updateDaylight(parseFloat(timeSlider.value)));
updateDaylight(14.5);

// --- 5b. Gentle 3D Snowfall Particle System (~2,200 voxel snow cubes) ---
const SNOW_COUNT = 2200;
const SNOW_SPAN_XZ = 130;
const SNOW_SPAN_Y = 55;
const snowGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
const snowMat = new THREE.MeshBasicMaterial({ color: 0xf6fbff });
const snowMesh = new THREE.InstancedMesh(snowGeo, snowMat, SNOW_COUNT);
snowMesh.frustumCulled = false;
snowMesh.visible = false;
scene.add(snowMesh);

const snowFlakes = [];
const snowDummy = new THREE.Object3D();
for (let i = 0; i < SNOW_COUNT; i++) {
  snowFlakes.push({
    x: (Math.random() - 0.5) * SNOW_SPAN_XZ,
    y: (Math.random() - 0.5) * SNOW_SPAN_Y,
    z: (Math.random() - 0.5) * SNOW_SPAN_XZ,
    speed: 1.5 + Math.random() * 1.6,
    phase: Math.random() * Math.PI * 2,
    sway: 0.45 + Math.random() * 0.7,
    scale: 0.7 + Math.random() * 0.75,
  });
}

function wrapCoord(val, center, span) {
  const half = span * 0.5;
  return center + ((((val - center) % span) + span + half) % span) - half;
}

function updateSnowfall(dt, elapsedSec) {
  if (!isWinter) {
    snowMesh.visible = false;
    return;
  }
  snowMesh.visible = true;
  const cx = camera.position.x;
  const cy = camera.position.y;
  const cz = camera.position.z;
  for (let i = 0; i < SNOW_COUNT; i++) {
    const f = snowFlakes[i];
    f.y -= f.speed * dt;
    f.x += Math.sin(elapsedSec * 0.9 + f.phase) * f.sway * dt;
    f.z += Math.cos(elapsedSec * 0.7 + f.phase) * f.sway * 0.7 * dt;

    const wx = wrapCoord(f.x, cx, SNOW_SPAN_XZ);
    const wy = wrapCoord(f.y, cy, SNOW_SPAN_Y);
    const wz = wrapCoord(f.z, cz, SNOW_SPAN_XZ);
    snowDummy.position.set(wx, wy, wz);
    snowDummy.scale.setScalar(f.scale);
    snowDummy.updateMatrix();
    snowMesh.setMatrixAt(i, snowDummy.matrix);
  }
  snowMesh.instanceMatrix.needsUpdate = true;
}

function applyChristmasMode(active) {
  const next = !!active && isWinter;
  isChristmas = next;
  if (chkChristmas) chkChristmas.checked = next;
  if (christmasToggleLabel) christmasToggleLabel.classList.toggle('active', next);
  if (christmasPill) christmasPill.textContent = next ? 'ON' : 'OFF';
  worldSetChristmasMode(next);
  heroSetChristmasMode(next);
  updateDaylight(parseFloat(timeSlider.value));
}

function applyWinterMode(active) {
  isWinter = !!active;
  if (winterToggleLabel) winterToggleLabel.classList.toggle('active', isWinter);
  if (winterPill) winterPill.textContent = isWinter ? 'ON' : 'OFF';
  if (chkChristmas) chkChristmas.disabled = !isWinter;
  if (christmasToggleLabel) christmasToggleLabel.classList.toggle('disabled', !isWinter);
  if (!isWinter && isChristmas) {
    applyChristmasMode(false);
  }
  worldSetWinterMode(isWinter);
  heroSetWinterMode(isWinter);
  simulation.setWinterMode(isWinter);
  playerChar.setWinterMode?.(isWinter);
  snowMesh.visible = isWinter;
  updateDaylight(parseFloat(timeSlider.value));
}

if (chkWinter) {
  chkWinter.addEventListener('change', () => applyWinterMode(chkWinter.checked));
}
if (chkChristmas) {
  chkChristmas.addEventListener('change', () => applyChristmasMode(chkChristmas.checked));
}

const chkLabels = document.getElementById('chk-labels');
const chkPin = document.getElementById('chk-pin');
const chkTraffic = document.getElementById('chk-traffic');
const chkRing = document.getElementById('chk-ring');

chkPin.addEventListener('change', () => {
  hero2646.pinGroup.visible = chkPin.checked;
});
chkRing.addEventListener('change', () => {
  ringMesh.visible = chkRing.checked;
});

// HUD Collapse toggle
const hudLeft = document.getElementById('hud-left');
const toggleHudBtn = document.getElementById('toggle-hud');
toggleHudBtn.addEventListener('click', () => {
  const collapsed = hudLeft.classList.toggle('collapsed');
  toggleHudBtn.classList.toggle('shifted', collapsed);
  toggleHudBtn.textContent = collapsed ? 'Show UI' : 'Hide UI';
});

// --- 6. Projected 3D Labels (Streets & Key Landmarks) ---
const labelsLayer = document.getElementById('labels-layer');
const WORLD_LABELS = [
  { text: '2646 Rue des Cormiers', x: 0, y: 10.5, z: 0, cls: 'target', maxDist: 750 },
  { text: 'École de la Samare', x: 270, y: 11, z: 245, cls: 'landmark', maxDist: 1100 },
  { text: 'Parc Gilles-Charland', x: -200, y: 7, z: -260, cls: 'landmark', maxDist: 950 },
  { text: 'Parc Ducharme', x: -209, y: 7, z: -512, cls: 'landmark', maxDist: 900 },
  { text: 'Parc Walter-Camden', x: 517, y: 8, z: 334, cls: 'landmark', maxDist: 950 },
  { text: 'Parc Bibeau', x: 419, y: 8, z: -923, cls: 'landmark', maxDist: 950 },
  { text: 'Dépanneur Galvin (Voisin)', x: 145, y: 8.5, z: -167, cls: 'landmark', maxDist: 700 },
  { text: 'Jean Coutu (King Est)', x: -535, y: 9, z: -815, cls: 'landmark', maxDist: 950 },
  { text: 'Rue des Cormiers', x: 18, y: 3, z: -22, cls: 'street', maxDist: 380 },
  { text: 'Rue Allard', x: 103, y: 3, z: 10, cls: 'street', maxDist: 650 },
  { text: 'Rue du Chalumeau', x: 255, y: 3, z: 194, cls: 'street', maxDist: 650 },
  { text: 'Chemin Galvin', x: 50, y: 3, z: -165, cls: 'street', maxDist: 750 },
  { text: 'Rue des Merisiers', x: -350, y: 3, z: 115, cls: 'street', maxDist: 650 },
  { text: 'Rue des Tilleuls', x: -335, y: 3, z: 455, cls: 'street', maxDist: 650 },
  { text: 'Rue Normand', x: -165, y: 3, z: -690, cls: 'street', maxDist: 800 },
  { text: 'Rue King Est (Rte 112)', x: -720, y: 4, z: -760, cls: 'street', maxDist: 1050 },
];

const labelEls = WORLD_LABELS.map((item) => {
  const el = document.createElement('div');
  el.className = `world-label ${item.cls}`;
  el.textContent = item.text;
  labelsLayer.appendChild(el);
  return { ...item, el, vec: new THREE.Vector3(item.x, elevAt(item.x, item.z) + item.y, item.z) };
});

function updateWorldLabels() {
  if (!chkLabels.checked) {
    labelsLayer.style.display = 'none';
    return;
  }
  labelsLayer.style.display = 'block';
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (const lbl of labelEls) {
    const dist = camera.position.distanceTo(lbl.vec);
    if (dist > lbl.maxDist) {
      lbl.el.style.display = 'none';
      continue;
    }
    const proj = lbl.vec.clone().project(camera);
    if (proj.z > 1 || proj.z < -1) {
      lbl.el.style.display = 'none';
      continue;
    }
    const sx = (proj.x * 0.5 + 0.5) * w;
    const sy = (-proj.y * 0.5 + 0.5) * h;
    if (sx < -60 || sx > w + 60 || sy < -40 || sy > h + 40) {
      lbl.el.style.display = 'none';
      continue;
    }
    lbl.el.style.display = 'block';
    lbl.el.style.left = `${sx}px`;
    lbl.el.style.top = `${sy}px`;
    lbl.el.style.opacity = String(Math.max(0.25, Math.min(1, 1.15 - dist / lbl.maxDist)));
  }
}

// --- 7. Building Raycaster & Address Inspector ---
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const hoverTip = document.getElementById('hover-tip');
const inspCard = document.getElementById('inspector-card');
const inspTitle = document.getElementById('insp-title');
const inspBody = document.getElementById('insp-body');
document.getElementById('insp-close').addEventListener('click', () => inspCard.classList.add('hidden'));

const STYLE_NAMES = {
  hero_2646: '2-Storey Quebec Cottage + Carport',
  cottage_2s: '2-Storey Quebec Cottage',
  cottage_1_5s: '1.5-Storey Gable Cottage',
  bungalow_brick: 'Quebec Brick Bungalow (Plain-Pied)',
  bungalow_vinyl: 'Quebec Vinyl Bungalow (Plain-Pied)',
  splitlevel: 'Split-Level (Paliers Multiples)',
  quadruplex: '2-Storey Brick Quadruplex',
  apartments: 'Multi-Unit Apartment Building',
  modular: 'Manufactured / Modular Home',
  garage_shed: 'Detached Garage / Cabanon',
  school_samare: 'Elementary School (1-Storey + Gym)',
  commercial: 'Commercial / Institutional Building',
  semidetached: 'Semi-Detached (Jumelé)',
  barn: 'Agricultural Barn',
};

function findNearestBuilding(x, z) {
  let best = null;
  let bestD = 18;
  for (const b of DATA.buildings) {
    const d = Math.hypot(b.cx - x, b.cz - z);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function formatBuildingLabel(b) {
  if (b.id === 827183553) return 'Dépanneur Galvin (Voisin) — 2785 Ch. Galvin';
  if (b.name) return b.name;
  if (b.hn && b.street) return `${b.hn} ${b.street}`;
  if (b.street) return `${b.street} (${b.type})`;
  return `Building #${b.id}`;
}

let pointerDownPos = [0, 0];
renderer.domElement.addEventListener('pointerdown', (e) => {
  pointerDownPos = [e.clientX, e.clientY];
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (isDraggingLook) {
    hoverTip.classList.add('hidden');
    return;
  }
  pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(pickableBuildingMeshes, true);
  if (hits.length > 0) {
    const b = findNearestBuilding(hits[0].point.x, hits[0].point.z);
    if (b) {
      hoverTip.textContent = formatBuildingLabel(b);
      hoverTip.style.left = `${e.clientX + 14}px`;
      hoverTip.style.top = `${e.clientY + 14}px`;
      hoverTip.classList.remove('hidden');
      return;
    }
  }
  hoverTip.classList.add('hidden');
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - pointerDownPos[0], e.clientY - pointerDownPos[1]) > 5) return;
  pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(pickableBuildingMeshes, true);
  if (hits.length > 0) {
    const b = findNearestBuilding(hits[0].point.x, hits[0].point.z);
    if (b) {
      inspTitle.textContent = formatBuildingLabel(b);
      const dist2646 = Math.round(Math.hypot(b.cx, b.cz));
      const rows = [
        ['Address', `${b.hn ? `${b.hn} ` : ''}${b.street || 'Fleurimont'}`],
        ['Style', STYLE_NAMES[b.style] || b.type],
        ['Footprint', `${b.w.toFixed(1)}m × ${b.d.toFixed(1)}m (${b.area} m²)`],
        ['Distance from 2646', `${dist2646} m`],
      ];
      inspBody.replaceChildren(
        ...rows.map(([label, val]) => {
          const row = document.createElement('div');
          row.className = 'row';
          const k = document.createElement('span');
          k.className = 'k';
          k.textContent = label;
          const v = document.createElement('span');
          v.className = 'v';
          v.textContent = val;
          row.append(k, v);
          return row;
        })
      );
      inspCard.classList.remove('hidden');
    }
  }
});

// --- 8. Interactive 2D Minimap Radar ---
const minimap = document.getElementById('minimap');
const mctx = minimap.getContext('2d');
const baseMapCanvas = document.createElement('canvas');
baseMapCanvas.width = 210;
baseMapCanvas.height = 210;
const bmctx = baseMapCanvas.getContext('2d');

const mapToPx = (wx, wz) => [105 + (wx / 1080) * 100, 105 + (wz / 1080) * 100];

(function renderMinimapBase() {
  bmctx.fillStyle = '#1b271e';
  bmctx.fillRect(0, 0, 210, 210);

  // Woods & Parks
  bmctx.fillStyle = '#253f27';
  for (const w of DATA.woods) {
    bmctx.beginPath();
    w.forEach(([x, z], idx) => {
      const [px, py] = mapToPx(x, z);
      if (idx === 0) bmctx.moveTo(px, py);
      else bmctx.lineTo(px, py);
    });
    bmctx.closePath();
    bmctx.fill();
  }
  bmctx.fillStyle = '#386d3c';
  for (const p of [...DATA.parks, ...DATA.schoolGrounds]) {
    bmctx.beginPath();
    p.pts.forEach(([x, z], idx) => {
      const [px, py] = mapToPx(x, z);
      if (idx === 0) bmctx.moveTo(px, py);
      else bmctx.lineTo(px, py);
    });
    bmctx.closePath();
    bmctx.fill();
  }

  // Roads
  for (const r of DATA.roads) {
    if (r.type === 'footway' || r.type === 'path') continue;
    bmctx.strokeStyle = r.type === 'primary' ? '#d9a441' : r.type === 'tertiary' ? '#9cb2c9' : '#657587';
    bmctx.lineWidth = r.type === 'primary' ? 2.2 : r.type === 'tertiary' ? 1.5 : 1.0;
    bmctx.beginPath();
    r.pts.forEach(([x, z], idx) => {
      const [px, py] = mapToPx(x, z);
      if (idx === 0) bmctx.moveTo(px, py);
      else bmctx.lineTo(px, py);
    });
    bmctx.stroke();
  }

  // Buildings
  bmctx.fillStyle = '#b6c1cc';
  for (const b of DATA.buildings) {
    const [px, py] = mapToPx(b.cx, b.cz);
    bmctx.fillRect(px - 0.8, py - 0.8, 1.6, 1.6);
  }

  // 1km radius ring
  bmctx.strokeStyle = 'rgba(83, 168, 255, 0.55)';
  bmctx.lineWidth = 1;
  bmctx.beginPath();
  bmctx.arc(105, 105, (1000 / 1080) * 100, 0, Math.PI * 2);
  bmctx.stroke();

  // School & 2646 markers
  const [sx, sy] = mapToPx(270, 248);
  bmctx.fillStyle = '#ffd454';
  bmctx.fillRect(sx - 3, sy - 3, 6, 6);
  const [hx, hy] = mapToPx(0, 0);
  bmctx.fillStyle = '#ff3838';
  bmctx.beginPath();
  bmctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
  bmctx.fill();
})();

minimap.addEventListener('click', (e) => {
  const rect = minimap.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const wx = ((px - 105) / 100) * 1080;
  const wz = ((py - 105) / 100) * 1080;
  const wy = elevAt(wx, wz);
  if (camMode === 'walk') {
    jumpTo([wx, wy + 1.72, wz], [wx + 12, wy + 1.72, wz]);
  } else {
    jumpTo([wx + 24, wy + 28, wz + 24], [wx, wy + 2, wz]);
  }
});

function updateMinimap() {
  mctx.drawImage(baseMapCanvas, 0, 0);
  if (chkTraffic.checked) {
    for (const [vx, vz, isBus] of simulation.getVehicleCoords()) {
      const [px, py] = mapToPx(vx, vz);
      mctx.fillStyle = isBus ? '#ffd93d' : '#74e3ff';
      mctx.fillRect(px - 1, py - 1, isBus ? 3 : 2, isBus ? 3 : 2);
    }
  }
  const [cx, cy] = mapToPx(camera.position.x, camera.position.z);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const yaw = Math.atan2(dir.z, dir.x);
  mctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  mctx.beginPath();
  mctx.moveTo(cx, cy);
  mctx.arc(cx, cy, 14, yaw - 0.45, yaw + 0.45);
  mctx.closePath();
  mctx.fill();
  mctx.fillStyle = '#ffffff';
  mctx.beginPath();
  mctx.arc(cx, cy, 2.8, 0, Math.PI * 2);
  mctx.fill();
}

// --- 9. Animation Loop & Resize ---
const telemetryBar = document.getElementById('telemetry-bar');
let prevTime = performance.now();
let fpsFrames = 0;
let fpsAcc = 0;
let currentFps = 60;
const _tmpFwd = new THREE.Vector3();
const _tmpRight = new THREE.Vector3();
const _tmpLookDir = new THREE.Vector3();
const _tmpLookTarget = new THREE.Vector3();
const _tmpPlayerPos = { x: 0, z: 0 };
const PIN_BASE_Y = elevAt(0, 0) + 11.4;
let animFrameIdx = 0;
let cloudDtAcc = 0;
let lastTelemetryText = '';

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - prevTime) / 1000);
  prevTime = now;

  fpsFrames++;
  fpsAcc += dt;
  if (fpsAcc >= 0.5) {
    currentFps = Math.round(fpsFrames / fpsAcc);
    fpsFrames = 0;
    fpsAcc = 0;
  }

  // Smooth bookmark glide
  if (glideAnim) {
    glideAnim.t = Math.min(1, glideAnim.t + dt * 1.45);
    const ease = 1 - Math.pow(1 - glideAnim.t, 3);
    camera.position.lerpVectors(glideAnim.startPos, glideAnim.endPos, ease);
    orbit.target.lerpVectors(glideAnim.startTgt, glideAnim.endTgt, ease);
    if (glideAnim.t >= 1) glideAnim = null;
  }

  // Camera movement per mode (reusing scratch vectors to avoid per-frame GC allocations)
  const boost = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight') ? 2.6 : 1.0;
  if (camMode === 'orbit') {
    const panSpd = Math.max(18, camera.position.distanceTo(orbit.target) * 0.6) * dt * boost;
    camera.getWorldDirection(_tmpFwd);
    _tmpFwd.y = 0;
    if (_tmpFwd.lengthSq() > 1e-4) _tmpFwd.normalize();
    _tmpRight.set(-_tmpFwd.z, 0, _tmpFwd.x);
    if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) {
      camera.position.addScaledVector(_tmpFwd, panSpd);
      orbit.target.addScaledVector(_tmpFwd, panSpd);
    }
    if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) {
      camera.position.addScaledVector(_tmpFwd, -panSpd);
      orbit.target.addScaledVector(_tmpFwd, -panSpd);
    }
    if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) {
      camera.position.addScaledVector(_tmpRight, -panSpd);
      orbit.target.addScaledVector(_tmpRight, -panSpd);
    }
    if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) {
      camera.position.addScaledVector(_tmpRight, panSpd);
      orbit.target.addScaledVector(_tmpRight, panSpd);
    }
    orbit.update();
  } else if (camMode === 'char') {
    const turnSpd = 2.5;
    let isTurning = false;
    if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) {
      charState.facing += turnSpd * dt;
      isTurning = true;
    }
    if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) {
      charState.facing -= turnSpd * dt;
      isTurning = true;
    }

    const dirX = Math.cos(-charState.facing);
    const dirZ = Math.sin(-charState.facing);
    const rightX = -dirZ;
    const rightZ = dirX;
    let moveFwd = 0;
    let moveStrafe = 0;
    if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) moveFwd += 1;
    if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) moveFwd -= 1;
    if (keysDown.has('KeyE')) moveStrafe += 1;
    if (keysDown.has('KeyQ')) moveStrafe -= 1;

    const isMoving = moveFwd !== 0 || moveStrafe !== 0 || isTurning;
    const spd = (keysDown.has('ShiftLeft') || keysDown.has('ShiftRight') ? 9.8 : 5.4);
    const moveLen = Math.hypot(moveFwd, moveStrafe);
    if (moveLen > 0) {
      const nf = moveFwd / moveLen;
      const ns = moveStrafe / moveLen;
      charState.x += (dirX * nf + rightX * ns) * spd * dt;
      charState.z += (dirZ * nf + rightZ * ns) * spd * dt;
    }
    const charCol = resolvePlayerCollisions(charState.x, charState.z, 0.42);
    charState.x = charCol.x;
    charState.z = charCol.z;
    if (isMoving) {
      charState.phase += dt * spd * 2.6;
      // Always shift camera smoothly behind the character whenever moving
      const targetCamYaw = Math.atan2(dirX, dirZ);
      const deltaYaw = Math.atan2(Math.sin(targetCamYaw - walkYaw), Math.cos(targetCamYaw - walkYaw));
      walkYaw += deltaYaw * Math.min(1, dt * 12.0);
      walkPitch += (0.32 - walkPitch) * Math.min(1, dt * 7.5);
    } else {
      charState.phase = 0;
    }

    const groundY = elevAt(charState.x, charState.z);
    if (keysDown.has('Space') && charState.y <= groundY + 0.05) {
      charState.velY = 6.2;
    }
    charState.velY -= 16.5 * dt;
    charState.y += charState.velY * dt;
    if (charState.y <= groundY) {
      charState.y = groundY;
      charState.velY = 0;
    }

    playerChar.root.position.set(charState.x, charState.y, charState.z);
    playerChar.root.rotation.y = charState.facing;
    const swing = isMoving ? Math.sin(charState.phase) * 0.58 : 0;
    playerChar.legL.rotation.z = swing;
    playerChar.legR.rotation.z = -swing;
    playerChar.armL.rotation.z = -swing * 0.8;
    playerChar.armR.rotation.z = swing * 0.8;

    const camDist = 6.2;
    const pitchClamped = Math.max(-0.95, Math.min(1.25, walkPitch));
    const horizDist = Math.cos(pitchClamped) * camDist;
    const camX = charState.x - Math.sin(walkYaw) * horizDist;
    const camZ = charState.z - Math.cos(walkYaw) * horizDist;
    const camGroundY = elevAt(camX, camZ);
    const rawCamY = charState.y + 1.45 + Math.sin(pitchClamped) * camDist;
    const camY = Math.max(camGroundY + 0.55, rawCamY);
    camera.position.set(camX, camY, camZ);

    // When looking up (pitch < 0), tilt look target up into the sky & clouds
    const skyLift = pitchClamped < 0 ? -Math.sin(pitchClamped) * 14.0 : 0;
    const lookAhead = pitchClamped < 0 ? 6.0 : 0;
    camera.lookAt(
      charState.x + Math.sin(walkYaw) * lookAhead,
      charState.y + 1.25 + skyLift,
      charState.z + Math.cos(walkYaw) * lookAhead
    );
  } else {
    _tmpLookDir.set(
      Math.sin(walkYaw) * Math.cos(walkPitch),
      Math.sin(walkPitch),
      Math.cos(walkYaw) * Math.cos(walkPitch)
    );
    _tmpFwd.set(Math.sin(walkYaw), 0, Math.cos(walkYaw)).normalize();
    _tmpRight.set(-_tmpFwd.z, 0, _tmpFwd.x);
    const moveSpd = (camMode === 'walk' ? 6.5 : 32.0) * dt * boost;

    if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) {
      camera.position.addScaledVector(camMode === 'fly' ? _tmpLookDir : _tmpFwd, moveSpd);
    }
    if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) {
      camera.position.addScaledVector(camMode === 'fly' ? _tmpLookDir : _tmpFwd, -moveSpd);
    }
    if (keysDown.has('KeyA') || keysDown.has('ArrowLeft') || (camMode === 'walk' && keysDown.has('KeyQ'))) {
      camera.position.addScaledVector(_tmpRight, -moveSpd);
    }
    if (keysDown.has('KeyD') || keysDown.has('ArrowRight') || (camMode === 'walk' && keysDown.has('KeyE'))) {
      camera.position.addScaledVector(_tmpRight, moveSpd);
    }
    if (camMode === 'fly') {
      const groundY = elevAt(camera.position.x, camera.position.z);
      if (keysDown.has('KeyE') || keysDown.has('Space')) camera.position.y += moveSpd * 0.8;
      if (keysDown.has('KeyQ') || keysDown.has('KeyC')) camera.position.y = Math.max(groundY + 1.5, camera.position.y - moveSpd * 0.8);
    } else {
      const walkCol = resolvePlayerCollisions(camera.position.x, camera.position.z, 0.42);
      camera.position.x = walkCol.x;
      camera.position.z = walkCol.z;
      camera.position.y = elevAt(camera.position.x, camera.position.z) + 1.72;
    }
    _tmpLookTarget.copy(camera.position).add(_tmpLookDir);
    camera.lookAt(_tmpLookTarget);
  }

  // Keep shadow frustum centered near camera view target for crisp local shadows
  const focus = camMode === 'orbit' ? orbit.target : camera.position;
  sunLight.target.position.set(focus.x, elevAt(focus.x, focus.z), focus.z);
  sunLight.position.copy(sunLight.target.position).add(sunLight.userData.offset);

  skyDome.position.set(camera.position.x, 0, camera.position.z);
  stars.position.set(camera.position.x, 0, camera.position.z);
  sunDisc.position.copy(camera.position).addScaledVector(sunLight.userData.offset, 6.2);
  sunDisc.lookAt(camera.position);

  // Update slow-drifting clouds at ~20 Hz (every 3rd frame) to reduce instanced matrix uploads
  animFrameIdx++;
  cloudDtAcc += dt;
  if (animFrameIdx === 1 || animFrameIdx % 3 === 0) {
    const cDt = cloudDtAcc;
    cloudDtAcc = 0;
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const c = clouds[i];
      c.cx += c.spd * cDt;
      if (c.cx > 1250) c.cx = -1250;
      cloudDummy.position.set(c.cx, c.cy, c.cz);
      cloudDummy.rotation.set(0, 0, 0);
      cloudDummy.scale.set(c.w, c.h, c.d);
      cloudDummy.updateMatrix();
      cloudMesh.setMatrixAt(i * 3, cloudDummy.matrix);

      cloudDummy.position.set(c.cx - c.w * 0.22, c.cy + c.h * 0.55, c.cz + c.d * 0.12);
      cloudDummy.scale.set(c.w * 0.58, c.h * 0.72, c.d * 0.62);
      cloudDummy.updateMatrix();
      cloudMesh.setMatrixAt(i * 3 + 1, cloudDummy.matrix);

      cloudDummy.position.set(c.cx + c.w * 0.24, c.cy + c.h * 0.42, c.cz - c.d * 0.1);
      cloudDummy.scale.set(c.w * 0.48, c.h * 0.65, c.d * 0.55);
      cloudDummy.updateMatrix();
      cloudMesh.setMatrixAt(i * 3 + 2, cloudDummy.matrix);
    }
    cloudMesh.instanceMatrix.needsUpdate = true;
  }

  // Subtle target pin bobbing
  if (hero2646.pinGroup.visible) {
    hero2646.pinGroup.position.y = PIN_BASE_Y + Math.sin(now * 0.003) * 0.65;
    hero2646.pinGroup.rotation.y = now * 0.0014;
  }

  const elapsedSec = now * 0.001;
  updateSnowfall(dt, elapsedSec);
  updateChimneySmoke(dt, elapsedSec, isWinter);
  updateHeroSmoke(dt, elapsedSec, isWinter);
  let playerPos = null;
  if (camMode === 'char') {
    _tmpPlayerPos.x = charState.x;
    _tmpPlayerPos.z = charState.z;
    playerPos = _tmpPlayerPos;
  } else if (camMode === 'walk') {
    _tmpPlayerPos.x = camera.position.x;
    _tmpPlayerPos.z = camera.position.z;
    playerPos = _tmpPlayerPos;
  }
  simulation.update(dt, isWinter ? Math.min(1, nightFactor + 0.25) : nightFactor, chkTraffic.checked, playerPos);
  updateWorldLabels();
  if (animFrameIdx === 1 || animFrameIdx % 3 === 0) {
    updateMinimap();
  }

  const px = Math.round(camera.position.x);
  const pz = -Math.round(camera.position.z); // North = -Z
  const nextTelemetry = `${px >= 0 ? `${px}m E` : `${-px}m W`}, ${pz >= 0 ? `${pz}m N` : `${-pz}m S`} • ${currentFps} FPS`;
  if (nextTelemetry !== lastTelemetryText) {
    lastTelemetryText = nextTelemetry;
    telemetryBar.textContent = nextTelemetry;
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);
