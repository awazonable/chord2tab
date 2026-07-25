# chord2tab

Chord-progression text → guitar arpeggio, per [`SPEC.md`](./SPEC.md).

This repository currently implements the first two, cheapest-to-lock layers
(SPEC §7 says to make these green before touching the solver):

- **L0** — input notation + rational time model (SPEC §2)
- **L0.5** — chord internal representation via left-to-right modifier operators (SPEC §3)

The voicing solver (L1), tab rendering (L2), and Karplus-Strong audio (§6) are
not implemented yet.

## Live demo

An interactive L0/L0.5 explorer is deployed to GitHub Pages. Type a progression
and see the exact-rational event timeline and the pitch-class analysis of each
chord. Building it (`npm run build`) also runs the tests, and pushes to `main`
auto-deploy via `.github/workflows/deploy-pages.yml`.

> To enable Pages: repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Develop

```bash
npm install
npm test          # runs the mandatory SPEC §2.5 and §3.4 test tables
npm run typecheck
npm run dev        # local demo at http://localhost:5173
npm run build      # typecheck + tests + static build into dist/
npm run cli -- "A==G | Dm7(b5) | Csus2dim"   # inspect L0 + L0.5 from the terminal
```

## Design notes

- **Time is exact rational** (`src/fraction.ts`). A bar is `1/1`; a bar of `N`
  tokens gives each slot `1/N`. `1/3` never rounds — floats are banned (§2.2).
- **Chords are operators, not a dictionary** (`src/l0_5/chord.ts`). Each modifier
  mutates degree *slots* left-to-right, so `dim` is a relative operator, `6` and
  `7` share a slot, and `add9`/`add2` differ only by octave placement (§3.2).

## Spec deviations

`SPEC.md` contains a few internal contradictions; where the operator table (§3.3),
the rationale (§3.2), and the test tables (§2.5/§3.4) disagree, these are the
choices made (all documented at their source in the code):

1. **Comment vs sharp (§2.1).** The spec strips `#`-to-end-of-line *after*
   normalizing `♯→#`, which would turn every `C#` into a comment and break the
   mandatory `C#5`/`C(#5)` tests. A `#` is treated as a comment only at line start
   or after whitespace; a `#` glued to the previous character is a sharp.

2. **`6` / `add6` (§3.3 vs §3.2).** The §3.3 table writes these to slot 13, but
   that makes `C67 ≠ C7`. §3.2 states the 6th shares the 7th slot, which is the
   only way `C67 == C7` holds — so `6`/`add6` write slot 7 (a ♭♭7 = 6th pitch),
   tagged `drop_octave` for low voicing. A following `7` overwrites it.

3. **`Φ φ ø` (§2.1 vs §3.3/§8).** §2.1 loosely groups these under "dim系"; §3.3
   and §8 define them as the half-diminished seventh (m7♭5). Implemented as the
   latter, distinct from `dim`.

4. **`Csus2dim` (§3.4).** §3.4 prints `{0,2,6}`, but that contradicts the §3.3
   operators and §3.2's own statement that `dim` moves the 3rd *further* after
   `sus2` (its gloss "Ebbb≡D" is also arithmetically wrong: Ebbb = 1). Applying
   the operators literally gives **`{0,1,6}`**. This is the one row where output
   differs from §3.4's printed value; every other row matches exactly. Flipping
   it would require special-casing `dim` on a suspended third — say the word and
   I'll change it.

## Layout

```
src/fraction.ts      exact rational type
src/l0/parse.ts      L0: normalize → tokenize → rational time
src/l0_5/chord.ts    L0.5: chord slots + modifier operators
src/cli.ts           terminal inspector
src/demo.ts          GitHub Pages explorer
tests/               SPEC §2.5 / §3.4 tables + more
```
