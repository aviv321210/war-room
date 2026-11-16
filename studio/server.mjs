// War Room server: serves the 2D studio app and bridges it to the Foreman.
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
import { spawn, execFile } from 'node:child_process';

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
    if (!same(t, TOKEN)) { res.writeHead(403).end('War Room: start it from the War Room shortcut.'); return; }
    res.writeHead(302, {
      'Set-Cookie': `ac_token=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`,
      Location: '/',
      'Cache-Control': 'no-store',
    }).end();
    return;
  }
  if (!same(cookieToken(req), TOKEN)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' }).end('War Room: start it from the War Room shortcut.');
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
  try { fs.writeFileSync(PEER_FILE, JSON.stringify({ id: self.id, code: self.code, hosts: self.hosts, host: peerCfg.host === true })); } catch { /* not fatal */ }
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
  return { anchor: str(p.anchor, 16), dx: num(p.dx, -200, 200), dz: num(p.dz, -200, 200), rot: num(p.rot, -20, 20), moving: !!p.moving, car: !!p.car };
}
// game traffic between windows (announcements, cars, cell locks, nearby talk, the arena): relayed as it is, small and
// rate-limited. The server gives it no meaning and it can reach nothing but the other windows, which treat it as untrusted.
function cleanGame(m) {
  if (typeof m.k !== 'string' || !/^[a-z.]{1,16}$/.test(m.k) || !m.d || typeof m.d !== 'object') return null;
  let size = 0; try { size = JSON.stringify(m.d).length; } catch { return null; }
  return size > 6000 ? null : { k: m.k, d: m.d };
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
// Two ways to be together on a LAN:
//   mesh    - every studio connects to every other studio it finds. Fine for a few people.
//   session - one studio hosts. Everybody else connects ONLY to the host, and the host passes everything on.
//             Then only the host's LAN port has to be reachable, which is what a room of 50 PCs (each with its own
//             firewall) needs. Whoever sees a host on the network joins it. The host is also the organiser of games.
const peers = new Map();        // id -> { id, name, look, office, pos, addr, send, ws (direct link) | via (reached through the host) }
const dialing = new Set();      // host:port being connected to
const seen = new Map();         // id -> { addr, port, name, first }
const session = { mode: peerCfg.host === true ? 'host' : 'mesh', host: null };   // host: the host's peer object while mode === 'member'
function sendTo(ws, m) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); }
function toPeers(m) {
  if (session.mode === 'member') { session.host.send(m); return; }      // the host passes it on to everybody
  for (const p of peers.values()) p.send(m);
}
function toSome(ids, m) {
  if (session.mode === 'member') { session.host.send({ t: 'to', ids, m }); return; }
  for (const id of ids) peers.get(id)?.send(m);
}
function proof() { return self.code ? crypto.createHash('sha256').update('warroom-team:' + self.code).digest('hex').slice(0, 32) : ''; }
const PROTO = 3;               // 3: sessions (one host passes everything on), shared offices
const APP_VERSION = '0.3.0', GET_IT = 'github.com/aviv321210/war-room/releases';       // keep in step with src/WarRoom.iss
const OTHER_VERSION = `Everybody needs the same version: the newest installer is at ${GET_IT}`;
const MAX_LINKS = 90;
function hello() { return { t: 'hello', app: 'warroom-peer', v: PROTO, id: self.id, name: self.name, proof: proof(), host: session.mode === 'host' }; }
// a team-code mismatch is retried every few seconds: tell the window once per address, until the code changes
const refusedSeen = new Set();
function codeNotice(addr, text) { if (refusedSeen.has(addr) || refusedSeen.size > 50) return; refusedSeen.add(addr); toApps({ type: 'notice', text }); }
function peerView(p) { return { id: p.id, name: p.name, look: p.look, office: p.office, pos: p.pos, addr: p.addr }; }
const ID = /^[a-f0-9]{16}$/;

