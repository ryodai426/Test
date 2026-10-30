// CRIMSON HOLLOW — 赤霧の村
// Over-the-shoulder survival-horror shooter. three.js, no build step.
import * as THREE from 'three';

const V3 = THREE.Vector3;
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const pick = a => a[Math.floor(Math.random() * a.length)];
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
const dampAng = (a, b, k, dt) => a + angDiff(a, b) * (1 - Math.exp(-k * dt));
const isTouch = matchMedia('(pointer: coarse)').matches;
const lowQ = /[?&]low/.test(location.search);
if (isTouch) document.body.classList.add('touch');

const BOUND = 44;

// =====================================================================
// Renderer / scene
// =====================================================================
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance' });
renderer.setPixelRatio(lowQ ? 0.6 : Math.min(window.devicePixelRatio, isTouch ? 1.5 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !lowQ;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.05, 260);
scene.fog = new THREE.FogExp2(0x4a3020, 0.024);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  particlesN.mat.uniforms.scale.value = particlesA.mat.uniforms.scale.value = innerHeight / 2;
});

// sky dome
const skyUni = { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, bot: { value: new THREE.Color() } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(220, 24, 12), new THREE.ShaderMaterial({
  uniforms: skyUni, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform vec3 top, mid, bot; varying vec3 vP;
    void main(){ float h = vP.y; vec3 c = h > 0. ? mix(mid, top, smoothstep(0., .55, h)) : mix(mid, bot, smoothstep(0., .25, -h));
      gl_FragColor = vec4(c, 1.); }`
}));
scene.add(sky);

const hemi = new THREE.HemisphereLight(0xffb07a, 0x2a1e16, 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xff8c4a, 1.8);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const sunDir = new V3(-0.6, 0.45, -0.4).normalize();

const ATMOS = {
  dusk:  { sky: [0x4a3040, 0xd27a40, 0x1e140f], fog: 0x6a4228, dens: 0.020, hs: 0xffb880, hg: 0x2a1e16, hi: 0.85, sc: 0xff9050, si: 2.0, dir: [-0.45, 0.32, 0.65], exp: 1.15 },
  dusk2: { sky: [0x2a1a26, 0x9a3a20, 0x140c0a], fog: 0x4a2418, dens: 0.024, hs: 0xff9a6a, hg: 0x22160f, hi: 0.6, sc: 0xff6a30, si: 1.6, dir: [0.7, 0.25, -0.3], exp: 1.1 },
  night: { sky: [0x05070e, 0x1c2232, 0x040406], fog: 0x161a24, dens: 0.030, hs: 0x7088b0, hg: 0x0c0c10, hi: 0.55, sc: 0xa8b8ff, si: 0.9, dir: [0.3, 0.7, 0.4], exp: 1.25 },
  blood: { sky: [0x0a0204, 0x5a0e0c, 0x060202], fog: 0x2e0c0a, dens: 0.030, hs: 0xc06050, hg: 0x140808, hi: 0.6, sc: 0xff5a3a, si: 1.0, dir: [-0.2, 0.6, 0.5], exp: 1.2 },
};
const atm = { from: null, to: null, t: 1, cur: null };
function atmosVals(a) {
  return {
    sky: a.sky.map(c => new THREE.Color(c)), fog: new THREE.Color(a.fog), dens: a.dens, hs: new THREE.Color(a.hs), hg: new THREE.Color(a.hg),
    hi: a.hi, sc: new THREE.Color(a.sc), si: a.si, dir: new V3(...a.dir).normalize(), exp: a.exp,
  };
}
function setAtmos(name, instant) {
  const v = atmosVals(ATMOS[name]);
  if (instant || !atm.cur) { atm.cur = v; atm.from = v; atm.to = v; atm.t = 1; applyAtmos(v); return; }
  atm.from = atm.cur; atm.to = v; atm.t = 0;
}
function applyAtmos(v) {
  skyUni.top.value.copy(v.sky[0]); skyUni.mid.value.copy(v.sky[1]); skyUni.bot.value.copy(v.sky[2]);
  scene.fog.color.copy(v.fog); scene.fog.density = v.dens;
  hemi.color.copy(v.hs); hemi.groundColor.copy(v.hg); hemi.intensity = v.hi;
  sun.color.copy(v.sc); sun.intensity = v.si; sunDir.copy(v.dir);
  renderer.toneMappingExposure = v.exp;
}
function updateAtmos(dt) {
  if (atm.t >= 1) return;
  atm.t = Math.min(1, atm.t + dt / 5);
  const a = atm.from, b = atm.to, t = atm.t;
  atm.cur = {
    sky: a.sky.map((c, i) => c.clone().lerp(b.sky[i], t)), fog: a.fog.clone().lerp(b.fog, t), dens: lerp(a.dens, b.dens, t),
    hs: a.hs.clone().lerp(b.hs, t), hg: a.hg.clone().lerp(b.hg, t), hi: lerp(a.hi, b.hi, t), sc: a.sc.clone().lerp(b.sc, t),
    si: lerp(a.si, b.si, t), dir: a.dir.clone().lerp(b.dir, t).normalize(), exp: lerp(a.exp, b.exp, t),
  };
  applyAtmos(atm.cur);
}
setAtmos('dusk', true);

// =====================================================================
// Procedural textures & materials
// =====================================================================
function canvasTex(size, draw, rx = 1, ry = rx) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
function speckle(g, s, n, cols, r0, r1, a0 = 0.2, a1 = 0.6) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = rand(a0, a1); g.fillStyle = pick(cols);
    const r = rand(r0, r1); g.beginPath(); g.arc(rand(0, s), rand(0, s), r, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
}
const texDirt = canvasTex(512, (g, s) => {
  g.fillStyle = '#4a3a2a'; g.fillRect(0, 0, s, s);
  speckle(g, s, 90, ['#3a2c20', '#5a4632', '#2e241a'], 20, 60, 0.15, 0.35);
  speckle(g, s, 3000, ['#2a2018', '#6a543c', '#3e3022', '#5e4a36'], 0.6, 2.2, 0.3, 0.8);
  speckle(g, s, 160, ['#7a6a58', '#5a5048', '#8a7a66'], 1.5, 4, 0.5, 0.9);
}, 36);
const texPlaza = canvasTex(512, (g, s) => {
  g.fillStyle = '#5a4a38'; g.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 32) for (let x = (y / 32 % 2) * 20; x < s; x += 44) {
    g.fillStyle = pick(['#6a5a48', '#5e4e3c', '#726252', '#56483a']); g.globalAlpha = 0.9;
    g.beginPath(); g.ellipse(x + rand(-3, 3), y + 16 + rand(-3, 3), rand(16, 21), rand(11, 14), rand(-.2, .2), 0, 7); g.fill();
  }
  g.globalAlpha = 1; speckle(g, s, 1500, ['#2a2018', '#3a3024'], 0.5, 1.8, 0.3, 0.7);
}, 6);
const texPlank = canvasTex(256, (g, s) => {
  g.fillStyle = '#5a4230'; g.fillRect(0, 0, s, s);
  const n = 6, w = s / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = pick(['#5e4632', '#4e3826', '#664c36', '#54402e']); g.fillRect(i * w + 1, 0, w - 2, s);
    g.strokeStyle = 'rgba(30,20,12,.35)';
    for (let k = 0; k < 6; k++) { g.beginPath(); const x = i * w + rand(3, w - 3); g.moveTo(x, 0); g.bezierCurveTo(x + rand(-4, 4), s / 3, x + rand(-4, 4), s / 1.5, x, s); g.stroke(); }
    g.fillStyle = '#1e140c'; g.fillRect(i * w, 0, 2, s);
  }
  speckle(g, s, 500, ['#2a1c12', '#7a5e44'], 0.5, 1.5, 0.2, 0.5);
});
const texStone = canvasTex(256, (g, s) => {
  g.fillStyle = '#3e3a36'; g.fillRect(0, 0, s, s);
  const rh = 32;
  for (let y = 0; y < s; y += rh) {
    let x = (y / rh % 2) ? -24 : 0;
    while (x < s) {
      const w = rand(40, 64);
      g.fillStyle = pick(['#6a645c', '#5e5850', '#746c62', '#58524c', '#686058']);
      g.fillRect(x + 2, y + 2, w - 4, rh - 4); x += w;
    }
  }
  speckle(g, s, 1200, ['#2a2622', '#8a8276'], 0.5, 1.6, 0.2, 0.5);
  speckle(g, s, 30, ['#3a3a20', '#2a3018'], 6, 18, 0.1, 0.25);
});
const texPlaster = canvasTex(256, (g, s) => {
  g.fillStyle = '#8a7a62'; g.fillRect(0, 0, s, s);
  speckle(g, s, 40, ['#6a5a46', '#9a8a70', '#5a4a3a'], 10, 40, 0.1, 0.3);
  speckle(g, s, 1500, ['#5a4a3a', '#a09078'], 0.5, 1.5, 0.2, 0.5);
  g.fillStyle = 'rgba(40,30,20,.25)'; for (let i = 0; i < 6; i++) g.fillRect(rand(0, s), s * 0.75, rand(2, 6), s * 0.25);
  g.fillStyle = '#3a2a1c'; g.fillRect(0, 0, s, 10); g.fillRect(0, s - 10, s, 10); g.fillRect(0, 0, 10, s); g.fillRect(s / 2 - 5, 0, 10, s);
});
const texRoof = canvasTex(256, (g, s) => {
  g.fillStyle = '#2a1e18'; g.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 16) for (let x = (y / 16 % 2) * 12; x < s; x += 24) {
    g.fillStyle = pick(['#4a2e22', '#3e261c', '#563428', '#3a2a22', '#5a3a2a']); g.fillRect(x, y, 22, 14);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, y + 12, 22, 2);
  }
});
const texBark = canvasTex(128, (g, s) => {
  g.fillStyle = '#2e2218'; g.fillRect(0, 0, s, s);
  g.strokeStyle = '#1a120c'; for (let i = 0; i < 30; i++) { g.beginPath(); const x = rand(0, s); g.moveTo(x, 0); g.lineTo(x + rand(-6, 6), s); g.stroke(); }
});

const matCache = new Map();
function mat(color, o = {}) {
  const key = color + JSON.stringify(o);
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0, ...(o.emissive ? { emissive: o.emissive, emissiveIntensity: o.ei ?? 1 } : {}) });
  matCache.set(key, m); return m;
}
const M = {
  ground: new THREE.MeshStandardMaterial({ map: texDirt, roughness: 1 }),
  plaza: new THREE.MeshStandardMaterial({ map: texPlaza, roughness: 1 }),
  plank: new THREE.MeshStandardMaterial({ map: texPlank, roughness: 0.95 }),
  stone: new THREE.MeshStandardMaterial({ map: texStone, roughness: 0.95 }),
  plaster: new THREE.MeshStandardMaterial({ map: texPlaster, roughness: 0.95 }),
  roof: new THREE.MeshStandardMaterial({ map: texRoof, roughness: 0.9, side: THREE.DoubleSide }),
  bark: new THREE.MeshStandardMaterial({ map: texBark, roughness: 1 }),
  pine: new THREE.MeshStandardMaterial({ color: 0x1c2618, roughness: 1, flatShading: true }),
  door: new THREE.MeshStandardMaterial({ color: 0x24170e, roughness: 0.9 }),
  winLit: new THREE.MeshStandardMaterial({ color: 0x2a1408, emissive: 0xff9a40, emissiveIntensity: 1.4 }),
  winDark: new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.6 }),
  winRed: new THREE.MeshStandardMaterial({ color: 0x200404, emissive: 0xff2010, emissiveIntensity: 1.6 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.45, metalness: 0.7 }),
  rock: new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 1, flatShading: true }),
  hay: new THREE.MeshStandardMaterial({ color: 0x9a7a3a, roughness: 1 }),
  barrelRed: new THREE.MeshStandardMaterial({ color: 0x8a1a10, roughness: 0.6, metalness: 0.2 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 0.9 }),
  crate: new THREE.MeshStandardMaterial({ map: texPlank, color: 0xc0a080, roughness: 0.9 }),
};

function scaleBoxUV(geo, w, h, d, unit) {
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / unit, uv.getY(i) * dims[f][1] / unit);
  }
  return geo;
}

// =====================================================================
// World: solids, props, nav grid
// =====================================================================
const solids = [];      // {minX,maxX,minZ,maxZ,maxY,alive,kind,mesh}
const barrels = [];     // explosive
const crates = [];      // breakable
const world = new THREE.Group(); scene.add(world);

function addSolid(x, z, w, d, h, extra = {}) {
  const s = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, maxY: h, alive: true, ...extra };
  solids.push(s); return s;
}
function meshAt(geo, m, x, y, z, parent = world, shadow = true) {
  const me = new THREE.Mesh(geo, m); me.position.set(x, y, z);
  if (shadow) { me.castShadow = true; me.receiveShadow = true; }
  parent.add(me); return me;
}

// ground
{
  const g = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), M.ground);
  g.rotation.x = -Math.PI / 2; g.receiveShadow = true; world.add(g);
  const p = new THREE.Mesh(new THREE.CircleGeometry(15, 48), M.plaza);
  p.rotation.x = -Math.PI / 2; p.position.y = 0.01; p.receiveShadow = true; world.add(p);
  // dirt road to church
  const r = new THREE.Mesh(new THREE.PlaneGeometry(5, 16), M.plaza);
  r.rotation.x = -Math.PI / 2; r.position.set(0, 0.012, -20); r.receiveShadow = true; world.add(r);
}

function makeHouse(x, z, w, d, h, wallMat, ridgeX = false) {
  const g = new THREE.Group(); g.position.set(x, 0, z); world.add(g);
  const geo = scaleBoxUV(new THREE.BoxGeometry(w, h, d), w, h, d, wallMat === M.plaster ? 4 : 2.5);
  meshAt(geo, wallMat, 0, h / 2, 0, g);
  // roof (triangular prism)
  const rw = (ridgeX ? d : w) + 0.8, rl = (ridgeX ? w : d) + 0.8, rh = rw * 0.42;
  const shape = new THREE.Shape(); shape.moveTo(-rw / 2, 0); shape.lineTo(rw / 2, 0); shape.lineTo(0, rh); shape.lineTo(-rw / 2, 0);
  const rg = new THREE.ExtrudeGeometry(shape, { depth: rl, bevelEnabled: false }); rg.translate(0, 0, -rl / 2);
  const uvs = rg.attributes.uv; for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * 0.3, uvs.getY(i) * 0.3);
  const roof = meshAt(rg, M.roof, 0, h, 0, g); if (ridgeX) roof.rotation.y = Math.PI / 2;
  // chimney
  if (Math.random() < 0.7) meshAt(new THREE.BoxGeometry(0.7, 2.2, 0.7), M.stone, rand(-w / 4, w / 4), h + rh * 0.6, rand(-d / 4, d / 4), g);
  // door facing the plaza
  const toward = Math.abs(x) > Math.abs(z) ? (x > 0 ? 'nx' : 'px') : (z > 0 ? 'nz' : 'pz');
  const faces = {
    px: [w / 2 + 0.02, 0, Math.PI / 2], nx: [-w / 2 - 0.02, 0, -Math.PI / 2],
    pz: [0, d / 2 + 0.02, 0], nz: [0, -d / 2 - 0.02, Math.PI],
  };
  const [fx, fz, fr] = faces[toward];
  const door = meshAt(new THREE.PlaneGeometry(1.3, 2.3), M.door, fx, 1.15, fz, g, false); door.rotation.y = fr;
  // windows on every face
  for (const k of Object.keys(faces)) {
    const [wx, wz, wr] = faces[k]; const along = (k === 'px' || k === 'nx') ? d : w;
    for (const off of [-along / 3, along / 3]) {
      if (k === toward && Math.abs(off) < 1) continue;
      const m = Math.random() < 0.45 ? M.winLit : (Math.random() < 0.2 ? M.winRed : M.winDark);
      const win = meshAt(new THREE.PlaneGeometry(0.9, 1.0), m, wx, h * 0.58, wz, g, false); win.rotation.y = wr;
      if (k === 'px' || k === 'nx') win.position.z += off; else win.position.x += off;
      win.position.addScaledVector(new V3(Math.sin(wr), 0, Math.cos(wr)), 0.01);
    }
  }
  addSolid(x, z, w, d, h + rh);
  return g;
}

function makePine(x, z, s = 1) {
  const g = new THREE.Group(); g.position.set(x, 0, z); world.add(g);
  meshAt(new THREE.CylinderGeometry(0.12 * s, 0.22 * s, 2.2 * s, 6), M.bark, 0, 1.1 * s, 0, g);
  for (let i = 0; i < 3; i++) {
    const c = meshAt(new THREE.ConeGeometry((1.9 - i * 0.45) * s, 2.6 * s, 7), M.pine, 0, (2.1 + i * 1.35) * s, 0, g);
    c.rotation.y = rand(0, 3);
  }
  return g;
}
function makeDeadTree(x, z, s = 1) {
  const g = new THREE.Group(); g.position.set(x, 0, z); world.add(g);
  meshAt(new THREE.CylinderGeometry(0.1 * s, 0.25 * s, 4.5 * s, 6), M.bark, 0, 2.25 * s, 0, g);
  for (let i = 0; i < 5; i++) {
    const b = meshAt(new THREE.CylinderGeometry(0.02 * s, 0.07 * s, 1.8 * s, 4), M.bark, 0, rand(2.2, 4) * s, 0, g);
    b.rotation.set(rand(0.5, 1.1), rand(0, 6.28), 0, 'YXZ'); b.translateY(0.8 * s);
  }
  addSolid(x, z, 0.5 * s, 0.5 * s, 4);
}

// ---- village layout ----
makeHouse(-18, -8, 10, 8, 4.5, M.plaster);
makeHouse(-20, 11, 8, 10, 4.2, M.plank, true);
makeHouse(18, -11, 9, 9, 5, M.stone);
makeHouse(21, 12, 10, 7, 4.2, M.plaster);
makeHouse(-6, 23, 8, 7, 4, M.stone);
makeHouse(9, 27, 9, 8, 4.5, M.plank);
makeHouse(-32, 27, 12, 10, 6, M.plank, true); // barn
makeHouse(32, -27, 8, 8, 4.2, M.plaster);
makeHouse(-32, -25, 9, 8, 4.5, M.stone);
makeHouse(34, 30, 7, 7, 4, M.plank);
makeHouse(-36, 0, 6, 9, 4, M.plaster, true);
makeHouse(36, -4, 6, 8, 4, M.stone, true);

// church
{
  const cx = 0, cz = -36, w = 12, d = 16, h = 8;
  const g = new THREE.Group(); g.position.set(cx, 0, cz); world.add(g);
  meshAt(scaleBoxUV(new THREE.BoxGeometry(w, h, d), w, h, d, 2.5), M.stone, 0, h / 2, 0, g);
  const rw = w + 0.8, rl = d + 0.6, rh = 5.5;
  const shape = new THREE.Shape(); shape.moveTo(-rw / 2, 0); shape.lineTo(rw / 2, 0); shape.lineTo(0, rh); shape.lineTo(-rw / 2, 0);
  const rg = new THREE.ExtrudeGeometry(shape, { depth: rl, bevelEnabled: false }); rg.translate(0, 0, -rl / 2);
  const uvs = rg.attributes.uv; for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * 0.3, uvs.getY(i) * 0.3);
  meshAt(rg, M.roof, 0, h, 0, g);
  // tower
  const tz = d / 2 + 1.5;
  meshAt(scaleBoxUV(new THREE.BoxGeometry(4.2, 15, 4.2), 4.2, 15, 4.2, 2.5), M.stone, 0, 7.5, tz, g);
  const spire = meshAt(new THREE.ConeGeometry(3.3, 6, 4), M.roof, 0, 18, tz, g); spire.rotation.y = Math.PI / 4;
  meshAt(new THREE.BoxGeometry(0.18, 1.6, 0.18), M.metal, 0, 21.6, tz, g);
  meshAt(new THREE.BoxGeometry(0.9, 0.16, 0.18), M.metal, 0, 21.9, tz, g);
  // bell opening
  const bo = meshAt(new THREE.PlaneGeometry(1.6, 2.2), M.winDark, 0, 12.5, tz + 2.12, g, false);
  const bell = meshAt(new THREE.CylinderGeometry(0.3, 0.6, 0.9, 10, 1, true), mat(0x6a5020, { metal: 0.8, rough: 0.4 }), 0, 12.4, tz + 1.6, g);
  bell.material.side = THREE.DoubleSide;
  const rose = meshAt(new THREE.CircleGeometry(0.9, 16), M.winRed, 0, 9.5, tz + 2.12, g, false);
  meshAt(new THREE.PlaneGeometry(2.0, 3.2), M.door, 0, 1.6, tz + 2.12, g, false);
  addSolid(cx, cz, w, d, h + rh);
  addSolid(cx, cz + tz, 4.2, 4.2, 21);
  void bo; void rose;
}

// well in the plaza
{
  const g = new THREE.Group(); world.add(g);
  const ring = meshAt(new THREE.CylinderGeometry(1.25, 1.35, 0.9, 16, 1, true), M.stone, 0, 0.45, 0, g);
  ring.material = M.stone.clone(); ring.material.side = THREE.DoubleSide;
  meshAt(new THREE.CircleGeometry(1.2, 16), mat(0x050403), 0, 0.3, 0, g, false).rotation.x = -Math.PI / 2;
  for (const sx of [-1.1, 1.1]) meshAt(new THREE.BoxGeometry(0.16, 2.4, 0.16), M.wood, sx, 1.2, 0, g);
  const r = meshAt(new THREE.ConeGeometry(1.8, 0.9, 4), M.roof, 0, 2.7, 0, g); r.rotation.y = Math.PI / 4;
  meshAt(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6), M.wood, 0, 2.0, 0, g).rotation.z = Math.PI / 2;
  addSolid(0, 0, 2.7, 2.7, 1.0);
}

// rocks / cliffs bounding the valley
for (let i = 0; i < 70; i++) {
  const a = i / 70 * Math.PI * 2;
  const r = rand(50, 58), x = Math.cos(a) * r, z = Math.sin(a) * r;
  const s = rand(4, 9);
  const rk = meshAt(new THREE.DodecahedronGeometry(s, 0), M.rock, x, s * 0.4, z);
  rk.scale.set(1, rand(0.8, 1.8), 1); rk.rotation.set(rand(0, 3), rand(0, 3), 0);
}
// forest
{
  const N = 260, trunkGeo = new THREE.CylinderGeometry(0.12, 0.22, 2.2, 6), coneGeo = new THREE.ConeGeometry(1.9, 2.6, 7);
  trunkGeo.translate(0, 1.1, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, M.bark, N), cones = new THREE.InstancedMesh(coneGeo, M.pine, N * 3);
  const o = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    const a = rand(0, Math.PI * 2), r = rand(45, 75), x = Math.cos(a) * r, z = Math.sin(a) * r, s = rand(1.2, 2.2);
    o.position.set(x, 0, z); o.rotation.set(0, rand(0, 6), 0); o.scale.setScalar(s); o.updateMatrix(); trunks.setMatrixAt(i, o.matrix);
    for (let k = 0; k < 3; k++) {
      const w = (1.9 - k * 0.45) / 1.9;
      o.position.set(x, (2.1 + k * 1.35) * s, z); o.scale.set(s * w, s, s * w); o.updateMatrix(); cones.setMatrixAt(i * 3 + k, o.matrix);
    }
  }
  for (const im of [trunks, cones]) { im.castShadow = true; im.receiveShadow = true; world.add(im); }
}
for (const [x, z] of [[-10, -20], [12, -24], [-26, -12], [27, 2], [-14, 34], [24, 36], [-40, 14], [40, 16], [-24, -38], [20, -38]]) makeDeadTree(x, z, rand(0.9, 1.3));
for (const [x, z] of [[-42, -38], [40, -40], [-42, 40], [-26, 40], [28, 22], [-38, -12]]) { makePine(x, z, 1.4); addSolid(x, z, 0.7, 0.7, 6); }

// fences
function fence(x0, z0, x1, z1) {
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(len / 1.8), ang = Math.atan2(x1 - x0, z1 - z0);
  for (let i = 0; i <= n; i++) {
    const t = i / n; const p = meshAt(new THREE.BoxGeometry(0.12, 1.2, 0.12), M.wood, lerp(x0, x1, t), 0.6, lerp(z0, z1, t));
    p.rotation.set(rand(-.08, .08), 0, rand(-.08, .08));
  }
  for (const y of [0.45, 0.95]) {
    const r = meshAt(new THREE.BoxGeometry(0.06, 0.1, len), M.wood, (x0 + x1) / 2, y, (z0 + z1) / 2); r.rotation.y = ang;
  }
  const minX = Math.min(x0, x1) - 0.1, maxX = Math.max(x0, x1) + 0.1, minZ = Math.min(z0, z1) - 0.1, maxZ = Math.max(z0, z1) + 0.1;
  solids.push({ minX, maxX, minZ, maxZ, maxY: 1.1, alive: true });
}
fence(-28, 4, -28, 18); fence(-14, 30, -24, 30); fence(27.5, 20, 27.5, 6); fence(10, -20, 10, -30); fence(-10, -28, -24, -28);
fence(14, 36, 26, 36); fence(-40, -18, -40, -6);

function hay(x, z) { const h = meshAt(new THREE.CylinderGeometry(0.75, 0.75, 1.3, 14), M.hay, x, 0.75, z); h.rotation.z = Math.PI / 2; h.rotation.y = rand(0, 3); addSolid(x, z, 1.4, 1.4, 1.5); }
[[-23.5, 19.6], [-25.2, 20.2], [-20.5, 35.5], [14, 18], [-12, -16], [28, -16]].forEach(p => hay(...p));
function cart(x, z, r) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = r; world.add(g);
  meshAt(new THREE.BoxGeometry(1.6, 0.5, 2.6), M.plank, 0, 0.9, 0, g);
  for (const sx of [-0.9, 0.9]) { const wh = meshAt(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 12), M.wood, sx, 0.55, 0.3, g); wh.rotation.z = Math.PI / 2; }
  const sh = meshAt(new THREE.BoxGeometry(0.1, 0.1, 2.2), M.wood, 0.4, 0.8, -2, g); sh.rotation.x = 0.25;
  const sh2 = meshAt(new THREE.BoxGeometry(0.1, 0.1, 2.2), M.wood, -0.4, 0.8, -2, g); sh2.rotation.x = 0.25;
  const big = Math.abs(Math.sin(r)) > 0.7;
  addSolid(x, z, big ? 2.6 : 1.8, big ? 1.8 : 2.6, 1.3);
}
cart(8, -6, 0.2); cart(-9, 9, 1.4); cart(26, 26, 0.6);
function woodBarrel(x, z) { meshAt(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12), M.wood, x, 0.5, z); addSolid(x, z, 0.8, 0.8, 1.0); }
[[-13, -3], [-12.4, -4], [13, 7], [-15, 16], [24, -4], [5, 18]].forEach(p => woodBarrel(...p));

// explosive barrels
function redBarrel(x, z) {
  const m = meshAt(new THREE.CylinderGeometry(0.4, 0.4, 1.05, 14), M.barrelRed, x, 0.525, z);
  const band = meshAt(new THREE.CylinderGeometry(0.41, 0.41, 0.12, 14), mat(0xd8c060), x, 0.7, z); band.castShadow = false;
  const s = addSolid(x, z, 0.8, 0.8, 1.05, { kind: 'barrel' });
  barrels.push({ pos: new V3(x, 0.55, z), mesh: m, band, solid: s, alive: true, fuse: -1 });
}
[[-7, -9], [9, 10], [-16, 4], [16, -3], [5, -21], [-4, 16], [-22, -18], [24, 20]].forEach(p => redBarrel(...p));

// breakable crates
function crate(x, z) {
  const m = meshAt(scaleBoxUV(new THREE.BoxGeometry(0.9, 0.9, 0.9), .9, .9, .9, 0.9), M.crate, x, 0.45, z);
  m.rotation.y = rand(-0.3, 0.3);
  const s = addSolid(x, z, 0.9, 0.9, 0.9, { kind: 'crate' });
  crates.push({ pos: new V3(x, 0.45, z), mesh: m, solid: s, alive: true });
}
[[-14, -13.3], [13.5, -16.4], [-23, 4.6], [15, 22], [-3, 30], [30, -20], [-30, -18], [6, -16], [-23.5, 33.5], [31, 8]].forEach(p => crate(...p));

// braziers (fire + light)
const fires = [];
function brazier(x, z, light = true) {
  meshAt(new THREE.CylinderGeometry(0.35, 0.5, 1.0, 8), M.stone, x, 0.5, z);
  meshAt(new THREE.CylinderGeometry(0.55, 0.35, 0.3, 10), M.metal, x, 1.1, z);
  addSolid(x, z, 1.0, 1.0, 1.2);
  let l = null;
  if (light) { l = new THREE.PointLight(0xff8a3a, 6, 16, 1.6); l.position.set(x, 1.8, z); world.add(l); }
  fires.push({ pos: new V3(x, 1.25, z), light: l, t: rand(0, 9) });
}
brazier(-5, -8); brazier(6, 6); brazier(-3, -25.5, false); brazier(3, -25.5, false);
{ const l = new THREE.PointLight(0xff8a3a, 7, 18, 1.6); l.position.set(0, 2.2, -23.6); world.add(l); fires[2].light = l; }

// grass tufts (instanced)
{
  const geo = new THREE.ConeGeometry(0.08, 0.5, 3); geo.translate(0, 0.25, 0);
  const n = 2600, im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x4a4a26, roughness: 1 }), n);
  const o = new THREE.Object3D(); const col = new THREE.Color(); let k = 0;
  while (k < n) {
    const x = rand(-48, 48), z = rand(-48, 48);
    if (Math.hypot(x, z) < 15.5) continue;
    o.position.set(x, 0, z); o.rotation.set(rand(-.3, .3), rand(0, 6), rand(-.3, .3)); o.scale.setScalar(rand(0.6, 1.6)); o.updateMatrix();
    im.setMatrixAt(k, o.matrix); im.setColorAt(k, col.setHSL(rand(0.1, 0.17), 0.35, rand(0.12, 0.25))); k++;
  }
  im.receiveShadow = true; world.add(im);
}

// ---- nav grid (flow field toward the player) ----
const NAV = { n: 92, org: -46, blocked: new Uint8Array(92 * 92), dist: new Int32Array(92 * 92), t: 0 };
function navBuild() {
  const { n, org } = NAV; NAV.blocked.fill(0);
  for (const s of solids) {
    if (!s.alive || s.maxY < 0.5) continue;
    const x0 = Math.floor(s.minX - 0.45 - org), x1 = Math.floor(s.maxX + 0.45 - org);
    const z0 = Math.floor(s.minZ - 0.45 - org), z1 = Math.floor(s.maxZ + 0.45 - org);
    for (let z = Math.max(0, z0); z <= Math.min(n - 1, z1); z++) for (let x = Math.max(0, x0); x <= Math.min(n - 1, x1); x++) NAV.blocked[z * n + x] = 1;
  }
}
const navQ = new Int32Array(92 * 92);
function navUpdate(tx, tz) {
  const { n, org, blocked, dist } = NAV; dist.fill(-1);
  let cx = clamp(Math.floor(tx - org), 0, n - 1), cz = clamp(Math.floor(tz - org), 0, n - 1);
  let head = 0, tail = 0; const s = cz * n + cx; dist[s] = 0; navQ[tail++] = s;
  while (head < tail) {
    const c = navQ[head++], x = c % n, z = (c / n) | 0, d = dist[c] + 1;
    if (x > 0) { const k = c - 1; if (dist[k] < 0 && !blocked[k]) { dist[k] = d; navQ[tail++] = k; } }
    if (x < n - 1) { const k = c + 1; if (dist[k] < 0 && !blocked[k]) { dist[k] = d; navQ[tail++] = k; } }
    if (z > 0) { const k = c - n; if (dist[k] < 0 && !blocked[k]) { dist[k] = d; navQ[tail++] = k; } }
    if (z < n - 1) { const k = c + n; if (dist[k] < 0 && !blocked[k]) { dist[k] = d; navQ[tail++] = k; } }
  }
}
function navDir(pos, out) {
  const { n, org, blocked, dist } = NAV;
  const x = clamp(Math.floor(pos.x - org), 0, n - 1), z = clamp(Math.floor(pos.z - org), 0, n - 1);
  let best = dist[z * n + x]; if (best < 0) best = 1e9;
  let bx = 0, bz = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dz) continue;
    const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= n || zz >= n) continue;
    const k = zz * n + xx; if (blocked[k] || dist[k] < 0) continue;
    if (dx && dz && (blocked[z * n + xx] || blocked[zz * n + x])) continue;
    const dd = dist[k] + (dx && dz ? 0.4 : 0);
    if (dd < best) { best = dd; bx = dx; bz = dz; }
  }
  if (!bx && !bz) return null;
  const tx = org + x + bx + 0.5 - pos.x, tz = org + z + bz + 0.5 - pos.z, l = Math.hypot(tx, tz) || 1;
  return out.set(tx / l, 0, tz / l);
}

// collision helpers
function collide(pos, r) {
  for (const s of solids) {
    if (!s.alive) continue;
    const cx = clamp(pos.x, s.minX, s.maxX), cz = clamp(pos.z, s.minZ, s.maxZ);
    const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) { const d = Math.sqrt(d2); pos.x += dx / d * (r - d); pos.z += dz / d * (r - d); }
    else {
      const l = pos.x - s.minX, rr = s.maxX - pos.x, t = pos.z - s.minZ, b = s.maxZ - pos.z, m = Math.min(l, rr, t, b);
      if (m === l) pos.x = s.minX - r; else if (m === rr) pos.x = s.maxX + r; else if (m === t) pos.z = s.minZ - r; else pos.z = s.maxZ + r;
    }
  }
  pos.x = clamp(pos.x, -BOUND, BOUND); pos.z = clamp(pos.z, -BOUND, BOUND);
}
function rayAABB(o, d, s) {
  let tmin = 0, tmax = Infinity;
  const ax = [[o.x, d.x, s.minX, s.maxX], [o.y, d.y, 0, s.maxY], [o.z, d.z, s.minZ, s.maxZ]];
  for (const [oa, da, mn, mx] of ax) {
    if (Math.abs(da) < 1e-9) { if (oa < mn || oa > mx) return Infinity; continue; }
    let t1 = (mn - oa) / da, t2 = (mx - oa) / da; if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return Infinity;
  }
  return tmin;
}
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r, h = b * b - cc;
  if (h < 0) return Infinity; const sq = Math.sqrt(h); let t = -b - sq; if (t < 0) t = -b + sq; return t >= 0 ? t : Infinity;
}
const _w = new V3(), _v = new V3(), _p = new V3(), _q = new V3();
function rayCapsule(o, d, a, b, r) {
  _v.subVectors(b, a); _w.subVectors(o, a);
  const B = d.dot(_v), C = _v.dot(_v), D = d.dot(_w), E = _v.dot(_w), den = C - B * B;
  let tc = den > 1e-8 ? (E - B * D) / den : E / C; tc = clamp(tc, 0, 1);
  let sc = Math.max(0, B * tc - D);
  _p.copy(o).addScaledVector(d, sc); _q.copy(a).addScaledVector(_v, tc);
  const dist = _p.distanceTo(_q); if (dist > r) return Infinity;
  return Math.max(0, sc - Math.sqrt(r * r - dist * dist));
}
function segClear(a, b) {
  _v.subVectors(b, a); const L = _v.length(); _v.divideScalar(L);
  for (const s of solids) { if (!s.alive || s.maxY < a.y) continue; if (rayAABB(a, _v, s) < L) return false; }
  return true;
}

// =====================================================================
// Particles (one additive + one normal system)
// =====================================================================
class Particles {
  constructor(max, blending) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.d = []; // per-particle sim data
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('palpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: innerHeight / 2 } }, transparent: true, depthWrite: false, blending,
      vertexShader: `attribute vec3 pcolor; attribute float psize; attribute float palpha; uniform float scale; varying vec3 vC; varying float vA;
        void main(){ vC = pcolor; vA = palpha; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = psize * scale / max(.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 c = gl_PointCoord - .5; float d = length(c); if (d > .5) discard; gl_FragColor = vec4(vC, vA * smoothstep(.5, .1, d)); }`,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; scene.add(this.points);
  }
  add(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a0 = 1, grav = 0, drag = 0, floor = true) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.d[i] = { x, y, z, vx, vy, vz, life, max: life, s0, s1, r, g, b, a0, grav, drag, floor };
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      const p = this.d[i]; p.life -= dt;
      if (p.life <= 0) { this.n--; this.d[i] = this.d[this.n]; continue; }
      p.vy -= p.grav * dt; const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.floor && p.y < 0.03) { p.y = 0.03; p.vy *= -0.2; p.vx *= 0.5; p.vz *= 0.5; }
      const t = 1 - p.life / p.max;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.col[i * 3] = p.r; this.col[i * 3 + 1] = p.g; this.col[i * 3 + 2] = p.b;
      this.size[i] = lerp(p.s0, p.s1, t); this.alpha[i] = p.a0 * (1 - t * t);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const k of ['position', 'pcolor', 'psize', 'palpha']) this.geo.attributes[k].needsUpdate = true;
  }
  clear() { this.n = 0; }
}
const particlesA = new Particles(1800, THREE.AdditiveBlending);
const particlesN = new Particles(2200, THREE.NormalBlending);

function fxBlood(p, dir, n = 14, big = 1) {
  for (let i = 0; i < n; i++) {
    particlesN.add(p.x, p.y, p.z, dir.x * rand(0.5, 3) + rand(-1.4, 1.4), rand(-0.4, 2.6), dir.z * rand(0.5, 3) + rand(-1.4, 1.4),
      rand(0.4, 0.9), rand(0.05, 0.11) * big, rand(0.03, 0.06), rand(0.35, 0.55), 0.02, 0.02, 1, 9, 0.5);
  }
  for (let i = 0; i < 3; i++) particlesN.add(p.x, p.y, p.z, rand(-.3, .3), rand(0, .5), rand(-.3, .3), 0.5, 0.15 * big, 0.45 * big, 0.3, 0.02, 0.02, 0.6, 0, 2);
}
function fxSparks(p, n = 8) {
  for (let i = 0; i < n; i++) particlesA.add(p.x, p.y, p.z, rand(-3, 3), rand(0, 4), rand(-3, 3), rand(0.15, 0.4), 0.05, 0.02, 1, 0.75, 0.35, 1, 12, 1);
  for (let i = 0; i < 4; i++) particlesN.add(p.x, p.y, p.z, rand(-.5, .5), rand(.2, 1), rand(-.5, .5), rand(0.5, 1), 0.1, 0.4, 0.45, 0.4, 0.36, 0.5, 0, 1.5);
}
function fxDust(p, n = 6) {
  for (let i = 0; i < n; i++) particlesN.add(p.x, p.y + 0.05, p.z, rand(-1, 1), rand(0.3, 1.5), rand(-1, 1), rand(0.5, 1), 0.12, 0.45, 0.4, 0.33, 0.25, 0.6, 1, 2);
}
function fxSplinters(p) {
  for (let i = 0; i < 24; i++) particlesN.add(p.x + rand(-.3, .3), p.y + rand(-.3, .3), p.z + rand(-.3, .3), rand(-3, 3), rand(1, 5), rand(-3, 3), rand(0.6, 1.2), 0.1, 0.06, 0.45, 0.32, 0.2, 1, 12, 0.5);
  fxDust(p, 10);
}
function fxExplosion(p, r) {
  for (let i = 0; i < 90; i++) {
    const a = rand(0, 6.28), e = rand(-0.2, 1.2), s = rand(2, 9) * r / 5;
    particlesA.add(p.x, p.y + 0.3, p.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 1, Math.sin(a) * Math.cos(e) * s, rand(0.3, 0.8), rand(0.4, 1.1), rand(0.9, 2.2), 1, rand(0.35, 0.65), 0.15, 1, -1, 3);
  }
  for (let i = 0; i < 40; i++) particlesA.add(p.x, p.y + 0.3, p.z, rand(-9, 9), rand(2, 12), rand(-9, 9), rand(0.5, 1.4), 0.08, 0.03, 1, 0.8, 0.4, 1, 14, 0.4);
  for (let i = 0; i < 40; i++) particlesN.add(p.x + rand(-1, 1), p.y + rand(0, 1.5), p.z + rand(-1, 1), rand(-2, 2), rand(1, 4), rand(-2, 2), rand(1.5, 3), 0.8, 3, 0.16, 0.13, 0.12, 0.75, -0.4, 1.2);
}
function fxMuzzle(p, dir, big) {
  for (let i = 0; i < (big ? 14 : 6); i++) {
    const s = rand(2, 7);
    particlesA.add(p.x, p.y, p.z, dir.x * s + rand(-1, 1), dir.y * s + rand(-1, 1), dir.z * s + rand(-1, 1), rand(0.04, 0.09), big ? 0.35 : 0.2, 0.05, 1, 0.75, 0.35, 1, 0, 0, false);
  }
  particlesN.add(p.x, p.y, p.z, dir.x * 0.6, 0.4, dir.z * 0.6, 0.7, 0.08, 0.35, 0.55, 0.52, 0.5, 0.35, -0.2, 1, false);
}

// blood decals
const decals = [];
const decalGeo = new THREE.CircleGeometry(0.5, 12);
const decalMat = new THREE.MeshBasicMaterial({ color: 0x3a0404, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
function addDecal(x, z, s) {
  let d;
  if (decals.length < 70) { d = new THREE.Mesh(decalGeo, decalMat); d.rotation.x = -Math.PI / 2; scene.add(d); decals.push(d); }
  else { d = decals.shift(); decals.push(d); }
  d.position.set(x, 0.025 + Math.random() * 0.005, z); d.scale.set(s * rand(0.8, 1.3), s * rand(0.6, 1.1), 1); d.rotation.z = rand(0, 6);
}

// flash light pool for explosions/muzzle
const flash = new THREE.PointLight(0xffa050, 0, 14, 1.8); scene.add(flash);
let flashI = 0;
function doFlash(p, i) { flash.position.copy(p); flashI = Math.max(flashI, i); }

// =====================================================================
// Audio (all synthesized)
// =====================================================================
const AC = { ctx: null };
function initAudio() {
  if (AC.ctx) { AC.ctx.resume(); return; }
  const ctx = new (window.AudioContext || window.webkitAudioContext)(); AC.ctx = ctx;
  const comp = ctx.createDynamicsCompressor(); comp.connect(ctx.destination);
  AC.master = ctx.createGain(); AC.master.gain.value = 0.75; AC.master.connect(comp);
  const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1; AC.noise = nb;
  const ir = ctx.createBuffer(2, ctx.sampleRate * 2.6, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3); }
  AC.verb = ctx.createConvolver(); AC.verb.buffer = ir; const vg = ctx.createGain(); vg.gain.value = 0.5; AC.verb.connect(vg); vg.connect(AC.master);
  AC.music = ctx.createGain(); AC.music.gain.value = 0.55; AC.music.connect(AC.master);
  // wind ambience
  const w = ctx.createBufferSource(); w.buffer = nb; w.loop = true;
  const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 400; wf.Q.value = 0.6;
  const wg = ctx.createGain(); wg.gain.value = 0.09;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11; const lg = ctx.createGain(); lg.gain.value = 220; lfo.connect(lg); lg.connect(wf.frequency); lfo.start();
  w.connect(wf); wf.connect(wg); wg.connect(AC.master); w.start();
  // combat drone
  AC.drone = ctx.createGain(); AC.drone.gain.value = 0; AC.drone.connect(AC.music);
  const df = ctx.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 260; df.connect(AC.drone);
  for (const f of [36.7, 37.1, 55.0, 73.6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0.12; o.connect(g); g.connect(df); o.start(); }
  setInterval(musicTick, 40);
}
function out(vol = 1, pan = 0, wet = 0.15) {
  const ctx = AC.ctx, g = ctx.createGain(); g.gain.value = vol;
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) { p.pan.value = clamp(pan, -1, 1); g.connect(p); p.connect(AC.master); } else g.connect(AC.master);
  if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; (p || g).connect(w); w.connect(AC.verb); }
  return g;
}
function spatial(pos) {
  if (!pos) return { vol: 1, pan: 0 };
  const dx = pos.x - player.pos.x, dz = pos.z - player.pos.z, d = Math.hypot(dx, dz) || 1;
  const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  return { vol: 1 / (1 + d * 0.13), pan: (dx * rx + dz * rz) / d * 0.75 };
}
function noise(t, dur, dest, f0, f1, type = 'lowpass', q = 0.8) {
  const ctx = AC.ctx, s = ctx.createBufferSource(); s.buffer = AC.noise;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  s.connect(f); f.connect(dest); s.start(t, rand(0, 0.4)); s.stop(t + dur + 0.05);
}
function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function tone(t, type, f0, f1, dur, dest, vol = 0.3, a = 0.005) {
  const ctx = AC.ctx, o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); env(g, t, a, vol, dur); o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + dur + 0.05);
}
const sfx = {
  ok() { return !!AC.ctx; },
  gun(kind) {
    if (!this.ok()) return; const t = AC.ctx.currentTime;
    const cfg = { hg: [0.85, 0.16, 5200, 0.12], sg: [1.1, 0.42, 3800, 0.22], rf: [1.0, 0.3, 7000, 0.18] }[kind];
    const o = out(cfg[0], 0, 0.45); const g = AC.ctx.createGain(); env(g, t, 0.002, 1, cfg[1]); g.connect(o);
    noise(t, cfg[1], g, cfg[2], 300);
    tone(t, 'sine', kind === 'sg' ? 120 : 160, 38, cfg[3] + 0.08, o, kind === 'sg' ? 0.9 : 0.6);
    if (kind === 'rf') { const g2 = AC.ctx.createGain(); env(g2, t, 0.001, 0.8, 0.04); g2.connect(o); noise(t, 0.04, g2, 9000, 4000, 'highpass'); }
  },
  click() { if (!this.ok()) return; const t = AC.ctx.currentTime; tone(t, 'square', 2200, 1800, 0.02, out(0.15, 0, 0), 0.4); },
  reload(dur) {
    if (!this.ok()) return; const t = AC.ctx.currentTime, o = out(0.35, 0.2, 0.05);
    tone(t + 0.05, 'square', 900, 700, 0.03, o, 0.25); tone(t + 0.25, 'square', 600, 500, 0.04, o, 0.2);
    tone(t + dur - 0.25, 'square', 1500, 1100, 0.03, o, 0.3); tone(t + dur - 0.12, 'square', 1100, 900, 0.04, o, 0.3);
  },
  step(run) { if (!this.ok()) return; const t = AC.ctx.currentTime, g = AC.ctx.createGain(); env(g, t, 0.003, run ? 0.32 : 0.2, 0.07); g.connect(out(1, rand(-.1, .1), 0)); noise(t, 0.08, g, 700, 200, 'lowpass'); },
  hit(pos) { if (!this.ok()) return; const s = spatial(pos), t = AC.ctx.currentTime, g = AC.ctx.createGain(); env(g, t, 0.003, 0.7, 0.12); g.connect(out(s.vol, s.pan, 0.1)); noise(t, 0.14, g, 1400, 300, 'bandpass', 2); tone(t, 'sine', 180, 60, 0.12, out(s.vol * 0.6, s.pan, 0), 0.5); },
  splat(pos) { if (!this.ok()) return; const s = spatial(pos), t = AC.ctx.currentTime, g = AC.ctx.createGain(); env(g, t, 0.003, 1, 0.3); g.connect(out(s.vol, s.pan, 0.2)); noise(t, 0.3, g, 2500, 200, 'lowpass', 3); },
  ping() { if (!this.ok()) return; const t = AC.ctx.currentTime; tone(t, 'triangle', 3200, 2800, 0.15, out(0.2, 0, 0.3), 0.3); },
  wood(pos) { if (!this.ok()) return; const s = spatial(pos), t = AC.ctx.currentTime, g = AC.ctx.createGain(); env(g, t, 0.002, 0.9, 0.25); g.connect(out(s.vol, s.pan, 0.2)); noise(t, 0.25, g, 900, 150, 'bandpass', 1.4); tone(t, 'square', 140, 60, 0.12, out(s.vol * 0.4, s.pan, 0), 0.3); },
  voice(pos, low = 1, scream = false) {
    if (!this.ok()) return; const s = spatial(pos); if (s.vol < 0.06) return;
    const ctx = AC.ctx, t0 = ctx.currentTime, o = out(s.vol * (scream ? 0.6 : 0.45), s.pan, 0.3);
    const vowels = [[730, 1090], [300, 2300], [520, 920], [400, 1900], [640, 1200]];
    const syl = scream ? 1 : randi(2, 4); let t = t0; const base = rand(95, 150) / low * (scream ? 1.6 : 1);
    for (let i = 0; i < syl; i++) {
      const dur = scream ? 0.6 : rand(0.1, 0.22), vw = pick(vowels);
      const src = ctx.createOscillator(); src.type = 'sawtooth';
      src.frequency.setValueAtTime(base * rand(0.9, 1.15), t); src.frequency.linearRampToValueAtTime(base * rand(0.7, 1.0), t + dur);
      const g = ctx.createGain(); env(g, t, 0.02, 0.5, dur);
      for (const f of vw) { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6; src.connect(bp); bp.connect(g); }
      g.connect(o); src.start(t); src.stop(t + dur + 0.1); t += dur + rand(0.02, 0.08);
    }
  },
  hurt() { if (!this.ok()) return; const t = AC.ctx.currentTime, o = out(0.5, 0, 0.1); tone(t, 'sawtooth', 160, 90, 0.22, o, 0.35, 0.01); const g = AC.ctx.createGain(); env(g, t, 0.003, 0.6, 0.12); g.connect(o); noise(t, 0.12, g, 500, 120); },
  kick() { if (!this.ok()) return; const t = AC.ctx.currentTime, o = out(0.7, 0, 0.2); const g = AC.ctx.createGain(); env(g, t, 0.02, 0.4, 0.18); g.connect(o); noise(t, 0.2, g, 600, 2400, 'bandpass', 1.5); tone(t + 0.22, 'sine', 140, 45, 0.18, o, 0.9); const g2 = AC.ctx.createGain(); env(g2, t + 0.22, 0.002, 0.8, 0.1); g2.connect(o); noise(t + 0.22, 0.1, g2, 1800, 300); },
  swish() { if (!this.ok()) return; const t = AC.ctx.currentTime, g = AC.ctx.createGain(); env(g, t, 0.03, 0.35, 0.12); g.connect(out(0.6, 0.2, 0.1)); noise(t, 0.16, g, 1200, 5000, 'bandpass', 2); },
  boom(pos) {
    if (!this.ok()) return; const s = spatial(pos), t = AC.ctx.currentTime, o = out(Math.min(1.2, s.vol * 2.2), s.pan, 0.6);
    const g = AC.ctx.createGain(); env(g, t, 0.004, 1, 1.4); g.connect(o); noise(t, 1.4, g, 2400, 60);
    tone(t, 'sine', 90, 24, 1.0, o, 1);
  },
  pickup() { if (!this.ok()) return; const t = AC.ctx.currentTime, o = out(0.25, 0, 0.3); tone(t, 'triangle', 880, 880, 0.08, o, 0.4); tone(t + 0.07, 'triangle', 1320, 1320, 0.12, o, 0.4); },
  cash() { if (!this.ok()) return; const t = AC.ctx.currentTime, o = out(0.18, 0, 0.3); for (let i = 0; i < 4; i++) tone(t + i * 0.05, 'sine', rand(2500, 4200), rand(2500, 4200), 0.08, o, 0.4); },
  heal() { if (!this.ok()) return; const t = AC.ctx.currentTime, o = out(0.25, 0, 0.4); [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.09, 'sine', f, f, 0.3, o, 0.3)); },
  roar(pos) {
    if (!this.ok()) return; const s = spatial(pos), ctx = AC.ctx, t = ctx.currentTime, o = out(Math.min(1, s.vol * 2.4), s.pan, 0.5);
    const src = ctx.createOscillator(); src.type = 'sawtooth'; src.frequency.setValueAtTime(70, t); src.frequency.linearRampToValueAtTime(95, t + 0.4); src.frequency.linearRampToValueAtTime(55, t + 1.6);
    const ws = ctx.createWaveShaper(); const c = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; c[i] = Math.tanh(x * 4); } ws.curve = c;
    const g = ctx.createGain(); env(g, t, 0.1, 0.6, 1.5); src.connect(ws); ws.connect(g); g.connect(o); src.start(t); src.stop(t + 1.8);
    const g2 = ctx.createGain(); env(g2, t, 0.1, 0.5, 1.4); g2.connect(o); noise(t, 1.5, g2, 900, 200, 'bandpass', 1);
  },
  heartbeat() { if (!this.ok()) return; const t = AC.ctx.currentTime, o = out(0.5, 0, 0); tone(t, 'sine', 70, 40, 0.12, o, 0.7); tone(t + 0.2, 'sine', 60, 35, 0.14, o, 0.5); },
  bell() { if (!this.ok()) return; const t = AC.ctx.currentTime, o = out(0.4, 0, 0.8); for (const [f, v] of [[196, 0.4], [392, 0.25], [523, 0.15], [587, 0.1]]) tone(t, 'sine', f, f * 0.995, 4, o, v, 0.01); },
};

// music scheduler: "combat" taiko-like pulse & drone, "rest" calm arpeggio
const music = { mode: 'none', next: 0, step: 0, intensity: 0 };
function setMusic(m) { music.mode = m; music.step = 0; if (AC.ctx) music.next = AC.ctx.currentTime + 0.1; }
function musicTick() {
  const ctx = AC.ctx; if (!ctx) return;
  const t = ctx.currentTime;
  const target = music.mode === 'combat' ? 0.25 + music.intensity * 0.35 : music.mode === 'boss' ? 0.6 : 0;
  AC.drone.gain.setTargetAtTime(target, t, 1.2);
  if (music.next < t) music.next = t + 0.05;
  while (music.next < t + 0.2) {
    const s = music.step++, at = music.next;
    if (music.mode === 'combat' || music.mode === 'boss') {
      const beat = music.mode === 'boss' ? 0.2 : 0.25;
      const pat = music.mode === 'boss' ? [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0] : [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0];
      if (pat[s % 16]) { tone(at, 'sine', 95, 38, 0.35, AC.music, 0.8); const g = ctx.createGain(); env(g, at, 0.002, 0.25, 0.12); g.connect(AC.music); noise(at, 0.12, g, 600, 100); }
      if (s % 32 === 28 && music.intensity > 0.3) tone(at, 'sawtooth', 587, 554, 1.2, AC.music, 0.05, 0.3);
      if (music.mode === 'boss' && s % 4 === 2) tone(at, 'square', 146.8, 146.8, 0.08, AC.music, 0.05);
      music.next += beat;
    } else if (music.mode === 'rest') {
      const prog = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 207.7, 246.9]];
      const ch = prog[Math.floor(s / 8) % 4], n = ch[s % 3] * (s % 8 > 4 ? 2 : 1);
      tone(at, 'triangle', n, n, 0.6, AC.music, 0.07, 0.01);
      if (s % 8 === 0) tone(at, 'sine', ch[0] / 2, ch[0] / 2, 2.2, AC.music, 0.09, 0.05);
      music.next += 0.32;
    } else music.next += 0.25;
  }
}

// =====================================================================
// Humanoid models (boxy, procedurally animated)
// =====================================================================
const geoCache = new Map();
function boxGeo(w, h, d) { const k = `${w}|${h}|${d}`; if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d)); return geoCache.get(k); }
function part(parent, w, h, d, m, x, y, z) { const me = new THREE.Mesh(boxGeo(w, h, d), m); me.position.set(x, y, z); me.castShadow = true; parent.add(me); return me; }
function grp(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }

function makeHumanoid(c) {
  const root = new THREE.Group(); root.rotation.order = 'YXZ';
  const s = c.scale || 1; root.scale.setScalar(s);
  const bw = c.bulk || 1;
  const hips = grp(root, 0, 0.95, 0);
  part(hips, 0.36 * bw, 0.2, 0.22, c.pants, 0, 0, 0);
  const torso = grp(hips, 0, 0.08, 0);
  part(torso, 0.44 * bw, 0.58, 0.26 * Math.sqrt(bw), c.shirt, 0, 0.3, 0);
  if (c.vest) part(torso, 0.46 * bw, 0.4, 0.28, c.vest, 0, 0.32, 0);
  if (c.apron) part(torso, 0.4 * bw, 0.75, 0.04, c.apron, 0, 0.12, 0.15);
  const neck = grp(torso, 0, 0.62, 0);
  const head = grp(neck, 0, 0.13, 0);
  const headMesh = part(head, 0.24, 0.27, 0.25, c.skin, 0, 0, 0);
  if (c.hair) part(head, 0.26, 0.08, 0.27, c.hair, 0, 0.14, -0.01);
  if (c.hairBack) part(head, 0.26, 0.2, 0.08, c.hair, 0, 0.04, -0.12);
  if (c.cap) { part(head, 0.28, 0.07, 0.29, c.cap, 0, 0.15, 0); part(head, 0.26, 0.03, 0.12, c.cap, 0, 0.12, 0.17); }
  if (c.strawHat) { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.04, 12), c.strawHat); h.position.y = 0.15; head.add(h); const h2 = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.12, 10), c.strawHat); h2.position.y = 0.2; head.add(h2); h.castShadow = h2.castShadow = true; }
  if (c.scarf) { part(head, 0.28, 0.2, 0.28, c.scarf, 0, 0.07, -0.01); part(head, 0.24, 0.24, 0.06, c.scarf, 0, -0.06, -0.13); }
  if (c.hood) { part(head, 0.32, 0.36, 0.34, c.hood, 0, 0.04, -0.02); }
  if (c.mask) { part(head, 0.3, 0.33, 0.31, c.mask, 0, 0.0, 0.0); for (let i = -1; i <= 1; i++) part(head, 0.02, 0.2, 0.02, M.metal, i * 0.07, 0.02, 0.165); }
  let eyes = null;
  if (c.eyes) {
    eyes = new THREE.Group(); head.add(eyes);
    for (const ex of [-0.055, 0.055]) { const e = new THREE.Mesh(boxGeo(0.04, 0.02, 0.01), c.eyes); e.position.set(ex, 0.02, (c.mask ? 0.163 : c.hood ? 0.175 : 0.128)); eyes.add(e); }
  }
  const arm = side => {
    const sh = grp(torso, side * (0.27 * bw), 0.54, 0);
    part(sh, 0.13 * bw, 0.32, 0.13 * bw, c.sleeve || c.shirt, 0, -0.15, 0);
    const el = grp(sh, 0, -0.31, 0);
    part(el, 0.11 * bw, 0.28, 0.11 * bw, c.forearm || c.sleeve || c.shirt, 0, -0.13, 0);
    const hand = grp(el, 0, -0.3, 0);
    part(hand, 0.09, 0.1, 0.1, c.glove || c.skin, 0, 0, 0);
    return { sh, el, hand };
  };
  const leg = side => {
    const hip = grp(hips, side * 0.1 * bw, -0.06, 0);
    part(hip, 0.16 * bw, 0.46, 0.17, c.pants, 0, -0.22, 0);
    const knee = grp(hip, 0, -0.45, 0);
    part(knee, 0.14 * bw, 0.44, 0.15, c.boots || c.pants, 0, -0.21, 0);
    part(knee, 0.15, 0.08, 0.27, c.boots || mat(0x1a1410), 0, -0.44, 0.05);
    const foot = grp(knee, 0, -0.46, 0);
    return { hip, knee, foot };
  };
  if (c.skirt) { const sk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.36, 0.6, 8), c.skirt); sk.position.y = -0.25; sk.castShadow = true; hips.add(sk); }
  return { root, hips, torso, neck, head, headMesh, eyes, armL: arm(1), armR: arm(-1), legL: leg(1), legR: leg(-1), cur: {}, scale: s };
}

// pose blending
const POSE_KEYS = ['lsx', 'lsz', 'rsx', 'rsz', 'lex', 'rex', 'lhx', 'rhx', 'lkx', 'rkx', 'tx', 'ty', 'tz', 'hx', 'hy', 'hz', 'py', 'rx', 'lhz', 'rhz'];
function applyPose(h, p, dt, k = 14) {
  const c = h.cur;
  for (const key of POSE_KEYS) { const v = p[key] || 0; c[key] = c[key] === undefined ? v : damp(c[key], v, k, dt); }
  h.armL.sh.rotation.set(c.lsx, 0, c.lsz); h.armR.sh.rotation.set(c.rsx, 0, c.rsz);
  h.armL.el.rotation.x = c.lex; h.armR.el.rotation.x = c.rex;
  h.legL.hip.rotation.set(c.lhx, 0, c.lhz); h.legR.hip.rotation.set(c.rhx, 0, c.rhz);
  h.legL.knee.rotation.x = c.lkx; h.legR.knee.rotation.x = c.rkx;
  h.torso.rotation.set(c.tx, c.ty, c.tz); h.head.rotation.set(c.hx, c.hy, c.hz);
  h.hips.position.y = 0.95 + c.py; h.root.rotation.x = c.rx;
}
function walkPose(p, phase, amp) {
  const s = Math.sin(phase), c2 = Math.cos(phase);
  p.lhx = s * 0.65 * amp; p.rhx = -s * 0.65 * amp;
  p.lkx = Math.max(0, -c2) * 0.9 * amp + 0.05; p.rkx = Math.max(0, c2) * 0.9 * amp + 0.05;
  p.lsx = (p.lsx || 0) - s * 0.5 * amp; p.rsx = (p.rsx || 0) + s * 0.5 * amp;
  p.py = -Math.abs(Math.sin(phase)) * 0.04 * amp;
  return p;
}

// weapons held by NPCs
function npcWeapon(kind) {
  const g = new THREE.Group();
  const wd = M.wood, mt = mat(0x6a6460, { metal: 0.6, rough: 0.5 });
  if (kind === 'fork') {
    part(g, 0.035, 1.6, 0.035, wd, 0, -0.3, 0);
    part(g, 0.22, 0.03, 0.03, mt, 0, -1.08, 0);
    for (const x of [-0.1, 0, 0.1]) part(g, 0.018, 0.28, 0.018, mt, x, -1.22, 0);
    g.rotation.x = 0.2;
  } else if (kind === 'sickle') {
    part(g, 0.035, 0.3, 0.035, wd, 0, -0.08, 0);
    const bl = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.014, 4, 12, Math.PI * 1.1), mt); bl.position.set(0, -0.3, 0.13); bl.rotation.y = Math.PI / 2; bl.castShadow = true; g.add(bl);
  } else if (kind === 'axe') {
    part(g, 0.035, 0.6, 0.035, wd, 0, -0.22, 0); part(g, 0.03, 0.14, 0.2, mt, 0, -0.46, 0.08);
  } else if (kind === 'torch') {
    part(g, 0.04, 0.6, 0.04, wd, 0, -0.2, 0);
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 6), new THREE.MeshBasicMaterial({ color: 0xffa040 })); f.position.y = -0.62; f.rotation.x = Math.PI; g.add(f); g.userData.flame = f;
  } else if (kind === 'maul') {
    part(g, 0.05, 1.0, 0.05, wd, 0, -0.35, 0); part(g, 0.16, 0.16, 0.34, mt, 0, -0.85, 0);
  } else if (kind === 'bigaxe') {
    part(g, 0.07, 2.0, 0.07, wd, 0, -0.7, 0);
    part(g, 0.05, 0.7, 0.6, mt, 0, -1.45, 0.3);
    part(g, 0.06, 0.12, 0.12, mt, 0, -1.7, -0.06);
  }
  return g;
}

// player-held guns (barrel along -Y of the hand, top along +Z)
function makeGun(kind) {
  const g = new THREE.Group(); const blk = mat(0x1a1a1c, { metal: 0.6, rough: 0.4 }), wd = mat(0x4a2e1a);
  if (kind === 'hg') {
    part(g, 0.045, 0.24, 0.065, blk, 0, -0.1, 0.06);
    part(g, 0.04, 0.05, 0.12, blk, 0, 0.0, -0.0);
  } else if (kind === 'sg') {
    part(g, 0.05, 0.75, 0.05, blk, 0, -0.32, 0.07); part(g, 0.045, 0.45, 0.045, blk, 0, -0.25, 0.02);
    part(g, 0.06, 0.25, 0.07, wd, 0, -0.32, 0.0); part(g, 0.06, 0.34, 0.1, wd, 0, 0.17, 0.0);
  } else {
    part(g, 0.04, 0.9, 0.04, blk, 0, -0.42, 0.07); part(g, 0.06, 0.6, 0.08, wd, 0, -0.05, 0.02);
    part(g, 0.05, 0.3, 0.06, blk, 0, -0.1, 0.13); part(g, 0.065, 0.3, 0.12, wd, 0, 0.32, 0.0);
  }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, kind === 'hg' ? -0.23 : kind === 'sg' ? -0.7 : -0.88, 0.07); g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

// =====================================================================
// Game data
// =====================================================================
const WEAP = {
  hg: { name: 'ハンドガン「ウォーデン9」', dmg: [12, 15, 18, 22, 27], cap: [10, 13, 16, 19, 23], rel: [1.5, 1.35, 1.2, 1.05, 0.9], rate: 0.24, pellets: 1, spread: 0.004, recoil: 0.03, range: 60, crit: 0.07, fov: 48, up: 700 },
  sg: { name: 'ショットガン「ブルドッグ」', dmg: [8, 10, 12, 14, 17], cap: [6, 8, 10, 12, 14], rel: [2.4, 2.2, 2.0, 1.8, 1.5], rate: 0.9, pellets: 9, spread: 0.065, recoil: 0.1, range: 24, crit: 0, fov: 52, up: 1100 },
  rf: { name: 'ライフル「ロングアイ」', dmg: [60, 75, 92, 112, 135], cap: [5, 7, 9, 11, 13], rel: [2.8, 2.5, 2.2, 1.9, 1.6], rate: 1.25, pellets: 1, spread: 0, recoil: 0.1, range: 140, crit: 0, fov: 20, up: 1400, scope: true },
};
const AMMO_NAME = { hg: 'ハンドガンの弾', sg: 'ショットシェル', rf: 'ライフル弾' };
const TREASURES = [['ガラスの義眼', 900], ['銀の燭台', 1500], ['赤い瞳の宝珠', 3000], ['古い金貨', 1200], ['獣骨の首飾り', 2000]];

const ETYPES = {
  fork:   { hp: 40, speed: 1.8, dmg: 14, range: 2.1, windup: 0.65, recover: 0.75, weapon: 'fork', grab: 0.22 },
  sickle: { hp: 32, speed: 2.5, dmg: 10, range: 1.6, windup: 0.42, recover: 0.5, weapon: 'sickle', grab: 0.3 },
  axe:    { hp: 42, speed: 1.7, dmg: 15, range: 1.8, windup: 0.6, recover: 0.65, weapon: 'axe', grab: 0.12, thrower: true },
  torch:  { hp: 38, speed: 2.0, dmg: 13, range: 1.8, windup: 0.55, recover: 0.6, weapon: 'torch', grab: 0.2 },
  brute:  { hp: 130, speed: 1.45, dmg: 24, range: 2.3, windup: 0.85, recover: 0.95, weapon: 'maul', grab: 0, scale: 1.22, bulk: 1.3 },
  boss:   { hp: 1600, speed: 1.75, dmg: 34, range: 3.8, weapon: 'bigaxe', scale: 1.6, bulk: 1.45 },
};

const WAVES = [
  { title: 'CHAPTER 1', sub: '黄昏の村', atmos: 'dusk', total: 9, conc: 4, mix: { fork: 0.55, sickle: 0.45 }, obj: '襲いかかる村人を撃退しろ' },
  { title: 'CHAPTER 2', sub: '燃える家々', atmos: 'dusk2', total: 13, conc: 6, mix: { fork: 0.3, sickle: 0.3, axe: 0.25, torch: 0.15 }, obj: '斧を投げる村人に注意しろ' },
  { title: 'CHAPTER 3', sub: '赤い霧の夜', atmos: 'night', total: 17, conc: 7, mix: { fork: 0.25, sickle: 0.25, axe: 0.2, torch: 0.15, brute: 0.15 }, obj: '頭を吹き飛ばしても安心するな', parasite: 0.4 },
  { title: 'FINAL CHAPTER', sub: '処刑人', atmos: 'blood', total: 8, conc: 3, mix: { fork: 0.4, sickle: 0.4, axe: 0.2 }, obj: '教会から現れた処刑人を倒せ', boss: true, parasite: 0.3 },
];
const SPAWNS = [[-42, 4], [42, 2], [0, 42], [-40, 40], [40, 40], [40, -40], [-41, -40], [-14, 42], [26, -42], [0, -21], [-30, 20.5], [42, -16], [-42, -14], [16, 42], [-20, -41]];
const TRADER_POS = new V3(13, 0, 2);
const START_POS = new V3(0, 0, 9);

function newInventory() {
  return {
    gold: 1200, ammo: { hg: 40, sg: 0, rf: 0 }, mag: { hg: 10, sg: 0, rf: 0 }, owned: { hg: true, sg: false, rf: false },
    lv: { hg: { pow: 0, cap: 0, rel: 0 }, sg: { pow: 0, cap: 0, rel: 0 }, rf: { pow: 0, cap: 0, rel: 0 } },
    herbG: 1, herbR: 0, herbGR: 0, gren: 1, treasures: [], vest: false,
  };
}
let inv = newInventory();
const W = id => { const w = WEAP[id], l = inv.lv[id]; return { ...w, d: w.dmg[l.pow], c: w.cap[l.cap], r: w.rel[l.rel] }; };

// =====================================================================
// Player
// =====================================================================
const player = {
  pos: START_POS.clone(), vel: new V3(), yaw: 0, pitch: -0.08, modelYaw: 0, hp: 100, maxHp: 100,
  state: 'normal', stateT: 0, aim: 0, aiming: false, fireT: 0, reloadT: 0, reloadMax: 1, weapon: 'hg',
  invuln: 0, hurtT: 0, grabbedBy: null, mash: 0, grabT: 0, dodgeT: 0, dodgeDir: new V3(), kickHit: false, knifeHit: false,
  stepAcc: 0, phase: 0, turnT: 0, turnFrom: 0, dead: false, hpLowT: 0, sway: 0, recoil: 0,
};
const ph = makeHumanoid({
  shirt: mat(0x5a3a22, { rough: 0.6 }), sleeve: mat(0x5a3a22, { rough: 0.6 }), vest: mat(0x2a2620), pants: mat(0x2a3240), skin: mat(0xc9a07e),
  hair: mat(0x3a2818), hairBack: true, glove: mat(0x1a1612), boots: mat(0x1e1712),
});
scene.add(ph.root);
const guns = { hg: makeGun('hg'), sg: makeGun('sg'), rf: makeGun('rf') };
for (const k in guns) { guns[k].position.set(0, -0.03, 0.02); ph.armR.hand.add(guns[k]); guns[k].visible = k === 'hg'; }
const knifeMesh = part(ph.armL.hand, 0.02, 0.25, 0.04, mat(0xb0b0b8, { metal: 0.9, rough: 0.3 }), 0, -0.15, 0.03); knifeMesh.visible = false;

// laser sight
const laserMat = new THREE.MeshBasicMaterial({ color: 0xff1a1a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 4, 1, true), laserMat); laser.geometry.translate(0, 0.5, 0); laser.geometry.rotateX(Math.PI / 2);
scene.add(laser);
const laserDot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030, depthTest: false, transparent: true, opacity: 0.95 }));
laserDot.renderOrder = 10; scene.add(laserDot);
const muzzleLight = new THREE.PointLight(0xffb060, 0, 9, 2); scene.add(muzzleLight);

// =====================================================================
// Enemies
// =====================================================================
const enemies = [];
const PAL = {
  shirt: [0x5e5040, 0x4a4a3a, 0x5a3020, 0x3a4636, 0x6e6252, 0x40362e, 0x5a4a5a],
  pants: [0x3a3020, 0x2a2a2a, 0x4a3a2a, 0x30302a],
  skin: [0x9a7c66, 0x8a705e, 0x8f7a6c, 0xa08a74],
};
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a10 });
const eyeMatY = new THREE.MeshBasicMaterial({ color: 0xffd040 });
const parasiteMat = new THREE.MeshStandardMaterial({ color: 0x7a0a10, emissive: 0x500008, emissiveIntensity: 1, roughness: 0.3 });

function makeVillager(type) {
  const female = (type === 'sickle' || type === 'torch') && Math.random() < 0.55;
  const t = ETYPES[type];
  const c = {
    shirt: mat(pick(PAL.shirt)), pants: mat(pick(PAL.pants)), skin: mat(pick(PAL.skin)), eyes: eyeMat,
    scale: (t.scale || 1) * rand(0.94, 1.06), bulk: t.bulk || (female ? 0.9 : rand(0.95, 1.08)), boots: mat(0x1e1812),
  };
  if (female) { c.skirt = mat(pick([0x3a2a2a, 0x2a2a3a, 0x4a3a2a])); c.scarf = mat(pick([0x5a2a20, 0x2a3a2a, 0x4a4030])); c.apron = Math.random() < 0.5 ? mat(0x8a8070) : null; }
  else {
    const r = Math.random();
    if (r < 0.35) c.cap = mat(pick([0x2a2a26, 0x3a3226])); else if (r < 0.55) c.strawHat = mat(0x9a8050); else c.hair = mat(pick([0x2a2018, 0x4a4038, 0x1a1410]));
    if (Math.random() < 0.4) c.vest = mat(pick([0x2a2420, 0x3a2e26]));
  }
  if (type === 'brute') { c.shirt = mat(0x3a2a20); c.apron = mat(0x2a1a14); c.hair = null; c.cap = null; c.strawHat = null; c.hood = mat(0x2a2018); }
  if (type === 'boss') {
    Object.assign(c, { shirt: mat(0x2a2220), sleeve: mat(0x5a4a40), apron: mat(0x3a2418, { rough: 0.6 }), pants: mat(0x221a16), mask: mat(0x3a3836, { metal: 0.7, rough: 0.45 }), eyes: eyeMatY, skin: mat(0x8a6a5a), glove: mat(0x2a1a12) });
    c.hair = c.cap = c.strawHat = c.scarf = c.skirt = null;
  }
  const h = makeHumanoid(c);
  const w = npcWeapon(t.weapon); h.armR.hand.add(w); h.weapon = w;
  // parasite (hidden until revealed)
  const par = new THREE.Group(); par.visible = false; h.neck.add(par);
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Group(); par.add(seg); seg.rotation.set(rand(-0.6, 0.6), i * 1.25, 0);
    for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.07 - k * 0.012, 6, 5), parasiteMat); b.position.y = 0.08 + k * 0.1; seg.add(b); }
  }
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), parasiteMat); bulb.position.y = 0.05; par.add(bulb);
  h.parasite = par;
  if (type === 'boss') {
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffaa30 }));
    core.position.set(0, 0.35, -0.16); h.torso.add(core); h.core = core;
    part(h.torso, 0.08, 0.08, 0.2, M.metal, 0.12, 0.55, -0.14); part(h.torso, 0.08, 0.08, 0.2, M.metal, -0.12, 0.55, -0.14);
  }
  return h;
}

class Enemy {
  constructor(type, x, z, waveCfg) {
    this.type = type; this.t = ETYPES[type]; this.boss = type === 'boss';
    const hpMul = 1 + (director.wave * 0.08);
    this.hp = this.maxHp = this.t.hp * (this.boss ? 1 : hpMul);
    this.pos = new V3(x, 0, z); this.vel = new V3(); this.face = Math.atan2(player.pos.x - x, player.pos.z - z);
    this.state = this.boss ? 'intro' : 'chase'; this.st = 0; this.cd = rand(0.4, 1.4);
    this.speed = this.t.speed * rand(0.9, 1.15) * (this.boss ? 1 : 1 + director.wave * 0.05);
    this.phase = rand(0, 6); this.voiceT = rand(1, 4); this.losT = 0; this.los = false; this.dead = false; this.removeT = 0;
    this.h = makeVillager(type); this.h.root.position.copy(this.pos); this.h.root.rotation.y = this.face; scene.add(this.h.root);
    this.hb = { head: new V3(), neck: new V3(), hips: new V3(), feet: new V3(), core: new V3() };
    this.scale = this.h.scale; this.radius = 0.33 * this.scale;
    this.kickable = false; this.throwCD = rand(2, 5); this.parasiteChance = waveCfg?.parasite || 0;
    this.isParasite = false; this.stagger = 0; this.slamPos = new V3(); this.phase2 = false; this.alerted = false;
    this.chargeDir = new V3(); this.hitThisCharge = false;
    this.updateHB();
  }
  setState(s) { this.state = s; this.st = 0; this.struck = false; this.marked = false; }
  updateHB() {
    const h = this.h; h.root.updateMatrixWorld(true);
    h.head.getWorldPosition(this.hb.head); h.neck.getWorldPosition(this.hb.neck); h.hips.getWorldPosition(this.hb.hips);
    h.legL.foot.getWorldPosition(_p); h.legR.foot.getWorldPosition(_q); this.hb.feet.addVectors(_p, _q).multiplyScalar(0.5);
    if (this.isParasite) this.hb.head.copy(this.hb.neck).y += 0.15 * this.scale;
    if (h.core) h.core.getWorldPosition(this.hb.core);
  }
  get alive() { return !this.dead && this.state !== 'dying'; }

  damage(dmg, part, dir, src = 'gun') {
    if (!this.alive) return;
    let m = part === 'head' ? 2.0 : part === 'legs' ? 0.75 : part === 'core' ? 2.6 : 1;
    if (this.isParasite) m = src === 'sg' || src === 'boom' ? 2.2 : part === 'head' ? 1.2 : 0.6;
    if (this.boss && part === 'head') m = 1.3;
    this.hp -= dmg * m; this.alerted = true;
    const hitP = part === 'head' ? this.hb.head : part === 'legs' ? _p.copy(this.hb.hips).lerp(this.hb.feet, 0.5) : _p.copy(this.hb.hips).lerp(this.hb.neck, 0.5);
    fxBlood(hitP, dir, part === 'head' ? 18 : 10, this.boss ? 1.4 : 1);
    if (this.isParasite) fxSparks(hitP, 4);
    sfx.hit(this.pos);
    if (this.boss) { this.bossDamage(dmg * m, part, src); return; }
    // critical headshot (instant head pop)
    if (part === 'head' && !this.isParasite && this.hp > 0 && ((src === 'hg' && Math.random() < WEAP.hg.crit) || (src === 'sg' && dmg * m > 30 && Math.random() < 0.35))) { this.hp = 0; showLog('クリティカル！'); }
    if (this.hp <= 0) { this.die(part === 'head', dir, src); return; }
    const sg = src === 'sg' || src === 'boom';
    const close = this.pos.distanceTo(player.pos) < 5;
    if (src === 'boom' || (sg && close)) { this.knockdown(); return; }
    if (part === 'head' && !this.isParasite) { this.setState('stagger'); this.staggerKind = 'head'; this.stDur = rand(1.1, 1.5); sfx.voice(this.pos, 1, true); }
    else if (part === 'legs' && Math.random() < 0.7) { this.setState('stagger'); this.staggerKind = 'knee'; this.stDur = rand(1.2, 1.6); }
    else if (this.state !== 'stagger' && this.state !== 'down') { this.setState('flinch'); }
  }
  bossDamage(d, part, src) {
    this.stagger += d * (part === 'head' ? 2 : 1);
    if (!this.phase2 && this.hp < this.maxHp * 0.5) { this.phase2 = true; this.speed *= 1.25; this.setState('roar'); sfx.roar(this.pos); showLog('処刑人が激昂した！'); director.extraSpawns = 6; return; }
    if (this.hp <= 0) { this.die(false, new V3(0, 0, 1), src); return; }
    if (this.stagger > 280 && this.state !== 'kneel') { this.stagger = 0; this.setState('kneel'); sfx.roar(this.pos); hideSlam(); }
  }
  knockdown() { if (!this.alive) return; this.setState('down'); this.kickable = false; this.vel.set(0, 0, 0); if (player.grabbedBy === this) releaseGrab(); }
  die(head, dir, src) {
    if (player.grabbedBy === this) releaseGrab();
    if (head && this.parasiteChance > 0 && !this.isParasite && Math.random() < this.parasiteChance) {
      // the head bursts, the parasite emerges
      this.isParasite = true; this.h.headMesh.parent.visible = false; this.h.parasite.visible = true;
      this.hp = 55; this.speed = 2.5; this.setState('emerge'); fxBlood(this.hb.head, dir, 40, 1.5); sfx.splat(this.pos); addDecal(this.pos.x, this.pos.z, 1.2);
      showLog('寄生体が姿を現した！ ショットガンが有効だ'); return;
    }
    if (head) { this.h.head.visible = false; fxBlood(this.hb.head, dir, 50, 1.6); sfx.splat(this.pos); }
    this.setState('dying'); this.kickable = false;
    this.fallDir = 1;
    stats.kills++; if (head) stats.headKills++;
    addDecal(this.pos.x, this.pos.z, this.boss ? 2.4 : 1);
    if (this.boss) { sfx.roar(this.pos); director.bossDead = true; dropLoot(this.pos, 'boss'); }
    else dropLoot(this.pos, this.type);
    sfx.voice(this.pos, this.scale, true);
  }

  update(dt) {
    this.st += dt; this.cd -= dt; this.throwCD -= dt; this.voiceT -= dt;
    if (this.dead) { this.removeT += dt; if (this.removeT > 4) this.h.root.position.y = -(this.removeT - 4) * 0.4; return; }
    if (this.state === 'dying') { this.animate(dt, 0); if (this.st > 1.3) { this.dead = true; this.removeT = 0; } return; }
    if (this.boss) { this.updateBoss(dt); return; }
    const P = player.pos, dx = P.x - this.pos.x, dz = P.z - this.pos.z, dist = Math.hypot(dx, dz) || 0.001;
    const toFace = Math.atan2(dx, dz);
    this.losT -= dt;
    if (this.losT <= 0) { this.losT = rand(0.2, 0.35); this.los = segClear(_a.set(this.pos.x, 0.6, this.pos.z), _b.set(P.x, 0.6, P.z)); }
    if (this.voiceT <= 0) { this.voiceT = rand(2.5, 6); if (dist < 25) { sfx.voice(this.pos, this.scale); if (dist < 16 && Math.random() < 0.25) showSubtitle(pick(CHANTS)); } }
    let moveSpeed = 0;
    this.kickable = false;
    switch (this.state) {
      case 'chase': {
        if (player.dead) { moveSpeed = 0.4; break; }
        moveSpeed = this.isParasite ? this.speed : this.speed;
        if (dist < this.t.range + 0.1 && this.cd <= 0) {
          if (this.t.grab && !player.grabbedBy && dist < 1.7 && Math.random() < this.t.grab && player.state !== 'kick') this.setState('grabWind');
          else this.setState('windup');
        } else if (this.t.thrower && dist > 6 && dist < 18 && this.los && this.throwCD <= 0) this.setState('throwWind');
        break;
      }
      case 'windup': this.face = dampAng(this.face, toFace, 6, dt); if (this.st > (this.isParasite ? 0.45 : this.t.windup)) this.setState('strike'); break;
      case 'strike':
        if (!this.struck) {
          this.struck = true; sfx.swish();
          const range = (this.isParasite ? 2.7 : this.t.range) + 0.45;
          const facing = Math.cos(angDiff(this.face, toFace));
          if (dist < range && facing > 0.4) hurtPlayer(this.isParasite ? 24 : this.t.dmg * (1 + director.wave * 0.05), this.pos);
        }
        if (this.st > 0.25) { this.struck = false; this.setState('recover'); }
        break;
      case 'recover': if (this.st > this.t.recover) { this.setState('chase'); this.cd = rand(0.7, 1.5); } break;
      case 'grabWind':
        this.face = dampAng(this.face, toFace, 8, dt); moveSpeed = this.speed * 1.4;
        if (this.st > 0.45) { if (dist < 1.5 && !player.grabbedBy && player.invuln <= 0 && player.state !== 'kick' && !player.dead && player.dodgeT <= 0) startGrab(this); else { this.setState('recover'); } }
        break;
      case 'grabbing': {
        const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
        this.pos.x = damp(this.pos.x, P.x + fx * 0.7, 10, dt); this.pos.z = damp(this.pos.z, P.z + fz * 0.7, 10, dt);
        this.face = Math.atan2(P.x - this.pos.x, P.z - this.pos.z);
        break;
      }
      case 'throwWind': this.face = dampAng(this.face, toFace, 8, dt); if (this.st > 0.85) { throwAxe(this); this.throwCD = rand(4, 7); this.setState('recover'); } break;
      case 'stagger': this.kickable = true; if (this.st > this.stDur) this.setState('chase'); break;
      case 'flinch': if (this.st > 0.3) this.setState('chase'); break;
      case 'down': if (this.st > 2.0) this.setState('getup'); break;
      case 'getup': if (this.st > 0.7) this.setState('chase'); break;
      case 'emerge': if (this.st > 1.2) this.setState('chase'); break;
      case 'stunned': this.kickable = true; if (this.st > 1.2) this.setState('chase'); break;
    }
    // locomotion
    const desire = _c.set(0, 0, 0);
    if (moveSpeed > 0) {
      if (this.los && dist < 22) desire.set(dx / dist, 0, dz / dist);
      else if (!navDir(this.pos, desire)) desire.set(dx / dist, 0, dz / dist);
      if (dist < 0.85) desire.set(0, 0, 0);
      desire.multiplyScalar(moveSpeed);
    }
    for (const o of enemies) {
      if (o === this || !o.alive) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z, d2 = ox * ox + oz * oz, rr = this.radius + o.radius + 0.15;
      if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2), f = (rr - d) / rr * 3; desire.x += ox / d * f; desire.z += oz / d * f; }
    }
    this.vel.x = damp(this.vel.x, desire.x, 6, dt); this.vel.z = damp(this.vel.z, desire.z, 6, dt);
    if (this.state === 'down' || this.state === 'stagger' || this.state === 'getup' || this.state === 'stunned') this.vel.multiplyScalar(Math.max(0, 1 - dt * 6));
    this.pos.addScaledVector(this.vel, dt);
    collide(this.pos, this.radius);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (this.state === 'chase' && sp > 0.2) this.face = dampAng(this.face, this.los && dist < 8 ? toFace : Math.atan2(this.vel.x, this.vel.z), 7, dt);
    this.phase += sp * dt * 3.2;
    this.animate(dt, sp);
  }

  animate(dt, sp) {
    const h = this.h, p = {}; const s = this.state;
    if (s === 'chase' || s === 'grabWind') {
      p.rsx = -0.35; p.lsx = 0; p.rex = -0.4; p.tx = 0.18; p.hx = -0.1;
      if (this.isParasite) { p.rsx = -0.2; p.lsx = -0.2; p.tx = 0.3; }
      walkPose(p, this.phase, clamp(sp / 2, 0, 1.2));
      if (s === 'grabWind') { p.lsx = -1.5; p.rsx = -1.5; p.lex = -0.2; p.rex = -0.2; p.tx = 0.3; }
      if (sp < 0.2 && this.isParasite) p.hz = Math.sin(this.st * 9) * 0.3;
    } else if (s === 'windup') { p.rsx = -2.7; p.rex = -0.6; p.lsx = -0.5; p.tx = -0.15; p.ty = 0.3; }
    else if (s === 'strike') { p.rsx = -0.9; p.rex = -0.1; p.lsx = 0.3; p.tx = 0.4; p.ty = -0.25; }
    else if (s === 'recover') { p.rsx = -0.6; p.tx = 0.25; }
    else if (s === 'throwWind') { p.rsx = -2.9; p.rex = -0.8; p.lsx = -0.9; p.tx = -0.25; p.ty = 0.4; }
    else if (s === 'grabbing') { p.lsx = -1.6; p.rsx = -1.6; p.lex = -0.5; p.rex = -0.5; p.tx = 0.35; p.hx = 0.3; walkPose(p, this.st * 10, 0.15); }
    else if (s === 'flinch') { p.tx = -0.35; p.hx = -0.4; p.rsx = 0.3; p.lsx = 0.3; }
    else if (s === 'stagger') {
      if (this.staggerKind === 'head') { p.lsx = -2.4; p.rsx = -2.0; p.lex = -1.8; p.rex = -1.6; p.tx = -0.25; p.hx = -0.3 + Math.sin(this.st * 8) * 0.15; p.ty = Math.sin(this.st * 5) * 0.2; }
      else { p.lhx = -1.4; p.lkx = 1.6; p.rhx = 0.2; p.rkx = 1.9; p.py = -0.42; p.tx = 0.4; p.lsx = -0.6; p.rsx = -0.4; }
    } else if (s === 'down' || s === 'dying') {
      const t = clamp(this.st / 0.55, 0, 1);
      p.rx = -Math.PI / 2 * (t * t * (3 - 2 * t)) * 0.98; p.py = -0.05; p.lsx = -2.6; p.rsx = -2.3; p.lhx = -0.3; p.rhx = 0.15; p.lkx = 0.3; p.hx = -0.2;
    } else if (s === 'getup') {
      const t = clamp(this.st / 0.7, 0, 1); p.rx = -Math.PI / 2 * (1 - t); p.tx = 0.6 * (1 - t); p.lkx = 1.2 * (1 - t); p.rkx = 1.2 * (1 - t); p.py = -0.3 * (1 - t);
    } else if (s === 'emerge') { p.tx = 0.2 + Math.sin(this.st * 14) * 0.15; p.lsx = 0.2; p.rsx = 0.2; p.tz = Math.sin(this.st * 11) * 0.2; }
    else if (s === 'stunned') { p.tx = 0.5; p.hx = 0.4; p.lsx = 0.2; p.rsx = 0.2; p.lkx = 0.4; p.rkx = 0.4; p.py = -0.1; }
    applyPose(h, p, dt, s === 'strike' ? 30 : s === 'down' || s === 'dying' ? 30 : 12);
    if (this.isParasite) { h.parasite.children.forEach((seg, i) => { seg.rotation.x = Math.sin(this.st * 6 + i) * 0.8; seg.rotation.z = Math.cos(this.st * 5 + i * 2) * 0.6; }); }
    if (h.weapon.userData.flame) { const f = h.weapon.userData.flame; f.scale.setScalar(0.8 + Math.random() * 0.5); if (Math.random() < 0.3) particlesA.add(this.hb.hips.x, this.hb.neck.y + 0.4, this.hb.hips.z, rand(-.2, .2), 1.2, rand(-.2, .2), 0.4, 0.15, 0.05, 1, 0.5, 0.15, 1, -1, 1, false); }
    h.root.position.x = this.pos.x; h.root.position.z = this.pos.z; h.root.rotation.y = this.face;
    this.updateHB();
  }

  updateBoss(dt) {
    const P = player.pos, dx = P.x - this.pos.x, dz = P.z - this.pos.z, dist = Math.hypot(dx, dz) || 0.001, toFace = Math.atan2(dx, dz);
    let speed = 0; this.kickable = false;
    const h = this.h, p = {};
    switch (this.state) {
      case 'intro': speed = 1.2; if (this.st > 3.2) { this.setState('roar'); sfx.roar(this.pos); } break;
      case 'roar': p.lsx = -2.2; p.rsx = -2.4; p.tx = -0.35; p.hx = -0.5; if (this.st < 0.1) shake(0.4, 0.8); if (this.st > 1.4) { this.setState('chase'); this.cd = 1; } break;
      case 'chase': {
        speed = this.speed;
        if (this.cd <= 0 && !player.dead) {
          if (dist < this.t.range) { this.setState(Math.random() < 0.6 ? 'swingWind' : 'slamWind'); }
          else if (dist > 8 && Math.random() < 0.5) { this.setState('chargeWind'); sfx.roar(this.pos); }
          else if (dist < 9 && Math.random() < 0.4) this.setState('slamWind');
          this.cd = 0.4;
        }
        break;
      }
      case 'swingWind': this.face = dampAng(this.face, toFace, 4, dt); p.rsx = -1.6; p.rsz = -1.3; p.ty = 0.9; p.lsx = -0.6; if (this.st > (this.phase2 ? 0.65 : 0.9)) { this.setState('swing'); sfx.swish(); } break;
      case 'swing': {
        p.rsx = -1.5; p.rsz = 0.6; p.ty = -1.0; p.tx = 0.3;
        if (!this.struck) { this.struck = true; const fa = Math.cos(angDiff(this.face, toFace)); if (dist < 4.4 && fa > 0.2 && hurtPlayer(32, this.pos)) knockPlayer(this.pos, 7); }
        if (this.st > 0.3) { this.struck = false; this.setState('recover'); this.recoverDur = 0.9; }
        break;
      }
      case 'slamWind':
        if (!this.marked) { this.marked = true; this.slamPos.set(P.x, 0, P.z); showSlam(this.slamPos, 3.2); }
        this.face = dampAng(this.face, Math.atan2(this.slamPos.x - this.pos.x, this.slamPos.z - this.pos.z), 5, dt);
        speed = dist > 3 ? this.speed * 0.9 : 0;
        p.rsx = -3.0; p.lsx = -3.0; p.tx = -0.3; slamDecal.material.opacity = 0.25 + this.st * 0.4;
        if (this.st > (this.phase2 ? 1.0 : 1.3)) this.setState('slam');
        break;
      case 'slam':
        p.rsx = -1.2; p.lsx = -1.2; p.tx = 0.6; p.py = -0.15;
        if (!this.struck) {
          this.struck = true; hideSlam(); shake(0.5, 0.6); sfx.boom(this.slamPos);
          const fwd = new V3(Math.sin(this.face), 0, Math.cos(this.face)).multiplyScalar(2.6 * this.scale / 1.6).add(this.pos);
          fxDust(fwd, 30); for (let i = 0; i < 12; i++) particlesN.add(fwd.x, 0.1, fwd.z, rand(-4, 4), rand(1, 4), rand(-4, 4), rand(0.6, 1.2), 0.12, 0.05, 0.3, 0.25, 0.2, 1, 12, 0.5);
          if (Math.hypot(P.x - fwd.x, P.z - fwd.z) < 3.4 && hurtPlayer(42, fwd)) knockPlayer(fwd, 8);
        }
        if (this.st > 0.35) { this.struck = false; this.setState('recover'); this.recoverDur = 1.2; }
        break;
      case 'chargeWind': this.face = dampAng(this.face, toFace, 8, dt); p.tx = 0.5; p.rsx = -0.4; p.lsx = -0.4; p.lhx = 0.4; p.lkx = 0.8; if (this.st > 0.9) { this.setState('charge'); this.chargeDir.set(Math.sin(this.face), 0, Math.cos(this.face)); this.hitThisCharge = false; qte.dodgeShown = false; } break;
      case 'charge': {
        p.tx = 0.55; p.rsx = -0.8; walkPose(p, this.st * 16, 1.3);
        this.pos.addScaledVector(this.chargeDir, (this.phase2 ? 11 : 9.5) * dt);
        const pre = this.pos.clone(); collide(this.pos, this.radius);
        const blocked = pre.distanceToSquared(this.pos) > 0.0004 || Math.abs(this.pos.x) >= BOUND || Math.abs(this.pos.z) >= BOUND;
        const rel = _b.subVectors(P, this.pos); const ahead = rel.dot(this.chargeDir);
        if (!this.hitThisCharge && ahead > -0.5 && ahead < 1.6 && Math.abs(rel.x * this.chargeDir.z - rel.z * this.chargeDir.x) < 1.3) {
          if (hurtPlayer(40, this.pos)) { knockPlayer(this.pos, 10); this.hitThisCharge = true; }
        }
        if (ahead > 0 && ahead < 7 && !this.hitThisCharge && player.dodgeT <= 0) qte.dodgeOpen = true;
        if (blocked) { this.setState('stun'); shake(0.6, 0.7); sfx.wood(this.pos); fxDust(this.pos, 30); showLog('処刑人が壁に激突した！今だ！'); hideQTE(); }
        else if (this.st > 2.2) { this.setState('recover'); this.recoverDur = 1.0; }
        break;
      }
      case 'stun': p.tx = 0.6; p.hx = 0.4; p.rsx = 0.3; p.lsx = 0.3; p.py = -0.2; this.kickable = true; if (this.st > 2.6) this.setState('chase'); break;
      case 'kneel': p.lhx = -1.4; p.lkx = 1.6; p.rhx = 0.2; p.rkx = 1.9; p.py = -0.42; p.tx = 0.6; p.lsx = -0.4; p.rsx = -0.3; p.hx = 0.3; this.kickable = true; if (this.st > 3.2) this.setState('chase'); break;
      case 'kicked': p.rx = -0.5; p.tx = -0.4; if (this.st > 1.0) this.setState('chase'); break;
      case 'recover': p.tx = 0.3; p.rsx = -0.4; if (this.st > (this.recoverDur || 1)) { this.setState('chase'); this.cd = rand(0.6, 1.4); } break;
    }
    if (this.state !== 'charge') qte.dodgeOpen = false;
    if (speed > 0) {
      const desire = _c;
      if (this.state === 'intro') desire.set(0, 0, 1);
      else if (segClear(_a.set(this.pos.x, 0.6, this.pos.z), _b.set(P.x, 0.6, P.z))) desire.set(dx / dist, 0, dz / dist);
      else if (!navDir(this.pos, desire)) desire.set(dx / dist, 0, dz / dist);
      if (dist < 2.2 && this.state === 'chase') desire.set(0, 0, 0);
      this.vel.x = damp(this.vel.x, desire.x * speed, 5, dt); this.vel.z = damp(this.vel.z, desire.z * speed, 5, dt);
    } else if (this.state !== 'charge') this.vel.multiplyScalar(Math.max(0, 1 - dt * 6));
    if (this.state !== 'charge') { this.pos.addScaledVector(this.vel, dt); if (this.state !== 'intro') collide(this.pos, this.radius); }
    const sp = this.state === 'charge' ? 9 : Math.hypot(this.vel.x, this.vel.z);
    if (this.state === 'chase' || this.state === 'intro') { this.face = dampAng(this.face, this.state === 'intro' ? 0 : toFace, 4, dt); walkPose(p, this.phase, clamp(sp / 1.6, 0, 1)); p.rsx = (p.rsx || 0) - 0.3; p.tx = (p.tx || 0) + 0.15; }
    this.phase += sp * dt * 2.2;
    if (this.state !== 'charge' && sp > 0.5 && Math.floor(this.phase / Math.PI) !== Math.floor((this.phase - sp * dt * 2.2) / Math.PI)) { shake(0.06, 0.15); }
    applyPose(h, p, dt, this.state === 'swing' || this.state === 'slam' ? 28 : 10);
    h.root.position.x = this.pos.x; h.root.position.z = this.pos.z; h.root.rotation.y = this.face;
    h.core.material.color.setHSL(0.08, 1, 0.5 + Math.sin(performance.now() / 120) * 0.15);
    this.updateHB();
  }
}
const _a = new V3(), _b = new V3(), _c = new V3();
const CHANTS = ['「ヴァル・セーナ！」', '「クォ・ダレム…」', '「ムエ・ラ・カーサ！」', '「オルド…オルド…」', '「セナ・ディール！」'];

// boss slam telegraph
const slamDecal = new THREE.Mesh(new THREE.RingGeometry(0.2, 1, 40), new THREE.MeshBasicMaterial({ color: 0xff2010, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }));
slamDecal.rotation.x = -Math.PI / 2; slamDecal.visible = false; scene.add(slamDecal);
function showSlam(p, r) { slamDecal.visible = true; slamDecal.position.set(p.x, 0.04, p.z); slamDecal.scale.setScalar(r); }
function hideSlam() { slamDecal.visible = false; }

// =====================================================================
// Projectiles, grenades, pickups
// =====================================================================
const projectiles = [];
const axeGeo = new THREE.BoxGeometry(0.04, 0.5, 0.05);
function throwAxe(e) {
  const g = new THREE.Group(); const m1 = new THREE.Mesh(axeGeo, M.wood); g.add(m1);
  const m2 = new THREE.Mesh(boxGeo(0.03, 0.14, 0.2), mat(0x6a6460, { metal: 0.6 })); m2.position.set(0, 0.22, 0.07); g.add(m2);
  g.traverse(o => o.castShadow = true); scene.add(g);
  const from = e.hb.neck.clone(); from.y += 0.2;
  const target = player.pos.clone().add(new V3(player.vel.x * 0.5, 1.2, player.vel.z * 0.5));
  const d = target.clone().sub(from); const flat = Math.hypot(d.x, d.z); const T = flat / 13;
  const vel = new V3(d.x / T, d.y / T + 0.5 * 9.8 * T, d.z / T);
  projectiles.push({ mesh: g, pos: from, vel, spin: rand(14, 18), life: 4, alive: true, kind: 'axe' });
  sfx.swish(); e.h.weapon.visible = false; setTimeout(() => { e.h.weapon.visible = true; }, 1600);
}
function updateProjectiles(dt) {
  for (const p of projectiles) {
    if (!p.alive) continue;
    p.life -= dt; p.vel.y -= 9.8 * dt; p.pos.addScaledVector(p.vel, dt);
    p.mesh.position.copy(p.pos); p.mesh.rotation.x += p.spin * dt; p.mesh.rotation.y = Math.atan2(p.vel.x, p.vel.z);
    if (p.kind === 'axe') {
      const c = _a.copy(player.pos); c.y = 1.15;
      if (p.pos.distanceTo(c) < 0.65) { if (hurtPlayer(15, p.pos)) {} p.alive = false; }
      else if (p.pos.y < 0.05 || p.life <= 0) { p.alive = false; fxDust(p.pos, 4); }
      else for (const s of solids) if (s.alive && p.pos.x > s.minX && p.pos.x < s.maxX && p.pos.z > s.minZ && p.pos.z < s.maxZ && p.pos.y < s.maxY) { p.alive = false; sfx.wood(p.pos); break; }
    } else if (p.kind === 'gren') {
      if (p.pos.y < 0.08) { p.pos.y = 0.08; if (p.vel.y < -1) sfx.click(); p.vel.y *= -0.35; p.vel.x *= 0.6; p.vel.z *= 0.6; }
      for (const s of solids) if (s.alive && p.pos.x > s.minX && p.pos.x < s.maxX && p.pos.z > s.minZ && p.pos.z < s.maxZ && p.pos.y < s.maxY) { p.pos.addScaledVector(p.vel, -dt); p.vel.x *= -0.4; p.vel.z *= -0.4; break; }
      if (p.life <= 0) { p.alive = false; explode(p.pos.clone(), 5.5, 140); }
    }
    if (!p.alive) scene.remove(p.mesh);
  }
  for (let i = projectiles.length - 1; i >= 0; i--) if (!projectiles[i].alive) projectiles.splice(i, 1);
}
function throwGrenade() {
  if (inv.gren <= 0) { showLog('手榴弾がない'); return; }
  inv.gren--; sfx.swish();
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), mat(0x3a4a2a, { metal: 0.4 })); m.castShadow = true; scene.add(m);
  const d = camForward(_a); const from = player.pos.clone().add(new V3(0, 1.6, 0));
  projectiles.push({ mesh: m, pos: from, vel: new V3(d.x * 13, d.y * 13 + 4.5, d.z * 13), spin: 8, life: 1.7, alive: true, kind: 'gren' });
}

function explode(pos, r, dmg) {
  fxExplosion(pos, r); doFlash(pos.clone().setY(1.5), 60); sfx.boom(pos);
  const dp = pos.distanceTo(player.pos); shake(clamp(1 - dp / 25, 0.1, 1) * 0.9, 0.7);
  addDecal(pos.x, pos.z, 2.2);
  for (const e of enemies) {
    if (!e.alive) continue; const d = e.pos.distanceTo(pos);
    if (d < r) { const dir = _b.subVectors(e.pos, pos).setY(0.4).normalize(); const f = 1 - d / r; e.damage(dmg * (0.3 + 0.7 * f) / (e.boss ? 1 : 1), 'body', dir, 'boom'); if (e.boss && e.alive) { e.stagger += 120 * f; } }
  }
  if (dp < r) hurtPlayer(dmg * 0.35 * (1 - dp / r), pos, true);
  for (const b of barrels) if (b.alive && b.fuse < 0 && b.pos.distanceTo(pos) < r * 0.9) b.fuse = 0.15 + Math.random() * 0.2;
  for (const c of crates) if (c.alive && c.pos.distanceTo(pos) < r * 0.8) breakCrate(c);
}
function blowBarrel(b) { if (!b.alive) return; b.alive = false; b.solid.alive = false; b.mesh.visible = false; b.band.visible = false; explode(b.pos.clone(), 5.5, 160); navBuild(); }
function breakCrate(c) {
  if (!c.alive) return; c.alive = false; c.solid.alive = false; c.mesh.visible = false; fxSplinters(c.pos); sfx.wood(c.pos); navBuild();
  const r = Math.random();
  if (r < 0.35) spawnPickup(c.pos, 'gold', randi(100, 400));
  else if (r < 0.65) spawnPickup(c.pos, 'ammo');
  else if (r < 0.82) spawnPickup(c.pos, 'herbG');
  else if (r < 0.9) spawnPickup(c.pos, 'herbR');
  else spawnPickup(c.pos, 'gren');
}

const pickups = [];
const PICK_VIS = {
  gold: [0xffcc40, 'G'], ammo_hg: [0xc0a060, ''], ammo_sg: [0xc04020, ''], ammo_rf: [0x60a0c0, ''], herbG: [0x40c040, ''], herbR: [0xd03030, ''], gren: [0x6a8a40, ''], treasure: [0xff40c0, ''],
};
function spawnPickup(at, kind, amount) {
  if (kind === 'ammo') {
    // weighted toward owned guns, especially ones running low
    const opts = ['hg', 'sg', 'rf'].filter(k => inv.owned[k]);
    const w = opts.map(k => 1 / (1 + (inv.ammo[k] + inv.mag[k]) / W(k).c));
    let r = Math.random() * w.reduce((a, b) => a + b, 0), k = opts[0];
    for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) { k = opts[i]; break; } }
    kind = 'ammo_' + k; amount = amount || { hg: randi(6, 12), sg: randi(3, 6), rf: randi(2, 4) }[k];
  }
  if (kind === 'treasure') amount = amount ?? randi(0, TREASURES.length - 1);
  const col = PICK_VIS[kind][0];
  const g = new THREE.Group();
  const shape = kind === 'gold' ? new THREE.CylinderGeometry(0.12, 0.12, 0.04, 10) : kind.startsWith('herb') ? new THREE.ConeGeometry(0.14, 0.3, 5) : kind === 'treasure' ? new THREE.OctahedronGeometry(0.14) : new THREE.BoxGeometry(0.22, 0.14, 0.14);
  const m = new THREE.Mesh(shape, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, metalness: kind === 'gold' ? 0.8 : 0.1, roughness: 0.4 }));
  m.castShadow = true; g.add(m);
  const glow = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.32, 20), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = -0.3; g.add(glow);
  g.position.set(at.x + rand(-0.4, 0.4), 0.38, at.z + rand(-0.4, 0.4));
  scene.add(g); pickups.push({ g, m, kind, amount, t: rand(0, 6), alive: true, life: 60 });
}
function dropLoot(pos, type) {
  if (type === 'boss') { spawnPickup(pos, 'treasure', 2); spawnPickup(pos, 'gold', 5000); return; }
  const r = Math.random();
  if (type === 'brute') { spawnPickup(pos, 'treasure'); spawnPickup(pos, 'gold', randi(400, 800)); return; }
  if (r < 0.42) spawnPickup(pos, 'gold', randi(60, 220));
  else if (r < 0.8) spawnPickup(pos, 'ammo');
  else if (r < 0.89) spawnPickup(pos, 'herbG');
  else if (r < 0.92) spawnPickup(pos, 'herbR');
  else if (r < 0.94) spawnPickup(pos, 'gren');
  else if (r < 0.97) spawnPickup(pos, 'treasure');
}
function updatePickups(dt) {
  for (const p of pickups) {
    if (!p.alive) continue;
    p.t += dt; p.life -= dt; p.m.rotation.y += dt * 2; p.m.position.y = Math.sin(p.t * 3) * 0.06;
    if (p.kind === 'gold') p.m.rotation.x = Math.PI / 2;
    const d = Math.hypot(p.g.position.x - player.pos.x, p.g.position.z - player.pos.z);
    if (d < 1.4 && !player.dead) { collectPickup(p); }
    else if (p.life <= 0) p.alive = false;
    if (!p.alive) scene.remove(p.g);
  }
  for (let i = pickups.length - 1; i >= 0; i--) if (!pickups[i].alive) pickups.splice(i, 1);
}
function collectPickup(p) {
  p.alive = false;
  const k = p.kind;
  if (k === 'gold') { inv.gold += p.amount; sfx.cash(); showLog(`${p.amount.toLocaleString()} G を手に入れた`); return; }
  sfx.pickup();
  if (k.startsWith('ammo_')) { const w = k.slice(5); inv.ammo[w] += p.amount; showLog(`${AMMO_NAME[w]} ×${p.amount}`); }
  else if (k === 'herbG') { inv.herbG++; showLog('グリーンハーブを手に入れた'); }
  else if (k === 'herbR') { inv.herbR++; showLog('レッドハーブを手に入れた（ケースで調合できる）'); }
  else if (k === 'gren') { inv.gren++; showLog('手榴弾を手に入れた'); }
  else if (k === 'treasure') { const t = TREASURES[p.amount]; inv.treasures.push(p.amount); showLog(`宝物「${t[0]}」を手に入れた（商人に売れる）`); }
}

// =====================================================================
// Trader
// =====================================================================
const trader = (() => {
  const h = makeHumanoid({ shirt: mat(0x1e2a24), sleeve: mat(0x1e2a24), pants: mat(0x161a18), skin: mat(0x6a5a4a), hood: mat(0x18221e), eyes: eyeMatY, glove: mat(0x2a2018), apron: mat(0x1a221e), scale: 1.05, bulk: 1.1 });
  const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.48, 1.1, 8), mat(0x18221e)); coat.position.y = -0.35; coat.castShadow = true; h.hips.add(coat);
  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.14), new THREE.MeshBasicMaterial({ color: 0x60a0ff })); lantern.position.y = -0.1; h.armL.hand.add(lantern);
  const light = new THREE.PointLight(0x4a80ff, 5, 10, 1.6); light.position.y = -0.1; h.armL.hand.add(light);
  const stall = new THREE.Group(); world.add(stall); stall.position.copy(TRADER_POS);
  meshAt(new THREE.BoxGeometry(2.2, 0.9, 0.9), M.plank, 0, 0.45, -1.1, stall);
  for (const sx of [-1.1, 1.1]) meshAt(new THREE.BoxGeometry(0.1, 2.4, 0.1), M.wood, sx, 1.2, -1.5, stall);
  const roof = meshAt(new THREE.BoxGeometry(2.6, 0.06, 1.4), mat(0x3a1a2a), 0, 2.4, -1.1, stall); roof.rotation.x = 0.25;
  addSolid(TRADER_POS.x, TRADER_POS.z - 1.1, 2.2, 0.9, 0.9);
  h.root.position.copy(TRADER_POS); h.root.rotation.y = Math.PI / 2 + 0.6; scene.add(h.root);
  const pose = { lsx: -0.9, lex: -0.9, rsx: -0.2, tx: 0.12, hx: 0.1 };
  return {
    h, light, visible: false, t: 0,
    show() { this.visible = true; h.root.visible = true; light.intensity = 5; },
    hide() { this.visible = false; h.root.visible = false; light.intensity = 0; },
    update(dt) {
      if (!this.visible) return; this.t += dt;
      const face = Math.atan2(player.pos.x - TRADER_POS.x, player.pos.z - TRADER_POS.z);
      h.root.rotation.y = dampAng(h.root.rotation.y, face, 3, dt);
      applyPose(h, { ...pose, hy: Math.sin(this.t * 0.7) * 0.2, ty: Math.sin(this.t * 0.4) * 0.08 }, dt, 4);
      light.intensity = 4.5 + Math.sin(this.t * 7) * 0.4 + Math.random() * 0.3;
    },
  };
})();
trader.hide();
const MERCHANT_LINES = {
  hello: ['「…よう、旅の人。いい品が揃ってるぜ」', '「ヘッヘッ…生きてたか。何が要る？」', '「霧の夜は商売日和でね…」'],
  buy: ['「毎度あり…」', '「いい目をしてるねぇ」', '「そいつは役に立つぜ」'],
  tune: ['「ほう、腕を上げたいか」', '「こいつはもっと化けるぜ」'],
  sell: ['「ほほう…いい値で買い取ろう」'],
  poor: ['「おっと、金が足りねえな」'],
  bye: ['「また来な…生きてりゃな」'],
};

// =====================================================================
// Director / waves
// =====================================================================
const director = { wave: 0, phase: 'title', spawned: 0, spawnT: 0, bossDead: false, boss: null, extraSpawns: 0, introT: 0 };
const stats = { kills: 0, headKills: 0, shots: 0, hits: 0, heads: 0, time: 0, deaths: 0 };
let snapshot = null;

function pickType(mix) { let r = Math.random(); for (const k in mix) { r -= mix[k]; if (r <= 0) return k; } return Object.keys(mix)[0]; }
function spawnEnemy(type) {
  const cands = SPAWNS.map(([x, z]) => ({ x, z, d: Math.hypot(x - player.pos.x, z - player.pos.z) })).filter(s => s.d > 16).sort(() => Math.random() - 0.5);
  const s = cands[0] || { x: SPAWNS[0][0], z: SPAWNS[0][1] };
  const pos = new V3(s.x + rand(-1.5, 1.5), 0, s.z + rand(-1.5, 1.5)); collide(pos, 0.4);
  const e = new Enemy(type, pos.x, pos.z, WAVES[director.wave]); enemies.push(e); return e;
}
function startWave(i, fromContinue) {
  director.wave = i; director.phase = 'intro'; director.introT = 3.5; director.spawned = 0; director.spawnT = 1.2; director.bossDead = false; director.boss = null; director.extraSpawns = 0;
  const w = WAVES[i];
  if (!fromContinue) snapshot = { inv: JSON.parse(JSON.stringify(inv)), hp: player.hp, maxHp: player.maxHp };
  trader.hide(); setAtmos(w.atmos); showBanner(w.title, w.sub); setMusic(w.boss ? 'none' : 'combat');
  $('chap').textContent = `${w.title} ― ${w.sub}`; $('tNext').classList.add('hidden');
  if (w.boss) setTimeout(() => sfx.bell(), 400);
}
function updateDirector(dt) {
  const w = WAVES[director.wave];
  const alive = enemies.filter(e => e.alive && !e.boss).length;
  music.intensity = clamp(alive / 6, 0, 1);
  if (director.phase === 'intro') {
    director.introT -= dt;
    if (director.introT <= 0) {
      director.phase = 'combat';
      if (w.boss) {
        const b = new Enemy('boss', 0, -24.0, w); b.face = 0; enemies.push(b); director.boss = b; setMusic('boss');
        $('bossBar').classList.remove('hidden');
      }
    }
  } else if (director.phase === 'combat') {
    const limit = w.boss ? (director.boss?.phase2 ? w.total : 2) : w.total;
    if (director.spawned < limit && alive < w.conc) {
      director.spawnT -= dt;
      if (director.spawnT <= 0) { spawnEnemy(pickType(w.mix)); director.spawned++; director.spawnT = rand(0.8, 2.0); }
    }
    const remaining = w.total - director.spawned + alive;
    setH('obj', w.boss ? w.obj : `${w.obj}　残り ${remaining}`);
    if (director.boss) $('bossHp').firstElementChild.style.width = `${Math.max(0, director.boss.hp / director.boss.maxHp * 100)}%`;
    const cleared = w.boss ? director.bossDead : (director.spawned >= w.total && alive === 0);
    if (cleared) {
      if (w.boss) { director.phase = 'ending'; director.introT = 4; $('bossBar').classList.add('hidden'); setMusic('rest'); showBanner('THE EXECUTIONER', '撃破'); }
      else {
        director.phase = 'rest'; const bonus = 800 + director.wave * 600; inv.gold += bonus;
        showBanner('CHAPTER CLEAR', `報酬 ${bonus.toLocaleString()} G`); sfx.cash();
        trader.show(); setMusic('rest');
        setH('obj', `商人と取引する <span class="kbd">E</span>／準備ができたら <span class="kbd">ENTER</span> で次の章へ`);
        if (isTouch) $('tNext').classList.remove('hidden');
      }
    }
  } else if (director.phase === 'ending') {
    director.introT -= dt; if (director.introT <= 0) { director.phase = 'done'; winGame(); }
  }
}
function nextWave() {
  if (director.phase !== 'rest') return;
  if (director.wave + 1 < WAVES.length) startWave(director.wave + 1);
}

// =====================================================================
// Player actions
// =====================================================================
function camForward(out) { return out.set(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch)); }
function hurtPlayer(dmg, from, force) {
  if (player.dead || (!force && (player.invuln > 0 || player.state === 'kick' || player.dodgeT > 0))) return false;
  if (inv.vest) dmg *= 0.7;
  player.hp -= dmg; player.invuln = force ? 0.1 : 0.55; player.hurtT = 0.3; ui.dmg = 1; shake(0.25, 0.35); sfx.hurt();
  fxBlood(player.pos.clone().setY(1.3), player.pos.clone().sub(from || player.pos).setY(0).normalize(), 12);
  if (player.reloadT > 0 && dmg > 20) { player.reloadT = 0; }
  if (player.hp <= 0) { player.hp = 0; killPlayer(); }
  return true;
}
function knockPlayer(from, power) {
  const d = _a.subVectors(player.pos, from).setY(0); if (d.lengthSq() < 1e-4) d.set(0, 0, 1); d.normalize();
  player.vel.addScaledVector(d, power); player.state = 'stumble'; player.stateT = 0;
}
function killPlayer() {
  player.dead = true; player.state = 'dead'; player.stateT = 0; releaseGrab(); stats.deaths++; setMusic('none');
  setTimeout(() => { if (player.dead) { game.state = 'dead'; document.exitPointerLock?.(); $('dead').classList.remove('hidden'); } }, 2600);
}
function startGrab(e) {
  player.grabbedBy = e; player.mash = 0; player.grabT = 0; e.setState('grabbing'); player.reloadT = 0;
  showQTE('SPACE', '連打して振りほどけ！'); sfx.voice(e.pos, 1, true);
}
function releaseGrab(escaped) {
  const e = player.grabbedBy; player.grabbedBy = null; hideQTE(); player.invuln = 0.9;
  if (e && e.alive) { if (escaped) { e.setState('stagger'); e.staggerKind = 'head'; e.stDur = 1.6; const d = _a.subVectors(e.pos, player.pos).setY(0).normalize(); e.pos.addScaledVector(d, 0.6); } else e.setState('recover'); }
}
function kickTarget() {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw); let best = null, bd = 1e9;
  for (const e of enemies) {
    if (!e.alive || !e.kickable) continue;
    const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z, d = Math.hypot(dx, dz);
    const reach = e.boss ? 3.6 : 2.5;
    if (d < reach && (dx * fx + dz * fz) / (d || 1) > 0.25 && d < bd) { bd = d; best = e; }
  }
  return best;
}
function doKick() {
  if (player.state !== 'normal' || player.grabbedBy || player.dead) return;
  const tgt = kickTarget(); if (!tgt) return;
  player.state = 'kick'; player.stateT = 0; player.kickHit = false; player.reloadT = 0;
  sfx.kick();
}
function applyKick() {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  let n = 0;
  for (const e of enemies) {
    if (!e.alive) continue;
    const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z, d = Math.hypot(dx, dz);
    if (d < (e.boss ? 3.8 : 2.9) && (dx * fx + dz * fz) / (d || 1) > -0.1) {
      const dir = _a.set(dx / (d || 1), 0.3, dz / (d || 1));
      if (e.boss) { if (e.kickable) { e.hp -= 110; e.setState('kicked'); fxBlood(e.hb.neck, dir, 20, 1.5); shake(0.35, 0.4); if (e.hp <= 0) e.die(false, dir, 'kick'); n++; } continue; }
      e.hp -= 22; fxBlood(e.hb.neck, dir, 8);
      if (e.hp <= 0) e.die(false, dir, 'kick'); else { e.knockdown(); e.vel.set(dx / (d || 1) * 7, 0, dz / (d || 1) * 7); }
      n++;
    }
  }
  if (n) { shake(0.3, 0.3); sfx.hit(player.pos); }
}
function doKnife() {
  if (player.state !== 'normal' || player.grabbedBy || player.dead) return;
  player.state = 'knife'; player.stateT = 0; player.knifeHit = false; sfx.swish();
}
function applyKnife() {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  for (const e of enemies) {
    if (!e.alive) continue;
    const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z, d = Math.hypot(dx, dz);
    if (d < (e.boss ? 2.6 : 1.8) && (dx * fx + dz * fz) / (d || 1) > 0.45) {
      const dmg = e.state === 'down' ? 16 : 8; e.damage(dmg, e.state === 'down' ? 'head' : 'body', _a.set(fx, 0, fz), 'knife');
      if (e.alive && !e.boss && e.state !== 'down' && e.state !== 'stagger') { e.setState('flinch'); }
      return;
    }
  }
  for (const c of crates) if (c.alive && Math.hypot(c.pos.x - player.pos.x, c.pos.z - player.pos.z) < 1.9) { breakCrate(c); return; }
  for (const b of barrels) if (b.alive && Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z) < 1.6) { sfx.ping(); return; }
}
function heal() {
  if (player.hp >= player.maxHp) { showLog('体力は満タンだ'); return; }
  if (inv.herbGR > 0) { inv.herbGR--; player.maxHp = Math.min(150, player.maxHp + 10); player.hp = player.maxHp; showLog('調合ハーブを使った（全回復＋最大体力アップ）'); }
  else if (inv.herbG > 0) { inv.herbG--; player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.4); showLog('グリーンハーブを使った'); }
  else { showLog('回復アイテムがない'); return; }
  sfx.heal(); for (let i = 0; i < 20; i++) particlesA.add(player.pos.x + rand(-.5, .5), rand(0.2, 1.8), player.pos.z + rand(-.5, .5), 0, rand(0.4, 1.2), 0, rand(0.6, 1.2), 0.08, 0.02, 0.3, 1, 0.4, 0.8, 0, 0, false);
}
function mixHerbs() {
  if (inv.herbG > 0 && inv.herbR > 0) { inv.herbG--; inv.herbR--; inv.herbGR++; sfx.pickup(); showLog('ハーブを調合した（G+R）'); return true; }
  showLog('グリーンとレッドが1つずつ必要だ'); return false;
}
function startReload() {
  const id = player.weapon, w = W(id);
  if (player.reloadT > 0 || inv.mag[id] >= w.c || inv.ammo[id] <= 0 || player.state === 'kick' || player.grabbedBy) return;
  player.reloadT = player.reloadMax = w.r; sfx.reload(w.r);
}
function finishReload() {
  const id = player.weapon, w = W(id); const need = w.c - inv.mag[id], take = Math.min(need, inv.ammo[id]);
  inv.mag[id] += take; inv.ammo[id] -= take;
}
function switchWeapon(id) {
  if (!inv.owned[id] || player.weapon === id || player.state !== 'normal') return;
  player.weapon = id; player.reloadT = 0; player.fireT = 0.35;
  for (const k in guns) guns[k].visible = k === id; sfx.click();
}
function cycleWeapon(dir) { const ids = ['hg', 'sg', 'rf'].filter(k => inv.owned[k]); const i = ids.indexOf(player.weapon); switchWeapon(ids[(i + dir + ids.length) % ids.length]); }

// raycast through the world: returns {t, type, enemy, part, barrel, crate, proj}
const _ro = new V3(), _rd = new V3();
function raycastWorld(o, d, maxT, minT = 0) {
  let best = { t: maxT, type: null };
  if (d.y < -1e-4) { const t = -o.y / d.y; if (t > minT && t < best.t) best = { t, type: 'ground' }; }
  for (const s of solids) {
    if (!s.alive) continue; const t = rayAABB(o, d, s);
    if (t > minT && t < best.t) best = { t, type: s.kind === 'crate' ? 'crate' : s.kind === 'barrel' ? 'barrel' : 'solid', solid: s };
  }
  if (best.type === 'crate') best.crate = crates.find(c => c.solid === best.solid);
  if (best.type === 'barrel') best.barrel = barrels.find(b => b.solid === best.solid);
  for (const p of projectiles) { if (!p.alive || p.kind !== 'axe') continue; const t = raySphere(o, d, p.pos, 0.35); if (t > minT && t < best.t) best = { t, type: 'proj', proj: p }; }
  for (const e of enemies) {
    if (!e.alive) continue;
    _p.subVectors(e.hb.hips, o); const along = _p.dot(d); if (along < 0) continue;
    if (_p.lengthSq() - along * along > 9 * e.scale * e.scale) continue;
    const sc = e.scale;
    let t = raySphere(o, d, e.hb.head, (e.isParasite ? 0.2 : e.boss ? 0.2 : 0.17) * sc);
    if (t > minT && t < best.t) best = { t, type: 'enemy', enemy: e, part: 'head' };
    if (e.boss) { t = raySphere(o, d, e.hb.core, 0.16 * sc); if (t > minT && t < best.t) best = { t, type: 'enemy', enemy: e, part: 'core' }; }
    t = rayCapsule(o, d, e.hb.hips, e.hb.neck, 0.25 * sc * (e.t.bulk || 1));
    if (t > minT && t < best.t) best = { t, type: 'enemy', enemy: e, part: 'body' };
    t = rayCapsule(o, d, e.hb.feet, e.hb.hips, 0.2 * sc * (e.t.bulk || 1));
    if (t > minT && t < best.t) best = { t, type: 'enemy', enemy: e, part: 'legs' };
  }
  best.point = o.clone().addScaledVector(d, best.t);
  return best;
}

const muzzleWorld = new V3();
function shoot() {
  const id = player.weapon, w = W(id);
  if (inv.mag[id] <= 0) { sfx.click(); player.fireT = 0.3; if (inv.ammo[id] > 0) startReload(); else showLog('弾がない！'); return; }
  inv.mag[id]--; player.fireT = w.rate; stats.shots++;
  guns[id].userData.muzzle.getWorldPosition(muzzleWorld);
  const base = aimDir(_rd);
  const camPos = camera.position.clone();
  const minT = camPos.distanceTo(_a.copy(player.pos).setY(1.5)) * 0.85;
  let hitAny = false; const hitEnemies = new Set();
  for (let i = 0; i < w.pellets; i++) {
    const d = base.clone();
    if (w.spread) { d.x += rand(-w.spread, w.spread); d.y += rand(-w.spread, w.spread) * 0.7; d.z += rand(-w.spread, w.spread); d.normalize(); }
    const hit = raycastWorld(camPos, d, w.range, minT);
    let dmg = w.d;
    if (id === 'sg') dmg *= clamp(1.25 - hit.t / w.range, 0.25, 1.1);
    if (hit.type === 'enemy') {
      hitAny = true; hitEnemies.add(hit.enemy);
      if (hit.part === 'head') stats.heads++;
      hit.enemy.damage(dmg, hit.part, d, id);
    } else if (hit.type === 'barrel') { blowBarrel(hit.barrel); }
    else if (hit.type === 'crate') { breakCrate(hit.crate); }
    else if (hit.type === 'proj') { hit.proj.alive = false; scene.remove(hit.proj.mesh); fxSparks(hit.point, 12); sfx.ping(); showLog('斧を撃ち落とした！'); }
    else if (hit.type) { if (hit.type === 'ground') fxDust(hit.point, 4); else fxSparks(hit.point, id === 'sg' ? 3 : 6); }
  }
  if (hitAny) stats.hits++;
  // rifle penetrates? no — keep it simple. recoil + effects
  player.recoil += w.recoil; shake(id === 'hg' ? 0.05 : 0.18, 0.12);
  fxMuzzle(muzzleWorld, base, id !== 'hg'); muzzleLight.position.copy(muzzleWorld); muzzleLight.intensity = id === 'hg' ? 8 : 14;
  sfx.gun(id);
  for (const e of enemies) if (e.alive && e.pos.distanceTo(player.pos) < 30) e.alerted = true;
  if (inv.mag[id] === 0 && inv.ammo[id] > 0) setTimeout(() => { if (player.state === 'normal' && !player.dead) startReload(); }, 250);
}
function aimDir(out) {
  camera.getWorldDirection(out); return out;
}

// =====================================================================
// Input
// =====================================================================
const keys = {};
const input = { aim: false, fire: false, mx: 0, my: 0, lookX: 0, lookY: 0, run: false, aimToggle: false };
let sens = 1;
let locked = false;
const game = { state: 'title' };

addEventListener('keydown', e => {
  if (e.code === 'Tab') e.preventDefault();
  if (game.state === 'case') { if (e.code === 'Tab' || e.code === 'Escape') closeCase(); return; }
  if (game.state === 'shop') { if (e.code === 'KeyE' || e.code === 'Escape') closeShop(); return; }
  if (game.state !== 'play') return;
  if (keys[e.code]) return; keys[e.code] = true;
  switch (e.code) {
    case 'KeyR': startReload(); break;
    case 'KeyF': doKick(); break;
    case 'KeyV': doKnife(); break;
    case 'KeyH': heal(); break;
    case 'KeyG': if (player.state === 'normal' && !player.grabbedBy) throwGrenade(); break;
    case 'KeyQ': quickTurn(); break;
    case 'Digit1': switchWeapon('hg'); break;
    case 'Digit2': switchWeapon('sg'); break;
    case 'Digit3': switchWeapon('rf'); break;
    case 'KeyE': interact(); break;
    case 'Enter': nextWave(); break;
    case 'Tab': openCase(); break;
    case 'Space': spacePressed(); break;
  }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; input.aim = input.fire = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('contextmenu', e => { if (game.state === 'play') e.preventDefault(); });
canvas.addEventListener('mousedown', e => {
  if (game.state !== 'play') return;
  if (!locked && !isTouch) { canvas.requestPointerLock?.(); return; }
  if (e.button === 2) input.aim = true;
  if (e.button === 0) { input.fire = true; if (!input.aim) doKnife(); }
});
addEventListener('mouseup', e => { if (e.button === 2) input.aim = false; if (e.button === 0) input.fire = false; });
addEventListener('mousemove', e => {
  if (!locked || game.state !== 'play') return;
  const k = 0.0022 * sens * (player.aiming ? (player.weapon === 'rf' ? 0.3 : 0.6) : 1);
  player.yaw -= e.movementX * k; player.pitch = clamp(player.pitch - e.movementY * k, -1.0, 0.85);
});
addEventListener('wheel', e => { if (game.state === 'play') cycleWeapon(e.deltaY > 0 ? 1 : -1); }, { passive: true });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked && game.state === 'play' && !isTouch) pauseGame();
});

function quickTurn() { if (player.state !== 'normal' || player.aiming || player.grabbedBy) return; player.turnT = 0.28; player.turnFrom = player.yaw; }
function interact() {
  if (trader.visible && player.pos.distanceTo(TRADER_POS) < 3.2) openShop();
}
function spacePressed() {
  if (player.grabbedBy) { player.mash++; shake(0.06, 0.1); return; }
  if (qte.dodgeOpen && player.dodgeT <= 0) {
    const b = director.boss; if (!b) return;
    const rel = _a.subVectors(player.pos, b.pos); const side = Math.sign(rel.x * b.chargeDir.z - rel.z * b.chargeDir.x) || 1;
    player.dodgeDir.set(b.chargeDir.z * side, 0, -b.chargeDir.x * side); player.dodgeT = 0.55; player.invuln = 0.6; sfx.swish(); hideQTE(); qte.dodgeOpen = false;
    stats.dodges = (stats.dodges || 0) + 1;
  }
}

// ---- touch controls ----
if (isTouch) {
  const stick = $('stick'), knob = $('stickKnob'); let sid = null, sx = 0, sy = 0; let lid = null, lx = 0, ly = 0;
  stick.addEventListener('touchstart', e => { const t = e.changedTouches[0]; sid = t.identifier; const r = stick.getBoundingClientRect(); sx = r.left + r.width / 2; sy = r.top + r.height / 2; e.preventDefault(); }, { passive: false });
  const lz = $('lookZone');
  lz.addEventListener('touchstart', e => { const t = e.changedTouches[0]; lid = t.identifier; lx = t.clientX; ly = t.clientY; e.preventDefault(); }, { passive: false });
  addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === sid) {
        let dx = (t.clientX - sx) / 55, dy = (t.clientY - sy) / 55; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
        input.mx = dx; input.my = -dy; input.run = l > 1.25; knob.style.transform = `translate(${dx * 38}px,${dy * 38}px)`;
      } else if (t.identifier === lid) {
        const k = 0.006 * sens * (player.aiming ? 0.5 : 1);
        player.yaw -= (t.clientX - lx) * k; player.pitch = clamp(player.pitch - (t.clientY - ly) * k, -1, 0.85); lx = t.clientX; ly = t.clientY;
      }
    }
  }, { passive: false });
  addEventListener('touchend', e => { for (const t of e.changedTouches) { if (t.identifier === sid) { sid = null; input.mx = input.my = 0; input.run = false; knob.style.transform = ''; } if (t.identifier === lid) lid = null; } });
  const btn = (id, down, up) => { const b = $(id); b.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); down(b); }, { passive: false }); if (up) b.addEventListener('touchend', e => { e.preventDefault(); up(b); }); };
  btn('tAim', b => { input.aim = !input.aim; b.classList.toggle('on', input.aim); });
  btn('tFire', () => { input.fire = true; if (!input.aim) doKnife(); }, () => { input.fire = false; });
  btn('tAct', () => { if (player.grabbedBy || qte.dodgeOpen) spacePressed(); else if (trader.visible && player.pos.distanceTo(TRADER_POS) < 3.2) interact(); else doKick(); });
  btn('tReload', () => startReload()); btn('tKnife', () => doKnife()); btn('tHeal', () => heal());
  btn('tWeap', () => cycleWeapon(1)); btn('tGren', () => throwGrenade()); btn('tTurn', () => quickTurn());
  btn('tCase', () => openCase()); btn('tNext', () => nextWave());
}

// =====================================================================
// UI helpers
// =====================================================================
const ui = { dmg: 0, bannerT: 0, prompt: '', logN: 0, ecg: [], ecgT: 0 };
function showBanner(a, b) { $('bannerA').textContent = a; $('bannerB').textContent = b; $('banner').style.opacity = 1; ui.bannerT = 3.2; }
function showLog(text) {
  const d = document.createElement('div'); d.textContent = text; $('log').appendChild(d);
  setTimeout(() => d.style.opacity = 0, 3200); setTimeout(() => d.remove(), 3900);
  while ($('log').children.length > 6) $('log').firstChild.remove();
}
let subT = 0;
function showSubtitle(t) { if (subT > 0) return; subT = 4; showLog('村人' + t); }
const qte = { dodgeOpen: false, shown: false };
function showQTE(key, text) { $('qteKey').textContent = isTouch ? 'タップ' : key; $('qteText').textContent = text; $('qte').classList.remove('hidden'); qte.shown = true; }
function hideQTE() { $('qte').classList.add('hidden'); qte.shown = false; }
let shakeAmp = 0, shakeT = 0;
function shake(a, t) { shakeAmp = Math.max(shakeAmp, a); shakeT = Math.max(shakeT, t); }

const ecgCtx = $('ecg').getContext('2d');
function drawECG(dt) {
  const r = player.hp / player.maxHp;
  const col = r > 0.6 ? '#4ad15a' : r > 0.3 ? '#e8c040' : '#ff3a2a';
  const label = r > 0.6 ? 'FINE' : r > 0.3 ? 'CAUTION' : 'DANGER';
  $('lifeState').textContent = player.dead ? 'DEAD' : label; $('lifeState').style.color = col;
  const bar = $('lifeBar').firstElementChild; bar.style.width = `${r * 100}%`; bar.style.background = col;
  const bpm = r > 0.6 ? 70 : r > 0.3 ? 100 : 135;
  ui.ecgT += dt * bpm / 60;
  const CW = 340, H = 80; const seg = ui.ecg; const beat = ui.ecgT % 1;
  let y = 0;
  if (beat > 0.1 && beat < 0.14) y = -0.15; else if (beat > 0.16 && beat < 0.19) y = 0.85; else if (beat > 0.19 && beat < 0.23) y = -0.45; else if (beat > 0.35 && beat < 0.45) y = 0.12;
  if (player.dead) y = 0;
  seg.push(y * (r > 0.3 ? 1 : 0.8) + (Math.random() - 0.5) * 0.03); while (seg.length > 120) seg.shift();
  ecgCtx.clearRect(0, 0, CW, H); ecgCtx.strokeStyle = 'rgba(255,255,255,.07)'; ecgCtx.lineWidth = 1;
  for (let x = 0; x < CW; x += 20) { ecgCtx.beginPath(); ecgCtx.moveTo(x, 0); ecgCtx.lineTo(x, H); ecgCtx.stroke(); }
  ecgCtx.strokeStyle = col; ecgCtx.lineWidth = 3; ecgCtx.shadowColor = col; ecgCtx.shadowBlur = 8; ecgCtx.beginPath();
  seg.forEach((v, i) => { const x = i / 119 * CW, yy = H / 2 - v * H * 0.45; i ? ecgCtx.lineTo(x, yy) : ecgCtx.moveTo(x, yy); }); ecgCtx.stroke(); ecgCtx.shadowBlur = 0;
}
const htmlCache = {};
function setH(id, html) { if (htmlCache[id] !== html) { htmlCache[id] = html; $(id).innerHTML = html; } }
function updateHUD(dt) {
  const id = player.weapon, w = W(id);
  setH('wname', w.name);
  setH('ammo', `${inv.mag[id]} <small>/ ${inv.ammo[id]}</small>`);
  $('reloadBar').firstElementChild.style.width = player.reloadT > 0 ? `${(1 - player.reloadT / player.reloadMax) * 100}%` : '0%';
  setH('gold', `${inv.gold.toLocaleString()} G`);
  setH('items',  `<span>ハーブ <b>${inv.herbG}</b>${inv.herbR ? `+赤<b>${inv.herbR}</b>` : ''}${inv.herbGR ? ` 調合<b>${inv.herbGR}</b>` : ''}</span><span>手榴弾 <b>${inv.gren}</b></span>`);
  drawECG(dt);
  ui.dmg = Math.max(0, ui.dmg - dt * 2); $('dmg').style.opacity = ui.dmg;
  const r = player.hp / player.maxHp; $('lowhp').style.opacity = r < 0.3 && !player.dead ? 0.5 + Math.sin(performance.now() / 300) * 0.3 : 0;
  $('hint').style.opacity = stats.time > 30 ? 0 : 1;
  if (ui.bannerT > 0) { ui.bannerT -= dt; if (ui.bannerT <= 0) $('banner').style.opacity = 0; }
  subT -= dt;
  // prompt
  let pr = '';
  if (!player.dead && !player.grabbedBy) {
    if (kickTarget() && player.state === 'normal') pr = `<kbd>${isTouch ? '蹴り' : 'F'}</kbd>回し蹴り`;
    else if (trader.visible && player.pos.distanceTo(TRADER_POS) < 3.2) pr = `<kbd>${isTouch ? 'E' : 'E'}</kbd>商人と取引`;
    else if (inv.mag[id] === 0 && inv.ammo[id] > 0 && player.reloadT <= 0) pr = `<kbd>R</kbd>リロード`;
  }
  if (pr !== ui.prompt) { ui.prompt = pr; $('prompt').innerHTML = pr; $('prompt').classList.toggle('hidden', !pr); }
  // grab / dodge QTE
  if (player.grabbedBy) { $('qteBar').firstElementChild.style.width = `${clamp(player.mash / 8, 0, 1) * 100}%`; }
  else if (qte.dodgeOpen && !qte.shown) { showQTE('SPACE', '回避！'); $('qteBar').firstElementChild.style.width = '0%'; }
  else if (!qte.dodgeOpen && qte.shown) hideQTE();
  const scoped = player.weapon === 'rf' && player.aim > 0.9;
  $('scope').classList.toggle('hidden', !scoped);
}

// =====================================================================
// Case / shop / screens
// =====================================================================
function caseItems() {
  const it = [];
  if (inv.owned.hg) it.push({ w: 3, h: 2, c: '#3a3a40', n: 'ウォーデン9', s: `${inv.mag.hg}/${W('hg').c}` });
  if (inv.owned.sg) it.push({ w: 6, h: 2, c: '#4a3424', ico: '', n: 'ブルドッグ', s: `${inv.mag.sg}/${W('sg').c}` });
  if (inv.owned.rf) it.push({ w: 8, h: 2, c: '#2e3a3e', ico: '', n: 'ロングアイ', s: `${inv.mag.rf}/${W('rf').c}` });
  for (const k of ['hg', 'sg', 'rf']) if (inv.ammo[k] > 0) it.push({ w: 2, h: 1, c: '#5a4a2a', n: { hg: '9mm弾', sg: 'シェル', rf: '.30弾' }[k], s: `×${inv.ammo[k]}` });
  for (let i = 0; i < inv.herbG; i++) it.push({ w: 1, h: 2, c: '#2a5a2a', ico: '🌿', n: '緑', use: 'heal' });
  for (let i = 0; i < inv.herbR; i++) it.push({ w: 1, h: 2, c: '#6a2020', ico: '🌿', n: '赤', use: 'mix' });
  for (let i = 0; i < inv.herbGR; i++) it.push({ w: 1, h: 2, c: '#5a4a1a', ico: '🌿', n: 'G+R', use: 'heal' });
  for (let i = 0; i < inv.gren; i++) it.push({ w: 1, h: 2, c: '#3a4a2a', ico: '💣', n: '手榴弾' });
  for (const t of inv.treasures) it.push({ w: 2, h: 2, c: '#4a2a4a', ico: '💎', n: TREASURES[t][0], s: `${TREASURES[t][1]}G` });
  if (inv.vest) it.push({ w: 3, h: 3, c: '#2a2a22', ico: '🦺', n: '防弾ベスト' });
  return it;
}
function renderCase() {
  const cols = 12, rows = 8; const grid = $('caseGrid'); const cell = Math.min(52, Math.floor((Math.min(innerWidth, 980) - 64) / cols));
  grid.style.width = `${cols * cell + 12}px`; grid.style.height = `${rows * cell + 12}px`; grid.style.backgroundSize = `${cell}px ${cell}px`;
  grid.innerHTML = '';
  const occ = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const fits = (x, y, w, h) => { if (x + w > cols || y + h > rows) return false; for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (occ[j][i]) return false; return true; };
  for (const it of caseItems()) {
    let placed = false;
    for (let y = 0; y < rows && !placed; y++) for (let x = 0; x < cols && !placed; x++) if (fits(x, y, it.w, it.h)) {
      for (let j = y; j < y + it.h; j++) for (let i = x; i < x + it.w; i++) occ[j][i] = true; placed = true;
      const d = document.createElement('div'); d.className = 'citem' + (it.use ? ' use' : '');
      Object.assign(d.style, { left: `${x * cell}px`, top: `${y * cell}px`, width: `${it.w * cell - 2}px`, height: `${it.h * cell - 2}px`, background: `linear-gradient(160deg, ${it.c}, #120c0a)` });
      d.innerHTML = `${it.ico ? `<span class="ico">${it.ico}</span>` : ''}<b>${it.n}</b>${it.s ? `<span>${it.s}</span>` : ''}`;
      if (it.use === 'heal') d.onclick = () => { heal(); renderCase(); };
      if (it.use === 'mix') d.onclick = () => { mixHerbs(); renderCase(); };
      grid.appendChild(d);
    }
  }
  $('caseGold').textContent = `${inv.gold.toLocaleString()} G`;
  const lvTxt = k => { const l = inv.lv[k]; return `威力${'●'.repeat(l.pow)}${'○'.repeat(4 - l.pow)} 装弾${'●'.repeat(l.cap)}${'○'.repeat(4 - l.cap)} 装填${'●'.repeat(l.rel)}${'○'.repeat(4 - l.rel)}`; };
  $('caseInfo').innerHTML = `LIFE ${Math.ceil(player.hp)} / ${player.maxHp}${inv.vest ? '　防弾ベスト着用' : ''}<br>` +
    ['hg', 'sg', 'rf'].filter(k => inv.owned[k]).map(k => `${WEAP[k].name}<br><span class="lvdots">${lvTxt(k)}</span>`).join('<br>') +
    `<br><span style="color:var(--dim)">撃破 ${stats.kills}　ヘッドショット ${stats.heads}</span>`;
}
function openCase() {
  if (game.state !== 'play' || player.dead) return;
  game.state = 'case'; document.exitPointerLock?.(); renderCase(); $('case').classList.remove('hidden');
}
function closeCase() { $('case').classList.add('hidden'); resumeGame(); }
$('caseClose').onclick = closeCase;
$('mixBtn').onclick = () => { mixHerbs(); renderCase(); };
$('useBtn').onclick = () => { heal(); renderCase(); };

let shopTab = 'buy';
function merchantSay(kind) { $('merchantLine').textContent = pick(MERCHANT_LINES[kind]); }
const SHOP_ITEMS = [
  { id: 'sg', name: 'ショットガン「ブルドッグ」', price: 2500, desc: '近距離で絶大な威力。群れをまとめて吹き飛ばす。寄生体に有効。', ok: () => !inv.owned.sg, buy() { inv.owned.sg = true; inv.mag.sg = W('sg').c; } },
  { id: 'rf', name: 'ライフル「ロングアイ」', price: 4500, desc: 'スコープ付きボルトアクション。遠くの頭を確実に撃ち抜く。', ok: () => !inv.owned.rf, buy() { inv.owned.rf = true; inv.mag.rf = W('rf').c; } },
  { id: 'ahg', name: 'ハンドガンの弾 ×15', price: 450, desc: '9mm弾。', ok: () => true, buy() { inv.ammo.hg += 15; } },
  { id: 'asg', name: 'ショットシェル ×8', price: 750, desc: '12ゲージ。', ok: () => inv.owned.sg, buy() { inv.ammo.sg += 8; } },
  { id: 'arf', name: 'ライフル弾 ×5', price: 850, desc: '.30口径。', ok: () => inv.owned.rf, buy() { inv.ammo.rf += 5; } },
  { id: 'hgr', name: 'グリーンハーブ', price: 500, desc: '体力を40%回復する。', ok: () => true, buy() { inv.herbG++; } },
  { id: 'hrd', name: 'レッドハーブ', price: 900, desc: 'グリーンと調合すると全回復＋最大体力アップ。', ok: () => true, buy() { inv.herbR++; } },
  { id: 'grn', name: '手榴弾', price: 1000, desc: '投げて爆破。群れと処刑人に有効。', ok: () => true, buy() { inv.gren++; } },
  { id: 'vst', name: '防弾ベスト', price: 5000, desc: '受けるダメージを30%軽減する。', ok: () => !inv.vest, buy() { inv.vest = true; } },
];
function renderShop() {
  $('shopGold').textContent = `${inv.gold.toLocaleString()} G`;
  const list = $('shopList'); list.innerHTML = '';
  const card = (nm, ds, price, can, onBuy, label = '買う') => {
    const d = document.createElement('div'); d.className = 'sitem';
    d.innerHTML = `<div class="nm">${nm}</div><div class="ds">${ds}</div><div class="row"><span class="pr">${price != null ? price.toLocaleString() + ' G' : ''}</span></div>`;
    const b = document.createElement('button'); b.className = 'btn small'; b.textContent = label; b.disabled = !can;
    b.onclick = () => { if (price != null && inv.gold < price) { merchantSay('poor'); return; } onBuy(); sfx.cash(); renderShop(); };
    d.querySelector('.row').appendChild(b); list.appendChild(d);
  };
  if (shopTab === 'buy') {
    for (const it of SHOP_ITEMS) if (it.ok()) card(it.name, it.desc, it.price, inv.gold >= it.price, () => { inv.gold -= it.price; it.buy(); merchantSay('buy'); });
  } else if (shopTab === 'tune') {
    const names = { pow: '威力', cap: '装弾数', rel: 'リロード速度' };
    for (const k of ['hg', 'sg', 'rf']) {
      if (!inv.owned[k]) continue;
      for (const s of ['pow', 'cap', 'rel']) {
        const lv = inv.lv[k][s]; const maxed = lv >= 4; const price = maxed ? null : WEAP[k].up * (lv + 1);
        const cur = s === 'pow' ? WEAP[k].dmg : s === 'cap' ? WEAP[k].cap : WEAP[k].rel;
        const ds = `<span class="lvdots">${'●'.repeat(lv)}${'○'.repeat(4 - lv)}</span>　${cur[lv]}${maxed ? '' : ` → ${cur[lv + 1]}`}${s === 'rel' ? '秒' : ''}`;
        card(`${WEAP[k].name.split('「')[1]?.replace('」', '') || k}：${names[s]}`, ds, price, !maxed && inv.gold >= price, () => {
          inv.gold -= price; inv.lv[k][s]++; if (s === 'cap') inv.mag[k] = Math.min(inv.mag[k], W(k).c); merchantSay('tune');
        }, maxed ? 'MAX' : '改造');
      }
    }
  } else {
    if (!inv.treasures.length) list.innerHTML = '<div style="color:var(--dim)">売れる宝物がない。巨漢の村人や木箱から見つかることがある。</div>';
    inv.treasures.forEach((t, i) => card(TREASURES[t][0], '換金用の宝物。', TREASURES[t][1], true, () => { inv.gold += TREASURES[t][1]; inv.treasures.splice(i, 1); merchantSay('sell'); }, '売る'));
  }
}
document.querySelectorAll('.tab').forEach(t => t.onclick = () => { shopTab = t.dataset.tab; document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t)); renderShop(); });
function openShop() { game.state = 'shop'; document.exitPointerLock?.(); merchantSay('hello'); renderShop(); $('shop').classList.remove('hidden'); }
function closeShop() { merchantSay('bye'); $('shop').classList.add('hidden'); resumeGame(); }
$('shopClose').onclick = closeShop;

