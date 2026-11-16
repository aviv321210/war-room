// War Room: a 2D view of the Foreman (from upstream AgentCraft) (protocol v1, docs/protocol.md).
'use strict';

// ---------------------------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------------------------
const S = {
  foreman: null, agents: new Map(), tasks: new Map(), decisions: new Map(), repos: new Map(),
  memory: new Map(), goal: null, feed: [], logs: new Map(), says: new Map(), connected: false,
};
const STATE_COLOR = {
  idle: '#9b9187', thinking: '#c9a227', reading: '#2fa3a0', editing: '#2fa3a0', running: '#2fa3a0',
  testing: '#2fa3a0', waiting_user: '#d97757', blocked: '#d0453b', done: '#8fa98b', error: '#d0453b',
};
const STATE_WORD = {
  idle: 'idle', thinking: 'thinking', reading: 'reading', editing: 'editing', running: 'running',
  testing: 'testing', waiting_user: 'waiting for you', blocked: 'blocked', done: 'done', error: 'error',
};
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const userName = () => S.foreman?.userName || 'you';

// ---------------------------------------------------------------------------------------------
// connection
// ---------------------------------------------------------------------------------------------
let ws = null, nextId = 1, backoff = 500;
const pending = new Map();      // id -> {resolve, reject}
const diffWaiters = new Map();  // requestId -> resolve

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => {
    backoff = 500;
    ws.send(JSON.stringify({ v: 1, type: 'hello', modVersion: 'studio-0.1.0', protocol: 1, client: 'studio' }));
  };
  ws.onmessage = (e) => { try { apply(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => {
    S.connected = false;
    banner('Reconnecting to the Foreman...', true);
    for (const p of pending.values()) p.reject(new Error('disconnected'));
    pending.clear();
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 5000);
  };
}

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) { reject(new Error('not connected to the Foreman')); return; }
    const id = 'c' + nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ v: 1, type, id, ...payload }));
  });
}
async function act(type, payload, okText) {
  try {
    const r = await send(type, payload);
    if (okText) toast(okText);
    return r;
  } catch (e) { toast(e.message, 'error'); return null; }
}

function apply(m) {
  switch (m.type) {
    case 'snapshot':
      S.connected = true;
      S.foreman = m.foreman;
      S.agents = new Map(m.agents.map((a) => [a.id, a]));
      S.tasks = new Map(m.tasks.map((t) => [t.id, t]));
      S.decisions = new Map(m.decisions.map((d) => [d.id, d]));
      S.repos = new Map(m.repos.map((r) => [r.id, r]));
      S.memory = new Map(m.memory.map((x) => [x.id, x]));
      S.goal = m.goal ?? null;
      S.feed = m.feed.slice(-200);
      S.logs = new Map(m.logs.map((l) => [l.agentId, l.entries.slice(-200)]));
      for (const a of S.agents.values()) ensureActor(a);
      banner(null);
      renderAll();
      break;
    case 'agent.upsert': S.agents.set(m.agent.id, m.agent); ensureActor(m.agent); renderAgentsUi(); break;
    case 'agent.log': {
      const l = S.logs.get(m.agentId) ?? [];
      l.push(...m.entries);
      S.logs.set(m.agentId, l.slice(-200));
      if (openModal?.kind === 'agent' && openModal.id === m.agentId) renderMonitor(m.agentId);
      break;
    }
    case 'agent.say': S.says.set(m.agentId, { text: m.text, to: m.to, until: Date.now() + 7000 }); break;
    case 'task.upsert': S.tasks.set(m.task.id, m.task); renderTasks(); break;
    case 'decision.upsert': S.decisions.set(m.decision.id, m.decision); renderDecisions(); refreshDecisionModal(m.decision); break;
    case 'repo.upsert': S.repos.set(m.repo.id, m.repo); renderHeader(); break;
    case 'memory.upsert': S.memory.set(m.entry.id, m.entry); break;
    case 'goal.upsert':
      if (!S.goal || S.goal.id === m.goal.id || m.goal.createdAt >= S.goal.createdAt) S.goal = m.goal;
      renderHeader();
      break;
    case 'feed.add': S.feed.push(m.item); if (S.feed.length > 200) S.feed.shift(); renderFeed(); break;
    case 'notify':
      toast(m.text, m.level, m.decisionId ? () => openDecision(m.decisionId) : null);
      if (m.level === 'need_user') bell();
      break;
    case 'foreman.status': S.foreman = m.status; renderHeader(); break;
    case 'diff': { const w = diffWaiters.get(m.requestId); if (w) { diffWaiters.delete(m.requestId); w(m); } break; }
    case 'ack': {
      const p = pending.get(m.re);
      if (p) { pending.delete(m.re); m.ok ? p.resolve(m.result ?? {}) : p.reject(new Error(m.error || 'refused')); }
      break;
    }
    case 'error': if (!m.re) toast(m.message, 'error'); break;
  }
}

// ---------------------------------------------------------------------------------------------
// the room (canvas, 32 x 20 tiles of 16 px)
// ---------------------------------------------------------------------------------------------
const T = 16, W = 32, H = 20;
const canvas = $('#room'), g = canvas.getContext('2d');
g.imageSmoothingEnabled = false;
const img = {};
function loadImg(key, src) { const i = new Image(); i.src = src; img[key] = i; return i; }
['oak_parquet', 'walnut_panel', 'walnut_trim', 'terracotta_tile', 'plaster_panel', 'monitor_screen_on', 'monitor_screen_off',
 'task_board_surface', 'memory_archive_front', 'merge_station_front', 'console_screen', 'decision_podium_front']
  .forEach((k) => loadImg(k, `assets/tex/${k}.png`));

// furniture and where agents stand (tile units; spots are the feet position)
const DESKS = [
  { x: 14, y: 4, lead: true }, // the lead's desk
  { x: 4, y: 8 }, { x: 10, y: 8 }, { x: 16, y: 8 },
  { x: 4, y: 12 }, { x: 10, y: 12 }, { x: 16, y: 12 },
];
const SPOTS = {
  library: [[2.5, 5.2], [5, 5.6], [7.5, 5.2]],
  terminal: [[23.5, 5.6], [25, 5.6]],
  testbench: [[28, 5.6], [29.5, 5.6]],
  mergestation: [[23.5, 10.6], [25, 10.6]],
  user: [[28, 10.8], [29.5, 10.8], [26.8, 11.2]],
  meeting: [[22.5, 15.2], [24.5, 15.2], [26.5, 15.2], [28.5, 15.2], [23.5, 17.6], [27.5, 17.6]],
  lounge: [[3, 17.4], [5, 17.4], [7, 17.4], [9, 17.4], [11, 17.4], [13, 17.4]],
};
const deskOf = new Map();   // agentId -> desk index
function deskFor(a) {
  if (deskOf.has(a.id)) return DESKS[deskOf.get(a.id)];
  let i = a.role === 'lead' ? 0 : -1;
  if (i < 0 || [...deskOf.values()].includes(0)) {
    i = DESKS.findIndex((d, k) => !d.lead && ![...deskOf.values()].includes(k));
  }
  if (i < 0) i = DESKS.length - 1;
  deskOf.set(a.id, i);
  return DESKS[i];
}

