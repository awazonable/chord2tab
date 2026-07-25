/**
 * L0.5 — Chord internal representation (SPEC §3).
 *
 * A chord is NOT looked up in a dictionary. Per §3.2, chord "types" like `dim`
 * are *relative operators*, several modifiers *share slots* (`6`/`7`), and some
 * differ only in octave placement (`add9`/`add2`). So we model a chord as a set
 * of degree slots and apply modifier functions strictly left-to-right.
 *
 * The value stored in a slot is the *relative change* from that degree's base
 * semitone (§3.1: "基準音からの相対変化量"). Pitch class of a present degree d is:
 *
 *     (root_pc + BASE[d] + slots[d]) mod 12
 *
 * ---------------------------------------------------------------------------
 * SPEC INCONSISTENCIES resolved here (see also README "Spec deviations"):
 *
 *  1. `6` / `add6`: §3.3's table says these write slot 13, but §3.2 states
 *     "6th と 7th は同一スロットを共有する。C67 == C7 はこの帰結" — the 6th shares
 *     the 7th slot, which is the ONLY way `C67 == C7` (§3.4) can hold. We follow
 *     §3.2 + the test: `6`/`add6` write slot 7 (= -2, a diminished-7th = 6th pc),
 *     tagged drop_octave so voicing places it as a 6th. A later `7` overwrites it.
 *
 *  2. `Φ φ ø`: §2.1 loosely groups these under "dim系", but §3.3 and §8 define
 *     them as the half-diminished seventh (m7♭5). We treat them as their own
 *     operator (slot3-=1, slot5-=1, slot7=-1), NOT as `dim`.
 *
 *  3. `Csus2dim`: §3.4 prints {0,2,6}, but that is inconsistent with the operator
 *     table (§3.3) and with §3.2's own statement that `dim` moves the 3rd *further*
 *     after `sus2`. Applying the operators literally (sus2: 3-=2 -> -2; dim: 3-=1
 *     -> -3) gives a 3rd pc of 1, i.e. {0,1,6}. (§3.4's gloss "Ebbb≡D" is itself
 *     wrong: Ebbb = 1, not 2.) We implement the mechanically-consistent {0,1,6}.
 *     This is the single row where our output differs from §3.4's printed value.
 * ---------------------------------------------------------------------------
 */

export type Degree = 1 | 3 | 5 | 7 | 9 | 11 | 13;

export const DEGREES: Degree[] = [1, 3, 5, 7, 9, 11, 13];

/** Base semitone of each degree over the root (major scale reference). */
export const BASE: Record<Degree, number> = {
  1: 0,
  3: 4,
  5: 7,
  7: 11,
  9: 14,
  11: 17,
  13: 21,
};

export type Slots = Record<Degree, number | null>;

export interface Chord {
  root_pc: number; // 0..11
  root_spelling: string; // display only
  bass_pc: number | null; // /X
  bass_spelling: string | null;
  slots: Slots;
  /** degrees (add2/4/6 family) to drop an octave in voicing */
  drop_octave: Set<Degree>;
}

const NOTE_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export class ChordParseError extends Error {}

/** Parse the leading note name (letter + accidentals). Returns pc, spelling, length. */
function parseRoot(s: string): { pc: number; spelling: string; len: number } | null {
  const letter = s[0]?.toUpperCase();
  if (!letter || !(letter in NOTE_PC)) return null;
  let pc = NOTE_PC[letter];
  let i = 1;
  // Greedy accidentals — root longest match (§2.1): `Cb5` = Cb + omit3, not C + b5.
  while (i < s.length && (s[i] === "#" || s[i] === "b")) {
    pc += s[i] === "#" ? 1 : -1;
    i++;
  }
  return { pc: ((pc % 12) + 12) % 12, spelling: s.slice(0, i), len: i };
}

function initialSlots(): Slots {
  return { 1: 0, 3: 0, 5: 0, 7: null, 9: null, 11: null, 13: null };
}

type Op = (c: Chord) => void;

const setSlot = (d: Degree, v: number): Op => (c) => {
  c.slots[d] = v;
};
const addSlot = (d: Degree, delta: number): Op => (c) => {
  // A relative operator on a null slot is meaningless; treat base as present.
  c.slots[d] = (c.slots[d] ?? 0) + delta;
};
const nullSlot = (d: Degree): Op => (c) => {
  // omit/no on an already-absent slot is a no-op (§3.3).
  c.slots[d] = null;
};

