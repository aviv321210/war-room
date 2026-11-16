// drives studio #2's /world socket like its window would: adds studio #1 as a coworker, walks, chats
import fs from 'node:fs';
import { createRequire } from 'node:module';
// ws comes from the upstream foreman, cloned next to this repo (../agentcraft); override with FOREMAN_DIR
const require = createRequire(new URL(process.env.FOREMAN_DIR ? `file:///${process.env.FOREMAN_DIR.replace(/\\/g, '/')}/package.json` : '../../../agentcraft/foreman/package.json', import.meta.url));
const { WebSocket } = require('ws');
const st = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ws = new WebSocket(`ws://127.0.0.1:${st.port}/world`, { headers: { Origin: `http://127.0.0.1:${st.port}`, Cookie: `ac_token=${st.token}` } });
const send = (m) => ws.send(JSON.stringify(m));
let other = null, t = 0;
ws.on('open', () => {
  send({ type: 'me', name: 'Dana', look: { name: 'Dana', skin: '#c68a5e', hair: '#a8463a', style: 'long', shirt: '#7a4f8a', pants: '#2a3350' } });
  send({ type: 'peer.add', host: '127.0.0.1:7891' });
});
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  if (m.type !== 'peer.pos') console.log(JSON.stringify(m).slice(0, 400));
  if (m.type === 'peer.join') other = m.peer.id;
});
setInterval(() => {
  if (!other) return;
  t++;
  send({ type: 'pos', anchor: other, dx: 13.2 + Math.sin(t / 10) * 0.6, dz: 22.2, rot: 0.6, moving: true });
  if (t % 30 === 5) send({ type: 'chat', text: 'Hi from next door! How is the build going?' });
}, 100);
setTimeout(() => process.exit(0), Number(process.argv[3] ?? 90) * 1000);