// one walking figure per agent
const actors = new Map();   // id -> {x, y, tx, ty, sprite, seated, phase}
function ensureActor(a) {
  let ac = actors.get(a.id);
  if (!ac) {
    const t = targetOf(a);
    ac = { x: t.x, y: t.y, tx: t.x, ty: t.y, seated: t.seated, phase: Math.random() * 6, sprite: null };
    actors.set(a.id, ac);
    makeSprite(a.skin).then((s) => { ac.sprite = s; });
  }
  const t = targetOf(a);
  ac.tx = t.x; ac.ty = t.y; ac.seatAt = t.seated;
}
function targetOf(a) {
  let station = a.active ? a.station : 'lounge';
  if (station === 'desk') { const d = deskFor(a); return { x: d.x + 1.5, y: d.y + 2.05, seated: true }; }
  const spots = SPOTS[station] ?? SPOTS.lounge;
  // agents sharing a station take different spots, in a stable order
  const same = [...S.agents.values()].filter((o) => (o.active ? o.station : 'lounge') === station).map((o) => o.id).sort();
  const [x, y] = spots[Math.max(0, same.indexOf(a.id)) % spots.length];
  return { x, y, seated: station === 'meeting' || station === 'lounge' };
}

// front view of a 64x64 player-style skin -> 16 x 32 figure (and a 8x8 face for portraits)
const skinCache = new Map();
function makeSprite(skin) {
  if (skinCache.has(skin)) return skinCache.get(skin);
  const p = new Promise((resolve) => {
    const s = new Image();
    s.onload = () => {
      const c = document.createElement('canvas'); c.width = 16; c.height = 32;
      const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
      const part = (sx, sy, w, h, dx, dy) => x.drawImage(s, sx, sy, w, h, dx, dy, w, h);
      part(4, 20, 4, 12, 4, 20); part(20, 52, 4, 12, 8, 20);          // legs
      part(4, 36, 4, 12, 4, 20); part(4, 52, 4, 12, 8, 20);           // leg overlays
      part(20, 20, 8, 12, 4, 8); part(20, 36, 8, 12, 4, 8);           // body + jacket
      part(44, 20, 4, 12, 0, 8); part(36, 52, 4, 12, 12, 8);          // arms
      part(44, 36, 4, 12, 0, 8); part(52, 52, 4, 12, 12, 8);          // sleeves
      part(8, 8, 8, 8, 4, 0); part(40, 8, 8, 8, 4, 0);                // head + hat
      const face = document.createElement('canvas'); face.width = 8; face.height = 8;
      const f = face.getContext('2d'); f.imageSmoothingEnabled = false;
      f.drawImage(s, 8, 8, 8, 8, 0, 0, 8, 8); f.drawImage(s, 40, 8, 8, 8, 0, 0, 8, 8);
      resolve({ body: c, face });
    };
    s.onerror = () => resolve(null);
    s.src = `assets/skins/${skin}.png`;
  });
  skinCache.set(skin, p);
  return p;
}

function tile(key, x, y, w = 1, h = 1) {
  const i = img[key];
  if (!i || !i.complete) return;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) g.drawImage(i, (x + xx) * T, (y + yy) * T, T, T);
}
function rect(c, x, y, w, h) { g.fillStyle = c; g.fillRect(Math.round(x * T), Math.round(y * T), Math.round(w * T), Math.round(h * T)); }

