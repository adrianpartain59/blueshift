// Records the live game's master bus as PCM with an AudioWorklet, every block stamped with its exact
// context time, so the recording can be placed on the song timeline to the sample.
//   node tools/harness.mjs --page "/index.html?bot=1&seed=3" --script tools/scripts/record_audio.mjs --seconds 36 --wav out/video/audio.wav --offset-file out/video/audio_offset.txt
// Writes a 16-bit stereo WAV and the SONG time (seconds) of its first sample.
import fs from 'node:fs';
export default async function (h) {
  const seconds = +h.opt.seconds || 30;
  await h.waitFor('window.__stage && window.__stage.mode === "title"', 15000);
  await h.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 });
  await h.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 });
  await h.waitFor('window.__stage.mode === "run" && window.__stage.audio', 8000);
  const t0 = await h.eval(`(async () => {
    const g = window.__stage, a = g.audio, ctx = a.ctx;
    const code = "class Cap extends AudioWorkletProcessor { constructor() { super(); this.sent = false; } process(inputs) { const i = inputs[0]; if (i && i[0]) { if (!this.sent) { this.sent = true; this.port.postMessage({ t0: currentTime }); } this.port.postMessage({ l: i[0].slice(), r: (i[1] || i[0]).slice() }); } return true; } } registerProcessor('cap', Cap);";
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
    const node = new AudioWorkletNode(ctx, 'cap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
    const cap = window.__cap = { L: [], R: [], t0: -1, sr: ctx.sampleRate, node };
    return await new Promise((res) => {
      node.port.onmessage = (e) => { const d = e.data; if (d.t0 !== undefined) { cap.t0 = d.t0; res(d.t0 - g.audioT0 + g.songT0); } else { cap.L.push(d.l); cap.R.push(d.r); } };
      (a.out || a.limiter).connect(node);
    });
  })()`);
  await h.sleep(seconds * 1000);
  const b64 = await h.eval(`(() => {
    const c = window.__cap; c.node.port.onmessage = null;
    const n = c.L.reduce((s, b) => s + b.length, 0), buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 2, true); v.setUint32(24, c.sr, true); v.setUint32(28, c.sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * 4, true);
    let o = 44;
    for (let b = 0; b < c.L.length; b++) { const l = c.L[b], r = c.R[b]; for (let i = 0; i < l.length; i++) { v.setInt16(o, Math.max(-1, Math.min(1, l[i])) * 32767, true); v.setInt16(o + 2, Math.max(-1, Math.min(1, r[i])) * 32767, true); o += 4; } }
    const bytes = new Uint8Array(buf); let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  })()`);
  fs.writeFileSync(h.opt.wav, Buffer.from(b64, 'base64'));
  if (h.opt['offset-file']) fs.writeFileSync(h.opt['offset-file'], String(t0));
  console.log('audio recorded: first sample is song time ' + t0.toFixed(4) + ' s');
}
