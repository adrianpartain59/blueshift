# PRISM BREAK  (pitch:arcade)

**Hook:** It's a runner where you aim AT the walls: you flip to their color at the last split second and smash straight through, and everything you smash trails behind you as a comet of loot that one mistake scatters into space unless you blow it all up in a Nova first.

**Fantasy:** You are a shardrunner, a thief on a mag-board tearing around the inner rim of the Prism, a ring-shaped orbital vault-city, with a stolen phase key that tunes your body to one of the vault's two hard-light security frequencies. Tuned right, you do not dodge the barriers: you go through them, and the light they were made of streams behind you as loot. None of it is yours until you burn it.

**Perspective:** Third-person chase camera in true 3D perspective, 6.5 units behind and 2.2 above the rider, pitched down 9 degrees. Base FOV 62 degrees, widening to 74 with speed and 88 in Nova. The rider sits in the lower third so about 70% of the frame is the future. Three lanes (3 units wide each) on a hard-light ribbon that runs around the INSIDE of an orbital ring, so the vertex shader bends the world upward with distance (y += k * z^2, about 18 units of lift at the 150-unit draw distance). The track ahead tilts toward the camera like a note highway, then keeps climbing into the sky as the far side of the ring. That one bend is both the space vista and the readability trick: upcoming rows are seen partly from above. The camera rolls 3 degrees into lane hops, and the vanishing point is deliberately the darkest part of the screen.

Everything is primitives through one batch: lane lines and rails are thin quads; a pane is 4 frame quads + a translucent fill + corner nodes + a floor decal; a Null is a black quad with animated white noise rects and a white outline; the rider is about 14 quads (a crouched black silhouette on a hex board with an emissive edge) plus an 8-segment verlet scarf; the haul is up to 200 shard triangles following the rider's lane history; towers are dark silhouette quads with window dots; the planet is a gradient disc with a rim arc; the sun is a disc cut by slats; stars are points that stretch into streaks. No depth buffer: rows are already sorted far to near and glows are additive.

**Core loop:** SECOND TO SECOND (every beat, 0.36 to 0.47 s): read the floor decals 4 to 7 beats ahead; pick the lane with glass in it instead of the empty one; flip to match, as late as you dare; the wall explodes on the beat, plays the next note of the lead, lengthens your tail and refills the fuse; do it again before the fuse burns out.

EVERY 10 TO 25 SECONDS: the tail is gold and Up is live. Cash now for a sure double, or push toward x24 and a Supernova while the game stacks Nulls on you for being greedy.

RUN TO RUN: you die or spill a haul, the results line prints LOST 96,000 in red, any key rewinds you onto the same fixed 8-bar opener in about a second, and you go again one read smarter and one notch greedier, chasing the next medal (50k / 300k / 1.5M / 5M).

## Controls
- **Left / Right arrows or A / D (touch: swipe left or right)** → STEER: hop one lane (3 lanes). The logical lane changes on the keydown frame; the board arrives 90 ms later. Up to 2 taps buffer.  
  _Feedback:_ SEE: the board snaps across with an 8% overshoot and rolls 22 degrees, the scarf whips, a light smear is painted across the lanes, the camera lags and rolls 3 degrees, and the gold tail swings wide a moment behind. HEAR: a stereo-panned filtered-noise 'fwip' tuned to the current chord, then a soft thud as the board settles. FEEL: committed on the same frame, which is what makes a last-instant dodge possible.
- **Space (also J or left mouse; touch: tap)** → FLIP polarity between CYAN and MAGENTA. Instant, unlimited, no cooldown.  
  _Feedback:_ SEE (same frame): rider, scarf, rails and horizon haze swap hue; a shock ring expands from the board for 250 ms; every barrier on screen irises between SOLID (threat) and HOLLOW (smashable) in 60 ms, so the whole road ahead visibly inverts; a 2-frame chromatic-aberration pulse. HEAR: a two-note synth stab, up a fifth going cyan and down a fifth going magenta, and the pad swaps timbre (glassy vs growling) so the music itself tells you your color. FEEL: a parry. If the flip lands in the clutch window the wall bursts on the same beat with a 'CLUTCH' stamp, a rimshot and a rising zing.
- **Up arrow or W (also Enter; touch: swipe up)** → CASH OUT. Always banks the haul trailing behind you. Below x8 it banks at face value. At x8 or more it detonates as a NOVA: haul banked double, then 6 to 16 beats of invincible overdrive in which everything you touch shatters, shield restored, multiplier back to x1.  
  _Feedback:_ NOVA: one 16th note of total silence and a 120 ms freeze, the tail implodes into the board, white flash, a shockwave ring warps the screen and rolls up the track turning every block gold, FOV kicks from 62 to 88, radial speed blur, then the music DROPS (full bass, lead, double-time drums) while the score rolls up on a rising blip glissando. BELOW x8: the shards streak up into the score with a coin trickle and a small ring pulse. NOTHING TO BANK: thruster flare, engine bark, and the fuse ring flashes to show progress toward x8.

