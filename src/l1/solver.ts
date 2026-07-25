/**
 * L1 — voicing solver: k-best enumeration per chord + Viterbi DP over the
 * progression using transition cost. (SPEC §4.5–§4.6)
 */

import type { ParsedPiece, TimedEvent } from "../l0/parse.js";
import { parseChord, type Chord } from "../l0_5/chord.js";
import {
  enumerate,
  analyze,
  singleCost,
  selectNotes,
  DEFAULT_FILTERS,
  type Candidate,
  type Voicing,
  type VoicingInfo,
  type Filters,
} from "./voicing.js";
import { lookupVoicings } from "./library.js";

const TW = {
  centroid: 0.3, // left-hand centroid movement (§4.5)
  keepFretBonus: -0.45, // same string+fret held
  openContBonus: -0.2, // open string kept open
  soundSetDiff: 0.2, // change in the set of sounding strings
  topLeap: 0.15, // top-note jump in semitones
};

function centroid(info: VoicingInfo): number {
  if (!info.pressed.length) return 0;
  return info.pressed.reduce((a, p) => a + p.f, 0) / info.pressed.length;
}

/** Transition cost from one voicing to the next (§4.5). */
export function transitionCost(a: Candidate, b: Candidate): number {
  let cost = 0;
  cost += TW.centroid * Math.abs(centroid(a.info) - centroid(b.info));

  for (let s = 0; s < 6; s++) {
    const fa = a.voicing[s];
    const fb = b.voicing[s];
    if (fa !== null && fb !== null && fa === fb) {
      cost += fa === 0 ? TW.openContBonus : TW.keepFretBonus;
    }
  }

  const setA = new Set(a.info.sounding);
  const setB = new Set(b.info.sounding);
  let diff = 0;
  for (const s of setA) if (!setB.has(s)) diff++;
  for (const s of setB) if (!setA.has(s)) diff++;
  cost += TW.soundSetDiff * diff;

  cost += TW.topLeap * Math.abs(a.info.topMidi - b.info.topMidi);
  return cost;
}

export interface NodeResult {
  token: string;
  chord: Chord;
  /** Chosen voicing (best path), or null if unsolvable. */
  voicing: Voicing | null;
  info: VoicingInfo | null;
  /** Ranked alternatives (k-best single-chord candidates) — for "別解" (§4.6). */
  alternates: Candidate[];
  /** Where the DP candidates came from. */
  source: "library" | "solver";
  eventIndices: number[]; // events (in the original list) this node covers
}

export interface SolveResult {
  events: TimedEvent[];
  nodes: NodeResult[];
  warnings: string[];
}

/** Wrap a raw voicing as a scored Candidate for a given chord. */
function toCandidate(voicing: Voicing, chord: Chord): Candidate {
  const info = analyze(voicing);
  const cost = singleCost(voicing, info, selectNotes(chord));
  return { voicing, info, cost };
}

/** Enumerate candidates for a chord, relaxing filters if nothing is playable. */
function solverCandidates(chord: Chord, k: number): { cands: Candidate[]; warning?: string } {
  let cands = enumerate(chord, k, DEFAULT_FILTERS);
  if (cands.length) return { cands };

  // Relaxation ladder: widen the hand, then allow a thinner voicing.
  const ladder: Filters[] = [
    { maxSpan: 5, maxFingers: 4, maxInnerMutes: 1 },
    { maxSpan: 5, maxFingers: 4, maxInnerMutes: 2 },
    { maxSpan: 6, maxFingers: 4, maxInnerMutes: 2 },
  ];
  for (const f of ladder) {
    cands = enumerate(chord, k, f);
    if (cands.length) return { cands, warning: `relaxed filters (span≤${f.maxSpan}) to voice this chord` };
  }
  return { cands: [] };
}

/**
 * Candidates for one chord. If the library has an idiomatic shape, those become
 * the DP candidates (the "standard answer" wins); solver candidates are still
 * appended as alternates. Otherwise the solver drives.
 */
