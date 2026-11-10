// game/music_kit.js — the drum kit: one-shot samples synthesized sample by sample into AudioBuffers
// at boot (no files). They are samples rather than live oscillators because a kick built from a
// running oscillator starts at a random phase on every hit: baked, every hit punches the same.
// Private to music.js.

function makeRand(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; };
}

// RBJ biquad run in place. type: 0 lowpass, 1 highpass, 2 bandpass (0 dB at the centre).
function biquad(d, sr, type, f, q) {
  const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 0) { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; } else if (type === 1) { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; } else { b0 = al; b1 = 0; b2 = -al; }
  const a0 = 1 + al, a1 = (-2 * c) / a0, a2 = (1 - al) / a0;
  b0 /= a0; b1 /= a0; b2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y;
  }
  return d;
}

function finish(d, sr, fadeSec) {
  let peak = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  const k = peak > 0 ? 1 / peak : 1, nf = Math.min(d.length, Math.floor(sr * fadeSec));
  for (let i = 0; i < d.length; i++) d[i] *= k;
  for (let i = 0; i < nf; i++) d[d.length - 1 - i] *= i / nf;
  return d;
}

function noise(n, seed) {
  const d = new Float32Array(n), r = makeRand(seed);
  for (let i = 0; i < n; i++) d[i] = r();
  return d;
}

// Sine drop from a 450 Hz knock to F#1, lightly squared off by tanh, plus a click. Kept short: the
// 8th-note sub pulse owns the space between kicks.
function kick(sr) {
  const n = Math.floor(sr * 0.3), d = new Float32Array(n), r = makeRand(0x51ed270b);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 46 + 112 * Math.exp(-t / 0.03) + 300 * Math.exp(-t / 0.005);
    ph += (2 * Math.PI * f) / sr;
    // two-stage decay: a hard knock that is mostly gone in 30 ms, then a short low tail
    const env = (0.55 * Math.exp(-t / 0.018) + 0.45 * Math.exp(-t / 0.075)) * Math.min(1, t / 0.0005);
    d[i] = Math.tanh(Math.sin(ph) * env * 1.3) + r() * 0.2 * Math.exp(-t / 0.0012);
  }
  biquad(d, sr, 1, 24, 0.7);
  return finish(d, sr, 0.03);
}

// 80s snare: two short tones, a band of noise, and a held "gated room" plateau that shuts at 150 ms.
function snare(sr) {
  const n = Math.floor(sr * 0.3), d = noise(n, 0x1f83d9ab);
  biquad(d, sr, 1, 1500, 0.8); biquad(d, sr, 0, 9000, 0.7);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * (182 + 80 * Math.exp(-t / 0.012))) / sr;
    const gate = t < 0.15 ? 0.2 : 0.2 * Math.exp(-(t - 0.15) / 0.016);
    const nz = d[i] * (0.95 * Math.exp(-t / 0.045) + gate) * Math.min(1, t / 0.0004);
    const tone = Math.sin(ph) * Math.exp(-t / 0.055) * 0.7 + Math.sin(2 * Math.PI * 331 * t) * Math.exp(-t / 0.03) * 0.25;
    d[i] = Math.tanh((nz + tone) * 1.5);
  }
  return finish(d, sr, 0.01);
}

// Three fast bursts and a tail of band-passed noise.
function clap(sr) {
  const n = Math.floor(sr * 0.34), d = noise(n, 0x5be0cd19);
  biquad(d, sr, 2, 1350, 1.1); biquad(d, sr, 1, 800, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let e;
    if (t < 0.031) { const k = t % 0.0105; e = Math.exp(-k / 0.0035) * 0.9; } else e = Math.exp(-(t - 0.031) / 0.07);
    d[i] *= e;
  }
  return finish(d, sr, 0.02);
}

// Noise wash with a metallic head.
function crash(sr) {
  const n = Math.floor(sr * 2.2), d = noise(n, 0x9b05688c), ring = noise(n, 0x3c6ef372);
  biquad(d, sr, 1, 3200, 0.7); biquad(d, sr, 0, 11500, 0.7);
  biquad(ring, sr, 2, 6200, 3); biquad(ring, sr, 1, 4000, 0.7);
  const fr = [3140, 4217, 5311, 6733, 7919, 9349];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let m = 0;
    for (let k = 0; k < fr.length; k++) m += Math.sin(2 * Math.PI * fr[k] * t + k * 1.7);
    const env = Math.min(1, t / 0.0015) * (0.55 * Math.exp(-t / 0.6) + 0.45 * Math.exp(-t / 0.11));
    d[i] = (d[i] + ring[i] * 1.6) * env + m * 0.035 * Math.exp(-t / 0.18);
  }
  return finish(d, sr, 0.25);
}

// One tom; music.js retunes it with playbackRate.
function tom(sr) {
  const n = Math.floor(sr * 0.32), d = new Float32Array(n), r = makeRand(0xa54ff53a);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * (104 + 120 * Math.exp(-t / 0.045))) / sr;
    d[i] = Math.tanh(Math.sin(ph) * Math.exp(-t / 0.1) * 1.6) + r() * 0.12 * Math.exp(-t / 0.003);
  }
  return finish(d, sr, 0.03);
}

// Short FM "clank": machine-hall percussion for the later sectors.
function clank(sr) {
  const n = Math.floor(sr * 0.16), d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    d[i] = Math.sin(2 * Math.PI * 830 * t + 3.4 * Math.exp(-t / 0.03) * Math.sin(2 * Math.PI * 1171 * t)) * Math.exp(-t / 0.034) * Math.min(1, t / 0.0005);
  }
  biquad(d, sr, 1, 500, 0.7);
  return finish(d, sr, 0.01);
}

// The sub drop under THE DROP and every sector gate: a sine falling from 150 Hz to 40 Hz in half a second.
function boom(sr) {
  const n = Math.floor(sr * 1.3), d = new Float32Array(n), rum = noise(n, 0x6a09e667);
  biquad(rum, sr, 0, 160, 0.7);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * (40 + 110 * Math.exp(-t / 0.14))) / sr;
    d[i] = Math.tanh(Math.sin(ph) * Math.min(1, t / 0.004) * Math.exp(-t / 0.3) * 1.5) + rum[i] * 0.5 * Math.exp(-t / 0.2);
  }
  return finish(d, sr, 0.2);
}

export function renderKit(ctx) {
  const sr = ctx.sampleRate;
  const wrap = (d) => { const b = ctx.createBuffer(1, d.length, sr); b.getChannelData(0).set(d); return b; };
  const cr = crash(sr), rev = new Float32Array(cr.length);
  for (let i = 0; i < cr.length; i++) rev[i] = cr[cr.length - 1 - i];
  return { kick: wrap(kick(sr)), snare: wrap(snare(sr)), clap: wrap(clap(sr)), crash: wrap(cr), rev: wrap(rev), tom: wrap(tom(sr)), clank: wrap(clank(sr)), boom: wrap(boom(sr)) };
}