function drawRoom(now) {
  // floor and walls
  tile('oak_parquet', 0, 2, W, H - 2);
  tile('terracotta_tile', 0, 15, 15, 5);                 // lounge rug area
  tile('plaster_panel', 0, 0, W, 2);
  rect('#3a2a20', 0, 1.75, W, 0.25);
  for (let wx = 2; wx < W; wx += 6) {                      // windows
    rect('#2a201a', wx, 0.25, 3, 1.3); rect('#8cc0d6', wx + 0.15, 0.4, 2.7, 1.0);
    rect('#b9dbe8', wx + 0.15, 0.4, 2.7, 0.3); rect('#2a201a', wx + 1.43, 0.4, 0.14, 1.0);
  }
  // library shelves (top left)
  for (let i = 0; i < 3; i++) {
    const sx = 1.5 + i * 2.2;
    rect('#4a3424', sx, 2.2, 2, 2.4);
    for (let r = 0; r < 3; r++) {
      rect('#2c1f16', sx + 0.1, 2.35 + r * 0.75, 1.8, 0.62);
      for (let b = 0; b < 7; b++) {
        const hue = ['#b9543f', '#2f6f8f', '#c9a227', '#6d8f5a', '#7a4f8a', '#d2c3a6', '#9c3d3d'][(b + r * 3 + i) % 7];
        rect(hue, sx + 0.18 + b * 0.24, 2.45 + r * 0.75 + (b % 3) * 0.04, 0.18, 0.52 - (b % 3) * 0.04);
      }
    }
  }
  // desks
  DESKS.forEach((d, k) => {
    const owner = [...deskOf.entries()].find(([, v]) => v === k)?.[0];
    const a = owner ? S.agents.get(owner) : null;
    const working = a && a.active && a.station === 'desk' && !['idle', 'done'].includes(a.state);
    rect('#2a1d15', d.x - 0.05, d.y + 0.95, 3.1, 0.25);           // shadow
    tile('walnut_panel', d.x, d.y, 3, 1);
    rect('#6b4a33', d.x, d.y + 0.85, 3, 0.15);
    // monitor
    rect('#1b1b1b', d.x + 0.9, d.y - 0.95, 1.2, 0.95);
    tile(working ? 'monitor_screen_on' : 'monitor_screen_off', d.x + 1, d.y - 0.85);
    if (working) {                                                  // scrolling code lines
      const off = Math.floor(now / 350) % 4;
      for (let l = 0; l < 4; l++) rect(['#9be59a', '#cfe8dc', '#ff9c8e', '#9fd9d6'][(l + off) % 4], d.x + 1.1, d.y - 0.75 + l * 0.17, 0.25 + ((l * 7 + off * 3) % 6) / 10, 0.07);
    }
    rect('#333', d.x + 1.4, d.y - 0.05, 0.2, 0.15);
    if (a) rect(a.color, d.x + 0.15, d.y + 0.2, 0.5, 0.12);         // name tag colour on the desk
    if (d.lead) { rect('#c9a227', d.x + 2.3, d.y + 0.15, 0.4, 0.4); rect('#e6c45a', d.x + 2.38, d.y + 0.2, 0.24, 0.12); }
    // chair
    rect('#3d2a1e', d.x + 1.05, d.y + 1.35, 0.9, 0.7);
    rect('#5a3e2b', d.x + 1.1, d.y + 1.4, 0.8, 0.45);
  });
  // terminal + test bench (top right)
  rect('#2d2d33', 22.6, 3.2, 3.2, 1.6); tile('console_screen', 23.2, 3.4); tile('console_screen', 24.3, 3.4);
  rect('#4a3424', 27.2, 3.6, 3.2, 1.2); rect('#8fa98b', 27.5, 3.3, 0.5, 0.5); rect('#c9a227', 28.3, 3.2, 0.4, 0.6); rect('#2fa3a0', 29.1, 3.35, 0.6, 0.45);
  // merge station + decision podium
  tile('merge_station_front', 23.6, 8.6); tile('walnut_panel', 22.8, 9.2, 3, 1); rect('#6b4a33', 22.8, 10, 3, 0.15);
  rect('#4a3424', 27.9, 8.3, 1.4, 1.9); tile('decision_podium_front', 28.1, 8.6);
  const open = [...S.decisions.values()].some((d) => d.status === 'open');
  rect(open ? '#d97757' : '#6b5a4c', 28.35, 8.05, 0.9, 0.3);
  // task board on the wall
  rect('#4a3424', 10.5, 0.15, 6.5, 1.55); tile('task_board_surface', 10.7, 0.3, 6, 1);
  const cols = ['todo', 'doing', 'review', 'done'];
  cols.forEach((c, i) => {
    const n = [...S.tasks.values()].filter((t) => t.status === c).length;
    for (let k = 0; k < Math.min(n, 4); k++) rect(['#f4efe6', '#9fd9d6', '#e6c45a', '#b8cdb4'][i], 10.9 + i * 1.5 + (k % 2) * 0.6, 0.45 + Math.floor(k / 2) * 0.5, 0.45, 0.35);
  });
  // meeting table
  rect('#2a1d15', 22.4, 16.25, 7.2, 0.3); tile('walnut_panel', 22.2, 15.4, 7, 1); rect('#6b4a33', 22.2, 16.2, 7, 0.15);
  // lounge sofa
  rect('#5b3b5f', 1.5, 17.6, 13, 1.2); rect('#6f4a74', 1.5, 16.9, 13, 0.8); rect('#4a2f4d', 1.2, 16.9, 0.5, 1.9); rect('#4a2f4d', 14.3, 16.9, 0.5, 1.9);
  // plants
  for (const [px, py] of [[20.5, 2.6], [31, 13.5], [0.6, 13.5]]) { rect('#8a5a3c', px - 0.3, py + 0.4, 0.6, 0.5); rect('#5e8a4f', px - 0.45, py - 0.2, 0.9, 0.7); rect('#77a865', px - 0.2, py - 0.4, 0.45, 0.4); }
  // lamps glow
  const glow = (lx, ly) => { const grd = g.createRadialGradient(lx * T, ly * T, 2, lx * T, ly * T, 3 * T); grd.addColorStop(0, 'rgba(255,214,140,.22)'); grd.addColorStop(1, 'rgba(255,214,140,0)'); g.fillStyle = grd; g.fillRect((lx - 3) * T, (ly - 3) * T, 6 * T, 6 * T); };
  glow(7, 7); glow(17, 7); glow(26, 7); glow(8, 15);
}

// movement (shared by the 2D and 3D views): positions are in tile units
function updateActors(dt) {
  for (const [id, ac] of actors) {
    if (!S.agents.get(id)) continue;
    const ox = ac.x, oy = ac.y;
    const dx = ac.tx - ac.x, dy = ac.ty - ac.y, dist = Math.hypot(dx, dy);
    const speed = 4.2 * dt;  // tiles per second
    if (dist > 0.02) {
      // walk the long axis first, like people in an office
      if (Math.abs(dx) > 0.02 && Math.abs(dy) > 0.6) { ac.y += Math.sign(dy) * Math.min(speed, Math.abs(dy)); }
      else { const k = Math.min(1, speed / dist); ac.x += dx * k; ac.y += dy * k; }
      ac.moving = true;
    } else { ac.x = ac.tx; ac.y = ac.ty; ac.moving = false; }
    ac.seated = !ac.moving && ac.seatAt;
    if (ac.moving) ac.heading = Math.atan2(ac.x - ox, ac.y - oy);
  }
}

function drawActors(now) {
  const list = [...actors.entries()].map(([id, ac]) => ({ id, ac, a: S.agents.get(id) })).filter((o) => o.a);
  const r = canvas.getBoundingClientRect(), fr = $('#floor').getBoundingClientRect();
  const sx = r.width / canvas.width, sy = r.height / canvas.height, ox = r.left - fr.left, oy = r.top - fr.top;
  list.sort((p, q) => p.ac.y - q.ac.y);
  for (const { a, ac } of list) {
    if (!ac.sprite) continue;
    const px = Math.round(ac.x * T - 8), feet = Math.round(ac.y * T);
    const bob = ac.moving ? Math.round(Math.abs(Math.sin(now / 110 + ac.phase)) * 1.5) : 0;
    g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(px + 8, feet, 6, 2.2, 0, 0, Math.PI * 2); g.fill();
    g.globalAlpha = a.active ? 1 : 0.7;
    if (ac.seated) {
      g.drawImage(ac.sprite.body, 0, 0, 16, 26, px, feet - 26 + 2, 16, 26);   // legs tucked under the desk
    } else {
      g.drawImage(ac.sprite.body, px, feet - 32 - bob);
    }
    g.globalAlpha = 1;
    // little working sparkle
    if (a.active && !a.paused && ['thinking', 'reading', 'editing', 'running', 'testing'].includes(a.state)) {
      const t = (now / 400 + ac.phase) % 1;
      g.fillStyle = STATE_COLOR[a.state];
      g.globalAlpha = 1 - t;
      g.fillRect(px + 12 + Math.round(Math.sin(t * 6) * 2), feet - 34 - Math.round(t * 10), 2, 2);
      g.globalAlpha = 1;
    }
    ac.screen = { x: ac.x * T + 0, top: feet - (ac.seated ? 24 : 32) - bob };
    ac.anchor = { x: ox + ac.screen.x * sx, y: oy + ac.screen.top * sy - 4 };
  }
}

