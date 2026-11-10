// game/city_env.js — private to city.js: the per-frame environment every city layer draws through.
// Holds the colour ramp, the music clock, the sector theme blend, the nova light model and a
// cheap "plane" helper for faces that sit at one depth (tower fronts, billboards, signs).
import { mixColor, hex, TAU } from '../engine/math.js';
import { C } from './config.js';
import { gearColor } from './tube.js';

export const RG = 140;            // radius of the cylinder's ground (towers stand on it, pointing inward)
export const LZ = 40;             // length of one city cell along the axis
export const NA = 24;             // city cells around the axis
export const CA = TAU / NA;

// ---- scratch. V8 keeps a double on the heap whenever it is handed to a function it did not inline,
// returned from one, or written to a closure variable, and the city draws thousands of primitives a
// frame: done the obvious way that was half a megabyte of garbage per frame. So numbers cross the
// city's own function boundaries through these arrays, and calls carry only colours, small
// integers and booleans.
//   A   arguments of the *S helpers below. Geometry in A[0..5], line width in A[6], light in A[7],
//       a second light or an alpha in A[8]. Helpers never write to A, so a run of similar
//       primitives only has to change the slots that differ.
//   HV  HV[0] is the result of the last H3().
//   Q   the last projS(): screen x, y, px per metre there, depth.
export const A = new Float64Array(16);
export const HV = new Float64Array(1);
export const Q = new Float64Array(4);

// Stateless hash of three integers -> [0,1) in HV[0]. All placement comes from this, so the city is
// stable. (math.js hash1 of the mixed integers, written out so nothing is returned.)
export function H3(a, b, c) {
  let t = (Math.imul(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791), 0x9e3779b1) + 0x7f4a7c15) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  HV[0] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
// floor(hash * n): an integer, so it can be returned.
export function H3n(a, b, c, n) { H3(a, b, c); return (HV[0] * n) | 0; }

