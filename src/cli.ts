/**
 * L0 + L0.5 + L1 CLI. Reads a chord progression from argv or stdin and prints
 * the timed events, per-chord pitch analysis, and the solved L1 voicing tab.
 *
 *   npm run cli -- "C Am F G | Dm7(b5) | Fm/Ab"
 *   npm run cli -- --alts "Cmaj7 | Am7"      # also show k-best alternatives
 *   echo "Am F C G" | npm run cli
 */
import { parse } from "./l0/parse.js";
import { parseChord, pitchClasses, DEGREES, type Chord } from "./l0_5/chord.js";
import { solve } from "./l1/solver.js";
import { formatL1, renderVoicing } from "./l1/format.js";

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
  });
}

function describeChord(c: Chord): string {
  const present = DEGREES.filter((d) => c.slots[d] !== null)
    .map((d) => `${d}${c.slots[d] === 0 ? "" : c.slots[d]! > 0 ? "+" + c.slots[d] : c.slots[d]}`)
    .join(" ");
  const pcs = [...pitchClasses(c)].sort((a, b) => a - b).join(",");
  const bass = c.bass_pc !== null ? ` /${c.bass_spelling}(${c.bass_pc})` : "";
  return `root=${c.root_spelling}(${c.root_pc})${bass}  slots[${present}]  pc={${pcs}}`;
}

async function main() {
  const args = process.argv.slice(2);
  const showAlts = args.includes("--alts");
  const input = (args.filter((a) => a !== "--alts").join(" ").trim() || (await readStdin()).trim());
  if (!input) {
    console.error('usage: cli [--alts] "C Am F G | Dm7(b5) | Fm/Ab"');
    process.exit(1);
  }

  const piece = parse(input);

  console.log("== L0 / L0.5 ==");
  for (const ev of piece.events) {
    const pos = `${ev.bar}:${ev.offset.toString()}`.padEnd(10);
    const dur = `dur=${ev.duration.toString()}`.padEnd(10);
    if (ev.kind === "chord") {
      let detail: string;
      try {
        detail = describeChord(parseChord(ev.chordToken!));
      } catch (e) {
        detail = `<parse error: ${(e as Error).message}>`;
      }
      console.log(`${pos} ${dur} ${ev.chordToken!.padEnd(12)} ${detail}`);
    } else if (ev.kind === "rest") {
      console.log(`${pos} ${dur} _ (rest)`);
    } else {
      console.log(`${pos} ${dur} N.C.`);
    }
  }

  console.log("\n== L1 ==");
  const result = solve(piece);
  console.log(formatL1(result));

  if (showAlts) {
    console.log("\n== k-best alternatives ==");
    for (const node of result.nodes) {
      const alts = node.alternates.slice(0, 4).map((c) => `${renderVoicing(c.voicing)} (${c.cost.toFixed(2)})`);
      console.log(`${node.token.padEnd(12)} ${alts.join("   ")}`);
    }
  }
}

main();
