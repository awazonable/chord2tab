/** Interactive L0/L0.5 explorer for GitHub Pages. */
import { parse, ParseError } from "./l0/parse.js";
import { parseChord, pitchClasses, DEGREES, type Chord } from "./l0_5/chord.js";

const PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const EXAMPLES = [
  "A / A= / A===",
  "AG | A==G | AG==",
  "A=G",
  "_A",
  "A=|=G",
  "Csus2dim",
  "C67 | C7",
  "Cdim7 | C#5 | C(#5)",
  "Fm/Ab | Dm7(b5) | Gsus4/D",
];

const input = document.getElementById("input") as HTMLTextAreaElement;
const output = document.getElementById("output") as HTMLDivElement;
const examples = document.getElementById("examples") as HTMLDivElement;

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function slotSummary(c: Chord): string {
  return DEGREES.filter((d) => c.slots[d] !== null)
    .map((d) => {
      const v = c.slots[d]!;
      const sign = v === 0 ? "" : v > 0 ? `+${v}` : `${v}`;
      const drop = c.drop_octave.has(d) ? "↓" : "";
      return `${d}${sign}${drop}`;
    })
    .join(" ");
}

function pcSet(c: Chord): string {
  return [...pitchClasses(c)]
    .sort((a, b) => a - b)
    .map((p) => `${p}<span style="opacity:.6">${PC_NAMES[p]}</span>`)
    .join(", ");
}

function render() {
  const text = input.value;
  let html = "";
  try {
    const { events } = parse(text);
    html += `<h2>L0 — timed events</h2><div class="scroll"><table>
      <tr><th>bar:offset</th><th>duration</th><th>kind</th><th>token</th></tr>`;
    for (const ev of events) {
      html += `<tr><td>${ev.bar}:${esc(ev.offset.toString())}</td>
        <td>${esc(ev.duration.toString())}</td>
        <td>${ev.kind}</td>
        <td>${ev.kind === "chord" ? esc(ev.chordToken!) : ev.kind === "rest" ? "_" : "N.C."}</td></tr>`;
    }
    html += `</table></div>`;

    const chordTokens = [...new Set(events.filter((e) => e.kind === "chord").map((e) => e.chordToken!))];
    if (chordTokens.length) {
      html += `<h2>L0.5 — chord analysis</h2><div class="scroll"><table>
        <tr><th>chord</th><th>root</th><th>slots (deg±/↓)</th><th>pitch classes</th></tr>`;
      for (const tok of chordTokens) {
        try {
          const c = parseChord(tok);
          const bass = c.bass_pc !== null ? ` /${esc(c.bass_spelling!)}` : "";
          html += `<tr><td>${esc(tok)}</td>
            <td>${esc(c.root_spelling)}(${c.root_pc})${bass}</td>
            <td>${esc(slotSummary(c))}</td>
            <td class="pc">{${pcSet(c)}}</td></tr>`;
        } catch (e) {
          html += `<tr><td>${esc(tok)}</td><td colspan="3" class="err">${esc((e as Error).message)}</td></tr>`;
        }
      }
      html += `</table></div>`;
    }
  } catch (e) {
    const label = e instanceof ParseError ? "Parse error" : "Error";
    html = `<h2>${label}</h2><div class="err">${esc((e as Error).message)}</div>`;
  }
  output.innerHTML = html;
}

for (const ex of EXAMPLES) {
  const b = document.createElement("button");
  b.textContent = ex;
  b.onclick = () => {
    input.value = ex;
    render();
  };
  examples.appendChild(b);
}

input.addEventListener("input", render);
render();
