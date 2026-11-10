# NEEDLE DROP  (pitch:rhythm)

**Hook:** You're the needle on a planet-sized record, and the bass only drops when YOU slam the space bar: hold the build as long as you dare, because the longer you wait, the harder it hits.

**Fantasy:** You are the Needle, a pirate-signal ship dropped onto the Ring: a blacked-out orbital megacity whose power rail is one colossal record groove circling an eclipsed star. As you ride the groove at 100 km/h and rising, the song locked inside it plays through you: every lane strike is a note of the lead, every slam is the kick, and every bass drop you land plunges you into the city and switches a whole sector back on. The city's security tries to jam your signal with red; you turn its jamming into percussion, and when the bass drops you eat it.

**Perspective:** Third-person chase camera with true perspective, looking down a three-lane ribbon of track toward a vanishing point: the note-highway view every rhythm player already reads, but with real speed and a ship that physically occupies a lane. The camera sits 7 m behind and 2.4 m above the ship, pitched 9 degrees down; the ship and the hit line sit 22% up from the bottom of the screen. Base FOV 72 degrees (narrows to 60 during a build, kicks to 100 and settles at 90 in a drop). Lanes are 3.2 m wide (track 9.6 m). One beat of music is always exactly 14 m of track (21 m in a drop) and 8 beats are visible, fading in through fog between beats 8 and 6, so distance on screen IS time in the song.

A curved-world vertex shader (x += yawK * z^2, y += pitchK * z^2) bends the logically straight track into sweeping curves, a climbing ramp during builds and a rollercoaster plunge on the drop, without touching lane logic. Three altitudes are the three song sections: VERSE = clean high orbit above the city, BUILD = the track climbs into empty black sky toward the eclipse, DROP = the track dives into a canyon between the towers.

Everything is primitives. Track: 3 dark quad strips, 4 additive lane lines, one cross-rung per beat (brighter on bar lines), a hoop of 24 line segments around the track every 4 bars. Notes and hazards: extruded prisms of 3 to 5 quads with additive outlines and one glow sprite each. Ship: a 9-triangle stylus/dart silhouette, engine glow sprite, 24-segment ribbon trail. City: two bands of instanced tower quads whose lit-window height is driven by the sequencer's instrument envelopes, so the skyline is the equalizer. Eclipse: a shader disc (black centre, noisy corona, outrun slice gaps) that follows the vanishing point. Stars: point quads that stretch into streaks with speed. Gate numerals and key glyphs: stroke-font quads lying on the track plane in perspective.

**Core loop:** Second to second: read the floor 2 to 4 beats ahead, then on each beat do one of three things in time: strike a lane (plays a lead note), slam (plays the kick), or leave a red lane at the last instant (plays a hat). Every on-beat action adds a sound, a burst of light and a slice of TENSION. Phrases are 1 or 2 bars long and resolve on a wall, so the hands settle into thumb-and-finger grooves. Two inputs, four keys, no jump.

Minute to minute, the song structure is the level structure: VERSE (charge TENSION, roughly 8 to 14 bars) -> BUILD (kick and bass vanish, density rises every bar, and a drop gate at the end of every bar asks 'now, or one more?') -> DROP (8 bars: invincible, everything red turns gold, score x the gate multiplier, mix fully healed) -> 2-bar run-out groove -> next Track, 8 BPM faster, new key, new sector of the city.

Run to run: a first run lasts 1 to 4 minutes and ends on one identifiable beat-level mistake; the backspin restart takes under a second; the things to chase are a deeper gate (BEST DROP xN), a later Track and the score. Seeded pattern assembly means the verse is never the same twice, while the first drop of every run is always inside the first 20 seconds.

## Controls
- **LEFT / DOWN / RIGHT arrows (also A S D or J K L; UP also means centre). Touch: left, middle and right thirds of the screen.** → PAD STRIKE. Absolute mapping: the three keys are the three lanes. The ship teleports to that lane and strikes there; pressing the lane you are already in strikes in place. This one gesture hits a node on the beat, mounts a rail, or dodges a block.  
  _Feedback:_ Sees: the ship snaps across in 50 ms with an 8% overshoot, banks 25 degrees and leaves a 3-ghost cyan-to-magenta ribbon for 120 ms; the lane pad on the hit line flashes. On a hit the node bursts into 14 shards that streak past the camera, a ring of light runs up the lane and the two lane lines twang like a plucked string (0.25 m, 300 ms); PERFECT flashes white-hot, GOOD stays cyan. Hears: a synth pluck at that lane's pitch (left = chord root, centre = fifth, right = tenth), panned 35% toward the lane, with a dotted-eighth delay; brighter filter plus an octave shimmer on PERFECT; a muted tick if nothing was there; a hat 'tss' and doppler whip on a last-instant dodge. Feels: the camera springs 0.6 m sideways and rolls 2 degrees, FOV punches +2 degrees on PERFECT, and the skyline on that side of the track jumps.
- **SPACE (touch: a full-width bar across the bottom quarter of the screen)** → SLAM. A shockwave across all three lanes that shatters a WALL if pressed as the wall reaches the hit line. Walls cannot be dodged, so this is the one verb that demands timing.  
  _Feedback:_ Sees: a ring expands from the ship across the track (0 to 12 m in 150 ms), the wall splits along its chevron seam into two halves and 40 shards, the whole track bows 0.5 m like a drumhead and the dent races to the horizon, a screen-space ripple and a 6 px chromatic spike decay over 200 ms. Hears: the big layered kick (sine dive 150 to 45 Hz in 120 ms, click, noise) with a sub drop, a crash on bar lines, and the entire mix ducks 9 dB and pumps back in 200 ms. Feels: a 60 ms fake hit-stop and a 0.35 m vertical camera kick. A whiff (nothing in range) gives a dry thud, a small grey ring, and the ring around the ship goes dark for the 350 ms that SPACE is locked out.
