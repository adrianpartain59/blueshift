# BLUESHIFT — game design

Chosen from seven pitches (see `docs/pitches/`; this one came from the "into-the-screen spectacle"
lens, full text in `docs/pitches/spectacle-blueshift.md`). This document is the canonical spec; where
it differs from the pitch, this wins.

## One line

You outrun a supernova down the hollow middle of a neon space city that wraps all the way around
you: spin the whole tunnel, flip gravity through its core, and punch through firewalls on the beat.
Every wall you break makes the world bluer and faster.

## Fantasy

You are the last courier out of the Spindle, a cylinder megacity whose star has just gone nova. You
sprint on mag-blades down the city's hollow axis: eight rails of conduit lined with still-armed
security firewalls, toward a jump gate glowing at the vanishing point. The shockfront is seconds
behind you and gaining. Speed is the only health bar you have.

## Why this one (the judgment call)

- The main actions are fun to do 500 times: every roll spins a city and plays a note, every breach
  is a drum hit with glass flying past the lens.
- It is beat-locked, so it feels musical in the hands without hand-tuned physics. Every hazard
  arrives on a 16th-note grid; every required press is on a beat.
- The "whoa" is guaranteed and needs no skill: at 9.4 s the tunnel shutter shatters and you are
  flying down the axis of a city as the star ignites behind you and the bass lands.
- The whole game is a table (9 cells x 16th notes), so a bot can play it, prove fairness and run
  the attract mode, and collision is exact and free.
- Three verbs that only exist because of depth: AROUND the tube, ACROSS its core, THROUGH its walls.

## Controls (3 action inputs)

| Input | Action |
|---|---|
| Left / Right, A / D | **ROLL** one lane around the tube. The whole world snaps 45 degrees; you stay bottom-centre. Hold to repeat. |
| Up, W | **FLIP** (the gravity jump): leap through the core and land on the opposite lane. One Left/Right tap in mid-air shifts the landing by one lane. |
| Space, J, X | **BREACH**: a 180 ms ram that shatters yellow ICE on contact. |
| P pause, M mute, F fullscreen, C comfort | not gameplay |
| Q / Esc | **BACK**, one level per press: in a run the first press pauses and the second, from the pause screen, leaves for the main menu (two presses, so a stray Q beside W and A never throws a run away; a second press within 250 ms is treated as key bounce). During the death and on the results it goes straight to the main menu. On the main menu it does nothing and never starts a run. An abandoned run still counts toward the best score and distance. |

Touch: four instant zones, no gestures: left third and right third roll, centre top half flips,
centre bottom half breaches. The top-left corner pauses; the pause screen carries the comfort switch
(bottom left) and MAIN MENU (bottom right), and the results screen carries MAIN MENU as well.
A run starts when the finger LIFTS (browsers only let audio start at the end of a touch).
Gamepad: d-pad, shoulder buttons or left stick roll, A / X breach, Y, d-pad up or stick up flip, Start
pauses, B is BACK (main menu from the pause screen or after a run; nothing in a run or on the menu),
Back toggles comfort, any other button starts a run.

Comfort mode removes every full-screen flash and halves shake, blur and aberration. It is remembered,
and starts on when the system asks for reduced motion.

A direction can be held from several sources at once (A and Left, two fingers, d-pad and stick): it
is released when the last one lets go. A direction key that starts a retry is already held in it.

## Space and time

- The tube is an octagon: 8 lanes (cells 0..7) plus the core (cell 8). Apothem 5 m, lane width
  4.14 m. The world rolls so the runner's lane is always "down".
- Hazards live on a 16th-note grid (4 ticks per beat). A hazard is `(tick, material, 9-bit cell
  mask, length, kind)`. Collision is a table lookup at the hazard's tick: no geometry.
- Hazards are **time-locked**: a hazard reaches you at its tick whatever your speed. On screen its
  distance is `(time until arrival) x current speed`. A higher gear never changes the rhythm, it
  only shortens the warning. Hazards materialise 150 m out (3.1 s in gear 1, 1.5 s in gear 5).
- Tempo map (`src/game/timeline.js`): sector 0 CONDUIT beats 0-20 at 128 BPM; sector 1 THE SPINDLE
  beats 20-68 at 128; then 64-beat sectors at 132, 136, 140, 144, then 148 forever.

## The three verbs

