// the play layer in open ground: build with the mouse, break, fight, drink, die. Needs stack #1 running (see HANDOFF.md).
export default async function ({ page, sleep, token, SP }) {
  const t1 = token(`${process.env.USERPROFILE}/.agentcraft/studio.json`);
  const p = await page('game', `http://127.0.0.1:7880/?t=${t1}#walk=-25,-12`);
  await sleep(7000);
  const st = async (tag) => p.log(tag + ' ' + JSON.stringify(await p.ev(`WRGame.state()`)));
  await p.ev(`WRGame.time(0.2); WRGame.peace(true)`); await sleep(400);
  await p.ev(`WRGame.select(1)`);
  await p.mouse(640, 360, 'right'); await sleep(400); await st('right-click 1');
  await p.mouse(640, 340, 'right'); await sleep(400); await st('right-click 2');
  await p.mouse(560, 380, 'right'); await sleep(400); await st('right-click 3');
  await p.mouse(640, 345, 'none'); await sleep(300);
  await p.shot('60-mouse-built.png');
  await p.ev(`WRGame.select(8)`);
  for (let i = 0; i < 2; i++) { await p.mouse(560, 375, 'left'); await sleep(450); }
  await st('left-click x2 (planks break)');
  // open-field fight
  await p.ev(`WRGame.peace(false); WRGame.select(0); WRGame.spawn('glitch', 0, -2.2)`);
  for (let i = 0; i < 8; i++) { await p.key('f'); await sleep(330); if (i === 1) await p.shot('61-fight.png'); }
  await st('glitch fight');
  await p.ev(`WRGame.spawn('leak', 2.2, 0.5)`);
  for (let i = 0; i < 12; i++) { await p.key('f'); await sleep(330); }
  await st('leak fight');
  // mouse attack on a bug
  await p.ev(`WRGame.peace(true); WRGame.peace(false); WRGame.hurt(7)`);
  await st('hurt'); 
  await p.ev(`WRGame.select(4)`); await p.mouse(640, 345, 'right'); await sleep(300); await st('drank coffee');
  await p.ev(`WRGame.hurt(40)`); await sleep(600); await st('died');
  await p.shot('62-respawn.png');
}
