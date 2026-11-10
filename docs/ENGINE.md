# Engine reference

The engine lives in `src/engine/` and has no dependencies and no game-specific code. Read the source
when in doubt: it is short and it is the truth. This file is the map.

## Ground rules

- **Module dialect (the bundler enforces it):** top-level `import { a, b as c } from './x.js'` or
  `import * as ns from './x.js'`; top-level `export function|class|const NAME` or `export { a, b }`.
  No default exports, no `export let`, no re-exports, no dynamic import, no circular imports, no
  `import.meta`, no top-level await. Relative specifiers ending in `.js`.
- **No per-frame allocation in hot paths.** Preallocate arrays/objects at module scope and reuse them.
  No closures, array literals, spread, `map/filter/forEach` or string building inside per-entity
  per-frame code. GC hitches are felt as stutter and stutter kills game feel.
- **No `Math.random()` in simulation code.** Use `makeRng(seed)` from `math.js` so runs are
  reproducible. Cosmetic code may use `hash1/hash2/noise1` (stateless) or a particle system's `rnd`.
- **Never touch the DOM or `window` at module top level.** Modules must be importable in node for
  syntax checks and pure-logic tests. Do DOM work inside functions.
- Plain modern JavaScript, 2-space indent, semicolons, single quotes. Comments say why, not what.

## Coordinates, color, light

- The view is always **720 logical units tall** (`VIEW_H`); width `gfx.W` follows the window aspect
  (960..1760, 1280 at 16:9). **y grows downward**, (0,0) is the top-left of the view.
- Colors are **linear-light `[r,g,b]` triples**. Make them with `hex('#00e5ff')` once at module scope.
- Every draw call takes a color plus **`k`, a light multiplier** (HDR: values above 1 are fine and
  are what blooms) and, for solids, **`a`, an occlusion alpha**: `a = 0` is pure additive glow,
  `a = 1` fully hides what is behind it. Neon = lines/glows with `a = 0`. Silhouettes = dark solids
  with `a = 1`, usually with a neon edge drawn on top.
- Intensity guide: `k` 0.15..0.5 background decoration, 0.8..1.2 normal neon, 1.5..2.5 hot gameplay
  elements, 3+ flashes. Bloom starts around brightness 0.9, so background art must stay below
  that or it turns to fog and hides gameplay.
