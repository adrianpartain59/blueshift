// game/city.js — everything outside the play tube: deep space and the jump gate, THE SPINDLE (the
// cylinder megacity wrapped around the player), sky traffic, the service lattice, and the closed
// launch conduit that hides it all until THE DROP.
//
// Shells are drawn from the outside in (sky, city, traffic, lattice, conduit), each far to near.
// Seen from the axis an inner shell is always nearer than an outer one on the same line of sight,
// so that order is a correct painter's sort without sorting anything.
//
// Rules this layer obeys (docs/DESIGN.md, readability): nothing inside radius 9 m except the
// conduit walls; hairlines and small dots at k <= 0.35 in the gear ramp (brief waves may exceed
// it); never magenta or yellow; nothing at the vanishing point except the jump gate.
import { damp, clamp01 } from '../engine/math.js';
import { createEnv, NSECT } from './city_env.js';
import { createSky } from './city_sky.js';
import { createSpindle } from './city_spindle.js';
import { createNear } from './city_near.js';
import { createConduit } from './city_conduit.js';

const WAVE_SPEED = 300;       // m/s: how fast a sector change sweeps down the city ahead of the runner
const IGNITE_SPEED = 460;     // m/s: the nova's first light racing forward at THE DROP

export function createCity(gfx, cam) {
  const E = createEnv(gfx, cam);
  const sky = createSky(E), spindle = createSpindle(E), near = createNear(E), conduit = createConduit(E);

  let inited = false;         // false until the first update of a run
  let anchored = false;       // the cell grid is pinned to the conduit mouth
  let igniteT = 99;           // seconds since novaIgnite
  let gearFlash = 0;
  let dropped = false;        // the shutter has been broken this run (frame.conduit lags it by the hit-stop)

  function reset(quick) {
    inited = false; anchored = false; dropped = false;
    igniteT = 99; E.igniteOn = false; E.afterglow = 0; E.revealT = 99; E.launchT = 9;
    E.igniteLevel = quick ? 3 : 0;
    E.pipT[1] = E.pipT[2] = E.pipT[3] = 99;
    E.frontOn = false; E.front = 1e9;
  }

  function onEvent(ev, frame) {
    switch (ev.type) {
      case 'start': reset(!!ev.quick); break;
      case 'pip': if (ev.n >= 1 && ev.n <= 3) { E.pipT[ev.n] = 0; if (ev.n > E.igniteLevel) E.igniteLevel = ev.n; } break;
      case 'launch': E.launchT = 0; E.igniteLevel = 3; break;
      case 'drop': E.revealT = 0; dropped = true; break;
      case 'novaIgnite': igniteT = 0; E.igniteOn = true; break;
      case 'gearUp': gearFlash = 1; break;
      case 'crash': E.danger = E.danger + 0.35 > 1 ? 1 : E.danger + 0.35; break;      // the nova's light lunges in, then falls back
      default: break;
    }
  }

  function update(dt, frame) {
    if (frame.paused) dt = 0;
    const sec = frame.sector < 1 ? 1 : frame.sector > NSECT ? NSECT : frame.sector;
    if (!inited) {
      inited = true;
      E.secFrom = E.secTo = sec; E.frontOn = false;
      E.gShat = E.themeRow(sec, 4); E.gCor = E.themeRow(sec, 5); E.gFlare = E.themeRow(sec, 6);
      E.gSign = E.themeRow(sec, 2); E.gMach = E.themeRow(sec, 3); E.gStar = sec === 5 ? 1 : 0;
      E.danger = frame.danger;
      E.conduitOn = false;
    }
    // ---- anchor the city's cell grid to the conduit mouth, so the reveal is the same city every run
    if (frame.conduit === 1) { E.origin = frame.dist + frame.conduitEndZ; anchored = true; E.conduitOn = true; }
    else {
      if (!anchored) { E.origin = frame.dist + frame.conduitEndZ; anchored = true; }
      dropped = true;
      if (frame.conduitEndZ < cam.z - 2) E.conduitOn = false;
    }
    E.capOn = E.conduitOn && !dropped;
    E.endZ = frame.conduitEndZ;

    // ---- sector theme: a change sweeps forward from the runner as a wave
    if (sec !== E.secTo) {
      E.secFrom = E.secTo; E.secTo = sec; E.front = -20; E.frontOn = true;
    }
    if (E.frontOn) {
      E.front += WAVE_SPEED * dt;
      if (E.front > 720) { E.frontOn = false; E.secFrom = E.secTo; }
    }
    const r = 1 - Math.exp(-dt * 0.9);
    E.gShat += (E.themeRow(sec, 4) - E.gShat) * r; E.gCor += (E.themeRow(sec, 5) - E.gCor) * r;
    E.gFlare += (E.themeRow(sec, 6) - E.gFlare) * r; E.gSign += (E.themeRow(sec, 2) - E.gSign) * r;
    E.gMach += (E.themeRow(sec, 3) - E.gMach) * r;
    E.gStar += ((sec === 5 ? 1 : 0) - E.gStar) * r;      // only CORONA skims the star itself

    // ---- light
    E.danger = damp(E.danger, frame.novaOn ? frame.danger : 0, 3, dt);
    igniteT += dt; E.revealT += dt; E.launchT += dt;
    E.pipT[1] += dt; E.pipT[2] += dt; E.pipT[3] += dt;
    if (E.igniteOn) {
      E.igniteZ = -70 + igniteT * IGNITE_SPEED;
      if (E.igniteZ > 800) E.igniteOn = false;
    }
    // the nova's first light lingers on the near city for a few seconds, then cools
    E.afterglow = igniteT < 6 ? 0.4 * Math.exp(-igniteT / 2.2) : 0;
    gearFlash = damp(gearFlash, 0, 5, dt);
    // leaving the dark tunnel: the city is overexposed for a moment, then the eye settles
    E.boost = 1 + 1.35 * Math.exp(-E.revealT / 0.5) + 0.25 * gearFlash;
    // the gold that is nobody's palette yet, creeping up the conduit over the last four beats
    E.creep = frame.conduit === 1 ? clamp01((frame.beat - (frame.dropBeat - 4)) / 4) : 0;
  }

  function draw(frame) {
    E.begin(frame);
    // While the conduit's shutter is closed the city is invisible. It is still drawn for the last
    // half second so that the frame the shutter breaks is not the first frame the city ever ran.
    const hidden = E.capOn && E.endZ > 26;
    sky.draw();
    if (!hidden) {
      spindle.draw();
      near.draw();
    }
    if (E.conduitOn) conduit.draw();
  }

  reset(true);
  return { onEvent, update, draw };
}
