// Plays a weak bot until the nova catches it, then captures the death and results screens.
//   node tools/harness.mjs --page "/index.html?manual=1&bot=1&skill=0.35&seed=4" --script tools/scripts/death_flow.mjs
export default async function (h) {
  await h.waitFor('window.__stage && window.__stage.seek', 15000);
  let t = 20;
  for (; t < 200; t += 2) { await h.eval(`window.__stage.seek(${t})`); if (!(await h.eval('window.__stage.sim.alive'))) break; }
  const info = await h.eval('(() => { const s = window.__stage.sim; return { deadAtSongT: +(s.t - s.deadT).toFixed(2), sector: s.sector, score: Math.floor(s.score), dist: Math.round(s.dist), crashes: s.stats.crashes }; })()');
  console.log('death', JSON.stringify(info), 'mode', await h.eval('window.__stage.mode'));
  await h.shot('out/death/a_dead.png');
  await h.eval('window.__stage.wait(0.5)'); await h.shot('out/death/b_dead_0.5s.png');
  await h.eval('window.__stage.wait(1.3)'); await h.shot('out/death/c_results.png');
  await h.eval('window.__stage.wait(2.0)'); await h.shot('out/death/d_results_2s.png');
  console.log('mode', await h.eval('window.__stage.mode'), 'frame.mode', await h.eval('window.__stage.frame.mode'));
}
