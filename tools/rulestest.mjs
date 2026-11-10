#!/usr/bin/env node
// tools/rulestest.mjs — regression tests for the rules the review round fixed. Pure node, no browser.
//   node tools/rulestest.mjs
// Each case scripts inputs into the simulation by song time and checks the events that come out.
import { createSim } from '../src/game/sim.js';
import { createBot } from '../src/game/bot.js';
import { beatToTime, timeToBeat } from '../src/game/timeline.js';
import { KIND } from '../src/game/patterns.js';
import { LANES } from '../src/game/config.js';

const DT = 1 / 120;
let failed = 0;
const ok = (cond, name, detail) => { if (!cond) failed++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail !== undefined ? '  ' + detail : '')); };

// Run a sim until `untilBeat`. `script` is [[time, 'press'|'release', action], ...] in seconds of song time.
function run({ seed = 3, startBeat = 0, untilBeat = 40, script = [], bot = null, onStep = null }) {
  const sim = createSim({ seed, startBeat });
  const b = bot ? createBot(sim, bot) : null;
  const log = [];
  const q = script.slice().sort((x, y) => x[0] - y[0]);
  const tEnd = beatToTime(untilBeat);
  while (sim.t < tEnd) {
    while (q.length && q[0][0] <= sim.t + DT) { const s = q.shift(); sim[s[1]](s[2]); }
    if (b) b.update(DT);
    sim.step(DT);
    for (const e of sim.events) log.push({ ...e, t: sim.t, beat: sim.beat });
    sim.events.length = 0;
    if (onStep) onStep(sim);
  }
  return { sim, log };
}
const of = (log, type) => log.filter((e) => e.type === type);
const ms = (x) => Math.round(x * 1000);

console.log('auto shutters break on their beat');
{
  const tDrop = beatToTime(20);
  for (const [name, startBeat] of [['first run', 0], ['retry', 18]]) {
    const { log } = run({ startBeat, untilBeat: 22 });
    const hits = of(log, 'breachHit').filter((e) => e.kind === 'shutter' && e.beat > 19);
    const drop = of(log, 'drop')[0];
    ok(hits.length === 1 && hits[0].auto && Math.abs(hits[0].t - drop.t) < 1e-9, `${name}, no input: one auto break in the same step as the drop`, `(${ms(hits[0].t - tDrop)} ms after beat 20)`);
    ok(of(log, 'crash').length === 0 && of(log, 'whiff').length === 0, `${name}, no input: no crash, no whiff`);
  }
  for (const lateMs of [20, 60, 150]) {
    const { log, sim } = run({ startBeat: 18, untilBeat: 22, script: [[tDrop + lateMs / 1000, 'press', 'breach']] });
    const credit = of(log, 'breachCredit');
    ok(credit.length === 1 && of(log, 'whiff').length === 0 && of(log, 'breach').filter((e) => !e.auto).length === 0,
      `press ${lateMs} ms late: credited, no second ram, no whiff`, `(${credit[0] ? credit[0].grade : '-'}, flux ${sim.flux.toFixed(0)})`);
  }
  for (const earlyMs of [150, 60, 5]) {
    const { log } = run({ startBeat: 18, untilBeat: 22, script: [[tDrop - earlyMs / 1000, 'press', 'breach']] });
    const hits = of(log, 'breachHit').filter((e) => e.kind === 'shutter');
    ok(hits.length === 1 && !hits[0].auto && of(log, 'breachCredit').length === 0, `press ${earlyMs} ms early: the player's own hit`, `(${hits[0].grade})`);
  }
  const { log: late } = run({ startBeat: 18, untilBeat: 22, script: [[tDrop + 0.32, 'press', 'breach']] });
  ok(of(late, 'whiff').length === 1 && of(late, 'breachCredit').length === 0, 'press 320 ms late: an ordinary whiff');
}

