// engine/font.js — a procedural neon vector font. Every glyph is a few strokes on a 4x6 grid,
// drawn with gfx.line so text glows, blooms and distorts exactly like the rest of the world.
// Uppercase only (lowercase input is upper-cased).

// Each glyph: strokes separated by '|', points 'x,y' separated by spaces. Grid: x 0..4, y 0..6 (y up, baseline 0).
const G = {
  'A': '0,0 0,4.5 1.5,6 2.5,6 4,4.5 4,0|0,2.5 4,2.5',
  'B': '0,0 0,6 3,6 4,5 4,4 3.2,3.2 4,2.4 4,1 3,0 0,0|0,3.2 3.2,3.2',
  'C': '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1',
  'D': '0,0 0,6 3,6 4,5 4,1 3,0 0,0',
  'E': '4,6 0,6 0,0 4,0|0,3.2 3,3.2',
  'F': '4,6 0,6 0,0|0,3.2 3,3.2',
  'G': '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2.2,3',
  'H': '0,0 0,6|4,0 4,6|0,3.2 4,3.2',
  'I': '2,0 2,6|0.8,0 3.2,0|0.8,6 3.2,6',
  'J': '4,6 4,1 3,0 1,0 0,1 0,2',
  'K': '0,0 0,6|4,6 0,2.8|1.4,3.9 4,0',
  'L': '0,6 0,0 4,0',
  'M': '0,0 0,6 2,3.4 4,6 4,0',
  'N': '0,0 0,6 4,0 4,6',
  'O': '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0',
  'P': '0,0 0,6 3,6 4,5 4,3.8 3,2.8 0,2.8',
  'Q': '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0|2.4,1.6 4.2,-0.4',
  'R': '0,0 0,6 3,6 4,5 4,3.8 3,2.8 0,2.8|2,2.8 4,0',
  'S': '4,5 3,6 1,6 0,5 0,4 1,3.2 3,3.2 4,2.4 4,1 3,0 1,0 0,1',
  'T': '0,6 4,6|2,6 2,0',
  'U': '0,6 0,1 1,0 3,0 4,1 4,6',
  'V': '0,6 2,0 4,6',
  'W': '0,6 0.9,0 2,3.2 3.1,0 4,6',
  'X': '0,0 4,6|0,6 4,0',
  'Y': '0,6 2,3 4,6|2,3 2,0',
  'Z': '0,6 4,6 0,0 4,0',
  '0': '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0|1.2,1.6 2.8,4.4',
  '1': '0.8,4.8 2,6 2,0|0.8,0 3.2,0',
  '2': '0,5 1,6 3,6 4,5 4,3.8 0,0 4,0',
  '3': '0,5 1,6 3,6 4,5 4,4 3.2,3.2 4,2.4 4,1 3,0 1,0 0,1|1.6,3.2 3.2,3.2',
  '4': '3,0 3,6 0,2 4,2',
  '5': '4,6 0,6 0,3.4 3,3.4 4,2.4 4,1 3,0 1,0 0,1',
  '6': '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2.4 3,3.4 0,3.4',
  '7': '0,6 4,6 1.6,0',
  '8': '1,0 3,0 4,1 4,2.4 3.2,3.2 4,4 4,5 3,6 1,6 0,5 0,4 0.8,3.2 0,2.4 0,1 1,0|0.8,3.2 3.2,3.2',
  '9': '0,1 1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,3.6 1,2.6 4,2.6',
  '.': '1.8,0 2.2,0 2.2,0.4 1.8,0.4 1.8,0',
  ',': '2.1,0.5 2.1,0 1.5,-0.9',
  ':': '1.8,1 2.2,1 2.2,1.4 1.8,1.4 1.8,1|1.8,4 2.2,4 2.2,4.4 1.8,4.4 1.8,4',
  '!': '2,6 2,2|1.8,0 2.2,0 2.2,0.4 1.8,0.4 1.8,0',
  '?': '0,5 1,6 3,6 4,5 4,4 2,2.6 2,1.8|1.8,0 2.2,0 2.2,0.4 1.8,0.4 1.8,0',
  '-': '0.8,3 3.2,3',
  '+': '0.6,3 3.4,3|2,1.6 2,4.4',
  '=': '0.6,2.2 3.4,2.2|0.6,3.8 3.4,3.8',
  '/': '0.4,0 3.6,6',
  '\\': '0.4,6 3.6,0',
  '%': '0.4,0 3.6,6|0.2,5.9 1.1,5.9 1.1,4.8 0.2,4.8 0.2,5.9|2.9,1.2 3.8,1.2 3.8,0.1 2.9,0.1 2.9,1.2',
  '(': '2.8,6 1.6,4.8 1.6,1.2 2.8,0',
  ')': '1.2,6 2.4,4.8 2.4,1.2 1.2,0',
  '[': '2.8,6 1.4,6 1.4,0 2.8,0',
  ']': '1.2,6 2.6,6 2.6,0 1.2,0',
  '<': '3.4,5.2 0.6,3 3.4,0.8',
  '>': '0.6,5.2 3.4,3 0.6,0.8',
  '_': '0,0 4,0',
  '\'': '2,6 2,4.6',
  '"': '1.3,6 1.3,4.6|2.7,6 2.7,4.6',
  '*': '2,1.4 2,4.6|0.6,2.2 3.4,3.8|0.6,3.8 3.4,2.2',
  '#': '1.2,0.6 1.2,5.4|2.8,0.6 2.8,5.4|0.2,2 3.8,2|0.2,4 3.8,4',
  '×': '0.6,1 3.4,5|0.6,5 3.4,1',
  '↑': '2,0 2,6|0.4,4.2 2,6 3.6,4.2',
  '↓': '2,6 2,0|0.4,1.8 2,0 3.6,1.8',
  '←': '4,3 0,3|1.8,4.8 0,3 1.8,1.2',
  '→': '0,3 4,3|2.2,4.8 4,3 2.2,1.2',
  '♦': '2,0.4 3.8,3 2,5.6 0.2,3 2,0.4',
  '▲': '0.2,0.6 2,5.4 3.8,0.6 0.2,0.6',
  '▼': '0.2,5.4 2,0.6 3.8,5.4 0.2,5.4',
  '■': '0.4,0.8 3.6,0.8 3.6,5.2 0.4,5.2 0.4,0.8',
  '●': '1.2,0.6 2.8,0.6 3.8,2 3.8,4 2.8,5.4 1.2,5.4 0.2,4 0.2,2 1.2,0.6',
  '|': '2,-0.4 2,6.4',
};