## Mechanics
### Polarity Phase (flip and smash)
- Rules: You are always CYAN or MAGENTA. The track is a grid: one row per beat subdivision, 3 cells per row, each cell empty, a cyan pane, a magenta pane or a Null. When a row reaches the board: cell matches your polarity = you smash through it (+100 x multiplier into the haul, multiplier +1, fuse refilled); cell is the other color = hit; Null = hit whatever your color; empty = nothing happens. Full-width GATES (all 3 lanes one color, worth 300 x multiplier) cannot be dodged, only matched. Flip is instant with no cooldown; a lane hop takes 90 ms. Collision is a table lookup at the crossing, with 40 ms of late grace resolved in the player's favor. There is no jump.
- Why fun: It inverts the runner instinct: the obstacles are the points, so you steer AT things. The rule is learned from color alone, and every correct read is paid with a wall exploding in your face on the beat and a note of the lead melody that you played.
- Interplay: Creates the two-axis state (3 lanes x 2 colors) that every other mechanic prices. Nulls make lanes matter and gates make color matter, so neither 'sit in the middle and flip' nor 'never flip and steer' survives. Empty lanes are always the safe, silent, worthless choice; glass is where Clutch timing, the Haul and the Nova charge all come from.
### Clutch (stay wrong as long as you dare)
- Rules: If the state you were in 140 ms before a row arrived would have been a hit, and a flip or lane hop inside that window turned it into a smash or a dodge, it is a CLUTCH: the pane pays double and gives multiplier +2 (a clutch dodge with no smash still pays 200 x multiplier, +1, and refills the fuse). Inside 45 ms it is a RAZOR: quadruple, multiplier +3. Later than the 40 ms grace = hit. Rows land on the beat, so a clutch is simply a flip played on the beat as the wall arrives; a strike band painted on the track just ahead of the board shows the window, and the wall's floor decal sliding into it is the cue.
- Why fun: A continuous dare the player sets for themself on every wall: early is safe and worth 1, on the beat is worth 2, a hair later is worth 4, a hair after that costs everything. It turns a state toggle into a parry and turns greedy play into rhythm play, with the Burnout near-miss sting on every success.
- Interplay: Doubles or triples multiplier growth, so it is the fast road to Nova and Supernova. Seam flips inside Streams and Turnstiles are built-in clutch chances; a clutch dodge past a Null keeps the fuse alive through sparse stretches. Experts flip to the WRONG color on purpose and flip back late to manufacture one, betting the entire haul on a 140 ms window.
### The Haul and the Fuse (unbanked loot)
- Rules: Everything you earn goes into the HAUL, a comet tail of gold shards physically trailing the board; it is not score yet. The multiplier starts at x1 and climbs to x99. The FUSE (a ring on the floor under the board) lasts 8 beats in sector 2, 6 in sectors 3-4 and 4 from sector 5 (it does not burn during the opening sector); every smash or clutch refills it. A haul has three fates. COOLED: the fuse runs out, or you cash below x8: banked at face value, multiplier back to x1. SCATTERED: any hit: the whole tail bursts and drifts away behind you, worth nothing; multiplier x1, shield gone. DETONATED: Nova: banked double (triple as a Supernova at x24+). Heat response: for every x16 of multiplier you carry, the generator raises Null density one tier and turns one empty cell per bar into a gold bait pane worth 5x.
- Why fun: Loss aversion you can see. A chain of n smashes is worth 50n(n+1), so one 40-chain is worth nearly seven times as much as eight 5-chains, and all of it hangs behind you like Sonic's rings waiting to spill. Coasting is always legal; it just lets the fuse burn and the band drop out of the mix. A beginner who understands none of this still scores, because the fuse banks for them.
- Interplay: The fuse is what forces the hard pane instead of the empty lane; the tail is what makes a misread polarity hurt; the multiplier is what arms and sizes the Nova. Heat response means greed literally summons more hunters, which the Nova then turns into prey.
### Nova (cash-out overdrive)
- Rules: Armed at x8: the tail ignites gold and a riser starts. On press the haul banks x2, then for 6 beats (+1 beat per 4 multiplier levels above x8) you are invincible, color does not matter, the scroll stretches x1.6 and the drums go double-time. Everything you touch pays 100 x the frozen multiplier straight to the bank; Nulls become gold-outlined prey worth 300 x. The shockwave seeds every empty cell ahead with bonus glass, so steering still chooses your payout. At x24+ it is a SUPERNOVA: the haul banks x3 and the spree is a full 16 beats. Exit: a 4-beat audible countdown, 2 guaranteed empty beats, shield restored, multiplier back to x1.
- Why fun: One button that is at once the bank, the panic bomb, the shield refill and the biggest spectacle in the game, and pressing it always costs the multiplier you built. The Pac-Man inversion (the things you feared become the jackpot) needs no explanation, and the release after 20 seconds of held breath is the emotional peak of every cycle.
- Interplay: Cashing early is safe and small. Holding lets heat response stack Nulls onto the track, which is exactly the field where a Nova pays most. It is the only instant way to get a broken shield back, so a wounded player must chain 7 smashes while exposed to earn it. Clutches get you there in half the walls.