function pauseGame() { if (game.state !== 'play') return; game.state = 'pause'; $('pause').classList.remove('hidden'); input.aim = input.fire = false; for (const k in keys) keys[k] = false; }
function resumeGame() {
  game.state = 'play'; $('pause').classList.add('hidden'); input.aim = false; input.fire = false; for (const k in keys) keys[k] = false;
  if (!isTouch) canvas.requestPointerLock?.();
  last = performance.now();
}
$('resumeBtn').onclick = resumeGame;
$('sens').oninput = e => { sens = +e.target.value; };
$('pause').addEventListener('click', e => { if (e.target.id === 'pause') resumeGame(); });

function resetWorldForWave() {
  for (const e of enemies) scene.remove(e.h.root); enemies.length = 0;
  for (const p of projectiles) scene.remove(p.mesh); projectiles.length = 0;
  for (const p of pickups) scene.remove(p.g); pickups.length = 0;
  particlesA.clear(); particlesN.clear(); hideSlam(); hideQTE(); qte.dodgeOpen = false;
  player.pos.copy(START_POS); player.vel.set(0, 0, 0); player.yaw = 0; player.pitch = -0.08; player.state = 'normal'; player.dead = false;
  player.grabbedBy = null; player.reloadT = 0; player.invuln = 1; player.dodgeT = 0; ph.root.rotation.x = 0;
  $('bossBar').classList.add('hidden');
}
function startGame() {
  initAudio();
  inv = newInventory(); Object.assign(stats, { kills: 0, headKills: 0, shots: 0, hits: 0, heads: 0, time: 0, deaths: 0, dodges: 0 });
  player.hp = player.maxHp = 100; player.weapon = 'hg'; for (const k in guns) guns[k].visible = k === 'hg';
  for (const b of barrels) { b.alive = true; b.solid.alive = true; b.mesh.visible = b.band.visible = true; b.fuse = -1; }
  for (const c of crates) { c.alive = true; c.solid.alive = true; c.mesh.visible = true; }
  navBuild(); resetWorldForWave();
  ['title', 'dead', 'win'].forEach(id => $(id).classList.add('hidden'));
  $('hud').classList.remove('hidden'); if (isTouch) $('touch').classList.remove('hidden');
  game.state = 'play'; if (!isTouch) canvas.requestPointerLock?.();
  startWave(0);
}
function continueGame() {
  initAudio();
  inv = JSON.parse(JSON.stringify(snapshot.inv)); player.maxHp = snapshot.maxHp; player.hp = Math.max(snapshot.hp, player.maxHp * 0.5);
  if (!inv.owned[player.weapon]) player.weapon = 'hg'; for (const k in guns) guns[k].visible = k === player.weapon;
  resetWorldForWave(); $('dead').classList.add('hidden');
  game.state = 'play'; if (!isTouch) canvas.requestPointerLock?.();
  startWave(director.wave, true);
}
function winGame() {
  game.state = 'win'; document.exitPointerLock?.();
  const acc = stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0;
  const mins = Math.floor(stats.time / 60), secs = Math.floor(stats.time % 60);
  let score = 0; score += acc >= 70 ? 3 : acc >= 50 ? 2 : 1; score += stats.time < 900 ? 3 : stats.time < 1300 ? 2 : 1; score += stats.deaths === 0 ? 3 : stats.deaths < 3 ? 2 : 0;
  const rank = score >= 8 ? 'S' : score >= 6 ? 'A' : score >= 4 ? 'B' : 'C';
  $('winStats').innerHTML = `<div id="rank">${rank}</div>クリアタイム ${mins}分${String(secs).padStart(2, '0')}秒<br>撃破数 ${stats.kills}　命中率 ${acc}%　ヘッドショット ${stats.heads}<br>コンティニュー ${stats.deaths}回<br><span style="color:var(--dim);font-size:14px">霧は晴れ、村に朝が来た。だが、調査団の行方は――</span>`;
  $('win').classList.remove('hidden'); $('hud').classList.add('hidden'); $('touch').classList.add('hidden');
}
$('startBtn').onclick = startGame;
$('contBtn').onclick = continueGame;
$('againBtn').onclick = () => { $('win').classList.add('hidden'); startGame(); };

