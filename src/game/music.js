// game/music.js — the BLUESHIFT soundtrack: a real-time step sequencer over Web Audio.
//
// The song is laid out in beats and reaches seconds only through timeline.js, so the tempo map
// (128 > 132 > ... > 148 BPM, one step per sector) is followed exactly and music.start() can enter at
// any beat. Design choices that matter:
//   - Every tonal voice is a PERSISTENT oscillator stack played by AudioParam automation
//     (setValueAtTime / setTargetAtTime only, which chain cleanly on one param). Polyphony is fixed
//     (about 40 oscillators, whatever the gear) and a busy bar creates no nodes and no garbage.
//   - Drums that need the same punch on every hit (kick, snare, clap, crash) are samples baked at
//     boot by music_kit.js; hats, ride, shaker and risers are gain envelopes over one noise loop.
//   - Gears are layer gains, switched the moment setGear() is called: the band answers a gear-up at
//     once instead of 0.25 s of lookahead later. Only details (hat pattern, filter depth) wait for
//     the next scheduled step.
//   - tapeStop() automates every oscillator's detune, so whatever sounds or is already scheduled
//     inside the window bends down together.
//   - Held notes on persistent voices would ring forever if update() stopped coming (hidden tab), so
//     every update re-arms a fade-out just past the scheduled horizon (keepAlive).
import { clamp, clamp01, hash1 } from '../engine/math.js';
import { bpmAtBeat, beatToTime, timeToBeat, sectorOfBeat, sectorStartBeat, sectorEndBeat, DROP_BEAT } from './timeline.js';
import { renderKit } from './music_kit.js';
import { mtof, BASS_ROOT, SUB_ROOT, ARP_TONES, PAD_NOTES, STAB_NOTES, ARP_SHAPES, ARP_ACC, RIFFS, RIFF_TURN, STAB_STEPS, MEL_NOTE, MEL_LEN, HATS, CLANKS } from './music_song.js';

const LOOKAHEAD = 0.25;   // seconds scheduled ahead of audio.now
const STALL = 0.5;        // further behind than this: skip forward, do not machine-gun stale notes
const TAPE_CENTS = 300;   // tape stop depth: 3 semitones

// Levels. Calibrated with out/music/probe.mjs (solo renders), not by ear.
const MIX = {
  master: 0.57,
  kick: 0.86, clap: 0.5, snare: 0.45, roll: 0.5, hat: 0.75, ohat: 0.6, ride: 0.6, shaker: 0.7, clank: 0.55, tom: 0.5,
  crash: 0.3, boom: 0.6, riser: 0.6, rtone: 0.085, pip: 0.16,
  sub: 0.25, dbass: 0.26, rbass: 0.48, arp: 0.6, arp2: 0.28, delay: 0.55, pad: 0.135, lead: 0.21, stab: 0.15, air: 0.1,
  tick: 0.8, klaxon: 0.45, shep: 0.24, ambPad: 0.07, ambArp: 0.26,
};
const DLY_FB = 0.4;
const CONDUIT = 0.72;                               // conduit velocity: the tunnel is restrained
const CLIP_T = 0.45, CLIP_C = 0.82;                 // soft clipper knee and ceiling (linear amplitude)
const RB_PEAK = [0, 700, 1800, 2400, 3400, 6400];   // rolling-bass filter peak by gear: gear 5 is wide open
const RB_TRIM = [0, 0, 1.2, 1.1, 1, 1];            // ...and it is mixed a little hotter while it has the stage to itself
const AR_PEAK = [0, 2400, 2400, 3800, 4600, 6400];
const HAT_GEAR = [0, 1, 0.85, 1, 1.1, 1.15];
const SHAKE = [0.5, 0.22, 0.4, 0.22];
const TOM_RATE = [1.6, 1.3, 1.0, 0.78];
const PIPS = [77, 80, 84];                          // F5 Ab5 C6: ignition pips climb the F minor triad
const PINGS = [84, 80, 84, 82];                     // conduit sonar ping per chord
const KLAX_HI = mtof(79), KLAX_LO = mtof(73);       // G5 / Db5: the tritone inside F minor
const SHEP_F0 = 174.6, SHEP_STEPS = 128;            // Shepard partials climb 4 octaves (F3..F7) in 32 beats
// arp plan per sector: [shape, inversion]
const ARP_PLAN = [[0, 0], [0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1]];
const AMB_PAD = [[41, 48, 56, 60], [41, 49, 56, 61], [41, 48, 56, 60], [39, 46, 55, 58]];
const AMB_ARP = [[72, 77, 80, 84, 87], [73, 77, 80, 85, 89], [72, 77, 80, 84, 87], [70, 75, 79, 82, 87]];
const AMB_STEP = 0.34, AMB_BAR = 24;

