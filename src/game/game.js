// game/game.js — the conductor. Owns the clock, input, the state machine (title/attract, ignition,
// run, dead, results), fills the frame contract, maps simulation events to sound, and calls every
// draw module in order. The simulation runs on SONG TIME: when audio is live, song time is the audio
// clock (what you see is locked to what you hear); otherwise it is a virtual clock.
import { createCam3d } from '../engine/cam3d.js';
import { createFx } from '../engine/fx.js';
import { createAudio } from '../engine/audio.js';
import { clamp, clamp01, ease, lerp, damp } from '../engine/math.js';
import { APOTHEM, LANE_ANGLE, GEAR_FLUX, LEAD_MAX, GEAR_SPEED, RAM_PERFECT } from './config.js';
import { beatToTime, timeToBeat, sectorStartBeat, sectorEndBeat, bpmAtBeat, DROP_BEAT, QUICK_START_BEAT } from './timeline.js';
import { createFrame } from './frame.js';
import { setupCamera } from './camera.js';
import { drawTube, drawStrikeRing } from './tube.js';
import { createHazardRenderer } from './hazards.js';
import { createSim, H_COMING } from './sim.js';
import { createBot } from './bot.js';
import { KIND } from './patterns.js';
import { createMusic } from './music.js';
import { createSfx } from './sfx.js';
import { createCity } from './city.js';
import { createVfx } from './vfx.js';
import { createCourier } from './courier.js';
import { createHud } from './hud.js';

