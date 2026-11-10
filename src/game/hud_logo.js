// game/hud_logo.js — the BLUESHIFT logotype. Custom geometric letterforms (chamfered like the
// tube's octagon, stencil-cut, leaning forward), coloured violet -> ice blue across the word
// because the name is the mechanic: faster is bluer. Behind every letter trail red-shifted echoes
// (the light you are outrunning); a scan band tears a slice of the word sideways now and then.
import { hex, hash1, clamp01 } from '../engine/math.js';

// Each letter: advance width and strokes on a grid 6 units tall (y up, baseline 0).
const LETTERS = [
  [4.4, '0,0 0,6 3.2,6 4.2,5 4.2,4 3.4,3.2 4.4,2.2 4.4,1 3.4,0 0,0|1.5,3.2 3.4,3.2'],   // B
  [3.8, '0,6 0,0 3.8,0'],                                                               // L
  [4.4, '0,6 0,1 1,0 3.4,0 4.4,1 4.4,6'],                                               // U
  [4.2, '0,6 4.2,6|0,3.1 3.3,3.1|0,0 4.2,0'],                                           // E (no stem: three bars)
  [4.4, '4.4,6 1,6 0,5 0,4.1 1,3.1 3.4,3.1 4.4,2.1 4.4,1 3.4,0 0,0'],                   // S
  [4.4, '0,0 0,6|4.4,0 4.4,6|0,3.1 4.4,3.1'],                                           // H
  [0.0, '0,0 0,6'],                                                                     // I
  [4.2, '0,0 0,6 4.2,6|1.5,3.1 3.3,3.1'],                                               // F
  [4.6, '0,6 4.6,6|2.3,6 2.3,0'],                                                       // T
];
const GAP = 1.55, SLANT = 0.17;

// The word is cut along a horizontal line and its foot is knocked back (left, toward the red):
// the logo itself is shifted. Segments are split at the cut once, here; `low` marks the foot.
const CUT = 1.72, FOOT_DX = -0.52, FOOT_HUE = -0.75;
let total = 0;
const segs = [];
function addSeg(x0, y0, x1, y1) {
  const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
  if (hi <= CUT) segs.push(x0, y0, x1, y1, 1);
  else if (lo >= CUT) segs.push(x0, y0, x1, y1, 0);
  else {
    const t = (CUT - y0) / (y1 - y0), xc = x0 + (x1 - x0) * t;
    // flags: 1 = foot, 2 = first end is a cut (flat), 4 = second end is a cut
    segs.push(x0, y0, xc, CUT, (y0 < CUT ? 1 : 0) | 4, xc, CUT, x1, y1, (y1 < CUT ? 1 : 0) | 2);
  }
}
for (let i = 0; i < LETTERS.length; i++) {
  const x0 = total;
  for (const stroke of LETTERS[i][1].split('|')) {
    const pts = stroke.trim().split(/\s+/).map((p) => p.split(',').map(Number));
    for (let j = 0; j < pts.length - 1; j++) addSeg(x0 + pts[j][0], pts[j][1], x0 + pts[j + 1][0], pts[j + 1][1]);
  }
  total += LETTERS[i][0] + (i < LETTERS.length - 1 ? GAP : 0);
}
const SEG = new Float32Array(segs);
const NSEG = SEG.length / 5;
export const LOGO_W = total;
export const LOGO_H = 6;
export const LOGO_SLANT = SLANT;

