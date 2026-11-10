// Real-time edge cases of the conductor: retry straight from the death, held keys across a restart,
// two keys holding one direction, a pause/unpause/pause race, and an audio clock that stops and comes back.
//   node tools/harness.mjs --page "/index.html?vol=0&seed=3" --script tools/scripts/live_edge_test.mjs --timeout 180000
export default async function (h) {
  const G = (expr) => h.eval('(() => { const g = window.__stage, s = g.sim; return ' + expr + '; })()');
  const out = {};
  let failed = 0;
  const ok = (cond, name, detail) => { if (!cond) failed++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); };

  await h.waitFor('window.__stage && window.__stage.mode === "title"', 15000);
  await h.sleep(300);
  // the first key press must not block the page building audio (it is built while the title is up)
  const t0 = await h.eval('performance.now()');
  await h.tap('Space');
  await h.waitFor('window.__stage.mode === "run"', 5000);
  await h.waitFor('window.__stage.sim.t > 0.05', 5000);
  out.firstStepMs = Math.round((await h.eval('performance.now()')) - t0);
  ok(out.firstStepMs < 600, 'first key press: the run is moving quickly', out.firstStepMs + ' ms incl. the 120 ms count-in and polling');

  // ---- two keys on one direction: letting one go keeps the roll going
  await h.waitFor('window.__stage.sim.t > 2.6', 10000);
  await h.key('a', 'keyDown'); await h.sleep(40); await h.key('ArrowLeft', 'keyDown'); await h.sleep(120);
  await h.key('a', 'keyUp'); await h.sleep(60);
  const r0 = await G('s.stats.rolls'); await h.sleep(500); const r1 = await G('s.stats.rolls');
  await h.key('ArrowLeft', 'keyUp'); await h.sleep(120);
  const r2 = await G('s.stats.rolls'); await h.sleep(400); const r3 = await G('s.stats.rolls');
  ok(r1 - r0 >= 3 && r3 === r2, 'A + Left held, A released: still rolling; Left released: stops', { whileOneHeld: r1 - r0, afterBoth: r3 - r2 });

  // ---- pause, unpause, pause again inside 15 ms: the song must end up stopped, and no fast-forward later
  await h.key('p', 'keyDown'); await h.key('p', 'keyUp'); await h.sleep(300);
  await h.key('p', 'keyDown'); await h.key('p', 'keyUp');
  await h.key('p', 'keyDown'); await h.key('p', 'keyUp');
  await h.sleep(700);
  const pz = await G('({ paused: g.frame.paused, ctx: g.audio.ctx.state, t: s.t })');
  await h.sleep(1200);
  const pz2 = await G('({ t: s.t, ctxT: g.audio.ctx.currentTime })');
  ok(pz.paused && pz.ctx === 'suspended' && Math.abs(pz2.t - pz.t) < 0.02, 'pause / resume / pause race: paused with the audio clock stopped', pz);
  await h.tap('p'); await h.sleep(250);
  const a0 = await G('s.t'); await h.sleep(1000); const a1 = await G('s.t');
  ok(a1 - a0 > 0.8 && a1 - a0 < 1.25, 'after unpausing the world runs at normal speed', +(a1 - a0).toFixed(3));

  // ---- the audio clock stops for 2.5 s outside the game's own pause and comes back: the song is re-locked
  await h.eval('window.__stage.audio.ctx.suspend()');
  await h.sleep(2500);
  const lost = await G('({ t: s.t, mode: g.mode })');
  await h.eval('window.__stage.audio.ctx.resume()');
  await h.sleep(1500);
  const back = await G('({ simT: s.t, heard: g.audio.ctx.currentTime - g.audioT0 + g.songT0, ctx: g.audio.ctx.state })');
  out.relock = +(back.simT - back.heard).toFixed(3);
  ok(Math.abs(out.relock) < 0.12 && back.ctx === 'running', 'audio stopped 2.5 s and came back: game and song within 120 ms again', out.relock);
  ok(lost.t > a1 + 1.5, 'while the audio was gone the run carried on (after a 0.6 s wait)', +(lost.t - a1).toFixed(2));

  // ---- die (do nothing), then: a key 0.2 s after death is ignored, a key 0.9 s after death restarts
  await h.waitFor('window.__stage.mode === "dead"', 80000);
  await h.sleep(180);
  await h.tap('Space', 30);
  await h.sleep(60);
  const early = await G('g.mode');
  await h.sleep(640);
  await h.key('ArrowRight', 'keyDown');     // restart WITH a direction, and keep holding it
  await h.sleep(250);
  const late = await G('({ mode: g.mode, startBeat: s.startBeat })');
  ok(early === 'dead' && late.mode === 'run' && late.startBeat === 18, 'key 0.2 s after death ignored; key ~0.9 s after death starts the quick launch', { early, late });
  await h.sleep(900);
  const held = await G('({ rolls: s.stats.rolls, lane: s.lane })');
  await h.key('ArrowRight', 'keyUp');
  ok(held.rolls >= 3, 'the direction key that restarted the run is held in the new run', held);
  // ---- the drop on this retry: shutter breaks on the beat, once
  await h.waitFor('window.__stage.sim.beat > 21', 8000);
  const st = await G('({ gear: s.gear, crashes: s.stats.crashes, lead: Math.round(s.lead), novaOn: s.novaOn })');
  ok(st.novaOn && st.gear >= 2, 'retry reached the drop', st);

  console.log(JSON.stringify(out));
  if (h.errors.length) { failed++; console.log('PAGE ERRORS', JSON.stringify(h.errors.slice(0, 5))); }
  console.log(failed ? 'LIVE EDGE TEST FAIL' : 'LIVE EDGE TEST PASS');
  if (failed) throw new Error('live edge test failed');
}
