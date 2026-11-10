# BLUESHIFT — architecture and module contracts

Read `docs/DESIGN.md` (what the game is), then `docs/ENGINE.md` (how to draw and make sound), then
this file (who owns what and how the pieces talk).

## Layout and ownership

```
index.html                 page shell (dev: loads src/main.js as a module)
src/engine/                the engine. No game code. Do not edit; ask the integrator by leaving a note.
  gfx.js font.js cam3d.js particles.js fx.js loop.js input.js audio.js math.js
src/game/
  config.js                every shared number and color                       (integrator)
  timeline.js              tempo map: beats <-> seconds, sectors               (integrator)
  frame.js                 the render-state contract                           (integrator)
  camera.js                chase camera setup                                  (integrator)
  tube.js                  rails, ribs, strike ring                            (integrator)
  sim.js level.js patterns.js bot.js hazards.js game.js                        (integrator)
  music.js                 the soundtrack                                      (music agent)
  sfx.js                   sound effects                                       (sfx agent)
  city.js                  everything outside the play tube                    (city agent)
  vfx.js                   particles, juice, nova dressing, camera kicks       (vfx agent)
  courier.js               the runner and its light ribbons                    (courier agent)
  hud.js                   HUD, title, results, prompts, banners               (hud agent)
dev/                       one standalone test page per module + dev/lib/stage.js (the mock game)
tools/                     harness.mjs (eyes), shots.mjs (storyboards), audio_probe.mjs (ears), build.mjs
docs/                      DESIGN.md ENGINE.md ARCHITECTURE.md pitches/
out/                       screenshots and renders (scratch; write only under out/<your-module>/)
```

**Edit only the files you own** (your module, your dev page, files under `out/<your-module>/`).
If you need something from a file you do not own, do not change it: say so in your final report.
You may add private helper files next to your module as `src/game/<module>_*.js`.

## The world you draw in

Everything 3D goes through `cam` (a `createCam3d` instance the game has already aimed):

- **Tube frame:** origin on the tube axis at the runner's depth. `x` right, `y` up, `+z` ahead of the
  runner (the camera sits at z = -8). Angles around the axis: 0 = straight down, lane `i` is centred
  at `i * 45` degrees. Helpers in `config.js`: `tubeX(angle, r)`, `tubeY(angle, r)`, `laneAngle(lane)`.
- The camera **rolls** by `frame.roll` so the runner's lane is drawn at the bottom of the screen.
  You do not handle that: draw in the tube frame and the world spins by itself. That is the point.
- Scroll with distance: a thing that lives at world distance `d` is at `z = d - frame.dist`.
  Hazards are different (time-locked) but only the integrator draws those.
- The play tube is the octagon of apothem 5 m. **Decoration must stay at radius >= 9 m.**
- Distances fade with `cam` fog (starts 40 m, gone by 620 m). The vanishing point is where the
  future is: keep it clean.

`frame` (see `src/game/frame.js`, it is the contract) is rebuilt every rendered frame. Song values
in it are visual time (they include hit-stop). Use `frame.time` for cosmetic animation, `frame.beat`,
`frame.beatPhase`, `frame.kick` for anything that should move with the music, `frame.gearF` for the
color ramp (`gearColor(frame.gearF, out)` in `tube.js`), `frame.danger` for nova light.

## Frame order (who draws when)

```
gfx.beginFrame()
setupCamera(cam, frame, vfx.kick)
gfx.push(); gfx.translate(fx.camX, fx.camY)       // world shake
  city.draw(frame)                                // background: space, megacity, lattice, conduit walls
  vfx.drawBack(frame)                             // effects that sit behind hazards (rib light pulses)
  drawTube + hazards (integrator)                 // rails, ribs, telegraphs, hazards far-to-near, pickups
  courier.draw(frame)
  vfx.drawWorld(frame)                            // shards, sparks, embers, flying judgement text
gfx.pop()
vfx.drawScreen(frame)                             // screen-space but still bloomed: nova edge glow, speed streaks
hud.drawWorld(frame)                              // HUD pieces that should bloom (lead arc under the runner)
gfx.beginOverlay(fx.post)
hud.draw(frame)                                   // crisp HUD, title, results, prompts
gfx.endFrame(fx.post)
```

