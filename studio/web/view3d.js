// War Room: the 3D view. Same room plan and agents as the 2D view (tile units -> metres:
// tile (x, y) = world (x, 0, y)), drawn with three.js from AgentCraft's own textures and skins.
import * as THREE from './vendor/three.module.min.js';
import { initGame } from './game.js';
import { initTown } from './town.js';
import { initArena } from './arena.js';
let Town = null, Arena = null;   // shared campus things (board, cart, cells, nearby talk) and the agent arena
let Game = null;                 // the play layer (blocks, backpack, bugs): see game.js

const AC = window.AC;
const { S, actors, DESKS, deskOf } = AC;
const floorEl = document.getElementById('floor');
const PX = 1 / 18;               // one skin pixel in metres (figures are 32 px = 1.78 m)

// ---------------------------------------------------------------------------------------------
// renderer, scene, camera
// ---------------------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none;cursor:grab';
floorEl.insertBefore(renderer.domElement, document.getElementById('overlay'));

const scene = new THREE.Scene();
scene.background = new THREE.Color('#a9cfe4');
scene.fog = new THREE.Fog('#a9cfe4', 60, 140);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);

// orbit camera: left drag rotates, right drag (or shift+drag) pans, wheel zooms
const orbit = { target: new THREE.Vector3(15.5, 0, 10.5), radius: 23, polar: 0.9, az: 0 };
function placeCamera() {
  const { target: t, radius: r, polar: p, az } = orbit;
  camera.position.set(t.x + r * Math.sin(p) * Math.sin(az), t.y + r * Math.cos(p), t.z + r * Math.sin(p) * Math.cos(az));
  camera.lookAt(t);
}
placeCamera();

// ---------------------------------------------------------------------------------------------
// textures and materials
// ---------------------------------------------------------------------------------------------
const loader = new THREE.TextureLoader();
function tex(name, rx = 1, ry = 1) {
  const t = loader.load(`assets/tex/${name}.png`);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapNearestFilter;
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  return t;
}
const mat = (o) => new THREE.MeshLambertMaterial(o);
const M = {
  walnut: mat({ map: tex('walnut_panel') }),
  walnutDark: mat({ color: '#3d2a1e' }),
  trim: mat({ map: tex('walnut_trim', 8, 1) }),
  dark: mat({ color: '#1e1e22' }),
  metal: mat({ color: '#55575d' }),
  screenOff: mat({ map: tex('monitor_screen_off') }),
  sofa: mat({ color: '#6f4a74' }),
  sofaDark: mat({ color: '#5b3b5f' }),
  pot: mat({ color: '#8a5a3c' }),
  leaf: mat({ color: '#5e8a4f' }),
  leaf2: mat({ color: '#77a865' }),
  glass: mat({ color: '#9fcfe3', emissive: '#6fa6bf', emissiveIntensity: 0.6 }),
  lampOn: mat({ color: '#ffd98a', emissive: '#ffcf70', emissiveIntensity: 1 }),
};
function faceMat(name) { return mat({ map: tex(name) }); }

// a canvas texture for the screens of agents who are working (scrolling code)
const codeCanvas = document.createElement('canvas'); codeCanvas.width = 32; codeCanvas.height = 24;
const codeCtx = codeCanvas.getContext('2d');
const codeTex = new THREE.CanvasTexture(codeCanvas);
codeTex.magFilter = THREE.NearestFilter; codeTex.colorSpace = THREE.SRGBColorSpace;
const screenOn = mat({ map: codeTex, emissive: '#ffffff', emissiveMap: codeTex, emissiveIntensity: 0.9 });
let codeTick = 0;
function paintCode(now) {
  const step = Math.floor(now / 300);
  if (step === codeTick) return;
  codeTick = step;
  codeCtx.fillStyle = '#14231f'; codeCtx.fillRect(0, 0, 32, 24);
  const cols = ['#9be59a', '#cfe8dc', '#ff9c8e', '#9fd9d6', '#cfe8dc', '#e6c45a'];
  for (let l = 0; l < 7; l++) {
    const k = (l + step) % 11;
    codeCtx.fillStyle = cols[k % cols.length];
    codeCtx.fillRect(2 + (k % 3) * 2, 2 + l * 3, 6 + ((k * 7) % 18), 1);
  }
  codeTex.needsUpdate = true;
}

// generated bookshelf face
function booksTexture() {
  const c = document.createElement('canvas'); c.width = 32; c.height = 32;
  const x = c.getContext('2d');
  x.fillStyle = '#4a3424'; x.fillRect(0, 0, 32, 32);
  const hues = ['#b9543f', '#2f6f8f', '#c9a227', '#6d8f5a', '#7a4f8a', '#d2c3a6', '#9c3d3d', '#3f6f6a'];
  for (let r = 0; r < 3; r++) {
    x.fillStyle = '#2c1f16'; x.fillRect(1, 1 + r * 10, 30, 9);
    for (let b = 0, px = 2; px < 30; b++) {
      const w = 2 + ((b * 5 + r) % 2), h = 6 + ((b * 3 + r) % 3);
      x.fillStyle = hues[(b * 3 + r * 5) % hues.length]; x.fillRect(px, 1 + r * 10 + (9 - h), w, h);
      px += w + ((b % 4) === 3 ? 1 : 0);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------------------------
// building blocks
// ---------------------------------------------------------------------------------------------
const clickables = [];
const colliders = [];   // {x0, x1, z0, z1, g}: the avatar cannot walk through these (while g is shown)
const occluders = [];   // walls and roof: the walk camera stays on the avatar's side of them
let BUILD = { parent: null, lot: null };   // where box() puts things while an office is being built
function shown(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }
function box(w, h, d, material, x, y, z, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = opts.cast ?? true; m.receiveShadow = true;
  if (opts.click) { m.userData.click = opts.click; clickables.push(m); }
  if (opts.solid) { const [cx, cz] = BUILD.lot ? BUILD.lot.w(x, z) : [x, z]; colliders.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, g: m }); }
  if (opts.occlude) occluders.push(m);
  (opts.parent ?? BUILD.parent ?? scene).add(m);
  return m;
}
const solid = { solid: true };
// a box whose +z face shows its own texture
function frontBox(w, h, d, side, front, x, y, z, opts) {
  return box(w, h, d, [side, side, side, side, front, side], x, y, z, opts);
}
function plane(w, d, material, x, y, z, parent) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  p.rotation.x = -Math.PI / 2; p.position.set(x, y, z); p.receiveShadow = true;
  (parent ?? BUILD.parent ?? scene).add(p);
  return p;
}

// ---------------------------------------------------------------------------------------------
// an office building: the same plan for you and for every coworker (origin at x = ox)
// ---------------------------------------------------------------------------------------------
// Lots: where an office can stand. Yours is the one at the origin, north of the road with its door to the south.
// The others sit in columns 48 m apart on both sides of the road; a south lot is the same plan turned around
// (about the middle of the road), so its door faces north. Everything on a lot is built in the office's own
// coordinates: w() turns those into world coordinates, l() goes back.
function makeLot(col, south) {
  const ox = col * 48;
  const L = { col, south, ox, key: col + (south ? 's' : 'n'), rot: south ? Math.PI : 0, owner: null, office: null };
  L.w = south ? (lx, lz) => [ox + 32 - lx, 52 - lz] : (lx, lz) => [ox + lx, lz];
  L.l = south ? (x, z) => [ox + 32 - x, 52 - z] : (x, z) => [x - ox, z];
  L.inside = (x, z) => { const [lx, lz] = L.l(x, z); return lx > 0 && lx < 32 && lz > 0 && lz < 20.2; };
  return L;
}
function lotGroup(L) {
  const g = new THREE.Group();
  g.position.set(L.south ? L.ox + 32 : L.ox, 0, L.south ? 52 : 0); g.rotation.y = L.rot;
  scene.add(g);
  return g;
}
const MYLOT = makeLot(0, false);
const LOTS = [];
for (const c of [0, 1, -1, 2, -2, 3, -3]) for (const s of [false, true]) if (c || s) LOTS.push(makeLot(c, s));

const plaster = (rx, ry) => mat({ map: tex('plaster_panel', rx, ry) });
const roofMat = mat({ color: '#5a3e2b' });
const floorMat = mat({ map: tex('oak_parquet', 32, 20) });
const rugMat = mat({ map: tex('terracotta_tile', 15, 5) });
const books = mat({ map: booksTexture() });
const CARD = { todo: mat({ color: '#f4efe6' }), doing: mat({ color: '#9fd9d6' }), review: mat({ color: '#e6c45a' }), done: mat({ color: '#b8cdb4' }), blocked: mat({ color: '#e08a80' }) };
const FM = {};
for (const k of ['task_board_surface', 'memory_archive_front', 'console_screen', 'merge_station_front', 'decision_podium_front']) FM[k] = faceMat(k);

