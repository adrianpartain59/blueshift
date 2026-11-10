// game/vfx.js — game feel: every event the simulation fires gets its answer here. Shards that rake
// past the lens, sparks, the lance, light pulses down the ribs, the nova's presence at the screen
// edges, speed dressing, camera kicks and every fx.* trigger (this is the only module that calls fx).
//
// Rules this file keeps (DESIGN.md, readability): effects decay within ~250 ms unless they are a set
// piece; nothing long-lived sits over the tube centre; yellow/white = ICE debris and the lance,
// cyan/white = the runner's own sparks, magenta = crash feedback only, orange-gold = the nova and
// only at the screen edges. Aberration, blur and glow are ~0 at screen centre.
import { TAU, clamp, clamp01, lerp, hash1, noise1, makeRng, mixColor, ease } from '../engine/math.js';
import { drawText } from '../engine/font.js';
import { APOTHEM, LANE_ANGLE, LANE_W, RIB_SPACING, LANES, C } from './config.js';
import { gearColor, CORNER_X, CORNER_Y } from './tube.js';
import { createPool3, P_SPARK, P_HEX, P_TRI, P_SPLINTER, P_GLOW } from './vfx_pool.js';

const WHITE = C.white, HOT = C.iceHot, ICE = C.ice, YOU = C.you, NOVA0 = C.nova0, NOVA1 = C.nova1, SOLID = C.solid;
const CAM_BACK = 8;            // matches camera.js: the lens sits 8 m behind the runner

// ---- the ICE lattice: where shards are born. Flat-top hexes of circumradius R tiling a disc.
function lattice(R, maxR, octagon) {
  const xs = [], ys = [];
  const dx = 1.5 * R, dy = Math.sqrt(3) * R;
  const nc = Math.ceil(maxR / dx) + 1, nr = Math.ceil(maxR / dy) + 1;
  for (let c = -nc; c <= nc; c++) {
    for (let r = -nr; r <= nr; r++) {
      const px = c * dx, py = r * dy + (c & 1 ? dy * 0.5 : 0);
      if (octagon) {
        let inside = true;
        for (let i = 0; i < LANES; i++) { const a = i * LANE_ANGLE; if (px * Math.sin(a) - py * Math.cos(a) > maxR) inside = false; }
        if (!inside) continue;
      } else if (Math.hypot(px, py) > maxR) continue;
      xs.push(px); ys.push(py);
    }
  }
  return { n: xs.length, x: new Float32Array(xs), y: new Float32Array(ys), R };
}
const FINE = lattice(0.5, APOTHEM - 0.15, true);     // ~125 cells across the tube mouth
const COARSE = lattice(1.15, 9.2, false);            // the big plates of a shutter or a sector gate

// ---- stateless dressing tables (hash-seeded once, so captures are reproducible)
const MOTE_N = 84, EMB_N = 96, SL_N = 40, EDGE_N = 48, IMP_N = 18;
const MOTE_A = new Float32Array(MOTE_N), MOTE_R = new Float32Array(MOTE_N), MOTE_P = new Float32Array(MOTE_N), MOTE_S = new Float32Array(MOTE_N);
for (let i = 0; i < MOTE_N; i++) { MOTE_A[i] = hash1(i * 7 + 1) * TAU; MOTE_R[i] = hash1(i * 7 + 2); MOTE_P[i] = hash1(i * 7 + 3); MOTE_S[i] = hash1(i * 7 + 4); }
const EMB_A = new Float32Array(EMB_N), EMB_R = new Float32Array(EMB_N), EMB_P = new Float32Array(EMB_N), EMB_S = new Float32Array(EMB_N), EMB_H = new Float32Array(EMB_N);
for (let i = 0; i < EMB_N; i++) { EMB_A[i] = hash1(i * 11 + 501) * TAU; EMB_R[i] = hash1(i * 11 + 502); EMB_P[i] = hash1(i * 11 + 503); EMB_S[i] = hash1(i * 11 + 504); EMB_H[i] = hash1(i * 11 + 505); }
const SL_A = new Float32Array(SL_N), SL_P = new Float32Array(SL_N), SL_S = new Float32Array(SL_N), SL_H = new Float32Array(SL_N);
for (let i = 0; i < SL_N; i++) { SL_A[i] = ((i + hash1(i * 5 + 901) * 0.8) / SL_N) * TAU; SL_P[i] = hash1(i * 5 + 902); SL_S[i] = hash1(i * 5 + 903); SL_H[i] = hash1(i * 5 + 904); }

const PERFECT_X = [];
for (let i = 0; i < 100; i++) PERFECT_X.push(i < 2 ? 'PERFECT' : 'PERFECT ×' + i);
const TXT = { tracking: 0.5, weight: 0.11, glow: 4, slant: 0.2 };
const TXT_ECHO = { tracking: 0.5, weight: 0.24, glow: 3, slant: 0.2 };