// what one studio may tell the others, cleaned. Everything else is dropped.
function clean(m) {
  if (!m || typeof m !== 'object') return null;
  switch (m.t) {
    case 'presence': return { t: 'presence', name: str(m.name, 24), look: cleanLook(m.look) };
    case 'office': return { t: 'office', office: cleanOffice(m.office) };
    case 'pos': { const p = cleanPos(m); return p ? { t: 'pos', ...p } : null; }
    case 'chat': { const text = str(m.text, 300).trim(); return text ? { t: 'chat', text } : null; }
    case 'g': { const g = cleanGame(m); return g ? { t: 'g', k: g.k, d: g.d } : null; }
  }
  return null;
}
function apply(peer, c) {
  switch (c.t) {
    case 'presence': peer.name = c.name || peer.name; peer.look = c.look; toApps({ type: 'peer.presence', id: peer.id, name: peer.name, look: peer.look }); break;
    case 'office': peer.office = c.office; toApps({ type: 'peer.office', id: peer.id, office: peer.office }); break;
    case 'pos': { const { t, ...pos } = c; peer.pos = pos; toApps({ type: 'peer.pos', id: peer.id, pos }); break; }
    case 'chat': toApps({ type: 'peer.chat', id: peer.id, name: peer.name, text: c.text, ts: Date.now() }); break;
    case 'g': toApps({ type: 'peer.g', id: peer.id, k: c.k, d: c.d }); break;
  }
}

// the host passes messages on in small bundles (one frame per member every 40 ms instead of one per message)
const relayQ = [];             // [from id, json, to id | null]
function relay(from, c, to = null) { relayQ.push([from, JSON.stringify(c), to]); }
setInterval(() => {
  if (!relayQ.length) return;
  const q = relayQ.splice(0);
  if (session.mode !== 'host') return;
  for (const p of peers.values()) {
    if (!p.ws || p.ws.readyState !== WebSocket.OPEN) continue;
    if (p.ws.bufferedAmount > 8e6) { log(`${p.name} cannot keep up, reconnecting them`); p.ws.close(); continue; }
    let s = '';
    for (const [from, json, to] of q) {
      if (from === p.id || (to && to !== p.id)) continue;
      s += (s ? ',' : '') + `["${from}",${json}]`;
      if (s.length > 120000) { p.ws.send(`{"t":"rb","a":[${s}]}`); s = ''; }
    }
    if (s) p.ws.send(`{"t":"rb","a":[${s}]}`);
  }
}, 40);
const introOf = (p) => ({ id: p.id, name: p.name, look: p.look, office: p.office, pos: p.pos });

function setMode(mode, hostPeer = null) {
  session.mode = mode; session.host = hostPeer;
  toApps(selfView());
}
// we found a host: from now on we talk only to it
function becomeMember(hp) {
  setMode('member', hp);
  log(`joined the session of ${hp.name}`);
  for (const p of [...peers.values()]) if (p !== hp && p.ws) { sendTo(p.ws, { t: 'bye' }); p.ws.close(); }   // they come back through the host
}
function leaveSession(why) {
  for (const p of [...peers.values()]) if (p.via) { peers.delete(p.id); toApps({ type: 'peer.gone', id: p.id }); }
  setMode('mesh');
  if (why) toApps({ type: 'notice', text: why });
}
function addVirtual(v) {
  const id = str(v?.id, 16), hp = session.host;
  if (!hp || !ID.test(id) || id === self.id) return;
  const old = peers.get(id);
  if (old?.via) return;
  if (old) { peers.delete(id); toApps({ type: 'peer.gone', id }); try { old.ws.close(); } catch { /* closing anyway */ } }
  const p = { id, name: str(v.name, 24) || 'Someone', look: cleanLook(v.look), office: cleanOffice(v.office), pos: cleanPos(v.pos), addr: `through ${hp.name}`, via: hp,
    send: (m) => hp.send({ t: 'to', ids: [id], m }) };
  peers.set(id, p);
  toApps({ type: 'peer.join', peer: peerView(p) });
}
function startHosting() {
  if (session.mode === 'member') return `You are in the session of ${session.host.name}. Only one studio can host; ask them to stop first.`;
  if (session.mode === 'host') return '';
  peerCfg.host = true; savePeerCfg();
  setMode('host');
  log('hosting a session');
  const list = [...peers.values()].filter((p) => p.ws);
  for (const p of list) sendTo(p.ws, { t: 'role', host: true });
  for (const p of list) sendTo(p.ws, { t: 'intros', a: list.filter((o) => o !== p).map(introOf) });
  return '';
}
function stopHosting() {
  if (session.mode !== 'host') return;
  peerCfg.host = false; savePeerCfg();
  for (const p of peers.values()) if (p.ws) sendTo(p.ws, { t: 'role', host: false });
  setMode('mesh');
  log('stopped hosting');
}

