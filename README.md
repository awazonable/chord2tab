# chord2tab

Chord-progression text → guitar arpeggio, per [`SPEC.md`](./SPEC.md).

Implemented so far:

- **L0** — input notation + rational time model (SPEC §2)
- **L0.5** — chord internal representation via left-to-right modifier operators (SPEC §3)
- **L1** — guitar voicing solver: candidate enumeration with physical filters,
  single/transition costs, and a Viterbi DP over the progression with k-best
  alternatives (SPEC §4), fronted by a curated **voicing library** of idiomatic
  open + movable CAGED shapes that override the solver when a standard shape
  exists (`src/l1/library.ts`)

- **L2** — tab rendering: an independent role-based fingerpicking pattern track
  scanned over the L1 voicing track, with grid-collision quantization, rest /
  string-transition damps, and ASCII tab output (SPEC §5)
- **§6 audio** — Karplus-Strong string synthesis: six independent voices in an
  AudioWorklet, driven by the L2 tab. Press **Play** in the live demo.

All five SPEC layers (L0 → audio) are implemented.

## Live demo

An interactive L0/L0.5/L1 explorer is deployed to GitHub Pages. Type a
progression and see the exact-rational event timeline, the pitch-class analysis
of each chord, the solved guitar voicings (with alternatives), and the ASCII
tab for a selectable fingerpicking pattern. Building it
(`npm run build`) also runs the tests, and pushes to `main` auto-deploy via
`.github/workflows/deploy-pages.yml`.

> To enable Pages: repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Develop

```bash
npm install
npm test          # runs the mandatory SPEC §2.5 and §3.4 test tables
npm run typecheck
npm run dev        # local demo at http://localhost:5173
npm run build      # typecheck + tests + static build into dist/
npm run cli -- "C Am F G | Dm7(b5) | Fm/Ab"        # L0 + L0.5 + L1 + L2 tab
npm run cli -- --alts "Cmaj7 | Am7"                # also show k-best voicings
npm run cli -- --pattern arp-up "C G Am | F"       # pick a fingerpicking pattern
```

## Design notes

- **Time is exact rational** (`src/fraction.ts`). A bar is `1/1`; a bar of `N`
  tokens gives each slot `1/N`. `1/3` never rounds — floats are banned (§2.2).
- **Chords are operators, not a dictionary** (`src/l0_5/chord.ts`). Each modifier
  mutates degree *slots* left-to-right, so `dim` is a relative operator, `6` and
  `7` share a slot, and `add9`/`add2` differ only by octave placement (§3.2).
- **Idiomatic shapes come first** (`src/l1/library.ts`). Real guitar vocabulary
  (open chords + movable E-shape/A-shape barres) is looked up by a root-relative
  interval signature and used as the primary voicing; the solver fills in any
  chord the library doesn't cover, and always handles slash chords so the `/X`
  bass is honored. The solver's k-best is still shown as alternatives.
- **Voicing is a shortest-path search** (`src/l1/`). Physical filters (fret span
  ≤ 4, ≤ 4 fingers after barre merge, inner-mute limit, required-tone coverage,
  slash-bass, string count) prune ~thousands of candidates per chord; a single
  cost (§4.3) ranks them and a Viterbi DP with transition cost (§4.5) picks the
  smoothest path. Cost weights live in `W`/`TW` and are meant to be tuned by ear
  (§7 calls this the most iterative part) — k-best alternatives are exposed to
  compare. Note selection follows the §4.1 drop priority (5th → 11th → 9th →
  root → 13th); `null` slots (e.g. `omit5`) are never sounded.

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
src/l1/library.ts    L1: curated idiomatic shapes (open + movable CAGED barres)
src/l1/voicing.ts    L1: note selection, candidate enumeration, filters, single cost
src/l1/solver.ts     L1: library-first lookup + transition cost + Viterbi DP + k-best
src/l1/format.ts     L1: §4.7 text form
src/l2/patterns.ts   L2: role-based fingerpicking patterns (travis, arp, block)
src/l2/tab.ts        L2: pattern×voicing expander + quantization/damps + ASCII tab
src/audio/ks-worklet.ts  §6: Karplus-Strong AudioWorklet (6 voices), as a string
src/audio/synth.ts       §6: tab→events (pure) + GuitarSynth (browser playback)
src/cli.ts           terminal inspector
src/demo.ts          GitHub Pages explorer
tests/               SPEC §2.5 / §3.4 tables + L1/L2 invariants
```

L2 design notes:

- **Two independent tracks** (§5.1). The pattern is a continuous grid that runs
  across bars and never restarts on a chord change; each pluck looks up whatever
  voicing is active at that instant.
- **Roles, not string numbers** (§5.2). `B`/`B*`/`m1`/`m2`/`T` resolve against
  the *current* voicing's ringing strings, so a pattern works regardless of how
  many strings a chord uses.
- **Quantize, don't subdivide** (§5.3). Off-grid chord changes (e.g. 3 chords in
  a 1/8-grid bar) snap to the nearest pluck and emit a shift warning; we never
  take an LCM.
- **Guitar ≠ keyboard** (§5.4–§5.6). Rests and sounding→muted transitions emit
  explicit damps (`X`); other strings ring until their next event.