export function createVfx(gfx, cam, fx) {
  const rng = makeRng(0x51ab07);
  const pool = createPool3(900, 0x9e3779);
  const kick = { fov: 0, back: 0, dip: 0 };
  const sc = [0, 0, 0], sc2 = [0, 0, 0], gcol = [0, 0, 0], gwhite = [0, 0, 0];
  const EX0 = new Float32Array(EDGE_N + 1), EY0 = new Float32Array(EDGE_N + 1), EX1 = new Float32Array(EDGE_N + 1), EY1 = new Float32Array(EDGE_N + 1);
  const IMP_A = new Float32Array(IMP_N), IMP_L = new Float32Array(IMP_N), IMP_K = new Float32Array(IMP_N);

  // ---- effect slots (fixed pools of plain objects, reused forever)
  const mk = (n, f) => { const a = []; for (let i = 0; i < n; i++) a.push(f()); return a; };
  const pulses = mk(6, () => ({ life: 0, maxLife: 1, z: 0, v: 0, band: 20, k: 1, w: 0.14, col: [1, 1, 1] }));
  const rings = mk(10, () => ({ life: 0, maxLife: 1, x: 0, y: 0, z: 0, vz: 0, r0: 0, r1: 1, w: 0.05, k: 1, col: [1, 1, 1] }));
  const floors = mk(3, () => ({ life: 0, maxLife: 1, x: 0, y: 0, tx: 1, ty: 0, z: 0, vz: 0, r1: 3 }));
  const flybys = mk(4, () => ({ life: 0, maxLife: 1, x: 0, y: 0, ux: 0, uy: 1, spd: 60, k: 1 }));
  const bolts = mk(3, () => ({ life: 0, x: 0, y: 0, t: 0 }));
  const judges = mk(1, () => ({ on: false, str: '', t: 0, size: 1, k: 1, tilt: 0, h: 4.4, col: [1, 1, 1] }));
  const srings = mk(4, () => ({ life: 0, maxLife: 1, x: 0, y: 0, r1: 900, w: 8, k: 1, col: [1, 1, 1] }));
  const SHIM_L = { x: -0.22, y: 0.5, radius: 0.5, width: 0.12, strength: 0 };
  const SHIM_R = { x: 1.22, y: 0.5, radius: 0.5, width: 0.12, strength: 0 };

  // ---- state
  let cm = 1;                          // comfort multiplier (0.5 when reduced motion is on)
  let comfort = false;                 // reduced motion: no full-screen flash or exposure kick at all
  let lastT = -1e9, time = 0, speed = 48;
  let fovP = 0, fovV = 0, fovRest = 0, backP = 0, backV = 0, dipP = 0, dipV = 0;
  let heat = 0, igniteK = 0, lungeK = 0, crashK = 0, crashAmt = 1, dimK = 0, lineBoost = 0, lowPulse = 0, lowLevel = 0;
  let lanceT = -1, lanceX = 0, lanceY = 0;
  let impT = -1, impX = 0, impY = 0, impPow = 1;
  let grindAcc = 0, grindGlow = 0, grindSide = 0;
  let deathT = -1, flipT = -1, rollGlow = 0, rollGX = 0, rollGY = 0, lastBigHit = -9;
  let lastHitT = -9, lastFlashT = -9;  // real time of the last breach hit / the last full-screen flash

  function reset() {
    pool.clear();
    for (const p of pulses) p.life = 0;
    for (const p of rings) p.life = 0;
    for (const p of floors) p.life = 0;
    for (const p of flybys) p.life = 0;
    for (const p of bolts) p.life = 0;
    for (const p of judges) p.on = false;
    for (const p of srings) p.life = 0;
    fovP = fovV = fovRest = backP = backV = dipP = dipV = 0;
    heat = igniteK = lungeK = crashK = dimK = lineBoost = lowPulse = 0; lowLevel = 0;
    lanceT = impT = deathT = flipT = -1; grindAcc = grindGlow = rollGlow = 0; grindSide = 0;
    lastHitT = lastFlashT = lastBigHit = -9;
  }

  // ---- slot helpers (take the free slot, else the one closest to dying)
  function slot(arr) {
    let s = arr[0];
    for (let i = 0; i < arr.length; i++) { const c = arr[i]; if (c.life <= 0) return c; if (c.life < s.life) s = c; }
    return s;
  }
  function addPulse(z, v, band, life, col, k, w) {
    const p = slot(pulses);
    p.z = z; p.v = v; p.band = band; p.life = p.maxLife = life; p.k = k; p.w = w; p.col[0] = col[0]; p.col[1] = col[1]; p.col[2] = col[2];
  }
  function addRing(x, y, z, vz, r0, r1, life, col, k, w) {
    const p = slot(rings);
    p.x = x; p.y = y; p.z = z; p.vz = vz; p.r0 = r0; p.r1 = r1; p.life = p.maxLife = life; p.k = k; p.w = w; p.col[0] = col[0]; p.col[1] = col[1]; p.col[2] = col[2];
  }
  function addScreenRing(x, y, r1, life, col, k, w) {
    const p = slot(srings);
    p.x = x; p.y = y; p.r1 = r1; p.life = p.maxLife = life; p.k = k; p.w = w; p.col[0] = col[0]; p.col[1] = col[1]; p.col[2] = col[2];
  }
  function fovPunch(deg) { fovP = Math.min(22, fovP + deg * cm); }
  // Every full-screen brightness pulse goes through these two, so comfort mode can have none of them.
  function flash(col, amount, decay) { if (!comfort) fx.flash(col, amount, decay); }
  function expKick(amount, decay) { if (!comfort) fx.exposureKick(amount, decay); }

  // Sparks in the plane spanned by (ax1, up): angle phi from a0..a1, speed s0..s1, plus a z velocity.
  // gUp pulls them back toward the floor. Colour runs colA -> colB at random.
  function sparks(n, ox, oy, oz, e1x, e1y, e2x, e2y, a0, a1, s0, s1, vz0, vz1, l0, l1, colA, colB, k, gUp, wd) {
    for (let i = 0; i < n; i++) {
      const phi = a0 + (a1 - a0) * rng(), s = s0 + (s1 - s0) * rng();
      const c = Math.cos(phi) * s, sn = Math.sin(phi) * s;
      mixColor(colA, colB, rng(), sc);
      const j = pool.add(P_SPARK, ox, oy, oz, e1x * c + e2x * sn, e1y * c + e2y * sn, vz0 + (vz1 - vz0) * rng(), l0 + (l1 - l0) * rng(), 0, sc, k * (0.6 + 0.8 * rng()));
      pool.ax[j] = -e2x * gUp; pool.ay[j] = -e2y * gUp; pool.w[j] = wd; pool.streak[j] = 0.03 + 0.02 * rng();
    }
  }

  // The wall plane at the runner's depth bursts along its lattice. `reach` limits the burst to cells
  // near the impact (a pylon, or ICE in the core); `white` 0..1 pushes yellow toward white-hot.
  function burstLattice(lat, frame, reach, white, sizeK, kK, zBase, keep) {
    const ix = frame.runnerX + frame.upX * 0.9, iy = frame.runnerY + frame.upY * 0.9;
    const S = 34 + 0.25 * speed;       // how fast the debris falls back past the lens (tamed at high gear so it still reads)
    for (let c = 0; c < lat.n; c++) {
      const px = lat.x[c], py = lat.y[c];
      const dx = px - ix, dy = py - iy, d = Math.hypot(dx, dy) + 1e-3;
      if (d > reach) continue;
      if (keep < 1 && rng() > keep) continue;
      const near = Math.exp(-d * 0.32);  // 1 at the impact point: those cells get punched forward hardest
      const out = 2.5 + 6 * rng() + near * 9;
      const r = rng();
      const kd = r < 0.46 ? P_HEX : r < 0.84 ? P_TRI : P_SPLINTER;
      const sz = lat.R * sizeK * (kd === P_HEX ? 0.8 + 0.16 * rng() : kd === P_TRI ? 0.55 + 0.5 * rng() : 0.6 + 0.9 * rng());
      mixColor(ICE, r > 0.5 ? WHITE : HOT, clamp01(white * (0.4 + 0.8 * rng())), sc);
      const j = pool.add(kd, px + (rng() - 0.5) * 0.08, py + (rng() - 0.5) * 0.08, zBase + rng() * 0.5,
        (dx / d) * out + (rng() - 0.5) * 4, (dy / d) * out + (rng() - 0.5) * 4,
        -S * 0.1 + near * S * (0.5 + 0.7 * rng()) + (rng() - 0.5) * 10,
        0.5 + 0.45 * rng(), sz, sc, kK * (1.15 + 0.75 * rng()));
      pool.drag[j] = 4.2 + 3.4 * rng(); pool.rest[j] = -S * (0.85 + 0.45 * rng());
      pool.spinA[j] = (rng() - 0.5) * 12; pool.spinB[j] = (rng() - 0.5) * 22;
      pool.rotB[j] = (rng() - 0.5) * 0.5;          // starts face-on (it was a wall), then tumbles
      pool.w[j] = 0.035 + 0.02 * sizeK;
    }
  }

  // Only one stamp is ever alive: in a fill the new grade replaces the old one instead of stacking on it.
  // `h` is its height above the runner's lane floor (the tube axis is APOTHEM up).
  function addJudge(str, size, col, k, h) {
    const s = judges[0];
    s.on = true; s.str = str; s.t = 0; s.size = size; s.k = k; s.h = h; s.tilt = (rng() - 0.5) * 0.14;
    s.col[0] = col[0]; s.col[1] = col[1]; s.col[2] = col[2];
  }

  // ---------------------------------------------------------------- events
  function doBreach(frame) {
    lanceT = 0; lanceX = frame.runnerX + frame.upX * 0.85; lanceY = frame.runnerY + frame.upY * 0.85;
    const b = slot(bolts); b.life = 0.3; b.t = 0; b.x = frame.runnerX + frame.upX * 0.07; b.y = frame.runnerY + frame.upY * 0.07;
    fovPunch(5);
    fx.aberrate(0.004 * cm, 16);
    lineBoost = Math.max(lineBoost, 0.35);
  }

  // The judgement, flying with the debris (not behind the title: there it would fly through the logo).
  // Anchored above the tube axis so the vanishing point, where the next hazard is, stays readable.
  function stampJudge(grade, kind, chain, frame) {
    if (frame.attract) return;
    const perfect = grade === 'perfect', big = kind === 'gate' || kind === 'shutter', local = kind === 'pylon' || kind === 'core';
    const esc = Math.min(chain, 8) / 8;
    const size = (perfect ? 0.95 : 0.72) * (big ? 1.3 : local ? 0.8 : 1) * (1 + (big ? 0.2 : 0.5) * esc);
    mixColor(ICE, WHITE, perfect ? 0.85 : 0.1, sc);
    addJudge(perfect ? PERFECT_X[Math.min(chain, 99)] : 'GOOD', size, sc, perfect ? 1.9 : 1.35, 6.6 + 0.8 * size);
  }

  function doBreachHit(grade, kind, chain, frame, auto) {
    const perfect = grade === 'perfect';
    const big = kind === 'gate' || kind === 'shutter';
    const local = kind === 'pylon' || kind === 'core';
    const esc = Math.min(chain, 8) / 8;
    const power = (perfect ? 1 : 0.78) * (big ? 1.45 : local ? 0.6 : 1) * (1 + esc * 0.3);
    const white = perfect ? 0.3 + 0.4 * esc : 0.08;
    const ix = frame.runnerX + frame.upX * 0.9, iy = frame.runnerY + frame.upY * 0.9;
    // walls an 8th note apart: thin the debris of the later ones so the next wall can be seen through it
    const rapid = time - lastHitT < 0.3; lastHitT = time;
    // debris
    burstLattice(FINE, frame, local ? 2.5 : 99, white, big ? 1.15 : 1, perfect ? 1.1 : 0.9, 0.1, rapid && !big ? 0.4 : 1);
    if (big) { burstLattice(COARSE, frame, 99, white, 1, 0.9, 0.6, 0.55); lastBigHit = time; }
    // glass dust: a forward cone of fast sparks from the impact point
    sparks(Math.round(34 * power), ix, iy, 0.3, 1, 0, 0, 1, 0, TAU, 3, 22, -speed * 0.2, speed * 0.9, 0.12, 0.3, HOT, WHITE, 1.6, 0, 0.04);
    // the impact frame: crack rays across the wall plane + a hot core
    impT = 0; impX = ix; impY = iy; impPow = power;
    for (let i = 0; i < IMP_N; i++) { IMP_A[i] = ((i + rng() * 0.7) / IMP_N) * TAU; IMP_L[i] = (local ? 1.5 : 2.6) + rng() * (local ? 1.5 : 4.2); IMP_K[i] = 0.5 + rng(); }
    // light races away down the ribs
    mixColor(ICE, WHITE, perfect ? 0.6 : 0.2, sc);
    addPulse(0, 520, 22 + 8 * power, 0.75, sc, 1.5 * power, 0.14);
    if (big) addPulse(-4, 300, 34, 1.0, sc, 1.0, 0.18);
    // a shutter that broke itself earned no grade (a late press is stamped by breachCredit instead)
    if (!auto) stampJudge(grade, kind, chain, frame);
    // screen
    fx.shockwave(frame.runnerSX / gfx.W, frame.runnerSY / gfx.H, 0.032 * power * (0.5 + 0.5 * cm), 1.5, 0.5, 0.08);
    // at most one white flash per 0.34 s (three a second), however fast the walls come
    if (time - lastFlashT >= 0.34) {
      lastFlashT = time;
      flash(WHITE, Math.min(0.95, 0.3 + 0.22 * power) * cm * (rapid ? 0.5 : 1), 50);
      expKick(0.25 * power, 9);
    }
    fx.aberrate(0.013 * power * cm, 10);
    fx.shake(Math.min(0.9, 0.44 * power) * cm);
    fx.radialBlur(0.05 * power * cm, 9);
    fx.zoomPunch(0.018 * power * cm);
    fovPunch(14 * Math.min(1.3, power));
    lineBoost = Math.max(lineBoost, 0.7 * power);
  }

  function doDrop(frame) {
    // the set piece: the debris of the whole conduit mouth, a wall of light, everything at eleven
    burstLattice(COARSE, frame, 99, 0.5, 1.4, 1.0, 1.5, 0.4);
    if (time - lastBigHit > 0.2) { burstLattice(FINE, frame, 99, 0.4, 1.15, 1.0, 0.1, 1); burstLattice(COARSE, frame, 99, 0.4, 1, 0.9, 0.6, 0.5); }
    sparks(70, frame.runnerX + frame.upX, frame.runnerY + frame.upY, 0.5, 1, 0, 0, 1, 0, TAU, 6, 34, -speed * 0.6, speed * 1.2, 0.2, 0.5, HOT, WHITE, 1.8, 0, 0.05);
    addPulse(0, 420, 46, 1.2, WHITE, 2.2, 0.2);
    addScreenRing(frame.runnerSX, frame.runnerSY, gfx.W * 1.1, 0.5, HOT, 2.2, 14);
    fx.shockwave(frame.runnerSX / gfx.W, frame.runnerSY / gfx.H, 0.06 * (0.5 + 0.5 * cm), 1.25, 0.8, 0.12);
    flash(WHITE, 0.95 * cm, 38); lastFlashT = time;
    fx.shake(0.95 * cm);
    fx.aberrate(0.022 * cm, 6);
    fx.radialBlur(0.12 * cm, 5);
    expKick(0.4, 7);
    fx.zoomPunch(0.035 * cm);
    fovPunch(10);
    lineBoost = 1.4;
  }

  function doNovaIgnite(frame) {
    igniteK = 1;
    // a wave of gold sweeping forward from behind the lens, and a first gust of embers with it
    addPulse(-CAM_BACK - 30, 190, 60, 2.0, NOVA1, 1.6, 0.2);
    addPulse(-CAM_BACK - 90, 190, 40, 2.4, NOVA0, 0.9, 0.16);
    for (let i = 0; i < 70; i++) {
      const a = rng() * TAU, r = 5.8 + rng() * 7;
      mixColor(NOVA0, NOVA1, rng(), sc);
      const j = pool.add(P_SPARK, Math.sin(a) * r, -Math.cos(a) * r, -CAM_BACK - 4 - rng() * 60, (rng() - 0.5) * 2, (rng() - 0.5) * 2, 70 + rng() * 120, 1.0 + rng() * 0.9, 0, sc, 1.2 + rng());
      pool.w[j] = 0.05 + rng() * 0.06; pool.streak[j] = 0.04;
    }
  }

  function doRoll(ev, frame) {
    fx.aberrate(0.0035 * cm, 18);
    if (ev.air) return;
    const a = ev.lane * LANE_ANGLE, dir = ev.dir || 1;
    const fxp = Math.sin(a) * APOTHEM, fyp = -Math.cos(a) * APOTHEM, ux = -Math.sin(a), uy = Math.cos(a), tx = Math.cos(a) * dir, ty = Math.sin(a) * dir;
    // the blades bite the rail they just crossed: sparks skid on in the direction of travel
    sparks(18, fxp - tx * LANE_W * 0.3 + ux * 0.05, fyp - ty * LANE_W * 0.3 + uy * 0.05, 0.2, tx, ty, ux, uy, 0.05, 0.95, 7, 22, -speed * 0.3, -speed * 0.04, 0.16, 0.36, YOU, WHITE, 1.8, 26, 0.055);
    rollGlow = 1; rollGX = fxp - tx * LANE_W * 0.3 + ux * 0.1; rollGY = fyp - ty * LANE_W * 0.3 + uy * 0.1;
  }

  function grindBurst(side, n, frame) {
    const tx = frame.upY * side, ty = -frame.upX * side;
    const ox = frame.runnerX + tx * LANE_W * 0.46 + frame.upX * 0.1, oy = frame.runnerY + ty * LANE_W * 0.46 + frame.upY * 0.1;
    // fountain: up off the fin's edge and back over the runner's shoulder
    sparks(n, ox, oy, 0.2 + rng() * 0.6, -tx, -ty, frame.upX, frame.upY, 0.75, 1.9, 6, 17, -speed * 0.2, -speed * 0.02, 0.2, 0.46, YOU, WHITE, 1.7, 30, 0.05);
  }

  function doFlip(ev, frame) {
    flipT = 0;
    const tx = frame.upY, ty = -frame.upX;
    sparks(16, frame.runnerX, frame.runnerY, 0.2, tx, ty, frame.upX, frame.upY, 0, Math.PI, 4, 12, -speed * 0.6, -speed * 0.1, 0.15, 0.32, YOU, WHITE, 1.4, 10, 0.04);
    addRing(frame.runnerX + frame.upX * 0.4, frame.runnerY + frame.upY * 0.4, 0.1, -speed * 0.3, 0.4, 2.6, 0.22, ev.clean ? WHITE : YOU, ev.clean ? 2 : 1.3, 0.06);
    fovPunch(ev.clean ? 5 : 3);
    fx.aberrate(0.005 * cm, 10);
  }

  function doLand(ev, frame) {
    flipT = -1;
    const a = ev.lane * LANE_ANGLE;
    const fxp = Math.sin(a) * APOTHEM, fyp = -Math.cos(a) * APOTHEM, ux = -Math.sin(a), uy = Math.cos(a), tx = Math.cos(a), ty = Math.sin(a);
    const f = slot(floors);
    f.life = f.maxLife = 0.36; f.x = fxp + ux * 0.06; f.y = fyp + uy * 0.06; f.tx = tx; f.ty = ty; f.z = 0.3; f.vz = 46; f.r1 = 3.4;
    // a ring of sparks that the landing throws up the lane
    for (let i = 0; i < 24; i++) {
      const phi = (i / 24) * TAU, c = Math.cos(phi), s = Math.sin(phi);
      mixColor(YOU, WHITE, rng(), sc);
      const j = pool.add(P_SPARK, fxp + ux * 0.08, fyp + uy * 0.08, 0.2, tx * c * 7 + ux * (1 + rng() * 3), ty * c * 7 + uy * (1 + rng() * 3), 34 + s * 14 + rng() * 6, 0.22 + rng() * 0.16, 0, sc, 1.6);
      pool.drag[j] = 2.5; pool.rest[j] = 8; pool.w[j] = 0.045; pool.ax[j] = -ux * 10; pool.ay[j] = -uy * 10;
    }
    dipV += 9.5 * cm;
    fx.shake(0.24 * cm);
    fx.aberrate(0.006 * cm, 12);
  }

  function doGraze(side, frame, n) {
    const tx = frame.upY * side, ty = -frame.upX * side;
    const ox = frame.runnerX + tx * LANE_W * 0.5 + frame.upX * 0.7, oy = frame.runnerY + ty * LANE_W * 0.5 + frame.upY * 0.7;
    // a fan thrown off the passing slab, away from it and back along its face
    sparks(n, ox, oy, 0.4, -tx, -ty, frame.upX, frame.upY, -0.5, 1.35, 4, 15, -speed * 1.0, -speed * 0.35, 0.14, 0.3, WHITE, YOU, 1.6, 6, 0.04);
    // and the slab's edge itself, whipping past at hip height
    const f = slot(flybys);
    f.life = f.maxLife = 0.13; f.spd = speed * 1.2 + 30; f.k = 1.5;
    f.x = ox; f.y = oy; f.ux = frame.upX; f.uy = frame.upY;
  }

  function doFlyby(ev, frame) {
    const f = slot(flybys);
    const side = ev.side || 0;
    f.life = f.maxLife = 0.17; f.spd = speed * 1.25 + 30; f.k = 0.75;
    const tx = frame.upY, ty = -frame.upX;
    const lat = side * LANE_W * 0.95, up = side === 0 ? 3.5 : 0.9;
    f.x = frame.runnerX + tx * lat + frame.upX * up; f.y = frame.runnerY + ty * lat + frame.upY * up;
    f.ux = frame.upX; f.uy = frame.upY;
  }

  function doPickup(frame, big, n) {
    const ox = frame.runnerX + frame.upX * 0.8, oy = frame.runnerY + frame.upY * 0.8;
    const esc = Math.min(n || 1, 6);
    sparks(big ? 9 + esc : 4, ox, oy, 0.3, 1, 0, 0, 1, 0, TAU, 3, big ? 10 : 6, -speed * 0.4, -speed * 0.05, 0.12, 0.26, YOU, WHITE, 1.4, 0, 0.035);
    addRing(ox, oy, 0.2, -speed * 0.25, 0.15, big ? 1.5 + esc * 0.12 : 0.7, big ? 0.2 : 0.13, YOU, big ? 1.6 : 1.0, 0.045);
  }

  function doGearUp(ev, frame) {
    const g = clamp((ev.gear || frame.gear) | 0, 1, 5);
    mixColor(C.gear[g], WHITE, 0.45, sc);
    addScreenRing(frame.runnerSX, frame.runnerSY, gfx.W * 0.95, 0.45, sc, 1.7, 9);
    addScreenRing(frame.runnerSX, frame.runnerSY, gfx.W * 0.7, 0.6, sc, 0.8, 4);
    addPulse(0, 440, 30, 0.9, sc, 1.3, 0.14);
    fovPunch(6);
    fx.radialBlur(0.07 * cm, 5);
    expKick(0.22, 6);
    fx.aberrate(0.006 * cm, 8);
    lineBoost = Math.max(lineBoost, 1.2);
  }

  function doCrash(frame, amt) {
    crashK = 1; crashAmt = amt;
    backV += 42 * amt * (0.5 + 0.5 * cm);
    if (frame.novaOn) lungeK = Math.max(lungeK, amt);
    fx.glitch(0.9 * amt * cm + (amt < 1 ? 0.12 : 0), 0.3);
    fx.desaturate(0.45 * amt, 5);
    fx.shake(0.8 * amt * cm);
    fx.aberrate(0.022 * amt * cm, 7);
    flash(SOLID, 0.16 * amt * cm, 22);
    fx.punch(0, 14 * amt * cm);
    // the runner's light knocked loose: magenta shrapnel thrown back at the lens
    const ox = frame.runnerX + frame.upX * 0.8, oy = frame.runnerY + frame.upY * 0.8;
    const n = Math.round(34 * amt + 2);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, s = 3 + rng() * 12, r = rng();
      mixColor(SOLID, WHITE, r > 0.8 ? 0.6 : 0.05, sc);
      const j = pool.add(r < 0.45 ? P_SPLINTER : r < 0.7 ? P_TRI : P_SPARK, ox, oy, 0.6, Math.cos(a) * s, Math.sin(a) * s, -speed * (0.1 + 0.5 * rng()), 0.3 + 0.35 * rng(), 0.18 + 0.3 * rng(), sc, 1.7);
      pool.drag[j] = 3; pool.rest[j] = -speed * 0.7; pool.spinA[j] = (rng() - 0.5) * 14; pool.spinB[j] = (rng() - 0.5) * 24; pool.w[j] = 0.045;
    }
    addRing(ox, oy, 0.5, -speed * 0.2, 0.3, 3.2 * amt + 0.6, 0.2, SOLID, 2 * amt + 0.4, 0.07);
  }

  function doDeath(frame) {
    if (deathT >= 0) return;
    deathT = 0;
    fx.shake(0.7 * cm);
    fx.aberrate(0.02 * cm, 3);
    fx.radialBlur(0.1 * cm, 2.5);
    // the runner comes apart and is pulled forward into the light
    for (let i = 0; i < 90; i++) {
      const h = rng() * 1.7, lat = (rng() - 0.5) * 0.7, a = rng() * TAU, s = 1 + rng() * 5;
      const ox = frame.runnerX + frame.upX * h + frame.upY * lat, oy = frame.runnerY + frame.upY * h - frame.upX * lat;
      mixColor(YOU, WHITE, rng(), sc);
      const j = pool.add(i % 3 === 0 ? P_GLOW : P_SPARK, ox, oy, rng() * 0.6, Math.cos(a) * s, Math.sin(a) * s, 4 + rng() * 14, 0.5 + rng() * 0.6, 0.16 + rng() * 0.2, sc, 1.6 + rng());
      pool.drag[j] = 1.2 + rng() * 2.2; pool.rest[j] = 60 + rng() * 80; pool.w[j] = 0.05; pool.streak[j] = 0.045;
    }
  }

  function onEvent(ev, frame) {
    comfort = !!frame.comfort;
    cm = (comfort ? 0.5 : 1) * (frame.attract ? 0.6 : 1);   // softer behind the title too
    speed = frame.speed;
    switch (ev.type) {
      case 'start': case 'title': reset(); break;
      case 'pip': {
        const n = ev.n || 1;
        fovRest = -1.6 * n;                       // the lens pulls in a notch per pip: a held breath
        // (no ring here: the courier's own collapsing floor ring marks the pip, under the shutter's countdown ring)
        sparks(5 + 4 * n, frame.runnerX, frame.runnerY, 0.1, frame.upY, -frame.upX, frame.upX, frame.upY, 0.3, Math.PI - 0.3, 1.5, 4 + 2 * n, -2, 2, 0.25, 0.5, YOU, WHITE, 1.2, 4, 0.035);
        mixColor(YOU, WHITE, 0.3, sc);
        addPulse(0, 260, 14, 0.5, sc, 0.5 + 0.25 * n, 0.12);
        fx.aberrate(0.003 * n * cm, 12);
        break;
      }
      case 'launch':
        fovRest = 0; fovPunch(12);
        // exhaust: the clamps let go and the barrel is full of sparks blown back at the lens
        sparks(46, frame.runnerX + frame.upX * 0.3, frame.runnerY + frame.upY * 0.3, -0.2, frame.upY, -frame.upX, frame.upX, frame.upY, 0, TAU, 1, 9, -70, -18, 0.2, 0.5, YOU, WHITE, 1.6, 0, 0.045);
        mixColor(YOU, WHITE, 0.5, sc);
        addPulse(0, 520, 26, 0.7, sc, 1.3, 0.14);
        fx.radialBlur(0.1 * cm, 4); fx.shake(0.35 * cm); expKick(0.3, 6);
        lineBoost = 1.3;
        break;
      case 'breach': doBreach(frame); break;
      case 'breachHit': doBreachHit(ev.grade, ev.kind, ev.chain | 0, frame, !!ev.auto); break;
      // a press just behind a shutter that broke itself: the grade is the player's, the break already happened
      case 'breachCredit': stampJudge(ev.grade, ev.kind, ev.chain | 0, frame); break;
      case 'whiff': fx.aberrate(0.003 * cm, 20); dimK = Math.max(dimK, 0.25); break;
      case 'drop': doDrop(frame); break;
      case 'novaIgnite': doNovaIgnite(frame); break;
      case 'roll': doRoll(ev, frame); break;
      case 'rollRefused': grindBurst(ev.dir || 1, 14, frame); grindSide = ev.dir || 1; grindGlow = 1; fx.aberrate(0.004 * cm, 14); break;
      case 'grind': grindBurst(ev.side || frame.grind || 1, 18, frame); grindSide = ev.side || frame.grind || 1; grindGlow = 1; fx.aberrate(0.004 * cm, 14); break;
      case 'grindEnd': grindSide = 0; break;
      case 'flip': doFlip(ev, frame); break;
      case 'land': doLand(ev, frame); break;
      case 'graze': doGraze(ev.side || 1, frame, 20); fx.aberrate(0.004 * cm, 14); break;
      case 'thread': doGraze(-1, frame, 18); doGraze(1, frame, 18); flash(WHITE, 0.1 * cm, 45); fx.aberrate(0.007 * cm, 12); fovPunch(2.5); break;
      case 'irisPass': {
        // the rim of the hole whips past the lens
        const col = ev.clean ? WHITE : YOU;
        addRing(0, 0, 3, -speed * 1.5 - 30, 3.1, 3.5, 0.14, col, ev.clean ? 1.8 : 1.1, 0.09);
        break;
      }
      case 'orb': doPickup(frame, true, ev.n); break;
      case 'spark': doPickup(frame, false, 1); break;
      case 'flyby': doFlyby(ev, frame); break;
      case 'gearUp': doGearUp(ev, frame); break;
      case 'gearDown': dimK = 1; fovP -= 3 * cm; break;
      case 'crash': doCrash(frame, 1); break;
      case 'stumble': doCrash(frame, 0.1); break;
      case 'sectorGate':
        addScreenRing(frame.runnerSX, frame.runnerSY, gfx.W * 1.2, 0.6, WHITE, 2.2, 12);
        addPulse(0, 380, 50, 1.2, WHITE, 1.8, 0.2);
        expKick(0.4, 4); lineBoost = 1.5;
        break;
      case 'leadLow': lowPulse = 1; fx.aberrate(0.006 * cm, 8); break;
      case 'death': doDeath(frame); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- update
  function update(dt, frame) {
    comfort = !!frame.comfort;
    cm = (comfort ? 0.5 : 1) * (frame.attract ? 0.6 : 1);   // softer behind the title too
    time = frame.time; speed = frame.speed;
    if (frame.paused) { lastT = frame.t; return; }   // a paused game holds every particle where it is
    // visual time includes hit-stop: debris holds its breath on the impact frame, then catches up
    let vdt = frame.t - lastT; lastT = frame.t;
    if (!(vdt >= 0) || vdt > dt * 3 + 0.05) vdt = dt;
    const sdt = Math.max(vdt, dt * 0.12);

    // camera springs
    const sub = dt > 0.012 ? Math.ceil(dt / 0.008) : 1, h = dt / sub;
    for (let i = 0; i < sub; i++) {
      fovV += (-(fovP - fovRest) * 300 - fovV * 27) * h; fovP += fovV * h;
      backV += (-backP * 95 - backV * 11.5) * h; backP += backV * h;
      dipV += (-dipP * 340 - dipV * 21) * h; dipP += dipV * h;
    }
    kick.fov = fovP; kick.back = backP; kick.dip = dipP;

    igniteK *= Math.exp(-dt * 1.0); lungeK *= Math.exp(-dt * 2.6); dimK *= Math.exp(-dt * 3.2);
    lineBoost *= Math.exp(-dt * 2.8); lowPulse *= Math.exp(-dt * 3); grindGlow *= Math.exp(-dt * 7); rollGlow *= Math.exp(-dt * 14);
    if (crashK > 0) crashK = Math.max(0, crashK - dt / 0.45);
    const target = frame.novaOn ? frame.danger : 0;
    heat += (target - heat) * (1 - Math.exp(-dt * 5));
    lowLevel = frame.novaOn && !frame.dead ? (frame.lead < 40 ? 2 : frame.lead < 80 ? 1 : 0) : 0;
    if (frame.dead && deathT < 0) doDeath(frame);
    if (!frame.dead && deathT >= 0 && frame.mode !== 'dead' && frame.mode !== 'results') deathT = -1;
    if (deathT >= 0) deathT += dt;

    // flip: the blur winds up through the core and lets go on landing
    if (frame.air >= 0) { const a = clamp01(frame.air); fx.radialBlur((0.012 + 0.075 * a * Math.sqrt(a)) * cm, 12); }

    // grind: a continuous fountain on the fin side
    if (frame.grind !== 0 && !frame.dead) {
      grindSide = frame.grind; grindGlow = Math.max(grindGlow, 0.6);
      grindAcc += dt * 140;
      const n = Math.floor(grindAcc); grindAcc -= n;
      if (n > 0) grindBurst(grindSide, Math.min(n, 6), frame);
    }

    if (lanceT >= 0) { lanceT += dt; if (lanceT > 0.2) lanceT = -1; }
    if (impT >= 0) { impT += dt; if (impT > 0.16) impT = -1; }
    for (let i = 0; i < bolts.length; i++) { const b = bolts[i]; if (b.life > 0) { b.life -= dt; b.t += dt; } }
    for (let i = 0; i < pulses.length; i++) { const p = pulses[i]; if (p.life > 0) { p.life -= dt; p.z += p.v * dt; } }
    for (let i = 0; i < rings.length; i++) { const p = rings[i]; if (p.life > 0) { p.life -= sdt; p.z += p.vz * sdt; } }
    for (let i = 0; i < floors.length; i++) { const p = floors[i]; if (p.life > 0) { p.life -= sdt; p.z += p.vz * sdt; } }
    for (let i = 0; i < flybys.length; i++) { const p = flybys[i]; if (p.life > 0) p.life -= dt; }
    for (let i = 0; i < srings.length; i++) { const p = srings[i]; if (p.life > 0) p.life -= dt; }
    for (let i = 0; i < judges.length; i++) { const j = judges[i]; if (j.on) { j.t += sdt; if (j.t > 0.34) j.on = false; } }
    pool.update(sdt, -(CAM_BACK + backP) - 1.5);

    // the steady look: more lens the faster you go, all of it weighted to the screen edges by the shaders
    const g = clamp01((frame.gearF - 1) / 4), b = fx.base;
    b.radialBlur = (0.004 + 0.018 * g * g + 0.007 * heat * heat) * cm;
    b.aberration = (0.0011 + 0.002 * g + 0.0014 * heat) * cm;
    b.barrel = 0.02 + 0.016 * g * cm;
    b.bloom = 1 + 0.08 * g;
    b.exposure = 1 - 0.32 * dimK;
    b.vignette = 0.42 + 0.14 * crashK * crashAmt;
    b.centerX = 0.5; b.centerY = 0.5;
  }

  // ---------------------------------------------------------------- draw: behind the hazards
  function drawBack(frame) {
    const scroll = frame.dist % RIB_SPACING;
    // light pulses racing down the ribs and rails
    for (let n = 0; n < pulses.length; n++) {
      const p = pulses[n];
      if (p.life <= 0) continue;
      const lf = p.life / p.maxLife, kk = p.k * Math.min(1, lf * 2.2);
      const k0 = Math.ceil((p.z - p.band + scroll) / RIB_SPACING), k1 = Math.floor((p.z + p.band + scroll) / RIB_SPACING);
      for (let k = k1; k >= k0; k--) {
        const z = k * RIB_SPACING - scroll;
        if (z < -7.4 || z > 600) continue;
        let gk = 1 - Math.abs(z - p.z) / p.band; gk = gk * gk * kk;
        if (gk < 0.01) continue;
        for (let i = 0; i < LANES; i++) { const j = (i + 1) % LANES; cam.line(CORNER_X[i], CORNER_Y[i], z, CORNER_X[j], CORNER_Y[j], z, p.w, p.col, gk, 4); }
      }
      const z0 = Math.max(-7.4, p.z - p.band * 0.7), z1 = Math.min(600, p.z + p.band * 0.25);
      if (z1 > z0) for (let i = 0; i < LANES; i++) cam.line(CORNER_X[i], CORNER_Y[i], z0, CORNER_X[i], CORNER_Y[i], z1, p.w * 0.8, p.col, kk * 0.6, 4);
    }
    // the breach bolt: light fired down the runner's lane to the vanishing point
    for (let n = 0; n < bolts.length; n++) {
      const b = bolts[n];
      if (b.life <= 0) continue;
      const f = clamp01(b.life / 0.3), head = Math.min(600, 30 + 1300 * b.t), tail = Math.max(1, head - 110);
      cam.line(b.x, b.y, 1, b.x, b.y, head, 0.1, ICE, 0.9 * f * f, 4);
      cam.line(b.x, b.y, tail, b.x, b.y, head, 0.2, HOT, 2.6 * f, 4);
    }
    // speed motes: dust outside the tube that turns into streaks as it passes the lens
    const g = clamp01((frame.gearF - 1) / 4);
    gearColor(frame.gearF, gcol); mixColor(gcol, WHITE, 0.35, gwhite);
    const nM = Math.round(MOTE_N * (0.4 + 0.6 * g)), RANGE = 150;
    const rIn = frame.conduit ? 5.7 : 6.6, rSpan = frame.conduit ? 2.6 : 10;
    const len = speed * (0.028 + 0.022 * g) + lineBoost * 2.5;
    const mk0 = (frame.conduit ? 0.2 : 0.26) + 0.14 * g + 0.2 * Math.min(1, lineBoost);
    for (let i = 0; i < nM; i++) {
      const z = RANGE - ((frame.dist * (0.85 + 0.3 * MOTE_S[i]) + MOTE_P[i] * RANGE) % RANGE) - 10;
      const r = rIn + MOTE_R[i] * rSpan, a = MOTE_A[i];
      const kk = mk0 * (0.5 + 0.5 * MOTE_S[i]) * (z > 70 ? clamp01((RANGE - 10 - z) / 60) : 1);
      const x = Math.sin(a) * r, y = -Math.cos(a) * r;
      cam.line(x, y, z, x, y, z + len, 0.035, gwhite, kk, 3);
    }
  }

  // ---------------------------------------------------------------- draw: over the world
  function drawEmbers(frame) {
    const amt = clamp01(heat * 1.15 + igniteK * 0.25) * EMB_N;
    if (amt < 0.02) return;
    const RANGE = 100, flick = 1 + lowLevel * 0.25 * frame.kick;
    for (let i = 0; i < EMB_N; i++) {
      const on = clamp01(amt - i);
      if (on <= 0) break;
      const v = 26 + 70 * EMB_S[i];                    // overtaking speed relative to the runner
      const z = ((time * v + EMB_P[i] * RANGE) % RANGE) - CAM_BACK - 8;
      const a = EMB_A[i] + Math.sin(time * 0.7 + i) * 0.12, r = 5.9 + EMB_R[i] * 6.5 + Math.sin(time * 1.3 + i * 2.1) * 0.25;
      const x = Math.sin(a) * r, y = -Math.cos(a) * r;
      // bright as they pass the lens, gone before they could crowd the vanishing point
      const kz = z < 12 ? 1 : clamp01(1 - (z - 12) / 64);
      const kk = on * kz * kz * (0.9 + 1.3 * EMB_H[i]) * flick;
      if (kk < 0.01) continue;
      mixColor(NOVA0, NOVA1, EMB_H[i], sc);
      cam.line(x, y, z, x, y, z - v * 0.05, 0.05 + 0.06 * EMB_H[i], sc, kk, 3);
    }
  }

  function drawWorld(frame) {
    const camZ = -(CAM_BACK + kick.back);
    drawEmbers(frame);

    // flybys: something just missed you
    for (let n = 0; n < flybys.length; n++) {
      const f = flybys[n];
      if (f.life <= 0) continue;
      const t = 1 - f.life / f.maxLife, z = 5 - f.spd * (f.maxLife - f.life), kk = f.k * (1 - t);
      for (let i = 0; i < 3; i++) {
        const hh = (i - 1) * 0.55, x = f.x + f.ux * hh, y = f.y + f.uy * hh;
        cam.line(x, y, z + 7 + i * 1.5, x, y, z, 0.05, gwhite, kk * (i === 1 ? 1 : 0.6), 3);
      }
    }

    // grind contact glow
    if (grindGlow > 0.03 && grindSide !== 0) {
      const tx = frame.upY * grindSide, ty = -frame.upX * grindSide;
      const fl = 0.7 + 0.6 * noise1(time * 47);
      cam.glow(frame.runnerX + tx * LANE_W * 0.46 + frame.upX * 0.15, frame.runnerY + ty * LANE_W * 0.46 + frame.upY * 0.15, 0.4, 0.9, WHITE, 1.6 * grindGlow * fl, 2);
      cam.glow(frame.runnerX + tx * LANE_W * 0.46 + frame.upX * 0.15, frame.runnerY + ty * LANE_W * 0.46 + frame.upY * 0.15, 0.4, 2.2, YOU, 0.5 * grindGlow * fl, 2);
    }

    if (rollGlow > 0.05) cam.glow(rollGX, rollGY, 0.2, 1.3, YOU, 1.3 * rollGlow, 2);

    // landing ring racing up the lane
    for (let n = 0; n < floors.length; n++) {
      const f = floors[n];
      if (f.life <= 0) continue;
      const t = 1 - f.life / f.maxLife, r = 0.3 + (f.r1 - 0.3) * ease.outCubic(t), kk = 2.6 * (1 - t) * (1 - t);
      const rl = Math.min(r, LANE_W * 0.5);
      let px = f.x + f.tx * rl, py = f.y + f.ty * rl, pz = f.z;
      for (let i = 1; i <= 14; i++) {
        const a = (i / 14) * TAU, c = Math.cos(a) * rl, s = Math.sin(a) * r * 1.6;
        const nx = f.x + f.tx * c, ny = f.y + f.ty * c, nz = f.z + s;
        cam.line(px, py, pz, nx, ny, nz, 0.09, i & 1 ? YOU : WHITE, kk, 4);
        px = nx; py = ny; pz = nz;
      }
    }

    // pickup / pip / iris rings
    for (let n = 0; n < rings.length; n++) {
      const p = rings[n];
      if (p.life <= 0) continue;
      const t = 1 - p.life / p.maxLife;
      cam.ring(p.x, p.y, p.z, lerp(p.r0, p.r1, ease.outCubic(t)), p.w, p.col, p.k * (1 - t) * (1 - t), 4);
    }

    // the lance: a spear of light with its bow shock. The apex is ahead of the runner and the cone
    // sweeps back past the shoulders toward the lens, so from behind it reads as a burst of thrust
    // lines converging on the point of the ram instead of a bullseye.
    if (lanceT >= 0) {
      const u = lanceT / 0.2, L = 3 + 13 * ease.outExpo(Math.min(1, lanceT / 0.07)), f = (1 - u) * (1 - u);
      cam.line(lanceX, lanceY, 0.5, lanceX, lanceY, L * 0.7, 0.55, ICE, 0.6 * f, 3);
      cam.line(lanceX, lanceY, 0.5, lanceX, lanceY, L + 6, 0.16, HOT, 2.8 * f, 4);
      const zb = -2.5, rb = 2.3, spin = lanceT * 5;
      for (let j = 0; j < 10; j++) {
        const a = (j / 10) * TAU + spin, c = Math.cos(a), sn = Math.sin(a);
        const a1 = ((j + 1) / 10) * TAU + spin, c1 = Math.cos(a1), s1 = Math.sin(a1);
        // a faint skin between the struts turns the wireframe into a cone of light
        cam.quad(lanceX, lanceY, L, lanceX + c * rb, lanceY + sn * rb, zb, lanceX + c1 * rb, lanceY + s1 * rb, zb, lanceX + c1 * rb, lanceY + s1 * rb, zb, ICE, 0.07 * f, 0);
        cam.line(lanceX, lanceY, L, lanceX + c * rb * 0.45, lanceY + sn * rb * 0.45, L + (zb - L) * 0.45, 0.05, HOT, 2.0 * f, 3);
        cam.line(lanceX + c * rb * 0.45, lanceY + sn * rb * 0.45, L + (zb - L) * 0.45, lanceX + c * rb, lanceY + sn * rb, zb, 0.04, ICE, 1.1 * f, 3);
      }
      for (let j = 1; j <= 3; j++) {
        const q = j / 3.6;
        cam.ring(lanceX, lanceY, L + (zb - L) * q, rb * q, 0.045, ICE, (1.5 - q) * f, 4);
      }
      cam.glow(lanceX, lanceY, L, 1.6, HOT, 1.6 * f, 2);
    }

    // the impact frame: cracks racing across the wall plane from the point of the ram
    if (impT >= 0) {
      const u = impT / 0.16, grow = ease.outExpo(Math.min(1, impT / 0.05)), f = (1 - u) * (1 - u);
      for (let i = 0; i < IMP_N; i++) {
        const a = IMP_A[i], L = IMP_L[i] * grow, a2 = a + (IMP_K[i] - 1) * 0.5;
        const mx = impX + Math.cos(a) * L * 0.45, my = impY + Math.sin(a) * L * 0.45;
        cam.line(impX, impY, 0.4, mx, my, 0.4, 0.07, WHITE, 2.6 * f * IMP_K[i], 3);
        cam.line(mx, my, 0.4, mx + Math.cos(a2) * L * 0.55, my + Math.sin(a2) * L * 0.55, 0.4, 0.045, HOT, 1.8 * f * IMP_K[i], 3);
      }
      cam.glow(impX, impY, 0.4, 2.1 * impPow, HOT, 1.9 * f, 2);
      cam.glow(impX, impY, 0.4, 5 * impPow, ICE, 0.3 * f, 1.5);
    }

    pool.draw(cam, camZ);

    // the judgement, in the world, stamped and then flying past over the lens with the debris
    for (let n = 0; n < judges.length; n++) {
      const j = judges[n];
      if (!j.on) continue;
      const t = j.t, z = t < 0.13 ? lerp(6.5, 3.4, ease.outCubic(t / 0.13)) : 3.4 - 260 * (t - 0.13) * (t - 0.13);
      // straight above the tube axis as the screen sees it NOW (not where the runner stood at the hit):
      // a roll or a flip after the hit cannot swing the stamp sideways or off the screen
      const ar = j.h - APOTHEM, ax = -Math.sin(frame.roll) * ar, ay = Math.cos(frame.roll) * ar;
      if (!cam.project(ax, ay, z)) { j.on = false; continue; }
      const sx = cam.sx, sy = cam.sy, s = cam.s, depth = cam.zc;
      const pop = 1 + 0.9 * (1 - ease.outCubic(Math.min(1, t / 0.09)));
      const fade = clamp01((depth - 1.2 - j.size) / (2.4 * j.size)) * Math.min(1, t / 0.015 + 0.3);
      if (fade <= 0.01) continue;
      // always upright on screen
      gfx.push(); gfx.translate(sx, sy); gfx.rotate(j.tilt); gfx.scale(s * pop);
      drawText(gfx, j.str, 0.05 * j.size, 0.06 * j.size, j.size, ICE, 0.42 * fade, 0.5, TXT_ECHO);
      drawText(gfx, j.str, 0, 0, j.size, j.col, j.k * fade, 0.5, TXT);
      gfx.pop();
    }
  }

  // ---------------------------------------------------------------- draw: screen space (still bloomed)
  // A band of light hugging the screen border, deepest at the sides, with tongues that lick inward.
  // Light is `k` at the border and exactly zero at the inner edge, so the centre is never touched.
  function edgeRing(col, k, depth, wob, ph, t, fq) {
    if (k < 0.004 || depth <= 0.002) return;
    const cx = gfx.W * 0.5, cy = gfx.H * 0.5;
    for (let i = 0; i <= EDGE_N; i++) {
      const th = (i / EDGE_N) * TAU, c = Math.cos(th), s = Math.sin(th);
      const te = Math.min(cx / (Math.abs(c) + 1e-4), cy / (Math.abs(s) + 1e-4));
      // the inner edge follows an ellipse more than the frame, so light pools in the corners (far
      // from the tube) and the band reads as a glow closing in, not as a picture frame
      const re = 1 / Math.sqrt((c * c) / (cx * cx) + (s * s) / (cy * cy));
      const n = 0.5 * noise1(c * 3.1 * fq + ph + t) + 0.5 * noise1(s * 3.7 * fq + ph * 1.7 - t * 0.8);
      const d = clamp(depth * (1 - wob + 2 * wob * n) * (0.75 + 0.25 * Math.abs(c)), 0, 1);
      const ri = (te + (re - te) * Math.min(1, depth * 2.2 + 0.25)) * (1 - d);
      EX0[i] = cx + c * te * 1.12; EY0[i] = cy + s * te * 1.12;
      EX1[i] = cx + c * ri; EY1[i] = cy + s * ri;
    }
    for (let i = 0; i < EDGE_N; i++) gfx.quadGrad(EX0[i], EY0[i], EX0[i + 1], EY0[i + 1], EX1[i + 1], EY1[i + 1], EX1[i], EY1[i], col, k, 0, col, 0, 0);
  }

  function drawScreen(frame) {
    const W = gfx.W, H = gfx.H, cx = W * 0.5, cy = H * 0.5;
    const g = clamp01((frame.gearF - 1) / 4);

    // speed streaks: only in the outer half of the frame, pointing at the vanishing point
    const inten = Math.max(0, g - 0.3) * 0.55 + lineBoost * 0.75;
    if (inten > 0.02) {
      for (let i = 0; i < SL_N; i++) {
        const th = SL_A[i], c = Math.cos(th), s = Math.sin(th);
        const te = Math.min(cx / (Math.abs(c) + 1e-4), cy / (Math.abs(s) + 1e-4));
        const ph = (time * (1.6 + SL_S[i] * 2.2) + SL_P[i]) % 1;
        const r0 = te * (0.56 + 0.55 * ph), ln = te * (0.05 + 0.13 * Math.min(1.5, inten)) * (0.5 + ph);
        const kk = Math.min(1.2, inten) * 0.5 * Math.sin(Math.PI * ph) * (0.35 + 0.65 * SL_H[i]);
        if (kk < 0.01) continue;
        gfx.line(cx + c * r0, cy + s * r0, cx + c * (r0 + ln), cy + s * (r0 + ln), 1.3, gwhite, kk, 3);
      }
    }

    // rings of light bursting outward (gear up, sector gate, the drop)
    for (let n = 0; n < srings.length; n++) {
      const p = srings[n];
      if (p.life <= 0) continue;
      const t = 1 - p.life / p.maxLife;
      gfx.ring(p.x, p.y, 30 + p.r1 * ease.outCubic(t), p.w * (1 - t) + 1, p.col, p.k * (1 - t) * (1 - t), 4);
    }

    // ---- the nova: orange-gold creeping in from the edges, never the centre
    const flick = 1 + lowLevel * 0.3 * frame.kick + 0.12 * (noise1(time * 9.3) - 0.5) * heat;
    const hk = clamp01(Math.max(heat, 0.8 * igniteK) + 0.3 * lowPulse * heat);
    const lunge = lungeK * (0.35 + 0.65 * heat);
    // after the death white-out everything the nova draws settles, so the results screen sits on deep
    // orange with a gold rim instead of light that clips to white (and reads as grey under the vignette)
    const settle = deathT >= 0 ? ease.inOutCubic(clamp01((deathT - 0.55) / 0.9)) : 0;
    if (hk > 0.01 || lunge > 0.01) {
      const depth = hk * (0.05 + 0.16 * hk) + lunge * 0.2;
      const kk = (hk * (0.35 + 1.3 * hk) + lunge * 0.8) * flick * (1 - 0.8 * settle);
      edgeRing(NOVA0, kk * 0.22, depth * 1.7, 0.45, 3.1, time * 0.9, 1);
      edgeRing(NOVA0, kk * 0.6, depth * 0.95, 0.8, 11.7, time * 1.9, 1.6);
      edgeRing(NOVA1, kk * (0.3 + hk) * 0.9, depth * 0.5, 0.95, 23.3, time * 2.7, 2.3);
      edgeRing(NOVA1, kk * hk * 1.6, depth * 0.22, 0.6, 37.9, time * 3.3, 3);
      // rays: the star's light pouring past you toward the vanishing point
      for (let i = 0; i < SL_N; i++) {
        const th = SL_A[i] + 0.05, c = Math.cos(th), s = Math.sin(th);
        const te = Math.min(cx / (Math.abs(c) + 1e-4), cy / (Math.abs(s) + 1e-4));
        const n = noise1(time * (1.5 + 3 * SL_S[i]) + i * 7.31);
        const ln = te * depth * (0.5 + 2.4 * n * SL_H[i]);
        const rk = kk * 0.55 * n * n;
        if (rk < 0.01) continue;
        gfx.line(cx + c * te * 1.03, cy + s * te * 1.03, cx + c * (te - ln), cy + s * (te - ln), 2 + 4 * SL_P[i], NOVA1, rk, 4);
      }
      // heat haze: two off-screen ripple sources shaking the left and right borders. Uses spare
      // shockwave slots only; a breach's own shockwave always has room.
      const sw = fx.post.shockwaves;
      if (hk > 0.25 && sw.length <= 2 && sw.indexOf(SHIM_L) < 0) {
        const amp = (hk - 0.25) * 0.011 * cm;
        SHIM_L.radius = 0.5 + 0.05 * Math.sin(time * 4.3); SHIM_L.strength = amp * Math.sin(time * 27) * (0.6 + 0.4 * Math.sin(time * 7.1));
        SHIM_R.radius = 0.5 + 0.05 * Math.sin(time * 3.7 + 2); SHIM_R.strength = amp * Math.sin(time * 31 + 1.3) * (0.6 + 0.4 * Math.sin(time * 6.3 + 0.7));
        SHIM_L.y = 0.5 + 0.25 * Math.sin(time * 1.9); SHIM_R.y = 0.5 + 0.25 * Math.sin(time * 2.3 + 1);
        sw.push(SHIM_L); sw.push(SHIM_R);
      }
    }

    // ---- crash: a magenta vignette pulse
    if (crashK > 0) {
      const e = crashK * crashK;
      edgeRing(SOLID, 0.85 * e * crashAmt, 0.09 + 0.11 * crashK * crashAmt, 0.45, 41.3, time * 3, 1.5);
      edgeRing(SOLID, 1.0 * e * crashAmt, 0.06, 0.3, 57.9, time * 5, 2.5);
    }

    // ---- death: white-gold wipes in from the edges and stays for the results screen to burn into
    if (deathT >= 0) {
      const w = clamp01(deathT / 0.4), e = ease.inOutCubic(w);
      // white-out at 0.4 s, then it settles to deep nova orange. Comfort mode skips the white-out: the
      // wipe closes in already settled, so the screen never flashes.
      const st = comfort ? 1 : settle, ks = lerp(1, 0.09, st);
      mixColor(NOVA1, WHITE, 0.25 + 0.6 * w, sc2); mixColor(sc2, NOVA0, st, sc2);
      mixColor(NOVA1, NOVA0, st, sc);
      edgeRing(sc2, (1.2 + 3.5 * e) * ks, 0.15 + 1.0 * e, 0.4 * (1 - e), 71.1, time * 2.2, 1);
      edgeRing(sc, (1.0 + 1.5 * e) * ks, Math.min(1, 0.3 + 1.4 * e), 0.3 * (1 - e), 83.7, time * 1.4, 1.5);
      if (w > 0.35) gfx.rect(0, 0, W, H, sc2, 2.6 * ks * clamp01((w - 0.35) / 0.65), 0);
    }
  }

  return { kick, onEvent, update, drawBack, drawWorld, drawScreen };
}