function buildOffice(L, mine) {
  const G = lotGroup(L);
  const prev = BUILD; BUILD = { parent: G, lot: L };
  const O = { G, lot: L, mine, deskScreens: [], plaques: [], cardKey: '', onBoard: null, onLibrary: null, onPodium: null, onMerge: null };
  const call = (k) => () => O[k]?.();

  plane(32, 20, floorMat, 16, 0, 10);
  plane(15, 5, rugMat, 7.5, 0.01, 17.5);

  // shell: four walls, a front door at x 15..17, a roof hidden while you are inside
  const wall = { cast: false, solid: true, occlude: true };
  O.frontWall = new THREE.Group(); G.add(O.frontWall);   // cut away in the overview of your own office
  const fwall = { ...wall, parent: O.frontWall };
  const fdeco = { cast: false, parent: O.frontWall };
  box(32.6, 4.2, 0.3, plaster(32, 4), 16, 2.1, -0.15, wall);
  box(0.3, 4.2, 20.6, plaster(20, 4), -0.15, 2.1, 10.15, wall);
  box(0.3, 4.2, 20.6, plaster(20, 4), 32.15, 2.1, 10.15, wall);
  box(15, 4.2, 0.3, plaster(15, 4), 7.5, 2.1, 20.15, fwall);
  box(15, 4.2, 0.3, plaster(15, 4), 24.5, 2.1, 20.15, fwall);
  box(2, 1.5, 0.3, plaster(2, 1.5), 16, 3.45, 20.15, { cast: false, occlude: true, parent: O.frontWall });
  for (const dx of [14.9, 17.1]) box(0.2, 2.8, 0.45, M.walnutDark, dx, 1.4, 20.15, fdeco);
  box(2.4, 0.2, 0.45, M.walnutDark, 16, 2.75, 20.15, fdeco);
  box(32, 0.25, 0.06, M.trim, 16, 0.12, 0.03, { cast: false });
  box(33, 0.5, 0.06, M.walnutDark, 16, 0.25, 20.33, fdeco);
  for (const wx of [4, 9.5, 22.5, 28]) {
    box(3.2, 1.8, 0.4, M.walnutDark, wx, 2.3, 20.15, fdeco);
    box(2.9, 1.5, 0.44, M.glass, wx, 2.3, 20.15, fdeco);
  }
  O.roof = new THREE.Group(); G.add(O.roof);
  box(33.4, 0.4, 21.4, roofMat, 16, 4.4, 10.1, { parent: O.roof, occlude: true });
  box(33.8, 0.6, 0.3, M.walnutDark, 16, 4.55, 20.85, { parent: O.roof });
  box(33.8, 0.6, 0.3, M.walnutDark, 16, 4.55, -0.65, { parent: O.roof });
  // the sign over the door
  const signCanvas = document.createElement('canvas'); signCanvas.width = 256; signCanvas.height = 48;
  const signTex = new THREE.CanvasTexture(signCanvas); signTex.colorSpace = THREE.SRGBColorSpace;
  box(5, 0.9, 0.12, [M.walnutDark, M.walnutDark, M.walnutDark, M.walnutDark, mat({ map: signTex }), M.walnutDark], 16, 3.55, 20.4, fdeco);
  O.paintSign = (text) => {
    const x = signCanvas.getContext('2d');
    x.fillStyle = '#3d2a1e'; x.fillRect(0, 0, 256, 48);
    x.strokeStyle = '#c9a227'; x.lineWidth = 3; x.strokeRect(3, 3, 250, 42);
    x.fillStyle = '#f4efe6'; x.font = 'bold 22px Segoe UI, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, 128, 25, 236);
    signTex.needsUpdate = true;
  };
  // back windows
  for (let wx = 3.5; wx < 32; wx += 6) {
    if (wx > 9 && wx < 18) continue;
    box(3.2, 1.8, 0.12, M.walnutDark, wx, 2.5, 0.02, { cast: false });
    box(2.9, 1.5, 0.14, M.glass, wx, 2.5, 0.02, { cast: false });
    box(0.12, 1.5, 0.16, M.walnutDark, wx, 2.5, 0.02, { cast: false });
  }
  // path from the door to the road
  plane(2.4, 4, pathMat, 16, -0.004, 22.2);

  // task board with a card per open task
  box(6.6, 1.9, 0.1, M.walnutDark, 13.75, 2.5, 0.05, { cast: false });
  box(6.2, 1.6, 0.12, FM.task_board_surface, 13.75, 2.5, 0.06, { cast: false, click: call('onBoard') });
  O.cardGroup = new THREE.Group(); G.add(O.cardGroup);

  // library shelves
  for (let i = 0; i < 3; i++) frontBox(2.1, 2.6, 0.6, M.walnutDark, books, 2.55 + i * 2.25, 1.3, 2.6, { solid: true, click: call('onLibrary') });
  box(0.9, 0.06, 0.6, FM.memory_archive_front, 8.6, 0.9, 3.4);

  // desks
  DESKS.forEach((d, k) => {
    const cx = d.x + 1.5, cz = d.y + 0.5;
    box(3, 0.12, 1, M.walnut, cx, 0.78, cz, solid);
    for (const [lx, lz] of [[-1.35, -0.38], [1.35, -0.38], [-1.35, 0.38], [1.35, 0.38]]) box(0.1, 0.72, 0.1, M.walnutDark, cx + lx, 0.36, cz + lz);
    box(0.12, 0.25, 0.12, M.dark, cx, 0.95, cz - 0.2);
    box(1.15, 0.72, 0.08, M.dark, cx, 1.38, cz - 0.24);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.02, 0.6), M.screenOff);
    scr.position.set(cx, 1.38, cz - 0.195); G.add(scr);
    O.deskScreens[k] = scr;
    box(0.55, 0.03, 0.2, M.dark, cx, 0.85, cz + 0.2);
    if (d.lead) box(0.35, 0.3, 0.35, mat({ color: '#c9a227' }), cx + 1.15, 0.99, cz - 0.1);
    box(0.72, 0.1, 0.72, M.walnutDark, cx, 0.42, d.y + 1.55);
    box(0.72, 0.7, 0.1, M.walnutDark, cx, 0.8, d.y + 1.92);
    box(0.08, 0.38, 0.08, M.metal, cx, 0.19, d.y + 1.55);
    O.plaques[k] = box(0.5, 0.08, 0.06, mat({ color: '#6b5a4c' }), cx - 1.0, 0.88, cz + 0.47, { cast: false });
  });

  // terminal + test bench
  box(3.2, 1.2, 1.2, M.dark, 24.2, 0.6, 4.0, solid);
  for (const sx of [23.5, 24.9]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), FM.console_screen); s.position.set(sx, 0.75, 4.61); G.add(s); }
  box(3.2, 0.1, 1.2, M.walnut, 28.8, 0.9, 4.2, solid);
  for (const [lx, lz] of [[-1.5, -0.5], [1.5, -0.5], [-1.5, 0.5], [1.5, 0.5]]) box(0.1, 0.85, 0.1, M.walnutDark, 28.8 + lx, 0.43, 4.2 + lz);
  box(0.3, 0.45, 0.3, mat({ color: '#8fa98b', emissive: '#8fa98b', emissiveIntensity: 0.25 }), 28.0, 1.18, 4.0);
  box(0.25, 0.6, 0.25, mat({ color: '#c9a227', emissive: '#c9a227', emissiveIntensity: 0.25 }), 28.7, 1.25, 4.2);
  box(0.45, 0.35, 0.3, mat({ color: '#2fa3a0', emissive: '#2fa3a0', emissiveIntensity: 0.25 }), 29.5, 1.13, 4.0);

  // merge station + decision podium
  frontBox(3, 1, 1, M.walnut, FM.merge_station_front, 24.3, 0.5, 9.6, { solid: true, click: call('onMerge') });
  frontBox(1.2, 1.25, 0.8, M.walnutDark, FM.decision_podium_front, 28.6, 0.62, 9.25, { solid: true, click: call('onPodium') });
  O.bellMat = mat({ color: '#6b5a4c', emissive: '#d97757', emissiveIntensity: 0 });
  box(0.5, 0.25, 0.5, O.bellMat, 28.6, 1.38, 9.25, { click: call('onPodium') });
  O.podiumLight = new THREE.PointLight('#ff8a5c', 0, 6, 2); O.podiumLight.position.set(28.6, 2.2, 9.6); G.add(O.podiumLight);

  // meeting table with stools
  box(7, 0.12, 1.1, M.walnut, 25.7, 0.76, 15.9, solid);
  for (const lx of [-3.2, 3.2]) box(0.15, 0.7, 0.8, M.walnutDark, 25.7 + lx, 0.35, 15.9);
  for (const [sx, sz] of [[22.5, 15.2], [24.5, 15.2], [26.5, 15.2], [28.5, 15.2], [23.5, 17.6], [27.5, 17.6]]) {
    box(0.55, 0.08, 0.55, M.walnutDark, sx, 0.42, sz + (sz < 16 ? -0.45 : 0.45));
    box(0.08, 0.4, 0.08, M.metal, sx, 0.2, sz + (sz < 16 ? -0.45 : 0.45));
  }

  // lounge sofa (sitters face the door)
  box(13, 0.45, 1.0, M.sofa, 8, 0.23, 17.65, solid);
  box(13, 0.95, 0.35, M.sofaDark, 8, 0.6, 17.05);
  box(0.4, 0.7, 1.35, M.sofaDark, 1.3, 0.35, 17.5);
  box(0.4, 0.7, 1.35, M.sofaDark, 14.7, 0.35, 17.5);

  // plants
  for (const [px, pz] of [[20.5, 2.6], [31.2, 13.5], [0.7, 13.5], [19.5, 18.8]]) {
    box(0.6, 0.5, 0.6, M.pot, px, 0.25, pz, solid);
    box(0.95, 0.8, 0.95, M.leaf, px, 0.9, pz);
    box(0.55, 0.5, 0.55, M.leaf2, px + 0.1, 1.45, pz - 0.05);
  }

  // warm lamps (fewer in coworkers' buildings, to keep the frame rate up)
  for (const [lx, lz] of mine ? [[7, 7], [17, 7], [7, 12], [17, 12], [26, 7], [26, 15], [8, 16]] : [[10, 9], [24, 11]]) {
    const p = new THREE.PointLight('#ffcf8a', mine ? 6 : 10, mine ? 9 : 16, 2); p.position.set(lx, 3.3, lz); G.add(p);
  }

  BUILD = prev;
  return O;
}

