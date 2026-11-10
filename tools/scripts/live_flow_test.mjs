// Real-time flow test: pause/resume keeps the song clock honest, death leads to results, a key restarts at the drop.
//   node tools/harness.mjs --page "/index.html?vol=0&seed=3" --script tools/scripts/live_flow_test.mjs --timeout 120000
export default async function (h) {
  const T = () => h.eval('window.__stage.sim.t');
  const mode = () => h.eval('window.__stage.mode');
  await h.waitFor('window.__stage && window.__stage.mode === "title"', 15000);
  await h.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
  await h.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
  await h.waitFor('window.__stage.mode === "run" && window.__stage.sim.t > 3', 15000);
  await h.tap('p');
  await h.sleep(150);
  const t1 = await T(); const paused = await h.eval('window.__stage.frame.paused');
  await h.sleep(1500);
  const t2 = await T();
  await h.tap('p');
  await h.sleep(1200);
  const t3 = await T();
  const out = { paused, heldWhilePaused: +(t2 - t1).toFixed(3), ranAfterResume: +(t3 - t2).toFixed(3) };
  // now do nothing until the nova wins
  await h.waitFor('window.__stage.mode === "results"', 70000);
  out.diedAtSongT = +(await h.eval('window.__stage.sim.t - window.__stage.sim.deadT')).toFixed(1);
  out.sectorAtDeath = await h.eval('window.__stage.sim.sector');
  await h.sleep(500);
  await h.tap('Space');
  await h.sleep(400);
  out.modeAfterKey = await mode();
  out.restartBeat = await h.eval('window.__stage.sim.startBeat');
  await h.sleep(1500);
  out.songAdvancing = +(await T()).toFixed(2);
  console.log(JSON.stringify(out));
  const ok = out.paused && Math.abs(out.heldWhilePaused) < 0.06 && out.ranAfterResume > 0.8 && out.ranAfterResume < 1.5 && out.modeAfterKey === 'run' && out.restartBeat === 18 && out.songAdvancing > 9;
  console.log(ok ? 'LIVE FLOW TEST PASS' : 'LIVE FLOW TEST FAIL');
  if (!ok) throw new Error('live flow test failed');
}
