// game/patterns.js — the hazard vocabulary and every hand-designed pattern. Pure data and logic.
//
// A pattern is a function (p, o) that places hazards with a builder `p`. Beats are relative to the
// pattern start; lanes are OFFSETS from L, the runner's lane when the pattern materialises, and are
// mirrored by p.dir, so each pattern shows up rotated and flipped around wherever the player is.
import { LANES, CORE, TICKS_PER_BEAT } from './config.js';

export const SOLID = 1;
export const ICE = 2;
export const KIND = {
  BLOCK: 1, FIN: 2, IRIS: 3, SPOKE: 4, MINE: 5, PLATE: 6,        // solids
  WALL: 7, PYLON: 8, GATE: 9, SHUTTER: 10, COREICE: 11,           // ice
  PAD: 12, ORB: 13, SPARK: 14,                                     // harmless: launch pad, pickups
};
export const KIND_NAME = ['', 'block', 'fin', 'iris', 'spoke', 'mine', 'plate', 'wall', 'pylon', 'gate', 'shutter', 'core', 'pad', 'orb', 'spark'];
export const ALL_LANES = (1 << LANES) - 1;          // 0b011111111
export const CORE_BIT = 1 << CORE;                  // 0b100000000
export const ALL_CELLS = ALL_LANES | CORE_BIT;
// rotate the lane bits of a cell mask by `shift` lanes (the core bit stays put)
export const rotateMask = (mask, shift) => { const l = mask & ALL_LANES; return (((l << shift) | (l >> (LANES - shift))) & ALL_LANES) | (mask & CORE_BIT); };

// ---- builder
export function createBuilder(out, prompts, barFlags) {
  const p = {
    at: 0,        // absolute start beat of the pattern
    L: 0,         // resolved lane
    dir: 1,       // +1 or -1 (mirror)
    tier: 2,      // sector-driven difficulty tier
    lane(o) { return (((p.L + p.dir * o) % LANES) + LANES) % LANES; },
    mask(offsets) { let m = 0; for (let i = 0; i < offsets.length; i++) m |= 1 << p.lane(offsets[i]); return m; },
    add(beat, kind, mat, mask, lenBeats, extra) {
      const h = {
        id: 0, kind, mat, mask,
        tick: Math.round((p.at + beat) * TICKS_PER_BEAT), len: Math.round((lenBeats || 0) * TICKS_PER_BEAT),
        t0: 0, t1: 0, state: 0, lane: -1, born: 0, auto: false, window: 0, hitT: 0, grade: '',
      };
      if (extra) for (const k in extra) h[k] = extra[k];
      out.push(h);
      return h;
    },
    // magenta slab on the given lane offsets, one tick long
    block(beat, offsets) { return p.add(beat, KIND.BLOCK, SOLID, p.mask(offsets), 0); },
    // long wall on one lane
    fin(beat, offset, lenBeats) { return p.add(beat, KIND.FIN, SOLID, 1 << p.lane(offset), lenBeats, { lane: p.lane(offset) }); },
    // ring across all eight lanes with the core open; launch pad half a beat earlier
    iris(beat, opts) {
      p.add(beat - 0.5, KIND.PAD, 0, ALL_LANES, 0);
      const h = p.add(beat, KIND.IRIS, SOLID, ALL_LANES, 0);
      if (!opts || opts.orb !== false) p.add(beat, KIND.ORB, 0, CORE_BIT, 0);
      return h;
    },
    // half ring: `count` lanes centred on offset `centre`, no pad (roll or flip, your choice)
    arc(beat, centre, count) {
      const offs = [];
      for (let i = 0; i < count; i++) offs.push(centre - Math.floor(count / 2) + i);
      return p.add(beat, KIND.BLOCK, SOLID, p.mask(offs), 0, { arc: true });
    },
    // bar through the core joining two opposite lanes
    spoke(beat, offset) { return p.add(beat, KIND.SPOKE, SOLID, (1 << p.lane(offset)) | (1 << p.lane(offset + 4)) | CORE_BIT, 0, { lane: p.lane(offset) }); },
    mine(beat) { return p.add(beat, KIND.MINE, SOLID, CORE_BIT, 0); },
    // yellow ICE across everything: breach it
    wall(beat, extra) { p.snare(beat); return p.add(beat, KIND.WALL, ICE, ALL_CELLS, 0, extra); },
    pylon(beat, offset) { return p.add(beat, KIND.PYLON, ICE, 1 << p.lane(offset), 0, { lane: p.lane(offset) }); },
    // ICE wall with magenta plates over some lanes
    plated(beat, plateOffsets) { p.add(beat, KIND.PLATE, SOLID, p.mask(plateOffsets), 0); return p.wall(beat); },
    // iris whose hole is filled with ICE: flip on the pad, breach in mid-air
    lock(beat) {
      p.add(beat - 0.5, KIND.PAD, 0, ALL_LANES, 0);
      p.add(beat, KIND.IRIS, SOLID, ALL_LANES, 0, { locked: true });
      p.snare(beat);
      return p.add(beat, KIND.COREICE, ICE, CORE_BIT, 0);
    },
    orb(beat) { return p.add(beat, KIND.ORB, 0, CORE_BIT, 0); },
    // a trail of lane pips from beat a to beat b on one lane offset (or a function of the step index)
    sparks(a, b, offset, step = 0.5) {
      let i = 0;
      for (let t = a; t <= b + 1e-6; t += step, i++) {
        const o = typeof offset === 'function' ? offset(i) : offset;
        p.add(t, KIND.SPARK, 0, 1 << p.lane(o), 0, { lane: p.lane(o) });
      }
    },
    gate(beat) { p.snare(beat); return p.add(beat, KIND.GATE, ICE, ALL_CELLS, 0); },
    shutter(beat, extra) { return p.add(beat, KIND.SHUTTER, ICE, ALL_CELLS, 0, extra); },
    prompt(a, b, kind, dir = 0) { prompts.push({ b0: p.at + a, b1: p.at + b, kind, dir: dir * p.dir }); },
    // tell the soundtrack to leave the snare out of the bar a wall lands in: the player's hit replaces it
    snare(beat) { const bar = Math.floor((p.at + beat) / 4); const f = barFlags[bar] || (barFlags[bar] = {}); f.noSnare = true; },
    drumsOff(beat) { const bar = Math.floor((p.at + beat) / 4); const f = barFlags[bar] || (barFlags[bar] = {}); f.noDrums = true; },
  };
  return p;
}

