// game/sfx.js — every sound effect in the game, synthesized at call time (no samples, no assets).
//
//   const sfx = createSfx(audio);
//   sfx.play('breachHit', { when, vol, pan, pitch, grade: 'perfect', chord: 0, chain: 3, kind: 'wall' });
//   sfx.loop('wind', 0.6, { pan: 0 });      // continuous beds: 'grind' | 'wind' | 'haze', level 0 releases
//   sfx.stopAll();
//
// Everything tonal sits in F minor (the soundtrack's key). One-shots are built from a handful of bricks
// (tone, hiss, kick, stab, glass, sparkle) into a per-sound voice: voice gain -> panner -> sfxBus, with an
// optional reverb send. Voices are counted per name so rapid repeats steal the oldest instead of piling up,
// and every voice disconnects itself when its last source ends.
//
// Timing notes for whoever maps events to sounds:
//   launch   the cannon thump lands exactly at `when` if it is scheduled >= 0.13 s ahead (the whip leads in);
//            fired "now" the whip is squeezed to 50 ms, so the thump is 50 ms late.
//   death    the reverse swell starts at `when`, the boom lands 0.45 s later.
//   gearUp / sector / sectorGate accept an optional `bpm` (default 128) so their figures sit on 16ths.
import { makeRng } from '../engine/math.js';

const SCALE = [0, 2, 3, 5, 7, 8, 10, 12];           // F natural minor, one octave: the 8 lanes
const PENTA = [0, 3, 5, 7, 10];                     // F minor pentatonic
// chord 0 Fm, 1 Db, 2 Ab, 3 Eb: stab voicings (MIDI) and the lowest three chord tones from C5 up (sparkles)
const STAB = [[53, 60, 65, 68, 72], [49, 56, 61, 65, 68], [56, 60, 63, 68, 72], [51, 58, 63, 67, 70]];
const LADDER = [[72, 77, 80], [73, 77, 80], [72, 75, 80], [75, 79, 82]];
const FM_ARP = [65, 68, 72, 77, 80, 84, 89];        // F minor triad climbing from F4 (gear-up figure)
const SPARK_STEPS = [0, 3, 5, 8, 10];               // the same pentatonic, counted from C
const F1 = 43.654;
const sparkNote = (i) => 84 + SPARK_STEPS[i % 5] + 12 * ((i / 5) | 0);

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const NO = Object.freeze({});

// name: [trim (linear gain, tuned with the probe), max voices, min seconds between triggers, priority]
// priority 0 = constant gameplay chatter (first to be stolen), 1 = hits, 2 = set pieces.
const DEF = {
  launch: [0.42, 1, 0.1, 2],
  uiStart: [0.29, 1, 0.1, 2],
  uiTick: [0.47, 2, 0.012, 0],
  pause: [0.55, 1, 0.05, 1],
  resume: [0.55, 1, 0.05, 1],
  roll: [0.5, 3, 0.02, 0],
  rollRefused: [0.28, 2, 0.04, 0],
  flip: [0.59, 2, 0.05, 1],
  land: [0.28, 2, 0.03, 0],
  ram: [0.42, 2, 0.03, 1],
  whiff: [0.47, 1, 0.05, 0],
  breachHit: [0.3, 3, 0.02, 1],
  graze: [0.58, 3, 0, 0],
  thread: [0.67, 2, 0.03, 0],
  flyby: [0.72, 2, 0.04, 0],
  orb: [0.55, 3, 0.02, 0],
  spark: [0.53, 3, 0.02, 0],
  gearUp: [0.375, 1, 0.1, 1],
  gearDown: [0.43, 1, 0.1, 1],
  crash: [0.375, 1, 0.1, 2],
  stumble: [0.2, 1, 0.08, 1],
  sector: [0.63, 1, 0.1, 1],
  sectorGate: [0.265, 1, 0.1, 2],
  leadLow: [0.35, 1, 0.1, 1],
  leadSafe: [0.65, 1, 0.1, 0],
  results: [0.67, 2, 0.03, 0],
  drop: [0.265, 1, 0.2, 2],
  death: [0.33, 1, 0.2, 2],
  novaIgnite: [0.34, 1, 0.2, 2],
};
const LOOP_TRIM = { grind: 0.3, wind: 0.18, haze: 0.165 };
const MAX_VOICES = 20;