console.log('a stray early BREACH never makes the wall on the beat unbreakable');
{
  // the first ICE wall of the opening is at beat 12; a wall with the normal 80 ms window is the corkscrew's at beat 32
  const tWall = beatToTime(32);
  let bad = 0; const rows = [];
  for (const early of [100, 185, 200, 234, 260, 290, 310, 350, 469]) {
    const { log } = run({ seed: 3, untilBeat: 34, bot: { skill: 1, seed: 5 }, script: [] , onStep: null });
    // (bot run above is only the control: it must break the wall)
    const control = of(log, 'breachHit').some((e) => Math.abs(e.t - tWall) < 0.02);
    // now a human-like script: hold Right through the corkscrew, press BREACH early, then exactly on the beat
    const script = [[beatToTime(21.2), 'press', 'right'], [beatToTime(31.6), 'release', 'right'], [tWall - early / 1000, 'press', 'breach'], [tWall - 0.004, 'press', 'breach']];
    const r = run({ seed: 3, untilBeat: 33.5, script });
    const hit = of(r.log, 'breachHit').some((e) => Math.abs(e.t - tWall) < 0.1);
    const crashed = of(r.log, 'crash').some((e) => e.t > tWall - 0.01 && e.cause === 'wall');
    rows.push(`${early}:${hit ? 'hit' : 'MISS'}`);
    if (!hit || crashed || !control) bad++;
  }
  ok(bad === 0, 'early press 100-469 ms before the wall, then a press on the beat: the wall breaks every time', rows.join(' '));
}

console.log('grinding ends when the fin does');
{
  let stuck = 0, n = 0;
  for (let period = 120; period <= 480; period += 20) {
    for (const down of [40, 70, 100, 130]) {
      const script = [];
      for (let t = beatToTime(21); t < beatToTime(32); t += period / 1000) { script.push([t, 'press', 'right']); script.push([t + down / 1000, 'release', 'right']); }
      const { sim } = run({ seed: 3, untilBeat: 37.5, script });
      n++; if (sim.grindDir !== 0 || sim.grind !== 0) stuck++;
    }
  }
  ok(stuck === 0, `tapping Right through the corkscrew at ${n} rhythms: grind state clears afterwards`, `(${stuck} stuck)`);
}

console.log('the tutorial thread gate opens two lanes from wherever the player ended up');
{
  const openLane = (sim) => { const g = sim.hazards.find((h) => h.kind === KIND.BLOCK && Math.abs(timeToBeat(h.t0) - 35) < 0.01); for (let l = 0; l < LANES; l++) if (!((g.mask >> l) & 1)) return l; return -1; };
  const cases = {
    'taught line (hold Right)': [[beatToTime(21.2), 'press', 'right'], [beatToTime(31.7), 'release', 'right'], [beatToTime(32) - 0.01, 'press', 'breach']],
    'released late': [[beatToTime(21.2), 'press', 'right'], [beatToTime(32.3), 'release', 'right'], [beatToTime(32) - 0.01, 'press', 'breach']],
    'never moved': [[beatToTime(32) - 0.01, 'press', 'breach']],
  };
  for (const name in cases) {
    let lane = -1, open = -1;
    run({ seed: 3, untilBeat: 34, script: cases[name], onStep: (sim) => { if (sim.beat >= 33.5 && lane < 0) { lane = sim.lane; open = openLane(sim); } } });
    const d = ((open - lane + 12) % 8) - 4;
    ok(d === 2, name, `runner lane ${lane}, opening lane ${open} (${d > 0 ? '+' : ''}${d})`);
  }
}

console.log('the drop cannot trap a roll');
{
  for (const [name, script] of [['Left tap at 9.50 s', [[9.5, 'press', 'left'], [9.55, 'release', 'left']]], ['Right twice at 9.45 s', [[9.45, 'press', 'right'], [9.5, 'release', 'right'], [9.6, 'press', 'right'], [9.65, 'release', 'right']]], ['Left tap at 10.0 s', [[10.0, 'press', 'left'], [10.05, 'release', 'left']]]]) {
    // ...and then the taught line: hold Right from just after the lead-in fins arrive
    const { log } = run({ seed: 3, untilBeat: 27, script: [[beatToTime(20) - 0.02, 'press', 'breach'], ...script, [beatToTime(21.4), 'press', 'right']] });
    ok(of(log, 'crash').length === 0, name + ', then the taught line: no crash', of(log, 'crash').map((e) => e.cause + '@' + e.t.toFixed(2)).join(' '));
  }
}

