#!/usr/bin/env node
// tools/harness.mjs — zero-dependency headless Chrome driver (static server + CDP over WebSocket).
// Gives humans and agents eyes on the game without touching the user's browser.
//
//   node tools/harness.mjs --page /dev/sandbox.html --shot out/sandbox.png
//   node tools/harness.mjs --page /index.html?manual=1 --script tools/scripts/storyboard.mjs
//
// Flags: --root DIR (default: project root)  --page PATH | --url FULL_URL  --width 1280 --height 720 --dpr 1
//        --wait-for "js expr"  --eval "js expr"  --shot file.png  --script file.mjs  --timeout 30000  --verbose
//        --touch 1        emulate a phone: touch events, coarse pointer, mobile metrics
//        --autoplay 0     keep Chrome's real autoplay policy (audio only starts from a user gesture)
// A --script module does `export default async function (h) {}` and gets:
//   h.eval(expr)            evaluate JS in the page (promises awaited, value returned by JSON)
//   h.shot(file)            PNG screenshot of the viewport
//   h.sleep(ms)  h.waitFor(expr, ms)
//   h.key(key, 'keyDown'|'keyUp')  h.tap(key, holdMs)   real key events (Space, ArrowUp, a, Enter, ...)
//   h.touch(type, points)   real touch events: type 'touchStart'|'touchMove'|'touchEnd', points [{x, y, id}]
//   h.touchTap(x, y, holdMs)  one finger down and up (needs --touch 1)
//   h.errors  h.logs        page exceptions / console output collected so far
// Exit code: 0 ok, 1 harness failure, 2 page errors (uncaught exception or console.error).
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { width: 1280, height: 720, dpr: 1, timeout: 30000, root: PROJECT_ROOT, page: '/index.html' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[k] = true;
    else { out[k] = next; i++; }
  }
  out.width = +out.width; out.height = +out.height; out.timeout = +out.timeout; out.dpr = +out.dpr;
  return out;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.txt': 'text/plain' };

export function startServer(root, port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(root, path.normalize(p));
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function launchChrome({ width, height, autoplay }) {
  return new Promise((resolve, reject) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
    const args = [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
      `--window-size=${width},${height}`, '--hide-scrollbars', '--mute-audio', '--no-first-run',
      '--no-default-browser-check', ...(String(autoplay) === '0' ? [] : ['--autoplay-policy=no-user-gesture-required']),
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--enable-gpu', '--ignore-gpu-blocklist',
      'about:blank',
    ];
    const proc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let buf = '';
    const timer = setTimeout(() => reject(new Error('chrome launch timeout: ' + buf)), 20000);
    proc.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) { clearTimeout(timer); resolve({ proc, browserWs: m[1], userDataDir }); }
    });
    proc.on('exit', (c) => { clearTimeout(timer); reject(new Error('chrome exited early ' + c + ': ' + buf)); });
  });
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id) {
        const p = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (!p) return;
        if (msg.error) p.rej(new Error(msg.error.message)); else p.res(msg.result);
      } else {
        for (const fn of this.handlers.get(msg.method) || []) fn(msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  on(method, fn) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(fn); }
  once(method) { return new Promise((res) => { const fn = (p) => { const l = this.handlers.get(method); l.splice(l.indexOf(fn), 1); res(p); }; this.on(method, fn); }); }
}

const KEYS = {
  ' ': { key: ' ', code: 'Space', vk: 32 }, Space: { key: ' ', code: 'Space', vk: 32 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 }, ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 }, ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  Enter: { key: 'Enter', code: 'Enter', vk: 13 }, Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Shift: { key: 'Shift', code: 'ShiftLeft', vk: 16 },
};
function keyDef(k) {
  if (KEYS[k]) return KEYS[k];
  const up = k.toUpperCase();
  return { key: k, code: 'Key' + up, vk: up.charCodeAt(0) };
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const root = path.resolve(opt.root);
  const { server, port } = await startServer(root);
  const { proc, browserWs, userDataDir } = await launchChrome(opt);
  const debugPort = new URL(browserWs).port;
  let exitCode = 0, pageErrors = null;
  try {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const pageT = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(pageT.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const cdp = new CDP(ws);
    const errors = []; const logs = [];
    pageErrors = errors;
    cdp.on('Runtime.exceptionThrown', (p) => errors.push('EXCEPTION: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text)));
    cdp.on('Runtime.consoleAPICalled', (p) => {
      const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (p.type === 'error') errors.push('console.error: ' + text); else logs.push(`[${p.type}] ${text}`);
    });
    cdp.on('Log.entryAdded', (p) => { if (p.entry.level === 'error') errors.push('LOG: ' + p.entry.text + ' ' + (p.entry.url || '')); });
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: opt.width, height: opt.height, deviceScaleFactor: opt.dpr, mobile: !!opt.touch });
    if (opt.touch) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const loaded = cdp.once('Page.loadEventFired');
    // --url opens any address as-is (e.g. file:///.../dist/index.html to prove the single-file build runs offline)
    await cdp.send('Page.navigate', { url: opt.url ? String(opt.url) : `http://127.0.0.1:${port}${opt.page}` });
    await loaded;

    const h = {
      errors, logs, opt, cdp, port,
      async eval(expr) {
        const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        return r.result.value;
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      async waitFor(expr, ms = opt.timeout) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { if (await h.eval(`!!(${expr})`)) return true; await h.sleep(40); }
        throw new Error('waitFor timeout: ' + expr);
      },
      async shot(file) {
        const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        return file;
      },
      async key(k, type = 'keyDown') {
        const d = keyDef(k);
        // no nativeVirtualKeyCode: on macOS a Windows VK passed as a native code is some OTHER key, and several
        // of them (every letter we tried) make headless Chrome hide the page, which silently stops rAF
        await cdp.send('Input.dispatchKeyEvent', { type: type === 'keyDown' ? 'rawKeyDown' : 'keyUp', key: d.key, code: d.code, windowsVirtualKeyCode: d.vk });
      },
      async tap(k, ms = 60) { await h.key(k, 'keyDown'); await h.sleep(ms); await h.key(k, 'keyUp'); },
      async touch(type, pts) { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id || 0, radiusX: 8, radiusY: 8, force: 1 })) }); },
      async touchTap(x, y, ms = 60) { await h.touch('touchStart', [{ x, y, id: 0 }]); await h.sleep(ms); await h.touch('touchEnd', []); },
    };

    if (opt['wait-for']) await h.waitFor(opt['wait-for']);
    if (opt.script) {
      const mod = await import(pathToFileURL(path.resolve(opt.script)).href);
      await mod.default(h);
    }
    if (opt.eval) console.log(JSON.stringify(await h.eval(opt.eval), null, 1));
    if (opt.shot) { await h.shot(opt.shot); console.log('shot: ' + opt.shot); }
    if (opt.verbose) for (const l of logs) console.log(l);
    if (errors.length) { console.log('PAGE ERRORS:\n' + errors.join('\n')); exitCode = 2; }
    ws.close();
  } catch (e) {
    console.error('HARNESS ERROR: ' + e.message); exitCode = 1;
    if (pageErrors && pageErrors.length) console.error('PAGE ERRORS:\n' + pageErrors.join('\n'));
  } finally {
    proc.removeAllListeners('exit'); proc.kill('SIGKILL'); server.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
  process.exit(exitCode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
