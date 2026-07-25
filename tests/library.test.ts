import { describe, it, expect } from "vitest";
import { parse } from "../src/l0/parse.js";
import { parseChord } from "../src/l0_5/chord.js";
import { solve } from "../src/l1/solver.js";
import { renderVoicing } from "../src/l1/format.js";
import { lookupVoicings, signatureOf } from "../src/l1/library.js";
import { OPEN_MIDI, type Voicing } from "../src/l1/voicing.js";
import { selectNotes } from "../src/l1/voicing.js";

const render = (v: Voicing) => renderVoicing(v);
const first = (tok: string) => {
  const v = lookupVoicings(parseChord(tok));
  return v ? render(v[0]!) : null;
};

describe("L1 library — signatures", () => {
  it("computes root-relative interval signatures", () => {
    expect(signatureOf(parseChord("C"))).toBe("0,4,7");
    expect(signatureOf(parseChord("Am"))).toBe("0,3,7");
    expect(signatureOf(parseChord("G7"))).toBe("0,4,7,10");
    expect(signatureOf(parseChord("Cmaj7"))).toBe("0,4,7,11");
    // spelling-independent: C# major and Db major share a signature
    expect(signatureOf(parseChord("C#"))).toBe(signatureOf(parseChord("Db")));
  });
});

describe("L1 library — idiomatic shapes", () => {
  it("returns the standard open shapes", () => {
    expect(first("C")).toBe("x-3-2-0-1-0"); // x32010
    expect(first("Am")).toBe("x-0-2-2-1-0"); // x02210
    expect(first("G7")).toBe("3-2-0-0-0-1"); // 320001, root in bass
    expect(first("Cmaj7")).toBe("x-3-2-0-0-0"); // x32000
    expect(first("Dm7")).toBe("x-x-0-2-1-1"); // xx0211
  });

  it("returns movable barre shapes for chords with no open form", () => {
    expect(first("Cm")).toBe("x-3-5-5-4-3"); // A-shape Cm
    expect(first("Ab")).toBe("4-6-6-5-4-4"); // E-shape Ab
    expect(first("Bb")).toBe("x-1-3-3-3-1"); // A-shape Bb
    expect(first("F")).toBe("1-3-3-2-1-1"); // E-shape F barre
  });

  it("chooses the lower-position movable transposition", () => {
    // Bb: A-shape at fret 1 beats E-shape at fret 6.
    const v = lookupVoicings(parseChord("Bb"))!;
    const maxFret = Math.max(...v[0]!.filter((f): f is number => f !== null));
    expect(maxFret).toBeLessThanOrEqual(3);
  });

  it("does not answer for slash chords (solver must honor the bass)", () => {
    expect(lookupVoicings(parseChord("Fm/Ab"))).toBeNull();
    expect(lookupVoicings(parseChord("C/G"))).toBeNull();
  });

  it("every library voicing actually contains the chord's required notes", () => {
    for (const tok of ["C", "Cm", "Ab", "G7", "Dm7", "Cmaj7", "Bm7b5", "A6", "Dsus4", "F"]) {
      const chord = parseChord(tok);
      const v = lookupVoicings(chord)![0]!;
      const sounded = new Set<number>();
      v.forEach((f, s) => {
        if (f !== null) sounded.add((OPEN_MIDI[s]! + f) % 12);
      });
      for (const req of selectNotes(chord).required) expect(sounded.has(req)).toBe(true);
    }
  });
});

describe("L1 solver — library integration", () => {
  it("uses the library as the primary voicing when available", () => {
    const { nodes } = solve(parse("C | Cm | Ab | G7"));
    expect(nodes.map((n) => n.source)).toEqual(["library", "library", "library", "library"]);
    expect(render(nodes[0]!.voicing!)).toBe("x-3-2-0-1-0");
    expect(render(nodes[1]!.voicing!)).toBe("x-3-5-5-4-3");
  });

  it("falls back to the solver for chords not in the library", () => {
    const { nodes } = solve(parse("C7b9 | Fm/Ab"));
    expect(nodes.map((n) => n.source)).toEqual(["solver", "solver"]);
    for (const n of nodes) expect(n.voicing).not.toBeNull();
  });

  it("still exposes solver alternatives alongside the library pick", () => {
    const { nodes } = solve(parse("C"));
    expect(nodes[0]!.source).toBe("library");
    expect(nodes[0]!.alternates.length).toBeGreaterThan(1);
  });
});
