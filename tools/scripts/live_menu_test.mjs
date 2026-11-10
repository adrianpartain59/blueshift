// Real-time test of the way back to the main menu, with real key events and a scripted gamepad.
//   node tools/harness.mjs --page "/index.html?vol=0&seed=3&quick=1" --script tools/scripts/live_menu_test.mjs --timeout 240000
// Q and Esc step back one level: in a run the first press pauses and the second leaves for the menu;
// after a run they go straight to the menu; on the menu they do nothing (and never start a run).
export default async function (h) {
  const G = () => h.eval('(() => { const g = window.__stage, s = g.sim; return { mode: g.mode, paused: g.frame.paused, attract: g.frame.attract, device: g.frame.device, t: +s.t.toFixed(2), startBeat: s.startBeat, audio: g.audio ? g.audio.ctx.state : "none" }; })()');
  let failed = 0;
  const ok = (cond, name, detail) => { if (!cond) failed++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); };
  const isMenu = (s) => s.mode === 'title' && s.attract && !s.paused && s.startBeat === 21;

  await h.waitFor('window.__stage && window.__stage.mode === "title"', 15000);
  await h.sleep(400);

  console.log('keyboard');
  await h.tap('q'); await h.sleep(250);
  await h.tap('Escape'); await h.sleep(250);
  let s = await G();
  ok(isMenu(s), 'on the menu, Q and Esc do nothing and do not start a run', s);

  await h.tap('Space');
  await h.waitFor('window.__stage.mode === "run" && window.__stage.sim.t > 9.6', 15000);
  await h.tap('q'); await h.sleep(300);
  s = await G();
  ok(s.mode === 'run' && s.paused && s.audio === 'suspended', 'in a run, Q pauses first', s);
  await h.shot('out/menu/pause_keyboard.png');
  await h.tap('Space'); await h.sleep(350);
  s = await G();
  ok(s.mode === 'run' && !s.paused, 'any other key resumes', s);

  await h.key('Escape', 'keyDown'); await h.key('Escape', 'keyUp');
  await h.key('Escape', 'keyDown'); await h.key('Escape', 'keyUp');   // a bounce: two presses a few ms apart
  await h.sleep(200);
  s = await G();
  ok(s.mode === 'run' && s.paused, 'Esc pauses, and a second Esc a few ms later is ignored (key bounce)', s);
  const tPaused = s.t;
  await h.sleep(350);
  await h.tap('Escape'); await h.sleep(700);
  s = await G();
  ok(isMenu(s) && s.audio === 'running', 'a second Esc from the pause screen goes to the main menu, with the audio clock running again', s);
  const best = await h.eval('(() => { try { return JSON.parse(localStorage.getItem("blueshift.best")); } catch (e) { return null; } })()');
  ok(best && best.score > 0 && best.dist > 0, 'the abandoned run still counts toward the best', best);
  await h.sleep(900);
  await h.shot('out/menu/back_on_title.png');

  await h.tap('Space');
  await h.waitFor('window.__stage.mode === "run"', 5000);
  s = await G();
  ok(s.mode === 'run' && !s.attract && !s.paused, 'a key on the menu starts a new run', s);
  ok(tPaused > 9.5, '(the first run was paused after the drop)', tPaused);
  // do nothing until the nova wins, then leave straight from the death
  await h.waitFor('window.__stage.mode === "dead"', 80000);
  await h.sleep(120);
  await h.tap('q'); await h.sleep(500);
  s = await G();
  ok(isMenu(s), 'Q during the death goes straight to the main menu', s);

  console.log('gamepad');
  await h.eval(`(() => { window.__pad = { index: 0, id: 'fake', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })) }; navigator.getGamepads = () => [window.__pad, null, null, null]; })()`);
  const press = async (i, ms = 90) => { await h.eval(`window.__pad.buttons[${i}].pressed = true, window.__pad.buttons[${i}].value = 1`); await h.sleep(ms); await h.eval(`window.__pad.buttons[${i}].pressed = false, window.__pad.buttons[${i}].value = 0`); await h.sleep(90); };
  await press(1); await h.sleep(250);
  s = await G();
  ok(isMenu(s) && s.device === 'gamepad', 'B on the menu does nothing', s);
  await press(0);
  await h.waitFor('window.__stage.mode === "run" && window.__stage.sim.t > 9.6', 15000);
  await press(1); await h.sleep(200);
  s = await G();
  ok(s.mode === 'run' && !s.paused, 'B in a run does nothing', s);
  await press(9); await h.sleep(300);
  s = await G();
  ok(s.mode === 'run' && s.paused, 'Start pauses', s);
  await h.shot('out/menu/pause_gamepad.png');
  await press(1); await h.sleep(700);
  s = await G();
  ok(isMenu(s), 'B on the pause screen goes to the main menu', s);
  await press(2);
  await h.waitFor('window.__stage.mode === "run"', 5000);
  await h.waitFor('window.__stage.mode === "results"', 90000);
  await h.sleep(700);
  await h.shot('out/menu/results_gamepad.png');
  await press(1); await h.sleep(500);
  s = await G();
  ok(isMenu(s), 'B on the results goes to the main menu', s);

  if (h.errors.length) { failed++; console.log('PAGE ERRORS', JSON.stringify(h.errors.slice(0, 5))); }
  console.log(failed ? 'LIVE MENU TEST FAIL' : 'LIVE MENU TEST PASS');
  if (failed) throw new Error('live menu test failed');
}
