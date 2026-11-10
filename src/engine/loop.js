// engine/loop.js — fixed-timestep game loop with render interpolation, time scaling (slow motion),
// hitstop (freeze frames) and a manual stepping mode for deterministic capture and tests.

export function createLoop({ update, render, hz = 120, maxFrame = 0.1 }) {
  const step = 1 / hz;
  let acc = 0, last = 0, raf = 0, running = false;
  let fpsAcc = 0, fpsN = 0;

  const loop = {
    step,
    timeScale: 1,     // simulation speed multiplier (1 = real time, 0.3 = slow motion)
    hitstopT: 0,      // real seconds of simulation freeze remaining
    manual: false,    // when true, requestAnimationFrame does not advance; call stepFrames()
    time: 0,          // simulated seconds
    realTime: 0,      // wall-clock seconds while running
    frame: 0,         // rendered frames
    fps: 60,
    paused: false,

    // Freeze the simulation for `sec` real seconds (rendering continues). Longest request wins.
    hitstop(sec) { if (sec > loop.hitstopT) loop.hitstopT = sec; },

    // Advance one visual frame of `realDt` seconds.
    advance(realDt) {
      loop.realTime += realDt;
      let simDt = loop.paused ? 0 : realDt * loop.timeScale;
      if (loop.hitstopT > 0) { loop.hitstopT -= realDt; simDt = 0; }
      acc += simDt;
      let n = 0;
      while (acc >= step - 1e-9 && n < 16) { update(step); loop.time += step; acc -= step; n++; }
      if (acc < 0) acc = 0;
      if (n === 16) acc = 0; // never spiral
      render(acc / step, realDt);
      loop.frame++;
    },

    // Deterministic stepping for manual mode: n visual frames of 1/fps each.
    stepFrames(n = 1, fps = 60) { for (let i = 0; i < n; i++) loop.advance(1 / fps); },

    start() {
      if (running) return;
      running = true; last = 0;
      const tick = (now) => {
        if (!running) return;
        raf = requestAnimationFrame(tick);
        if (!last) { last = now; return; }
        let dt = (now - last) / 1000;
        last = now;
        if (dt > maxFrame) dt = maxFrame;
        fpsAcc += dt; fpsN++;
        if (fpsAcc >= 0.5) { loop.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
        if (!loop.manual) loop.advance(dt);
      };
      raf = requestAnimationFrame(tick);
    },
    stop() { running = false; cancelAnimationFrame(raf); },
    // Drop accumulated time (call after a long pause or state change).
    resetAccumulator() { acc = 0; last = 0; },
  };
  return loop;
}