function attachPeer(ws, addr, outbound, port = 0) {
  let peer = null;
  let budget = 60;                                     // messages per second a peer may send (the host's link carries everybody)
  const refill = setInterval(() => { budget = peer && peer === session.host ? 600 : 60; }, 1000);
  const timer = setTimeout(() => ws.close(), 8000);
  if (outbound) ws.on('open', () => sendTo(ws, hello()));
  ws.on('message', (data) => {
    if (--budget < 0) return;
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    if (!peer) {
      if (m.t === 'denied') {
        const why = str(m.why, 60);
        if (why === 'session') {       // they are in somebody's session: go to that host instead
          const g = m.go, h = str(g?.host, 80);
          if (session.mode === 'mesh' && /^[\w.\-:]+$/.test(h)) dial(h, Math.round(num(g.port, 1, 65535)) || PEER_PORT);
        } else {
          log(`peer ${addr} refused us: ${why}`);
          codeNotice(addr, why === 'version' ? `${addr} runs a different War Room version than yours (${APP_VERSION}). ${OTHER_VERSION}`
            : why === 'two hosts' ? `${addr} is hosting a session too. Only one studio on the network should host.`
            : why === 'full' ? `${addr} has no room for more people.`
            : `${addr} did not let you in: their team code is different from yours.`);
        }
        ws.close(); return;
      }
      if (m.t !== 'hello' || m.app !== 'warroom-peer' || typeof m.id !== 'string' || !ID.test(m.id) || m.id === self.id) { ws.close(); return; }
      if (str(m.proof, 64) !== proof()) {
        sendTo(ws, { t: 'denied', why: 'different team code' });
        codeNotice(addr, `${str(m.name, 24) || 'Someone'} (${addr}) tried to join with a different team code.`);
        ws.close(); return;
      }
      if (m.v !== PROTO) {
        sendTo(ws, { t: 'denied', why: 'version' });
        codeNotice(addr, `${str(m.name, 24) || 'Someone'} (${addr}) runs a different War Room version than yours (${APP_VERSION}). ${OTHER_VERSION}`);
        ws.close(); return;
      }
      const theyHost = m.host === true;
      if (session.mode === 'member') {                 // we talk only to our host: send them there too
        sendTo(ws, { t: 'denied', why: 'session', go: { host: session.host.addr, port: session.host.port || seen.get(session.host.id)?.port || PEER_PORT } });
        ws.close(); return;
      }
      if (session.mode === 'host' && theyHost) {
        sendTo(ws, { t: 'denied', why: 'two hosts' });
        codeNotice(addr, `${str(m.name, 24) || 'Someone'} (${addr}) is hosting a session too. Only one studio on the network should host.`);
        ws.close(); return;
      }
      if (peers.size >= MAX_LINKS) { sendTo(ws, { t: 'denied', why: 'full' }); ws.close(); return; }
      refusedSeen.delete(addr);
      const old = peers.get(m.id);
      if (old && old.ws?.readyState === WebSocket.OPEN) { ws.close(); return; }   // already connected the other way
      clearTimeout(timer);
      if (!outbound) sendTo(ws, hello());
      peer = { id: m.id, name: str(m.name, 24) || 'Someone', look: null, office: null, pos: null, ws, addr, port, host: theyHost, send: (x) => sendTo(ws, x) };
      peers.set(peer.id, peer);
      log(`peer joined: ${peer.name} (${addr})${theyHost ? ', the host' : ''}`);
      if (session.mode === 'host') {                    // tell the newcomer who is here, and everybody about the newcomer
        const others = [...peers.values()].filter((o) => o !== peer && o.ws);
        sendTo(ws, { t: 'intros', a: others.map(introOf) });
        for (const o of others) sendTo(o.ws, { t: 'intros', a: [introOf(peer)] });
      }
      sendTo(ws, { t: 'presence', name: self.name, look: self.look });
      if (office) sendTo(ws, { t: 'office', office });
      if (self.pos) sendTo(ws, { t: 'pos', ...self.pos });
      toApps({ type: 'peer.join', peer: peerView(peer) });
      if (theyHost) becomeMember(peer);
      return;
    }
    switch (m.t) {
      case 'presence': case 'office': case 'pos': case 'chat': case 'g': {
        const c = clean(m);
        if (!c) break;
        apply(peer, c);
        if (session.mode === 'host') relay(peer.id, c);
        break;
      }
      case 'to': {                                      // a member asks the host to hand a game message to some people
        if (session.mode !== 'host') break;
        const c = clean(m.m);
        if (!c || c.t !== 'g' || !Array.isArray(m.ids)) break;
        for (const id of m.ids.slice(0, 64)) { if (id === self.id) apply(peer, c); else if (peers.has(id)) relay(peer.id, c, id); }
        break;
      }
      case 'rb':                                        // the host passes on what the others said
        if (peer !== session.host || !Array.isArray(m.a)) break;
        for (const e of m.a.slice(0, 5000)) {
          const v = Array.isArray(e) ? peers.get(e[0]) : null;
          if (!v?.via) continue;
          const c = clean(e[1]);
          if (c) apply(v, c);
        }
        break;
      case 'intros':
        if (peer !== session.host || !Array.isArray(m.a)) break;
        for (const v of m.a.slice(0, MAX_LINKS)) addVirtual(v);
        break;
      case 'outro': {
        if (peer !== session.host) break;
        const v = peers.get(str(m.id, 16));
        if (v?.via) { peers.delete(v.id); toApps({ type: 'peer.gone', id: v.id }); }
        break;
      }
      case 'role':
        if (m.host === true && session.mode === 'mesh') { peer.host = true; becomeMember(peer); }
        else if (m.host === false && peer === session.host) { peer.host = false; leaveSession(`${peer.name} stopped hosting the session.`); }
        break;
      case 'bye': ws.close(); break;
    }
  });
  ws.on('close', () => {
    clearTimeout(timer); clearInterval(refill);
    if (!peer || peers.get(peer.id) !== peer) return;
    peers.delete(peer.id); log(`peer left: ${peer.name}`); toApps({ type: 'peer.gone', id: peer.id });
    if (session.mode === 'host') for (const o of peers.values()) if (o.ws) sendTo(o.ws, { t: 'outro', id: peer.id });
    if (peer === session.host) leaveSession(`The session host (${peer.name}) is gone. Looking for the session again...`);
  });
  ws.on('error', () => {});
}