// Doppler ramp: red (receding, far behind) -> violet -> the gear ramp -> ice (approaching).
const RAMP = [hex('#ff3030'), hex('#d42bb0'), hex('#7a3cff'), hex('#4658ff'), hex('#1e8bff'), hex('#19d3ff'), hex('#a4eeff')];
const col = [0, 0, 0], col2 = [0, 0, 0];
function ramp(v, out) {
  const m = RAMP.length - 1;
  v = v < 0 ? 0 : v > m ? m : v;
  const i = Math.min(m - 1, Math.floor(v)), f = v - i, a = RAMP[i], b = RAMP[i + 1];
  out[0] = a[0] + (b[0] - a[0]) * f; out[1] = a[1] + (b[1] - a[1]) * f; out[2] = a[2] + (b[2] - a[2]) * f;
  return out;
}
// Ramp position for a point `t` (0..1) across the word; `shift` slides the whole word bluer.
export function logoColor(t, shift, out) { return ramp(2 + clamp01(t) * 4 + shift, out); }
// The whole Doppler spectrum, 0 = red (behind you) .. 1 = ice (ahead).
export function dopplerColor(v, out) { return ramp(clamp01(v) * (RAMP.length - 1), out); }

// transform + tear state for the segment emitter (module scope: no per-frame objects)
let TX = 0, TY = 0, U = 1, BY0 = 0, BY1 = 0, BDX = 0;
// f0 / f1: that end is a cut and must be flat (a clean slice), otherwise it gets a round cap.
function emit(g, x0, y0, x1, y1, dx, lw, c, k, glow, f0, f1) {
  const ax = TX + (x0 + (y0 - 3) * SLANT + dx) * U, ay = TY + (3 - y0) * U, bx = TX + (x1 + (y1 - 3) * SLANT + dx) * U, by = TY + (3 - y1) * U;
  if ((!f0 && !f1) || !g.lineTaper) { g.line(ax, ay, bx, by, lw, c, k, glow); return; }
  g.lineTaper(ax, ay, lw, k, bx, by, lw, k, c, glow);
  if (f0 === 3) return;                                  // 3 = flat and bare: no cap at either end (inline core)
  if (!f0) g.line(ax, ay, ax, ay, lw, c, k, glow);
  if (!f1) g.line(bx, by, bx, by, lw, c, k, glow);
}
// Draws one logo segment, cutting it where it crosses the tear band and sliding that piece sideways.
function seg(g, x0, y0, x1, y1, bx, lw, c, k, glow, f0, f1) {
  if (BDX === 0) { emit(g, x0, y0, x1, y1, bx, lw, c, k, glow, f0, f1); return; }
  const lo = y0 < y1 ? y0 : y1, hi = y0 < y1 ? y1 : y0;
  if (hi <= BY0 || lo >= BY1) { emit(g, x0, y0, x1, y1, bx, lw, c, k, glow, f0, f1); return; }
  if (lo >= BY0 && hi <= BY1) { emit(g, x0, y0, x1, y1, bx + BDX, lw, c, k * 1.3, glow, f0, f1); return; }
  const dy = y1 - y0;
  let ta = (BY0 - y0) / dy, tb = (BY1 - y0) / dy;
  if (ta > tb) { const s = ta; ta = tb; tb = s; }
  ta = clamp01(ta); tb = clamp01(tb);
  const dx = x1 - x0, head = ta > 0.01, tail = tb < 0.99;
  if (head) emit(g, x0, y0, x0 + dx * ta, y0 + dy * ta, bx, lw, c, k, glow, f0, 1);
  emit(g, x0 + dx * ta, y0 + dy * ta, x0 + dx * tb, y0 + dy * tb, bx + BDX, lw, c, k * 1.3, glow, head ? 1 : f0, tail ? 1 : f1);
  if (tail) emit(g, x0 + dx * tb, y0 + dy * tb, x1, y1, bx, lw, c, k, glow, 1, f1);
}

