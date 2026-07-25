/**
 * L2 patterns (SPEC §5.2). Patterns are written with *roles*, not absolute
 * string numbers, because the set of ringing strings changes with the voicing.
 *
 *   B   lowest sounding string
 *   B*  alternating bass (toggles low ↔ second-lowest each time it fires)
 *   m1  inner voice, low side
 *   m2  inner voice, next
 *   T   highest sounding string
 *   -   grid slot with no pluck
 *
 * A pattern is a continuous cycle at a fixed division; it runs across bars and
 * does NOT restart on chord change (§5.1).
 */

import { frac, type Fraction } from "../fraction.js";

export type Role = "B" | "B*" | "m1" | "m2" | "T" | "-";

export interface Pattern {
  name: string;
  div: Fraction; // spacing between grid slots, in bar units
  steps: Role[];
  /** Strike all four arpeggio notes together at bar starts and chord changes. */
  chordStrike?: boolean;
  /** Meter hint for display only. */
  meter?: string;
}

export const PATTERNS: Record<string, Pattern> = {
  // 12/8 up-down arpeggio over four selected notes (4 = root = B): 4 3 2 1 2 3
  // repeated twice per bar -> 432123432123.
  "arp12": {
    name: "arp12",
    div: frac(1, 12),
    steps: ["B", "m1", "m2", "T", "m2", "m1"],
    meter: "12/8",
  },
  // Same, but strike all four notes together on the downbeat and at each chord
  // change: (4321)32123... .
  "arp12-strike": {
    name: "arp12-strike",
    div: frac(1, 12),
    steps: ["B", "m1", "m2", "T", "m2", "m1"],
    chordStrike: true,
    meter: "12/8",
  },
  // Strikes only: all four notes together at bar starts and chord changes, ring
  // out in between (the strike part of arp12-strike on its own).
  strike: {
    name: "strike",
    div: frac(1, 12),
    steps: ["-"],
    chordStrike: true,
    meter: "12/8",
  },
  "arp-up": {
    name: "arp-up",
    div: frac(1, 8),
    steps: ["B", "m1", "m2", "T"],
  },
  "arp-updown": {
    name: "arp-updown",
    div: frac(1, 8),
    steps: ["B", "m1", "m2", "T", "m2", "m1"],
  },
};

/**
 * Resolve a role to a string index (0 = low E … 5 = high e) given the sounding
 * strings of the active voicing (ascending). `bstar` counts prior B* hits.
 * Returns null when the role is a rest or no string is available.
 */
export function resolveRole(role: Role, sounding: number[], bstar: number): number | null {
  if (role === "-" || sounding.length === 0) return null;
  const B = sounding[0]!;
  const T = sounding[sounding.length - 1]!;
  const inner = sounding.slice(1, -1);
  switch (role) {
    case "B":
      return B;
    case "T":
      return T;
    case "m1":
      return inner[0] ?? T;
    case "m2":
      return inner[1] ?? inner[0] ?? T;
    case "B*":
      return bstar % 2 === 0 ? B : (sounding[1] ?? B);
  }
  return null;
}
