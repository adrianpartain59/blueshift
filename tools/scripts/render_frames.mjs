// Renders exact frames of a manual-stepping run to JPEG files. Driven by tools/make_video.mjs:
//   node tools/harness.mjs --page "/index.html?manual=1&bot=1&seed=3" --script tools/scripts/render_frames.mjs --frames 1020 --fps 30 --dir out/video/frames
import fs from 'node:fs';
export default async function (h) {
  const n = +h.opt.frames, fps = +h.opt.fps || 30, dir = h.opt.dir;
  fs.mkdirSync(dir, { recursive: true });
  await h.waitFor('window.__stage && window.__stage.seek', 20000);
  for (let i = 0; i < n; i++) {
    await h.eval('window.__stage.seek(' + i / fps + ')');
    const r = await h.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93 });
    fs.writeFileSync(dir + '/f' + String(i).padStart(5, '0') + '.jpg', Buffer.from(r.data, 'base64'));
    if (i % 150 === 0) console.log('frame ' + i + '/' + n);
  }
}
