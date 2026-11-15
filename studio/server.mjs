// AgentCraft Studio server: serves the 2D studio app and bridges it to the Foreman.
//
// The Foreman refuses browser connections (any Origin header), so a web page can never drive
// the agents. This server keeps that guarantee: it listens on 127.0.0.1 only, the app page and
// its WebSocket need a random per-run token (handed to the window the launcher opens), the
// WebSocket must come from this server's own origin, and only then is it relayed to the Foreman
// as a plain local client (no Origin).
//
//   node server.mjs --port 7880 --foreman 7878 --foreman-dir ../foreman --state <file>
import http from 'node:http';
import dgram from 'node:dgram';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const PORT = Number(args.port ?? 7880);
const FOREMAN_PORT = Number(args.foreman ?? 7878);
const FOREMAN_DIR = path.resolve(here, args['foreman-dir'] ?? '../foreman');
const STATE = args.state ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.agentcraft', 'studio.json');
const WEB = path.join(here, 'web');

// reuse the Foreman's ws package (no extra dependencies to ship)
const require = createRequire(path.join(FOREMAN_DIR, 'package.json'));
const { WebSocket, WebSocketServer } = require('ws');

const TOKEN = crypto.randomBytes(24).toString('hex');
const ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};

function log(...a) { console.log(new Date().toISOString().slice(11, 19), '[studio]', ...a); }

function cookieToken(req) {
  const m = /(?:^|;\s*)ac_token=([a-f0-9]+)/.exec(req.headers.cookie ?? '');
  return m ? m[1] : null;
}
function same(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const server = http.createServer((req, res) => {
  if (!HOSTS.has(req.headers.host ?? '')) { res.writeHead(403).end(); return; }
  const url = new URL(req.url, `http://${req.headers.host}`);
  // the launcher opens /?t=<token>: trade it for a cookie and drop it from the address bar
  const t = url.searchParams.get('t');
  if (t) {
    if (!same(t, TOKEN)) { res.writeHead(403).end('AgentCraft Studio: start it from the AgentCraft shortcut.'); return; }
    res.writeHead(302, {
      'Set-Cookie': `ac_token=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`,
      Location: '/',
      'Cache-Control': 'no-store',
    }).end();
    return;
  }
  if (!same(cookieToken(req), TOKEN)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' }).end('AgentCraft Studio: start it from the AgentCraft shortcut.');
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(WEB, rel));
  if (!file.startsWith(WEB + path.sep)) { res.writeHead(404).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'",
    }).end(data);
  });
});

const wss = new WebSocketServer({ noServer: true });
const worldWss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const ok = (req.url === '/ws' || req.url === '/world') && HOSTS.has(req.headers.host ?? '') && ORIGINS.has(req.headers.origin ?? '') && same(cookieToken(req), TOKEN);
  if (!ok) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  if (req.url === '/ws') wss.handleUpgrade(req, socket, head, (client) => bridge(client));
  else worldWss.handleUpgrade(req, socket, head, (client) => worldApp(client));
});

function bridge(client) {
  const up = new WebSocket(`ws://127.0.0.1:${FOREMAN_PORT}`);   // a plain local client: no Origin header
  const queue = [];
  up.on('open', () => { for (const m of queue.splice(0)) up.send(m); });
  up.on('message', (data, isBinary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary }); });
  up.on('close', () => client.close(4000, 'foreman closed'));
  up.on('error', () => client.close(4001, 'foreman unreachable'));
  client.on('message', (data) => {
    const text = data.toString();
    if (up.readyState === WebSocket.OPEN) up.send(text); else queue.push(text);
  });
  client.on('close', () => up.close());
  client.on('error', () => up.close());
}

// =============================================================================================
// LAN multiplayer (peer to peer, no central server)
//
// Each studio announces itself on the LAN (UDP broadcast) and connects directly to the others
// over a WebSocket on PEER_PORT. Peers exchange ONLY: name + avatar look, avatar position, chat,
// and an activity summary of the office (agents with their status line, task titles and status,
// goal progress, how many decisions wait). Never logs, diffs, code, decision contents or paths,
// and nothing a peer sends can reach the Foreman. With a team code set, only studios with the
// same code are accepted.
// =============================================================================================
const PEER_PORT = Number(args['peer-port'] ?? 7891);
const DISCO_PORT = Number(args['disco-port'] ?? 7892);
const PEER_FILE = args['peer-file'] ?? path.join(path.dirname(STATE), 'studio-peer.json');
const NO_LAN = args['no-lan'] === '1';

