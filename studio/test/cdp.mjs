// headless Edge driven over the DevTools protocol: node cdp.mjs <url> <out.png> [waitMs] [js to run before the shot] [keyToPress]
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const [url, out, wait = '7000', js = '', key = ''] = process.argv.slice(2);
const port = 9300 + Math.floor(Math.random() * 500);
const dir = `${process.env.TEMP}/ac-cdp-${port}`;
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1500,900', `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
for (let i = 0; i < 40 && !page; i++) { await sleep(500); try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((p) => p.type === 'page'); } catch {} }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) pending.get(m.id)?.(m); else if (m.method === 'Runtime.exceptionThrown') console.log('EXCEPTION', JSON.stringify(m.params.exceptionDetails).slice(0, 600)); else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) console.log('CONSOLE', m.params.type, m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300)); };
const cmd = (method, params = {}) => new Promise((r) => { const k = ++id; pending.set(k, r); ws.send(JSON.stringify({ id: k, method, params })); });
await cmd('Runtime.enable'); await cmd('Page.enable');
await cmd('Page.navigate', { url });
await sleep(Number(wait));
if (js) { const r = await cmd('Runtime.evaluate', { expression: js, awaitPromise: true }); if (r.result?.exceptionDetails) console.log('JS ERR', JSON.stringify(r.result.exceptionDetails).slice(0, 400)); else console.log('JS ->', JSON.stringify(r.result?.result?.value)); await sleep(1500); }
if (key) { for (const type of ['keyDown', 'keyUp']) await cmd('Input.dispatchKeyEvent', { type, key, code: 'Key' + key.toUpperCase(), text: type === 'keyDown' ? key : undefined, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) }); await sleep(1500); }
const shot = await cmd('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
ws.close();
try { (await import('node:child_process')).execSync('taskkill /PID ' + edge.pid + ' /T /F', { stdio: 'ignore' }); } catch { edge.kill(); }   // kill the whole browser tree, or headless Edge processes pile up
console.log('saved', out);
process.exit(0);
