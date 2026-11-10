// game/tube.js — draws the play tube itself: eight rails, octagon ribs, the strike ring at the
// runner's depth and the runner's lane guide. Hazards are drawn by hazards.js on top of this.
import { LANES, APOTHEM, VERTEX_R, LANE_ANGLE, RIB_SPACING, C } from './config.js';
import { clamp, lerp, mixColor } from '../engine/math.js';

const col = [0, 0, 0], col2 = [0, 0, 0];
const VX = new Float32Array(LANES), VY = new Float32Array(LANES);
for (let i = 0; i < LANES; i++) {
  // octagon corners sit between lanes: corner i is the boundary between lane i-1 and lane i
  const a = (i - 0.5) * LANE_ANGLE;
  VX[i] = Math.sin(a) * VERTEX_R; VY[i] = -Math.cos(a) * VERTEX_R;
}

// Structure color for the current gear (the blueshift ramp), written into `out`.
export function gearColor(gearF, out) {
  const g = clamp(gearF, 1, 5), i = Math.floor(g), f = g - i;
  return mixColor(C.gear[i], C.gear[Math.min(5, i + 1)], f, out);
}

// farZ: nothing of the tube is drawn beyond it (a closed shutter seals the tunnel there).
export function drawTube(gfx, cam, frame, farZ = Infinity) {
  gearColor(frame.gearF, col);
  const kick = frame.kick;
  const FAR = Math.min(640, farZ);
  const scroll = frame.dist % RIB_SPACING;
  // ---- ribs (far to near), with LOD: every rib near, every 2nd/4th far away
  const n = Math.ceil(FAR / RIB_SPACING);
  const ribIndex0 = Math.floor(frame.dist / RIB_SPACING);
  for (let k = n; k >= -1; k--) {
    const z = k * RIB_SPACING - scroll;
    if (z < -7.4 || z > FAR) continue;
    const idx = ribIndex0 + k;
    if (z > 320 && (idx & 3) !== 0) continue;
    if (z > 150 && (idx & 1) !== 0) continue;
    // every 4th rib is a stronger "bar line"; all ribs breathe with the kick
    const strong = (idx & 3) === 0;
    const kk = (strong ? 0.42 : 0.2) * (1 + kick * 0.9);
    const w = strong ? 0.09 : 0.06;
    for (let i = 0; i < LANES; i++) {
      const j = (i + 1) % LANES;
      cam.line(VX[i], VY[i], z, VX[j], VY[j], z, w, col, kk, 4);
    }
  }
  // ---- rails along the corners
  for (let i = 0; i < LANES; i++) {
    let z0 = -7.4;
    while (z0 < FAR) {
      const seg = z0 < 80 ? 8 : z0 < 240 ? 16 : 40;
      const z1 = Math.min(FAR, z0 + seg);
      cam.line(VX[i], VY[i], z0, VX[i], VY[i], z1, 0.08, col, 0.5, 4);
      z0 = z1;
    }
  }
}

// The strike ring: the rib at the runner's depth. Hazards land exactly here.
export function drawStrikeRing(gfx, cam, frame) {
  mixColor(C.you, C.white, 0.2, col2);
  const k = 0.55 + frame.kick * 0.5;
  for (let i = 0; i < LANES; i++) {
    const j = (i + 1) % LANES;
    cam.line(VX[i], VY[i], 0, VX[j], VY[j], 0, 0.1, col2, k, 4);
  }
}

export { VX as CORNER_X, VY as CORNER_Y };
