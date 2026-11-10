// game/hud.js — everything typographic and diegetic-UI in BLUESHIFT: the three-piece run HUD
// (gear + flux ring, score, the lead arc under the runner), the wordless key prompts, stamps and
// banners, the title screen, the results screen and the pause screen.
//   hud.drawWorld(frame)  bloomed, screen space: logo, lead arc, GEAR stamp, shards
//   hud.draw(frame)       crisp overlay: everything else
// Reads `frame`, never writes it. Never calls fx.* (vfx owns screen effects). No per-frame
// allocation: numbers are drawn digit by digit, strings are only built when an event fires.
import { C, LEAD_MAX, sectorName } from './config.js';
import { gearColor } from './tube.js';
import { clamp, clamp01, lerp, damp, approach, ease, smoothstep, mixColor, makeRng, hash1, hex } from '../engine/math.js';
import { txt, txtW, num, numW, digitStr, arrowKey, spaceKey, letterKey, keycap, tapIcon, dpad, padButton, chamferRect, arrow, createShards, BLACK, INK } from './hud_kit.js';
import { drawLogo, logoColor, dopplerColor, LOGO_W } from './hud_logo.js';

const MARGIN = 28;
const WHITE = C.white, CYAN = C.you, ICE = C.ice, GOLD = C.nova1, ORANGE = C.nova0, MAGENTA = C.solid;
const DIM = hex('#a79be0');            // quiet label ink
const PALE = hex('#dfe9ff');           // body text
const RED = [1, 0.05, 0.16], BLUE = [0.08, 0.36, 1];
const SLOT = [0.004, 0.0015, 0.011];   // the burned results slot: almost black, a breath of violet   // the two ghosts of an RGB split
const GEAR_STR = ['', 'GEAR 1', 'GEAR 2', 'GEAR 3', 'GEAR 4', 'GEAR 5'];
const MULT_STR = ['', '×1', '×2', '×3', '×4', '×5'];
const LOST_STR = ['', '-1 GEAR', '-2 GEARS'];
const SECTOR_STR = [];
for (let i = 0; i < 100; i++) SECTOR_STR.push('SECTOR ' + (i < 10 ? '0' : '') + i);

// The gear ring is an octagon (the tube, seen end-on). Unit path starting at the middle of the
// top edge and running clockwise: 9 pieces (two half edges and seven whole ones).
const OCT = new Float32Array(20);
const OCT_EDGE = 2 * Math.tan(Math.PI / 8), OCT_TOTAL = OCT_EDGE * 8;
OCT[0] = 0; OCT[1] = -1; OCT[18] = 0; OCT[19] = -1;
for (let i = 0; i < 8; i++) {
  const a = (-67.5 + 45 * i) * Math.PI / 180, r = 1 / Math.cos(Math.PI / 8);
  OCT[2 + i * 2] = Math.cos(a) * r; OCT[3 + i * 2] = Math.sin(a) * r;
}
const TICKS = 5;
const RING_Y = 28 + 48, RING_R = 39;

