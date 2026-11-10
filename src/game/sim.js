// game/sim.js — BLUESHIFT as a deterministic table machine. No DOM, no rendering, no audio:
// this file runs unchanged in node, which is how the bot proves levels fair.
//
// The runner occupies one of 9 cells (8 lanes + the core). Hazards are (time, material, cell mask).
// Collision is a mask lookup at the instant a hazard arrives. Everything else is bookkeeping.
import {
  LANES, CORE, GEAR_SPEED, GEAR_FLUX, MAX_GEAR, LEAD_START, LEAD_MAX, LEAD_CRASH, LEAD_GATE, novaSpeed, HORIZON,
  ROLL_INTERVAL, ROLL_BUFFER, ROLL_REPEAT_DELAY, FLIP_BEATS, FLIP_CORE_IN, FLIP_CORE_OUT,
  RAM_TIME, RAM_LATE, RAM_PERFECT, RAM_RECOVERY, GHOST_TIME, INPUT_BUFFER, FLUX, POINTS, sectorName, SPINDLE_LEAD_FLOOR,
} from './config.js';
import { beatToTime, timeToBeat, sectorOfBeat, bpmAtBeat, DROP_BEAT } from './timeline.js';
import { createLevel } from './level.js';
import { KIND, SOLID, ICE, KIND_NAME, rotateMask } from './patterns.js';

// hazard.state
export const H_COMING = 0;
export const H_PASSED = 1;
export const H_BROKEN = 2;
export const H_TAKEN = 3;
export const H_LATE = 4;
const CREEP_SPEED = 8;     // m/s while clamped in the launch barrel (beats 0-4)
const wrap = (l) => ((l % LANES) + LANES) % LANES;