const peerCfg = (() => { try { return JSON.parse(fs.readFileSync(PEER_FILE, 'utf8')); } catch { return {}; } })();
const self = {
  id: typeof peerCfg.id === 'string' && /^[a-f0-9]{16}$/.test(peerCfg.id) ? peerCfg.id : crypto.randomBytes(8).toString('hex'),
  name: os.userInfo().username,
  look: null,
  pos: null,
  code: typeof peerCfg.code === 'string' ? peerCfg.code : '',
  hosts: Array.isArray(peerCfg.hosts) ? peerCfg.hosts.filter((h) => typeof h === 'string').slice(0, 20) : [],
};
function savePeerCfg() {
  try { fs.writeFileSync(PEER_FILE, JSON.stringify({ id: self.id, code: self.code, hosts: self.hosts })); } catch { /* not fatal */ }
}
savePeerCfg();

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const HEX = /^#[0-9a-fA-F]{6}$/;
function cleanLook(l) {
  if (!l || typeof l !== 'object') return null;
  const c = (v, d) => (typeof v === 'string' && HEX.test(v) ? v : d);
  return {
    name: str(l.name, 24), skin: c(l.skin, '#e0ac7e'), hair: c(l.hair, '#3b2a1f'), shirt: c(l.shirt, '#2f6f8f'), pants: c(l.pants, '#3a3f4a'),
    style: ['short', 'long', 'cap', 'bald'].includes(l.style) ? l.style : 'short',
  };
}
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
function cleanPos(p) {
  if (!p || typeof p !== 'object') return null;
  return { anchor: str(p.anchor, 16), dx: num(p.dx, -200, 200), dz: num(p.dz, -200, 200), rot: num(p.rot, -20, 20), moving: !!p.moving };
}
const STATES = new Set(['idle', 'thinking', 'reading', 'editing', 'running', 'testing', 'waiting_user', 'blocked', 'done', 'error']);
const STATIONS = new Set(['desk', 'library', 'terminal', 'testbench', 'mergestation', 'meeting', 'lounge', 'user']);
function cleanOffice(o) {
  if (!o || typeof o !== 'object') return null;
  return {
    backend: str(o.backend, 10),
    repo: str(o.repo, 60),
    goal: o.goal && typeof o.goal === 'object' ? { text: str(o.goal.text, 140), progress: num(o.goal.progress, 0, 1), status: str(o.goal.status, 12) } : null,
    open: Math.round(num(o.open, 0, 999)),
    agents: (Array.isArray(o.agents) ? o.agents : []).slice(0, 12).map((a) => ({
      id: str(a.id, 24), name: str(a.name, 24), role: a.role === 'lead' ? 'lead' : 'worker', skin: /^[a-z0-9_-]{1,24}$/.test(a.skin) ? a.skin : 'kit',
      color: HEX.test(a.color) ? a.color : '#6b5a4c', state: STATES.has(a.state) ? a.state : 'idle', activity: str(a.activity, 60),
      station: STATIONS.has(a.station) ? a.station : 'lounge', active: !!a.active, paused: !!a.paused, task: str(a.task, 80),
    })),
    tasks: (Array.isArray(o.tasks) ? o.tasks : []).slice(0, 40).map((t) => ({ id: str(t.id, 12), title: str(t.title, 80), status: str(t.status, 10), assignee: str(t.assignee, 24) })),
  };
}