// =====================================================================
// Player update + camera
// =====================================================================
function updatePlayer(dt) {
  const p = player, id = p.weapon, w = W(id);
  p.fireT -= dt; p.invuln -= dt; p.hurtT -= dt; p.stateT += dt;
  p.recoil = damp(p.recoil, 0, 10, dt);
  if (p.dead) { applyPose(ph, { rx: -Math.PI / 2, lsx: -2.8, rsx: -2.6, lhx: -0.2, py: -0.05 }, dt, 6); ph.root.position.copy(p.pos); return; }
  // reload
  if (p.reloadT > 0) { p.reloadT -= dt; if (p.reloadT <= 0) finishReload(); }
  // grabbed
  if (p.grabbedBy) {
    p.grabT += dt; if (p.grabT % 1 < dt) hurtPlayer(5, p.pos, true);
    if (p.mash >= 8) { releaseGrab(true); showLog('振りほどいた！ 蹴りで反撃だ'); }
    else if (p.grabT > 3) { hurtPlayer(22, p.grabbedBy.pos, true); sfx.splat(p.pos); releaseGrab(false); }
  }
  // quick turn
  if (p.turnT > 0) { p.turnT -= dt; const t = 1 - Math.max(0, p.turnT) / 0.28; p.yaw = p.turnFrom + Math.PI * (t * t * (3 - 2 * t)); }
  // aim
  const canAim = p.state === 'normal' && !p.grabbedBy && p.dodgeT <= 0;
  p.aiming = input.aim && canAim;
  p.aim = damp(p.aim, p.aiming ? 1 : 0, 14, dt);
  // move
  let mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + input.mx, my = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + input.my;
  const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
  const canMove = !p.aiming && (p.state === 'normal') && !p.grabbedBy && p.hurtT <= 0;
  const run = (keys.ShiftLeft || keys.ShiftRight || input.run) && my > 0.3 && p.reloadT <= 0;
  let spd = run ? 5.4 : 3.0; if (my < 0) spd *= 0.65; if (p.reloadT > 0) spd *= 0.75;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  let tvx = 0, tvz = 0;
  if (canMove && ml > 0.05) { tvx = (fx * my + rx * mx) * spd; tvz = (fz * my + rz * mx) * spd; }
  if (p.dodgeT > 0) { p.dodgeT -= dt; tvx = p.dodgeDir.x * 7.5; tvz = p.dodgeDir.z * 7.5; }
  const acc = p.state === 'stumble' ? 3 : 12;
  p.vel.x = damp(p.vel.x, tvx, acc, dt); p.vel.z = damp(p.vel.z, tvz, acc, dt);
  p.pos.addScaledVector(p.vel, dt);
  collide(p.pos, 0.35);
  for (const e of enemies) {
    if (!e.alive || e.state === 'down') continue;
    const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z, d = Math.hypot(dx, dz), rr = 0.35 + e.radius;
    if (d < rr && d > 1e-4) { p.pos.x += dx / d * (rr - d); p.pos.z += dz / d * (rr - d); }
  }
  if (p.state === 'stumble' && p.stateT > 0.5) p.state = 'normal';
  const sp = Math.hypot(p.vel.x, p.vel.z);
  p.stepAcc += sp * dt; if (p.stepAcc > (run ? 1.5 : 1.15)) { p.stepAcc = 0; sfx.step(run); }
  p.phase += sp * dt * (run ? 2.6 : 3.2);
  // actions
  if (p.state === 'kick') {
    if (p.stateT > 0.26 && !p.kickHit) { p.kickHit = true; applyKick(); }
    if (p.stateT > 0.7) p.state = 'normal';
  }
  if (p.state === 'knife') {
    if (p.stateT > 0.14 && !p.knifeHit) { p.knifeHit = true; applyKnife(); }
    if (p.stateT > 0.42) p.state = 'normal';
  }
  if (p.aiming && input.fire && p.fireT <= 0 && p.reloadT <= 0 && p.aim > 0.6) shoot();
  // model
  let my2 = p.yaw + Math.PI;
  if (p.state === 'kick') my2 = p.yaw + Math.PI + Math.min(1, p.stateT / 0.45) * Math.PI * 2;
  p.modelYaw = p.state === 'kick' ? my2 : dampAng(p.modelYaw, my2, 16, dt);
  ph.root.position.copy(p.pos); ph.root.rotation.y = p.modelYaw;
  const pose = {};
  const twoHand = id !== 'hg';
  if (p.state === 'kick') {
    const t = p.stateT; Object.assign(pose, { rhx: -1.5, rhz: t < 0.5 ? -0.9 : 0, rkx: 0.2, lkx: 0.3, tx: -0.2, tz: 0.4, lsx: -0.6, lsz: 0.8, rsx: -0.3, rsz: -0.8, py: -0.05 });
  } else if (p.state === 'knife') {
    const t = p.stateT / 0.42; Object.assign(pose, { lsx: t < 0.35 ? -2.2 : -0.6, lsz: t < 0.35 ? 0.9 : -0.6, lex: -0.3, ty: t < 0.35 ? 0.5 : -0.4, rsx: -0.4, tx: 0.15 });
  } else if (p.grabbedBy) {
    Object.assign(pose, { lsx: -1.4, rsx: -1.4, lex: -1.2, rex: -1.2, tx: -0.2, hx: -0.2 }); walkPose(pose, p.grabT * 12, 0.2);
  } else if (p.aim > 0.05) {
    const a = -Math.PI / 2 - p.pitch - p.recoil * 3;
    Object.assign(pose, twoHand
      ? { rsx: a, rsz: 0.05, rex: 0, lsx: a + 0.15, lsz: -0.55, lex: -0.5, tx: 0.05, ty: 0.25, hy: -0.15, hx: -p.pitch * 0.4 }
      : { rsx: a, rsz: 0.1, rex: 0, lsx: a + 0.1, lsz: -0.35, lex: -0.25, tx: 0.05, ty: 0.1, hx: -p.pitch * 0.4 });
    pose.lhx = -0.2; pose.rhx = 0.25; pose.lkx = 0.15; pose.rkx = 0.1;
  } else {
    Object.assign(pose, twoHand ? { rsx: -0.6, rex: -0.8, lsx: -0.9, lsz: -0.4, lex: -1.1, tx: 0.08 } : { rsx: -0.25, rex: -0.35, lsx: 0, tx: 0.05 });
    walkPose(pose, p.phase, clamp(sp / 3, 0, run ? 1.25 : 1));
    if (twoHand) { pose.lsx = -0.9; pose.rsx = -0.6; }
    if (p.reloadT > 0) { pose.lsx = -1.3; pose.lex = -1.2; pose.rsx = -1.0; pose.rex = -0.9; pose.hx = 0.35; }
    if (run) pose.tx = 0.22;
  }
  if (p.hurtT > 0) { pose.tx = (pose.tx || 0) - 0.3; pose.hx = (pose.hx || 0) - 0.3; }
  applyPose(ph, pose, dt, p.state === 'kick' ? 30 : 16);
  knifeMesh.visible = p.state === 'knife';
  const scoped = id === 'rf' && p.aim > 0.9;
  ph.root.visible = !scoped;
  if (p.hp / p.maxHp < 0.3) { p.hpLowT -= dt; if (p.hpLowT <= 0) { p.hpLowT = 0.75; sfx.heartbeat(); } }
}

