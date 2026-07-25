/**
 * L0 + L0.5 CLI. Reads a chord progression from argv or stdin and prints the
 * timed event list plus, for each chord, its slots and pitch-class set.
 *
 *   npm run cli -- "A==G | Dm7(b5) | Csus2dim"
 *   echo "Am F C G" | npm run cli
 */
import { parse } from "./l0/parse.js";
import { parseChord, pitchClasses, DEGREES, type Chord } from "./l0_5/chord.js";

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
  const arg = process.argv.slice(2).join(" ").trim();
  const input = arg || (await readStdin()).trim();
  if (!input) {
    console.error('usage: cli "A==G | Dm7 | Csus2dim"');
    process.exit(1);
  }

  const { events } = parse(input);
  for (const ev of events) {
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
}

main();
