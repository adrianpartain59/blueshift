#!/usr/bin/env node
// tools/capture_audio.mjs — records what the REAL game actually outputs (music + every sound effect the
// run triggers) while the bot plays live in headless Chrome, then measures it and draws a spectrogram.
//
//   node tools/capture_audio.mjs [--seconds 40] [--seed 3] [--skill 1] [--quick 1] [--tag live]
//   -> out/audio/<tag>.webm, <tag>.wav, <tag>.png (spectrogram), and loudness numbers on stdout
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opt = { seconds: '40', seed: '3', skill: '1', tag: 'live' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1]; i++; }
const outDir = path.join(ROOT, 'out', 'audio');
fs.mkdirSync(outDir, { recursive: true });
const webm = path.join(outDir, opt.tag + '.webm'), wav = path.join(outDir, opt.tag + '.wav'), png = path.join(outDir, opt.tag + '.png');
const script = path.join(outDir, `.capture-${process.pid}.mjs`);
fs.writeFileSync(script, `
import fs from 'node:fs';
export default async function (h) {
  await h.waitFor('window.__stage && window.__stage.mode === "title"', 15000);
  await h.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
  await h.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
  await h.waitFor('window.__stage.mode === "run" && window.__stage.audio', 8000);
  await h.eval("(() => { const a = window.__stage.audio, d = a.ctx.createMediaStreamDestination(); (a.out || a.limiter).connect(d); const r = new MediaRecorder(d.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 }); window.__chunks = []; r.ondataavailable = (e) => window.__chunks.push(e.data); r.start(500); window.__rec = r; })()");
  await h.sleep(${+opt.seconds} * 1000);
  const b64 = await h.eval("new Promise((res) => { const r = window.__rec; r.onstop = async () => { const buf = new Uint8Array(await new Blob(window.__chunks).arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); res(btoa(s)); }; r.stop(); })");
  fs.writeFileSync(${JSON.stringify(webm)}, Buffer.from(b64, 'base64'));
  console.log(JSON.stringify(await h.eval("(() => { const s = window.__stage.sim; return { songT: +s.t.toFixed(1), gear: s.gear, sector: s.sector, alive: s.alive, stats: s.stats }; })()")));
}`);
const q = new URLSearchParams({ bot: '1', seed: opt.seed, skill: opt.skill });
if (opt.quick) q.set('quick', '1');
const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'harness.mjs'), '--page', '/index.html?' + q, '--script', script, '--timeout', String((+opt.seconds + 40) * 1000)], { stdio: 'inherit' });
fs.rmSync(script, { force: true });
if (fs.existsSync(webm)) {
  spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', webm, '-ar', '44100', wav]);
  const st = spawnSync('ffmpeg', ['-hide_banner', '-i', wav, '-af', 'astats=metadata=0:measure_perchannel=none:measure_overall=Peak_level+RMS_level+RMS_peak+Crest_factor+Flat_factor+Number_of_samples,volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const lines = (st.stderr || '').split('\n').filter((l) => /Peak level|RMS level|RMS peak|Crest factor|Flat factor|mean_volume|max_volume/.test(l)).map((l) => l.replace(/^\[.*?\]\s*/, ''));
  console.log(lines.join('\n'));
  spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', wav, '-lavfi', 'showspectrumpic=s=1400x520:legend=1:scale=log:fscale=log:color=intensity', png]);
  console.log(`spectrogram: ${path.relative(ROOT, png)}   wav: ${path.relative(ROOT, wav)}`);
}
process.exit(r.status || 0);
