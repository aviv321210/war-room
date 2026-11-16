// War Room: the play layer of the campus. A block world to mine and build in, a backpack, and
// bugs to fight. Everything here is local game state: it only READS the team's status (failing
// tests bring out more bugs, finished tasks pay a few bytes) and can never message an agent,
// answer a decision, spend tokens or touch a repository. All art is drawn here, pixel by pixel.
export function initGame(C) {
  const { THREE, scene, camera, el, floorEl, overlayEl, me, mat, AC, S, sun, hemi } = C;
  const LOTS = C.lots();                           // every place an office can stand, on both sides of the road
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const load = (k, d) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : d; } catch { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };

  // -------------------------------------------------------------------------------------------
  // pixel art: 16 x 16 block faces and item icons
  // -------------------------------------------------------------------------------------------
  function art(seed, paint) {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const x = c.getContext('2d'), r = rng(seed);
    const f = (col, X, Y, W = 1, H = 1) => { x.fillStyle = col; x.fillRect(X, Y, W, H); };
    paint(f, r, x);
    return c;
  }
  const speckle = (f, r, base, cols, dens = 0.5) => { f(base, 0, 0, 16, 16); for (let i = 0; i < 256 * dens; i++) f(cols[(r() * cols.length) | 0], (r() * 16) | 0, (r() * 16) | 0); };
  const ART = {
    stone: art(11, (f, r) => { speckle(f, r, '#8b8d91', ['#7c7e83', '#9a9ca0', '#74767b']); for (let i = 0; i < 5; i++) f('#63656a', (r() * 12) | 0, (r() * 16) | 0, 2 + ((r() * 3) | 0), 1); }),
    cobble: art(12, (f, r) => {
      f('#55575c', 0, 0, 16, 16);
      for (let row = 0; row < 4; row++) for (let x0 = row % 2 ? -2 : 0; x0 < 16;) {
        const w = 3 + ((r() * 3) | 0), g = ['#8f9196', '#a2a4a8', '#7d7f84', '#96989c'][(r() * 4) | 0];
        f(g, x0, row * 4, w, 3); f('#b4b6ba', x0, row * 4, w, 1); x0 += w + 1;
      }
    }),
    planks: art(13, (f, r) => { speckle(f, r, '#b98f52', ['#ad8348', '#c49a5c', '#a57b42'], 0.35); for (let y = 3; y < 16; y += 4) f('#7d5d30', 0, y, 16, 1); for (let row = 0; row < 4; row++) { f('#7d5d30', (row * 7 + 4) % 16, row * 4, 1, 3); f('#5f4524', (row * 7 + 6) % 16, row * 4 + 1); } }),
    log: art(14, (f, r) => { f('#6a492e', 0, 0, 16, 16); for (let x0 = 0; x0 < 16; x0++) { const c = ['#5c3f27', '#775436', '#6a492e', '#523822'][(r() * 4) | 0]; for (let y = 0; y < 16; y++) if (r() < 0.8) f(c, x0, y); } }),
    logTop: art(15, (f) => { f('#6a492e', 0, 0, 16, 16); f('#c9a66b', 1, 1, 14, 14); for (const [i, c] of [[3, '#a98850'], [5, '#c9a66b'], [6, '#a98850']]) { f(c, i, i, 16 - 2 * i, 16 - 2 * i); } f('#8a6c3c', 7, 7, 2, 2); }),
    leaves: art(16, (f, r) => { speckle(f, r, '#4d8a3c', ['#417a32', '#5c9c48', '#376b2a', '#69ab52'], 0.7); for (let i = 0; i < 9; i++) f('#2c5a22', (r() * 16) | 0, (r() * 16) | 0); }),
    brick: art(17, (f, r) => { f('#cfc5b4', 0, 0, 16, 16); for (let row = 0; row < 4; row++) for (let x0 = row % 2 ? -4 : 0; x0 < 16; x0 += 8) { f(['#a14c3b', '#974434', '#ab5644'][(r() * 3) | 0], x0, row * 4, 7, 3); f('#b96652', x0, row * 4, 7, 1); } }),
    sand: art(18, (f, r) => speckle(f, r, '#dccf98', ['#d2c48a', '#e6daa8', '#c9ba7e'], 0.5)),
    glass: art(19, (f, r, x) => { x.clearRect(0, 0, 16, 16); f('rgba(190,228,240,.28)', 0, 0, 16, 16); f('#e6f6fb', 0, 0, 16, 1); f('#e6f6fb', 0, 0, 1, 16); f('#9cc9d8', 0, 15, 16, 1); f('#9cc9d8', 15, 0, 1, 16); for (let i = 0; i < 4; i++) { f('#f4fcff', 3 + i, 6 - i); f('#f4fcff', 9 + i, 12 - i); } }),
    lamp: art(20, (f) => { f('#5f4428', 0, 0, 16, 16); f('#ffe7a0', 2, 2, 12, 12); f('#fff6d2', 4, 4, 8, 8); f('#5f4428', 7, 0, 2, 16); f('#5f4428', 0, 7, 16, 2); f('#ffd470', 2, 2, 12, 1); }),
    ore: art(21, (f, r) => { speckle(f, r, '#8b8d91', ['#7c7e83', '#9a9ca0', '#74767b']); for (let i = 0; i < 6; i++) { const X = 1 + ((r() * 12) | 0), Y = 1 + ((r() * 12) | 0); f('#2bbfb4', X, Y, 2, 2); f('#8ff2e6', X, Y); f('#167f78', X + 1, Y + 1); } }),
  };
  const line = (f, col, x0, y0, n, dx = 1, dy = -1, w = 1) => { for (let i = 0; i < n; i++) f(col, x0 + i * dx, y0 + i * dy, w, w); };
  const ICON = {
    swatter: art(31, (f, r, x) => { x.clearRect(0, 0, 16, 16); line(f, '#6a492e', 1, 14, 8, 1, -1, 2); f('#b8483c', 8, 1, 7, 7); for (let i = 0; i < 3; i++) { f('#e9d8c8', 9 + i * 2, 1, 1, 7); f('#e9d8c8', 8, 2 + i * 2, 7, 1); } }),
    blade: art(32, (f, r, x) => { x.clearRect(0, 0, 16, 16); line(f, '#bfeee8', 5, 10, 9, 1, -1, 2); line(f, '#f2fffd', 6, 10, 8); f('#3a2c23', 3, 9, 2, 2); f('#3a2c23', 5, 11, 2, 2); f('#c9a227', 4, 10, 3, 3); line(f, '#6a492e', 1, 14, 3, 1, -1, 2); }),
    pick: art(33, (f, r, x) => { x.clearRect(0, 0, 16, 16); line(f, '#6a492e', 2, 14, 10, 1, -1, 2); f('#9a9ca0', 5, 2, 9, 2); f('#9a9ca0', 12, 2, 2, 9); f('#c4c6ca', 5, 2, 9, 1); f('#74767b', 3, 3, 2, 2); f('#74767b', 12, 11, 2, 2); }),
    byte: art(34, (f, r, x) => { x.clearRect(0, 0, 16, 16); for (let i = 0; i < 6; i++) { f('#2bbfb4', 7 - i, 2 + i, 2 + 2 * i, 1); f('#1f9c93', 7 - i, 13 - i, 2 + 2 * i, 1); } f('#8ff2e6', 6, 4, 2, 3); f('#0f6f69', 2, 7, 12, 1); }),
    shell: art(35, (f, r, x) => { x.clearRect(0, 0, 16, 16); f('#3f7d3a', 4, 3, 8, 11); f('#3f7d3a', 3, 5, 10, 7); f('#5fa857', 5, 4, 3, 4); f('#2b5a28', 8, 3, 1, 11); f('#2b5a28', 4, 13, 8, 1); }),
    coffee: art(36, (f, r, x) => { x.clearRect(0, 0, 16, 16); f('#f4efe6', 3, 7, 8, 7); f('#f4efe6', 11, 8, 3, 1); f('#f4efe6', 13, 9, 1, 3); f('#f4efe6', 11, 11, 3, 1); f('#5a3a22', 4, 7, 6, 2); f('#d8ccb8', 3, 13, 8, 1); f('#cfc5b4', 5, 2, 1, 3); f('#cfc5b4', 8, 3, 1, 3); }),
  };
  const texOf = (c) => { const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t; };
  const url = (c) => c.toDataURL();

  // blocks: hp = hits by hand; drop = what you get
  const logSide = mat({ map: texOf(ART.log) }), logTop = mat({ map: texOf(ART.logTop) });
  const BLOCKS = {
    stone: { name: 'Stone', hp: 3, drop: 'cobble', mat: mat({ map: texOf(ART.stone) }), dust: '#8b8d91' },
    cobble: { name: 'Cobble', hp: 3, mat: mat({ map: texOf(ART.cobble) }), dust: '#8f9196' },
    planks: { name: 'Planks', hp: 2, mat: mat({ map: texOf(ART.planks) }), dust: '#b98f52' },
    log: { name: 'Log', hp: 2, mat: [logSide, logSide, logTop, logTop, logSide, logSide], dust: '#6a492e' },
    leaves: { name: 'Leaves', hp: 1, mat: mat({ map: texOf(ART.leaves) }), dust: '#4d8a3c' },
    brick: { name: 'Brick', hp: 3, mat: mat({ map: texOf(ART.brick) }), dust: '#a14c3b' },
    sand: { name: 'Sand', hp: 1, mat: mat({ map: texOf(ART.sand) }), dust: '#dccf98' },
    glass: { name: 'Glass', hp: 1, mat: mat({ map: texOf(ART.glass), transparent: true }), dust: '#cfeaf2', clear: true },
    lamp: { name: 'Lamp', hp: 1, mat: mat({ map: texOf(ART.lamp), emissive: '#ffd98a', emissiveMap: texOf(ART.lamp), emissiveIntensity: 0.9 }), dust: '#ffe7a0', clear: true },
    ore: { name: 'Byte ore', hp: 4, drop: 'byte', mat: mat({ map: texOf(ART.ore) }), dust: '#2bbfb4' },
  };
  const ITEMS = {
    swatter: { name: 'Bug swatter', kind: 'weapon', dmg: 2, icon: url(ICON.swatter), tip: 'Hits bugs for 2' },
    blade: { name: 'Debugger', kind: 'weapon', dmg: 5, icon: url(ICON.blade), tip: 'Hits bugs for 5' },
    pick: { name: 'Refactor pick', kind: 'tool', dmg: 2, dig: 3, icon: url(ICON.pick), tip: 'Breaks blocks three times faster' },
    byte: { name: 'Byte', kind: 'mat', icon: url(ICON.byte), tip: 'From ore, bugs, and tasks your team finishes' },
    shell: { name: 'Bug shell', kind: 'mat', icon: url(ICON.shell), tip: 'Dropped by bugs' },
    coffee: { name: 'Coffee', kind: 'food', heal: 6, icon: url(ICON.coffee), tip: 'Right-click to drink: +3 hearts' },
  };
  for (const [id, b] of Object.entries(BLOCKS)) ITEMS[id] = { name: b.name, kind: 'block', icon: url(ART[id]), tip: 'Right-click to place' };
  const RECIPES = [
    { out: ['planks', 4], in: [['log', 1]] },
    { out: ['brick', 4], in: [['cobble', 4]] },
    { out: ['glass', 2], in: [['sand', 2]] },
    { out: ['lamp', 2], in: [['planks', 1], ['byte', 1]] },
    { out: ['pick', 1], in: [['planks', 2], ['cobble', 3]] },
    { out: ['blade', 1], in: [['planks', 1], ['shell', 3], ['byte', 2]] },
    { out: ['coffee', 1], in: [['byte', 1], ['leaves', 2]] },
  ];

  // -------------------------------------------------------------------------------------------
  // the block world: 1 m cubes on a grid, outside the offices only
  // -------------------------------------------------------------------------------------------
  const cells = new Map();                       // "x,y,z" -> { t, x, y, z, hp, nat }
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const has = (x, y, z) => cells.has(key(x, y, z));
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const blockGroup = new THREE.Group(); scene.add(blockGroup);
  // drawn as one instanced mesh per block type (a thousand separate cubes would be a thousand draw calls)
  const layers = {}, m4 = new THREE.Matrix4();
  function rebuild(t) {
    const L = layers[t]; L.dirty = false;
    if (L.list.length > L.cap) {
      if (L.mesh) { blockGroup.remove(L.mesh); L.mesh.dispose(); }
      L.cap = Math.max(64, L.list.length * 2);
      L.mesh = new THREE.InstancedMesh(geo, BLOCKS[t].mat, L.cap);
      L.mesh.castShadow = !BLOCKS[t].clear; L.mesh.receiveShadow = true; L.mesh.frustumCulled = false; L.mesh.userData.layer = L;
      blockGroup.add(L.mesh);
    }
    if (!L.mesh) return;
    L.list.forEach((c, i) => L.mesh.setMatrixAt(i, m4.makeTranslation(c.x + 0.5, c.y + 0.5, c.z + 0.5)));
    L.mesh.count = L.list.length; L.mesh.instanceMatrix.needsUpdate = true;
    L.mesh.boundingSphere = null; L.mesh.boundingBox = null;      // recomputed by the next raycast
  }
  const rebuildDirty = () => { for (const t in layers) if (layers[t].dirty) rebuild(t); };
  const saved = load('wr-world2', { placed: {}, mined: [] });
  const mined = new Set(saved.mined);
  const placed = new Map(Object.entries(saved.placed ?? {}));
  let saveTimer = null;
  const saveSoon = () => { saveTimer ??= setTimeout(() => { saveTimer = null; store('wr-world2', { placed: Object.fromEntries(placed), mined: [...mined] }); store('wr-player', { inv, sel, xp, hp: Math.ceil(hp), sound }); }, 800); };

  // inside a building that is standing (yours, or a coworker's)
  const inOffice = (x, z) => LOTS.some((L) => { if (L.col || L.south) { if (!L.owner) return false; } const [lx, lz] = L.l(x, z); return lx > -0.4 && lx < 32.4 && lz > -0.4 && lz < 20.5; });
  function canBuild(x, z) {       // cell (x, z): keep the buildings, their doorsteps and the road free
    const cx = x + 0.5, cz = z + 0.5;
    if (cx < -158 || cx > 188 || cz < -78 || cz > 108) return false;
    if (cz > 23.5 && cz < 28.5) return false;
    return !LOTS.some((L) => { const [lx, lz] = L.l(cx, cz); return lx > -1.5 && lx < 46.5 && lz > -1.5 && lz < 23.5; });   // office, doorstep, holding cells
  }
  function setBlock(x, y, z, t, nat) {
    const b = BLOCKS[t];
    if (!b || cells.has(key(x, y, z))) return;
    const c = { t, x, y, z, hp: b.hp, nat }, L = (layers[t] ??= { list: [], mesh: null, cap: 0, dirty: false });
    L.list.push(c); L.dirty = true;
    cells.set(key(x, y, z), c);
  }
  function delBlock(x, y, z) {
    const k = key(x, y, z), c = cells.get(k);
    if (!c) return;
    const L = layers[c.t]; L.list.splice(L.list.indexOf(c), 1); L.dirty = true; cells.delete(k);
    if (c.nat) mined.add(k); else placed.delete(k);
    saveSoon();
  }
  // the wild part of the campus: the same for everyone (seeded), minus what you already mined
  (function grow() {
    const r = rng(20261116);
    const nat = (x, y, z, t) => { if (canBuild(x, z) && !mined.has(key(x, y, z)) && !(y === 0 && C.blocked(x + 0.5, z + 0.5))) setBlock(x, y, z, t, true); };
    for (let n = 0; n < 150; n++) {
      const front = n < 9 || r() < 0.55;
      const x = Math.round(n < 9 ? -10 + r() * 54 : -150 + r() * 330), z = Math.round(n < 9 ? -3 - r() * 11 : front ? 56 + r() * 40 : -5 - r() * 40);   // the first few right behind your office
      const kind = r();
      if (kind < 0.42) {                                             // a stone outcrop with some ore
        let cx = x, cz = z;
        for (let i = 0, m = 4 + ((r() * 6) | 0); i < m; i++) {
          const h = 1 + (r() < 0.45 ? 1 : 0) + (r() < 0.12 ? 1 : 0);
          for (let y = 0; y < h; y++) nat(cx, y, cz, r() < 0.16 ? 'ore' : r() < 0.25 ? 'cobble' : 'stone');
          if (r() < 0.5) cx += r() < 0.5 ? 1 : -1; else cz += r() < 0.5 ? 1 : -1;
        }
      } else if (kind < 0.75) {                                      // a tree
        const h = 3 + ((r() * 2) | 0);
        if (!canBuild(x, z) || C.blocked(x + 0.5, z + 0.5)) continue;
        for (let y = 0; y < h; y++) nat(x, y, z, 'log');
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          if (dx || dz) { if (r() < 0.85) nat(x + dx, h - 1, z + dz, 'leaves'); }
          if (!(dx && dz) || r() < 0.6) nat(x + dx, h, z + dz, 'leaves');
        }
        nat(x, h + 1, z, 'leaves');
      } else {                                                       // a sand patch
        let cx = x, cz = z;
        for (let i = 0, m = 4 + ((r() * 5) | 0); i < m; i++) { nat(cx, 0, cz, 'sand'); if (r() < 0.5) cx += r() < 0.5 ? 1 : -1; else cz += r() < 0.5 ? 1 : -1; }
      }
    }
    for (const [k, t] of placed) { const [x, y, z] = k.split(',').map(Number); if (canBuild(x, z)) setBlock(x, y, z, t, false); }
    rebuildDirty();
  })();

  // is there a block in the way of a body at (x, z) with its feet at y?
  function solid(x, z, y = me.y ?? 0, h = 1.75, r = 0.3) {
    for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) for (let cz = Math.floor(z - r); cz <= Math.floor(z + r); cz++)
      for (let cy = Math.max(0, Math.floor(y + 0.05)); cy <= Math.floor(y + h); cy++) if (has(cx, cy, cz)) return true;
    return false;
  }
  function support(x, z, y, r = 0.3) {             // the height of what is under a body
    let top = 0;
    for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) for (let cz = Math.floor(z - r); cz <= Math.floor(z + r); cz++)
      for (let cy = Math.floor(y + 0.01) - 1; cy >= 0; cy--) if (has(cx, cy, cz)) { top = Math.max(top, cy + 1); break; }
    return top;
  }

  // -------------------------------------------------------------------------------------------
  // you: backpack, hearts, experience
  // -------------------------------------------------------------------------------------------
  const P = load('wr-player', null);
  const inv = Array.from({ length: 36 }, (_, i) => { const s = P?.inv?.[i]; return s && ITEMS[s.id] && s.n > 0 ? { id: s.id, n: s.n } : null; });
  if (!P) { [['swatter', 1], ['planks', 24], ['glass', 8], ['lamp', 4], ['coffee', 2]].forEach(([id, n], i) => { inv[i] = { id, n }; }); }
  let sel = clamp(P?.sel ?? 0, 0, 8), xp = P?.xp ?? 0, hp = clamp(P?.hp ?? 20, 1, 20), sound = P?.sound ?? true;
  let lastHurt = -1e9, swing = 0, coolUntil = 0, vy = 0, onGround = true, wantJump = false, dirty = true;
  me.y ??= 0;
  const stackMax = (id) => (['weapon', 'tool'].includes(ITEMS[id].kind) ? 1 : 64);
  const count = (id) => inv.reduce((n, s) => n + (s?.id === id ? s.n : 0), 0);
  function give(id, n = 1) {
    for (const s of inv) if (n > 0 && s?.id === id && s.n < stackMax(id)) { const k = Math.min(n, stackMax(id) - s.n); s.n += k; n -= k; }
    for (let i = 0; i < inv.length && n > 0; i++) if (!inv[i]) { const k = Math.min(n, stackMax(id)); inv[i] = { id, n: k }; n -= k; }
    dirty = true; saveSoon();
    return n;                                      // what did not fit
  }
  function take(id, n = 1) {
    if (count(id) < n) return false;
    for (let i = inv.length - 1; i >= 0 && n > 0; i--) if (inv[i]?.id === id) { const k = Math.min(n, inv[i].n); inv[i].n -= k; n -= k; if (!inv[i].n) inv[i] = null; }
    dirty = true; saveSoon();
    return true;
  }
  const held = () => inv[sel];
  const level = () => Math.floor(Math.sqrt(xp / 12));
  function gainXp(n) { const before = level(); xp += n; dirty = true; saveSoon(); if (level() > before) { AC.toast(`Level ${level()}!`); tone(660, 0.12, 'triangle', 0.05, 440); } }

  // small sounds, off with the switch in the backpack
  let actx = null;
  function tone(f, d = 0.07, type = 'square', v = 0.03, slide = 0) {
    if (!sound) return;
    try {
      actx ??= new AudioContext();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.linearRampToValueAtTime(Math.max(40, f + slide), t + d);
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + d);
    } catch { /* no audio */ }
  }

  // -------------------------------------------------------------------------------------------
  // HUD: hearts, experience, hotbar
  // -------------------------------------------------------------------------------------------
  const heart = (fill) => url(art(1, (f, r, x) => {
    x.clearRect(0, 0, 16, 16);
    const rows = ['0110110', '1111111', '1111111', '1111111', '0111110', '0011100', '0001000'];
    rows.forEach((row, y) => [...row].forEach((c, X) => { if (c === '1') { f('#1a1410', 1 + X * 2, 1 + y * 2, 2, 2); } }));
    rows.forEach((row, y) => [...row].forEach((c, X) => { if (c === '1' && (fill === 2 || (fill === 1 && X < 4))) f(y < 2 && X === 1 ? '#ff9a8e' : '#d8402f', 1 + X * 2, 1 + y * 2, 2, 2); else if (c === '1') f('#4a3a33', 1 + X * 2, 1 + y * 2, 2, 2); }));
  }));
  const HEART = [heart(0), heart(1), heart(2)];
  const hud = document.createElement('div'); hud.className = 'hud'; hud.hidden = true;
  hud.innerHTML = `<div class="vitals"><div class="hearts"></div><div class="sky"></div></div><div class="xp"><div class="xpfill"></div><span class="lvl"></span></div><div class="hotbar"></div><div class="itemname"></div>`;
  floorEl.append(hud);
  const hurtEl = document.createElement('div'); hurtEl.className = 'hurt'; floorEl.append(hurtEl);
  const $h = (q) => hud.querySelector(q);
  let nameUntil = 0;
  const slotHtml = (s) => (s ? `<img src="${ITEMS[s.id].icon}" alt="">${s.n > 1 ? `<span class="n">${s.n}</span>` : ''}` : '');
  function renderHud() {
    dirty = false;
    $h('.hearts').innerHTML = Array.from({ length: 10 }, (_, i) => `<img src="${HEART[clamp(Math.ceil(hp) - i * 2, 0, 2)]}" alt="">`).join('');
    const L = level(), lo = 12 * L * L, hi = 12 * (L + 1) * (L + 1);
    $h('.xpfill').style.width = clamp((xp - lo) / (hi - lo), 0, 1) * 100 + '%';
    $h('.lvl').textContent = L ? 'Level ' + L : '';
    $h('.hotbar').innerHTML = inv.slice(0, 9).map((s, i) => `<div class="slot${i === sel ? ' on' : ''}" data-i="${i}" title="${s ? AC.esc(ITEMS[s.id].name) : ''}"><span class="k">${i + 1}</span>${slotHtml(s)}</div>`).join('');
    for (const d of hud.querySelectorAll('.slot')) d.onclick = () => select(Number(d.dataset.i));
    if (AC.modalKind() === 'bag') renderBag();
    refreshHeld();
  }
  function select(i) {
    sel = i; dirty = true; saveSoon();
    const s = held();
    $h('.itemname').textContent = s ? ITEMS[s.id].name : '';
    nameUntil = performance.now() + 1600;
  }

  // what you hold, in your avatar's right hand
  let heldMesh = null, heldId = '';
  function refreshHeld() {
    const id = held()?.id ?? '';
    const arm = me.fig?.armR;
    if (heldMesh && heldId === id && heldMesh.parent === arm) return;
    heldMesh?.parent?.remove(heldMesh); heldMesh = null; heldId = id;
    if (!id || !arm) return;
    if (BLOCKS[id]) heldMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), BLOCKS[id].mat);
    else {
      const img = new Image(); const c = document.createElement('canvas'); c.width = c.height = 16;
      const t = texOf(c); img.onload = () => { c.getContext('2d').drawImage(img, 0, 0); t.needsUpdate = true; }; img.src = ITEMS[id].icon;
      heldMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide }));
      heldMesh.rotation.set(0, Math.PI / 2, -Math.PI / 4);
    }
    heldMesh.position.set(0, -0.62, 0.16); heldMesh.castShadow = true;
    arm.add(heldMesh);
  }

  // -------------------------------------------------------------------------------------------
  // backpack and crafting
  // -------------------------------------------------------------------------------------------
  let picked = null;
  const costHtml = (list) => list.map(([id, n]) => `<span class="cost${count(id) >= n ? '' : ' short'}"><img src="${ITEMS[id].icon}" alt="">${n} ${AC.esc(ITEMS[id].name)}</span>`).join('');
  function renderBag() {
    const cell = (i) => `<div class="slot${i === picked ? ' on' : ''}${i < 9 && i === sel ? ' sel' : ''}" data-i="${i}" title="${inv[i] ? AC.esc(ITEMS[inv[i].id].name + ': ' + ITEMS[inv[i].id].tip) : ''}">${slotHtml(inv[i])}</div>`;
    AC.modal('bag', '', `
      <div class="m-head"><h1>Backpack <span class="sub">level ${level()} &middot; ${xp} xp</span></h1><button class="x" data-close aria-label="Close">&times;</button></div>
      <div class="m-body"><div class="bag">
        <div>
          <div class="grid">${Array.from({ length: 27 }, (_, i) => cell(i + 9)).join('')}</div>
          <h3>Hotbar</h3>
          <div class="grid">${Array.from({ length: 9 }, (_, i) => cell(i)).join('')}</div>
          <p class="muted">Click a slot, then another, to move things.</p>
        </div>
        <div class="craft">
          <h3>Make</h3>
          ${RECIPES.map((r, i) => `<button class="quiet recipe" data-r="${i}" ${r.in.every(([id, n]) => count(id) >= n) ? '' : 'disabled'} title="${AC.esc(ITEMS[r.out[0]].tip)}">
            <img src="${ITEMS[r.out[0]].icon}" alt=""><b>${r.out[1] > 1 ? r.out[1] + ' ' : ''}${AC.esc(ITEMS[r.out[0]].name)}</b><span class="needs">${costHtml(r.in)}</span></button>`).join('')}
        </div>
      </div></div>
      <div class="m-foot"><span class="muted">Bugs come out at night, and when your team's tests fail. Finished tasks pay bytes.</span><button class="quiet" id="bag-sound">Sound: ${sound ? 'on' : 'off'}</button></div>`);
    const box = document.getElementById('modal-box');
    for (const d of box.querySelectorAll('.slot')) d.onclick = () => {
      const i = Number(d.dataset.i);
      if (picked === null) { if (inv[i]) picked = i; }
      else if (picked !== i) {
        const a = inv[picked], b = inv[i];
        if (a && b && a.id === b.id && b.n < stackMax(b.id)) { const k = Math.min(a.n, stackMax(b.id) - b.n); b.n += k; a.n -= k; if (!a.n) inv[picked] = null; }
        else { inv[picked] = b; inv[i] = a; }
        picked = null; saveSoon();
      } else picked = null;
      dirty = true; renderHud();
    };
    for (const b of box.querySelectorAll('.recipe')) b.onclick = () => {
      const r = RECIPES[Number(b.dataset.r)];
      if (!r.in.every(([id, n]) => count(id) >= n)) return;
      for (const [id, n] of r.in) take(id, n);
      if (give(r.out[0], r.out[1])) AC.toast('Your backpack is full.', 'warn');
      tone(520, 0.08, 'triangle', 0.04, 260);
      renderHud();
    };
    document.getElementById('bag-sound').onclick = () => { sound = !sound; saveSoon(); renderBag(); };
  }

  // -------------------------------------------------------------------------------------------
  // effects: block dust, floating numbers
  // -------------------------------------------------------------------------------------------
  const dustGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11);
  const dust = [];
  function burst(x, y, z, color, n = 8) {
    const m = new THREE.MeshLambertMaterial({ color });
    for (let i = 0; i < n && dust.length < 90; i++) {
      const d = new THREE.Mesh(dustGeo, m); d.position.set(x, y, z); scene.add(d);
      dust.push({ d, vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 4, ttl: 0.5 + Math.random() * 0.3 });
    }
  }
  const floats = [];
  function float(text, x, y, z, cls = '') {
    const d = document.createElement('div'); d.className = 'float ' + cls; d.textContent = text; overlayEl.append(d);
    floats.push({ d, x, y, z, ttl: 1.1 });
    if (floats.length > 14) floats.shift().d.remove();
  }

  // -------------------------------------------------------------------------------------------
  // bugs
  // -------------------------------------------------------------------------------------------
  const shellArt = (a, b, c) => art(40, (f, r) => { f(a, 0, 0, 16, 16); f(b, 7, 0, 2, 16); for (let i = 0; i < 10; i++) f(c, (r() * 16) | 0, (r() * 16) | 0, 2, 2); f(b, 0, 0, 16, 1); f(b, 0, 15, 16, 1); });
  const BUGS = {
    glitch: { name: 'Glitch', hp: 4, dmg: 1, speed: 2.5, size: 1, xp: 3, mat: mat({ map: texOf(shellArt('#4f9a45', '#2b5a28', '#77c56b')) }), eye: '#ffe14a', dust: '#4f9a45', drops: [['shell', 1, 0.7], ['byte', 1, 0.35]] },
    heisen: { name: 'Heisenbug', hp: 7, dmg: 2, speed: 2.2, size: 1.15, xp: 6, mat: mat({ map: texOf(shellArt('#7a4f9a', '#46285e', '#b48ad6')) }), eye: '#7ff7ff', dust: '#7a4f9a', drops: [['shell', 2, 0.8], ['byte', 1, 0.7]] },
    leak: { name: 'Memory leak', hp: 6, dmg: 2, speed: 1.5, size: 0.9, xp: 8, mat: mat({ map: texOf(shellArt('#3f78b8', '#234a78', '#8fc0ee')) }), eye: '#ffffff', dust: '#3f78b8', drops: [['byte', 2, 0.9], ['shell', 1, 0.6]] },
  };
  const bugs = [];
  const legMat = mat({ color: '#1e1e22' }), barBg = new THREE.MeshBasicMaterial({ color: '#1a1410' }), barFg = new THREE.MeshBasicMaterial({ color: '#d8402f' });
  function spawnBug(type, x, z) {
    const T = BUGS[type], g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    const add = (w, h, d, m, X, Y, Z, parent = body) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(X, Y, Z); b.castShadow = true; parent.add(b); return b; };
    add(0.7, 0.36, 0.9, T.mat, 0, 0.38, 0);
    add(0.42, 0.28, 0.3, T.mat, 0, 0.34, 0.58);
    const eyeMat = mat({ color: T.eye, emissive: T.eye, emissiveIntensity: 1 });
    for (const ex of [-0.12, 0.12]) add(0.09, 0.09, 0.05, eyeMat, ex, 0.4, 0.74);
    const legs = [];
    for (const sx of [-1, 1]) for (const lz of [-0.3, 0, 0.3]) { const p = new THREE.Group(); p.position.set(sx * 0.35, 0.3, lz); body.add(p); add(0.07, 0.34, 0.07, legMat, sx * 0.12, -0.14, 0, p).rotation.z = sx * 0.5; legs.push(p); }
    const bar = new THREE.Group(); bar.position.y = 0.95; g.add(bar); bar.visible = false;
    bar.add(new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.1), barBg));
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.06), barFg); fg.position.z = 0.001; bar.add(fg);
    g.position.set(x, 0, z); g.scale.setScalar(T.size);
    g.traverse((o) => { o.userData.bug = true; });
    scene.add(g);
    const b = { type, T, g, body, legs, bar, fg, x, z, rot: 0, hp: T.hp, max: T.hp, size: T.size, kx: 0, kz: 0, cd: 0, flash: 0, wx: x, wz: z, wt: 0, born: performance.now(), grow: 0, phase: Math.random() * 9 };
    g.userData.ref = b;
    bugs.push(b);
    return b;
  }
  function killBug(b, reward) {
    scene.remove(b.g); bugs.splice(bugs.indexOf(b), 1);
    burst(b.x, 0.5, b.z, b.T.dust, 14);
    if (!reward) return;
    tone(180, 0.16, 'sawtooth', 0.04, -120);
    gainXp(Math.round(b.T.xp * b.size / b.T.size));
    float(`+${b.T.xp} xp`, b.x, 1.2, b.z, 'xp');
    for (const [id, n, chance] of b.T.drops) if (Math.random() < chance) { give(id, n); float(`+${n} ${ITEMS[id].name}`, b.x, 0.8, b.z); }
  }
  const passable = (x, z) => !C.blocked(x, z) && !inOffice(x, z) && !solid(x, z, 0, 0.8, 0.28);
  function hurtBug(b, dmg) {
    b.hp -= dmg; b.flash = 0.18; b.bar.visible = true;
    const dx = b.x - me.x, dz = b.z - me.z, d = Math.hypot(dx, dz) || 1;
    b.kx = dx / d * 4; b.kz = dz / d * 4;
    burst(b.x, 0.5, b.z, b.T.dust, 5);
    float('-' + dmg, b.x, 1.1, b.z, 'dmg');
    tone(320, 0.06, 'square', 0.04, -140);
    if (b.hp <= 0) { killBug(b, true); return; }
    if (b.type === 'heisen' && Math.random() < 0.6) {            // it is somewhere else when you look
      for (let i = 0; i < 8; i++) { const a = Math.random() * 6.28, nx = me.x + Math.sin(a) * 4.5, nz = me.z + Math.cos(a) * 4.5; if (passable(nx, nz)) { burst(b.x, 0.5, b.z, '#b48ad6', 8); b.x = nx; b.z = nz; b.kx = b.kz = 0; tone(900, 0.09, 'sine', 0.03, 500); break; } }
    }
  }
  let dead = 0;
  function hurtMe(dmg, fromX, fromZ) {
    if (dead) return;
    hp -= dmg; lastHurt = performance.now(); dirty = true;
    hurtEl.classList.remove('on'); void hurtEl.offsetWidth; hurtEl.classList.add('on');
    tone(140, 0.14, 'sawtooth', 0.05, -60);
    const dx = me.x - fromX, dz = me.z - fromZ, d = Math.hypot(dx, dz) || 1, nx = me.x + dx / d * 0.7, nz = me.z + dz / d * 0.7;
    if (!C.blocked(nx, nz) && !solid(nx, nz)) { me.x = nx; me.z = nz; }
    if (hp <= 0) {
      dead = performance.now();
      AC.toast('The bugs got you. Back to your office for a coffee.', 'warn');
      me.x = 16; me.z = 22.4; me.y = 0; vy = 0; hp = 20;
      for (const b of [...bugs]) if (Math.hypot(b.x - 16, b.z - 22.4) < 14) killBug(b, false);
      saveSoon();
    }
  }
  function updateBugs(now, dt) {
    const safe = inOffice(me.x, me.z) || !active();
    for (const b of [...bugs]) {
      const dx = me.x - b.x, dz = me.z - b.z, dist = Math.hypot(dx, dz);
      if (dist > 60) { killBug(b, false); continue; }
      if (b.type === 'leak' && b.size < 2 && now - b.born > (b.grow + 1) * 9000) { b.grow++; b.size *= 1.22; b.max += 3; b.hp += 3; b.g.scale.setScalar(b.size); }
      const chase = !safe && dist < 12 && (me.y ?? 0) < 1.6;
      let tx, tz;
      if (chase) { tx = me.x; tz = me.z; }
      else {
        if (now > b.wt || Math.hypot(b.wx - b.x, b.wz - b.z) < 0.4) { b.wx = b.x + (Math.random() - 0.5) * 10; b.wz = b.z + (Math.random() - 0.5) * 10; b.wt = now + 2500 + Math.random() * 3000; }
        tx = b.wx; tz = b.wz;
      }
      const ddx = tx - b.x, ddz = tz - b.z, dd = Math.hypot(ddx, ddz) || 1;
      const sp = (chase ? b.T.speed : b.T.speed * 0.45) * (chase && dist < 0.8 ? 0 : 1);
      const mx = (ddx / dd * sp + b.kx) * dt, mz = (ddz / dd * sp + b.kz) * dt;
      b.kx *= Math.max(0, 1 - dt * 6); b.kz *= Math.max(0, 1 - dt * 6);
      let moved = false;
      if (passable(b.x + mx, b.z)) { b.x += mx; moved = true; }
      if (passable(b.x, b.z + mz)) { b.z += mz; moved = true; }
      if (!moved) b.wt = 0;
      const want = Math.atan2(ddx, ddz), diff = ((want - b.rot + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      b.rot += diff * Math.min(1, dt * 8);
      b.cd -= dt;
      if (chase && dist < 1.0 + 0.25 * b.size && b.cd <= 0) { b.cd = 1.5; hurtMe(b.T.dmg + (b.grow > 2 ? 1 : 0), b.x, b.z); }
      // draw
      const t = now / 1000 + b.phase;
      b.g.position.set(b.x, Math.abs(Math.sin(t * 9)) * 0.05, b.z);
      b.g.rotation.y = b.rot;
      b.body.position.z = b.cd > 1.3 ? 0.25 : 0;
      b.legs.forEach((l, i) => { l.rotation.x = Math.sin(t * 16 + i * 2.1) * 0.5; });
      b.flash = Math.max(0, b.flash - dt);
      b.body.scale.setScalar(b.flash > 0 ? 1.18 : 1);
      if (b.bar.visible) { b.bar.quaternion.copy(camera.quaternion); b.bar.rotation.y -= b.rot; b.fg.scale.x = clamp(b.hp / b.max, 0.02, 1); b.fg.position.x = -0.38 * (1 - b.fg.scale.x); }
    }
  }
  // how many bugs the campus holds: a few at night, more for every agent whose tests fail
  let peace = false, failing = [], spawnAt = 0, forcedTime = null, light = 1, lastFailNote = '';
  function teamTrouble() {
    failing = [...S.agents.values()].filter((a) => a.active && (a.state === 'error' || a.state === 'blocked' || /fail|error|broken/i.test(a.activity ?? '')));
    const note = failing.map((a) => a.id).join(',');
    if (failing.length && note !== lastFailNote && active()) AC.toast(`${failing[0].name}: ${failing[0].activity || failing[0].state}. Bugs are getting out onto the campus.`, 'warn');
    lastFailNote = note;
  }
  function spawnTick(now) {
    if (now < spawnAt) return;
    spawnAt = now + 3500;
    teamTrouble();
    const cap = Math.min(10, (light < 0.5 ? 5 : 1) + failing.length * 2);
    if (bugs.length >= cap || !active() || peace) return;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * 6.28, d = 13 + Math.random() * 8, x = me.x + Math.sin(a) * d, z = me.z + Math.cos(a) * d;
      if (!passable(x, z) || z < -70 || z > 100) continue;
      const roll = Math.random();
      spawnBug(light < 0.5 && roll < 0.25 ? 'leak' : roll < (failing.length ? 0.5 : 0.25) ? 'heisen' : 'glitch', x, z);
      return;
    }
  }
  // finished tasks pay a few bytes (read-only: we only watch the task list)
  const taskSeen = new Map();
  let tasksPrimed = false;
  function payday() {
    for (const t of S.tasks.values()) {
      const was = taskSeen.get(t.id);
      if (tasksPrimed && was && was !== 'done' && t.status === 'done') { give('byte', 2); gainXp(4); AC.toast(`${t.title}: done. +2 bytes`); }
      taskSeen.set(t.id, t.status);
    }
    if (S.tasks.size) tasksPrimed = true;
  }

  // -------------------------------------------------------------------------------------------
  // day and night (on the wall clock, so coworkers share it), and lamp blocks that light up
  // -------------------------------------------------------------------------------------------
  const DAY = 600;
  const skyDay = new THREE.Color('#a9cfe4'), skyNight = new THREE.Color('#0e1526'), sky = new THREE.Color();
  const lampLights = Array.from({ length: 5 }, () => { const p = new THREE.PointLight('#ffd98a', 0, 10, 2); scene.add(p); return p; });
  let lampAt = 0;
  function daylight(now) {
    const p = forcedTime ?? ((Date.now() / 1000) % DAY) / DAY;                 // 0 morning .. 0.6 dusk .. 0.9 dawn
    light = p < 0.55 ? 1 : p < 0.63 ? 1 - (p - 0.55) / 0.08 : p < 0.9 ? 0 : (p - 0.9) / 0.1;
    sun.intensity = 0.12 + 2.08 * light;
    hemi.intensity = 0.5 + 1.1 * light;
    sky.copy(skyNight).lerp(skyDay, light);
    scene.background.copy(sky); scene.fog.color.copy(sky);
    const label = light > 0.7 ? 'Day' : light > 0.05 ? (p < 0.7 ? 'Dusk' : 'Dawn') : 'Night';
    const s = $h('.sky'); if (s.textContent !== label) { s.textContent = label; s.className = 'sky ' + label.toLowerCase(); }
    if (now < lampAt) return;
    lampAt = now + 600;
    const lamps = (layers.lamp?.list ?? []).map((c) => ({ x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 })).sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
    lampLights.forEach((l, i) => { const at = lamps[i]; l.intensity = at ? 4 + 14 * (1 - light) : 0; if (at) l.position.set(at.x, at.y, at.z); });
  }

  // -------------------------------------------------------------------------------------------
  // aiming with the mouse: the block or bug under the pointer, within reach of your avatar
  // -------------------------------------------------------------------------------------------
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(0, 0), v3 = new THREE.Vector3();
  let hasPtr = false;
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01, 1.01, 1.01)), new THREE.LineBasicMaterial({ color: '#1a1410' }));
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.98, 0.98), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.28, depthWrite: false }));
  outline.visible = ghost.visible = false; scene.add(outline, ghost);
  const REACH = 6, MELEE = 3.4;
  const from = (x, y, z) => Math.hypot(x - me.x, y - (me.y + 1.2), z - me.z);
  function aim() {
    const out = { bug: null, block: null, place: null };
    if (!hasPtr) return out;
    ray.setFromCamera(ptr, camera);
    const bh = ray.intersectObjects(bugs.map((b) => b.g), true)[0];
    const kh = ray.intersectObjects(blockGroup.children, false)[0];
    const o = ray.ray.origin, d = ray.ray.direction;
    const gt = d.y < -0.001 ? -o.y / d.y : Infinity;
    if (bh && (!kh || bh.distance < kh.distance)) {
      let g = bh.object; while (g && !g.userData.ref) g = g.parent;
      if (g && from(g.userData.ref.x, 0.5, g.userData.ref.z) < MELEE) out.bug = g.userData.ref;
    }
    if (kh && kh.distance < gt) {
      const { x, y, z } = kh.object.userData.layer.list[kh.instanceId];
      if (from(x + 0.5, y + 0.5, z + 0.5) < REACH) { out.block = [x, y, z]; const n = kh.face.normal; out.place = [x + Math.round(n.x), y + Math.round(n.y), z + Math.round(n.z)]; }
    } else if (gt < 80) {
      v3.copy(o).addScaledVector(d, gt);
      if (from(v3.x, 0, v3.z) < REACH) out.place = [Math.floor(v3.x), 0, Math.floor(v3.z)];
    }
    if (out.place) {
      const [x, y, z] = out.place;
      const onMe = x + 1 > me.x - 0.3 && x < me.x + 0.3 && z + 1 > me.z - 0.3 && z < me.z + 0.3 && y + 1 > me.y && y < me.y + 1.8;
      const onBug = bugs.some((b) => Math.abs(b.x - x - 0.5) < 0.8 && Math.abs(b.z - z - 0.5) < 0.8 && y < 1);
      if (has(x, y, z) || !canBuild(x, z) || y > 7 || onMe || onBug || (y === 0 && C.blocked(x + 0.5, z + 0.5))) out.place = null;
    }
    return out;
  }
  function faceTo(x, z) { if (me.fig) me.fig.rot = Math.atan2(x - me.x, z - me.z); }
  function inFront() {                              // the nearest bug within arm's reach (you turn to it)
    let best = null, bd = 3;
    for (const b of bugs) { const d = Math.hypot(b.x - me.x, b.z - me.z); if (d < bd) { best = b; bd = d; } }
    return best;
  }
  const active = () => C.isVisible() && C.getMode() === 'walk' && !!me.fig;
  function doSwing() { swing = 0.26; coolUntil = performance.now() + 280; }   // on the clock, so a slow frame rate cannot eat clicks
  // left click (or F): hit the bug or the block you point at. true when something was hit
  function hit(useAim = true) {
    if (!active() || performance.now() < coolUntil) return false;
    const a = useAim ? aim() : { bug: null, block: null };
    const tool = ITEMS[held()?.id];
    const b = a.bug ?? (a.block ? null : inFront());
    if (b) { faceTo(b.x, b.z); doSwing(); hurtBug(b, tool?.dmg ?? 1); return true; }
    if (a.block) {
      const [x, y, z] = a.block, c = cells.get(key(x, y, z)), B = BLOCKS[c.t];
      faceTo(x + 0.5, z + 0.5); doSwing();
      c.hp -= tool?.dig ?? 1;
      burst(x + 0.5, y + 0.5, z + 0.5, B.dust, 4);
      tone(210 + Math.random() * 40, 0.05, 'square', 0.03, -80);
      if (c.hp <= 0) {
        delBlock(x, y, z);
        burst(x + 0.5, y + 0.5, z + 0.5, B.dust, 10);
        const drop = B.drop ?? c.t, n = c.t === 'ore' ? 1 + ((Math.random() * 2) | 0) : 1;
        if (give(drop, n)) AC.toast('Your backpack is full.', 'warn');
        float(`+${n} ${ITEMS[drop].name}`, x + 0.5, y + 1.1, z + 0.5);
        if (c.t === 'ore') gainXp(2);
        tone(520, 0.05, 'triangle', 0.03, 200);
      }
      return true;
    }
    return false;
  }
  // right click: place the block you hold, or drink the coffee
  function use() {
    if (!active()) return false;
    const s = held();
    if (!s) return false;
    const it = ITEMS[s.id];
    if (it.kind === 'food') {
      if (hp >= 20) { AC.toast('You are already at full health.'); return true; }
      take(s.id, 1); hp = Math.min(20, hp + it.heal); dirty = true; tone(440, 0.12, 'sine', 0.04, 220);
      float('+' + it.heal / 2 + ' hearts', me.x, me.y + 2.1, me.z, 'xp');
      return true;
    }
    if (it.kind !== 'block') return false;
    const a = aim();
    if (!a.place) return false;
    const [x, y, z] = a.place, id = s.id;
    s.n--; if (!s.n) inv[sel] = null;
    setBlock(x, y, z, id, false); placed.set(key(x, y, z), id);
    faceTo(x + 0.5, z + 0.5); doSwing(); dirty = true; saveSoon();
    tone(150, 0.05, 'square', 0.035, 60);
    return true;
  }

  // keys: 1-9 pick a hotbar slot, Space jumps, F swings, I opens the backpack
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'i' && AC.modalKind() === 'bag') { AC.closeModal(); return; }
    if (!active() || C.busy()) return;
    if (e.code === 'Space') { e.preventDefault(); wantJump = true; }
    else if (k >= '1' && k <= '9' && !e.ctrlKey && !e.altKey) select(Number(k) - 1);
    else if (k === 'f') { if (!hit(false)) doSwing(); }
    else if (k === 'i') { picked = null; renderBag(); }
  });
  el.addEventListener('pointermove', (e) => { const r = el.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); hasPtr = true; });
  el.addEventListener('pointerleave', () => { hasPtr = false; });

  let shownNow = false, introDone = load('wr-intro', false);
  function show(v) {
    if (v === shownNow) return;
    shownNow = v; hud.hidden = !v; floorEl.classList.toggle('playing', v);
    if (!v) { outline.visible = ghost.visible = false; for (const f of floats.splice(0)) f.d.remove(); }
    if (v && !introDone) { introDone = true; store('wr-intro', true); AC.toast('New on the campus: click to hit, right-click to build, I for your backpack. Bugs come out at night, or when your tests fail.'); }
  }

  function update(now, dt) {
    const on = active();
    show(on);
    rebuildDirty();
    daylight(now);
    if (!on) { updateBugs(now, dt); return; }
    payday();
    // jumping and falling onto blocks
    if (dead && now - dead > 1500) dead = 0;
    if (wantJump && onGround && !C.busy()) { vy = 7; tone(300, 0.05, 'sine', 0.02, 120); }
    wantJump = false;
    vy -= 20 * dt;
    let ny = me.y + vy * dt;
    const sup = support(me.x, me.z, me.y);
    if (ny <= sup) { ny = sup; vy = 0; onGround = true; } else onGround = false;
    if (vy > 0 && solid(me.x, me.z, ny, 1.8) && !solid(me.x, me.z, me.y, 1.75)) { vy = 0; ny = me.y; }
    me.y = ny;
    // resting heals, faster indoors
    if (now - lastHurt > 5000 && hp < 20) { const before = Math.ceil(hp); hp = Math.min(20, hp + dt * (inOffice(me.x, me.z) ? 2 : 0.4)); if (Math.ceil(hp) !== before) dirty = true; }
    if (swing > 0) { swing = Math.max(0, swing - dt); me.fig.armR.rotation.x = -0.35 - Math.sin((1 - swing / 0.26) * Math.PI) * 1.5; }
    else if (held()) me.fig.armR.rotation.x -= 0.25;
    spawnTick(now);
    updateBugs(now, dt);
    // aim marks
    const a = C.busy() ? { block: null, place: null } : aim();
    outline.visible = !!a.block; if (a.block) outline.position.set(a.block[0] + 0.5, a.block[1] + 0.5, a.block[2] + 0.5);
    const placing = a.place && ITEMS[held()?.id]?.kind === 'block';
    ghost.visible = !!placing; if (placing) ghost.position.set(a.place[0] + 0.5, a.place[1] + 0.5, a.place[2] + 0.5);
    // effects
    for (let i = dust.length - 1; i >= 0; i--) { const p = dust[i]; p.ttl -= dt; p.vy -= 14 * dt; p.d.position.x += p.vx * dt; p.d.position.y = Math.max(0.05, p.d.position.y + p.vy * dt); p.d.position.z += p.vz * dt; if (p.ttl <= 0) { scene.remove(p.d); dust.splice(i, 1); } }
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i]; f.ttl -= dt; f.y += dt * 0.9;
      if (f.ttl <= 0) { f.d.remove(); floats.splice(i, 1); continue; }
      const s = C.toScreen(f.x, f.y, f.z); f.d.hidden = s.hidden; f.d.style.left = s.x + 'px'; f.d.style.top = s.y + 'px'; f.d.style.opacity = Math.min(1, f.ttl * 2);
    }
    if (nameUntil && now > nameUntil) { nameUntil = 0; $h('.itemname').textContent = ''; }
    if (dirty) renderHud(); else if (heldMesh?.parent !== me.fig.armR) refreshHeld();
  }

  // may the avatar step to (x, z)? (never traps you inside a block you are already in)
  const blocksMove = (x, z) => solid(x, z) && !solid(me.x, me.z);

  // for tests and screenshots
  window.WRGame = {
    give, take, count, select, hit, use, spawn: (type = 'glitch', dx = 0, dz = 3) => spawnBug(type, me.x + dx, me.z + dz), bugs, cells, inv,
    time: (p) => { forcedTime = p; }, peace: (v = true) => { peace = v; if (v) for (const b of [...bugs]) killBug(b, false); }, setBlock: (x, y, z, t) => { setBlock(x, y, z, t, false); placed.set(key(x, y, z), t); saveSoon(); }, delBlock,
    aimAt: (x, y) => { ptr.set(x, y); hasPtr = true; return aim(); }, hurt: (n) => hurtMe(n, me.x, me.z + 1), openBag: () => { picked = null; renderBag(); },
    state: () => ({ hp, xp, level: level(), sel, held: held()?.id ?? null, y: +me.y.toFixed(2), bugs: bugs.map((b) => `${b.type}:${b.hp}`), light: +light.toFixed(2), blocks: cells.size, placed: placed.size, failing: failing.map((a) => a.name) }),
  };
  renderHud();
  return { update, hit, use, blocksMove, show, swing: doSwing };
}
