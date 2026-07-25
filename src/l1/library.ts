/**
 * L1 voicing library — curated, idiomatic guitar shapes that override the
 * solver when a well-known "standard answer" exists (the user's request).
 *
 * Two tiers:
 *   1. OPEN — hand-authored open-position shapes for the common open chords
 *      (C, Am, G7, …). These are what a guitarist actually plays and are
 *      open-string-rich (good for arpeggios).
 *   2. MOVABLE — CAGED-style barre shapes (E-shape on the 6th string, A-shape
 *      on the 5th) that transpose to *any* root, covering chords with no open
 *      form (Cm, Ab, Bb, …). We pick the lowest-position transposition.
 *
 * Chords are keyed by a root-relative interval SIGNATURE (e.g. major = "0,4,7"),
 * computed from the L0.5 slots, so spelling never matters. Slash chords and
 * anything with no matching entry fall through to the enumeration solver.
 */

import type { Chord } from "../l0_5/chord.js";
import { DEGREES, BASE } from "../l0_5/chord.js";
import { OPEN_MIDI, type Voicing } from "./voicing.js";

const OPEN_PC = OPEN_MIDI.map((m) => m % 12); // [4,9,2,7,11,4]

/** Root-relative interval set of a chord's present degrees, e.g. "0,4,7". */
export function signatureOf(chord: Chord): string {
  const set = new Set<number>();
  for (const d of DEGREES) {
    const v = chord.slots[d];
    if (v === null) continue;
    set.add(((BASE[d] + v) % 12 + 12) % 12);
  }
  return [...set].sort((a, b) => a - b).join(",");
}

// ---------------------------------------------------------------------------
// Movable (transposable) shapes — frets are RELATIVE to the root fret; the root
// sits at rel 0 on `rootString` (0 = low E … 5 = high E). null = muted.
// ---------------------------------------------------------------------------

interface Movable {
  rootString: number;
  rel: (number | null)[];
}

const MOVABLE: Record<string, Movable[]> = {
  "0,4,7": [ // major
    { rootString: 0, rel: [0, 2, 2, 1, 0, 0] }, // E-shape
    { rootString: 1, rel: [null, 0, 2, 2, 2, 0] }, // A-shape
  ],
  "0,3,7": [ // minor
    { rootString: 0, rel: [0, 2, 2, 0, 0, 0] },
    { rootString: 1, rel: [null, 0, 2, 2, 1, 0] },
  ],
  "0,4,7,10": [ // dominant 7
    { rootString: 0, rel: [0, 2, 0, 1, 0, 0] },
    { rootString: 1, rel: [null, 0, 2, 0, 2, 0] },
  ],
  "0,3,7,10": [ // minor 7
    { rootString: 0, rel: [0, 2, 0, 0, 0, 0] },
    { rootString: 1, rel: [null, 0, 2, 0, 1, 0] },
  ],
  "0,4,7,11": [ // major 7
    { rootString: 0, rel: [0, 2, 1, 1, 0, 0] },
    { rootString: 1, rel: [null, 0, 2, 1, 2, 0] },
  ],
  "0,3,6,10": [ // m7♭5 (half-diminished)
    { rootString: 1, rel: [null, 0, 1, 0, 1, null] },
  ],
  "0,5,7": [ // sus4
    { rootString: 0, rel: [0, 2, 2, 2, 0, 0] },
    { rootString: 1, rel: [null, 0, 2, 2, 3, 0] },
  ],
  "0,2,7": [ // sus2
    { rootString: 1, rel: [null, 0, 2, 2, 0, 0] },
    { rootString: 2, rel: [null, null, 0, 2, 3, 0] },
  ],
  "0,4,7,9": [ // 6
    { rootString: 0, rel: [0, 2, 2, 1, 2, 0] },
    { rootString: 1, rel: [null, 0, 2, 2, 2, 2] },
  ],
  "0,3,7,9": [ // m6
    { rootString: 0, rel: [0, 2, 2, 0, 2, 0] },
    { rootString: 1, rel: [null, 0, 2, 2, 1, 2] },
  ],
  "0,2,4,7": [ // add9
    { rootString: 1, rel: [null, 0, 2, 4, 2, 0] },
  ],
  "0,7": [ // power chord (5)
    { rootString: 0, rel: [0, 2, 2, null, null, null] },
    { rootString: 1, rel: [null, 0, 2, 2, null, null] },
  ],
};

// ---------------------------------------------------------------------------
// Open-position shapes — absolute frets, best first. Keyed by `${rootPc}:${sig}`.
// ---------------------------------------------------------------------------

const O = (...frets: (number | null)[]): Voicing => frets;
const x = null;