/**
 * Ordered modifier matchers. Longest / most specific first so that e.g. `maj7`
 * beats `maj`, `dim7` beats `dim`, `omit5` beats `o`, `sus4` beats `sus`.
 * Each entry: [matcher, ops]. `matcher` returns matched length or 0.
 */
interface Rule {
  match: (s: string) => number; // consumed length, 0 = no match
  ops: (matched: string) => Op[];
}

function lit(token: string, ops: Op[]): Rule {
  return {
    match: (s) => (s.startsWith(token) ? token.length : 0),
    ops: () => ops,
  };
}

// The 7th-chain modifiers (9/11/13 imply the flat-7 and everything below).
const domChain = (top: Degree): Op[] => {
  const ops: Op[] = [setSlot(7, -1)];
  if (top >= 9) ops.push(setSlot(9, 0));
  if (top >= 11) ops.push(setSlot(11, 0));
  if (top >= 13) ops.push(setSlot(13, 0));
  return ops;
};
const majChain = (top: Degree): Op[] => {
  const ops: Op[] = [setSlot(7, 0)];
  if (top >= 9) ops.push(setSlot(9, 0));
  if (top >= 11) ops.push(setSlot(11, 0));
  if (top >= 13) ops.push(setSlot(13, 0));
  return ops;
};

// A sixth shares the 7th slot (see deviation #1) and is voiced low.
const sixthOps: Op[] = [
  setSlot(7, -2),
  (c) => c.drop_octave.add(13),
];

const RULES: Rule[] = [
  // --- major-seventh family (must precede bare m / M) ---
  lit("maj13", majChain(13)),
  lit("maj11", majChain(11)),
  lit("maj9", majChain(9)),
  lit("maj7", majChain(7)),
  lit("M13", majChain(13)),
  lit("M11", majChain(11)),
  lit("M9", majChain(9)),
  lit("M7", majChain(7)),
  // --- minor (bare lower-case m; placed after maj* so those win) ---
  lit("m", [addSlot(3, -1)]),
  // --- suspensions (sus4/sus2 before bare sus) ---
  lit("sus4", [addSlot(3, 1)]),
  lit("sus2", [addSlot(3, -2)]),
  lit("sus", [addSlot(3, 1)]), // bare sus = sus4 (common convention)
  // --- diminished (dim7 before dim; o family before bare o) ---
  lit("dim7", [addSlot(3, -1), addSlot(5, -1), setSlot(7, -2)]),
  lit("dim", [addSlot(3, -1), addSlot(5, -1)]),
  // --- add family (addN, add2/4/6 with octave drop) ---
  lit("add9", [setSlot(9, 0)]),
  lit("add11", [setSlot(11, 0)]),
  lit("add13", [setSlot(13, 0)]),
  lit("add2", [setSlot(9, 0), (c) => c.drop_octave.add(9)]),
  lit("add4", [setSlot(11, 0), (c) => c.drop_octave.add(11)]),
  lit("add6", sixthOps),
  // --- omit family ---
  lit("omit1", [nullSlot(1)]),
  lit("omit3", [nullSlot(3)]),
  lit("omit5", [nullSlot(5)]),
  lit("no1", [nullSlot(1)]),
  lit("no3", [nullSlot(3)]),
  lit("no5", [nullSlot(5)]),
  // --- augmented ---
  lit("aug", [addSlot(5, 1)]),
  lit("+5", [addSlot(5, 1)]),
  lit("-5", [addSlot(5, -1)]),
  // --- half-diminished (deviation #2) ---
  { match: (s) => (/^[Φφø]/.test(s) ? 1 : 0), ops: () => [addSlot(3, -1), addSlot(5, -1), setSlot(7, -1)] },
  // --- dominant / extension chain ---
  lit("13", domChain(13)),
  lit("11", domChain(11)),
  lit("9", domChain(9)),
  lit("7", domChain(7)),
  lit("6", sixthOps),
  // --- power chord / omit-3 shorthand: bare `5` = omit3 (§3.3, §3.4 `C#5`) ---
  lit("5", [nullSlot(3)]),
  // --- augmented shorthand `+` (after +5 so +5 wins) ---
  lit("+", [addSlot(5, 1)]),
  // --- `o` = dim shorthand (after dim7/dim/omit) ---
  lit("o", [addSlot(3, -1), addSlot(5, -1)]),
];

const DEGREE_NUMS = new Set([2, 4, 5, 6, 7, 9, 11, 13]);

