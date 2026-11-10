// game/music_song.js — the notes of the BLUESHIFT theme. Pure data, no audio. Private to music.js.
//
// Key of F minor. The chord follows the bar: index = bar % 4 into Fm - Db - Ab - Eb. THE DROP is bar 5
// and every sector starts on a bar with index 1, so each 4-bar phrase runs Db - Ab - Eb - Fm: it lifts
// off on the bright chord and comes home on the last bar (which is also where the sector fill sits).

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

//                      Fm  Db  Ab  Eb
export const BASS_ROOT = [41, 37, 44, 39];   // F2 Db2 Ab2 Eb2
export const SUB_ROOT = [29, 37, 32, 39];    // F1 Db2 Ab1 Eb2: kept inside 43..78 Hz

// Six ascending chord tones per chord for the arpeggios, voiced so neighbours share notes.
export const ARP_TONES = [
  [65, 68, 72, 77, 80, 84],   // Fm : F  Ab C  F  Ab C
  [65, 68, 73, 77, 80, 85],   // Db : F  Ab Db F  Ab Db
  [63, 68, 72, 75, 80, 84],   // Ab : Eb Ab C  Eb Ab C
  [63, 67, 70, 75, 79, 82],   // Eb : Eb G  Bb Eb G  Bb
];
export const PAD_NOTES = [[53, 60, 68], [53, 61, 68], [51, 60, 68], [51, 58, 67]];
export const STAB_NOTES = [[65, 68, 72], [65, 68, 73], [63, 68, 72], [63, 67, 70]];

// Arp shapes: indices into ARP_TONES, one per 16th.
export const ARP_SHAPES = [
  [0, 2, 3, 2, 4, 2, 3, 2, 5, 2, 3, 2, 4, 2, 3, 1],   // pedal tone with a walking top line
  [0, 2, 4, 1, 3, 5, 2, 4, 0, 2, 4, 1, 3, 5, 3, 1],   // 3 + 3 + 2 staircase
  [0, 1, 2, 3, 4, 3, 2, 1, 2, 3, 4, 5, 4, 3, 2, 1],   // wave
  [5, 3, 4, 2, 3, 1, 2, 0, 5, 3, 4, 2, 3, 1, 2, 3],   // falling thirds
];
// Velocity shapes for the arp (accents make the 3+3+2 audible).
export const ARP_ACC = [
  [1, 0.6, 0.75, 0.6, 0.9, 0.6, 0.75, 0.6, 1, 0.6, 0.75, 0.6, 0.9, 0.6, 0.75, 0.7],
  [1, 0.6, 0.7, 1, 0.6, 0.7, 1, 0.7, 1, 0.6, 0.7, 1, 0.6, 0.7, 1, 0.7],
];

// Rolling 16th bass: semitones above the chord root. The octave pops every third 16th (a hemiola
// against the four-on-the-floor kick) are what make it roll.
export const RIFFS = [
  [0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 0],
  [0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 12, 0, 7, 12],
  [0, 0, 12, 0, 0, 12, 0, 12, 0, 0, 12, 0, 7, 12, 0, 12],
];
// Phrase-ending bar (Fm): the last beat walks up F - Ab - C - Eb into the next phrase.
export const RIFF_TURN = [0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 3, 7, 10];

// Stab rhythms (16th steps that carry a supersaw chord stab).
export const STAB_STEPS = [
  [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],   // off-beats: fills the sidechain pocket
  [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],   // hemiola, with the bass pops
  [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0],
];

// The counter-melody: 8 bars (two phrases), bar 0 of each phrase is the Db bar. [step, midi, length in 16ths].
const M1 = [
  [[0, 68, 3], [3, 73, 3], [6, 77, 6], [12, 75, 4]],
  [[0, 68, 3], [3, 72, 3], [6, 75, 6], [12, 72, 4]],
  [[0, 70, 3], [3, 75, 3], [6, 79, 6], [12, 77, 4]],
  [[0, 80, 8], [8, 79, 2], [10, 77, 2], [12, 72, 4]],
  [[0, 77, 3], [3, 80, 3], [6, 85, 6], [12, 84, 4]],
  [[0, 75, 3], [3, 80, 3], [6, 84, 6], [12, 82, 4]],
  [[0, 75, 3], [3, 79, 3], [6, 82, 6], [12, 79, 4]],
  [[0, 77, 10], [10, 75, 2], [12, 77, 4]],
];
const M2 = [
  [[0, 77, 2], [2, 80, 2], [4, 77, 2], [6, 85, 6], [12, 84, 2], [14, 80, 2]],
  [[0, 75, 2], [2, 80, 2], [4, 75, 2], [6, 84, 6], [12, 82, 2], [14, 80, 2]],
  [[0, 75, 2], [2, 79, 2], [4, 75, 2], [6, 82, 6], [12, 80, 2], [14, 79, 2]],
  [[0, 77, 6], [6, 80, 2], [8, 84, 8]],
  [[0, 85, 3], [3, 84, 3], [6, 80, 2], [8, 77, 4], [12, 80, 4]],
  [[0, 84, 3], [3, 82, 3], [6, 80, 2], [8, 75, 4], [12, 80, 4]],
  [[0, 82, 3], [3, 80, 3], [6, 79, 2], [8, 75, 4], [12, 79, 4]],
  [[0, 80, 4], [4, 79, 4], [8, 77, 8]],
];

// Flattened into per-step lookup tables so the sequencer never searches or allocates:
// MEL_NOTE[m][bar8 * 16 + step] = midi (0 = nothing starts here), MEL_LEN = its length in 16ths.
function flatten(mel) {
  const note = new Uint8Array(128), len = new Uint8Array(128);
  for (let b = 0; b < 8; b++) for (const n of mel[b]) { note[b * 16 + n[0]] = n[1]; len[b * 16 + n[0]] = n[2]; }
  return [note, len];
}
const F1 = flatten(M1), F2 = flatten(M2);
export const MEL_NOTE = [F1[0], F2[0]];
export const MEL_LEN = [F1[1], F2[1]];

// Closed-hat velocity per 16th, by hat mode.
export const HATS = [
  [0.3, 0, 0.65, 0, 0.3, 0, 0.65, 0, 0.3, 0, 0.65, 0, 0.3, 0, 0.65, 0.2],             // 0 conduit / gear 1: 8ths
  [0.5, 0.28, 0, 0.32, 0.5, 0.28, 0, 0.32, 0.5, 0.28, 0, 0.32, 0.5, 0.28, 0, 0.4],    // 1 16ths around the open hat
  [0.6, 0.3, 0.2, 0.45, 0.35, 0.3, 0.6, 0.3, 0.35, 0.45, 0.2, 0.3, 0.6, 0.3, 0.35, 0.5], // 2 3+3+2 accents
  [0.55, 0.3, 0.25, 0.3, 0.55, 0.3, 0.25, 0.5, 0.55, 0.3, 0.25, 0.3, 0.55, 0.5, 0.25, 0.5], // 3 pushed
];
// Clank percussion (later sectors): velocity per 16th.
export const CLANKS = [
  [0, 0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0],
  [0, 0, 0, 0.7, 0, 0, 0.4, 0, 0, 0, 0.5, 0, 0, 0.6, 0, 0],
];
