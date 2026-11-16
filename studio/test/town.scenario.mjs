// Two players: offices across the road, the announcement board, /say range, a cell locked from outside, the cart.
// Needs both stacks running (see HANDOFF.md, "Two stacks on one PC"); SHOTS_DIR must hold s2/studio.json of stack #2.
export default async function ({ page, sleep, token, SP }) {
  const t1 = token(`${process.env.USERPROFILE}/.agentcraft/studio.json`), t2 = token(`${SP}/s2/studio.json`);
  const p1 = await page('aviv', `http://127.0.0.1:7880/?t=${t1}#walk=16,23`);
  const p2 = await page('dana', `http://127.0.0.1:7881/?t=${t2}`);
  await sleep(3000);
  await p2.ev(`localStorage.setItem('ac-avatar', JSON.stringify({name:'Dana',skin:'#c68a5e',hair:'#a8463a',style:'long',shirt:'#7a4f8a',pants:'#2a3350'}))`);
  await p2.nav(`http://127.0.0.1:7881/?t=${t2}&r=1#walk=16,23`);
  await sleep(7000);
  const cmd = (pg, text) => pg.ev(`(()=>{const c=document.getElementById('cmd'); c.value=${JSON.stringify(text)}; c.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return true})()`);
  const view = `(()=>{const v=WRView; return {me:[+v.me.x.toFixed(1),+v.me.z.toFixed(1)], peers:[...v.peersV.values()].map(p=>({name:p.name, lot:p.lot?.key, at:p.avatar?.shown?[+p.avatar.x.toFixed(1),+p.avatar.z.toFixed(1)]:null, car:!!p.pos?.car, say:p.chat?.text}))}})()`;
  const go = (pg, x, z, yaw = 0) => pg.ev(`(()=>{const v=WRView; if (WRTown.car.driving) WRTown.getOut(); document.activeElement?.blur(); v.me.x=${x}; v.me.z=${z}; v.cam.yaw=${yaw}; return true})()`);
  const hint = (pg) => pg.ev(`document.querySelector('.hint')?.hidden ? '' : document.querySelector('.hint')?.textContent`);
  const feed = (pg) => pg.ev(`[...document.querySelectorAll('#feed > *')].slice(-3).map(e=>e.textContent.slice(0,90))`);

  // connect
  await p1.ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Coworkers')).click()`); await sleep(500);
  await p1.ev(`document.getElementById('pp-host').value='127.0.0.1:7893'; document.getElementById('pp-add').click()`);
  await sleep(5000);
  await p1.ev(`document.querySelector('[data-close]')?.click()`);
  p1.log('view ' + JSON.stringify(await p1.ev(view)));
  p2.log('view ' + JSON.stringify(await p2.ev(view)));

  // 1. the same campus in both windows: the distance between the two players must agree
  await go(p1, 10, 24.5); await go(p2, 20, 25.5); await sleep(1500);
  const a = await p1.ev(view), b = await p2.ev(view);
  const d = (v) => Math.hypot(v.me[0] - v.peers[0].at[0], v.me[1] - v.peers[0].at[1]).toFixed(1);
  p1.log(`distance seen by aviv ${d(a)}, by dana ${d(b)}; lots: aviv sees dana on ${a.peers[0].lot}, dana sees aviv on ${b.peers[0].lot}`);
  await p1.ev(`WRGame.time(0.2); WRGame.peace(true)`); await p2.ev(`WRGame.time(0.2); WRGame.peace(true)`);
  await go(p1, 16, 26, Math.PI); await sleep(1200); await p1.shot('70-across-the-road.png');     // looking south at the office across the road
  await p1.ev(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Overview').click()`); await sleep(600);
  await p1.ev(`(()=>{const o=WRView.orbit; o.target.set(18,0,26); o.radius=58; o.polar=0.55; o.az=0.5; WRView.placeCamera(); return true})()`); await sleep(1200);
  await p1.shot('71-overview-both-sides.png');
  await p1.ev(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Walk').click()`); await sleep(500);

  // 2. announcement board
  await cmd(p1, '/announce Stand-up at 10 in my office. Bring your failing tests.'); await sleep(1500);
  p2.log('board at dana: ' + JSON.stringify((await p2.ev(`WRTown.state()`)).posts) + ' feed ' + JSON.stringify(await feed(p2)));
  await go(p2, 5, 25.2); await sleep(900); p2.log('hint: ' + await hint(p2)); await p2.shot('72-board.png');
  await p2.key('e'); await sleep(600); await p2.shot('73-board-dialog.png');
  await p2.ev(`document.getElementById('bd-text').value='Cart race at noon'; document.getElementById('bd-post').click()`); await sleep(1200);
  await p2.ev(`document.querySelector('[data-close]')?.click()`);
  p1.log('board at aviv: ' + JSON.stringify((await p1.ev(`WRTown.state()`)).posts));

  // 3. /say: heard near, not heard far
  await go(p1, 16, 23); await go(p2, -40, 26); await sleep(1300);
  await cmd(p1, '/say can you hear me from there?'); await sleep(1200);
  p2.log('far: bubble ' + JSON.stringify((await p2.ev(view)).peers[0].say ?? null));
  await go(p2, 16, 23); await sleep(1300);            // dana's own door: across the road from aviv's
  await cmd(p1, '/say and now?'); await sleep(1200);
  p2.log('near: bubble ' + JSON.stringify((await p2.ev(view)).peers[0].say ?? null) + ' feed ' + JSON.stringify(await feed(p2)));

  // 4. holding cells: aviv walks into his own cell 1, dana locks it from the yard
  await go(p1, 35.1, 8.6); await sleep(600);
  const door = await p2.ev(`(()=>{const L=[...WRView.peersV.values()][0].lot; const [x,z]=L.w(35.1, 11.2); return [x,z,L.rot]})()`);
  await go(p2, door[0], door[1], door[2]); await sleep(1300);
  p2.log('at the door: ' + await hint(p2));
  await p2.key('e'); await sleep(1200);
  p1.log('after lock: ' + JSON.stringify(await p1.ev(`WRTown.state()`)) + ' hint: ' + await hint(p1));
  await p1.hold('s', 1500); await sleep(300);
  p1.log('tried to walk out: ' + JSON.stringify((await p1.ev(view)).me));
  await p2.shot('74-locked-in.png');
  p2.log('where aviv is, on dana\'s screen: ' + await p2.ev(`[...document.querySelectorAll('.plate.peer')].map(p=>p.textContent).join(' | ')`));
  await p2.key('e'); await sleep(1200);
  await p1.hold('s', 1500); await sleep(300);
  p1.log('after unlock: ' + JSON.stringify(await p1.ev(`WRTown.state()`)) + ' me ' + JSON.stringify((await p1.ev(view)).me));

  // 5. the cart
  await go(p1, 27, 23.8); await sleep(900);
  p1.log('by the cart: ' + await hint(p1));
  await p1.key('e'); await sleep(500);
  await p1.hold('w', 2500); await sleep(400);
  p1.log('driving: ' + JSON.stringify((await p1.ev(`WRTown.state()`)).car));
  await p1.shot('75-cart.png');
  const seen = (await p2.ev(view)).peers[0];
  p2.log('dana sees: ' + JSON.stringify(seen));
  await p2.ev(`(()=>{const v=WRView, a=[...v.peersV.values()][0].avatar; v.me.x=a.x+3; v.me.z=a.z+5; v.cam.yaw=0.5; return true})()`); await sleep(1200);
  await p2.shot('76-cart-seen-by-dana.png');
  await p1.key('e'); await sleep(900);
  p1.log('got out: ' + JSON.stringify((await p1.ev(`WRTown.state()`)).car) + ' me ' + JSON.stringify((await p1.ev(view)).me));
  await sleep(1200);
  p2.log('parked cart seen by dana: ' + JSON.stringify(await p2.ev(`(()=>{const t=[...WRView.peersV.values()][0].town; return t.cartAt && [+t.cartAt.x.toFixed(1), +t.cartAt.z.toFixed(1), t.cart.visible]})()`)));
}