const camPivot = new V3(), camWant = new V3(), camLook = new V3();
const camSmooth = { side: 0.55, dist: 2.7, height: 1.55, fov: 65 };
function updateCamera(dt) {
  const p = player, a = p.aim, w = WEAP[p.weapon];
  const scoped = p.weapon === 'rf' && a > 0.5;
  camSmooth.side = lerp(0.72, scoped ? 0 : 0.78, a); camSmooth.dist = lerp(2.8, scoped ? -0.25 : 1.7, a); camSmooth.height = lerp(1.6, scoped ? 1.62 : 1.68, a);
  camSmooth.fov = damp(camSmooth.fov, lerp(65, w.fov, a), 12, dt);
  // aim sway (makes the laser drift a bit, like a real sight picture)
  const t = performance.now() / 1000;
  const swayK = a * (p.weapon === 'rf' ? 0.006 : 0.0035);
  const yaw = p.yaw + (Math.sin(t * 1.3) + Math.sin(t * 2.7) * 0.5) * swayK;
  const pitch = p.pitch + p.recoil + (Math.sin(t * 1.9) * 0.8 + Math.cos(t * 0.9) * 0.5) * swayK;
  const d = _a.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const base = p.dead ? p.pos.clone().setY(0.3) : p.pos;
  camPivot.set(base.x + rx * camSmooth.side, base.y + camSmooth.height, base.z + rz * camSmooth.side);
  let dist = p.dead ? 4 + Math.min(3, p.stateT) : camSmooth.dist;
  // camera collision
  if (dist > 0) {
    const back = _b.copy(d).negate();
    for (const s of solids) { if (!s.alive) continue; const tt = rayAABB(camPivot, back, s); if (tt < dist + 0.2) dist = Math.max(0.2, tt - 0.25); }
  }
  camWant.copy(camPivot).addScaledVector(d, -dist);
  if (camWant.y < 0.25) camWant.y = 0.25;
  camera.position.copy(camWant);
  if (p.dead) { camera.position.y += 1.5 + Math.min(2, p.stateT); }
  camLook.copy(camPivot).addScaledVector(d, 30);
  if (p.dead) camLook.copy(p.pos).setY(0.4);
  camera.lookAt(camLook);
  if (shakeT > 0) { shakeT -= dt; const s = shakeAmp * Math.min(1, shakeT * 4); camera.rotation.x += rand(-s, s) * 0.05; camera.rotation.y += rand(-s, s) * 0.05; camera.position.x += rand(-s, s) * 0.06; camera.position.y += rand(-s, s) * 0.06; } else shakeAmp = 0;
  camera.fov = camSmooth.fov; camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  // sun shadow follows the player
  sun.position.copy(p.pos).addScaledVector(sunDir, 50); sun.target.position.copy(p.pos);
}