// --- this office's activity summary, read from our own Foreman ------------------------------
let office = null, officeJson = '';
function summaryClient() {
  const st = { agents: new Map(), tasks: new Map(), decisions: new Map(), repos: new Map(), goal: null, foreman: null };
  const ws = new WebSocket(`ws://127.0.0.1:${FOREMAN_PORT}`);
  ws.on('open', () => ws.send(JSON.stringify({ v: 1, type: 'hello', modVersion: 'studio-lan', protocol: 1, client: 'studio-lan' })));
  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    switch (m.type) {
      case 'snapshot':
        st.foreman = m.foreman; st.goal = m.goal ?? null;
        st.agents = new Map(m.agents.map((a) => [a.id, a])); st.tasks = new Map(m.tasks.map((t) => [t.id, t]));
        st.decisions = new Map(m.decisions.map((d) => [d.id, d])); st.repos = new Map(m.repos.map((r) => [r.id, r]));
        break;
      case 'agent.upsert': st.agents.set(m.agent.id, m.agent); break;
      case 'task.upsert': st.tasks.set(m.task.id, m.task); break;
      case 'decision.upsert': st.decisions.set(m.decision.id, m.decision); break;
      case 'repo.upsert': st.repos.set(m.repo.id, m.repo); break;
      case 'goal.upsert': if (!st.goal || st.goal.id === m.goal.id || m.goal.createdAt >= st.goal.createdAt) st.goal = m.goal; break;
      case 'foreman.status': st.foreman = m.status; break;
      default: return;
    }
    if (st.foreman?.userName && self.name === os.userInfo().username && !self.look) self.name = st.foreman.userName;
    scheduleOffice(st);
  });
  ws.on('close', () => setTimeout(summaryClient, 3000));
  ws.on('error', () => {});
}
let officeTimer = null;
function scheduleOffice(st) {
  if (officeTimer) return;
  officeTimer = setTimeout(() => {
    officeTimer = null;
    const live = [...st.tasks.values()].filter((t) => t.status !== 'cancelled');
    const goalTasks = st.goal ? live.filter((t) => !t.goalId || t.goalId === st.goal.id) : live;
    const tasks = goalTasks.length ? goalTasks : live.filter((t) => t.status !== 'done');
    const repo = st.goal?.repoId ? st.repos.get(st.goal.repoId) : [...st.repos.values()].pop();
    office = cleanOffice({
      backend: st.foreman?.backend,
      repo: repo?.name,
      goal: st.goal ? { text: st.goal.text, progress: st.goal.progress, status: st.goal.status } : null,
      open: [...st.decisions.values()].filter((d) => d.status === 'open').length,
      agents: [...st.agents.values()].map((a) => ({ ...a, task: a.taskId ? st.tasks.get(a.taskId)?.title : '' })),
      tasks,
    });
    const j = JSON.stringify(office);
    if (j === officeJson) return;
    officeJson = j;
    toPeers({ t: 'office', office });
    toApps({ type: 'self.office', office });
  }, 800);
}

// --- peers -------------------------------------------------------------------------------------
const peers = new Map();        // id -> { id, name, look, office, pos, ws, addr }
const dialing = new Set();      // host:port being connected to
const seen = new Map();         // id -> { addr, port, name, first }
function sendTo(ws, m) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); }
function toPeers(m) { for (const p of peers.values()) sendTo(p.ws, m); }
function proof() { return self.code ? crypto.createHash('sha256').update('agentcraft-team:' + self.code).digest('hex').slice(0, 32) : ''; }
function hello() { return { t: 'hello', app: 'agentcraft-peer', v: 1, id: self.id, name: self.name, proof: proof() }; }
function peerView(p) { return { id: p.id, name: p.name, look: p.look, office: p.office, pos: p.pos, addr: p.addr }; }