Every module also gets `onEvent(ev, frame)` for each simulation event that happened since the last
frame, then `update(dt, frame)` once per frame with real `dt`.

## Events

Events are small plain objects with a `type`. Do not keep references to them. Every event that
adds score carries `pts`, the points actually added (already multiplied by the gear at that
instant): show that number, never one recomputed from the frame. Nothing but `beat` is emitted
after `death`.

| type | payload | when |
|---|---|---|
| `start` | `quick` | a run begins: ignition at beat 0, or the quick launch at beat 18 on a retry |
| `beat` | `beat, bar, downbeat` | every beat of song time |
| `pip` | `n` (1..3) | ignition: a rib lights on beats 1, 2, 3 |
| `launch` | | the courier fires out of the barrel (beat 4, or beat 20 on a quick launch) |
| `roll` | `dir (-1/+1), lane, air` | the lane changed (`air`: a mid-flip steer) |
| `rollRefused` | `dir` | a roll was blocked by a fin: grinding starts |
| `grind` | `side, pts` | once per beat while grinding a fin |
| `grindEnd` | | |
| `flip` | `fromLane, toLane, clean` | flip launched (`clean`: on a launch-pad beat) |
| `land` | `lane` | flip landed |
| `breach` | `auto` | the ram and its lance fire, hit or not (`auto`: an opening shutter ramming itself) |
| `breachHit` | `grade ('perfect'/'good'), kind ('wall'/'pylon'/'gate'/'shutter'/'core'), chain, auto, pts` | ICE shattered. `auto`: one of the opening's two shutters broke itself on its beat because nobody rammed it (no judgement, no points) |
| `breachCredit` | `grade, kind, chain, pts` | BREACH pressed up to 200 ms after an auto shutter broke itself: the press is absorbed into that break and graded as the player's own (judgement and score only: no second ram, burst or sound) |
| `whiff` | | the ram ended without hitting anything |
| `graze` | `side (-1 left, +1 right), pts` | a solid passed in the adjacent lane |
| `thread` | `pts` | solids passed on both sides at once |
| `irisPass` | `clean, pts` | flew through an iris |
| `orb` | `n, pts` | collected a core orb (`n` = how many in a row) |
| `spark` | `n, pts` | collected a lane spark |
| `flyby` | `side (-1, 0, +1), kind` | a hazard passed the runner's depth without touching |
| `crash` | `cause, gearLost` | hit a solid or unbroken ICE: gears and lead lost |
| `stumble` | `cause` | conduit only: a hit that costs nothing |
| `gearUp` / `gearDown` | `gear` | |
| `sector` | `sector, name` | entered a new sector |
| `sectorGate` | `sector, pts` | the gate at a sector boundary was breached |
| `drop` | | THE DROP (beat 20): the conduit ends and the city is revealed |
| `novaIgnite` | | same beat as `drop` |
| `leadLow` | `level (1: under 80 m, 2: under 40 m)` | the nova is closing in |
| `leadSafe` | | lead is back above 80 m |
| `death` | `cause` | caught by the nova |
| `results` / `title` | | screen changes |
| `pause` / `resume` | | |
| `comfort` | `on` | the player toggled comfort mode with C (`frame.comfort` holds the state, which is remembered and starts on when the system asks for reduced motion) |

## Module APIs

