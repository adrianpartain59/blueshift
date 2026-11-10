// game/frame.js — the render-state contract. The game fills ONE of these objects every rendered
// frame and hands it to every draw module (city, tube, courier, vfx, hud). Modules read it and
// never write it. All "song" values are VISUAL time: they include the hit-stop offset, so the world
// can freeze for a few frames on a big hit without the real song clock ever pausing.

export function createFrame() {
  return {
    // ---- clocks
    time: 0,          // real seconds since boot. Never pauses. Use for cosmetic animation.
    dt: 0,            // real seconds since the previous rendered frame
    t: 0,             // song time in seconds (0 at ignition)
    beat: 0,          // song position in beats (float, tempo-mapped; beat 20 is THE DROP)
    beatPhase: 0,     // 0..1 inside the current beat (0 = on the beat)
    bar: 0,           // integer bar index (4 beats per bar)
    barPhase: 0,      // 0..1 through the current bar
    bpm: 128,
    kick: 0,          // 1 on every beat, decaying to ~0 before the next: the visual metronome

    // ---- run state
    mode: 'title',    // 'title' | 'ignition' | 'run' | 'dead' | 'results'
    attract: false,   // true while the bot plays behind the title
    paused: false,
    sector: 0,        // 0 = conduit (closed tunnel), 1 = Spindle, 2.. see config SECTOR_NAMES
    sectorT: 0,       // 0..1 progress through the sector
    conduit: 1,       // 1 while inside the closed launch conduit, 0 once past THE DROP
    dropBeat: 20,     // song beat of THE DROP (the conduit's end is `conduitEndZ` metres ahead)
    conduitEndZ: 0,   // z of the conduit mouth relative to the runner (positive = still ahead)
    gear: 1,          // integer 1..5
    gearF: 1,         // smoothed float gear: use for color ramps and anything continuous
    speed: 48,        // current smoothed speed in m/s
    dist: 0,          // metres travelled: scroll the world with this
    flux: 0, fluxN: 0,       // flux, and flux / threshold for the current gear (0..1)
    lead: 220, leadN: 0.73,  // metres ahead of the nova; lead / LEAD_MAX
    danger: 0,        // 0..1 nova proximity: 0 when lead >= 150 m, 1 when caught
    novaOn: false,    // false in the conduit, true after THE DROP
    score: 0, mult: 1, chain: 0,   // chain = consecutive PERFECT breaches
    bestScore: 0, bestDist: 0,   // the best BEFORE this run while dead/results, so a new record can be shown
    newBest: false,   // true on the results screen when this run beat the best score

    // ---- the runner (tube frame: x right, y up, origin on the tube axis at the runner's depth)
    lane: 0,          // logical lane 0..7
    roll: 0,          // smoothed world roll (radians). The camera rolls by this, so the runner's lane is drawn at the bottom.
    rollVel: 0,       // rad/s (bank into it)
    air: -1,          // -1 on the ground, else flip progress 0..1
    runnerX: 0, runnerY: -5,     // feet position
    upX: 0, upY: 1,              // unit vector from feet to head
    runnerSX: 640, runnerSY: 520, runnerS: 60,  // feet on screen (logical units) and pixels-per-metre there
    ramT: -1,         // seconds since BREACH was pressed, -1 when idle (ram is live for 0.18 s)
    landT: 9,         // seconds since the last flip landing
    crashT: 9,        // seconds since the last crash
    ghost: false,     // true during post-crash invulnerability
    grind: 0,         // -1 / +1 while grinding a fin on that side, else 0
    dead: false,      // true once the nova has caught the runner
    deadT: 0,         // seconds since death

    // ---- prompts for the wordless tutorial (HUD draws key glyphs near the runner)
    prompt: '',       // '' | 'roll' | 'breach' | 'flip' | 'hold'
    promptDir: 0,     // -1 / +1 for 'hold' (which way), 0 otherwise
    device: 'keyboard', // 'keyboard' | 'touch' | 'gamepad'
    comfort: false,   // reduced-motion option: halve shake, blur and aberration
  };
}
