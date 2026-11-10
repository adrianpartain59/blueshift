// game/hazards.js — draws everything the player must READ: hazards, telegraphs, launch pads,
// pickups, beat ticks, the lane guide and the landing reticle. Readability rules (docs/DESIGN.md)
// live here: solids are the only dark-filled shapes, magenta = never touch, yellow = breach,
// cyan = safe guidance. Hazards are time-locked: z = (seconds until arrival) x speed.
import { LANES, APOTHEM, VERTEX_R, LANE_ANGLE, C, FLIP_BEATS, RAM_TIME } from './config.js';
import { KIND, SOLID } from './patterns.js';
import { H_COMING, H_BROKEN, H_TAKEN } from './sim.js';
import { CORNER_X, CORNER_Y, gearColor } from './tube.js';
import { clamp01, lerp, TAU } from '../engine/math.js';
import { beatToTime } from './timeline.js';

const DARK = [0, 0, 0], tmp = [0, 0, 0];
const SLAB_IN = 0.46;      // inner edge of a slab as a fraction of the outer radius (it rises ~2.7 m)
const FIN_IN = 0.66;       // fins are lower (~1.7 m): a kerb to grind, and the camera can see over it
const FIN_NEAR = -1.5;     // fins stop just behind the runner instead of running up to the lens
const PASSED_CUT = -3;     // solids that have gone by are dropped this far behind the runner
const IRIS_HOLE = 2.5;     // radius of the hole in an iris (metres)
const DOOR_R = 9.2;        // radius of a shutter's opaque backing (seals the conduit behind it)
const wrap = (l) => ((l % LANES) + LANES) % LANES;
// lane i spans corner i -> corner i+1
const ax = (i) => CORNER_X[i], ay = (i) => CORNER_Y[i];
const bx = (i) => CORNER_X[(i + 1) % LANES], by = (i) => CORNER_Y[(i + 1) % LANES];
const isDoor = (h) => h.kind === KIND.SHUTTER && h.state === H_COMING;
const isWall = (k) => k === KIND.WALL || k === KIND.GATE || k === KIND.SHUTTER;

