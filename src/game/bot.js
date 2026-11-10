// game/bot.js — a planner that plays BLUESHIFT. It is the attract mode, the automated playtester and
// the fairness proof: with skill 1 it must never crash on a generated level.
//
// The game is a table, so the bot is dynamic programming over that table: one column per 16th-note
// tick, one row per state (8 ground lanes + 16 mid-flip states). It only knows hazards that have
// already materialised, exactly like a player.
import { LANES, CORE, TICKS_PER_BEAT } from './config.js';
import { timeToTick, tickToTime } from './timeline.js';
import { KIND, SOLID, ICE } from './patterns.js';
import { H_COMING, H_PASSED } from './sim.js';
import { makeRng } from '../engine/math.js';

const N = 44;                    // ticks of lookahead (11 beats)
const STATES = LANES + LANES * 2; // ground lanes, then air (from lane, phase 1|2)
const NEG = -1e9;
const wrap = (l) => ((l % LANES) + LANES) % LANES;

export function createBot(sim, opts = {}) {
  const skill = opts.skill !== undefined ? opts.skill : 1;     // 1 = perfect execution
  const greed = opts.greed !== undefined ? opts.greed : 1;     // weight of optional bonuses
  const rng = makeRng(opts.seed || 99);
  const solid = new Int32Array(N + 8), ice = new Int32Array(N + 8), grazeM = new Int32Array(N + 8), finBlock = new Int32Array(N + 8);
  const spark = new Int32Array(N + 8), iris = new Uint8Array(N + 8), orb = new Uint8Array(N + 8);
  const val = new Float64Array((N + 8) * STATES), prev = new Int16Array((N + 8) * STATES), act = new Int8Array((N + 8) * STATES);
  const seq = new Int8Array(N + 8);
  // act codes: 0 stay, 1 roll +1, 2 roll -1, 3 flip (launch), 4 air continue, 5 land +3, 6 land +4, 7 land +5,
  //            8 grind-roll +1, 9 grind-roll -1 (hold against a fin; the roll fires when the fin ends)
  let lastTick = Math.floor(timeToTick(sim.t)) - 1;
  let breachAt = -1, queuedRoll = 0, holding = 0;
  const bot = { plans: 0, deadEnds: 0, lastPlanScore: 0 };

  function groundScore(k, l) {
    if ((solid[k] >> l) & 1) return NEG;
    let v = 0;
    if ((ice[k] >> l) & 1) v += 30;
    const gl = (grazeM[k] >> wrap(l - 1)) & 1, gr = (grazeM[k] >> wrap(l + 1)) & 1;
    if (gl && gr) v += 12 * greed; else if (gl || gr) v += 5 * greed;
    if ((spark[k] >> l) & 1) v += 1 * greed;
    return v;
  }
  function coreScore(k) {
    if ((solid[k] >> CORE) & 1) return NEG;
    let v = 0;
    if ((ice[k] >> CORE) & 1) v += 30;
    if (iris[k]) v += 13;
    if (orb[k]) v += 4 * greed;
    return v;
  }

  // Plan from tick k0 (already resolved). Returns the action code to take now.
  function plan(k0) {
    solid.fill(0); ice.fill(0); grazeM.fill(0); finBlock.fill(0); spark.fill(0); iris.fill(0); orb.fill(0);
    const hz = sim.hazards;
    for (let i = 0; i < hz.length; i++) {
      const h = hz[i];
      const k = h.tick - k0;
      if (h.kind === KIND.FIN) {
        for (let j = Math.max(0, k); j < Math.min(N + 4, k + h.len); j++) finBlock[j] |= h.mask;
      }
      if (h.state !== H_COMING || k <= 0 || k > N + 3) continue;
      if (h.mat === SOLID) {
        solid[k] |= h.mask;
        if (h.kind === KIND.IRIS) iris[k] = 1; else grazeM[k] |= h.mask & 0xff;
      } else if (h.mat === ICE) ice[k] |= h.mask;
      else if (h.kind === KIND.ORB) orb[k] = 1;
      else if (h.kind === KIND.SPARK) spark[k] |= h.mask;
    }
    val.fill(NEG);
    // initial state
    let s0;
    if (!sim.air) s0 = sim.lane;
    else {
      // mid-flip: where in the flip is tick k0? (ticks since launch; the core lasts until 2.68, touchdown at 3)
      const pt = k0 - timeToTick(sim.flipT0);
      if (pt >= 2.6) s0 = sim.flipTo;                       // on final approach: plan as if already down
      else s0 = LANES + sim.flipFrom * 2 + (pt < 1.5 ? 0 : 1);
    }
    val[s0] = 0;
    let bestEnd = -1, bestEndVal = NEG, lastAlive = 0, lastAliveState = s0;
    for (let k = 0; k < N; k++) {
      const row = k * STATES, next = row + STATES;
      let any = false;
      for (let s = 0; s < STATES; s++) {
        const v = val[row + s];
        if (v <= NEG / 2) continue;
        any = true;
        if (s < LANES) {
          const l = s;
          for (let a = 0; a < 3; a++) {
            const l2 = a === 0 ? l : a === 1 ? wrap(l + 1) : wrap(l - 1);
            // A fin in the way? If it ends exactly at the next tick, a HELD roll fires the instant it
            // ends (before that tick's hazards resolve): lean on it and ride it round. That is a grind.
            let grind = false;
            if (a > 0 && (finBlock[k] >> l2) & 1) { if ((finBlock[k + 1] >> l2) & 1) continue; grind = true; }
            const g = groundScore(k + 1, l2);
            if (g <= NEG / 2) continue;
            const nv = v + g - (a > 0 ? 0.3 : 0) + (grind ? 1.6 * greed : 0);
            if (nv > val[next + l2]) { val[next + l2] = nv; prev[next + l2] = s; act[next + l2] = grind ? 7 + a : a; }
          }
          // flip launched at tick k: core at k+1 and k+2, landing lane at k+3
          const c1 = coreScore(k + 1);
          if (c1 > NEG / 2) {
            const sa = LANES + l * 2;
            const nv = v + c1 - 1.0;
            if (nv > val[next + sa]) { val[next + sa] = nv; prev[next + sa] = s; act[next + sa] = 3; }
          }
        } else {
          const from = (s - LANES) >> 1, phase = (s - LANES) & 1;
          if (phase === 0) {
            const c2 = coreScore(k + 1);
            if (c2 > NEG / 2) { const sa = s + 1, nv = v + c2; if (nv > val[next + sa]) { val[next + sa] = nv; prev[next + sa] = s; act[next + sa] = 4; } }
          } else {
            for (let d = 3; d <= 5; d++) {
              const to = wrap(from + d);
              if ((finBlock[k + 1] >> to) & 1) continue;
              const g = groundScore(k + 1, to);
              if (g <= NEG / 2) continue;
              const nv = v + g - (d === 4 ? 0 : 0.4);
              if (nv > val[next + to]) { val[next + to] = nv; prev[next + to] = s; act[next + to] = 2 + d; }
            }
          }
        }
      }
      if (!any) break;
      // remember the furthest column with any survivor
      for (let s = 0; s < STATES; s++) if (val[next + s] > NEG / 2) { lastAlive = k + 1; break; }
    }
    // best state in the furthest surviving column
    const row = lastAlive * STATES;
    for (let s = 0; s < STATES; s++) if (val[row + s] > bestEndVal) { bestEndVal = val[row + s]; bestEnd = s; }
    bot.plans++;
    bot.lastPlanScore = bestEndVal;
    if (lastAlive < Math.min(N, 6)) bot.deadEnds++;
    if (bestEnd < 0 || lastAlive === 0) return { a: 0, ice1: false, cell1: 0, hold: 0 };
    // backtrack to column 1, remembering the action taken into each column
    let s = bestEnd, k = lastAlive;
    while (k > 1) { seq[k] = act[k * STATES + s]; s = prev[k * STATES + s]; k--; }
    const a = act[STATES + s];
    seq[1] = a;
    // will the first step put us in ICE at tick k0+1?
    const cell1 = s < LANES ? s : CORE;
    // Lean on a fin as soon as the plan's next move is a grind-roll (within a beat) and the fin is
    // already there: holding early is free, pays flux per beat and is what a person would do.
    let hold = 0;
    for (let j = 1; j <= Math.min(5, lastAlive); j++) {
      const q = seq[j];
      if (q === 0) continue;
      if (q === 8 || q === 9) { const d = q === 8 ? 1 : -1; if (!sim.air && (finBlock[0] >> wrap(sim.lane + d)) & 1) hold = d; }
      break;
    }
    return { a, ice1: ((ice[1] >> cell1) & 1) === 1, cell1, hold };
  }

  // Call once before every sim.step(dt).
  bot.update = (dt) => {
    if (!sim.alive) { sim.releaseAll(); holding = 0; return; }
    const t = sim.t;
    if (breachAt >= 0 && t + dt >= breachAt) { sim.press('breach'); breachAt = -1; }
    // a roll decided during final approach waits for touchdown (in the air a tap would steer instead)
    if (queuedRoll && !sim.air) { const a = queuedRoll > 0 ? 'right' : 'left'; sim.press(a); sim.release(a); queuedRoll = 0; }
    // The newest tick the simulation has already resolved. Must use the sim's own test (t0 <= t):
    // an epsilon here lets the bot act a step early and roll INTO a block that has not arrived yet.
    let kNow = Math.floor(timeToTick(t));
    while (tickToTime(kNow + 1) <= t) kNow++;
    while (tickToTime(kNow) > t) kNow--;
    if (kNow <= lastTick) return;
    lastTick = kNow;
    const p = plan(kNow);
    // let go of a held roll unless the plan still wants to lean on that side
    if (holding && p.hold !== holding) { sim.release(holding > 0 ? 'right' : 'left'); holding = 0; }
    // human error: sometimes simply fail to act
    if (skill < 1 && rng() > skill) return;
    const jitter = skill < 1 ? (rng() + rng() + rng() - 1.5) * (1 - skill) * 0.16 : 0;
    if (p.a === 1 || p.a === 2) {
      if (sim.air) queuedRoll = p.a === 1 ? 1 : -1;
      else { const a = p.a === 1 ? 'right' : 'left'; sim.press(a); sim.release(a); }
    } else if (p.a === 3) sim.press('flip');      // buffered by the sim if we are a few ms from touchdown
    else if (p.a >= 5 && p.a <= 7) {
      // steer the landing: one tap any time before touchdown
      const d = p.a - 2;
      if (d !== 4 && !sim.flipSteered) { const a = d === 5 ? 'right' : 'left'; sim.press(a); sim.release(a); }
    }
    if (p.hold && !holding && !sim.air) { holding = p.hold; sim.press(p.hold > 0 ? 'right' : 'left'); }
    if (p.ice1) breachAt = tickToTime(kNow + 1) - 0.014 + jitter;
  };
  return bot;
}
