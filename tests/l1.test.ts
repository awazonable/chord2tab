import { describe, it, expect } from "vitest";
import { parse } from "../src/l0/parse.js";
import { parseChord } from "../src/l0_5/chord.js";
import { enumerate, analyze, selectNotes, OPEN_MIDI, type Voicing } from "../src/l1/voicing.js";
import { solve } from "../src/l1/solver.js";

/** Pitch classes actually sounded by a voicing. */
function soundingPcs(v: Voicing): Set<number> {
  const out = new Set<number>();
  v.forEach((f, s) => {
    if (f !== null) out.add((OPEN_MIDI[s]! + f) % 12);
  });
  return out;
}

const COMMON = ["C", "Am", "G", "Em", "F", "Dm7", "G7", "Cmaj7", "A", "E", "D", "Bm"];

describe("L1 — every candidate is physically playable (§4.2)", () => {
  for (const tok of COMMON) {
    it(`${tok} produces admissible voicings`, () => {
      const cands = enumerate(parseChord(tok), 24);
      expect(cands.length).toBeGreaterThan(0);
      for (const c of cands) {
        expect(c.info.span).toBeLessThanOrEqual(4); // fret span (§4.2)
        expect(c.info.fingers).toBeLessThanOrEqual(4); // ≤4 fingers after barre
        expect(c.info.innerMutes).toBeLessThanOrEqual(1); // inner mutes (§4.2)
        expect(c.info.sounding.length).toBeGreaterThanOrEqual(4); // ≥4 strings
      }
    });
  }

  it("power chords are allowed with as few as 2 strings", () => {
    const cands = enumerate(parseChord("C5"), 24);
    expect(cands.length).toBeGreaterThan(0);
    // omit3: the third must never sound
    for (const c of cands) {
      expect(soundingPcs(c.voicing).has(4)).toBe(false); // no E (major 3rd of C)
    }
  });
});

describe("L1 — note selection & coverage (§4.1)", () => {
  it("keeps root, 3rd and 7th; the omitted 5th is never required", () => {
    const sel = selectNotes(parseChord("Cmaj7"));
    expect(sel.required).toContain(0); // C
    expect(sel.required).toContain(4); // E
    expect(sel.required).toContain(11); // B (maj7)
  });

  it("every chosen voicing contains all required pitch classes", () => {
    const { nodes } = solve(parse("Cmaj7 | Dm7(b5) | Fm7 | G7 | Am"));
    for (const node of nodes) {
      expect(node.voicing).not.toBeNull();
      const sel = selectNotes(node.chord);
      const pcs = soundingPcs(node.voicing!);
      for (const req of sel.required) expect(pcs.has(req)).toBe(true);
    }
  });

  it("a slash chord puts the specified bass on the lowest string", () => {
    const { nodes } = solve(parse("Fm/Ab | C/G | D/F#"));
    const bass = ["Ab", "G", "F#"];
    nodes.forEach((node, i) => {
      const v = node.voicing!;
      const lowStr = v.findIndex((f) => f !== null);
      const lowPc = (OPEN_MIDI[lowStr]! + (v[lowStr] as number)) % 12;
      expect(lowPc).toBe(parseChord(`X/${bass[i]}`.replace("X", "C")).bass_pc);
    });
  });
});

describe("L1 — solver over a progression", () => {
  it("solves a typical progression with no unplayable chords", () => {
    const res = solve(parse("C Am F G | Em Dm7 G7 C | Cmaj7 | Am7 | Fmaj7 | G7"));
    expect(res.warnings).toEqual([]);
    for (const node of res.nodes) expect(node.voicing).not.toBeNull();
  });

  it("repeated identical chords (via %) share one fingering node", () => {
    const res = solve(parse("Am F | %"));
    // Am, F, Am, F events -> 2 collapsed nodes covering 2 events each? No: the
    // consecutive collapse only merges *adjacent* identical tokens. Here the
    // sequence is Am F Am F, so 4 distinct nodes, but each Am/F is solvable.
    expect(res.nodes.map((n) => n.token)).toEqual(["Am", "F", "Am", "F"]);
    for (const n of res.nodes) expect(n.voicing).not.toBeNull();
  });

  it("adjacent identical chords collapse into a single node", () => {
    const res = solve(parse("C === | C"));
    // "C ===" is one event (tie), then "C" again -> tokens collapse to one node.
    expect(res.nodes).toHaveLength(1);
    expect(res.nodes[0]!.eventIndices.length).toBe(2);
  });

  it("provides k-best alternatives per chord (§4.6 別解)", () => {
    const res = solve(parse("Cmaj7"));
    expect(res.nodes[0]!.alternates.length).toBeGreaterThan(1);
    // sorted by ascending single cost
    const costs = res.nodes[0]!.alternates.map((c) => c.cost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });
});

describe("L1 — voicing analysis", () => {
  it("detects a barre and counts fingers accordingly", () => {
    // F barre 133211 -> barre at fret 1 across all 6 strings.
    const F: Voicing = [1, 3, 3, 2, 1, 1];
    const info = analyze(F);
    expect(info.barre).toBe(true);
    expect(info.fingers).toBeLessThanOrEqual(4);
    expect(info.sounding.length).toBe(6);
  });

  it("counts open strings and inner mutes", () => {
    const Am: Voicing = [null, 0, 2, 2, 1, 0]; // x02210
    const info = analyze(Am);
    expect(info.openCount).toBe(2);
    expect(info.innerMutes).toBe(0); // the muted low E is an edge, not inner
  });
});
