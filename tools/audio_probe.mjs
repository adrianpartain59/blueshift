#!/usr/bin/env node
// tools/audio_probe.mjs — "ears" for people and agents who cannot listen: renders the real music/sfx
// modules offline in headless Chrome, prints loudness / clipping / spectral-balance numbers, and
// writes a WAV plus a spectrogram PNG you can look at.
//
//   node tools/audio_probe.mjs music --seconds 32 --timeline 0:0.2,8:0.5,16:0.8,24:1 [--section run]
//   node tools/audio_probe.mjs sfx [--names jump,land,dash]
//   node tools/audio_probe.mjs mix --seconds 16 --intensity 1 --names jump,dash,hit
//   -> out/audio/<mode>[-tag].wav, .png (spectrogram), .json (report). Add --tag NAME to keep several.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const mode = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'music';
const opt = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1]; i++; }
const params = new URLSearchParams({ mode });
for (const k of ['seconds', 'timeline', 'intensity', 'names', 'section']) if (opt[k] !== undefined) params.set(k, opt[k]);
const tag = opt.tag ? `${mode}-${opt.tag}` : mode;
const outDir = path.join(ROOT, 'out', 'audio');
fs.mkdirSync(outDir, { recursive: true });

const script = path.join(outDir, `.probe-${process.pid}.mjs`);
fs.writeFileSync(script, `
import fs from 'node:fs';
export default async function (h) {
  await h.waitFor('window.__done', 120000);
  const report = await h.eval('window.__report');
  fs.writeFileSync(${JSON.stringify(path.join(outDir, tag + '.json'))}, JSON.stringify(report, null, 1));
  if (!report.error) fs.writeFileSync(${JSON.stringify(path.join(outDir, tag + '.wav'))}, Buffer.from(await h.eval('window.__wav'), 'base64'));
  console.log(JSON.stringify(report, null, 1));
}`);
const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'harness.mjs'), '--page', `/dev/audio_probe.html?${params}`, '--script', script, '--timeout', '120000'], { stdio: 'inherit' });
fs.rmSync(script, { force: true });
const wav = path.join(outDir, tag + '.wav');
if (fs.existsSync(wav) && fs.statSync(wav).mtimeMs > Date.now() - 120000) {
  const png = path.join(outDir, tag + '.png');
  const ff = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', wav, '-lavfi', 'showspectrumpic=s=1400x520:legend=1:scale=log:fscale=log:color=intensity', png]);
  if (ff.status === 0) console.log(`spectrogram: ${path.relative(ROOT, png)}   wav: ${path.relative(ROOT, wav)}`);
}
process.exit(r.status || 0);