// HTML overlay: nameplates, "!" and speech bubbles (crisp text on top of the pixel art)
const overlay = $('#overlay');
const plates = new Map();
function drawOverlay() {
  const openBy = new Map();
  for (const d of S.decisions.values()) if (d.status === 'open' && !openBy.has(d.agentId)) openBy.set(d.agentId, d.id);
  const seen = new Set();
  for (const [id, ac] of actors) {
    const a = S.agents.get(id);
    if (!a || !ac.anchor || ac.anchor.hidden) continue;
    seen.add(id);
    let p = plates.get(id);
    if (!p) {
      p = { plate: document.createElement('div'), bang: document.createElement('div'), say: document.createElement('div') };
      p.plate.className = 'plate'; p.bang.className = 'bang'; p.bang.textContent = '!'; p.say.className = 'say';
      p.plate.onclick = () => openAgent(id);
      p.bang.onclick = () => openDecision(openBy.get(id) ?? [...S.decisions.values()].find((d) => d.agentId === id && d.status === 'open')?.id);
      overlay.append(p.plate, p.bang, p.say);
      plates.set(id, p);
    }
    const x = ac.anchor.x, y = ac.anchor.y;
    const word = a.paused ? 'paused' : a.active ? STATE_WORD[a.state] : 'off shift';
    const html = `<div class="who"><span class="dot" style="background:${a.active ? STATE_COLOR[a.state] : '#6b5a4c'}"></span>${esc(a.name)}</div>` +
      `<div class="what">${esc(a.active ? (a.activity || word) : word)}</div>`;
    if (p.html !== html) { p.plate.innerHTML = html; p.html = html; }
    p.plate.classList.toggle('off', !a.active);
    p.plate.style.left = x + 'px'; p.plate.style.top = y + 'px';
    const hasBang = openBy.has(id);
    p.bang.hidden = !hasBang;
    if (hasBang) { p.bang.style.left = x + 'px'; p.bang.style.top = (y - p.plate.offsetHeight - 6) + 'px'; }
    const say = S.says.get(id);
    const showSay = say && say.until > Date.now();
    p.say.hidden = !showSay;
    if (showSay) {
      const to = say.to && say.to !== 'all' ? (say.to === 'user' ? `to ${userName()}` : `to ${S.agents.get(say.to)?.name ?? say.to}`) : '';
      const sh = `${to ? `<div class="to">${esc(to)}</div>` : ''}${esc(say.text.length > 140 ? say.text.slice(0, 137) + '...' : say.text)}`;
      if (p.sayHtml !== sh) { p.say.innerHTML = sh; p.sayHtml = sh; }
      p.say.style.left = x + 'px';
      p.say.style.top = (y - p.plate.offsetHeight - (hasBang ? 34 : 8)) + 'px';
    }
  }
  for (const [id, p] of plates) if (!seen.has(id)) { p.plate.remove(); p.bang.remove(); p.say.remove(); plates.delete(id); }
  declutter();
}

// nameplates of agents standing close together: lift the later ones so none overlap
function declutter() {
  const placed = [];
  const items = [...plates.values()].map((p) => ({ p, top: parseFloat(p.plate.style.top), left: parseFloat(p.plate.style.left) }))
    .sort((a, b) => b.top - a.top || a.left - b.left);
  for (const it of items) {
    const w = it.p.plate.offsetWidth, h = it.p.plate.offsetHeight;
    let top = it.top;
    for (let guard = 0; guard < 6; guard++) {
      const hit = placed.find((o) => Math.abs(o.left - it.left) < (o.w + w) / 2 + 2 && top > o.top - h - 2 && top - h < o.top + 2);
      if (!hit) break;
      top = hit.top - hit.h - 3;
    }
    if (top !== it.top) {
      const lift = it.top - top;
      it.p.plate.style.top = top + 'px';
      if (!it.p.bang.hidden) it.p.bang.style.top = (parseFloat(it.p.bang.style.top) - lift) + 'px';
      if (!it.p.say.hidden) it.p.say.style.top = (parseFloat(it.p.say.style.top) - lift) + 'px';
    }
    placed.push({ left: it.left, top, w, h });
  }
}

function fitCanvas() {
  const fr = $('#floor').getBoundingClientRect();
  const k = Math.max(1, Math.min(fr.width / canvas.width, fr.height / canvas.height));
  canvas.style.width = Math.floor(canvas.width * k) + 'px';
  canvas.style.height = Math.floor(canvas.height * k) + 'px';
}
window.addEventListener('resize', fitCanvas);

// click on a figure (not only its nameplate)
canvas.addEventListener('click', (e) => {
  if (viewMode === '3d') return;
  const r = canvas.getBoundingClientRect();
  const mx = (e.clientX - r.left) * canvas.width / r.width, my = (e.clientY - r.top) * canvas.height / r.height;
  for (const [id, ac] of actors) {
    if (!ac.screen) continue;
    if (Math.abs(mx - ac.x * T) < 9 && my > ac.screen.top && my < ac.y * T + 2) { openAgent(id); return; }
  }
  if (mx > 27.5 * T && mx < 29.5 * T && my > 8 * T && my < 10.5 * T) { const d = firstOpenDecision(); if (d) openDecision(d.id); }
  if (mx > 10.5 * T && mx < 17 * T && my < 2 * T) $('#p-tasks').scrollIntoView();
  if (mx < 8 * T && my > 2 * T && my < 5 * T) openLibrary();
});

// 2D or 3D (view3d.js registers window.View3D)
let viewMode = (() => { try { return localStorage.getItem('ac-view') || '3d'; } catch { return '3d'; } })();
function setView(m) {
  viewMode = m;
  try { localStorage.setItem('ac-view', m); } catch { /* private window */ }
  $('#btn-view').textContent = m === '3d' ? '2D view' : '3D view';
  canvas.hidden = m === '3d';
  window.View3D?.setVisible(m === '3d');
  fitCanvas();
}
$('#btn-view').onclick = () => setView(viewMode === '3d' ? '2d' : '3d');

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  updateActors(dt);
  if (viewMode === '3d' && window.View3D) {
    if (!window.View3D.visible) setView('3d');
    window.View3D.render(now, dt);
  } else {
    g.clearRect(0, 0, canvas.width, canvas.height);
    drawRoom(now);
    drawActors(now);
  }
  drawOverlay();
  requestAnimationFrame(frame);
}

// what the 3D view needs from here
window.AC = {
  S, actors, DESKS, SPOTS, STATE_COLOR, deskOf,
  openAgent: (id) => openAgent(id), openDecision: (id) => openDecision(id), openLibrary: () => openLibrary(),
  modal: (kind, id, html) => modal(kind, id, html), closeModal: () => closeModal(), isModalOpen: () => !!openModal, modalKind: () => openModal?.kind ?? null,
  toast: (t, l) => toast(t, l), esc,
  addFeed: (item) => { S.feed.push(item); if (S.feed.length > 200) S.feed.shift(); renderFeed(); },
  prefill: (text) => { const c = $('#cmd'); c.value = text; c.focus(); c.setSelectionRange(text.length, text.length); },
  firstOpenDecision: () => firstOpenDecision(), wallTasks: () => wallTasks(), focusTasks: () => $('#p-tasks').scrollIntoView(),
};

// ---------------------------------------------------------------------------------------------
// panels
// ---------------------------------------------------------------------------------------------
function renderAll() { renderHeader(); renderDecisions(); renderTasks(); renderFeed(); renderAgentsUi(); }
function renderAgentsUi() { for (const a of S.agents.values()) ensureActor(a); }

