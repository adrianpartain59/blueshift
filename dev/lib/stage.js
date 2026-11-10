// dev/lib/stage.js — a stand-in for the real game so each draw module can be built and screenshotted
// on its own. It produces the same `frame` object and the same events the real game produces, from
// a fixed script (the opening 32 seconds of BLUESHIFT, then a repeating phrase), fully deterministic.
//
// URL parameters (all optional):
//   t=12.5        render the scene at song second 12.5 (deterministic, single frame). Without `t` it runs live.
//   start=20      begin the script at this beat instead of 0 (so t counts from there)
//   gear=4        pin the gear        lead=40   pin the lead (metres)       sector=3  pin the sector
//   mode=title    force frame.mode ('title' | 'ignition' | 'run' | 'dead' | 'results'); title sets attract
//   die=40        nova catches the runner at this beat
//   notube=1      do not draw the play tube      norunner=1  do not draw the stand-in runner
//   comfort=1     frame.comfort = true
// For multi-shot runs use tools/shots.mjs, which calls window.__stage.seek(t).
import { createGfx } from '../../src/engine/gfx.js';
import { createCam3d } from '../../src/engine/cam3d.js';
import { createFx } from '../../src/engine/fx.js';
import { hash1, clamp, clamp01, ease, lerp } from '../../src/engine/math.js';
import { createFrame } from '../../src/game/frame.js';
import { setupCamera } from '../../src/game/camera.js';
import { drawTube, drawStrikeRing } from '../../src/game/tube.js';
import { APOTHEM, LANE_ANGLE, LANES, GEAR_SPEED, GEAR_FLUX, LEAD_MAX, LEAD_START, novaSpeed, FLIP_BEATS, C } from '../../src/game/config.js';
import { beatToTime, timeToBeat, sectorOfBeat, sectorStartBeat, sectorEndBeat, bpmAtBeat, DROP_BEAT } from '../../src/game/timeline.js';

const STEP = 1 / 120;