/** Map a "tension number" as written to its slot degree. 2->9,4->11,6->13. */
function tensionDegree(n: number): Degree {
  if (n === 2) return 9;
  if (n === 4) return 11;
  if (n === 6) return 13;
  return n as Degree;
}

/** Parse the contents of a parenthesised group (or a one-sided `(no5`). */
function applyParen(inner: string, chord: Chord): void {
  // Split on separators; also allow concatenated terms like `#9#11`.
  const terms = inner.split(/[,\s]+/).filter(Boolean);
  for (const term of terms) {
    let rest = term;
    while (rest.length > 0) {
      // no3 / omit5 inside parens
      const om = /^(?:no|omit)(1|3|5)/.exec(rest);
      if (om) {
        nullSlot(Number(om[1]) as Degree)(chord);
        rest = rest.slice(om[0].length);
        continue;
      }
      // signed alteration: (#5) (b9) (-9) (+11) ...
      const alt = /^([#b+\-])(\d{1,2})/.exec(rest);
      if (alt) {
        const sign = alt[1] === "#" || alt[1] === "+" ? 1 : -1;
        const d = tensionDegree(Number(alt[2]));
        setSlot(d, sign)(chord);
        rest = rest.slice(alt[0].length);
        continue;
      }
      // bare number inside parens: add that tension natural (e.g. (9))
      const nat = /^(\d{1,2})/.exec(rest);
      if (nat && DEGREE_NUMS.has(Number(nat[1]))) {
        setSlot(tensionDegree(Number(nat[1])), 0)(chord);
        rest = rest.slice(nat[0].length);
        continue;
      }
      throw new ChordParseError(`unrecognised tension: (${term})`);
    }
  }
}

/**
 * Parse a full chord token, e.g. `Dm7(b5)/A`, into a Chord.
 * Throws ChordParseError on an unparseable root or leftover garbage.
 */
export function parseChord(token: string): Chord {
  const raw = token.trim();
  const root = parseRoot(raw);
  if (!root) throw new ChordParseError(`no root in "${token}"`);

  const chord: Chord = {
    root_pc: root.pc,
    root_spelling: root.spelling,
    bass_pc: null,
    bass_spelling: null,
    slots: initialSlots(),
    drop_octave: new Set(),
  };

  let body = raw.slice(root.len);

  // Split off a trailing /bass (the last '/'), if any.
  const slash = body.lastIndexOf("/");
  if (slash >= 0) {
    const bassStr = body.slice(slash + 1);
    const bass = parseRoot(bassStr);
    if (!bass || bass.len !== bassStr.length) {
      throw new ChordParseError(`bad bass note "/${bassStr}"`);
    }
    chord.bass_pc = bass.pc;
    chord.bass_spelling = bass.spelling;
    body = body.slice(0, slash);
  }

  // `M` / `maj` with nothing after = major triad (§3.3 exception: `CM`).
  if (body === "M" || body === "maj") body = "";

  // Apply modifiers left-to-right.
  let i = 0;
  while (i < body.length) {
    if (body[i] === "(") {
      const close = body.indexOf(")", i);
      const inner = close >= 0 ? body.slice(i + 1, close) : body.slice(i + 1); // one-sided ok
      applyParen(inner, chord);
      i = close >= 0 ? close + 1 : body.length;
      continue;
    }
    // Bare altered tension without parentheses, e.g. `m7b5`, `7b9`, `7#9`, `7#11`.
    const bareAlt = /^([#b])(\d{1,2})/.exec(body.slice(i));
    if (bareAlt) {
      setSlot(tensionDegree(Number(bareAlt[2])), bareAlt[1] === "#" ? 1 : -1)(chord);
      i += bareAlt[0].length;
      continue;
    }
    const slice = body.slice(i);
    let matched = false;
    for (const rule of RULES) {
      const len = rule.match(slice);
      if (len > 0) {
        for (const op of rule.ops(slice.slice(0, len))) op(chord);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      throw new ChordParseError(`unrecognised modifier "${slice}" in "${token}"`);
    }
  }

  return chord;
}

/** Pitch-class set of the chord's slot degrees (root included iff slot 1 present). */
export function pitchClasses(chord: Chord): Set<number> {
  const out = new Set<number>();
  for (const d of DEGREES) {
    const v = chord.slots[d];
    if (v === null) continue;
    out.add(((chord.root_pc + BASE[d] + v) % 12 + 12) % 12);
  }
  return out;
}
