/**
 * L→audio bridge (SPEC §6). Converts an L2 tab into scheduled pluck/damp events
 * and plays them through the Karplus-Strong AudioWorklet.
 *
 * `tabToPlayEvents` is pure (unit-tested); `GuitarSynth` needs a browser
 * AudioContext and is only exercised in the page.
 */
import { OPEN_MIDI, type Voicing } from "../l1/voicing.js";
import type { TabResult } from "../l2/tab.js";
import { KS_WORKLET } from "./ks-worklet.js";

export const mtof = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export interface PlayEvent {
  time: number; // seconds from start
  type: "pluck" | "damp";
  string: number; // 0 = low E
  freq?: number;
  vel?: number;
  bright?: number;
}

export interface PlayOptions {
  tempo?: number; // BPM
  beatsPerBar?: number; // meter numerator
}

/** Turn an L2 tab into time-stamped audio events. Pure. */
export function tabToPlayEvents(tab: TabResult, opts: PlayOptions = {}): PlayEvent[] {
  const tempo = opts.tempo ?? 100;
  const beatsPerBar = opts.beatsPerBar ?? 4;
  const secPerBar = (beatsPerBar * 60) / tempo;
  const secPerCol = tab.pattern.div.toNumber() * secPerBar;

  const events: PlayEvent[] = [];
  for (const p of tab.plucks) {
    events.push({
      time: p.col * secPerCol,
      type: "pluck",
      string: p.stringIdx,
      freq: mtof(OPEN_MIDI[p.stringIdx]! + p.fret),
      vel: 0.85,
      // higher strings a touch brighter
      bright: 0.4 + (p.stringIdx / 5) * 0.35,
    });
  }
  for (const d of tab.damps) {
    for (const s of d.strings) events.push({ time: d.col * secPerCol, type: "damp", string: s });
  }
  events.sort((a, b) => a.time - b.time || (a.type === "damp" ? -1 : 1));
  return events;
}

/** Total duration of the tab in seconds (for UI / stop timing). */
export function tabDurationSec(tab: TabResult, opts: PlayOptions = {}): number {
  const tempo = opts.tempo ?? 100;
  const beatsPerBar = opts.beatsPerBar ?? 4;
  const secPerCol = tab.pattern.div.toNumber() * ((beatsPerBar * 60) / tempo);
  return tab.totalCols * secPerCol;
}

export class GuitarSynth {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  private async init(): Promise<void> {
    if (this.ctx) return;
    const ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([KS_WORKLET], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(ctx, "karplus-strong", { outputChannelCount: [2] });
    node.connect(ctx.destination);
    this.ctx = ctx;
    this.node = node;
  }

  /** Schedule and play the events. Resolves immediately after scheduling. */
  async play(events: PlayEvent[]): Promise<void> {
    await this.init();
    await this.ctx!.resume();
    this.stop();
    for (const e of events) {
      const id = setTimeout(() => {
        this.node!.port.postMessage(
          e.type === "pluck"
            ? { type: "pluck", string: e.string, freq: e.freq, vel: e.vel, bright: e.bright }
            : { type: "damp", string: e.string },
        );
      }, Math.max(0, e.time * 1000));
      this.timers.push(id);
    }
  }

  stop(): void {
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    this.node?.port.postMessage({ type: "dampAll" });
  }
}

/** Convenience for chord auditioning: strum a single voicing (no pattern). */
export function strumEvents(voicing: Voicing, opts: { spread?: number } = {}): PlayEvent[] {
  const spread = opts.spread ?? 0.03; // seconds between adjacent strings
  const events: PlayEvent[] = [];
  let k = 0;
  voicing.forEach((f, s) => {
    if (f === null) return;
    events.push({
      time: k * spread,
      type: "pluck",
      string: s,
      freq: mtof(OPEN_MIDI[s]! + f),
      vel: 0.85,
      bright: 0.4 + (s / 5) * 0.35,
    });
    k++;
  });
  return events;
}