function dial(host, port) {
  const key = `${host}:${port}`;
  if (dialing.has(key)) return;
  dialing.add(key);
  const h = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const ws = new WebSocket(`ws://${h}:${port}/peer`, { handshakeTimeout: 5000, maxPayload: 1024 * 1024 });
  attachPeer(ws, host, true, port);
  ws.on('close', () => dialing.delete(key));
  ws.on('error', () => dialing.delete(key));
}
const connectedTo = (id) => peers.has(id);

// inbound peer connections (the only port reachable from the LAN)
if (!NO_LAN) {
  const peerHttp = http.createServer((req, res) => res.writeHead(404).end());
  const peerWss = new WebSocketServer({ server: peerHttp, path: '/peer', maxPayload: 1024 * 1024 });
  peerWss.on('connection', (ws, req) => attachPeer(ws, (req.socket.remoteAddress ?? '?').replace(/^::ffff:/, ''), false));
  peerWss.on('error', () => {});                   // ws repeats the listen error of its http server: reported just below
  peerHttp.on('error', (e) => log(`LAN port ${PEER_PORT} unavailable (${e.code}); others cannot connect to us, we still connect to them`));
  peerHttp.listen(PEER_PORT, '0.0.0.0', () => log(`LAN: peers on tcp ${PEER_PORT}, discovery on udp ${DISCO_PORT}`));

  // discovery: announce every 3 s on every IPv4 broadcast address
  const disco = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const card = () => Buffer.from(JSON.stringify({ app: 'warroom', v: 1, id: self.id, name: self.name, port: PEER_PORT, host: session.mode === 'host' }));
  disco.on('error', (e) => log(`LAN discovery off (${e.code})`));
  disco.on('message', (buf, rinfo) => {
    let m; try { m = JSON.parse(buf.toString()); } catch { return; }
    if (m.app !== 'warroom' || typeof m.id !== 'string' || !ID.test(m.id) || m.id === self.id) return;
    const port = Math.round(num(m.port, 1, 65535));
    if (!seen.has(m.id)) { if (seen.size > 500) return; seen.set(m.id, { first: Date.now() }); }
    Object.assign(seen.get(m.id), { addr: rinfo.address, port, name: str(m.name, 24), at: Date.now() });
    if (connectedTo(m.id) || session.mode === 'member') return;
    if (m.host === true) { if (session.mode === 'mesh') dial(rinfo.address, port); return; }   // a host: go to it
    if (session.mode === 'host') {
      // answer straight to the sender: a PC whose firewall hides our broadcasts still gets the answer to its own packet
      disco.send(card(), rinfo.port, rinfo.address, () => {});
      if (Date.now() - seen.get(m.id).first > 6000) dial(rinfo.address, port);     // and try to reach it ourselves
      return;
    }
    // the lower id dials; the other side waits a little, then dials too (in case it cannot be reached)
    if (self.id < m.id || Date.now() - seen.get(m.id).first > 8000) dial(rinfo.address, port);
  });
  disco.bind(DISCO_PORT, () => { try { disco.setBroadcast(true); } catch { /* ignore */ } });
  const announce = () => { const b = card(); for (const a of broadcastAddrs()) disco.send(b, DISCO_PORT, a, () => {}); };
  setInterval(announce, 3000);
  setTimeout(announce, 500);
  // coworkers (or the host) added by name or address
  const dialSaved = () => {
    if (session.mode === 'member') return;
    for (const h of self.hosts) {
      const [host, port] = splitHost(h);
      if (![...peers.values()].some((p) => p.addr === host)) dial(host, port);
    }
  };
  setInterval(dialSaved, 10000);
  setTimeout(dialSaved, 1500);
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

// =============================================================================================
// Arena brains: the thinking of the game's operatives (see web/arena.js)
//
// An operative is a game piece, NOT one of the Foreman's coding agents. One turn is one question to Claude,
// asked through Claude Code exactly as Anthropic ships it (the binary inside the Foreman's packages, not
// modified), started with every tool switched off, no settings, no MCP servers, in an empty folder. All it can
// do is answer with ONE of the game moves below, and this server checks the answer. Nothing a window or a
// coworker sends can add a tool or reach a file, a shell or a repository.
// Who pays: this studio's own Claude sign-in (the player signs in to Claude Code themselves, in Anthropic's own
// sign-in page; this server never sees or stores that token), or this studio's own API key (memory only, never
// written to disk or to the log, never sent to a coworker). Models: Haiku and Sonnet only. The token budget of
// a match is set by this studio's own window, never by a coworker, and has a hard ceiling (--arena-max-tokens).
// =============================================================================================
const ARENA_MAX_TOKENS = Math.max(10000, Number(args['arena-max-tokens'] ?? 3000000));
const BRAIN_MODELS = { haiku: 'haiku', sonnet: 'sonnet' };      // Claude Code's own names for the current Haiku and Sonnet
const MOVES = ['go', 'guard', 'approach', 'attack', 'arrest', 'free', 'say', 'join_team', 'wait'];
// The answer of a turn is one line of JSON. (Asking Claude Code for "structured output" instead costs a second
// round trip per turn: twice the tokens and seconds for the same move.)
const MOVE_FORMAT = `Answer with ONLY one JSON object on a single line and nothing else:
{"move": "<one of: ${MOVES.join(', ')}>", "target": "<go, guard: a place. approach, attack, arrest, free: a name. join_team: the team you join for good. Otherwise empty>", "text": "<say: your words, out loud. join_team: your reason. Otherwise empty>", "note": "<one short line to yourself for your next turn>"}`;
function parseMove(s) {
  if (typeof s !== 'string') return null;
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { const o = JSON.parse(s.slice(a, b + 1)); return o && typeof o === 'object' && typeof o.move === 'string' ? o : null; } catch { return null; }
}
const CLAUDE_EXE = [
  path.join(FOREMAN_DIR, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe'),
  path.join(FOREMAN_DIR, 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, 'claude'),
].find((p) => fs.existsSync(p)) ?? '';
const BRAIN_DIR = path.join(os.tmpdir(), 'warroom-brain'), PROMPT_DIR = path.join(os.tmpdir(), 'warroom-brain-prompts');
const brain = { key: process.env.ANTHROPIC_API_KEY ?? '', useKey: false, seat: null, seatAt: 0, spent: 0, budget: Math.min(300000, ARENA_MAX_TOKENS), calls: 0, running: 0 };
// the environment of a Claude Code process: with our key, or with no key at all so that it uses the player's sign-in
function brainEnv(via, model) {
  const env = { ...process.env };
  if (model === 'haiku') env.MAX_THINKING_TOKENS = '0';        // a move a turn needs no long thinking: it is most of the wait and of the tokens
  for (const k of Object.keys(env)) if (['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'].includes(k.toUpperCase())) delete env[k];
  if (via === 'key') env.ANTHROPIC_API_KEY = brain.key;
  return env;
}
const brainVia = () => (brain.key && (brain.useKey || !brain.seat?.signedIn) ? 'key' : brain.seat?.signedIn ? 'seat' : '');
function brainStatus() {
  const via = CLAUDE_EXE ? brainVia() : '';
  return { type: 'brain.status', cli: !!CLAUDE_EXE, signedIn: !!brain.seat?.signedIn, plan: brain.seat?.plan ?? '', key: !!brain.key, via, ready: !!via, spent: brain.spent, budget: brain.budget, max: ARENA_MAX_TOKENS, calls: brain.calls };
}
// is the player signed in to Claude Code? ("claude auth status" answers in JSON and with its exit code)
function checkSeat(then) {
  if (!CLAUDE_EXE) { then?.(); return; }
  brain.seatAt = Date.now();
  execFile(CLAUDE_EXE, ['auth', 'status'], { env: brainEnv('seat'), timeout: 20000, windowsHide: true }, (err, stdout) => {
    let j = null; try { j = JSON.parse(String(stdout).slice(String(stdout).indexOf('{'))); } catch { /* not signed in, or no answer */ }
    const was = JSON.stringify(brain.seat);
    brain.seat = { signedIn: !!j?.loggedIn && j.authMethod !== 'none', plan: str(j?.subscriptionType, 20) };
    if (JSON.stringify(brain.seat) !== was) toApps(brainStatus());
    then?.();
  });
}
// open Anthropic's own sign-in (Claude Code's "auth login") in a console window of its own; it opens the browser
let signinTimer = null;
function brainSignIn(ws) {
  if (!CLAUDE_EXE) { sendTo(ws, { type: 'notice', text: 'Claude Code is not part of this install, so there is nothing to sign in to. The demo brain still works.' }); return; }
  try {
    spawn('cmd.exe', ['/c', 'start', '"War Room - sign in to Claude"', 'cmd', '/c', `""${CLAUDE_EXE}" auth login & echo. & echo You can close this window. & pause"`],
      { env: brainEnv('seat'), detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  } catch (e) { sendTo(ws, { type: 'notice', text: `Could not start the Claude sign-in: ${e.message}` }); return; }
  clearInterval(signinTimer);
  let n = 0;
  signinTimer = setInterval(() => { if (++n > 120 || brain.seat?.signedIn) clearInterval(signinTimer); else checkSeat(); }, 4000);
}
function runClaude(model, system, user, via) {
  return new Promise((resolve) => {
    fs.mkdirSync(BRAIN_DIR, { recursive: true }); fs.mkdirSync(PROMPT_DIR, { recursive: true });
    const file = path.join(PROMPT_DIR, crypto.createHash('sha256').update(system).digest('hex').slice(0, 24) + '.txt');
    if (!fs.existsSync(file)) fs.writeFileSync(file, system);
    const t0 = Date.now();
    const child = spawn(CLAUDE_EXE, ['-p', '--model', model, '--effort', 'low', '--system-prompt-file', file, '--tools', '', '--output-format', 'json',
      '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--max-turns', '1'],
    { cwd: BRAIN_DIR, env: brainEnv(via, model), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '', done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve({ ...r, ms: Date.now() - t0 }); };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish({ error: 'timeout' }); }, 70000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (s) => { if (out.length < 400000) out += s; });
    child.on('error', (e) => finish({ error: 'spawn: ' + e.message }));
    child.on('close', () => { let j = null; try { j = JSON.parse(out.slice(out.indexOf('{'))); } catch { /* no answer */ } finish(j ? { j } : { error: 'no answer' }); });
    child.stdin.on('error', () => {});
    child.stdin.end(user);
  });
}
async function brainThink(ws, m) {
  const rid = str(m.rid, 24);
  const reply = (x) => sendTo(ws, { type: 'brain.result', rid, ...x, spent: brain.spent, budget: brain.budget });
  const model = BRAIN_MODELS[m.model];
  if (!model) return reply({ ok: false, why: 'model' });
  if (!CLAUDE_EXE) return reply({ ok: false, why: 'nocli' });
  const via = brainVia();
  if (!via) return reply({ ok: false, why: 'nokey' });
  if (brain.spent >= brain.budget) return reply({ ok: false, why: 'budget' });
  if (brain.running >= 6) return reply({ ok: false, why: 'busy' });
  const system = `${str(m.game, 8000)}\n\n${str(m.rules, 6000)}\n\n${MOVE_FORMAT}`, user = str(m.user, 9000);
  brain.running++;
  let r;
  try { r = await runClaude(model, system, user, via); } finally { brain.running--; }
  const j = r.j;
  if (!j) return reply({ ok: false, why: 'error', detail: r.error });
  let tin = 0, tout = 0, cr = 0, cw = 0, name = '';
  for (const [k, u] of Object.entries(j.modelUsage ?? {})) {
    tin += num(u.inputTokens, 0, 1e9); tout += num(u.outputTokens, 0, 1e9); cr += num(u.cacheReadInputTokens, 0, 1e9); cw += num(u.cacheCreationInputTokens, 0, 1e9);
    if (!name || num(u.outputTokens, 0, 1e9) > 60) name = k;
  }
  const tokens = Math.round(tin + tout + cr + cw);
  brain.spent += tokens; brain.calls++;
  const so = j.is_error ? null : parseMove(j.result);
  const usage = { in: Math.round(tin), out: Math.round(tout), cr: Math.round(cr), cw: Math.round(cw) };
  if (!so && !j.is_error) return reply({ ok: true, tool: null, usage, tokens, model: str(name, 40), via, ms: r.ms });      // it answered, but not with a move
  if (!so) {
    const s = str(typeof j.result === 'string' ? j.result : '', 300);
    const why = /log ?in|logged|authenticat|api key|401|oauth|credential/i.test(s) ? 'auth' : /rate limit|usage limit|429|overloaded|quota/i.test(s) ? 'rate' : 'error';
    if (why === 'auth' && via === 'seat') { brain.seat = { signedIn: false, plan: '' }; toApps(brainStatus()); }
    log(`arena brain: ${why}${why === 'error' ? ' (' + (str(j.subtype, 40) || 'no move') + ')' : ''}`);
    return reply({ ok: false, why, detail: s.slice(0, 160), tokens });
  }
  const move = MOVES.includes(so.move) ? so.move : 'wait', target = str(so.target, 60), text = str(so.text, 300), note = str(so.note, 200);
  const input = move === 'go' || move === 'guard' ? { place: target } : ['approach', 'attack', 'arrest', 'free'].includes(move) ? { who: target } : move === 'say' ? { text } : move === 'join_team' ? { team: target, reason: text } : {};
  reply({ ok: true, tool: { name: move, input: { ...input, note } }, usage, tokens, cost: num(j.total_cost_usd, 0, 1000), model: str(name, 40), via, ms: r.ms });
}
checkSeat();

// --- the studio window(s) on this machine ----------------------------------------------------
const apps = new Set();
function toApps(m) { const s = JSON.stringify(m); for (const a of apps) if (a.readyState === WebSocket.OPEN) a.send(s); }
function selfView() {
  return { type: 'self', version: APP_VERSION, id: self.id, name: self.name, addrs: myAddrs(), host: os.hostname(), port: PEER_PORT, code: self.code, hosts: self.hosts, lan: !NO_LAN, discovered: seen.size,
    session: { mode: session.mode, host: session.mode === 'host' ? { id: self.id, name: self.name } : session.host ? { id: session.host.id, name: session.host.name } : null } };
}
function worldApp(ws) {
  apps.add(ws);
  sendTo(ws, selfView());
  sendTo(ws, brainStatus());
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
      case 'g': {
        const g = cleanGame(m);
        if (!g) break;
        const out = { t: 'g', k: g.k, d: g.d };
        if (Array.isArray(m.to)) toSome(m.to.filter((id) => typeof id === 'string').slice(0, 64), out); else toPeers(out);
        break;
      }
      case 'peer.add': {
        const h = str(m.host, 120).trim();
        if (!h || !/^[\w.\-:[\]]+$/.test(h)) { sendTo(ws, { type: 'notice', text: 'That is not a PC name or address.' }); break; }
        if (!self.hosts.includes(h)) { self.hosts.push(h); savePeerCfg(); }
        if (session.mode !== 'member') dial(...splitHost(h));
        sendTo(ws, selfView());
        break;
      }
      case 'peer.forget': self.hosts = self.hosts.filter((h) => h !== m.host); savePeerCfg(); sendTo(ws, selfView()); break;
      case 'code':
        self.code = str(m.code, 64);
        savePeerCfg();
        refusedSeen.clear();
        for (const p of [...peers.values()]) if (p.ws) { sendTo(p.ws, { t: 'bye' }); p.ws.close(); }   // reconnect under the new code
        toApps(selfView());
        break;
      case 'self': sendTo(ws, selfView()); break;
      case 'host.start': { const no = startHosting(); if (no) sendTo(ws, { type: 'notice', text: no }); break; }
      case 'host.stop': stopHosting(); break;
      case 'brain.think': brainThink(ws, m); break;
      case 'brain.key': {                    // typed in the window: kept in memory only
        const k = str(m.key, 300).trim();
        if (k && !/^sk-ant-[\w-]{20,280}$/.test(k)) { sendTo(ws, { type: 'notice', text: 'That does not look like an Anthropic API key (sk-ant-...).' }); break; }
        brain.key = k || (process.env.ANTHROPIC_API_KEY ?? ''); brain.useKey = !!k;
        toApps(brainStatus());
        break;
      }
      case 'brain.budget':                   // a new match: a new budget, counted from zero
        brain.budget = Math.round(Math.max(5000, Math.min(ARENA_MAX_TOKENS, num(m.tokens, 0, 1e9) || 300000)));
        brain.spent = 0; brain.calls = 0;
        toApps(brainStatus());
        break;
      case 'brain.signin': brainSignIn(ws); break;
      case 'brain.status': if (Date.now() - brain.seatAt > 20000) checkSeat(() => sendTo(ws, brainStatus())); else sendTo(ws, brainStatus()); break;
    }
  });
  ws.on('close', () => { apps.delete(ws); if (!apps.size) { self.pos = null; toPeers({ t: 'pos', anchor: '', dx: 0, dz: 0, rot: 0, moving: false }); toPeers({ t: 'g', k: 'away', d: {} }); } });
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
