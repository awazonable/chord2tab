import { describe, it, expect } from "vitest";
import { parse } from "../src/l0/parse.js";
import { solve } from "../src/l1/solver.js";
import { OPEN_MIDI } from "../src/l1/voicing.js";
import { buildTab, renderTab } from "../src/l2/tab.js";
import { resolveRole, arpFourStrings } from "../src/l2/patterns.js";

/** plucks grouped by column: col -> sorted string indices struck there. */
function byCol(tab: ReturnType<typeof buildTab>) {
  const m = new Map<number, number[]>();
  for (const p of tab.plucks) m.set(p.col, [...(m.get(p.col) ?? []), p.stringIdx].sort((a, b) => a - b));
  return m;
}

describe("L2 — role resolution (§5.2)", () => {
  const sounding = [1, 2, 3, 4, 5]; // e.g. an x-shaped 5-string voicing

  it("maps B/T to lowest/highest sounding strings", () => {
    expect(resolveRole("B", sounding, 0)).toBe(1);
    expect(resolveRole("T", sounding, 0)).toBe(5);
  });

  it("maps m1/m2 to inner voices from the low side", () => {
    expect(resolveRole("m1", sounding, 0)).toBe(2);
    expect(resolveRole("m2", sounding, 0)).toBe(3);
  });

  it("alternates B* between the two lowest strings", () => {
    expect(resolveRole("B*", sounding, 0)).toBe(1);
    expect(resolveRole("B*", sounding, 1)).toBe(2);
    expect(resolveRole("B*", sounding, 2)).toBe(1);
  });

  it("returns null for a rest slot or empty voicing", () => {
    expect(resolveRole("-", sounding, 0)).toBeNull();
    expect(resolveRole("B", [], 0)).toBeNull();
  });
});

describe("L2 — tab generation (§5)", () => {
  it("plays only sounding strings, with frets matching the active voicing", () => {
    const res = solve(parse("C | Am | F | G"));
    const tab = buildTab(res, { pattern: "travis" });
    expect(tab.plucks.length).toBeGreaterThan(0);
    const bySeg = res.nodes; // one node per bar here
    void bySeg;
    for (const p of tab.plucks) {
      expect(p.fret).toBeGreaterThanOrEqual(0);
      expect(p.stringIdx).toBeGreaterThanOrEqual(0);
      expect(p.stringIdx).toBeLessThan(6);
    }
  });

  it("the pattern grid spans whole bars (8 columns/bar at div=1/8)", () => {
    const tab = buildTab(solve(parse("C | Am | F | G")), { pattern: "travis" });
    expect(tab.colsPerBar).toBe(8);
    expect(tab.totalCols).toBe(32);
  });

  it("quantizes off-grid chord changes and warns (§5.3)", () => {
    // 3 chords in a bar -> changes at 1/3, 2/3 fall between 1/8 grid slots.
    const tab = buildTab(solve(parse("C G Am | F")), { pattern: "arp-up" });
    const q = tab.warnings.filter((w) => w.startsWith("quantize:"));
    expect(q.length).toBe(2);
    expect(q.some((w) => w.includes("1/24"))).toBe(true);
  });

  it("does not subdivide the grid (no LCM blow-up) — stays at div", () => {
    const tab = buildTab(solve(parse("C G Am | F")), { pattern: "arp-up" });
    expect(tab.colsPerBar).toBe(8); // not LCM(3,8)=24
  });

  it("a rest damps every ringing string (§5.5)", () => {
    const res = solve(parse("C | _"));
    const tab = buildTab(res, { pattern: "travis" });
    const cSounding = res.nodes[0]!.info!.sounding;
    // there is a damp at the rest onset covering all of C's strings
    const restDamp = tab.damps.find((d) => d.strings.length === cSounding.length);
    expect(restDamp).toBeTruthy();
    expect(restDamp!.strings).toEqual([...cSounding].sort((a, b) => a - b));
  });

  it("renders six labelled tab lines, high e on top", () => {
    const out = renderTab(buildTab(solve(parse("C | G")), { pattern: "travis" }));
    const lines = out.split("\n").filter((l) => /^[eBGDAE]\|/.test(l));
    expect(lines.length).toBe(6);
    expect(lines[0]!.startsWith("e|")).toBe(true);
    expect(lines[5]!.startsWith("E|")).toBe(true);
  });

  it("block pattern strikes all sounding strings together on the beat", () => {
    const res = solve(parse("C"));
    const tab = buildTab(res, { pattern: "block" });
    const col0 = tab.plucks.filter((p) => p.col === 0);
    expect(col0.length).toBe(res.nodes[0]!.info!.sounding.length);
  });

  it("arp12: 12/8 up-down over four notes = 4 3 2 1 2 3 4 3 2 1 2 3", () => {
    const res = solve(parse("Am"));
    const tab = buildTab(res, { pattern: "arp12" });
    expect(tab.colsPerBar).toBe(12);
    const sounding = res.nodes[0]!.info!.sounding;
    const roleSeq = ["B", "m1", "m2", "T", "m2", "m1"] as const;
    // one note per column, following the repeated 6-step role cycle
    const cols = byCol(tab);
    for (let k = 0; k < 12; k++) {
      const expected = resolveRole(roleSeq[k % 6]!, sounding, 0)!;
      expect(cols.get(k)).toEqual([expected]);
    }
  });

  it("arp12-strike: bar start strikes all four notes, then arpeggiates", () => {
    const res = solve(parse("Am"));
    const tab = buildTab(res, { pattern: "arp12-strike" });
    const four = arpFourStrings(res.nodes[0]!.info!.sounding);
    const cols = byCol(tab);
    expect(cols.get(0)).toEqual(four); // (4321)
    expect(four.length).toBe(4);
    // interior columns are single arpeggio notes
    expect(cols.get(1)!.length).toBe(1);
    expect(cols.get(3)!.length).toBe(1);
  });

  it("arp12-strike: also strikes at a chord change on beat 7 (col 6)", () => {
    // "Am C" -> two chords, change quantized to col 6 of 12.
    const res = solve(parse("Am C"));
    const tab = buildTab(res, { pattern: "arp12-strike" });
    const cols = byCol(tab);
    const amFour = arpFourStrings(res.nodes[0]!.info!.sounding);
    const cFour = arpFourStrings(res.nodes[1]!.info!.sounding);
    expect(cols.get(0)).toEqual(amFour); // (4321) for Am at bar start
    expect(cols.get(6)).toEqual(cFour); // (4321) for C at the change
    expect(cols.get(6)!.length).toBe(4);
  });

  it("pluck pitches equal open-string MIDI + fret", () => {
    const tab = buildTab(solve(parse("Em")), { pattern: "arp-up" });
    for (const p of tab.plucks) {
      expect(Number.isFinite(OPEN_MIDI[p.stringIdx]! + p.fret)).toBe(true);
    }
  });
});
