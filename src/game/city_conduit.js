// game/city_conduit.js — private to city.js: THE CONDUIT, the closed launch tunnel of the first 9.4
// seconds. Dark opaque panels hugging the play tube (apothem 7.25 m, the one thing of ours allowed
// inside 9 m), violet hairline seams, ribs that ignite on the pips, hazard chevrons, glyph
// stencils and chase lights. It hides the city completely until the shutter at its mouth breaks;
// after THE DROP what is left of it rushes back past the camera and is gone.
import { LANES, LANE_ANGLE } from './config.js';
import { H3, HV, A, KANA, NKANA } from './city_env.js';

const AP_WALL = 7.25;         // wall apothem (corners at 7.85 m)
const AP_RIB = 6.65;          // ribs stand proud of the wall (corners at 7.2 m)
const BAY = 8;                // a rib every 8 m, in step with the tube's own ribs
const MAX_SEG = 72;

export function createConduit(E) {
  const { cam } = E;
  const WX = new Float32Array(LANES + 1), WY = new Float32Array(LANES + 1), RX = new Float32Array(LANES + 1), RY = new Float32Array(LANES + 1);
  for (let i = 0; i <= LANES; i++) {
    // corner i is the boundary between lane i-1 and lane i, like the tube's own corners
    const a = (i - 0.5) * LANE_ANGLE, c = Math.cos(LANE_ANGLE / 2);
    WX[i] = Math.sin(a) * AP_WALL / c; WY[i] = -Math.cos(a) * AP_WALL / c;
    RX[i] = Math.sin(a) * AP_RIB / c; RY[i] = -Math.cos(a) * AP_RIB / c;
  }
  const segZ = new Float32Array(MAX_SEG);
  const wallCol = [0, 0, 0], capCol = [0, 0, 0];
  // K: [0] depth in / light out of ribK(), [1] depth and [2] light for stencil()
  // (see the note on scratch in city_env.js)
  const K = new Float64Array(3);

  // How bright the rib at depth K[0] is (the answer replaces it): dark until its zone's pip, a flash
  // as the ignition sweeps out through the zone, then a steady glow that breathes with the kick.
  function ribK() {
    const z = K[0];
    const zone = z < 36 ? 1 : z < 112 ? 2 : 3;
    let k = 0.045;
    if (zone <= E.igniteLevel) {
      k = 0.24;
      const pt = E.pipT[zone];
      if (pt < 2.5) {
        const delay = (z - (zone === 1 ? -8 : zone === 2 ? 36 : 112)) / 520;
        if (pt < delay) k = 0.045; else k += 1.5 * Math.exp(-(pt - delay) / 0.2);
      }
    }
    if (E.launchT < 1.2) k += 1.1 * Math.exp(-E.launchT / 0.16);
    K[0] = k * (0.8 + 0.6 * E.kick);
  }

  // One pseudo-kana stencilled on the wall panel of `lane` at depth K[1] with light K[2], stretched
  // 5.6 m along the axis.
  function stencil(gi, lane) {
    const g = KANA[((gi % NKANA) + NKANA) % NKANA], z = K[1], len = 5.6;
    const x0 = WX[lane], y0 = WY[lane], dx = WX[lane + 1] - x0, dy = WY[lane + 1] - y0;
    A[6] = 0.06; A[7] = K[2];
    for (let i = 0; i < g.length; i += 4) {
      const u0 = 0.3 + g[i] * 0.4, u1 = 0.3 + g[i + 2] * 0.4;
      A[0] = x0 + dx * u0; A[1] = y0 + dy * u0; A[2] = z + g[i + 1] * len; A[3] = x0 + dx * u1; A[4] = y0 + dy * u1; A[5] = z + g[i + 3] * len;
      E.line3S(E.colA, 3);
    }
  }

  function draw() {
    const zCam = cam.z + 0.6, end = E.endZ;
    if (end < zCam) return;
    const zEnd = end < 640 ? end : 640;
    const lit = E.igniteLevel / 3;
    const a = E.colA;
    wallCol[0] = 0.0026 + a[0] * 0.03; wallCol[1] = 0.001 + a[1] * 0.03; wallCol[2] = 0.0055 + a[2] * 0.03;
    capCol[0] = wallCol[0] * 0.6; capCol[1] = wallCol[1] * 0.6; capCol[2] = wallCol[2] * 0.6;
    // the gold that is not in anybody's palette yet: it climbs the ribs from behind over the last four beats
    const goldReach = E.creep > 0 ? -8 + E.creep * E.creep * 70 : -99;

    // ---- segment boundaries, near to far: every rib near, coarser (still world-aligned) far away
    let n = 0, z = Math.floor((E.dist + zCam) / BAY) * BAY - E.dist;
    segZ[n++] = zCam;
    while (n < MAX_SEG - 1) {
      const L = z < 104 ? BAY : z < 248 ? BAY * 2 : BAY * 6;
      z = (Math.floor((z + E.dist) / L + 1e-4) + 1) * L - E.dist;
      if (z >= zEnd) break;
      if (z > zCam + 0.05) segZ[n++] = z;
    }
    segZ[n++] = zEnd;

    // ---- the mouth
    if (E.capOn && end < 640) {
      // a blast door closes the tunnel behind the shutter: nothing of the city may show
      for (let i = 0; i < LANES; i++) cam.quad(0, 0, end, WX[i], WY[i], end, WX[i + 1], WY[i + 1], end, WX[i + 1], WY[i + 1], end, capCol, 1, 1);
      A[2] = end; A[5] = end; A[7] = 0.3 * (0.8 + 0.6 * E.kick);
      for (let i = 0; i < LANES; i++) {
        A[0] = RX[i]; A[1] = RY[i]; A[3] = RX[i + 1]; A[4] = RY[i + 1]; A[6] = 0.07; E.line3S(E.colA, 3);
        A[3] = WX[i]; A[4] = WY[i]; A[6] = 0.06; E.line3S(E.colC, 3);                          // door clamps
      }
    }

    // ---- walls, far to near
    const tick = E.tick16;
    for (let s = n - 2; s >= 0; s--) {
      const za = segZ[s], zb = segZ[s + 1];
      const bay = Math.round((za + E.dist) / BAY);
      const near = za < 104;
      // panels: opaque, almost black, each plate a slightly different shade so the surface reads
      A[4] = za; A[5] = zb; A[8] = 1;
      for (let i = 0; i < LANES; i++) {
        let shade = 0.8;
        if (near) {
          H3(bay, i, 110); const h0 = HV[0];
          H3(bay, i, 113);
          shade = 0.35 + 1.4 * h0 * HV[0] + ((i + bay) & 1 ? 0.25 : 0);
          if (E.creep > 0) { H3(bay * 8 + i, tick, 111); if (HV[0] < 0.1 * E.creep) shade *= 2.6; }       // plates flicker as the build peaks
        }
        A[0] = WX[i]; A[1] = WY[i]; A[2] = WX[i + 1]; A[3] = WY[i + 1]; A[7] = shade;
        E.zQuadS(wallCol);
      }
      // seams along the corners
      const cs = za < goldReach ? E.nova : E.colA;
      A[2] = za; A[5] = zb; A[6] = 0.05; A[7] = (0.07 + 0.15 * lit) * (za < goldReach ? 1.6 : 1);
      for (let i = 0; i < LANES; i++) { A[0] = WX[i]; A[1] = WY[i]; A[3] = WX[i]; A[4] = WY[i]; E.line3S(cs, 3); }

      if (za > zCam + 0.01) {
        if (near && za < 96) {
          // wall dressing for the bay that starts at this rib
          const run = ((bay * 2 - tick) & 15) === 0;                       // a pulse racing ahead on the 16ths
          for (let i = 0; i < LANES; i++) {
            const kind = (i + (bay >> 2)) & 3;
            const x0 = WX[i], y0 = WY[i], dx = WX[i + 1] - x0, dy = WY[i + 1] - y0;
            if (kind === 0 && (bay & 1) === 0) {
              // hazard chevrons, pointing the way out (violet: yellow and magenta mean something here)
              A[6] = 0.07; A[7] = (0.13 + 0.12 * lit) * (((bay >> 1) - (tick >> 1)) & 3 ? 1 : 2.1);
              A[3] = x0 + dx * 0.5; A[4] = y0 + dy * 0.5;
              for (let c = 0; c < 2; c++) {
                const zc = za + 1.2 + c * 2.6;
                A[2] = zc; A[5] = zc + 2.2;
                A[0] = x0 + dx * 0.24; A[1] = y0 + dy * 0.24; E.line3S(E.colA, 3);
                A[0] = x0 + dx * 0.76; A[1] = y0 + dy * 0.76; E.line3S(E.colA, 3);
              }
            } else if (kind === 2 && (bay & 3) === 1) {
              K[1] = za + 1.2; K[2] = 0.1 + 0.14 * lit;
              stencil(bay * 3 + i, i);
            } else if (kind === 3 && (bay & 1) === 1) {
              // a service strip: two short bars
              A[2] = za + 2; A[5] = za + 6; A[6] = 0.05; A[7] = 0.08 + 0.1 * lit;
              A[0] = x0 + dx * 0.34; A[1] = y0 + dy * 0.34; A[3] = A[0]; A[4] = A[1]; E.line3S(E.colB, 3);
              A[0] = x0 + dx * 0.66; A[1] = y0 + dy * 0.66; A[3] = A[0]; A[4] = A[1]; E.line3S(E.colB, 3);
            }
            // chase lights on alternate corners
            if ((i & 1) === 0) {
              A[0] = x0 * 0.985; A[1] = y0 * 0.985; A[2] = za; A[3] = run ? 0.3 : 0.12; A[7] = (run ? 0.75 : 0.22) * (0.3 + 0.7 * lit);
              E.glow3S(run ? E.pale : E.colA, 2);
            }
          }
        }
        // the rib at this boundary
        H3(bay, 0, 112);
        const gold = za < goldReach * (0.55 + 0.45 * HV[0]);
        if (gold) K[0] = 0.55 * (0.8 + 0.6 * E.kick); else { K[0] = za; ribK(); }
        const kr = K[0];
        const cr = gold ? E.nova : E.colA;
        A[2] = za; A[5] = za;
        for (let i = 0; i < LANES; i++) {
          A[0] = RX[i]; A[1] = RY[i]; A[3] = RX[i + 1]; A[4] = RY[i + 1]; A[6] = near ? 0.075 : 0.06; A[7] = kr; E.line3S(cr, 3.5);
          if (near) { A[3] = WX[i]; A[4] = WY[i]; A[6] = 0.06; A[7] = kr * 0.8; E.line3S(cr, 3); }
        }
      }
    }

    // ---- after the drop: the mouth's rim flares as it sweeps past the camera
    if (!E.capOn && end > zCam + 0.2) {
      const kf = 0.5 + 1.4 * Math.exp(-E.revealT / 0.12);
      A[2] = end; A[5] = end;
      for (let i = 0; i < LANES; i++) {
        A[0] = WX[i]; A[1] = WY[i]; A[3] = WX[i + 1]; A[4] = WY[i + 1]; A[6] = 0.12; A[7] = kf; E.line3S(E.pale, 4);
        A[0] = RX[i]; A[1] = RY[i]; A[3] = RX[i + 1]; A[4] = RY[i + 1]; A[6] = 0.07; A[7] = kf * 0.6; E.line3S(E.colC, 3);
      }
    }
  }
  return { draw };
}
