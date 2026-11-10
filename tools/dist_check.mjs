#!/usr/bin/env node
// tools/dist_check.mjs — the shipped single-file build must be the SAME game as the dev build.
// Plays the same deterministic bot run from the dev server (ES modules) and from dist/index.html over
// file://, and compares simulation state and draw cost at several moments. Catches bundler bugs that
// leave the bundle running but wrong (for example an export that silently became undefined).
//
//   node tools/build.mjs && node tools/dist_check.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harness = path.join(ROOT, 'tools', 'harness.mjs'), script = path.join(ROOT, 'tools', 'scripts', 'state_dump.mjs');
const q = '?manual=1&bot=1&seed=3';
function run(args) {
  const r = spawnSync(process.execPath, [harness, ...args, '--script', script, '--timeout', '120000'], { encoding: 'utf8' });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('STATE '));
  if (!line) { console.error((r.stdout || '') + (r.stderr || '')); throw new Error('no state from ' + args.join(' ')); }
  return { state: JSON.parse(line.slice(6)), errors: /PAGE ERRORS/.test(r.stdout || '') ? r.stdout : '' };
}
const dev = run(['--page', '/index.html' + q]);
const dist = run(['--url', 'file://' + path.join(ROOT, 'dist', 'index.html') + q]);
let bad = 0;
for (let i = 0; i < dev.state.length; i++) {
  const a = dev.state[i], b = dist.state[i];
  for (const k in a) {
    const same = k === 'quads' ? Math.abs(a[k] - b[k]) <= Math.max(40, a[k] * 0.02) : a[k] === b[k];
    if (!same) { bad++; console.log(`MISMATCH at t=${a.t}s  ${k}: dev ${a[k]}  dist ${b[k]}`); }
  }
  if (!a.finite || !b.finite) { bad++; console.log(`NON-FINITE state at t=${a.t}s`, JSON.stringify(a.finite ? b : a)); }
}
if (dev.errors || dist.errors) { bad++; console.log(dev.errors || dist.errors); }
console.log(bad ? `DIST CHECK FAIL (${bad} problems)` : `DIST CHECK PASS: dist/index.html over file:// matches the dev build at ${dev.state.map((s) => s.t + 's').join(', ')} (score ${dist.state[dist.state.length - 1].score}, lead ${dist.state[dist.state.length - 1].lead} m)`);
process.exit(bad ? 1 : 0);
