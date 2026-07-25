import { describe, it, expect } from "vitest";
import { parseChord, pitchClasses, ChordParseError } from "../src/l0_5/chord.js";

/** Sorted pitch-class array for a chord token (root C = 0). */
function pcs(token: string): number[] {
  return [...pitchClasses(parseChord(token))].sort((a, b) => a - b);
}

describe("L0.5 — SPEC §3.4 mandatory test table", () => {
  it("C67 == C7 (the 6th shares the 7th slot; §3.2)", () => {
    expect(pcs("C67")).toEqual(pcs("C7"));
    expect(pcs("C7")).toEqual([0, 4, 7, 10]);
  });

  it("Cdim7 == {0, 3, 6, 9}", () => {
    expect(pcs("Cdim7")).toEqual([0, 3, 6, 9]);
  });

  it("dim7 does not decompose into dim + dominant-7 (bb7 vs b7)", () => {
    // Half-diminished (Cø) is a dim triad with a *minor* 7th = {0,3,6,10};
    // Cdim7 uses a diminished 7th (bb7 = 9). They must differ.
    expect(pcs("Cø")).toEqual([0, 3, 6, 10]);
    expect(pcs("Cdim7")).not.toEqual(pcs("Cø"));
  });

  it("C#5 is C# omit3 = {1, 8} (bare 5 = power chord)", () => {
    expect(pcs("C#5")).toEqual([1, 8]);
  });

  it("C(#5) is C augmented = {0, 4, 8} (parenthesised #5 raises the fifth)", () => {
    expect(pcs("C(#5)")).toEqual([0, 4, 8]);
  });

  it("Cb5 is Cb omit3 = {6, 11} (root longest match)", () => {
    expect(pcs("Cb5")).toEqual([6, 11]);
  });

  it("Comit1 = {4, 7} (root removed)", () => {
    expect(pcs("Comit1")).toEqual([4, 7]);
  });

  it("Csus2dim = {0, 1, 6} — operators applied literally (see deviation #3)", () => {
    // SPEC §3.4 prints {0,2,6}, but that contradicts the §3.3 operator table and
    // §3.2's statement that dim moves the 3rd *further* after sus2.
    // sus2: 3-=2 (-> D=2); dim: 3-=1 (-> Db=1), 5-=1 (-> Gb=6).
    expect(pcs("Csus2dim")).toEqual([0, 1, 6]);
  });
});

describe("L0.5 — modifier semantics", () => {
  it("basic triads", () => {
    expect(pcs("C")).toEqual([0, 4, 7]);
    expect(pcs("Cm")).toEqual([0, 3, 7]);
    expect(pcs("CM")).toEqual([0, 4, 7]); // bare M = major triad (§3.3 exception)
  });

  it("suspensions", () => {
    expect(pcs("Csus4")).toEqual([0, 5, 7]);
    expect(pcs("Csus2")).toEqual([0, 2, 7]);
  });

  it("sevenths and extensions", () => {
    expect(pcs("Cmaj7")).toEqual([0, 4, 7, 11]);
    expect(pcs("CM7")).toEqual([0, 4, 7, 11]);
    expect(pcs("C9")).toEqual([0, 2, 4, 7, 10]); // 9 implies b7
    expect(pcs("Cadd9")).toEqual([0, 2, 4, 7]); // add9 has no 7th
  });

  it("altered tensions in parentheses (b5 == -5, #5 == +5)", () => {
    expect(pcs("Cm7(b5)")).toEqual([0, 3, 6, 10]); // half-diminished
    expect(pcs("Cm7(-5)")).toEqual(pcs("Cm7(b5)"));
    expect(pcs("C7(#9)")).toEqual([0, 3, 4, 7, 10]); // #9 = pc 3
  });

  it("add2/add6 share pitch class with add9/add13 (drop_octave differs)", () => {
    const add2 = parseChord("Cadd2");
    expect([...pitchClasses(add2)].sort((a, b) => a - b)).toEqual([0, 2, 4, 7]);
    expect(add2.drop_octave.has(9)).toBe(true);
    const add6 = parseChord("Cadd6");
    expect(add6.drop_octave.has(13)).toBe(true);
    expect([...pitchClasses(add6)].sort((a, b) => a - b)).toEqual([0, 4, 7, 9]);
  });

  it("parses bare altered tensions without parentheses (m7b5, 7#9)", () => {
    expect(pcs("Bm7b5")).toEqual(pcs("Bm7(b5)"));
    expect(pcs("C7#9")).toEqual(pcs("C7(#9)"));
    expect(pcs("C7b9")).toEqual(pcs("C7(b9)"));
  });

  it("slash bass is parsed but is not part of the slot pitch-class set", () => {
    const c = parseChord("Fm/Ab");
    expect(c.bass_pc).toBe(8); // Ab
    expect(c.root_pc).toBe(5); // F
  });

  it("omit on an absent slot is a no-op; unknown modifier throws", () => {
    expect(pcs("Comit5")).toEqual([0, 4]);
    expect(() => parseChord("Czzz")).toThrow(ChordParseError);
    expect(() => parseChord("Hm7")).toThrow(ChordParseError); // H is not a note
  });
});
