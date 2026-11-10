// Real-time performance probe: lets a bot run play live (not manual) and reports frame times and quad counts.
//   node tools/harness.mjs --page "/index.html?bot=1&seed=5&mute=1&quick=1" --script tools/scripts/perf.mjs --timeout 90000
export default async function (h) {
  await h.waitFor('window.__stage && window.__stage.mode === "title"', 15000);
  await h.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
  await h.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
  await h.waitFor('window.__stage.mode === "run"', 5000);
  await h.eval(`(() => { const P = window.__perf = { dts: [], quads: [], last: 0 }; (function f(now) { if (P.last) P.dts.push(now - P.last); P.last = now; P.quads.push(window.__stage.gfx.stats.quads); if (P.dts.length < 60000) requestAnimationFrame(f); })(performance.now()); })()`);
  const secs = +(h.opt.seconds || 40);
  await h.sleep(secs * 1000);
  const r = await h.eval(`(() => { const P = window.__perf, d = P.dts.slice().sort((a, b) => a - b), q = P.quads.slice().sort((a, b) => a - b); const pc = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))]; const s = window.__stage.sim; return { frames: d.length, medianMs: +pc(d, 0.5).toFixed(2), p95Ms: +pc(d, 0.95).toFixed(2), p99Ms: +pc(d, 0.99).toFixed(2), maxMs: +d[d.length - 1].toFixed(1), over20ms: d.filter(x => x > 20).length, quadsMedian: pc(q, 0.5), quadsP99: pc(q, 0.99), quadsMax: q[q.length - 1], draws: window.__stage.gfx.stats.draws, cpuSimMs: +window.__stage.cpu.sim.toFixed(2), cpuDrawMs: +window.__stage.cpu.draw.toFixed(2), cpuWorstMs: +window.__stage.cpu.worst.toFixed(1), songT: +s.t.toFixed(1), gear: s.gear, sector: s.sector, alive: s.alive, renderScale: window.__stage.gfx.getRenderScale() }; })()`);
  console.log(JSON.stringify(r));
}