function attachPeer(ws, addr, outbound) {
  let peer = null;
  let budget = 60;                                     // messages per second a peer may send
  const refill = setInterval(() => { budget = 60; }, 1000);
  const timer = setTimeout(() => ws.close(), 8000);
  if (outbound) ws.on('open', () => sendTo(ws, hello()));
  ws.on('message', (data) => {
    if (--budget < 0) return;
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    if (!peer) {
      if (m.t === 'denied') { log(`peer ${addr} refused us: ${str(m.why, 60)}`); ws.close(); return; }
      if (m.t !== 'hello' || m.app !== 'agentcraft-peer' || typeof m.id !== 'string' || !/^[a-f0-9]{16}$/.test(m.id) || m.id === self.id) { ws.close(); return; }
      if (str(m.proof, 64) !== proof()) { sendTo(ws, { t: 'denied', why: 'different team code' }); ws.close(); return; }
      const old = peers.get(m.id);
      if (old && old.ws.readyState === WebSocket.OPEN) { ws.close(); return; }   // already connected the other way
      clearTimeout(timer);
      if (!outbound) sendTo(ws, hello());
      peer = { id: m.id, name: str(m.name, 24) || 'Someone', look: null, office: null, pos: null, ws, addr };
      peers.set(peer.id, peer);
      log(`peer joined: ${peer.name} (${addr})`);
      sendTo(ws, { t: 'presence', name: self.name, look: self.look });
      if (office) sendTo(ws, { t: 'office', office });
      if (self.pos) sendTo(ws, { t: 'pos', ...self.pos });
      toApps({ type: 'peer.join', peer: peerView(peer) });
      return;
    }
    switch (m.t) {
      case 'presence': peer.name = str(m.name, 24) || peer.name; peer.look = cleanLook(m.look); toApps({ type: 'peer.presence', id: peer.id, name: peer.name, look: peer.look }); break;
      case 'office': peer.office = cleanOffice(m.office); toApps({ type: 'peer.office', id: peer.id, office: peer.office }); break;
      case 'pos': peer.pos = cleanPos(m); toApps({ type: 'peer.pos', id: peer.id, pos: peer.pos }); break;
      case 'chat': { const text = str(m.text, 300).trim(); if (text) toApps({ type: 'peer.chat', id: peer.id, name: peer.name, text, ts: Date.now() }); break; }
      case 'bye': ws.close(); break;
    }
  });
  ws.on('close', () => {
    clearTimeout(timer); clearInterval(refill);
    if (peer && peers.get(peer.id) === peer) { peers.delete(peer.id); log(`peer left: ${peer.name}`); toApps({ type: 'peer.gone', id: peer.id }); }
  });
  ws.on('error', () => {});
}

function dial(host, port) {
  const key = `${host}:${port}`;
  if (dialing.has(key)) return;
  dialing.add(key);
  const h = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const ws = new WebSocket(`ws://${h}:${port}/peer`, { handshakeTimeout: 5000, maxPayload: 256 * 1024 });
  attachPeer(ws, host, true);
  ws.on('close', () => dialing.delete(key));
  ws.on('error', () => dialing.delete(key));
}
const connectedTo = (id) => peers.has(id);

// inbound peer connections (the only port reachable from the LAN)
if (!NO_LAN) {
  const peerHttp = http.createServer((req, res) => res.writeHead(404).end());
  const peerWss = new WebSocketServer({ server: peerHttp, path: '/peer', maxPayload: 256 * 1024 });
  peerWss.on('connection', (ws, req) => attachPeer(ws, (req.socket.remoteAddress ?? '?').replace(/^::ffff:/, ''), false));
  peerHttp.on('error', (e) => log(`LAN port ${PEER_PORT} unavailable (${e.code}); others cannot connect to us, we still connect to them`));
  peerHttp.listen(PEER_PORT, '0.0.0.0', () => log(`LAN: peers on tcp ${PEER_PORT}, discovery on udp ${DISCO_PORT}`));

  // discovery: announce every 3 s on every IPv4 broadcast address
  const disco = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  disco.on('error', (e) => log(`LAN discovery off (${e.code})`));
  disco.on('message', (buf, rinfo) => {
    let m; try { m = JSON.parse(buf.toString()); } catch { return; }
    if (m.app !== 'agentcraft' || typeof m.id !== 'string' || !/^[a-f0-9]{16}$/.test(m.id) || m.id === self.id) return;
    const port = Math.round(num(m.port, 1, 65535));
    if (!seen.has(m.id)) seen.set(m.id, { first: Date.now() });
    Object.assign(seen.get(m.id), { addr: rinfo.address, port, name: str(m.name, 24), at: Date.now() });
    if (connectedTo(m.id)) return;
    // the lower id dials; the other side waits a little, then dials too (in case it cannot be reached)
    if (self.id < m.id || Date.now() - seen.get(m.id).first > 8000) dial(rinfo.address, port);
  });
  disco.bind(DISCO_PORT, () => { try { disco.setBroadcast(true); } catch { /* ignore */ } });
  const announce = () => {
    const b = Buffer.from(JSON.stringify({ app: 'agentcraft', v: 1, id: self.id, name: self.name, port: PEER_PORT }));
    for (const a of broadcastAddrs()) disco.send(b, DISCO_PORT, a, () => {});
  };
  setInterval(announce, 3000);
  setTimeout(announce, 500);
  // coworkers added by name or address
  setInterval(() => {
    for (const h of self.hosts) {
      const [host, port] = splitHost(h);
      const known = [...peers.values()].some((p) => p.addr === host);
      if (!known) dial(host, port);
    }
  }, 10000);
  setTimeout(() => { for (const h of self.hosts) dial(...splitHost(h)); }, 1500);
}
function broadcastAddrs() {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const ip = i.address.split('.').map(Number), mask = i.netmask.split('.').map(Number);
      out.add(ip.map((b, k) => (b | (~mask[k] & 255))).join('.'));
    }
  }
  return [...out];
}
function myAddrs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}
function splitHost(h) {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(h.trim());
  return m ? [m[1], Number(m[2] ?? PEER_PORT)] : [h, PEER_PORT];
}