// ---- the patterns. Each returns nothing; `beats` below is how much song each one occupies.
const P = {
  // -- scripted opening pieces
  bayShutter(p) { p.shutter(0, { auto: true, bay: true }); },
  // (in the opening these are laid out with a late `lock`, so they follow the runner's lane until they lock on)
  aimed(p) { p.prompt(-1.5, -0.05, 'roll'); p.block(0, [0]); },
  firstWall(p) { p.prompt(-1.6, 0.1, 'breach'); p.wall(0, { window: 0.2 }); },
  flank(p) { p.block(0, [-1, 1]); },
  dropShutter(p) { p.prompt(-2, 0.1, 'breach'); p.shutter(0, { auto: true, drop: true, window: 0.2 }); },
  irisPair(p, o) {
    if (o && o.tutorial) p.prompt(-1.5, 0.3, 'flip');
    p.iris(0.5); p.iris(4.5);
  },
  irisWall(p) { p.iris(0.5); p.wall(2); },

  // -- the vocabulary
  // SLALOM: blocks alternate sides every beat. The tight line grazes every time.
  slalom(p, o) {
    const n = (o && o.beats) || 4;
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) p.block(i, [0, 1]); else p.block(i, [-1, -2]);
      if (p.tier >= 4 && i >= 2) { if (i % 2 === 0) p.block(i + 0.5, [-1, -2]); else p.block(i + 0.5, [0, 1]); }
    }
    p.sparks(0, n - 1, (i) => (i % 2 === 0 ? -1 : 0), 1);
  },
  // CORKSCREW: two fins bound a two-lane channel that turns one lane per beat. Hold toward the
  // leading fin to grind it while the city drills around you. Ends in an ICE wall.
  corkscrew(p, o) {
    const steps = (o && o.steps) || 8;
    const leadIn = o && o.leadIn !== undefined ? o.leadIn : 1;     // beats of straight channel before it starts turning
    const reverseAt = p.tier >= 4 && !(o && o.tutorial) ? Math.floor(steps / 2) : -1;
    if (o && o.tutorial) p.prompt(-leadIn, steps - 1, 'hold', 1);
    if (leadIn > 0) { p.fin(-leadIn, -1, leadIn); p.fin(-leadIn, 2, leadIn); }
    let c = 0, d = 1; // channel = lanes {c, c + 1}, fins just outside it; it steps one lane per beat in direction d
    for (let i = 0; i < steps; i++) {
      if (i === reverseAt) d = -1;
      p.fin(i, c - 1, 1); p.fin(i, c + 2, 1);
      if (i > 0) p.sparks(i, i, d > 0 ? c + 1 : c, 1);
      c += d;
    }
    p.wall(steps);
  },
  // THREAD GATE: seven lanes blocked, one open two lanes over, telegraphed by a spark trail.
  threadGate(p, o) {
    const open = (o && o.open) || 2;
    const offs = [];
    for (let i = 0; i < LANES; i++) if (i !== ((open % LANES) + LANES) % LANES) offs.push(i);
    p.sparks(0, 1.5, open, 0.5);
    p.block(2, offs);
    if (p.tier >= 3) {
      const offs2 = [];
      const open2 = open - 3;
      for (let i = 0; i < LANES; i++) if (i !== ((open2 % LANES) + LANES) % LANES) offs2.push(i);
      p.sparks(2.5, 3.5, open2, 0.5);
      p.block(4, offs2);
    }
  },
  // IRIS LADDER: flip, flip (, flip). An orb waits in every hole.
  irisLadder(p) {
    if (p.tier >= 3) {
      p.iris(0.5); p.iris(1.5); p.iris(2.5);
      if (p.tier >= 4) p.block(3.25, [4, 5]);     // a block lands beside your touchdown: steer or roll
    } else { p.iris(0.5); p.iris(2.5); }
  },
  // BLIND BREACH: a slab hides behind the lattice, in your lane.
  blind(p) { p.wall(0); p.block(p.tier >= 3 ? 0.5 : 1, [0]); },
  // PLATED ICE: the wall is armoured where you stand. Roll to a bare lane, then breach.
  plated(p) {
    if (p.tier >= 4) { p.sparks(0, 1.5, 3, 0.5); p.plated(2, [-2, -1, 0, 1, 2, 5]); }
    else { p.sparks(0, 1.5, 2, 0.5); p.plated(2, [-1, 0, 1]); }
  },
  // PYLON RUN: optional ICE in your own lane. Stand and drum it for flux, or step aside for nothing.
  pylons(p) {
    p.pylon(0, 0); p.pylon(1, 0); p.block(1, [2]); p.pylon(2, 0);
    if (p.tier >= 3) { p.pylon(2.5, 0); p.block(3, [-1, 1]); } else p.pylon(3, 0);
  },
  // PROPELLER: a spoke on every beat, turning one lane per beat. Walk ahead of the blade.
  propeller(p, o) {
    const n = (o && o.beats) || 6;
    for (let i = 0; i < n; i++) {
      p.spoke(i, i - 1);
      if (p.tier >= 5) p.spoke(i, i + 1);
    }
    p.sparks(0, n - 1, (i) => i, 1);
  },
  // ORB BAIT: half rings under you on the off-beat with an orb each: flip to harvest. The last one
  // hides a mine in the core, so that one must be rolled.
  orbBait(p) {
    p.arc(0.5, 0, 5); p.orb(0.5);
    p.arc(1.5, 4, 5); p.orb(1.5);
    p.arc(2.5, 0, 5); p.orb(2.5);
    p.arc(3.75, 4, 5); p.mine(3.75);
  },
  // IRIS LOCK: flip on the beat, breach on the "and".
  irisLock(p) {
    p.lock(0.5);
    if (p.tier >= 5) { p.sparks(1.5, 2.5, 6, 0.5); p.block(3, [3, 4, 5, 7, 0]); }
  },
  // SWITCHBACK: flip into a lane that is about to be hit: steer in mid-air or roll on touchdown.
  switchback(p) {
    p.iris(0.5); p.block(1, [4]);
    p.iris(2.5); p.block(3, [-1, 0, 1]);
  },
  // FAKE: a half ring with a mine in the core: the flip you have learned is the wrong answer.
  fake(p) { p.arc(1, 0, 5); p.mine(1); p.sparks(0, 0.5, 3, 0.5); },
  // DRUM FILL: the drums drop out and four walls arrive on four beats. You are the fill.
  fill(p) {
    p.drumsOff(0);
    if (p.tier >= 4) { p.wall(0); p.wall(1); p.wall(2); p.wall(2.5); p.wall(3); p.wall(3.5); }
    else { p.wall(0); p.wall(1); p.wall(2); p.wall(3); }
  },
  gate(p) { p.gate(0); },
};

