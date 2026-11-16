// Voice between two players, with the browser's fake microphone (a beep): heard near, quieter further away, not
// at all out of earshot, and with push-to-talk only while V is held. Run with VOICE=1 so that the test browser
// has a fake microphone: VOICE=1 node drive.mjs voice.scenario.mjs. Needs both stacks running (see HANDOFF.md).
export default async function ({ page, sleep, token, SP }) {
  const t1 = token(`${process.env.USERPROFILE}/.agentcraft/studio.json`), t2 = token(`${SP}/s2/studio.json`);
  const p1 = await page('aviv', `http://127.0.0.1:7880/?t=${t1}`);
  const p2 = await page('dana', `http://127.0.0.1:7881/?t=${t2}`);
  await sleep(3000);
  await p1.ev(`localStorage.setItem('wr-signin-asked', 'true'); localStorage.setItem('ac-avatar', JSON.stringify({name:'Aviv',skin:'#e0ac7e',hair:'#3b2a1f',style:'short',shirt:'#2f6f8f',pants:'#3a3f4a'}))`);
  await p2.ev(`localStorage.setItem('wr-signin-asked', 'true'); localStorage.setItem('ac-avatar', JSON.stringify({name:'Dana',skin:'#c68a5e',hair:'#a8463a',style:'long',shirt:'#7a4f8a',pants:'#2a3350'}))`);
  await p1.nav(`http://127.0.0.1:7880/?t=${t1}&r=1#walk=16,24`);
  await p2.nav(`http://127.0.0.1:7881/?t=${t2}&r=1#walk=16,24`);
  await sleep(7000);
  await p1.ev(`WRView.createOffice('Payments')`);
  await p1.ev(`WRView.net.ws.send(JSON.stringify({ type: 'peer.add', host: '127.0.0.1:7893' }))`);
  await sleep(6000);
  await p2.ev(`AC.closeModal(); WRView.joinOffice([...WRView.offices.values()].find(g => g.name === 'Payments').id)`);
  await sleep(2000);
  for (const p of [p1, p2]) await p.ev(`AC.closeModal(); WRGame.peace(true)`);
  const go = (p, x, z) => p.ev(`document.activeElement?.blur(); WRView.me.x = ${x}; WRView.me.z = ${z}; true`);
  // listen for a second and a half: the fake microphone beeps, it is not a steady tone
  const heard = () => p2.ev(`(async () => { let max = 0, l = null; for (let i = 0; i < 36; i++) { l = WRVoice.state().links[0]; if (!l) break; max = Math.max(max, l.level); await new Promise(r => setTimeout(r, 40)); } return l ? { state: l.state, vol: l.vol, level: +max.toFixed(3), plate: !!document.querySelector('.plate.peer.talking') } : null; })()`);
  const ok = {};
  await go(p1, 14, 24); await go(p2, 16, 24);                       // 2 m apart
  p1.log('before anybody talks: ' + JSON.stringify(await heard()));
  await p1.ev(`WRVoice.setMode('open')`);                           // microphone on, all the time
  await sleep(7000);
  const near = await heard();
  p1.log('2 m apart, open microphone: ' + JSON.stringify(near) + ' talker: ' + JSON.stringify(await p1.ev(`WRVoice.state()`)));
  ok.heardNear = near?.state === 'connected' && near.vol > 0.9 && near.level > 0.02;
  await p2.shot('98-voice.png');
  await go(p2, 24, 24); await sleep(2500);                          // 10 m apart
  const mid = await heard();
  p1.log('10 m apart: ' + JSON.stringify(mid));
  ok.quieterFurther = mid?.state === 'connected' && mid.vol > 0.2 && mid.vol < 0.75;
  await go(p2, 33, 24); await sleep(2500);                          // 19 m: out of earshot, still connected
  const edge = await heard();
  p1.log('19 m apart: ' + JSON.stringify(edge));
  ok.silentOutOfEarshot = !!edge && edge.vol < 0.05;
  await go(p2, 70, 24); await sleep(2500);                          // 56 m: the connection is dropped
  const far = await heard();
  p1.log('56 m apart: ' + JSON.stringify(far));
  ok.droppedFar = far === null;
  await go(p2, 16, 24); await p1.ev(`WRVoice.setMode('ptt')`); await sleep(7000);
  const quiet = await heard();
  p1.log('near again, push to talk, not pressed: ' + JSON.stringify(quiet));
  ok.silentUntilPressed = quiet?.state === 'connected' && quiet.level < 0.01;
  await p1.ev(`document.activeElement?.blur(); true`);
  const pressed = (async () => { await sleep(800); p1.log('talker while pressed: ' + JSON.stringify(await p1.ev(`({ v: WRVoice.state().talking, focus: document.activeElement?.tagName, modal: AC.modalKind() })`))); return heard(); })();
  await p1.hold('v', 3000);
  const talk = await pressed;
  p1.log('while V is held: ' + JSON.stringify(talk));
  ok.heardWhilePressed = talk?.level > 0.02;
  await sleep(1500);
  ok.silentAfterRelease = (await heard())?.level < 0.01;
  p1.log('RESULT ' + JSON.stringify(ok) + (Object.values(ok).every(Boolean) ? ' PASS' : ' FAIL'));
}