**AROUND (roll).** The logical lane changes on the input frame (the 90 ms world snap is cosmetic).
At most one lane per 85 ms, 110 ms input buffer, hold auto-repeats after 160 ms. A roll into a lane
occupied by a FIN is refused and becomes a GRIND (sparks, +5 flux per beat while held); the held
roll fires the instant the lane frees. GRAZE: a solid passing in an adjacent lane pays +5 flux per
side; both sides at once is a THREAD, +12.

**ACROSS (flip).** Airtime 0.75 beat. From 0.08 to 0.67 beat you occupy the core cell: immune to
everything on the lanes, but solids in the core (SPOKES, CORE MINES) crash you and ICE in the core
must be breached in mid-air. You land on lane+4 (or +3/+5 after one mid-air tap). Landing on a
solid crashes. An IRIS blocks all 8 lanes with the core open; it always sits on the off-beat with a
cyan launch pad on the beat before, so the right press is ON the beat (window -80..+197 ms at 128
BPM). Passing an iris pays +10 flux, +16 if the flip started within 50 ms of the pad beat (CLEAN).
Orbs in the core are collected automatically, +4 each.

**THROUGH (breach).** ICE WALLS cover all 9 cells and arrive only on beats. Space opens a 180 ms
ram; the wall breaks if it arrives during the ram or if you press up to 80 ms after it arrives
(so a pure-reaction press on the white "NOW" flash still lands).
PERFECT = press within 50 ms of the beat: +30 flux, +4 more per consecutive PERFECT (cap +20).
GOOD = +18. A hit cancels recovery so stacked walls can be drummed. A whiff costs 200 ms of
recovery, -3 flux and the chain. One stray press is forgiven its recovery when a wall arrives (the
press on the beat is never swallowed); whiffs within 0.7 s of each other are not, so mashing is no
way through. Ramming a solid does nothing. Every ICE wall carries three rings
that collapse on the three beats before impact.

## Hazard vocabulary

| Kind | Material | Cells | Answer |
|---|---|---|---|
| BLOCK | solid | 1-3 lanes, one tick | roll around it |
| FIN | solid | one lane, 2-16 beats long | corridor edge; grind it |
| IRIS | solid | all 8 lanes, core open; off-beat; launch pad the beat before | flip |
| SPOKE | solid | two opposite lanes + core | do not flip; do not stand under it |
| CORE MINE | solid | core only | do not flip |
| ICE WALL | ice | all 9 cells, on the beat | breach |
| ICE PYLON | ice | one lane | optional: dodge for nothing or breach for a full payout |
| PLATED ICE | ice wall + solid plates on some lanes | | roll to a bare lane, then breach |
| IRIS LOCK | iris + ice in the core | | flip on the beat, breach in mid-air |
| SECTOR GATE | double-thick ice wall on the first downbeat of the next sector | | breach: +1 gear, +30 m lead |

Pickups: SPARKS (lane pips tracing the high-value line, +1 flux), ORBS (core only, +4 flux).

## Speed is life: flux, gears, the nova

- FLUX fills a ring. 60 / 80 / 100 / 120 flux shifts gear 1>2>3>4>5. Gear speeds 48 / 60 / 72 / 86
  / 100 m/s; score multiplier x1..x5. At gear 5, overflow flux becomes lead (0.5 m per point).
- LEAD is your distance to the shockfront: starts at 220 m when the nova ignites at THE DROP, caps
  at 300 m, and changes by `(gear speed - nova speed)` every second. Nova speed by sector: 36, 50,
  64, 78, 90, 98, then +4 per sector. So gear 1 is safe in the Spindle and losing ground from sector
  2, and each later sector demands one more gear.
- A CRASH never kills: it costs 2 gears (minimum gear 1), all flux, 40 m of lead, and gives 1.2 s
  of ghost invulnerability. The only death is LEAD reaching 0: the nova catches you.
- Inside the scripted opening (the conduit and THE SPINDLE) lead cannot fall below 70 m: the nova
  looms but cannot catch a first-timer before sector 2.
- Each gear is also one more layer of music, a bluer palette, a wider field of view.

## Score

`metres travelled x gear + event points x gear`. PERFECT breach 500, GOOD 200, CLEAN flip 300, iris
pass 150, THREAD 250, graze 50, orb 40, sector gate 1000. Best distance, best score and best
sector persist locally.

## The first 32 seconds (hand-authored, identical every run)

Beats at 128 BPM; one beat = 0.469 s.