export function createHud(gfx) {
  const rng = makeRng(0xb1e5);
  const shards = createShards(640, rng);
  const colG = [0, 0, 0], colA = [0, 0, 0], colB = [0, 0, 0];
  const tickVal = new Float32Array(TICKS), tickAge = new Float32Array(TICKS), tickHot = new Uint8Array(TICKS), tickRow = new Uint8Array(TICKS);
  let tickNext = 0;

  const S = {
    t: 0, init: false, prevMode: '', sinceStart: 9,
    hudVis: 0, titleVis: 0, pauseVis: 0,
    // gear ring
    ringS: 1, ringV: 0, ringFlash: 0, crack: 0, crackSeed: 1, echoT: -1, fluxShown: 0,
    // score
    scoreShown: 0, scorePunch: 0,
    // lead arc
    arcIn: 0, ax: 640, ay: 520, as: 60, anchored: false, leadPrev: 220, trend: 0, wasLow: false, lowVis: 0, alarm: 0, relax: 0, introT: 9, lossT: 9,
    // prompts
    pCur: '', pVis: 0, pDir: 1, pMute: false,   // pMute: the wall this breach prompt was for has broken
    // stamps (stDelay: the GEAR stamp waits for a flying judgement; hitAge: seconds since the player's last breach hit)
    stT: -1, stGear: 2, stDelay: 0, hitAge: 9, bnT: -1, bnA: '', bnB: '', crT: -1, crLost: 0,
    // comfort toast, touch pause glyph
    cfT: -1, cfOn: false, pzVis: 0,
    // title
    shatterT: -1,
    // results
    deadSeen: false, deadClock: 0, resT: -1, resShattered: false,
    resDist: 0, resDistM: 0, resScore: 0, resSecA: '', resSecB: '', best0Score: 0, best0Dist: 0, newBestScore: false, newBestDist: false,
  };

  // ------------------------------------------------------------------ helpers
  const pressLabel = (device) => (device === 'touch' ? 'TAP TO START' : device === 'gamepad' ? 'PRESS ANY BUTTON' : 'PRESS ANY KEY');

  function captureDeath(f) {
    S.deadSeen = true; S.deadClock = 0; S.resT = f.mode === 'results' ? 0 : -1; S.resShattered = false;
    S.resDistM = f.dist; S.resDist = Math.floor(f.dist / 10); S.resScore = Math.floor(f.score);
    const sec = Math.max(1, f.sector | 0);
    S.resSecA = SECTOR_STR[Math.min(99, sec)]; S.resSecB = sectorName(sec);
    // frame.bestScore / bestDist hold the best from BEFORE this run while dead, so a record can be shown
    S.best0Score = f.bestScore || 0; S.best0Dist = f.bestDist || 0;
    S.newBestScore = S.resScore > S.best0Score; S.newBestDist = f.dist > S.best0Dist;
  }

  function addTick(v, hot) {
    const i = tickNext; tickNext = (tickNext + 1) % TICKS;
    let row = 0;
    for (let j = 0; j < TICKS; j++) if (j !== i && tickAge[j] < 0.5) row = Math.max(row, tickRow[j] + 1);
    tickVal[i] = v; tickAge[i] = 0; tickHot[i] = hot ? 1 : 0; tickRow[i] = row % 3;
    S.scorePunch = 1;
  }

  // Title layout, shared by the bloomed and the crisp pass.
  let LW = 900, LU = 20, LY = 226;
  function layoutTitle(W) { LW = clamp(W * 0.78, 740, 1120); LU = LW / LOGO_W; LY = 212; }

  function shatterTitle(f) {
    const W = gfx.W;
    layoutTitle(W);
    S.shatterT = 0;
    shards.clear();
    shards.origin(W * 0.5, LY + 40, 3.0, 24, 0.36, 0.54);
    drawLogo(shards.rec, W * 0.5, LY, LW, 0, 0, 1.7, true);
    // glass: slivers seeded inside the word
    for (let i = 0; i < 54; i++) {
      const t = rng();
      logoColor(t, 0.4, colA);
      shards.glass(W * 0.5 + (t - 0.5) * LW, LY + (rng() - 0.5) * LU * 6.4, 9 + rng() * 22, colA, 1.5);
    }
    // the small print goes with it
    shards.origin(W * 0.5, LY + 40, 2.2, 40, 0.26, 0.42);
    txt(shards.rec, 'OUTRUN THE NOVA', W * 0.5, LY + LU * 3 + 58, 17, PALE, 1.1, 0.5, 5, 0.1);
    txt(shards.rec, pressLabel(f.device), W * 0.5, 646, 19, WHITE, 1.2, 0.5, 3, 0.1);
  }

  function shatterResults() {
    S.resShattered = true;
    const W = gfx.W, size = 148 * (W < 1100 ? 0.86 : 1), kmSize = size * 0.36;
    const wN = numW(S.resDist, size, false, 2), wK = txtW('KM', kmSize, 1), gap = size * 0.2;
    const xr = W * 0.5 - (wN + gap + wK) * 0.5 + wN;
    shards.clear();
    shards.origin(W * 0.5, 310, 2.8, 30, 0.32, 0.5);
    num(shards.rec, S.resDist, xr, 300, size, GOLD, 1.6, false, 2, 0.078);
    txt(shards.rec, 'KM', xr + gap, 300 + size * 0.5 - kmSize * 0.5, kmSize, GOLD, 1.4, 0, 1, 0.11);
  }

  function beginRun(f) {
    S.sinceStart = 0;
    S.deadSeen = false; S.resT = -1;
    S.stT = -1; S.stDelay = 0; S.hitAge = 9; S.bnT = -1; S.crT = -1; S.echoT = -1;
    S.ringS = 1; S.ringV = 0; S.ringFlash = 0; S.crack = 0;
    S.scoreShown = 0; S.scorePunch = 0;
    for (let i = 0; i < TICKS; i++) tickAge[i] = 9;
    S.arcIn = 0; S.wasLow = false; S.lowVis = 0; S.alarm = 0; S.relax = 0; S.introT = 9; S.lossT = 9;
    S.leadPrev = f.lead; S.trend = 0;
    S.pVis = 0; S.pCur = ''; S.pMute = false;
  }

  // ------------------------------------------------------------------ events
  // The player's own hit on ICE (a breachHit that is not auto, or a breachCredit). The key prompt
  // goes at once (its wall is gone), and a GEAR stamp that would land in the flying judgement waits.
  function ownHit(ev) {
    if (S.pCur === 'breach') { S.pVis = 0; S.pMute = true; }
    S.hitAge = 0;
    if (S.stT >= 0 && S.stT < 0.34) { S.stT = -1; S.stDelay = 0.34; }   // a press just after the gear-up
    scoreTick(ev, true);
  }
  // Ticks show the points the simulation actually added (ev.pts), never a guess.
  function scoreTick(ev, hot) { if (!ev.auto && ev.pts > 0) addTick(ev.pts, hot); }

  function onEvent(ev, frame) {
    if (ev.type === 'comfort') { S.cfT = 0; S.cfOn = !!ev.on; return; }   // also on the title, behind the bot
    // the bot's run behind the title fires the same events as a real one: none of it is HUD business
    if (frame.attract && ev.type !== 'title') return;
    switch (ev.type) {
      case 'start':
        if (S.titleVis > 0.2 && S.shatterT < 0) shatterTitle(frame);
        else if (S.deadSeen && !S.resShattered) shatterResults();
        beginRun(frame);
        break;
      case 'title': S.shatterT = -1; S.deadSeen = false; S.resT = -1; break;
      case 'gearUp':
        if (S.hitAge < 0.05) { S.stT = -1; S.stDelay = 0.34; } else { S.stT = 0; S.stDelay = 0; }
        S.stGear = clamp(ev.gear | 0, 1, 5);
        S.ringV += 9; S.ringFlash = 1; S.echoT = 0; S.crack = 0;
        break;
      case 'gearDown': S.crack = 1; S.crackSeed = (S.crackSeed + 7) | 0; S.ringV -= 5; S.stT = -1; S.stDelay = 0; break;
      case 'crash': S.crT = 0; S.crLost = clamp(ev.gearLost | 0, 0, 2); S.lossT = 0; break;
      case 'sector':
        if (ev.sector >= 1) { S.bnT = 0; S.bnA = SECTOR_STR[Math.min(99, ev.sector | 0)]; S.bnB = sectorName(ev.sector | 0); }
        break;
      case 'drop': S.arcIn = 0; S.introT = 0; break;
      case 'breachHit':
        // a shutter that broke itself: no points, no judgement, but its prompt is over all the same
        if (ev.auto) { if (S.pCur === 'breach') { S.pVis = 0; S.pMute = true; } } else ownHit(ev);
        break;
      case 'breachCredit': ownHit(ev); break;
      case 'thread': scoreTick(ev, false); break;
      case 'irisPass': scoreTick(ev, false); break;
      case 'sectorGate': scoreTick(ev, true); break;
      case 'death': if (!S.deadSeen && !frame.attract && frame.mode !== 'title') captureDeath(frame); break;
      case 'results': if (S.deadSeen && S.resT < 0) S.resT = 0; break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ update
  function update(dt, f) {
    S.t += dt; S.sinceStart += dt;
    if (!S.init) {
      S.init = true; S.prevMode = f.mode;
      S.scoreShown = f.score; S.leadPrev = f.lead; S.fluxShown = f.fluxN;
      for (let i = 0; i < TICKS; i++) tickAge[i] = 9;
    }
    if (f.mode !== S.prevMode) {
      if (S.prevMode === 'title' && S.shatterT < 0 && S.titleVis > 0.2) shatterTitle(f);
      if (f.mode === 'results' && S.deadSeen && S.resT < 0) S.resT = 0;
      if (f.mode === 'title') { S.shatterT = -1; S.deadSeen = false; S.resT = -1; }
      // a run began without a 'start' event reaching us: do what the event would have done
      if ((f.mode === 'ignition' || f.mode === 'run') && S.sinceStart > 0.5) {
        if (S.deadSeen && !S.resShattered) shatterResults();
        beginRun(f);
      }
      S.prevMode = f.mode;
    }
    if (f.dead && !S.deadSeen && S.sinceStart > 0.25 && !f.attract && f.mode !== 'title') captureDeath(f);   // the bot dying behind the title is not a result
    if (S.deadSeen) { S.deadClock += dt; if (S.resT >= 0) S.resT += dt; }
    if (S.shatterT >= 0) S.shatterT += dt;

    const run = (f.mode === 'run' || (f.mode === 'ignition' && f.beat > 2.5)) && !f.dead && !S.deadSeen;
    S.hudVis = damp(S.hudVis, run ? 1 : 0, run ? 6 : 16, dt);
    const title = f.mode === 'title' && S.shatterT < 0;
    S.titleVis = title ? damp(S.titleVis, 1, 5, dt) : approach(S.titleVis, 0, dt / 0.1);
    S.pauseVis = approach(S.pauseVis, f.paused ? 1 : 0, dt / 0.12);

    // gear ring: a spring for the overshoot, timers for flash / crack / echo
    S.ringV += (-420 * (S.ringS - 1) - 15 * S.ringV) * dt; S.ringS += S.ringV * dt;
    S.ringFlash = Math.max(0, S.ringFlash - dt / 0.5);
    S.crack = Math.max(0, S.crack - dt / 0.75);
    if (S.echoT >= 0) { S.echoT += dt; if (S.echoT > 0.5) S.echoT = -1; }
    S.fluxShown = damp(S.fluxShown, f.fluxN, f.fluxN < S.fluxShown ? 9 : 14, dt);

    // score rolls toward the truth
    if (f.score < S.scoreShown) S.scoreShown = f.score;
    S.scoreShown = damp(S.scoreShown, f.score, 9, dt);
    if (f.score - S.scoreShown < 0.6) S.scoreShown = f.score;
    S.scorePunch = Math.max(0, S.scorePunch - dt / 0.28);
    for (let i = 0; i < TICKS; i++) tickAge[i] += dt;

    // lead arc: anchored to the ground under the runner (it holds still while the runner flips)
    const arcOn = run && f.novaOn && f.conduit < 0.5;
    S.arcIn = approach(S.arcIn, arcOn ? 1 : 0, dt / (arcOn ? 0.6 : 0.2));
    S.trend = damp(S.trend, clamp((f.lead - S.leadPrev) / Math.max(dt, 1e-4), -40, 40), 2.5, dt);
    S.leadPrev = f.lead;
    const low = arcOn && f.lead < 80;
    if (low && !S.wasLow) S.alarm = 1;
    if (!low && S.wasLow && arcOn) S.relax = 1;
    S.wasLow = low;
    S.lowVis = approach(S.lowVis, low ? 1 : 0, dt / 0.15);
    S.alarm = Math.max(0, S.alarm - dt / 0.5); S.relax = Math.max(0, S.relax - dt / 0.9);
    S.introT += dt; S.lossT += dt;

    // prompts
    const want0 = (f.mode === 'run' || f.mode === 'ignition') && !f.dead ? f.prompt : '';
    if (want0 !== 'breach') S.pMute = false;   // the latch clears itself in the gap before the next breach prompt
    const want = S.pMute ? '' : want0;
    if (want) {
      if (want !== S.pCur) { S.pCur = want; S.pVis = Math.min(S.pVis, 0.2); }
      if (f.promptDir) S.pDir = f.promptDir;
      S.pVis = approach(S.pVis, 1, dt / 0.14);
    } else S.pVis = approach(S.pVis, 0, dt / 0.16);

    S.hitAge += dt;
    if (S.stDelay > 0) { S.stDelay -= dt; if (S.stDelay <= 0) S.stT = 0; }
    if (S.stT >= 0) { S.stT += dt; if (S.stT > 0.86) S.stT = -1; }
    if (S.bnT >= 0 && S.stT < 0 && S.stDelay <= 0) { S.bnT += dt; if (S.bnT > 2.05) S.bnT = -1; }   // the banner waits for a GEAR stamp to clear
    if (S.crT >= 0) { S.crT += dt; if (S.crT > 0.95) S.crT = -1; }
    if (S.cfT >= 0) { S.cfT += dt; if (S.cfT > 1.1) S.cfT = -1; }
    const pz = f.device === 'touch' && (f.mode === 'run' || f.mode === 'ignition') && !f.dead && !S.deadSeen;
    S.pzVis = approach(S.pzVis, pz ? 1 : 0, dt / 0.25);
    shards.update(dt);
  }

  // ------------------------------------------------------------------ gear + flux ring
  function octPiece(cx, cy, R, i, t0, t1, lw, col, k, glow, crack, seed) {
    let x0 = OCT[i * 2], y0 = OCT[i * 2 + 1], x1 = OCT[i * 2 + 2], y1 = OCT[i * 2 + 3];
    const dx = x1 - x0, dy = y1 - y0;
    const ax = x0 + dx * t0, ay = y0 + dy * t0, bx = x0 + dx * t1, by = y0 + dy * t1;
    let ox = 0, oy = 0, ra = 0, rb = 0;
    if (crack > 0) {
      // each side jumps outward along its own normal and tilts: the ring breaks into eight pieces
      const d = crack * crack * (0.18 + hash1(seed + i * 31) * 0.55);
      ox = (x0 + x1) * 0.5 * d; oy = (y0 + y1) * 0.5 * d + crack * crack * 0.12;
      ra = (hash1(seed + i * 17 + 5) - 0.5) * crack * 0.5; rb = (hash1(seed + i * 13 + 9) - 0.5) * crack * 0.5;
    }
    gfx.line(cx + (ax + ox + ax * ra) * R, cy + (ay + oy + ay * ra) * R, cx + (bx + ox + bx * rb) * R, cy + (by + oy + by * rb) * R, lw, col, k, glow);
  }
  // Draws the stretch of the octagon between perimeter fractions f0..f1.
  function oct(cx, cy, R, f0, f1, lw, col, k, glow, crack, seed) {
    let acc = 0;
    for (let i = 0; i < 9; i++) {
      const len = (i === 0 || i === 8 ? OCT_EDGE * 0.5 : OCT_EDGE) / OCT_TOTAL;
      const a = acc, b = acc + len; acc = b;
      if (b <= f0 || a >= f1) continue;
      octPiece(cx, cy, R, i, Math.max(0, (f0 - a) / len), Math.min(1, (f1 - a) / len), lw, col, k, glow, crack, seed);
    }
  }
  let PX = 0, PY = 0;
  function octPoint(f) {
    let acc = 0;
    f = clamp01(f);
    for (let i = 0; i < 9; i++) {
      const len = (i === 0 || i === 8 ? OCT_EDGE * 0.5 : OCT_EDGE) / OCT_TOTAL;
      if (f <= acc + len || i === 8) {
        const t = clamp01((f - acc) / len);
        PX = lerp(OCT[i * 2], OCT[i * 2 + 2], t); PY = lerp(OCT[i * 2 + 1], OCT[i * 2 + 3], t);
        return;
      }
      acc += len;
    }
  }

  function drawGear(f, W) {
    const cx = W * 0.5, cy = RING_Y, R = RING_R * S.ringS;
    const gear = clamp(f.gear | 0, 1, 5);
    gearColor(f.gearF, colG);
    mixColor(colG, WHITE, 0.28, colA);                     // ring ink: the gear colour, lifted so violet still reads
    const crack = S.crack, flash = S.ringFlash;
    if (crack > 0) mixColor(colA, MAGENTA, Math.min(1, crack * 1.4), colA);
    // a soft dark seat so the ring reads over a bright city
    gfx.glow(cx, cy + 6, 104, BLACK, 1, 1.6, 0.8);
    // track
    oct(cx, cy, R, 0, 1, 2, colA, 0.34 + flash * 0.5, 3, crack, S.crackSeed);
    // flux fill, clockwise from the top
    const fl = clamp01(S.fluxShown);
    if (fl > 0.004) {
      oct(cx, cy, R, 0, fl, 5, colA, 1.25 + f.kick * 0.25, 3.6, crack, S.crackSeed);
      octPoint(fl);
      mixColor(colA, WHITE, 0.6, colB);
      gfx.glow(cx + PX * R, cy + PY * R, 13, colB, 0.9, 2);
      gfx.disc(cx + PX * R, cy + PY * R, 3.2, colB, 1.5, 0);
    }
    // gear up: the whole ring fires white and an echo runs off it
    if (flash > 0) {
      mixColor(colA, WHITE, 0.7, colB);
      oct(cx, cy, R, 0, 1, 2.5 + flash * 2.5, colB, flash * flash * 1.5, 4, 0, 0);
    }
    if (S.echoT >= 0) {
      const e = S.echoT / 0.5;
      oct(cx, cy, RING_R * (1 + ease.outCubic(e) * 1.1), 0, 1, 2, colA, (1 - e) * (1 - e) * 1.3, 4, 0, 0);
    }
    // numeral
    mixColor(colG, WHITE, 0.62, colB);
    if (crack > 0) mixColor(colB, MAGENTA, crack * 0.8, colB);
    const jx = crack > 0 ? (hash1(Math.floor(S.t * 50)) - 0.5) * 7 * crack : 0;
    txt(gfx, digitStr(gear), cx + jx, cy + 0.5, 37 * S.ringS, colB, 1.15 + flash * 1.2, 0.5, 0, 0.115, 3);
    // multiplier
    txt(gfx, MULT_STR[gear], cx, cy + RING_R + 22, 13, colA, 1.0 + flash, 0.5, 1, 0.12, 3);
  }

  // ------------------------------------------------------------------ score
  function drawScore(f, W) {
    const xr = W - MARGIN, y = MARGIN + 15;
    gfx.glowEllipse(xr - 90, y + 16, 210, 78, BLACK, 1, 1.5, 0.72);
    const p = S.scorePunch, size = 27 * (1 + p * p * 0.1);
    mixColor(PALE, WHITE, p, colA);
    num(gfx, Math.round(S.scoreShown), xr, y, size, colA, 1.12 + p * 0.5, true, 0, 0.09, 3);
    // distance, small
    const kw = txt(gfx, 'KM', xr, y + 33, 11, DIM, 0.95, 1, 1, 0.11, 3);
    num(gfx, f.dist / 10, xr - kw - 7, y + 33, 11, DIM, 1.0, false, 2, 0.11, 3);
    // "+500" ticks rise into the score
    for (let i = 0; i < TICKS; i++) {
      const a = tickAge[i];
      if (a > 0.9) continue;
      const e = ease.outCubic(clamp01(a / 0.9));
      const k = Math.min(1, a / 0.05) * (1 - smoothstep(0.5, 0.9, a));
      const ty = y + 80 + tickRow[i] * 19 - e * 22, ts = 13;
      const col = tickHot[i] ? ICE : CYAN;
      const xl = num(gfx, tickVal[i], xr, ty, ts, col, 1.2 * k, false, 0, 0.11, 3);
      txt(gfx, '+', xl - 3, ty, ts, col, 1.2 * k, 1, 0, 0.11, 3);
    }
  }

  // ------------------------------------------------------------------ banners and stamps
  function drawBanner(f, W) {
    const t = S.bnT;
    if (t <= 0) return;
    const cx = W * 0.5, y = RING_Y + RING_R + 56;
    const inn = ease.outCubic(clamp01(t / 0.28)), out = smoothstep(1.7, 2.02, t);
    const k = (1 - out) * Math.min(1, t / 0.06);
    const size = 13, tr = 2.2;
    const wa = txtW(S.bnA, size, tr), wb = txtW(S.bnB, size, tr), gap = 22;
    const total = wa + gap + wb, x0 = cx - total * 0.5;
    gearColor(f.gearF, colG); mixColor(colG, WHITE, 0.35, colA);
    gfx.glowEllipse(cx, y, total * 0.75, 30, BLACK, 1, 1.4, 0.7 * k);
    // hairlines shoot out from the centre, the text slides out from behind them
    const half = (total * 0.5 + 34) * inn, slide = (1 - inn) * 16;
    gfx.line(cx - half, y + 15, cx + half, y + 15, 1.3, colA, 0.8 * k, 3);
    gfx.line(cx - half, y - 15, cx - half + 14, y - 15, 1.3, colA, 0.8 * k, 3);
    gfx.line(cx + half, y - 15, cx + half - 14, y - 15, 1.3, colA, 0.8 * k, 3);
    const tk = k * smoothstep(0.05, 0.3, t);
    txt(gfx, S.bnA, x0 - slide, y - out * 5, size, colA, 1.05 * tk, 0, tr, 0.11, 3);
    gfx.line(x0 + wa + gap * 0.5, y - 6, x0 + wa + gap * 0.5, y + 6, 1.4, colA, 0.9 * tk, 3);
    txt(gfx, S.bnB, x0 + wa + gap + slide, y - out * 5, size, WHITE, 1.2 * tk, 0, tr, 0.11, 3);
  }

  function drawCrash(f, W) {
    const t = S.crT;
    if (t < 0 || S.crLost < 1) return;
    const cx = W * 0.5 + RING_R + 24, cy = RING_Y;
    const pop = lerp(1.5, 1, ease.outExpo(clamp01(t / 0.14)));
    const k = Math.min(1, t / 0.03) * (1 - smoothstep(0.6, 0.95, t));
    const jx = t < 0.25 ? (hash1(Math.floor(t * 60)) - 0.5) * 8 * (1 - t / 0.25) : 0;
    txt(gfx, LOST_STR[S.crLost], cx + jx, cy + t * 16, 17 * pop, MAGENTA, 1.5 * k, 0, 1.5, 0.13, 4);
  }

  // GEAR n, slammed across the upper middle. Bloomed. Gone in 0.8 s.
  function drawStamp(f, W) {
    const t = S.stT;
    if (t < 0) return;
    const cx = W * 0.5, cy = 208;
    const slam = ease.outExpo(clamp01(t / 0.15));
    const sc = lerp(2.1, 1, slam);
    const out = smoothstep(0.52, 0.84, t);
    const k = Math.min(1, t / 0.025) * (1 - out);
    const split = 32 * (1 - ease.outExpo(clamp01(t / 0.32))) + 1.2 + out * 10;
    const size = 66 * sc, tr = 1.2 + out * 4;
    const str = GEAR_STR[S.stGear];
    gearColor(S.stGear, colG); mixColor(colG, WHITE, 0.72, colA);
    txt(gfx, str, cx - split, cy, size, RED, 0.7 * k, 0.5, tr, 0.11, 4, 0.12);
    txt(gfx, str, cx + split, cy, size, BLUE, 0.9 * k, 0.5, tr, 0.11, 4, 0.12);
    txt(gfx, str, cx, cy, size, colA, (1.2 + (1 - slam) * 1.5) * k, 0.5, tr, 0.11, 4, 0.12);
    // a bar under it that snaps wide and dies
    const w = txtW(str, 66, 1.2) * (0.3 + 0.75 * slam) * (1 + out * 0.3);
    mixColor(colG, WHITE, 0.4, colB);
    gfx.line(cx - w * 0.5, cy + 54, cx + w * 0.5, cy + 54, 2.2, colB, 1.2 * k, 4);
    gfx.line(cx - w * 0.5, cy - 54, cx - w * 0.5 + 26, cy - 54, 2.2, colB, 1.0 * k, 4);
    gfx.line(cx + w * 0.5, cy - 54, cx + w * 0.5 - 26, cy - 54, 2.2, colB, 1.0 * k, 4);
  }

  // ------------------------------------------------------------------ the lead arc
  const ARC_SPAN = 1.22, ARC_N = 15;   // radians each side of straight down; dashes per side (20 m each)
  let ACX = 0, ACY = 0, ARX = 1, ARY = 1;
  const arcX = (p) => ACX + ARX * Math.sin(p * ARC_SPAN);
  const arcY = (p) => ACY + ARY * Math.cos(p * ARC_SPAN);
  function arcDash(p0, p1, lw, col, k, glow) {
    // two chords per dash keep the curve smooth
    const pm = (p0 + p1) * 0.5, xm = arcX(pm), ym = arcY(pm);
    gfx.line(arcX(p0), arcY(p0), xm, ym, lw, col, k, glow);
    gfx.line(xm, ym, arcX(p1), arcY(p1), lw, col, k, glow);
  }
  function drawLeadArc(f) {
    const vis = S.hudVis, inn = ease.outBack(clamp01(S.arcIn)), fadeIn = clamp01(S.arcIn * 2.5);
    const s = S.as, lead = clamp(f.lead, 0, LEAD_MAX), fill = lead / LEAD_MAX;
    const low = S.lowVis, beatK = f.kick;
    const shake = S.alarm > 0 ? Math.sin(S.t * 90) * 5 * S.alarm : 0;
    ACX = S.ax + shake; ACY = S.ay + 0.42 * s + (1 - inn) * 46; ARX = 2.5 * s; ARY = 0.72 * s;
    // cyan while safe, sliding to nova gold as the star closes in
    const hot = smoothstep(0.1, 0.72, f.danger);
    mixColor(CYAN, GOLD, hot, colA);
    if (low > 0) mixColor(colA, ORANGE, low * 0.35 * (0.5 + 0.5 * beatK), colA);
    if (S.lossT < 0.5) mixColor(colA, MAGENTA, 1 - S.lossT / 0.5, colA);
    const pulse = 1 + low * (beatK * 1.1 - 0.15) + S.alarm * 2 + (S.lossT < 0.3 ? 1.5 * (1 - S.lossT / 0.3) : 0);
    const k = vis * fadeIn;
    gfx.glowEllipse(ACX, ACY + ARY * 0.55, ARX * 1.15, ARY * 1.5, colA, 0.1 * k * (1 + low * beatK), 1.6);
    const reach = fill * clamp01(S.arcIn * 1.4);
    const dp = 1 / ARC_N, gapP = dp * 0.2;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < ARC_N; i++) {
        const a = i * dp + gapP * 0.5, b = (i + 1) * dp - gapP * 0.5;
        if (a > inn * 1.02) break;                         // the track unrolls from the centre on the slide-in
        // relief wave on leadSafe: a brightness ripple running outward
        const wave = S.relax > 0 ? Math.max(0, 1 - Math.abs((1 - S.relax) * 1.25 - a) * 5) * S.relax * 2.2 : 0;
        if (reach >= b) arcDash(side * a, side * b, 5, colA, (1.35 * pulse + wave) * k, 4);
        else if (reach > a) {
          arcDash(side * a, side * reach, 5, colA, (1.35 * pulse + wave) * k, 4);
          arcDash(side * reach, side * b, 1.6, colA, (0.32 + wave * 0.4) * k, 3);
        } else arcDash(side * a, side * b, 1.6, colA, (0.32 + wave * 0.4) * k, 3);
      }
      // the 80 m mark: below this the klaxon starts
      const pm = side * (80 / LEAD_MAX);
      gfx.line(arcX(pm), arcY(pm) + 6, arcX(pm), arcY(pm) + 13, 1.6, GOLD, 0.75 * k, 3);
      // trend chevrons past the tip: closing in (gold, pointing inward) or pulling away (cyan, outward)
      const tr = clamp(S.trend / 10, -1, 1);
      if (Math.abs(tr) > 0.15 && reach > 0.03 && reach < 0.93) {
        const dir = tr > 0 ? 1 : -1, ph = (f.beatPhase * 2) % 1;
        const cc = tr > 0 ? CYAN : GOLD;
        for (let j = 0; j < 2; j++) {
          const pc = side * (reach + 0.045 + j * 0.04 + dir * (ph - 0.5) * 0.02);
          const x = arcX(pc), y = arcY(pc);
          let tx = arcX(pc + side * dir * 0.02) - x, ty = arcY(pc + side * dir * 0.02) - y;
          const tl = 7 / (Math.hypot(tx, ty) + 1e-4); tx *= tl; ty *= tl;
          const order = dir > 0 ? j : 1 - j;               // the leading chevron is the bright one
          const ck = k * Math.min(1, Math.abs(tr) * 1.6) * (order === 0 ? 0.55 : 1) * (0.75 + 0.35 * (1 - ph));
          gfx.line(x - tx - ty, y - ty + tx, x, y, 2, cc, 1.15 * ck, 3);
          gfx.line(x - tx + ty, y - ty - tx, x, y, 2, cc, 1.15 * ck, 3);
        }
      }
    }
    // read-out: always when the nova is close, briefly when the arc first slides in, and on a crash
    const ly = ACY + ARY + 24;
    const intro = S.introT < 2.6 ? Math.min(1, S.introT / 0.3) * (1 - smoothstep(2.0, 2.6, S.introT)) : 0;
    const show = Math.max(low, intro);
    if (show > 0.01) {
      const size = 13 + low * 3 + low * beatK * 1.5, tr = 2;
      const m = Math.round(lead);
      const w0 = txtW('NOVA', size, tr), w1 = numW(m, size, false, 0), w2 = txtW('M', size, 0), g0 = size * 0.9, g1 = size * 0.6;
      const x0 = ACX - (w0 + g0 + w1 + g1 + w2) * 0.5;
      const tk = k * show * (low > 0.5 ? 1.15 + beatK * 0.9 : 0.95);
      mixColor(colA, WHITE, 0.25, colB);
      txt(gfx, 'NOVA', x0, ly, size, colB, tk, 0, tr, 0.12, 3.5);
      num(gfx, m, x0 + w0 + g0 + w1, ly, size, colB, tk * 1.1, false, 0, 0.12, 3.5);
      txt(gfx, 'M', x0 + w0 + g0 + w1 + g1, ly, size, colB, tk, 0, 0, 0.12, 3.5);
      if (low > 0.5 && f.lead < 40) {
        // level 2: flanking warning marks on the off-beat
        const blink = f.beatPhase > 0.5 ? 1 : 0.25, hw = (w0 + g0 + w1 + g1 + w2) * 0.5 + 18;
        txt(gfx, '▲', ACX - hw, ly, size * 0.9, ORANGE, tk * blink, 0.5, 0, 0.14, 3.5);
        txt(gfx, '▲', ACX + hw, ly, size * 0.9, ORANGE, tk * blink, 0.5, 0, 0.14, 3.5);
      }
    }
    if (S.lossT < 0.9) {
      const t = S.lossT, lk = k * Math.min(1, t / 0.04) * (1 - smoothstep(0.55, 0.9, t));
      txt(gfx, '-40 M', ACX + ARX * 0.78, ACY + ARY * 0.2 - 18 - t * 14, 13, MAGENTA, 1.5 * lk, 0.5, 1.5, 0.13, 3.5);
    }
  }

  // ------------------------------------------------------------------ prompts
  function chevrons(x, y, dir, n, phase, col, k) {
    // little arrowheads streaming in `dir` (-1 left, +1 right): "keep going this way"
    for (let i = 0; i < n; i++) {
      const p = (i + phase) / n, px = x + dir * p * n * 13, a = Math.sin(p * Math.PI);
      gfx.line(px - dir * 6, y - 7, px, y, 2.2, col, k * a, 3); gfx.line(px - dir * 6, y + 7, px, y, 2.2, col, k * a, 3);
    }
  }
  // two chevrons lifting off a key or a fingertip: "up, through the core"
  function liftChevrons(y0, ph) {
    for (let i = 0; i < 2; i++) {
      const yy = y0 - i * 13 - ph * 10, a = (1 - ph) * (1 - i * 0.45);
      gfx.line(-11, yy + 8, 0, yy, 2.4, CYAN, 1.2 * a, 3); gfx.line(11, yy + 8, 0, yy, 2.4, CYAN, 1.2 * a, 3);
    }
  }
  // the sides of a centre-column touch zone, with corner ticks on the half-way line at y0
  function zoneMarks(zl, zr, y0, y1, col) {
    gfx.line(zl, y0, zl, y1, 1.4, col, 0.4, 3); gfx.line(zr, y0, zr, y1, 1.4, col, 0.4, 3);
    gfx.line(zl, y0, zl + 16, y0, 1.4, col, 0.4, 3); gfx.line(zr, y0, zr - 16, y0, 1.4, col, 0.4, 3);
  }
  function drawPrompt(f, W, H) {
    const v = S.pVis;
    if (v <= 0.01 || !S.pCur) return;
    const sc = lerp(0.5, 1, ease.outBack(v));
    const ax = S.ax, ay = S.ay, s = S.as, ph = f.beatPhase, kick = f.kick;
    const odd = Math.floor(f.beat) & 1;
    const down = Math.exp(-ph * 4.5);          // a key going down exactly on the beat and easing back up
    const sideX = 2.75 * s, sideY = ay - 0.8 * s, topY = ay - 2.34 * s;
    const type = S.pCur, dev = f.device;
    gfx.push(); gfx.mulFade(v);
    if (dev === 'touch') {
      // four tap zones, no swipes: left third, right third, and the centre column cut in half
      // (top half FLIP, bottom half BREACH). Every icon sits inside the zone it teaches.
      const zx = W * 0.17, zy = H * 0.63, zl = W * 0.34, zr = W * 0.66, hy = H * 0.5;
      if (type === 'roll' || type === 'hold') {
        for (let side = -1; side <= 1; side += 2) {
          if (type === 'hold' && side !== S.pDir) continue;
          const x = W * 0.5 + side * (W * 0.5 - zx), on = type === 'hold' ? 1 : (side < 0 ? 1 - odd : odd);
          // the zone itself: a wash from the screen edge and its inner boundary
          const ex = side < 0 ? 0 : W, bx = side < 0 ? zl : zr;
          gfx.quadGrad(ex, 0, ex, H, bx, H, bx, 0, CYAN, 0.006 + 0.016 * on * down, 0, CYAN, 0, 0);
          gfx.line(bx, H * 0.46, bx, H - MARGIN, 1.4, CYAN, 0.4, 3);
          gfx.line(bx, H * 0.46, bx + side * 16, H * 0.46, 1.4, CYAN, 0.4, 3); gfx.line(bx, H - MARGIN, bx + side * 16, H - MARGIN, 1.4, CYAN, 0.4, 3);
          gfx.push(); gfx.translate(x, zy); gfx.scale(sc);
          tapIcon(gfx, 0, 0, 30, CYAN, 1.2, on ? ph : 0.999, type === 'hold');
          arrow(gfx, side * 62, 0, 26, side < 0 ? 0 : 1, 3.2, CYAN, 1.3 * (0.6 + 0.6 * on * down));
          if (type === 'hold') { txt(gfx, 'HOLD', 0, 54, 13, WHITE, 1.2, 0.5, 3, 0.12, 3); chevrons(side * 86, 0, side, 3, ph, CYAN, 1.2); }
          gfx.pop();
        }
      } else if (type === 'breach') {
        // bottom half of the centre column; the fingertip sits beside the runner, clear of the wall's middle
        gfx.rectGrad(zl, hy, zr - zl, H - hy, ICE, 0, 0, ICE, 0.006 + 0.016 * down, 0);
        zoneMarks(zl, zr, hy, H - MARGIN, ICE);
        gfx.push(); gfx.translate(ax + Math.min(sideX, W * 0.11), Math.max(sideY, hy + 46)); gfx.scale(sc);
        tapIcon(gfx, 0, 0, 28, ICE, 1.3, ph, false);
        gfx.pop();
      } else if (type === 'flip') {
        // top half of the centre column; the fingertip sits up and to the side, so the iris stays in view
        gfx.rectGrad(zl, 0, zr - zl, hy, CYAN, 0.006 + 0.016 * down, 0, CYAN, 0, 0);
        zoneMarks(zl, zr, hy, H * 0.2, CYAN);
        gfx.push(); gfx.translate(W * 0.5 + Math.min(sideX, W * 0.11), H * 0.31); gfx.scale(sc);
        tapIcon(gfx, 0, 0, 28, CYAN, 1.3, ph, false);
        liftChevrons(-52, ph);
        gfx.pop();
      }
    } else if (dev === 'gamepad') {
      if (type === 'roll') {
        gfx.push(); gfx.translate(ax - sideX, sideY); gfx.scale(sc); dpad(gfx, 0, 0, 62, 0, CYAN, 1.2, odd ? 0 : down); gfx.pop();
        gfx.push(); gfx.translate(ax + sideX, sideY); gfx.scale(sc); dpad(gfx, 0, 0, 62, 1, CYAN, 1.2, odd ? down : 0); gfx.pop();
      } else if (type === 'hold') {
        gfx.push(); gfx.translate(ax + S.pDir * sideX, sideY); gfx.scale(sc);
        dpad(gfx, 0, 0, 62, S.pDir < 0 ? 0 : 1, CYAN, 1.25, 0.8 + 0.2 * kick);
        txt(gfx, 'HOLD', 0, 50, 12, WHITE, 1.2, 0.5, 3, 0.12, 3);
        chevrons(S.pDir * 44, 0, S.pDir, 3, ph, CYAN, 1.2);
        gfx.pop();
      } else if (type === 'breach') {
        gfx.push(); gfx.translate(ax, topY); gfx.scale(sc); padButton(gfx, 0, 0, 25, 'A', ICE, 1.25, down); gfx.pop();
      } else if (type === 'flip') {
        gfx.push(); gfx.translate(ax + sideX, sideY); gfx.scale(sc); padButton(gfx, 0, 0, 25, 'Y', CYAN, 1.25, down);
        arrow(gfx, 0, -46 - (1 - down) * 6, 20, 2, 2.6, CYAN, 1.1 * (0.4 + 0.6 * down)); gfx.pop();
      }
    } else {
      if (type === 'roll') {
        gfx.push(); gfx.translate(ax - sideX, sideY); gfx.scale(sc); arrowKey(gfx, 0, 0, 48, 0, CYAN, 1.15, odd ? 0 : down); gfx.pop();
        gfx.push(); gfx.translate(ax + sideX, sideY); gfx.scale(sc); arrowKey(gfx, 0, 0, 48, 1, CYAN, 1.15, odd ? down : 0); gfx.pop();
      } else if (type === 'hold') {
        gfx.push(); gfx.translate(ax + S.pDir * sideX, sideY); gfx.scale(sc);
        arrowKey(gfx, 0, 0, 48, S.pDir < 0 ? 0 : 1, CYAN, 1.2, 0.82 + 0.18 * kick);
        txt(gfx, 'HOLD', 0, 46, 12, WHITE, 1.25, 0.5, 3, 0.12, 3);
        chevrons(S.pDir * 38, 0, S.pDir, 3, ph, CYAN, 1.25);
        gfx.pop();
      } else if (type === 'breach') {
        gfx.push(); gfx.translate(ax, topY); gfx.scale(sc); spaceKey(gfx, 0, 0, 158, 36, ICE, 1.2, down); gfx.pop();
      } else if (type === 'flip') {
        // beside the runner, not over the vanishing point: the iris and its pad must stay in view
        gfx.push(); gfx.translate(ax + sideX, sideY); gfx.scale(sc);
        arrowKey(gfx, 0, 0, 48, 2, CYAN, 1.2, down);
        liftChevrons(-42, ph);
        gfx.pop();
      }
    }
    gfx.pop();
  }

  // ------------------------------------------------------------------ legend (title + pause)
  function touchPict(cx, cy, kind, col, k, on, ph) {
    // a tiny screen cut into its four tap zones (thirds, the middle one halved), with the one to touch lit
    const w = 84, h = 52, x = cx - w * 0.5, y = cy - h * 0.5;
    gfx.rect(x, y, w, h, INK, 1, 0.75);
    chamferRect(gfx, x, y, w, h, 6, 1.8, col, k * 0.7, 3);
    gfx.line(x + w / 3, y + 5, x + w / 3, y + h - 5, 1, col, k * 0.3, 2); gfx.line(x + (w * 2) / 3, y + 5, x + (w * 2) / 3, y + h - 5, 1, col, k * 0.3, 2);
    gfx.line(x + w / 3, cy, x + (w * 2) / 3, cy, 1, col, k * 0.3, 2);
    const lit = 0.25 + 0.75 * on * Math.exp(-ph * 4);
    if (kind === 0) {
      const side = on === 2 ? 1 : -1, sx = cx + side * (w / 3);
      gfx.rect(side < 0 ? x + 3 : x + (w * 2) / 3 + 2, y + 3, w / 3 - 5, h - 6, col, 0.3 * k * (on ? lit : 0.25), 0);
      gfx.disc(sx, cy, 5, col, k * (on ? 0.6 + lit : 0.5), 0);
      gfx.disc(cx - side * (w / 3), cy, 4, col, k * 0.35, 0);
    } else {
      // FLIP is the top half of the middle column, BREACH the bottom half
      const top = kind === 1, dy = cy + (top ? -1 : 1) * h * 0.25;
      gfx.rect(x + w / 3 + 2, top ? y + 3 : cy + 2, w / 3 - 4, h * 0.5 - 5, col, 0.3 * k * lit, 0);
      gfx.disc(cx, dy, 4.5, col, k * (0.6 + lit), 0);
      if (on) gfx.ring(cx, dy, 4.5 + ph * 9, 1.4, col, k * (1 - ph), 3);
    }
  }
  // Three items: ROLL, FLIP, BREACH. The icons play themselves on the beat: left, right, up, SPACE.
  function drawLegend(f, cx, cy, W, k) {
    const sp = clamp((W - 160) / 3.5, 200, 270);
    const step = Math.floor(f.beat) & 3, ph = f.beatPhase, down = Math.exp(-ph * 4.5);
    const dev = f.device;
    const x0 = cx - sp, x2 = cx + sp;
    if (dev === 'touch') {
      touchPict(x0, cy, 0, CYAN, k, step === 0 ? 1 : step === 1 ? 2 : 0, ph);
      touchPict(cx, cy, 1, CYAN, k, step === 2 ? 1 : 0, ph);
      touchPict(x2, cy, 2, ICE, k, step === 3 ? 1 : 0, ph);
    } else if (dev === 'gamepad') {
      dpad(gfx, x0, cy, 54, step === 1 ? 1 : 0, CYAN, k, step < 2 ? down : 0);
      padButton(gfx, cx, cy, 21, 'Y', CYAN, k, step === 2 ? down : 0);
      padButton(gfx, x2, cy, 21, 'A', ICE, k, step === 3 ? down : 0);
    } else {
      arrowKey(gfx, x0 - 25, cy, 42, 0, CYAN, k, step === 0 ? down : 0);
      arrowKey(gfx, x0 + 25, cy, 42, 1, CYAN, k, step === 1 ? down : 0);
      arrowKey(gfx, cx, cy, 42, 2, CYAN, k, step === 2 ? down : 0);
      spaceKey(gfx, x2, cy, 138, 38, ICE, k, step === 3 ? down : 0);
    }
    const ly = cy + 46;
    txt(gfx, 'ROLL', x0, ly, 13, PALE, k * (step < 2 ? 1.25 : 0.85), 0.5, 3.4, 0.11, 3);
    txt(gfx, 'FLIP', cx, ly, 13, PALE, k * (step === 2 ? 1.25 : 0.85), 0.5, 3.4, 0.11, 3);
    txt(gfx, 'BREACH', x2, ly, 13, PALE, k * (step === 3 ? 1.25 : 0.85), 0.5, 3.4, 0.11, 3);
  }

  // ------------------------------------------------------------------ title
  function drawTitleWorld(f, W, H) {
    const v = S.titleVis, cx = W * 0.5;
    layoutTitle(W);
    // scrim: a general dimming plus soft pools of dark behind the word and behind the small print
    gfx.rect(0, 0, W, H, BLACK, 1, 0.4 * v);
    // a feathered band of dark behind the word and its tagline
    const b0 = LY - LU * 3 - 70, b1 = LY - LU * 3 - 6, b2 = LY + LU * 3 + 84, b3 = b2 + 70;
    gfx.rectGrad(0, b0, W, b1 - b0, BLACK, 1, 0, BLACK, 1, 0.8 * v);
    gfx.rect(0, b1, W, b2 - b1, BLACK, 1, 0.8 * v);
    gfx.rectGrad(0, b2, W, b3 - b2, BLACK, 1, 0.8 * v, BLACK, 1, 0);
    gfx.glowEllipse(cx, 612, 640, 190, BLACK, 1, 1.2, 0.85 * v);
    if (S.shatterT >= 0) return;
    drawLogo(gfx, cx, LY, LW, f.time, f.kick, v, false);
    // the Doppler rule under the word: red behind you, blue ahead, and a marker that jumps bluer on the beat
    const y = LY + LU * 3 + 26, x0 = cx - LW * 0.5, n = 56, seg = LW / n;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      dopplerColor(t, colA);
      const major = i % 7 === 0;
      gfx.line(x0 + i * seg + 2, y, x0 + (i + 1) * seg - 2, y, 1.6, colA, (0.5 + 0.3 * t) * v, 3);
      if (major) gfx.line(x0 + i * seg, y - 5, x0 + i * seg, y + 5, 1.2, colA, 0.6 * v, 3);
    }
    const mk = 0.64 + 0.3 * (1 - Math.exp(-f.kick * 2.2)) + Math.sin(f.time * 0.9) * 0.03;
    const mx = x0 + LW * clamp01(mk);
    dopplerColor(mk, colA); mixColor(colA, WHITE, 0.5, colA);
    gfx.line(mx, y - 7, mx, y + 7, 2.6, colA, 1.5 * v, 4);
    gfx.tri(mx - 6, y - 17, mx + 6, y - 17, mx, y - 8, colA, 1.3 * v, 0);
    gfx.glow(mx, y, 26, colA, 0.5 * v, 2);
  }

  function drawTitle(f, W, H) {
    const v = S.titleVis, cx = W * 0.5;
    layoutTitle(W);
    gfx.push(); gfx.mulFade(v);
    // registration marks in the corners: the screen is a composed plate
    const m = MARGIN, cl = 22;
    gfx.line(m, m, m + cl, m, 1.4, DIM, 0.55, 3); gfx.line(m, m, m, m + cl, 1.4, DIM, 0.55, 3);
    gfx.line(m, H - m, m + cl, H - m, 1.4, DIM, 0.55, 3); gfx.line(m, H - m, m, H - m - cl, 1.4, DIM, 0.55, 3);
    gfx.line(W - m, H - m, W - m - cl, H - m, 1.4, DIM, 0.55, 3); gfx.line(W - m, H - m, W - m, H - m - cl, 1.4, DIM, 0.55, 3);
    // tagline: OUTRUN THE (ice) NOVA (gold)
    const ty = LY + LU * 3 + 58, ts = 17, ttr = 5;
    const wa = txtW('OUTRUN THE', ts, ttr), wsp = ts * 1.9, wb = txtW('NOVA', ts, ttr);
    const tx = cx - (wa + wsp + wb) * 0.5;
    txt(gfx, 'OUTRUN THE', tx, ty, ts, PALE, 1.15, 0, ttr, 0.1, 3.5);
    txt(gfx, 'NOVA', tx + wa + wsp, ty, ts, GOLD, 1.3 + f.kick * 0.4, 0, ttr, 0.11, 4);
    // press any key, breathing with the kick, with brackets that squeeze in on the beat
    const py = 646, label = pressLabel(f.device), ps = 19, ptr = 3;
    const pw = txtW(label, ps, ptr), pk = 0.7 + f.kick * 0.9;
    txt(gfx, label, cx, py, ps, WHITE, pk, 0.5, ptr, 0.1, 4);
    const bx = pw * 0.5 + 26 + (1 - f.kick) * 10;
    gfx.line(cx - bx - 9, py - 10, cx - bx, py, 2.2, CYAN, pk, 3); gfx.line(cx - bx - 9, py + 10, cx - bx, py, 2.2, CYAN, pk, 3);
    gfx.line(cx + bx + 9, py - 10, cx + bx, py, 2.2, CYAN, pk, 3); gfx.line(cx + bx + 9, py + 10, cx + bx, py, 2.2, CYAN, pk, 3);
    // legend
    drawLegend(f, cx, 546, W, 1.1);
    // best, top right (where the score lives during a run)
    if (f.bestScore > 0 || f.bestDist > 0) {
      const xr = W - MARGIN, y = MARGIN + 14;
      const xl = num(gfx, f.bestScore, xr, y, 20, PALE, 1.1, true, 0, 0.1, 3.5);
      txt(gfx, 'BEST', xl - 12, y, 11, DIM, 1.0, 1, 2.4, 0.11, 3);
      const kw = txt(gfx, 'KM', xr, y + 28, 11, DIM, 0.95, 1, 1, 0.11, 3);
      num(gfx, f.bestDist / 10, xr - kw - 7, y + 28, 11, DIM, 1.0, false, 2, 0.11, 3);
    }
    // footer: M MUTE  F FULLSCREEN  P PAUSE  C COMFORT
    if (f.device !== 'touch') drawFooter(f, cx, H - MARGIN - 4, true);
    gfx.pop();
  }

  // The keyboard-only options, small, along the bottom of the title and the pause screen.
  // COMFORT reads "COMFORT ON" and lights up while the option is on, so its state is always visible.
  function drawFooter(f, cx, fy, withPause) {
    const fs = 9, ftr = 2.2, kw = 18, g0 = 8, g1 = 28;
    const cLab = f.comfort ? 'COMFORT ON' : 'COMFORT', cCol = f.comfort ? PALE : DIM;
    const w0 = txtW('MUTE', fs, ftr), w1 = txtW('FULLSCREEN', fs, ftr), w2 = withPause ? txtW('PAUSE', fs, ftr) : 0, w3 = txtW(cLab, fs, ftr);
    const n = withPause ? 4 : 3;
    let x = cx - ((kw + g0) * n + w0 + w1 + w2 + w3 + g1 * (n - 1)) * 0.5;
    letterKey(gfx, x + kw * 0.5, fy - 2, kw, 'M', DIM, 0.9); x += kw + g0; txt(gfx, 'MUTE', x, fy, fs, DIM, 0.95, 0, ftr, 0.11, 3); x += w0 + g1;
    letterKey(gfx, x + kw * 0.5, fy - 2, kw, 'F', DIM, 0.9); x += kw + g0; txt(gfx, 'FULLSCREEN', x, fy, fs, DIM, 0.95, 0, ftr, 0.11, 3); x += w1 + g1;
    if (withPause) { letterKey(gfx, x + kw * 0.5, fy - 2, kw, 'P', DIM, 0.9); x += kw + g0; txt(gfx, 'PAUSE', x, fy, fs, DIM, 0.95, 0, ftr, 0.11, 3); x += w2 + g1; }
    letterKey(gfx, x + kw * 0.5, fy - 2, kw, 'C', cCol, 0.9); x += kw + g0; txt(gfx, cLab, x, fy, fs, cCol, f.comfort ? 1.1 : 0.95, 0, ftr, 0.11, 3);
  }

  // "COMFORT ON" / "COMFORT OFF", top left, for a second after the player presses C (on any screen).
  function drawComfortToast() {
    const t = S.cfT;
    if (t < 0) return;
    const k = Math.min(1, t / 0.05) * (1 - smoothstep(0.85, 1.1, t));
    const x = MARGIN + 16, y = MARGIN + 17, slide = (1 - ease.outCubic(clamp01(t / 0.18))) * 10;
    const str = S.cfOn ? 'COMFORT ON' : 'COMFORT OFF', col = S.cfOn ? CYAN : PALE;
    const w = txtW(str, 13, 2.6);
    gfx.glowEllipse(x + 12 + w * 0.5, y, w * 0.8, 34, BLACK, 1, 1.4, 0.75 * k);
    gfx.line(x - slide, y - 9, x - slide, y + 9, 2.4, col, 1.2 * k, 3);
    txt(gfx, str, x + 12 - slide, y, 13, WHITE, 1.2 * k, 0, 2.6, 0.11, 3.5);
  }

  // Touch: the top-left corner pauses (x < 10 %, y < 17 % of the canvas). A small, quiet glyph marks it.
  function drawPauseGlyph(W, H) {
    const v = S.pzVis * 0.9, cx = clamp(W * 0.05, 44, 70), cy = clamp(H * 0.085, 44, 62);
    gfx.push(); gfx.mulFade(v);
    gfx.rect(cx - 17, cy - 17, 34, 34, INK, 1, 0.5);
    chamferRect(gfx, cx - 17, cy - 17, 34, 34, 6, 1.4, DIM, 0.5, 3);
    gfx.line(cx - 5, cy - 7, cx - 5, cy + 7, 3, PALE, 0.85, 3); gfx.line(cx + 5, cy - 7, cx + 5, cy + 7, 3, PALE, 0.85, 3);
    gfx.pop();
  }

  // ------------------------------------------------------------------ results
  function drawResults(f, W, H) {
    const tb = S.deadClock - 0.42;
    if (tb < 0) return;
    const cx = W * 0.5, rT = S.resT, cyN = 300;
    // the song is over on this screen (frame.kick is 0), so the pulse runs on its own clock
    const ph = (S.t * 2.1) % 1, kick = Math.max(f.kick, Math.exp(-ph * 4.5));
    const open = ease.outExpo(clamp01(tb / 0.2));
    const ex = rT >= 0 ? ease.outCubic(clamp01(rT / 0.3)) : 0;
    const top = lerp(cyN - 112 * open, 96, ex), bot = lerp(cyN + 112 * open, 654, ex);
    // the slot: burned through whatever the nova left on screen
    gfx.rectGrad(0, top - 46, W, 46, BLACK, 1, 0, BLACK, 1, 0.55);
    gfx.rectGrad(0, bot, W, 46, BLACK, 1, 0.55, BLACK, 1, 0);
    gfx.rect(0, top, W, bot - top, SLOT, 1, 0.95);
    const heat = Math.exp(-tb / 0.45), flick = 0.85 + 0.15 * hash1(Math.floor(S.t * 30));
    mixColor(GOLD, WHITE, heat, colA);
    gfx.line(-30, top, W + 30, top, 2.2 + heat * 5, colA, (1.1 + heat * 2.4) * flick, 6);
    gfx.line(-30, bot, W + 30, bot, 2.2 + heat * 5, colA, (1.1 + heat * 2.4) * flick, 6);
    if (heat > 0.02) {
      gfx.rectGrad(0, top, W, 40, ORANGE, heat * 0.4, 0, ORANGE, 0, 0);
      gfx.rectGrad(0, bot - 40, W, 40, ORANGE, 0, 0, ORANGE, heat * 0.4, 0);
    }

    // the punchline: how far you got
    const tn = tb - 0.06;
    if (tn > 0) {
      const slam = ease.outExpo(clamp01(tn / 0.16)), nh = Math.exp(-tn / 0.4);
      const size = 148 * (W < 1100 ? 0.86 : 1) * lerp(1.9, 1, slam), kmSize = size * 0.36;
      const wN = numW(S.resDist, size, false, 2), wK = txtW('KM', kmSize, 1), gap = size * 0.2;
      const xr = cx - (wN + gap + wK) * 0.5 + wN;
      const split = 36 * (1 - ease.outExpo(clamp01(tn / 0.38))) + 1.6;
      const kIn = Math.min(1, tn / 0.02), ghost = clamp01((split - 1.6) / 14) * kIn;
      if (ghost > 0.01) {
        num(gfx, S.resDist, xr - split, cyN, size, RED, 0.8 * ghost, false, 2, 0.075, 3.5);
        num(gfx, S.resDist, xr + split, cyN, size, BLUE, 0.9 * ghost, false, 2, 0.075, 3.5);
      }
      mixColor(GOLD, WHITE, 0.22 + 0.78 * nh, colA);
      num(gfx, S.resDist, xr, cyN, size, colA, (1.0 + nh * 1.3) * kIn, false, 2, 0.078, 3.6);
      txt(gfx, 'KM', xr + gap, cyN + size * 0.5 - kmSize * 0.5, kmSize, colA, 1.0 * kIn, 0, 1, 0.1, 3.6);
      if (tn < 0.3) { const fl = 1 - tn / 0.3; gfx.line(-30, cyN, W + 30, cyN, 2 + fl * 3, WHITE, fl * fl * 2.2, 10); }
      // new best: say it at once
      if (S.newBestDist && tn > 0.3) {
        const a = Math.min(1, (tn - 0.3) / 0.12), blink = tn < 1.1 ? (Math.floor(tn * 12) & 1 ? 1.6 : 0.6) : 1.1 + kick * 0.5;
        const pop = lerp(1.6, 1, ease.outExpo(clamp01((tn - 0.3) / 0.18)));
        const w = txt(gfx, 'NEW BEST', cx, 196 - lerp(0, 4, ex), 17 * pop, ICE, blink * a, 0.5, 4, 0.12, 4);
        txt(gfx, '♦', cx - w * 0.5 - 22, 196 - lerp(0, 4, ex), 13, ICE, blink * a, 0.5, 0, 0.14, 3);
        txt(gfx, '♦', cx + w * 0.5 + 22, 196 - lerp(0, 4, ex), 13, ICE, blink * a, 0.5, 0, 0.14, 3);
        // light runs outward from it on every beat
        chevrons(cx - w * 0.5 - 44, 196 - lerp(0, 4, ex), -1, 4, ph, ICE, 1.1 * a);
        chevrons(cx + w * 0.5 + 44, 196 - lerp(0, 4, ex), 1, 4, ph, ICE, 1.1 * a);
      }
    }
    if (rT < 0) return;

    // sector reached
    let a = ease.outCubic(clamp01((rT - 0.05) / 0.2)) * ex;
    if (a > 0) {
      const size = 14, tr = 3, wa = txtW(S.resSecA, size, tr), wb = txtW(S.resSecB, size, tr), gap = 26;
      const x0 = cx - (wa + gap + wb) * 0.5, y = 144 - (1 - a) * 8;
      txt(gfx, S.resSecA, x0, y, size, DIM, 1.05 * a, 0, tr, 0.11, 3);
      gfx.line(x0 + wa + gap * 0.5, y - 7, x0 + wa + gap * 0.5, y + 7, 1.4, DIM, 0.9 * a, 3);
      txt(gfx, S.resSecB, x0 + wa + gap, y, size, WHITE, 1.2 * a, 0, tr, 0.11, 3);
    }
    // score and best, side by side
    a = ease.outCubic(clamp01((rT - 0.12) / 0.2)) * ex;
    if (a > 0) {
      const col0 = cx - Math.min(200, W * 0.19), col1 = cx + Math.min(200, W * 0.19), yl = 446, yv = 482 + (1 - a) * 8;
      const count = ease.outCubic(clamp01((rT - 0.12) / 0.55));
      const sv = Math.round(S.resScore * count), bv = Math.max(S.best0Score, sv);
      txt(gfx, 'SCORE', col0, yl, 11, DIM, 1.0 * a, 0.5, 3.4, 0.11, 3);
      num(gfx, sv, col0 + numW(sv, 30, true, 0) * 0.5, yv, 30, WHITE, 1.1 * a, true, 0, 0.085, 3);
      const nb = S.newBestScore && count >= 1;
      txt(gfx, 'BEST', col1, yl, 11, nb ? ICE : DIM, 1.0 * a, 0.5, 3.4, 0.11, 3);
      num(gfx, bv, col1 + numW(bv, 30, true, 0) * 0.5, yv, 30, nb ? ICE : PALE, (nb ? 1.2 + kick * 0.4 : 0.9) * a, true, 0, 0.085, 3);
      gfx.line(cx, yl - 6, cx, yv + 16, 1.2, DIM, 0.4 * a, 3);
    }
    // how close: this run against the best distance
    a = ease.outCubic(clamp01((rT - 0.2) / 0.2)) * ex;
    if (a > 0) {
      const half = Math.min(300, W * 0.27), x0 = cx - half, x1 = cx + half, y = 546;
      const full = Math.max(S.resDistM, S.best0Dist, 1);
      const grow = ease.outCubic(clamp01((rT - 0.2) / 0.7));
      const fr = (S.resDistM / full) * grow, fb = S.best0Dist / full;
      gfx.line(x0, y, x1, y, 1.6, DIM, 0.4 * a, 3);
      for (let i = 0; i <= 10; i++) { const x = lerp(x0, x1, i / 10); gfx.line(x, y + 5, x, y + (i % 5 === 0 ? 11 : 8), 1.2, DIM, 0.45 * a, 2); }
      mixColor(GOLD, WHITE, 0.25, colA);
      const xf = lerp(x0, x1, fr);
      gfx.line(x0, y, xf, y, 4.2, colA, 1.35 * a, 4);
      gfx.glow(xf, y, 16, colA, 0.8 * a, 2);
      gfx.line(xf, y - 9, xf, y + 9, 2.6, WHITE, 1.4 * a, 4);
      if (S.best0Dist > 0) {
        const xb = lerp(x0, x1, fb), c = S.newBestDist ? DIM : ICE;
        gfx.line(xb, y - 13, xb, y + 13, 2, c, 1.1 * a, 3);
        
        // label hangs off the best mark, kept inside the bar
        const ls = 10, ltr = 2.2, lab = S.newBestDist ? 'WAS' : 'BEST';
        const wl = txtW(lab, ls, ltr), wn = numW(S.best0Dist / 10, ls, false, 2), wk = txtW('KM', ls, 1);
        const wt = wl + 8 + wn + 8 + wk, lx = clamp(xb - wt * 0.5, x0, x1 - wt), ly = y + 26;
        txt(gfx, lab, lx, ly, ls, c, 1.0 * a, 0, ltr, 0.11, 3);
        num(gfx, S.best0Dist / 10, lx + wl + 8 + wn, ly, ls, c, 1.05 * a, false, 2, 0.11, 3);
        txt(gfx, 'KM', lx + wl + 8 + wn + 8, ly, ls, c, 1.0 * a, 0, 1, 0.11, 3);
      }
    }
    // go again
    if (rT >= 0.3) {
      const pa = Math.min(1, (rT - 0.3) / 0.1), py = 608, label = f.device === 'touch' ? 'TAP TO RUN AGAIN' : f.device === 'gamepad' ? 'PRESS ANY BUTTON' : 'PRESS ANY KEY';
      const pk = (0.75 + kick * 0.85) * pa, pw = txtW(label, 19, 3);
      txt(gfx, label, cx, py, 19, WHITE, pk, 0.5, 3, 0.1, 4);
      const bx = pw * 0.5 + 26 + (1 - kick) * 10;
      gfx.line(cx - bx - 9, py - 10, cx - bx, py, 2.2, GOLD, pk, 3); gfx.line(cx - bx - 9, py + 10, cx - bx, py, 2.2, GOLD, pk, 3);
      gfx.line(cx + bx + 9, py - 10, cx + bx, py, 2.2, GOLD, pk, 3); gfx.line(cx + bx + 9, py + 10, cx + bx, py, 2.2, GOLD, pk, 3);
    }
    // ...or leave: the way back to the main menu, said quietly under the invitation to go again
    if (rT >= 0.45) {
      const ma = Math.min(1, (rT - 0.45) / 0.15), my = 638, ms = 9.5, mtr = 2.6, wm = txtW('MAIN MENU', ms, mtr);
      if (f.device === 'touch') cornerButton(W - MARGIN - 14 - CORNER_W, H - MARGIN - CORNER_H + 6, 'MAIN MENU', false, ma);
      else if (f.device === 'gamepad') {
        const r = 9, x0 = cx - (r * 2 + 10 + wm) * 0.5;
        padButton(gfx, x0 + r, my, r, 'B', DIM, 0.95 * ma, 0);
        txt(gfx, 'MAIN MENU', x0 + r * 2 + 10, my, ms, DIM, 1.0 * ma, 0, mtr, 0.11, 3);
      } else {
        const kw = 18, x0 = cx - (kw + 10 + wm) * 0.5;
        letterKey(gfx, x0 + kw * 0.5, my - 2, kw, 'Q', DIM, 0.95 * ma);
        txt(gfx, 'MAIN MENU', x0 + kw + 10, my, ms, DIM, 1.0 * ma, 0, mtr, 0.11, 3);
      }
    }
  }

  // A touch button for a screen corner: dark plate, chamfered rim, label. game.js reads taps in the
  // bottom corners (x < 30 % or x > 70 %, y > 78 % of the canvas) on the pause screen and after a run.
  const CORNER_W = 176, CORNER_H = 38;
  function cornerButton(x, y, label, on, k) {
    gfx.rect(x, y, CORNER_W, CORNER_H, INK, 1, 0.5 * k);
    chamferRect(gfx, x, y, CORNER_W, CORNER_H, 7, 1.4, on ? CYAN : DIM, (on ? 0.9 : 0.55) * k, 3);
    txt(gfx, label, x + CORNER_W * 0.5, y + CORNER_H * 0.5 + 1, 11, on ? WHITE : PALE, 1.0 * k, 0.5, 2.4, 0.11, 3);
  }
  // A key with a short word on it (ESC).
  function wordKey(cx, cy, w, h, label, col, k) {
    const fy = keycap(gfx, cx, cy, w, h, col, k, 0, 0.7);
    txt(gfx, label, cx, fy, h * 0.36, col, k * 1.2, 0.5, 1.2, 0.11, 3);
  }

  // ------------------------------------------------------------------ pause
  function drawPause(f, W, H) {
    const v = S.pauseVis, cx = W * 0.5;
    gfx.rect(0, 0, W, H, SLOT, 1, 0.78 * v);
    gfx.push(); gfx.mulFade(v);
    gearColor(f.gearF, colG); mixColor(colG, WHITE, 0.6, colA);
    const y = 236, blink = 0.8 + 0.2 * Math.sin(S.t * 3.2);
    txt(gfx, 'PAUSED', cx + 4, y, 58, colA, 1.15 * blink, 0.5, 5, 0.085, 3.6);
    const w = txtW('PAUSED', 58, 5);
    gfx.line(cx - w * 0.5 - 40, y + 56, cx + w * 0.5 + 40, y + 56, 1.6, colA, 0.7, 3);
    gfx.line(cx - w * 0.5 - 40, y - 56, cx - w * 0.5 - 12, y - 56, 1.6, colA, 0.7, 3);
    gfx.line(cx + w * 0.5 + 40, y - 56, cx + w * 0.5 + 12, y - 56, 1.6, colA, 0.7, 3);
    drawLegend(f, cx, 420, W, 1.05);
    // how to get back into the run, and how to leave it for the main menu
    const ry = 648, rs = 14, rtr = 3, gap = 56, wMenu = txtW('MAIN MENU', rs, rtr);
    if (f.device === 'touch') txt(gfx, 'TAP TO RESUME', cx, ry, rs, WHITE, 1.1, 0.5, rtr, 0.11, 3.5);
    else if (f.device === 'gamepad') {
      const w0 = txtW('START  RESUME', rs, rtr), r = 13;
      let x = cx - (w0 + gap + r * 2 + 12 + wMenu) * 0.5;
      txt(gfx, 'START  RESUME', x, ry, rs, WHITE, 1.1, 0, rtr, 0.11, 3.5); x += w0 + gap;
      padButton(gfx, x + r, ry - 1, r, 'B', PALE, 0.95, 0); x += r * 2 + 12;
      txt(gfx, 'MAIN MENU', x, ry, rs, PALE, 1.0, 0, rtr, 0.11, 3.5);
    } else {
      const w0 = txtW('RESUME', rs, rtr), kw = 30, ew = 54;
      let x = cx - (kw + 14 + w0 + gap + kw + 8 + ew + 14 + wMenu) * 0.5;
      letterKey(gfx, x + kw * 0.5, ry - 2, kw, 'P', WHITE, 1.0); x += kw + 14;
      txt(gfx, 'RESUME', x, ry, rs, WHITE, 1.1, 0, rtr, 0.11, 3.5); x += w0 + gap;
      letterKey(gfx, x + kw * 0.5, ry - 2, kw, 'Q', PALE, 0.9); x += kw + 8;
      wordKey(x + ew * 0.5, ry - 2, ew, kw * 0.9, 'ESC', PALE, 0.9); x += ew + 14;
      txt(gfx, 'MAIN MENU', x, ry, rs, PALE, 1.0, 0, rtr, 0.11, 3.5);
    }
    if (f.device !== 'touch') drawFooter(f, cx, H - MARGIN - 4, false);
    else {
      // touch has no keys: the bottom corners of the pause screen are the comfort switch and the way out
      const by = H - MARGIN - CORNER_H - 12;
      cornerButton(MARGIN + 14, by, f.comfort ? 'COMFORT ON' : 'COMFORT OFF', f.comfort, 1);
      cornerButton(W - MARGIN - 14 - CORNER_W, by, 'MAIN MENU', false, 1);
    }
    gfx.pop();
  }

  // ------------------------------------------------------------------ frame hooks
  // The ground point under the runner, smoothed. It holds still while the runner flips through the
  // core (so the arc never rides up into the middle of the screen). Tracked here, not in update():
  // the game projects the runner at the top of its render, so this is where the numbers are fresh.
  function trackRunner(f) {
    if (f.air >= 0 && S.anchored) return;
    const far = Math.abs(f.runnerSX - S.ax) + Math.abs(f.runnerSY - S.ay) > 90;
    if (!S.anchored || far) { S.ax = f.runnerSX; S.ay = f.runnerSY; S.as = f.runnerS; S.anchored = f.air < 0; return; }
    const dt = Math.min(0.05, f.dt || 0.016);
    S.ax = damp(S.ax, f.runnerSX, 18, dt); S.ay = damp(S.ay, f.runnerSY, 18, dt); S.as = damp(S.as, f.runnerS, 18, dt);
  }

  function drawWorld(frame) {
    const W = gfx.W, H = gfx.H;
    trackRunner(frame);
    if (S.titleVis > 0.01) drawTitleWorld(frame, W, H);
    if (shards.count > 0) shards.draw(gfx);
    if (S.hudVis > 0.01 && S.arcIn > 0.001) drawLeadArc(frame);
    if (S.stT >= 0 && S.hudVis > 0.01) drawStamp(frame, W);
  }

  function draw(frame) {
    const W = gfx.W, H = gfx.H;
    if (S.hudVis > 0.01) {
      gfx.push(); gfx.mulFade(S.hudVis);
      drawGear(frame, W);
      drawScore(frame, W);
      // the sector banner sits exactly where the pause screen writes PAUSED: it steps aside
      if (S.pauseVis < 0.99) { gfx.push(); gfx.mulFade(1 - S.pauseVis); drawBanner(frame, W); gfx.pop(); }
      drawCrash(frame, W);
      gfx.pop();
      drawPrompt(frame, W, H);
    }
    if (S.pzVis > 0.01) drawPauseGlyph(W, H);
    if (S.titleVis > 0.01) drawTitle(frame, W, H);
    if (S.deadSeen && frame.mode !== 'title') drawResults(frame, W, H);
    if (S.pauseVis > 0.01) drawPause(frame, W, H);
    if (S.cfT >= 0) drawComfortToast();
  }

  return { onEvent, update, drawWorld, draw };
}
