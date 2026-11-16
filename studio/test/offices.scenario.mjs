// A session with one host: studio 1 hosts, studio 2 and a crowd of bots (bots.mjs, started by this scenario) join
// through it. Checks: everybody sees everybody through the host, people share offices, the campus is laid out the
// same for both real windows, a shared office has one set of cell doors, the host can move a person.
// Needs both stacks running (see HANDOFF.md); SHOTS_DIR must hold s2/studio.json of stack #2. BOTS=n (default 10).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export default async function ({ page, sleep, token, SP }) {
  const t1 = token(`${process.env.USERPROFILE}/.agentcraft/studio.json`), t2 = token(`${SP}/s2/studio.json`);
  const N = Number(process.env.BOTS ?? 10);
  const p1 = await page('aviv', `http://127.0.0.1:7880/?t=${t1}`);
  const p2 = await page('dana', `http://127.0.0.1:7881/?t=${t2}`);
  await sleep(3000);
  await p1.ev(`localStorage.setItem('ac-avatar', JSON.stringify({name:'Aviv',skin:'#e0ac7e',hair:'#3b2a1f',style:'short',shirt:'#2f6f8f',pants:'#3a3f4a'}))`);
  await p2.ev(`localStorage.setItem('ac-avatar', JSON.stringify({name:'Dana',skin:'#c68a5e',hair:'#a8463a',style:'long',shirt:'#7a4f8a',pants:'#2a3350'}))`);
  await p1.nav(`http://127.0.0.1:7880/?t=${t1}&r=1#walk=16,24`);
  await p2.nav(`http://127.0.0.1:7881/?t=${t2}&r=1#walk=18,24`);
  await sleep(7000);
  await p1.ev(`WRView.createOffice('Organisers'); View3D.host()`); await sleep(800);
  await p1.ev(`WRView.net.ws.send(JSON.stringify({ type: 'peer.add', host: '127.0.0.1:7893' }))`);
  const bots = spawn(process.execPath, [fileURLToPath(new URL('./bots.mjs', import.meta.url)), '--n', String(N), '--offices', String(Math.max(1, Math.ceil(N / 3))), '--seconds', '120'], { stdio: 'ignore' });
  await sleep(9000);
  const info = (p) => p.ev(`({ mode: WRView.net.self.session.mode, host: WRView.net.self.session.host?.name, peers: WRView.peersV.size, placed: [...WRView.peersV.values()].filter(q => q.lot).length, seen: [...WRView.peersV.values()].filter(q => q.avatar?.shown).length,
    offices: [...WRView.offices.values()].map(g => g.name + ':' + g.members.length + '@' + g.lot.key).sort(), mine: WRView.office.name + (WRView.office.ok ? '' : ' (not chosen)'), modal: AC.modalKind() })`);
  const a0 = await info(p1), b0 = await info(p2);
  p1.log('host   ' + JSON.stringify(a0)); p2.log('member ' + JSON.stringify(b0));
  const ok = {};
  ok.roles = a0.mode === 'host' && b0.mode === 'member';
  ok.everybody = a0.peers === N + 1 && b0.peers === N + 1;
  ok.danaIsAsked = b0.modal === 'offices' && b0.mine.includes('not chosen');
  await p2.shot('90-pick-office.png');
  // Dana joins the host's office: one building for two people
  await p2.ev(`AC.closeModal(); WRView.joinOffice([...WRView.offices.values()].find(g => g.name === 'Organisers').id)`);
  await sleep(2500);
  const a1 = await info(p1), b1 = await info(p2);
  p1.log('host   ' + JSON.stringify(a1)); p2.log('member ' + JSON.stringify(b1));
  ok.sharedOffice = a1.offices.includes('Organisers:2@0n') && b1.offices.includes('Organisers:2@0n');
  const strip = (list) => list.map((s) => s.split('@')[0]).join(',');
  ok.sameOffices = strip(a1.offices) === strip(b1.offices) && a1.offices.length === Math.max(1, Math.ceil(N / 3)) + 1;
  // both see each other in front of the same door
  const d1 = await p1.ev(`(() => { const q = [...WRView.peersV.values()].find(x => x.name === 'Dana'); return q?.avatar?.shown ? [+(q.avatar.x - WRView.me.x).toFixed(1), +(q.avatar.z - WRView.me.z).toFixed(1)] : null; })()`);
  const d2 = await p2.ev(`(() => { const q = [...WRView.peersV.values()].find(x => x.name === 'Aviv'); return q?.avatar?.shown ? [+(q.avatar.x - WRView.me.x).toFixed(1), +(q.avatar.z - WRView.me.z).toFixed(1)] : null; })()`);
  p1.log(`Dana seen from Aviv at ${JSON.stringify(d1)}, Aviv seen from Dana at ${JSON.stringify(d2)}`);
  ok.sameSpot = !!d1 && !!d2 && Math.abs(d1[0] + d2[0]) < 0.6 && Math.abs(d1[1] + d2[1]) < 0.6;
  // one set of cell doors: Dana locks cell 2, the keeper applies it, both see it
  await p2.ev(`WRTown.lockCell(1, 1)`); await sleep(1500);
  const c1 = await p1.ev(`WRTown.cells()`), c2 = await p2.ev(`WRTown.cells()`);
  p1.log(`cells: host ${JSON.stringify(c1)} member ${JSON.stringify(c2)}`);
  ok.sharedCells = c1[1] === 1 && c2[1] === 1;
  await p1.ev(`WRTown.lockCell(1, 0)`); await sleep(1200);
  ok.unlocked = (await p2.ev(`WRTown.cells()`))[1] === 0;
  await p1.ev(`WRView.cam.yaw = 0.5; WRView.cam.dist = 16; WRView.cam.pitch = 0.6`); await sleep(600);
  await p1.shot('91-shared-office.png');
  // the host moves Dana to a bot office
  const target = await p1.ev(`(() => { const g = [...WRView.offices.values()].find(x => x.name !== 'Organisers' && x.members.length > 1); const d = [...WRView.peersV.values()].find(x => x.name === 'Dana'); WRView.net.ws.send(JSON.stringify({ type: 'g', k: 'of.move', to: [d.id], d: { id: g.id, name: g.name, born: g.born, slot: g.slot } })); return g.name; })()`);
  await sleep(2500);
  const b2 = await info(p2);
  p2.log('after the move: ' + JSON.stringify(b2));
  ok.hostMoves = b2.mine === target;
  await p2.ev(`WRView.cam.yaw = 0.4; WRView.cam.dist = 20; WRView.cam.pitch = 0.7`); await sleep(1500);
  await p2.shot('92-moved.png');
  // the member's frame rate with the crowd around
  const fps = await p2.ev(`new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 3000 ? requestAnimationFrame(f) : r(Math.round(n / 3)); }; requestAnimationFrame(f); })`);
  p2.log(`frames per second with ${N} bots: ${fps}`);
  // the host goes away for the others when it stops hosting
  await p1.ev(`View3D.host('stop')`); await sleep(2500);
  const b3 = await info(p2);
  ok.backToMesh = b3.mode === 'mesh' && b3.peers <= 1;
  p1.log('RESULT ' + JSON.stringify(ok) + (Object.values(ok).every(Boolean) ? ' PASS' : ' FAIL'));
  bots.kill();
}