- **SPACE at a DROP GATE (gates exist only during a build, one per bar, arriving on the downbeat)** → THE DROP. Slamming the gate cashes in the build at the multiplier printed on it. Not pressing is also a choice: the gate passes and the multiplier rises.  
  _Feedback:_ Sees: an 80 ms white flash and 2 inverted frames, FOV snaps from 60 to 100, the climbing track tips over its crest and plunges into the city canyon, a gold wave runs down the track at 300 m/s turning every red hazard gold, every later gate detonates in sequence one per sixteenth, the eclipse cracks open into a sliced neon sun and every tower fires a beam. Hears: the keypress IS the first kick of the drop: sub boom from 60 to 30 Hz over 1.2 s, a 2 s noise crash, then full kick, sidechained supersaw chords, reese bass and lead all at once after bars with no low end. Feels: the biggest shake in the game (0.6 m, 400 ms) and, from that frame, 8 bars in which nothing can hurt you. If you let the gate pass instead: a whip sound, the arch shatters behind you, the numeral ticks up and the riser restarts a step higher.
- **SPACE (or any key) on the title screen or after death** → Drop the needle: start or restart the run with no menu in between.  
  _Feedback:_ Title: the logo is itself a wall standing on the track; the press shatters it on a full kick and the ship is already moving (0 s to gameplay). After death: a 350 ms backspin (the world scrolls backwards at 10x, the ship's shards fly back together, a reverse-scratch zwip), then the kick lands and the track is live again.

## Mechanics
### PAD STRIKE: every move is a note
- Rules: Three lanes, three keys, absolute mapping. A press moves the ship to that lane instantly (0 ms in logic, 50 ms cosmetic snap) and strikes there; pressing your own lane strikes in place; last key pressed wins. NODE within +/-40 ms of the hit line = PERFECT, within +/-90 ms = GOOD (Track 01 is assisted: +/-50 and +/-110). Nothing in range = ghost tap: muted tick, no penalty, 50 ms same-key lockout. Nodes are optional: a missed node costs only the note and your streak. RAIL = a node with a tail of 1 to 4 beats: strike the head, then simply stay in the lane; every sixteenth ridden pays; pressing another lane ends it. BLOCK = kills its lane for a 60 ms slab centred on its beat; you are hit if you are in, or strike into, that lane during the slab. LASER = a block that lasts 1 to 4 beats. Leaving a lane in the 120 ms before its slab = GRAZE. One press that grazes out of a block AND lands a node elsewhere = CROSSFADE (double value). Every node carries a pitch (left = chord root, centre = fifth, right = tenth of the current chord) that sounds only if you strike it: the lead line of the track exists only when you play it.
- Why fun: Move and attack are one gesture, so the ship cuts across the track like a plectrum and every dodge can also be a hit. A newcomer can survive it as a pure dodge-runner; an expert plays it as a three-pad drum chart in which even the dodges are in time. Because lanes are pitches, zigzag patterns are literally arpeggios: you hear the shape you just flew.
- Interplay: It is the main source of TENSION, so striking well is what summons the build. It shares one beat grid with SLAM, so patterns alternate thumb and fingers like kick and snare. In a DROP the same gesture is inverted: you strike INTO the things that used to kill you. On-beat strikes are also the only way to heal the mix between drops.
### SLAM: the space bar is the kick drum
- Rules: WALLS span all three lanes, cannot be dodged, and only ever arrive on grid beats. SPACE within +/-90 ms of arrival shatters the wall (+/-40 ms = PERFECT; Track 01 allows +/-120). No slam = you crash through it: lose one mix layer and get 2 beats of invulnerability. SPACE with no wall or gate in range = WHIFF: SPACE is dead for 350 ms and your streak resets, so mashing fails. Walls never spawn during a build. During the first 8 bars of Track 01 a missed wall glitches the screen but costs nothing.
- Why fun: The simplest input in the game gets the heaviest feedback in the game: the kick, the pump, the drumhead bow and the hit-stop all land on your thumb on the downbeat. Tapping a bar on the beat is what bodies already do to dance music, so it is learned in one press.
- Interplay: It teaches 'SPACE = the low end', which is exactly what makes the drop legible with zero text: in a build the kick disappears and there is nothing for SPACE to hit until a gate arrives. Walls punctuate lane phrases and force two-handed grooves (wall on 1, pads on the off-beats). The whiff lockout makes the decision at a drop gate deliberate rather than accidental.
### HOLD THE DROP: build, gates, inversion
- Rules: TENSION runs 0 to 100: PERFECT +4, GOOD +2, GRAZE +4, CROSSFADE +8, perfect SLAM +6 (good +3), rail +1 per sixteenth, +1 per bar for free, -15 when hit; Track 01 guarantees a full meter by the end of bar 8. At 100 a BUILD starts on the next bar line: kick and bass cut out, no walls spawn, the track tilts into a climb, and density steps up every bar (quarter-note nodes, then eighths, eighths plus blocks, two-lane turnstiles, sixteenth bursts). Every build bar ends with a DROP GATE arriving exactly on the next downbeat, printed with a multiplier. Slam it (+/-130 ms) = THE DROP at that multiplier. Fly through it untouched = the build continues and the next gate is worth more. Gate ladders: Track 01: x2, MAX x3. Track 02: x2, x3, x4, MAX x6. Track 03 onward: x2 through x8, then MAX x10. The MAX gate is solid: slam it or choke. Any hit during a build = CHOKE: 250 ms tape-stop, multiplier lost, TENSION back to 50, one mix layer gone, verse resumes next bar. THE DROP lasts exactly 8 bars: mix restored to full, invulnerable, scroll x1.5, all score x the gate multiplier. A gold wave converts every block and laser into a smashable (touching one = 50 points, striking it on the beat = 200). The level does not branch: the bars you would have had to survive become the bars you get to smash, so a later gate means denser gold. The drop ends on a visible end-line followed by a 2-bar empty run-out groove, so invulnerability never expires with a hazard in your face; then +8 BPM and the next Track.
- Why fun: It is push-your-luck you can see and hear: through every gate you can see the wall of red you would be choosing to fly into, the snare roll is doubling, the song has had no bass for ten seconds, and one thumb press turns all of it to gold and brings the kick back. The player, not the composer, authors the biggest moment in the song, and the power-pellet inversion gives 8 bars of pure release before the next verse tightens the screws.
- Interplay: Fed by every strike, slam and graze. Cashing out fully heals the mix, so low health argues for an early drop and full health tempts you toward MAX. Each drop permanently raises the tempo, so mastering the mechanic is what accelerates the game. Because walls are absent from builds and whiffs lock SPACE, the space bar means exactly one thing at a gate.
### THE MIX IS YOUR LIFE
- Rules: There is no health bar. The arrangement has 4 layers and each hit strips the top one with a one-beat stutter. Level 4 = kick + bass + hats + pads, your notes wet with delay and reverb, city fully lit. Level 3 = pads gone, skyline dark. Level 2 = hats gone, stars stop streaking, saturation down 30%. Level 1 = bass gone: a bare kick heartbeat and your dry notes, the world greyscale except hazard red and note cyan. A hit at Level 1 ends the run. Every 16 on-beat actions since your last hit restore one layer (it re-enters on the next downbeat behind a one-beat snare fill while a wave of light relights the city). A drop restores everything.
- Why fun: You hear how you are doing without ever looking away from the track. Damage makes the song worse, which stings more than a number, and clawing back from a lone kick drum to the full arrangement is an emotional arc inside a two-minute run. At one hit from death everything decorative has been stripped away, so the game is at its most readable exactly when it is most tense.
- Interplay: On-beat play (strikes, slams, grazes) is the only heal in a verse; the drop is the full heal, which is what gives each gate decision teeth. It replaces the HUD entirely, so the screen stays clear for reading the track, and the intro teaches it silently because the player assembles the mix layer by layer in the first 10 seconds.

## First 30 seconds
- 0-2s: Before the press: black void, vinyl crackle, a muffled kick at 120 BPM. The logo NEEDLE DROP stands as a wall of neon glyphs across a dark three-lane track, a SPACE key glyph on it pulsing with each kick. The player presses SPACE and the logo-wall shatters into 200 shards on a full-range kick and sub drop; white flash; FOV punches 72-90-72; the Needle drops onto the track in a spray of sparks; lane lines ignite toward the horizon one rung per sixteenth; stars stretch into streaks. Bar 1 of the song starts on that keypress. No menu, no countdown: we are already doing 100 km/h, and a gold wall wearing the same SPACE glyph is sliding in from the eclipse.
- 2-4s: The wall meets the hit line exactly on the downbeat at 2.0 s, a bracket closing on it over its last beat. SLAM: it splits, the track bows like a drumhead, and the rolling sixteenth-note bassline starts because of that hit. A second wall lands at 3.0 s. Two presses in, the player knows SPACE is the kick. (For these first 8 bars a mistake glitches the screen but costs nothing.)
- 4-8s: Wall at 4.0 s. Three pads light up on the hit line wearing the glyphs for LEFT, DOWN, RIGHT. A spinning cyan node wearing the DOWN glyph comes down the centre lane where the ship already sits and arrives at 5.0 s: strike it, a bright pluck rings out and the hi-hats enter. Wall at 6.0 s. At 7.0 s a node in the left lane, at 7.5 s one in the right: the ship slashes across two lanes in a single teleport-streak and the player discovers that each lane is its own key and its own pitch.
- 8-12s: First real phrase, quarter notes: left, centre, right, centre (an A minor arpeggio climbing and falling), a wall on the next downbeat, then centre, right, centre. The pads swell in as the fourth layer and the megacity below switches on district by district, its towers bouncing as an equalizer; the eclipse corona ignites on the horizon. The song is now complete, the player built it layer by layer, and they can hear that the top line is theirs.
- 12-16s: Red arrives. A block with a striped red carpet comes down the very lane the player is standing in while a node invites them one lane over: strike the node and the block rips past the wingtip in a shower of sparks with a hat hit, the game's first and almost unavoidable CROSSFADE. Three of those in a row, then a wall and three more nodes. The ring around the ship has been filling with every hit and locks shut with a clack at 16.0 s.
- 16-18s: THE BUILD. Kick and bass are suddenly gone. A riser starts, a snare roll ticks in quarters, the track tilts upward into empty black sky toward the eclipse and the city sinks out of frame. The camera creeps in, FOV narrows to 60. Four easy nodes. Ahead: a golden arch printed with a huge x2 and the SPACE glyph and, visible through it, a much redder, denser bar of track.
- 18-20s: For the last eighth-note before the arch the sound sucks out to near-silence and the screen pinches inward: an inhale. The arch arrives on the downbeat at 18.0 s. Slam it and the drop happens right there. Fly through it and it shatters behind you, the numeral ticks to x3, the riser restarts a step higher, the roll doubles to eighths and the player threads eighth-note nodes between two red blocks toward a solid gold wall marked MAX x3. Another inhale at 19.75 s.
- 20-22s: THE DROP. SPACE on the downbeat at 20.0 s (on Track 01 only, the MAX gate fires itself if untouched, the one time the game ever plays for you). White flash, two inverted frames, sub boom; the track tips over the crest and plunges into a canyon of towers; a gold wave races away down the track turning every red block gold; the eclipse cracks open into a sliced neon sun; kick, bass, supersaw chords and lead all hit at once after 4 seconds without low end. FOV 100, speed x1.5.
- 22-30s: Gold rush. Nothing can hurt you. Dense zigzags of gold blocks and nodes pour down the canyon; each one struck on the beat detonates into a pillar of light and fires a chord stab, the score numerals pop with every hit at x3, and the towers on whichever side you are playing strobe in time. By 30 s the player has slammed, struck, grazed, chosen a drop and been made invincible without reading a word, and the drop still has three bars left (it ends at 36 s, then the faster Track 02 begins).

## Signature moment
Five seconds at the top of a full build. The track points almost straight up at a black eclipse; the city is gone; there has been no kick and no bass for eight bars; the snare roll is at 32nds; the ship is threading sixteenth-note red turnstiles with its trail white-hot, and a solid gold wall marked MAX x10 fills the top of the screen. The sound sucks out to silence for one eighth-note and the screen pinches. SLAM. White flash; the wall blows apart; the track tips over the crest like a rollercoaster and falls away into a canyon of ten thousand equalizer towers; a gold wavefront races down the track flipping red to gold; the bass comes back on the player's own keypress.

The screenshot is the frame half a second later: the ship mid-plunge with the track dropping away beneath it, gold behind the wavefront and red still ahead of it, a sliced neon sun breaking out of the eclipse, the x10 numeral in shards across the sky.

## Hazards and patterns
VOCABULARY (everything sits on a sixteenth-note grid, in one of 3 lanes, and only ever travels straight down its lane):
- NODE: spinning cyan diamond inside a ring. Strike its lane on the beat. Optional. Plays its pitch.
- RAIL: a node with a glowing cyan strip 1 to 4 beats long. Strike the head, stay in the lane: sparks, TENSION, and a sustained lead note whose filter opens as you ride.
- BLOCK: red slab with an X face and a striped red carpet. Do not be in its lane on its beat. Leaving in the last 120 ms = GRAZE.
- LASER: a block stretched to 1 to 4 beats: that lane is closed. Its carpet shows 2 beats early.
- WALL: white-gold bar across all lanes with a chevron seam. SPACE on the beat or lose a layer.
- DROP GATE (builds only): gold arch printed with a multiplier, on a bar line. SPACE = drop; no press = raise. The MAX gate is a solid wall.
- Constraints: never more than 2 of 3 lanes blocked on any slot; no node inside a block; nothing decorative ever enters the track.

PATTERNS (1 bar = beats 1 2 3 4; L C R = lanes; N node, B block, W wall):
1. FOUR ON THE FLOOR (tier 1): W on 1; N-C on 2, 3, 4. Slam, then strike in place.
2. ARP (tier 1): N-L on 1, N-C on 2, N-R on 3, N-C on 4, with mirror and inversion variants. Root, fifth, tenth, fifth: the synthwave arpeggio, flown.
3. CROSSCUT (tier 1-2): 1: N-L. 2: B-L + N-R. 3: B-R + N-L. 4: B-L + N-C. Every strike is also a dodge; done on the beat each one is a CROSSFADE.
4. BOOTS AND CATS (tier 2): W on 1 and 3; N on the 'and' of every beat, alternating L and R. Thumb, finger, thumb, finger in eighths: a drum groove.
5. TURNSTILE (tier 2-3): two blocks per beat leaving one gap that sweeps L, C, R, C, with a node in each gap; an eighth-note version at tier 3. Threading the needle.
6. RAIL SWITCH (tier 2): rail on L from beat 1 to 2.75; B-L on 3 with a rail head on R at 3 running to 4.75; W on the next 1. Ride, hop off on the beat, ride, slam.
7. GALLOP (tier 3): three sixteenths in one lane (1, 1e, 1&) then W on 2; repeat on 3-4 in another lane. Da-da-dum, crash.
8. JAM (tier 3): a laser closes L for beats 1-2, then R for beats 3-4, while eighth-note nodes zigzag in the two open lanes; W on the bar line.
9. FAKE-OUT (tier 4): W on 1, W on the 'and' of 2 (syncopated), then B-C on 3 with nodes on both L and R (choose one), W on 4.
10. STAIRWAY (build bars b1 to b8): b1 quarter-note nodes; b2 eighth-note zigzag; b3 eighths with a block behind every strike; b4 quarter-note turnstiles; b5 eighth-note turnstiles; b6 eighth-note turnstiles under a laser; b7 adds sixteenth bursts; b8 direction-reversing eighth turnstiles with gallops. Every bar ends in a gate, and if you drop early the remaining stairs are what turns to gold.

ASSEMBLY: a seeded generator picks patterns by tier for the current Track, mirrors them at random, checks entry and exit lanes so no pattern opens with a forced move inside one eighth-note of the previous one, and transposes node pitches to the current chord. A verse is 4-bar phrases of 1 and 2 bar patterns, each phrase ending on a wall.

## Readability
Rule 1, one reserved danger colour: signal red with an orange fringe, a near-white core and moving hazard stripes means 'this hurts', and nothing else in the game is ever red. The environment is confined to indigo, violet and teal at 25 to 40% of gameplay luminance; even low health is shown by draining colour from the world, never by adding red.

Rule 2, three silhouettes for three verbs, readable without colour: a small spinning diamond in a ring (strike it), a tall static slab with an X (do not be here), a bar as wide as the track (SPACE). Gates are the only arches.

Rule 3, the floor tells the truth: every object paints its lane for 2 beats ahead of itself (red hazard stripes, cyan dots, a full-width gold band). The 2 beats of track in front of the ship therefore read as a piano roll in peripheral vision, and you can play by floor alone.

Rule 4, timing has its own cue: a bracket closes on each node and wall over its final beat and meets it exactly at the hit line, and objects sit on beat rungs that tick under the ship in time with the kick, so 'when' never depends on judging depth.

Rule 5, a clean backdrop: the vanishing point always sits inside the black disc of the eclipse, so distant objects are silhouetted on pure black, and decoration is forbidden inside the track's screen trapezoid plus a 15% margin.

Rule 6, crisp over glow: decoration is thin lines drawn before bloom; gameplay cores and outlines are redrawn hard-edged after bloom; chromatic aberration, distortion and scanlines are masked to zero in the central corridor and grow toward the screen edges.

Rule 7, hazards never lie: they do not change lane, never move relative to the track, are fully visible at least 6 beats out, and never block more than 2 of 3 lanes.

Rule 8, spectacle follows vulnerability: the verse is a clean orbit; the build, where density peaks, plays against empty black sky; the drop, with its towers, sun, inverted frames and x1.5 speed, happens only while the player cannot be hurt; and at one hit from death the world is greyscale with only red and cyan left.

## Risk / reward
Points: PERFECT 100, GOOD 50, GRAZE 100, SLAM 150 (GOOD 75), CROSSFADE 300, rail 10 per sixteenth, gold smash 50 on contact or 200 struck on the beat. Everything is multiplied by CHAIN (x1, +1 for every 16 on-beat actions in a row without a miss, whiff or hit, max x4) and, during a drop, by the gate multiplier (x2 to x10). At the end of each drop the DROP TOTAL slams onto the run-out groove in giant numerals. A x10 drop at chain x4 is worth more than the rest of the run combined, and that is the point.

Three nested greed loops:
1. Per beat, the GRAZE: moving out of a red lane early is always safe and worth nothing; waiting until the last 120 ms pays TENSION, points and a hat hit, and landing on a node with the same press doubles it.
2. Per bar, the GATE: bank now (heal to full, 8 invincible bars at xN) or fly through for the next rung into a visibly denser bar where one touch of red chokes the whole build and costs a layer. Low mix pushes you to cash out; full mix dares you to ride to MAX; the ladder jumps at the top (x8 to x10) so the last bar is the most tempting.
3. Per run, the TEMPO: every drop you land raises the BPM by 8 for good. Playing well is what makes the game faster. A cautious player gets a slower, lower-scoring run; a greedy one gets a faster, richer, shorter one.

The results screen shows three numbers only: SCORE, TRACK reached, BEST DROP xN. The last one is the number friends compare.

## Escalation
Tempo is the spine: 120 BPM on Track 01, +8 per Track (128, 136, 144, 152), capped at 160 from Track 06. One beat is always 14 m, so ground speed climbs from 28 m/s to 37.3 m/s (42 to 56 m/s inside drops, where a beat stretches to 21 m). Reading time for the 8 visible beats shrinks from 4.0 s to 3.0 s.

- Track 01 (0:00 to about 0:40), tier 1: walls on downbeats, quarter-note nodes, single blocks. First 8 bars cannot hurt you. 2-bar build, first drop at 0:18 to 0:20.
- Track 02 (to about 1:30), 128 BPM, tier 2: rails, eighth-note arps, turnstiles, walls on 1 and 3. 4-bar build, ladder to x6.
- Track 03 (to about 2:25), 136 BPM, tier 3: lasers, gallops, off-beat nodes. Full 8-bar build, ladder to x10.
- Track 04 (to about 3:20), 144 BPM, tier 4: syncopated walls, fake-outs, sixteenth bursts; healing a layer now takes 24 on-beat actions.
- Track 05 (to about 4:10), 152 BPM: the whole vocabulary, mirrored and merged.
- Track 06+, 160 BPM: tempo stops rising; instead the visible distance shrinks half a beat per Track (8 down to 6), GOOD narrows from 90 to 70 ms, and remix patterns (two tier-3 patterns overlaid) enter.

Inside each verse the tier weighting creeps up every 4 bars so a verse never idles; inside each build density steps up every bar; inside each drop intensity is maximal but harmless. Intensity is therefore a climbing sawtooth: tense verse, tenser build, release, then a faster verse. A typical first run dies in Track 02 around 1:00 to 1:30; a good one reaches Track 04 around the 3 minute mark.

## Visual direction
PALETTE
- Void: #05010F, with nebula washes #3A0CA3 and #7209B7 at under 15% intensity.
- Track glass: #0E0B2B; beat rungs ultraviolet #5B2BFF; lane lines cyan #29E7FF.
- Player and everything you should hit: cyan #19F9FF with a white core; ship engine and trail edge magenta #FF2BD6.
- Walls and slams: white-gold core #FFF3B0, glow #FFC400.
- Danger, reserved for things that hurt and used nowhere else: signal red #FF1744, orange fringe #FF6A00, near-white core #FFE9E0, always striped.
- Drop gold: #FFD23F and #FFF7AE; drop-only sun gradient #FF3CAC to #FFC371.
- City windows: teal #0AFFC2 and violet #8A5CFF at 25 to 40% luminance; holograms #B14CFF.
- Each Track rotates the environment's cyan/violet hue by 25 degrees; red, gold and the player's cyan never shift.

LAYERS, far to near
1. Starfield and nebula shader.
2. The Eclipse at the vanishing point: a black disc ringed by a noisy corona that pulses with the kick.
3. The Ring megacity: two bands of equalizer towers, lit by the mix.
4. Dim violet hologram billboards with abstract glyph blocks, traffic streams as thin lines, a hoop around the track every 4 bars.
5. The track.
6. Notes and hazards.
7. Ship, trail, shards, shockwaves.
8. Post: bloom, edge-weighted chromatic aberration, light scanlines, barrel distortion, ripple rings, vignette, glitch slices.

SET PIECES, each tied to song structure
- THE LIFT (build): the track climbs out of the city into empty sky, pointing at the eclipse.
- THE PLUNGE (drop): the track falls into a canyon of towers, camera low, the eclipse opening into an outrun sun.
- THE RUN-OUT GROOVE (the 2 bars between Tracks): smooth black-glass track with concentric groove lines and vinyl crackle, the DROP TOTAL and 'TRACK 02' lying on it in giant numerals.
- Sectors: Track 02 a shipyard lattice of girders overhead; Track 03 a hex tunnel inside the Ring for maximum speed sensation; Track 04 a violet lightning storm.

## Audio direction
TEMPO AND HARMONY: 120 BPM rising 8 per Track to 160; straight sixteenths. Key A minor, modulating up a whole tone each Track. Progression i-VI-III-VII (Am, F, C, G), one bar each, so every 4-bar loop is one phrase ring on the track.

VOICES, all synthesized live: KICK (sine dive 150 to 45 Hz, click, short noise); SNARE/CLAP (band-passed noise plus a 180 Hz body) on 2 and 4 from Track 02; HATS (band-passed noise at 8 to 10 kHz, eighths then sixteenths); BASS (saw into a 24 dB low-pass, rolling sixteenths on the root with octave jumps); PADS (three detuned saw voices, slow filter LFO); PLUCK LEAD, played by the player (saw + square, fast filter envelope, dotted-eighth ping-pong delay, panned by lane); RAIL LEAD (two detuned saws with a sub, 60 ms glide, vibrato after 200 ms); DROP STACK (7-saw supersaw chord stabs fired by gold smashes, reese bass, automatic lead melody); RISER (noise through a rising high-pass plus a saw climbing an octave per bar); reverb from a generated noise impulse.

THE PLAYER PERFORMS TWO PARTS: lane strikes are the lead (a node's pitch sounds only if struck; a press up to 50 ms early is scheduled onto the exact grid time, a late one plays instantly), and slams are the big kick with sub and crash. The backing kick in a verse is deliberately medium so the slammed kick is the loud one.

ADAPTIVE LAYERING on three axes:
1. Health: 4 mix levels strip pads, then hats, then bass, leaving the kick and your dry notes.
2. Section: verse = groove; build = kick and bass muted, riser restarting a step higher each bar, snare roll doubling (quarters, eighths, sixteenths, 32nds), an eighth-note vacuum before every gate; drop = full kick, heavy sidechain, supersaws, reese; run-out = pad tail and vinyl crackle while the tempo ramps.
3. TENSION: bass cutoff and hat density rise as the meter fills, so you can hear a build coming.

KEY EFFECTS: SLAM (kick + 90 to 40 Hz sub drop + pump); GRAZE (open-hat 'tss' + doppler whip); HIT (one beat of sixteenth-note beat-repeat on the master, a bit-crush burst, low-pass reopening over a bar); LAYER BACK (snare fill + rising whoop); TENSION FULL (rising 4-note chime and a ring clack); GATE PASSED (whip + numeral tick, a step higher each time); THE DROP (sub boom 60 to 30 Hz over 1.2 s, 2 s crash, your keypress as the first kick); CHOKE (250 ms tape-stop of everything); DEATH (500 ms tape-stop to silence, then run-out crackle); RESTART (350 ms reverse scratch, then the kick).

## Failure and restart
You take damage in only two ways: being in a red lane on its beat, or failing to slam a wall. Each hit strips one mix layer and grants 2 beats of flickering invulnerability; a hit during a build also chokes the build. A hit taken while only the kick is left (the fourth unhealed hit) ends the run. During the first 8 bars of Track 01 nothing can cost a layer.

Death is a record stopping: the music's pitch and the world's scroll decelerate together over 500 ms, the ship shatters into shards that hang in zero-g, the frame drains to grey-magenta with the fatal object frozen in front of you, and SCORE, TRACK and BEST DROP xN fade up as giant numerals lying on the track, a SPACE glyph pulsing at the old tempo.

Input is accepted 250 ms after the fatal hit. SPACE triggers a 350 ms backspin (the world rewinds at 10x, the shards fly back into the ship, reverse scratch) and the kick lands: you are moving again 0.6 s after dying at the fastest, about 1.0 s typically, always under 1.5 s. Restarts skip the tutorial bars: the first wall arrives 2 beats (1.0 s) after the needle lands, the mix is full, the seed is new, and the first drop is again less than 20 seconds away.

## Bot strategy
The world is a pure function of song time and the chart is a list of events {beat, lane, type, length}, so the bot is a scheduler, not a controller. Because a lane press teleports the ship, there is no path-finding: only the lane occupied at each grid slot matters.

For each occupied slot s at time T, with blocked(s) = the lanes under a block or laser:
1. Wall (or gold wall) at s: press SPACE at T.
2. Node or rail head at s in an unblocked lane: press that lane at T (this is also the dodge). If two nodes share a slot, take the one whose lane is open at the next occupied slot.
3. Otherwise, if the current lane is in blocked(s): press an open lane, preferring the lane of the next node, at T - 60 ms (inside the graze window; 'safe' mode uses T - 250 ms).
4. On a rail: do nothing until the tail ends or rule 3 fires.
5. Drop gate: slam gate number g, a policy parameter (attract mode uses the MAX gate on Track 01 and g = 3 afterwards; test sweeps run g = 1 to MAX).
6. In a drop: press the lane of every gold object at its time, nodes first.

A jitter parameter adds +/- N ms to every press. Tests: at 0 ms every generated chart must come back 100% PERFECT with no damage, which proves the assembler never emits an impossible slot; at +/-35 ms the bot must never take damage; at +/-80 ms it should clear Track 01 and die by Track 04, which is how the windows get tuned. Because the simulation needs only a clock, the same bot runs 10,000 bars headless against a mock audio clock in seconds, and with +/-15 ms jitter it is the attract mode playing behind the title.

## Tech notes
SIMULATION: no physics and no per-frame collision. Song time comes from AudioContext.currentTime minus output latency; every object's position is (eventBeat - songBeat) x beatLength; judgments are evaluated analytically at keydown (the event timestamp mapped to audio time, nearest event in that lane) and at each event's own time (lane-occupancy check for blocks, missed-wall check). The whole game state is a small struct plus the chart, which makes it deterministic, replayable and trivially bot-driven. Hit-stop is faked with camera and flash only; object positions never leave the audio clock.

CHART: a seeded PRNG assembles hand-authored 1 and 2 bar patterns per tier, always at least 8 beats ahead. A validator enforces one open lane per slot, no node inside a block, and a per-tier cap on required presses per second (2, 4, 6, 8). Build bars and drop bars are generated as one continuous strip: the drop does not branch the level, it only flips the meaning of what is already on screen, so nothing pops in or is regenerated when the player decides.

RENDERING (WebGL2): one dynamic vertex buffer of coloured, additively blended quads and triangles (about 6 to 10k quads a frame); lines are thin quads with a 1D falloff; a curved-world vertex shader takes yaw and pitch curvature uniforms plus up to 4 'string twang' and 1 'drumhead' displacement uniforms. Passes: environment and gameplay into an RGBA16F target (RGBA8 fallback); bloom by threshold and a 5-level half-resolution down/up-sample chain; a crisp pass redrawing gameplay cores and outlines over the bloom; one final post shader (radially masked chromatic aberration, barrel distortion, up to 4 ripple rings, scanlines, vignette, glitch slices, invert, saturation). Text is a stroke font defined in code and baked once into an atlas texture at boot.

AUDIO: a 25 ms look-ahead scheduler queuing 120 ms ahead; pooled oscillator/filter/gain voices; bus chain music -> sidechain gain -> 'vacuum' filter -> beat-repeat delay (feedback 1.0 while engaged) -> compressor -> out. One ConstantSourceNode feeds every oscillator's detune, which gives tape-stop, backspin and choke for almost nothing. Skyline and pulse visuals read the sequencer's own envelopes rather than an FFT, so they are exactly in time and deterministic.

CHEAP: everything on the track, the city (instanced quads), the sky shader, particles as CPU triangles (cap 2,000), the audio graph (under 40 simultaneous voices).
EXPENSIVE, so budgeted: full-screen passes (bloom at half resolution, a single combined post pass), overdraw from large glow sprites (cap count and size), the supersaw stack (7 oscillators per voice, 4 voices max, drops only). Flashes and inverted frames sit behind a reduced-flash toggle.

## Biggest risk
Timing that feels unfair. A rhythm-locked runner dies the moment what you see, hear and press disagree by 60 ms, and browsers add variable audio latency (worst on Bluetooth), so a hit that looked right gets judged wrong and every core verb feels broken.

Mitigations, in order of importance:
1. One clock: visuals, judgments and the sequencer all read the audio clock offset by the reported output latency, and key presses are judged from their event timestamps, not the frame they were polled on.
2. Silent calibration: the median signed error of the player's first 12 judged hits (the harmless tutorial bars) shifts the judgment and visual offset, clamped to +/-100 ms, and keeps adapting slowly.
3. It survives as a runner without good timing: nodes are optional, blocks are positional with a 60 ms slab and 4 seconds of warning, and only walls demand timing, with a +/-120 ms window on Track 01. Precision buys score, TENSION and healing, not survival.
4. The biggest moment has the widest window: +/-130 ms on a drop gate.

Secondary risk: absolute lane keys can surprise players who expect left/right to nudge one lane. The three pads wear their key glyphs for the first 16 bars and the first three nodes arrive wearing the glyph of the key that hits them, in the 8 bars where mistakes are free.

## Why this wins
It answers the brief's hardest demands with one idea. 'Unique mechanic', 'own soundtrack', 'heavy game feel' and 'whoa inside 30 seconds' are all the same feature: the player performs the track and personally triggers its bass drop, which is at once a literal rollercoaster drop, a power-pellet inversion, a full heal and the scoring engine. Nobody needs it explained; everyone who has ever waited for a drop already knows why holding it is delicious.

It is tight. Four keys, two verbs, three object shapes, no jump, no HUD. Strikes feed tension, tension summons the build, the build asks one question per bar, the answer flips the whole game, and the mix tells you how you are doing by ear.

It is still a runner. Momentum is automatic and relentless at 100 to 200 km/h, the ship physically occupies a lane, and survival is a matter of reading ahead and being in the right place; rhythm is the expression layered on top, so non-rhythm players survive and rhythm players shine.

It turns the production constraints into strengths. Live synthesis is what lets the lead exist only when you play it, lets damage remove instruments, and gives tape-stops and backspins for free. A beat-grid, three-lane, teleport-move model is the most analyzable obstacle model there is, so the bot is a provably perfect scheduler and the engineering budget goes into feel instead of physics. Readability is designed in rather than patched on: one reserved danger colour, a floor that works as a piano roll, a black eclipse behind the vanishing point, and maximum spectacle scheduled for the 8 bars when the player cannot be hurt.

And it restarts like a song: death is a record stopping, retry is a backspin and a needle drop, and the next drop is never more than 20 seconds away.

## Juice
- Lane strike: the ship snaps in 50 ms with 8% overshoot, banks 25 degrees and leaves a 3-ghost ribbon for 120 ms; the camera follows on a 120 ms spring (0.6 m, 2 degree roll). There is no screen shake on strikes, ever: shake is reserved for slams, hits and drops so it keeps its meaning.
- PERFECT node: 14 shards streak past the camera at 2x track speed, a ring of light runs 60 m up the lane in 200 ms, the two lane lines twang as a damped standing wave (0.25 m, 300 ms), FOV +2 degrees for 120 ms, white-hot flash. GOOD gets 8 cyan shards and no twang, so quality is felt rather than read.
- Slam: a 60 ms fake hit-stop (camera, ship and shards freeze under a 35% white frame while track objects keep scrolling on the audio clock, so impact is felt but timing is never bent), a 0.35 m camera kick at 28 Hz for 250 ms, a drumhead wave down the track at 250 m/s, a screen-space ripple, a 6 px chromatic spike, and a 9 dB sidechain pump on the whole music bus.
- Graze: a white slice-line across the block face, a horizontal spark shower off the wingtip, a hat 'tss' and doppler whip panned to the side the block passed on, and the sparks curve into the TENSION ring.
- Rail ride: a continuous spark fountain from the stylus tip, the trail turns white, the sustained lead note's filter opens with distance ridden and the camera lowers 0.3 m; hopping off on the beat ends it with a pitched pop.
- Everything breathes on the kick: corona radius +6%, bloom +10%, lane-line brightness +20%, all decaying across the beat; beat rungs pass under the ship exactly on beats so the floor is a metronome you can feel.
- The city is the equalizer: tower window-height follows each instrument's envelope (bass near, hats far), and your own notes strobe the skyline on the side you played them, so pressing LEFT visibly plays the left of the city.
- Taking a hit is a needle skip: the master output stutters the last sixteenth 4 times, the frame tears into 6 offset slices with a 10 px RGB split for 250 ms, the camera jolts back 1 m, the top layer of the mix tape-stops out and a district of the city goes dark in a cascade.
- Getting a layer back: a one-beat snare fill, the part re-enters on the downbeat and a wave of light relights the skyline from near to far while saturation returns.
- Build: lane lines turn from cyan to white, the camera dollies 1.5 m closer and FOV narrows 72 to 60, the vignette tightens, a continuous micro-shake grows from 0.02 to 0.12 m by bar 8, the engine trail lengthens 30% per bar, and the track climbs until the screen has emptied to black sky.
- Gate tease: for the last eighth-note before every gate the mix is high-passed to 2 kHz and dropped 12 dB while the screen pinches (barrel -0.15): an inhale. Passing the gate snaps everything back louder and a step higher.
- The drop: 80 ms white flash, 2 inverted frames, FOV 60 to 100 settling at 90, the camera drops from 2.4 m to 1.5 m for ground rush, the track plunges, a gold wavefront converts hazards at 300 m/s, later gates chain-detonate one per sixteenth, speed lines crowd the screen edges and the eclipse breaks into a sliced sun.
- Gold smash: each block erupts into a 200 ms pillar of light and fires a chord stab; the score numeral pops from 1.4x to 1.0x in 100 ms; at chain x4 the trail splits into twin white ribbons.
- Death and restart: a tape-stop in which the music's pitch and the world's scroll decelerate together over 500 ms, the ship shatters into shards that hang in zero-g with the fatal object frozen in front of you; on SPACE the world backspins at 10x for 350 ms, the shards reassemble, and the kick lands.