// the task cards on an office's board
function fillCards(O, tasks) {
  const key = tasks.map((t) => t.id + t.status).join(',');
  if (key === O.cardKey) return;
  O.cardKey = key;
  O.cardGroup.clear();
  ['todo', 'doing', 'review', 'done'].forEach((c, ci) => {
    const list = tasks.filter((t) => (c === 'todo' ? t.status === 'todo' || t.status === 'blocked' : t.status === c));
    list.slice(0, 8).forEach((t, k) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.02), t.status === 'blocked' ? CARD.blocked : CARD[c]);
      m.position.set(11.05 + ci * 1.5 + (k % 2) * 0.65, 3.05 - Math.floor(k / 2) * 0.38, 0.14);
      O.cardGroup.add(m);
    });
  });
}
// screens, desk plaques and the podium lamp of an office
function dressOffice(O, deskOwners, openCount, now) {
  DESKS.forEach((d, k) => {
    const a = deskOwners.get(k);
    const working = a && a.active && a.station === 'desk' && !['idle', 'done'].includes(a.state);
    O.deskScreens[k].material = working ? screenOn : M.screenOff;
    const col = a ? a.color : '#6b5a4c';
    if (O.plaques[k].userData.col !== col) { O.plaques[k].material = mat({ color: col }); O.plaques[k].userData.col = col; }
  });
  const open = openCount > 0;
  O.bellMat.emissiveIntensity = open ? 0.9 + Math.sin(now / 250) * 0.3 : 0;
  O.bellMat.color.set(open ? '#d97757' : '#6b5a4c');
  O.podiumLight.intensity = open ? 4 : 0;
}

// ---------------------------------------------------------------------------------------------
// the campus
// ---------------------------------------------------------------------------------------------
function noiseTexture(base, spots, size = 32, repeat = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, size, size);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < size * size * 0.45; i++) { x.fillStyle = spots[Math.floor(rnd() * spots.length)]; x.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 1, 1); }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  return t;
}
const stone = (rx, ry) => { const t = noiseTexture('#a49d92', ['#958e83', '#b1aa9f', '#8a847a'], 32, 1); t.repeat.set(rx, ry); return mat({ map: t }); };
const pathMat = stone(1, 2);
plane(500, 500, mat({ map: noiseTexture('#6f9a4f', ['#668f48', '#7aa658', '#5f8742', '#82ad5f'], 32, 250) }), 16, -0.02, 20, scene);
plane(500, 4, stone(125, 1), 16, -0.005, 26, scene);

const bark = mat({ color: '#6b4a33' }), crown = mat({ color: '#4f7d3d' }), crown2 = mat({ color: '#5f9147' });
function tree(x, z, s = 1) {
  box(0.5 * s, 2.2 * s, 0.5 * s, bark, x, 1.1 * s, z, solid);
  box(2.6 * s, 1.6 * s, 2.6 * s, crown, x, 2.9 * s, z);
  box(1.7 * s, 1.0 * s, 1.7 * s, crown2, x + 0.2, 4.0 * s, z - 0.1);
}
function bench(x, z) { box(2, 0.12, 0.6, M.walnut, x, 0.5, z, solid); box(2, 0.5, 0.12, M.walnut, x, 0.8, z + 0.3); for (const dx of [-0.8, 0.8]) box(0.12, 0.5, 0.5, M.dark, x + dx, 0.25, z); }
// free plots: a sign and a fence until a coworker's office takes the lot
const plotSignCanvas = document.createElement('canvas'); plotSignCanvas.width = 256; plotSignCanvas.height = 64;
{
  const x = plotSignCanvas.getContext('2d');
  x.fillStyle = '#f4efe6'; x.fillRect(0, 0, 256, 64); x.fillStyle = '#3d2a1e'; x.font = 'bold 22px Segoe UI, sans-serif';
  x.textAlign = 'center'; x.fillText('Free plot', 128, 28); x.font = '16px Segoe UI, sans-serif'; x.fillText("a coworker's office goes here", 128, 50);
}
const plotSignTex = new THREE.CanvasTexture(plotSignCanvas); plotSignTex.colorSpace = THREE.SRGBColorSpace;
// around every lot: trees, benches and street lamps (the far lots only show once someone lives there)
const freeMat = mat({ color: '#8a7a5c' }), plotSignMat = mat({ map: plotSignTex });
for (const L of [MYLOT, ...LOTS]) {
  L.deco = lotGroup(L);
  const prev = BUILD; BUILD = { parent: L.deco, lot: L };
  tree(-3.4, 4, 1.1); tree(-3.8, 15, 0.9);
  bench(10, 23); bench(22, 23);
  for (const lx of [8, 24]) { box(0.15, 3, 0.15, M.dark, lx, 1.5, 24.2, solid); box(0.45, 0.35, 0.45, M.lampOn, lx, 3.1, 24.2, { cast: false }); }
  if (L !== MYLOT) {
    L.free = new THREE.Group(); L.deco.add(L.free);
    BUILD = { parent: L.free, lot: L };
    plane(32, 20, freeMat, 16, -0.01, 10);
    for (const [fx, fz, fw, fd] of [[16, 0, 32, 0.15], [0, 10, 0.15, 20], [32, 10, 0.15, 20]]) box(fw, 0.6, fd, M.walnut, fx, 0.3, fz, solid);
    box(0.15, 1.6, 0.15, M.walnutDark, 16, 0.8, 21.5, solid);
    box(2.6, 0.7, 0.08, [M.walnut, M.walnut, M.walnut, M.walnut, plotSignMat, M.walnut], 16, 1.7, 21.5);
    L.deco.visible = Math.abs(L.col) <= 1;
  }
  BUILD = prev;
}

// lights: soft ambient + a sun that follows you (its shadows cover the area around you)
const hemi = new THREE.HemisphereLight('#fff3df', '#3a2a20', 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
sun.position.set(8, 30, 30); sun.target.position.set(16, 0, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 30, bottom: -30, near: 1, far: 90 });
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);

// your own office
const MY = buildOffice(MYLOT, true);
const { deskScreens, roof, frontWall, cardGroup, bellMat, podiumLight } = MY;
const paintSign = MY.paintSign;
MY.onBoard = () => AC.focusTasks();
MY.onLibrary = () => AC.openLibrary();
MY.onPodium = () => { const d = AC.firstOpenDecision(); if (d) AC.openDecision(d.id); else AC.toast('Nothing is waiting for you.'); };
MY.onMerge = () => { const d = [...S.decisions.values()].find((x) => x.status === 'open' && x.kind === 'merge'); if (d) AC.openDecision(d.id); };
function updateCards() { fillCards(MY, AC.wallTasks()); }


// ---------------------------------------------------------------------------------------------
// agents: blocky figures built from each agent's 64x64 skin
// ---------------------------------------------------------------------------------------------
// skin UV layout of a box with texture origin (u, v) and size w x h x d pixels
function skinBox(w, h, d, u, v, material, inflate = 0) {
  const g = new THREE.BoxGeometry((w + inflate) * PX, (h + inflate) * PX, (d + inflate) * PX);
  const rects = [
    [u + d + w, v + d, d, h],  // +x: the figure's left side
    [u, v + d, d, h],          // -x: right side
    [u + d, v, w, d],          // +y: top
    [u + d + w, v, w, d],      // -y: bottom
    [u + d, v + d, w, h],      // +z: front
    [u + 2 * d + w, v + d, w, h], // -z: back
  ];
  const uv = g.attributes.uv;
  rects.forEach(([rx, ry, rw, rh], f) => {
    const x0 = rx / 64, x1 = (rx + rw) / 64, y1 = 1 - ry / 64, y0 = 1 - (ry + rh) / 64;
    const quad = f === 3 ? [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] : [[x0, y1], [x1, y1], [x0, y0], [x1, y0]];
    quad.forEach(([a, b], k) => uv.setXY(f * 4 + k, a, b));
  });
  uv.needsUpdate = true;
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  return m;
}
const skinMats = new Map();
function skinMaterials(skin) {
  if (skinMats.has(skin)) return skinMats.get(skin);
  const t = loader.load(`assets/skins/${skin}.png`);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  const pair = { base: mat({ map: t, alphaTest: 0.5 }), over: mat({ map: t, alphaTest: 0.5, transparent: false }) };
  skinMats.set(skin, pair);
  return pair;
}
function limb(parent, x, y, w, h, d, u, v, ou, ov, m) {
  const pivot = new THREE.Group(); pivot.position.set(x * PX, y * PX, 0);
  const a = skinBox(w, h, d, u, v, m.base); a.position.y = -h / 2 * PX;
  const b = skinBox(w, h, d, ou, ov, m.over, 0.5); b.position.y = -h / 2 * PX;
  pivot.add(a, b); parent.add(pivot);
  return pivot;
}
function buildFigure(a, m = skinMaterials(a.skin)) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const legR = limb(body, -2, 12, 4, 12, 4, 0, 16, 0, 32, m);
  const legL = limb(body, 2, 12, 4, 12, 4, 16, 48, 0, 48, m);
  const torso = skinBox(8, 12, 4, 16, 16, m.base); torso.position.y = 18 * PX;
  const jacket = skinBox(8, 12, 4, 16, 32, m.over, 0.5); jacket.position.y = 18 * PX;
  body.add(torso, jacket);
  const armR = limb(body, -6, 24, 4, 12, 4, 40, 16, 40, 32, m);
  const armL = limb(body, 6, 24, 4, 12, 4, 32, 48, 48, 48, m);
  const head = new THREE.Group(); head.position.y = 24 * PX;
  const h1 = skinBox(8, 8, 8, 0, 0, m.base); h1.position.y = 4 * PX;
  const h2 = skinBox(8, 8, 8, 32, 0, m.over, 1); h2.position.y = 4 * PX;
  head.add(h1, h2); body.add(head);
  if (a.id) root.traverse((o) => { o.userData.agentId = a.id; });
  scene.add(root);
  return { root, body, head, legL, legR, armL, armR };
}

