// engine/particles.js — pooled particle system (struct-of-arrays, zero allocation per particle),
// rendered through the gfx batch. World-space; draw it inside whatever transform the world uses.
//
// Types: 0 GLOW (soft dot), 1 SPARK (velocity-stretched streak), 2 RING (expanding outline),
//        3 SHARD (spinning line fragment), 4 SQUARE (spinning solid pixel)

export const P_GLOW = 0;
export const P_SPARK = 1;
export const P_RING = 2;
export const P_SHARD = 3;
export const P_SQUARE = 4;

export function createParticles(max = 4096) {
  const x = new Float32Array(max), y = new Float32Array(max), vx = new Float32Array(max), vy = new Float32Array(max);
  const life = new Float32Array(max), maxLife = new Float32Array(max);
  const size0 = new Float32Array(max), size1 = new Float32Array(max), k0 = new Float32Array(max);
  const cr = new Float32Array(max), cg = new Float32Array(max), cb = new Float32Array(max);
  const drag = new Float32Array(max), gx = new Float32Array(max), gy = new Float32Array(max);
  const rot = new Float32Array(max), spin = new Float32Array(max);
  const type = new Uint8Array(max);
  let count = 0;
  const col = [0, 0, 0];
  // tiny deterministic RNG so bursts do not depend on Math.random (keeps captures reproducible)
  let seed = 0x1234abcd;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };

  const ps = {
    get count() { return count; },
    rnd,
    clear() { count = 0; },

    // Spawn one particle. o: { vx, vy, life, size, sizeEnd, col, k, drag, gx, gy, type, rot, spin }
    spawn(px, py, o) {
      let i;
      if (count < max) i = count++;
      else i = Math.floor(rnd() * max); // pool full: overwrite a random one
      x[i] = px; y[i] = py; vx[i] = o.vx || 0; vy[i] = o.vy || 0;
      life[i] = maxLife[i] = o.life || 0.5;
      size0[i] = o.size !== undefined ? o.size : 4;
      size1[i] = o.sizeEnd !== undefined ? o.sizeEnd : 0;
      const c = o.col || WHITE; cr[i] = c[0]; cg[i] = c[1]; cb[i] = c[2];
      k0[i] = o.k !== undefined ? o.k : 1;
      drag[i] = o.drag || 0; gx[i] = o.gx || 0; gy[i] = o.gy || 0;
      type[i] = o.type || 0; rot[i] = o.rot || 0; spin[i] = o.spin || 0;
    },

    // Radial/cone burst. o: { count, angle, spread, speedMin, speedMax, lifeMin, lifeMax, size, sizeEnd,
    //   col, k, drag, gx, gy, type, spinMax, inheritVx, inheritVy, sizeJitter }
    burst(px, py, o) {
      const n = o.count || 12;
      const a0 = o.angle || 0, spread = o.spread !== undefined ? o.spread : Math.PI * 2;
      const s0 = o.speedMin !== undefined ? o.speedMin : 100, s1 = o.speedMax !== undefined ? o.speedMax : 300;
      const l0 = o.lifeMin !== undefined ? o.lifeMin : 0.3, l1 = o.lifeMax !== undefined ? o.lifeMax : 0.7;
      const tmp = TMP;
      tmp.col = o.col; tmp.k = o.k; tmp.drag = o.drag; tmp.gx = o.gx; tmp.gy = o.gy; tmp.type = o.type; tmp.sizeEnd = o.sizeEnd;
      const jit = o.sizeJitter !== undefined ? o.sizeJitter : 0.5;
      for (let j = 0; j < n; j++) {
        const a = a0 + (rnd() - 0.5) * spread, s = s0 + (s1 - s0) * rnd();
        tmp.vx = Math.cos(a) * s + (o.inheritVx || 0); tmp.vy = Math.sin(a) * s + (o.inheritVy || 0);
        tmp.life = l0 + (l1 - l0) * rnd();
        tmp.size = (o.size !== undefined ? o.size : 4) * (1 - jit * rnd());
        tmp.rot = rnd() * 6.283; tmp.spin = (rnd() - 0.5) * 2 * (o.spinMax || 0);
        ps.spawn(px, py, tmp);
      }
    },

    update(dt) {
      for (let i = 0; i < count; i++) {
        life[i] -= dt;
        if (life[i] <= 0) {
          // swap-remove
          const l = --count;
          if (i !== l) {
            x[i] = x[l]; y[i] = y[l]; vx[i] = vx[l]; vy[i] = vy[l]; life[i] = life[l]; maxLife[i] = maxLife[l];
            size0[i] = size0[l]; size1[i] = size1[l]; k0[i] = k0[l]; cr[i] = cr[l]; cg[i] = cg[l]; cb[i] = cb[l];
            drag[i] = drag[l]; gx[i] = gx[l]; gy[i] = gy[l]; rot[i] = rot[l]; spin[i] = spin[l]; type[i] = type[l];
          }
          i--; continue;
        }
        const d = drag[i];
        if (d > 0) { const f = Math.exp(-d * dt); vx[i] *= f; vy[i] *= f; }
        vx[i] += gx[i] * dt; vy[i] += gy[i] * dt;
        x[i] += vx[i] * dt; y[i] += vy[i] * dt;
        rot[i] += spin[i] * dt;
      }
    },

    draw(gfx) {
      for (let i = 0; i < count; i++) {
        const t = 1 - life[i] / maxLife[i];           // 0 -> 1 over the lifetime
        const sz = size0[i] + (size1[i] - size0[i]) * t;
        const fade = t < 0.1 ? t * 10 : 1 - (t - 0.1) / 0.9; // quick in, linear out
        const k = k0[i] * fade;
        col[0] = cr[i]; col[1] = cg[i]; col[2] = cb[i];
        switch (type[i]) {
          case P_GLOW: gfx.glow(x[i], y[i], sz, col, k, 2); break;
          case P_SPARK: {
            const sp = Math.hypot(vx[i], vy[i]) + 1e-5;
            const len = Math.min(sp * 0.035, 46) + sz;
            gfx.line(x[i], y[i], x[i] - (vx[i] / sp) * len, y[i] - (vy[i] / sp) * len, sz * 0.5, col, k, 3);
            break;
          }
          case P_RING: gfx.ring(x[i], y[i], sz, Math.max(1, 3 * (1 - t)), col, k, 4); break;
          case P_SHARD: {
            const c = Math.cos(rot[i]) * sz, s = Math.sin(rot[i]) * sz;
            gfx.line(x[i] - c, y[i] - s, x[i] + c, y[i] + s, 1.6, col, k, 3);
            break;
          }
          default: {
            gfx.push(); gfx.translate(x[i], y[i]); gfx.rotate(rot[i]);
            gfx.rect(-sz * 0.5, -sz * 0.5, sz, sz, col, k, 0);
            gfx.pop();
          }
        }
      }
    },
  };
  return ps;
}

const WHITE = [1, 1, 1];
const TMP = { vx: 0, vy: 0, life: 0, size: 0, sizeEnd: 0, col: null, k: 1, drag: 0, gx: 0, gy: 0, type: 0, rot: 0, spin: 0 };
