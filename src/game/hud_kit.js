// game/hud_kit.js — private drawing kit for hud.js: text and number helpers that never build
// strings per frame, keycaps and input icons for the wordless prompts, and a tiny shard system
// (the logo and the results number shatter into it). Screen space, logical units.
import { drawText, measureText } from '../engine/font.js';
import { C } from './config.js';
import { TAU } from '../engine/math.js';

export const BLACK = [0, 0, 0];
export const INK = [0.007, 0.0025, 0.02];      // the dark of keycap faces and scrims (void violet)
const OPT = { tracking: 0, weight: 0.09, glow: 4, slant: 0 };
const DIG = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const tmp = [0, 0, 0];

// drawText with positional style arguments (the shared opts object is reused, never allocated).
export function txt(g, str, x, y, size, col, k, align, tracking, weight, glow, slant) {
  OPT.tracking = tracking || 0; OPT.weight = weight || 0.09; OPT.glow = glow || 4; OPT.slant = slant || 0;
  return drawText(g, str, x, y, size, col, k, align, OPT);
}
export const txtW = (str, size, tracking) => measureText(str, size, tracking || 0);

// ---- numbers. Digits sit in fixed cells so a rolling score does not jitter sideways.
const CELL = 5.7 / 6, GAP = 1.7 / 6, SEPW = 2.6 / 6;
function digitCount(v) { let n = 1; while (v >= 10) { v = Math.floor(v / 10); n++; } return n; }
// Width of integer `v` drawn at cap height `size`; `sep` adds thousands separators; `dec` = how many
// of the trailing digits are decimals (v is the scaled integer: 4.21 km is v = 421, dec = 2).
export function numW(v, size, sep, dec) {
  let n = digitCount(Math.max(0, Math.floor(v)));
  if (dec && n < dec + 1) n = dec + 1;
  let w = n * CELL - GAP;
  if (dec) w += SEPW;
  if (sep) w += Math.floor((n - (dec || 0) - 1) / 3) * SEPW;
  return w * size;
}
// Draws integer `v` right-aligned so its last digit ends at `xr`. Returns the left edge.
export function num(g, v, xr, y, size, col, k, sep, dec, weight, glow) {
  OPT.tracking = 0; OPT.weight = weight || 0.09; OPT.glow = glow || 4; OPT.slant = 0;
  v = Math.max(0, Math.floor(v));
  dec = dec || 0;
  const cell = CELL * size, half = (2 / 6) * size, sw = SEPW * size;
  let x = xr, i = 0;
  do {
    if (dec && i === dec) { drawText(g, '.', x - sw * 0.5 + GAP * size * 0.5, y, size, col, k, 0.5, OPT); x -= sw; }
    else if (sep && i > dec && (i - dec) % 3 === 0) { drawText(g, ',', x - sw * 0.5 + GAP * size * 0.5, y, size, col, k, 0.5, OPT); x -= sw; }
    const d = v % 10; v = (v - d) / 10;
    drawText(g, DIG[d], x - half, y, size, col, k, 0.5, OPT);
    x -= cell; i++;
  } while (v > 0 || i < dec + 1);
  return x + GAP * size;
}
export const digitStr = (d) => DIG[d < 0 ? 0 : d > 9 ? 9 : d];

