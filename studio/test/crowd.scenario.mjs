// A full room: studio 1 hosts, studio 2 and BOTS (default 48) fake studios join through it, in about 20 shared
// offices, and everybody plays one arena match. Measures what a member's and the host's window can draw and what
// the host process uses. Needs both stacks running (see HANDOFF.md); SHOTS_DIR must hold s2/studio.json.
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
export default async function ({ page, sleep, token, SP }) {
  const t1 = token(`${process.env.USERPROFILE}/.agentcraft/studio.json`), t2 = token(`${SP}/s2/studio.json`);
  const N = Number(process.env.BOTS ?? 48), OFFICES = Number(process.env.OFFICES ?? 19);
  const p1 = await page('aviv', `http://127.0.0.1:7880/?t=${t1}`);
  const p2 = await page('dana', `http://127.0.0.1:7881/?t=${t2}`);
  await sleep(3000);
  await p1.ev(`localStorage.setItem('wr-signin-asked', 'true'); localStorage.setItem('ac-avatar', JSON.stringify({name:'Aviv',skin:'#e0ac7e',hair:'#3b2a1f',style:'short',shirt:'#2f6f8f',pants:'#3a3f4a'}))`);
  await p2.ev(`localStorage.setItem('wr-signin-asked', 'true'); localStorage.setItem('ac-avatar', JSON.stringify({name:'Dana',skin:'#c68a5e',hair:'#a8463a',style:'long',shirt:'#7a4f8a',pants:'#2a3350'}))`);
  await p1.nav(`http://127.0.0.1:7880/?t=${t1}&r=1#walk=16,24`);
  await p2.nav(`http://127.0.0.1:7881/?t=${t2}&r=1#walk=18,24`);
  await sleep(7000);
  await p1.ev(`WRView.createOffice('Organisers'); View3D.host()`); await sleep(800);
  await p1.ev(`WRView.net.ws.send(JSON.stringify({ type: 'peer.add', host: '127.0.0.1:7893' }))`);
  const bots = spawn(process.execPath, [fileURLToPath(new URL('./bots.mjs', import.meta.url)), '--n', String(N), '--offices', String(OFFICES), '--arena', '1', '--seconds', '240'], { stdio: 'ignore' });
  await sleep(12000);
  await p2.ev(`AC.closeModal(); WRView.joinOffice([...WRView.offices.values()].find(g => g.name === 'Organisers').id)`);
  await sleep(2500);
  const fps = (p) => p.ev(`new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 4000 ? requestAnimationFrame(f) : r(Math.round(n / 4)); }; requestAnimationFrame(f); })`);
  const info = (p) => p.ev(`({ peers: WRView.peersV.size, placed: [...WRView.peersV.values()].filter(q => q.lot).length, offices: WRView.offices.size, lots: WRView.LOTS.length, draws: 0 })`);
  const cpu = () => { try { const pid = JSON.parse(fs.readFileSync(`${process.env.USERPROFILE}/.agentcraft/studio.json`, 'utf8')).pid; return execSync(`powershell -NoProfile -Command "$p = Get-Process -Id ${pid}; $a = $p.TotalProcessorTime.TotalMilliseconds; Start-Sleep -Seconds 4; $p.Refresh(); [math]::Round(($p.TotalProcessorTime.TotalMilliseconds - $a) / 40, 1); [math]::Round($p.WorkingSet64 / 1MB)"`).toString().trim().split(/\s+/); } catch (e) { return ['?', '?']; } };
  for (const p of [p1, p2]) await p.ev(`WRGame.time(0.2); WRGame.peace(true); WRView.cam.yaw = 1.2; WRView.cam.dist = 22; WRView.cam.pitch = 0.5`);
  await sleep(1500);
  const a0 = await info(p1), b0 = await info(p2);
  p1.log(`campus: host sees ${JSON.stringify(a0)}, member sees ${JSON.stringify(b0)}`);
  p1.log(`before the match: host ${await fps(p1)} fps, member ${await fps(p2)} fps, host process ${cpu().join(' % of one core, ')} MB`);
  await p2.shot('95-crowd-street.png');
  await p1.ev(`WRArena.join()`); await p2.ev(`WRArena.join()`); await sleep(3000);
  await p1.ev(`WRArena.host({ total: 6, minutes: 3 }); WRArena.start()`);
  await sleep(12000);
  const s1 = await p1.ev(`WRArena.state()`), s2 = await p2.ev(`WRArena.state()`);
  const units = (s) => s.others.reduce((n, o) => n + Number(o.split(':')[1]), 0) + s.mine.length;
  p1.log(`match: ${s1.match?.teams.length} teams, host counts ${units(s1)} operatives, member counts ${units(s2)}; mine ${s1.mine.length} + ${s2.mine.length} (one office of ${6})`);
  p1.log(`during the match: host ${await fps(p1)} fps, member ${await fps(p2)} fps, host process ${cpu().join(' % of one core, ')} MB`);
  await p2.shot('96-crowd-match.png');
  if (process.env.PROFILE) {
    p2.log('member profile:\n  ' + (await p2.profile()).join('\n  '));
    p2.log('drawn: ' + await p2.ev(`WRView.renderer.info.render.calls + ' calls, ' + WRView.renderer.info.render.triangles + ' triangles, ' + document.querySelectorAll('#overlay > *').length + ' labels'`));
  }
  await p1.ev(`View3D.setVisible?.(true); WRView.me.x = 16; WRView.me.z = 40; WRView.cam.yaw = 0; WRView.cam.dist = 40; WRView.cam.pitch = 0.9`); await sleep(1500);
  await p1.shot('97-crowd-above.png');
  await p1.ev(`WRArena.endNow()`); await sleep(3000);
  const e1 = await p1.ev(`WRArena.state()`), e2 = await p2.ev(`WRArena.state()`);
  const ok = { everybody: a0.peers === N + 1 && b0.peers === N + 1, offices: b0.offices === OFFICES + 1, allTeams: s1.match?.teams.length === OFFICES + 1, sameCount: units(s1) === units(s2) && units(s1) === (OFFICES + 1) * 6, shared: s1.mine.length + s2.mine.length === 6, ended: !!e1.match?.over && !!e2.match?.over && e1.match.winner === e2.match.winner };
  p1.log('RESULT ' + JSON.stringify(ok) + (Object.values(ok).every(Boolean) ? ' PASS' : ' FAIL'));
  await p1.ev(`View3D.host('stop')`);
  bots.kill();
}
