// game/courier.js — the hero: a cyber courier sprinting on mag-blades, and the two ribbons of
// light the blades leave behind.
//
// How it is built: a small 3D skeleton (two-bone IK for arms and legs) posed procedurally in BODY
// SPACE (x right, y up from the feet, z forward, metres), then turned into the tube frame with
// frame.up / frame.runner and projected joint by joint with cam.project. Because every joint goes
// through the real camera, the world roll, the gravity flip and the 360 degree corkscrew need no
// special cases: the figure is simply somewhere else, facing some other way, and the parts are
// depth-sorted. Each part is a dark capsule; all the cyan rims are drawn first and all the dark
// fills on top, so the body reads as one silhouette with one neon outline (a hole punched in the
// glow), with white-hot accents (visor, spine, blades) painted on as each part is drawn.
//
// Ribbons live in the tube frame: each sample remembers where a blade was, and drifts back toward
// the camera as it ages, so a roll whips them across the lane and a flip leaves a double helix
// through the core. Budget: about 200 quads running, 320 at the busiest (limit 500).
import { C } from './config.js';
import { clamp, clamp01, lerp, smoothstep, hash1, mixColor } from '../engine/math.js';

// ---- proportions (metres). Long legs, broad shoulders, small helmet: it has to read at 90 px tall.
const THIGH = 0.48, SHIN = 0.47, ANKLE = 0.09, HIP_W = 0.105, TORSO = 0.52, SH_W = 0.235;
const UARM = 0.3, FARM = 0.29, HEAD_R = 0.112;

// ---- joints
const PEL = 0, WA = 1, CH = 2, HD = 3, SL = 4, SR = 5, EL = 6, ER = 7, HL = 8, HR = 9;
const HIL = 10, HIR = 11, KL = 12, KR = 13, AL = 14, AR = 15, TL = 16, TR = 17;
const BL0 = 18, BL1 = 19, BR0 = 20, BR1 = 21;         // blade tail / tip
const PK0 = 22, PK1 = 23;                             // the courier tube slung across the back (top, bottom)
const SP0 = 24, SP1 = 25;                             // spine light: nape .. tailbone
const HT = 26, HC = 27, V0 = 28;                      // helmet tail, crest top, visor arc V0..V0+4
const CL0 = 33;                                       // calf light strips: CL0..CL0+3 (left top/bottom, right top/bottom)
const NJ = 37;

// ---- pose parameters (blended between behaviours)
const HIPX = 0, HIPY = 1, HIPZ = 2, LEAN = 3, YAW = 4, SIDE = 5, TILT = 6;
const FLX = 7, FLY = 8, FLZ = 9, FLH = 10, FRX = 11, FRY = 12, FRZ = 13, FRH = 14;
const HLX = 15, HLY = 16, HLZ = 17, HRX = 18, HRY = 19, HRZ = 20, HYAW = 21, HDY = 22, KNEE = 23;
const NP = 24;

// ---- draw groups (depth-sorted far to near)
const G_HEAD = 0, G_TORSO = 1, G_PACK = 2, G_UAL = 3, G_FAL = 4, G_UAR = 5, G_FAR = 6;
const G_THL = 7, G_SHL = 8, G_THR = 9, G_SHR = 10, NG = 11;

// capsules: joint a, joint b, t0, t1 (the part of a->b it covers), width, group. A limb is a thin
// full-length capsule plus a fatter partial one, so it tapers like muscle under armour plate.
const CAPS = new Float32Array([
  CH, PEL, 0, 1, 0.225, G_TORSO,
  SL, HIL, 0, 1, 0.14, G_TORSO,
  SR, HIR, 0, 1, 0.14, G_TORSO,
  SL, SR, 0, 1, 0.16, G_TORSO,
  HIL, HIR, 0, 1, 0.215, G_TORSO,
  CH, HD, 0, 1, 0.085, G_HEAD,
  HD, HT, 0, 1, 0.15, G_HEAD,
  PK0, PK1, 0, 1, 0.11, G_PACK,
  SL, EL, 0, 1, 0.105, G_UAL,
  EL, HL, 0, 1, 0.088, G_FAL,
  SR, ER, 0, 1, 0.105, G_UAR,
  ER, HR, 0, 1, 0.088, G_FAR,
  HIL, KL, 0, 1, 0.15, G_THL,
  KL, AL, 0, 1, 0.11, G_SHL,
  AL, TL, 0, 1, 0.13, G_SHL,
  HIR, KR, 0, 1, 0.15, G_THR,
  KR, AR, 0, 1, 0.11, G_SHR,
  AR, TR, 0, 1, 0.13, G_SHR,
  // ---- the fat parts (not drawn by the afterimages)
  SL, EL, 0, 0.5, 0.145, G_UAL,
  EL, HL, 0.5, 1, 0.12, G_FAL,
  SR, ER, 0, 0.5, 0.145, G_UAR,
  ER, HR, 0.5, 1, 0.12, G_FAR,
  HIL, KL, 0, 0.58, 0.215, G_THL,
  KL, AL, 0.06, 0.52, 0.16, G_SHL,
  KL, AL, 0.8, 1, 0.145, G_SHL,
  HIR, KR, 0, 0.58, 0.215, G_THR,
  KR, AR, 0.06, 0.52, 0.16, G_SHR,
  KR, AR, 0.8, 1, 0.145, G_SHR,
]);
const NCAP = CAPS.length / 6, NCAP_BASE = 18;
// discs: joint, group, then radii
const DSC = new Uint8Array([HD, G_HEAD, SL, G_UAL, SR, G_UAR, KL, G_THL, KR, G_THR]);
const DSCR = new Float32Array([HEAD_R, 0.1, 0.1, 0.085, 0.085]);
const NDSC = DSCR.length;
// which joints give each group its depth
const GKEY = new Uint8Array([HD, HD, WA, WA, PK0, PK1, SL, EL, EL, HL, SR, ER, ER, HR, HIL, KL, KL, AL, HIR, KR, KR, AR]);

const FILL = [0.003, 0.012, 0.02];      // near-black with a breath of teal, so the body is not a void
const BLACK = [0, 0, 0];
const BRONZE = [0.17, 0.075, 0.012];       // the fill when the nova lights the runner's back
const RN = 64;                           // ribbon samples per blade
const HN = 14;                           // glove-streak samples per hand

// one stride: u = beats from this leg's full extension (-1..1). The push builds through the beat
// before and snaps out ON the beat, then the leg recovers under the body in half a beat.
function ext(u) {
  if (u < 0) { const t = clamp01((u + 0.82) / 0.82), e = t * t * (3 - 2 * t); return e * (0.45 + 0.55 * e); }
  const t = clamp01(u / 0.56);
  return 1 - t * t * (3 - 2 * t);
}
function lift(u) { return u > 0 && u < 0.64 ? Math.sin((u / 0.64) * Math.PI) : 0; }