function candidatesFor(
  chord: Chord,
  k: number,
): { dp: Candidate[]; alternates: Candidate[]; source: "library" | "solver"; warning?: string } {
  const lib = lookupVoicings(chord);
  const solver = solverCandidates(chord, k);
  for (const c of solver.cands) c.origin = "solver";

  if (lib && lib.length) {
    const dp = lib.map((v) => {
      const c = toCandidate(v, chord);
      c.origin = "library";
      return c;
    });
    const seen = new Set(dp.map((c) => c.voicing.join(",")));
    const extra = solver.cands.filter((c) => !seen.has(c.voicing.join(",")));
    return { dp, alternates: [...dp, ...extra], source: "library" };
  }
  return { dp: solver.cands, alternates: solver.cands, source: "solver", ...(solver.warning ? { warning: solver.warning } : {}) };
}

export interface SolveOptions {
  k?: number; // candidates kept per chord (§4.6: 20–40)
}

export function solve(piece: ParsedPiece, opts: SolveOptions = {}): SolveResult {
  const k = opts.k ?? 24;
  const warnings: string[] = [];
  const chordCache = new Map<string, Chord>();

  // Build DP nodes, collapsing consecutive identical chord tokens so that ties
  // and `%` repeats inherit the same fingering (§4.6 pin).
  const nodes: NodeResult[] = [];
  piece.events.forEach((ev, i) => {
    if (ev.kind !== "chord") return;
    const token = ev.chordToken!;
    const last = nodes[nodes.length - 1];
    if (last && last.token === token) {
      last.eventIndices.push(i);
      return;
    }
    let chord = chordCache.get(token);
    if (!chord) {
      try {
        chord = parseChord(token);
      } catch (e) {
        warnings.push(`${ev.bar}:${ev.offset}: cannot parse chord "${token}" (${(e as Error).message})`);
        return;
      }
      chordCache.set(token, chord);
    }
    nodes.push({ token, chord, voicing: null, info: null, alternates: [], source: "solver", eventIndices: [i] });
  });

  // Per-node candidate lists (library-first, solver fallback).
  const candLists: Candidate[][] = [];
  for (const node of nodes) {
    const { dp, alternates, source, warning } = candidatesFor(node.chord, k);
    node.alternates = alternates;
    node.source = source;
    if (warning) warnings.push(`${node.token}: ${warning}`);
    if (!dp.length) warnings.push(`${node.token}: no playable voicing found`);
    candLists.push(dp);
  }

  // Viterbi DP over nodes that have at least one candidate.
  const solvable = nodes.map((_, i) => candLists[i]!.length > 0);
  let prevCosts: number[] = [];
  let prevIdx = -1;
  const back: number[][] = []; // back[node][j] = chosen index in previous solvable node

  for (let n = 0; n < nodes.length; n++) {
    if (!solvable[n]) {
      back.push([]);
      continue;
    }
    const cands = candLists[n]!;
    const costs = new Array(cands.length).fill(0);
    const bp = new Array(cands.length).fill(-1);
    if (prevIdx < 0) {
      for (let j = 0; j < cands.length; j++) costs[j] = cands[j]!.cost;
    } else {
      const prev = candLists[prevIdx]!;
      for (let j = 0; j < cands.length; j++) {
        let best = Infinity;
        let bestI = -1;
        for (let i = 0; i < prev.length; i++) {
          const c = prevCosts[i]! + transitionCost(prev[i]!, cands[j]!);
          if (c < best) {
            best = c;
            bestI = i;
          }
        }
        costs[j] = best + cands[j]!.cost;
        bp[j] = bestI;
      }
    }
    back.push(bp);
    prevCosts = costs;
    prevIdx = n;
  }

  // Backtrack.
  if (prevIdx >= 0) {
    let j = prevCosts.reduce((bi, c, i, arr) => (c < arr[bi]! ? i : bi), 0);
    for (let n = prevIdx; n >= 0; n--) {
      if (!solvable[n]) continue;
      const cand = candLists[n]![j]!;
      nodes[n]!.voicing = cand.voicing;
      nodes[n]!.info = cand.info;
      const bp = back[n]![j];
      if (bp !== undefined && bp >= 0) j = bp;
    }
  }

  return { events: piece.events, nodes, warnings };
}

/** Re-analyze a raw voicing (used when a fingering is supplied by hand). */
export function infoOf(v: Voicing): VoicingInfo {
  return analyze(v);
}
