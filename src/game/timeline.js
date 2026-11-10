// game/timeline.js — the tempo map. The whole game (simulation, level, music) is laid out in beats;
// this is the one place that turns beats into seconds. Pure functions, no state.
//
// Sector 0 CONDUIT   : beats   0..20  (5 bars, 128 BPM)  intro tunnel, ends at THE DROP (beat 20)
// Sector 1 SPINDLE   : beats  20..68  (12 bars, 128 BPM)
// Sector n >= 2      : 64 beats each (16 bars), +4 BPM per sector up to 148
import { TICKS_PER_BEAT } from './config.js';

export const DROP_BEAT = 20;
export const QUICK_START_BEAT = 18;   // retries begin two beats before the drop
const S1_END = 68;
const SECTOR_BEATS = 64;

export const sectorBpm = (s) => (s <= 1 ? 128 : Math.min(148, 128 + 4 * (s - 1)));
export const sectorStartBeat = (s) => (s <= 0 ? 0 : s === 1 ? DROP_BEAT : S1_END + SECTOR_BEATS * (s - 2));
export const sectorEndBeat = (s) => sectorStartBeat(s + 1);
export const sectorOfBeat = (b) => (b < DROP_BEAT ? 0 : b < S1_END ? 1 : 2 + Math.floor((b - S1_END) / SECTOR_BEATS));
export const bpmAtBeat = (b) => sectorBpm(sectorOfBeat(b));

// Seconds at the start of each sector, extended lazily.
const startTimes = [0];
function sectorStartTime(s) {
  while (startTimes.length <= s) {
    const i = startTimes.length - 1;
    startTimes.push(startTimes[i] + ((sectorStartBeat(i + 1) - sectorStartBeat(i)) * 60) / sectorBpm(i));
  }
  return startTimes[s];
}

export function beatToTime(b) {
  if (b <= 0) return (b * 60) / 128;
  const s = sectorOfBeat(b);
  return sectorStartTime(s) + ((b - sectorStartBeat(s)) * 60) / sectorBpm(s);
}
export function timeToBeat(t) {
  if (t <= 0) return (t * 128) / 60;
  let s = 0;
  while (sectorStartTime(s + 1) <= t) s++;
  return sectorStartBeat(s) + ((t - sectorStartTime(s)) * sectorBpm(s)) / 60;
}
export const tickToTime = (tick) => beatToTime(tick / TICKS_PER_BEAT);
export const timeToTick = (t) => timeToBeat(t) * TICKS_PER_BEAT;
export const beatDurAt = (b) => 60 / bpmAtBeat(b);
