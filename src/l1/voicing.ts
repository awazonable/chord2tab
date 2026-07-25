/**
 * L1 — guitar model: tuning, candidate voicings, physical filters, single cost.
 * (SPEC §4.1–§4.4)
 *
 * A Voicing is 6 entries, index 0 = 6th string (low E) .. index 5 = 1st string
 * (high E) — matching the low→high order of the §4.7 text form `x-3-5-5-4-3`.
 * `null` = muted string, `0` = open.
 */

import { type Chord, DEGREES, BASE, type Degree } from "../l0_5/chord.js";

/** Standard tuning EADGBE, low→high, as MIDI note numbers. */
export const OPEN_MIDI = [40, 45, 50, 55, 59, 64] as const;
export const STRINGS = 6;
export const MAX_FRET = 15;

export type Voicing = (number | null)[]; // length 6, low→high

export interface NoteSelection {
  /** Pitch classes any sounding string is allowed to play. */
  allowed: Set<number>;
  /** Pitch classes that MUST all appear among sounding strings (§4.1 保持). */
  required: Set<number>;
  rootPc: number;
  bassPc: number | null;
  /** Minimum number of sounding strings (§4.2: ≥4, power chords ≥2). */
  minSounding: number;
  /** Optional tones ranked by drop willingness (index 0 = drop first) (§4.1). */
  droppableByPriority: number[];
  /** True when the chord asked for an inner-cluster placement (add2/4/6) (§4.4). */
  dropOctave: boolean;
}

const midiAt = (stringIdx: number, fret: number) => OPEN_MIDI[stringIdx]! + fret;
const pcAt = (stringIdx: number, fret: number) => midiAt(stringIdx, fret) % 12;

function degreePc(chord: Chord, d: Degree): number {
  return ((chord.root_pc + BASE[d] + (chord.slots[d] as number)) % 12 + 12) % 12;
}

/**
 * Decide which pitch classes to keep / allow / may-drop for a chord (§4.1).
 */
export function selectNotes(chord: Chord): NoteSelection {
  const allowed = new Set<number>();
  const required = new Set<number>();
  const optional: { pc: number; dropRank: number }[] = [];

  // Drop willingness: 5th first, then 11th, 9th, root(cond), 13th (§4.1).
  const DROP_RANK: Partial<Record<Degree, number>> = { 5: 0, 11: 1, 9: 2, 13: 4 };

  const powerChord = chord.slots[3] === null && chord.slots[5] !== null;

  for (const d of DEGREES) {
    const v = chord.slots[d];
    if (v === null) continue; // null slots are excluded entirely (§4.1)
    const pc = degreePc(chord, d);
    allowed.add(pc);

    const characteristic = v !== 0 || chord.drop_octave.has(d);
    const isKeep =
      d === 1 || // root
      d === 3 || // 3rd (or its sus replacement)
      d === 7 || // 7th
      characteristic || // altered tones, add-family, 6th
      (powerChord && d === 5); // keep the 5th of a power chord

    if (isKeep) required.add(pc);
    else optional.push({ pc, dropRank: DROP_RANK[d] ?? 3 });
  }

  if (chord.bass_pc !== null) allowed.add(chord.bass_pc);

  optional.sort((a, b) => a.dropRank - b.dropRank);

  return {
    allowed,
    required,
    rootPc: chord.root_pc,
    bassPc: chord.bass_pc,
    minSounding: powerChord ? 2 : 4,
    droppableByPriority: optional.map((o) => o.pc),
    dropOctave: chord.drop_octave.size > 0,
  };
}