## First 30 seconds
- 0-2s: Any key on the title. The attract-mode camera whips onto your rider in 0.35 s, a filtered four-on-the-floor kick fades in, and the PRISM BREAK logo is standing across the track as a wall of cyan glass. You have control at 0.8 s. At 1.9 s, on the downbeat of bar 2, you smash through the logo: first shatter, first bell note, FOV punch, 'x2'.
- 2-6s: Two full-width cyan gates arrive on the next two downbeats (3.75 s and 5.6 s). They cannot be missed and cannot hurt: SMASH, SMASH, the notes climb, the rolling bass enters, and gold shards start trailing behind the board. With zero input the player has learned that glass in their color is good and that something is growing behind them.
- 6-10s: Slalom. Single cyan panes alternate lanes every 2 beats; the floor of each glass lane glows and arrow-key glyphs pulse on it. Nothing here can hurt. Every pane taken is a note, a burst and a longer tail; every pane skipped is silence. Steering is learned as 'go get it', not 'get away'.
- 10-14s: The first MAGENTA gate: full width, solid, X-braced, pulsing, its floor strip running at you with chevrons and a two-note warning. At 1.2 s from impact the world drops to 20% speed (the music tape-slows and muffles) and a spacebar glyph pulses beside the rider. Press: shock ring, the rider goes hot pink, the gate irises from solid to hollow, time snaps back on a reverse cymbal and you blow through it. 'CLUTCH' stamps the screen, double shards, multiplier +2. First run only, and it holds until pressed: nobody dies here.
- 14-17s: Five gates alternating cyan and magenta, one every 2 beats, at full speed. Flip, smash, flip, smash: the pad changes voice with every flip, hats and arp come in at x4, and at x8 the tail ignites gold, a riser starts and an up-arrow glyph pulses over the rider. The fuse is frozen for the whole opening sector, so even a player who never steered is armed by now.
- 17-21s: The camera lifts a little to show what is coming: six rows packed with black, static-crawling Nulls and solid glass, obviously too much. One lane is open for anyone who does not press. The riser peaks.
- 21-25s: NOVA. Up arrow: a 16th of dead silence and a 120 ms freeze, the tail implodes into the board, a white ring warps the screen and rolls up the track turning every Null gold, and the drop lands. FOV 62 to 88, star streaks, double-time drums; everything in your path explodes on contact and the score rolls from 0 past 20,000 on a rising glissando. About three seconds of ploughing through the things that looked impossible four seconds ago. (If the player never presses, they thread the open lane, the haul cools into the bank, and the prompt returns at the next x8.)
- 25-30s: Four-beat countdown on the hats, gold drains back to your color, the shield hex re-forms with a chime, multiplier x1, one bar of breakdown. The canyon walls fall away: planet limb below, slatted sun in the corner, the far side of the ring arching overhead. The first Sector Ring passes with a sub 'whoom', the tempo steps to 134, the fuse starts burning, and a Fork is already painted on the floor ahead: left, right, or the coward's lane.

## Signature moment
Sector 4, shield down, alarm motif in the mix, a white-hot tail at x31 (about 180,000 unbanked) and a Gauntlet of eight Nulls closing behind a solid magenta gate. The player stays cyan until the gate fills the screen, flips 40 ms out (RAZOR stamps the frame, the gate bursts into pink glass), and on the same beat hits Up: one 16th of dead silence, the entire tail implodes into the board, a white shock ring warps the screen and rolls up the curve of the track turning every Null gold, the drop lands, and the rider ploughs through all eight in a fountain of shards while the score rolls up by more than half a million and the city windows on the far arc of the ring flash in the player's color.

The screenshot is the frame after the silence: a black rider silhouette inside an expanding white ring, pink glass still in the air, gold Nulls ahead, the ring-city arching into the sky, 'x31' and '+540,000' on screen.

## Hazards and patterns
VOCABULARY (all cell-based: one row per beat subdivision, 3 cells per row).
- PANE: a one-lane sheet of hard-light glass, cyan or magenta. Match = smash, mismatch = hit.
- GATE: all 3 lanes one color, worth 3x. Cannot be dodged, only matched.
- STREAM: panes in one lane on every half-beat, with color seams.
- NULL: a black monolith crawling with white TV-static. Colorless, so no polarity phases it; dodge by lane; becomes prey during Nova.
- SHUFFLER (sector 5+): a Null that visibly hops one lane per beat; its floor decal always marks the lane it will be in on arrival, so to the grid it is an ordinary Null.
- GOLD PANE: a pane with a gold rim worth 5x, only ever placed as bait.
- SECTOR RING: a harmless set piece every 16 bars.
No pickups, no pits, no jumping: glass is the only thing worth touching.

