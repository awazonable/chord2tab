/**
 * L1 text format (SPEC §4.7). Position-explicit (not column-aligned) because
 * time offsets are rational. Frets are always hyphen-separated, low→high.
 */

import type { SolveResult } from "./solver.js";
import type { Voicing } from "./voicing.js";

/** Render a voicing as `x-3-5-5-4-3` (low→high, x = mute, 0 = open). */
export function renderVoicing(v: Voicing): string {
  return v.map((f) => (f === null ? "x" : String(f))).join("-");
}

export interface FormatOptions {
  meter?: string;
  tuning?: string;
  capo?: number;
}

export function formatL1(result: SolveResult, opts: FormatOptions = {}): string {
  const meter = opts.meter ?? "4/4";
  const tuning = opts.tuning ?? "EADGBE";
  const capo = opts.capo ?? 0;

  const lines: string[] = [`@meter ${meter}`, `@tuning ${tuning}`, `@capo ${capo}`, ""];
  lines.push("# bar:offset   chord         voicing");

  // Map each event index -> the node/voicing that covers it.
  const voicingByEvent = new Map<number, Voicing | null>();
  for (const node of result.nodes) {
    for (const ei of node.eventIndices) voicingByEvent.set(ei, node.voicing);
  }

  result.events.forEach((ev, i) => {
    const pos = `${ev.bar}:${ev.offset.toString()}`.padEnd(13);
    if (ev.kind === "chord") {
      const v = voicingByEvent.get(i);
      const voic = v ? renderVoicing(v) : "(unplayable)";
      lines.push(`${pos} ${ev.chordToken!.padEnd(13)} ${voic}`);
    } else if (ev.kind === "rest") {
      lines.push(`${pos} _`); // rest: all sounding strings damped (§5.5)
    } else {
      lines.push(`${pos} N.C.`);
    }
  });

  if (result.warnings.length) {
    lines.push("");
    for (const w of result.warnings) lines.push(`# warning: ${w}`);
  }

  return lines.join("\n");
}
