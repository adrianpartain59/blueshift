// game/city_spindle.js — private to city.js: THE SPINDLE, the cylinder megacity wrapped around the
// player. Towers stand on the inside of a 140 m cylinder and point inward at the axis.
//
// How it is drawn: seen from the axis, a tower shows exactly two faces: its FRONT (the face that
// looks back at the camera, flat at one depth) and its ROOF (the face that looks at the axis,
// receding toward the vanishing point). Fronts go through the env's affine plane helper (cheap,
// crisp px-width hairlines, window lights); roofs go through the env's 3D helpers (what cam.quad
// and cam.line draw, with the numbers handed over in the scratch array A).
// Cells are (z index, angle index); everything about a cell comes from H3 of those integers, so
// the city is the same every frame and every run. Rings of cells are drawn far to near.
import { TAU, clamp01, clamp } from '../engine/math.js';
import { RG, LZ, NA, CA, H3, H3n, HV, A, Q } from './city_env.js';

const GREAT_EVERY = 8;      // a great ring every 8 cells (320 m) ...
// ... and a gateway of three in quick succession just past the conduit mouth, because the first
// seconds after THE DROP are the picture that sells the game: nested rings, four megatowers.
const isGreat = (zi) => zi === 2 || zi === 4 || (((zi - 6) % GREAT_EVERY) + GREAT_EVERY) % GREAT_EVERY === 0;
const isGateTower = (zi, ai, sub) => sub === 0 && ((zi === 3 && ai % 4 === 1) || (zi === 5 && ai % 4 === 3));
const FAR_CELLS = 14;       // cells drawn ahead of the camera (560 m: the fog has eaten the rest)

// Per-ring and per-tower numbers live in G, and a box's arguments in B (see the note on scratch in
// city_env.js: a double in a closure variable or an argument list is a heap allocation).
const EX = 0, EY = 1, TX = 2, TY = 3;   // G: this tower's radial (outward) and tangential unit vectors
const RK = 4;                           // light of the ring being drawn
const AF = 5;                           // body opacity of the ring being drawn
const SH = 6;                           // SHATTER: how broken this ring is (0..1)
const OT = 7;                           // cells with less cluster noise than this are open to space
const ZC = 8;                           // depth of the near edge of the ring being drawn
const CZ = 9;                           // the camera's depth