function currentRepo() {
  if (S.goal?.repoId && S.repos.has(S.goal.repoId)) return S.repos.get(S.goal.repoId);
  return [...S.repos.values()].pop();
}
function renderHeader() {
  const r = currentRepo();
  $('#repo').innerHTML = r
    ? `<b>${esc(r.name)}</b> &middot; ${esc(r.branch)}${r.dirty ? ' <span class="warn">&middot; uncommitted changes</span>' : ''}`
    : 'No project yet: <b>/repo add C:\\path</b>';
  const gl = S.goal;
  $('#goal-text').textContent = gl ? `${gl.text}  (${gl.status}, ${Math.round(gl.progress * 100)}%)` : 'No goal yet. Type one below.';
  $('#goal-fill').style.width = gl ? Math.round(gl.progress * 100) + '%' : '0';
  const f = S.foreman;
  if (f) {
    const who = f.backend === 'sim' ? 'Demo team' : f.backend === 'claude' ? 'Claude' : 'Codex';
    const cost = typeof f.costUsd === 'number' ? ` &middot; $${f.costUsd.toFixed(2)}` : '';
    const auth = f.auth === 'ok' ? '' : f.auth === 'failed' ? ' <span class="warn">&middot; sign-in failed</span>' : ` &middot; ${esc(f.auth)}`;
    $('#backend').innerHTML = `<b>${who}</b>${cost}${auth}`;
    $('#backend').title = f.message ?? '';
    if (f.auth === 'failed') banner(f.message || 'The agents cannot run: check the API key in War Room settings.');
    else if (S.connected) banner(null);
  }
  document.title = `${openDecisions().length ? `(${openDecisions().length}) ` : ''}War Room`;
}

const openDecisions = () => [...S.decisions.values()].filter((d) => d.status === 'open').sort((a, b) => a.createdAt - b.createdAt);
const firstOpenDecision = () => openDecisions()[0];
function renderDecisions() {
  const list = openDecisions();
  $('#dec-count').textContent = list.length;
  $('#dec-count').classList.toggle('hot', list.length > 0);
  $('#decisions').innerHTML = list.map((d) => {
    const a = S.agents.get(d.agentId);
    const kind = d.kind === 'merge' ? 'Merge review' : d.kind === 'permission' ? `Permission${d.tool ? ': ' + d.tool : ''}` : 'Question';
    return `<div class="dec" data-id="${esc(d.id)}" style="border-left-color:${a?.color ?? '#d97757'}">
      <div class="k">${esc(kind)} &middot; ${esc(a?.name ?? d.agentId)}</div><div class="q">${esc(d.question)}</div></div>`;
  }).join('');
  for (const el of $('#decisions').children) el.onclick = () => openDecision(el.dataset.id);
  renderHeader();
}

// the current goal's tasks; if it has none (e.g. it was cancelled), every task that is still open
function wallTasks() {
  const live = [...S.tasks.values()].filter((t) => t.status !== 'cancelled');
  const mine = S.goal ? live.filter((t) => !t.goalId || t.goalId === S.goal.id) : live;
  return mine.length ? mine : live.filter((t) => t.status !== 'done');
}
function renderTasks() {
  const cols = [['todo', 'To do'], ['doing', 'Doing'], ['review', 'Review'], ['done', 'Done']];
  const tasks = wallTasks();
  $('#tasks').innerHTML = cols.map(([k, label]) => {
    const items = tasks.filter((t) => (k === 'todo' ? t.status === 'todo' || t.status === 'blocked' : t.status === k))
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    return `<div class="col"><h3>${label} ${items.length}</h3>${items.map((t) => {
      const a = t.assignee ? S.agents.get(t.assignee) : null;
      return `<div class="card ${t.status}" data-id="${esc(t.id)}" title="${esc(t.title)}"><span class="tid">${esc(t.id)}${t.status === 'blocked' ? ' &middot; blocked' : ''}</span> ${esc(t.title)}
        ${a ? `<div class="who"><span class="dot" style="background:${a.color}"></span>${esc(a.name)}</div>` : ''}</div>`;
    }).join('')}</div>`;
  }).join('');
  for (const el of $('#tasks').querySelectorAll('.card')) el.onclick = () => openTask(el.dataset.id);
}

function renderFeed() {
  const el = $('#feed');
  const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
  el.innerHTML = S.feed.slice(-120).map((f) =>
    `<div class="fi ${esc(f.kind)}"><span class="t">${hhmm(f.ts)}</span><span>${esc(f.text)}</span></div>`).join('');
  if (stick) el.scrollTop = el.scrollHeight;
}

function banner(text, soft) {
  const b = $('#banner');
  b.hidden = !text;
  b.textContent = text ?? '';
  b.classList.toggle('soft', !!soft);
}
function toast(text, level = 'info', onClick) {
  const t = document.createElement('div');
  t.className = 'toast ' + level;
  t.textContent = text;
  if (onClick) t.onclick = () => { onClick(); t.remove(); };
  $('#toasts').append(t);
  setTimeout(() => t.remove(), level === 'need_user' ? 12000 : 6000);
}
let audio;
function bell() {
  try {
    audio ??= new AudioContext();
    for (const [f, d] of [[880, 0], [1320, 0.12]]) {
      const o = audio.createOscillator(), v = audio.createGain();
      o.frequency.value = f; o.type = 'sine';
      v.gain.setValueAtTime(0.0001, audio.currentTime + d);
      v.gain.exponentialRampToValueAtTime(0.15, audio.currentTime + d + 0.01);
      v.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + d + 0.9);
      o.connect(v).connect(audio.destination); o.start(audio.currentTime + d); o.stop(audio.currentTime + d + 1);
    }
  } catch { /* no audio */ }
}

// ---------------------------------------------------------------------------------------------
// dialogs
// ---------------------------------------------------------------------------------------------
let openModal = null;
function modal(kind, id, html) {
  openModal = { kind, id };
  $('#modal-box').innerHTML = html;
  $('#modal').hidden = false;
  for (const x of $('#modal-box').querySelectorAll('[data-close]')) x.onclick = closeModal;
}
function closeModal() { $('#modal').hidden = true; openModal = null; if (viewMode !== '3d') $('#cmd').focus(); }
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openModal) closeModal();
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (e.key === 'j' && !openModal && !typing) { const d = firstOpenDecision(); if (d) { e.preventDefault(); openDecision(d.id); } }
  if ((e.key === '`' || e.key === 'Enter') && !openModal && !typing) { e.preventDefault(); $('#cmd').focus(); }
  if (e.key === 'Escape' && document.activeElement === $('#cmd')) $('#cmd').blur();
});

