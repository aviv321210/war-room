// One headless Edge, several pages (each with its own cookies), driven over the DevTools protocol.
// Usage: node drive.mjs <scenario.mjs>     (GPU=1 uses the real graphics card instead of software WebGL; VOICE=1 gives the
// pages a fake microphone, for voice.scenario.mjs)
// A scenario is `export default async ({ page, sleep, token, SP }) => {...}`; page(name, url) gives
// { ev(js), shot(file), key(k), hold(k, ms), mouse(x, y, 'left'|'right'), nav(url), log(text) }.
// Screenshots land in SP/shots (SP = env SHOTS_DIR or %TEMP%/warroom-test). See play.scenario.mjs.
import fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const SP = (process.env.SHOTS_DIR ?? `${process.env.TEMP}/warroom-test`).replaceAll('\\', '/');
fs.mkdirSync(`${SP}/shots`, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 500);
const dir = `${process.env.TEMP}/ac-drv-${port}`;
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', ...(process.env.VOICE ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] : []), ...(process.env.GPU ? ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--window-size=1500,900', `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
const kill = () => { try { execSync('taskkill /PID ' + edge.pid + ' /T /F', { stdio: 'ignore' }); } catch { edge.kill(); } };
process.on('exit', kill);
let ver;
for (let i = 0; i < 40 && !ver; i++) { await sleep(300); try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch {} }
const bws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => (bws.onopen = r));
let id = 0; const pending = new Map(); const sessions = new Map();
bws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) return pending.get(m.id)?.(m);
  const pg = sessions.get(m.sessionId); if (!pg) return;
  if (m.method === 'Runtime.exceptionThrown') pg.log('EXCEPTION ' + JSON.stringify(m.params.exceptionDetails).slice(0, 500));
  else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) pg.log('CONSOLE ' + m.params.type + ' ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
};
const send = (method, params = {}, sessionId) => new Promise((r) => { const k = ++id; pending.set(k, r); bws.send(JSON.stringify({ id: k, method, params, sessionId })); });

async function page(name, url) {
  const { result: { browserContextId } } = await send('Target.createBrowserContext', {});   // own cookies: both studios use "ac_token" and cookies ignore the port
  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
  const c = (method, params) => send(method, params, sessionId);
  const pg = {
    name, log: (s) => console.log(`[${name}] ${s}`),
    async ev(js) { const r = await c('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) { pg.log('JS ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return undefined; } return r.result?.result?.value; },
    async shot(file) { await c('Page.bringToFront'); await sleep(300); const s = await c('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${SP}/shots/${file}`, Buffer.from(s.result.data, 'base64')); pg.log('shot ' + file); },
    async key(key, code) { await c('Page.bringToFront'); for (const type of ['keyDown', 'keyUp']) await c('Input.dispatchKeyEvent', { type, key, code: code ?? (key.length === 1 ? 'Key' + key.toUpperCase() : key), text: type === 'keyDown' && key.length === 1 ? key : undefined, windowsVirtualKeyCode: key === 'Enter' ? 13 : key === 'Escape' ? 27 : key.toUpperCase().charCodeAt(0) }); },
    async hold(key, ms) { await c('Page.bringToFront'); const code = 'Key' + key.toUpperCase(); await c('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) }); await sleep(ms); await c('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) }); },
    async mouse(x, y, button = 'left') { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : button, buttons: type === 'mousePressed' ? (button === 'right' ? 2 : 1) : 0, clickCount: 1, pointerType: 'mouse' }); },
    async nav(u) { await c('Page.navigate', { url: u }); },
    async reload() { await c('Page.reload', {}); },
    async profile(ms = 4000, top = 16) {       // where the page spends its time: the functions with the most self time
      await c('Profiler.enable'); await c('Profiler.setSamplingInterval', { interval: 500 }); await c('Profiler.start'); await sleep(ms);
      const { result: { profile } } = await c('Profiler.stop');
      const self = new Map(), dt = profile.timeDeltas ?? [], byId = new Map(profile.nodes.map((n) => [n.id, n]));
      (profile.samples ?? []).forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0)); });
      const total = [...self.values()].reduce((a, b) => a + b, 0);
      return [...self].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => `${(v / total * 100).toFixed(1)}% ${k}`);
    },
    close: () => send('Target.closeTarget', { targetId }),
  };
  sessions.set(sessionId, pg);
  await c('Runtime.enable'); await c('Page.enable');
  await c('Emulation.setFocusEmulationEnabled', { enabled: true });
  if (url) await pg.nav(url);
  return pg;
}
const token = (f) => JSON.parse(fs.readFileSync(f, 'utf8')).token;
const scenario = await import(pathToFileURL(process.argv[2]).href);
try { await scenario.default({ page, sleep, token, SP }); } catch (e) { console.log('SCENARIO FAILED', e.stack); }
kill();
process.exit(0);