// Draws the logo centred on (cx, cy), `width` logical units wide. `kick` (0..1) is the beat pulse:
// the echoes stretch and the word slides bluer on every beat. `plain` skips echoes, tears and the
// inline core (used when the strokes are fed to the shard recorder).
export function drawLogo(g, cx, cy, width, time, kick, k, plain) {
  U = width / total;
  TX = cx - total * 0.5 * U; TY = cy;
  const lw = U * 0.72;
  const shift = plain ? 0 : kick * 0.55 + Math.sin(time * 0.7) * 0.18;
  BDX = 0;
  if (!plain) {
    // a slow scan band drifting down the word, and every few seconds a hard tear
    const scanT = (time % 3.6) / 1.2;
    const popN = Math.floor(time / 2.3), popT = time - popN * 2.3;
    if (popT < 0.11 && hash1(popN * 7 + 3) > 0.25) {
      BY0 = hash1(popN * 13 + 1) * 4.6; BY1 = BY0 + 0.7 + hash1(popN * 5) * 0.9;
      BDX = (hash1(popN * 3 + 9) > 0.5 ? 1 : -1) * (0.5 + hash1(popN) * 0.9);
    } else if (scanT < 1) {
      BY1 = 6.6 - scanT * 7.4; BY0 = BY1 - 0.5; BDX = 0.13;
    }
    // red-shifted echoes, farthest first: thin ghosts of the word trailing behind it
    for (let j = 3; j >= 1; j--) {
      const dx = -(0.3 + 0.07 * j) * j * (1 + kick * 0.6);
      const ek = k * (j === 1 ? 0.42 : j === 2 ? 0.26 : 0.15), ew = lw * (0.4 - 0.06 * j);
      for (let i = 0; i < NSEG; i++) {
        const o = i * 5, t = ((SEG[o] + SEG[o + 2]) * 0.5) / total, fl = SEG[o + 4], low = fl & 1;
        ramp(2 + t * 4 + shift - 1.1 * j + low * FOOT_HUE, col);
        emit(g, SEG[o], SEG[o + 1], SEG[o + 2], SEG[o + 3], dx + low * FOOT_DX, ew, col, ek, 3, fl & 2, fl & 4);
      }
    }
    // speed lines streaming off the back of the B, fading into the red
    for (let i = 0; i < 3; i++) {
      const y = i === 0 ? 6 : i === 1 ? 3.2 : 0, len = (i === 1 ? 5.2 : 7.5) * (1 + kick * 0.25), x1 = -1.7 - (i === 1 ? 0.6 : i === 2 ? 0.5 : 0);
      for (let j = 0; j < 5; j++) {
        const a = j / 5, b = (j + 1) / 5;
        ramp(1.6 - a * 1.6, col);
        emit(g, x1 - len * a, y, x1 - len * b + 0.12, y, i === 2 ? FOOT_DX : 0, lw * 0.3 * (1 - a * 0.6), col, k * 0.6 * (1 - a) * (1 - a), 3, 0, 0);
      }
    }
    if (BDX !== 0) {
      // the band itself: a faint hairline across the word
      const yb = (BY0 + BY1) * 0.5;
      ramp(5.2, col);
      emit(g, -1.2, yb, total + 1.2, yb, 0, 1.2, col, k * 0.22, 3, 0, 0);
    }
  }
  for (let i = 0; i < NSEG; i++) {
    const o = i * 5, t = ((SEG[o] + SEG[o + 2]) * 0.5) / total, fl = SEG[o + 4], low = fl & 1;
    ramp(2 + t * 4 + shift + low * FOOT_HUE, col);
    seg(g, SEG[o], SEG[o + 1], SEG[o + 2], SEG[o + 3], low * FOOT_DX, lw, col, k * 1.05, 3.2, fl & 2, fl & 4);
  }
  if (!plain) {
    // hot inline core, like the gas inside a neon tube
    for (let i = 0; i < NSEG; i++) {
      const o = i * 5, t = ((SEG[o] + SEG[o + 2]) * 0.5) / total, fl = SEG[o + 4], low = fl & 1;
      ramp(2 + t * 4 + shift + low * FOOT_HUE, col);
      col2[0] = col[0] + (1 - col[0]) * 0.62; col2[1] = col[1] + (1 - col[1]) * 0.62; col2[2] = col[2] + (1 - col[2]) * 0.62;
      seg(g, SEG[o], SEG[o + 1], SEG[o + 2], SEG[o + 3], low * FOOT_DX, lw * 0.22, col2, k * 0.95, 2, 3, 3);
    }
  }
  BDX = 0;
}
