// game/config.js — every shared number and color in BLUESHIFT. Pure data, importable anywhere.
import { hex } from '../engine/math.js';

// ---- the tube (world units are metres)
export const LANES = 8;                 // lane cells 0..7
export const CORE = 8;                  // the ninth cell: the open core of the tube
export const APOTHEM = 5;               // distance from the tube axis to the middle of a lane
export const LANE_ANGLE = (Math.PI * 2) / LANES;       // 45 degrees
export const VERTEX_R = APOTHEM / Math.cos(LANE_ANGLE / 2); // radius of the octagon corners (5.41)
export const LANE_W = 2 * APOTHEM * Math.tan(LANE_ANGLE / 2); // 4.14
export const RIB_SPACING = 8;           // an octagon rib every 8 m
export const DECOR_MIN_R = 9;           // nothing decorative may come closer to the axis than this
export const HORIZON = 150;             // hazards materialise this many metres ahead

// ---- time
export const TICKS_PER_BEAT = 4;        // hazards live on a 16th-note grid
export const BEATS_PER_BAR = 4;

// ---- gears: speed is life
export const GEAR_SPEED = [0, 48, 60, 72, 86, 100];   // m/s, index = gear 1..5
export const GEAR_FLUX = [0, 60, 80, 100, 120, 120];  // flux needed to leave gear g (gear 5: overflow -> lead)
export const MAX_GEAR = 5;
export const GEAR_FOV = [0, 68, 72, 76, 80, 84];      // vertical FOV in degrees (kept modest: a wider lens shrinks the hazards)

// ---- the nova
export const LEAD_START = 220;
export const LEAD_MAX = 300;
export const LEAD_CRASH = 40;
export const LEAD_GATE = 30;
export const SPINDLE_LEAD_FLOOR = 70;  // inside the scripted opening (sectors 0-1) the nova can loom but not catch you
export const NOVA_SPEED = [0, 36, 50, 64, 78, 90, 98]; // by sector; beyond the table: +4 per sector
export const novaSpeed = (sector) => (sector < NOVA_SPEED.length ? NOVA_SPEED[sector] : 98 + 4 * (sector - 6));

// ---- player timing (seconds unless noted)
export const ROLL_INTERVAL = 0.085;     // at most one lane per 85 ms
export const ROLL_BUFFER = 0.11;
export const ROLL_REPEAT_DELAY = 0.16;
export const ROLL_ANIM = 0.09;          // cosmetic world snap
export const FLIP_BEATS = 0.75;         // airtime
export const FLIP_CORE_IN = 0.08; // beats: in the core cell between these
export const FLIP_CORE_OUT = 0.67;
export const RAM_TIME = 0.18;           // breach ram window after the press
export const RAM_LATE = 0.08;           // late grace after the wall arrives (a pure-reaction press on the white flash still lands)
export const RAM_PERFECT = 0.05;        // |press - beat| for PERFECT
export const RAM_RECOVERY = 0.2;        // after a whiff
export const GHOST_TIME = 1.2;          // invulnerability after a crash
export const INPUT_BUFFER = 0.12;

// ---- flux income
export const FLUX = {
  perfect: 30, perfectChain: 4, perfectChainCap: 20, good: 18, whiff: -3,
  graze: 5, thread: 12, grindPerBeat: 5, irisPass: 10, irisClean: 16, orb: 4, spark: 1, gate: 30,
  overflowToLead: 0.5,
};
// ---- score (each multiplied by the current gear)
export const POINTS = { perfect: 500, good: 200, cleanFlip: 300, irisPass: 150, thread: 250, graze: 50, orb: 40, spark: 10, grindPerBeat: 60, gate: 1000, metre: 1 };

// ---- palette (linear light). Reserved meanings: do not reuse a hazard color for decoration.
export const C = {
  void0: hex('#05010f'), void1: hex('#0b0424'),
  // structure ramp by gear: the faster you go, the bluer the world
  // violet -> blue, one step bluer and brighter per gear. It stops short of cyan on purpose: cyan is
  // reserved for the runner and everything safe, and must never be the colour of the walls.
  gear: [hex('#5b2bd6'), hex('#5b2bd6'), hex('#4a3df0'), hex('#3857ff'), hex('#2b74ff'), hex('#3f97ff')],
  you: hex('#00f0ff'),       // runner, pickups, launch pads, safe guidance
  white: [1, 1, 1],
  solid: hex('#ff2a6d'),     // magenta: never touch
  solidFill: hex('#14000a'),
  ice: hex('#ffe600'),       // yellow: breach it
  iceHot: hex('#fff9c2'),
  nova0: hex('#ff7a1a'), nova1: hex('#ffd27a'),   // the star, only ever at the screen edges
  ok: hex('#7dffb0'),
  dim: hex('#8a7fb8'),
};
export const SECTOR_NAMES = ['CONDUIT', 'THE SPINDLE', 'NEON MILE', 'FOUNDRY', 'SHATTER', 'CORONA', 'FLARE'];
export const sectorName = (s) => SECTOR_NAMES[Math.min(s, SECTOR_NAMES.length - 1)];

// Lane index -> angle around the tube axis (0 = straight down, increasing clockwise as seen by the camera).
export const laneAngle = (lane) => lane * LANE_ANGLE;
// Tube space -> world x/y (y up). angle 0 puts the point at the bottom of the tube.
export const tubeX = (angle, r) => Math.sin(angle) * r;
export const tubeY = (angle, r) => -Math.cos(angle) * r;
