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

  it("strikes roll as a downstroke: low string first, staggered by `strum`", () => {
    const strikeTab = buildTab(solve(parse("C")), { pattern: "strike" });
    const strum = 0.02;
    const ev = tabToPlayEvents(strikeTab, { tempo: 100, strum }).filter((e) => e.type === "pluck");
    // The downbeat strike is a group of notes at col 0; recover it by base time.
    const group = ev
      .filter((e) => e.time < strum * 6) // all within the first strum window
      .sort((a, b) => a.time - b.time);
    expect(group.length).toBeGreaterThan(1);
    for (let i = 1; i < group.length; i++) {
      expect(group[i]!.string).toBeGreaterThan(group[i - 1]!.string); // ascending = low→high
      expect(group[i]!.time - group[i - 1]!.time).toBeCloseTo(strum, 9); // even spacing
    }
    expect(group[0]!.time).toBe(0); // first note is exactly on the beat
  });

  it("simultaneous strum can be disabled with strum: 0", () => {
    const strikeTab = buildTab(solve(parse("C")), { pattern: "strike" });
    const ev = tabToPlayEvents(strikeTab, { strum: 0 }).filter((e) => e.type === "pluck");
    const atZero = ev.filter((e) => e.time === 0);
    expect(atZero.length).toBeGreaterThan(1); // all downbeat notes share the instant
  });
});
