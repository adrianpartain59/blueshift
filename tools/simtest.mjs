#!/usr/bin/env node
// tools/simtest.mjs — plays BLUESHIFT in node with the planner bot. Two jobs:
//   fairness:  node tools/simtest.mjs fair [seeds=60] [seconds=300]   a perfect bot must never crash
//   balance:   node tools/simtest.mjs balance [seeds=40]              how long do bots of each skill survive?
import { createSim } from '../src/game/sim.js';
import { createBot } from '../src/game/bot.js';

const mode = process.argv[2] || 'fair';
const DT = 1 / 120;

function run(seed, skill, seconds, opts = {}) {
  const sim = createSim({ seed, startBeat: opts.startBeat || 0 });
  const bot = createBot(sim, { skill, seed: seed * 7 + 3, greed: opts.greed ?? 1 });
  const ev = [];
  const crashes = [];
  const gearTime = [0, 0, 0, 0, 0, 0];
  let steps = Math.round(seconds / DT);
  for (let i = 0; i < steps && sim.alive; i++) {
    bot.update(DT);
    sim.step(DT);
    gearTime[sim.gear] += DT;
    if (sim.events.length) {
      sim.drain(ev);
      for (const e of ev) if (e.type === 'crash') crashes.push({ t: +sim.t.toFixed(2), beat: +sim.beat.toFixed(2), sector: sim.sector, cause: e.cause, pattern: e.pattern });
      ev.length = 0;
    }
  }
  return { sim, bot, crashes, gearTime };
}

if (mode === 'fair') {
  const seeds = +(process.argv[3] || 60), seconds = +(process.argv[4] || 300);
  let total = 0; const byPattern = {};
  let minSector = 99, sumScore = 0, deaths = 0;
  for (let s = 1; s <= seeds; s++) {
    const r = run(s, 1, seconds);
    total += r.crashes.length;
    for (const c of r.crashes) { const k = `${c.pattern}/${c.cause}/s${c.sector}`; byPattern[k] = (byPattern[k] || 0) + 1; if (total <= 12) console.log('  crash', s, JSON.stringify(c)); }
    if (!r.sim.alive) deaths++;
    minSector = Math.min(minSector, r.sim.sector); sumScore += r.sim.score;
  }
  console.log(`perfect bot: ${seeds} seeds x ${seconds}s -> ${total} crashes, ${deaths} deaths, min sector reached ${minSector}, mean score ${Math.round(sumScore / seeds)}`);
  if (total) console.log(byPattern);
  process.exit(total ? 1 : 0);
} else {
  const seeds = +(process.argv[3] || 40);
  for (const skill of [0, 0.5, 0.7, 0.85, 0.93, 0.97, 1]) {
    const times = [], sectors = [], scores = []; let crashes = 0, perf = 0, walls = 0; const gt = [0, 0, 0, 0, 0, 0];
    for (let s = 1; s <= seeds; s++) {
      const r = skill === 0 ? (() => { const sim = createSim({ seed: s }); let i = 0; while (sim.alive && i++ < 120 * 600) sim.step(DT); return { sim, crashes: { length: sim.stats.crashes }, gearTime: gt }; })() : run(s, skill, 600);
      times.push(r.sim.t); sectors.push(r.sim.sector); scores.push(r.sim.score); crashes += r.crashes.length; perf += r.sim.stats.perfects; walls += r.sim.stats.walls;
      if (skill) for (let g = 1; g <= 5; g++) gt[g] += r.gearTime[g];
    }
    times.sort((a, b) => a - b); scores.sort((a, b) => a - b);
    const med = (a) => a[Math.floor(a.length / 2)];
    const gsum = gt.reduce((a, b) => a + b, 0) || 1;
    console.log(`skill ${skill.toFixed(2)}: survive median ${med(times).toFixed(0)}s (min ${times[0].toFixed(0)}, max ${times[times.length - 1].toFixed(0)})  sector ~${med(sectors.sort((a, b) => a - b))}  score ${Math.round(med(scores))}  crashes/run ${(crashes / seeds).toFixed(1)}  perfect% ${walls ? Math.round((100 * perf) / walls) : 0}  gear time% ${gt.slice(1).map((v) => Math.round((100 * v) / gsum)).join('/')}`);
  }
}