console.log('a sector gate pays a gear to whoever breaks it, and only to them');
{
  const idle = run({ seed: 3, untilBeat: 69.5 });
  ok(of(idle.log, 'sectorGate').length === 0, 'idle player: the opening gate does not break itself');
  // one press on the gate at gear 1 with no flux: gear 2
  const sim = createSim({ seed: 3, startBeat: 18 });
  let got = null, pressed = false;
  while (sim.beat < 69.5) {
    if (sim.beat > 67.2 && !pressed && sim.t >= beatToTime(68) - 0.02) { pressed = true; sim.gear = 1; sim.flux = 0; sim.ghostUntil = 0; sim.press('breach'); }
    if (sim.beat > 62 && sim.beat < 67.9) sim.ghostUntil = sim.t + 1;     // (this player sleeps through the fill)
    sim.step(DT);
    for (const e of sim.events) if (e.type === 'sectorGate') got = { gear: sim.gear, pts: e.pts };
    sim.events.length = 0;
  }
  ok(got && got.gear === 2 && got.pts > 0, 'one press on beat 68 at gear 1 with no flux: gear 2 and points', JSON.stringify(got));
}

console.log('mashing BREACH is not a way through');
{
  // perfect steering, but the bot's own breach presses are thrown away and Space is hammered blindly
  const times = { 100: [], 235: [] };
  for (const period of [100, 235]) {
    for (let seed = 1; seed <= 12; seed++) {
      const sim = createSim({ seed });
      const press0 = sim.press;
      sim.press = (a) => { if (a !== 'breach') press0(a); };
      const bot = createBot(sim, { skill: 1, seed: seed * 7 + 3, greed: 1 });
      let next = 0;
      while (sim.alive && sim.t < 320) {
        if (sim.t >= next) { press0('breach'); next = sim.t + period / 1000; }
        bot.update(DT); sim.step(DT); sim.events.length = 0;
      }
      times[period].push(sim.t);
    }
    times[period].sort((x, y) => x - y);
  }
  const med = (a) => a[a.length >> 1];
  ok(med(times[100]) < 200 && med(times[235]) < 200, 'perfect steering + blind Space every 100 ms / 235 ms dies well before a real player', `(median ${med(times[100]).toFixed(0)} s / ${med(times[235]).toFixed(0)} s; a perfect player is alive at 320 s)`);
}

console.log('a gate keeps banked flux');
{
  const sim = createSim({ seed: 3, startBeat: 18 });
  let done = false, before = 0, after = -1;
  while (sim.beat < 70 && !done) {
    if (sim.beat > 67.9 && !before) { sim.gear = 3; sim.flux = 77; before = 1; sim.press('breach'); }
    sim.step(DT);
    for (const e of sim.events) if (e.type === 'sectorGate') { after = sim.flux; done = true; }
    sim.events.length = 0;
  }
  ok(sim.gear === 4 && after >= 77, 'gear 3 with 77 flux through a gate -> gear 4, flux kept', `(gear ${sim.gear}, flux ${after})`);
}

console.log('nothing happens to a dead runner');
{
  let bad = 0, runs = 0; const seen = {};
  for (let seed = 1; seed <= 30; seed++) {
    const sim = createSim({ seed });
    const bot = createBot(sim, { skill: 0.35, seed: seed * 7 + 3, greed: 1 });
    let deadAt = -1;
    for (let i = 0; i < 120 * 400; i++) {
      // a weak bot plus stray flips and rams, so that some deaths happen mid-flip with a ram out
      if (sim.alive && i % 97 === 0) sim.press('flip');
      if (sim.alive && i % 61 === 0) sim.press('breach');
      if (sim.alive) bot.update(DT);
      sim.step(DT);
      for (const e of sim.events) { if (e.type === 'death') deadAt = sim.t; else if (deadAt >= 0 && e.type !== 'beat') { bad++; seen[e.type] = (seen[e.type] || 0) + 1; } }
      sim.events.length = 0;
      if (deadAt >= 0 && sim.t > deadAt + 32) break;
    }
    if (deadAt >= 0) runs++;
  }
  ok(bad === 0 && runs > 20, `${runs} deaths followed for 32 s: no events but beats`, JSON.stringify(seen));
}

console.log(failed ? `\n${failed} FAILED` : '\nall rules tests passed');
process.exit(failed ? 1 : 0);