function updateLaser() {
  const p = player; const show = p.aim > 0.7 && !p.dead && !(p.weapon === 'rf' && p.aim > 0.9) && game.state === 'play';
  laser.visible = laserDot.visible = show;
  if (!show) return;
  ph.root.updateMatrixWorld(true);
  guns[p.weapon].userData.muzzle.getWorldPosition(muzzleWorld);
  const d = aimDir(_rd);
  const minT = camera.position.distanceTo(_a.copy(p.pos).setY(1.5)) * 0.85;
  const hit = raycastWorld(camera.position, d, 60, minT);
  const end = hit.point;
  const L = muzzleWorld.distanceTo(end);
  laser.position.copy(muzzleWorld); laser.lookAt(end); laser.scale.set(1, 1, L);
  laserDot.position.copy(end).addScaledVector(d, -0.03);
  laserDot.scale.setScalar(1 + hit.t * 0.04);
  laserDot.material.color.setHex(hit.type === 'enemy' ? (hit.part === 'head' ? 0xff8080 : 0xff2020) : 0xff3030);
}

// =====================================================================
// Main loop
// =====================================================================
let last = performance.now();
let titleT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  tick(dt);
  renderer.render(scene, camera);
}
function tick(dt) {
  updateAtmos(dt);
  if (game.state === 'play') {
    stats.time += dt;
    updatePlayer(dt);
    NAV.t -= dt; if (NAV.t <= 0) { NAV.t = 0.4; navUpdate(player.pos.x, player.pos.z); }
    for (const e of enemies) e.update(dt);
    for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead && enemies[i].removeT > 7) { scene.remove(enemies[i].h.root); enemies.splice(i, 1); }
    updateProjectiles(dt); updatePickups(dt); trader.update(dt);
    for (const b of barrels) if (b.alive && b.fuse >= 0) { b.fuse -= dt; if (b.fuse < 0) blowBarrel(b); }
    updateDirector(dt);
    updateCamera(dt); updateLaser(); updateHUD(dt);
  } else if (game.state === 'title') {
    titleT += dt;
    const a = titleT * 0.05; camera.position.set(Math.sin(a) * 26, 7 + Math.sin(titleT * 0.2), Math.cos(a) * 26); camera.lookAt(0, 3, -10);
    camera.fov = 55; camera.updateProjectionMatrix();
    sun.position.set(0, 0, 0).addScaledVector(sunDir, 50); sun.target.position.set(0, 0, 0);
    laser.visible = laserDot.visible = false;
  } else if (game.state === 'dead') {
    player.stateT += dt; updatePlayer(dt); updateCamera(dt);
  }
  // fires & ambient embers
  for (const f of fires) {
    f.t += dt;
    if (f.light) f.light.intensity = 5 + Math.sin(f.t * 13) * 0.8 + Math.sin(f.t * 7.3) * 0.6 + Math.random() * 0.5;
    if (Math.random() < 0.7) particlesA.add(f.pos.x + rand(-.2, .2), f.pos.y, f.pos.z + rand(-.2, .2), rand(-.2, .2), rand(1, 2.2), rand(-.2, .2), rand(0.4, 0.8), rand(0.25, 0.4), 0.05, 1, rand(0.35, 0.55), 0.1, 0.9, -0.5, 0.5, false);
    if (Math.random() < 0.05) particlesA.add(f.pos.x, f.pos.y + 0.3, f.pos.z, rand(-.5, .5), rand(1.5, 3), rand(-.5, .5), rand(1.5, 3), 0.04, 0.02, 1, 0.6, 0.2, 1, -0.2, 0.3, false);
  }
  if (Math.random() < 0.35) { const c = game.state === 'play' ? player.pos : _a.set(0, 0, 0); particlesA.add(c.x + rand(-18, 18), rand(0.5, 6), c.z + rand(-18, 18), rand(-.3, .3), rand(0.05, 0.3), rand(-.3, .3), rand(3, 6), 0.05, 0.03, 0.9, 0.35, 0.1, 0.6, -0.02, 0, false); }
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 120);
  flashI = Math.max(0, flashI - dt * 150); flash.intensity = flashI;
  particlesA.update(dt); particlesN.update(dt);
}
navBuild(); navUpdate(0, 0);
requestAnimationFrame(frame);

// debug handle for automated testing
window.__game = { startWave, sim(sec, dt = 1 / 30) { for (let t = 0; t < sec; t += dt) tick(dt); }, input, camera, scene, solids, player, enemies, director, game, startGame, spawnEnemy, stats, get inv() { return inv; } };