/** Frets on a string whose pitch class is allowed (plus open if allowed). */
function fretOptions(stringIdx: number, allowed: Set<number>, maxFret: number): number[] {
  const out: number[] = [];
  for (let f = 0; f <= maxFret; f++) {
    if (allowed.has(pcAt(stringIdx, f))) out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Physical structure of a voicing
// ---------------------------------------------------------------------------

export interface VoicingInfo {
  sounding: number[]; // string indices that ring (open or fretted)
  pressed: { s: number; f: number }[]; // fretted (f>0)
  soundingPcs: Set<number>;
  minFret: number; // min pressed fret (0 if no pressed)
  maxFret: number; // max pressed fret (0 if no pressed)
  span: number; // maxFret - minFret over pressed
  fingers: number; // estimated fingers after barre merge
  barre: boolean;
  openCount: number;
  innerMutes: number;
  topMidi: number; // highest sounding pitch
  lowMidi: number; // lowest sounding pitch
}

export function analyze(v: Voicing): VoicingInfo {
  const sounding: number[] = [];
  const pressed: { s: number; f: number }[] = [];
  const soundingPcs = new Set<number>();
  let openCount = 0;
  for (let s = 0; s < STRINGS; s++) {
    const f = v[s];
    if (f === null) continue;
    sounding.push(s);
    soundingPcs.add(pcAt(s, f));
    if (f === 0) openCount++;
    else pressed.push({ s, f });
  }

  const pf = pressed.map((p) => p.f);
  const minFret = pf.length ? Math.min(...pf) : 0;
  const maxFret = pf.length ? Math.max(...pf) : 0;
  const span = pf.length ? maxFret - minFret : 0;

  // Barre: the lowest pressed fret shared by ≥2 strings can be one finger.
  const atMin = pressed.filter((p) => p.f === minFret).length;
  const barre = minFret > 0 && atMin >= 2;
  const fingers = pressed.length - (barre ? atMin - 1 : 0);

  // Inner mutes: muted strings between the lowest and highest sounding string.
  let innerMutes = 0;
  if (sounding.length) {
    const lo = sounding[0]!;
    const hi = sounding[sounding.length - 1]!;
    for (let s = lo + 1; s < hi; s++) if (v[s] === null) innerMutes++;
  }

  const soundMidis = sounding.map((s) => midiAt(s, v[s]!));
  const topMidi = soundMidis.length ? Math.max(...soundMidis) : -1;
  const lowMidi = soundMidis.length ? Math.min(...soundMidis) : -1;

  return {
    sounding,
    pressed,
    soundingPcs,
    minFret,
    maxFret,
    span,
    fingers,
    barre,
    openCount,
    innerMutes,
    topMidi,
    lowMidi,
  };
}

export interface Filters {
  maxSpan: number;
  maxFingers: number;
  maxInnerMutes: number;
}

export const DEFAULT_FILTERS: Filters = { maxSpan: 4, maxFingers: 4, maxInnerMutes: 1 };

/** Hard playability filters (§4.2). Returns true if the voicing is admissible. */
export function passesFilters(info: VoicingInfo, sel: NoteSelection, filt: Filters): boolean {
  if (info.sounding.length < sel.minSounding) return false;
  if (info.span > filt.maxSpan) return false;
  if (info.fingers > filt.maxFingers) return false;
  if (info.innerMutes > filt.maxInnerMutes) return false;

  // all "keep" pitch classes present
  for (const pc of sel.required) if (!info.soundingPcs.has(pc)) return false;

  // bass constraint: lowest sounding pc == /X
  if (sel.bassPc !== null) {
    const lowPc = ((info.lowMidi % 12) + 12) % 12;
    if (lowPc !== sel.bassPc) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Single-voicing cost (§4.3, §4.4)
// ---------------------------------------------------------------------------

export const W = {
  finger: 0.9,
  span: 0.5,
  barreBonus: -0.25,
  openBonus: -0.5, // open strings pull the solver toward idiomatic open shapes
  height: 0.55, // applied to the *highest* pressed fret (position up the neck)
  rootBassBonus: -1.0, // root on the lowest string (no slash) — root position
  inversionPenalty: 1.8, // a non-root in the bass when no /X was asked for
  soundingBonus: -0.25, // per ringing string: prefer fuller, idiomatic shapes
  innerMute: 1.5, // muted string sandwiched between ringing strings (§4.3 慣習形)
  semitoneAdj: 0.9,
  semitoneAdjRelaxed: 0.25, // §4.4 add2/4/6
  omitOptional: 0.5, // per omitted optional tone, scaled by priority
};

export function singleCost(v: Voicing, info: VoicingInfo, sel: NoteSelection): number {
  let cost = 0;
  cost += W.finger * info.fingers;
  cost += W.span * info.span;
  if (info.barre) cost += W.barreBonus;
  cost += W.openBonus * info.openCount;
  cost += W.height * info.maxFret; // higher up the neck = costlier
  cost += W.innerMute * info.innerMutes;
  cost += W.soundingBonus * info.sounding.length;
  // Root position vs inversion. A /X slash is already forced by the filter, so
  // only shape plain chords here: reward root-in-bass, penalise inversions.
  if (sel.bassPc === null) {
    const lowPc = ((info.lowMidi % 12) + 12) % 12;
    cost += lowPc === sel.rootPc ? W.rootBassBonus : W.inversionPenalty;
  }

  // Upper-voice semitone adjacency penalty, relaxed for drop_octave (§4.4).
  const adjW = sel.dropOctave ? W.semitoneAdjRelaxed : W.semitoneAdj;
  for (let i = 0; i + 1 < info.sounding.length; i++) {
    const a = info.sounding[i]!;
    const b = info.sounding[i + 1]!;
    if (a < 3) continue; // only the upper part
    const d = Math.abs(midiAt(b, v[b]!) - midiAt(a, v[a]!));
    if (d === 1) cost += adjW;
  }

  // Completeness: penalise omitted optional tones, cheapest to drop first (§4.1).
  sel.droppableByPriority.forEach((pc, idx) => {
    if (!info.soundingPcs.has(pc)) cost += W.omitOptional * (idx + 1);
  });

  return cost;
}

export interface Candidate {
  voicing: Voicing;
  info: VoicingInfo;
  cost: number;
  /** Where this candidate came from (set by the solver's candidatesFor). */
  origin?: "library" | "solver";
}

/**
 * Enumerate admissible voicings for a chord and return the top-K by single cost.
 * Uses depth-first assignment with span pruning to stay well under the ~15k
 * brute-force bound (§4.2).
 */
export function enumerate(chord: Chord, k: number, filt: Filters = DEFAULT_FILTERS): Candidate[] {
  const sel = selectNotes(chord);
  const perString = Array.from({ length: STRINGS }, (_, s) => {
    const opts: (number | null)[] = [null]; // mute always an option
    for (const f of fretOptions(s, sel.allowed, MAX_FRET)) opts.push(f);
    return opts;
  });

  const results: Candidate[] = [];
  const current: (number | null)[] = new Array(STRINGS).fill(null);

  const recurse = (s: number, curMin: number, curMax: number) => {
    if (s === STRINGS) {
      const v = current.slice();
      const info = analyze(v);
      if (passesFilters(info, sel, filt)) {
        results.push({ voicing: v, info, cost: singleCost(v, info, sel) });
      }
      return;
    }
    for (const opt of perString[s]!) {
      let nMin = curMin;
      let nMax = curMax;
      if (opt !== null && opt > 0) {
        nMin = Math.min(curMin, opt);
        nMax = Math.max(curMax, opt);
        if (nMax - nMin > filt.maxSpan) continue; // prune
      }
      current[s] = opt;
      recurse(s + 1, nMin, nMax);
    }
    current[s] = null;
  };

  recurse(0, Infinity, -Infinity);
  results.sort((a, b) => a.cost - b.cost);
  return results.slice(0, k);
}
