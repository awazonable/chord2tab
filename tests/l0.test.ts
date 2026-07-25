import { describe, it, expect } from "vitest";
import { parse, tokenizeBar, ParseError } from "../src/l0/parse.js";

/** Compact, comparable representation of an event list. */
function shape(input: string) {
  return parse(input).events.map((e) => ({
    bar: e.bar,
    offset: e.offset.toString(),
    duration: e.duration.toString(),
    kind: e.kind,
    token: e.chordToken,
  }));
}

describe("L0 — SPEC §2.5 mandatory test table", () => {
  it("A / A= / A=== are all identical (A fills the whole bar)", () => {
    const a = shape("A");
    expect(a).toEqual([{ bar: 1, offset: "0", duration: "1", kind: "chord", token: "A" }]);
    expect(shape("A=")).toEqual(a);
    expect(shape("A===")).toEqual(a);
  });

  it("AG / A==G / AG== are all different", () => {
    const ag = shape("AG");
    const a2g = shape("A==G");
    const ag2 = shape("AG==");
    expect(ag).not.toEqual(a2g);
    expect(ag).not.toEqual(ag2);
    expect(a2g).not.toEqual(ag2);

    expect(ag.map((e) => e.duration)).toEqual(["1/2", "1/2"]);
    expect(a2g.map((e) => e.duration)).toEqual(["3/4", "1/4"]);
    expect(ag2.map((e) => e.duration)).toEqual(["1/4", "3/4"]);
  });

  it("A=G gives A: 2/3, G: 1/3 (exact rational)", () => {
    expect(shape("A=G")).toEqual([
      { bar: 1, offset: "0", duration: "2/3", kind: "chord", token: "A" },
      { bar: 1, offset: "2/3", duration: "1/3", kind: "chord", token: "G" },
    ]);
  });

  it("_A gives rest 1/2 then A 1/2", () => {
    expect(shape("_A")).toEqual([
      { bar: 1, offset: "0", duration: "1/2", kind: "rest", token: undefined },
      { bar: 1, offset: "1/2", duration: "1/2", kind: "chord", token: "A" },
    ]);
  });

  it("A=|=G ties A across the bar line for 1 + 1/2 bars", () => {
    const ev = shape("A=|=G");
    expect(ev).toEqual([
      { bar: 1, offset: "0", duration: "3/2", kind: "chord", token: "A" },
      { bar: 2, offset: "1/2", duration: "1/2", kind: "chord", token: "G" },
    ]);
  });

  it("=A is a parse error (tie with no preceding chord)", () => {
    expect(() => parse("=A")).toThrow(ParseError);
  });
});

describe("L0 — tokenization & structure", () => {
  it("segments consecutive chords by upper-case note letters", () => {
    expect(tokenizeBar("CGAmF")).toEqual(["C", "G", "Am", "F"]);
    expect(tokenizeBar("F#m7 Bb Csus4")).toEqual(["F#m7", "Bb", "Csus4"]);
  });

  it("keeps /bass attached to its chord", () => {
    expect(tokenizeBar("Fm/Ab C/G")).toEqual(["Fm/Ab", "C/G"]);
  });

  it("recognises markers and N.C.", () => {
    expect(tokenizeBar("A = _ N.C.")).toEqual(["A", "=", "_", "N.C."]);
  });

  it("expands % to the previous bar", () => {
    const { bars } = parse("Am F | %");
    expect(bars).toEqual([
      ["Am", "F"],
      ["Am", "F"],
    ]);
  });

  it("rejects % that is not the sole token of a bar", () => {
    expect(() => parse("Am | A%")).toThrow(ParseError);
  });

  it("rejects % in the first bar", () => {
    expect(() => parse("%")).toThrow(ParseError);
  });
});

describe("L0 — normalization", () => {
  it("strips trailing comments but keeps sharps glued to notes", () => {
    expect(shape("C#m7 # this is a comment")).toEqual([
      { bar: 1, offset: "0", duration: "1", kind: "chord", token: "C#m7" },
    ]);
  });

  it("treats a full-line # as a comment", () => {
    // The comment line becomes an empty bar and is dropped; only Am remains.
    expect(shape("# intro\nAm")).toEqual([
      { bar: 1, offset: "0", duration: "1", kind: "chord", token: "Am" },
    ]);
  });

  it("normalizes full-width and musical symbols", () => {
    // Ｃ♯ (full-width C + music sharp) -> C#
    expect(shape("Ｃ♯")).toEqual([
      { bar: 1, offset: "0", duration: "1", kind: "chord", token: "C#" },
    ]);
  });
});