function portrait(skin, size = 40) {
  const c = document.createElement('canvas'); c.width = 8; c.height = 8;
  makeSprite(skin).then((s) => { if (s) c.getContext('2d').drawImage(s.face, 0, 0); });
  c.style.width = c.style.height = size + 'px';
  return c;
}

// agent card: state, task, live monitor, message, pause / stop
function openAgent(id) {
  const a = S.agents.get(id);
  if (!a) return;
  const t = a.taskId ? S.tasks.get(a.taskId) : null;
  const engine = a.model ? `${a.model}` : a.engine ?? (S.foreman?.backend === 'sim' ? 'demo' : '');
  modal('agent', id, `
    <div class="m-head"><span id="pf"></span><h1>${esc(a.name)} <span class="sub">${esc(a.title ?? a.role)}${engine ? ' &middot; ' + esc(engine) : ''}</span></h1>
      <button class="x" data-close aria-label="Close">&times;</button></div>
    <div class="m-body">
      <dl class="kv">
        <dt>Now</dt><dd><span class="dot" style="background:${STATE_COLOR[a.state]}"></span> ${esc(a.paused ? 'paused' : a.active ? STATE_WORD[a.state] : 'off shift')}${a.activity ? ' &middot; ' + esc(a.activity) : ''}</dd>
        <dt>Task</dt><dd>${t ? `<a href="#" id="go-task">${esc(t.id)} ${esc(t.title)}</a>` : '<span class="muted">none</span>'}</dd>
        ${a.worktree ? `<dt>Branch</dt><dd>${esc(t?.branch ?? a.worktree)}</dd>` : ''}
      </dl>
      <div class="monitor" id="mon"></div>
      <div class="row"><input type="text" id="msg" placeholder="Message ${esc(a.name)}..."><button id="send">Send</button></div>
    </div>
    <div class="m-foot">
      <div class="left">${a.worktree && a.repoId ? '<button class="quiet" id="see-diff">See changes</button>' : ''}</div>
      ${a.active ? `<button class="ghost quiet" id="pause">${a.paused ? 'Resume' : 'Pause'}</button><button class="danger" id="stop">Take off shift</button>`
                 : '<button id="spawn">Bring on shift</button>'}
    </div>`);
  $('#pf').append(portrait(a.skin));
  renderMonitor(id);
  const sendMsg = () => { const v = $('#msg').value.trim(); if (!v) return; act('user.message', { to: id, text: v }, `Sent to ${a.name}`); $('#msg').value = ''; };
  $('#send').onclick = sendMsg;
  $('#msg').onkeydown = (e) => { if (e.key === 'Enter') sendMsg(); };
  $('#go-task')?.addEventListener('click', (e) => { e.preventDefault(); openTask(t.id); });
  $('#see-diff')?.addEventListener('click', () => openDiff(a.repoId, a.worktree, `${a.name}'s changes`));
  $('#pause')?.addEventListener('click', () => { act('agent.action', { agentId: id, action: a.paused ? 'resume' : 'pause' }); closeModal(); });
  $('#stop')?.addEventListener('click', () => { act('agent.action', { agentId: id, action: 'stop' }); closeModal(); });
  $('#spawn')?.addEventListener('click', () => { act('agent.action', { agentId: id, action: 'spawn' }); closeModal(); });
  $('#msg').focus();
}
function renderMonitor(id) {
  const el = $('#mon');
  if (!el) return;
  const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
  const entries = S.logs.get(id) ?? [];
  el.innerHTML = entries.length ? entries.map((e) => {
    let body = esc(e.text);
    if (e.kind === 'diff') body = e.text.split('\n').map((l) => `<span class="${l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}">${esc(l)}</span>`).join('\n');
    return `<div class="le ${e.kind}"><span class="ts">${hhmm(e.ts)}</span>${body}</div>`;
  }).join('') : '<span style="opacity:.6">Nothing on the screen yet.</span>';
  if (stick) el.scrollTop = el.scrollHeight;
}

// decisions: questions, permissions, merges
function openDecision(id) {
  const d = id && S.decisions.get(id);
  if (!d) return;
  const a = S.agents.get(d.agentId);
  const isOpen = d.status === 'open';
  const kind = d.kind === 'merge' ? 'Merge review' : d.kind === 'permission' ? 'Permission' : 'Question';
  const answered = d.answer ? `<p class="muted">${esc(userName())} answered: <b>${esc(d.answer.option ?? '')}</b> ${esc(d.answer.text ?? '')}</p>` : '';
  const free = d.kind === 'question' || d.kind === 'merge';
  modal('decision', id, `
    <div class="m-head"><span id="pf"></span><h1>${esc(kind)} <span class="sub">from ${esc(a?.name ?? d.agentId)}</span></h1>
      <button class="x" data-close aria-label="Close">&times;</button></div>
    <div class="m-body">
      <p style="font-size:15px;margin:0 0 6px"><b>${esc(d.question)}</b></p>
      ${d.context ? `<pre class="ctx">${esc(d.context)}</pre>` : ''}
      ${d.kind === 'merge' && d.repoId && d.worktree ? '<div id="diffbox"><p class="muted">Loading the changes...</p></div>' : ''}
      ${isOpen && free ? `<label class="muted" for="ans">${d.kind === 'merge' ? 'Feedback (needed for "Request changes")' : d.options.length ? 'Or answer in your own words' : 'Your answer'}</label><textarea id="ans"></textarea>` : ''}
      ${!isOpen ? answered || '<p class="muted">This is no longer open.</p>' : ''}
    </div>
    <div class="m-foot">${isOpen ? d.options.map((o, i) =>
      `<button class="${i === 0 ? '' : o === 'Reject' || o === 'Deny' ? 'danger' : 'quiet'}" data-opt="${esc(o)}">${esc(o)}</button>`).join('') +
      (d.kind === 'question' && !d.options.length ? '<button data-opt="">Send answer</button>' : '') : '<button class="quiet" data-close>Close</button>'}</div>`);
  if (a) $('#pf').append(portrait(a.skin));
  for (const b of $('#modal-box').querySelectorAll('[data-opt]')) {
    b.onclick = async () => {
      const option = b.dataset.opt || undefined;
      const text = $('#ans')?.value.trim() || undefined;
      if (option === 'Request changes' && !text) { toast('Write what should change first.', 'warn'); $('#ans').focus(); return; }
      if (!option && !text) { toast('Write an answer first.', 'warn'); return; }
      b.disabled = true;
      const r = await act('decision.answer', { decisionId: id, ...(option !== undefined ? { option } : {}), ...(text ? { text } : {}) });
      if (r) closeModal(); else b.disabled = false;
    };
  }
  if (d.kind === 'merge' && d.repoId && d.worktree) loadDiff(d.repoId, d.worktree, $('#diffbox'));
}
function refreshDecisionModal(d) {
  if (openModal?.kind === 'decision' && openModal.id === d.id && d.status !== 'open') openDecision(d.id);
}