// ---- pseudo-kana: invented katakana-like glyphs, a few strokes each, in a unit box (y up).
const KANA_SRC = [
  '.1,.9 .9,.9 .55,.55|.5,.7 .45,.3 .2,.05',
  '.8,.95 .2,.5|.55,.7 .55,.05',
  '.5,1 .5,.8|.15,.55 .15,.8 .85,.8 .8,.4 .4,.05',
  '.15,.85 .85,.85|.5,.85 .5,.15|.05,.15 .95,.15',
  '.1,.7 .85,.7 .8,.2 .6,.05|.5,.95 .45,.4 .15,.05',
  '.15,.75 .85,.8|.1,.45 .9,.5|.45,.98 .6,.02',
  '.4,.95 .15,.5|.4,.8 .85,.8 .7,.35 .3,.05',
  '.15,.85 .85,.85 .85,.15 .15,.15',
  '.05,.7 .95,.7|.3,.95 .3,.4|.7,.95 .7,.4 .45,.05',
  '.15,.9 .3,.8|.1,.6 .25,.5|.15,.1 .6,.25 .9,.7',
  '.15,.85 .8,.85 .5,.4 .1,.05|.55,.45 .9,.05',
  '.4,.95 .15,.5|.4,.8 .85,.8 .7,.35 .3,.05|.35,.55 .65,.4',
  '.2,.9 .8,.9|.05,.6 .95,.6|.5,.6 .45,.3 .25,.05',
  '.3,.95 .3,.05|.3,.6 .8,.4',
  '.05,.65 .95,.65|.5,.95 .45,.4 .2,.05',
  '.2,.75 .8,.75|.05,.2 .95,.2',
  '.8,.95 .6,.45 .15,.05',
  '.35,.8 .1,.1|.65,.8 .9,.1',
  '.2,.95 .2,.15 .85,.15|.2,.6 .8,.7',
  '.1,.85 .9,.85 .75,.4 .3,.05',
  '.05,.7 .95,.7|.5,.95 .5,.05|.25,.45 .1,.15|.75,.45 .9,.15',
  '.15,.85 .85,.85 .85,.15 .15,.15 .15,.85',
  '.15,.85 .85,.85 .85,.15 .15,.15|.2,.5 .85,.5',
  '.25,.92 .75,.92|.1,.65 .9,.65 .75,.3 .35,.05',
  '.3,.9 .3,.4 .1,.05|.6,.95 .6,.1 .95,.4',
  '.15,.5 .15,.85 .85,.85 .8,.4 .4,.05',
  '.15,.85 .35,.7|.1,.1 .6,.25 .9,.7',
  '.5,.95 .5,.05|.1,.5 .9,.5|.2,.2 .8,.2',
];
function parseGlyph(src) {
  const segs = [];
  for (const stroke of src.split('|')) {
    const pts = stroke.trim().split(/\s+/).map((p) => p.split(',').map(Number));
    for (let i = 0; i < pts.length - 1; i++) segs.push(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
  }
  return new Float32Array(segs);
}
export const KANA = KANA_SRC.map(parseGlyph);
export const NKANA = KANA.length;

// ---- sector themes. One row per sector; a z-position blends two rows while a change sweeps past it.
//  dens   tower density            hMul   tower height            sign   signage and billboards
//  mach   foundry machinery        shat   towers breaking off     cor    bare-rail corona
//  flare  white-blue + afterimages win    lit-window fraction
const TH = new Float32Array([
  0.72, 1.00, 0.22, 0, 0, 0.0, 0, 0.30,   // 0 conduit (the city is hidden; same as the Spindle)
  0.72, 1.00, 0.22, 0, 0, 0.0, 0, 0.30,   // 1 THE SPINDLE
  0.80, 0.94, 1.00, 0, 0, 0.0, 0, 0.44,   // 2 NEON MILE
  0.50, 0.70, 0.25, 1, 0, 0.0, 0, 0.14,   // 3 FOUNDRY
  0.64, 1.00, 0.10, 0, 1, 0.0, 0, 0.20,   // 4 SHATTER
  0.05, 0.50, 0.00, 0, 0, 1.0, 0, 0.10,   // 5 CORONA
  0.42, 1.12, 0.06, 0, 0, 0.3, 1, 0.30,   // 6 FLARE
]);
export const NSECT = 6;

export function createEnv(gfx, cam) {
  const S = gfx.S, P = cam.P;
  // The camera, copied once a frame by begin(): [0] focal length, [1..2] principal point,
  // [3..11] rotation, [12..14] position, [15..16] world bend, [17] near, [18] fogStart, [19] fogEnd,
  // [20] fogPow, [21] fogEnd - fogStart.
  const CT = new Float64Array(22);
  const X = new Float64Array(3);          // the point pv() projects
  // plane helper state: screen origin [0..1], the two basis vectors in logical px [2..5], fog [6]
  const PL = new Float64Array(7);
  let own = false;                        // CT reproduces cam.project and cam.fog bit for bit (begin() checks)

  // X -> Q, exactly as cam.project does it. The arithmetic of cam3d's view(), project() and fog() is
  // repeated in this file because cam.project takes three doubles and cam.fog returns one, and
  // each is a heap allocation wherever V8 does not inline the call: measured in the game, calling
  // them from setPlaneS alone was 30 KB of garbage per frame. If the engine's camera ever stops
  // matching this copy, begin() notices and everything here goes through the engine instead.
  function pv() {
    if (!own) {
      if (!cam.project(X[0], X[1], X[2])) return false;
      Q[0] = P[0]; Q[1] = P[1]; Q[2] = P[2]; Q[3] = P[3];
      return true;
    }
    const x = X[0] - CT[12], y = X[1] - CT[13], z = X[2] - CT[14];
    const zc = CT[9] * x + CT[10] * y + CT[11] * z;
    if (zc < CT[17]) return false;
    const zz = zc * zc, s = CT[0] / zc;
    Q[0] = CT[1] + (CT[3] * x + CT[4] * y + CT[5] * z + CT[15] * zz) * s;
    Q[1] = CT[2] - (CT[6] * x + CT[7] * y + CT[8] * z + CT[16] * zz) * s;
    Q[2] = s; Q[3] = zc;
    return true;
  }
  function probe(x, y, z) {
    X[0] = x; X[1] = y; X[2] = z;
    const a = pv(), q0 = Q[0], q1 = Q[1], q2 = Q[2], q3 = Q[3];
    if (cam.project(x, y, z) !== a) return false;
    if (!a) return true;
    const fs = CT[18], fe = CT[19];
    return q0 === P[0] && q1 === P[1] && q2 === P[2] && q3 === P[3] && cam.fog(q3) === (q3 <= fs ? 1 : q3 >= fe ? 0 : Math.pow(1 - (q3 - fs) / CT[21], CT[20]));
  }

  const E = {
    gfx, cam, frame: null,
    // palette for this frame (all inside the violet-to-ice ramp, plus dim warm white and nova gold)
    colA: [0, 0, 0],        // structure: the gear colour
    colB: [0, 0, 0],        // one notch more violet: deep, far, quiet things
    colC: [0, 0, 0],        // one notch bluer: signs and accents
    warm: hex('#ffd6ae'),   // window light
    pale: [0, 0, 0],        // cool window light
    nova: [0, 0, 0], novaHot: [0, 0, 0],
    fillF: [0, 0, 0], fillR: [0, 0, 0], fillD: [0, 0, 0], fillG: [0, 0, 0], fillGF: [0, 0, 0],
    // clocks
    t: 0, time: 0, kick: 0, beat: 0, tick16: 0, barPhase: 0, dist: 0,
    origin: 0,              // world distance of the conduit mouth: the city's cell grid is anchored there
    // light state (set by city.js update)
    boost: 1,               // global brightness (eyes adapting as the tunnel ends)
    danger: 0,              // smoothed frame.danger
    igniteZ: -1e9, igniteOn: false, afterglow: 0,
    // theme transition: cells nearer than `front` already show `secTo`
    secFrom: 1, secTo: 1, front: 1e9, frontOn: false,
    // theme at the last themeAt(z)
    dens: 0.7, hMul: 1, sign: 0.2, mach: 0, shat: 0, cor: 0, flare: 0, win: 0.3,
    // global (time-blended) theme weights for things that are not at a z: backdrop, palette
    gShat: 0, gCor: 0, gFlare: 0, gSign: 0, gMach: 0, gStar: 0,
    // light at the last light(z)
    lk: 1, lg: 0, sr: 0,
    kL: 1, kF: 1,           // luminance compensation for lines and for fills (see begin)
    // projection of the jump gate (the vanishing point), focal length, farthest screen corner from it
    vpx: 640, vpy: 360, focal: 500, maxR: 800, W: 1280, H: 720,
    // conduit / reveal state (set by city.js)
    conduitOn: false, capOn: false, endZ: 0, igniteLevel: 3, pipT: new Float32Array(4), launchT: 9, revealT: 99, creep: 0,
    ps: 1,                  // px per metre of the last plane

    begin(frame) {
      E.frame = frame;
      E.t = frame.t; E.time = frame.time; E.kick = frame.kick; E.beat = frame.beat;
      E.tick16 = Math.floor(frame.beat * 4); E.barPhase = frame.barPhase; E.dist = frame.dist;
      E.W = gfx.W; E.H = gfx.H; E.focal = cam.focal;
      // this frame's camera (the same arithmetic as cam3d begin()), then make sure it is the camera
      CT[0] = cam.focal; CT[1] = gfx.W * cam.cx; CT[2] = gfx.H * cam.cy;
      const cYaw = Math.cos(cam.yaw), sYaw = Math.sin(cam.yaw), cPit = Math.cos(cam.pitch), sPit = Math.sin(cam.pitch), cRol = Math.cos(cam.roll), sRol = Math.sin(cam.roll);
      CT[3] = cYaw * cRol - sYaw * sPit * sRol; CT[4] = cPit * sRol; CT[5] = -sYaw * cRol - cYaw * sPit * sRol;
      CT[6] = -cYaw * sRol - sYaw * sPit * cRol; CT[7] = cPit * cRol; CT[8] = sYaw * sRol - cYaw * sPit * cRol;
      CT[9] = sYaw * cPit; CT[10] = sPit; CT[11] = cYaw * cPit;
      CT[12] = cam.x; CT[13] = cam.y; CT[14] = cam.z; CT[15] = cam.curveX; CT[16] = cam.curveY; CT[17] = cam.near;
      CT[18] = cam.fogStart; CT[19] = cam.fogEnd; CT[20] = cam.fogPow; CT[21] = cam.fogEnd - cam.fogStart;
      // two points in the fog, one just inside the near plane and one just outside it
      own = true;
      own = probe(61, -47, 23) && probe(-9, 118, 310) && probe(cam.x, cam.y, cam.z + cam.near * 1.01) && probe(cam.x, cam.y, cam.z + cam.near * 0.99);
      const g = frame.gearF;
      gearColor(g, E.colA); gearColor(g - 0.9, E.colB); gearColor(g + 0.9, E.colC);
      // FLARE washes the ramp toward white-blue
      if (E.gFlare > 0.01) {
        const w = E.gFlare * 0.55;
        mixColor(E.colA, C.gear[5], w, E.colA); mixColor(E.colB, C.gear[4], w, E.colB); mixColor(E.colC, C.white, w * 0.6, E.colC);
      }
      mixColor(E.colC, C.white, 0.55, E.pale);
      mixColor(C.nova0, C.nova1, 0.35, E.nova); mixColor(C.nova0, C.nova1, 0.85, E.novaHot);
      // The ramp gets far brighter to the eye as it turns from violet to ice. Scale our light down
      // with its luminance so the city sits at the same quiet level under the hazards in every gear.
      const a = E.colA, b = E.colB, v = C.void1;
      const lum = 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2] + 1e-4;
      const kl = Math.pow(0.13 / lum, 0.3); E.kL = kl > 1 ? 1 : kl < 0.55 ? 0.55 : kl;
      // bodies and ground are tinted one notch back down the ramp (deeper, more saturated than the
      // linework), so the fastest gears stay blue instead of washing out to grey
      const lumB = 0.2126 * b[0] + 0.7152 * b[1] + 0.0722 * b[2] + 1e-4;
      let kf = Math.pow(0.13 / lumB, 0.7); kf = kf > 1 ? 1 : kf < 0.25 ? 0.25 : kf;
      E.kF = kf;
      // tower bodies: nearly black, tinted by the ramp so the mass reads as a place and not a hole
      const cf = 0.034 * kf, cr = 0.105 * kf;
      E.fillF[0] = v[0] * 0.6 + b[0] * cf; E.fillF[1] = v[1] * 0.6 + b[1] * cf; E.fillF[2] = v[2] * 0.6 + b[2] * cf;
      E.fillR[0] = v[0] * 0.8 + b[0] * cr; E.fillR[1] = v[1] * 0.8 + b[1] * cr; E.fillR[2] = v[2] * 0.8 + b[2] * cr;
      E.fillD[0] = v[0] * 0.35; E.fillD[1] = v[1] * 0.35; E.fillD[2] = v[2] * 0.35;
      // the same bodies once the nova's light is on them: roofs and tower tops glow like embers
      E.fillG[0] = E.nova[0] * 0.11; E.fillG[1] = E.nova[1] * 0.11; E.fillG[2] = E.nova[2] * 0.11;
      E.fillGF[0] = E.nova[0] * 0.045; E.fillGF[1] = E.nova[1] * 0.045; E.fillGF[2] = E.nova[2] * 0.045;
      // the vanishing point: where the far end of the play tube lands on screen. The world bends, so
      // this is the axis at the depth where the fog swallows the rails, not the middle of the view.
      X[0] = 0; X[1] = 0; X[2] = 540;
      if (pv()) { E.vpx = Q[0]; E.vpy = Q[1]; } else { E.vpx = E.W * 0.5; E.vpy = E.H * 0.5; }
      const dx = Math.max(E.vpx, E.W - E.vpx), dy = Math.max(E.vpy, E.H - E.vpy);
      E.maxR = Math.sqrt(dx * dx + dy * dy);
    },

    // px per metre at tube-frame depth z
    pps(z) { const d = z - cam.z; return d > 0.5 ? E.focal / d : E.focal * 2; },

    // Sector theme at depth A[0] (relative to the runner).
    themeAtS() {
      const z = A[0];
      let t = 1;
      if (E.frontOn) { t = (E.front - z) / 90; t = t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }
      const a = E.secFrom * 8, b = E.secTo * 8, u = 1 - t;
      E.dens = TH[a] * u + TH[b] * t; E.hMul = TH[a + 1] * u + TH[b + 1] * t;
      E.sign = TH[a + 2] * u + TH[b + 2] * t; E.mach = TH[a + 3] * u + TH[b + 3] * t;
      E.shat = TH[a + 4] * u + TH[b + 4] * t; E.cor = TH[a + 5] * u + TH[b + 5] * t;
      E.flare = TH[a + 6] * u + TH[b + 6] * t; E.win = TH[a + 7] * u + TH[b + 7] * t;
    },
    themeRow(sector, i) { return TH[sector * 8 + i]; },

    // Light at depth A[0] for something at radius A[1]: lk multiplies brightness, lg (0..1) is how
    // much nova gold has reached it. Gold is decided by where the thing sits ON SCREEN: it creeps in
    // from the edges (which is where everything close to the camera is) and never reaches the centre,
    // because orange belongs to the nova and the middle of the screen belongs to the hazards.
    lightS() {
      const z = A[0], R = A[1];
      // the bar shimmer: one slow wave of brightness travelling down the city per bar
      let k = E.boost * E.kL * (0.87 + 0.13 * Math.sin(TAU * (E.barPhase - z * 0.0035)));
      let g = 0;
      const d = z - cam.z;
      const sr = d > 1 ? R * E.focal / d : 9999;                 // distance from the vanishing point, px
      E.sr = sr;
      const amt = E.danger > E.afterglow ? E.danger : E.afterglow;
      if (amt > 0.002) {
        const u = (sr - (560 - 390 * amt)) / 230;
        if (u > 0) g = amt * (u > 1 ? 1 : u);
      }
      if (E.igniteOn) {
        const dw = (z - E.igniteZ) / 40, w = Math.exp(-dw * dw);
        k += 1.2 * w; if (w > g) g = w;
      }
      if (E.frontOn) { const df = (z - E.front) / 45; k += 0.9 * E.kL * Math.exp(-df * df); }
      E.lk = k; E.lg = g;
    },
    // Colour for an element with stable hash h: gold if the nova light has reached it, else its own.
    // (Chosen per element, never blended: violet mixed with orange is pink, and pink means danger.)
    pick(base, h) { return E.lg > h ? E.nova : base; },
    // The same test for an element whose hash is H3(a, b, c).
    gold3(a, b, c) { H3(a, b, c); return E.lg > HV[0]; },

    // ---- 3D primitives, read from A. They draw exactly what cam.line / cam.quad / cam.glow draw.
    // Projects the tube-frame point A[0..2] into Q (as cam.project does into cam.P); false behind the near plane.
    projS() { X[0] = A[0]; X[1] = A[1]; X[2] = A[2]; return pv(); },
    // Neon line from A[0..2] to A[3..5], width A[6] in metres, light A[7].
    line3S(col, glow) {
      const L = cam.A;
      L[0] = A[0]; L[1] = A[1]; L[2] = A[2]; L[3] = A[3]; L[4] = A[4]; L[5] = A[5]; L[6] = A[6]; L[7] = A[7];
      cam.lineA(col, glow);
    },
    // A wall along the axis: the edge (A[0],A[1])-(A[2],A[3]) swept from depth A[4] to A[5], light A[7],
    // alpha A[8]. With all four corners in front of the lens (nearly always) this is cam.quad's own
    // arithmetic; otherwise the camera clips it.
    zQuadS(col) {
      const k = A[7], a = A[8];
      X[0] = A[0]; X[1] = A[1]; X[2] = A[4];
      if (own && pv()) {
        const x0 = Q[0], y0 = Q[1], z0 = Q[3];
        X[0] = A[2]; X[1] = A[3];
        if (pv()) {
          const x1 = Q[0], y1 = Q[1], z1 = Q[3];
          X[2] = A[5];
          if (pv()) {
            const x2 = Q[0], y2 = Q[1], z2 = Q[3];
            X[0] = A[0]; X[1] = A[1];
            if (pv()) {
              const x3 = Q[0], y3 = Q[1], z3 = Q[3], fs = CT[18], fe = CT[19], fr = CT[21], fp = CT[20];
              const k0 = k * (z0 <= fs ? 1 : z0 >= fe ? 0 : Math.pow(1 - (z0 - fs) / fr, fp));
              const k1 = k * (z1 <= fs ? 1 : z1 >= fe ? 0 : Math.pow(1 - (z1 - fs) / fr, fp));
              const k2 = k * (z2 <= fs ? 1 : z2 >= fe ? 0 : Math.pow(1 - (z2 - fs) / fr, fp));
              const k3 = k * (z3 <= fs ? 1 : z3 >= fe ? 0 : Math.pow(1 - (z3 - fs) / fr, fp));
              if (k0 < 0.003 && k1 < 0.003 && k2 < 0.003 && k3 < 0.003 && a <= 0) return;
              // entirely off one side of the view: nothing to draw
              const W = E.W, H = E.H;
              if ((x0 < 0 && x1 < 0 && x2 < 0 && x3 < 0) || (x0 > W && x1 > W && x2 > W && x3 > W)) return;
              if ((y0 < 0 && y1 < 0 && y2 < 0 && y3 < 0) || (y0 > H && y1 > H && y2 > H && y3 > H)) return;
              S[0] = x0; S[1] = y0; S[2] = k0; S[3] = x1; S[4] = y1; S[5] = k1; S[6] = x2; S[7] = y2; S[8] = k2; S[9] = x3; S[10] = y3; S[11] = k3;
              gfx.quadKS(col, a);
              return;
            }
          }
        }
      }
      const q = cam.Q;
      q[0] = A[0]; q[1] = A[1]; q[2] = A[4]; q[3] = A[2]; q[4] = A[3]; q[5] = A[4]; q[6] = A[2]; q[7] = A[3]; q[8] = A[5]; q[9] = A[0]; q[10] = A[1]; q[11] = A[5];
      q[12] = k; q[13] = a;
      cam.quadA(col);
    },
    // Camera-facing glow at A[0..2], radius A[3] in metres, light A[7] (cam.glow's arithmetic).
    glow3S(col, pow) {
      if (!own) { cam.glow(A[0], A[1], A[2], A[3], col, A[7], pow); return; }
      X[0] = A[0]; X[1] = A[1]; X[2] = A[2];
      if (!pv()) return;
      const z = Q[3], fs = CT[18], fe = CT[19];
      const kk = A[7] * (z <= fs ? 1 : z >= fe ? 0 : Math.pow(1 - (z - fs) / CT[21], CT[20]));
      if (kk < 0.003) return;
      gfx.glow(Q[0], Q[1], A[3] * Q[2], col, kk, pow);
    },

    // ---- plane helper: a flat face at one depth. (A[0],A[1]) is its origin at depth A[2], (A[3],A[4])
    // and (A[5],A[6]) its unit axes U and V in the tube frame. The p* helpers then take plane coordinates.
    setPlaneS() {
      X[0] = A[0]; X[1] = A[1]; X[2] = A[2];
      if (!pv()) return false;
      const x0 = Q[0], y0 = Q[1], z = Q[3], fs = CT[18], fe = CT[19];
      const fg = !own ? cam.fog(z) : z <= fs ? 1 : z >= fe ? 0 : Math.pow(1 - (z - fs) / CT[21], CT[20]);
      PL[0] = x0; PL[1] = y0; E.ps = Q[2]; PL[6] = fg;
      if (fg < 0.004) return false;
      X[0] = A[0] + A[3]; X[1] = A[1] + A[4]; pv(); PL[2] = Q[0] - x0; PL[3] = Q[1] - y0;
      X[0] = A[0] + A[5]; X[1] = A[1] + A[6]; pv(); PL[4] = Q[0] - x0; PL[5] = Q[1] - y0;
      return true;
    },
    // hairline (A[0],A[1])-(A[2],A[3]); width A[6] is in screen px so far lines stay crisp; light A[7]
    pLineS(col, glow = 3) {
      const u0 = A[0], v0 = A[1], u1 = A[2], v1 = A[3];
      S[0] = PL[0] + PL[2] * u0 + PL[4] * v0; S[1] = PL[1] + PL[3] * u0 + PL[5] * v0;
      S[2] = PL[0] + PL[2] * u1 + PL[4] * v1; S[3] = PL[1] + PL[3] * u1 + PL[5] * v1;
      S[4] = A[6]; S[5] = A[7] * PL[6];
      gfx.lineS(col, glow);
    },
    // the same hairline with its light fading from A[7] to A[8] along its length
    pFadeS(col, glow = 3) {
      const u0 = A[0], v0 = A[1], u1 = A[2], v1 = A[3];
      S[0] = PL[0] + PL[2] * u0 + PL[4] * v0; S[1] = PL[1] + PL[3] * u0 + PL[5] * v0; S[2] = A[6]; S[3] = A[7] * PL[6];
      S[4] = PL[0] + PL[2] * u1 + PL[4] * v1; S[5] = PL[1] + PL[3] * u1 + PL[5] * v1; S[6] = A[6]; S[7] = A[8] * PL[6];
      gfx.lineTaperS(col, glow);
    },
    // rectangle (A[0],A[1])..(A[2],A[3]), light A[7]
    pRectS(col, a) {
      const u0 = A[0], v0 = A[1], u1 = A[2], v1 = A[3], k = A[7] * PL[6];
      S[0] = PL[0] + PL[2] * u0 + PL[4] * v0; S[1] = PL[1] + PL[3] * u0 + PL[5] * v0; S[2] = k;
      S[3] = PL[0] + PL[2] * u1 + PL[4] * v0; S[4] = PL[1] + PL[3] * u1 + PL[5] * v0; S[5] = k;
      S[6] = PL[0] + PL[2] * u1 + PL[4] * v1; S[7] = PL[1] + PL[3] * u1 + PL[5] * v1; S[8] = k;
      S[9] = PL[0] + PL[2] * u0 + PL[4] * v1; S[10] = PL[1] + PL[3] * u0 + PL[5] * v1; S[11] = k;
      gfx.quadKS(col, a);
    },
    // trapezoid with a gradient along v: (A[0]..A[1] at v = A[2]) is colA, (A[3]..A[4] at v = A[5]) is colB; alpha A[8]
    pTrapS(colA, colB) {
      const uA0 = A[0], uA1 = A[1], vA = A[2], uB0 = A[3], uB1 = A[4], vB = A[5], k = PL[6], a = A[8];
      // through the batch's scratch array: fourteen numbers passed as arguments would be fourteen boxes
      S[0] = PL[0] + PL[2] * uA0 + PL[4] * vA; S[1] = PL[1] + PL[3] * uA0 + PL[5] * vA; S[2] = PL[0] + PL[2] * uA1 + PL[4] * vA; S[3] = PL[1] + PL[3] * uA1 + PL[5] * vA;
      S[4] = PL[0] + PL[2] * uB1 + PL[4] * vB; S[5] = PL[1] + PL[3] * uB1 + PL[5] * vB; S[6] = PL[0] + PL[2] * uB0 + PL[4] * vB; S[7] = PL[1] + PL[3] * uB0 + PL[5] * vB;
      S[8] = k; S[9] = a; S[10] = k; S[11] = a;
      gfx.quadGradS(colA, colB);
    },
    // soft dot at (A[0],A[1]), radius A[2] in px, light A[7]
    pDotS(col, pow) {
      const u = A[0], v = A[1];
      gfx.glow(PL[0] + PL[2] * u + PL[4] * v, PL[1] + PL[3] * u + PL[5] * v, A[2], col, A[7] * PL[6], pow);
    },
    // neon circle at (A[0],A[1]), radius A[2] in px, width A[6], light A[7]
    pRingS(col, glow) {
      const u = A[0], v = A[1];
      gfx.ring(PL[0] + PL[2] * u + PL[4] * v, PL[1] + PL[3] * u + PL[5] * v, A[2], A[6], col, A[7] * PL[6], glow);
    },
    // one pseudo-kana in the box (A[0],A[1])..(+A[2], +A[3]); the glyph's top is at v (toward the axis); width A[6], light A[7]
    pGlyphS(gi, col) {
      const g = KANA[((gi % NKANA) + NKANA) % NKANA], u = A[0], v = A[1], w = A[2], h = A[3];
      S[4] = A[6]; S[5] = A[7] * PL[6];
      for (let j = 0; j < g.length; j += 4) {
        const u0 = u + g[j] * w, v0 = v + (1 - g[j + 1]) * h, u1 = u + g[j + 2] * w, v1 = v + (1 - g[j + 3]) * h;
        S[0] = PL[0] + PL[2] * u0 + PL[4] * v0; S[1] = PL[1] + PL[3] * u0 + PL[5] * v0;
        S[2] = PL[0] + PL[2] * u1 + PL[4] * v1; S[3] = PL[1] + PL[3] * u1 + PL[5] * v1;
        gfx.lineS(col, 3);
      }
    },
    // true when the plane's origin is on screen, with a margin of A[0] px
    pOnS() {
      const x = PL[0], y = PL[1], m = A[0];
      return x > -m && x < E.W + m && y > -m && y < E.H + m;
    },
  };
  return E;
}