export function createSpindle(E) {
  const { gfx, cam } = E;
  const G = new Float64Array(10);
  // B: tangential centre [0], half-width at the roof [1] and at the base [2], roof radius [3], base
  // radius [4], near and far depth [5..6]; [7] is the length of the mast for antenna()
  const B = new Float64Array(8);
  let lightCol = E.warm;                     // window colour of the tower being drawn
  const tipR = new Float32Array(NA * 2), tipZ = new Float32Array(NA * 2), tipA = new Float32Array(NA * 2);
  const nz = new Float32Array(NA);           // cluster noise of the ring being drawn

  // Coarse value noise over the cylinder: where the downtown clusters and the low-rise gaps are.
  function cluster(zi) {
    const gz = zi / 3, iz = Math.floor(gz);
    let fz = gz - iz;
    fz = fz * fz * (3 - 2 * fz);
    for (let ai = 0; ai < NA; ai++) {
      const ga = ai / 4, ia = Math.floor(ga);
      let fa = ga - ia;
      fa = fa * fa * (3 - 2 * fa);
      const a0 = ((ia % 6) + 6) % 6, a1 = (a0 + 1) % 6;
      H3(iz, a0, 77); const n0 = HV[0];
      H3(iz, a1, 77); const n1 = HV[0];
      H3(iz + 1, a0, 77); const n2 = HV[0];
      H3(iz + 1, a1, 77); const n3 = HV[0];
      nz[ai] = (n0 + (n1 - n0) * fa) * (1 - fz) + (n2 + (n3 - n2) * fa) * fz;
    }
  }
  // Three helical avenues: tower-free boulevards that spiral slowly around the cylinder.
  const isAvenue = (zi, ai) => (((ai - Math.floor(zi / 5)) % 8) + 8) % 8 === 0;

  // One box of a tower (arguments in B): tangential centre uc, half-width hT at its roof (radius r0)
  // widening to hB at radius r1, from z0 to z1. Returns true when its front plane is set (for masts
  // and lights).
  function box(lod, seed, pat) {
    const uc = B[0], hT = B[1], hB = B[2], r0 = B[3], r1 = B[4], z0 = B[5], z1 = B[6];
    const ex = G[EX], ey = G[EY], tx = G[TX], ty = G[TY], rk = G[RK], afill = G[AF], cz = G[CZ];
    const ax = tx * (uc - hT) + ex * r0, ay = ty * (uc - hT) + ey * r0;
    const bx = tx * (uc + hT) + ex * r0, by = ty * (uc + hT) + ey * r0;
    const zn = z0 < cz + 1 ? cz + 1 : z0;
    const gold = E.gold3(seed, 3, 5);
    const cE = gold ? E.nova : E.colA;
    const kE = (gold ? 0.46 : 0.33) * rk;
    // roof first: it is behind the front face. It faces the axis, so it is the lit side of the box.
    if (lod < 2 || z0 < 420) {
      A[0] = ax; A[1] = ay; A[2] = bx; A[3] = by; A[4] = zn; A[5] = z1; A[7] = 1; A[8] = afill;
      E.zQuadS(gold ? E.fillG : E.fillR);
    }
    if (lod < 2) {
      const d = zn - cz;
      A[6] = 1.25 / (d > 0.5 ? E.focal / d : E.focal * 2); A[7] = 0.24 * rk;
      A[0] = ax; A[1] = ay; A[2] = zn; A[3] = ax; A[4] = ay; A[5] = z1; E.line3S(E.colA, 3);
      A[0] = bx; A[1] = by; A[3] = bx; A[4] = by; E.line3S(E.colA, 3);
      if (lod === 0) { A[0] = ax; A[1] = ay; A[2] = z1; A[7] = 0.14 * rk; E.line3S(E.colA, 3); }
    }
    if (z0 < cz + 1) return false;
    A[0] = tx * uc + ex * r0; A[1] = ty * uc + ey * r0; A[2] = z0; A[3] = tx; A[4] = ty; A[5] = ex; A[6] = ey;
    if (!E.setPlaneS()) return false;
    const hgt = r1 - r0;
    // the body: lit at the top by the glow of the axis, sinking into the dark toward the ground
    A[0] = -hT; A[1] = hT; A[2] = 0; A[3] = -hB; A[4] = hB; A[5] = hgt; A[8] = afill;
    E.pTrapS(gold ? E.fillGF : E.fillF, E.fillD);
    let lw = E.ps * 0.13;
    lw = lw < 1.1 ? 1.1 : lw > 1.8 ? 1.8 : lw;
    A[0] = -hT; A[1] = 0; A[2] = hT; A[3] = 0; A[6] = lw; A[7] = kE; E.pLineS(cE);
    if (lod < 2) {
      A[7] = kE * 0.6; A[8] = kE * 0.06;
      A[0] = -hT; A[2] = -hB; A[3] = hgt; E.pFadeS(cE);
      A[0] = hT; A[2] = hB; E.pFadeS(cE);
    }
    lights(lod, seed, pat);
    return true;
  }

  // Window light on the front face whose plane is set (the box is still in B). Three facade languages:
  //   0 panes   a regular grid of small lit panes (rows of dashes at mid distance)
  //   1 strips  vertical light strips, pointing at the gate like everything else here
  //   2 floors  stacked lit floors, fine horizontal lines
  // A third of the lights blink on the 16th-note grid: the city is a metronome.
  function lights(lod, seed, pat) {
    const win = E.win, hT = B[1], hB = B[2], hgt = B[4] - B[3], rk = G[RK];
    if (win < 0.02 || hgt < 5) return;
    const lc = E.gold3(seed, 1, 9) ? E.novaHot : lightCol;
    if (lod === 2) {
      H3(seed, 0, 17);
      if (HV[0] < win * 1.7) {
        H3(seed, 0, 18);
        A[0] = 0; A[1] = hgt * 0.1; A[2] = 0; A[3] = hgt * (0.35 + 0.4 * HV[0]); A[6] = 1.1; A[7] = 0.17 * rk; E.pLineS(lc, 2.5);
      }
      return;
    }
    const tw = E.tick16;
    if (pat === 0) {
      if (lod === 0) {
        const cols = clamp(Math.floor((hT + hB) / 1.7), 1, 7), rows = clamp(Math.floor((hgt - 2) / 3), 1, 24);
        const dv = (hgt - 2.5) / rows, total = cols * rows;
        const p = win * 1.5 * total > 30 ? 30 / total : win * 1.5;
        for (let r = 0; r < rows; r++) {
          const v = 1.6 + (r + 0.5) * dv, hv = hT + (hB - hT) * v / hgt - 0.7, du = 2 * hv / cols;
          for (let c = 0; c < cols; c++) {
            H3(seed + r * 31, c, 11);
            const h = HV[0];
            if (h >= p) continue;
            const hh = h / p;
            let kk = 0.34 - 0.13 * hh;
            if (hh < 0.34) { H3(seed + r * 31 + c * 7, tw, 12); if (HV[0] < 0.42) kk *= 0.15; }
            const u = -hv + (c + 0.5) * du;
            A[0] = u - 0.45; A[1] = v - 0.62; A[2] = u + 0.45; A[3] = v + 0.62; A[7] = kk * rk; E.pRectS(lc, 0);
          }
        }
      } else {
        // rows of lit windows read as short dashes
        const rows = Math.min(9, Math.floor(hgt / 5.5));
        A[6] = 1.25;
        for (let r = 0; r < rows; r++) {
          H3(seed, r, 21);
          const h = HV[0];
          if (h > win * 2.3) continue;
          const v = (r + 0.7) * hgt / (rows + 0.5), hv = hT + (hB - hT) * v / hgt - 0.7;
          H3(seed, r, 22);
          const u0 = -hv + 2 * hv * HV[0] * 0.6;
          H3(seed, r, 23);
          const u1 = u0 + 2 * hv * (0.2 + 0.25 * HV[0]);
          let on = 1;
          if (h < win * 0.7) { H3(seed + r, tw, 12); if (HV[0] < 0.42) on = 0.2; }
          A[0] = u0; A[1] = v; A[2] = u1 > hv ? hv : u1; A[3] = v; A[7] = 0.3 * rk * on; E.pLineS(lc, 2.4);
        }
      }
    } else if (pat === 1) {
      const n = lod === 0 ? 3 : 2;
      A[6] = 1.15;
      for (let i = 0; i < n; i++) {
        const f = ((i + 0.5) / n * 2 - 1) * 0.62;
        H3(seed, i, 24);
        const v0 = 1.4 + HV[0] * hgt * 0.18;
        H3(seed, i, 25);
        const v1 = hgt * (0.45 + 0.5 * HV[0]);
        H3(seed + i, tw >> 1, 26);
        const on = HV[0] < 0.2 ? 0.3 : 1;
        A[0] = f * (hT + (hB - hT) * v0 / hgt); A[1] = v0; A[2] = f * (hT + (hB - hT) * v1 / hgt); A[3] = v1;
        A[7] = 0.28 * rk * on; A[8] = 0.07 * rk * on; E.pFadeS(lc, 2.6);
      }
      const m = lod === 0 ? 7 : 3;
      for (let i = 0; i < m; i++) {
        H3(seed, i, 22);
        const v = hgt * (0.08 + 0.8 * HV[0]), hv = hT + (hB - hT) * v / hgt - 0.7;
        H3(seed + i, tw, 12);
        if (HV[0] < 0.3) continue;
        H3(seed, i, 23);
        const u = (HV[0] - 0.5) * 1.6 * hv;
        if (lod === 0) { A[0] = u - 0.45; A[1] = v - 0.65; A[2] = u + 0.45; A[3] = v + 0.65; A[7] = 0.3 * rk; E.pRectS(lc, 0); }
        else { A[0] = u; A[1] = v; A[2] = 1.4; A[7] = 0.34 * rk; E.pDotS(lc, 2.4); }
      }
    } else {
      const n = lod === 0 ? Math.min(16, Math.floor(hgt / 3.6)) : Math.min(8, Math.floor(hgt / 6.5));
      A[6] = 1.1;
      for (let r = 0; r < n; r++) {
        const v = (r + 0.6) * hgt / (n + 0.3), hv = hT + (hB - hT) * v / hgt - 0.6;
        H3(seed, r, 27);
        const h = HV[0];
        if (h > 0.45 + win * 1.3) continue;                        // a dark floor
        let kk = h < win * 1.1 ? 0.27 : 0.11;
        if (h < win * 0.5) { H3(seed + r, tw, 12); if (HV[0] < 0.4) kk = 0.07; }
        H3(seed, r, 28);
        const cut = HV[0];
        A[0] = cut < 0.25 ? -hv * 0.2 : -hv; A[1] = v; A[2] = cut > 0.75 ? hv * 0.3 : hv; A[3] = v; A[7] = kk * rk; E.pLineS(lc, 2.5);
      }
    }
  }

  // A mast of length B[7] on the last box drawn (its plane is still set): a hairline toward the axis
  // and a blinking tip.
  function antenna(lod, seed) {
    const len = B[7];
    A[0] = 0; A[1] = 0; A[2] = 0; A[3] = -len; A[6] = 1.1; A[7] = 0.28 * G[RK]; E.pLineS(E.colA);
    if (lod === 0) { A[1] = -len; A[2] = 2; A[7] = (((E.tick16 >> 1) + seed) & 3) === 0 ? 0.42 : 0.1; E.pDotS(E.warm, 2); }
  }

  // FLARE: afterimages. Echoes of a tower's outline (B[0..5]: uc, hT, hB, r0, r1, z0) sliding back
  // toward the camera.
  function echo() {
    const uc = B[0], hT = B[1], hB = B[2], r0 = B[3], r1 = B[4], z0 = B[5], amount = E.flare;
    const ex = G[EX], ey = G[EY], tx = G[TX], ty = G[TY], rk = G[RK];
    for (let i = 1; i <= 2; i++) {
      const z = z0 - i * 7;
      if (z < G[CZ] + 2) return;
      A[0] = tx * uc + ex * r0; A[1] = ty * uc + ey * r0; A[2] = z; A[3] = tx; A[4] = ty; A[5] = ex; A[6] = ey;
      if (!E.setPlaneS()) return;
      const k = 0.2 * rk * amount / i, hgt = r1 - r0;
      A[0] = -hT; A[1] = 0; A[2] = hT; A[3] = 0; A[6] = 1.1; A[7] = k; E.pLineS(E.colC);
      A[7] = k * 0.7; A[8] = 0;
      A[2] = -hB; A[3] = hgt; E.pFadeS(E.colC);
      A[0] = hT; A[2] = hB; E.pFadeS(E.colC);
    }
  }

  // SHATTER: the top of a tower (B[0..5]: uc, hT, hB, rCut, rTip, z0), broken off and tumbling free
  // in gold light.
  function fragment(seed) {
    const uc = B[0], hT = B[1], hB = B[2], rCut = B[3], rTip = B[4], z0 = B[5], s = G[SH];
    const ex = G[EX], ey = G[EY], tx = G[TX], ty = G[TY], rk = G[RK];
    H3(seed, 1, 70); const h1 = HV[0];
    H3(seed, 2, 70); const h2 = HV[0];
    H3(seed, 3, 70); const h3 = HV[0];
    const d = s * s * (14 + 30 * h1);
    const phi = s * (h2 - 0.5) * 2.2;
    const cs = Math.cos(phi), sn = Math.sin(phi);
    // rotated basis in the facade plane
    const ux = tx * cs + ex * sn, uy = ty * cs + ey * sn, vx = -tx * sn + ex * cs, vy = -ty * sn + ey * cs;
    const len = rCut - rTip, hM = hT + (hB - hT) * 0.6;
    let rc = rCut - d * 0.55; if (rc < len + 16) rc = len + 16;      // however it tumbles, it stays far outside the play tube
    const uo = uc + d * (h3 - 0.5) * 1.6, z = z0 - d * 0.5;
    if (z < G[CZ] + 2) return;
    A[0] = tx * uo + ex * rc; A[1] = ty * uo + ey * rc; A[2] = z; A[3] = ux; A[4] = uy; A[5] = vx; A[6] = vy;
    if (!E.setPlaneS()) return;
    const k = (0.3 + 0.3 * s) * rk;
    A[0] = -hT; A[1] = hT; A[2] = -len; A[3] = -hM; A[4] = hM; A[5] = 0; A[8] = G[AF];
    E.pTrapS(E.fillF, E.fillD);
    const gold = E.lg > h1 * 0.8, c0 = gold ? E.nova : E.colA, c1 = gold ? E.novaHot : E.colC;
    A[6] = 1.2;
    A[0] = -hT; A[1] = -len; A[2] = hT; A[3] = -len; A[7] = k; E.pLineS(c0);
    A[7] = k * 0.8;
    A[2] = -hM; A[3] = 0; E.pLineS(c0);
    A[0] = hT; A[2] = hM; E.pLineS(c0);
    // the torn edge
    A[7] = k;
    A[0] = -hM; A[1] = 0; A[2] = -hM * 0.3; A[3] = 1.4; E.pLineS(c1);
    A[0] = -hM * 0.3; A[1] = 1.4; A[2] = hM * 0.2; A[3] = -0.6; E.pLineS(c1);
    A[0] = hM * 0.2; A[1] = -0.6; A[2] = hM; A[3] = 0.5; E.pLineS(c1);
    // lights dying inside it
    A[7] = 0.3 * rk;
    for (let i = 0; i < 4; i++) {
      H3(seed + i, E.tick16, 71);
      if (HV[0] < 0.5) continue;
      A[0] = -hT * 0.6 + i * hT * 0.4 - 0.5; A[1] = -len * (0.2 + 0.18 * i) - 0.7; A[2] = -hT * 0.6 + i * hT * 0.4 + 0.5; A[3] = -len * (0.2 + 0.18 * i) + 0.7;
      E.pRectS(gold ? E.novaHot : E.warm, 0);
    }
    // debris between the stump and the piece
    A[6] = 1.1; A[7] = k * 0.8;
    for (let i = 0; i < 5; i++) {
      H3(seed, i, 72); const ha = HV[0];
      H3(seed, i, 73);
      const a = ha * TAU + E.t * (HV[0] - 0.5) * 1.5;
      H3(seed, i, 74);
      const r = 2 + d * 0.5 * HV[0];
      H3(seed, i, 75);
      const du = Math.cos(a) * r, dv = 3 + d * 0.45 * HV[0] + Math.sin(a) * 2;
      H3(seed, i, 76);
      const l = 0.8 + 1.6 * HV[0];
      A[0] = du; A[1] = dv; A[2] = du + Math.cos(a * 3) * l; A[3] = dv + Math.sin(a * 3) * l; E.pLineS(c0);
    }
  }

  function tower(zi, ai, sub, lod) {
    const q = ai * 2 + sub + 500;                      // per-tower hash channel
    const n = nz[ai], zc = G[ZC], rk = G[RK];
    const gate = isGateTower(zi, ai, sub);
    if (n < G[OT] && !gate) return;
    const thr = gate ? E.dens * 1.4 : E.dens * (sub === 0 ? 0.5 + 0.8 * n : 0.02 + 0.98 * n);
    let s1 = 0.3;
    if (!gate) { H3(zi, q, 1); s1 = HV[0]; }
    if (s1 >= thr) return;
    const grow = clamp01((thr - s1) / 0.07);
    H3(zi, q, 2);
    const s2 = HV[0];
    let giant = gate;
    if (!giant && sub === 0 && n > 0.3) { H3(zi, q, 3); giant = HV[0] > 0.95; }
    let hgt = giant ? 84 + 11 * s2 : 14 + (18 + 50 * n) * (0.3 + 0.7 * s2);
    hgt *= E.hMul * (0.2 + 0.8 * grow);
    if (hgt > 97) hgt = 97;
    H3(zi, ai, 33);
    const slab = HV[0] < 0.3, wide = sub === 0 && slab;
    H3(zi, q, 4);
    const th = (ai + (wide ? 0.5 : sub === 0 ? 0.29 : 0.73) + (HV[0] - 0.5) * (wide ? 0.08 : 0.16)) * CA;
    H3(zi, q, 5);
    const dz = 14 + 16 * HV[0];
    H3(zi, q, 6);
    const z0 = zc + 2 + HV[0] * (LZ - dz - 4), z1 = z0 + dz;
    if (z1 < G[CZ] + 2) return;
    const rt = RG - hgt;
    const ex = Math.sin(th), ey = -Math.cos(th), tx = Math.cos(th), ty = Math.sin(th);
    G[EX] = ex; G[EY] = ey; G[TX] = tx; G[TY] = ty;
    const ti = ai * 2 + sub;
    tipR[ti] = rt; tipZ[ti] = z0 + dz * 0.5; tipA[ti] = th;
    // cull: if the far end of the roof is off screen, the whole tower is (it only gets further out toward the camera)
    A[0] = ex * rt; A[1] = ey * rt; A[2] = z1;
    if (!E.projS()) return;
    H3(zi, q, 7);
    let w = 2.8 + 3.8 * HV[0];
    const m = (wide ? 14 : w * 1.6) * Q[2] + 24;
    if (Q[0] < -m || Q[0] > E.W + m || Q[1] < -m || Q[1] > E.H + m) return;

    const block = !giant && slab;                      // a megablock: one wide slab owns the whole cell
    if (block && sub === 1) return;
    const type = giant ? 5 : block ? 6 : H3n(zi, q, 8, 5);
    const pat = H3n(zi, q, 9, 3);
    H3(zi, q, 10);
    const hc = HV[0];
    lightCol = hc < 0.55 ? E.warm : hc < 0.85 ? E.pale : E.colC;
    const seed = zi * 131 + q * 7;
    const lim = 0.21 * CA;                             // two towers share a cell: each stays inside its half
    if (w > lim * rt * 1.25) w = lim * rt * 1.25;

    // SHATTER: the nova is overtaking this ring; the tops of its towers have broken away
    let cut = 0;
    if (G[SH] > 0.04 && hgt > 26) {
      H3(zi, q, 69);
      if (HV[0] < 0.8) { H3(zi, q, 68); cut = 0.3 + 0.35 * HV[0]; }
    }
    const rTop = cut > 0 ? RG - hgt * cut : rt;        // where the standing part now ends

    let ok = false, eT = w, eB = w, eR = rt;           // top box (for echoes)
    B[0] = 0; B[4] = RG; B[5] = z0; B[6] = z1;
    if (type === 0) {
      eT = w * 0.8; eB = w;
      B[1] = cut > 0 ? eB + (eT - eB) * cut : eT; B[2] = eB; B[3] = rTop;
      ok = box(lod, seed, pat);
      if (ok && cut === 0 && lod < 2 && s2 > 0.45) { B[7] = hgt * 0.14; antenna(lod, seed); }
    } else if (type === 1) {
      const w1 = Math.min(w * 1.35, lim * (RG - 0.42 * hgt) * 1.3);
      B[1] = w1; B[2] = w1; B[3] = RG - 0.42 * hgt;
      box(lod, seed, pat);
      if (rTop < RG - 0.42 * hgt) {
        B[1] = w1 * 0.66; B[2] = w1 * 0.66; B[3] = Math.max(rTop, RG - 0.75 * hgt); B[4] = RG - 0.42 * hgt; B[5] = z0 + 2; B[6] = z1 - 2;
        box(lod, seed + 1, pat);
      }
      eT = eB = w1 * 0.36; eR = rt;
      if (rTop < RG - 0.75 * hgt) {
        B[1] = eT; B[2] = eB; B[3] = rTop; B[4] = RG - 0.75 * hgt; B[5] = z0 + 4; B[6] = z1 - 4;
        ok = box(lod, seed + 2, 1);
      }
      if (ok && cut === 0 && lod < 2 && s2 > 0.6) { B[7] = hgt * 0.1; antenna(lod, seed); }
    } else if (type === 2) {
      const off = Math.min(w, lim * rt) * 0.62, wa = off * 0.58;
      eT = eB = wa;
      B[0] = -off; B[1] = wa; B[2] = wa; B[3] = rTop;
      box(lod, seed, pat);
      B[0] = off; B[3] = Math.max(rTop, rt + 0.2 * hgt); B[5] = z0 + 3;
      box(lod, seed + 1, pat);
      if (lod < 2 && cut === 0) {
        A[0] = ex * rt; A[1] = ey * rt; A[2] = z0; A[3] = tx; A[4] = ty; A[5] = ex; A[6] = ey;
        if (E.setPlaneS()) {
          // skybridges between the twins
          const kb = 0.26 * rk;
          A[0] = -off + wa; A[1] = hgt * 0.34; A[2] = off - wa; A[3] = hgt * 0.34; A[6] = 1.2; A[7] = kb; E.pLineS(E.colC);
          A[1] = hgt * 0.34 + 1.6; A[3] = hgt * 0.34 + 1.6; A[6] = 1.1; A[7] = kb * 0.6; E.pLineS(E.colA);
          A[1] = hgt * 0.62; A[3] = hgt * 0.62; A[6] = 1.2; A[7] = kb; E.pLineS(E.colC);
        }
      }
    } else if (type === 3) {
      // obelisk: a blade tapering to a point, with a mast
      eT = 0.7; eB = w * 1.15;
      B[1] = cut > 0 ? eB + (eT - eB) * cut : eT; B[2] = eB; B[3] = rTop; B[5] = z0 + 2; B[6] = z1 - 2;
      ok = box(lod, seed, 1);
      if (ok && cut === 0 && lod < 2) { B[7] = hgt * 0.2; antenna(lod, seed); }
    } else if (type === 4) {
      const w1 = Math.min(w * 1.4, lim * (RG - 0.3 * hgt) * 1.3);
      B[1] = w1; B[2] = w1; B[3] = Math.max(rTop, RG - 0.3 * hgt);
      box(lod, seed, 2);
      eT = eB = w1 * 0.38;
      if (rTop < RG - 0.3 * hgt) {
        B[0] = -w1 * 0.5; B[1] = eT; B[2] = eB; B[3] = rTop; B[4] = RG - 0.3 * hgt; B[5] = z0 + 1; B[6] = z0 + dz * 0.55;
        box(lod, seed + 1, pat);
        B[0] = w1 * 0.48; B[1] = w1 * 0.33; B[2] = w1 * 0.33; B[3] = Math.max(rTop, rt + 0.3 * hgt); B[5] = z0 + dz * 0.4; B[6] = z1 - 1;
        box(lod, seed + 2, pat);
      }
    } else if (type === 6) {
      // megablock: a broad slab of lit floors with a podium and a neon sign down one edge
      const w1 = Math.min(0.36 * CA * rt, 13);
      const hp = Math.min(hgt * 0.22, 12);
      B[1] = w1 * 1.12; B[2] = w1 * 1.12; B[3] = RG - hp;
      box(lod, seed + 1, 2);
      eT = w1 * 0.94; eB = w1;
      B[1] = cut > 0 ? eB + (eT - eB) * cut : eT; B[2] = eB; B[3] = Math.min(rTop, RG - hp); B[4] = RG - hp; B[5] = z0 + 2; B[6] = z1 - 2;
      ok = box(lod, seed, s2 > 0.5 ? 0 : 2);
      if (ok && cut === 0 && lod === 0) {
        const g = 2.2, u = (s2 > 0.5 ? 1 : -1) * (eT - 1.6) - g * 0.4;
        A[0] = u - 0.5; A[1] = 2; A[2] = u - 0.5; A[3] = 2.6 + 3 * g * 1.25; A[6] = 1.1; A[7] = 0.3 * rk; E.pLineS(E.colC);
        A[0] = u; A[2] = g * 0.8; A[3] = g; A[6] = 1.25; A[7] = 0.34 * rk * (0.7 + 0.5 * E.kick);
        for (let i = 0; i < 3; i++) { A[1] = 2.4 + i * g * 1.25; E.pGlyphS(seed + i * 5, E.colC); }
      }
    } else {
      // megatower: setbacks narrowing to a crown and a beacon
      const w1 = Math.min(w * 1.7, lim * (RG - 0.3 * hgt) * 1.5);
      B[1] = w1 * 0.9; B[2] = w1; B[3] = RG - 0.3 * hgt;
      box(lod, seed, 2);
      B[1] = w1 * 0.66; B[2] = w1 * 0.74; B[3] = RG - 0.58 * hgt; B[4] = RG - 0.3 * hgt; B[5] = z0 + 2; B[6] = z1 - 2;
      box(lod, seed + 1, 0);
      B[1] = w1 * 0.42; B[2] = w1 * 0.5; B[3] = RG - 0.84 * hgt; B[4] = RG - 0.58 * hgt; B[5] = z0 + 4; B[6] = z1 - 4;
      box(lod, seed + 2, 1);
      eT = w1 * 0.16; eB = w1 * 0.3;
      B[1] = eT; B[2] = eB; B[3] = rt; B[4] = RG - 0.84 * hgt; B[5] = z0 + 5; B[6] = z1 - 5;
      if (box(lod, seed + 3, 1)) {
        const kc = 0.34 * rk;
        A[6] = 1.2; A[7] = kc;
        A[0] = -eT; A[1] = 0; A[2] = -eT * 2.2; A[3] = -4; E.pLineS(E.colC);
        A[0] = eT; A[2] = eT * 2.2; E.pLineS(E.colC);
        A[0] = 0; A[2] = 0; A[3] = -11; A[6] = 1.1; E.pLineS(E.colA);
        // a lit spine from crown to street: the megatowers are the landmarks you steer by
        A[1] = 1; A[3] = hgt * 0.8; A[6] = 1.5; A[7] = kc * (0.78 + 0.25 * E.kick); A[8] = kc * 0.15; E.pFadeS(E.pale, 3.5);
        if (lod < 2) {
          A[6] = 1.2;
          A[0] = -eB * 1.6; A[1] = hgt * 0.16; A[2] = eB * 1.6; A[3] = hgt * 0.16; A[7] = kc; E.pLineS(E.colC);
          A[0] = -eB * 2.6; A[1] = hgt * 0.42; A[2] = eB * 2.6; A[3] = hgt * 0.42; A[7] = kc * 0.8; E.pLineS(E.colC);
        }
        A[0] = 0; A[1] = -11; A[2] = 2.2 + 3 * E.kick; A[7] = 0.2 + 0.3 * E.kick; E.pDotS(E.warm, 2);       // the beacon blinks on the beat
        A[1] = 2; A[2] = 26 * E.ps; A[7] = 0.05 * rk; E.pDotS(E.colC, 1.6);                                   // and the crown wears a halo
      }
      cut = 0;
    }
    if (E.sign > 0.55 && lod === 0 && cut === 0 && type < 5) {
      H3(zi, q, 34);
      if (HV[0] < 0.55) {
        A[0] = ex * rt; A[1] = ey * rt; A[2] = z0 - 0.5; A[3] = tx; A[4] = ty; A[5] = ex; A[6] = ey;
        if (E.setPlaneS()) {
          // NEON MILE: a sign blade down the side of the tower
          H3(zi, q, 35);
          const g = 2.0, n = hgt > 40 ? 4 : 3, u = (HV[0] < 0.5 ? -1 : 1) * (eB + 1.9) - g * 0.4, v0 = hgt * 0.12;
          H3(seed, E.tick16 >> 2, 36);
          const ks = 0.34 * rk * (0.75 + 0.45 * E.kick) * (HV[0] < 0.08 ? 0.3 : 1);
          A[6] = 1.1; A[7] = ks * 0.8;
          A[0] = u - 0.45; A[1] = v0 - 0.5; A[2] = u - 0.45; A[3] = v0 + n * g * 1.25; E.pLineS(E.colC);
          A[0] = u + g * 0.8 + 0.45; A[2] = u + g * 0.8 + 0.45; E.pLineS(E.colC);
          A[0] = u; A[2] = g * 0.8; A[3] = g; A[6] = 1.25; A[7] = ks;
          for (let i = 0; i < n; i++) { A[1] = v0 + i * g * 1.25; E.pGlyphS(seed * 3 + i * 7, E.pale); }
        }
      }
    }
    if (cut > 0 && lod < 2) {
      B[0] = 0; B[1] = eT; B[2] = eB; B[3] = rTop; B[4] = rt; B[5] = z0;
      fragment(seed);
    } else if (E.flare > 0.03 && lod < 2 && type !== 2 && type !== 4) {
      B[0] = 0; B[1] = eT; B[2] = eB; B[3] = eR; B[4] = RG; B[5] = z0;
      echo();
    }
  }

  // Avenue cell: no tower; kerb lines and a row of street lights converging on the gate.
  function avenue(ai, lod) {
    const zc = G[ZC], cz = G[CZ], rk = G[RK];
    const th0 = ai * CA, th1 = (ai + 1) * CA, thm = (ai + 0.5) * CA;
    const zn = Math.max(zc, cz + 2), d = zn - cz;
    A[2] = zn; A[5] = zc + LZ; A[6] = 1.3 / (d > 0.5 ? E.focal / d : E.focal * 2); A[7] = 0.26 * rk * (1 - 0.5 * E.cor);
    A[0] = Math.sin(th0) * RG; A[1] = -Math.cos(th0) * RG; A[3] = A[0]; A[4] = A[1]; E.line3S(E.colA, 3);
    A[0] = Math.sin(th1) * RG; A[1] = -Math.cos(th1) * RG; A[3] = A[0]; A[4] = A[1]; E.line3S(E.colA, 3);
    if (E.sign > 0.5 && lod < 2) {
      A[7] = 0.3 * rk * (E.sign - 0.5) * 2 * (0.7 + 0.5 * E.kick);
      for (let i = 1; i < 4; i++) {
        const tn = (ai + i * 0.25) * CA;
        A[0] = Math.sin(tn) * (RG - 1.5); A[1] = -Math.cos(tn) * (RG - 1.5); A[3] = A[0]; A[4] = A[1];
        E.line3S(i === 2 ? E.pale : E.colC, 3);
      }
    }
    if (lod === 2) return;
    A[0] = Math.sin(thm) * (RG - 3); A[1] = -Math.cos(thm) * (RG - 3); A[3] = 1.2; A[7] = 0.34 * rk;
    for (let i = 0; i < 4; i++) {
      const z = zc + (i + 0.5) * LZ * 0.25;
      if (z < cz + 2) continue;
      A[2] = z; E.glow3S(E.warm, 2);
    }
  }

  // The ground of the cylinder: a patchwork of faintly lit city blocks. Towers are dark against it,
  // which is what makes them read as towers. Cells with little cluster noise are open to space.
  function ground(zi, lod) {
    const zc = G[ZC], cz = G[CZ], rk = G[RK], openThr = G[OT];
    const zf = zc + LZ, zn = Math.max(zc, cz + 1.5);
    const df = zf - cz, dn = zn - cz;
    const s = df > 0.5 ? E.focal / df : E.focal * 2, sn = dn > 0.5 ? E.focal / dn : E.focal * 2;      // px per metre at zf, zn
    if (RG * s > E.maxR + 40) return;
    const w = 1.2 / sn;
    let px = Math.sin(0) * RG, py = -Math.cos(0) * RG;
    for (let ai = 0; ai < NA; ai++) {
      const th = (ai + 1) * CA, x = Math.sin(th) * RG, y = -Math.cos(th) * RG;
      const n = nz[ai];
      if (n >= openThr) {
        const av = isAvenue(zi, ai);
        H3(zi, ai, 30);
        const hG = HV[0];
        const kG = (av ? 0.05 : 0.01 + 0.04 * n * n + (hG > 0.8 ? 0.03 : 0.012 * hG)) * E.kF;
        A[0] = px; A[1] = py; A[2] = x; A[3] = y; A[4] = zn; A[5] = zf; A[8] = 0.82;
        if (E.lg > 0.5 + 0.5 * hG) { A[7] = kG * 0.7 / E.kF; E.zQuadS(E.nova); }
        else { A[7] = kG; E.zQuadS(E.colB); }
        // one street hairline per two blocks: enough to show the surface, not a spider web
        if ((ai & 1) === 0 && lod < 2) { A[0] = x; A[1] = y; A[2] = zn; A[3] = x; A[4] = y; A[5] = zf; A[6] = w; A[7] = 0.1 * rk; E.line3S(E.colB, 3); }
      } else if (lod < 2 && E.cor < 0.5) {
        // an opening: just its frame
        A[0] = px; A[1] = py; A[2] = zf; A[3] = x; A[4] = y; A[5] = zf; A[6] = 1.2 / s; A[7] = 0.2 * rk; E.line3S(E.colA, 3);
      }
      px = x; py = y;
    }
    if (E.cor > 0.05) {
      // CORONA: the city is gone and its bare rails are left skimming the star: three shells of
      // rails with sleepers flickering past, and the stripped hoops that used to carry streets
      const kc = 0.3 * E.cor * rk;
      for (let a = 0; a < NA; a += (lod === 2 ? 4 : 2)) {
        const th = a * CA, r = (a & 2) ? RG : (a & 4) ? 96 : 66, cx = Math.sin(th), cy = -Math.cos(th);
        A[0] = cx * r; A[1] = cy * r; A[2] = zn; A[3] = cx * r; A[4] = cy * r; A[5] = zf; A[6] = w; A[7] = kc; E.line3S(E.colA, 3);
        if (lod === 2 || r === RG) continue;
        const ux = Math.cos(th) * 2.6, uy = Math.sin(th) * 2.6;
        for (let i = 0; i < 4; i++) {
          const z = zc + i * LZ * 0.25;
          if (z < cz + 2) continue;
          // every eighth sleeper is lit, and the lit one runs toward the gate on the 16ths
          const run = ((zi * 4 + i - E.tick16 * 2) & 7) === 0;
          A[0] = cx * r - ux; A[1] = cy * r - uy; A[2] = z; A[3] = cx * r + ux; A[4] = cy * r + uy; A[5] = z; A[7] = kc * (run ? 1.15 : 0.8);
          E.line3S(run ? E.pale : E.colC, 3);
          if (run) { A[0] = cx * r; A[1] = cy * r; A[3] = 1.3; A[7] = 0.3 * E.cor * rk; E.glow3S(E.pale, 2); }
        }
      }
      if ((zi & 1) === 0) {
        cam.ring(0, 0, zf, RG, 1.2 / s, E.colA, kc * 0.7, 3);
        if (lod < 2 && 96 * s < E.maxR + 30) cam.ring(0, 0, zf, 96, 1.1 / s, E.colB, kc * 0.6, 3);
      }
    }
  }

  // A great ring: a structural hoop at 60 m held by six pylons. You fly through one every 320 m.
  function greatRing(zi, lod) {
    const zc = G[ZC], cz = G[CZ], rk = G[RK];
    if (zc < cz + 1.5) return;
    const dc = zc - cz, s = dc > 0.5 ? E.focal / dc : E.focal * 2;
    if (60 * s > E.maxR + 60) return;
    const hero = zi <= 6;                                   // the gateway rings just past the conduit mouth
    const k = (hero ? 0.26 : 0.23) * rk * (1 + 0.38 * E.kick);
    const cA = E.pick(E.colA, 0.35);
    cam.ring(0, 0, zc, 60, (hero ? 2.2 : 1.5) / s, cA, k, hero ? 4 : 3);
    cam.ring(0, 0, zc, 64.5, 1.1 / s, cA, k * 0.6, 3);
    if (hero) cam.ring(0, 0, zc, 58.4, 1.0 / s, E.pick(E.colC, 0.5), k * 0.7, 3);
    H3(zi, 0, 50);
    const a0 = HV[0] * TAU, lw = 1.2;
    for (let i = 0; i < 6; i++) {
      const th = a0 + i * (TAU / 6);
      const cx = Math.sin(th), cy = -Math.cos(th), ux = Math.cos(th), uy = Math.sin(th);
      A[0] = cx * 64.5; A[1] = cy * 64.5; A[2] = zc; A[3] = ux; A[4] = uy; A[5] = cx; A[6] = cy;
      if (!E.setPlaneS()) continue;
      const len = RG - 64.5;
      A[6] = lw; A[7] = k * 0.8; A[8] = k * 0.3;
      A[0] = -2; A[1] = 0; A[2] = -3.5; A[3] = len; E.pFadeS(E.colA);
      A[0] = 2; A[2] = 3.5; E.pFadeS(E.colA);
      if (lod < 2) {
        A[6] = 1.1; A[7] = k * 0.45;
        for (let j = 0; j < 5; j++) {
          const v = j * len / 5, wv = 2 + 1.5 * j / 5, sg = j & 1 ? 1 : -1;
          A[0] = -wv * sg; A[1] = v; A[2] = wv * sg; A[3] = v + len / 5; E.pLineS(E.colB);
        }
      }
    }
    if (lod === 2) return;
    // ties between the two hoops, and a chase of lights stepping around on the 16ths
    for (let i = 0; i < 36; i++) {
      const th = a0 + i * (TAU / 36), cx = Math.sin(th), cy = -Math.cos(th);
      A[0] = cx * 60; A[1] = cy * 60; A[2] = zc; A[3] = cx * 64.5; A[4] = cy * 64.5; A[5] = zc; A[6] = 1.1 / s; A[7] = k * 0.55; E.line3S(E.colB, 3);
      if (((i + E.tick16) & 3) === 0) { A[0] = cx * 62.2; A[1] = cy * 62.2; A[3] = 1.0; A[7] = 0.4 * rk; E.glow3S(E.warm, 2); }
    }
  }

  // A holographic billboard floating over the rooftops, facing back down the axis.
  function billboard(zi, b, lod) {
    const rk = G[RK];
    H3(zi, b, 41);
    const th = HV[0] * TAU;
    H3(zi, b, 42);
    const R = 53 + 20 * HV[0];
    const big = 1 + 0.3 * E.sign;
    H3(zi, b, 43);
    const hw = (9 + 8 * HV[0]) * big;
    H3(zi, b, 44);
    const hh = (4.5 + 4 * HV[0]) * big;
    H3(zi, b, 45);
    const z = G[ZC] + 3 + HV[0] * (LZ - 6);
    if (z < G[CZ] + 2) return;
    const cx = Math.sin(th), cy = -Math.cos(th), ux = Math.cos(th), uy = Math.sin(th);
    A[0] = cx * R; A[1] = cy * R; A[2] = z; A[3] = ux; A[4] = uy; A[5] = cx; A[6] = cy;
    if (!E.setPlaneS()) return;
    A[0] = (hw + hh) * E.ps;
    if (!E.pOnS()) return;
    const seed = zi * 17 + b * 5;
    H3(seed, E.tick16 >> 1, 46);
    const flick = HV[0] < 0.07 ? 0.3 : 1;
    const k = 0.26 * rk * flick * (1 + 0.35 * E.kick);
    const c = E.pick(E.colC, 0.5);
    A[0] = 0; A[1] = 0; A[2] = (hw + hh) * 1.1 * E.ps; A[7] = 0.035 * flick * rk; E.pDotS(c, 1.6);      // its light spills into the haze
    A[0] = -hw; A[1] = -hh; A[2] = hw; A[3] = hh; A[7] = 0.018 * flick * rk; E.pRectS(c, 0.45);          // light you can see through
    const lw = clamp(E.ps * 0.1, 1.1, 1.8);
    A[6] = lw; A[7] = k;
    A[3] = -hh; E.pLineS(c);
    A[1] = hh; A[3] = hh; E.pLineS(c);
    A[7] = k * 0.7;
    A[1] = -hh; A[2] = -hw; E.pLineS(c);
    A[0] = hw; A[2] = hw; E.pLineS(c);
    A[0] = 0; A[1] = hh; A[2] = 0; A[3] = hh + 16; A[6] = 1.1; A[7] = k * 0.5; A[8] = 0; E.pFadeS(E.colB);         // its mast
    if (lod === 2) return;
    const full = lod === 0;
    if (full) {
      A[6] = lw; A[7] = k * 0.6;
      A[0] = -hw + 0.8; A[1] = -hh + 0.8; A[2] = -hw + 0.8; A[3] = -hh + 3; E.pLineS(c);
      A[2] = -hw + 3; A[3] = -hh + 0.8; E.pLineS(c);
      A[0] = hw - 0.8; A[1] = hh - 0.8; A[2] = hw - 0.8; A[3] = hh - 3; E.pLineS(c);
      A[2] = hw - 3; A[3] = hh - 0.8; E.pLineS(c);
    }
    const style = H3n(zi, b, 47, 4);
    if (style === 0) {
      // a short word in pseudo-kana; the last glyph changes on the beat
      H3(zi, b, 48);
      const n = full ? 2 + (HV[0] > 0.5 ? 1 : 0) : 1, gh = hh * 1.3, gw = gh * 0.8, gap = gw * 0.35;
      let u = -(n * gw + (n - 1) * gap) * 0.5;
      A[1] = -gh * 0.5; A[2] = gw; A[3] = gh; A[6] = lw * 1.15; A[7] = k * 1.05;
      for (let i = 0; i < n; i++) {
        const gi = H3n(seed, i, 49, 97) + (i === n - 1 ? Math.floor(E.beat) : 0);
        A[0] = u; E.pGlyphS(gi, E.pale);
        u += gw + gap;
      }
    } else if (style === 1) {
      // an equaliser: the music is visible
      const n = full ? 8 : 5, bw = (2 * hw - 3) / n;
      A[1] = hh * 0.8; A[6] = Math.max(1.2, bw * E.ps * 0.3); A[7] = k * 0.7;
      for (let i = 0; i < n; i++) {
        H3(seed + i, E.tick16 >> 1, 51);
        const lvl = 0.12 + 0.88 * HV[0] * (0.55 + 0.45 * E.kick);
        const u = -hw + 1.5 + (i + 0.5) * bw;
        A[0] = u; A[2] = u; A[3] = hh * 0.8 - lvl * hh * 1.6; E.pLineS(c, 2.5);
      }
    } else if (style === 2) {
      // a mark: ring, bar and one glyph
      A[0] = -hw * 0.45; A[1] = 0; A[2] = hh * 0.62 * E.ps; A[6] = lw; A[7] = k; E.pRingS(c, 3);
      A[0] = -hw * 0.45 - hh * 0.62; A[2] = -hw * 0.45 + hh * 0.62; A[3] = 0; A[7] = k * 0.8; E.pLineS(c);
      if (full) { A[0] = hw * 0.15; A[1] = -hh * 0.6; A[2] = hh * 0.95; A[3] = hh * 1.2; A[6] = lw * 1.15; A[7] = k; E.pGlyphS(H3n(seed, 2, 49, 97), E.pale); }
    } else {
      // ticker: rows of dashes sliding sideways
      A[6] = lw; A[7] = k * 0.8;
      for (let r = full ? 0 : 1; r < (full ? 3 : 2); r++) {
        const v = (r - 1) * hh * 0.55, sp = (r & 1 ? -1 : 1) * (2 + r);
        for (let i = 0; i < (full ? 4 : 3); i++) {
          H3(seed + r, i, 52);
          let u = ((HV[0] * 2 * hw + E.t * sp) % (2 * hw) + 2 * hw) % (2 * hw) - hw;
          H3(seed + r, i, 53);
          const len = 1.5 + 3 * HV[0];
          const u1 = Math.min(hw - 0.5, u + len);
          if (u < -hw + 0.5) u = -hw + 0.5;
          if (u1 > u) { A[0] = u; A[1] = v; A[2] = u1; A[3] = v; E.pLineS(r === 1 ? E.pale : c); }
        }
      }
    }
  }

  function ring(zi) {
    const zc = G[ZC], cz = G[CZ];
    if (zc + LZ < cz + 1.5) return;
    A[0] = zc + LZ * 0.5; A[1] = 95;
    E.themeAtS(); E.lightS();
    // SHATTER: the rings nearest the nova break first, and its gold is on them once they reach the
    // screen's edge (430 px from the gate is the edge at 720p; 190 was mid-screen). It stays dimmer
    // than real danger: orange at the edge has to keep meaning that the nova is close.
    const shatS = E.shat * clamp01((330 - zc) / 260);
    G[SH] = shatS;
    const sg = 0.6 * E.shat * clamp01((E.sr - 430) / 200);
    if (sg > E.lg) E.lg = sg;
    const rk = E.lk > 2.6 ? 2.6 : E.lk;
    G[RK] = rk;
    const lod = zc < 130 - 45 * E.sign ? 0 : zc < 290 - 70 * E.sign ? 1 : 2;
    G[AF] = zc < 300 ? 0.96 : 0.96 - 0.6 * clamp01((zc - 300) / 240);
    cluster(zi);
    const openThr = 0.2 + 0.22 * E.shat + 0.8 * E.cor;
    G[OT] = openThr;
    ground(zi, lod);
    tipR.fill(0);
    for (let ai = 0; ai < NA; ai++) {
      if (isAvenue(zi, ai) && !isGateTower(zi, ai, 0)) { if (nz[ai] >= openThr) avenue(ai, lod); }
      else { tower(zi, ai, 0, lod); tower(zi, ai, 1, lod); }
    }
    // skybridges between neighbouring rooftops
    if (lod < 2 && shatS < 0.3) {
      A[7] = 0.24 * rk;
      for (let i = 0; i < NA * 2; i++) {
        const j = (i + 1) % (NA * 2);
        if (tipR[i] === 0 || tipR[j] === 0) continue;
        H3(zi, i, 60);
        if (HV[0] > 0.3) continue;
        H3(zi, i, 61);
        const r = Math.max(tipR[i], tipR[j]) + 5 + 12 * HV[0];
        if (r > RG - 6) continue;
        const zb = Math.max(cz + 2, tipZ[i]), db = zb - cz;
        A[0] = Math.sin(tipA[i]) * r; A[1] = -Math.cos(tipA[i]) * r; A[2] = zb;
        A[3] = Math.sin(tipA[j]) * r; A[4] = -Math.cos(tipA[j]) * r; A[5] = Math.max(cz + 2, tipZ[j]);
        A[6] = 1.2 / (db > 0.5 ? E.focal / db : E.focal * 2);
        E.line3S(E.colC, 3);
      }
    }
    const nb = E.sign * 2.2 + 0.3;
    for (let b = 0; b < 3; b++) { H3(zi, b, 40); if (HV[0] < nb - b) billboard(zi, b, lod); }
    if (isGreat(zi)) greatRing(zi, lod);
  }

  function draw() {
    const veil = (1 - 0.7 * E.gCor) * (0.7 + 0.3 * E.boost) * E.kF;
    G[CZ] = cam.z;
    const zi0 = Math.floor((E.dist + cam.z - E.origin) / LZ);
    for (let k = FAR_CELLS; k >= 0; k--) {
      const zi = zi0 + k, zc = zi * LZ + E.origin - E.dist;
      G[ZC] = zc;
      ring(zi);
      // aerial perspective: a thin veil of light over everything farther than this ring, so the
      // far city sits back in haze and the near towers stand dark and crisp in front of it
      if (k === 10 || k === 6 || k === 3) gfx.glow(E.vpx, E.vpy, RG * E.pps(zc) * 1.3, E.colB, (k === 10 ? 0.075 : k === 6 ? 0.06 : 0.04) * veil, 1.25);
    }
  }
  return { draw };
}