const STEP = 1 / 120;
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'flip', KeyW: 'flip', Space: 'breach', KeyJ: 'breach', KeyX: 'breach',
};
const IGNORE_KEYS = new Set(['Tab', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12']);
const CREEP_UNTIL = beatToTime(4);
const T_DROP = beatToTime(DROP_BEAT);

export function createGame({ canvas, gfx, params }) {
  const P = params || new URLSearchParams('');
  const manual = P.has('manual');
  const cam = createCam3d(gfx);
  const fx = createFx(null);
  const frame = createFrame();
  // comfort mode (no flashes, less shake): remembered, and on by default when the system asks for reduced motion
  try {
    const c = localStorage.getItem('blueshift.comfort');
    frame.comfort = c === null ? matchMedia('(prefers-reduced-motion: reduce)').matches : c === '1';
  } catch (e) { /* storage or matchMedia unavailable */ }
  const city = createCity(gfx, cam);
  const vfx = createVfx(gfx, cam, fx);
  const courier = createCourier(gfx, cam);
  const hud = createHud(gfx);
  const hazards = createHazardRenderer(gfx, cam);
  const modules = [city, vfx, courier, hud];

  let audio = null, music = null, sfx = null, audioFailed = false, wantMute = false;
  let sim = null, bot = null;
  let mode = 'title';            // 'title' | 'run' | 'dead' | 'results'
  let attract = true;
  let paused = false;
  let runs = 0;
  let seedCounter = (P.has('seed') ? +P.get('seed') : (Date.now() % 100000)) | 0;
  const best = loadBest();
  let newBest = false;

  // ---- clocks
  let songT = 0;                 // the song time the simulation should have reached
  let clockAudio = false;        // true when songT is derived from the audio clock
  let runAudioT0 = 0, runSongT0 = 0;
  let lastCt = -1, perfAtCt = 0;
  let visOffset = 0, visFreeze = 0;   // visual hit-stop: the picture lags the song by visOffset seconds
  let visT = -1e9, visDist = -1e9;    // what the picture has shown so far: neither ever runs backwards
  let audioStall = 0, stallTries = 0; // seconds the audio clock has refused to run
  let audioLost = false;         // the audio clock gave up mid-run: the song is re-locked to the game when it comes back
  let musicErr = false;
  let stateT = 0;                // real seconds in the current mode

  // ---- cosmetic runner state
  let rollAngle = 0, rollTarget = 0, rollFrom = 0, rollAnimT = 1;
  let flipFromAngle = 0, flipDelta = Math.PI, flipping = false;
  let gearF = 1, lastGear = 1;
  let grindVis = 0, grindLv = 0.3;
  const events = [];
  const inputQ = [];             // { a: action, down, t: song time }
  let device = 'keyboard';
  try { if (matchMedia('(hover: none) and (pointer: coarse)').matches) device = 'touch'; } catch (e) { /* no matchMedia */ }
  if (P.has('device')) device = P.get('device');   // ?device=touch|gamepad: show that device's prompts (testing)
  const view = { t: 0, speed: 48, beatDur: 0.47, zAt: null };
  let creepRun = false;
  let mouthDist = null;          // world distance of the conduit mouth, once known (the city anchors itself there)

  view.zAt = (time) => {
    const tv = view.t;
    if (creepRun && tv < CREEP_UNTIL) {
      // still clamped in the launch barrel: crawl until beat 4, then full speed
      const a = Math.min(time, CREEP_UNTIL) - tv, b = Math.max(0, time - CREEP_UNTIL);
      return a * view.speed + b * GEAR_SPEED[1];
    }
    return (time - tv) * view.speed;
  };

  function loadBest() {
    try { const v = JSON.parse(localStorage.getItem('blueshift.best') || 'null'); if (v && typeof v.score === 'number') return v; } catch (e) { /* storage unavailable */ }
    return { score: 0, dist: 0, sector: 0 };
  }
  function saveBest() { try { localStorage.setItem('blueshift.best', JSON.stringify(best)); } catch (e) { /* storage unavailable */ } }

  // ---- audio
  function ensureAudio() {
    if (audio || audioFailed || manual || P.has('mute')) return;
    try {
      audio = createAudio();
      if (!audio) { audioFailed = true; return; }
      // iOS plays Web Audio in the 'ambient' category, which the ring/silent switch mutes: ask for playback
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* optional */ }
      if (P.has('vol')) audio.setMasterVolume(clamp01(+P.get('vol')));   // ?vol=0 runs the full audio path silently
      if (wantMute) audio.setMuted(true);
      music = createMusic(audio);
      sfx = createSfx(audio);
    } catch (e) { audio = null; music = null; sfx = null; audioFailed = true; console.warn('audio unavailable', e); }
  }
  function audioNowOutput() {
    // context time of the sound leaving the speakers right now
    const ctx = audio.ctx, now = performance.now();
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      // The pair goes stale while the context is suspended; right after a resume it would extrapolate
      // across the whole pause. What is leaving the speakers can never be ahead of the context clock.
      if (ts && ts.performanceTime > 0 && ts.contextTime > 0) {
        const est = ts.contextTime + (now - ts.performanceTime) / 1000;
        // sane only if it sits within half a second behind the context clock (some browsers report junk here)
        if (est <= ctx.currentTime + 0.001 && est > ctx.currentTime - 0.5) return est;
        if (est > ctx.currentTime) return ctx.currentTime;
      }
    }
    const ct = ctx.currentTime;
    if (ct !== lastCt) { lastCt = ct; perfAtCt = now; }
    const lat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    return lastCt + Math.min(0.05, (now - perfAtCt) / 1000) - lat;
  }
  const songToAudio = (t) => runAudioT0 + (t - runSongT0);
  // Nothing is queued on a context that is not running (it would all fire at once when it wakes up),
  // except in the moment after a run starts, while the song is waiting for the context to come up.
  function play(name, opts) { if (sfx && (audio.running || clockAudio)) { try { sfx.play(name, opts); } catch (e) { /* never let a sound break the game */ } } }
  // The audio clock stopped for a while (no gesture yet, an interruption, a device change) and the run
  // carried on without it. Now that it is back, start the song again in step with the game.
  function relockAudio() {
    audioLost = false; audioStall = 0;
    runAudioT0 = audio.now + 0.12; runSongT0 = songT + 0.12;
    try { music.setAmbient(false); music.start(runAudioT0, timeToBeat(runSongT0)); music.setGear(sim.gear); flagsSentAt = -1; } catch (e) { console.warn(e); }
    clockAudio = true;
  }

  // ---- runs
  function startAttract() {
    mode = 'title'; attract = true; stateT = 0;
    sim = createSim({ seed: 1000 + (seedCounter++ % 50), startBeat: 21, prompts: false });
    sim.gear = 3; sim.speed = GEAR_SPEED[3];
    bot = createBot(sim, { skill: 0.985, seed: seedCounter, greed: 1 });
    songT = sim.t; clockAudio = false; creepRun = false; mouthDist = -40;
    resetCosmetics();
    if (music) { music.stop(); music.setAmbient(true); }
    dispatch({ type: 'title' });
  }
  function startRun(quick) {
    ensureAudio();
    const startBeat = quick ? QUICK_START_BEAT : 0;
    const useBot = P.has('bot');
    sim = createSim({ seed: P.has('seed') ? +P.get('seed') : 1 + (seedCounter++ % 100000), startBeat, prompts: !quick && runs === 0 });
    bot = useBot ? createBot(sim, { skill: P.has('skill') ? +P.get('skill') : 1, seed: 5 }) : null;
    mode = 'run'; attract = false; stateT = 0; runs++; newBest = false; paused = false;
    dropSounded = false; launchSounded = false; scheduledHitId = -1; flagsSentAt = -1; audioStall = 0; stallTries = 0; audioLost = false;
    holders.left.clear(); holders.right.clear();
    songT = sim.t; creepRun = !quick; mouthDist = null;
    resetCosmetics();
    inputQ.length = 0;
    if (audio && music) {
      audio.resume();
      runAudioT0 = audio.now + 0.12; runSongT0 = sim.t;
      try { if (music.clearBarFlags) music.clearBarFlags(); music.setAmbient(false); music.setGear(sim.gear); music.setDanger(0); music.start(runAudioT0, startBeat); } catch (e) { console.warn(e); }
      clockAudio = true;
      // on a context that has only just started, the limiter swallows the first 50 ms: begin a moment in
      play('uiStart', audio.now < 0.15 ? { when: 0.15 } : {});
    } else clockAudio = false;
  }
  function resetCosmetics() {
    rollAngle = rollTarget = rollFrom = 0; rollAnimT = 1; flipping = false;
    sim.lane = 0;
    gearF = sim.gear; lastGear = sim.gear; visOffset = 0; visFreeze = 0; grindVis = 0; visT = -1e9; visDist = -1e9;
    fx.reset();
    events.length = 0;
  }

  // A draw module that throws must not take the game down with it: report once, keep playing, and
  // switch the module off if it keeps failing.
  const MOD_NAMES = ['city', 'vfx', 'courier', 'hud'];
  const fails = [0, 0, 0, 0];
  function guard(i, method, a, b) {
    if (fails[i] > 40) return;
    try { modules[i][method](a, b); }
    catch (e) { if (fails[i]++ === 0) console.error('[' + MOD_NAMES[i] + '.' + method + ']', e); }
  }
  function dispatch(e) { for (let i = 0; i < modules.length; i++) guard(i, 'onEvent', e, frame); }

  // ---- input
  function act(a, down, perfTime) {
    if (mode !== 'run' || !sim || !sim.alive || bot) return;
    let t = sim.t;
    if (clockAudio && perfTime) {
      // place the press where it really happened in song time; ignore timestamps that make no sense
      const age = (performance.now() - perfTime) / 1000;
      if (age >= 0 && age < 0.25) t = songT - age;
    }
    inputQ.push({ a, down, t });
  }
  // Rolls can be held from several sources at once (A and Left, two fingers, d-pad and stick): the
  // direction is let go only when the last of them is. A set cannot over-count a key-up that got lost.
  const holders = { left: new Set(), right: new Set() };
  function dirInput(a, down, src, perfTime) {
    const set = holders[a];
    if (down) { set.add(src); act(a, true, perfTime); }
    else if (set.delete(src) && set.size === 0) act(a, false, perfTime);
  }
  function dropSources(prefix) {
    for (const a of ['left', 'right']) {
      const set = holders[a];
      let had = false;
      for (const src of set) if (src.startsWith(prefix)) { set.delete(src); had = true; }
      if (had && set.size === 0) act(a, false, 0);
    }
  }
  // Any key starts a run from the title, the results, or the death itself once the distance stamp can
  // be read (so the last panicked press of a run does not skip its ending). Returns true when a run was started.
  function anyKey() {
    if (manual) return false;
    if (mode === 'title') startRun(P.has('quick'));   // ?quick=1: skip the conduit even on the first run (testing)
    else if ((mode === 'results' && stateT > 0.1) || (mode === 'dead' && stateT > 0.7)) startRun(true);
    else return false;
    return true;
  }
  // C, the pad's Back button, or the bottom-left corner of the pause screen on touch
  function toggleComfort() {
    frame.comfort = !frame.comfort;
    try { localStorage.setItem('blueshift.comfort', frame.comfort ? '1' : '0'); } catch (err) { /* storage unavailable */ }
    dispatch({ type: 'comfort', on: frame.comfort });
  }
  let pausedAt = 0;               // performance.now() of the last pause (a second Esc / Q this soon after is a key bounce)
  function togglePause() {
    if (mode !== 'run' || !sim.alive) return;
    paused = !paused;
    if (paused) pausedAt = performance.now();
    if (audio) { if (paused) audio.suspend(); else audio.resume(); }
    dispatch({ type: paused ? 'pause' : 'resume' });
  }
  // Back to the main menu (the title over the attract run) from the pause screen, the death or the
  // results. A run that is abandoned still counts toward the best score and distance.
  function quitToMenu() {
    if (mode === 'title' || manual) return;
    if (mode === 'run' && sim && !attract) {
      const score = Math.floor(sim.score);
      if (score > best.score) best.score = score;
      if (sim.dist > best.dist) best.dist = sim.dist;
      if (sim.sector > best.sector) best.sector = sim.sector;
      saveBest();
    }
    play('uiTick', {});           // queued now, heard the moment the context is running again
    if (sfx) { sfx.loop('grind', 0); sfx.loop('wind', 0); sfx.loop('haze', 0); }
    paused = false; newBest = false;
    if (audio) audio.resume();
    inputQ.length = 0; holders.left.clear(); holders.right.clear(); pointers.clear(); armedPointer = -1;
    startAttract();
  }
  // Esc or Q: one step back. In a run the first press pauses and the second, from the pause screen,
  // leaves for the main menu (two presses, so a stray Q beside W and A never throws a run away).
  // After a run it goes straight to the menu. On the menu itself there is nothing to quit to.
  function quitKey() {
    if (mode === 'run') {
      if (!paused) togglePause();
      else if (performance.now() - pausedAt > 250) quitToMenu();
    } else if (mode === 'dead' || mode === 'results') quitToMenu();
    else if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) { /* optional */ } }
  }
  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || IGNORE_KEYS.has(e.code)) return;
    const a = KEYMAP[e.code];
    if (a || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    device = 'keyboard';
    if (e.code === 'KeyM') { wantMute = !wantMute; if (audio) audio.setMuted(wantMute); return; }
    if (e.code === 'KeyF') { toggleFullscreen(); return; }
    if (e.code === 'KeyC') { toggleComfort(); return; }
    if (e.code === 'KeyP') { if (mode === 'run') togglePause(); return; }
    if (e.code === 'Escape' || e.code === 'KeyQ') { quitKey(); return; }
    if (paused) { togglePause(); return; }
    // a direction that starts the run is already held in it (its key-repeat never reaches us)
    if (mode !== 'run') { if (anyKey() && (a === 'left' || a === 'right')) dirInput(a, true, 'k:' + e.code, e.timeStamp); return; }
    if (a === 'left' || a === 'right') dirInput(a, true, 'k:' + e.code, e.timeStamp);
    else if (a) act(a, true, e.timeStamp);
  }
  function onKeyUp(e) { const a = KEYMAP[e.code]; if (a === 'left' || a === 'right') dirInput(a, false, 'k:' + e.code, e.timeStamp); }
  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (canvas.requestFullscreen) canvas.requestFullscreen().catch(() => {});
    } catch (e) { /* optional */ }
  }
  // touch: four instant zones, no gestures (a gesture would have to wait before it could tell a tap
  // from a swipe, and waiting is latency): left third and right third roll, centre top half flips,
  // centre bottom half breaches. The top-left corner (where the HUD draws a pause glyph) pauses.
  // Zones are fractions of the PICTURE, not of the canvas: on a screen that letterboxes the game the
  // buttons the HUD draws and the places that answer to a finger have to be the same places.
  const pointers = new Map();
  const viewPt = { x: 0, y: 0 };
  let armedPointer = -1;         // a touch that starts a run when it LIFTS: only the end of a touch may start audio
  function onPointerDown(e) {
    canvas.focus({ preventScroll: true });
    if (e.pointerType === 'touch') device = 'touch';
    gfx.clientToView(e.clientX, e.clientY, viewPt);
    const x = viewPt.x / gfx.W, y = viewPt.y / gfx.H;
    // on the pause screen and after a run, touch has two corner buttons (drawn by the HUD):
    // bottom-left the comfort switch (pause screen only), bottom-right MAIN MENU
    const corner = e.pointerType === 'touch' && y > 0.78 ? (x < 0.3 ? -1 : x > 0.7 ? 1 : 0) : 0;
    if (paused) { if (corner < 0) toggleComfort(); else if (corner > 0) quitToMenu(); else togglePause(); return; }
    if (mode !== 'run') {
      if (corner > 0 && (mode === 'dead' || mode === 'results')) quitToMenu();
      else if (e.pointerType === 'touch') armedPointer = e.pointerId;
      else anyKey();
      return;
    }
    if (e.pointerType === 'mouse') { act('breach', true, e.timeStamp); return; }
    if (x < 0.1 && y < 0.17) { togglePause(); e.preventDefault(); return; }
    const a = x < 0.34 ? 'left' : x > 0.66 ? 'right' : y < 0.5 ? 'flip' : 'breach';
    pointers.set(e.pointerId, a);
    if (a === 'left' || a === 'right') dirInput(a, true, 'p:' + e.pointerId, e.timeStamp); else act(a, true, e.timeStamp);
    e.preventDefault();
  }
  function onPointerUp(e) {
    if (e.pointerId === armedPointer) { armedPointer = -1; if (e.type === 'pointerup' && !paused && mode !== 'run') anyKey(); return; }
    const a = pointers.get(e.pointerId);
    if (a) { pointers.delete(e.pointerId); if (a === 'left' || a === 'right') dirInput(a, false, 'p:' + e.pointerId, e.timeStamp); }
  }
  const padPrev = {};
  const PAD = { 14: 'left', 4: 'left', 15: 'right', 5: 'right', 0: 'breach', 2: 'breach', 3: 'flip', 12: 'flip' };
  let padOk = true;
  // One button or stick direction changed state. `a` is its action, if it has one.
  function padEdge(key, down, a) {
    if (down === !!padPrev[key]) return;
    padPrev[key] = down; device = 'gamepad';
    if (down && paused) { togglePause(); return; }
    // outside a run ANY button starts one; a direction that started it is already held in it
    if (mode !== 'run' && (!down || !anyKey() || (a !== 'left' && a !== 'right'))) return;
    if (a === 'left' || a === 'right') dirInput(a, down, 'g:' + key, performance.now());
    else if (a && down) act(a, true, performance.now());
  }
  function pollGamepad() {
    if (!padOk || !navigator.getGamepads) return;
    let pads;
    // inside a sandboxed frame the Gamepad API can be forbidden by permissions policy and THROW: ask once, then never again
    try { pads = navigator.getGamepads(); } catch (e) { padOk = false; return; }
    if (!pads) return;
    for (const pad of pads) {
      if (!pad || !pad.buttons) continue;
      const id = pad.index + ':';
      for (let idx = 0; idx < pad.buttons.length; idx++) {
        const b = pad.buttons[idx], down = !!(b && (b.pressed || b.value > 0.5));
        if (idx === 9) {
          // Start: pause in a run, start one anywhere else
          if (down !== !!padPrev[id + 9]) { padPrev[id + 9] = down; device = 'gamepad'; if (down) { if (mode === 'run') togglePause(); else anyKey(); } }
        } else if (idx === 8) {
          // Back / Select: comfort mode
          if (down !== !!padPrev[id + 8]) { padPrev[id + 8] = down; device = 'gamepad'; if (down) toggleComfort(); }
        } else if (idx === 1) {
          // B: back to the main menu from the pause screen or after a run; nothing in a run or on the menu
          if (down !== !!padPrev[id + 1]) { padPrev[id + 1] = down; device = 'gamepad'; if (down && (paused || mode === 'dead' || mode === 'results')) quitToMenu(); }
        } else padEdge(id + idx, down, PAD[idx]);
      }
      // left stick, with hysteresis so a worn stick does not chatter
      const ax = (pad.axes && pad.axes[0]) || 0, ay = (pad.axes && pad.axes[1]) || 0;
      padEdge(id + 'axL', padPrev[id + 'axL'] ? ax < -0.35 : ax < -0.55, 'left');
      padEdge(id + 'axR', padPrev[id + 'axR'] ? ax > 0.35 : ax > 0.55, 'right');
      padEdge(id + 'axU', padPrev[id + 'axU'] ? ay < -0.4 : ay < -0.7, 'flip');
    }
  }
  function onPadGone(e) {
    const id = e.gamepad.index + ':';
    for (const k in padPrev) if (k.startsWith(id)) padPrev[k] = false;
    dropSources('g:' + id);
  }

  // ---- simulation events -> sound, hit-stop, cosmetic state
  let scheduledHitId = -1;
  function onSimEvent(e) {
    switch (e.type) {
      case 'roll':
        if (e.air) flipDelta += e.dir * LANE_ANGLE;
        else { rollFrom = rollAngle; rollTarget += e.dir * LANE_ANGLE; rollAnimT = 0; }
        if (!attract) play('roll', { lane: e.lane, dir: e.dir, pan: e.dir * 0.3, vol: 1 + 0.15 * (sim.gear - 1) });   // the small sounds rise with the gear: the mix they sit in does
        break;
      case 'rollRefused': if (!attract) play('rollRefused', { dir: e.dir, pan: e.dir * 0.4 }); break;
      case 'flip': flipping = true; flipFromAngle = rollTarget; flipDelta = Math.PI; if (!attract) play('flip', {}); break;
      case 'land':
        flipping = false; rollTarget = flipFromAngle + flipDelta; rollAngle = rollTarget; rollAnimT = 1;
        if (!attract) play('land', {});
        break;
      case 'breach': if (!attract) play('ram', {}); break;
      case 'breachHit': {
        visFreeze = e.grade === 'perfect' ? 0.085 : 0.06;
        if (e.kind === 'gate' || e.kind === 'shutter') visFreeze = 0.11;
        if (!attract && !e.presounded) play('breachHit', { grade: e.grade, kind: e.kind, chain: e.chain, gear: sim.gear, chord: music ? music.chordAt(sim.beat) : 0 });
        if (audio && !attract) audio.duck(0.35, 0.005, 0.22);
        break;
      }
      case 'whiff': if (!attract) play('whiff', {}); break;
      case 'irisPass': if (!attract) { play('flyby', { side: 0, kind: 'iris', vol: 2 }); if (e.clean) play('thread', {}); } break;
      case 'graze': if (!attract) play('graze', { side: e.side, pan: e.side * 0.8, vol: 1 + 0.25 * (sim.gear - 1) }); break;
      case 'thread': if (!attract) play('thread', {}); break;
      case 'flyby': if (!attract) play('flyby', { side: e.side, kind: e.kind, pan: e.side * 0.7, vol: 1 + 0.25 * (sim.gear - 1) }); break;
      case 'orb': if (!attract) play('orb', { n: e.n }); break;
      case 'spark': if (!attract) play('spark', { n: e.n }); break;
      case 'gearUp': if (!attract && Math.abs(sim.beat - DROP_BEAT) > 0.2) play('gearUp', { gear: e.gear }); break;   // at THE DROP the drop itself is the fanfare
      case 'gearDown': if (!attract) play('gearDown', { gear: e.gear }); break;
      case 'crash':
        visFreeze = 0.11;
        if (!attract) { play('crash', {}); if (music) music.tapeStop(audio.now, 0.32); }
        break;
      case 'stumble': visFreeze = 0.05; if (!attract) play('stumble', {}); break;
      case 'launch': if (!attract && creepRun && !launchSounded) play('launch', {}); break;
      case 'drop':
        mouthDist = sim.dist - (sim.t - T_DROP) * sim.speed;   // from here on the mouth is a fixed place behind us
        if (!attract && !dropSounded) play('drop', {});
        break;
      case 'novaIgnite': if (!attract) play('novaIgnite', audio ? { when: audio.now + 0.18 } : {}); break;
      case 'sectorGate': break;   // the gate's own breachHit (kind 'gate') is the sound of this moment
      case 'sector': if (!attract && mode === 'run' && e.sector >= 2) play('sector', audio ? { when: audio.now + 0.3 } : {}); break;
      case 'leadLow': if (!attract) play('leadLow', { level: e.level }); break;
      case 'leadSafe': if (!attract) play('leadSafe', {}); break;
      case 'death': onDeath(); break;
    }
  }
  let dropSounded = false, launchSounded = false;
  function onDeath() {
    if (attract) return;
    mode = 'dead'; stateT = 0;
    if (music) music.stop();
    play('death', {});
    if (sfx) { sfx.loop('grind', 0); sfx.loop('wind', 0); sfx.loop('haze', 0); }
    clockAudio = false;        // the song is over: drift on a virtual clock
    const score = Math.floor(sim.score);
    newBest = score > best.score;
    frame.bestScore = best.score; frame.bestDist = best.dist;
    if (newBest) best.score = score;
    if (sim.dist > best.dist) best.dist = sim.dist;
    if (sim.sector > best.sector) best.sector = sim.sector;
    saveBest();
  }

  // Sounds that must land exactly on a beat are scheduled ahead on the audio clock.
  function presound() {
    if (!audio || !sfx || attract || !clockAudio) return;
    // THE DROP, and the launch out of the barrel on beat 4 (its thump needs to be scheduled ahead to land on the beat)
    if (!dropSounded && sim.t > T_DROP - 0.2 && sim.t < T_DROP) { dropSounded = true; play('drop', { when: songToAudio(T_DROP) }); }
    if (creepRun && !launchSounded && sim.t > CREEP_UNTIL - 0.3 && sim.t < CREEP_UNTIL - 0.14) { launchSounded = true; play('launch', { when: songToAudio(CREEP_UNTIL) }); }
    // a breach pressed early: the wall WILL break when it arrives, so its hit can be sample-accurate
    if (sim.ramT0 >= 0) {
      for (let i = 0; i < sim.hazards.length; i++) {
        const h = sim.hazards[i];
        if (h.state !== H_COMING || h.t0 < sim.t) continue;
        if (h.t0 > sim.ramUntil) break;
        if ((h.kind === KIND.WALL || h.kind === KIND.GATE || h.kind === KIND.SHUTTER) && h.id !== scheduledHitId) {
          scheduledHitId = h.id; h.presounded = true;
          const grade = h.t0 - sim.ramT0 <= (h.window ? 0.09 : RAM_PERFECT) ? 'perfect' : 'good';
          play('breachHit', { when: songToAudio(h.t0), grade, kind: h.kind === KIND.WALL ? 'wall' : h.kind === KIND.GATE ? 'gate' : 'shutter', chain: sim.chain + (grade === 'perfect' ? 1 : 0), gear: sim.gear, chord: music.chordAt(timeToBeat(h.t0)) });
        }
      }
    }
  }

  let flagsSentAt = -1;
  function sendBarFlags() {
    if (!music || attract) return;
    const bar = Math.floor(sim.beat / 4);
    if (sim.level.resolvedCount === flagsSentAt) return;
    flagsSentAt = sim.level.resolvedCount;
    const flags = sim.level.barFlags;
    for (const b in flags) if (+b >= bar) music.setBarFlags(+b, flags[b]);
  }

  // ---- stepping
  function stepSim(untilT) {
    let guard = 0;
    while (sim.t + STEP <= untilT && guard++ < 40) {
      const stepEnd = sim.t + STEP;
      while (inputQ.length && inputQ[0].t <= stepEnd) { const q = inputQ.shift(); if (q.down) sim.press(q.a); else sim.release(q.a); }
      if (bot) bot.update(STEP);
      sim.step(STEP);
      if (sim.events.length) {
        const n0 = events.length;
        sim.drain(events);
        for (let i = n0; i < events.length; i++) {
          const e = events[i];
          if (e.type === 'breachHit' && scheduledHitId >= 0) {
            // was this hit already sounded ahead of time?
            for (let j = 0; j < sim.hazards.length; j++) { const h = sim.hazards[j]; if (h.presounded && h.hitT === sim.t) { e.presounded = true; h.presounded = false; } }
          }
          onSimEvent(e);
        }
      }
    }
    if (guard >= 40) songT = sim.t;   // fell far behind (tab was asleep): do not fast-forward the world
    presound();
    sendBarFlags();
  }

  function advance(realDt) {
    stateT += realDt;
    frame.time += realDt; frame.dt = realDt;
    pollGamepad();
    if (paused) {
      // a resume that was still in flight when the pause came would leave the song running behind the pause screen
      if (audio && audio.running) audio.suspend();
    } else {
      if (clockAudio && audio) {
        if (audio.running) {
          audioStall = 0; stallTries = 0;
          const tA = audioNowOutput() - runAudioT0 + runSongT0;
          // never run backwards, never leap: follow the audio clock, clamp to a sane step
          if (tA > songT) songT = Math.min(tA, songT + 0.1);
        } else {
          // waiting for the context to come up (a first start, or back from a pause): keep asking, then
          // give up and play on silently; the song is brought back in step if the context wakes later
          if (stallTries++ % 8 === 0) audio.resume();
          if ((audioStall += realDt) > 0.6) { clockAudio = false; audioLost = true; if (music) { try { music.stop(); } catch (e) { /* optional */ } } }
        }
      } else {
        songT += Math.min(realDt, 0.05);
        if (audioLost && audio && music && mode === 'run' && sim.alive) {
          if (audio.running) relockAudio();
          else if (stallTries++ % 30 === 0) audio.resume();   // keep asking: an interruption can end without any gesture
        }
      }
      // pump the sequencer every frame: the song while running, the ambient bed on title and results
      if (music && audio.running) { try { music.update(); } catch (e) { if (!musicErr) { musicErr = true; console.error('[music.update]', e); } } }
      stepSim(songT);
    }
    // state machine
    if (mode === 'dead' && stateT > 1.5) {
      mode = 'results'; stateT = 0;
      dispatch({ type: 'results' }); play('results', {});
      if (music) { try { music.setAmbient(true); } catch (e) { /* optional */ } }
    }
    else if (mode === 'results' && stateT > 30) startAttract();
    else if (mode === 'title' && (!sim.alive || stateT > 75)) startAttract();
    if (music && !attract && mode === 'run') {
      if (sim.gear !== lastGear) { music.setGear(sim.gear); lastGear = sim.gear; }
    }
    fillFrame(realDt);
    if (music && !attract && mode === 'run') music.setDanger(frame.danger);
    if (sfx && !attract) {
      const on = mode === 'run' && !paused;
      // the grind whine climbs for as long as the fin is held (a ten-beat corkscrew takes it to the top)
      grindLv = on && grindVis ? Math.min(1, grindLv + realDt * 0.15) : 0.3;
      sfx.loop('grind', on && grindVis ? grindLv : 0, { pan: grindVis * 0.5 });
      sfx.loop('wind', on ? 0.25 + 0.75 * clamp01((gearF - 1) / 4) : 0);
      sfx.loop('haze', on && frame.novaOn ? frame.danger : 0);
    }
    // deliver events, update modules
    for (let i = 0; i < events.length; i++) dispatch(events[i]);
    events.length = 0;
    fx.update(realDt);
    for (let i = 0; i < modules.length; i++) guard(i, 'update', realDt, frame);
  }

  function fillFrame(realDt) {
    const f = frame;
    // visual hit-stop: freeze the picture, then catch up at double speed. The song never pauses, and
    // the picture is never more than one hit-stop behind it however many walls arrive in a row.
    if (!paused) {
      if (visFreeze > 0) { const d = Math.min(visFreeze, realDt); visFreeze -= realDt; visOffset = Math.min(0.11, visOffset + d); }
      else if (visOffset > 0) visOffset = Math.max(0, visOffset - realDt);
    }
    const tReal = Math.max(sim.t, Math.min(songT, sim.t + STEP));
    const tv = visT = Math.max(visT, tReal - visOffset);
    f.t = tv; f.beat = timeToBeat(tv); f.beatPhase = f.beat - Math.floor(f.beat);
    f.bar = Math.floor(f.beat / 4); f.barPhase = f.beat / 4 - f.bar; f.bpm = bpmAtBeat(f.beat);
    f.kick = sim.alive && (f.beat >= 4 || !creepRun) ? Math.exp(-f.beatPhase * 5.5) : 0;
    f.mode = mode === 'run' ? (creepRun && f.beat < 4 ? 'ignition' : 'run') : mode;
    f.attract = attract; f.paused = paused;
    f.sector = sim.sector;
    const s0 = sectorStartBeat(sim.sector), s1 = sectorEndBeat(sim.sector);
    f.sectorT = clamp01((f.beat - s0) / (s1 - s0));
    f.dropBeat = DROP_BEAT;
    f.gear = sim.gear;
    gearF = damp(gearF, sim.gear, 7, realDt); f.gearF = gearF;
    f.speed = sim.speed;
    f.dist = visDist = Math.max(visDist, sim.dist + (tReal - sim.t) * sim.speed - visOffset * sim.speed);
    f.flux = sim.flux; f.fluxN = clamp01(sim.flux / GEAR_FLUX[sim.gear]);
    f.lead = sim.lead; f.leadN = sim.lead / LEAD_MAX;
    f.novaOn = sim.novaOn;
    f.danger = sim.novaOn ? clamp01(1 - sim.lead / 150) : 0;
    f.score = Math.floor(sim.score); f.mult = sim.gear; f.chain = sim.chain;
    if (mode === 'run' || mode === 'title') { f.bestScore = best.score; f.bestDist = best.dist; }
    f.newBest = newBest;
    f.lane = sim.lane;
    f.device = device;
    // hazards / conduit geometry are functions of visual time
    view.t = tv; view.speed = sim.speed; view.beatDur = 60 / f.bpm;
    f.conduit = creepRun || sim.startBeat < DROP_BEAT ? (tv < T_DROP ? 1 : 0) : 0;
    f.conduitEndZ = mouthDist !== null ? mouthDist - f.dist : view.zAt(T_DROP);

    // cosmetic roll / flip
    const prevRoll = rollAngle;
    // a flip that ends after death lands without its event
    if (flipping && !sim.air && !sim.alive) { flipping = false; rollTarget = flipFromAngle + flipDelta; rollAngle = rollTarget; rollAnimT = 1; }
    if (sim.air || flipping) {
      const p = clamp01((tReal - sim.flipT0) / sim.flipDur);
      rollAngle = flipFromAngle + flipDelta * ease.inOutCubic(p);
      const rho = APOTHEM * Math.cos(Math.PI * p);
      const a = flipFromAngle + (flipDelta - Math.PI) * p, up = flipFromAngle + flipDelta * p;
      f.runnerX = Math.sin(a) * rho; f.runnerY = -Math.cos(a) * rho;
      f.upX = -Math.sin(up); f.upY = Math.cos(up);
      f.air = p;
    } else {
      if (rollAnimT < 1) { rollAnimT = Math.min(1, rollAnimT + realDt / 0.09); rollAngle = lerp(rollFrom, rollTarget, ease.outBack(rollAnimT)); }
      else rollAngle = rollTarget;
      f.runnerX = Math.sin(rollAngle) * APOTHEM; f.runnerY = -Math.cos(rollAngle) * APOTHEM;
      f.upX = -Math.sin(rollAngle); f.upY = Math.cos(rollAngle);
      f.air = -1;
    }
    f.roll = rollAngle;
    f.rollVel = realDt > 0 ? (rollAngle - prevRoll) / realDt : 0;
    f.ramT = sim.t - sim.lastRamT < 0.4 ? sim.t - sim.lastRamT : -1;
    f.landT = sim.t - sim.lastLandT; f.crashT = sim.t - sim.lastCrashT;
    f.ghost = sim.t < sim.ghostUntil;
    grindVis = sim.grindDir || 0;
    f.grind = grindVis;
    f.dead = !sim.alive; f.deadT = sim.alive ? 0 : sim.deadT;
    const pr = sim.prompt();
    f.prompt = pr ? pr.kind : ''; f.promptDir = pr ? pr.dir : 0;
  }

  function render() {
    gfx.beginFrame();
    setupCamera(cam, frame, vfx.kick);
    if (cam.project(frame.runnerX, frame.runnerY, 0)) { frame.runnerSX = cam.sx; frame.runnerSY = cam.sy; frame.runnerS = cam.s; }
    const W = gfx.W, H = gfx.H;
    gfx.push();
    gfx.translate(W / 2 + fx.camX, H / 2 + fx.camY); gfx.rotate(fx.camRot); gfx.translate(-W / 2, -H / 2);
    guard(0, 'draw', frame);
    // a closed shutter is a door: its backing goes down first, so the world behind it is sealed off
    // while the rails and ribs on our side are drawn over it
    const farZ = hazards.drawDoorBacking(frame, sim, view);
    guard(1, 'drawBack', frame);
    drawTube(gfx, cam, frame, farZ);
    hazards.draw(frame, sim, view, farZ);
    drawStrikeRing(gfx, cam, frame);
    hazards.drawReticle(frame, sim, view);
    guard(2, 'draw', frame);
    guard(1, 'drawWorld', frame);
    gfx.pop();
    guard(1, 'drawScreen', frame);
    guard(3, 'drawWorld', frame);
    gfx.beginOverlay(fx.post);
    guard(3, 'draw', frame);
    gfx.endFrame(fx.post);
  }

  // ---- main loop
  let last = 0, raf = 0, slowFrames = 0, scaleStep = 0, scaleLocked = false;
  let dtAvg = 1 / 60, dtBefore = 0, evalIn = 0;
  const SCALES = [1, 0.75, 0.55];
  const cpu = { sim: 0, draw: 0, worst: 0 };
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!last) { last = now; return; }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (manual) return;
    const c0 = performance.now();
    advance(dt);
    const c1 = performance.now();
    render();
    const c2 = performance.now();
    // main-thread cost of a frame, smoothed (read by tools/scripts/perf.mjs)
    cpu.sim += (c1 - c0 - cpu.sim) * 0.05; cpu.draw += (c2 - c1 - cpu.draw) * 0.05; if (c2 - c0 > cpu.worst) cpu.worst = c2 - c0;
    // dynamic resolution: if the machine cannot hold ~50 fps, render fewer pixels, then CHECK that it
    // helped. If frames are no faster, the rate is capped by the display or a power mode (30 Hz), not
    // by fill rate: step back up and stop adapting.
    dtAvg += (dt - dtAvg) * 0.05;
    if (dt > 0.024) slowFrames++; else slowFrames = Math.max(0, slowFrames - 2);
    if (evalIn > 0) {
      if (--evalIn === 0 && dtAvg > dtBefore * 0.92) { scaleStep--; scaleLocked = true; gfx.setRenderScale(SCALES[scaleStep]); }
    } else if (!scaleLocked && scaleStep < 2 && slowFrames > 90) {
      dtBefore = dtAvg; scaleStep++; slowFrames = 0; evalIn = 75; gfx.setRenderScale(SCALES[scaleStep]);
    }
  }

  const game = {
    frame, gfx, fx, cam,
    get sim() { return sim; },
    get mode() { return mode; },
    get audio() { return audio; },     // for tools/capture_audio.mjs
    cpu,
    // context time at which this run's song time `songT0` sounds (for tools/make_video.mjs to line audio up)
    get audioT0() { return runAudioT0; },
    get songT0() { return runSongT0; },
    start() {
      addEventListener('keydown', onKeyDown);
      addEventListener('keyup', onKeyUp);
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      addEventListener('gamepaddisconnected', onPadGone);
      // Browsers only let audio start from certain gestures (a key going down, a mouse button, the END of
      // a touch), and never from a gamepad. Whatever started the run, the next such gesture wakes the
      // context, and advance() brings the song back in step with the game.
      const unlock = () => { if (audio && !paused) audio.resume(); };
      for (const type of ['keydown', 'pointerup', 'touchend', 'click']) addEventListener(type, unlock, true);
      canvas.addEventListener('webglcontextlost', () => { if (mode === 'run' && !paused && sim.alive && !bot) togglePause(); });
      addEventListener('blur', () => {
        holders.left.clear(); holders.right.clear(); pointers.clear(); armedPointer = -1;
        if (sim) sim.releaseAll();
        if (mode === 'run' && !paused && !manual && sim.alive && !bot) togglePause();
      });
      // build the audio graph now, while the title is up, so the first key press does not have to
      // (it stays suspended until that press)
      ensureAudio();
      document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'run' && !paused && sim.alive && !bot) togglePause(); last = 0; });
      startAttract();
      if (manual) {
        // deterministic capture: ?manual=1[&run=1][&quick=1][&bot=1&skill=0.95][&seed=7]
        if (P.has('run') || P.has('bot')) startRun(P.has('quick'));
        advance(1e-4); render();
      }
      raf = requestAnimationFrame(tick);
    },
    // Deterministic capture API used by tools/shots.mjs: advance to `t` seconds after start and render.
    seek(t) {
      const t0 = seekBase === null ? (seekBase = sim.t) : seekBase;
      let guard = 0;
      while (sim.t < t0 + t - 1e-6 && guard++ < 200000) advance(Math.min(1 / 60, Math.max(1e-4, t0 + t - sim.t)));
      render();
      return true;
    },
    // Advance by real seconds regardless of song time (for the dead/results screens).
    wait(seconds) { for (let i = 0; i < Math.ceil(seconds * 60); i++) advance(1 / 60); render(); return true; },
    press(a) { if (sim) sim.press(a); },
    release(a) { if (sim) sim.release(a); },
    startRun, startAttract,
  };
  let seekBase = null;
  return game;
}
