// Leaving a running match forfeits it, and nobody can bring a fresh squad into a match that is still being played.
// Three squads are not needed: Dana leaves in the middle, joins again and tries to start; Aviv must win the match.
// Needs both stacks running (see HANDOFF.md); SHOTS_DIR must hold s2/studio.json of stack #2.
export default async function ({ page, sleep, token, SP }) {
  const t1 = token(`${process.env.USERPROFILE}/.agentcraft/studio.json`), t2 = token(`${SP}/s2/studio.json`);
  const p1 = await page('aviv', `http://127.0.0.1:7880/?t=${t1}`);
  const p2 = await page('dana', `http://127.0.0.1:7881/?t=${t2}`);
  await sleep(3000);
  for (const p of [p1, p2]) await p.ev(`localStorage.removeItem('wr-arena')`);
  await p1.nav(`http://127.0.0.1:7880/?t=${t1}&r=1#walk=22,24`);
  await p2.nav(`http://127.0.0.1:7881/?t=${t2}&r=1#walk=22,24`);
  await sleep(7000);
  await p1.ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Coworkers')).click()`); await sleep(500);
  await p1.ev(`document.getElementById('pp-host').value='127.0.0.1:7893'; document.getElementById('pp-add').click()`);
  await sleep(5000);
  await p1.ev(`document.querySelector('[data-close]')?.click()`);
  for (const p of [p1, p2]) await p.ev(`WRGame.peace(true)`);
  const st = async (p, tag) => { const s = await p.ev(`WRArena.state()`); p.log(`${tag} mine=${JSON.stringify(s.mine)} others=${JSON.stringify(s.others)} match=${JSON.stringify(s.match)}`); return s; };
  const fieldOf = (p) => p.ev(`WRArena.field().map(f => f.team.slice(0,4) + ':' + f.name + ':' + f.st)`);
  await p1.ev(`WRArena.join()`); await p2.ev(`WRArena.join()`); await sleep(2500);
  await p1.ev(`WRArena.join()`);                                   // a second join changes nothing
  await p1.ev(`WRArena.start()`); await sleep(7000);
  await p2.ev(`WRArena.start()`);                                  // refused: a match is on
  const a0 = await st(p1, 'running'); await st(p2, 'running');
  p1.log('field ' + JSON.stringify(await fieldOf(p1)));
  await p2.ev(`WRArena.command('leave')`); await sleep(1500);
  await p2.ev(`WRArena.command('join')`); await sleep(1500);
  await p2.ev(`WRArena.command('start')`); await sleep(6000);      // must be refused: Aviv's match is still being played
  const a1 = await st(p1, 'after dana left+joined+start'), b1 = await st(p2, 'after dana left+joined+start');
  const f1 = await fieldOf(p1);
  p1.log('field ' + JSON.stringify(f1));
  await sleep(12000);
  const a2 = await st(p1, 'later'), b2 = await st(p2, 'later');
  const ok = {
    matchKept: a1.match?.id === a0.match?.id,
    danaHasNoSquad: (b1.mine?.length ?? 0) === 0 && !b1.match,
    avivSeesOnlyOwn: f1.length === 3,
    avivWins: !!a2.match?.over,
  };
  p1.log('RESULT ' + JSON.stringify(ok) + (Object.values(ok).every(Boolean) ? ' PASS' : ' FAIL'));
  await p2.ev(`WRArena.command('start')`); await sleep(6000);      // now a new match may start
  const a3 = await st(p1, 'new match'), b3 = await st(p2, 'new match');
  p1.log('NEW MATCH ' + (a3.match && b3.match && a3.match.id === b3.match.id && a3.match.id !== a0.match.id ? 'PASS' : 'FAIL'));
}
