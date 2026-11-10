// game/level.js — turns patterns into the stream of hazards for one run. Pure and seeded.
// Sectors 0 and 1 are the hand-authored opening; later sectors are assembled from the pattern pool,
// 8-13 patterns with a little air between them, always ending in the drum fill and the sector gate.
import { sectorStartBeat, sectorEndBeat, beatToTime, timeToBeat, tickToTime } from './timeline.js';
import { makeRng } from '../engine/math.js';
import { createBuilder, PATTERN_FN, POOL, OPENING, patternBeats } from './patterns.js';

export function createLevel(seed, opts = {}) {
  const rng = makeRng(seed);
  const startBeat = opts.startBeat || 0;
  const instances = [];      // { beat, name, o, dir, tier }
  let nextInstance = 0;
  let generatedSector = 1;
  const pending = [];        // resolved hazards waiting for their turn, sorted by time
  const prompts = [];        // { b0, b1, kind, dir }
  const barFlags = {};       // bar -> { noSnare, noDrums }
  const builder = createBuilder(pending, prompts, barFlags);
  let idCounter = 1;
  let resolvedCount = 0;

  for (const [beat, name, o] of OPENING) if (beat > startBeat) instances.push({ beat, name, o: o || null, dir: 1, tier: 2 });

  function generateSector(s) {
    const b0 = sectorStartBeat(s), b1 = sectorEndBeat(s);
    const tier = Math.min(s, 6);
    const air = s <= 2 ? 2 : s <= 4 ? 1.5 : 1;
    const fillStart = b1 - 4;
    let b = b0 + 2, last = '', guard = 0;
    while (guard++ < 40) {
      let total = 0;
      const names = [];
      for (const n in POOL) {
        if (POOL[n].tier > tier || n === last) continue;
        if (b + patternBeats(n, tier) > fillStart - 1) continue;
        names.push(n);
        total += POOL[n].w * (POOL[n].tier === s ? 2.2 : 1);   // show off what is new in this sector
      }
      if (!names.length) break;
      let r = rng() * total, pick = names[0];
      for (const n of names) { r -= POOL[n].w * (POOL[n].tier === s ? 2.2 : 1); if (r <= 0) { pick = n; break; } }
      const lead = POOL[pick].lead || 0;
      instances.push({ beat: b + lead, name: pick, o: null, dir: rng.sign(), tier });
      b = Math.ceil(b + patternBeats(pick, tier) + air);
      last = pick;
    }
    instances.push({ beat: fillStart, name: 'fill', o: null, dir: 1, tier });
    instances.push({ beat: b1, name: 'gate', o: null, dir: 1, tier });
  }

  function resolve(inst, lane) {
    const from = pending.length;
    builder.at = inst.beat; builder.L = lane; builder.dir = inst.dir; builder.tier = inst.tier;
    PATTERN_FN[inst.name](builder, inst.o);
    // late lock: the pattern stays centred on the runner until `lock` beats before its start
    const trk = inst.o && inst.o.lock ? { L0: lane, shift: 0, lockT: beatToTime(inst.beat - inst.o.lock) } : null;
    for (let i = from; i < pending.length; i++) {
      const h = pending[i];
      h.id = idCounter++;
      if (trk) { h.trk = trk; h.mask0 = h.mask; h.lane0 = h.lane; }
      h.t0 = tickToTime(h.tick);
      h.t1 = h.len ? tickToTime(h.tick + h.len) : h.t0;
      h.pattern = inst.name;
    }
    // keep hazards in time order; at the same instant pads/pickups first, then solids, then ice
    pending.sort((a, b) => a.tick - b.tick || a.mat - b.mat);
    resolvedCount++;
  }

  return {
    seed, barFlags, prompts, instances,
    get resolvedCount() { return resolvedCount; },
    // Hand over every hazard that should exist by time `t` when hazards materialise `horizon` seconds
    // before they arrive. `lane` is where the runner is now: new patterns are laid out around it.
    pull(t, horizon, lane, out) {
      const ahead = timeToBeat(t + horizon) + 12;
      while (sectorStartBeat(generatedSector + 1) < ahead) generateSector(++generatedSector);
      // resolve two beats early: some patterns begin with a lead-in before their nominal start beat
      while (nextInstance < instances.length && beatToTime(instances[nextInstance].beat - 2) - horizon <= t) resolve(instances[nextInstance++], lane);
      while (pending.length && pending[0].t0 - horizon <= t) out.push(pending.shift());
    },
    // The tutorial prompt active at a song beat, or null.
    promptAt(beat) {
      if (opts.prompts === false) return null;
      for (let i = 0; i < prompts.length; i++) { const p = prompts[i]; if (beat >= p.b0 && beat < p.b1) return p; }
      return null;
    },
  };
}
