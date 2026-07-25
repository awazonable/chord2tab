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
}

export const PATTERNS: Record<string, Pattern> = {
  travis: {
    name: "travis",
    div: frac(1, 8),
    steps: ["B", "m2", "T", "m1", "B*", "m2", "T", "m1"],
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
  block: {
    name: "block",
    div: frac(1, 4),
    steps: ["B", "-", "-", "-"], // one bass hit; other voices struck with it (see tab.ts)
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