// Parsed glyphs: Float32Array of segment endpoints [x0,y0,x1,y1,...]
const GLYPHS = new Map();
for (const ch in G) {
  const segs = [];
  for (const stroke of G[ch].split('|')) {
    const pts = stroke.trim().split(/\s+/).map((p) => p.split(',').map(Number));
    for (let i = 0; i < pts.length - 1; i++) segs.push(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
  }
  GLYPHS.set(ch, new Float32Array(segs));
}

export const GLYPH_W = 4;
export const GLYPH_H = 6;
const ADVANCE = 5.5; // glyph width + gap, in grid units
const NARROW = { 'I': 4.4, '1': 4.6, '.': 2.8, ',': 2.8, ':': 2.8, '!': 2.8, '\'': 2.4, ' ': 3.4, '|': 2.8, '(': 3.6, ')': 3.6, '[': 3.6, ']': 3.6 };
const advanceOf = (ch) => NARROW[ch] !== undefined ? NARROW[ch] : ADVANCE;

// Width of `str` at cap height `size` (logical units). `tracking` adds extra spacing in grid units.
export function measureText(str, size, tracking = 0) {
  const s = size / GLYPH_H;
  let w = 0;
  const up = String(str).toUpperCase();
  for (let i = 0; i < up.length; i++) w += advanceOf(up[i]) + tracking;
  return (w - (ADVANCE - GLYPH_W) - tracking) * s;
}

// Draws text. (x, y) is the anchor: horizontally per `align` (0 left, 0.5 center, 1 right),
// vertically the middle of the cap height. size = cap height. weight = stroke core thickness as a
// fraction of size (default 0.09). slant skews glyphs (0.2 = italic). Returns the text width.
export function drawText(gfx, str, x, y, size, col, k = 1, align = 0, opts) {
  const tracking = opts && opts.tracking !== undefined ? opts.tracking : 0;
  const weight = opts && opts.weight !== undefined ? opts.weight : 0.09;
  const glow = opts && opts.glow !== undefined ? opts.glow : 4;
  const slant = opts && opts.slant !== undefined ? opts.slant : 0;
  const up = String(str).toUpperCase();
  const s = size / GLYPH_H;
  const total = measureText(up, size, tracking);
  let cx = x - total * align;
  const lw = size * weight;
  for (let i = 0; i < up.length; i++) {
    const ch = up[i];
    const g = GLYPHS.get(ch);
    if (g) {
      // center narrow glyphs inside their advance box
      const off = (advanceOf(ch) - (ADVANCE - GLYPH_W) - GLYPH_W) * 0.5 * s;
      for (let j = 0; j < g.length; j += 4) {
        const y0 = g[j + 1], y1 = g[j + 3];
        gfx.line(cx + off + (g[j] + (y0 - 3) * slant) * s, y + (3 - y0) * s, cx + off + (g[j + 2] + (y1 - 3) * slant) * s, y + (3 - y1) * s, lw, col, k, glow);
      }
    }
    cx += (advanceOf(ch) + tracking) * s;
  }
  return total;
}

// Per-character draw with a callback that can offset/scale each glyph (wavy titles, glitch, type-on).
// fn(i, n) returns nothing or an object {dx, dy, k, skip}.
export function drawTextFx(gfx, str, x, y, size, col, k, align, opts, fn) {
  const tracking = opts && opts.tracking !== undefined ? opts.tracking : 0;
  const weight = opts && opts.weight !== undefined ? opts.weight : 0.09;
  const glow = opts && opts.glow !== undefined ? opts.glow : 4;
  const slant = opts && opts.slant !== undefined ? opts.slant : 0;
  const up = String(str).toUpperCase();
  const s = size / GLYPH_H;
  const total = measureText(up, size, tracking);
  let cx = x - total * align;
  const lw = size * weight;
  for (let i = 0; i < up.length; i++) {
    const ch = up[i];
    const g = GLYPHS.get(ch);
    const fx = fn ? fn(i, up.length) : null;
    if (g && !(fx && fx.skip)) {
      const dx = fx && fx.dx ? fx.dx : 0, dy = fx && fx.dy ? fx.dy : 0, kk = fx && fx.k !== undefined ? k * fx.k : k;
      const off = (advanceOf(ch) - (ADVANCE - GLYPH_W) - GLYPH_W) * 0.5 * s;
      for (let j = 0; j < g.length; j += 4) {
        const y0 = g[j + 1], y1 = g[j + 3];
        gfx.line(cx + off + dx + (g[j] + (y0 - 3) * slant) * s, y + dy + (3 - y0) * s, cx + off + dx + (g[j + 2] + (y1 - 3) * slant) * s, y + dy + (3 - y1) * s, lw, col, kk, glow);
      }
    }
    cx += (advanceOf(ch) + tracking) * s;
  }
  return total;
}
