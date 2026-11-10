// live bot run: allocation sampling by source file over N seconds + retained heap growth
export default async function (h) {
  const secs = +(h.opt.seconds || 60);
  await h.waitFor('window.__stage && window.__stage.mode === "title"', 15000);
  await h.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
  await h.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
  await h.waitFor('window.__stage.mode === "run" && window.__stage.sim.t > 12', 30000);
  await h.cdp.send('HeapProfiler.enable');
  await h.cdp.send('HeapProfiler.collectGarbage');
  const u0 = (await h.cdp.send('Runtime.getHeapUsage')).usedSize;
  await h.eval('(() => { window.__fc = 0; (function f() { window.__fc++; requestAnimationFrame(f); })(); })()');
  await h.cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const t0 = Date.now(); const samples = [];
  while (Date.now() - t0 < secs * 1000) { await h.sleep(5000); samples.push(Math.round((await h.cdp.send('Runtime.getHeapUsage')).usedSize / 1024)); }
  const prof = (await h.cdp.send('HeapProfiler.stopSampling')).profile;
  const frames = await h.eval('window.__fc');
  const byFile = {}, byFn = {};
  (function walk(n) {
    if (n.selfSize) {
      const f = (n.callFrame.url || '(native)').replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '');
      byFile[f] = (byFile[f] || 0) + n.selfSize;
      const k = f + ' :: ' + (n.callFrame.functionName || '(anon)') + ':' + (n.callFrame.lineNumber + 1);
      byFn[k] = (byFn[k] || 0) + n.selfSize;
    }
    for (const c of n.children || []) walk(c);
  })(prof.head);
  await h.cdp.send('HeapProfiler.collectGarbage');
  const u1 = (await h.cdp.send('Runtime.getHeapUsage')).usedSize;
  const st = await h.eval('(() => { const s = window.__stage.sim; return { t: +s.t.toFixed(1), gear: s.gear, sector: s.sector, alive: s.alive, mode: window.__stage.mode }; })()');
  const total = Object.values(byFile).reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({ secs, frames, fps: +(frames / secs).toFixed(1), heapKB_every5s: samples, retainedGrowthKB: Math.round((u1 - u0) / 1024), allocatedKB: Math.round(total / 1024), bytesPerFrame: Math.round(total / frames), state: st }));
  console.log('BY FILE (bytes/frame)');
  for (const [k, v] of Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log('  ' + String(Math.round(v / frames)).padStart(7) + '  ' + k);
  console.log('BY FUNCTION (bytes/frame)');
  for (const [k, v] of Object.entries(byFn).sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log('  ' + String(Math.round(v / frames)).padStart(7) + '  ' + k);
}