PATTERNS (rows in arrival order as [left center right]; c/m = pane, CCC/MMM = gate, # = Null, g = gold pane, . = empty). Each is authored once, then mirrored and color-swapped into 4 variants.
1. WELCOME MAT (S1, 2 beats apart): [CCC] [CCC]. Free, unmissable smashes; teaches the verb with zero input.
2. SLALOM (S1, 1 per beat): [c . .] [. c .] [. . c] [. c .]. Nothing can hurt a cyan rider; four smashes for steering, none for sitting still.
3. FORK (S2, 1 per beat): [c . m] [c . m] [m . c] [m . c]. The center is the coward's lane: silent, fuse burning. Either side is 4 smashes with a seam flip in the middle, a built-in clutch chance.
4. ZIPPER (S2 per beat, S5 per half-beat): [c m c] [m c m] [c m c] [m c m]. No empty cell. Two valid answers: hold your lane and flip every beat, or hold your color and zigzag.
5. TURNSTILE (S3 per beat, S6 per half-beat): [CCC] [MMM] [CCC] [MMM]. Forced flips on the rhythm; four clutches in a row is +8 multiplier in four beats.
6. NEEDLE (S3): [MMM], then half a beat later [# g .] with g cyan. Decide before the gate: the right lane is the safe exit; the center means flipping back inside about 210 ms to take the 5x pane sitting beside a Null.
7. BLOODSTREAM (S3-S4, 8 beats): a center-lane Stream on half-beats, cccc mmmm cccc mmmm; the right lane is a wall of Nulls, the left lane is empty. Commit for 16 smashes and 3 seam clutches, bail left at any time, or ride the left lane for nothing.
8. GAUNTLET (S4, 1 per beat): [# # c] [# m #] [c # #] [# m #]. One open cell per row, alternating color: hop AND flip every beat with no safe alternative. Eight Nulls in four beats: the best Nova field in the game.
9. DOUBLE-CROSS (S4, half a beat apart): [c # m] [m # c]. The center Null blocks crossing; whichever side you chose, you flip inside half a beat.
10. SHUFFLE (S5, 6 beats): a Zipper with one Shuffler walking across it, so the legal cells change every beat.

ASSEMBLY: a sector is 16 bars drawn from its tier pool. Every candidate sequence is checked by the bot's solver for a legal path with human input spacing (at least 250 ms between required inputs in S1-S3, 170 ms later) and for at least one unbroken full-chain route, or it is rerolled.

## Readability
Seven rules the art is not allowed to break.

1. STATE-RELATIVE SHAPE, NOT JUST HUE. A threat is always SOLID (filled slab, X-brace, edge pulsing on the beat). Something you can smash right now is always HOLLOW (bright frame, faint fill, you can see through it). A Null is always COLORLESS (black with white static). On every flip all panes swap solid/hollow in 60 ms. The eye learns one rule: hollow = hit it, solid = don't, static = never. Hue is redundant: cyan panes also carry a horizontal scanline fill and round corner nodes, magenta carry a diagonal hatch and diamond nodes, and there is a blue/orange alternate palette.

2. THE FLOOR SPEAKS FIRST. Every object paints its lane with a 30-unit strip from 150 units out: dashed in its color when hollow, solid with chevrons pointing at you when a threat, white hazard hatch for Nulls. Lanes are read off the floor seconds before the object is big enough to read, and the upward ring curve tilts that floor toward the camera.

3. THE SACRED CORRIDOR. Nothing decorative ever enters the track volume (3 lanes wide, 4 units high). Scenery starts 1.5 units outside the rails or 6 units overhead. The vanishing point is kept the darkest region of the frame; the sun and planet live in the upper corners.

4. BRIGHTNESS BUDGET. Scenery is capped at 40% luminance in desaturated indigo and violet and is written below the bloom threshold; only gameplay objects write HDR values, so only danger and reward bloom. Saturated cyan, hot pink, gold and pure white are reserved for gameplay.

5. MOTION BUDGET. Scenery moves only with the scroll. Only gameplay objects pulse, and they pulse on the beat.

6. EFFECTS GET OUT OF THE WAY. Shards spawn at the impact plane and are flung outward and behind, clearing the lanes ahead within 250 ms; flashes last at most 2 frames; Nova blur is radial, so the center, which is the future, stays sharp; shake is mostly roll and FOV with under 6 px of translation, so lanes never smear. The tail streams back under the camera, never in front of the rider.

7. YOUR OWN STATE IS EVERYWHERE. Rider glow, scarf, rails, horizon haze and the pad's timbre all carry your current polarity, and in the last 300 ms before a lethal cell in your lane the lane floor strobes and a rising tone starts.

## Risk / reward
Survival pays nothing; only glass pays, and it only becomes score when banked.

EARNING into the haul: pane 100 x multiplier, gate 300 x, gold bait pane 500 x; a clutch doubles it, a razor quadruples it; multiplier +1 / +2 / +3 per smash / clutch / razor, up to x99. Value scales with the multiplier, so a clean chain of n is worth 50n(n+1): 1,500 at 5, 13,600 at 16, 82,000 at 40, 183,000 at 60.

THREE FATES OF A HAUL: SCATTERED x0 (any hit), COOLED x1 (fuse runs out, or cash below x8), DETONATED x2 (Nova at x8+) or x3 (Supernova at x24+), plus a spree paying 100 x the frozen multiplier per object and 300 x per Null.

GREED LOOPS, smallest to largest:
1. Every wall: flip early for 1x, on the beat for 2x, a hair later for 4x, later still for a hit.
2. Every row: the empty lane is always legal, silent and worth zero, and it lets the fuse burn.
3. Every bar: gold panes sit beside Nulls or half a beat behind an opposite-color gate.
4. Every 10 to 25 s: cash at x8 for a sure double, or carry toward x24 for the triple and a 16-beat Supernova, while heat response adds a Null tier for every x16 you carry. Those Nulls are 3x prey if you live to press the button.
5. When hurt: the only fast way to get the shield back is a Nova, which means chaining 7 smashes with no shield.

PUNISHMENT is always the same picture: your tail bursting and drifting away behind you. On death the results line prints it in red as LOST.

CHASE: medals at 50k / 300k / 1.5M / 5M so every skill level has a next number, a ghost line at your best distance, a daily seed and a local top 10. A first run banks roughly 30-80k; a cash-early player lands 300-500k; holding for Supernovas is the only road past 1.5M.

## Escalation
Endless, in sectors of 16 bars (23 to 30 s) separated by a Sector Ring. Each ring: +6 BPM and a semitone up in the music, +8 units/s of scroll, a palette shift and a new pattern tier.

S1 0:00 - 128 BPM, 44 u/s (about 7 beats of lookahead). The fixed opener: rows every 2 beats, cyan-heavy, fuse frozen, Nulls only in the scripted Nova field.
S2 0:30 - 134 BPM, 52 u/s. A row every beat, Nulls in 15% of rows, Fork and Zipper, every row keeps one empty cell, fuse 8 beats.
S3 0:59 - 140 BPM, 60 u/s. Gates and Turnstiles (forced flips), Needle, first half-beat Streams, Nulls 25%, fuse 6.
S4 1:26 - 146 BPM, 68 u/s. Gauntlet and Double-Cross, up to 4 consecutive rows with no empty cell.
S5 1:52 - 152 BPM, 76 u/s. Shufflers, half the rows on half-beats, fuse 4.
S6 2:18 - 158 BPM, 84 u/s. 16-beat compound phrases (two patterns interleaved).
S7 2:42 - 164 BPM, 92 u/s.
S8+ 3:05 - cap at 168 BPM and 100 u/s (4.2 beats, 1.5 s of lookahead); from here each sector removes one breather beat until a human cracks.

INSIDE EVERY SECTOR the same 16-bar arc: bars 1-4 present the sector's new pattern alone at low density, bars 5-12 mix it with everything earlier, bars 13-15 are a Null-heavy peak (a natural Nova field), bar 16 is two empty beats and the Ring.

SECOND DIAL: heat response adds a Null tier per x16 of multiplier carried, so the player's own greed raises the difficulty on top of the timeline, and a Nova resets it.

EXPECTED RUN LENGTH: first-timers die in S3-S4 (1:00 to 1:50), practiced players reach S7-S8 (about 3:00), and the cap exists to end almost everyone by 4 to 5 minutes.

## Visual direction
PALETTE: void #05030F grading to #120A2E; structure violet #2A1B6B with dim accents #5B4BD6; track bed #0A0818 with lane lines #8F7BFF; CYAN polarity #00F0FF (hot core #D9FDFF); MAGENTA polarity #FF2A8A (hot core #FFD6EA); GOLD for everything that is reward (haul, score, Nova) #FFC42E (hot core #FFF3C4); Nulls #000000 with #FFFFFF static and outline; damage red #FF3B30 used only for the hit vignette and the LOST number. Planet bands #3D1F4F and #6B2D5C with a dim blue rim #3550A0; sun gradient #FFB35C to #FF5C8A at half luminance.

LAYERS, back to front: starfield and nebula noise; planet limb with a faint city-light grid; slatted synthwave sun cresting the limb in an upper corner; the far side of the ring arching overhead with pin-prick windows (you can see where the track is going); mid-distance tower silhouettes with dim holo-billboards of procedural glyphs and streams of traffic dashes; near gantries, with an arch crossing the track on every bar line; the hard-light track with beat pulses rolling toward you; gameplay objects; particles; a minimal HUD (score top center, multiplier floating beside the rider, the fuse ring on the floor under the board, the haul shown as the tail itself, the shield as a faint hex outline).

LOOK: black silhouettes with thin emissive edges, glass that is mostly frame and glow, heavy bloom on gameplay only, light scanlines, a 4% color grade toward your current polarity.

SET PIECES: the logo is a glass gate you smash 1.9 s in; the sector-2 reveal where the canyon walls drop away to the planet; the sector-3 sunrise clearing the limb; the sector-4 core tunnel of rotating hex rings; freighters crossing overhead in sector 5; a 360-degree camera-only corkscrew over 4 bars in sector 6; the city windows on the far arc of the ring flashing your color during a Supernova.

## Audio direction
Driving dark synthwave, 128 BPM rising 6 BPM per sector to a 168 cap. A minor, the whole track transposed up a semitone at every Sector Ring. Progression Am - F - C - G, two bars each, so one sector is two passes of the loop.

INSTRUMENTS (all synthesized at runtime): kick = sine dropping 150 to 45 Hz in 120 ms plus a click, four on the floor; snare/clap = band-passed noise at 1.8 kHz with a 200 Hz body through a gated reverb; hats = high-passed noise 16ths with an open hat on the off-beat; rolling 16th-note bass = two detuned saws through a resonant low-pass with an envelope, ducked by the kick; arp = pulse-width plucks in 16ths through a dotted-eighth delay; pad = 3-voice supersaw chords whose timbre is your polarity (cyan: bright, glassy, high-passed; magenta: detuned, growling, low-passed); lead = mono saw + square with portamento, heard only at high intensity.

THE PLAYER'S INSTRUMENT: every smash plays an FM glass bell (sine carrier, 3.5 ratio modulator, fast decay) on the next step of an A-minor-pentatonic ladder from A3 to A6, so a chain is heard climbing; at x8 it gains a fifth above, at x24 an octave. Rows land on the grid, so the player's notes are always in time.

ADAPTIVE LAYERS by multiplier: x1 kick + sub drone + closed-filter pad; x2 rolling bass; x4 hats + arp; x8 (armed) open hats, pad filter opens, a looping riser; Nova = lead, octave bass, double-time drums and maximum sidechain pump; after a Nova a one-bar breakdown, then rebuild. Coast in the empty lane and the fuse-out strips the mix back to kick and drone: the safe path sounds as empty as it scores.

KEY SFX: flip stab (fifth up / fifth down); glass smash (2-8 kHz noise burst + sine tinks, gates add a 60 Hz thump); clutch rimshot + rising zing; razor ring-mod 'shing'; fuse ticks (16ths rising in pitch over its last 2 beats); armed shimmer; Nova = a 16th of silence, sub drop 80 to 30 Hz, supersaw chord stab, reverse cymbal; cash trickle (ascending blips, one per shard); shield break = bit-crushed crunch and the music slammed through a 300 Hz low-pass for a bar, then a two-note alarm motif until the shield returns; shield-up three-note rise; Null proximity crackle panned by lane; lane 'fwip'; Sector Ring sub 'whoom'; death tape-stop; restart reverse zip.

Inputs are never quantized; their sounds are tuned to the current chord instead.

## Failure and restart
Two-stage failure.

HIT WITH SHIELD UP (wrong color or a Null): 180 ms hit-stop, the shield hex shatters, the entire haul scatters behind you, multiplier x1, 1.2 s of flicker invulnerability, and an alarm motif joins the mix until the shield returns (instantly on a Nova, otherwise after 16 clean beats).

HIT WITH SHIELD DOWN: death. 250 ms freeze on the impact frame with the rider as a white silhouette, then the rider shatters at 20% time while the music tape-stops over 600 ms. The result is two numbers and a bar, readable at a glance: SCORE (banked, gold), LOST (the haul that died with you, red, shown only if non-zero), and progress to the next medal. A ghost line on the track marks your best distance.

RESTART: any key at any moment after the freeze. The shards rewind into the rider in 350 ms with a reverse zip, the kick comes back and control returns as the rewind ends: 0.6 s from death to steering if the key is already down, and never more than 0.4 s after a later keypress. Restarts skip the title and the first-run slow-motion prompt, and always begin with the same hand-authored 8-bar opener, so a returning player can be greedy from second one. From bar 9 the sequence comes from the seed (a daily seed by default, so friends chase the same track).

## Bot strategy
The level is a grid: row r arrives at beat b(r) with 3 cells from {empty, cyan, magenta, Null, gold-cyan, gold-magenta}. The player is one of 6 states (lane 0-2 x polarity). Between consecutive rows a transition is legal if lane distance x 90 ms fits in the gap; flips are free.

The bot runs a Viterbi pass over the next 12 rows each time a row is generated, with a lexicographic utility: (1) never occupy a lethal cell, (2) never let the fuse expire if a legal path avoids it, (3) maximize haul (gold > gate > pane > empty, clutch-eligible commits counted), (4) fewest inputs. Ties resolve to the lower lane index, so output is a pure function of seed + parameters.

Inputs are emitted in beat time: lane hops at arrival - 240 ms, flips at arrival - nerve, where nerve is 300 ms (safe regression bot), 100 ms (attract mode: constant CLUTCH stamps) or 30 ms (razor showcase).

Cash-out policy: Nova when armed and any of: 4 or more Nulls in the next 8 beats, multiplier at or above target (x16 attract, x32 score test), or shield down.

Because the simulation clock is the beat clock at a fixed 120 Hz step with a seeded PRNG, headless runs are bit-reproducible. The same solver is the generator's validator, and three personas give balance telemetry in CI: COWARD (empty lane whenever legal, cash at x8), GREEDY (max haul), CHAOS (seeded random legal inputs). A standing assertion: COWARD scores under 10% of GREEDY on every seed, which is 'the safe path is boring' as a unit test.

## Tech notes
RENDERING: one dynamic interleaved vertex buffer (position 3f, color 4f, uv 2f, misc 2f). The CPU writes world-space quads and triangles; the vertex shader applies view-projection plus the ring bend. Premultiplied-alpha blending (ONE, ONE_MINUS_SRC_ALPHA) lets opaque, translucent and additive geometry share one draw call (additive = alpha 0), so a frame is roughly 3 draws before post: a sky quad (stars, nebula, planet and sun in a fragment shader), the world batch, the HUD batch. No depth buffer: rows are generated in z order and drawn far to near. The scene goes to an RGBA16F target (EXT_color_buffer_float, with an RGBA8 + threshold fallback). Scenery writes values under 0.6 and gameplay writes 1.5 to 4.0, so a bright-pass at 1.0 blooms only gameplay with no layer split. Bloom is a 5-level dual-filter down/up chain from half resolution. One composite shader does chromatic aberration (radial, uniform strength), up to 4 shockwave displacement rings, glitch slices, the polarity grade, scanlines, vignette and grain; the Nova radial blur (8 taps) runs at half resolution only while active. Text is a hand-coded stroke font rasterized into an atlas at boot.

CLOCK: one beat clock drives everything. Audio is scheduled from it with a 25 ms tick and 100 ms lookahead; row depth is z = (rowBeat - songBeat) * unitsPerBeat, so arrivals are on the beat by construction, and tempo steps, the tutorial slow motion and the death tape-stop are just tempo curves. Hit-stop freezes rendering only and catches up; it never touches the clock. Visuals are offset by AudioContext.outputLatency.

SIM AND COLLISION: fixed 120 Hz step, seeded PRNG (mulberry32), no allocation in the loop (typed-array pools for 4,000 particles and 64 rows). Collision is a table lookup when a row crosses the board: cell vs (lane, polarity). Inputs carry event timestamps converted to beat time, a 150 ms state-history ring buffer answers 'were you dead 140 ms ago', and lethal results are evaluated 40 ms after the crossing so a late save still counts. Replays and bot runs are input logs in beat time.

AUDIO: about 24 pooled voices (oscillator + gain + biquad), a runtime-generated noise buffer, a generated-impulse convolver for the gated reverb, a feedback delay for the arp, sidechain as gain automation on the music bus, a master compressor, and a low-pass 'muffle' bus for hits and slow motion.

CHEAP: lines, panes, floor decals, shards, the tail, low-resolution bloom, every synth voice.
EXPENSIVE, and how it is contained: additive overdraw when a gate shatters at the near plane (cap on-screen shard size at 6% of the frame, cull behind the camera immediately); full-screen multi-tap blur (Nova only, half resolution); float render targets on weak GPUs (RGBA8 fallback); oscillator count on mobile Safari (voice stealing); GC hitches (pools).

SCOPE VALVE, in cut order if needed: Shuffler, the corkscrew set piece, the Supernova tier, heat response. Never cut: solid/hollow coding, floor decals, the clutch grace, the visible tail.

## Biggest risk
Polarity confusion at speed: the toggle problem. Under pressure a player loses track of their own color, panic-taps, and flips OUT of the right state. If a death feels like the game cheated, nobody gambles, and the whole greed loop dies with it. A related second failure: the haul / fuse / Nova layer stays abstract and the game gets played as plain color matching.

MITIGATIONS, in order of importance:
1. Threat is coded by shape relative to your current state (solid vs hollow), so a wrong flip shows instantly as the wall ahead turning solid, with time to fix it unless you chose to be late.
2. Your color is everywhere: rider, scarf, rails, haze, and the timbre of the pad.
3. Rows land on the beat, a strike band shows the clutch window, and ties resolve in the player's favor (40 ms late grace, input timestamps rather than frame times).
4. The first mistake is never fatal (shield), and the first 20 seconds cannot be failed.
5. The scoring layer is physical, not numeric: loot is a tail you can see, loss is watching it drift away, armed is gold plus a riser, cashing is a detonation, and the fuse auto-banks so a player who understands none of it still scores.
6. One verb is taught at a time by a fixed opener.

FALLBACK KNOBS if playtests still show confusion: widen the grace to 60 ms, keep sectors 1-2 cyan-dominant, slow the S2-S3 ramp, and offer a hold-for-magenta control mode (key down = magenta, key up = cyan) so color becomes a body state instead of a memory.

## Why this wins
Because the risk-reward lens is the whole game, not a scoring layer bolted onto a dodge-runner.

1. One verb with a wall-shattering payoff that is learned from color alone, and it inverts the genre: the obstacles are the points, so the player steers at danger from second two.
2. The safe path exists on every row and is designed to be empty in every sense: no glass, no notes, the band drops out. Survival pays zero; only glass pays.
3. Greed is physical. The loot is a comet you tow, the loss is watching it scatter, and its three fates (scattered x0, cooled x1, detonated x2 or x3) are understood without a word.
4. One button asks 'now, or one more?' every second of the run, and it is simultaneously the bank, the panic bomb, the shield refill and the best spectacle in the game, with a Pac-Man inversion as the payoff.
5. The skill ceiling is three independent dials: routing (the lane x color path), timing (early / clutch / razor) and nerve (when to cash), so the same 8-bar opener is still interesting on run 200.
6. It is built for exactly this engine: glass panes, lines, shards and bloom are the primitives; a 3-wide grid on a beat clock makes collision a table lookup, makes the bot and the generator's validator the same small solver, and gets music sync, slow motion and replays for free.
7. The restart loop is a slot-machine pull: a red LOST number, a fixed opener, and under a second back to speed.

## Juice
- Smash: 35 ms visual-only hit-stop (70 ms for gates; the beat clock never pauses, rendering catches up), 40-90 additive glass triangles inheriting your velocity and flung outward away from the lanes ahead, a white core flash, FOV punch of +3 degrees decaying over 150 ms, a ripple down the lane floor, and '+800' popping into the tail.
- Smash audio: a band-passed noise burst (2-8 kHz) plus an FM glass bell on the next step of an A-minor-pentatonic ladder, so a long chain is heard climbing; gates add a 60 Hz thump.
- Flip: the whole road inverts in 60 ms (solid to hollow and back), a shock ring leaves the board, 2 frames of chromatic aberration, the scarf whips, and the world tint and pad timbre swap with it.
- Clutch: a 'CLUTCH' stamp with a letter-spacing snap, a 1-frame color inversion, a radial streak, doubled shards tinted white-gold, rimshot plus rising zing. RAZOR adds a metallic ring-mod 'shing' and holds the stamp for 6 frames.
- Lane hop: 90 ms ease-out-back with 8% overshoot, 22 degree board roll, camera lag and 3 degree roll, a light smear across the lanes, a panned 'fwip'.
- The tail: every smash visibly adds shards; it swings wide on lane hops with spring delay; at x8 it ignites gold, at x24 it goes white-hot with lens streaks. On cash-out each shard flies to the score and fires its own ascending blip.
- The fuse: a ring on the floor under the board; in its last 2 beats it ticks in 16ths with rising pitch and the tail flickers; a refill is a whoosh-up.
- Adaptive mix as feedback: x2 brings the rolling bass, x4 hats and arp, x8 open hats and a riser, Nova the lead and double-time drums. Coast in the empty lane and the band audibly drops out.
- Nova: one 16th of silence plus a 120 ms freeze, the tail implodes, white flash, a shockwave displacement ring across the screen and up the track, FOV 62 to 88 in 200 ms, radial blur that keeps the vanishing point sharp, star streaks, and Nulls flipping to gold prey as the wave passes them.
- Shield break: 180 ms hit-stop, trauma shake, horizontal glitch slices with RGB split and 0.4 s of desaturation, the tail scattering into drifting shards you watch recede, and the music slammed through a 300 Hz low-pass and bit-crush for one bar.
- Danger shimmer: in the last 300 ms before a lethal cell in your lane the lane floor strobes and a rising tone starts, the tell that makes a late save feel earned instead of lucky.
- Beat-reactive world: lane lines pulse on the kick, an arch crosses overhead with a Doppler whoosh on every bar line, panes breathe 4% on the beat (which also helps judge arrival).
- Speed: FOV, star-streak length, camera micro-shake and scarf flutter all scale with scroll speed; Sector Rings land with a sub 'whoom' and a scanline wipe.
- Death and retry: freeze on a white rider silhouette, slow shatter, tape-stop; on restart the shards rewind into the rider with a reverse zip and the kick comes straight back.