- Draw order is submission order (painter's algorithm). One draw call per ~16k quads, so do not
  worry about batching; do cull things that are far off screen (lines/glows/rings cull themselves).

## `gfx.js` — renderer

`createGfx(canvas, opts?) -> gfx | null` (null when WebGL2 is missing).

Frame: `gfx.beginFrame()` ... draw the world ... `gfx.beginOverlay(post)` ... draw HUD/menus ...
`gfx.endFrame(post)`. World draws go to an HDR buffer and get bloom, shockwave distortion and radial
blur. Overlay draws land after that: crisp, no bloom (line halos still glow), immune to world
distortion, but still under the final screen pass (aberration, scanlines, vignette, glitch, flash).
The aberration grows toward the edges like a lens but levels off outside the middle of the screen, so
score and gear read-outs in the corners split by a few pixels on a big hit, not by tens.
`beginOverlay` is optional; without it everything is world.

Transform stack (affects everything drawn after it): `push() pop() translate(x,y) scale(sx,sy?)
rotate(rad) resetTransform()`, plus `setFade(k)` / `mulFade(k)` (multiplies all light and alpha;
restored by `pop()`), `tx(x,y)`/`ty(x,y)` (local point to view space). Line widths and radii scale
with the transform.

Primitives (all coordinates in the current local space):

| Call | What |
|---|---|
| `rect(x, y, w, h, col, k=1, a=1)` | solid rect, anti-aliased edges |
| `quad(x0,y0, x1,y1, x2,y2, x3,y3, col, k=1, a=1)` | any convex quad, vertices in order |
| `quadGrad(x0..y3, colA,kA,aA, colB,kB,aB)` | vertices 0,1 use A; 2,3 use B |
| `rectGrad(x, y, w, h, colA,kA,aA, colB,kB,aB)` | vertical gradient, top = A |
| `tri(x0,y0, x1,y1, x2,y2, col, k=1, a=1)` | triangle |
| `line(x0,y0, x1,y1, width, col, k=1, glow=4, a=0)` | neon line with round caps; `width` = bright core, halo reaches `width*glow/2` |
| `polyline(flatPts, n, width, col, k=1, closed=false, glow=4)` | connected lines |
| `rectLine(x, y, w, h, width, col, k=1, glow=4)` | neon rectangle outline |
| `ring(x, y, radius, width, col, k=1, glow=4, a=0)` | perfect neon circle outline |
| `arc(x, y, radius, a0, a1, width, col, k=1, glow=4)` | neon arc (radians) |
| `disc(x, y, radius, col, k=1, a=1)` | filled circle |
| `glow(x, y, radius, col, k=1, pow=2, a=0)` | soft radial light; `pow` 1 = wide, 4 = tight |
| `glowEllipse(x, y, rx, ry, col, k=1, pow=2, a=0)` | stretched glow |

`gfx.createLayer(fragmentShaderSource) -> { uniforms, draw(time, (gl, u) => {...}) }` draws a
full-view fragment shader in submission order (procedural skies, nebulae, planets). The shader is
GLSL ES 3.00, gets `in vec2 v_uv` (0..1, origin bottom-left), `uniform vec2 u_res` (logical W,H) and
`uniform float u_time`, and writes premultiplied HDR to `out vec4 o` (alpha 1 replaces, 0 adds).

Post-processing: pass an object to `endFrame(post)`; missing fields use defaults:
`time, exposure(1), bloom(1), bloomThreshold(0.9), bloomSpread(0.72), contrast(0.35),
aberration(0.0012), vignette(0.42), scanlines(0.08), grain(0.035), flash(0), flashColor([1,1,1]),
glitch(0..1), radialBlur(0..0.2), barrel(0.02), saturation(1), tint([1,1,1]), invert(0..1),
zoom(1), fade(1), offsetX/offsetY (logical units, whole-screen punch), centerX/centerY (0..1, y
down; origin of aberration and radial blur), shockwaves ([{x, y, radius, width, strength}] in 0..1
view space, y down, up to 4)`.

Other: `gfx.W`, `gfx.H`, `gfx.pxScale` (device px per unit), `gfx.stats` ({quads, draws}),
`gfx.setRenderScale(s)`, `gfx.clientToView(clientX, clientY)`.

## `cam3d.js` — 3D on top of the 2D batch

`createCam3d(gfx) -> cam`. A perspective camera whose projection runs on the CPU and feeds the same
batch, so 3D and 2D share one draw call. World axes: x right, y up, +z into the screen. Set `cam.x/y/z`,
`yaw/pitch/roll`, `fov` (vertical, radians), `cx/cy` (vanishing point as a fraction of the view),
`curveX/curveY` (a curved-world bend: view x,y += curve * z^2), `fogStart/fogEnd/fogPow`,
`maxLineWidth` (on-screen cap for line cores, so lines passing the lens do not balloon), then call
`cam.begin()` once per frame. `begin()` takes a snapshot of every camera property and drawing reads
only the snapshot, so a property changed after `begin()` has no effect until the next `begin()`.
Draw far-to-near (painter's algorithm, no depth buffer):

| Call | What |
|---|---|
| `cam.line(x0,y0,z0, x1,y1,z1, width, col, k=1, glow=4)` | neon line; `width` in world units, tapers with distance, near-plane clipped, fogged per end |
| `cam.quad(x0..z3 (12 numbers), col, k=1, a=1)` | convex quad, near-plane clipped, fogged per vertex, culled when fully off screen |
| `cam.glow / cam.ring / cam.disc (x, y, z, radius, ...)` | camera-facing sprites sized in world units |
| `cam.project(x, y, z) -> bool` | sets `cam.sx, cam.sy` (view position), `cam.s` (pixels per world unit there), `cam.zc` (depth); false when behind the near plane. Hot loops read `cam.P[0..3]` (the same four numbers in a typed array) to avoid boxed getter returns |
| `cam.fog(depth)`, `cam.depth(x, y, z)` | helpers |
| `cam.lineA(col, glow)`, `cam.quadA(col)` | the same line and quad with their numbers read from `cam.A = [x0,y0,z0, x1,y1,z1, width, k]` and `cam.Q = [12 coordinates, k, a]`. `line()` and `quad()` are thin wrappers that fill those arrays; they are small enough for V8 to inline, which is what keeps their arguments off the heap |

### Why the hot paths look the way they do

V8 keeps numbers that are not small integers in heap boxes whenever they cross a boundary it cannot
see through: a double written to a closure variable, returned from a function it did not inline, or
passed as an argument to one. At a few thousand primitives per frame that was 1.76 MB of garbage
per frame (measured with `tools/scripts/heap.mjs`). So the renderer keeps its transform in a typed
array, writes vertices inline, and offers scratch entry points for hot callers: fill
`gfx.S` and call `gfx.lineS(col, glow, a)` (`S = [x0, y0, x1, y1, width, k]`),
`gfx.lineTaperS(col, glow)` (`S = [x0, y0, w0, k0, x1, y1, w1, k1]`), `gfx.quadKS(col, a)`
(`S = [x0,y0,k0, x1,y1,k1, x2,y2,k2, x3,y3,k3]`) or `gfx.quadGradS(colA, colB)`
(`S = [x0,y0, x1,y1, x2,y2, x3,y3, kA, aA, kB, aB]`). The many-argument forms (`line`, `lineTaper`,
`quadK`, `quadGrad`) are thin wrappers that fill `S`, so they overwrite it. In your own hot loops: keep per-call scratch in
typed arrays at module scope, do not write doubles to captured `let` variables, and do not pass many
doubles through small helpers.

Two more cases found with the allocation profiler, both in `cam3d.js`:
- **Arguments.** A big function is never inlined, so every non-integer argument passed to it is boxed
  by the caller: eight per `cam.line`. Making `line()` a ten-line wrapper around an argument-free
  `lineA()` fixed every existing call site at once, because the wrapper IS inlined.
- **Object properties.** Reading `cam.near`, `cam.fogStart` and friends inside `lineA` cost 32 bytes
  per line. The camera's numbers now live in one `Float64Array` snapshot filled by `begin()`.
  After both: 0 bytes and 0 collections for 15 million lines in node, and 2.8 times faster.
- **Helpers called several times from one big function.** V8 inlines some of the calls and not the
  rest, so `view(x, y, z)` boxed its three numbers on the calls that were left out. `viewAt(array,
  index)` takes an array and a small integer instead: nothing to box either way.

Whole game after the city code was converted the same way (`tools/scripts/heap.mjs`, 60 s live bot
run): 45 KB of garbage per frame, down from 1.76 MB, with every frame pixel-identical to before.
What is left is mostly strings for HUD numbers and a few doubles returned by small helpers.

## `font.js` — neon vector font

`drawText(gfx, str, x, y, size, col, k=1, align=0, opts?) -> width` — `size` is cap height, `(x,y)`
anchors horizontally by `align` (0 left, 0.5 center, 1 right) and vertically at the middle of the
caps. `opts`: `{ tracking, weight (0.09), glow (4), slant }`. Uppercase A-Z, digits and
`. , : ! ? - + = / \ % ( ) [ ] < > _ ' " * # × ↑ ↓ ← → ♦ ▲ ▼ ■ ● |`. `measureText(str, size, tracking)`.
`drawTextFx(gfx, str, x, y, size, col, k, align, opts, (i, n) => ({dx, dy, k, skip}))` for
per-glyph animation. Text is made of lines, so it blooms; keep `k` near 1.0..1.4 for small text.

## `particles.js`

`createParticles(max=4096) -> ps`. `ps.spawn(x, y, {vx, vy, life, size, sizeEnd, col, k, drag, gx,
gy, type, rot, spin})`, `ps.burst(x, y, {count, angle, spread, speedMin, speedMax, lifeMin,
lifeMax, size, sizeEnd, col, k, drag, gx, gy, type, spinMax, inheritVx, inheritVy})`,
`ps.update(dt)`, `ps.draw(gfx)`, `ps.clear()`, `ps.rnd()`. Types: `P_GLOW, P_SPARK, P_RING,
P_SHARD, P_SQUARE`.

## `fx.js` — screen-level game feel

`createFx(loop) -> fx`. Runs on real time (keeps moving during hitstop/slow motion). Owns `fx.post`
(pass it to `gfx.endFrame`) and `fx.base` (the steady look the game sets each frame: `exposure,
bloom, aberration, radialBlur, vignette, scanlines, grain, barrel, saturation, zoom, glitch, fade,
contrast, tint, centerX, centerY`). Triggers: `shake(0..1)` (trauma; offsets in `fx.camX/camY/camRot`
for the world camera), `punch(dx, dy)`, `zoomPunch(amount)`, `flash(col, amount, decay)`,
`aberrate(amount, decay)`, `radialBlur(amount, decay)`, `glitch(amount, seconds)`, `invert(seconds)`,
`desaturate(amount, decay)`, `exposureKick(amount, decay)`, `shockwave(x, y, strength, speed, life,
width)` (0..1 view space), `slowmo(scale, hold, easeOut)`. Call `fx.update(realDt)` once per frame.

## `loop.js`

`createLoop({ update(dt), render(alpha, realDt), hz=120 })`. Fixed 120 Hz simulation steps with
render interpolation. `loop.timeScale` (slow motion), `loop.hitstop(seconds)` (freeze frames),
`loop.paused`, `loop.manual` + `loop.stepFrames(n, fps=60)` for deterministic capture.

## `input.js`

`createInput({ action: ['KeyCode', ...] })`. Per sim step call `input.update(dt)`. Query with
`input.down(a)`, `input.buffered(a, windowSec)` + `input.consume(a)`, `input.released(a)`.
`input.inject(a, bool)` / `input.tap(a)` drive it from bots and tests. `attachPointer(el, zoneFn)`,
`setGamepadMap`, `rumble`, `takeAnyPress()`.

## `audio.js` — audio core

`createAudio({ ctx? }) -> audio`: `audio.ctx`, `audio.now`, buses `audio.musicBus`, `audio.sfxBus`,
`audio.reverbIn` (send into a shared 2.6 s reverb), `audio.noise()` (shared white-noise buffer),
`duck(depth, attack, release, when)`, `setMusicLowpass(freq, glide, when)`, volume setters,
`getSpectrum()`. Works on an `OfflineAudioContext` too, which is how the audio probe measures things.
Signal path: music bus (filter, duck) and sfx bus and reverb -> master -> limiter -> `audio.out`
(a fixed -0.6 dB trim that keeps one decibel of true-peak headroom) -> speakers. Record from `audio.out`.
**Everything must be scheduled at explicit context times** (`when`), never with `setTimeout`.

## `math.js`

`TAU clamp clamp01 lerp invLerp remap remapClamp smoothstep sign fract mod approach damp dist`,
`ease.{linear,inQuad,outQuad,inOutQuad,inCubic,outCubic,inOutCubic,outQuart,outExpo,inExpo,outBack,outElastic,outBounce,pulse}`,
`makeRng(seed)` (`rng()`, `.range(a,b)`, `.int(a,b)`, `.pick(arr)`, `.chance(p)`, `.sign()`),
`hash1(n) hash2(a,b) noise1(x)`, `hex('#rrggbb') mixColor scaleColor hsv`.

## Tools (all zero-dependency, run from the project root)

- **Eyes:** `node tools/harness.mjs --page "/dev/yourpage.html?t=2.5" --wait-for "window.__frames > 3" --shot out/yourname.png`
  renders a page in headless Chrome (real GPU, WebGL2) and saves a PNG you can open with the Read
  tool. Exit code 2 and a `PAGE ERRORS` block mean an exception or `console.error` happened: fix it.
  Add `--dpr 2` for a sharper shot, `--width/--height` for other sizes, `--eval "expr"` to print a
  value, `--script file.mjs` for multi-step runs (`h.eval`, `h.shot`, `h.tap`, `h.sleep`, `h.waitFor`).
  `--touch 1` emulates a phone (touch events, coarse pointer; `h.touchTap(x, y)`, `h.touch(type, points)`),
  `--autoplay 0` keeps Chrome's real autoplay policy so audio only starts from a real gesture, and
  `--url https://...` points the same harness at a deployed copy.
  Each run uses its own port and browser profile, so parallel runs are safe. Write shots only under
  `out/<your-module>/`. Make dev pages deterministic: read a `t` query parameter instead of the clock.
  Crop/zoom a shot with ffmpeg if you need detail:
  `ffmpeg -loglevel error -y -i in.png -vf "crop=640:360:0:0,scale=1280:-1:flags=neighbor" out.png`.
- **Ears:** `node tools/audio_probe.mjs music --seconds 32 --timeline 0:0.2,8:0.5,16:0.8,24:1`,
  `node tools/audio_probe.mjs sfx [--names a,b]`, `node tools/audio_probe.mjs mix --seconds 16 --names a,b`
  render the real audio modules offline and print peak/RMS/crest/clipping/band balance, and write
  `out/audio/<mode>.wav`, a spectrogram `.png` and a `.json` report. Use `--tag` to keep variants.
- **Real mix:** `node tools/capture_audio.mjs --seconds 40 --seed 3 --tag live` records what the real
  game outputs (music plus every effect a live bot run triggers) and prints peak/RMS and a spectrogram.
- **The bot:** `node tools/simtest.mjs fair 60 300` (a perfect bot must never crash) and
  `node tools/simtest.mjs balance 30` (survival by skill) play the pure simulation in node.
- **The rules:** `node tools/rulestest.mjs` scripts inputs into the simulation and checks the events
  that come out (auto shutters on the beat, late credit, a stray press never swallowing the press on
  the beat, mashing not being a way through, grind state, the opening's locks, nothing after death).
- **Real-time tests:** `node tools/harness.mjs --page "/index.html?vol=0&seed=3" --script tools/scripts/live_input_test.mjs`
  (real click, real keys, audio clock), `live_flow_test.mjs` (pause, death, results, retry),
  `live_edge_test.mjs` (two keys on one direction, pause races, the audio clock stopping and coming
  back, retry straight from the death with a held key), `live_menu_test.mjs` (Q / Esc / gamepad B:
  pause, main menu, retry), `live_touch_test.mjs` (run it with `--touch 1 --autoplay 0 --width 844
  --height 390`: start on finger lift, corner pause, comfort switch, MAIN MENU), `perf.mjs` (frame times, quads, main-thread
  cost), `heap.mjs` (bytes of garbage per frame, by file and function), `death_flow.mjs` (death and
  results screenshots).
- **Shipped build:** `node tools/build.mjs && node tools/dist_check.mjs` plays the same seed and inputs
  on the dev modules and on the bundled file and fails if their state differs. A bundle that runs is
  not proof that it is the same game.
- **Video:** `node tools/make_video.mjs --seconds 34 --seed 3` renders exact frames and muxes the real audio.
- **Syntax:** `node --check src/path/file.js`. **Bundle:** `node tools/build.mjs` (`--check file` validates one module).
- Do not use the in-app Browser pane or the user's Chrome; the harness is the parallel-safe path.