// name -> { beats occupied, minimum sector, weight }
export const POOL = {
  slalom: { beats: 4, tier: 2, w: 3 },
  threadGate: { beats: 3, tier: 2, w: 3, beats3: 5 },
  irisLadder: { beats: 4, tier: 2, w: 3 },
  blind: { beats: 2, tier: 2, w: 3 },
  pylons: { beats: 4, tier: 2, w: 2 },
  corkscrew: { beats: 10, tier: 2, w: 2, lead: 1 },
  plated: { beats: 3, tier: 3, w: 3 },
  propeller: { beats: 6, tier: 3, w: 2 },
  orbBait: { beats: 5, tier: 3, w: 2 },
  fake: { beats: 2, tier: 3, w: 2 },
  irisLock: { beats: 2, tier: 4, w: 3 },
  switchback: { beats: 4, tier: 4, w: 2 },
};
export const patternBeats = (name, tier) => (name === 'threadGate' && tier >= 3 ? 5 : name === 'irisLock' && tier >= 5 ? 4 : POOL[name].beats);
export const PATTERN_FN = P;

// The hand-authored opening: [absolute beat, pattern name, options]. Fixed direction (+1), never mirrored.
// `lock: n` keeps a pattern centred on the runner's lane until n beats before its start beat: it is aimed at YOU.
export const OPENING = [
  [4, 'bayShutter'],
  [8, 'aimed', { lock: 1.5 }], [10, 'aimed', { lock: 1.5 }], [12, 'firstWall'], [13, 'flank', { lock: 1 }], [16, 'aimed', { lock: 1.5 }],
  [20, 'dropShutter'],
  [22, 'corkscrew', { steps: 10, tutorial: true, leadIn: 1, lock: 1 }],
  [33, 'threadGate', { open: 2, lock: 0.5 }],
  [38, 'irisPair', { tutorial: true }],
  [44, 'slalom', { beats: 4 }],
  [48, 'blind'], [52, 'irisWall'], [55, 'threadGate', { open: -2, lock: 1 }], [60, 'slalom', { beats: 4 }],
  [64, 'fill'], [68, 'gate'],
];