export function createSim(opts = {}) {
  const startBeat = opts.startBeat || 0;
  const level = createLevel(opts.seed || 1, { startBeat, prompts: opts.prompts !== false });
  const events = [];
  const hazards = [];
  const emit = (type, e) => { const o = e || {}; o.type = type; events.push(o); return o; };

  const sim = {
    level, hazards, events,
    startBeat,
    t: beatToTime(startBeat), beat: startBeat, sector: sectorOfBeat(startBeat),
    // runner
    lane: 0, air: false,
    flipT0: 0, flipDur: 1, flipBeat: 0.47, flipFrom: 0, flipTo: 4, flipSteered: false, flipClean: false,
    grind: 0, grindDir: 0,   // grind: pushing against a fin right now; grindDir: side of the ongoing grind (survives the per-beat roll)
    ramT0: -1, ramUntil: 0, recoverUntil: 0, ghostUntil: 0,
    lastLandT: -9, lastCrashT: -9, lastRamT: -9, lastRollT: -9, lastRollDir: 0,
    // economy
    gear: startBeat >= DROP_BEAT ? 2 : 1, flux: 0, lead: LEAD_START, score: 0, chain: 0,
    speed: startBeat > 0 ? GEAR_SPEED[startBeat >= DROP_BEAT ? 2 : 1] : CREEP_SPEED, dist: 0,
    novaOn: startBeat >= DROP_BEAT, alive: true, deadT: 0, leadLevel: 0,
    assist: opts.assist !== false,
    stats: { crashes: 0, perfects: 0, goods: 0, whiffs: 0, grazes: 0, threads: 0, flips: 0, rolls: 0, orbs: 0, maxGear: 1, maxChain: 0, walls: 0 },
  };

  // input state
  const held = { '-1': false, '1': false };
  let activeDir = 0, heldSince = 0, rollPressT = -1, rollPressDir = 0, rollReadyAt = 0;
  let flipPressT = -1, breachPressT = -1;
  let grindAcc = 0, lastGrindT = -9, grinding = false, orbRun = 0, sparkRun = 0, lastPickupT = -9;
  let lastBeat = Math.ceil(startBeat) - 1, started = false;
  let graceH = null, graceUntil = -1;   // an auto shutter that just broke itself: a press this late still counts
  let lastWhiffT = -9, whiffAlone = false;

  function finAt(lane, time) {
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      if (h.kind === KIND.FIN && ((h.mask >> lane) & 1) && time >= h.t0 && time < h.t1) return true;
      if (h.t0 > time) break;
    }
    return false;
  }
  // The cell the runner occupies at `time` (within the current step).
  function cellAt(time) {
    if (!sim.air) return sim.lane;
    const pb = (time - sim.flipT0) / sim.flipBeat;
    return pb < FLIP_CORE_IN ? sim.flipFrom : pb <= FLIP_CORE_OUT ? CORE : sim.flipTo;
  }

  function addFlux(n) {
    sim.flux += n;
    if (sim.flux < 0) sim.flux = 0;
    while (sim.gear < MAX_GEAR && sim.flux >= GEAR_FLUX[sim.gear]) {
      sim.flux -= GEAR_FLUX[sim.gear]; sim.gear++;
      if (sim.gear > sim.stats.maxGear) sim.stats.maxGear = sim.gear;
      emit('gearUp', { gear: sim.gear });
    }
    if (sim.gear === MAX_GEAR && sim.flux > GEAR_FLUX[MAX_GEAR]) {
      sim.lead = Math.min(LEAD_MAX, sim.lead + (sim.flux - GEAR_FLUX[MAX_GEAR]) * FLUX.overflowToLead);
      sim.flux = GEAR_FLUX[MAX_GEAR];
    }
  }

  function hit(h) {
    if (!sim.alive || sim.t < sim.ghostUntil) return;
    const cause = KIND_NAME[h.kind];
    if (sim.sector === 0) { sim.ghostUntil = sim.t + 0.4; sim.lastCrashT = sim.t; emit('stumble', { cause }); return; }
    sim.lastCrashPattern = h.pattern || '';
    const lost = Math.min(2, sim.gear - 1);
    sim.gear -= lost; sim.flux = 0; sim.chain = 0;
    sim.lead -= LEAD_CRASH;
    sim.ghostUntil = sim.t + GHOST_TIME; sim.lastCrashT = sim.t;
    sim.stats.crashes++;
    emit('crash', { cause, gearLost: lost, pattern: h.pattern || '' });
    if (lost) emit('gearDown', { gear: sim.gear });
  }

  const gradeOf = (h, pressT) => (Math.abs(h.t0 - pressT) <= (h.window ? 0.09 : RAM_PERFECT) ? 'perfect' : 'good');
  // Chain, stats and score for a graded hit. Returns the flux it is worth; the points added are left in `lastPts`.
  let lastPts = 0;
  function award(grade) {
    let gain;
    sim.stats.walls++;
    if (grade === 'perfect') {
      gain = FLUX.perfect + Math.min(sim.chain * FLUX.perfectChain, FLUX.perfectChainCap);
      sim.chain++; sim.stats.perfects++;
      if (sim.chain > sim.stats.maxChain) sim.stats.maxChain = sim.chain;
      lastPts = POINTS.perfect * sim.gear;
    } else { gain = FLUX.good; sim.chain = 0; sim.stats.goods++; lastPts = POINTS.good * sim.gear; }
    sim.score += lastPts;
    return gain;
  }
  // Breaking a sector gate pays a gear whatever your flux (flux instead at top gear), lead and points.
  function gateReward() {
    const pts = POINTS.gate * sim.gear;
    sim.score += pts;
    sim.lead = Math.min(LEAD_MAX, sim.lead + LEAD_GATE);
    emit('sectorGate', { sector: sim.sector, pts });
    // banked flux carries over: the old gear's flux is always below the next gear's threshold
    if (sim.gear < MAX_GEAR) { sim.gear++; if (sim.gear > sim.stats.maxGear) sim.stats.maxGear = sim.gear; emit('gearUp', { gear: sim.gear }); }
    else addFlux(FLUX.gate);
  }
  function breakIce(h, pressT) {
    const grade = gradeOf(h, pressT);
    h.state = H_BROKEN; h.hitT = sim.t; h.grade = grade;
    sim.ramT0 = -1; sim.recoverUntil = sim.t;        // a hit cancels recovery: stacked walls can be drummed
    const gain = award(grade);
    emit('breachHit', { grade, kind: KIND_NAME[h.kind], chain: sim.chain, auto: false, pts: lastPts });
    if (h.kind === KIND.GATE) gateReward(); else addFlux(gain);
  }
  // The two shutters of the opening break on their beat even if the player does nothing: the reveal
  // is never gated on skill, and it never lands late.
  function autoBreak(h) {
    h.state = H_BROKEN; h.hitT = sim.t; h.grade = 'good';
    sim.ramT0 = -1; sim.recoverUntil = sim.t; sim.lastRamT = sim.t;
    emit('breach', { auto: true });
    emit('breachHit', { grade: 'good', kind: KIND_NAME[h.kind], chain: 0, auto: true, pts: 0 });
  }

  function arrive(h) {
    const cell = cellAt(h.t0);
    const inMask = (h.mask >> cell) & 1;
    if (h.kind === KIND.PAD) { h.state = H_PASSED; return; }
    if (h.kind === KIND.ORB) {
      if (inMask && sim.alive) {
        h.state = H_TAKEN; orbRun = sim.t - lastPickupT < 3 ? orbRun + 1 : 1; lastPickupT = sim.t;
        sim.stats.orbs++; sim.score += POINTS.orb * sim.gear; emit('orb', { n: orbRun, pts: POINTS.orb * sim.gear }); addFlux(FLUX.orb);
      } else h.state = H_PASSED;
      return;
    }
    if (h.kind === KIND.SPARK) {
      if (inMask && sim.alive) {
        h.state = H_TAKEN; sparkRun = sim.t - lastPickupT < 1.5 ? sparkRun + 1 : 1; lastPickupT = sim.t;
        sim.score += POINTS.spark * sim.gear; emit('spark', { n: sparkRun, pts: POINTS.spark * sim.gear }); addFlux(FLUX.spark);
      } else h.state = H_PASSED;
      return;
    }
    if (!sim.alive) { h.state = H_PASSED; return; }
    if (h.mat === SOLID) {
      h.state = H_PASSED;
      if (inMask) { hit(h); return; }
      if (h.kind === KIND.IRIS) {
        if (cell === CORE) {
          const pts = (sim.flipClean ? POINTS.cleanFlip : POINTS.irisPass) * sim.gear;
          sim.score += pts;
          emit('irisPass', { clean: sim.flipClean, pts });
          addFlux(sim.flipClean ? FLUX.irisClean : FLUX.irisPass);
        }
        return;
      }
      let side = 0;
      if (cell < LANES) {
        const l = (h.mask >> wrap(cell - 1)) & 1, r = (h.mask >> wrap(cell + 1)) & 1;
        if (l && r) { sim.stats.threads++; sim.score += POINTS.thread * sim.gear; emit('thread', { pts: POINTS.thread * sim.gear }); addFlux(FLUX.thread); }
        else if (l || r) { side = r ? 1 : -1; sim.stats.grazes++; sim.score += POINTS.graze * sim.gear; emit('graze', { side, pts: POINTS.graze * sim.gear }); addFlux(FLUX.graze); }
        else if ((h.mask >> wrap(cell + 2)) & 1) side = 1; else if ((h.mask >> wrap(cell - 2)) & 1) side = -1;
      }
      emit('flyby', { side, kind: KIND_NAME[h.kind] });
      return;
    }
    // ICE
    if (h.bay) { autoBreak(h); return; }
    if (!inMask) { h.state = H_PASSED; emit('flyby', { side: 0, kind: KIND_NAME[h.kind] }); return; }
    const late = h.window || RAM_LATE;
    if (sim.ramT0 >= 0 && h.t0 <= sim.ramUntil && sim.ramT0 - h.t0 <= late) { breakIce(h, sim.ramT0); return; }
    // nobody rammed an auto hazard: it breaks itself here, ON the beat. A press that comes inside the
    // late window is still credited (see the breach input below) instead of firing into empty air.
    if (h.auto) { autoBreak(h); graceH = h; graceUntil = h.t0 + late; return; }
    h.state = H_LATE; h.lateUntil = h.t0 + late;
    // One stray press must not swallow the press on the beat: a wall arriving cuts short what is left
    // of an ISOLATED whiff's recovery (it has already cost its flux and the chain). Whiffs in a row
    // keep their full recovery, so mashing BREACH is still no way through.
    if (whiffAlone && sim.recoverUntil > sim.t) sim.recoverUntil = sim.t;
  }

  function tryRoll(dir, tap) {
    if (!sim.alive) return true;
    if (sim.air) {
      // one tap in mid-air shifts the landing lane; holding does nothing up here
      if (tap && !sim.flipSteered) {
        sim.flipTo = wrap(sim.flipTo + dir); sim.flipSteered = true;
        sim.lastRollT = sim.t; sim.lastRollDir = dir; sim.stats.rolls++;
        emit('roll', { dir, lane: sim.flipTo, air: true });
      }
      return true;
    }
    if (sim.t < rollReadyAt) return false;
    const target = wrap(sim.lane + dir);
    if (finAt(target, sim.t)) {
      if (sim.grind !== dir) {
        sim.grind = dir;
        if (!grinding) { grindAcc = 0; grinding = true; emit('rollRefused', { dir }); }
      }
      lastGrindT = sim.t; sim.grindDir = dir;
      return tap;      // a tap is spent on the fin; a hold keeps pushing
    }
    sim.lane = target; rollReadyAt = sim.t + ROLL_INTERVAL;
    sim.lastRollT = sim.t; sim.lastRollDir = dir; sim.stats.rolls++;
    sim.grind = 0;
    emit('roll', { dir, lane: target, air: false });
    return true;
  }

  function onBeat(b) {
    emit('beat', { beat: b, bar: Math.floor(b / 4), downbeat: b % 4 === 0 });
    if (startBeat === 0 && b >= 1 && b <= 3) emit('pip', { n: b });
    if (startBeat === 0 && b === 4) emit('launch', {});
    if (b === DROP_BEAT) {
      if (startBeat > 0) emit('launch', {});
      sim.novaOn = true; sim.lead = LEAD_START;
      emit('drop', {}); emit('novaIgnite', {});
      if (sim.gear < 2) { sim.gear = 2; sim.flux = 0; sim.stats.maxGear = Math.max(sim.stats.maxGear, 2); emit('gearUp', { gear: 2 }); }
    }
    const sec = sectorOfBeat(b);
    if (sim.alive && sec !== sim.sector) { sim.sector = sec; emit('sector', { sector: sec, name: sectorName(sec) }); }
  }

  // ---- public API
  sim.finAt = finAt;
  sim.cellAt = cellAt;
  // actions: 'left' | 'right' | 'flip' | 'breach'
  sim.press = (a) => {
    if (a === 'left' || a === 'right') {
      const d = a === 'left' ? -1 : 1;
      held[d] = true; activeDir = d; heldSince = sim.t; rollPressT = sim.t; rollPressDir = d;
    } else if (a === 'flip') flipPressT = sim.t;
    else if (a === 'breach') breachPressT = sim.t;
  };
  sim.release = (a) => {
    if (a !== 'left' && a !== 'right') return;
    const d = a === 'left' ? -1 : 1;
    held[d] = false;
    if (activeDir === d) { activeDir = held[-d] ? -d : 0; heldSince = sim.t; }
  };
  sim.releaseAll = () => { held[-1] = held[1] = false; activeDir = 0; };
  sim.prompt = () => (sim.alive ? level.promptAt(sim.beat) : null);
  // seconds a hazard materialises before it arrives, at the current speed
  sim.horizon = () => HORIZON / Math.max(sim.speed, GEAR_SPEED[1]);

  sim.step = (dt) => {
    if (!started) { started = true; emit('start', { quick: startBeat > 0 }); }
    const tPrev = sim.t;
    sim.t += dt;
    const t = sim.t;
    sim.beat = timeToBeat(t);
    const beatDur = 60 / bpmAtBeat(sim.beat);

    // ---- new hazards materialise
    const had = hazards.length;
    level.pull(t, sim.horizon(), sim.air ? sim.flipTo : sim.lane, hazards);
    for (let i = had; i < hazards.length; i++) hazards[i].born = t;

    if (sim.alive) {
      // ---- rolls: buffered tap first, then hold-to-repeat / grind
      if (rollPressT >= 0) {
        if (t - rollPressT > ROLL_BUFFER) rollPressT = -1;
        else if (tryRoll(rollPressDir, true)) rollPressT = -1;
      }
      if (activeDir && rollPressT < 0 && !sim.air) {
        if (sim.grind === activeDir || t - heldSince >= ROLL_REPEAT_DELAY) tryRoll(activeDir, false);
      }
      if (sim.grind) {
        if (activeDir !== sim.grind || sim.air || !finAt(wrap(sim.lane + sim.grind), t)) sim.grind = 0;
        else {
          grindAcc += dt; lastGrindT = t;
          if (grindAcc >= beatDur) { grindAcc -= beatDur; sim.score += POINTS.grindPerBeat * sim.gear; emit('grind', { side: sim.grind, pts: POINTS.grindPerBeat * sim.gear }); addFlux(FLUX.grindPerBeat); }
        }
      }
      // a corkscrew re-grinds every beat: only call the grind over once it has really stopped
      if (grinding && t - lastGrindT > 0.2) { grinding = false; sim.grindDir = 0; emit('grindEnd', {}); }
      // ---- flip
      if (flipPressT >= 0) {
        if (t - flipPressT > INPUT_BUFFER) flipPressT = -1;
        else if (!sim.air) {
          flipPressT = -1;
          sim.air = true; sim.flipT0 = t; sim.flipBeat = beatDur; sim.flipDur = FLIP_BEATS * beatDur;
          sim.flipFrom = sim.lane; sim.flipTo = wrap(sim.lane + 4); sim.flipSteered = false; sim.flipClean = false;
          for (let i = 0; i < hazards.length; i++) { const h = hazards[i]; if (h.kind === KIND.PAD && Math.abs(h.t0 - t) <= 0.05) { sim.flipClean = true; break; } }
          sim.stats.flips++;
          emit('flip', { fromLane: sim.flipFrom, toLane: sim.flipTo, clean: sim.flipClean });
        }
      }
      // ---- breach
      if (breachPressT >= 0) {
        if (t - breachPressT > INPUT_BUFFER) breachPressT = -1;
        else if (sim.ramT0 < 0 && t >= sim.recoverUntil) {
          breachPressT = -1;
          if (graceH && t <= graceUntil) {
            // just behind an auto shutter that already broke itself: the press is absorbed into that
            // break and graded as the player's own (no second ram, no whiff)
            const h = graceH; graceH = null;
            const grade = gradeOf(h, t); h.grade = grade;
            const gain = award(grade);
            emit('breachCredit', { grade, kind: KIND_NAME[h.kind], chain: sim.chain, pts: lastPts });
            addFlux(gain);
          } else {
            sim.ramT0 = t; sim.ramUntil = t + RAM_TIME; sim.lastRamT = t;
            emit('breach', { auto: false });
            // late grace: a wall that arrived a moment ago can still be broken
            for (let i = 0; i < hazards.length; i++) { const h = hazards[i]; if (h.state === H_LATE && t <= h.lateUntil && sim.ramT0 >= 0) breakIce(h, t); }
          }
        }
      }
    }

    // ---- hazards: tracking, arrivals, late-grace expiry
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      if (h.state === H_COMING) {
        if (h.trk) {
          // patterns laid out with a late lock follow the runner until they lock on
          const trk = h.trk;
          if (sim.alive && t < trk.lockT) trk.shift = wrap((sim.air ? sim.flipTo : sim.lane) - trk.L0);
          if (h.sh !== trk.shift) {
            h.sh = trk.shift; h.mask = rotateMask(h.mask0, trk.shift);
            if (h.lane0 >= 0) h.lane = wrap(h.lane0 + trk.shift);
            h.trkT = t;
          }
        }
        if (h.t0 <= t) arrive(h);
      } else if (h.state === H_LATE) {
        if (sim.ramT0 >= 0 && sim.ramT0 - h.t0 <= (h.window || RAM_LATE)) breakIce(h, sim.ramT0);
        else if (t > h.lateUntil) { h.state = H_PASSED; hit(h); }
      }
    }
    // ---- flip landing (after arrivals, so a hazard at the landing instant sees the landing lane)
    if (sim.air && t - sim.flipT0 >= sim.flipDur) {
      sim.air = false; sim.lane = sim.flipTo; sim.lastLandT = t; rollReadyAt = t;
      if (sim.alive) emit('land', { lane: sim.lane });
      if (finAt(sim.lane, t)) hit({ kind: KIND.FIN });
    }
    // ---- a ram that ran out without touching anything
    if (sim.alive && sim.ramT0 >= 0 && t >= sim.ramUntil) {
      let waiting = false;
      for (let i = 0; i < hazards.length; i++) if (hazards[i].state === H_LATE) { waiting = true; break; }
      if (!waiting) {
        sim.ramT0 = -1; sim.recoverUntil = t + RAM_RECOVERY; sim.chain = 0; sim.stats.whiffs++;
        whiffAlone = t - lastWhiffT > 0.7; lastWhiffT = t;
        emit('whiff', {}); addFlux(FLUX.whiff);
      }
    }
    // ---- forget hazards that are well behind us
    while (hazards.length && Math.max(hazards[0].t1, hazards[0].t0) < t - 0.7 && hazards[0].state !== H_COMING) hazards.shift();

    // ---- beats, sectors, the drop
    const nb = Math.floor(sim.beat);
    while (lastBeat < nb) { lastBeat++; onBeat(lastBeat); }

    // ---- speed, distance, the nova
    const launched = startBeat > 0 || sim.beat >= 4;
    const target = !sim.alive ? 0 : launched ? GEAR_SPEED[sim.gear] : CREEP_SPEED;
    sim.speed += (target - sim.speed) * (1 - Math.exp(-dt * (sim.alive ? 9 : 2.5)));
    sim.dist += sim.speed * dt;
    if (sim.alive) {
      if (launched) sim.score += sim.speed * dt * sim.gear * POINTS.metre;
      if (sim.novaOn) {
        sim.lead = Math.min(LEAD_MAX, sim.lead + (sim.speed - novaSpeed(sim.sector)) * dt);
        if (sim.sector <= 1 && sim.lead < SPINDLE_LEAD_FLOOR) sim.lead = SPINDLE_LEAD_FLOOR;   // the scripted opening cannot kill
        const lvl = sim.lead < 40 ? 2 : sim.lead < 80 ? 1 : 0;
        if (lvl !== sim.leadLevel) { if (lvl > sim.leadLevel) emit('leadLow', { level: lvl }); else if (lvl === 0) emit('leadSafe', {}); sim.leadLevel = lvl; }
        if (sim.lead <= 0) { sim.lead = 0; sim.alive = false; sim.deadT = 0; sim.grind = 0; emit('death', { cause: 'nova' }); }
      }
    } else sim.deadT += dt;
    return tPrev;
  };

  sim.drain = (out) => { for (let i = 0; i < events.length; i++) out.push(events[i]); events.length = 0; return out; };
  return sim;
}