// diffs
function requestDiff(repoId, worktree) {
  const requestId = 'r' + nextId++;
  return new Promise((resolve) => {
    diffWaiters.set(requestId, resolve);
    send('diff.request', { requestId, repoId, worktree }).catch((e) => { diffWaiters.delete(requestId); resolve({ error: e.message, files: [] }); });
    setTimeout(() => { if (diffWaiters.delete(requestId)) resolve({ error: 'the Foreman did not answer', files: [] }); }, 20000);
  });
}
async function loadDiff(repoId, worktree, box) {
  const d = await requestDiff(repoId, worktree);
  if (!box.isConnected) return;
  if (d.error) { box.innerHTML = `<p class="muted">Could not load the diff: ${esc(d.error)}</p>`; return; }
  if (!d.files.length) { box.innerHTML = '<p class="muted">No changes.</p>'; return; }
  box.innerHTML = `<p class="muted">${d.stats.files} files, <span style="color:var(--add-fg)">+${d.stats.additions}</span> <span style="color:var(--del-fg)">-${d.stats.deletions}</span>${d.branch ? ` &middot; ${esc(d.branch)} into ${esc(d.base ?? '')}` : ''}${d.truncated ? ' &middot; large files cut' : ''}</p>
    <div class="diff"><div class="files">${d.files.map((f, i) =>
      `<a data-i="${i}" class="${i === 0 ? 'on' : ''}"><span>${esc(f.path)}</span><span class="st"><span class="a">+${f.additions}</span> <span class="d">-${f.deletions}</span></span></a>`).join('')}</div>
      <div class="hunks" id="hunks"></div></div>`;
  const show = (i) => {
    const f = d.files[i];
    for (const x of box.querySelectorAll('.files a')) x.classList.toggle('on', +x.dataset.i === i);
    $('#hunks', box).innerHTML = `<div class="fname">${esc(f.oldPath ? f.oldPath + ' -> ' : '')}${esc(f.path)} <span class="muted">(${f.status})</span></div>` +
      (f.binary ? '<p class="muted">Binary file.</p>' : f.hunks.map((h) => `<div class="hunk"><div class="hh">${esc(h.header)}</div>${h.lines.map((l) =>
        `<div class="dl ${l.kind}"><span class="n">${l.oldNo ?? ''}</span><span class="n">${l.newNo ?? ''}</span><span>${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${esc(l.text)}</span></div>`).join('')}</div>`).join(''));
  };
  for (const x of box.querySelectorAll('.files a')) x.onclick = () => show(+x.dataset.i);
  show(0);
}
function openDiff(repoId, worktree, title) {
  modal('diff', worktree, `<div class="m-head"><h1>${esc(title)}</h1><button class="x" data-close aria-label="Close">&times;</button></div>
    <div class="m-body"><div id="diffbox"><p class="muted">Loading the changes...</p></div></div>`);
  loadDiff(repoId, worktree, $('#diffbox'));
}

// tasks
function openTask(id) {
  const t = S.tasks.get(id);
  if (!t) return;
  const a = t.assignee ? S.agents.get(t.assignee) : null;
  const workers = [...S.agents.values()].filter((x) => x.role === 'worker');
  modal('task', id, `
    <div class="m-head"><h1>${esc(t.id)} &middot; ${esc(t.title)}</h1><button class="x" data-close aria-label="Close">&times;</button></div>
    <div class="m-body">
      <dl class="kv">
        <dt>Status</dt><dd>${esc(t.status)}${t.blockedReason ? ' &middot; ' + esc(t.blockedReason) : ''}</dd>
        <dt>Assigned to</dt><dd>${a ? esc(a.name) : '<span class="muted">nobody yet</span>'}</dd>
        <dt>Depends on</dt><dd>${t.deps.length ? t.deps.map(esc).join(', ') : '<span class="muted">nothing</span>'}</dd>
        <dt>Tests</dt><dd>${esc(t.ci)}</dd>
        ${t.branch ? `<dt>Branch</dt><dd>${esc(t.branch)}</dd>` : ''}
        <dt>Created by</dt><dd>${esc(S.agents.get(t.createdBy)?.name ?? t.createdBy)}</dd>
      </dl>
      ${t.description ? `<pre class="ctx">${esc(t.description)}</pre>` : ''}
      ${t.summary ? `<p><b>Summary</b></p><pre class="ctx">${esc(t.summary)}</pre>` : ''}
    </div>
    <div class="m-foot">
      <div class="left">${t.worktree && t.repoId ? '<button class="quiet" id="tdiff">See changes</button>' : ''}</div>
      <select id="reassign" style="width:auto"><option value="">Reassign to...</option>${workers.map((w) => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('')}</select>
      <button class="quiet" id="prio">Do it next</button>
      ${t.status === 'blocked' || t.ci === 'fail' ? '<button class="quiet" id="retry">Retry</button>' : ''}
      ${t.status !== 'done' ? '<button class="danger" id="cancel">Cancel task</button>' : ''}
    </div>`);
  $('#tdiff')?.addEventListener('click', () => openDiff(t.repoId, t.worktree, `${t.id} changes`));
  $('#reassign').onchange = (e) => { if (e.target.value) { act('task.action', { taskId: id, action: 'reassign', arg: e.target.value }, 'Reassigned'); closeModal(); } };
  $('#prio').onclick = () => { act('task.action', { taskId: id, action: 'prioritize' }, 'Moved to the top'); closeModal(); };
  $('#retry')?.addEventListener('click', () => { act('task.action', { taskId: id, action: 'retry' }); closeModal(); });
  $('#cancel')?.addEventListener('click', () => { if (confirm(`Cancel ${t.id}?`)) { act('task.action', { taskId: id, action: 'cancel' }); closeModal(); } });
}

// shared memory library
function openLibrary() {
  const entries = [...S.memory.values()].sort((a, b) => b.updated - a.updated);
  modal('library', '', `
    <div class="m-head"><h1>Library <span class="sub">the plan, decisions and conventions every agent reads</span></h1><button class="x" data-close aria-label="Close">&times;</button></div>
    <div class="m-body">${entries.length ? `<div class="mem"><div class="files">${entries.map((m, i) =>
      `<a data-i="${i}" class="${i === 0 ? 'on' : ''}"><span>${esc(m.title)}</span><span class="st">${esc(m.scope === 'shared' ? '' : S.agents.get(m.scope)?.name ?? m.scope)}</span></a>`).join('')}</div><div class="body" id="membody"></div></div>`
      : '<p class="muted">Empty. The lead writes the plan here when you give a goal.</p>'}</div>`);
  const show = (i) => {
    const m = entries[i];
    for (const x of $('#modal-box').querySelectorAll('.files a')) x.classList.toggle('on', +x.dataset.i === i);
    $('#membody').textContent = m.body;
  };
  for (const x of $('#modal-box').querySelectorAll('.files a')) x.onclick = () => show(+x.dataset.i);
  if (entries.length) show(0);
}
$('#btn-library').onclick = openLibrary;

// ---------------------------------------------------------------------------------------------
// console (same commands as the in-game console)
// ---------------------------------------------------------------------------------------------
const cmd = $('#cmd'), sug = $('#suggest');
let sugIdx = 0, sugItems = [];
const HELP = `Plain text: a new goal for the team
@name text: message an agent (Tab completes names)
/answer [dN] <n or option> [text]: answer a decision
/repo add <path>: add a project (a git repository)
/pause @x, /resume @x, /stop @x, /spawn @x [task]
/task <id> cancel|retry|prioritize|reassign <agent>
/diff @x: see an agent's changes
/chat <text>: to everyone on the campus   /say <text>: only to who stands near you
/announce <text>: pin a note on the announcement boards   /cart: bring your cart
/arena: the agent arena (squad, rules, budget)   /order <name|all> <text>: order your operatives
/office: join or create an office   /host: host a session for everyone on this network
/voice: microphone on or off (hold V to talk)
/library: shared memory   J: next decision`;

cmd.addEventListener('keydown', async (e) => {
  if (!sug.hidden && (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    if (e.key === 'ArrowUp') sugIdx = (sugIdx - 1 + sugItems.length) % sugItems.length;
    else if (e.key === 'ArrowDown') sugIdx = (sugIdx + 1) % sugItems.length;
    else { completeName(sugItems[sugIdx]); return; }
    paintSuggest();
    return;
  }
  if (e.key === 'Enter') {
    const v = cmd.value.trim();
    if (!v) return;
    cmd.value = ''; sug.hidden = true;
    await runCommand(v);
  }
  if (e.key === 'Escape') sug.hidden = true;
});
cmd.addEventListener('input', () => {
  const m = /(^|\s)@(\w*)$/.exec(cmd.value);
  if (!m) { sug.hidden = true; return; }
  sugItems = [...S.agents.values()].filter((a) => a.id.startsWith(m[2].toLowerCase())).map((a) => a.id);
  sugIdx = 0;
  sug.hidden = !sugItems.length;
  paintSuggest();
});
function paintSuggest() {
  sug.innerHTML = sugItems.map((id, i) => { const a = S.agents.get(id); return `<div class="${i === sugIdx ? 'on' : ''}" data-id="${id}"><span class="dot" style="background:${a.color}"></span>@${id} <span class="muted">${esc(a.title ?? '')}</span></div>`; }).join('');
  for (const el of sug.children) el.onmousedown = (e) => { e.preventDefault(); completeName(el.dataset.id); };
}
function completeName(id) { cmd.value = cmd.value.replace(/@\w*$/, '@' + id + ' '); sug.hidden = true; cmd.focus(); }

async function runCommand(v) {
  const agentArg = (s) => (s ?? '').replace(/^@/, '').toLowerCase();
  if (v.startsWith('@')) {
    const m = /^@(\w+)\s+([\s\S]+)/.exec(v);
    if (!m) return toast('Write a message after the name.', 'warn');
    return act('user.message', { to: 'all', text: v }, `Sent to ${S.agents.get(m[1].toLowerCase())?.name ?? m[1]}`);
  }
  if (!v.startsWith('/')) {
    const r = await act('goal.submit', { text: v, ...(currentRepo() ? { repoId: currentRepo().id } : {}) });
    if (r) toast('New goal sent to the lead.');
    return;
  }
  const [c, ...rest] = v.slice(1).split(/\s+/);
  switch (c.toLowerCase()) {
    case 'help': case '?': toast(HELP); return;
    case 'library': case 'memory': openLibrary(); return;
    case 'chat': case 'say': case 'announce': case 'post': case 'cart': case 'car': case 'arena': case 'order': case 'office': case 'offices': case 'host': case 'voice': case 'mic': {
      const text = v.replace(/^\/\w+\s*/, ''), k = c.toLowerCase();
      if (!window.View3D?.chat) return toast('That needs the 3D view.', 'warn');
      if (k === 'cart' || k === 'car') return window.View3D.cart();
      if (k === 'office' || k === 'offices') return window.View3D.office();
      if (k === 'host') return window.View3D.host(text.trim());
      if (k === 'voice' || k === 'mic') return window.View3D.voice ? window.View3D.voice(text.trim()) : toast('Voice is not available here.', 'warn');
      if (k === 'arena') return window.View3D.arena(text);
      if (k === 'order') return window.View3D.arena('order ' + text);
      if (!text) return toast(`Write something after /${k}.`, 'warn');
      if (k === 'chat') window.View3D.chat(text); else if (k === 'say') window.View3D.say(text); else window.View3D.announce(text);
      return;
    }
    case 'status': toast(`${[...S.agents.values()].filter((a) => a.active).length} agents on shift, ${[...S.tasks.values()].filter((t) => !['done', 'cancelled'].includes(t.status)).length} open tasks, ${openDecisions().length} waiting on you${typeof S.foreman?.costUsd === 'number' ? `, $${S.foreman.costUsd.toFixed(2)} spent` : ''}`); return;
    case 'repo': case 'repos':
      if (rest[0] === 'add' && rest[1]) { const r = await act('repo.add', { path: rest.slice(1).join(' ') }); if (r) toast(`Added ${r.repoId ?? 'the project'}`); }
      else toast([...S.repos.values()].map((r) => `${r.name}: ${r.path}`).join('\n') || 'No projects. /repo add C:\\path\\to\\repo');
      return;
    case 'pause': case 'resume': case 'stop': case 'spawn':
      return act('agent.action', { agentId: agentArg(rest[0]), action: c.toLowerCase(), ...(rest[1] ? { arg: rest[1] } : {}) }, 'Done');
    case 'task':
      return act('task.action', { taskId: rest[0], action: rest[1], ...(rest[2] ? { arg: agentArg(rest[2]) } : {}) }, 'Done');
    case 'diff': {
      const a = S.agents.get(agentArg(rest[0]));
      if (a?.repoId && a.worktree) openDiff(a.repoId, a.worktree, `${a.name}'s changes`);
      else toast('That agent has no changes right now.', 'warn');
      return;
    }
    case 'answer': {
      let [first, ...more] = rest;
      let d;
      if (/^d\d+$/i.test(first ?? '')) { d = S.decisions.get(first.toLowerCase()); first = more.shift(); } else d = firstOpenDecision();
      if (!d) return toast('No open decision.', 'warn');
      const opt = /^\d+$/.test(first ?? '') ? Number(first) - 1 : first;
      return act('decision.answer', { decisionId: d.id, option: opt, ...(more.length ? { text: more.join(' ') } : {}) }, 'Answered');
    }
    default: toast(`Unknown command /${c}. Try /help`, 'warn');
  }
}

// ---------------------------------------------------------------------------------------------
setView(viewMode);
connect();
requestAnimationFrame(frame);
if (viewMode !== '3d') cmd.focus();
