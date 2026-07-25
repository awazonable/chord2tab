/**
 * L0 — input notation + time model (SPEC §2).
 *
 * Pipeline (§2.1, order is strict):
 *   1. NFKC normalize (full-width -> half-width)
 *   2. unify symbols (♯→#, ♭→b, △→M, half-dim glyphs, bar-line variants)
 *   3. strip comments
 *   4. split into bars
 *   5. tokenize each bar (root longest-match -> modifiers -> /bass)
 * then resolve `%`, then assign rational time (§2.2).
 *
 * The number of slots in a bar is NOT declared; it is derived from the token
 * count (§2.2). Each slot lasts `bar / N`. All durations are exact fractions in
 * *bar units* (a whole bar = 1/1); floats are never used (§2.2).
 *
 * NOTE on comments (spec deviation, see README): §2.1 lists comment-stripping
 * after unifying ♯→#, which would turn every `C#` into a comment. Since the
 * mandatory §3.4 test table feeds ASCII `#` chords (`C#5`, `C(#5)`), a `#` is
 * treated as a comment only when it starts a line or is preceded by whitespace;
 * a `#` glued to the preceding character (a note or `(`) is a musical sharp.
 */

import { Fraction, frac } from "../fraction.js";

export type EventKind = "chord" | "rest" | "nc";

export interface TimedEvent {
  /** 1-based bar index where the event starts. */
  bar: number;
  /** Start offset within the bar, in bar units (0 <= offset < 1). */
  offset: Fraction;
  /** Duration in bar units; may exceed 1 via a cross-bar tie (§2.4). */
  duration: Fraction;
  kind: EventKind;
  /** Raw chord token (only for kind === "chord"). */
  chordToken?: string;
}

export interface ParsedPiece {
  events: TimedEvent[];
  /** Resolved token lists per bar (after `%` expansion) — for inspection/tests. */
  bars: string[][];
}

export class ParseError extends Error {}

// ---------------------------------------------------------------------------
// Step 1-3: normalization
// ---------------------------------------------------------------------------

const UNIFY: Record<string, string> = {
  "＃": "#",
  "♯": "#",
  "♭": "b",
  "△": "M",
  "Δ": "M",
  "Φ": "ø",
  "φ": "ø",
  "｜": "|",
  "l": "|",
  "ｌ": "|",
};

function stripComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "#" && (i === 0 || /\s/.test(line[i - 1]!))) {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Normalize input and return the flat, comment-free, bar-delimited string. */
export function normalize(input: string): string {
  const nfkc = input.normalize("NFKC");
  // Comment-strip per physical line, then treat line breaks as bar boundaries.
  const lines = nfkc.split(/\r?\n/).map(stripComment);
  let joined = lines.join("|");
  let out = "";
  for (const ch of joined) out += UNIFY[ch] ?? ch;
  return out;
}

// ---------------------------------------------------------------------------
// Step 4-5: bars + tokenization
// ---------------------------------------------------------------------------

const NC_RE = /^N\.?C\.?/i;
const ROOT_LETTER = /[A-G]/;

/** Tokenize a single bar into slot tokens (§2.2). Whitespace separates tokens. */
export function tokenizeBar(bar: string): string[] {
  const s = bar;
  const tokens: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i]!)) {
      i++;
      continue;
    }
    const c = s[i]!;
    if (c === "=" || c === "_" || c === "%") {
      tokens.push(c);
      i++;
      continue;
    }
    const nc = NC_RE.exec(s.slice(i));
    if (nc) {
      tokens.push("N.C.");
      i += nc[0].length;
      continue;
    }
    if (ROOT_LETTER.test(c)) {
      const start = i;
      i++; // consume root letter
      while (i < s.length) {
        const ch = s[i]!;
        if (/\s/.test(ch) || ch === "=" || ch === "_" || ch === "%") break;
        // A new chord begins at an upper-case note letter that is not a /bass.
        if (ROOT_LETTER.test(ch) && s[i - 1] !== "/") break;
        i++;
      }
      tokens.push(s.slice(start, i));
      continue;
    }
    throw new ParseError(`cannot interpret token starting at "${s.slice(i)}"`);
  }
  return tokens;
}

/** Split normalized text into bars and tokenize, dropping empty bar segments. */
function splitBars(normalized: string): string[][] {
  return normalized
    .split("|")
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .map(tokenizeBar);
}

/** Resolve `%` bars (§2.2 / §2.3): `%` must be the sole token and copies the prior bar. */
function resolvePercent(bars: string[][]): string[][] {
  const out: string[][] = [];
  for (let b = 0; b < bars.length; b++) {
    const toks = bars[b]!;
    const pctAt = toks.indexOf("%");
    if (pctAt >= 0) {
      if (toks.length !== 1) {
        throw new ParseError(`'%' must be the only token in a bar (bar ${b + 1})`);
      }
      if (out.length === 0) {
        throw new ParseError(`'%' in the first bar has no previous bar to copy`);
      }
      out.push([...out[out.length - 1]!]);
    } else {
      out.push(toks);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Time assignment (§2.2, §2.4)
// ---------------------------------------------------------------------------

function classify(tok: string): EventKind | "tie" {
  if (tok === "=") return "tie";
  if (tok === "_") return "rest";
  if (tok === "N.C.") return "nc";
  return "chord";
}

/** Full L0 parse: text -> timed events. */
export function parse(input: string): ParsedPiece {
  const bars = resolvePercent(splitBars(normalize(input)));
  const events: TimedEvent[] = [];
  let current: TimedEvent | null = null; // last event, extendable by a tie

  for (let b = 0; b < bars.length; b++) {
    const toks = bars[b]!;
    const n = toks.length;
    if (n === 0) continue;
    const slot = frac(1, n);
    for (let k = 0; k < n; k++) {
      const tok = toks[k]!;
      const kind = classify(tok);
      const offset = slot.mul(frac(k));
      if (kind === "tie") {
        if (!current) {
          // §2.3: a tie with no preceding chord (e.g. leading `=`, or `=A`).
          throw new ParseError(`tie '=' has no preceding event (bar ${b + 1}, slot ${k + 1})`);
        }
        current.duration = current.duration.add(slot);
        continue;
      }
      const ev: TimedEvent = {
        bar: b + 1,
        offset,
        duration: slot,
        kind,
        ...(kind === "chord" ? { chordToken: tok } : {}),
      };
      events.push(ev);
      current = ev;
    }
  }

  return { events, bars };
}
