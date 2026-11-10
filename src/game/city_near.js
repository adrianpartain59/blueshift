// game/city_near.js — private to city.js: the layers between the city and the play tube.
//   SKY TRAFFIC      r 15..40 m   light trains and fliers streaking along the axis, both ways
//   FOUNDRY          r 13..60 m   sector 3: gear rings that step on the beat, pistons that land on the
//                                 kick, spark waterfalls
//   SERVICE LATTICE  r 9.4..13 m  hoops, stringers, gantry arms, pseudo-kana signs and deck stencils:
//                                 the fast near layer that sells speed
// Nothing here comes closer to the axis than 9.4 m, and all of it is dim hairlines: this is the
// layer hazards are read against.
import { TAU, clamp01 } from '../engine/math.js';
import { H3, H3n, HV, A, KANA, NKANA } from './city_env.js';

const CELL = 16;              // lattice cell length (two tube ribs)
const HOOP_EVERY = 3;         // a hoop every 48 m
const R_HOOP = 10.4, R_OUT = 11.7;
const LAT_FAR = 300;          // the lattice has faded out by here, to keep the far tube clean
const NLANE = 28;
const HOOP_SEG = 24;

// Per-cell numbers live in N (see the note on scratch in city_env.js).
const LK = 0, FADE = 1;       // N: light and distance fade of the lattice cell being drawn
const Z = 2;                  // its depth
const CZ = 3;                 // the camera's depth
const DA = 4, DZ = 5, DK = 6; // deckGlyph(): angle, depth, light