export function createHazardRenderer(gfx, cam) {
  // Point on lane i's wedge: u along the lane width (0..1), v from the floor (0) toward the axis (1 = axis).
  const Wp = new Float64Array(2);
  function W(i, u, v) {
    Wp[0] = lerp(ax(i), bx(i), u) * (1 - v); Wp[1] = lerp(ay(i), by(i), u) * (1 - v);
  }
  function wedgeLine(i, u0, v0, u1, v1, z, w, col, k) {
    W(i, u0, v0); const x0 = Wp[0], y0 = Wp[1]; W(i, u1, v1);
    cam.line(x0, y0, z, Wp[0], Wp[1], z, w, col, k, 4);
  }
  // Wedge on lane i between floor (v0) and v1: optional dark fill, neon rim.
  function wedge(i, v0, v1, z, col, k, fill, rimW) {
    const s0 = 1 - v0, s1 = 1 - v1;
    const x0 = ax(i) * s0, y0 = ay(i) * s0, x1 = bx(i) * s0, y1 = by(i) * s0;
    const x2 = bx(i) * s1, y2 = by(i) * s1, x3 = ax(i) * s1, y3 = ay(i) * s1;
    if (fill) cam.quad(x0, y0, z, x1, y1, z, x2, y2, z, x3, y3, z, fill, 1, 1);
    cam.line(x0, y0, z, x1, y1, z, rimW, col, k, 4);
    cam.line(x1, y1, z, x2, y2, z, rimW, col, k, 4);
    cam.line(x2, y2, z, x3, y3, z, rimW, col, k, 4);
    cam.line(x3, y3, z, x0, y0, z, rimW, col, k, 4);
  }
  function chevrons(i, z, col, k, vTop) {
    // two warning chevrons pointing at the axis
    const a = vTop * 0.22, b = vTop * 0.5, c = vTop * 0.78;
    wedgeLine(i, 0.2, a, 0.5, b, z, 0.09, col, k); wedgeLine(i, 0.5, b, 0.8, a, z, 0.09, col, k);
    wedgeLine(i, 0.26, b, 0.5, c, z, 0.09, col, k * 0.8); wedgeLine(i, 0.5, c, 0.74, b, z, 0.09, col, k * 0.8);
  }
  // Translucent stripe on the floor of lane i between z0 and z1 (the telegraph).
  function floorStripe(i, z0, z1, col, k) {
    if (z1 <= z0) return;
    cam.quad(ax(i), ay(i), z0, bx(i), by(i), z0, bx(i), by(i), z1, ax(i), ay(i), z1, col, k, 0);
  }
  // A line along lane i at a fraction u of its width.
  function laneLine(i, u, z0, z1, w, col, k) {
    const mx = lerp(ax(i), bx(i), u), my = lerp(ay(i), by(i), u);
    let a = z0;
    while (a < z1) { const b = Math.min(z1, a + (a < 60 ? 10 : 30)); cam.line(mx, my, a, mx, my, b, w, col, k, 4); a = b; }
  }
  // The lane guide: two rails either side of the runner (a single centre line would hide behind the body).
  function laneGuide(i, z0, z1, w, col, k) { laneLine(i, 0.2, z0, z1, w, col, k); laneLine(i, 0.8, z0, z1, w, col, k); }
  function octagon(r, z, w, col, k) {
    const s = r / VERTEX_R;
    for (let i = 0; i < LANES; i++) cam.line(ax(i) * s, ay(i) * s, z, bx(i) * s, by(i) * s, z, w, col, k, 4);
  }
  // Triangular lattice clipped to a disc: the ICE look.
  function lattice(r, z, col, k, n) {
    for (let f = 0; f < 3; f++) {
      const a = (f * Math.PI) / 3 + 0.26, c = Math.cos(a), s = Math.sin(a);
      for (let j = -n; j <= n; j++) {
        const d = (j / (n + 0.5)) * r, hl = Math.sqrt(Math.max(0, r * r - d * d));
        cam.line(-s * d - c * hl, c * d - s * hl, z, -s * d + c * hl, c * d + s * hl, z, 0.05, col, k, 4);
      }
    }
  }
  function discFill(r, z, col, k, a) {
    const s = r / VERTEX_R;
    for (let i = 0; i < LANES; i += 2) {
      const j = (i + 1) % LANES, m = (i + 2) % LANES;
      cam.quad(0, 0, z, CORNER_X[i] * s, CORNER_Y[i] * s, z, CORNER_X[j] * s, CORNER_Y[j] * s, z, CORNER_X[m] * s, CORNER_Y[m] * s, z, col, k, a);
    }
  }
  // z of the nearest closed shutter ahead (an opaque door: nothing beyond it may be drawn), else Infinity
  function doorZ(sim, view) {
    const hz = sim.hazards;
    for (let i = 0; i < hz.length; i++) { if (isDoor(hz[i])) { const z = view.zAt(hz[i].t0); if (z > 0) return z; } }
    return Infinity;
  }

  const R = {
    doorZ,
    // Call BEFORE the tube is drawn: paints the opaque backing of a closed shutter so it seals off the
    // world beyond it, while the rails and ribs on the near side are drawn after it and stay visible.
    // Returns the door's z (pass it to drawTube and draw() as the far limit).
    drawDoorBacking(frame, sim, view) {
      const z = doorZ(sim, view);
      if (z < 400) discFill(DOOR_R, z + 0.05, DARK, 1, 1);
      return z;
    },

    // view: { t (visual song time), speed, zAt(time) -> metres ahead, beatDur }. farZ: nothing beyond it is drawn.
    draw(frame, sim, view, farZ = Infinity) {
      const hz = sim.hazards;
      const t = view.t, lane = frame.lane, beatLen = view.beatDur * view.speed;
      const pulse = 0.75 + 0.25 * frame.kick;
      const far = Math.min(330, farZ + 0.5);

      // ---- beat ticks on the floor: the future, measured in beats (downbeats brighter)
      gearColor(frame.gearF, tmp);
      const b0 = Math.ceil(frame.beat + 0.02);
      for (let b = b0 + 7; b >= b0; b--) {
        const z = view.zAt(beatToTime(b));
        if (z > 260 || z < 0.5 || z > farZ - 1) continue;
        const down = b % 4 === 0;
        octagon(VERTEX_R * 0.985, z, down ? 0.09 : 0.05, down ? C.white : tmp, down ? 0.5 : 0.32);
      }

      // ---- the runner's lane guide: cyan, magenta from here to the next solid in this lane.
      // The search stops at ICE: what hides behind a wall is the wall's business, not the guide's.
      let nextSolidZ = -1;
      for (let i = 0; i < hz.length; i++) {
        const h = hz[i];
        if (h.state !== H_COMING || !((h.mask >> lane) & 1)) continue;
        const z = view.zAt(h.t0);
        if (z <= 0.5) continue;
        if (isWall(h.kind)) break;
        if (h.mat !== SOLID || h.kind === KIND.IRIS) continue;
        nextSolidZ = z; break;
      }
      if (frame.air < 0 && !frame.dead) {
        const end = Math.min(170, farZ - 0.5);
        if (nextSolidZ > 0 && nextSolidZ < 150 && nextSolidZ < end) {
          laneGuide(lane, 1.5, nextSolidZ, 0.1, C.solid, 1.0 * pulse);
          laneGuide(lane, nextSolidZ, end, 0.06, C.you, 0.3);
        } else laneGuide(lane, 1.5, end, 0.06, C.you, 0.45);
      }

      // ---- hazards, far to near
      for (let n = hz.length - 1; n >= 0; n--) {
        const h = hz[n];
        if (h.state === H_BROKEN || h.state === H_TAKEN) continue;
        const z = view.zAt(h.t0);
        const zEnd = h.len ? view.zAt(h.t1) : z;
        if (zEnd < -7.6 || z > far) continue;
        const appear = clamp01((t - h.born) / 0.22);             // materialise
        const tau = h.t0 - t;
        // A solid that has gone by without touching is no longer a threat: rim only, dimmed, soon dropped.
        const gone = z < 0, goneK = gone ? 0.4 : 1;
        switch (h.kind) {
          case KIND.BLOCK: case KIND.PLATE: {
            const zz = h.kind === KIND.PLATE ? z - 0.6 : z;
            if (zz < PASSED_CUT) break;
            for (let i = 0; i < LANES; i++) {
              if (!((h.mask >> i) & 1)) continue;
              const d = Math.min(wrap(i - lane), wrap(lane - i));
              const k = (d > 2 ? 0.55 : 1) * appear * goneK;
              // telegraph: one beat of magenta floor running ahead of the slab toward the player
              if (h.state === H_COMING && z > 0) floorStripe(i, Math.max(0.3, z - beatLen), z, C.solid, 0.13 * k * pulse);
              wedge(i, 0, (1 - SLAB_IN) * appear, zz, C.solid, 1.9 * k, gone ? null : C.solidFill, 0.14);
              if (zz < 140 && !gone) chevrons(i, zz, C.solid, 1.2 * k, (1 - SLAB_IN) * appear);
              if (zz < 90 && !gone) wedge(i, 0, (1 - SLAB_IN) * appear, zz + 0.9, C.solid, 0.5 * k, null, 0.07);  // back edge: reads as thickness
            }
            break;
          }
          case KIND.FIN: {
            const i = h.lane, d = Math.min(wrap(i - lane), wrap(lane - i));
            const k = (d > 2 ? 0.6 : 1) * appear;
            const z0 = Math.max(z, FIN_NEAR), z1 = Math.min(zEnd, far);
            if (z1 <= z0) break;
            const s = FIN_IN;
            const x0 = ax(i), y0 = ay(i), x1 = bx(i), y1 = by(i);
            if (h.state === H_COMING && z > 0) floorStripe(i, Math.max(0.3, z - beatLen), z, C.solid, 0.13 * k * pulse);
            // sides, top, long edges, far edge
            cam.quad(x0, y0, z0, x0 * s, y0 * s, z0, x0 * s, y0 * s, z1, x0, y0, z1, C.solidFill, 1, 1);
            cam.quad(x1, y1, z0, x1 * s, y1 * s, z0, x1 * s, y1 * s, z1, x1, y1, z1, C.solidFill, 1, 1);
            cam.quad(x0 * s, y0 * s, z0, x1 * s, y1 * s, z0, x1 * s, y1 * s, z1, x0 * s, y0 * s, z1, C.solidFill, 1, 1);
            cam.line(x0, y0, z0, x0, y0, z1, 0.12, C.solid, 1.5 * k, 4); cam.line(x1, y1, z0, x1, y1, z1, 0.12, C.solid, 1.5 * k, 4);
            cam.line(x0 * s, y0 * s, z0, x0 * s, y0 * s, z1, 0.12, C.solid, 1.7 * k, 4); cam.line(x1 * s, y1 * s, z0, x1 * s, y1 * s, z1, 0.12, C.solid, 1.7 * k, 4);
            cam.line(x0 * s, y0 * s, z1, x1 * s, y1 * s, z1, 0.1, C.solid, 1.2 * k, 4);
            // near cap (the true front while it approaches, a clean cut end once it runs beside you)
            wedge(i, 0, 1 - s, z0, C.solid, 1.9 * k, C.solidFill, 0.14);
            if (z > FIN_NEAR && z < 140) chevrons(i, z, C.solid, 1.2 * k, 1 - s);
            break;
          }
          case KIND.IRIS: {
            if (z < PASSED_CUT) break;
            const vHole = 1 - IRIS_HOLE / APOTHEM, ka = appear * goneK;
            for (let i = 0; i < LANES; i++) {
              const s1 = 1 - vHole;
              if (!gone) cam.quad(ax(i), ay(i), z, bx(i), by(i), z, bx(i) * s1, by(i) * s1, z, ax(i) * s1, ay(i) * s1, z, C.solidFill, 1, 1);
              cam.line(ax(i), ay(i), z, bx(i), by(i), z, 0.14, C.solid, 1.9 * ka, 4);
              if (gone) continue;
              cam.line(ax(i), ay(i), z, ax(i) * s1, ay(i) * s1, z, 0.07, C.solid, 0.9 * ka, 4);
              if (z < 150) { wedgeLine(i, 0.25, vHole * 0.3, 0.5, vHole * 0.6, z, 0.08, C.solid, 0.9 * ka); wedgeLine(i, 0.5, vHole * 0.6, 0.75, vHole * 0.3, z, 0.08, C.solid, 0.9 * ka); }
            }
            // the cyan-rimmed hole: the way through
            octagon(IRIS_HOLE / Math.cos(LANE_ANGLE / 2), z, 0.16, h.locked ? C.ice : C.you, 2.2 * ka * pulse);
            if (z > 0 && !h.locked) cam.glow(0, 0, z, IRIS_HOLE * 1.3, C.you, 0.3 * appear, 1.5);
            break;
          }
          case KIND.SPOKE: {
            if (z < PASSED_CUT) break;
            const i = h.lane, j = wrap(i + 4), ka = appear * goneK;
            if (h.state === H_COMING && z > 0) { floorStripe(i, Math.max(0.3, z - beatLen), z, C.solid, 0.13 * appear * pulse); floorStripe(j, Math.max(0.3, z - beatLen), z, C.solid, 0.13 * appear * pulse); }
            // a full-width bar through the axis: both lanes and the core are blocked
            if (!gone) cam.quad(ax(i), ay(i), z, bx(i), by(i), z, ax(j), ay(j), z, bx(j), by(j), z, C.solidFill, 1, 1);
            cam.line(ax(i), ay(i), z, bx(i), by(i), z, 0.14, C.solid, 1.9 * ka, 4); cam.line(ax(j), ay(j), z, bx(j), by(j), z, 0.14, C.solid, 1.9 * ka, 4);
            cam.line(ax(i), ay(i), z, bx(j), by(j), z, 0.12, C.solid, 1.7 * ka, 4); cam.line(bx(i), by(i), z, ax(j), ay(j), z, 0.12, C.solid, 1.7 * ka, 4);
            if (!gone) { cam.ring(0, 0, z, 0.8, 0.12, C.solid, 1.8 * ka, 4); chevrons(i, z, C.solid, 1.0 * ka, 0.6); chevrons(j, z, C.solid, 1.0 * ka, 0.6); }
            break;
          }
          case KIND.MINE: {
            if (z < PASSED_CUT) break;
            const spin = frame.time * 2.2, ka = appear * goneK;
            if (!gone) cam.disc(0, 0, z, 0.95, C.solidFill, 1, 1);
            cam.ring(0, 0, z, 0.95, 0.13, C.solid, 2.0 * ka * pulse, 4);
            for (let s = 0; s < 6; s++) { const a = spin + (s * TAU) / 6; cam.line(Math.cos(a) * 0.95, Math.sin(a) * 0.95, z, Math.cos(a) * 1.9, Math.sin(a) * 1.9, z, 0.1, C.solid, 1.6 * ka, 4); }
            if (!gone) cam.ring(0, 0, z, IRIS_HOLE, 0.05, C.solid, 0.7 * ka, 4);
            break;
          }
          case KIND.WALL: case KIND.GATE: case KIND.SHUTTER: {
            if (z < -7.4) break;
            const big = h.kind !== KIND.WALL;
            // "NOW": white-hot inside the ram window
            const now = tau < RAM_TIME && tau > -0.07 ? 1 : 0;
            const col = now ? C.iceHot : C.ice;
            const k = appear * (1 + now * 0.9);
            if (h.kind === KIND.SHUTTER) {
              // a real door (its opaque backing was painted before the tube): frame and spokes
              octagon(VERTEX_R * 1.25, z, 0.16, C.ice, 0.9 * k);
              for (let i = 0; i < LANES; i++) cam.line(ax(i) * 0.3, ay(i) * 0.3, z, ax(i), ay(i), z, 0.1, C.ice, 0.8 * k, 4);
            } else {
              // faint veil so the lattice reads as a surface, but what hides behind it stays visible
              discFill(VERTEX_R, z, C.ice, 0.035 * k, 0.12);
            }
            if (h.kind === KIND.GATE) { octagon(VERTEX_R, z + 1.2, 0.12, col, 1.2 * k); if (z < 160) lattice(APOTHEM * 0.98, z + 1.2, col, 0.5 * k, 3); }
            octagon(VERTEX_R, z, big ? 0.2 : 0.15, col, 2.1 * k);
            if (z < 200) lattice(APOTHEM * 0.98, z, col, (big ? 1.0 : 0.75) * k, z < 90 ? 4 : 3);
            // three rings that collapse on the three beats before impact: 3 .. 2 .. 1
            if (h.state === H_COMING) {
              const beatsLeft = tau / view.beatDur;
              for (let r = 0; r < 3; r++) {
                const left = beatsLeft - r;                 // ring r dies when this hits 0
                if (left <= 0) continue;
                const shrink = left < 1 ? left : 1;         // collapses over its final beat
                cam.ring(0, 0, z - 0.05, (1.5 + r * 1.15) * (0.25 + 0.75 * shrink), 0.11, C.iceHot, (1.3 + (left < 1 ? (1 - left) * 1.2 : 0)) * appear, 4);
              }
            }
            break;
          }
          case KIND.PYLON: {
            if (z < PASSED_CUT) break;
            const i = h.lane;
            const now = tau < RAM_TIME && tau > -0.07 ? 1 : 0;
            wedge(i, 0, 1 - SLAB_IN, z, now ? C.iceHot : C.ice, 1.9 * appear * goneK * (1 + now * 0.8), null, 0.13);
            if (gone) break;
            wedgeLine(i, 0, 0, 1, 1 - SLAB_IN, z, 0.06, C.ice, 0.9 * appear); wedgeLine(i, 1, 0, 0, 1 - SLAB_IN, z, 0.06, C.ice, 0.9 * appear);
            wedgeLine(i, 0.5, 0, 0.5, 1 - SLAB_IN, z, 0.06, C.ice, 0.9 * appear);
            break;
          }
          case KIND.COREICE: {
            if (z < PASSED_CUT) break;
            const now = tau < RAM_TIME && tau > -0.07 ? 1 : 0;
            lattice(IRIS_HOLE * 0.96, z, now ? C.iceHot : C.ice, 1.2 * appear * (1 + now), 2);
            cam.ring(0, 0, z, IRIS_HOLE * 0.5, 0.1, C.iceHot, 1.4 * appear, 4);
            break;
          }
          case KIND.PAD: {
            // launch pad: cyan chevrons on every lane, brightest on yours. Flip HERE.
            if (z < 0.2 || h.state !== H_COMING) break;
            for (let i = 0; i < LANES; i++) {
              const mine = i === lane, k = (mine ? 2.2 : 1.0) * appear * pulse;
              const mx = (ax(i) + bx(i)) * 0.5, my = (ay(i) + by(i)) * 0.5;
              for (let c = 0; c < (mine ? 3 : 1); c++) {
                const zz = z - c * 1.6;
                cam.line(lerp(ax(i), mx, 0.25), lerp(ay(i), my, 0.25), zz - 1.4, mx * 0.97, my * 0.97, zz, 0.1, C.you, k * (1 - c * 0.25), 4);
                cam.line(lerp(bx(i), mx, 0.25), lerp(by(i), my, 0.25), zz - 1.4, mx * 0.97, my * 0.97, zz, 0.1, C.you, k * (1 - c * 0.25), 4);
              }
            }
            break;
          }
          case KIND.ORB: {
            if (z < 0.2) break;
            const bob = Math.sin(frame.time * 5 + h.id) * 0.12;
            cam.glow(0, bob, z, 1.5, C.you, 0.9 * appear, 2);
            cam.disc(0, bob, z, 0.34, C.white, 1.6 * appear, 1);
            cam.ring(0, bob, z, 0.62, 0.07, C.you, 1.6 * appear, 4);
            break;
          }
          case KIND.SPARK: {
            if (z < 0.2 || z > 200) break;
            const i = h.lane, mx = (ax(i) + bx(i)) * 0.5 * 0.9, my = (ay(i) + by(i)) * 0.5 * 0.9;
            const r = 0.26, k = 1.5 * appear;
            cam.line(mx - r, my, z, mx, my + r, z, 0.06, C.you, k, 4); cam.line(mx, my + r, z, mx + r, my, z, 0.06, C.you, k, 4);
            cam.line(mx + r, my, z, mx, my - r, z, 0.06, C.you, k, 4); cam.line(mx, my - r, z, mx - r, my, z, 0.06, C.you, k, 4);
            break;
          }
        }
      }
    },

    // Where a flip from the current lane would touch down, and whether that is safe.
    drawReticle(frame, sim, view) {
      if (frame.dead) return;
      let show = sim.air, padZ = -1;
      if (!show) {
        for (let i = 0; i < sim.hazards.length; i++) { const h = sim.hazards[i]; if (h.kind === KIND.PAD && h.state === H_COMING) { padZ = view.zAt(h.t0); break; } }
        show = padZ > 0 && padZ < view.speed * view.beatDur * 3;
      }
      if (!show) return;
      const to = sim.air ? sim.flipTo : wrap(sim.lane + 4);
      const landT = sim.air ? sim.flipT0 + sim.flipDur : view.t + FLIP_BEATS * view.beatDur;
      const z = Math.max(0.5, view.zAt(landT));
      const blocked = sim.finAt(to, landT);
      const col = blocked ? C.solid : C.you, k = 1.6 * (0.7 + 0.3 * frame.kick);
      const mx = (ax(to) + bx(to)) * 0.5, my = (ay(to) + by(to)) * 0.5;
      const qx = lerp(ax(to), mx, 0.35), qy = lerp(ay(to), my, 0.35), rx = lerp(bx(to), mx, 0.35), ry = lerp(by(to), my, 0.35);
      cam.line(qx, qy, z - 1.2, qx, qy, z + 1.2, 0.09, col, k, 4); cam.line(rx, ry, z - 1.2, rx, ry, z + 1.2, 0.09, col, k, 4);
      cam.line(qx, qy, z + 1.2, rx, ry, z + 1.2, 0.09, col, k, 4); cam.line(qx, qy, z - 1.2, rx, ry, z - 1.2, 0.09, col, k, 4);
    },
  };
  return R;
}