const figures = new Map();
const tmp = new THREE.Vector3();
function facingAtRest(a, ac) {
  if (!a.active) return 0;                              // lounge: face the camera
  if (a.station === 'desk') return Math.PI;              // face the monitor
  if (a.station === 'meeting') return ac.y < 16 ? 0 : Math.PI;
  return Math.PI;                                        // face the station
}
function updateFigures(now, dt) {
  const w = floorEl.clientWidth, h = floorEl.clientHeight;
  for (const [id, ac] of actors) {
    const a = S.agents.get(id);
    let f = figures.get(id);
    if (!a) { if (f) { scene.remove(f.root); figures.delete(id); } continue; }
    if (!f || f.skin !== a.skin) { if (f) scene.remove(f.root); f = buildFigure(a); f.skin = a.skin; f.rot = 0; figures.set(id, f); }
    const deskSeat = ac.seated && a.active && a.station === 'desk';
    const x = ac.x, z = deskSeat ? ac.y - 0.5 : ac.y;
    f.root.position.set(x, ac.seated ? -0.22 : 0, z);
    // turn smoothly towards where it walks, or to its work when it stops
    const want = ac.moving ? (ac.heading ?? 0) : facingAtRest(a, ac);
    let diff = ((want - f.rot + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    f.rot += diff * Math.min(1, dt * 10);
    f.root.rotation.y = f.rot;
    const t = now / 1000 + (ac.phase ?? 0);
    const working = a.active && !a.paused && ['thinking', 'reading', 'editing', 'running', 'testing'].includes(a.state);
    if (ac.moving) {
      const s = Math.sin(t * 11) * 0.7;
      f.legL.rotation.x = s; f.legR.rotation.x = -s; f.armL.rotation.x = -s * 0.8; f.armR.rotation.x = s * 0.8;
      f.body.position.y = Math.abs(Math.sin(t * 11)) * 0.04;
      f.head.rotation.set(0, 0, 0);
    } else if (ac.seated) {
      f.legL.rotation.x = f.legR.rotation.x = -Math.PI / 2;
      f.body.position.y = 0;
      const typing = deskSeat && working;
      f.armL.rotation.x = typing ? -1.1 + Math.sin(t * 18) * 0.08 : -0.3;
      f.armR.rotation.x = typing ? -1.1 + Math.cos(t * 17) * 0.08 : -0.3;
      f.head.rotation.x = typing ? 0.12 : 0;
      f.head.rotation.y = 0;
    } else {
      f.legL.rotation.x = f.legR.rotation.x = 0;
      f.body.position.y = 0;
      const think = a.state === 'thinking' || a.state === 'reading';
      f.armR.rotation.x = think ? -0.5 : Math.sin(t * 1.3) * 0.05;
      f.armL.rotation.x = Math.sin(t * 1.3 + 1) * 0.05;
      f.head.rotation.y = think ? Math.sin(t * 0.8) * 0.35 : Math.sin(t * 0.4) * 0.15;
      f.head.rotation.x = a.state === 'waiting_user' ? -0.1 : 0;
    }
    // nameplate anchor: just above the head, in #floor pixels
    tmp.set(x, f.root.position.y + 34 * PX + 0.15, z).project(camera);
    ac.anchor = { x: (tmp.x + 1) / 2 * w, y: (1 - tmp.y) / 2 * h, hidden: tmp.z > 1 || Math.abs(tmp.x) > 1.2 || Math.abs(tmp.y) > 1.2 || walkOutside() };
  }
}

function updateDesks() {
  const owners = new Map();
  for (const [id, k] of deskOf) { const a = S.agents.get(id); if (a) owners.set(k, a); }
  dressOffice(MY, owners, [...S.decisions.values()].filter((x) => x.status === 'open').length, performance.now());
}


// ---------------------------------------------------------------------------------------------
// your avatar: a figure painted from the look you pick (drawn here, no game assets)
// ---------------------------------------------------------------------------------------------
const LOOK_DEFAULT = { name: '', skin: '#e0ac7e', hair: '#3b2a1f', style: 'short', shirt: '#2f6f8f', pants: '#3a3f4a' };
const SKIN_TONES = ['#f6d7bd', '#e0ac7e', '#c68a5e', '#9a6440', '#6b4229'];
const HAIR_COLORS = ['#1f1a17', '#3b2a1f', '#7a4b2a', '#d6b04a', '#bdb6ab', '#a8463a'];
const STYLES = [['short', 'Short'], ['long', 'Long'], ['cap', 'Cap'], ['bald', 'None']];
function loadLook() {
  try { const s = localStorage.getItem('ac-avatar'); return s ? { ...LOOK_DEFAULT, ...JSON.parse(s) } : null; } catch { return null; }
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
}
function paintSkin(L) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const f = (col, X, Y, W, H) => { x.fillStyle = col; x.fillRect(X, Y, W, H); };
  const part = (u, v, w, h, d, col) => { f(col, u + d, v, w * 2, d); f(col, u, v + d, 2 * (w + d), h); };
  part(0, 0, 8, 8, 8, L.skin);                                   // head
  part(16, 16, 8, 12, 4, L.shirt);                                // body
  for (const [u, v] of [[40, 16], [32, 48]]) {                    // arms: sleeves, then hands
    part(u, v, 4, 12, 4, L.shirt);
    f(L.skin, u, v + 4 + 5, 16, 7); f(L.skin, u + 8, v, 4, 4);
    f(shade(L.shirt, -0.25), u, v + 4 + 4, 16, 1);
  }
  for (const [u, v] of [[0, 16], [16, 48]]) {                     // legs and shoes
    part(u, v, 4, 12, 4, L.pants);
    f('#2a211b', u, v + 4 + 10, 16, 2); f('#2a211b', u + 8, v, 4, 4);
  }
  f(shade(L.shirt, -0.2), 16, 20, 24, 1);                          // shoulders
  f(L.skin, 23, 20, 2, 1);                                         // collar
  f(shade(L.pants, -0.35), 16, 31, 24, 1);                          // belt
  f(shade(L.shirt, 0.15), 21, 23, 1, 6);                           // shirt fold
  // face
  f('#ffffff', 9, 12, 1, 1); f('#2b3a55', 10, 12, 1, 1); f('#2b3a55', 13, 12, 1, 1); f('#ffffff', 14, 12, 1, 1);
  f(shade(L.skin, -0.12), 11, 13, 2, 1);
  f(shade(L.skin, -0.4), 11, 14, 2, 1);
  // hair
  const H = L.hair;
  if (L.style !== 'bald') {
    f(H, 8, 0, 8, 8);                                              // top
    f(H, 24, 8, 8, L.style === 'long' ? 8 : 5);                    // back
    if (L.style === 'long') { f(H, 0, 8, 8, 8); f(H, 16, 8, 8, 8); f(H, 8, 8, 1, 7); f(H, 15, 8, 1, 7); }
    else { f(H, 0, 8, 8, 3); f(H, 16, 8, 8, 3); f(H, 0, 11, 2, 1); f(H, 22, 11, 2, 1); f(H, 8, 8, 1, 3); f(H, 15, 8, 1, 3); }
    f(H, 8, 8, 8, 2);                                              // fringe
    f(shade(H, 0.2), 10, 9, 3, 1);
  }
  if (L.style === 'cap') {                                         // a cap on the hat layer
    const C = shade(L.shirt, -0.1);
    f(C, 40, 0, 8, 8); f(C, 32, 8, 32, 3); f(shade(C, -0.35), 40, 11, 8, 1); f('#f4efe6', 43, 8, 2, 2);
  }
  return c;
}
function drawFront(skin, ctx, k) {
  ctx.imageSmoothingEnabled = false;
  const p = (sx, sy, w, h, dx, dy) => ctx.drawImage(skin, sx, sy, w, h, dx * k, dy * k, w * k, h * k);
  p(4, 20, 4, 12, 4, 20); p(20, 52, 4, 12, 8, 20); p(20, 20, 8, 12, 4, 8);
  p(44, 20, 4, 12, 0, 8); p(36, 52, 4, 12, 12, 8); p(8, 8, 8, 8, 4, 0); p(40, 8, 8, 8, 4, 0);
}

const me = { x: 16, z: 23.6, rot: Math.PI, look: loadLook(), fig: null, moving: false, heading: Math.PI };
if (location.hash.startsWith('#walk')) {   // screenshots: a look without saving one; "#walk=x,z" also picks where to stand
  me.look ??= { ...LOOK_DEFAULT, name: 'Visitor' };
  const at = /^#walk=(-?[\d.]+),(-?[\d.]+)$/.exec(location.hash);
  if (at) { me.x = Number(at[1]); me.z = Number(at[2]); }
}
function buildAvatar() {
  if (me.fig) scene.remove(me.fig.root);
  if (!me.look) { me.fig = null; paintSign('War Room'); return; }
  const t = new THREE.CanvasTexture(paintSkin(me.look));
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  me.fig = buildFigure({}, { base: mat({ map: t, alphaTest: 0.5 }), over: mat({ map: t, alphaTest: 0.5 }) });
  me.fig.rot = me.rot;
  const n = me.look.name.trim();
  paintSign(n ? `${n}'s office` : 'My office');
}
buildAvatar();

function openCreator() {
  const L = { ...(me.look ?? LOOK_DEFAULT) };
  if (!L.name) L.name = S.foreman?.userName ?? '';
  const sw = (key, list) => list.map((c) => `<button class="sw${L[key] === c ? ' on' : ''}" data-k="${key}" data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
  AC.modal('avatar', '', `
    <div class="m-head"><h1>Your avatar <span class="sub">how you look on the campus</span></h1><button class="x" data-close aria-label="Close">&times;</button></div>
    <div class="m-body"><div class="creator">
      <canvas id="av-prev" width="96" height="192"></canvas>
      <div class="av-form">
        <label>Name<input type="text" id="av-name" maxlength="24" value="${AC.esc(L.name)}"></label>
        <div><span class="lbl">Skin</span><div class="sws">${sw('skin', SKIN_TONES)}</div></div>
        <div><span class="lbl">Hair</span><div class="sws">${STYLES.map(([v, t]) => `<button class="quiet pill${L.style === v ? ' on' : ''}" data-k="style" data-v="${v}">${t}</button>`).join('')}</div>
          <div class="sws">${sw('hair', HAIR_COLORS)}</div></div>
        <div class="two"><label>Shirt<input type="color" id="av-shirt" value="${L.shirt}"></label><label>Trousers<input type="color" id="av-pants" value="${L.pants}"></label></div>
      </div></div></div>
    <div class="m-foot"><button id="av-save">${me.look ? 'Save' : 'Start walking'}</button></div>`);
  const box = document.getElementById('modal-box');
  const prev = () => { const c = document.getElementById('av-prev'), x = c.getContext('2d'); x.clearRect(0, 0, 96, 192); drawFront(paintSkin(L), x, 6); };
  for (const b of box.querySelectorAll('[data-k]')) b.onclick = () => {
    L[b.dataset.k] = b.dataset.v;
    for (const o of box.querySelectorAll(`[data-k="${b.dataset.k}"]`)) o.classList.toggle('on', o === b);
    prev();
  };
  document.getElementById('av-shirt').oninput = (e) => { L.shirt = e.target.value; prev(); };
  document.getElementById('av-pants').oninput = (e) => { L.pants = e.target.value; prev(); };
  document.getElementById('av-name').oninput = (e) => { L.name = e.target.value; };
  document.getElementById('av-save').onclick = () => {
    L.name = L.name.trim() || 'Me';
    me.look = L;
    try { localStorage.setItem('ac-avatar', JSON.stringify(L)); } catch { /* private window */ }
    buildAvatar();
    sendMe();
    AC.closeModal();
    setMode('walk');
  };
  prev();
}

// ---------------------------------------------------------------------------------------------
// modes: walk (third person) and overview (orbit the building)
// ---------------------------------------------------------------------------------------------
let mode = me.look ? 'walk' : 'overview';
const header = document.getElementById('btn-view');
const btnMode = document.createElement('button'); btnMode.className = 'ghost';
const btnAvatar = document.createElement('button'); btnAvatar.className = 'ghost'; btnAvatar.textContent = 'My avatar';
btnAvatar.title = 'Change how you look';
header.before(btnMode, btnAvatar);
btnMode.onclick = () => setMode(mode === 'walk' ? 'overview' : 'walk');
btnAvatar.onclick = openCreator;
function setMode(m) {
  if (m === 'walk' && !me.look) { openCreator(); return; }
  mode = m;
  btnMode.textContent = m === 'walk' ? 'Overview' : 'Walk';
  btnMode.title = m === 'walk' ? 'See the whole building from above' : 'Walk around as your avatar (WASD)';
  if (m === 'overview') placeCamera();
  hint.hidden = true;
  help.innerHTML = m === 'walk'
    ? '<b>WASD</b> walk &middot; <b>Shift</b> run &middot; <b>Space</b> jump &middot; <b>drag</b> look &middot; <b>click</b> hit &middot; <b>right-click</b> build &middot; <b>1-9</b> item &middot; <b>I</b> backpack &middot; <b>E</b> interact &middot; <b>Enter</b> console'
    : '<b>drag</b> rotate &middot; <b>right-drag</b> move &middot; <b>wheel</b> zoom &middot; <b>click</b> an agent or the podium &middot; <b>Walk</b> to play as your avatar';
}
const inside = () => me.x > 0 && me.x < 32 && me.z > 0 && me.z < 20.2;
function walkOutside() { return mode === 'walk' && !inside(); }

// my nameplate and the "press E" hint
const overlayEl = document.getElementById('overlay');
const myPlate = document.createElement('div'); myPlate.className = 'plate me'; overlayEl.append(myPlate);
const hint = document.createElement('div'); hint.className = 'hint'; hint.hidden = true; floorEl.append(hint);
const help = document.createElement('div'); help.className = 'help3d';
floorEl.append(help);

// keyboard
const keys = new Set();
const busy = () => AC.isModalOpen() || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'];
document.addEventListener('keydown', (e) => {
  if (!window.View3D.visible || busy()) return;
  const k = e.key.toLowerCase();
  if (mode === 'walk' && MOVE_KEYS.includes(k)) { keys.add(k); e.preventDefault(); }
  if (k === 'e' && mode === 'walk' && near) { e.preventDefault(); near.act(); }
});
document.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

// movement with simple collision against walls and furniture
const R = 0.3;
const blocked = (x, z) => colliders.some((c) => x + R > c.x0 && x - R < c.x1 && z + R > c.z0 && z - R < c.z1 && shown(c.g));
const cam = { yaw: 0, pitch: 0.36, dist: 6.5 };
function moveAvatar(dt) {
  if (busy()) keys.clear();
  const fwd = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  const str = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  let mx = -Math.sin(cam.yaw) * fwd + Math.cos(cam.yaw) * str;
  let mz = -Math.cos(cam.yaw) * fwd - Math.sin(cam.yaw) * str;
  const len = Math.hypot(mx, mz);
  me.moving = len > 0;
  if (!me.moving) return;
  mx /= len; mz /= len;
  const step = (keys.has('shift') ? 7 : 4.2) * dt;
  const nx = Math.max(-160, Math.min(190, me.x + mx * step)), nz = Math.max(-80, Math.min(110, me.z + mz * step));
  if (!blocked(nx, me.z) && !Game?.blocksMove(nx, me.z)) me.x = nx;
  if (!blocked(me.x, nz) && !Game?.blocksMove(me.x, nz)) me.z = nz;
  me.heading = Math.atan2(mx, mz);
}
function animate(f, moving, seated, t) {
  if (moving) {
    const s = Math.sin(t * 11) * 0.7;
    f.legL.rotation.x = s; f.legR.rotation.x = -s; f.armL.rotation.x = -s * 0.8; f.armR.rotation.x = s * 0.8;
    f.body.position.y = Math.abs(Math.sin(t * 11)) * 0.04;
  } else {
    f.legL.rotation.x = f.legR.rotation.x = 0; f.body.position.y = 0;
    f.armL.rotation.x = Math.sin(t * 1.3 + 1) * 0.05; f.armR.rotation.x = Math.sin(t * 1.3) * 0.05;
  }
}
function updateAvatar(now, dt) {
  if (!me.fig) return;
  if (mode !== 'walk') me.moving = false;
  else if (!Town?.drive(dt, keys, cam, !!drag)) moveAvatar(dt);      // in the cart, the cart moves you
  const want = me.moving ? me.heading : me.fig.rot;
  const diff = ((want - me.fig.rot + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  me.fig.rot += diff * Math.min(1, dt * 12);
  me.fig.root.position.set(me.x, me.y ?? 0, me.z);
  me.fig.root.rotation.y = me.fig.rot;
  animate(me.fig, me.moving, false, now / 1000);
  Town?.pose(me.fig);
}

// third-person camera that stays on the avatar's side of walls
const camRay = new THREE.Raycaster();

const head = new THREE.Vector3(), want = new THREE.Vector3(), dir = new THREE.Vector3();
function placeWalkCamera() {
  const eye = 1.55 + (me.y ?? 0);
  head.set(me.x, eye, me.z);
  want.set(me.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist, eye + Math.sin(cam.pitch) * cam.dist, me.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist);
  dir.copy(want).sub(head);
  const len = dir.length(); dir.normalize();
  camRay.set(head, dir); camRay.far = len;
  const hit = camRay.intersectObjects(occluders.filter(shown), false)[0];
  if (hit) want.copy(head).addScaledVector(dir, Math.max(0.5, hit.distance - 0.3));
  camera.position.copy(want);
  camera.lookAt(head);
}

// what is in reach for "E"
let near = null;
const PODIUM = [28.6, 9.25], SHELVES = [4.8, 3.2], BOARD = [13.75, 0.6], MERGE = [24.3, 9.6];
function findNear() {
  if (mode !== 'walk' || !me.fig) return null;
  const d = (x, z) => Math.hypot(me.x - x, me.z - z);
  let best = null;
  const offer = (dist, max, label, act) => { if (dist < max && (!best || dist < best.dist)) best = { dist, label, act }; };
  for (const [id, f] of figures) {
    const a = S.agents.get(id);
    if (a) offer(d(f.root.position.x, f.root.position.z), 1.8, `Talk to ${a.name}`, () => AC.openAgent(id));
  }
  const open = AC.firstOpenDecision();
  offer(d(...PODIUM), 2.3, open ? `Answer ${S.agents.get(open.agentId)?.name ?? 'the team'}` : 'Podium: nothing waiting', () => { if (open) AC.openDecision(open.id); else AC.toast('Nothing is waiting for you.'); });
  const merge = [...S.decisions.values()].find((x) => x.status === 'open' && x.kind === 'merge');
  offer(d(...MERGE), 2.2, merge ? 'Review the merge' : 'Merge station: nothing to merge', () => { if (merge) AC.openDecision(merge.id); });
  offer(d(...SHELVES), 2.6, 'Open the library', () => AC.openLibrary());
  offer(d(...BOARD), 2.6, 'Look at the task wall', () => AC.focusTasks());
  peerNear(offer);
  Town?.near(offer);
  Arena?.near(offer);
  return best;
}

// ---------------------------------------------------------------------------------------------
// mouse: walk mode drags the camera around the avatar; overview orbits the building
// ---------------------------------------------------------------------------------------------
const el = renderer.domElement;
let drag = null;
el.addEventListener('contextmenu', (e) => e.preventDefault());
el.addEventListener('pointerdown', (e) => {
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  drag = { x: e.clientX, y: e.clientY, moved: 0, pan: e.button === 2 || e.shiftKey };
  el.setPointerCapture(e.pointerId);
  el.style.cursor = 'grabbing';
});
el.addEventListener('pointermove', (e) => {
  if (!drag) { hover(e); return; }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
  if (mode === 'walk') {
    cam.yaw -= dx * 0.006;
    cam.pitch = Math.max(0.05, Math.min(1.25, cam.pitch + dy * 0.005));
    return;
  }
  if (drag.pan) {
    const k = orbit.radius / 900;
    const fx = Math.cos(orbit.az), fz = -Math.sin(orbit.az);
    orbit.target.x -= (dx * fx + dy * Math.sin(orbit.az)) * k;
    orbit.target.z -= (dx * fz + dy * Math.cos(orbit.az)) * k;
    orbit.target.x = Math.max(-150, Math.min(190, orbit.target.x)); orbit.target.z = Math.max(-10, Math.min(62, orbit.target.z));
  } else {
    orbit.az -= dx * 0.006;
    orbit.polar = Math.max(0.25, Math.min(1.35, orbit.polar - dy * 0.005));
  }
  placeCamera();
});
el.addEventListener('pointerup', (e) => {
  el.style.cursor = 'grab';
  if (drag && drag.moved < 6) { if (e.button === 2) Game?.use(); else click(e); }
  drag = null;
});
el.addEventListener('wheel', (e) => {
  e.preventDefault();
  const k = 1 + Math.sign(e.deltaY) * 0.1;
  if (mode === 'walk') cam.dist = Math.max(2.5, Math.min(16, cam.dist * k));
  else { orbit.radius = Math.max(7, Math.min(60, orbit.radius * k)); placeCamera(); }
}, { passive: false });

const ray = new THREE.Raycaster();
function pick(e) {
  const r = el.getBoundingClientRect();
  ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, camera);
  const targets = [...clickables, ...[...figures.values()].map((f) => f.root)];
  return ray.intersectObjects(targets, true)[0]?.object ?? null;
}
function click(e) {
  if (mode === 'walk' && Game?.hit()) return;          // a bug or a block was in reach
  const o = pick(e);
  if (!o) { if (mode === 'walk') Game?.swing(); return; }
  if (o.userData.agentId) AC.openAgent(o.userData.agentId);
  else if (o.userData.click) o.userData.click();
}
function hover(e) {
  const o = pick(e);
  el.style.cursor = o && (o.userData.agentId || o.userData.click) ? 'pointer' : 'grab';
}

// ---------------------------------------------------------------------------------------------
// frame
// ---------------------------------------------------------------------------------------------
let size = '';
function resize() {
  const w = floorEl.clientWidth, h = floorEl.clientHeight, key = w + 'x' + h;
  if (key === size || !w || !h) return;
  size = key;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
const myPos = new THREE.Vector3();
function placeMyPlate() {
  if (!me.fig) { myPlate.hidden = true; return; }
  myPos.set(me.x, (me.y ?? 0) + 34 * PX + 0.15, me.z).project(camera);
  const w = floorEl.clientWidth, h = floorEl.clientHeight;
  myPlate.hidden = myPos.z > 1;
  const html = `<div class="who">${AC.esc(me.look.name)}</div><div class="what">you</div>`;
  if (myPlate.dataset.html !== html) { myPlate.innerHTML = html; myPlate.dataset.html = html; }
  myPlate.style.left = (myPos.x + 1) / 2 * w + 'px';
  myPlate.style.top = (1 - myPos.y) / 2 * h - 4 + 'px';
}

// ---------------------------------------------------------------------------------------------
// LAN multiplayer: coworkers' offices, avatars and chat (through the studio server's /world)
// ---------------------------------------------------------------------------------------------
const net = { ws: null, self: null, lastPos: '', lastSent: 0 };
const peersV = new Map();                         // id -> a coworker on the campus
const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// A place on the wire is written in the frame of the nearest office (whose owner everybody knows), so it means
// the same spot in every window although each window draws the campus around its own office.
function toWire(x, z, rot = 0) {
  let L = MYLOT, id = net.self?.id ?? '', best = Math.hypot(x - 16, z - 10);
  for (const p of peersV.values()) {
    if (!p.lot) continue;
    const [cx, cz] = p.lot.w(16, 10), dd = Math.hypot(x - cx, z - cz);
    if (dd < best) { best = dd; L = p.lot; id = p.id; }
  }
  const [dx, dz] = L.l(x, z);
  return { anchor: id, dx: +dx.toFixed(2), dz: +dz.toFixed(2), rot: +norm(rot - L.rot).toFixed(2) };
}
function fromWire(w) {
  if (!w || typeof w !== 'object' || !w.anchor) return null;
  const L = w.anchor === net.self?.id ? MYLOT : peersV.get(w.anchor)?.lot;
  if (!L || !Number.isFinite(w.dx) || !Number.isFinite(w.dz)) return null;
  const [x, z] = L.w(Math.max(-200, Math.min(200, w.dx)), Math.max(-200, Math.min(200, w.dz)));
  return { x, z, rot: (Number.isFinite(w.rot) ? w.rot : 0) + L.rot };
}
const projV = new THREE.Vector3();
function toScreen(x, y, z) {
  projV.set(x, y, z).project(camera);
  return { x: (projV.x + 1) / 2 * floorEl.clientWidth, y: (1 - projV.y) / 2 * floorEl.clientHeight, hidden: projV.z > 1 || Math.abs(projV.x) > 1.1 || Math.abs(projV.y) > 1.1 };
}

function netConnect() {
  const ws = new WebSocket(`ws://${location.host}/world`);
  net.ws = ws;
  ws.onopen = () => sendMe();
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onNet(m); };
  ws.onclose = () => { net.ws = null; for (const id of [...peersV.keys()]) dropPeer(id, true); setTimeout(netConnect, 2000); };
}
function netSend(m) { if (net.ws?.readyState === 1) net.ws.send(JSON.stringify(m)); }
function sendMe() { netSend({ type: 'me', name: me.look?.name || S.foreman?.userName || '', look: me.look }); }

function onNet(m) {
  switch (m.type) {
    case 'self': net.self = m; assignLots(); updatePeerChip(); break;
    case 'peer.join': upsertPeer(m.peer); break;
    case 'peer.presence': { const p = peersV.get(m.id); if (p) { p.name = m.name; p.look = m.look; refreshPeerLook(p); } break; }
    case 'peer.office': { const p = peersV.get(m.id); if (p) p.office = m.office; break; }
    case 'peer.pos': { const p = peersV.get(m.id); if (p) p.pos = m.pos; break; }
    case 'peer.chat': {
      const p = peersV.get(m.id);
      if (p) p.chat = { text: m.text, until: Date.now() + 8000 };
      AC.addFeed({ ts: m.ts, kind: 'message', text: `${m.name} (chat): ${m.text}` });
      AC.toast(`${m.name}: ${m.text}`);
      break;
    }
    case 'peer.g': { const p = peersV.get(m.id); if (p && m.d && typeof m.d === 'object' && typeof m.k === 'string') { Town?.onGame(p, m.k, m.d); Arena?.onGame(p, m.k, m.d); } break; }
    case 'peer.gone': dropPeer(m.id); break;
    case 'notice': AC.toast(m.text, 'warn'); break;
  }
}

function upsertPeer(v) {
  let p = peersV.get(v.id);
  const fresh = !p;
  if (!p) {
    p = { id: v.id, lot: null, O: null, agents: new Map(), avatar: null, chat: null, dom: null };
    peersV.set(v.id, p);
    AC.toast(`${v.name || 'A coworker'} is on the campus.`);
    AC.addFeed({ ts: Date.now(), kind: 'system', text: `${v.name || 'A coworker'} joined the campus` });
  }
  Object.assign(p, { name: v.name, look: v.look, office: v.office, pos: v.pos, addr: v.addr });
  assignLots();
  refreshPeerLook(p);
  updatePeerChip();
  if (fresh) { Town?.onJoin(p); Arena?.onJoin(p); }
}
// Everyone orders the campus the same way: players sorted by id take the lots in pairs across the road. Each
// window then shows that same campus, moved (and, if your own lot is a south one, turned around) so that your
// office is the one at the origin. That keeps distances and neighbours the same for everybody.
function assignLots() {
  if (!net.self) return;
  const ids = [net.self.id, ...peersV.keys()].sort();
  const r0 = ids.indexOf(net.self.id), c0 = r0 >> 1, s0 = r0 & 1;
  const moves = [];
  for (const p of peersV.values()) {
    const r = ids.indexOf(p.id), c = r >> 1, s = r & 1;
    const col = s0 ? c0 - c : c - c0, south = s0 ? !s : !!s;
    const L = LOTS.find((l) => l.col === col && l.south === south) ?? null;      // null: the campus is full
    if (L !== p.lot) moves.push([p, L]);
  }
  for (const [p] of moves) if (p.lot) { p.O.G.visible = false; p.lot.owner = null; p.lot = null; p.O = null; }
  for (const [p, L] of moves) {
    if (!L) continue;
    const O = (L.office ??= buildOffice(L, false));
    O.G.visible = true; O.cardKey = '';
    L.owner = p.id; p.lot = L; p.O = O;
    O.onPodium = () => AC.toast(`Only ${p.name} can answer their team's questions.`);
    O.onMerge = O.onPodium;
    O.onLibrary = () => AC.toast(`${p.name}'s library stays private.`);
    O.onBoard = () => openPeerTasks(p);
    O.paintSign(`${p.name || 'Coworker'}'s office`);
    L.deco.visible = true;
    Town?.dressLot(L);
  }
  for (const L of LOTS) { L.free.visible = !L.owner; L.deco.visible = !!L.owner || Math.abs(L.col) <= 1; }
}
function dropPeer(id, quiet) {
  const p = peersV.get(id);
  if (!p) return;
  if (p.avatar) scene.remove(p.avatar.fig.root);
  for (const g of p.agents.values()) { scene.remove(g.fig.root); g.plate?.remove(); }
  p.dom?.plate.remove(); p.dom?.say.remove();
  if (p.lot) { p.O.G.visible = false; p.lot.owner = null; p.lot = null; p.O = null; }
  Town?.onLeave(p); Arena?.onLeave(p);
  peersV.delete(id);
  assignLots();
  if (!quiet) { AC.toast(`${p.name} left the campus.`); AC.addFeed({ ts: Date.now(), kind: 'system', text: `${p.name} left the campus` }); }
  updatePeerChip();
}
function refreshPeerLook(p) {
  p.O?.paintSign(`${p.name || 'Coworker'}'s office`);
  const key = JSON.stringify(p.look);
  if (p.avatar && p.avatar.key === key) return;
  if (p.avatar) scene.remove(p.avatar.fig.root);
  const t = new THREE.CanvasTexture(paintSkin(p.look ?? LOOK_DEFAULT));
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  const fig = buildFigure({}, { base: mat({ map: t, alphaTest: 0.5 }), over: mat({ map: t, alphaTest: 0.5 }) });
  fig.root.visible = false;
  p.avatar = { fig, key, x: 0, z: 0, rot: 0, shown: false };
}

// a coworker's avatar: positions arrive relative to an office (theirs, yours, or someone else's)
function placePeerAvatar(p, now, dt) {
  const av = p.avatar, at = p.pos ? fromWire(p.pos) : null;
  if (!av || !at) { if (av) { av.fig.root.visible = false; av.shown = false; } Town?.peerPose(p, null); return; }
  if (!av.shown || Math.hypot(at.x - av.x, at.z - av.z) > 12) { av.x = at.x; av.z = at.z; av.rot = at.rot; av.shown = true; }
  const k = Math.min(1, dt * 10);
  av.x += (at.x - av.x) * k; av.z += (at.z - av.z) * k;
  av.rot += norm(at.rot - av.rot) * Math.min(1, dt * 12);
  av.fig.root.visible = true;
  av.fig.root.position.set(av.x, 0, av.z);
  av.fig.root.rotation.y = av.rot;
  animate(av.fig, p.pos.moving, false, now / 1000 + p.id.charCodeAt(0));
  Town?.peerPose(p, av);
}

// a coworker's agents, walking their own office from the activity summary
function placePeerAgents(p, now, dt) {
  const list = p.office?.agents ?? [];
  const deskIdx = new Map();
  let next = 1;
  for (const a of list) if (a.role === 'lead' && !deskIdx.has(a.id) && ![...deskIdx.values()].includes(0)) deskIdx.set(a.id, 0);
  for (const a of list) if (!deskIdx.has(a.id)) deskIdx.set(a.id, Math.min(next++, DESKS.length - 1));
  const at = new Map();
  for (const a of list) { const st = a.active ? a.station : 'lounge'; if (!at.has(st)) at.set(st, []); at.get(st).push(a.id); }
  for (const ids of at.values()) ids.sort();
  const keep = new Set();
  const t = now / 1000;
  const owners = new Map();
  for (const a of list) {
    keep.add(a.id);
    let g = p.agents.get(a.id);
    if (!g || g.skin !== a.skin) { if (g) scene.remove(g.fig.root); g = { fig: buildFigure({}, skinMaterials(a.skin)), skin: a.skin, x: null, y: null, rot: 0, heading: 0 }; p.agents.set(a.id, g); }
    g.a = a;
    const st = a.active ? a.station : 'lounge';
    let tx, ty, seated;
    if (st === 'desk') { const k = deskIdx.get(a.id); const d = DESKS[k]; tx = d.x + 1.5; ty = d.y + 2.05; seated = true; owners.set(k, a); }
    else { const spots = SPOTS[st] ?? SPOTS.lounge; [tx, ty] = spots[at.get(st).indexOf(a.id) % spots.length]; seated = st === 'meeting' || st === 'lounge'; }
    if (g.x === null) { g.x = tx; g.y = ty; }
    const dx = tx - g.x, dy = ty - g.y, dist = Math.hypot(dx, dy);
    const moving = dist > 0.05;
    if (moving) { const s = Math.min(1, 4.2 * dt / dist); g.x += dx * s; g.y += dy * s; g.heading = Math.atan2(dx, dy); }
    const sit = !moving && seated, deskSeat = sit && st === 'desk';
    const f = g.fig;
    const [wx, wz] = p.lot.w(g.x, deskSeat ? g.y - 0.5 : g.y);
    f.root.position.set(wx, sit ? -0.22 : 0, wz);
    const want = moving ? g.heading : (!a.active || st === 'lounge') ? 0 : st === 'meeting' ? (g.y < 16 ? 0 : Math.PI) : Math.PI;
    const diff = ((want - g.rot + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    g.rot += diff * Math.min(1, dt * 10);
    f.root.rotation.y = g.rot + p.lot.rot;
    const working = a.active && !a.paused && ['thinking', 'reading', 'editing', 'running', 'testing'].includes(a.state);
    if (moving || !sit) animate(f, moving, false, t + g.rot);
    else {
      f.legL.rotation.x = f.legR.rotation.x = -Math.PI / 2; f.body.position.y = 0;
      f.armL.rotation.x = deskSeat && working ? -1.1 + Math.sin(t * 18) * 0.08 : -0.3;
      f.armR.rotation.x = deskSeat && working ? -1.1 + Math.cos(t * 17) * 0.08 : -0.3;
    }
    g.head = [f.root.position.x, f.root.position.y + 34 * PX + 0.15, f.root.position.z];
  }
  for (const [id, g] of p.agents) if (!keep.has(id)) { scene.remove(g.fig.root); g.plate?.remove(); p.agents.delete(id); }
  // their office: screens, plaques, the podium lamp, the task board
  dressOffice(p.O, owners, p.office?.open ?? 0, now);
  fillCards(p.O, p.office?.tasks ?? []);
}
const insidePeer = (p) => mode === 'walk' && !!p.lot?.inside(me.x, me.z);

// nameplates for coworkers, their agents (while you are in their office) and chat bubbles
function peerPlates() {
  const dot = AC.STATE_COLOR;
  for (const p of peersV.values()) {
    if (!p.dom) {
      p.dom = { plate: document.createElement('div'), say: document.createElement('div') };
      p.dom.plate.className = 'plate peer'; p.dom.say.className = 'say';
      overlayEl.append(p.dom.plate, p.dom.say);
    }
    const av = p.avatar;
    const vis = av && av.shown && window.View3D.visible;
    const s = vis ? toScreen(av.x, 34 * PX + 0.15, av.z) : { hidden: true };
    p.dom.plate.hidden = s.hidden;
    if (!s.hidden) {
      const where = insideAt(av.x, av.z);
      const html = `<div class="who">${AC.esc(p.name || 'Coworker')}</div><div class="what">${AC.esc(where)}</div>`;
      if (p.dom.plate.dataset.h !== html) { p.dom.plate.innerHTML = html; p.dom.plate.dataset.h = html; }
      p.dom.plate.style.left = s.x + 'px'; p.dom.plate.style.top = s.y - 4 + 'px';
    }
    const talk = p.chat && p.chat.until > Date.now() && !s.hidden;
    p.dom.say.hidden = !talk;
    if (talk) {
      if (p.dom.say.textContent !== p.chat.text) p.dom.say.textContent = p.chat.text;
      p.dom.say.style.left = s.x + 'px'; p.dom.say.style.top = s.y - 40 + 'px';
    }
    const inside = insidePeer(p) && window.View3D.visible;
    for (const g of p.agents.values()) {
      if (!g.plate) { g.plate = document.createElement('div'); g.plate.className = 'plate'; g.plate.onclick = () => openPeerAgent(p, g.a); overlayEl.append(g.plate); }
      const sc = inside && g.head ? toScreen(...g.head) : { hidden: true };
      g.plate.hidden = sc.hidden;
      if (sc.hidden) continue;
      const a = g.a;
      const html = `<div class="who"><span class="dot" style="background:${a.active ? dot[a.state] : '#6b5a4c'}"></span>${AC.esc(a.name)}</div><div class="what">${AC.esc(a.active ? a.activity || a.state : 'off shift')}</div>`;
      if (g.plate.dataset.h !== html) { g.plate.innerHTML = html; g.plate.dataset.h = html; }
      g.plate.style.left = sc.x + 'px'; g.plate.style.top = sc.y - 4 + 'px';
    }
  }
}
function insideAt(x, z) {
  if (MYLOT.inside(x, z)) return 'in your office';
  for (const q of peersV.values()) if (q.lot?.inside(x, z)) return `in ${q.name}'s office`;
  return Town?.where(x, z) ?? 'on the campus';
}

// read-only views of a coworker's team
function openPeerAgent(p, a) {
  if (!a) return;
  AC.modal('peer-agent', a.id, `
    <div class="m-head"><h1>${AC.esc(a.name)} <span class="sub">${AC.esc(p.name)}'s team &middot; ${AC.esc(a.role)}</span></h1><button class="x" data-close aria-label="Close">&times;</button></div>
    <div class="m-body"><dl class="kv">
      <dt>Now</dt><dd><span class="dot" style="background:${AC.STATE_COLOR[a.state]}"></span> ${AC.esc(a.paused ? 'paused' : a.active ? a.state.replace('_', ' ') : 'off shift')}${a.activity ? ' &middot; ' + AC.esc(a.activity) : ''}</dd>
      <dt>Task</dt><dd>${a.task ? AC.esc(a.task) : '<span class="muted">none</span>'}</dd>
    </dl><p class="muted">You are visiting. Only ${AC.esc(p.name)} can talk to, steer or approve their team.</p></div>`);
}
function openPeerTasks(p) {
  const o = p.office;
  const tasks = o?.tasks ?? [];
  const col = (s) => tasks.filter((t) => (s === 'todo' ? t.status === 'todo' || t.status === 'blocked' : t.status === s));
  AC.modal('peer-tasks', p.id, `
    <div class="m-head"><h1>${AC.esc(p.name)}'s task wall</h1><button class="x" data-close aria-label="Close">&times;</button></div>
    <div class="m-body">
      ${o?.goal ? `<p><b>${AC.esc(o.goal.text)}</b> <span class="muted">(${AC.esc(o.goal.status)}, ${Math.round(o.goal.progress * 100)}%)</span></p>` : '<p class="muted">No goal right now.</p>'}
      <div class="kanban light">${['todo', 'doing', 'review', 'done'].map((s) => `<div class="col"><h3>${s} ${col(s).length}</h3>${col(s).map((t) => `<div class="card ${t.status}"><span class="tid">${AC.esc(t.id)}</span> ${AC.esc(t.title)}</div>`).join('')}</div>`).join('')}</div>
      ${o?.open ? `<p class="muted">${o.open} decision${o.open > 1 ? 's' : ''} waiting for ${AC.esc(p.name)}.</p>` : ''}
    </div>`);
}

// "E" near coworkers' things
function peerNear(offer) {
  const d = (x, z) => Math.hypot(me.x - x, me.z - z);
  for (const p of peersV.values()) {
    if (p.avatar?.shown) offer(d(p.avatar.x, p.avatar.z), 2, `Talk to ${p.name}`, () => { AC.prefill('/say '); });
    if (!p.lot || d(...p.lot.w(16, 10)) > 30) continue;
    for (const g of p.agents.values()) if (g.head) offer(d(g.head[0], g.head[2]), 1.8, `Watch ${g.a.name} (${p.name}'s team)`, () => openPeerAgent(p, g.a));
    offer(d(...p.lot.w(28.6, 9.25)), 2.3, `${p.name}'s podium`, () => p.O.onPodium());
    offer(d(...p.lot.w(13.75, 0.6)), 2.6, `Look at ${p.name}'s task wall`, () => openPeerTasks(p));
  }
}

// send where you are about 10 times a second, relative to the nearest office
function sendPos(now) {
  if (!net.ws || net.ws.readyState !== 1 || !net.self) return;
  if (now - net.lastSent < 100) return;
  const msg = me.fig ? { type: 'pos', ...toWire(me.x, me.z, me.fig.rot), moving: me.moving, car: !!Town?.driving() } : { type: 'pos', anchor: '', dx: 0, dz: 0, rot: 0, moving: false };
  const key = JSON.stringify(msg);
  if (key === net.lastPos && now - net.lastSent < 2000) return;
  net.lastPos = key; net.lastSent = now;
  netSend(msg);
}

// chat from the console (/chat ...)
const mySay = document.createElement('div'); mySay.className = 'say'; mySay.hidden = true; overlayEl.append(mySay);
let myChat = null;
function chat(text) {
  text = String(text ?? '').trim().slice(0, 300);
  if (!text) return;
  netSend({ type: 'chat', text });
  myChat = { text, until: Date.now() + 8000 };
  AC.addFeed({ ts: Date.now(), kind: 'user', text: `${me.look?.name || 'You'} (chat): ${text}` });
  if (!peersV.size) AC.toast('Nobody else is on the campus yet. Open "Coworkers" to connect.', 'warn');
}
function placeMySay() {
  const talk = myChat && myChat.until > Date.now() && !myPlate.hidden;
  mySay.hidden = !talk;
  if (!talk) return;
  if (mySay.textContent !== myChat.text) mySay.textContent = myChat.text;
  mySay.style.left = myPlate.style.left;
  mySay.style.top = parseFloat(myPlate.style.top) - 40 + 'px';
}

// the "Coworkers" button and panel
const btnPeers = document.createElement('button'); btnPeers.className = 'ghost';
header.before(btnPeers);
btnPeers.onclick = () => renderPeersPanel();
function updatePeerChip() {
  const n = peersV.size;
  btnPeers.innerHTML = `Coworkers <span class="count${n ? ' on' : ''}">${n}</span>`;
  btnPeers.title = net.self?.lan === false ? 'LAN is off' : 'Coworkers on the LAN: connect, team code';
  if (AC.modalKind() === 'peers') renderPeersPanel(true);      // someone joined or left, or our settings changed
}
updatePeerChip();
function renderPeersPanel(refresh) {
  const s = net.self;
  const list = [...peersV.values()];
  // a refresh must not eat what is being typed
  const typed = refresh ? { host: document.getElementById('pp-host')?.value, code: document.getElementById('pp-code')?.value, focus: document.activeElement?.id } : null;
  AC.modal('peers', '', `
    <div class="m-head"><h1>Coworkers <span class="sub">your campus on the local network</span></h1><button class="x" data-close aria-label="Close">&times;</button></div>
    <div class="m-body">
      <p>${list.length ? `On the campus now:` : 'Nobody else yet. Coworkers running War Room on the same network appear by themselves; if they do not, add them by PC name or address.'}</p>
      ${list.length ? `<ul class="peers">${list.map((p) => `<li><b>${AC.esc(p.name)}</b> <span class="muted">${AC.esc(p.addr ?? '')} &middot; ${AC.esc(p.office?.backend === 'sim' ? 'demo team' : p.office?.backend ?? '')}</span></li>`).join('')}</ul>` : ''}
      <h3>Add a coworker</h3>
      <div class="row"><input type="text" id="pp-host" placeholder="PC name or IP address, e.g. DANA-LAPTOP or 10.0.4.17"><button id="pp-add">Connect</button></div>
      ${s?.hosts?.length ? `<p class="muted">Saved: ${s.hosts.map((h) => `${AC.esc(h)} <a href="#" data-forget="${AC.esc(h)}">forget</a>`).join(' &middot; ')}</p>` : ''}
      <h3>Your address</h3>
      <p>Others can add you as <b>${AC.esc(s?.host ?? '?')}</b>${s?.addrs?.length ? ` or <b>${s.addrs.map(AC.esc).join('</b>, <b>')}</b>` : ''} <span class="muted">(port ${s?.port ?? 7891})</span></p>
      <h3>Team code</h3>
      <p class="muted">Optional. With a code, only coworkers who type the same code can join your campus. Empty = anyone running War Room on this network.</p>
      <div class="row"><input type="password" id="pp-code" value="${AC.esc(s?.code ?? '')}" placeholder="no code"><button class="quiet" id="pp-save">Save code</button></div>
      <p class="muted">Shared with coworkers: your name and avatar, where you walk, chat, and your team's activity (agents' status lines, task titles, progress). Never logs, diffs or code, and nobody else can answer your agents.</p>
    </div>`);
  if (typed?.host) document.getElementById('pp-host').value = typed.host;
  if (typeof typed?.code === 'string') document.getElementById('pp-code').value = typed.code;
  if (typed?.focus === 'pp-host' || typed?.focus === 'pp-code') document.getElementById(typed.focus).focus();
  const add = () => { const h = document.getElementById('pp-host').value.trim(); if (h) { document.getElementById('pp-host').value = ''; netSend({ type: 'peer.add', host: h }); AC.toast(`Connecting to ${h}...`); } };
  document.getElementById('pp-add').onclick = add;
  document.getElementById('pp-host').onkeydown = (e) => { if (e.key === 'Enter') add(); };
  document.getElementById('pp-save').onclick = () => { netSend({ type: 'code', code: document.getElementById('pp-code').value }); AC.toast('Team code saved. Reconnecting...'); };
  for (const a of document.querySelectorAll('[data-forget]')) a.onclick = (e) => { e.preventDefault(); netSend({ type: 'peer.forget', host: a.dataset.forget }); };
}
netConnect();

function updatePeers(now, dt) {
  for (const p of peersV.values()) {
    placePeerAvatar(p, now, dt);
    if (!p.lot) continue;
    placePeerAgents(p, now, dt);
    p.O.roof.visible = !insidePeer(p);
  }
  sendPos(now);
  const fx = mode === 'walk' ? me.x : orbit.target.x, fz = mode === 'walk' ? me.z : orbit.target.z;
  sun.target.position.set(fx, 0, fz); sun.position.set(fx - 8, 30, fz + 16);
}

Game = initGame({
  THREE, scene, camera, el, floorEl, overlayEl, me, mat, AC, S, sun, hemi, blocked, busy, toScreen,
  lots: () => [MYLOT, ...LOTS], getMode: () => mode, isVisible: () => !!window.View3D?.visible,
});
const W = {
  THREE, scene, camera, el, floorEl, overlayEl, me, cam, mat, M, AC, S, box, plane, colliders, blocked, busy, toScreen, toWire, fromWire, netSend,
  peersV, MYLOT, LOTS, PX, buildFigure, skinMaterials, animate, shade,
  build: (L, parent, fn) => { const prev = BUILD; BUILD = { parent, lot: L }; try { return fn(); } finally { BUILD = prev; } },
  bubble: (text) => { myChat = { text, until: Date.now() + 8000 }; },
  getMode: () => mode, isVisible: () => !!window.View3D?.visible, myId: () => net.self?.id ?? '', myName: () => me.look?.name || 'You', game: () => Game,
};
Town = initTown(W);
window.WRView = { me, cam, orbit, peersV, MYLOT, LOTS, placeCamera, colliders };   // for tests and screenshots
Arena = initArena(W, Town);
setMode(mode);
window.View3D = {
  visible: false,
  setVisible(v) {
    this.visible = v;
    el.style.display = v ? 'block' : 'none';
    for (const x of [btnMode, btnAvatar, help]) x.style.display = v ? '' : 'none';
    myPlate.hidden = !v; if (!v) { hint.hidden = true; peerPlates(); placeMySay(); Game?.show(false); Arena?.show(false); }
  },
  chat: (text) => chat(text),
  say: (text) => Town?.say(text),
  announce: (text) => Town?.announce(text),
  cart: () => Town?.recall(),
  arena: (args) => Arena?.command(args),
  render(now, dt) {
    resize();
    paintCode(now);
    updateCards();
    updateDesks();
    updateAvatar(now, dt);
    Game?.update(now, dt);
    Town?.update(now, dt);
    Arena?.update(now, dt);
    roof.visible = walkOutside();
    frontWall.visible = mode === 'walk';
    if (mode === 'walk' && me.fig) placeWalkCamera();
    updateFigures(now, dt);
    updatePeers(now, dt);
    renderer.render(scene, camera);
    placeMyPlate();
    peerPlates();
    placeMySay();
    near = findNear();
    hint.hidden = !near;
    if (near) { const t = `<kbd>E</kbd> ${AC.esc(near.label)}`; if (hint.dataset.t !== t) { hint.innerHTML = t; hint.dataset.t = t; } }
  },
};
