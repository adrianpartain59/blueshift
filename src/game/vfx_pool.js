// game/vfx_pool.js — private helper of vfx.js: a pooled 3D particle system in the TUBE FRAME
// (x right, y up, +z ahead of the runner), drawn through cam3d so debris really flies at the lens.
// The engine's particle system is 2D; shards that rake past the camera need depth.
// Struct-of-arrays, swap-remove, zero allocation after construction.
import { makeRng } from '../engine/math.js';

export const P_SPARK = 0;      // velocity-stretched streak
export const P_HEX = 1;        // tumbling hexagon cell of ICE (outline + faint glass fill)
export const P_TRI = 2;        // tumbling triangular fragment
export const P_SPLINTER = 3;   // tumbling sliver (one line)
export const P_GLOW = 4;       // soft camera-facing dot

const HC = new Float32Array(6), HS = new Float32Array(6);
for (let i = 0; i < 6; i++) { HC[i] = Math.cos((i * Math.PI) / 3); HS[i] = Math.sin((i * Math.PI) / 3); }
const TRI_A = [0, 2.25, 4.15];

export function createPool3(max, seed) {
  const F = () => new Float32Array(max);
  const x = F(), y = F(), z = F(), vx = F(), vy = F(), vz = F(), ax = F(), ay = F();
  const life = F(), maxLife = F(), size = F(), k0 = F(), cr = F(), cg = F(), cb = F();
  const drag = F(), rest = F(), rotA = F(), rotB = F(), spinA = F(), spinB = F(), shape = F(), w = F(), streak = F();
  const kind = new Uint8Array(max);
  let count = 0;
  const rng = makeRng(seed);
  const col = [0, 0, 0];
  const PX = new Float32Array(6), PY = new Float32Array(6), PZ = new Float32Array(6);

  function copy(i, l) {
    x[i] = x[l]; y[i] = y[l]; z[i] = z[l]; vx[i] = vx[l]; vy[i] = vy[l]; vz[i] = vz[l]; ax[i] = ax[l]; ay[i] = ay[l];
    life[i] = life[l]; maxLife[i] = maxLife[l]; size[i] = size[l]; k0[i] = k0[l]; cr[i] = cr[l]; cg[i] = cg[l]; cb[i] = cb[l];
    drag[i] = drag[l]; rest[i] = rest[l]; rotA[i] = rotA[l]; rotB[i] = rotB[l]; spinA[i] = spinA[l]; spinB[i] = spinB[l];
    shape[i] = shape[l]; w[i] = w[l]; streak[i] = streak[l]; kind[i] = kind[l];
  }

  const pool = {
    rng,
    // extra per-particle fields a caller may set right after add(): pool.drag[i] = ...
    drag, rest, ax, ay, rotA, rotB, spinA, spinB, shape, w, streak, vz, z,
    get count() { return count; },
    clear() { count = 0; },

    // Returns the slot index so the caller can set the optional fields.
    add(kd, px, py, pz, pvx, pvy, pvz, lf, sz, c, k) {
      const i = count < max ? count++ : Math.floor(rng() * max);
      kind[i] = kd; x[i] = px; y[i] = py; z[i] = pz; vx[i] = pvx; vy[i] = pvy; vz[i] = pvz; ax[i] = 0; ay[i] = 0;
      life[i] = maxLife[i] = lf; size[i] = sz; k0[i] = k; cr[i] = c[0]; cg[i] = c[1]; cb[i] = c[2];
      drag[i] = 0; rest[i] = 0; rotA[i] = rng() * 6.283; rotB[i] = rng() * 6.283; spinA[i] = 0; spinB[i] = 0;
      shape[i] = rng(); w[i] = 0.045; streak[i] = 0.035;
      return i;
    },

    // killZ: anything that has fallen behind the camera is recycled.
    update(dt, killZ) {
      for (let i = 0; i < count; i++) {
        life[i] -= dt;
        if (life[i] <= 0 || z[i] < killZ) {
          const l = --count;
          if (i !== l) copy(i, l);
          i--; continue;
        }
        const d = drag[i];
        if (d > 0) { const f = Math.exp(-d * dt); vx[i] *= f; vy[i] *= f; vz[i] = rest[i] + (vz[i] - rest[i]) * f; }
        vx[i] += ax[i] * dt; vy[i] += ay[i] * dt;
        x[i] += vx[i] * dt; y[i] += vy[i] * dt; z[i] += vz[i] * dt;
        rotA[i] += spinA[i] * dt; rotB[i] += spinB[i] * dt;
      }
    },

    draw(cam, camZ) {
      for (let i = 0; i < count; i++) {
        const t = 1 - life[i] / maxLife[i];
        const fade = t > 0.6 ? (1 - t) / 0.4 : 1;
        const k = k0[i] * fade;
        if (k < 0.004) continue;
        col[0] = cr[i]; col[1] = cg[i]; col[2] = cb[i];
        const X = x[i], Y = y[i], Z = z[i], kd = kind[i];
        if (kd === P_SPARK) {
          // a spark about to hit the lens would be a fat white bar: let it die a couple of metres out
          const st = streak[i], near = (Z - camZ - 0.8) * 0.4;
          if (near <= 0) continue;
          cam.line(X, Y, Z, X - vx[i] * st, Y - vy[i] * st, Z - vz[i] * st, w[i], col, near < 1 ? k * near : k, 3);
        } else if (kd === P_GLOW) {
          cam.glow(X, Y, Z, size[i] * (1 - t * 0.6), col, k, 2);
        } else {
          const s = size[i];
          if (Z + s < camZ + 0.4) continue;
          const ca = Math.cos(rotA[i]), sa = Math.sin(rotA[i]), cb2 = Math.cos(rotB[i]), sb = Math.sin(rotB[i]);
          const ux = ca * s, uy = sa * s;                       // in-plane axis
          const wx = -sa * cb2 * s, wy = ca * cb2 * s, wz = sb * s; // tilted axis (the tumble)
          let glint = cb2 * cb2; glint = glint * glint * glint; // face-on to the lens: the glass catches the light
          const age = maxLife[i] - life[i];
          const ke = k * (0.62 + 0.95 * glint) * (age < 0.1 ? 0.6 + age * 4 : 1);
          if (kd === P_SPLINTER) {
            cam.line(X - wx, Y - wy, Z - wz, X + wx, Y + wy, Z + wz, w[i] * 1.4, col, ke, 3);
            continue;
          }
          // a shard about to hit the lens would flood the frame with fill: fade the pane out up close
          const near = (Z - camZ) * 0.4;
          // (and the pane is dark on the impact frame: a wall that just cracked is all edges)
          const kf = k * (0.035 + 0.42 * glint) * (near < 1 ? (near < 0 ? 0 : near) : 1) * (age < 0.12 ? 0.15 + age * 7 : 1);
          const lw = w[i];
          if (kd === P_HEX) {
            for (let j = 0; j < 6; j++) { PX[j] = X + ux * HC[j] + wx * HS[j]; PY[j] = Y + uy * HC[j] + wy * HS[j]; PZ[j] = Z + wz * HS[j]; }
            if (kf > 0.01) {
              cam.quad(PX[0], PY[0], PZ[0], PX[1], PY[1], PZ[1], PX[2], PY[2], PZ[2], PX[3], PY[3], PZ[3], col, kf, 0);
              cam.quad(PX[0], PY[0], PZ[0], PX[3], PY[3], PZ[3], PX[4], PY[4], PZ[4], PX[5], PY[5], PZ[5], col, kf, 0);
            }
            for (let j = 0; j < 6; j++) { const n = j === 5 ? 0 : j + 1; cam.line(PX[j], PY[j], PZ[j], PX[n], PY[n], PZ[n], lw, col, ke, 3); }
          } else {
            const sh = shape[i];
            for (let j = 0; j < 3; j++) {
              const a = TRI_A[j] + sh * 0.6, r = j === 0 ? 1 : j === 1 ? 0.55 + 0.6 * sh : 1.2 - 0.6 * sh;
              const c = Math.cos(a) * r, sn = Math.sin(a) * r;
              PX[j] = X + ux * c + wx * sn; PY[j] = Y + uy * c + wy * sn; PZ[j] = Z + wz * sn;
            }
            if (kf > 0.01) cam.quad(PX[0], PY[0], PZ[0], PX[1], PY[1], PZ[1], PX[2], PY[2], PZ[2], PX[2], PY[2], PZ[2], col, kf, 0);
            cam.line(PX[0], PY[0], PZ[0], PX[1], PY[1], PZ[1], lw, col, ke, 3);
            cam.line(PX[1], PY[1], PZ[1], PX[2], PY[2], PZ[2], lw, col, ke, 3);
            cam.line(PX[2], PY[2], PZ[2], PX[0], PY[0], PZ[0], lw, col, ke, 3);
          }
        }
      }
    },
  };
  return pool;
}
