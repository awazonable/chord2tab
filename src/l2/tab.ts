/**
 * L2 — expand an L1 solve + a pattern into tab (SPEC §5).
 *
 * Two independent tracks (§5.1):
 *   - voicing track: a step function time → fingering (from the L1 solve)
 *   - pattern track: a continuous grid of role-plucks that ignores chord changes
 *
 * We scan the pattern grid; at each pluck we look up the active voicing and
 * resolve the role to a real string. Chord changes are quantized to the nearest
 * grid onset (§5.3). Rests damp all ringing strings (§5.5); strings that go
 * sounding→muted across a change get an explicit damp (§5.4).
 */

import { Fraction, frac } from "../fraction.js";
import type { TimedEvent } from "../l0/parse.js";
import type { SolveResult } from "../l1/solver.js";
import type { Voicing } from "../l1/voicing.js";
import { OPEN_MIDI, selectNotes } from "../l1/voicing.js";
import type { Chord } from "../l0_5/chord.js";
import { PATTERNS, resolveRole, type Pattern } from "./patterns.js";

const pcOf = (v: Voicing, s: number): number => ((OPEN_MIDI[s]! + v[s]!) % 12 + 12) % 12;

/**
 * Choose the (up to) four notes the arpeggio plays, by CHORD TONE, not just by
 * string position. Keeps the bass and top strings, and drops octave-duplicate
 * pitch classes first so a chord's characteristic tone (e.g. the 3rd vs a sus4)
 * is always represented — otherwise Esus4 and E would arpeggiate identically.
 * Returns string indices low→high.
 */
export function selectArpStrings(chord: Chord, voicing: Voicing): number[] {
  const s: number[] = [];
  for (let i = 0; i < 6; i++) if (voicing[i] !== null) s.push(i);
  if (s.length <= 4) return s;

  const droppable = selectNotes(chord).droppableByPriority; // pcs, earliest = drop first
  const dropRank = (p: number): number => {
    const i = droppable.indexOf(p);
    return i < 0 ? Infinity : i;
  };

  while (s.length > 4) {
    // 1) prefer removing an interior string whose pitch class is duplicated
    let removeAt = -1;
    for (let i = 1; i < s.length - 1; i++) {
      const p = pcOf(voicing, s[i]!);
      if (s.filter((x) => pcOf(voicing, x) === p).length > 1) {
        removeAt = i;
        break;
      }
    }
    // 2) otherwise remove the most-droppable interior tone (5th first, etc.)
    if (removeAt < 0) {
      let best = Infinity;
      removeAt = 1;
      for (let i = 1; i < s.length - 1; i++) {
        const r = dropRank(pcOf(voicing, s[i]!));
        if (r < best) {
          best = r;
          removeAt = i;
        }
      }
    }
    s.splice(removeAt, 1);
  }
  return s;
}

// --- integer rounding on exact fractions (times are always ≥ 0) ---
const roundHalfDown = (f: Fraction): number => Number((2n * f.num + f.den - 1n) / (2n * f.den));
const ceilInt = (f: Fraction): number => Number((f.num + f.den - 1n) / f.den);

interface Segment {
  gridCol: number;
  kind: "chord" | "rest" | "nc";
  voicing?: Voicing;
  sounding: number[]; // ascending string indices, [] for rest/nc
  four: number[]; // chord-tone-aware arpeggio strings, low→high ([] for rest/nc)
}

export interface PluckEvent {
  col: number;
  stringIdx: number; // 0 = low E
  fret: number;
}
export interface DampEvent {
  col: number;
  strings: number[];
}

export interface TabResult {
  pattern: Pattern;
  totalCols: number;
  colsPerBar: number;
  plucks: PluckEvent[];
  damps: DampEvent[];
  warnings: string[];
}

export interface TabOptions {
  pattern?: string; // key into PATTERNS
}

