// Which patterns hurt imperfect players most? Plays bots of several skills and counts crashes per pattern
// instance seen.   node tools/scripts/crash_stats.mjs [seeds=40] [seconds=240]
import { createSim } from '../../src/game/sim.js';
import { createBot } from '../../src/game/bot.js';
const seeds = +(process.argv[2] || 40), seconds = +(process.argv[3] || 240), DT = 1 / 120;
for (const skill of [0.7, 0.85, 0.93]) {
  const crashes = {}, seen = {}, causes = {};
  let total = 0;
  for (let s = 1; s <= seeds; s++) {
    const sim = createSim({ seed: s, startBeat: 18, prompts: false });
    const bot = createBot(sim, { skill, seed: s * 13 + 1 });
    const ev = []; let counted = 0;
    for (let i = 0; i < seconds / DT && sim.alive; i++) {
      bot.update(DT); sim.step(DT);
      const inst = sim.level.instances;
      // count pattern instances as they come up
      while (counted < inst.length && inst[counted].beat <= sim.beat) { const n = inst[counted++].name; seen[n] = (seen[n] || 0) + 1; }
      if (sim.events.length) { sim.drain(ev); for (const e of ev) if (e.type === 'crash') { total++; crashes[e.pattern] = (crashes[e.pattern] || 0) + 1; causes[e.pattern + '/' + e.cause] = (causes[e.pattern + '/' + e.cause] || 0) + 1; } ev.length = 0; }
    }
  }
  const rows = Object.keys(seen).map((n) => [n, seen[n], crashes[n] || 0, (crashes[n] || 0) / seen[n]]).sort((a, b) => b[3] - a[3]);
  console.log(`\nskill ${skill}: ${total} crashes. crashes per pattern instance:`);
  console.log(rows.map((r) => `  ${r[0].padEnd(12)} ${r[3].toFixed(2)}  (${r[2]}/${r[1]})`).join('\n'));
}
