// Real-time test of the touch controls around a run: start on finger lift, corner pause, the comfort
// switch, MAIN MENU from the pause screen and from the results. Chrome's real autoplay policy is on.
//   node tools/harness.mjs --touch 1 --autoplay 0 --width 844 --height 390 --dpr 2 --page "/index.html?vol=0&seed=3&quick=1" --script tools/scripts/live_touch_test.mjs --timeout 240000
export default async function (h) {
  const G = () => h.eval('(() => { const g = window.__stage, s = g.sim; return { mode: g.mode, paused: g.frame.paused, attract: g.frame.attract, device: g.frame.device, comfort: g.frame.comfort, t: +s.t.toFixed(2), startBeat: s.startBeat, audio: g.audio ? g.audio.ctx.state : "none" }; })()');
  let failed = 0;
  const ok = (cond, name, detail) => { if (!cond) failed++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); };
  const isMenu = (s) => s.mode === 'title' && s.attract && !s.paused && s.startBeat === 21;

  await h.waitFor('window.__stage && window.__stage.mode === "title"', 15000);
  await h.sleep(500);
  // Positions are fractions of the picture (which is letterboxed on a tall screen), turned into client pixels.
  const at = (fx, fy) => h.eval(`(() => { const g = window.__stage.gfx, c = document.getElementById('game'), r = c.getBoundingClientRect(); const vw = g.W * g.pxScale, vh = g.H * g.pxScale, vx = (c.width - vw) / 2, vy = (c.height - vh) / 2; return [r.left + (vx + ${fx} * vw) * r.width / c.width, r.top + (vy + ${fy} * vh) * r.height / c.height]; })()`);
  // the HUD's own geometry: pause glyph at about (5 %, 8.5 %), corner buttons 176 x 38 units, 42 units in from the sides
  const vw = await h.eval('window.__stage.gfx.W');
  const centre = await at(0.5, 0.5), corner = await at(0.05, 0.085), bl = await at(130 / vw, 0.92), br = await at(1 - 130 / vw, 0.92);
  console.log('  view ' + Math.round(vw) + ' x 720 units; taps at', JSON.stringify({ centre: centre.map(Math.round), corner: corner.map(Math.round), bl: bl.map(Math.round), br: br.map(Math.round) }));
  let s = await G();
  ok(s.device === 'touch' && s.audio === 'suspended', 'touch device recognised on the menu; no audio before a gesture', s);

  await h.touch('touchStart', [{ x: centre[0], y: centre[1], id: 0 }]); await h.sleep(120);
  s = await G();
  ok(s.mode === 'title', 'finger down does not start the run yet', s.mode);
  await h.touch('touchEnd', []);
  await h.waitFor('window.__stage.mode === "run" && window.__stage.sim.t > 9.8', 15000);
  s = await G();
  ok(s.audio === 'running', 'the run started on finger lift with audio running', s);

  await h.touchTap(...corner); await h.sleep(350);
  s = await G();
  ok(s.paused && s.audio === 'suspended', 'top-left corner pauses', s);
  await h.shot('out/menu/pause_touch.png');
  const c0 = s.comfort;
  await h.touchTap(...bl); await h.sleep(250);
  s = await G();
  ok(s.paused && s.comfort === !c0, 'bottom-left on the pause screen is the comfort switch', s);
  await h.touchTap(...bl); await h.sleep(250);
  await h.touchTap(...centre); await h.sleep(400);
  s = await G();
  ok(s.mode === 'run' && !s.paused && s.comfort === c0, 'a tap anywhere else resumes', s);

  await h.touchTap(...corner); await h.sleep(350);
  await h.touchTap(...br); await h.sleep(800);
  s = await G();
  ok(isMenu(s) && s.audio === 'running', 'bottom-right on the pause screen is MAIN MENU', s);
  await h.sleep(600);
  s = await G();
  ok(isMenu(s), 'the tap that left for the menu does not start a run when it lifts', s.mode);

  await h.touchTap(...centre);
  await h.waitFor('window.__stage.mode === "run"', 5000);
  await h.waitFor('window.__stage.mode === "results"', 90000);
  await h.sleep(800);
  await h.shot('out/menu/results_touch.png');
  await h.touchTap(...br); await h.sleep(700);
  s = await G();
  ok(isMenu(s), 'bottom-right on the results is MAIN MENU', s);
  await h.touchTap(...centre);
  await h.waitFor('window.__stage.mode === "run"', 5000);
  ok(true, 'and a tap on the menu starts again');

  if (h.errors.length) { failed++; console.log('PAGE ERRORS', JSON.stringify(h.errors.slice(0, 5))); }
  console.log(failed ? 'LIVE TOUCH TEST FAIL' : 'LIVE TOUCH TEST PASS');
  if (failed) throw new Error('live touch test failed');
}
