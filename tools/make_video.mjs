#!/usr/bin/env node
// tools/make_video.mjs — renders a gameplay video of a bot run, with the game's real audio.
// Picture: deterministic frames from the manual-stepping game (exact song times, no dropped frames).
// Sound: the same run (same seed, same bot) played live in headless Chrome and recorded off the
// master bus by an AudioWorklet that stamps every block with its context time. The simulation is
// deterministic, so the two runs are the same run, and ffmpeg places the audio on the song timeline.
//
//   node tools/make_video.mjs [--seconds 34] [--seed 3] [--skill 1] [--fps 30] [--quick 1] [--crf 23] [--out out/video/blueshift.mp4]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opt = { seconds: '34', seed: '3', skill: '1', fps: '30', crf: '23', out: 'out/video/blueshift.mp4', width: '1280', height: '720' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1]; i++; }
const seconds = +opt.seconds, fps = +opt.fps;
const out = path.resolve(ROOT, opt.out), dir = path.dirname(out), frames = path.join(dir, 'frames');
const wav = path.join(dir, 'audio.wav'), offFile = path.join(dir, 'audio_offset.txt');
fs.rmSync(frames, { recursive: true, force: true });
fs.mkdirSync(frames, { recursive: true });
const q = new URLSearchParams({ bot: '1', seed: opt.seed, skill: opt.skill });
if (opt.quick) q.set('quick', '1');
const harness = path.join(ROOT, 'tools', 'harness.mjs'), scripts = path.join(ROOT, 'tools', 'scripts');

console.log('rendering frames...');
let r = spawnSync(process.execPath, [harness, '--page', '/index.html?manual=1&' + q, '--script', path.join(scripts, 'render_frames.mjs'),
  '--frames', String(Math.round(seconds * fps)), '--fps', String(fps), '--dir', frames, '--width', opt.width, '--height', opt.height, '--timeout', '900000'], { stdio: 'inherit' });
if (r.status !== 0 && r.status !== 2) process.exit(r.status || 1);

console.log('recording audio (real time)...');
fs.rmSync(wav, { force: true });
r = spawnSync(process.execPath, [harness, '--page', '/index.html?' + q, '--script', path.join(scripts, 'record_audio.mjs'),
  '--seconds', String(seconds + 1.5), '--wav', wav, '--offset-file', offFile, '--timeout', String((seconds + 40) * 1000)], { stdio: 'inherit' });

// The video's first frame is the run's first moment: song time 0, or beat 18 for a quick run.
const videoT0 = opt.quick ? (18 * 60) / 128 : 0;
const offset = fs.existsSync(offFile) ? +fs.readFileSync(offFile, 'utf8') - videoT0 : 0;
const args = ['-loglevel', 'error', '-y', '-framerate', String(fps), '-i', path.join(frames, 'f%05d.jpg')];
if (fs.existsSync(wav)) {
  // offset > 0: the recording starts after the video does (delay it); offset < 0: it starts earlier (trim its head)
  if (offset >= 0) args.push('-itsoffset', offset.toFixed(4), '-i', wav); else args.push('-ss', (-offset).toFixed(4), '-i', wav);
  args.push('-c:a', 'aac', '-b:a', '224k');
}
args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', String(opt.crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', String(seconds), out);
const ff = spawnSync('ffmpeg', args, { stdio: 'inherit' });
if (ff.status === 0) {
  fs.rmSync(frames, { recursive: true, force: true });
  console.log(`video: ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${seconds}s @ ${fps} fps; audio's first sample at song time ${(offset + videoT0).toFixed(4)} s)`);
}
process.exit(ff.status || 0);
