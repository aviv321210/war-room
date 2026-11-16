// War Room: things on the campus that coworkers share. An announcement board in front of every office, a cart
// to get around faster, holding cells whose doors lock from the outside, and talk that only carries a few metres.
// All of it is game state between windows (the "g" relay of the studio server). What arrives from a coworker is
// untrusted: numbers are checked, text is cut and escaped, and none of it can reach an agent, a decision or a repo.
export function initTown(W) {
  const { THREE, scene, me, mat, M, AC, box, plane, peersV, MYLOT } = W;
  const load = (k, d) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : d; } catch { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const dist = (x, z) => Math.hypot(me.x - x, me.z - z);
  const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, n).trim() : '');
  const canvasTex = (c, pixel) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; if (pixel) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; } return t; };
  const HEAR = 16;                                // metres that /say carries
  const dressed = [];                             // lots that have a board and a jail

  // -------------------------------------------------------------------------------------------
  // announcement board: everyone keeps their own notes (5 at most) and shows everybody's
  // -------------------------------------------------------------------------------------------
  let myPosts = load('wr-board', []).filter((p) => p && typeof p.text === 'string').slice(0, 5);
  const boardCanvas = document.createElement('canvas'); boardCanvas.width = 512; boardCanvas.height = 320;
  const boardTex = canvasTex(boardCanvas);
  const boardMat = mat({ map: boardTex });
  const allPosts = () => {
    const out = myPosts.map((p) => ({ ...p, by: W.myName(), mine: true }));
    for (const p of peersV.values()) for (const n of p.town?.posts ?? []) out.push({ ...n, by: p.name || 'Coworker' });
    return out.sort((a, b) => b.ts - a.ts);
  };
  function wrap(x, s, width, max) {
    const lines = []; let line = '';
    for (const word of s.split(/\s+/)) {
      const next = line ? line + ' ' + word : word;
      if (x.measureText(next).width <= width || !line) line = next; else { lines.push(line); line = word; }
      if (lines.length === max) break;
    }
    if (line && lines.length < max) lines.push(line);
    else if (line && lines.length === max) lines[max - 1] = lines[max - 1].replace(/.{0,3}$/, '...');
    return lines;
  }
  function paintBoard() {
    const x = boardCanvas.getContext('2d');
    x.fillStyle = '#b08d57'; x.fillRect(0, 0, 512, 320);
    for (let i = 0, s = 5; i < 900; i++) { s = (s * 16807) % 2147483647; x.fillStyle = i % 2 ? '#a58250' : '#bb9862'; x.fillRect(s % 512, (s >> 9) % 320, 3, 2); }
    x.fillStyle = '#3d2a1e'; x.fillRect(0, 0, 512, 46);
    x.fillStyle = '#f4efe6'; x.font = 'bold 26px Segoe UI, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('ANNOUNCEMENTS', 256, 24);
    const notes = allPosts().slice(0, 4);
    x.textAlign = 'left'; x.textBaseline = 'top';
    if (!notes.length) { x.fillStyle = '#3d2a1e'; x.font = '20px Segoe UI, sans-serif'; x.textAlign = 'center'; x.fillText('Nothing posted yet. Press E here to post.', 256, 170); }
    notes.forEach((n, i) => {
      const nx = 14 + (i % 2) * 250, ny = 58 + Math.floor(i / 2) * 130;
      x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(nx + 4, ny + 4, 234, 118);
      x.fillStyle = ['#fbf3d0', '#f4efe6', '#dfeee0', '#f6ded7'][i]; x.fillRect(nx, ny, 234, 118);
      x.fillStyle = '#b9543f'; x.beginPath(); x.arc(nx + 117, ny + 8, 5, 0, 7); x.fill();
      x.fillStyle = '#3d2a1e'; x.font = 'bold 16px Segoe UI, sans-serif'; x.fillText(wrap(x, n.by, 210, 1)[0] ?? '', nx + 12, ny + 16);
      x.font = '15px Segoe UI, sans-serif';
      wrap(x, n.text, 212, 4).forEach((l, k) => x.fillText(l, nx + 12, ny + 40 + k * 19));
    });
    boardTex.needsUpdate = true;
    if (AC.modalKind() === 'board') openBoard(true);
  }
  function announce(s) {
    s = text(s, 160);
    if (!s) return AC.toast('Write the announcement after /announce.', 'warn');
    myPosts = [{ id: Math.random().toString(36).slice(2, 10), text: s, ts: Date.now() }, ...myPosts].slice(0, 5);
    store('wr-board', myPosts);
    paintBoard(); sendState();
    AC.addFeed({ ts: Date.now(), kind: 'user', text: `You posted on the announcement board: ${s}` });
    AC.toast(peersV.size ? 'Posted. Everyone on the campus sees it on the boards.' : 'Posted on the announcement board.');
  }
  const ago = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  function openBoard(refresh) {
    const typed = refresh ? document.getElementById('bd-text')?.value : '';
    const notes = allPosts();
    AC.modal('board', '', `
      <div class="m-head"><h1>Announcements <span class="sub">the boards in front of every office show the same notes</span></h1><button class="x" data-close aria-label="Close">&times;</button></div>
      <div class="m-body">
        ${notes.length ? `<ul class="notes">${notes.slice(0, 40).map((n) => `<li><b>${AC.esc(n.by)}</b> <span class="muted">${ago(n.ts)}</span>${n.mine ? ` <a href="#" data-rm="${AC.esc(n.id)}">remove</a>` : ''}<div>${AC.esc(n.text)}</div></li>`).join('')}</ul>` : '<p class="muted">Nothing posted yet.</p>'}
        <h3>Post a note</h3>
        <div class="row"><input type="text" id="bd-text" maxlength="160" placeholder="For everyone on the campus, e.g. Stand-up at 10 in my office"><button id="bd-post">Post</button></div>
        <p class="muted">You keep your five newest notes. Also from the console: /announce your text</p>
      </div>`);
    const input = document.getElementById('bd-text');
    if (typed) input.value = typed;
    const post = () => { const v = input.value.trim(); if (v) { input.value = ''; announce(v); } };
    document.getElementById('bd-post').onclick = post;
    input.onkeydown = (e) => { if (e.key === 'Enter') post(); };
    for (const a of document.querySelectorAll('[data-rm]')) a.onclick = (e) => { e.preventDefault(); myPosts = myPosts.filter((p) => p.id !== a.dataset.rm); store('wr-board', myPosts); paintBoard(); sendState(); };
    if (!refresh) input.focus();
  }

  // -------------------------------------------------------------------------------------------
  // holding cells beside every office: three cells, each door locks from the yard side only
  // -------------------------------------------------------------------------------------------
  const CELLS = 3, CW = 2.6, JX = 33.8, JZ = 7, CELL_Z = 10.2, YARD_Z = 14.6, WALL_H = 2.7, PICK_MS = 45000;
  function brickTex(rx, ry) {
    const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
    x.fillStyle = '#6f6a63'; x.fillRect(0, 0, 32, 32);
    for (let row = 0, s = 3; row < 4; row++) for (let x0 = row % 2 ? -8 : 0; x0 < 32; x0 += 16) { s = (s * 16807) % 2147483647; x.fillStyle = ['#8d8880', '#9a958c', '#827d75'][s % 3]; x.fillRect(x0 + 1, row * 8 + 1, 14, 6); x.fillStyle = '#a8a39a'; x.fillRect(x0 + 1, row * 8 + 1, 14, 1); }
    const t = canvasTex(c, true); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); return t;
  }
  const brick = (w) => mat({ map: brickTex(Math.max(1, Math.round(w / 1.4)), 2) });
  const barsCanvas = (() => {
    const c = document.createElement('canvas'); c.width = 32; c.height = 32; const x = c.getContext('2d');
    x.clearRect(0, 0, 32, 32);
    for (let i = 2; i < 32; i += 8) { x.fillStyle = '#2b2d31'; x.fillRect(i, 0, 4, 32); x.fillStyle = '#5a5d63'; x.fillRect(i, 0, 1, 32); }
    for (const y of [3, 26]) { x.fillStyle = '#2b2d31'; x.fillRect(0, y, 32, 3); x.fillStyle = '#5a5d63'; x.fillRect(0, y, 32, 1); }
    return c;
  })();
  const barsMats = new Map();
  function bars(w) {
    const k = Math.max(1, Math.round(w / 0.55));
    if (!barsMats.has(k)) { const t = canvasTex(barsCanvas, true); t.wrapS = THREE.RepeatWrapping; t.repeat.set(k, 1); barsMats.set(k, new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide })); }
    return barsMats.get(k);
  }
  const yardMat = mat({ color: '#8f8a80' }), lockRed = mat({ color: '#d8402f', emissive: '#d8402f', emissiveIntensity: 0.8 }), lockGreen = mat({ color: '#6fbf5a', emissive: '#6fbf5a', emissiveIntensity: 0.5 });
  function signMat(label) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 48; const x = c.getContext('2d');
    x.fillStyle = '#2b2d31'; x.fillRect(0, 0, 256, 48); x.strokeStyle = '#c9a227'; x.lineWidth = 3; x.strokeRect(3, 3, 250, 42);
    x.fillStyle = '#f4efe6'; x.font = 'bold 24px Segoe UI, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(label, 128, 25, 236);
    return mat({ map: canvasTex(c) });
  }
  const jailSign = signMat('HOLDING CELLS');
  const cellX = (i) => JX + CW * (i + 0.5);
  function buildJail(L) {
    const J = { cells: Array(CELLS).fill(0), doors: [] };
    const wall = { solid: true, cast: true }, thin = { solid: true, cast: false };
    plane(7.8, YARD_Z - JZ, yardMat, JX + 3.9, 0.006, (JZ + YARD_Z) / 2);
    box(7.96, WALL_H, 0.16, brick(8), JX + 3.9, WALL_H / 2, JZ, wall);
    for (const sx of [JX, JX + 7.8]) box(0.16, WALL_H, YARD_Z - JZ, brick(7.6), sx, WALL_H / 2, (JZ + YARD_Z) / 2, wall);
    box(3.1, WALL_H, 0.16, brick(3.1), JX + 1.55, WALL_H / 2, YARD_Z, wall);
    box(3.1, WALL_H, 0.16, brick(3.1), JX + 6.25, WALL_H / 2, YARD_Z, wall);
    box(1.9, 0.5, 0.2, [M.dark, M.dark, M.dark, M.dark, jailSign, M.dark], JX + 3.9, WALL_H + 0.1, YARD_Z, { cast: false });
    for (const dx of [JX + CW, JX + 2 * CW]) box(0.1, WALL_H, CELL_Z - JZ, bars(CELL_Z - JZ), dx, WALL_H / 2, (JZ + CELL_Z) / 2, thin);
    for (let i = 0; i < CELLS; i++) {
      const cx = cellX(i);
      for (const s of [-1, 1]) box(0.75, WALL_H, 0.1, bars(0.75), cx + s * 0.925, WALL_H / 2, CELL_Z, thin);
      box(1.1, 0.45, 0.12, M.dark, cx, WALL_H - 0.22, CELL_Z, { cast: false });
      box(0.75, 0.3, 1.8, M.walnutDark, cx - 0.75, 0.3, JZ + 1.1, { cast: false });
      const closed = box(1.1, WALL_H - 0.45, 0.08, bars(1.1), cx, (WALL_H - 0.45) / 2, CELL_Z, thin);
      const open = box(0.08, WALL_H - 0.45, 1.1, bars(1.1), cx - 0.55, (WALL_H - 0.45) / 2, CELL_Z + 0.55, { cast: false });
      const lamp = box(0.16, 0.16, 0.08, lockGreen, cx + 0.74, 1.5, CELL_Z + 0.09, { cast: false });
      closed.visible = false;
      J.doors.push({ closed, open, lamp, at: L.w(cx, CELL_Z), out: L.w(cx, CELL_Z + 0.75), in: L.w(cx, CELL_Z - 0.75) });
    }
    return J;
  }
  // a lot belongs to an office (a group of people). One of them, the "keeper", answers for its cell doors.
  const ownerOf = (L) => (L === MYLOT ? W.office.id : L.owner ?? '');
  const ownerName = (L) => (L === MYLOT ? "your office's" : `the ${W.officeName(L.owner)}`);
  const iKeep = (L) => W.keeperOf(L) === W.myId();
  // which cell (x, z) is in: [lot, index] or null
  function cellAt(x, z) {
    for (const L of dressed) {
      if (!L.deco.visible) continue;
      const [lx, lz] = L.l(x, z);
      if (lz > JZ && lz < CELL_Z && lx > JX && lx < JX + CELLS * CW) return [L, clamp(Math.floor((lx - JX) / CW), 0, CELLS - 1)];
    }
    return null;
  }
  const lockHooks = [];                            // the arena moves its own people out of a closing door
  function setCell(L, i, v) {
    const J = L.jail, d = J.doors[i];
    J.cells[i] = v ? 1 : 0;
    d.closed.visible = !!v; d.open.visible = !v; d.lamp.material = v ? lockRed : lockGreen;
    if (v && Math.hypot(me.x - d.at[0], me.z - d.at[1]) < 0.75) {       // you stood in the doorway: step to the side you were on
      const [, lz] = L.l(me.x, me.z); const to = lz < CELL_Z ? d.in : d.out; me.x = to[0]; me.z = to[1];
    }
    for (const h of lockHooks) h(L, i, !!v, d);
  }
  function lockCell(L, i, v) {
    const keeper = W.keeperOf(L);
    if (L === MYLOT && (!keeper || keeper === W.myId())) { setCell(L, i, v); sendState(); }
    else if (keeper) W.netSend({ type: 'g', k: 'jreq', to: [keeper], d: { i, v: v ? 1 : 0 } });
  }
  let jailed = null;                               // { L, i, since } while you are behind a locked door

  // -------------------------------------------------------------------------------------------
  // your cart: E gets in and out, W/S drive, A/D steer, Shift goes faster
  // -------------------------------------------------------------------------------------------
  function buildCart(color) {
    const g = new THREE.Group();
    const paint = mat({ color }), dark = M.dark, trim = mat({ color: W.shade(color, -0.35) });
    const add = (w, h, d, m, x, y, z, cast = true) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = cast; b.receiveShadow = true; g.add(b); return b; };
    add(1.7, 0.3, 3.3, paint, 0, 0.45, 0);
    add(1.7, 0.42, 0.9, paint, 0, 0.8, 1.2);
    add(1.74, 0.1, 0.94, trim, 0, 1.03, 1.2);
    add(1.7, 0.32, 1.0, paint, 0, 0.76, -1.15);
    for (const s of [-1, 1]) { add(0.12, 0.34, 1.5, paint, s * 0.79, 0.77, 0); add(0.1, 1.25, 0.1, dark, s * 0.78, 1.4, -0.62); }
    add(1.66, 0.1, 0.1, dark, 0, 2.0, -0.62);
    add(1.5, 0.75, 0.14, trim, 0, 0.98, -0.34);
    add(1.5, 0.14, 0.6, trim, 0, 0.62, -0.02);
    add(1.5, 0.5, 0.05, new THREE.MeshLambertMaterial({ color: '#bfe4f0', transparent: true, opacity: 0.35 }), 0, 1.3, 0.78, false);
    add(0.5, 0.06, 0.34, dark, -0.38, 1.12, 0.6, false);
    for (const [x, z] of [[-0.92, 1.15], [0.92, 1.15], [-0.92, -1.15], [0.92, -1.15]]) { add(0.26, 0.66, 0.66, dark, x, 0.33, z); add(0.28, 0.3, 0.3, M.metal, x, 0.33, z, false); }
    for (const s of [-1, 1]) { add(0.36, 0.16, 0.06, M.lampOn, s * 0.55, 0.82, 1.66, false); add(0.3, 0.14, 0.06, mat({ color: '#b8362c', emissive: '#b8362c', emissiveIntensity: 0.6 }), s * 0.6, 0.8, -1.66, false); }
    add(1.76, 0.14, 0.14, dark, 0, 0.42, 1.66); add(1.76, 0.14, 0.14, dark, 0, 0.42, -1.66);
    scene.add(g);
    return g;
  }
  // people who share an office park next to each other
  const park = () => { const k = Math.max(0, W.membersOf(W.office.id).indexOf(W.myId())); const [x, z] = MYLOT.w([27, 30.7, 19.2][k % 3], 22.2 - Math.floor(k / 3) * 0.01); return { x, z, rot: Math.PI / 2 }; };
  const car = { ...park(), speed: 0, driving: false, mesh: null, color: '' };
  function myCart() {
    const color = me.look?.shirt ?? '#2f6f8f';
    if (car.mesh && car.color === color) return car.mesh;
    if (car.mesh) scene.remove(car.mesh);
    car.color = color; car.mesh = buildCart(color);
    return car.mesh;
  }
  const clear = (x, z) => !W.blocked(x, z) && !W.game()?.blocksMove(x, z);
  function carFits(x, z, rot) {
    const s = Math.sin(rot), c = Math.cos(rot);
    for (const [px, pz] of [[0, 0], [0.6, 1.45], [-0.6, 1.45], [0.6, -1.45], [-0.6, -1.45]]) if (!clear(x + px * c + pz * s, z - px * s + pz * c)) return false;
    return x > -600 && x < 632 && z > -78 && z < 130;
  }
  function getIn() {
    if (jailed) return AC.toast('Not from inside a cell.', 'warn');
    car.driving = true; car.speed = 0; me.y = 0;
    me.x = car.x; me.z = car.z;
    if (!load('wr-cart-tip', false)) { store('wr-cart-tip', true); AC.toast('W and S drive, A and D steer, Shift goes faster. E gets out.'); }
  }
  function getOut() {
    car.driving = false; car.speed = 0;
    const s = Math.sin(car.rot), c = Math.cos(car.rot);
    for (const side of [1.4, -1.4]) { const x = car.x + c * side, z = car.z - s * side; if (clear(x, z)) { me.x = x; me.z = z; break; } }
    sendState();
  }
  function drive(dt, keys, cam, dragging) {
    if (!car.driving) return false;
    const on = (...k) => k.some((x) => keys.has(x));
    const gas = (on('w', 'arrowup') ? 1 : 0) - (on('s', 'arrowdown') ? 1 : 0), steer = (on('a', 'arrowleft') ? 1 : 0) - (on('d', 'arrowright') ? 1 : 0);
    const top = keys.has('shift') ? 19 : 13;
    if (gas > 0) car.speed = Math.min(top, car.speed + 10 * dt);
    else if (gas < 0) car.speed = Math.max(-5, car.speed - 14 * dt);
    else { car.speed *= Math.max(0, 1 - 1.8 * dt); if (Math.abs(car.speed) < 0.08) car.speed = 0; }
    if (car.speed > top) car.speed -= 12 * dt;
    const rot = car.rot + steer * 2.2 * dt * clamp(car.speed / 5, -1, 1);
    const nx = car.x + Math.sin(rot) * car.speed * dt, nz = car.z + Math.cos(rot) * car.speed * dt;
    if (carFits(nx, nz, rot)) { car.x = nx; car.z = nz; car.rot = rot; }
    else if (carFits(car.x, car.z, rot)) { car.rot = rot; car.speed *= -0.2; }
    else car.speed *= -0.2;
    me.x = car.x; me.z = car.z; me.moving = false; me.heading = car.rot;
    if (me.fig) me.fig.rot = car.rot;
    if (!dragging && Math.abs(car.speed) > 2.5) cam.yaw += angDiff(car.rot + Math.PI, cam.yaw) * Math.min(1, dt * 2);
    return true;
  }
  function sit(fig, y) {
    fig.legL.rotation.x = fig.legR.rotation.x = -Math.PI / 2;
    fig.armL.rotation.x = fig.armR.rotation.x = -1.05;
    fig.body.position.y = 0;
    fig.root.position.y = y - 0.03;
  }
  const pose = (fig) => { if (car.driving) sit(fig, me.y ?? 0); };
  function recall() {
    if (car.driving) return AC.toast('You are sitting in it.');
    const s = Math.sin(me.fig?.rot ?? 0), c = Math.cos(me.fig?.rot ?? 0);
    for (const [f, side] of [[0, 2], [0, -2], [3, 0], [-3, 0]]) {
      const x = me.x + s * f + c * side, z = me.z + c * f - s * side;
      if (carFits(x, z, me.fig?.rot ?? 0)) { Object.assign(car, { x, z, rot: me.fig?.rot ?? 0, speed: 0 }); sendState(); return AC.toast('Your cart is next to you.'); }
    }
    AC.toast('No room for the cart here.', 'warn');
  }
  // a coworker in their cart, or their parked cart
  function peerPose(p, av) {
    const T = (p.town ??= {});
    const driving = !!p.pos?.car;
    const at = driving ? { x: av.x, z: av.z, rot: av.rot } : W.fromWire(T.car);
    if (!at) { if (T.cart) T.cart.visible = false; return; }
    const color = p.look?.shirt ?? '#8a5a3c';
    if (!T.cart || T.cartColor !== color) { if (T.cart) scene.remove(T.cart); T.cart = buildCart(color); T.cartColor = color; }
    T.cart.visible = Math.hypot(at.x - me.x, at.z - me.z) < 150; T.cart.position.set(at.x, 0, at.z); T.cart.rotation.y = at.rot;
    T.cartAt = at;
    if (driving) sit(av.fig, 0);
  }

  // -------------------------------------------------------------------------------------------
  // talking: /say carries HEAR metres from where you stand
  // -------------------------------------------------------------------------------------------
  const heard = [];                                // listeners: ({ from, name, text, x, z })
  function say(s) {
    s = text(s, 300);
    if (!s) return AC.toast('Write something after /say.', 'warn');
    if (!me.fig) return AC.toast('Pick an avatar first (Walk).', 'warn');
    const w = W.toWire(me.x, me.z);
    W.netSend({ type: 'g', k: 'say', d: { text: s, at: { anchor: w.anchor, dx: w.dx, dz: w.dz } } });
    W.bubble(s);
    AC.addFeed({ ts: Date.now(), kind: 'user', text: `${W.myName()} (nearby): ${s}` });
    let n = [...peersV.values()].filter((p) => p.avatar?.shown && dist(p.avatar.x, p.avatar.z) < HEAR).length;
    for (const h of heard) n += h({ from: W.myId(), name: W.myName(), text: s, x: me.x, z: me.z }) ?? 0;
    if (!n) AC.toast(`Nobody is within ${HEAR} m to hear that. /chat reaches the whole campus.`, 'warn');
  }

  // -------------------------------------------------------------------------------------------
  // what coworkers send, and what we send them
  // -------------------------------------------------------------------------------------------
  let stateAt = 0;
  function sendState() {
    stateAt = performance.now();
    if (!W.myId()) return;
    W.netSend({ type: 'g', k: 'st', d: { jail: MYLOT.jail.cells, car: car.driving ? null : W.toWire(car.x, car.z, car.rot), posts: myPosts } });
  }
  function onGame(p, k, d) {
    const T = (p.town ??= {});
    if (k === 'st') {
      // the doors of an office are as its keeper says (also for my own office, when the keeper is somebody else)
      if (Array.isArray(d.jail)) { T.jail = d.jail.slice(0, CELLS).map((v) => (v ? 1 : 0)); if (p.lot?.jail && W.keeperOf(p.lot) === p.id) T.jail.forEach((v, i) => { if (p.lot.jail.cells[i] !== v) setCell(p.lot, i, v); }); }
      T.car = d.car && typeof d.car === 'object' ? { anchor: text(d.car.anchor, 16), dx: Number(d.car.dx), dz: Number(d.car.dz), rot: Number(d.car.rot) } : null;
      const posts = (Array.isArray(d.posts) ? d.posts : []).slice(0, 5).map((n) => ({ id: text(n?.id, 12), text: text(n?.text, 160), ts: Number.isFinite(n?.ts) ? n.ts : 0 })).filter((n) => n.id && n.text);
      const known = new Set((T.posts ?? []).map((n) => n.id));
      for (const n of posts) if (T.posts && !known.has(n.id)) { AC.toast(`Announcement from ${p.name}: ${n.text}`); AC.addFeed({ ts: Date.now(), kind: 'message', text: `${p.name} (announcement): ${n.text}` }); }
      T.posts = posts;
      paintBoard();
    } else if (k === 'jreq') {
      const i = Number(d.i);
      if (!Number.isInteger(i) || i < 0 || i >= CELLS) return;
      if (!iKeep(MYLOT)) return;
      setCell(MYLOT, i, d.v ? 1 : 0); sendState();
      if (p.lot !== MYLOT) AC.toast(`${p.name} ${d.v ? 'locked' : 'unlocked'} cell ${i + 1} of your holding cells.`);
    } else if (k === 'say') {
      const s = text(d.text, 300), at = W.fromWire({ anchor: text(d.at?.anchor, 16), dx: Number(d.at?.dx), dz: Number(d.at?.dz) }) ?? (p.avatar?.shown ? { x: p.avatar.x, z: p.avatar.z } : null);
      if (!s || !at) return;
      if (me.fig && dist(at.x, at.z) < HEAR) { p.chat = { text: s, until: Date.now() + 8000 }; AC.addFeed({ ts: Date.now(), kind: 'message', text: `${p.name} (nearby): ${s}` }); }
      for (const h of heard) h({ from: p.id, name: p.name, text: s, x: at.x, z: at.z });
    }
  }
  function onJoin() { sendState(); }
  function onLeave(p) {
    if (p.town?.cart) scene.remove(p.town.cart);
    paintBoard();
  }
  // a lot got an office (yours at the start, a coworker's when they arrive): give it a board and holding cells
  function dressLot(L) {
    if (!L.jail) {
      W.build(L, L.deco, () => {
        for (const px of [3.5, 6.5]) box(0.14, 2.7, 0.14, M.walnutDark, px, 1.35, 22.7, { solid: true });
        box(3.3, 2.06, 0.1, M.walnutDark, 5, 1.7, 22.68, { cast: false });
        box(3.2, 2.0, 0.12, [M.walnutDark, M.walnutDark, M.walnutDark, M.walnutDark, boardMat, M.walnutDark], 5, 1.7, 22.7, { cast: false });
        box(3.6, 0.12, 0.5, M.walnutDark, 5, 2.8, 22.7);
        L.jail = buildJail(L);
      });
      L.boardAt = L.w(5, 23.4);
      dressed.push(L);
    }
    const keeper = W.keeperOf(L);
    const want = keeper && keeper !== W.myId() ? peersV.get(keeper)?.town?.jail ?? [0, 0, 0] : L === MYLOT ? (homeOf === W.office.id ? MYLOT.jail.cells : [0, 0, 0]) : [0, 0, 0];
    if (L === MYLOT) homeOf = W.office.id;
    for (let i = 0; i < CELLS; i++) if (!!L.jail.cells[i] !== !!want[i] || !L.jail.set) setCell(L, i, want[i] ? 1 : 0);
    L.jail.set = true;
  }
  let homeOf = W.office.id;                         // the office whose cells my own lot shows
  // you moved to another office: your cart waits in front of it
  function moved() {
    if (car.driving) getOut();
    Object.assign(car, park(), { speed: 0 });
    jailed = null;
    sendState();
  }

  // "E" near the things of this file
  function near(offer) {
    if (car.driving) { offer(0, 1, 'Get out of the cart', getOut); return; }
    if (!jailed) offer(dist(car.x, car.z), 2.5, 'Drive your cart', getIn);
    for (const p of peersV.values()) { const at = p.town?.cartAt; if (at && p.town.cart?.visible && !p.pos?.car && dist(at.x, at.z) < 4) offer(dist(at.x, at.z), 2.2, `${p.name}'s cart`, () => AC.toast(`Only ${p.name} drives that one. Yours waits by your office (or type /cart).`)); }
    for (const L of dressed) {
      if (!L.deco.visible || !(L === MYLOT || L.owner)) continue;
      offer(dist(...L.boardAt), 2.6, 'Read the announcements', () => openBoard());
      L.jail.doors.forEach((d, i) => {
        const dd = dist(...d.at);
        if (dd > 1.7) return;
        const [, lz] = L.l(me.x, me.z), inside = lz < CELL_Z, locked = L.jail.cells[i];
        if (inside && locked) {
          const left = jailed ? Math.ceil((PICK_MS - (Date.now() - jailed.since)) / 1000) : 0;
          if (left > 0) offer(dd, 1.7, `Locked from the outside. You can force the lock in ${left} s`, () => AC.toast('Someone outside has to open it, or wait until you can force the lock.'));
          else offer(dd, 1.7, 'Force the lock', () => { lockCell(L, i, 0); AC.toast('The lock gives way.'); });
        } else if (!inside) offer(dd, 1.7, locked ? `Unlock cell ${i + 1} (${ownerName(L)} cells)` : `Lock cell ${i + 1} (${ownerName(L)} cells)`, () => lockCell(L, i, locked ? 0 : 1));
      });
    }
  }
  function where(x, z) {
    const c = cellAt(x, z);
    return c ? `in ${ownerName(c[0])} holding cells` : null;
  }
  function update(now) {
    const m = car.mesh ?? myCart();
    if (car.color !== (me.look?.shirt ?? '#2f6f8f')) myCart();
    m.visible = W.isVisible(); m.position.set(car.x, 0, car.z); m.rotation.y = car.rot;
    if (car.driving && (W.getMode() !== 'walk' || !me.fig)) getOut();
    const c = me.fig ? cellAt(me.x, me.z) : null;
    const held = c && c[0].jail.cells[c[1]];
    if (held && !(jailed && jailed.L === c[0] && jailed.i === c[1])) { jailed = { L: c[0], i: c[1], since: Date.now() }; AC.toast(`You are locked in ${ownerName(c[0])} holding cells. Someone has to unlock the door from the outside.`, 'warn'); }
    else if (!held && jailed) { jailed = null; AC.toast('You are free.'); }
    if (now - stateAt > 5000) sendState();
  }

  dressLot(MYLOT);
  paintBoard();
  window.WRTown = {
    car, say, announce, getIn, getOut, recall, lockCell: (i, v, L = MYLOT) => lockCell(L, i, v), cells: (L = MYLOT) => [...L.jail.cells], cellAt,
    state: () => ({ car: { x: +car.x.toFixed(1), z: +car.z.toFixed(1), driving: car.driving, speed: +car.speed.toFixed(1) }, cells: [...MYLOT.jail.cells], jailed: jailed ? [jailed.i, Math.round((Date.now() - jailed.since) / 1000)] : null, posts: allPosts().map((p) => `${p.by}: ${p.text}`), lots: dressed.map((L) => L.key) }),
  };
  return { update, near, drive, pose, peerPose, onGame, onJoin, onLeave, dressLot, where, moved, iKeep, say, announce, recall, driving: () => car.driving, heard, lockHooks, cellAt, lockCell, setCell, isJailed: () => !!jailed, CELL: { JX, JZ, CW, CELL_Z, CELLS }, cellX, dressed, ownerOf, HEAR };
}