const OPEN: Record<string, Voicing[]> = {
  // major
  "0:0,4,7": [O(x, 3, 2, 0, 1, 0)], // C
  "9:0,4,7": [O(x, 0, 2, 2, 2, 0)], // A
  "7:0,4,7": [O(3, 2, 0, 0, 0, 3), O(3, 2, 0, 0, 3, 3)], // G
  "4:0,4,7": [O(0, 2, 2, 1, 0, 0)], // E
  "2:0,4,7": [O(x, x, 0, 2, 3, 2)], // D
  // minor
  "9:0,3,7": [O(x, 0, 2, 2, 1, 0)], // Am
  "4:0,3,7": [O(0, 2, 2, 0, 0, 0)], // Em
  "2:0,3,7": [O(x, x, 0, 2, 3, 1)], // Dm
  // dominant 7
  "0:0,4,7,10": [O(x, 3, 2, 3, 1, 0)], // C7
  "9:0,4,7,10": [O(x, 0, 2, 0, 2, 0)], // A7
  "7:0,4,7,10": [O(3, 2, 0, 0, 0, 1)], // G7
  "4:0,4,7,10": [O(0, 2, 0, 1, 0, 0)], // E7
  "2:0,4,7,10": [O(x, x, 0, 2, 1, 2)], // D7
  "11:0,4,7,10": [O(x, 2, 1, 2, 0, 2)], // B7
  // minor 7
  "9:0,3,7,10": [O(x, 0, 2, 0, 1, 0)], // Am7
  "4:0,3,7,10": [O(0, 2, 0, 0, 0, 0)], // Em7
  "2:0,3,7,10": [O(x, x, 0, 2, 1, 1)], // Dm7
  // major 7
  "0:0,4,7,11": [O(x, 3, 2, 0, 0, 0)], // Cmaj7
  "9:0,4,7,11": [O(x, 0, 2, 1, 2, 0)], // Amaj7
  "7:0,4,7,11": [O(3, 2, 0, 0, 0, 2)], // Gmaj7
  "4:0,4,7,11": [O(0, 2, 1, 1, 0, 0)], // Emaj7
  "2:0,4,7,11": [O(x, x, 0, 2, 2, 2)], // Dmaj7
  "5:0,4,7,11": [O(x, x, 3, 2, 1, 0)], // Fmaj7
  // sixth
  "0:0,4,7,9": [O(x, 3, 2, 2, 1, 0)], // C6
  "7:0,4,7,9": [O(3, 2, 0, 0, 0, 0)], // G6
  "9:0,4,7,9": [O(x, 0, 2, 2, 2, 2)], // A6
  "4:0,4,7,9": [O(0, 2, 2, 1, 2, 0)], // E6
  "2:0,4,7,9": [O(x, x, 0, 2, 0, 2)], // D6
  // sus4
  "9:0,5,7": [O(x, 0, 2, 2, 3, 0)], // Asus4
  "2:0,5,7": [O(x, x, 0, 2, 3, 3)], // Dsus4
  "4:0,5,7": [O(0, 2, 2, 2, 0, 0)], // Esus4
  // sus2
  "9:0,2,7": [O(x, 0, 2, 2, 0, 0)], // Asus2
  "2:0,2,7": [O(x, x, 0, 2, 3, 0)], // Dsus2
  // add9
  "0:0,2,4,7": [O(x, 3, 2, 0, 3, 0)], // Cadd9
  // m7b5
  "2:0,3,6,10": [O(x, x, 0, 1, 1, 1)], // Dm7b5
};

function transpose(m: Movable, rootPc: number): Voicing {
  const rootFret = ((rootPc - OPEN_PC[m.rootString]!) % 12 + 12) % 12;
  return m.rel.map((r) => (r === null ? null : r + rootFret));
}

const maxFret = (v: Voicing) => Math.max(0, ...v.filter((f): f is number => f !== null));

/**
 * Look up idiomatic voicing(s) for a chord, best first. Returns null when the
 * chord has a slash bass (handled by the solver) or no library match.
 */
export function lookupVoicings(chord: Chord): Voicing[] | null {
  if (chord.bass_pc !== null) return null; // slash chords: let the solver honor /X
  const sig = signatureOf(chord);

  const open = OPEN[`${chord.root_pc}:${sig}`];
  if (open) return open.map((v) => [...v]);

  const movable = MOVABLE[sig];
  if (movable) {
    const voiced = movable
      .map((m) => transpose(m, chord.root_pc))
      .filter((v) => maxFret(v) <= 15)
      .sort((a, b) => maxFret(a) - maxFret(b));
    if (voiced.length) return voiced.slice(0, 2);
  }
  return null;
}
