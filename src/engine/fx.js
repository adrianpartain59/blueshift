// engine/fx.js — the screen-level game-feel toolkit: trauma shake, directional punches, flashes,
// chromatic kicks, glitch bursts, zoom punches, shockwave ripples and slow motion. It owns the
// `post` object that goes to gfx.endFrame() and exposes camera offsets for the world layer.
// Everything here runs on REAL time, so effects keep animating through hitstop and slow motion.
import { noise1, clamp01, lerp } from './math.js';

export function createFx(loop) {
  // "base" is the steady look the game sets every frame (speed lines, mood); kicks are added on top.
  const base = {
    exposure: 1, bloom: 1, aberration: 0.0012, radialBlur: 0, vignette: 0.42, scanlines: 0.08,
    grain: 0.035, barrel: 0.02, saturation: 1, zoom: 1, glitch: 0, fade: 1, contrast: 0.35,
    tint: [1, 1, 1], centerX: 0.5, centerY: 0.5,
  };
  const post = {
    time: 0, exposure: 1, bloom: 1, bloomThreshold: 0.9, bloomSpread: 0.72, contrast: 0.35,
    aberration: 0.0012, vignette: 0.42, scanlines: 0.08, grain: 0.035, flash: 0, flashColor: [1, 1, 1],
    glitch: 0, radialBlur: 0, barrel: 0.02, saturation: 1, tint: [1, 1, 1], invert: 0, zoom: 1, fade: 1,
    offsetX: 0, offsetY: 0, centerX: 0.5, centerY: 0.5, shockwaves: [],
  };
  const shockPool = [];
  for (let i = 0; i < 4; i++) shockPool.push({ x: 0, y: 0, radius: 0, width: 0.06, strength: 0, speed: 1, life: 0, maxLife: 1, s0: 0 });

  let trauma = 0, t = 0;
  let punchX = 0, punchY = 0, pvx = 0, pvy = 0;       // spring-damped screen offset
  let zoomK = 0, zoomV = 0;                            // spring-damped zoom kick
  let flashK = 0, flashDecay = 8;
  let abK = 0, abDecay = 6;
  let rbK = 0, rbDecay = 4;
  let glitchK = 0, glitchT = 0;
  let invertT = 0;
  let satK = 0, satDecay = 3;
  let exposureK = 0, exposureDecay = 5;
  let slowScale = 1, slowHold = 0, slowEase = 0.25, slowActive = false;

  const fx = {
    post, base,
    camX: 0, camY: 0, camRot: 0,     // add to the WORLD camera only (HUD stays put)
    maxShake: 22, maxShakeRot: 0.022,

    // ---- triggers
    shake(amount) { trauma = Math.min(1, trauma + amount); },
    setTraumaFloor(v) { if (trauma < v) trauma = v; },          // continuous rumble (e.g. while boosting)
    punch(dx, dy) { pvx += dx * 28; pvy += dy * 28; },           // whole-screen directional kick, peak ~ (dx,dy) logical units
    zoomPunch(amount) { zoomV += amount * 30; },                 // +0.05 = quick ~5% push-in that springs back
    flash(col, amount = 0.6, decay = 8) { post.flashColor[0] = col[0]; post.flashColor[1] = col[1]; post.flashColor[2] = col[2]; flashK = Math.max(flashK, amount); flashDecay = decay; },
    aberrate(amount = 0.01, decay = 6) { abK = Math.max(abK, amount); abDecay = decay; },
    radialBlur(amount = 0.08, decay = 4) { rbK = Math.max(rbK, amount); rbDecay = decay; },
    glitch(amount = 0.6, seconds = 0.18) { glitchK = Math.max(glitchK, amount); glitchT = Math.max(glitchT, seconds); },
    invert(seconds = 0.05) { invertT = Math.max(invertT, seconds); },
    desaturate(amount = 0.8, decay = 3) { satK = Math.max(satK, amount); satDecay = decay; },
    exposureKick(amount = 0.5, decay = 5) { exposureK = Math.max(exposureK, amount); exposureDecay = decay; },
    // Expanding distortion ring. x,y in 0..1 view space (y down). speed in view-heights per second.
    shockwave(x, y, strength = 0.03, speed = 1.2, life = 0.6, width = 0.07) {
      let s = shockPool[0];
      for (const c of shockPool) { if (c.life <= 0) { s = c; break; } if (c.life < s.life) s = c; }
      s.x = x; s.y = y; s.radius = 0; s.speed = speed; s.s0 = strength; s.strength = strength; s.life = life; s.maxLife = life; s.width = width;
    },
    // Slow the simulation to `scale` for `hold` real seconds, then ease back over `easeOut` seconds.
    slowmo(scale = 0.25, hold = 0.25, easeOut = 0.35) { slowScale = scale; slowHold = hold; slowEase = easeOut; slowActive = true; if (loop) loop.timeScale = scale; },
    cancelSlowmo() { slowActive = false; if (loop) loop.timeScale = 1; },
    get trauma() { return trauma; },
    get slowAmount() { return loop ? 1 - loop.timeScale : 0; },
    reset() {
      trauma = 0; punchX = punchY = pvx = pvy = 0; zoomK = zoomV = 0; flashK = abK = rbK = glitchK = glitchT = invertT = satK = exposureK = 0;
      for (const s of shockPool) s.life = 0;
      fx.cancelSlowmo();
    },

    // ---- per rendered frame, with real dt
    update(dt) {
      t += dt;
      trauma = Math.max(0, trauma - dt * 1.5);
      const sh = trauma * trauma;
      fx.camX = (noise1(t * 31.7) * 2 - 1) * sh * fx.maxShake;
      fx.camY = (noise1(t * 29.3 + 57.1) * 2 - 1) * sh * fx.maxShake;
      fx.camRot = (noise1(t * 23.9 + 113.3) * 2 - 1) * sh * fx.maxShakeRot;
      // critically damped-ish springs (stiffness 420, damping 26)
      const sub = dt > 0.02 ? 2 : 1, h = dt / sub;
      for (let i = 0; i < sub; i++) {
        pvx += (-420 * punchX - 26 * pvx) * h; pvy += (-420 * punchY - 26 * pvy) * h;
        punchX += pvx * h; punchY += pvy * h;
        zoomV += (-520 * zoomK - 30 * zoomV) * h; zoomK += zoomV * h;
      }
      flashK *= Math.exp(-flashDecay * dt); if (flashK < 0.002) flashK = 0;
      abK *= Math.exp(-abDecay * dt);
      rbK *= Math.exp(-rbDecay * dt);
      satK *= Math.exp(-satDecay * dt);
      exposureK *= Math.exp(-exposureDecay * dt);
      if (glitchT > 0) { glitchT -= dt; if (glitchT <= 0) glitchK = 0; }
      if (invertT > 0) invertT -= dt;
      if (slowActive && loop) {
        if (slowHold > 0) { slowHold -= dt; loop.timeScale = slowScale; }
        else {
          loop.timeScale = Math.min(1, loop.timeScale + (dt / Math.max(slowEase, 1e-3)) * (1 - slowScale));
          if (loop.timeScale >= 1) { loop.timeScale = 1; slowActive = false; }
        }
      }
      // shockwaves
      post.shockwaves.length = 0;
      for (const s of shockPool) {
        if (s.life <= 0) continue;
        s.life -= dt;
        s.radius += s.speed * dt;
        const k = clamp01(s.life / s.maxLife);
        s.strength = s.s0 * k * k;
        if (s.life > 0) post.shockwaves.push(s);
      }
      // compose post
      const b = base;
      post.time = t;
      post.exposure = b.exposure + exposureK;
      post.bloom = b.bloom + flashK * 0.6;
      post.contrast = b.contrast;
      post.aberration = b.aberration + abK + sh * 0.006;
      post.radialBlur = b.radialBlur + rbK;
      post.vignette = b.vignette; post.scanlines = b.scanlines; post.grain = b.grain; post.barrel = b.barrel;
      post.saturation = lerp(b.saturation, 0.1, clamp01(satK));
      post.glitch = Math.max(b.glitch, glitchK);
      post.invert = invertT > 0 ? 1 : 0;
      post.flash = flashK;
      post.zoom = b.zoom + zoomK;
      post.fade = b.fade;
      post.tint[0] = b.tint[0]; post.tint[1] = b.tint[1]; post.tint[2] = b.tint[2];
      post.centerX = b.centerX; post.centerY = b.centerY;
      post.offsetX = punchX; post.offsetY = punchY;
    },
  };
  return fx;
}