// ---- shapes
// Rectangle outline with 45-degree chamfered corners (the octagon motif of the tube).
export function chamferRect(g, x, y, w, h, c, lw, col, k, glow) {
  const x1 = x + w, y1 = y + h;
  g.line(x + c, y, x1 - c, y, lw, col, k, glow); g.line(x1 - c, y, x1, y + c, lw, col, k, glow);
  g.line(x1, y + c, x1, y1 - c, lw, col, k, glow); g.line(x1, y1 - c, x1 - c, y1, lw, col, k, glow);
  g.line(x1 - c, y1, x + c, y1, lw, col, k, glow); g.line(x + c, y1, x, y1 - c, lw, col, k, glow);
  g.line(x, y1 - c, x, y + c, lw, col, k, glow); g.line(x, y + c, x + c, y, lw, col, k, glow);
}
// Chunky arrow. dir: 0 left, 1 right, 2 up, 3 down.
export function arrow(g, cx, cy, size, dir, lw, col, k) {
  const dx = dir === 0 ? -1 : dir === 1 ? 1 : 0, dy = dir === 2 ? -1 : dir === 3 ? 1 : 0;
  const px = -dy, py = dx, h = size * 0.5, hd = size * 0.38;
  const tx = cx + dx * h, ty = cy + dy * h;
  g.line(cx - dx * h, cy - dy * h, tx, ty, lw, col, k, 3);
  g.line(tx, ty, tx - dx * hd + px * hd, ty - dy * hd + py * hd, lw, col, k, 3);
  g.line(tx, ty, tx - dx * hd - px * hd, ty - dy * hd - py * hd, lw, col, k, 3);
}
// A keyboard key seen from the front: a skirt, and a face that sinks into it when pressed (0..1).
// (cx, cy) is the centre of the face at rest. The face is dark-filled so it reads over anything.
export function keycap(g, cx, cy, w, h, col, k, press, fillA) {
  const drop = 5, c = Math.min(7, h * 0.22);
  const fy = cy + press * (drop - 1);
  const x = cx - w * 0.5;
  // a pool of dark behind the key, so it separates from whatever it floats over (an ICE wall, say)
  g.glowEllipse(cx, cy + 2, w * 0.5 + h * 0.9, h * 1.5, BLACK, 1, 1.3, 0.62);
  // skirt
  g.rect(x, cy - h * 0.5 + drop, w, h, INK, 1, fillA);
  chamferRect(g, x, cy - h * 0.5 + drop, w, h, c, 1.6, col, k * 0.34, 3);
  // face
  g.rect(x + 1, fy - h * 0.5 + 1, w - 2, h - 2, INK, 1, Math.min(1, fillA + 0.12));
  if (press > 0.02) g.rect(x + 2, fy - h * 0.5 + 2, w - 4, h - 4, col, 0.22 * press * k, 0);
  chamferRect(g, x, fy - h * 0.5, w, h, c, 2.2, col, k * (1 + press * 0.7), 4);
  return fy;
}
// Arrow key: keycap + arrow glyph.
export function arrowKey(g, cx, cy, s, dir, col, k, press) {
  const fy = keycap(g, cx, cy, s, s * 0.9, col, k, press, 0.78);
  mix3(col, C.white, 0.45 + press * 0.4);
  arrow(g, cx, fy, s * 0.42, dir, s * 0.085, tmp, k * (1.1 + press * 0.8));
}
// The space bar: a wide keycap with its name on it.
export function spaceKey(g, cx, cy, w, h, col, k, press) {
  const fy = keycap(g, cx, cy, w, h, col, k, press, 0.78);
  mix3(col, C.white, 0.4 + press * 0.5);
  txt(g, 'SPACE', cx, fy, h * 0.34, tmp, k * (1.1 + press * 0.8), 0.5, 1.6, 0.11, 3);
}
// A small labelled key (letters: M, F, P).
export function letterKey(g, cx, cy, s, ch, col, k) {
  const fy = keycap(g, cx, cy, s, s * 0.9, col, k, 0, 0.7);
  txt(g, ch, cx, fy, s * 0.42, col, k * 1.2, 0.5, 0, 0.11, 3);
}
// Touch: a fingertip contact with a ripple. phase 0..1 through the beat; held = finger stays down.
export function tapIcon(g, cx, cy, r, col, k, phase, held) {
  g.disc(cx, cy, r * 1.05, INK, 1, 0.6);
  g.ring(cx, cy, r, 2.2, col, k * 0.9, 4);
  const down = held ? 1 : Math.exp(-phase * 5);
  g.disc(cx, cy, r * (0.34 + 0.12 * down), col, k * (0.35 + 0.9 * down), 0);
  if (!held) g.ring(cx, cy, r * (1 + phase * 0.9), 1.6, col, k * (1 - phase) * (1 - phase) * 0.9, 4);
  else { g.ring(cx, cy, r * 1.28, 1.4, col, k * 0.5, 4); }
}
// Gamepad d-pad with one arm lit. dir as arrow(); press 0..1.
export function dpad(g, cx, cy, s, dir, col, k, press) {
  const a = s * 0.17, b = s * 0.5;
  g.rect(cx - b, cy - a, b * 2, a * 2, INK, 1, 0.75); g.rect(cx - a, cy - b, a * 2, b * 2, INK, 1, 0.75);
  const dk = k * 0.55;
  g.line(cx - a, cy - b, cx + a, cy - b, 1.8, col, dk, 3); g.line(cx + a, cy - b, cx + a, cy - a, 1.8, col, dk, 3);
  g.line(cx + a, cy - a, cx + b, cy - a, 1.8, col, dk, 3); g.line(cx + b, cy - a, cx + b, cy + a, 1.8, col, dk, 3);
  g.line(cx + b, cy + a, cx + a, cy + a, 1.8, col, dk, 3); g.line(cx + a, cy + a, cx + a, cy + b, 1.8, col, dk, 3);
  g.line(cx + a, cy + b, cx - a, cy + b, 1.8, col, dk, 3); g.line(cx - a, cy + b, cx - a, cy + a, 1.8, col, dk, 3);
  g.line(cx - a, cy + a, cx - b, cy + a, 1.8, col, dk, 3); g.line(cx - b, cy + a, cx - b, cy - a, 1.8, col, dk, 3);
  g.line(cx - b, cy - a, cx - a, cy - a, 1.8, col, dk, 3); g.line(cx - a, cy - a, cx - a, cy - b, 1.8, col, dk, 3);
  const dx = dir === 0 ? -1 : dir === 1 ? 1 : 0, dy = dir === 2 ? -1 : dir === 3 ? 1 : 0;
  const lx = cx + dx * (a + b) * 0.5, ly = cy + dy * (a + b) * 0.5, hw = dx ? (b - a) * 0.5 : a, hh = dy ? (b - a) * 0.5 : a;
  g.rect(lx - hw + 2, ly - hh + 2, hw * 2 - 4, hh * 2 - 4, col, k * (0.5 + press * 0.9), 0);
  g.rectLine(lx - hw, ly - hh, hw * 2, hh * 2, 2.2, col, k * (1 + press * 0.6), 4);
}
// Gamepad face button with its letter.
export function padButton(g, cx, cy, r, ch, col, k, press) {
  g.disc(cx, cy, r * 1.05, INK, 1, 0.78);
  if (press > 0.02) g.disc(cx, cy, r * 0.9, col, 0.3 * press * k, 0);
  g.ring(cx, cy, r * (1 - press * 0.06), 2.4, col, k * (1 + press * 0.7), 4);
  mix3(col, C.white, 0.4 + press * 0.5);
  txt(g, ch, cx, cy, r * 0.82, tmp, k * (1.1 + press * 0.7), 0.5, 0, 0.12, 3);
}
function mix3(a, b, t) { tmp[0] = a[0] + (b[0] - a[0]) * t; tmp[1] = a[1] + (b[1] - a[1]) * t; tmp[2] = a[2] + (b[2] - a[2]) * t; return tmp; }