export function createMusic(audio) {
  const ctx = audio.ctx;
  const kit = renderKit(ctx);
  const dbg = { bus: {}, log: null, stats: null };   // dev probes only: solo buses, an event log, counters
  const kitName = new Map();
  for (const k in kit) kitName.set(kit[k], k);

  // ---------------------------------------------------------------- graph helpers
  const autos = [], autoRest = [];     // every param the sequencer automates, and where a reset parks it (NaN = leave)
  const detP = [], detBase = [];       // every pitched source's detune, for the tape stop
  const reg = (param, rest) => { autos.push(param); autoRest.push(rest); return param; };
  const G = (v, dest) => { const g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; };
  const F = (type, f, q, dest) => {
    const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q;
    // envelopes on filters only need one value per render quantum: a-rate would recompute coefficients per sample
    try { n.frequency.automationRate = 'k-rate'; } catch (e) { /* older browsers: stays a-rate */ }
    if (dest) n.connect(dest);
    return n;
  };
  const P = (pan, dest) => {
    if (!ctx.createStereoPanner) return dest;
    const p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(dest); return p;
  };
  const O = (type, dest, detune = 0, freq = 110) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
    o.connect(dest); o.start(); detP.push(o.detune); detBase.push(detune);
    return o;
  };
  const send = (from, amount, to) => { const g = G(amount, to); from.connect(g); return g; };

  // ---------------------------------------------------------------- buses
  const out = G(1, audio.musicBus);
  const songXf = G(1, out);                 // crossfades against the ambient bed
  const gate = G(1, songXf);                // hard stop
  // Soft clipper on the song sum: transparent below 0.45, rounds the kick + bass peaks off under 0.8 so
  // the master limiter is left with headroom for the sound effects.
  const clip = ctx.createWaveShaper();
  const curve = new Float32Array(2049);
  for (let i = 0; i < 2049; i++) {
    const x = (i - 1024) / 1024, a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= CLIP_T ? a : CLIP_T + (CLIP_C - CLIP_T) * Math.tanh((a - CLIP_T) / (CLIP_C - CLIP_T)));
  }
  clip.curve = curve; clip.oversample = '2x'; clip.connect(gate);
  const songBus = G(MIX.master, clip);
  const ambBus = G(0, out);
  const drumBus = G(1, songBus), fxBus = G(1, songBus), dangerBus = G(1, songBus);
  const duckDeep = G(1, songBus), duckLight = G(1, songBus);   // sidechain: bass and pad pump hard, arp and lead a little
  const dDeep = reg(duckDeep.gain, 1), dLight = reg(duckLight.gain, 1);
  const kickBus = G(MIX.kick, drumBus), snBus = G(1, drumBus), hatBus = G(1, drumBus), percBus = G(1, drumBus);
  send(snBus, 0.1, audio.reverbIn);

  // Two readers of the shared noise buffer, out of step with each other: voices that can hit together
  // (hat + ride) must not be the same noise or they add in phase.
  const noiseLoop = (offset) => {
    const n = ctx.createBufferSource();
    n.buffer = audio.noise(); n.loop = true; n.start(0, offset);
    if (n.detune) { detP.push(n.detune); detBase.push(0); }
    return n;
  };
  const nz = noiseLoop(0), nz2 = noiseLoop(0.777);

  // gear layers: [node, first gear, last gear, fade in, fade out]
  const layNode = [], layMin = [], layMax = [], layIn = [], layOut = [];
  const L = {};
  const layer = (name, dest, min, max, tin = 0.012, tout = 0.02) => {
    const g = G(0, dest); L[name] = g; reg(g.gain, 0);   // a reset closes every layer; the first step reopens them
    layNode.push(g); layMin.push(min); layMax.push(max); layIn.push(tin); layOut.push(tout);
    return g;
  };

  // ---------------------------------------------------------------- voices
  // sub: one sine, 8th-note pulse
  const subBus = G(MIX.sub, duckDeep);
  const subGn = G(0, subBus), subG = reg(subGn.gain, 0);
  const subO = O('sine', subGn, 0, 43.65);

  // dark bass: conduit / gear 1 (and the ignition drone)
  const dbBus = G(MIX.dbass, duckDeep);
  layer('dbass', dbBus, 1, 1);
  const dbGn = G(0, L.dbass), dbG = reg(dbGn.gain, 0);
  const dbFl = F('lowpass', 300, 4, dbGn), dbF = reg(dbFl.frequency, NaN);
  const dbSaw = O('sawtooth', G(0.6, dbFl)), dbSq = O('square', G(0.4, dbFl));

  // rolling bass: gear 2+
  const rbBus = G(MIX.rbass, duckDeep);
  layer('rbass', rbBus, 2, 5);
  const rbGn = G(0, L.rbass), rbG = reg(rbGn.gain, 0);
  const rbFl = F('lowpass', 300, 9, rbGn), rbF = reg(rbFl.frequency, NaN);
  const rbS1 = O('sawtooth', G(0.42, rbFl), -8), rbS2 = O('sawtooth', G(0.42, rbFl), 8), rbSq = O('square', G(0.3, rbFl));

  // ping-pong delay (dotted 8th), shared by arps, lead and pips
  const dlyIn = G(1), dlyL = ctx.createDelay(1), dlyR = ctx.createDelay(1);
  const dlyLP = F('lowpass', 3600, 0.7), dlyFbN = G(DLY_FB), dlyMerge = ctx.createChannelMerger(2);
  const dlyOut = G(MIX.delay, duckLight);
  dlyIn.connect(dlyL); dlyL.connect(dlyLP); dlyLP.connect(dlyR); dlyR.connect(dlyFbN); dlyFbN.connect(dlyL);
  dlyL.connect(dlyMerge, 0, 0); dlyR.connect(dlyMerge, 0, 1); dlyMerge.connect(dlyOut);
  dlyL.delayTime.value = dlyR.delayTime.value = 0.3516;
  reg(dlyL.delayTime, NaN); reg(dlyR.delayTime, NaN);
  const dlyFbG = reg(dlyFbN.gain, NaN), dlyOutG = reg(dlyOut.gain, NaN);

  // arp: square + saw pluck, gear 3+
  const arpBus = G(MIX.arp, duckLight);
  layer('arp', arpBus, 3, 5);
  const arGn = G(0, L.arp), arG = reg(arGn.gain, 0);
  const arFl = F('lowpass', 1200, 5, arGn), arF = reg(arFl.frequency, NaN);
  const arSq = O('square', G(0.5, arFl)), arSaw = O('sawtooth', G(0.4, arFl), 9);
  send(arpBus, 0.42, dlyIn); send(arpBus, 0.1, audio.reverbIn);

  // arp 2: octave-up saw sparkle, gear 5
  const a2Bus = G(MIX.arp2, duckLight);
  layer('arp2', a2Bus, 5, 5);
  const a2Gn = G(0, L.arp2), a2G = reg(a2Gn.gain, 0);
  const a2Fl = F('lowpass', 7000, 1, a2Gn);
  const a2A = O('sawtooth', G(0.6, a2Fl), -7), a2B = O('square', G(0.25, a2Fl), 7);
  send(a2Bus, 0.6, dlyIn);

  // pad: three notes x two detuned saws, gear 4+
  const padBus = G(MIX.pad, duckDeep);
  layer('pad', padBus, 4, 5, 0.12, 0.04);
  const padGn = G(0, L.pad), padG = reg(padGn.gain, 0);
  const padFl = F('lowpass', 1500, 0.5, padGn), padF = reg(padFl.frequency, NaN);
  const padHP = F('highpass', 210, 0.7, padFl);   // keeps the pad out of the bass's octave
  const padO = [];
  for (let i = 0; i < 3; i++) { padO.push(O('sawtooth', P(-0.75, padHP), -9 - i)); padO.push(O('sawtooth', P(0.75, padHP), 9 + i)); }
  send(padBus, 0.22, audio.reverbIn);

  // lead: three detuned saws with vibrato, gear 4+
  const leadBus = G(MIX.lead, duckLight);
  layer('lead', leadBus, 4, 5, 0.02, 0.03);
  const ldGn = G(0, L.lead), ldG = reg(ldGn.gain, 0);
  const ldFl = F('lowpass', 2800, 2, ldGn), ldF = reg(ldFl.frequency, NaN);
  const ldO = [O('sawtooth', P(-0.45, ldFl), -12), O('sawtooth', ldFl, 0), O('sawtooth', P(0.45, ldFl), 12)];
  const lfo = ctx.createOscillator(); lfo.frequency.value = 5.3; lfo.start();
  const lfoG = G(7); lfo.connect(lfoG);
  for (let i = 0; i < 3; i++) lfoG.connect(ldO[i].detune);
  send(leadBus, 0.3, dlyIn); send(leadBus, 0.2, audio.reverbIn);

  // stabs: supersaw chord (3 notes x 3 saws), gear 5; the same voice plays the big hit on every sector downbeat
  const stabBus = G(MIX.stab, duckLight);
  layer('stab', stabBus, 5, 5);
  const hitGn = G(0, stabBus), hitG = reg(hitGn.gain, 0);
  const stOut = G(1); stOut.connect(L.stab); stOut.connect(hitGn);
  const stGn = G(0, stOut), stG = reg(stGn.gain, 0);
  const stFl = F('lowpass', 3000, 1, stGn), stF = reg(stFl.frequency, NaN);
  const stHP = F('highpass', 300, 0.7, stFl);
  const stO = [];
  for (let i = 0; i < 3; i++) for (let j = -1; j <= 1; j++) stO.push(O('sawtooth', P(j * 0.85, stHP), j * 16 + i * 2));
  send(stabBus, 0.16, audio.reverbIn);

  // hats, shaker, ride, air: envelopes over the shared noise loop
  const hHP = F('highpass', 7200, 0.9), hLP = F('lowpass', 11000, 0.7);
  nz.connect(hHP); hHP.connect(hLP);
  const chGn = G(0, P(0.18, G(MIX.hat, hatBus))), chG = reg(chGn.gain, 0);
  hLP.connect(chGn);
  layer('ohat', P(-0.18, G(MIX.ohat, hatBus)), 2, 5, 0.004, 0.01);
  const ohGn = G(0, L.ohat), ohG = reg(ohGn.gain, 0);
  hLP.connect(ohGn);
  layer('perc', percBus, 2, 5, 0.004, 0.01);
  const shBP = F('bandpass', 5200, 1.2), shGn = G(0, P(-0.3, G(MIX.shaker, L.perc))), shG = reg(shGn.gain, 0);
  nz2.connect(shBP); shBP.connect(shGn);
  // ride: a band of sizzle with three inharmonic squares under it for the metal
  layer('ride', P(0.3, G(MIX.ride, hatBus)), 5, 5, 0.004, 0.01);
  const rdGn = G(0, L.ride), rdG = reg(rdGn.gain, 0);
  const rdHP = F('highpass', 6200, 0.7, rdGn), rdBP = F('bandpass', 9000, 1.6, rdHP);
  nz2.connect(rdBP);
  O('square', G(0.1, rdHP), 0, 3413); O('square', G(0.1, rdHP), 0, 5119); O('square', G(0.08, rdHP), 0, 7717);
  layer('air', G(MIX.air, duckDeep), 5, 5, 0.2, 0.05);
  const airHP = F('highpass', 5500, 0.7, L.air), airLP = F('lowpass', 10500, 0.7, airHP);
  nz2.connect(airLP);

  // sampled drums
  layer('clap', G(MIX.clap, snBus), 2, 5, 0.003, 0.01);
  layer('snare', G(MIX.snare, snBus), 4, 5, 0.003, 0.01);
  const rollBus = G(MIX.roll, snBus);
  const crashBus = G(MIX.crash, fxBus), boomBus = G(MIX.boom, duckDeep);   // the sub drop pumps under the kick
  send(crashBus, 0.25, audio.reverbIn);

  // risers: swept noise plus a gliding saw
  const rzBP = F('bandpass', 400, 0.8), rzGn = G(0, G(MIX.riser, fxBus)), rzG = reg(rzGn.gain, 0);
  nz.connect(rzBP); rzBP.connect(rzGn);
  try { rzBP.frequency.automationRate = 'a-rate'; } catch (e) { /* default */ }
  const rzF = reg(rzBP.frequency, NaN);
  const rtGn = G(0, G(MIX.rtone, fxBus)), rtG = reg(rtGn.gain, 0);
  const rtFl = F('lowpass', 2400, 1, rtGn);
  const rt1 = O('sawtooth', rtFl, -11, 174.6), rt2 = O('sawtooth', rtFl, 11, 174.6);
  reg(rt1.frequency, NaN); reg(rt2.frequency, NaN);

  // pips (ignition) and sonar pings (conduit)
  const pipBus = G(MIX.pip, fxBus);
  const pipGn = G(0, pipBus), pipG = reg(pipGn.gain, 0);
  const pipO = O('triangle', pipGn, 0, 698);
  send(pipBus, 0.5, dlyIn); send(pipBus, 0.45, audio.reverbIn);

  // danger layer: Geiger ticks, two-tone klaxon, Shepard riser. Levels follow setDanger() at once.
  const tkLv = G(0, dangerBus), kxLv = G(0, dangerBus), shLv = G(0, dangerBus);
  const tkBP = F('bandpass', 4600, 1.2), tkGn = G(0, P(0.35, tkLv)), tkG = reg(tkGn.gain, 0);
  nz.connect(tkBP); tkBP.connect(tkGn);
  const kxGn = G(0, kxLv), kxG = reg(kxGn.gain, 0);
  const kxBP = F('bandpass', 1300, 1.1, kxGn);
  const kxA = O('square', G(0.5, kxBP), 0, KLAX_HI), kxB = O('sawtooth', G(0.5, kxBP), 15, KLAX_HI);
  const shpLP = F('lowpass', 3200, 0.7, shLv);
  const spO = [], spG = [];
  for (let i = 0; i < 4; i++) {
    const g = G(0, shpLP); spG.push(reg(g.gain, 0));
    const o = O('sawtooth', g, 0, SHEP_F0); spO.push(o); reg(o.frequency, NaN);
  }

  dbg.bus = {
    kick: kickBus, snare: snBus, hats: hatBus, perc: percBus, sub: subBus, dbass: dbBus, rbass: rbBus, arp: arpBus, arp2: a2Bus,
    delay: dlyOut, pad: padBus, lead: leadBus, stab: stabBus, air: L.air, fx: fxBus, danger: dangerBus, amb: ambBus,
  };

  // ---------------------------------------------------------------- state
  let running = false, t0 = 0, b0 = 0, off0 = 0;
  let stepIdx = 0, fresh = true, horizon = 0;
  let gear = 1, layerGear = -1, layerT = 0, beatDur = 0;
  let danger = 0, dangerSet = -1, rzOn = false, shpOn = false;
  let tapeA = 0, tapeHold = 0, tapeEnd = 0, tapeTd = 1, tapeTu = 1;
  let ambOn = false, amb = null, ambT = 0, ambN = 0, ambFresh = true;
  let aliveT = 0;
  let hits = 0, steps = 0, logBeat = 0;
  const flags = new Uint8Array(4096);
  const ring = new Array(32).fill(null), ringT = new Float64Array(32);
  let ringI = 0;

  const stepTime = (n) => t0 + beatToTime(n * 0.25) - off0;
  const beatAt = (ctxTime) => timeToBeat(ctxTime - t0 + off0);
  // Offline (scheduleUntil far ahead of the clock) calls take effect at the schedule horizon; live calls now.
  const applyTime = () => { const now = audio.now; return horizon > now + 0.5 ? horizon : now; };
  // The conduit is always the gear-1 arrangement, and the two bars after THE DROP are never thinner than gear 2.
  const effGear = (beat) => (beat < DROP_BEAT ? 1 : beat < DROP_BEAT + 8 ? Math.max(gear, 2) : gear);

  function setLayers(g, t) {
    if (t < layerT) t = layerT + 0.001;
    layerT = t; layerGear = g;
    for (let i = 0; i < layNode.length; i++) {
      const on = g >= layMin[i] && g <= layMax[i];
      layNode[i].gain.setTargetAtTime(on ? (layNode[i] === L.rbass ? RB_TRIM[g] : 1) : 0, t, on ? layIn[i] : layOut[i]);
    }
  }

  function tapeCents(t) {
    if (t < tapeA || t >= tapeEnd) return 0;
    const down = -TAPE_CENTS * (1 - Math.exp(-(Math.min(t, tapeA + tapeHold) - tapeA) / tapeTd));
    return t < tapeA + tapeHold ? down : down * Math.exp(-(t - tapeA - tapeHold) / tapeTu);
  }

  // ---------------------------------------------------------------- one-shots
  function hit(buf, t, vel, dest, rate) {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    if (rate !== 1) s.playbackRate.value = rate;
    if (t < tapeEnd && s.detune) s.detune.value = tapeCents(t);
    if (vel === 1) s.connect(dest); else { const g = ctx.createGain(); g.gain.value = vel; s.connect(g); g.connect(dest); }
    s.start(t);
    ring[ringI] = s; ringT[ringI] = t; ringI = (ringI + 1) & 31;
    hits++;
    if (dbg.log) dbg.log.push([kitName.get(buf), logBeat, +t.toFixed(4), vel]);
  }
  // Reversed crash that ends exactly at tEnd (entered part-way through if there is less room than the sample).
  function revCrash(t, tEnd, vel) {
    const D = kit.rev.duration, st = Math.max(t, tEnd - D);
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = kit.rev;
    g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(vel, st + 0.06);
    s.connect(g); g.connect(crashBus);
    s.start(st, Math.max(0, D - (tEnd - st)));
    ring[ringI] = s; ringT[ringI] = st; ringI = (ringI + 1) & 31;
  }

  function duck(t, amt) {
    const rel = beatDur * 0.19;
    dDeep.setTargetAtTime(1 - 0.9 * amt, t - 0.005, 0.003); dDeep.setTargetAtTime(1, t + 0.04, rel);
    dLight.setTargetAtTime(1 - 0.5 * amt, t - 0.005, 0.003); dLight.setTargetAtTime(1, t + 0.04, rel);
  }
  function kick(t, vel) {
    hit(kit.kick, t, vel, kickBus, 1);
    duck(t, vel);
  }
  function hat(t, vel) { chG.setTargetAtTime(vel, t, 0.0007); chG.setTargetAtTime(0, t + 0.003, 0.012); }
  function openHat(t, tChoke, vel) {
    ohG.setTargetAtTime(vel, t, 0.001); ohG.setTargetAtTime(0, t + 0.006, 0.1); ohG.setTargetAtTime(0, tChoke, 0.006);
  }
  function ride(t, vel) { rdG.setTargetAtTime(vel, t, 0.001); rdG.setTargetAtTime(0, t + 0.004, 0.085); }
  function shaker(t, vel) { shG.setTargetAtTime(vel, t, 0.004); shG.setTargetAtTime(0, t + 0.012, 0.018); }
  // Snare roll for a build bar: 8ths, 8ths, 16ths, 32nds, climbing in level and pitch.
  function roll(t, sd, s, level) {
    const qb = s >> 2, p = s / 16;
    const v = (0.22 + 0.78 * p * Math.sqrt(p)) * level, rate = 0.92 + 0.3 * p;
    if (qb < 2) { if (!(s & 1)) hit(kit.snare, t, v, rollBus, rate); return; }
    hit(kit.snare, t, v, rollBus, rate);
    if (qb === 3) hit(kit.snare, t + sd * 0.5, v * 0.92, rollBus, rate);
  }
  // Noise sweep + gliding saw, drawn as chained ramps one step at a time so it can start anywhere.
  function riser(t, t1, p, p1, level, last) {
    if (!rzOn) {
      rzOn = true;
      rzG.setValueAtTime(level * p * p, t); rzF.setValueAtTime(350 * Math.pow(26, p), t);
      rtG.setValueAtTime(p * p, t);
      rt1.frequency.setValueAtTime(174.6 * Math.pow(4, p), t); rt2.frequency.setValueAtTime(174.6 * Math.pow(4, p), t);
    }
    rzG.linearRampToValueAtTime(level * p1 * p1, t1); rzF.exponentialRampToValueAtTime(350 * Math.pow(26, p1), t1);
    rtG.linearRampToValueAtTime(p1 * p1, t1);
    rt1.frequency.exponentialRampToValueAtTime(174.6 * Math.pow(4, p1), t1); rt2.frequency.exponentialRampToValueAtTime(174.6 * Math.pow(4, p1), t1);
    if (last) { rzG.linearRampToValueAtTime(0, t1 + 0.005); rtG.linearRampToValueAtTime(0, t1 + 0.005); rzOn = false; }
  }
  function riserOff(t) {
    if (!rzOn) return;
    rzOn = false;
    rzG.cancelScheduledValues(t); rzG.setValueAtTime(0, t); rtG.cancelScheduledValues(t); rtG.setValueAtTime(0, t);
  }

  // ---------------------------------------------------------------- notes (all automation on persistent voices)
  function noteSub(t, tOff, f, vel) {
    subO.frequency.setValueAtTime(f, t);
    subG.setTargetAtTime(vel, t, 0.005); subG.setTargetAtTime(0, tOff, 0.018);
  }
  function noteDark(t, tOff, f, cut, vel) {
    dbSaw.frequency.setValueAtTime(f, t); dbSq.frequency.setValueAtTime(f, t);
    dbF.setTargetAtTime(cut * 1.5, t, 0.004); dbF.setTargetAtTime(cut * 0.8, t + 0.02, 0.06);
    dbG.setTargetAtTime(vel, t, 0.004); dbG.setTargetAtTime(0, tOff, 0.02);
  }
  function noteRoll(t, tOff, f, peak, vel) {
    rbS1.frequency.setValueAtTime(f, t); rbS2.frequency.setValueAtTime(f, t); rbSq.frequency.setValueAtTime(f, t);
    rbF.setTargetAtTime(peak, t, 0.003); rbF.setTargetAtTime(150 + peak * 0.2, t + 0.012, 0.05);
    rbG.setTargetAtTime(vel, t, 0.003); rbG.setTargetAtTime(0, tOff, 0.012);
  }
  function noteArp(t, f, vel, peak) {
    arSq.frequency.setValueAtTime(f, t); arSaw.frequency.setValueAtTime(f, t);
    arF.setTargetAtTime(peak, t, 0.002); arF.setTargetAtTime(700, t + 0.008, 0.05);
    arG.setTargetAtTime(vel, t, 0.002); arG.setTargetAtTime(0, t + 0.012, 0.07);
  }
  function noteArp2(t, f, vel) {
    a2A.frequency.setValueAtTime(f, t); a2B.frequency.setValueAtTime(f, t);
    a2G.setTargetAtTime(vel, t, 0.002); a2G.setTargetAtTime(0, t + 0.01, 0.045);
  }
  function noteLead(t, tOff, f, vel, bright) {
    ldO[0].frequency.setValueAtTime(f, t); ldO[1].frequency.setValueAtTime(f, t); ldO[2].frequency.setValueAtTime(f, t);
    ldF.setTargetAtTime(bright, t, 0.008); ldF.setTargetAtTime(bright * 0.7, t + 0.05, 0.14);
    ldG.setTargetAtTime(vel, t, 0.01); ldG.setTargetAtTime(vel * 0.72, t + 0.06, 0.12); ldG.setTargetAtTime(0, tOff - 0.035, 0.018);
  }
  function noteStab(t, tOff, vel) {
    stF.setTargetAtTime(8500, t, 0.003); stF.setTargetAtTime(3200, t + 0.02, 0.11);
    stG.setTargetAtTime(vel, t, 0.003); stG.setTargetAtTime(0, tOff, 0.03);
  }
  // The arrival chord on THE DROP and every sector gate: a supersaw chord held for three beats, pumping
  // under the kick, whatever the gear.
  function stabHit(t, tOff, vel) {
    hitG.setTargetAtTime(1.8, t - 0.004, 0.001); hitG.setTargetAtTime(0, tOff + 0.2, 0.03);
    stF.setTargetAtTime(9000, t, 0.004); stF.setTargetAtTime(1300, t + 0.03, 0.4);
    stG.setTargetAtTime(vel, t, 0.004); stG.setTargetAtTime(vel * 0.6, t + 0.05, 0.3); stG.setTargetAtTime(0, tOff, 0.06);
  }
  function notePip(t, midi, vel, len) {
    pipO.frequency.setValueAtTime(mtof(midi), t);
    pipG.setTargetAtTime(vel, t, 0.003); pipG.setTargetAtTime(0, t + 0.02, len);
  }
  function setChord(t, chord) {
    const pn = PAD_NOTES[chord], sn = STAB_NOTES[chord];
    for (let i = 0; i < 3; i++) {
      const pf = mtof(pn[i]), sf = mtof(sn[i]);
      padO[i * 2].frequency.setValueAtTime(pf, t); padO[i * 2 + 1].frequency.setValueAtTime(pf, t);
      stO[i * 3].frequency.setValueAtTime(sf, t); stO[i * 3 + 1].frequency.setValueAtTime(sf, t); stO[i * 3 + 2].frequency.setValueAtTime(sf, t);
    }
  }

  // ---------------------------------------------------------------- the song
  // Beats 0-4. Near silence: a drone that slowly opens, three climbing pips, a reverse cymbal into beat 4.
  function stepIgnition(n, t, t1, first) {
    const beat = n * 0.25, sd = t1 - t;
    if (n === 0 || first) {
      dbSaw.frequency.setValueAtTime(mtof(41), t); dbSq.frequency.setValueAtTime(mtof(29), t);
      dbG.setTargetAtTime(0.5, t, 0.35);
    }
    dbF.setTargetAtTime(90 + 300 * (beat / 4) * (beat / 4), t, sd);
    if (n === 4 || n === 8 || n === 12) notePip(t, PIPS[(n >> 2) - 1], 0.55 + 0.15 * (n >> 2), 0.09);
    if (n >= 8) {
      riser(t, t1, (beat - 2) / 2, (beat - 1.75) / 2, 0.8, n === 15);
      if (n === 8 || first) revCrash(t, stepTime(16), 0.5);
    }
    if (n === 15) dbG.setTargetAtTime(0, t1 - 0.03, 0.008);
  }

  // Beats 4-20. Kick, closed hats, sub pulse and a dark bass; then THE BUILD (16-20) with the hole on beat 19.
  function stepConduit(n, t, t1, first) {
    const beat = n * 0.25, bar = n >> 4, s = n & 15, sd = t1 - t, chord = bar & 3;
    const build = beat >= 16, hole = beat >= 19;
    if (n === 16) { hit(kit.boom, t, 0.5, boomBus, 1); hit(kit.crash, t, 0.3, crashBus, 1); }
    if (!hole) {
      // held back about 3 dB so THE DROP has somewhere to go
      if (!(n & 3)) kick(t, CONDUIT);
      const hv = HATS[0][s];
      if (hv) hat(t, hv);
      if (!(n & 1)) {
        noteSub(t, t + 1.3 * sd, mtof(SUB_ROOT[chord]), CONDUIT);
        const cut = build ? 300 * Math.pow(4.5, (beat - 16) / 3) : 300;
        noteDark(t, t + 1.4 * sd, mtof(BASS_ROOT[chord] + (s === 14 && (bar & 1) ? 12 : 0)), cut, CONDUIT);
      }
    }
    if (!build && s === 8) notePip(t, PINGS[chord], 0.3, 0.16);
    if (build) {
      roll(t, sd, s, 1);
      riser(t, t1, s / 16, (s + 1) / 16, 1, s === 15);
      if (s === 8 || (first && s > 8)) revCrash(t, stepTime(n - s + 16), 0.5);
    }
  }

  // Beat 20 on: the arrangement is always fully sequenced; the gear layers decide what is heard.
  function stepMain(n, t, t1, first, g) {
    const beat = n * 0.25, bar = n >> 4, s = n & 15, sub = n & 3, sd = t1 - t, chord = bar & 3;
    const sector = sectorOfBeat(beat), secStart = sectorStartBeat(sector), secEnd = sectorEndBeat(sector);
    const secBar = (beat - secStart) >> 2;
    const fill = beat >= secEnd - 4;                       // last bar of the sector: the player is the drum fill
    const fl = bar < flags.length ? flags[bar] : 0;
    const noDrums = fill || (fl & 2) !== 0, noSnare = noDrums || (fl & 1) !== 0, build = !fill && (fl & 4) !== 0;
    const phraseEnd = chord === 0;
    const pos = s / 16, pos1 = (s + 1) / 16;

    if (s === 0 || first) {
      setChord(t, chord);
      padG.setTargetAtTime(1, t, 0.18);
      padF.setTargetAtTime(g >= 5 ? 2700 : 1500, t, 0.3);
    }
    // arrivals: THE DROP and every sector gate get crash + sub drop + chord hit; a lighter crash every 8 bars
    const arrival = sector === 1 ? 4 : 1;                  // bars that open with the arrival chord (THE DROP gets a whole phrase)
    if (s === 0 && beat === secStart) {
      hit(kit.crash, t, 1, crashBus, 1); hit(kit.boom, t, sector === 1 ? 1 : 0.8, boomBus, 1);
      if (dbg.log) dbg.log.push(['sector', beat, +t.toFixed(4), sector, bpmAtBeat(beat)]);
    } else if (s === 0 && secBar > 0 && !(secBar & 7) && !fill) hit(kit.crash, t, 0.5, crashBus, 1);
    if (s === 0 && secBar < arrival) stabHit(t, t + 13 * sd, (secBar ? 0.75 : 1) * (g >= 4 ? 0.65 : 1));   // quieter under a full band
    if ((s === 8 || (first && s > 8)) && !((secBar + 1) & 7) && !fill) revCrash(t, stepTime(n - s + 16), 0.3);
    if (fill) {
      if (s === 0 || first) revCrash(t, stepTime(n - s + 16), 0.55);
      riser(t, t1, pos, pos1, 1, s === 15);
    } else if (build) {
      riser(t, t1, pos, pos1, 0.8, s === 15);
      roll(t, sd, s, 0.85);
    }

    // ---- drums
    if (!sub) { if (noDrums) duck(t, 0.8); else kick(t, 1); }
    if (!noDrums) {
      if (s === 14 && phraseEnd && g >= 3) hit(kit.kick, t, 0.7, kickBus, 1);
      if (sector >= 5 && s === 15 && (secBar & 1)) hit(kit.kick, t, 0.55, kickBus, 1);
      const mode = g === 1 ? 0 : sector <= 1 ? 1 : sector === 2 ? 2 : sector === 3 ? 3 : (secBar & 4) ? 2 : 3;
      const hv = HATS[mode][s];
      // closed and open hat are the same noise: never stack them on one step (they would add in phase)
      if (hv && (g === 1 || sub !== 2)) hat(t, hv * HAT_GEAR[g]);
      if (sector >= 4 && s >= 12 && (secBar & 1) && g >= 3) hat(t + sd * 0.5, 0.3);
      if (sub === 2) openHat(t, t + 2 * sd - 0.012, 0.8);
      if (sector >= 3) shaker(t, SHAKE[sub]);
      if (!(n & 1)) ride(t, sub ? 0.5 : 0.8); else if (sector >= 5) ride(t, 0.28);
      if (sector >= 2) { const cv = CLANKS[sector & 1][s]; if (cv) hit(kit.clank, t, cv * MIX.clank, L.perc, sector & 1 ? 1 : 1.26); }
      if (!noSnare) {
        if (s === 4 || s === 12) { hit(kit.clap, t, 1, L.clap, 1); hit(kit.snare, t, 1, L.snare, 1); }
        if (phraseEnd && !build && s >= 12) {
          // every phrase ends with a pickup: snare ghosts, or toms on alternate phrases from the Foundry on
          if (sector >= 3 && (secBar & 4)) hit(kit.tom, t, 0.75 * MIX.tom, L.perc, TOM_RATE[s - 12]);
          else if (s === 13 || s === 15) hit(kit.snare, t, s === 13 ? 0.35 : 0.6, L.clap, 1);
        }
      }
    }

    // ---- low end
    if (!(n & 1)) {
      if (!fill) noteSub(t, t + 1.3 * sd, mtof(SUB_ROOT[chord]), 1);
      noteDark(t, t + 1.4 * sd, mtof(BASS_ROOT[chord] + (fill ? 12 : 0)), fill ? 340 * Math.pow(3, pos) : 360, 1);
    }
    if (!fill || !(n & 1)) {
      const riff = phraseEnd && !fill ? RIFF_TURN : RIFFS[sector <= 2 ? 0 : (sector + (secBar >> 2)) % 3];
      const off = fill ? 12 : riff[s];                       // the fill bar lifts the bass an octave: the floor drops away
      // from the Foundry on the bass filter breathes over 8 bars
      const move = sector >= 3 ? Math.pow(2, 0.45 * Math.sin((secBar + pos) * 0.785)) : 1;
      const wide = sector === 1 && beat < DROP_BEAT + 16 ? Math.max(RB_PEAK[g], beat < DROP_BEAT + 8 ? 3600 : 3600 - 260 * (beat - DROP_BEAT - 8)) : RB_PEAK[g];
      const peak = wide * (fill ? 0.5 + pos : off >= 12 ? 1.5 : off ? 1.25 : 1) * move;
      noteRoll(t, t + (fill ? 1.2 : 0.64) * sd, mtof(BASS_ROOT[chord] + off), Math.min(peak, 12000), off && !fill ? 1 : 0.8);
    }

    // ---- arps
    const plan = ARP_PLAN[sector < ARP_PLAN.length ? sector : 1 + ((sector - 1) & 7)];
    const tones = ARP_TONES[chord], shape = plan[0];
    let ai = ARP_SHAPES[shape][s] + plan[1];
    let am = ai < 6 ? tones[ai] : tones[ai - 3] + 12;
    noteArp(t, mtof(am), ARP_ACC[shape & 1][s], AR_PEAK[g] * (fill ? 0.6 + 0.8 * pos : 1));
    ai = ARP_SHAPES[(shape + 1) & 3][s];
    am = tones[ai] + 12;
    noteArp2(t, mtof(am), ARP_ACC[(shape + 1) & 1][s]);

    // ---- counter-melody
    const mi = sector & 1 ? 0 : 1, mk = ((secBar & 7) << 4) | s, mn = MEL_NOTE[mi][mk];
    if (mn) noteLead(t, stepTime(n + MEL_LEN[mi][mk]), mtof(mn), 1, g >= 5 ? 7000 : 4600);

    // ---- stabs (the sector's first bar belongs to the arrival hit)
    if ((secBar >= arrival || s >= 10) && STAB_STEPS[phraseEnd ? 1 : sector >= 4 && (secBar & 4) ? 2 : 0][s]) noteStab(t, t + 1.5 * sd, 1);
  }

  // Nova proximity. Ticks and klaxon are sequenced only while danger is up; their loudness is immediate.
  function stepDanger(n, t, t1, first) {
    const d = danger;
    if (d < 0.3) {
      if (shpOn) { shpOn = false; for (let i = 0; i < 4; i++) spG[i].linearRampToValueAtTime(0, t1); }
      return;
    }
    const sd = t1 - t, p = clamp01((d - 0.3) / 0.6);
    // Geiger counter: irregular at first, every 16th (and some 32nds) at the end
    if (hash1(n * 7 + 3) < 0.12 + 0.88 * p * p) {
      const v = 0.45 + 0.55 * hash1(n + 99);
      tkG.setTargetAtTime(v, t, 0.0004); tkG.setTargetAtTime(0, t + 0.002, 0.007);
    }
    if (p > 0.75 && hash1(n * 5 + 11) < p - 0.4) { tkG.setTargetAtTime(0.5, t + sd * 0.5, 0.0004); tkG.setTargetAtTime(0, t + sd * 0.5 + 0.002, 0.007); }
    // two-tone klaxon on the beat: hi / lo on alternate beats, and both inside every beat once it is critical
    if (!(n & 1)) {
      const crit = d > 0.8, on = crit || !(n & 3);
      if (on) {
        const f = (crit ? n >> 1 : n >> 2) & 1 ? KLAX_LO : KLAX_HI;
        kxA.frequency.setValueAtTime(f, t); kxB.frequency.setValueAtTime(f, t);
        kxG.setTargetAtTime(1, t, 0.006); kxG.setTargetAtTime(0, t + 1.6 * sd, 0.02);
      }
    }
    // Shepard riser: four partials an octave apart, each fading in at the bottom and out at the top
    for (let i = 0; i < 4; i++) {
      const k = (n + i * (SHEP_STEPS >> 2)) % SHEP_STEPS, u = k / SHEP_STEPS, u1 = (k + 1) / SHEP_STEPS;
      const o = spO[i].frequency, g = spG[i];
      if (!shpOn || first || k === 0) { o.setValueAtTime(SHEP_F0 * Math.pow(16, u), t); g.setValueAtTime(Math.pow(Math.sin(Math.PI * u), 2), t); }
      o.exponentialRampToValueAtTime(SHEP_F0 * Math.pow(16, u1), t1);
      g.linearRampToValueAtTime(Math.pow(Math.sin(Math.PI * u1), 2), t1);
    }
    shpOn = true;
  }

  function step(n, t, t1) {
    const beat = n * 0.25, first = fresh;
    fresh = false; logBeat = beat; steps++;
    const g = effGear(beat);
    if (g !== layerGear) setLayers(g, t);
    if (first || !(n & 15)) {
      const bd = 60 / bpmAtBeat(beat);
      if (bd !== beatDur) {   // new sector, new tempo: the echo follows
        beatDur = bd;
        dlyL.delayTime.setTargetAtTime(bd * 0.75, t, 0.03); dlyR.delayTime.setTargetAtTime(bd * 0.75, t, 0.03);
      }
    }
    if (beat < 4) stepIgnition(n, t, t1, first);
    else if (beat < DROP_BEAT) stepConduit(n, t, t1, first);
    else stepMain(n, t, t1, first, g);
    stepDanger(n, t, t1, first);
  }

  function schedule(until) {
    let t = stepTime(stepIdx);
    while (t < until) {
      const t1 = stepTime(stepIdx + 1);
      step(stepIdx, t, t1);
      stepIdx++; t = t1;
    }
  }

  // Park every voice at time t: cancels everything scheduled from t on and silences what was sounding.
  function resetVoices(t) {
    for (let i = 0; i < autos.length; i++) {
      const p = autos[i], r = autoRest[i];
      p.cancelScheduledValues(t);
      if (r === r) p.setValueAtTime(r, t);
    }
    for (let i = 0; i < ring.length; i++) {
      if (ring[i] && ringT[i] > t - 3) { try { ring[i].stop(t); } catch (e) { /* already stopped */ } }
      ring[i] = null;
    }
    // the echo still holds the old run: mute it until the line has emptied
    dlyFbG.setValueAtTime(0, t); dlyFbG.setValueAtTime(DLY_FB, t + 0.8);
    dlyOutG.setValueAtTime(0, t); dlyOutG.setValueAtTime(MIX.delay, t + 0.8);
    rzOn = false; shpOn = false;
  }

  // Dead-man's switch. Pads, risers and the drone are held notes on persistent voices: if update() stops
  // coming (hidden tab, a pause that leaves the context running) they would ring forever. So every call
  // re-arms a fade-out just past what has been scheduled; it only ever plays out when the calls stop.
  function keepAlive(now, until) {
    const g = out.gain;
    g.cancelScheduledValues(now);
    // always re-assert: issued only once after a gap, the un-fade is removed again by the next frame's
    // cancel and the bus stays silent for the rest of the session (measured: 8 of 10 stalls of 0.6 s)
    g.setTargetAtTime(1, now, 0.02);
    aliveT = until + 0.2;
    g.setTargetAtTime(0, aliveT, 0.06);
  }

  // ---------------------------------------------------------------- ambient bed (title / results)
  function ambBuild() {
    const padFl = F('lowpass', 420, 1.5, G(MIX.ambPad, ambBus));
    const o = [O('sawtooth', P(-0.6, padFl), -8, 87.3), O('sawtooth', P(0.6, padFl), 8, 130.8), O('sawtooth', P(-0.3, padFl), 5, 207.7), O('sawtooth', P(0.3, padFl), -5, 261.6)];
    const arpBusA = G(MIX.ambArp, ambBus);
    const lp = F('lowpass', 2600, 0.7, arpBusA);
    const gn = G(0, lp), ao = O('triangle', gn, 0, 698);
    const d = ctx.createDelay(1.5), fb = G(0.55);
    d.delayTime.value = AMB_STEP * 1.5;
    lp.connect(d); d.connect(fb); fb.connect(d); d.connect(P(0.5, G(0.7, arpBusA)));
    send(ambBus, 0.35, audio.reverbIn);   // post-fader: nothing reaches the reverb while the bed is off
    amb = { o, cut: padFl.frequency, ao, g: gn.gain };
  }
  function ambStep(k, t) {
    const c = (Math.floor(k / AMB_BAR)) & 3;
    if (ambFresh || k % AMB_BAR === 0) {
      for (let i = 0; i < 4; i++) amb.o[i].frequency.setTargetAtTime(mtof(AMB_PAD[c][i]), t, ambFresh ? 0.01 : 0.5);
      ambFresh = false;
    }
    amb.cut.setTargetAtTime(540 + 230 * Math.sin(k * 0.21), t, 0.5);
    const h = hash1(k * 31 + 7);
    if (h < 0.5) {
      amb.ao.frequency.setValueAtTime(mtof(AMB_ARP[c][Math.floor(hash1(k * 17 + 5) * 5)]), t);
      amb.g.setTargetAtTime(0.35 + 1.3 * h, t, 0.004); amb.g.setTargetAtTime(0, t + 0.02, 0.13);
    }
  }
  function ambSchedule(now, until) {
    if (!ambOn) return;
    if (ambT < now - STALL) ambT = now + 0.02;
    while (ambT < until) { ambStep(ambN, ambT); ambN++; ambT += AMB_STEP; }
  }

  // ---------------------------------------------------------------- API
  const music = {
    get running() { return running; },
    get bpm() { return running ? bpmAtBeat(Math.max(0, beatAt(audio.now))) : 128; },

    // Song beat `fromBeat` sounds at context time `when`. Works from any beat (retries use 18).
    start(when, fromBeat = 0) {
      const now = audio.now;
      if (when === undefined) when = now + 0.05;
      const tR = Math.max(now, when - 0.01);
      resetVoices(tR);
      gate.gain.cancelScheduledValues(tR); gate.gain.setValueAtTime(1, tR);
      t0 = when; b0 = Math.max(0, fromBeat); off0 = beatToTime(b0);
      stepIdx = Math.ceil(b0 * 4 - 1e-6);
      fresh = true; layerGear = -1; layerT = tR; beatDur = 0;
      running = true;
      if (ambOn) music.setAmbient(false);   // a run never starts under the title bed
    },
    // Hard cut.
    stop(when = audio.now, fade = 0.05) {
      if (!running) return;
      schedule(when);
      running = false;
      gate.gain.cancelScheduledValues(when); gate.gain.setTargetAtTime(0, when, Math.max(0.001, fade / 4));
      resetVoices(when + fade);
    },
    // Live: call once per frame.
    update() {
      const now = audio.now;
      horizon = now + LOOKAHEAD;
      keepAlive(now, horizon);
      ambSchedule(now, horizon);
      if (!running) return;
      if (stepTime(stepIdx) < now - STALL) {
        // the page stalled: rejoin the song where it is now instead of replaying what was missed
        stepIdx = Math.ceil(beatAt(now + 0.03) * 4);
        fresh = true;
        riserOff(now);
        if (dbg.log) dbg.log.push(['skip', stepIdx / 4, +now.toFixed(4)]);
      }
      schedule(horizon);
    },
    // Offline: schedule everything up to ctxTime.
    scheduleUntil(ctxTime) {
      horizon = ctxTime;
      keepAlive(audio.now, ctxTime);
      ambSchedule(audio.now, ctxTime);
      if (running) schedule(ctxTime);
    },

    setGear(g) {
      g = clamp(Math.round(g), 1, 5);
      if (g === gear) return;
      gear = g;
      if (!running) return;
      const t = Math.max(applyTime(), layerT + 0.001), eg = effGear(beatAt(t));
      if (eg !== layerGear) setLayers(eg, t);
    },
    setIntensity(x) { music.setGear(1 + Math.round(clamp01(x) * 4)); },
    // Arrangement cues from the level for one song bar. Passing {} clears the bar.
    setBarFlags(bar, f) {
      if (bar >= 0 && bar < flags.length) flags[bar] = f ? (f.noSnare ? 1 : 0) | (f.noDrums ? 2 : 0) | (f.build ? 4 : 0) : 0;
    },
    clearBarFlags() { flags.fill(0); },
    // Nova proximity 0..1. The layer fades in from about 0.35 and is an emergency at 1.
    setDanger(x) {
      x = clamp01(x);
      // called every frame: only touch the gains when the value really moved (and always land exactly on 0 and 1)
      if (Math.abs(x - dangerSet) < 0.01 && !(x === 0 && dangerSet !== 0) && !(x === 1 && dangerSet !== 1)) { danger = x; return; }
      danger = dangerSet = x;
      const t = applyTime();
      // audible from the moment lead drops under 80 m (danger 0.47), then rising all the way to the end
      const a = clamp01((x - 0.3) / 0.3), b = clamp01((x - 0.45) / 0.55), c = clamp01((x - 0.4) / 0.6);
      tkLv.gain.setTargetAtTime(MIX.tick * a, t, 0.08);
      kxLv.gain.setTargetAtTime(MIX.klaxon * (b > 0 ? 0.5 + 0.5 * b : 0), t, 0.08);
      shLv.gain.setTargetAtTime(MIX.shep * c * (0.5 + 0.5 * c), t, 0.12);
    },
    // Crash: everything sounding or scheduled inside the window bends down 3 semitones and recovers,
    // while the bus low-pass closes and reopens.
    tapeStop(when = audio.now, seconds = 0.5) {
      const a = Math.max(when, audio.now);
      seconds = Math.max(0.05, seconds);
      tapeA = a; tapeHold = seconds * 0.45; tapeEnd = a + seconds; tapeTd = seconds * 0.1; tapeTu = seconds * 0.14;
      for (let i = 0; i < detP.length; i++) {
        const p = detP[i], b = detBase[i];
        p.cancelScheduledValues(a);
        p.setTargetAtTime(b - TAPE_CENTS, a, tapeTd); p.setTargetAtTime(b, a + tapeHold, tapeTu); p.setValueAtTime(b, tapeEnd);
      }
      for (let i = 0; i < ring.length; i++) {   // drum hits already scheduled inside the window
        const s = ring[i];
        if (s && s.detune && ringT[i] >= a - 0.3 && ringT[i] < tapeEnd) {
          s.detune.setTargetAtTime(-TAPE_CENTS, a, tapeTd); s.detune.setTargetAtTime(0, a + tapeHold, tapeTu);
        }
      }
      audio.setMusicLowpass(380, 0.025, a);
      audio.setMusicLowpass(20000, seconds * 0.2, a + seconds * 0.5);
    },
    // Title / results bed. Crossfades against the song.
    setAmbient(on) {
      on = !!on;
      if (on === ambOn) return;
      ambOn = on;
      const t = applyTime();
      if (on) {
        if (!amb) ambBuild();
        ambT = t + 0.02; ambFresh = true;
        ambBus.gain.cancelScheduledValues(t); ambBus.gain.setTargetAtTime(1, t, 0.5);
        songXf.gain.cancelScheduledValues(t); songXf.gain.setTargetAtTime(0, t, 0.4);
      } else {
        ambBus.gain.cancelScheduledValues(t); ambBus.gain.setTargetAtTime(0, t, 0.1);
        songXf.gain.cancelScheduledValues(t); songXf.gain.setTargetAtTime(1, t, 0.03);
      }
    },
    beatAt,
    chordAt(beat) { return ((Math.floor(beat / 4) % 4) + 4) % 4; },
    _dbg: dbg,
  };
  // sources = every always-running generator: oscillators + the noise loop + the vibrato LFO (the ambient bed adds 5)
  dbg.stats = () => ({ sources: detP.length + 1, params: autos.length, steps, hits });
  return music;
}