export function createNear(E) {
  const { cam } = E;
  const N = new Float64Array(7);

  // ---- traffic lanes, fixed for the life of the module
  const laneR = new Float32Array(NLANE), laneX = new Float32Array(NLANE), laneY = new Float32Array(NLANE);
  const laneV = new Float32Array(NLANE), laneGap = new Float32Array(NLANE), laneLen = new Float32Array(NLANE), lanePh = new Float32Array(NLANE);
  for (let i = 0; i < NLANE; i++) {
    H3(i, 1, 90); const r = 15 + 25 * HV[0];
    H3(i, 2, 90); const a = HV[0] * TAU;
    laneR[i] = r; laneX[i] = Math.sin(a) * r; laneY[i] = -Math.cos(a) * r;
    H3(i, 3, 90);
    laneV[i] = (i & 1) ? -(30 + 70 * HV[0]) : 70 + 90 * HV[0];    // world m/s; negative = oncoming
    H3(i, 4, 90);
    laneGap[i] = 170 + 280 * HV[0];
    H3(i, 5, 90); const kind = HV[0];
    H3(i, 6, 90);
    laneLen[i] = kind < 0.6 ? 14 + 30 * HV[0] : 3.5 + 2.5 * HV[0];
    H3(i, 7, 90);
    lanePh[i] = HV[0] * 400;
  }

  function traffic() {
    const t = E.t, zMin = N[CZ] + 1, thin = 1 - 0.75 * E.gCor;
    for (let i = 0; i < NLANE; i++) {
      H3(i, 8, 90);
      if (HV[0] > thin) continue;                        // CORONA: almost nobody is left to fly
      const gap = laneGap[i], len = laneLen[i], v = laneV[i], x = laneX[i], y = laneY[i];
      const base = lanePh[i] + v * t - E.dist;            // z of vehicle n = 0 relative to the runner
      let n = Math.ceil((zMin - len - base) / gap);
      for (let z = base + n * gap; z < 600; z += gap, n++) {
        const zh = v < 0 ? z : z + len, zt = v < 0 ? z + len : z;     // head leads in the direction of travel
        A[0] = (zh + zt) * 0.5; A[1] = laneR[i];
        E.lightS();
        const gold = E.gold3(i, n, 91);
        const k = E.lk > 2.4 ? 2.4 : E.lk;
        const train = len > 8;
        A[0] = x; A[1] = y; A[2] = zt; A[3] = x; A[4] = y; A[5] = zh; A[6] = train ? 0.26 : 0.16; A[7] = (train ? 0.2 : 0.3) * k;
        E.line3S(gold ? E.nova : (i & 2 ? E.colC : E.colA), 3.5);
        if (zh > zMin) { A[2] = zh; A[3] = train ? 0.8 : 0.55; A[7] = 0.4 * k; E.glow3S(gold ? E.novaHot : (v < 0 ? E.warm : E.pale), 2); }
        if (train && zt > zMin) { A[2] = zt; A[3] = 0.5; A[7] = 0.3 * k; E.glow3S(E.colC, 2); }
      }
    }
  }

  // ---- FOUNDRY: a ring press around the hoop of lattice cell j (at depth N[Z]). Two toothed rings
  // counter-rotate one tooth per beat, four hammers land on the kick, and spark waterfalls pour
  // outward (which is "down" in a spun city) from the outer ring. All of it stays outside 13 m.
  function foundry(j) {
    const f = E.frame, z = N[Z], cz = N[CZ], lk = N[LK], fade = N[FADE], amount = E.mach;
    const dc = z - cz, s = dc > 0.5 ? E.focal / dc : E.focal * 2;      // px per metre at z
    if (z < cz + 2) return;
    const k = 0.2 * lk * fade * amount;
    const bp = f.beatPhase, snap = 1 - Math.pow(1 - Math.min(1, bp / 0.25), 3);
    const step = Math.floor(f.beat) + snap;
    const dir = (j & 1) ? -1 : 1;
    const flash = 1 + 0.8 * f.kick;
    for (let g = 0; g < 2; g++) {
      const R = g === 0 ? 15.2 : 23.5, NT = g === 0 ? 16 : 24, tooth = g === 0 ? 1.5 : 2.1;
      if (R * s > E.maxR + 30) continue;
      const cR = E.lg > 0.3 + 0.3 * g ? E.nova : E.colA;
      cam.ring(0, 0, z, R, 1.5 / s, cR, k * flash, 3);
      cam.ring(0, 0, z, R - 0.9, 1.0 / s, E.colB, k * 0.6, 3);
      if (z > 190) continue;
      const rot = step * (TAU / NT) * (g === 0 ? dir : -dir);
      const da = (TAU / NT) * 0.26, wl = 1.25 / s;
      A[2] = z; A[5] = z;
      for (let i = 0; i < NT; i++) {
        const a = rot + i * (TAU / NT);
        const x0 = Math.sin(a - da), y0 = -Math.cos(a - da), x1 = Math.sin(a + da), y1 = -Math.cos(a + da);
        if (z < 110) {
          // a proper tooth: two flanks and a land
          A[6] = wl; A[7] = k;
          A[0] = x0 * R; A[1] = y0 * R; A[3] = x0 * (R + tooth); A[4] = y0 * (R + tooth); E.line3S(cR, 3);
          A[0] = x1 * R; A[1] = y1 * R; A[3] = x1 * (R + tooth); A[4] = y1 * (R + tooth); E.line3S(cR, 3);
          A[0] = x0 * (R + tooth); A[1] = y0 * (R + tooth); A[7] = k * flash; E.line3S(E.colC, 3);
        } else {
          const cx = Math.sin(a), cy = -Math.cos(a);
          A[0] = cx * R; A[1] = cy * R; A[3] = cx * (R + tooth); A[4] = cy * (R + tooth); A[6] = 2.2 / s; A[7] = k * 0.9; E.line3S(cR, 3);
        }
      }
    }
    if (z > 220) return;
    // hammers: they are down on the beat and draw back between beats
    const head = 13.3 + 6.5 * (1 - f.kick);
    for (let i = 0; i < 4; i++) {
      const a = (i + 0.5) * (TAU / 4) + (j % 3) * 0.26, cx = Math.sin(a), cy = -Math.cos(a), ux = Math.cos(a), uy = Math.sin(a);
      A[0] = cx * head; A[1] = cy * head; A[2] = z + 0.5; A[3] = ux; A[4] = uy; A[5] = cx; A[6] = cy;
      if (!E.setPlaneS()) continue;
      const lw = Math.max(1.2, E.ps * 0.09);
      A[0] = -1.7; A[1] = 0; A[2] = 1.7; A[3] = 0; A[6] = lw * 1.3; A[7] = k * (1.0 + 0.7 * f.kick); E.pLineS(E.colC);
      A[6] = lw; A[7] = k;
      A[2] = -1.2; A[3] = 1.3; E.pLineS(E.colA);
      A[0] = 1.7; A[2] = 1.2; E.pLineS(E.colA);
      A[0] = -1.2; A[1] = 1.3; E.pLineS(E.colA);
      A[7] = k * 0.9; A[8] = k * 0.1;
      A[0] = -0.5; A[2] = -0.5; A[3] = 36 - head; E.pFadeS(E.colA);
      A[0] = 0.5; A[2] = 0.5; E.pFadeS(E.colA);
      // the strike: a cold-white burst when the hammer lands
      if (f.kick > 0.35) {
        A[0] = 0; A[1] = 0.4; A[2] = (1.5 + 2.4 * f.kick) * E.ps; A[7] = 0.45 * f.kick * amount * fade; E.pDotS(E.pale, 2.2);
        A[0] = -3.2 * f.kick; A[1] = 0; A[2] = 3.2 * f.kick; A[3] = 0; A[7] = 0.5 * f.kick * amount * fade; E.pLineS(E.pale);
      }
    }
    if (z > 170) return;
    // spark waterfalls
    for (let w = 0; w < 4; w++) {
      H3(j, w, 95);
      const a0 = HV[0] * TAU;
      const sx = Math.sin(a0), sy = -Math.cos(a0);
      A[0] = sx * 25.6; A[1] = sy * 25.6; A[2] = z; A[3] = 1.1 + 0.5 * f.kick; A[7] = 0.45 * lk * fade * amount; E.glow3S(E.pale, 2);
      A[6] = 0.14;
      for (let i = 0; i < 12; i++) {
        H3(j * 7 + w, i, 96); const h0 = HV[0];
        H3(j * 7 + w, i, 97);
        const p = (h0 + E.t * (0.6 + 0.5 * HV[0])) % 1;
        H3(j * 7 + w, i, 98);
        const r = 25.6 + 40 * p * p, a = a0 + (HV[0] - 0.5) * 0.1 * (0.3 + p);
        const cx = Math.sin(a), cy = -Math.cos(a), zz = z - 5 * p;
        if (zz < cz + 1) continue;
        const l = 0.4 + 3.2 * p;
        A[0] = cx * r; A[1] = cy * r; A[2] = zz; A[3] = cx * (r + l); A[4] = cy * (r + l); A[5] = zz; A[7] = (0.6 - 0.5 * p) * lk * fade * amount;
        E.line3S(p < 0.3 ? E.warm : E.pale, 3);
      }
    }
  }

  // ---- one pseudo-kana lying on the lattice cylinder at angle N[DA], depth N[DZ], light N[DK]:
  // 1.7 m across (tangential), 5.5 m along the axis
  function deckGlyph(gi, col) {
    const g = KANA[((gi % NKANA) + NKANA) % NKANA], inv = 1 / R_HOOP, a = N[DA], z = N[DZ], wu = 1.7, wz = 5.5;
    A[6] = 0.07; A[7] = N[DK];
    for (let i = 0; i < g.length; i += 4) {
      const a0 = a + (g[i] - 0.5) * wu * inv, a1 = a + (g[i + 2] - 0.5) * wu * inv;
      A[0] = Math.sin(a0) * R_HOOP; A[1] = -Math.cos(a0) * R_HOOP; A[2] = z + g[i + 1] * wz;
      A[3] = Math.sin(a1) * R_HOOP; A[4] = -Math.cos(a1) * R_HOOP; A[5] = z + g[i + 3] * wz;
      E.line3S(col, 3);
    }
  }

  // One lattice cell, at depth N[Z].
  function cell(j) {
    const z = N[Z], cz = N[CZ];
    const fade = clamp01((LAT_FAR - z) / 150);
    N[FADE] = fade;
    if (fade <= 0) return;
    A[0] = z + CELL * 0.5; A[1] = R_HOOP;
    E.themeAtS(); E.lightS();
    const lk = E.lk > 2.4 ? 2.4 : E.lk;
    N[LK] = lk;
    const gapP = 0.1 + 0.45 * E.shat;
    const zn = z < cz + 1 ? cz + 1 : z, zf = z + CELL;
    if (zf < cz + 1.5) return;
    const kick = E.kick;
    const gold = E.gold3(j, 0, 79);
    const cS = gold ? E.nova : E.colA;

    // stringers: four rails just outside the hoops, with gaps, and an insulator tick per cell
    for (let i = 0; i < 4; i++) {
      H3(j, i, 80);
      if (HV[0] < gapP) continue;
      const a = (i * 2 + 0.5) * (TAU / 8), x = Math.sin(a) * R_OUT, y = -Math.cos(a) * R_OUT;
      A[0] = x; A[1] = y; A[2] = zn; A[3] = x; A[4] = y; A[5] = zf; A[6] = 0.07; A[7] = 0.2 * lk * fade; E.line3S(cS, 3);
      if (z > cz + 1 && z < 180) { A[2] = z; A[3] = x * 1.08; A[4] = y * 1.08; A[5] = z; A[6] = 0.09; A[7] = 0.3 * lk * fade; E.line3S(E.colC, 3); }
      // sleepers every 4 m on the nearest rails: the flicker at the edge of the eye that reads as speed
      if (z < 64) {
        A[3] = x * 1.05; A[4] = y * 1.05; A[6] = 0.06; A[7] = 0.24 * lk;
        for (let t = 1; t < 4; t++) { const zt = z + t * 4; if (zt > cz + 1) { A[2] = zt; A[5] = zt; E.line3S(E.colA, 3); } }
      }
    }
    // lane-gap dashes on the hoop cylinder, between the stringers
    if (z < 128) {
      for (let i = 0; i < 4; i++) {
        H3(j, i, 78);
        if (HV[0] < 0.35 + gapP) continue;
        const a = (i * 2 + 1.5) * (TAU / 8), x = Math.sin(a) * R_HOOP, y = -Math.cos(a) * R_HOOP;
        const z0 = z + 3 > zn ? z + 3 : zn, z1 = z + 8;
        if (z1 > z0) { A[0] = x; A[1] = y; A[2] = z0; A[3] = x; A[4] = y; A[5] = z1; A[6] = 0.06; A[7] = 0.26 * lk * fade; E.line3S(E.colB, 3); }
      }
    }

    if (j % HOOP_EVERY === 0 && z > cz + 1) {
      const dc = z - cz, s = dc > 0.5 ? E.focal / dc : E.focal * 2;      // px per metre at z
      const kh = 0.2 * lk * fade * (1 + 0.7 * kick);
      const cH = E.gold3(j, 1, 79) ? E.nova : E.colA;
      if (z > 110) {
        H3(j, 9, 80);
        if (HV[0] >= gapP) cam.ring(0, 0, z, R_HOOP, 1.2 / s, cH, kh * 0.8, 3);
      } else {
        // near hoops: a broken double ring with ties, and gantry arms reaching out toward the city
        H3(j, 3, 81);
        const rot = HV[0] * TAU;
        let px = Math.sin(rot), py = -Math.cos(rot);
        A[2] = z; A[5] = z;
        for (let i = 1; i <= HOOP_SEG; i++) {
          const a = rot + i * (TAU / HOOP_SEG), cx = Math.sin(a), cy = -Math.cos(a);
          H3(j, (i >> 2) + 20, 81);
          const arc = HV[0];          // arcs come and go in runs of four segments
          if (arc >= gapP + 0.12) {
            A[0] = px * R_HOOP; A[1] = py * R_HOOP; A[3] = cx * R_HOOP; A[4] = cy * R_HOOP; A[6] = 0.085; A[7] = kh; E.line3S(cH, 3);
            if (arc > 0.55) {
              A[0] = px * R_OUT; A[1] = py * R_OUT; A[3] = cx * R_OUT; A[4] = cy * R_OUT; A[6] = 0.06; A[7] = kh * 0.6; E.line3S(cH, 3);
              if ((i & 1) === 0) { A[0] = cx * R_HOOP; A[1] = cy * R_HOOP; A[7] = kh * 0.7; E.line3S(E.colB, 3); }
            }
          }
          px = cx; py = cy;
        }
        for (let i = 0; i < 3; i++) {
          H3(j, i, 84);
          if (HV[0] < 0.25 + gapP) continue;
          H3(j, i, 85);
          const a = HV[0] * TAU, cx = Math.sin(a), cy = -Math.cos(a);
          H3(j, i, 86);
          const r1 = 17 + 16 * HV[0];
          A[0] = cx * R_OUT; A[1] = cy * R_OUT; A[2] = z; A[3] = cx * r1; A[4] = cy * r1; A[5] = z; A[6] = 0.08; A[7] = kh * 0.8; E.line3S(E.colB, 3);
          A[0] = cx * r1; A[1] = cy * r1; A[3] = 0.35 + 0.25 * kick; A[7] = 0.33 * lk * fade; E.glow3S(E.pale, 2);
        }
      }
      if (E.mach > 0.05) foundry(j);
    }

    // a sign facing back down the axis: a column of pseudo-kana in a bracket, read as it flies past
    if (z > cz + 3 && z < 190) {
      H3(j, 0, 82);
      if (HV[0] < 0.22 + 0.5 * E.sign) {
        const a = (H3n(j, 1, 82, 16) + 0.5) * (TAU / 16), cx = Math.sin(a), cy = -Math.cos(a);
        H3(j, 2, 82);
        const zs = z + 4 + 8 * HV[0];
        A[0] = cx * 9.5; A[1] = cy * 9.5; A[2] = zs; A[3] = Math.cos(a); A[4] = Math.sin(a); A[5] = cx; A[6] = cy;
        if (E.setPlaneS()) {
          H3(j, 3, 82);
          const n = 2 + Math.floor(HV[0] * 2.99);
          H3(j, 4, 82);
          const g = 0.95 + 0.4 * HV[0], pitch = g * 1.28;
          const lw = Math.max(1.1, E.ps * 0.055);
          const k = 0.24 * lk * fade * (1 + 0.45 * kick) * clamp01((190 - zs) / 60);
          const cG = E.gold3(j, 5, 82) ? E.novaHot : E.pale;
          const hgt = n * pitch + 0.25, hw = g * 0.62;
          A[6] = lw; A[7] = k * 0.8;
          A[0] = -hw; A[1] = 0; A[2] = -hw; A[3] = hgt; E.pLineS(cS);
          A[2] = -hw * 0.4; A[3] = 0; E.pLineS(cS);
          A[1] = hgt; A[3] = hgt; E.pLineS(cS);
          A[0] = hw; A[1] = 0; A[2] = hw; E.pLineS(cS);
          A[2] = hw * 0.4; A[3] = 0; E.pLineS(cS);
          A[1] = hgt; A[3] = hgt; E.pLineS(cS);
          if (zs < 130) {
            H3(j, 6, 82);
            const scroll = HV[0] < 0.5 ? E.tick16 >> 2 : 0;      // some signs step a glyph every beat
            A[0] = -g * 0.4; A[2] = g * 0.8; A[3] = g; A[7] = k;
            for (let i = 0; i < n; i++) { A[1] = 0.2 + i * pitch; E.pGlyphS(H3n(j, i, 87, 97) + scroll * (i + 1), cG); }
          }
        }
      }
    }

    // a deck stencil: kana laid along the lattice like paint on a runway, stretched by the speed
    if (z < 140) {
      H3(j, 0, 83);
      const want = HV[0] < 0.2 + 0.25 * E.sign;
      H3(j, 1, 83);
      if (want && HV[0] >= gapP) {
        const a = (H3n(j, 2, 83, 8) + 0.5) * (TAU / 8) + TAU / 16;
        const k = 0.26 * lk * fade * clamp01((140 - z) / 50);
        const da = 1.25 / R_HOOP;
        const a0 = a - da, a1 = a + da;
        A[2] = zn; A[5] = zf; A[6] = 0.06; A[7] = k * 0.8;
        A[0] = Math.sin(a0) * R_HOOP; A[1] = -Math.cos(a0) * R_HOOP; A[3] = A[0]; A[4] = A[1]; E.line3S(E.colB, 3);
        A[0] = Math.sin(a1) * R_HOOP; A[1] = -Math.cos(a1) * R_HOOP; A[3] = A[0]; A[4] = A[1]; E.line3S(E.colB, 3);
        if (z > cz + 1) {
          N[DA] = a; N[DK] = k;
          N[DZ] = z + 1.5; deckGlyph(H3n(j, 3, 83, 97), cS);
          N[DZ] = z + 8.5; deckGlyph(H3n(j, 4, 83, 97), cS);
        }
      }
    }
  }

  function lattice() {
    const j0 = Math.floor((E.dist + cam.z) / CELL);
    for (let c = Math.ceil(LAT_FAR / CELL); c >= 0; c--) {
      const j = j0 + c;
      N[Z] = j * CELL - E.dist;
      cell(j);
    }
  }

  function draw() {
    N[CZ] = cam.z;
    traffic();
    lattice();
  }
  return { draw };
}