// ---- shards: line fragments (and a few glass triangles) that fly apart from an origin.
// `rec` has the same line() signature as gfx, so anything drawn through it (drawText, the logo)
// becomes shards instead of light.
export function createShards(max, rng) {
  const x = new Float32Array(max), y = new Float32Array(max), vx = new Float32Array(max), vy = new Float32Array(max);
  const hl = new Float32Array(max), rot = new Float32Array(max), spin = new Float32Array(max), wd = new Float32Array(max);
  const life = new Float32Array(max), life0 = new Float32Array(max), kk = new Float32Array(max);
  const cr = new Float32Array(max), cg = new Float32Array(max), cb = new Float32Array(max);
  const kind = new Uint8Array(max);
  const col = [0, 0, 0];
  let n = 0, ox = 0, oy = 0, power = 4, maxLen = 26, lifeMin = 0.34, lifeMax = 0.52;

  function add(px, py, half, angle, width, c, k, type) {
    if (n >= max) return;
    const i = n++;
    x[i] = px; y[i] = py; hl[i] = half; rot[i] = angle; wd[i] = width; kind[i] = type;
    // explode: speed grows with distance from the origin, so the shape reads as flying past the lens
    const dx = px - ox, dy = py - oy, d = Math.hypot(dx, dy) + 1e-3;
    const sp = power * (0.55 + rng() * 0.9), kickSp = 90 + rng() * 300;
    const ja = (rng() - 0.5) * 1.1, ca = Math.cos(ja), sa = Math.sin(ja);
    const ux = (dx / d) * ca - (dy / d) * sa, uy = (dx / d) * sa + (dy / d) * ca;
    vx[i] = dx * sp + ux * kickSp; vy[i] = dy * sp * 1.25 + uy * kickSp;
    spin[i] = (rng() - 0.5) * 26;
    life[i] = life0[i] = lifeMin + rng() * (lifeMax - lifeMin);
    cr[i] = c[0]; cg[i] = c[1]; cb[i] = c[2]; kk[i] = k;
  }

  const rec = {
    // gfx.line signature; long segments are cut into pieces so they break up
    line(x0, y0, x1, y1, width, c, k) {
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
      const pieces = Math.max(1, Math.ceil(len / maxLen)), a = Math.atan2(dy, dx);
      for (let p = 0; p < pieces; p++) {
        const t = (p + 0.5) / pieces;
        add(x0 + dx * t, y0 + dy * t, (len / pieces) * 0.5, a, width, c, k === undefined ? 1 : k, 0);
      }
    },
  };

  return {
    rec,
    get count() { return n; },
    clear() { n = 0; },
    // Where the next shards explode from, and how hard.
    origin(px, py, pw, pieceLen, l0, l1) { ox = px; oy = py; power = pw; maxLen = pieceLen || 26; lifeMin = l0 || 0.34; lifeMax = l1 || 0.52; },
    glass(px, py, size, c, k) { add(px, py, size, rng() * TAU, 1, c, k, 1); },
    update(dt) {
      for (let i = 0; i < n; i++) {
        life[i] -= dt;
        if (life[i] <= 0) {
          const l = --n;
          if (i !== l) {
            x[i] = x[l]; y[i] = y[l]; vx[i] = vx[l]; vy[i] = vy[l]; hl[i] = hl[l]; rot[i] = rot[l]; spin[i] = spin[l]; wd[i] = wd[l];
            life[i] = life[l]; life0[i] = life0[l]; kk[i] = kk[l]; cr[i] = cr[l]; cg[i] = cg[l]; cb[i] = cb[l]; kind[i] = kind[l];
          }
          i--; continue;
        }
        // accelerate outward a little: shards speed up as they near the lens
        const f = 1 + 1.4 * dt;
        vx[i] *= f; vy[i] *= f;
        x[i] += vx[i] * dt; y[i] += vy[i] * dt; rot[i] += spin[i] * dt;
      }
    },
    draw(g) {
      for (let i = 0; i < n; i++) {
        const t = 1 - life[i] / life0[i];
        const k = kk[i] * (1 - t * t) * (1 + (1 - t) * 0.8);
        const grow = 1 + t * 0.9;
        col[0] = cr[i]; col[1] = cg[i]; col[2] = cb[i];
        const c = Math.cos(rot[i]) * hl[i] * grow, s = Math.sin(rot[i]) * hl[i] * grow;
        if (kind[i] === 0) g.line(x[i] - c, y[i] - s, x[i] + c, y[i] + s, wd[i] * (0.62 - t * 0.3), col, k, 4);
        else {
          // a sliver of glass: thin additive triangle with one bright edge
          g.tri(x[i] - c, y[i] - s, x[i] + c, y[i] + s, x[i] - s * 0.55, y[i] + c * 0.55, col, k * 0.22, 0);
          g.line(x[i] - c, y[i] - s, x[i] + c, y[i] + s, 1.4, col, k * 0.9, 3);
        }
      }
    },
  };
}
