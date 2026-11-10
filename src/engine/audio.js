// engine/audio.js — Web Audio core: context, master chain, buses, reverb send, shared utilities.
// The soundtrack and the sound effects are separate game modules that plug into these buses.
//
//   musicBus -> musicFilter (lowpass, for muffling) -> musicDuck (sidechain gain) -+
//   sfxBus ------------------------------------------------------------------------+-> master -> limiter -> out
//   reverbIn -> convolver -> reverbOut --------------------------------------------+
//
// Works with a live AudioContext or an OfflineAudioContext (pass { ctx }) for offline rendering/tests.

function makeImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  // deterministic noise so offline renders are reproducible
  let s = 0x2545f491;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; };
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // early reflections + diffuse tail that gets darker over time
      const n = rnd();
      lp += (n - lp) * (0.9 - 0.75 * t);
      d[i] = lp * Math.pow(1 - t, decay) * (i < rate * 0.004 ? i / (rate * 0.004) : 1);
    }
  }
  return buf;
}

export function createAudio(opts = {}) {
  const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  const ctx = opts.ctx || (AC ? new AC({ latencyHint: 'interactive' }) : null);
  if (!ctx) return null;

  const master = ctx.createGain();
  master.gain.value = opts.volume !== undefined ? opts.volume : 0.85;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -7; limiter.knee.value = 5; limiter.ratio.value = 14; limiter.attack.value = 0.002; limiter.release.value = 0.14;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.72;

  const musicBus = ctx.createGain();
  const musicFilter = ctx.createBiquadFilter();
  musicFilter.type = 'lowpass'; musicFilter.frequency.value = 20000; musicFilter.Q.value = 0.7;
  const musicDuck = ctx.createGain();
  const sfxBus = ctx.createGain();
  const reverbIn = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx, 2.6, 2.4);
  const reverbOut = ctx.createGain();
  reverbOut.gain.value = 0.8;

  musicBus.connect(musicFilter); musicFilter.connect(musicDuck); musicDuck.connect(master);
  sfxBus.connect(master);
  reverbIn.connect(convolver); convolver.connect(reverbOut); reverbOut.connect(master);
  // the limiter's make-up gain lands the loudest moments around -0.7 dBFS: a fixed trim after it keeps
  // a full decibel of true-peak headroom for whatever converts or re-encodes the output
  const outTrim = ctx.createGain();
  outTrim.gain.value = 0.93;
  master.connect(limiter); limiter.connect(outTrim); outTrim.connect(analyser); outTrim.connect(ctx.destination);

  let noiseBuf = null;
  let musicVol = 1, sfxVol = 1, muted = false, masterVol = master.gain.value;
  const spectrum = new Uint8Array(analyser.frequencyBinCount);

  const audio = {
    ctx, master, limiter, analyser, musicBus, musicFilter, musicDuck, sfxBus, reverbIn,
    out: outTrim,          // the last node before the speakers (tools record from here)
    get now() { return ctx.currentTime; },
    get running() { return ctx.state === 'running'; },
    // Must be called from a user gesture at least once (browser autoplay policy).
    resume() { return ctx.state !== 'running' && ctx.resume ? ctx.resume().catch(() => {}) : Promise.resolve(); },
    suspend() { return ctx.state === 'running' && ctx.suspend ? ctx.suspend().catch(() => {}) : Promise.resolve(); },

    // Shared 2 s white-noise buffer (mono).
    noise() {
      if (!noiseBuf) {
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        let s = 0x9e3779b9;
        for (let i = 0; i < d.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; d[i] = ((s >>> 0) / 4294967296) * 2 - 1; }
      }
      return noiseBuf;
    },

    setMasterVolume(v) { masterVol = v; master.gain.setTargetAtTime(muted ? 0 : v, ctx.currentTime, 0.02); },
    setMusicVolume(v) { musicVol = v; musicBus.gain.setTargetAtTime(v, ctx.currentTime, 0.03); },
    setSfxVolume(v) { sfxVol = v; sfxBus.gain.setTargetAtTime(v, ctx.currentTime, 0.03); },
    getMusicVolume: () => musicVol,
    getSfxVolume: () => sfxVol,
    setMuted(m) { muted = m; master.gain.setTargetAtTime(m ? 0 : masterVol, ctx.currentTime, 0.02); },
    isMuted: () => muted,

    // Momentarily pull the music down so a big sound punches through (sidechain feel).
    duck(depth = 0.5, attack = 0.008, release = 0.28, when = ctx.currentTime) {
      const g = musicDuck.gain;
      g.cancelScheduledValues(when);
      g.setTargetAtTime(1 - depth, when, attack);
      g.setTargetAtTime(1, when + attack * 4, release / 3);
    },
    // Muffle or open the music (20000 = fully open). Used for slow motion, pause, death.
    setMusicLowpass(freq, glide = 0.08, when = ctx.currentTime) {
      musicFilter.frequency.cancelScheduledValues(when);
      musicFilter.frequency.setTargetAtTime(Math.max(40, freq), when, glide);
    },
    // 0..255 magnitude per frequency bin (128 bins, ~0..22 kHz). Reuses one array.
    getSpectrum() { analyser.getByteFrequencyData(spectrum); return spectrum; },
  };
  return audio;
}