// --- the studio window(s) on this machine ----------------------------------------------------
const apps = new Set();
function toApps(m) { const s = JSON.stringify(m); for (const a of apps) if (a.readyState === WebSocket.OPEN) a.send(s); }
function selfView() {
  return { type: 'self', id: self.id, name: self.name, addrs: myAddrs(), host: os.hostname(), port: PEER_PORT, code: self.code, hosts: self.hosts, lan: !NO_LAN, discovered: seen.size };
}
function worldApp(ws) {
  apps.add(ws);
  sendTo(ws, selfView());
  if (office) sendTo(ws, { type: 'self.office', office });
  for (const p of peers.values()) sendTo(ws, { type: 'peer.join', peer: peerView(p) });
  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    switch (m.type) {
      case 'me':
        self.look = cleanLook(m.look);
        self.name = str(m.name, 24) || self.name;
        toPeers({ t: 'presence', name: self.name, look: self.look });
        break;
      case 'pos': self.pos = cleanPos(m); if (self.pos) toPeers({ t: 'pos', ...self.pos }); break;
      case 'chat': {
        const text = str(m.text, 300).trim();
        if (!text) break;
        toPeers({ t: 'chat', text });
        break;
      }
      case 'peer.add': {
        const h = str(m.host, 120).trim();
        if (!h || !/^[\w.\-:[\]]+$/.test(h)) { sendTo(ws, { type: 'notice', text: 'That is not a PC name or address.' }); break; }
        if (!self.hosts.includes(h)) { self.hosts.push(h); savePeerCfg(); }
        dial(...splitHost(h));
        sendTo(ws, selfView());
        break;
      }
      case 'peer.forget': self.hosts = self.hosts.filter((h) => h !== m.host); savePeerCfg(); sendTo(ws, selfView()); break;
      case 'code':
        self.code = str(m.code, 64);
        savePeerCfg();
        for (const p of peers.values()) { sendTo(p.ws, { t: 'bye' }); p.ws.close(); }   // reconnect under the new code
        toApps(selfView());
        break;
      case 'self': sendTo(ws, selfView()); break;
    }
  });
  ws.on('close', () => { apps.delete(ws); if (!apps.size) { self.pos = null; toPeers({ t: 'pos', anchor: '', dx: 0, dz: 0, rot: 0, moving: false }); } });
  ws.on('error', () => {});
}
summaryClient();

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { log(`port ${PORT} is in use (another studio server?)`); process.exit(2); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ pid: process.pid, port: PORT, token: TOKEN, foreman: FOREMAN_PORT }));
  log(`http://127.0.0.1:${PORT}  ->  Foreman ws://127.0.0.1:${FOREMAN_PORT}`);
});
const cleanup = () => {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    if (s.pid === process.pid) fs.unlinkSync(STATE);
  } catch { /* already gone */ }
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