```js
// city.js
export function createCity(gfx, cam)      // -> { onEvent(ev, frame), update(dt, frame), draw(frame) }
// vfx.js
export function createVfx(gfx, cam, fx)   // -> { kick, onEvent, update, drawBack(frame), drawWorld(frame), drawScreen(frame) }
//   vfx.kick = { fov, back, dip }: camera offsets the game adds each frame (degrees, metres, metres)
//   vfx is the ONLY module that calls fx.shake/flash/aberrate/shockwave/... (no double shakes)
// courier.js
export function createCourier(gfx, cam)   // -> { onEvent, update, draw(frame) }
// hud.js
export function createHud(gfx)            // -> { onEvent, update, drawWorld(frame), draw(frame) }

// music.js
export function createMusic(audio)        // -> music
//   music.start(when, fromBeat = 0)   song beat `fromBeat` sounds at context time `when`
//   music.stop(when = audio.now, fade = 0.05)
//   music.update()                    live: call every frame; schedules everything up to audio.now + 0.25 s
//   music.scheduleUntil(ctxTime)      offline: schedule everything up to ctxTime (used by the audio probe)
//   music.setGear(1..5)               which layers play, from the next scheduled step on
//   music.setIntensity(0..1)          probe helper: maps to gear 1..5
//   music.setBarFlags(bar, { noSnare, noDrums, build })   arrangement cues from the level, set ahead of time
//   music.setDanger(0..1)             nova proximity tension layer
//   music.tapeStop(when, seconds)     crash: everything detunes down about 3 semitones and recovers
//   music.setAmbient(on)              title / results bed (not tempo critical)
//   music.beatAt(ctxTime) -> float    song beat sounding at that context time
//   music.chordAt(beat) -> 0..3       index into the Fm - Db - Ab - Eb loop
//   music.bpm, music.running

// sfx.js
export function createSfx(audio)          // -> sfx
//   sfx.names                         every one-shot name
//   sfx.play(name, { when, vol, pan, pitch, ...per-sound options })
//   sfx.loop(name, level, { pan })    continuous beds: sets a target level 0..1 (0 = off), smoothed
//   sfx.stopAll()
```

The game owns the mapping from events to `sfx.play` and `music.*` calls; audio modules just have to
sound right and be schedulable at an exact `when`.

## Building and checking your module

1. Start from `dev/tube.html`: copy it to `dev/<module>.html`, create your module, and register its
   hooks with the stage: `createStage().use({ onEvent, update, drawBackground, drawBack, drawWorld,
   drawScreen, drawOverlay }).start()` (any subset; names map 1:1 to the frame order above:
   city.draw -> drawBackground, hud.draw -> drawOverlay, hud.drawWorld -> drawScreen).
   `stage.gfx`, `stage.cam`, `stage.fx`, `stage.frame` are what the real game will hand you.
   The stage plays the opening 32 seconds of the game (ignition, conduit, THE DROP at 9.4 s,
   corkscrew, irises, breaches, a crash at beat 52, the drum fill) and then a repeating phrase, and
   fires the real events. Read `dev/lib/stage.js` for the URL parameters (`t`, `start`, `gear`,
   `lead`, `sector`, `mode`, `die`, `notube`, `norunner`).
2. Look at it: `node tools/shots.mjs --page "/dev/<module>.html" --times 1,5.6,9.5,12,18,24.4 --out out/<module>`
   writes one PNG per time plus `out/<module>/sheet.png`; open them with the Read tool. One frame:
   `node tools/harness.mjs --page "/dev/<module>.html?t=9.5&gear=5" --wait-for "window.__done" --shot out/<module>/x.png`.
   Judge the picture like an art director, change the code, shoot again. Iterate until it is
   genuinely good, not merely present. Check several gears, sectors and moments, and `--dpr 2` once.
3. Count your cost: add `--eval "window.__stage.gfx.stats"` to a harness run to see quads per frame.
4. Before you finish: `node --check` on each file you wrote, `node tools/build.mjs --check src/game/<module>.js`
   (dialect), and a final harness run with no `PAGE ERRORS`.

Budgets (quads per frame at 1280x720, whole game must stay near one draw call): city 6000, vfx 3500
at its busiest, hud 1500, courier 500. No per-frame allocation. No `Math.random()` (use `hash1`,
`hash2`, `noise1`, `makeRng`, or a particle system's `rnd`), so captures are reproducible.

## Audio modules

Use `node tools/audio_probe.mjs ...` (see ENGINE.md, Tools). It renders your real module offline
through the real bus graph and prints peak / RMS / crest / clipped samples / band balance per
second, and writes a WAV and a spectrogram PNG you can open with the Read tool. Nobody on this
project can listen, so the numbers and the spectrogram are the mix check: use them.
Targets for the full mix at gear 5: integrated RMS around -16 to -13 dBFS, peaks under -1 dBFS,
zero clipped samples, sub+bass 35-50% of energy, a visible kick every beat in the spectrogram.
Connect music to `audio.musicBus`, effects to `audio.sfxBus`, reverb sends to `audio.reverbIn`.
Schedule everything at explicit context times. Create nodes per note and let them be collected
(stop oscillators, no leaks); cap polyphony so a busy bar cannot overload the audio thread.