| Beat | Time | What happens |
|---|---|---|
| 0-4 | 0.0-1.9 | **IGNITION.** Any key on the title: the logo shatters into hex shards, camera drops behind the courier clamped in a dark launch barrel. Ribs ignite on beats 1, 2, 3 with rising pips and a riser. Rolling is live at once. On beat 4 the courier fires and auto-rams the bay shutter: freeze frame, yellow shards, kick and filtered bass come in. The player has now seen what yellow is for. |
| 8, 10 | 3.8, 4.7 | **AROUND.** Two magenta slabs aimed at whatever lane the player is in: each follows the runner's lane until it locks on 1.5 beats out, then the arrow glyphs pulse. A hit here is only a stumble: nothing in the conduit costs anything. |
| 12 | 5.6 | **THROUGH.** A yellow wall counts itself in (three rings on three beats), space-bar glyph over the runner, window widened to +/-200 ms. Lance, freeze, 120 shards, shockwave: the hit is the snare. |
| 13 | 6.1 | Two slabs flank the player's lane: a free THREAD. |
| 16 | 7.5 | One last aimed slab, then three beats of empty conduit while the end shutter fills the screen, counting 3-2-1. Snare roll, riser. Gold light creeps up the ribs from behind. |
| 20 | 9.4 | **THE DROP.** Breach the shutter (it breaks itself on the beat if you do not, and a press up to 200 ms late is still graded as yours). The tunnel is gone: you are flying down the axis of a cylinder megacity, towers pointing at you from every direction. The nova ignites behind the lens, the bassline drops, GEAR 2 stamps the screen, the LEAD arc slides in. |
| 21-32 | 9.8-15.0 | **CORKSCREW.** Two fins form a channel around the runner (it follows the runner's lane until the fins arrive on beat 21, then one straight beat to settle in), then it turns one lane per beat for ten beats. Hold Right: the courier grinds the leading fin in a fountain of sparks while the city drills 450 degrees around you. ICE wall on beat 32. |
| 33-36 | 15.5-16.9 | A thread gate two lanes over (it follows the runner until half a beat after the corkscrew ends, so it is two lanes over for everyone), read from the sparks leading to the gap. |
| 38-48 | 17.8-22.5 | **ACROSS.** Iris with a cyan-rimmed hole and an orb, launch pad on beat 38, up-arrow glyph. Flip: the city turns upside down. A second iris one bar later flips you back, then a four-beat slalom. |
| 48-64 | 22.5-30.0 | **FIRST PHRASE.** The three verbs chained, one input per beat: ICE with a slab hiding one beat behind it, iris into ICE, a thread gate, a slalom. |
| 64-68 | 30.0-31.9 | **THE FILL.** The drums cut out and four ICE walls arrive on four beats: the player is the snare fill, straight into the SECTOR 02 gate on the downbeat: break it and it pays +1 gear whatever your flux, as the tempo lifts to 132. |

Retries skip the conduit: any key from 0.7 s after death starts a 2-beat quick launch (beat 18) that auto-rams
the shutter on the downbeat, so every restart opens on the game's best moment at gear 2.

## After the opening

Sectors are assembled from hand-designed patterns (slalom, corkscrew, thread gate, iris ladder,
blind breach, plated ice, propeller, orb bait, iris lock, drum fill), mirrored and rotated around
the runner's lane, 8-13 per sector with 1-2 beats of air, never two new ideas at once, always ending
in the drum fill and the sector gate. Pattern tiers unlock by sector. A solver bot validates that
every generated sector is clearable.

| Sector | BPM | Nova m/s | Needs gear | New ideas |
|---|---|---|---|---|
| 1 THE SPINDLE | 128 | 36 | 1 | scripted opening |
| 2 NEON MILE | 132 | 50 | 2 | iris ladders, blind breaches, thread gates |
| 3 FOUNDRY | 136 | 64 | 3 | propellers, plated ice, core mines, 8th-note blocks |
| 4 SHATTER | 140 | 78 | 4 | iris locks, switchback landings, reversing corkscrews |
| 5 CORONA | 144 | 90 | 5 | three-verb phrases every bar, 8th-note fills |
| 6+ FLARE | 148 | 98, +4 each | 5 and bleeding | everything, maximum density |

Targets: a first-timer who crashes every 6 s survives about a minute (dies in sector 2-3); a
competent player reaches sector 4-5 (2-2.5 min); experts pass 4 minutes.

## Readability rules (non-negotiable)

1. **Reserved space.** Nothing decorative enters the play tube (r < 5 m). All decoration lives at
   r >= 9 m.
2. **Fill rule.** Solids are the only dark-filled shapes: near-black polygons with a thick
   saturated rim, so they read as holes punched in the glow. Decoration is hairlines only, capped
   at 35% luminance (k <= 0.35). ICE is the only full-disc lattice.
3. **Reserved colors.** Magenta `#ff2a6d` = solid, never touch. Yellow `#ffe600` = ICE, hit Space.
   Cyan `#00f0ff` and white = you, pickups, launch pads, safe guidance. Orange-gold = the nova, and
   only at the screen edges. Decoration uses only the violet-to-ice-blue gear ramp. Shapes back up
   colors: solids are chevron-striped slabs, ICE is a hex lattice with countdown rings, an iris has
   a cyan-rimmed hole.
4. **Lane telegraphs.** Every solid projects a magenta stripe one beat long down its lane toward
   you; your own lane's cyan guide line turns magenta between you and the next solid in it.
5. **Strike ring and beat lock.** A brighter rib marks the runner's depth. ICE counts itself in
   3-2-1. Irises have launch pads.
6. **FX budget.** Only rims bloom. Aberration, distortion and blur are near zero at screen centre
   (where the future is) and grow toward the edges. Hit effects decay within 250 ms. Hazards more
   than two lanes from the runner draw at 55%.

HUD is three things: the LEAD arc under the runner, the gear numeral with its flux ring at top
centre, the score at top right.

## Game feel (event -> response)

- **Roll:** 45-degree world snap in 90 ms with spring overshoot, runner banks 30 degrees, ribbons
  whip, rail sparks, a pitched pluck per lane (8 lanes = one octave of F minor), small aberration tick.
- **Breach hit:** 60 ms (GOOD) or 90 ms (PERFECT) visual hit-stop that then catches up (the song
  clock never pauses); FOV punch +14 degrees; ~120 hex shards raking past the camera; shockwave
  ring; one-frame white flash; chromatic split decaying over 300 ms; shake for 200 ms; a pulse of
  light racing down the ribs to the vanishing point; kick + glass burst + chord stab exactly on
  the beat; PERFECT / GOOD stamped into the flying shards.
- **Whiff:** the lance and the thoom still fire. Even a miss feels like something.
- **Flip:** 180-degree world roll, runner corkscrews up through the core leaving a helix trail,
  radial blur, sub whoomp; landing squash 0.7 > 1.1 > 1.0 in 160 ms, spark ring, camera dip, thud.
- **Graze / thread / grind:** side fan of sparks, Doppler zzip panned to that side, runner rim
  flashes white; a grind is a continuous spark fountain with a rising whine.
- **Fly-bys:** every dodged hazard whooshes past the camera, panned by lane.
- **Gear up:** speed springs up over 0.35 s so the tunnel ahead telescopes away and rushes back;
  palette steps bluer; FOV +6; ribbons lengthen; snare roll, riser, rising arpeggio; GEAR stamp.
- **Crash:** 110 ms hit-stop, camera thrown back on a spring, scanline-tear glitch 300 ms, 40%
  desaturation for 0.5 s, runner flickers as a ghost for 1.2 s, music low-passed with a tape-stop
  detune, nova glow lunges inward.
- **Nova proximity (continuous):** edge glow, heat haze at the borders, embers overtaking you,
  Geiger-tick hats and a two-tone klaxon on the beat once lead drops under 80 m.
- **Beat sync:** ribs brighten on every kick, city windows twinkle on 16ths, the tunnel bend sways
  on a 4-bar LFO. The whole world is a metronome.
- **Death:** 0.4 s visual slow-down while white-gold wipes in from the edges, the runner dissolves
  forward into particles, a single sub boom, the distance stamped huge. Input accepted after 0.7 s (the distance stamp is
  readable by then, and the last panicked press of the run does not skip the death).

## Audio

128 BPM rising 4 per sector to 148; F minor; 4-bar loop Fm - Db - Ab - Eb. Layers follow gear:
gear 1 kick + closed hats + 8th-note sub pulse; gear 2 adds offbeat open hat, clap and rolling 16th
bass; gear 3 adds the arp; gear 4 adds the sidechained pad and a counter-melody; gear 5 adds
supersaw stabs, octave-up arp, ride, fully open filter. The player is in the band: roll plucks walk
the scale, ICE phrases mute the snare so breaches supply it, and the last bar of every sector drops
the drums so four breaches are the fill.

## Non-goals

No menus beyond title and results. No upgrades, currencies, characters or unlocks. No online
anything. No text the player must read to play.
