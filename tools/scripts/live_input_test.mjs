// End-to-end test of the REAL-TIME path (audio clock, real key events, input timestamping):
//   node tools/harness.mjs --page "/index.html?vol=0&seed=3" --script tools/scripts/live_input_test.mjs --timeout 60000
// Starts a run with a real click, then plays the opening by sending keys at song times read from the page.
export default async function (h) {
  await h.waitFor('window.__stage && window.__stage.mode === "title"', 15000);
  const click = async (x, y) => {
    await h.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await h.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  await click(640, 360);
  await h.waitFor('window.__stage.mode === "run"', 5000);
  const B = 60 / 128;
  // [song time, action]: breach the first wall, the drop shutter, hold right through the corkscrew, breach its wall
  const script = [
    [12 * B - 0.03, 'tap', 'Space'], [20 * B - 0.03, 'tap', 'Space'],
    [21.15 * B, 'down', 'ArrowRight'], [31.85 * B, 'up', 'ArrowRight'], [32 * B - 0.03, 'tap', 'Space'],
  ];
  let i = 0, t = 0, polls = 0;
  const t0 = Date.now();
  while (i < script.length && Date.now() - t0 < 40000) {
    t = await h.eval('window.__stage.sim.t'); polls++;
    while (i < script.length && t >= script[i][0]) {
      const [, kind, key] = script[i++];
      if (kind === 'tap') { await h.key(key, 'keyDown'); await h.key(key, 'keyUp'); } else await h.key(key, kind === 'down' ? 'keyDown' : 'keyUp');
    }
  }
  await h.sleep(600);
  const r = await h.eval('(() => { const g = window.__stage, s = g.sim; return { mode: g.mode, t: +s.t.toFixed(2), beat: +s.beat.toFixed(2), gear: s.gear, lead: Math.round(s.lead), lane: s.lane, stats: s.stats, audioClock: !!(g.frame && g.frame.time), paused: g.frame.paused }; })()');
  console.log(JSON.stringify(r));
  console.log(`polls ${polls} (${(polls / ((Date.now() - t0) / 1000)).toFixed(0)}/s)`);
  const ok = r.stats.walls >= 3 && r.stats.crashes === 0 && r.mode === 'run';
  console.log(ok ? 'LIVE INPUT TEST PASS' : 'LIVE INPUT TEST FAIL');
  if (!ok) throw new Error('live input test failed');
}