export function createCourier(gfx, cam) {
  const P = new Float32Array(NP);
  const JX = new Float32Array(NJ), JY = new Float32Array(NJ), JZ = new Float32Array(NJ);   // body space
  const BX = new Float32Array(NJ), BY = new Float32Array(NJ), BZ = new Float32Array(NJ);   // runner frame (right, up, forward)
  const SX = new Float32Array(NJ), SY = new Float32Array(NJ), SS = new Float32Array(NJ);   // screen
  const order = new Uint8Array(NG), key = new Float32Array(NG);
  const vis = new Float32Array(4);        // visor segment visibility
  // ribbons: tube-frame samples of each blade tail
  const rX = new Float32Array(2 * RN), rY = new Float32Array(2 * RN), rZ = new Float32Array(2 * RN), rT = new Float32Array(RN);
  let rHead = 0, rCount = 0;
  // glove streaks: short trails off the hands when the courier is really moving
  const hX = new Float32Array(2 * HN), hY = new Float32Array(2 * HN), hZ = new Float32Array(2 * HN), hT = new Float32Array(HN);
  let hHead = 0, hCount = 0;
  const rimCol = [0, 0, 0], hotCol = [0, 0, 0], fillCol = [0, 0, 0], goldCol = [0, 0, 0];

  // ---- state
  let clock = 0, lastPush = -1, posed = false;
  let G = 1;                               // figure scale (grows a little with gear as the FOV widens)
  let bank = 0, bankV = 0;                 // lean into rolls (spring)
  let surge = 0, surgeV = 0;               // forward/back body offset (launch, ram, knock-back)
  let spin = 0, sq = 1, offX = 0, offY = 0, offZ = 0;
  let wIgn = 0, wGrind = 0, grindSide = 1, wRam = 0, wAir = 0, airA = 0, wHit = 0;
  let launched = false;
  let flashT = 9, flashAmp = 0, hitT = 9, hitAmp = 0, hitDur = 0.7, hitDir = 1, hitN = 0;
  let launchT = 9, pipT = 9, pipN = 0, gearT = 9, landT = 9;
  let charge = 0, shake = 0, backVis = 1, spineK = 1, ribbonGain = 0, echoK = 0, lanceK = 0, lanceL = 0;
  let ikx = 0, iky = 0, ikz = 0, iex = 0, iey = 0, iez = 0;

  function to(i, v, w) { P[i] += (v - P[i]) * w; }
  function setJ(i, x, y, z) { JX[i] = x; JY[i] = y; JZ[i] = z; }

  // Two-bone IK: root a, target t, bone lengths, pole hint p. Writes the middle joint to ik* and
  // the (reach-clamped) end to ie*.
  function ik(ax, ay, az, tx, ty, tz, l1, l2, px, py, pz) {
    let dx = tx - ax, dy = ty - ay, dz = tz - az;
    let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-4) { d = 1e-4; dx = 0; dy = -d; dz = 0; }
    const ux = dx / d, uy = dy / d, uz = dz / d;
    const dd = clamp(d, Math.abs(l1 - l2) + 0.02, (l1 + l2) * 0.997);
    const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const dot = px * ux + py * uy + pz * uz;
    let qx = px - ux * dot, qy = py - uy * dot, qz = pz - uz * dot;
    const ql = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1;
    qx /= ql; qy /= ql; qz /= ql;
    ikx = ax + ux * a + qx * h; iky = ay + uy * a + qy * h; ikz = az + uz * a + qz * h;
    iex = ax + ux * dd; iey = ay + uy * dd; iez = az + uz * dd;
  }

  // ------------------------------------------------------------------ poses
  // RUN: skating strides locked to the beat. Left leg hits full extension on even beats, right on odd.
  function poseRun(f, g, amp) {
    const b = f.beat;
    const uL = b + 1 - 2 * Math.floor((b + 1) / 2) - 1, uR = b - 2 * Math.floor(b / 2) - 1;
    const eL = ext(uL), eR = ext(uR), lL = lift(uL), lR = lift(uR);
    const A = (0.8 + 0.2 * g) * amp;
    const sw = eL - eR, pk = Math.max(eL, eR);
    P[HIPX] = sw * 0.15 * A;
    P[HIPY] = 0.7 - 0.07 * g - 0.045 * pk * A + 0.01 * Math.sin(f.time * 2.3);
    P[HIPZ] = 0;
    P[LEAN] = 0.66 + 0.24 * g + 0.08 * pk * A;
    P[YAW] = -sw * (0.36 + 0.12 * g);
    P[SIDE] = sw * 0.075 * A;
    P[TILT] = sw * 0.2;
    P[KNEE] = 0.42;
    // feet: glide under the body, drive out to the side and back
    const eLA = eL * A, eRA = eR * A;
    P[FLX] = lerp(-0.12 + P[HIPX] * 0.7, -0.8, eLA); P[FLY] = ANKLE + 0.17 * lL * A; P[FLZ] = lerp(0.14, -0.42, eLA) - 0.12 * lL;
    P[FRX] = lerp(0.12 + P[HIPX] * 0.7, 0.8, eRA); P[FRY] = ANKLE + 0.17 * lR * A; P[FRZ] = lerp(0.14, -0.42, eRA) - 0.12 * lR;
    P[FLH] = -0.7 * Math.max(eL, lL * 0.6); P[FRH] = 0.7 * Math.max(eR, lR * 0.6);
    // arms counter-swing: when the left leg drives back, the right arm whips back and up
    const sa = clamp(sw * 0.8 + 0.3 * Math.cos(b * Math.PI), -1, 1) * (0.82 + 0.18 * g) * amp;
    const tr = 0.5 + 0.5 * sa, tl = 0.5 - 0.5 * sa;
    // (the hands swing through low and close like pendulums, not straight across)
    const mr = 4 * tr * (1 - tr), ml = 4 * tl * (1 - tl);
    P[HRX] = lerp(0.02, 0.36, tr) - 0.13 * mr; P[HRY] = lerp(-0.42, 0.22, tr) - 0.26 * mr; P[HRZ] = lerp(0.3, -0.4, tr);
    P[HLX] = -lerp(0.02, 0.36, tl) + 0.13 * ml; P[HLY] = lerp(-0.42, 0.22, tl) - 0.26 * ml; P[HLZ] = lerp(0.3, -0.4, tl);
    P[HYAW] = P[YAW] * 0.25; P[HDY] = 0;
  }

  // GRIND: carve into the fin on side s; outside foot pressed against it, trailing hand on the wall.
  function poseGrind(w, s, f) {
    const j = (hash1(Math.floor(f.time * 40)) - 0.5) * 0.02;   // scrape chatter
    to(HIPX, -s * 0.06, w); to(HIPY, 0.6 + j, w); to(LEAN, 0.62, w); to(YAW, s * 0.3, w); to(SIDE, s * 0.05, w); to(TILT, -s * 0.2, w);
    const ox = s > 0 ? FRX : FLX, ix = s > 0 ? FLX : FRX;
    to(ox, s * 0.1, w); to(ox + 1, ANKLE, w); to(ox + 2, 0.2, w); to(ox + 3, s * 0.45, w);
    to(ix, -s * 0.36, w); to(ix + 1, ANKLE, w); to(ix + 2, -0.26, w); to(ix + 3, s * 0.4, w);
    const oh = s > 0 ? HRX : HLX, ih = s > 0 ? HLX : HRX;
    to(oh, s * 0.5, w); to(oh + 1, -0.4 + j, w); to(oh + 2, -0.26, w);        // trailing hand, low and back
    to(ih, -s * 0.4, w); to(ih + 1, 0.2, w); to(ih + 2, 0.06, w);            // balance arm, up and out
  }

  // IGNITION: clamped in the barrel in a starter's crouch, front hand on the deck, back arm cocked.
  function poseIgnition(w, f) {
    const dip = 0.022 * charge + 0.03 * Math.exp(-pipT * 9);
    const tr = (hash1(Math.floor(f.time * 50)) - 0.5) * 0.008 * charge;
    to(HIPX, 0.02 + tr, w); to(HIPY, 0.54 - dip, w); to(HIPZ, -0.06, w); to(LEAN, 1.02, w); to(YAW, -0.42, w); to(SIDE, 0, w); to(TILT, 0.22, w);
    to(FLX, -0.13, w); to(FLY, ANKLE, w); to(FLZ, 0.34, w); to(FLH, -0.1, w);
    to(FRX, 0.24, w); to(FRY, ANKLE, w); to(FRZ, -0.44, w); to(FRH, 0.95, w);
    to(HLX, 0.03, w); to(HLY, -0.66, w); to(HLZ, 0.26, w);
    to(HRX, 0.24, w); to(HRY, 0.2 + tr * 3, w); to(HRZ, -0.4, w);
    to(HYAW, 0, w); to(HDY, -0.02, w);
  }

  // FLIP: spring off, a split tuck while the body corkscrews, then reach for the new lane.
  function poseFlip(a) {
    const tuck = smoothstep(0.04, 0.24, a) * (1 - smoothstep(0.66, 0.95, a));
    const reach = smoothstep(0.68, 0.94, a);
    to(HIPX, 0, wAir); to(HIPY, 0.8, wAir); to(LEAN, lerp(0.35, 0.8, tuck), wAir); to(YAW, 0, wAir); to(SIDE, 0, wAir); to(TILT, 0, wAir);
    const fy = lerp(ANKLE + 0.02, P[HIPY] - 0.34, tuck);
    to(FLX, lerp(-0.14, -0.33, tuck), wAir); to(FLY, fy, wAir); to(FLZ, lerp(0.02, 0.22, tuck), wAir); to(FLH, -0.3 * tuck, wAir);
    to(FRX, lerp(0.14, 0.33, tuck), wAir); to(FRY, fy - 0.07 * tuck, wAir); to(FRZ, lerp(-0.04, -0.14, tuck), wAir); to(FRH, 0.3 * tuck, wAir);
    // arms: thrown up at launch, hugged in through the twist, flung wide to land
    const up = 1 - smoothstep(0.0, 0.2, a);
    to(HLX, lerp(lerp(0.07, -0.3, up), -0.5, reach), wAir); to(HLY, lerp(lerp(-0.24, 0.42, up), 0.08, reach), wAir); to(HLZ, lerp(0.2, 0.02, reach), wAir);
    to(HRX, lerp(lerp(-0.07, 0.3, up), 0.5, reach), wAir); to(HRY, lerp(lerp(-0.27, 0.42, up), 0.08, reach), wAir); to(HRZ, lerp(0.2, 0.02, reach), wAir);
    to(HYAW, 0, wAir);
  }

  // BREACH: a lunge with the right shoulder leading and the right fist driven ahead.
  function poseRam(w) {
    to(HIPX, -0.03, w); to(HIPY, 0.68, w); to(HIPZ, 0.1, w); to(LEAN, 0.98, w); to(YAW, 0.9, w); to(SIDE, -0.03, w); to(TILT, 0.3, w);
    to(HRX, 0.1, w); to(HRY, 0.2, w); to(HRZ, 0.52, w);
    to(HLX, -0.3, w); to(HLY, -0.06, w); to(HLZ, -0.5, w);
    to(FRX, 0.13, w); to(FRY, ANKLE, w); to(FRZ, 0.44, w); to(FRH, 0.05, w);
    to(FLX, -0.34, w); to(FLY, ANKLE + 0.05, w); to(FLZ, -0.58, w); to(FLH, -0.5, w);
    to(HYAW, 0.1, w); to(HDY, -0.03, w);
  }

  // CRASH / STUMBLE: thrown back off balance, arms windmilling, one foot braced, one kicked up.
  function poseHit(w, d, t) {
    const wob = Math.sin(t * 26) * 0.12 * w;
    to(HIPX, d * 0.08, w); to(HIPY, 0.84, w); to(HIPZ, 0.1, w); to(LEAN, -0.34 + wob, w); to(YAW, d * 0.55, w); to(SIDE, -d * 0.1, w); to(TILT, d * 0.35, w);
    to(HLX, -0.5, w); to(HLY, 0.3 + d * 0.16 + wob, w); to(HLZ, 0.06, w);
    to(HRX, 0.5, w); to(HRY, 0.3 - d * 0.16 - wob, w); to(HRZ, 0.06, w);
    const bx = d > 0 ? FLX : FRX, kx = d > 0 ? FRX : FLX, sg = d > 0 ? -1 : 1;
    to(bx, sg * 0.22, w); to(bx + 1, ANKLE, w); to(bx + 2, 0.46, w); to(bx + 3, 0, w);
    to(kx, -sg * 0.3, w); to(kx + 1, ANKLE + 0.3, w); to(kx + 2, -0.36, w); to(kx + 3, -sg * 0.5, w);
    to(HYAW, -d * 0.3, w); to(HDY, 0.02, w);
  }

  // ------------------------------------------------------------------ skeleton
  function build() {
    const hx = P[HIPX], hy = P[HIPY], hz = P[HIPZ];
    const sl = Math.sin(P[LEAN]), cl = Math.cos(P[LEAN]);
    // spine direction
    let tx = P[SIDE] * 2, ty = cl, tz = sl;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz); tx /= tl; ty /= tl; tz /= tl;
    const sy = Math.sin(P[YAW]), cy = Math.cos(P[YAW]);
    const ax = cy, ay = P[TILT], az = sy;                 // shoulder axis (toward the right shoulder)
    const bx = cl * sy, by = sl, bz = -cl * cy;           // the back's outward normal
    setJ(PEL, hx, hy, hz);
    setJ(WA, hx + tx * TORSO * 0.45, hy + ty * TORSO * 0.45, hz + tz * TORSO * 0.45);
    const cx = hx + tx * TORSO, cyy = hy + ty * TORSO, cz = hz + tz * TORSO;
    setJ(CH, cx, cyy, cz);
    setJ(SR, cx + ax * SH_W - tx * 0.03, cyy + ay * SH_W - ty * 0.03, cz + az * SH_W - tz * 0.03);
    setJ(SL, cx - ax * SH_W - tx * 0.03, cyy - ay * SH_W - ty * 0.03, cz - az * SH_W - tz * 0.03);
    // hips counter-rotate a little against the shoulders
    const hyw = -P[YAW] * 0.3, hcx = Math.cos(hyw), hsz = Math.sin(hyw);
    setJ(HIR, hx + hcx * HIP_W, hy - 0.02, hz + hsz * HIP_W);
    setJ(HIL, hx - hcx * HIP_W, hy - 0.02, hz - hsz * HIP_W);
    // head: the gaze stays locked down the lane whatever the body does
    const hdx = cx + tx * 0.05 - hx * 0.25, hdy = cyy + 0.165 + P[HDY] + ty * 0.02, hdz = cz + 0.05 + tz * 0.03;
    setJ(HD, hdx, hdy, hdz);
    const fhx = -Math.sin(P[HYAW]), fhz = Math.cos(P[HYAW]);   // head forward (x,z); head right = (fhz, -fhx)
    setJ(HT, hdx - fhx * 0.1, hdy + 0.02, hdz - fhz * 0.1);
    setJ(HC, hdx + fhx * 0.02, hdy + HEAD_R * 0.98, hdz + fhz * 0.02);
    for (let i = 0; i < 5; i++) {
      const al = (i - 2) * 0.92, sa = Math.sin(al), ca = Math.cos(al);
      setJ(V0 + i, hdx + (fhz * sa + fhx * ca) * HEAD_R * 0.97, hdy + 0.012, hdz + (-fhx * sa + fhz * ca) * HEAD_R * 0.97);
      if (i < 4) {
        const am = al + 0.46, nx = fhz * Math.sin(am) + fhx * Math.cos(am), nz = -fhx * Math.sin(am) + fhz * Math.cos(am);
        vis[i] = clamp01((-0.12 - (-nx * Math.sin(spin) + nz * Math.cos(spin))) * 2.2);
      }
    }
    // the courier tube slung from the right shoulder to the left hip, and the spine light under it
    setJ(PK0, cx + ax * 0.2 + tx * 0.1 + bx * 0.13, cyy + ay * 0.2 + ty * 0.1 + by * 0.13, cz + az * 0.2 + tz * 0.1 + bz * 0.13);
    setJ(PK1, hx - ax * 0.18 + tx * 0.07 + bx * 0.14, hy - ay * 0.18 + ty * 0.07 + by * 0.14, hz - az * 0.18 + tz * 0.07 + bz * 0.14);
    setJ(SP0, cx + bx * 0.09 - tx * 0.03, cyy + by * 0.09 - ty * 0.03, cz + bz * 0.09 - tz * 0.03);
    setJ(SP1, hx + tx * 0.03 + bx * 0.1, hy + ty * 0.03 + by * 0.1, hz + tz * 0.03 + bz * 0.1);
    backVis = clamp01(-(-bx * Math.sin(spin) + bz * Math.cos(spin)) * 2.2);
    // arms
    ik(JX[SL], JY[SL], JZ[SL], JX[SL] + P[HLX], JY[SL] + P[HLY], JZ[SL] + P[HLZ], UARM, FARM, -0.3, -0.3, -1);
    setJ(EL, ikx, iky, ikz); setJ(HL, iex, iey, iez);
    ik(JX[SR], JY[SR], JZ[SR], JX[SR] + P[HRX], JY[SR] + P[HRY], JZ[SR] + P[HRZ], UARM, FARM, 0.3, -0.3, -1);
    setJ(ER, ikx, iky, ikz); setJ(HR, iex, iey, iez);
    // legs, boots, blades, calf strips
    ik(JX[HIL], JY[HIL], JZ[HIL], P[FLX], P[FLY], P[FLZ], THIGH, SHIN, -P[KNEE], 0.1, 1);
    setJ(KL, ikx, iky, ikz); setJ(AL, iex, iey, iez);
    ik(JX[HIR], JY[HIR], JZ[HIR], P[FRX], P[FRY], P[FRZ], THIGH, SHIN, P[KNEE], 0.1, 1);
    setJ(KR, ikx, iky, ikz); setJ(AR, iex, iey, iez);
    for (let s = 0; s < 2; s++) {
      const A = AL + s, K = KL + s, hd = P[s ? FRH : FLH], sh = Math.sin(hd), ch = Math.cos(hd);
      const x = JX[A], y = JY[A], z = JZ[A], by0 = y - ANKLE + 0.015;
      setJ(TL + s, x + sh * 0.19, y - 0.045, z + ch * 0.19);
      setJ(BL0 + s * 2, x - sh * 0.24, by0, z - ch * 0.24);
      setJ(BL1 + s * 2, x + sh * 0.34, by0, z + ch * 0.34);
      setJ(CL0 + s * 2, lerp(JX[K], x, 0.18), lerp(JY[K], y, 0.18), lerp(JZ[K], z, 0.18) - 0.066);
      setJ(CL0 + s * 2 + 1, lerp(JX[K], x, 0.92), lerp(JY[K], y, 0.92), z - 0.066);
    }
    // body space -> runner frame: scale, squash, corkscrew about the long axis, bank about the feet
    const kxz = G / Math.sqrt(sq), ky = G * sq;
    const sn = Math.sin(spin), cs = Math.cos(spin), sb = Math.sin(bank), cb = Math.cos(bank);
    for (let i = 0; i < NJ; i++) {
      const x = JX[i] * kxz, y = JY[i] * ky, z = JZ[i] * kxz;
      const xs = x * cs + z * sn, zs = -x * sn + z * cs;
      BX[i] = xs * cb + y * sb + offX; BY[i] = -xs * sb + y * cb + offY; BZ[i] = zs + offZ;
    }
  }

  // ------------------------------------------------------------------ update
  function onEvent(ev, f) {
    const t = ev.type;
    if (t === 'roll') { bankV += ev.dir * (ev.air ? 5 : 3.2); }
    else if (t === 'graze') { flashT = 0; flashAmp = 1; }
    else if (t === 'thread') { flashT = 0; flashAmp = 1.3; }
    else if (t === 'breachHit') { flashT = 0; flashAmp = ev.grade === 'perfect' ? 0.9 : 0.5; }
    else if (t === 'orb') { flashT = 0.05; flashAmp = 0.6; }
    else if (t === 'crash') { hitT = 0; hitAmp = 1; hitDur = 0.78; hitN++; hitDir = hash1(hitN * 7 + 3) > 0.5 ? 1 : -1; surgeV = -9; }
    else if (t === 'stumble') { hitT = 0; hitAmp = 0.55; hitDur = 0.45; hitN++; hitDir = hash1(hitN * 7 + 3) > 0.5 ? 1 : -1; surgeV = -4.5; }
    else if (t === 'pip') { pipT = 0; pipN = ev.n || pipN + 1; }
    else if (t === 'start') { pipN = 0; pipT = 9; launchT = 9; rCount = 0; hCount = 0; launched = false; }
    else if (t === 'launch') { launchT = 0; surgeV += 6.5; wIgn = 0; launched = true; }
    else if (t === 'gearUp') { gearT = 0; }
    else if (t === 'land') { landT = 0; }
    else if (t === 'rollRefused') { bankV += ev.dir * 2; }
  }

  function update(dt, f) {
    clock += dt;
    flashT += dt; hitT += dt; launchT += dt; pipT += dt; gearT += dt; landT += dt;
    const g = clamp01((f.gearF - 1) / 4);
    G = 1 + 0.3 * g;
    // (hit-stop can hold the visual beat just short of the launch beat: once fired, stay fired)
    if (f.mode !== 'ignition') launched = false;
    const ign = f.mode === 'ignition' && !launched;
    // ---- blend weights
    wIgn = ign ? 1 : Math.max(0, wIgn - dt / 0.07);
    if (f.grind) grindSide = f.grind;
    wGrind += ((f.grind ? 1 : 0) - wGrind) * Math.min(1, dt * 14);
    airA = f.air >= 0 ? clamp01(f.air) : -1;
    wAir = airA >= 0 ? Math.min(1, wAir + dt / 0.035) : Math.max(0, wAir - dt / 0.07);
    const rt = f.ramT;
    wRam = rt < 0 ? Math.max(0, wRam - dt / 0.1) : rt < 0.03 ? Math.max(wRam, rt / 0.03) : 1 - smoothstep(0.17, 0.36, rt);
    wHit = hitT < hitDur ? hitAmp * (1 - smoothstep(hitDur * 0.3, hitDur, hitT)) : 0;
    charge = ign ? clamp(Math.max(pipN, Math.floor(f.beat)), 0, 3) : 0;
    const boost = Math.exp(-launchT * 4.5);          // the first stride out of the barrel is the biggest

    // ---- pose
    poseRun(f, g, 1 + 0.35 * boost);
    P[LEAN] += 0.22 * boost;
    if (wGrind > 0.002) poseGrind(wGrind, grindSide, f);
    if (wIgn > 0.002) poseIgnition(wIgn, f);
    if (wAir > 0.002) poseFlip(airA >= 0 ? airA : 1);
    if (wRam > 0.002) poseRam(wRam);
    if (wHit > 0.002) poseHit(Math.min(1, wHit), hitDir, hitT);
    // land: arms thrown wide and low for 200 ms
    const lt = airA < 0 ? Math.min(landT, f.landT) : 9;
    if (lt < 0.22) {
      const w = 1 - lt / 0.22;
      to(HLX, -0.5, w); to(HLY, -0.1, w); to(HLZ, 0, w); to(HRX, 0.5, w); to(HRY, -0.1, w); to(HRZ, 0, w);
      to(HIPY, 0.6, w * 0.6);
    }

    // ---- springs (sub-stepped so a long frame cannot blow them up)
    const bankTarget = clamp(f.rollVel * 0.075, -0.55, 0.55) * (1 - wAir) * (1 - wIgn * 0.6) + grindSide * 0.44 * wGrind + hitDir * 0.24 * wHit;
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120); left -= h;
      bankV += ((bankTarget - bank) * 300 - bankV * 17) * h; bank += bankV * h;
      surgeV += (-surge * 95 - surgeV * 12) * h; surge += surgeV * h;
    }
    bank = clamp(bank, -0.75, 0.75);
    // the outside arm flares out as the body banks; the inside hand drops toward the deck
    const bk = clamp(bank / 0.5, -1, 1) * (1 - wAir) * (1 - wRam) * (1 - wGrind * 0.7);
    if (bk > 0) { P[HLX] -= 0.26 * bk; P[HLY] += 0.3 * bk; P[HRY] -= 0.12 * bk; P[HRX] += 0.08 * bk; }
    else { P[HRX] -= 0.26 * bk; P[HRY] -= 0.3 * bk; P[HLY] += 0.12 * bk; P[HLX] += 0.08 * bk; }

    // ---- whole-body terms
    spin = 0; sq = 1; offX = 0; offY = 0; offZ = surge + 0.3 * wRam;
    if (airA >= 0) {
      const u = clamp01((airA - 0.05) / 0.87);
      spin = Math.PI * 2 * (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
      sq = 1 + 0.16 * Math.sin(clamp01(airA / 0.22) * Math.PI) + 0.08 * smoothstep(0.75, 1, airA);
    } else if (lt < 0.16) {
      // landing: 0.7 > 1.1 > 1.0 in 160 ms
      sq = lt < 0.065 ? lerp(0.7, 1.1, 1 - (1 - lt / 0.065) * (1 - lt / 0.065)) : lerp(1.1, 1, smoothstep(0.065, 0.16, lt));
    }
    if (wHit > 0) { spin += hitDir * 0.5 * wHit; sq *= 1 - 0.1 * wHit * Math.exp(-hitT * 10); }
    sq *= 1 + 0.13 * Math.exp(-launchT * 9) - 0.05 * Math.exp(-pipT * 10) * wIgn;
    // ghost: the figure tears sideways for a frame now and then
    shake = 0;
    if (f.ghost && !f.comfort) { const n = Math.floor(f.time * 30); if (hash1(n * 3 + 1) > 0.72) shake = (hash1(n) - 0.5) * 0.22; }
    offX += shake;

    build();
    posed = true;

    // ---- drawing levels
    spineK = 1.5 + 1.1 * f.kick;
    ribbonGain += ((ign ? 0 : 1) - ribbonGain) * Math.min(1, dt * (ign ? 20 : 9));
    echoK = airA >= 0 ? 0 : clamp01(0.75 * smoothstep(2.8, 5, f.gearF) + 0.8 * boost * (ign ? 0 : 1) + 0.4 * Math.exp(-gearT * 4));
    lanceK = rt >= 0 && rt < 0.24 ? Math.pow(1 - rt / 0.24, 1.4) : 0;
    lanceL = rt >= 0 ? 0.9 + 2.3 * (1 - Math.exp(-rt * 60)) : 0;

    // ---- histories (tube frame), one sample per ~1/75 s
    if (clock - lastPush >= 1 / 76) {
      lastPush = clock;
      const rx = f.upY, ry = -f.upX;
      // A roll moves the blades a whole lane in two or three frames. Fill the gap with samples
      // interpolated around the tube axis so the ribbon whips in an arc instead of a chord.
      const j0 = BL0, wx = f.runnerX + rx * BX[j0] + f.upX * BY[j0], wy = f.runnerY + ry * BX[j0] + f.upY * BY[j0];
      let sub = 1;
      if (rCount > 0) {
        const d = Math.abs(wx - rX[rHead]) + Math.abs(wy - rY[rHead]);
        sub = d > 2.4 ? 4 : d > 1.2 ? 3 : d > 0.5 ? 2 : 1;
      }
      const prev = rHead, tPrev = rT[prev];
      for (let q = 1; q <= sub; q++) {
        const u = q / sub;
        rHead = (rHead + 1) % RN; if (rCount < RN) rCount++;
        for (let sd = 0; sd < 2; sd++) {
          const j = BL0 + sd * 2, o = sd * RN + rHead, po = sd * RN + prev;
          const x = f.runnerX + rx * BX[j] + f.upX * BY[j], y = f.runnerY + ry * BX[j] + f.upY * BY[j];
          if (u < 1) {
            // interpolate angle and radius about the axis
            const a0 = Math.atan2(rX[po], -rY[po]), r0 = Math.sqrt(rX[po] * rX[po] + rY[po] * rY[po]);
            let da = Math.atan2(x, -y) - a0; if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
            const r1 = Math.sqrt(x * x + y * y), a = a0 + da * u, r = lerp(r0, r1, u);
            if (Math.abs(da) < 1.2 && r0 > 2 && r1 > 2) { rX[o] = Math.sin(a) * r; rY[o] = -Math.cos(a) * r; }
            else { rX[o] = lerp(rX[po], x, u); rY[o] = lerp(rY[po], y, u); }
            rZ[o] = lerp(rZ[po], BZ[j], u);
          } else { rX[o] = x; rY[o] = y; rZ[o] = BZ[j]; }
        }
        rT[rHead] = lerp(tPrev, clock, u);
      }
      hHead = (hHead + 1) % HN; if (hCount < HN) hCount++;
      for (let sd = 0; sd < 2; sd++) {
        const j = HL + sd, o = sd * HN + hHead;
        hX[o] = f.runnerX + rx * BX[j] + f.upX * BY[j]; hY[o] = f.runnerY + ry * BX[j] + f.upY * BY[j]; hZ[o] = BZ[j];
      }
      hT[hHead] = clock;
    }
  }

  // ------------------------------------------------------------------ draw
  let rimK = 1, rimPx = 2, innerK = 0.3, goldK = 0;

  // capsule c of the table, in screen space: mode 0 = bright rim, 1 = dim inner contour, 2 = dark fill
  function cap(c, mode) {
    const o = c * 6, a = CAPS[o], b = CAPS[o + 1], t0 = CAPS[o + 2], t1 = CAPS[o + 3];
    const dx = SX[b] - SX[a], dy = SY[b] - SY[a];
    const x0 = SX[a] + dx * t0, y0 = SY[a] + dy * t0, x1 = SX[a] + dx * t1, y1 = SY[a] + dy * t1;
    const w = CAPS[o + 4] * (SS[a] + SS[b]) * 0.5 * G;
    if (mode === 0) gfx.line(x0, y0, x1, y1, w + rimPx * 2, rimCol, rimK, 1.9, 1);
    else if (mode === 1) gfx.line(x0, y0, x1, y1, w + rimPx * 1.1, rimCol, innerK, 1.5, 0);
    else gfx.line(x0, y0, x1, y1, w, fillCol, 1, 1.4, 1);
  }
  function accent(a, b, w, col, k, glow) {
    const s = (SS[a] + SS[b]) * 0.5 * G;
    gfx.line(SX[a], SY[a], SX[b], SY[b], w * s, col, k, glow, 0);
  }

  function drawRibbons(f, g, fade) {
    if (rCount < 2 || ribbonGain < 0.01) return;
    const boost = Math.exp(-launchT * 2.2), air = airA >= 0 || landT < 0.5 ? 1 : 0;
    const life = 0.4 + 0.045 * f.gearF + 0.12 * air + 0.1 * boost;
    const len = 4.6 + 0.75 * f.gearF, v = len / life;
    const k0 = (1.25 + 0.3 * f.gearF + 1.6 * boost + 0.5 * f.kick * g + 1.2 * Math.exp(-flashT * 14)) * ribbonGain * fade;
    const w0 = (0.05 + 0.004 * f.gearF + 0.03 * boost) * G;
    const rx = f.upY, ry = -f.upX;
    for (let s = 0; s < 2; s++) {
      const j = BL0 + s * 2;
      let px = f.runnerX + rx * BX[j] + f.upX * BY[j], py = f.runnerY + ry * BX[j] + f.upY * BY[j], pz = BZ[j], pu = 0;
      for (let n = 0; n < rCount; n++) {
        const i = (rHead - n + RN) % RN, age = clock - rT[i];
        if (age > life) break;
        const u = age / life, o = s * RN + i;
        const x = rX[o], y = rY[o], z = rZ[o] - age * v;
        const um = (u + pu) * 0.5, kk = k0 * (1 - um) * (1 - um), w = w0 * (1 - 0.8 * um * um);
        cam.line(px, py, pz, x, y, z, w, C.you, kk, 5);
        if (um < 0.7) cam.line(px, py, pz, x, y, z, w * 0.3, C.white, kk * 0.8 * (1 - um / 0.7), 3);
        px = x; py = y; pz = z; pu = u;
      }
    }
  }

  // Glove streaks: in the top gears (and in the air, and off the line) the hands smear light.
  function drawStreaks(f, fade) {
    if (echoK < 0.03 || hCount < 3) return;
    const life = 0.15, rx = f.upY, ry = -f.upX;
    for (let sd = 0; sd < 2; sd++) {
      const j = HL + sd;
      let px = f.runnerX + rx * BX[j] + f.upX * BY[j], py = f.runnerY + ry * BX[j] + f.upY * BY[j], pz = BZ[j], pu = 0;
      for (let n = 0; n < hCount; n++) {
        const i = (hHead - n + HN) % HN, age = clock - hT[i];
        if (age > life) break;
        const u = age / life, o = sd * HN + i, x = hX[o], y = hY[o], z = hZ[o] - age * 9;
        const um = (u + pu) * 0.5, kk = echoK * fade * 1.3 * (1 - um) * (1 - um);
        // a roll teleports the hand a lane sideways: break the streak there instead of drawing a chord
        if (Math.abs(x - px) + Math.abs(y - py) < 0.7) cam.line(px, py, pz, x, y, z, 0.05 * G * (1 - 0.6 * um), C.you, kk, 4);
        px = x; py = y; pz = z; pu = u;
      }
    }
  }

  // Yellow-white lance: the body-attached part of the breach (the bolt down the lane is vfx).
  // A spear from the fist and a prow of light swept back past both shoulders, so from behind the
  // courier is the tip of an arrowhead.
  function drawLance(f, fade) {
    if (lanceK <= 0.01) return;
    const rx = f.upY, ry = -f.upX;
    const hx = BX[HR], hy = BY[HR], hz = BZ[HR];
    const x = f.runnerX + rx * hx + f.upX * hy, y = f.runnerY + ry * hx + f.upY * hy;
    const k = lanceK * fade, L = lanceL * G, tz = hz + L;
    cam.glow(x, y, hz + 0.15, 0.4 * G, C.ice, 1.3 * k, 2.2);
    cam.line(x, y, hz, x, y, tz, 0.17 * G, C.ice, 2.1 * k, 5);
    cam.line(x, y, hz - 0.05, x, y, tz + 0.5 * L, 0.06 * G, C.iceHot, 3.2 * k, 3);
    const wy = hy - 0.42 * G, wz = BZ[PEL] - 0.3 * G, wr = (0.75 + 0.25 * (1 - lanceK)) * G;
    for (let s = -1; s <= 1; s += 2) {
      const wx = BX[PEL] + s * wr;
      const ex = f.runnerX + rx * wx + f.upX * wy, ey = f.runnerY + ry * wx + f.upY * wy;
      cam.line(x, y, tz, ex, ey, wz, 0.085 * G, C.ice, 1.9 * k, 5);
      cam.line(x, y, tz, lerp(x, ex, 0.45), lerp(y, ey, 0.45), lerp(tz, wz, 0.45), 0.03 * G, C.iceHot, 2.4 * k, 3);
    }
  }

  // The lane is polished mag-rail: the figure's rim mirrors in it, strongest at the boots and gone
  // by the hips. It pins the feet to the deck and costs one additive line per limb.
  function drawReflection(f, fade) {
    const kr = 0.42 * fade * (1 - wAir) * (1 - wIgn * 0.3);
    if (kr < 0.01) return;
    const rx = f.upY, ry = -f.upX;
    for (let c = 0; c < NCAP_BASE; c++) {
      const a = CAPS[c * 6], b = CAPS[c * 6 + 1];
      const h = (BY[a] + BY[b]) * 0.5 / G, t = 1 - h / 0.62;
      if (t <= 0.02) continue;
      if (!cam.project(f.runnerX + rx * BX[a] - f.upX * BY[a], f.runnerY + ry * BX[a] - f.upY * BY[a], BZ[a])) continue;
      const ax = cam.sx, ay = cam.sy, as = cam.s;
      if (!cam.project(f.runnerX + rx * BX[b] - f.upX * BY[b], f.runnerY + ry * BX[b] - f.upY * BY[b], BZ[b])) continue;
      gfx.line(ax, ay, cam.sx, cam.sy, CAPS[c * 6 + 4] * (as + cam.s) * 0.5 * G * 0.5, C.you, kr * t * t, 3, 0);
    }
  }

  // The bite of each push: on the beat the driving blade throws a few sparks out and back.
  function drawKick(f, g, fade) {
    const b0 = Math.floor(f.beat), p = f.beat - b0, T = 0.2;
    const w = (1 - wAir) * (1 - wIgn) * (1 - wGrind) * (1 - Math.min(1, wHit)) * fade;
    if (p >= T || w < 0.05 || f.dead) return;
    const sd = b0 & 1, sg = sd ? 1 : -1, j = BL0 + sd * 2, u = p / T, e = u * (2 - u);
    const rx = f.upY, ry = -f.upX, k = (1.5 + 1.2 * g) * (1 - u) * (1 - u) * w;
    for (let i = 0; i < 5; i++) {
      const h = hash1(b0 * 13 + i * 7), h2 = hash1(b0 * 29 + i * 3 + 1);
      const dx = sg * (0.25 + 0.95 * h), dy = 0.05 + 0.95 * h2 * h2, dz = -(0.3 + 1.6 * hash1(b0 + i * 11));
      const d1 = e * (0.3 + 0.4 * h2) * G, d0 = Math.max(0, d1 - (0.12 + 0.14 * h) * (1 - u * 0.5) * G);
      const x0 = BX[j] + dx * d0, y0 = BY[j] + dy * d0 - 0.25 * u * u, x1 = BX[j] + dx * d1, y1 = BY[j] + dy * d1 - 0.25 * u * u;
      cam.line(f.runnerX + rx * x0 + f.upX * y0, f.runnerY + ry * x0 + f.upY * y0, BZ[j] + dz * d0,
        f.runnerX + rx * x1 + f.upX * y1, f.runnerY + ry * x1 + f.upY * y1, BZ[j] + dz * d1, 0.022 * G, i & 1 ? C.white : C.you, k, 4);
    }
  }

  // A ring lying on the lane around the feet (world space, so it sits in perspective).
  function floorRing(f, radius, width, col, k) {
    const rx = f.upY, ry = -f.upX, cx = f.runnerX + rx * BX[PEL] * 0.5, cy = f.runnerY + ry * BX[PEL] * 0.5, cz = offZ * 0.5;
    let px = cx + rx * radius, py = cy + ry * radius, pz = cz;
    for (let i = 1; i <= 20; i++) {
      const a = (i / 20) * Math.PI * 2, c = Math.cos(a) * radius, z = cz + Math.sin(a) * radius;
      const x = cx + rx * c, y = cy + ry * c;
      cam.line(px, py, pz, x, y, z, width, col, k, 4);
      px = x; py = y; pz = z;
    }
  }

  // Nova behind the camera: its light washes up the lane and the runner throws a long shadow into it.
  // The wash is faint (it must never compete with a telegraph stripe); the shadow is the shape.
  function drawNovaShadow(f, fade) {
    const d = smoothstep(0.2, 0.85, f.danger) * (1 - wAir) * fade;
    if (d < 0.01) return;
    const rx = f.upY, ry = -f.upX, L = 9 + 12 * d, z0 = -0.6, z1 = z0 + L;
    const fx = f.runnerX + rx * BX[PEL] * 0.6, fy = f.runnerY + ry * BX[PEL] * 0.6;
    const flick = 0.82 + 0.18 * Math.sin(f.time * 11) * Math.sin(f.time * 7.3);
    const kg = 0.26 * d * flick, w0 = 0.3 * G, w1 = 0.62 * G, e = 2.0, zn = -3, zm = 0.4, wm = lerp(w0, w1, (zm - z0) / L);
    for (let s = -1; s <= 1; s += 2) {
      // light spilling either side of the shadow: brightest beside the feet, gone by the lane edge
      if (!cam.project(fx + rx * s * w0, fy + ry * s * w0, zn)) return;
      const ax = cam.sx, ay = cam.sy;
      cam.project(fx + rx * s * e, fy + ry * s * e, zn); const bx = cam.sx, by = cam.sy;
      cam.project(fx + rx * s * e, fy + ry * s * e, zm); const cx = cam.sx, cy = cam.sy;
      cam.project(fx + rx * s * wm, fy + ry * s * wm, zm); const dx = cam.sx, dy = cam.sy;
      cam.project(fx + rx * s * e, fy + ry * s * e, z1); const ex = cam.sx, ey = cam.sy;
      cam.project(fx + rx * s * w1, fy + ry * s * w1, z1); const gx = cam.sx, gy = cam.sy;
      // both quads fan out from the lit corner beside the feet, so the falloff has no crease
      gfx.quadK(dx, dy, kg, ax, ay, 0, bx, by, 0, cx, cy, 0, goldCol, 0);
      gfx.quadK(dx, dy, kg, cx, cy, 0, ex, ey, 0, gx, gy, kg * 0.3, goldCol, 0);
    }
    cam.project(fx - rx * w0, fy - ry * w0, 0.1); const ax = cam.sx, ay = cam.sy;
    cam.project(fx + rx * w0, fy + ry * w0, 0.1); const bx = cam.sx, by = cam.sy;
    cam.project(fx + rx * w1, fy + ry * w1, z1); const cx = cam.sx, cy = cam.sy;
    cam.project(fx - rx * w1, fy - ry * w1, z1); const dx = cam.sx, dy = cam.sy;
    gfx.quadGrad(ax, ay, bx, by, cx, cy, dx, dy, BLACK, 0, 0.42 * d, BLACK, 0, 0);
  }

  function drawGroup(gid, f) {
    // inner contour (dim, additive) then the dark fill
    for (let c = 0; c < NCAP; c++) if (CAPS[c * 6 + 5] === gid) cap(c, 1);
    for (let d = 0; d < NDSC; d++) if (DSC[d * 2 + 1] === gid) { const j = DSC[d * 2]; gfx.disc(SX[j], SY[j], DSCR[d] * SS[j] * G + rimPx * 0.55, rimCol, innerK, 0); }
    if (gid === G_TORSO) gfx.quad(SX[SL], SY[SL], SX[SR], SY[SR], SX[HIR], SY[HIR], SX[HIL], SY[HIL], fillCol, 1, 1);
    for (let c = 0; c < NCAP; c++) if (CAPS[c * 6 + 5] === gid) cap(c, 2);
    for (let d = 0; d < NDSC; d++) if (DSC[d * 2 + 1] === gid) { const j = DSC[d * 2]; gfx.disc(SX[j], SY[j], DSCR[d] * SS[j] * G, fillCol, 1, 1); }
    // nova light: hot spots where the helmet, shoulders and knees catch it
    if (goldK > 0.01) {
      for (let d = 0; d < NDSC; d++) if (DSC[d * 2 + 1] === gid) { const j = DSC[d * 2]; gfx.glow(SX[j], SY[j] + DSCR[d] * SS[j] * G * 0.15, DSCR[d] * SS[j] * G * 0.85, C.nova1, goldK, 1.6); }
    }
    // accents
    if (gid === G_HEAD) {
      for (let i = 0; i < 4; i++) if (vis[i] > 0.02) {
        accent(V0 + i, V0 + i + 1, 0.05, C.you, 1.6 * vis[i], 4);
        accent(V0 + i, V0 + i + 1, 0.022, C.white, 2.6 * vis[i], 3);
      }
      if (backVis > 0.05) {
        accent(HC, HT, 0.026, C.you, 1.5 * backVis, 4);
        accent(HC, HT, 0.011, C.white, 1.6 * backVis, 3);
      }
      // key light: the crown of the helmet burns white
      const ang = Math.atan2(SY[HD] - SY[CH], SX[HD] - SX[CH]);
      gfx.arc(SX[HD], SY[HD], HEAD_R * SS[HD] * G + rimPx * 0.5, ang - 0.95, ang + 0.95, rimPx * 0.9, C.white, 1.25, 3);
    } else if (gid === G_TORSO) {
      // key light along the top of the shoulders
      let nx = SX[CH] - SX[WA], ny = SY[CH] - SY[WA];
      const nl = Math.sqrt(nx * nx + ny * ny) || 1, off = 0.085 * SS[CH] * G + rimPx * 0.5;
      nx = (nx / nl) * off; ny = (ny / nl) * off;
      gfx.line(lerp(SX[SL], SX[SR], 0.08) + nx, lerp(SY[SL], SY[SR], 0.08) + ny, lerp(SX[SL], SX[SR], 0.92) + nx, lerp(SY[SL], SY[SR], 0.92) + ny, rimPx * 0.9, C.white, 1.1 * clamp01(1.25 - Math.abs(P[YAW]) * 1.4), 3, 0);
      if (backVis > 0.02) {
        accent(SP0, SP1, 0.028, C.you, spineK * backVis, 5);
        accent(SP0, SP1, 0.013, C.white, spineK * 1.3 * backVis, 3);
      }
    } else if (gid === G_PACK) {
      if (backVis > 0.02) {
        // the tube's status light: a hot cap at the shoulder end and a thin strip down its length
        const dx = SX[PK1] - SX[PK0], dy = SY[PK1] - SY[PK0], s = SS[PK0] * G;
        gfx.line(SX[PK0] + dx * 0.2, SY[PK0] + dy * 0.2, SX[PK0] + dx * 0.86, SY[PK0] + dy * 0.86, 0.018 * s, C.you, 1.1 * backVis, 4, 0);
        gfx.line(SX[PK0] - dx * 0.02, SY[PK0] - dy * 0.02, SX[PK0] + dx * 0.1, SY[PK0] + dy * 0.1, 0.05 * s, hotCol, (1.8 + 1.4 * f.kick) * backVis, 4, 0);
      }
    } else if (gid === G_FAL || gid === G_FAR) {
      const j = gid === G_FAL ? HL : HR;
      gfx.glow(SX[j], SY[j], 0.06 * SS[j] * G, C.you, 0.9, 2.5);
    } else if (gid === G_UAL || gid === G_UAR) {
      const j = gid === G_UAL ? SL : SR;
      if (backVis > 0.05) gfx.glow(SX[j], SY[j] - 0.02 * SS[j] * G, 0.04 * SS[j] * G, hotCol, 1.4 * backVis, 2.5);
    } else if (gid === G_SHL || gid === G_SHR) {
      const s = gid === G_SHL ? 0 : 1, cv = clamp01(Math.cos(spin) * 1.5 + 0.2);
      if (cv > 0.02) accent(CL0 + s * 2, CL0 + s * 2 + 1, 0.024, C.you, 1.5 * cv, 4);
    }
  }

  function draw(f) {
    if (!posed || f.mode === 'results') return;
    let fade = 1;
    if (f.dead) { fade = 1 - f.deadT / 0.3; if (fade <= 0) return; }
    const g = clamp01((f.gearF - 1) / 4);
    const rx = f.upY, ry = -f.upX;
    for (let i = 0; i < NJ; i++) {
      if (!cam.project(f.runnerX + rx * BX[i] + f.upX * BY[i], f.runnerY + ry * BX[i] + f.upY * BY[i], BZ[i])) return;
      SX[i] = cam.sx; SY[i] = cam.sy; SS[i] = cam.s;
    }
    const s0 = SS[PEL] * G;
    const flash = flashT < 0.14 ? flashAmp * (1 - flashT / 0.14) : 0;
    const pulse = Math.exp(-gearT * 5) * 0.8 + Math.exp(-launchT * 5) * 0.8;
    mixColor(C.you, C.white, clamp01(flash + pulse * 0.4), rimCol);
    mixColor(C.you, C.white, 0.75, hotCol);
    rimK = 1.45 + 0.3 * f.kick + 0.25 * g + 0.9 * flash + pulse + wIgn * (0.2 * charge + 0.8 * Math.exp(-pipT * 8)) * 0.5;
    rimPx = Math.max(1.5, 0.03 * s0);
    innerK = 0.34;
    goldK = smoothstep(0.2, 0.85, f.danger) * (0.42 + 0.1 * Math.sin(f.time * 11)) * clamp01(backVis + 0.3);
    mixColor(FILL, BRONZE, smoothstep(0.15, 0.85, f.danger) * (0.85 + 0.15 * Math.sin(f.time * 11)), fillCol);
    mixColor(C.nova0, C.nova1, 0.55, goldCol);

    gfx.push();
    // ghost flicker: the whole figure drops to a see-through hologram and strobes
    let bodyFade = fade;
    // (comfort mode: a steady hologram, no strobe)
    if (f.ghost) { const n = Math.floor(f.time * 24); bodyFade *= f.comfort ? 0.45 : hash1(n * 5 + 2) > 0.45 ? 0.62 : 0.2; }

    drawNovaShadow(f, fade);
    // ---- light pooled under the blades (the mag field), kept low and behind the feet
    const grounded = 1 - wAir;
    const chg = wIgn * (charge / 3);
    for (let s = 0; s < 2; s++) {
      const a = BL0 + s * 2, b = a + 1, mx = (SX[a] + SX[b]) * 0.5, my = (SY[a] + SY[b]) * 0.5;
      const lifted = clamp01(1 - (BY[AL + s] / G - ANKLE) * 7);
      const kk = (0.3 + 0.12 * g + 0.25 * f.kick * lifted + 1.3 * chg + 0.9 * wIgn * Math.exp(-pipT * 7)) * fade * (0.35 + 0.65 * lifted * grounded);
      gfx.glowEllipse(mx, my + 0.02 * s0, (0.5 + 0.35 * chg) * s0, (0.16 + 0.12 * chg) * s0, C.you, kk, 2);
      if (chg > 0.01) gfx.glow(mx, my, (0.14 + 0.3 * chg) * s0, C.white, (1.4 + 0.8 * Math.exp(-pipT * 6)) * chg * fade, 2.2);
    }
    if (wIgn > 0.01 && pipT < 0.42) {
      // each pip: a ring of charge collapsing onto the blades
      const u = pipT / 0.42;
      floorRing(f, lerp(1.9, 0.25, u * (2 - u)) * G, 0.035, C.you, 2 * u * wIgn * fade);
    }
    if (launchT < 0.34) {
      const u = launchT / 0.34, e = u * (2 - u);
      floorRing(f, lerp(0.4, 3.4, e) * G, 0.09 * (1 - u) + 0.01, C.white, 2.6 * (1 - u) * (1 - u) * fade);
      floorRing(f, lerp(0.3, 2.2, e) * G, 0.05 * (1 - u) + 0.01, C.you, 2 * (1 - u) * fade);
    }

    drawReflection(f, fade);
    drawKick(f, g, fade);
    drawRibbons(f, g, fade);
    drawStreaks(f, fade * (f.ghost ? 0.4 : 1));
    drawLance(f, fade);

    gfx.mulFade(bodyFade);
    // ---- pass 1: every rim. Pass 2 hides whatever is inside the silhouette.
    for (let c = 0; c < NCAP; c++) cap(c, 0);
    for (let d = 0; d < NDSC; d++) { const j = DSC[d * 2]; gfx.disc(SX[j], SY[j], DSCR[d] * SS[j] * G + rimPx, rimCol, rimK * 1.25, 1); }
    // ---- pass 2: dark parts, far to near
    for (let i = 0; i < NG; i++) { order[i] = i; key[i] = (BZ[GKEY[i * 2]] + BZ[GKEY[i * 2 + 1]]) * 0.5; }
    key[G_PACK] -= 0.06 * (backVis * 2 - 1);   // the tube rides on the back: nearer than the torso whenever the back shows
    for (let i = 1; i < NG; i++) {
      const o = order[i], kv = key[o]; let j = i - 1;
      while (j >= 0 && key[order[j]] < kv) { order[j + 1] = order[j]; j--; }
      order[j + 1] = o;
    }
    for (let i = 0; i < NG; i++) drawGroup(order[i], f);
    // ---- blades: white-hot edges under the boots
    const scrape = wGrind * (0.6 + 0.4 * hash1(Math.floor(f.time * 45)));
    for (let s = 0; s < 2; s++) {
      const a = BL0 + s * 2, b = a + 1;
      const hot = 1 + 1.2 * chg + 0.8 * scrape + 0.5 * Math.exp(-launchT * 5) + flash;
      accent(a, b, 0.05, C.you, 2 * hot, 5);
      accent(a, b, 0.02, C.white, 2.6 * hot, 3);
    }
    gfx.pop();
  }

  return { onEvent, update, draw };
}