export function createSfx(audio) {
  const ctx = audio.ctx;
  const rng = makeRng(0xb1e5);                      // deterministic variation (tinkle times, noise offsets)
  const noiseBuf = audio.noise();
  const active = [];
  const lastAt = Object.create(null);
  const build = Object.create(null);
  const loopBuild = Object.create(null);
  const loops = { grind: null, wind: null, haze: null };
  // every reverb send goes through one highpass: a 2.6 s tail of sub-bass is mud under the music
  const verb = ctx.createBiquadFilter();
  verb.type = 'highpass'; verb.frequency.value = 320; verb.Q.value = 0.5;
  verb.connect(audio.reverbIn);

  const mkCurve = (fn) => { const c = new Float32Array(1025); for (let i = 0; i < 1025; i++) c[i] = fn(i / 512 - 1); return c; };
  const SOFT = mkCurve((x) => Math.tanh(2.2 * x));
  const HARD = mkCurve((x) => Math.tanh(9 * x) * 0.8);
  // crackle gate: silent until the (slow random) input gets near the rails, then opens fast
  const GATE = mkCurve((x) => { const a = (Math.abs(x) - 0.74) / 0.26; return a > 0 ? a * a : 0; });

  // ---------------------------------------------------------------- bricks

  const G = (val) => { const g = ctx.createGain(); g.gain.value = val; return g; };
  const F = (type, freq, q) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 0.7; return f; };
  const P = (pan) => { const p = ctx.createStereoPanner(); p.pan.value = pan; return p; };
  const SH = (curve) => { const s = ctx.createWaveShaper(); s.curve = curve; return s; };
  function link(a, b, c, d, e) { a.connect(b); if (c) { b.connect(c); if (d) { c.connect(d); if (e) d.connect(e); } } return a; }

  function track(v, s, t1) { s.stop(t1); v.srcs.push(s); if (t1 > v.end) { v.end = t1; v.last = s; } return s; }
  function O(v, type, freq, t0, t1) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.start(t0);
    return track(v, o, t1);
  }
  function N(v, t0, t1, rate) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    if (rate) s.playbackRate.value = rate;
    s.start(t0, rng() * 1.9);
    return track(v, s, t1);
  }

  // envelopes. `dec` is the time to fall 60 dB, so the audible body is roughly dec / 2.
  function perc(p, t, peak, dec, att) {
    att = att || 0.001;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + att);
    p.exponentialRampToValueAtTime(peak * 0.001, t + att + dec);
  }
  // reversed shape: exponential rise then a short fall
  function swell(p, t, peak, rise, fall) {
    p.setValueAtTime(peak * 0.006, t);
    p.exponentialRampToValueAtTime(peak, t + rise);
    p.exponentialRampToValueAtTime(peak * 0.001, t + rise + fall);
  }
  function sweep(p, t, a, b, dur) { p.setValueAtTime(a, t); p.exponentialRampToValueAtTime(b, t + dur); }

  // one enveloped oscillator, optionally gliding f0 -> f1 over `sw` seconds
  function tone(v, dest, type, t, f0, f1, sw, peak, dec, att) {
    const o = O(v, type, f0, t, t + (att || 0.001) + dec + 0.02), g = G(0);
    if (f1) sweep(o.frequency, t, f0, f1, sw);
    perc(g.gain, t, peak, dec, att);
    o.connect(g); g.connect(dest);
    return o;
  }
  // one enveloped, filtered noise burst, optionally sweeping the filter
  function hiss(v, dest, ftype, t, f0, f1, sw, q, peak, dec, att) {
    const n = N(v, t, t + (att || 0.001) + dec + 0.02), f = F(ftype, f0, q), g = G(0);
    if (f1) sweep(f.frequency, t, f0, f1, sw);
    perc(g.gain, t, peak, dec, att);
    link(n, f, g, dest);
    return g;
  }
  // the same two, with the reversed (swelling) envelope
  function toneUp(v, dest, type, t, f0, f1, peak, rise, fall) {
    const o = O(v, type, f0, t, t + rise + fall + 0.02), g = G(0);
    if (f1) sweep(o.frequency, t, f0, f1, rise);
    swell(g.gain, t, peak, rise, fall);
    o.connect(g); g.connect(dest);
    return o;
  }
  function hissUp(v, dest, ftype, t, f0, f1, q, peak, rise, fall) {
    const n = N(v, t, t + rise + fall + 0.02), f = F(ftype, f0, q), g = G(0);
    if (f1) sweep(f.frequency, t, f0, f1, rise);
    swell(g.gain, t, peak, rise, fall);
    link(n, f, g, dest);
    return g;
  }
  // drum body: pitch falls fast then settles (time constant `tc`), instant attack
  function kick(v, dest, t, f0, f1, tc, peak, dec, type) {
    const o = O(v, type || 'sine', f0, t, t + dec + 0.03), g = G(0);
    o.frequency.setValueAtTime(f0, t); o.frequency.setTargetAtTime(f1, t, tc);
    perc(g.gain, t, peak, dec, 0.0012);
    o.connect(g); g.connect(dest);
    return o;
  }
  // bell: fundamental + octave + a short glassy upper partial
  function bell(v, dest, t, f, peak, dec) {
    tone(v, dest, 'sine', t, f, 0, 0, peak, dec, 0.0015);
    tone(v, dest, 'sine', t, f * 2, 0, 0, peak * 0.32, dec * 0.5, 0.001);
    tone(v, dest, 'sine', t, f * 4.16, 0, 0, peak * 0.12, dec * 0.18, 0.001);
  }
  // supersaw chord stab through a closing lowpass
  function stab(v, dest, t, notes, from, n, peak, dec, cut0, cut1, pm, att) {
    const end = t + dec + 0.04;
    const mix = G(0.7 / Math.sqrt(n)), f = F('lowpass', cut0, 1.6), g = G(0);
    sweep(f.frequency, t, cut0, cut1, dec * 0.6);
    perc(g.gain, t, peak, dec, att || 0.003);
    for (let i = 0; i < n; i++) {
      const fr = mtof(notes[from + i]) * pm;
      const a = O(v, 'sawtooth', fr, t, end), b = O(v, 'sawtooth', fr, t, end);
      a.detune.value = -8 - i * 2; b.detune.value = 9 + i * 2;
      a.connect(mix); b.connect(mix);
    }
    link(mix, f, g, dest);
  }
  // a run of small bells up the chord tones; `start` shifts the whole run up the ladder
  function sparkle(v, dest, t, chord, start, n, peak, step, pm) {
    const lad = LADDER[chord];
    for (let i = 0; i < n; i++) {
      const idx = start + i, f = mtof(lad[idx % 3] + 12 * ((idx / 3) | 0)) * pm, tt = t + i * step;
      tone(v, dest, 'sine', tt, f, 0, 0, peak, 0.24, 0.001);
      tone(v, dest, 'triangle', tt, f * 2, 0, 0, peak * 0.3, 0.1, 0.001);
    }
  }
  // breaking glass: a crack, a band of noise sweeping upward as the pieces get smaller, sizzle, and
  // `count` tinkles tuned to the chord. `wide` > 0.4 splits it into two decorrelated sides.
  function glass(v, dest, t, peak, len, top, wide, count, chord) {
    let L = dest, R = dest;
    if (wide > 0.4) { L = P(-wide); R = P(wide); L.connect(dest); R.connect(dest); }
    hiss(v, L, 'bandpass', t, 1500, top, 0.2 * len, 3.2, peak * 1.5, 0.34 * len, 0.001);
    if (L !== R) hiss(v, R, 'bandpass', t, 2100, top * 0.85, 0.25 * len, 3.2, peak * 1.5, 0.38 * len, 0.001);
    hiss(v, L, 'highpass', t, 2500, 0, 0, 0.7, peak * 0.5, 0.06, 0.0005);
    hiss(v, R, 'highpass', t, 6500, 0, 0, 0.7, peak * 0.5, 0.5 * len, 0.002);
    const lad = LADDER[chord];
    for (let i = 0; i < count; i++) {
      const tt = t + 0.012 + (i + rng()) / count * 0.34 * len;
      const f = mtof(lad[i % 3] + 24 + 12 * ((rng() * 2) | 0)) * (0.985 + rng() * 0.03);
      tone(v, i & 1 ? L : R, 'sine', tt, f, 0, 0, peak * (0.1 + 0.12 * rng()), 0.05 + 0.1 * rng(), 0.0008);
    }
  }
  // Doppler pass: a buzzing saw whose pitch falls as the thing goes by
  function zip(v, dest, t, f0, f1, dur, peak) {
    const end = t + dur + 0.06;
    const o = O(v, 'sawtooth', f0, t, end), o2 = O(v, 'square', f0 * 0.5, t, end), bp = F('bandpass', f0 * 2.4, 2.2), g = G(0);
    sweep(o.frequency, t, f0, f1, dur); sweep(o2.frequency, t, f0 * 0.502, f1 * 0.502, dur);
    sweep(bp.frequency, t, f0 * 2.4, f1 * 2.4, dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(peak * 0.001, t + dur + 0.04);
    o.connect(bp); o2.connect(bp); bp.connect(g); g.connect(dest);
    hiss(v, dest, 'bandpass', t, f0 * 4, f1 * 3, dur, 1.4, peak * 0.45, dur, 0.006);
  }
  // a heavy metal door giving way: inharmonic plate partials ringing, then debris rattling off after it
  function clang(v, dest, t, peak) {
    const bp = F('bandpass', 1100, 0.6); bp.connect(dest);
    tone(v, bp, 'square', t, 147, 0, 0, 0.3 * peak, 0.9, 0.001);
    tone(v, bp, 'square', t, 219.5, 0, 0, 0.26 * peak, 0.8, 0.001);
    tone(v, bp, 'square', t, 331, 0, 0, 0.22 * peak, 0.7, 0.001);
    tone(v, bp, 'square', t, 518, 0, 0, 0.2 * peak, 0.55, 0.001);
    tone(v, bp, 'square', t, 787, 0, 0, 0.16 * peak, 0.45, 0.001);
    tone(v, bp, 'square', t, 1213, 0, 0, 0.12 * peak, 0.3, 0.001);
    for (let i = 0; i < 3; i++) {
      const tt = t + 0.11 + i * 0.1 + rng() * 0.03, a = peak * (0.2 - i * 0.05);
      tone(v, bp, 'square', tt, 620 + 240 * i, 0, 0, a, 0.12, 0.0008);
      tone(v, bp, 'square', tt, (620 + 240 * i) * 1.47, 0, 0, a, 0.1, 0.0008);
      hiss(v, dest, 'bandpass', tt, 3200, 0, 0, 1.2, a * 1.5, 0.04, 0.0005);
    }
  }
  // crash / stumble: distorted noise impact + low thud + a falling tone + bent metal
  function wreck(v, t, size, pm) {
    const drv = SH(SOFT); drv.connect(v.out);
    const end = t + 0.5 * size + 0.05;
    const n = N(v, t, end), ng = G(0), hs = SH(HARD), lp = F('lowpass', 5200 * pm, 0.8), og = G(0.9);
    perc(ng.gain, t, 1, 0.48 * size, 0.001);
    sweep(lp.frequency, t, 5200 * pm, 420 * pm, 0.4 * size);
    link(n, ng, hs, lp, og); og.connect(v.out);
    kick(v, drv, t, 96 * pm, 34 * pm, 0.05 * size, 1, 0.52 * size);
    const o = O(v, 'sawtooth', 392 * pm, t, t + 0.66 * size), fl = F('lowpass', 1800 * pm, 2), fg = G(0);
    sweep(o.frequency, t, 392 * pm, 55 * pm, 0.55 * size);
    perc(fg.gain, t, 0.55, 0.62 * size, 0.004);
    link(o, fl, fg, drv);
    tone(v, v.out, 'square', t, 233 * pm, 196 * pm, 0.2 * size, 0.1, 0.22 * size, 0.001);
    tone(v, v.out, 'square', t, 492 * pm, 440 * pm, 0.2 * size, 0.07, 0.16 * size, 0.001);
  }

  // ---------------------------------------------------------------- voices

  function dispose(v) {
    v.out.disconnect(); v.pn.disconnect();
    if (v.sg) v.sg.disconnect();
  }
  function open(name, t, o, pan, send) {
    const out = ctx.createGain(), pn = ctx.createStereoPanner();
    out.gain.value = DEF[name][0] * (o.vol !== undefined ? o.vol : 1);
    pn.pan.value = clamp(o.pan !== undefined ? o.pan : pan, -1, 1);
    out.connect(pn); pn.connect(audio.sfxBus);
    let sg = null;
    if (send > 0) { sg = ctx.createGain(); sg.gain.value = send; pn.connect(sg); sg.connect(verb); }
    const v = { name, out, pn, sg, t0: t, end: t, last: null, srcs: [], pri: DEF[name][3], big: false };
    active.push(v);
    return v;
  }
  function seal(v) {
    if (v.last) v.last.onended = () => dispose(v);
  }
  // fade a voice out fast (steal / stopAll) and stop its sources shortly after
  function cut(v, t, tc) {
    v.out.gain.cancelScheduledValues(t);
    v.out.gain.setTargetAtTime(0, t, tc);
    const stopAt = t + tc * 8;
    if (v.end > stopAt) {
      for (let i = 0; i < v.srcs.length; i++) { try { v.srcs[i].stop(stopAt); } catch (e) { /* already ended */ } }
      v.end = stopAt;
    }
  }
  function sweepDead(now) {
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].end <= now) { active[i] = active[active.length - 1]; active.pop(); }
    }
  }
  const near = (a, t) => a !== undefined && Math.abs(a - t) < 0.06;
  // called by the set pieces: halve any big breach that started on the same instant
  function yieldBig(t) {
    for (let i = 0; i < active.length; i++) {
      const v = active[i];
      if (v.big && near(v.t0, t)) { v.big = false; v.out.gain.setValueAtTime(v.out.gain.value * 0.5, t); }
    }
  }
  // make room: at most DEF[name][1] voices of this name, and MAX_VOICES overall
  function makeRoom(name, t) {
    const max = DEF[name][1];
    let same = 0, live = 0, oldest = null, pick = null;
    for (let i = 0; i < active.length; i++) {
      const v = active[i];
      if (v.end <= t + 0.03 || v.t0 > t + 0.03) continue;      // already over, or scheduled for later
      live++;
      if (v.name === name) { same++; if (!oldest || v.t0 < oldest.t0) oldest = v; }
      if (!pick || v.pri < pick.pri || (v.pri === pick.pri && v.t0 < pick.t0)) pick = v;
    }
    if (same >= max && oldest) cut(oldest, t, 0.006);
    else if (live >= MAX_VOICES && pick && pick.pri <= DEF[name][3]) cut(pick, t, 0.008);
  }

  // ---------------------------------------------------------------- one-shots: movement

  // plucked note; lanes walk the F minor scale from F4 to F5
  build.roll = (t, o, pm) => {
    const lane = (((o.lane | 0) % 8) + 8) % 8, dir = o.dir < 0 ? -1 : o.dir > 0 ? 1 : 0;
    const f = mtof(65 + SCALE[lane]) * pm;
    const v = open('roll', t, o, dir * 0.32, 0.1);
    const end = t + 0.22;
    const a = O(v, 'sawtooth', f, t, end), b = O(v, 'square', f * 2.004, t, end), bg = G(0.28);
    const lp = F('lowpass', 7000, 4), g = G(0);
    lp.frequency.setValueAtTime(Math.min(9000, f * 14), t); lp.frequency.setTargetAtTime(f * 2.6, t, 0.045);
    perc(g.gain, t, 0.5, 0.19, 0.001);
    a.connect(lp); b.connect(bg); bg.connect(lp); lp.connect(g); g.connect(v.out);
    tone(v, v.out, 'triangle', t, f, 0, 0, 0.4, 0.14, 0.001);
    tone(v, v.out, 'sine', t, f * 3, 0, 0, 0.1, 0.05, 0.0008);
    hiss(v, v.out, 'highpass', t, 5000, 0, 0, 0.7, 0.09, 0.012, 0.0005);
    return v;
  };

  // blocked by a fin: inharmonic metal partials, a knock, and a small rattle after
  build.rollRefused = (t, o, pm) => {
    const dir = o.dir < 0 ? -1 : o.dir > 0 ? 1 : 0;
    const v = open('rollRefused', t, o, dir * 0.45, 0.07);
    const bp = F('bandpass', 2400 * pm, 0.9), hp = F('highpass', 500, 0.7);
    bp.connect(hp); hp.connect(v.out);
    tone(v, bp, 'square', t, 311 * pm, 0, 0, 0.5, 0.1, 0.0008);
    tone(v, bp, 'square', t, 467 * pm, 0, 0, 0.45, 0.09, 0.0008);
    tone(v, bp, 'square', t, 739 * pm, 0, 0, 0.4, 0.13, 0.0008);
    tone(v, bp, 'square', t, 1108 * pm, 0, 0, 0.35, 0.16, 0.0008);
    tone(v, bp, 'square', t, 1663 * pm, 0, 0, 0.3, 0.1, 0.0008);
    kick(v, v.out, t, 170 * pm, 78 * pm, 0.018, 0.35, 0.09);
    hiss(v, v.out, 'bandpass', t, 3600, 0, 0, 1.2, 0.75, 0.035, 0.0005);
    // rattle: a second, smaller tap
    tone(v, bp, 'square', t + 0.062, 739 * pm, 0, 0, 0.16, 0.07, 0.0008);
    tone(v, bp, 'square', t + 0.062, 1108 * pm, 0, 0, 0.16, 0.08, 0.0008);
    hiss(v, v.out, 'bandpass', t + 0.062, 3900, 0, 0, 1.2, 0.12, 0.025, 0.0005);
    return v;
  };

  // gravity flip: sub whoomp 110 -> 45 Hz under a reversed noise swell, 0.35 s
  build.flip = (t, o, pm) => {
    const v = open('flip', t, o, 0, 0.12);
    const drv = SH(SOFT); drv.connect(v.out);
    tone(v, drv, 'sine', t, 110 * pm, 45 * pm, 0.3, 0.85, 0.36, 0.004);
    tone(v, v.out, 'triangle', t, 220 * pm, 90 * pm, 0.3, 0.16, 0.3, 0.004);
    hissUp(v, v.out, 'bandpass', t, 500, 4600, 1.1, 0.9, 0.29, 0.05);
    toneUp(v, v.out, 'triangle', t, 174.6 * pm, 698.5 * pm, 0.14, 0.28, 0.05);
    return v;
  };

  // landing: tight thud, a spark of high end
  build.land = (t, o, pm) => {
    const v = open('land', t, o, 0, 0.05);
    pm *= 0.97 + rng() * 0.06;
    kick(v, v.out, t, 150 * pm, 52 * pm, 0.02, 0.8, 0.14);
    hiss(v, v.out, 'lowpass', t, 900, 0, 0, 0.7, 0.5, 0.03, 0.0005);
    hiss(v, v.out, 'bandpass', t, 7500, 0, 0, 1.6, 1.0, 0.06, 0.0005);
    tone(v, v.out, 'triangle', t, 2794 * pm, 0, 0, 0.12, 0.07, 0.0008);
    return v;
  };

  // ---------------------------------------------------------------- one-shots: breach

  // the ram, on every press: punchy 160 -> 40 Hz thoom with a short burst of air
  build.ram = (t, o, pm) => {
    const v = open('ram', t, o, 0, 0.06);
    const drv = SH(SOFT); drv.connect(v.out);
    kick(v, drv, t, 160 * pm, 40 * pm, 0.034, 1, 0.3);
    kick(v, v.out, t, 320 * pm, 80 * pm, 0.02, 0.2, 0.1, 'triangle');
    hiss(v, v.out, 'lowpass', t, 2600, 0, 0, 0.7, 0.7, 0.012, 0.0005);
    hiss(v, v.out, 'bandpass', t, 2600, 650, 0.1, 0.8, 1.0, 0.13, 0.002);
    return v;
  };

  // the ram hit nothing: a small hollow tok-tuk
  build.whiff = (t, o, pm) => {
    const v = open('whiff', t, o, 0, 0.08);
    tone(v, v.out, 'sine', t, 420 * pm, 250 * pm, 0.035, 0.6, 0.06, 0.0008);
    hiss(v, v.out, 'bandpass', t, 760 * pm, 0, 0, 7, 0.9, 0.04, 0.0005);
    tone(v, v.out, 'sine', t + 0.075, 300 * pm, 175 * pm, 0.04, 0.3, 0.07, 0.0008);
    hiss(v, v.out, 'bandpass', t + 0.075, 520 * pm, 0, 0, 7, 0.4, 0.04, 0.0005);
    return v;
  };

  // ICE shatters: kick-weight impact + band-swept glass + chord stab (+ sparkle run on PERFECT)
  build.breachHit = (t, o, pm) => {
    const perfect = o.grade !== 'good';
    const kind = o.kind || 'wall';
    const big = kind === 'gate' || kind === 'shutter', small = kind === 'pylon', core = kind === 'core';
    const chord = (o.chord | 0) & 3, chain = clamp(o.chain | 0, 0, 8);
    const size = big ? 1.25 : small ? 0.72 : core ? 0.85 : 1, len = big ? 2.3 : small ? 0.7 : 1;
    const wide = big ? 0.9 : core ? 0.6 : 0;
    // the soundtrack fills up with every gear: the glass and the stab rise with it, so the hit is still
    // the snare at gear 5 (measured: without this it added nothing above 250 Hz there)
    const lift = 1 + 0.2 * clamp((o.gear | 0) - 1, 0, 4);
    const v = open('breachHit', t, o, 0, big ? 0.3 : core ? 0.26 : 0.15);
    v.out.gain.value *= (perfect ? 1 : 0.8) * (big ? 0.74 : core ? 0.85 : 1);
    // the drop and the sector gate carry their own boom: a big breach on the same instant steps back
    v.big = big;
    if (big && (near(lastAt.drop, t) || near(lastAt.sectorGate, t))) v.out.gain.value *= 0.5;
    const drv = SH(SOFT); drv.connect(v.out);
    // impact
    kick(v, drv, t, 215 * pm, 47 * pm, 0.028, 0.8 * size, big ? 0.42 : 0.27);
    hiss(v, v.out, 'lowpass', t, 3400, 0, 0, 0.7, 0.9 * size, 0.014, 0.0005);
    if (big) {
      kick(v, drv, t, 74, 30, 0.14, 0.75, 1.2);
      // a shutter is metal behind the ICE: add a low clang
      if (kind === 'shutter') clang(v, v.out, t, 1.7);
    }
    // glass
    glass(v, v.out, t, 1.3 * size * lift, len * 1.25, kind === 'shutter' ? 6500 : perfect ? 9500 : 6200, wide, big ? 11 : small ? 3 : 6, chord);
    // chord stab
    const notes = STAB[chord];
    if (big) stab(v, v.out, t, notes, 0, 5, 0.8, 0.95, 6500 * pm, 500, pm);
    else if (small) stab(v, v.out, t, notes, 2, 3, 0.5, 0.26, 5200 * pm, 900, pm);
    else stab(v, v.out, t, notes, core ? 1 : 0, core ? 4 : 5, (perfect ? 0.7 : 0.55) * lift, 0.34, (perfect ? 6000 : 3600) * pm, 700, pm);
    // sparkle run: every consecutive PERFECT starts a step higher
    if (perfect) sparkle(v, v.out, t + 0.03, chord, (chain + 1) >> 1, (big ? 6 : small ? 3 : 4) + (chain >= 4 ? 1 : 0), 0.2, 0.043, pm * (core ? 2 : 1));
    return v;
  };

  // ---------------------------------------------------------------- one-shots: near misses, pickups

  build.graze = (t, o, pm) => {
    const side = o.side < 0 ? -1 : 1;
    const v = open('graze', t, o, side * 0.88, 0.05);
    const p = pm * (0.96 + rng() * 0.08);                // no two passes quite alike
    zip(v, v.out, t, 1250 * p, 430 * p, 0.13, 0.6);
    return v;
  };

  // both sides at once, plus a small bright chime
  build.thread = (t, o, pm) => {
    const v = open('thread', t, o, 0, 0.2);
    const L = P(-0.92), R = P(0.92);
    L.connect(v.out); R.connect(v.out);
    zip(v, L, t, 1250 * pm, 430 * pm, 0.13, 0.5);
    zip(v, R, t, 1400 * pm, 470 * pm, 0.14, 0.5);
    bell(v, v.out, t + 0.015, 1396.9 * pm, 0.2, 0.36);
    bell(v, v.out, t + 0.07, 2093 * pm, 0.2, 0.42);
    return v;
  };

  // a dodged hazard passing the camera: pitch-dropping whoosh, subtle
  build.flyby = (t, o, pm) => {
    const side = o.side < 0 ? -1 : o.side > 0 ? 1 : 0;
    const k = o.kind;
    const bigThing = k === 'iris' || k === 'wall' || k === 'spoke' || k === 'gate' || k === 'fin' || k === 'lock';
    const p = pm * (bigThing ? 0.62 : 1) * (0.94 + rng() * 0.12), d = bigThing ? 0.3 : 0.2;
    const v = open('flyby', t, o, side * 0.78, 0.04);
    const n = N(v, t, t + d + 0.06), bp = F('bandpass', 1700 * p, 1.9), g = G(0);
    sweep(bp.frequency, t, 1700 * p, 300 * p, d);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.95, t + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0007, t + d + 0.04);
    link(n, bp, g, v.out);
    if (bigThing) hiss(v, v.out, 'lowpass', t, 420, 110, d, 0.8, 0.5, d, 0.03);
    return v;
  };

  // core orb: a bell climbing the pentatonic
  build.orb = (t, o, pm) => {
    const idx = clamp((o.n | 0) - 1, 0, 9);
    const f = mtof(77 + PENTA[idx % 5] + 12 * ((idx / 5) | 0)) * pm;
    const v = open('orb', t, o, 0, 0.28);
    bell(v, v.out, t, f, 0.5, 0.55);
    tone(v, v.out, 'triangle', t, f * 0.5, 0, 0, 0.12, 0.12, 0.001);
    return v;
  };

  // lane spark: a tiny two-note blip, also climbing
  build.spark = (t, o, pm) => {
    const n = (o.n | 0) - 1, idx = n < 8 ? clamp(n, 0, 7) : 3 + (n % 5);
    const v = open('spark', t, o, 0, 0.1);
    const lp = F('lowpass', 6000, 0.7); lp.connect(v.out);
    tone(v, lp, 'square', t, mtof(sparkNote(idx)) * pm, 0, 0, 0.3, 0.045, 0.0008);
    tone(v, lp, 'square', t + 0.03, mtof(sparkNote(idx + 2)) * pm, 0, 0, 0.3, 0.06, 0.0008);
    tone(v, v.out, 'sine', t + 0.03, mtof(sparkNote(idx + 2)) * pm, 0, 0, 0.2, 0.1, 0.0008);
    return v;
  };

  // ---------------------------------------------------------------- one-shots: gears

  // snare roll + riser + 4-note rising figure, bigger for higher gears
  build.gearUp = (t, o, pm) => {
    const gear = clamp((o.gear | 0) || 2, 2, 5), k = (gear - 2) / 3;
    const step = 15 / (o.bpm || 128), top = t + 3 * step;
    const v = open('gearUp', t, o, 0, 0.16 + 0.12 * k);
    v.out.gain.value *= 0.82 + 0.1 * (gear - 2);
    // snare roll in 32nds, crescendo into the top note
    for (let i = 0; i < 6; i++) {
      const tt = t + i * step * 0.5, a = 0.2 + 0.1 * i;
      hiss(v, v.out, 'highpass', tt, 1700, 0, 0, 0.7, a * 1.6, 0.07, 0.0005);
      tone(v, v.out, 'triangle', tt, 215, 170, 0.03, a * 0.7, 0.05, 0.0005);
    }
    // riser
    hissUp(v, v.out, 'bandpass', t, 500, 5200 + 2400 * k, 2.4, 0.26 + 0.08 * k, 3 * step, 0.05);
    const ro = O(v, 'sawtooth', 174.6 * pm, t, top + 0.08), rl = F('lowpass', 2600, 1), rg = G(0);
    sweep(ro.frequency, t, 174.6 * pm, 698.5 * pm, 3 * step);
    swell(rg.gain, t, 0.14, 3 * step, 0.05);
    link(ro, rl, rg, v.out);
    // the figure: F minor arpeggio, one inversion higher per gear
    for (let i = 0; i < 4; i++) {
      const tt = t + i * step, f = mtof(FM_ARP[gear - 2 + i]) * pm, last = i === 3;
      const end = tt + (last ? 0.5 : 0.2);
      const a = O(v, 'sawtooth', f, tt, end), b = O(v, 'square', f * 1.005, tt, end), lp = F('lowpass', 5200, 2.5), g = G(0);
      lp.frequency.setValueAtTime(5200 + 1800 * k, tt); lp.frequency.setTargetAtTime(1500, tt, last ? 0.14 : 0.05);
      perc(g.gain, tt, last ? 0.42 : 0.3, last ? 0.46 : 0.17, 0.0015);
      a.connect(lp); b.connect(lp); lp.connect(g); g.connect(v.out);
    }
    // arrival: bell an octave up, a splash, and from gear 4 a low hit
    bell(v, v.out, top, mtof(FM_ARP[gear + 1] + 12) * pm, 0.16 + 0.06 * k, 0.5);
    hiss(v, v.out, 'highpass', top, 5500, 0, 0, 0.7, 0.2 + 0.16 * k, 0.4 + 0.2 * k, 0.001);
    if (gear >= 3) stab(v, v.out, top, STAB[0], 0, gear >= 5 ? 5 : 3, 0.2 + 0.1 * k, 0.4, 5000, 800, pm);
    if (gear >= 4) kick(v, v.out, top, 120, 44, 0.04, 0.7, 0.3);
    return v;
  };

  // losing a gear: a deflating downward bend with air leaking out
  build.gearDown = (t, o, pm) => {
    const gear = clamp((o.gear | 0) || 1, 1, 4);
    const f0 = mtof(72 + SCALE[gear - 1]) * pm;
    const v = open('gearDown', t, o, 0, 0.12);
    const end = t + 0.6;
    const a = O(v, 'sawtooth', f0, t, end), b = O(v, 'square', f0 * 0.5, t, end), lp = F('lowpass', 3200, 3), g = G(0);
    a.frequency.setValueAtTime(f0, t); a.frequency.setTargetAtTime(f0 * 0.3, t, 0.16);
    b.frequency.setValueAtTime(f0 * 0.5, t); b.frequency.setTargetAtTime(f0 * 0.15, t, 0.16);
    lp.frequency.setValueAtTime(3200, t); lp.frequency.setTargetAtTime(260, t, 0.17);
    perc(g.gain, t, 0.55, 0.56, 0.003);
    // the wobble slows down as it deflates
    const lfo = O(v, 'sine', 17, t, end), lg = G(35);
    sweep(lfo.frequency, t, 17, 5, 0.5);
    lfo.connect(lg); lg.connect(a.detune); lg.connect(b.detune);
    a.connect(lp); b.connect(lp); lp.connect(g); g.connect(v.out);
    hiss(v, v.out, 'bandpass', t, 3800, 500, 0.4, 0.9, 0.3, 0.5, 0.004);
    return v;
  };

  build.crash = (t, o, pm) => {
    const v = open('crash', t, o, 0, 0.2);
    wreck(v, t, 1, pm);
    return v;
  };
  build.stumble = (t, o, pm) => {
    const v = open('stumble', t, o, 0, 0.08);
    wreck(v, t, 0.42, pm * 1.35);
    return v;
  };

  // ---------------------------------------------------------------- one-shots: set pieces

  // the courier fires out of the barrel: rising whip into a cannon thump, then it tears away
  build.launch = (t, o, pm) => {
    const now = ctx.currentTime;
    const tw = Math.max(now, t - 0.13), tb = Math.max(t, tw + 0.05), lead = tb - tw;
    const v = open('launch', tw, o, 0, 0.25);
    const drv = SH(SOFT); drv.connect(v.out);
    hissUp(v, v.out, 'bandpass', tw, 420, 5600, 3, 1.1, lead, 0.03);
    toneUp(v, v.out, 'sawtooth', tw, 160 * pm, 1500 * pm, 0.22, lead, 0.02);
    kick(v, drv, tb, 135 * pm, 36 * pm, 0.05, 1.1, 0.6);
    kick(v, v.out, tb, 270 * pm, 60 * pm, 0.03, 0.25, 0.16, 'triangle');
    hiss(v, v.out, 'highpass', tb, 2800, 0, 0, 0.7, 0.8, 0.02, 0.0005);
    hiss(v, v.out, 'lowpass', tb, 2000, 180, 0.3, 0.8, 0.7, 0.4, 0.001);
    // tearing away down the barrel
    hiss(v, v.out, 'bandpass', tb, 3400, 800, 0.55, 1.4, 0.6, 0.7, 0.03);
    toneUp(v, v.out, 'triangle', tb, 349.2 * pm, 1396.9 * pm, 0.1, 0.22, 0.2);
    return v;
  };

  // THE DROP: huge sub boom + cymbal wash + airy tail
  build.drop = (t, o, pm) => {
    yieldBig(t);
    const v = open('drop', t, o, 0, 0.4);
    const drv = SH(SOFT); drv.connect(v.out);
    const L = P(-0.85), R = P(0.85); L.connect(v.out); R.connect(v.out);
    kick(v, drv, t, 96 * pm, 31 * pm, 0.1, 1.15, 2.2);
    tone(v, v.out, 'sine', t, F1 * pm, 0, 0, 0.6, 3.2, 0.004);
    tone(v, drv, 'triangle', t, F1 * 2 * pm, 0, 0, 0.22, 2.0, 0.004);
    hiss(v, v.out, 'lowpass', t, 4200, 0, 0, 0.7, 1.0, 0.035, 0.0005);
    hiss(v, v.out, 'lowpass', t, 900, 120, 0.5, 0.8, 0.6, 0.7, 0.001);
    // cymbal wash, decorrelated left and right
    hiss(v, L, 'highpass', t, 5200, 0, 0, 0.7, 1.6, 3.4, 0.003);
    hiss(v, R, 'highpass', t, 6400, 0, 0, 0.7, 1.6, 3.1, 0.003);
    hiss(v, L, 'bandpass', t, 9000, 0, 0, 3, 1.0, 2.4, 0.003);
    hiss(v, R, 'bandpass', t, 11000, 0, 0, 3, 1.0, 2.1, 0.003);
    // airy tail: slow band of wind opening up
    hiss(v, L, 'bandpass', t, 900, 2600, 1.2, 0.7, 0.45, 3.2, 0.3);
    hiss(v, R, 'bandpass', t, 1300, 3200, 1.4, 0.7, 0.45, 3.2, 0.35);
    return v;
  };

  // the star goes: a roar from behind swelling over 1.5 s
  build.novaIgnite = (t, o, pm) => {
    const v = open('novaIgnite', t, o, 0, 0.3);
    const rise = 1.5, fall = 0.9, end = t + rise + fall + 0.03;
    for (let s = -1; s <= 1; s += 2) {
      const n = N(v, t, end, 0.8 + 0.1 * s), lp = F('lowpass', 110, 1.2), ng = G(0), hs = SH(SOFT), pn = P(0.92 * s);
      sweep(lp.frequency, t, 110, 1500, rise);
      lp.frequency.exponentialRampToValueAtTime(200, t + rise + fall);
      swell(ng.gain, t, 1.6, rise, fall);
      link(n, lp, ng, hs, pn); pn.connect(v.out);
    }
    const lp2 = F('lowpass', 90, 1), sg = G(0);
    sweep(lp2.frequency, t, 90, 420, rise);
    swell(sg.gain, t, 0.5, rise, fall);
    const a = O(v, 'sawtooth', F1 * pm, t, end), b = O(v, 'sawtooth', F1 * 1.013 * pm, t, end), c = O(v, 'sine', F1 * 2.004 * pm, t, end);
    a.connect(lp2); b.connect(lp2); c.connect(lp2); lp2.connect(sg); sg.connect(v.out);
    hissUp(v, v.out, 'bandpass', t, 1800, 3600, 0.6, 0.14, rise, fall * 0.7);
    return v;
  };

  // the sector gate: a massive double breach
  build.sectorGate = (t, o, pm) => {
    const chord = (o.chord | 0) & 3, step = 15 / (o.bpm || 132);
    yieldBig(t);
    const v = open('sectorGate', t, o, 0, 0.4);
    const drv = SH(SOFT); drv.connect(v.out);
    const t2 = t + step;
    kick(v, drv, t, 200 * pm, 50 * pm, 0.03, 0.8, 0.3);
    hiss(v, v.out, 'lowpass', t, 3400, 0, 0, 0.7, 0.5, 0.014, 0.0005);
    glass(v, v.out, t, 1.0, 1, 8000, 0.7, 5, chord);
    kick(v, drv, t2, 230 * pm, 44 * pm, 0.032, 1.2, 0.5);
    kick(v, drv, t2, 70, 28, 0.16, 0.8, 1.4);
    hiss(v, v.out, 'lowpass', t2, 4200, 0, 0, 0.7, 0.7, 0.016, 0.0005);
    glass(v, v.out, t2, 1.4, 2.6, 10000, 0.95, 12, chord);
    stab(v, v.out, t, STAB[chord], 0, 4, 0.55, 0.2, 5000 * pm, 900, pm);
    stab(v, v.out, t2, STAB[chord], 0, 5, 0.85, 1.3, 7000 * pm, 450, pm);
    tone(v, drv, 'sawtooth', t2, mtof(STAB[chord][0] - 12) * pm, 0, 0, 0.2, 1.1, 0.003);
    sparkle(v, v.out, t2 + 0.03, chord, 1, 8, 0.2, 0.045, pm);
    return v;
  };

  // sector banner: a short bright two-hit fanfare
  build.sector = (t, o, pm) => {
    const chord = (o.chord | 0) & 3, step = 15 / (o.bpm || 132), t2 = t + step;
    const v = open('sector', t, o, 0, 0.26);
    const n = STAB[chord];
    stab(v, v.out, t, n, 0, 4, 0.5, 0.14, 7000 * pm, 1500, pm, 0.004);
    stab(v, v.out, t2, n, 1, 4, 0.6, 0.6, 8500 * pm, 1100, pm, 0.004);
    // brassy edge and a top note an octave above the chord
    tone(v, v.out, 'square', t2, mtof(n[2]) * pm, 0, 0, 0.1, 0.4, 0.006);
    bell(v, v.out, t2, mtof(n[4] + 12) * pm, 0.2, 0.6);
    hiss(v, v.out, 'highpass', t2, 7000, 0, 0, 0.7, 0.12, 0.3, 0.002);
    return v;
  };

  // the nova is close: two-tone klaxon, more urgent at level 2
  build.leadLow = (t, o, pm) => {
    const urgent = (o.level | 0) >= 2;
    const v = open('leadLow', t, o, 0, 0.1);
    const bp = F('bandpass', urgent ? 1700 : 1300, 1.1), drv = SH(SOFT);
    bp.connect(drv); drv.connect(v.out);
    const count = urgent ? 4 : 2, dur = urgent ? 0.085 : 0.15;
    const hi = mtof(urgent ? 77 : 75) * pm, lo = mtof(urgent ? 73 : 72) * pm;
    for (let i = 0; i < count; i++) {
      const tt = t + i * dur, f = i & 1 ? lo : hi, end = tt + dur;
      const a = O(v, 'sawtooth', f, tt, end + 0.02), b = O(v, 'square', f * 0.5, tt, end + 0.02), g = G(0);
      g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.9, tt + 0.004);
      g.gain.setValueAtTime(0.9, end - 0.012); g.gain.linearRampToValueAtTime(0, end);
      a.connect(g); b.connect(g); g.connect(bp);
    }
    return v;
  };

  build.leadSafe = (t, o, pm) => {
    const v = open('leadSafe', t, o, 0, 0.3);
    bell(v, v.out, t, mtof(84) * pm, 0.3, 0.4);
    bell(v, v.out, t + 0.09, mtof(89) * pm, 0.34, 0.55);
    return v;
  };

  // caught by the nova: reverse swell into one enormous sub boom with a long dark tail
  build.death = (t, o, pm) => {
    const v = open('death', t, o, 0, 0.45);
    const rise = 0.45, tb = t + rise;
    const drv = SH(SOFT); drv.connect(v.out);
    const L = P(-0.9), R = P(0.9); L.connect(v.out); R.connect(v.out);
    hissUp(v, L, 'bandpass', t, 260, 3200, 1, 0.9, rise, 0.03);
    hissUp(v, R, 'highpass', t, 2500, 7000, 0.7, 0.5, rise, 0.02);
    const so = O(v, 'sawtooth', 55 * pm, t, tb + 0.05), sl = F('lowpass', 1400, 1), sg = G(0);
    sweep(so.frequency, t, 55 * pm, 220 * pm, rise);
    swell(sg.gain, t, 0.3, rise, 0.03);
    link(so, sl, sg, v.out);
    // the boom
    kick(v, drv, tb, 84 * pm, 27 * pm, 0.13, 1.3, 2.5);
    const sub = tone(v, v.out, 'sine', tb, F1 * pm, 0, 0, 0.7, 2.6, 0.004);
    sub.frequency.setTargetAtTime(32.7 * pm, tb, 0.9);
    hiss(v, v.out, 'lowpass', tb, 2600, 0, 0, 0.7, 0.9, 0.05, 0.0005);
    hiss(v, v.out, 'lowpass', tb, 3200, 260, 1.1, 0.8, 0.8, 1.5, 0.001);
    // long dark tail
    hiss(v, L, 'lowpass', tb, 800, 110, 2.2, 0.8, 0.6, 2.6, 0.004);
    hiss(v, R, 'lowpass', tb, 650, 90, 2.4, 0.8, 0.6, 2.6, 0.004);
    const fo = O(v, 'sawtooth', 87.3 * pm, tb, tb + 2.6), fl = F('lowpass', 900, 1.5), fg = G(0);
    sweep(fo.frequency, tb, 87.3 * pm, 41 * pm, 2.5);
    perc(fg.gain, tb, 0.45, 2.5, 0.01);
    link(fo, fl, fg, drv);
    return v;
  };

  // score burn-in on the results screen: soft tick with a breath of air
  build.results = (t, o, pm) => {
    const v = open('results', t, o, 0, 0.16);
    tone(v, v.out, 'sine', t, 1396.9 * pm, 0, 0, 0.32, 0.05, 0.0008);
    const n = N(v, t, t + 0.36), bp = F('bandpass', 1800, 1.2), g = G(0);
    sweep(bp.frequency, t, 1800, 5600, 0.24);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.2, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0002, t + 0.34);
    link(n, bp, g, v.out);
    return v;
  };

  // ---------------------------------------------------------------- one-shots: UI

  // the title logo shatters and the run powers up
  build.uiStart = (t, o, pm) => {
    const v = open('uiStart', t, o, 0, 0.32);
    const drv = SH(SOFT); drv.connect(v.out);
    kick(v, drv, t, 160 * pm, 42 * pm, 0.04, 0.9, 0.45);
    hiss(v, v.out, 'lowpass', t, 3600, 0, 0, 0.7, 0.6, 0.016, 0.0005);
    glass(v, v.out, t, 1.2, 2, 10000, 0.85, 14, 0);
    // power-up: an F minor chord opening upward
    const end = t + 0.9, mix = G(0.3), lp = F('lowpass', 300, 3), g = G(0);
    sweep(lp.frequency, t, 300, 7000, 0.6);
    swell(g.gain, t, 0.5, 0.6, 0.28);
    for (let i = 0; i < 4; i++) {
      const f = mtof(STAB[0][i]) * pm;
      const a = O(v, 'sawtooth', f, t, end), b = O(v, 'sawtooth', f * 1.006, t, end);
      a.connect(mix); b.connect(mix);
    }
    link(mix, lp, g, v.out);
    sparkle(v, v.out, t + 0.36, 0, 0, 6, 0.2, 0.045, pm);
    return v;
  };

  build.uiTick = (t, o, pm) => {
    const v = open('uiTick', t, o, 0, 0);
    tone(v, v.out, 'sine', t, 2093 * pm, 0, 0, 0.4, 0.03, 0.0006);
    tone(v, v.out, 'square', t, 1046.5 * pm, 0, 0, 0.1, 0.014, 0.0006);
    hiss(v, v.out, 'highpass', t, 6000, 0, 0, 0.7, 0.12, 0.008, 0.0004);
    return v;
  };

  // pause steps down a fifth, resume steps back up
  function twoNote(name, t, o, pm, m0, m1) {
    const v = open(name, t, o, 0, 0.14);
    const lp = F('lowpass', 2800, 1); lp.connect(v.out);
    tone(v, lp, 'square', t, mtof(m0) * pm, 0, 0, 0.22, 0.12, 0.002);
    tone(v, v.out, 'triangle', t, mtof(m0) * pm, 0, 0, 0.3, 0.12, 0.002);
    tone(v, lp, 'square', t + 0.075, mtof(m1) * pm, 0, 0, 0.22, 0.2, 0.002);
    tone(v, v.out, 'triangle', t + 0.075, mtof(m1) * pm, 0, 0, 0.3, 0.2, 0.002);
    return v;
  }
  build.pause = (t, o, pm) => twoNote('pause', t, o, pm, 72, 65);
  build.resume = (t, o, pm) => twoNote('resume', t, o, pm, 65, 72);

  // ---------------------------------------------------------------- loops

  // sources -> out (level, smoothed) -> post (trim) -> panner -> sfxBus
  function loopBase(trim) {
    const out = G(0), post = G(trim), pn = P(0);
    out.connect(post); post.connect(pn); pn.connect(audio.sfxBus);
    return { out, post, pn, srcs: [], level: -1, panV: 0, set: null };
  }
  function LO(L, type, freq, now) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.start(now); L.srcs.push(o); return o; }
  function LN(L, now, rate) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.playbackRate.value = rate;
    s.start(now, rng() * 1.9); L.srcs.push(s); return s;
  }

  // sparks on a fin: a saw whine that climbs with level, over crackling noise
  loopBuild.grind = (now) => {
    const L = loopBase(LOOP_TRIM.grind);
    const a = LO(L, 'sawtooth', 349, now), b = LO(L, 'sawtooth', 349, now), c = LO(L, 'square', 698, now);
    b.detune.value = 17;
    const cg = G(0.25), lp = F('lowpass', 1600, 5), wg = G(0.3);
    a.connect(lp); b.connect(lp); c.connect(cg); cg.connect(lp); lp.connect(wg); wg.connect(L.out);
    // metal flutter on the pitch
    const fl = LO(L, 'sine', 37, now), fg = G(22);
    fl.connect(fg); fg.connect(a.detune); fg.connect(b.detune); fg.connect(c.detune);
    // crackle: bright noise whose gain is opened by a slow random signal pushed through a threshold
    const n = LN(L, now, 1), hp = F('highpass', 2600, 0.7), cr = G(0);
    const slow = LN(L, now, 0.0045), gate = SH(GATE), depth = G(0.9);
    link(n, hp, cr, L.out);
    link(slow, gate, depth); depth.connect(cr.gain);
    // a constant bed of fine hiss so the sparks never fully vanish
    const n2 = LN(L, now, 1.3), bp = F('bandpass', 5200, 1.2), hg = G(0.26);
    link(n2, bp, hg, L.out);
    L.set = (lv, t) => {
      const f = 349.2 * Math.pow(2, 1.585 * lv);              // F4 climbing to C6
      a.frequency.setTargetAtTime(f, t, 0.07); b.frequency.setTargetAtTime(f, t, 0.07); c.frequency.setTargetAtTime(f * 2, t, 0.07);
      lp.frequency.setTargetAtTime(1300 + 5200 * lv, t, 0.07);
      hp.frequency.setTargetAtTime(2200 + 3200 * lv, t, 0.07);
      slow.playbackRate.setTargetAtTime(0.004 + 0.012 * lv, t, 0.1);
      bp.frequency.setTargetAtTime(3000 + 4000 * lv, t, 0.07);
      L.out.gain.setTargetAtTime(0.3 + 0.7 * lv, t, 0.05);
    };
    return L;
  };

  // rushing air: two decorrelated bands of soft noise that open up with level
  loopBuild.wind = (now) => {
    const L = loopBase(LOOP_TRIM.wind);
    const lps = [], bps = [];
    for (let s = -1; s <= 1; s += 2) {
      const n = LN(L, now, 0.83 + 0.07 * s), hp = F('highpass', 230, 0.7), hp2 = F('highpass', 150, 0.7), lp = F('lowpass', 700, 0.6), lp2 = F('lowpass', 2400, 0.5), pn = P(0.75 * s);
      link(n, hp, hp2, lp, lp2); lp2.connect(pn); pn.connect(L.out);
      // a gentle resonance wandering on a slow LFO gives the air a moving "shape"
      const bp = F('bandpass', 900, 4), bg = G(0.8), lfo = LO(L, 'sine', s < 0 ? 0.11 : 0.17, now), lg = G(300);
      lfo.connect(lg); lg.connect(bp.frequency);
      n.connect(bp); bp.connect(bg); bg.connect(pn);
      lps.push(lp, lp2); bps.push(bp);
    }
    L.set = (lv, t) => {
      lps[0].frequency.setTargetAtTime(420 + 1300 * lv, t, 0.25); lps[2].frequency.setTargetAtTime(470 + 1450 * lv, t, 0.25);
      lps[1].frequency.setTargetAtTime(1300 + 2300 * lv, t, 0.25); lps[3].frequency.setTargetAtTime(1300 + 2300 * lv, t, 0.25);
      bps[0].frequency.setTargetAtTime(560 + 800 * lv, t, 0.25); bps[1].frequency.setTargetAtTime(700 + 950 * lv, t, 0.25);
      L.out.gain.setTargetAtTime(0.3 + 0.55 * lv, t, 0.2);
    };
    return L;
  };

  // the nova behind you: a low beating rumble that tremors harder as it closes in
  loopBuild.haze = (now) => {
    const L = loopBase(LOOP_TRIM.haze);
    // tremor: AM on the whole bed
    const trem = G(1), lfo = LO(L, 'sine', 5, now), ld = G(0);
    lfo.connect(ld); ld.connect(trem.gain); const sub = F('highpass', 32, 0.7);
    trem.connect(sub); sub.connect(L.out);
    const n = LN(L, now, 0.6), lp = F('lowpass', 120, 1.4), ng = G(2.2), hs = SH(SOFT), og = G(0.5);
    link(n, lp, ng, hs, og); og.connect(trem);
    const a = LO(L, 'sawtooth', F1, now), b = LO(L, 'sawtooth', F1 * 1.03, now), c = LO(L, 'sine', F1 * 1.997, now);
    const tl = F('lowpass', 150, 1), tg = G(0.55);
    a.connect(tl); b.connect(tl); c.connect(tl); tl.connect(tg); tg.connect(trem);
    // heat: a thin high band that only appears when it is close
    const n2 = LN(L, now, 1.1), bp = F('bandpass', 2600, 0.6), hg = G(0);
    link(n2, bp, hg, trem);
    L.set = (lv, t) => {
      lp.frequency.setTargetAtTime(90 + 170 * lv, t, 0.2);
      tl.frequency.setTargetAtTime(110 + 450 * lv * lv, t, 0.2);
      lfo.frequency.setTargetAtTime(4 + 6 * lv, t, 0.3);
      ld.gain.setTargetAtTime(0.3 * lv, t, 0.2);
      hg.gain.setTargetAtTime(0.12 * lv * lv, t, 0.2);
      L.out.gain.setTargetAtTime(0.15 + 0.85 * lv, t, 0.15);
    };
    return L;
  };

  function releaseLoop(L, now) {
    L.out.gain.cancelScheduledValues(now);
    L.out.gain.setTargetAtTime(0, now, 0.05);
    const stopAt = now + 0.4;
    for (let i = 0; i < L.srcs.length; i++) L.srcs[i].stop(stopAt);
    L.srcs[0].onended = () => { L.out.disconnect(); L.post.disconnect(); L.pn.disconnect(); };
  }

  // ---------------------------------------------------------------- public

  const sfx = {
    names: Object.keys(DEF),
    loops: Object.keys(loops),
    // voices sounding or scheduled right now (debug / tests)
    get voices() { sweepDead(ctx.currentTime); return active.length; },

    play(name, opts) {
      const b = build[name];
      if (!b) return false;
      const o = opts || NO, now = ctx.currentTime;
      const t = o.when !== undefined && o.when > now ? o.when : now;
      const last = lastAt[name];
      if (last !== undefined && t - last < DEF[name][2] && t >= last) return false;
      lastAt[name] = t;
      sweepDead(now);
      makeRoom(name, t);
      seal(b(t, o, o.pitch ? Math.pow(2, o.pitch / 12) : 1));
      return true;
    },

    loop(name, level, opts) {
      const mk = loopBuild[name];
      if (!mk) return;
      const now = ctx.currentTime, lv = clamp(+level || 0, 0, 1);
      let L = loops[name];
      if (lv <= 0.001) {
        if (L) { releaseLoop(L, now); loops[name] = null; }
        return;
      }
      if (!L) L = loops[name] = mk(now);
      const pan = opts && opts.pan !== undefined ? clamp(opts.pan, -1, 1) : 0;
      if (Math.abs(lv - L.level) > 0.008) { L.set(lv, now); L.level = lv; }
      if (Math.abs(pan - L.panV) > 0.01) { L.pn.pan.setTargetAtTime(pan, now, 0.05); L.panV = pan; }
    },

    stopAll() {
      const now = ctx.currentTime;
      for (let i = 0; i < active.length; i++) cut(active[i], now, 0.012);
      for (const k in loops) if (loops[k]) { releaseLoop(loops[k], now); loops[k] = null; }
      for (const k in lastAt) delete lastAt[k];
    },
  };
  return sfx;
}
