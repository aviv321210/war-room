// Fake studios for load tests: N bots connect to a session host like real studio servers would, sit in shared
// offices, walk around, show a demo team at their desks and (with --arena) field a squad when a match starts.
// Usage: node bots.mjs [--n 48] [--host 127.0.0.1:7891] [--offices 19] [--agents 4] [--arena 1] [--seconds 600]
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL(process.env.FOREMAN_DIR ? `file:///${process.env.FOREMAN_DIR.replace(/\\/g, '/')}/package.json` : '../../../agentcraft/foreman/package.json', import.meta.url));
const { WebSocket } = require('ws');
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((s) => s.trim().split(/\s+/)));
const N = Number(args.n ?? 48), HOST = args.host ?? '127.0.0.1:7891', OFFICES = Number(args.offices ?? 19), AGENTS = Number(args.agents ?? 4);
const ARENA = args.arena === '1', SECONDS = Number(args.seconds ?? 600), PROTO = 3;
const NAMES = ['Noa', 'Omer', 'Tal', 'Yael', 'Ido', 'Maya', 'Gil', 'Shir', 'Roni', 'Lior', 'Adi', 'Eran', 'Dana', 'Nir', 'Hila', 'Amit', 'Tom', 'Ziv', 'Bar', 'Gal'];
const SKINS = ['kit', 'juniper', 'marlow', 'rowan', 'tove', 'wren'];
const TEAMS = ['Payments', 'Search', 'Platform', 'Mobile', 'Data', 'Infra', 'Billing', 'Growth', 'Security', 'Design', 'Support', 'Research', 'Ops', 'Core', 'Labs', 'Edge', 'Cloud', 'Tools', 'Web', 'QA'];
const hex = (n) => '#' + crypto.randomBytes(3).toString('hex');
const born0 = Date.now() - 100000;
let up = 0, got = 0, sent = 0;
function bot(k) {
  const o = k % OFFICES;
  const me = {
    id: crypto.createHash('sha256').update('bot' + k).digest('hex').slice(0, 16), name: `${NAMES[k % NAMES.length]}${k >= NAMES.length ? Math.floor(k / NAMES.length) + 1 : ''}`,
    of: { id: `botoff${String(o).padStart(2, '0')}`, name: TEAMS[o % TEAMS.length], born: born0 + o, slot: o + 1, ok: true },
    x: 6 + (k * 7) % 20, z: 23 + (k % 3), rot: 0, tx: 16, tz: 24, units: [], match: null, on: ARENA,
  };
  const ws = new WebSocket(`ws://${HOST}/peer`, { handshakeTimeout: 5000, maxPayload: 1024 * 1024 });
  const send = (m) => { if (ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(m)); sent++; } };
  const g = (kk, d, to) => (to ? send({ t: 'to', ids: to, m: { t: 'g', k: kk, d } }) : send({ t: 'g', k: kk, d }));
  const agents = Array.from({ length: AGENTS }, (_, i) => ({ id: `a${k}_${i}`, name: `${NAMES[(k + i * 3) % NAMES.length]}-bot`, role: i ? 'worker' : 'lead', skin: SKINS[(k + i) % SKINS.length], color: hex(), state: 'editing', activity: 'editing src/app.ts', station: 'desk', active: true, paused: false, task: 'Demo task' }));
  let joined = false, timers = [];
  ws.on('open', () => send({ t: 'hello', app: 'warroom-peer', v: PROTO, id: me.id, name: me.name, proof: '', host: false }));
  ws.on('message', (data) => {
    got++;
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    if (!joined) {
      if (m.t !== 'hello') { console.log(`bot ${k}: refused`, JSON.stringify(m).slice(0, 120)); return; }
      joined = true; up++;
      send({ t: 'presence', name: me.name, look: { name: me.name, skin: ['#f6d7bd', '#e0ac7e', '#c68a5e', '#9a6440'][k % 4], hair: '#3b2a1f', style: ['short', 'long', 'cap'][k % 3], shirt: hex(), pants: '#3a3f4a' } });
      send({ t: 'office', office: { backend: 'sim', repo: 'demo', goal: { text: 'Ship the demo', progress: 0.4, status: 'active' }, open: 0, agents, tasks: [{ id: 'T1', title: 'Demo task', status: 'doing', assignee: agents[0]?.name ?? '' }] } });
      const state = () => { g('of', me.of); g('st', { jail: [0, 0, 0], car: { anchor: me.of.id, dx: [27, 30.7, 19.2][k % 3], dz: 22.2, rot: 1.57 }, posts: k % 9 ? [] : [{ id: 'p' + k, text: `Hello from ${me.name}`, ts: Date.now() - k * 1000 }] }); };
      state();
      timers.push(setInterval(state, 5000));
      timers.push(setInterval(() => {                 // walk between random spots in front of the office
        const dx = me.tx - me.x, dz = me.tz - me.z, d = Math.hypot(dx, dz);
        if (d < 0.3) { me.tx = 2 + Math.random() * 28; me.tz = 21.5 + Math.random() * 6; }
        else { me.x += dx / d * 0.42; me.z += dz / d * 0.42; me.rot = Math.atan2(dx, dz); }
        send({ t: 'pos', anchor: me.of.id, dx: +me.x.toFixed(2), dz: +me.z.toFixed(2), rot: +me.rot.toFixed(2), moving: d >= 0.3, car: false });
      }, 100));
      if (ARENA) timers.push(setInterval(() => {      // arena: joined; a squad that wanders once a match starts
        for (const u of me.units) { u.x += (Math.random() - 0.5) * 0.5; u.z += (Math.random() - 0.5) * 0.3; }
        g('ar.st', { on: true, matchId: me.match ?? '', active: me.units.length, live: !!me.match, units: me.units.map((u) => ({ id: u.id, n: u.name, s: u.skin, t: 'free', h: 12, a: me.of.id, x: +u.x.toFixed(2), z: +u.z.toFixed(2), r: 0, m: 1, f: 0, j: null })) });
      }, 230));
      return;
    }
    const handle = (from, x) => {
      if (x?.t !== 'g' || !ARENA) return;
      if (x.k === 'ar.start' && Array.isArray(x.d?.teams)) {
        const team = x.d.teams.find((t) => t[0] === me.of.id);
        const i = team ? team[1].indexOf(me.id) : -1;
        if (i < 0) return;
        const m = team[1].length, total = x.d.total ?? 6, count = Math.floor(total / m) + (i < total % m ? 1 : 0);
        me.match = x.d.id;
        me.units = Array.from({ length: count }, (_, j) => ({ id: `${me.id.slice(0, 8)}${j}`, name: `${me.name.slice(0, 4)}${j}`, skin: SKINS[(k + j) % SKINS.length], x: 8 + ((i * 3 + j) * 2.2) % 18, z: 24.9 }));
      }
      if (x.k === 'ar.over' || x.k === 'ar.end') { me.match = null; me.units = []; }
    };
    if (m.t === 'rb' && Array.isArray(m.a)) for (const e of m.a) handle(e[0], e[1]); else handle('host', m);
  });
  ws.on('close', () => { if (joined) up--; for (const t of timers) clearInterval(t); setTimeout(() => bot(k), 3000); });
  ws.on('error', () => {});
}
for (let k = 0; k < N; k++) setTimeout(() => bot(k), k * 60);
setInterval(() => { console.log(`${up}/${N} bots connected, ${sent} sent, ${got} frames received`); sent = 0; got = 0; }, 5000);
setTimeout(() => process.exit(0), SECONDS * 1000);