export function buildTab(solve: SolveResult, opts: TabOptions = {}): TabResult {
  const pattern = PATTERNS[opts.pattern ?? "arp12"] ?? PATTERNS["arp12"]!;
  const div = pattern.div;
  const warnings: string[] = [...solve.warnings];

  // event index -> voicing / sounding / chord
  const voicingByEvent = new Map<number, { voicing: Voicing; sounding: number[]; chord: Chord }>();
  for (const node of solve.nodes) {
    if (!node.voicing || !node.info) continue;
    for (const ei of node.eventIndices) {
      voicingByEvent.set(ei, { voicing: node.voicing, sounding: node.info.sounding, chord: node.chord });
    }
  }

  // Build quantized segments and find the end of the piece.
  const segments: Segment[] = [];
  let maxEnd = Fraction.ZERO;
  solve.events.forEach((ev: TimedEvent, i) => {
    const start = frac(ev.bar - 1).add(ev.offset);
    const end = start.add(ev.duration);
    if (maxEnd.lt(end)) maxEnd = end;

    const gridCol = roundHalfDown(start.div(div));
    const shift = start.sub(div.mul(frac(gridCol)));
    if (!shift.isZero()) {
      warnings.push(
        `quantize: ${ev.kind === "chord" ? ev.chordToken : ev.kind} at ${ev.bar}:${ev.offset} ` +
          `shifted by ${shift.num < 0n ? "-" : ""}${new Fraction(shift.num < 0n ? -shift.num : shift.num, shift.den)} to the grid`,
    );
    }

    if (ev.kind === "chord") {
      const v = voicingByEvent.get(i);
      if (v) {
        segments.push({
          gridCol,
          kind: "chord",
          voicing: v.voicing,
          sounding: v.sounding,
          four: selectArpStrings(v.chord, v.voicing),
        });
      }
    } else {
      segments.push({ gridCol, kind: ev.kind, sounding: [], four: [] });
    }
  });
  segments.sort((a, b) => a.gridCol - b.gridCol);

  const cpb = frac(1).div(div);
  if (cpb.den !== 1n) throw new Error(`pattern div ${div} does not divide a bar evenly`);
  const colsPerBar = Number(cpb.num);
  const totalCols = Math.max(colsPerBar, ceilInt(maxEnd) * colsPerBar);

  const activeAt = (col: number): Segment | null => {
    let seg: Segment | null = null;
    for (const s of segments) {
      if (s.gridCol <= col) seg = s;
      else break;
    }
    return seg;
  };

  // Columns where a chord change lands (for chordStrike patterns).
  const changeCols = new Set(segments.filter((s) => s.kind === "chord").map((s) => s.gridCol));

  // --- plucks ---
  const plucks: PluckEvent[] = [];
  let bstar = 0;
  for (let k = 0; k < totalCols; k++) {
    const seg = activeAt(k);
    if (!seg || seg.kind !== "chord" || !seg.voicing) continue;

    // chordStrike: on a bar start or a chord change, strike all four selected
    // notes together instead of the single arpeggio note (§ user request).
    if (pattern.chordStrike && (k % colsPerBar === 0 || changeCols.has(k))) {
      for (const s of seg.four) plucks.push({ col: k, stringIdx: s, fret: seg.voicing[s]! });
      continue;
    }

    const role = pattern.steps[k % pattern.steps.length]!;
    if (role === "-") continue;

    // Roles resolve against the four chord-tone-aware notes, not raw strings.
    const s = resolveRole(role, seg.four, bstar);
    if (role === "B*") bstar++;
    if (s === null) continue;
    const fret = seg.voicing[s];
    if (fret === null || fret === undefined) continue;
    plucks.push({ col: k, stringIdx: s, fret });
  }

  // --- damps (§5.4, §5.5): rest onsets damp the previous chord; on a chord
  //     change, strings that were ringing but are now muted get damped. ---
  const damps: DampEvent[] = [];
  let prevSounding = new Set<number>();
  for (const seg of segments) {
    if (seg.kind === "chord") {
      const now = new Set(seg.sounding);
      const gone = [...prevSounding].filter((s) => !now.has(s));
      if (gone.length) damps.push({ col: seg.gridCol, strings: gone.sort((a, b) => a - b) });
      prevSounding = now;
    } else {
      // rest / N.C. — damp everything currently ringing
      if (prevSounding.size) damps.push({ col: seg.gridCol, strings: [...prevSounding].sort((a, b) => a - b) });
      prevSounding = new Set();
    }
  }

  return { pattern, totalCols, colsPerBar, plucks, damps, warnings };
}

// ---------------------------------------------------------------------------
// ASCII tab rendering (§5.7)
// ---------------------------------------------------------------------------

const STRING_LABELS = ["E", "A", "D", "G", "B", "e"]; // by index 0..5 (low→high)

function cell(v: number | "X" | null): string {
  if (v === null) return "--";
  if (v === "X") return "-X";
  const s = String(v);
  return s.length === 1 ? `-${s}` : s; // right-align in 2 chars
}

export function renderTab(tab: TabResult): string {
  // grid[stringIdx][col]
  const grid: (number | "X" | null)[][] = Array.from({ length: 6 }, () =>
    new Array<number | "X" | null>(tab.totalCols).fill(null),
  );
  for (const d of tab.damps) for (const s of d.strings) grid[s]![d.col] = "X";
  for (const p of tab.plucks) grid[p.stringIdx]![p.col] = p.fret; // pluck wins over damp

  const lines: string[] = [
    `@meter ${tab.pattern.meter ?? "4/4"}`,
    `@tuning EADGBE`,
    `@pattern ${tab.pattern.name} div=${tab.pattern.div}`,
    `@section bars=1-${Math.ceil(tab.totalCols / tab.colsPerBar)} div=${tab.pattern.div}`,
    ``,
  ];

  // display high e (idx 5) at top → low E (idx 0) at bottom
  for (let idx = 5; idx >= 0; idx--) {
    const bars: string[] = [];
    for (let c = 0; c < tab.totalCols; c += tab.colsPerBar) {
      let bar = "";
      for (let j = c; j < c + tab.colsPerBar && j < tab.totalCols; j++) bar += cell(grid[idx]![j]!);
      bars.push(bar);
    }
    lines.push(`${STRING_LABELS[idx]}|${bars.join("|")}|`);
  }

  if (tab.warnings.length) {
    lines.push("");
    for (const w of tab.warnings) lines.push(`# ${w}`);
  }
  return lines.join("\n");
}

/** MIDI pitches a pluck sounds (for future audio); string monophonic (§5.6). */
export function pluckMidi(p: PluckEvent): number {
  return OPEN_MIDI[p.stringIdx]! + p.fret;
}
