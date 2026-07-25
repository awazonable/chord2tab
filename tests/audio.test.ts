import { describe, it, expect } from "vitest";
import { parse } from "../src/l0/parse.js";
import { solve } from "../src/l1/solver.js";
import { buildTab } from "../src/l2/tab.js";
import { tabToPlayEvents, tabDurationSec, mtof } from "../src/audio/synth.js";

describe("audio — pitch conversion", () => {
  it("mtof maps MIDI to frequency (A4 = 440)", () => {
    expect(mtof(69)).toBeCloseTo(440, 6);
    expect(mtof(57)).toBeCloseTo(220, 6); // A3
    expect(mtof(81)).toBeCloseTo(880, 6); // A5
  });
});

describe("audio — tab → play events", () => {
  const tab = buildTab(solve(parse("C | Am | F | G")), { pattern: "arp-up" });

  it("emits a pluck per tab pluck and a damp per damped string", () => {
    const ev = tabToPlayEvents(tab, { tempo: 120 });
    const plucks = ev.filter((e) => e.type === "pluck");
    const damps = ev.filter((e) => e.type === "damp");
    expect(plucks.length).toBe(tab.plucks.length);
    expect(damps.length).toBe(tab.damps.reduce((a, d) => a + d.strings.length, 0));
  });

  it("schedules columns at div * secondsPerBar and stays sorted", () => {
    const ev = tabToPlayEvents(tab, { tempo: 120, beatsPerBar: 4 });
    // 120 BPM, 4/4 -> 2s per bar; div 1/8 -> 0.25s per column.
    const firstPluck = ev.find((e) => e.type === "pluck")!;
    expect(firstPluck.time % 0.25).toBeCloseTo(0, 9);
    for (let i = 1; i < ev.length; i++) expect(ev[i]!.time).toBeGreaterThanOrEqual(ev[i - 1]!.time);
  });

  it("total duration = columns * seconds-per-column", () => {
    expect(tabDurationSec(tab, { tempo: 120 })).toBeCloseTo(tab.totalCols * 0.25, 9);
  });

  it("pluck frequencies are positive and finite", () => {
    for (const e of tabToPlayEvents(tab)) {
      if (e.type === "pluck") expect(e.freq! > 0 && Number.isFinite(e.freq!)).toBe(true);
    }
  });
});