export function createStage(canvasId = 'c') {
  const q = new URLSearchParams(location.search);
  const num = (k, d) => (q.has(k) ? +q.get(k) : d);
  const gfx = createGfx(document.getElementById(canvasId));
  const cam = createCam3d(gfx);
  const fx = createFx(null);
  const frame = createFrame();
  const startBeat = num('start', 0);
  const pinGear = num('gear', 0), pinLead = num('lead', -1), pinSector = num('sector', -1), dieBeat = num('die', -1);
  const forceMode = q.get('mode') || '';
  frame.comfort = q.has('comfort');

  // ---- mock simulation state
  const m = {
    t: beatToTime(startBeat), lane: 0, rollAngle: 0, rollFrom: 0, rollTo: 0, rollT: 1,
    air: -1, airStartBeat: 0, flipFromAngle: 0,
    gear: startBeat >= DROP_BEAT ? 2 : 1, gearF: startBeat >= DROP_BEAT ? 2 : 1, speed: 48, dist: 0,
    flux: 0, lead: LEAD_START, score: 0, chain: 0, ramT: -1, landT: 9, crashT: 9, grind: 0,
    dead: false, deadT: 0, prompt: '', promptDir: 0, lastBeat: Math.ceil(startBeat) - 1, visOffset: 0, freeze: 0,
  };
  const events = [];
  const emit = (type, o) => { const e = o || {}; e.type = type; events.push(e); return e; };

  function doRoll(dir) {
    m.lane = (m.lane + dir + LANES) % LANES;
    m.rollFrom = m.rollAngle; m.rollTo = m.rollTo + dir * LANE_ANGLE; m.rollT = 0;
    emit('roll', { dir, lane: m.lane, air: m.air >= 0 });
  }
  function doFlip(beat, clean) {
    m.air = 0; m.airStartBeat = beat; m.flipFromAngle = m.rollTo;
    emit('flip', { fromLane: m.lane, toLane: (m.lane + 4) % LANES, clean });
  }
  function doBreach(grade, kind) {
    m.ramT = 0;
    emit('breach', {});
    if (grade === 'perfect') m.chain++; else m.chain = 0;
    emit('breachHit', { grade, kind, chain: m.chain });
    m.flux += grade === 'perfect' ? 30 : 18; m.score += (grade === 'perfect' ? 500 : 200) * m.gear;
    m.freeze = grade === 'perfect' ? 0.09 : 0.06;
  }
  function gearUp() { if (m.gear < 5) { m.gear++; m.flux = 0; emit('gearUp', { gear: m.gear }); } }
  function crash(cause) {
    const lost = Math.min(2, m.gear - 1);
    m.gear -= lost; m.flux = 0; m.lead = Math.max(5, m.lead - 40); m.crashT = 0; m.chain = 0;
    emit('crash', { cause, gearLost: lost });
    if (lost) emit('gearDown', { gear: m.gear });
    m.freeze = 0.11;
  }

  // What happens on each integer beat of the script.
  function onBeat(b) {
    emit('beat', { beat: b, bar: Math.floor(b / 4), downbeat: b % 4 === 0 });
    if (b === 0) emit('start', { quick: false });
    if (b >= 1 && b <= 3) emit('pip', { n: b });
    if (b === 4) { emit('launch', {}); doBreach('good', 'shutter'); }
    if (b === 7 || b === 9 || b === 15) { m.prompt = 'roll'; doRoll(hash1(b) > 0.5 ? 1 : -1); }
    if (b === 8 || b === 10 || b === 16) { emit('flyby', { side: hash1(b) > 0.5 ? -1 : 1, kind: 'block' }); m.prompt = ''; }
    if (b === 11) m.prompt = 'breach';
    if (b === 12) { doBreach('perfect', 'wall'); m.prompt = ''; }
    if (b === 13) { emit('thread', {}); m.flux += 12; }
    if (b === 19) m.prompt = 'breach';
    if (b === 20) { m.prompt = ''; doBreach('perfect', 'shutter'); emit('drop', {}); emit('novaIgnite', {}); emit('sector', { sector: 1, name: 'THE SPINDLE' }); gearUp(); }
    if (b === 21) { m.prompt = 'hold'; m.promptDir = 1; }
    if (b >= 22 && b <= 31) { doRoll(1); m.grind = 1; emit('grind', { side: 1 }); m.flux += 5; }
    if (b === 32) { m.grind = 0; m.prompt = ''; m.promptDir = 0; doBreach('good', 'wall'); gearUp(); }
    if (b === 34) { emit('graze', { side: 1 }); m.flux += 5; }
    if (b === 35) { doRoll(-1); emit('thread', {}); }
    if (b === 37) m.prompt = 'flip';
    if (b === 38 || b === 42) { m.prompt = ''; doFlip(b, b === 38); }
    if (b >= 44 && b <= 47) { doRoll(b % 2 ? 1 : -1); emit('graze', { side: b % 2 ? -1 : 1 }); m.flux += 5; }
    if (b === 48) doBreach('perfect', 'wall');
    if (b === 49) doRoll(1);
    if (b === 52) crash('block');
    if (b === 54) doFlip(b, false);
    if (b === 56) doBreach('good', 'wall');
    if (b === 58 || b === 59) doRoll(-1);
    if (b === 60) emit('thread', {});
    if (b >= 64 && b <= 67) doBreach('perfect', 'wall');
    if (b === 68) { doBreach('perfect', 'gate'); emit('sectorGate', { sector: 2 }); emit('sector', { sector: 2, name: 'NEON MILE' }); gearUp(); }
    if (b > 68) {
      const k = (b - 68) % 16, loop = Math.floor((b - 68) / 16);
      if (k === 0 && b > 68) { doBreach('perfect', 'wall'); if (loop % 2 === 0) gearUp(); }
      if (k === 1 || k === 2 || k === 9 || k === 11 || k === 13) doRoll(hash1(b) > 0.5 ? 1 : -1);
      if (k === 4) doFlip(b, hash1(b) > 0.4);
      if (k === 6 || k === 10) { emit('graze', { side: hash1(b) > 0.5 ? 1 : -1 }); m.flux += 5; }
      if (k === 8) doBreach(hash1(b) > 0.3 ? 'perfect' : 'good', 'wall');
      if (k === 12) emit('thread', {});
      if (k === 14 && loop % 3 === 2) crash('iris');
      const sEnd = sectorEndBeat(sectorOfBeat(b));
      if (b === sEnd) { emit('sectorGate', { sector: sectorOfBeat(b) }); emit('sector', { sector: sectorOfBeat(b), name: 'SECTOR' }); }
    }
    if (b === dieBeat && !m.dead) { m.dead = true; m.deadT = 0; emit('death', { cause: 'nova' }); }
  }

  function stepSim(dt) {
    if (m.dead) { m.deadT += dt; }
    m.t += dt;
    const beat = timeToBeat(m.t);
    const b = Math.floor(beat);
    if (!m.dead) while (m.lastBeat < b) { m.lastBeat++; onBeat(m.lastBeat); }
    // flip progress
    if (m.air >= 0) {
      m.air = (beat - m.airStartBeat) / FLIP_BEATS;
      if (m.air >= 1) {
        m.air = -1; m.lane = (m.lane + 4) % LANES; m.landT = 0;
        m.rollTo = m.flipFromAngle + Math.PI; m.rollFrom = m.rollTo; m.rollAngle = m.rollTo; m.rollT = 1;
        emit('land', { lane: m.lane }); emit('irisPass', { clean: true }); emit('orb', { n: 1 });
      }
    }
    // roll animation (90 ms snap with a little overshoot)
    const prev = m.rollAngle;
    if (m.air >= 0) m.rollAngle = m.flipFromAngle + Math.PI * ease.inOutCubic(clamp01(m.air));
    else if (m.rollT < 1) { m.rollT = Math.min(1, m.rollT + dt / 0.09); m.rollAngle = lerp(m.rollFrom, m.rollTo, ease.outBack(m.rollT)); }
    m.rollVel = (m.rollAngle - prev) / dt;
    // gears, speed, lead
    const gear = pinGear || m.gear;
    m.gearF += (gear - m.gearF) * Math.min(1, dt * 8);
    m.speed += (GEAR_SPEED[gear] - m.speed) * Math.min(1, dt * 6);
    m.dist += m.speed * dt;
    const sector = pinSector >= 0 ? pinSector : sectorOfBeat(beat);
    if (beat >= DROP_BEAT && !m.dead) m.lead = clamp(m.lead + (GEAR_SPEED[gear] - novaSpeed(sector)) * dt, 0, LEAD_MAX);
    if (m.ramT >= 0) { m.ramT += dt; if (m.ramT > 0.4) m.ramT = -1; }
    m.landT += dt; m.crashT += dt;
    if (!m.dead) m.score += m.speed * dt * gear;
    // visual hit-stop: freeze, then catch up at 1.5x
    if (m.freeze > 0) { m.freeze -= dt; m.visOffset += dt; } else if (m.visOffset > 0) m.visOffset = Math.max(0, m.visOffset - dt * 0.5);
  }

  function fillFrame(realDt) {
    const f = frame;
    f.time += realDt; f.dt = realDt;
    const tv = m.t - m.visOffset;
    f.t = tv; f.beat = timeToBeat(tv); f.beatPhase = f.beat - Math.floor(f.beat);
    f.bar = Math.floor(f.beat / 4); f.barPhase = f.beat / 4 - f.bar; f.bpm = bpmAtBeat(f.beat);
    f.kick = Math.exp(-f.beatPhase * 5.5);
    const gear = pinGear || m.gear;
    f.sector = pinSector >= 0 ? pinSector : sectorOfBeat(f.beat);
    const s0 = sectorStartBeat(f.sector), s1 = sectorEndBeat(f.sector);
    f.sectorT = clamp01((f.beat - s0) / (s1 - s0));
    f.conduit = f.beat < DROP_BEAT && pinSector < 1 ? 1 : 0;
    f.conduitEndZ = (beatToTime(DROP_BEAT) - tv) * m.speed;
    f.mode = forceMode || (m.dead ? (m.deadT > 1.5 ? 'results' : 'dead') : f.beat < 4 ? 'ignition' : 'run');
    f.attract = f.mode === 'title';
    f.gear = gear; f.gearF = pinGear ? pinGear : m.gearF; f.speed = m.speed; f.dist = m.dist - m.visOffset * m.speed;
    f.flux = m.flux % GEAR_FLUX[gear]; f.fluxN = clamp01(f.flux / GEAR_FLUX[gear]);
    f.lead = pinLead >= 0 ? pinLead : m.lead; f.leadN = f.lead / LEAD_MAX;
    f.novaOn = f.beat >= DROP_BEAT || pinSector >= 1;
    f.danger = f.novaOn ? clamp01(1 - f.lead / 150) : 0;
    f.score = Math.floor(m.score); f.mult = gear; f.chain = m.chain; f.bestScore = 184250; f.bestDist = 6120;
    f.lane = m.lane; f.roll = m.rollAngle; f.rollVel = m.rollVel; f.air = m.air;
    // runner position: on its lane, or travelling the diameter during a flip
    if (m.air >= 0) {
      const rho = APOTHEM * Math.cos(Math.PI * clamp01(m.air));   // +5 -> -5 along the launch diameter
      const a = m.flipFromAngle, up = m.flipFromAngle + Math.PI * clamp01(m.air);
      f.runnerX = Math.sin(a) * rho; f.runnerY = -Math.cos(a) * rho;
      f.upX = -Math.sin(up); f.upY = Math.cos(up);
    } else {
      f.runnerX = Math.sin(m.rollAngle) * APOTHEM; f.runnerY = -Math.cos(m.rollAngle) * APOTHEM;
      f.upX = -Math.sin(m.rollAngle); f.upY = Math.cos(m.rollAngle);
    }
    f.ramT = m.ramT; f.landT = m.landT; f.crashT = m.crashT; f.ghost = m.crashT < 1.2; f.grind = m.grind;
    f.dead = m.dead; f.deadT = m.deadT; f.prompt = m.prompt; f.promptDir = m.promptDir;
  }

  let mod = null, drawTubeOn = !q.has('notube'), drawRunnerOn = !q.has('norunner');

  // One visual frame: advance the mock by dt, deliver events, update, optionally render.
  function tick(dt, render) {
    events.length = 0;
    let acc = dt;
    while (acc > 1e-9) { const h = Math.min(STEP, acc); stepSim(h); acc -= h; }
    fillFrame(dt);
    fx.update(dt);
    if (mod) {
      if (mod.onEvent) for (const e of events) mod.onEvent(e, frame);
      if (mod.update) mod.update(dt, frame);
    }
    if (render) draw();
  }

  function draw() {
    gfx.beginFrame();
    setupCamera(cam, frame, null);
    if (cam.project(frame.runnerX, frame.runnerY, 0)) { frame.runnerSX = cam.sx; frame.runnerSY = cam.sy; frame.runnerS = cam.s; }
    gfx.push();
    gfx.translate(fx.camX, fx.camY);
    if (mod && mod.drawBackground) mod.drawBackground(frame);
    if (drawTubeOn) { drawTube(gfx, cam, frame); drawStrikeRing(gfx, cam, frame); }
    if (mod && mod.drawBack) mod.drawBack(frame);
    if (drawRunnerOn) standInRunner();
    if (mod && mod.drawWorld) mod.drawWorld(frame);
    gfx.pop();
    if (mod && mod.drawScreen) mod.drawScreen(frame);
    gfx.beginOverlay(fx.post);
    if (mod && mod.drawOverlay) mod.drawOverlay(frame);
    gfx.endFrame(fx.post);
    window.__frames = (window.__frames || 0) + 1;
  }

  // A plain marker so other modules have something where the courier will be.
  function standInRunner() {
    const s = frame.runnerS, x = frame.runnerSX, y = frame.runnerSY;
    const a = Math.atan2(frame.upX, frame.upY) + frame.roll; // on-screen lean of the up vector (0 = upright)
    gfx.push(); gfx.translate(x, y); gfx.rotate(a);
    gfx.line(0, 0, 0, -1.2 * s, 0.12 * s, C.you, 1.6);
    gfx.disc(0, -1.5 * s, 0.2 * s, C.white, 1.4, 1);
    gfx.line(-0.35 * s, -0.02 * s, 0.35 * s, -0.02 * s, 0.08 * s, C.you, 1.4);
    gfx.pop();
  }

  const stage = {
    gfx, cam, fx, frame, q,
    // Register a module: any of { onEvent, update, drawBackground, drawBack, drawWorld, drawScreen, drawOverlay }.
    use(module) { mod = module; return stage; },
    // Deterministically advance to song second `t` (measured from the start beat) and render one frame.
    seek(t) {
      const target = beatToTime(startBeat) + t;
      while (m.t + 1 / 60 <= target + 1e-9) tick(1 / 60, false);
      tick(Math.max(1e-4, target - m.t), true);
      return true;
    },
    start() {
      if (q.has('t')) { stage.seek(+q.get('t')); window.__done = true; return; }
      // manual=1 (set by tools/shots.mjs): no live loop, so seek() times are exact and repeatable
      if (q.has('manual')) { tick(1e-4, true); return; }
      let last = 0;
      const loop = (now) => { requestAnimationFrame(loop); if (!last) { last = now; return; } const dt = Math.min(0.05, (now - last) / 1000); last = now; tick(dt, true); };
      requestAnimationFrame(loop);
    },
  };
  window.__stage = stage;
  return stage;
}
