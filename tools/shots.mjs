#!/usr/bin/env node
// tools/shots.mjs — storyboard a dev page (or the game) in one headless run: seeks to each time,
// saves a PNG per time and a contact sheet of all of them.
//
//   node tools/shots.mjs --page "/dev/city.html?start=18" --times 0.5,1,2,4,8 --out out/city
//   -> out/city/t000.50.png ... and out/city/sheet.png (labelled grid; open it with the Read tool)
// The page must expose window.__stage.seek(seconds) (dev/lib/stage.js and the game both do).
// Options: --cols 3  --thumb 640 (thumbnail width in the sheet)  --width 1280 --height 720 --dpr 1
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opt = { times: '1,2,4,8', out: 'out/shots', cols: '3', thumb: '640', width: '1280', height: '720', dpr: '1', page: '/index.html' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1]; i++; }
const times = opt.times.split(',').map(Number).sort((a, b) => a - b);
const outDir = path.resolve(ROOT, opt.out);
fs.mkdirSync(outDir, { recursive: true });
const name = (t) => `t${t.toFixed(2).padStart(6, '0')}.png`;
const script = path.join(outDir, `.shots-${process.pid}.mjs`);
fs.writeFileSync(script, `
export default async function (h) {
  await h.waitFor('window.__stage && window.__stage.seek', 20000);
  const times = ${JSON.stringify(times)};
  for (const t of times) {
    await h.eval('window.__stage.seek(' + t + ')');
    // stamp the time into the page itself (this ffmpeg build has no drawtext filter)
    await h.eval("(() => { let l = document.getElementById('__shotlabel'); if (!l) { l = document.createElement('div'); l.id = '__shotlabel'; l.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:99;font:600 15px Menlo,monospace;color:#fff;background:rgba(0,0,0,.72);padding:2px 7px;border-radius:3px;pointer-events:none'; document.body.appendChild(l); } l.textContent = 't=' + (" + t + ").toFixed(2) + 's'; })()");
    await h.sleep(60);
    await h.shot(${JSON.stringify(outDir)} + '/' + 't' + t.toFixed(2).padStart(6, '0') + '.png');
  }
}`);
const page = opt.page + (opt.page.includes('?') ? '&' : '?') + 'manual=1';
const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'harness.mjs'), '--page', page, '--script', script, '--width', opt.width, '--height', opt.height, '--dpr', opt.dpr, '--timeout', '60000'], { stdio: 'inherit' });
fs.rmSync(script, { force: true });
// contact sheet with time labels
const files = times.map((t) => path.join(outDir, name(t))).filter((f) => fs.existsSync(f));
if (files.length) {
  const cols = Math.min(+opt.cols, files.length), rows = Math.ceil(files.length / cols);
  const tw = +opt.thumb, th = Math.round((tw * +opt.height) / +opt.width);
  const args = ['-loglevel', 'error', '-y'];
  for (const f of files) args.push('-i', f);
  let fc = '';
  files.forEach((f, i) => { fc += `[${i}]scale=${tw}:${th}[v${i}];`; });
  const layout = files.map((f, i) => `${(i % cols) * tw}_${Math.floor(i / cols) * th}`).join('|');
  fc += files.map((f, i) => `[v${i}]`).join('') + `xstack=inputs=${files.length}:layout=${layout}:fill=black[o]`;
  const sheet = path.join(outDir, 'sheet.png');
  const ff = files.length > 1 ? spawnSync('ffmpeg', [...args, '-filter_complex', fc, '-map', '[o]', sheet]) : spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', files[0], sheet]);
  console.log(ff.status === 0 ? `sheet: ${path.relative(ROOT, sheet)} (${cols}x${rows}, times ${times.join(', ')})` : 'contact sheet failed: ' + (ff.stderr || '').toString().slice(0, 300));
}
process.exit(r.status || 0);
