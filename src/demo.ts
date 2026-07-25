/** Interactive L0/L0.5/L1 explorer for GitHub Pages. */
import { parse, ParseError } from "./l0/parse.js";
import { parseChord, pitchClasses, DEGREES, type Chord } from "./l0_5/chord.js";
import { solve, type SolveResult } from "./l1/solver.js";
import { renderVoicing } from "./l1/format.js";
import { analyze, type Voicing } from "./l1/voicing.js";
import { buildTab, renderTab } from "./l2/tab.js";
import { PATTERNS } from "./l2/patterns.js";
import { GuitarSynth, tabToPlayEvents, tabDurationSec } from "./audio/synth.js";

/** User-chosen voicing overrides, keyed by chord token (applies to every use). */
const overrides = new Map<string, Voicing>();

function parseVoicing(s: string): Voicing {
  return s.split("-").map((t) => (t === "x" ? null : Number(t)));
}

/** Solve, then replace any chord's voicing with the user's chosen alternative. */
function solveWithOverrides(text: string): SolveResult {
  const res = solve(parse(text));
  for (const node of res.nodes) {
    const ov = overrides.get(node.token);
    if (ov) {
      node.voicing = ov;
      node.info = analyze(ov);
    }
  }
  return res;
}

const PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const EXAMPLES = [
  "A | A= | A===",
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

let currentPattern = "arp12";

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

    // ---- L1: solved voicings (with user-selectable alternatives) ----
    const result = solveWithOverrides(text);
    const voicingByEvent = new Map<number, string>();
    for (const node of result.nodes) {
      const v = node.voicing ? renderVoicing(node.voicing) : "(unplayable)";
      for (const ei of node.eventIndices) voicingByEvent.set(ei, v);
    }
    html += `<h2>L1 — solved voicings (EADGBE)</h2>
      <p style="color:var(--muted);font-size:13px;margin:.25rem 0 .75rem">Click an alternative to pin that voicing for the chord.</p>
      <div class="scroll"><table>
      <tr><th>bar:offset</th><th>chord</th><th>voicing (lo→hi)</th><th>source</th><th>alternatives (click to use)</th></tr>`;
    result.nodes.forEach((node) => {
      const firstEi = node.eventIndices[0]!;
      const ev = events[firstEi]!;
      const current = node.voicing ? renderVoicing(node.voicing) : "";
      const chips = node.alternates
        .slice(0, 6)
        .map((c) => {
          const vs = renderVoicing(c.voicing);
          const active = vs === current ? " active" : "";
          return `<span class="alt${active}" data-token="${esc(node.token)}" data-v="${vs}">${vs}</span>`;
        })
        .join(" ");
      const reset = overrides.has(node.token)
        ? ` <span class="alt reset" data-token="${esc(node.token)}" data-v="auto">auto ✕</span>`
        : "";
      const src = overrides.has(node.token)
        ? `<span style="color:var(--accent)">pinned</span>`
        : node.source === "library"
          ? `<span style="color:var(--accent)">library</span>`
          : `<span style="opacity:.6">solver</span>`;
      html += `<tr><td>${ev.bar}:${esc(ev.offset.toString())}</td>
        <td>${esc(node.token)}</td>
        <td class="pc">${esc(current || "(unplayable)")}</td>
        <td>${src}</td>
        <td>${chips}${reset}</td></tr>`;
    });
    html += `</table></div>`;
    if (result.warnings.length) {
      html += `<div class="err">${result.warnings.map(esc).join("\n")}</div>`;
    }

    // ---- L2: ASCII tab ----
    const opts = Object.keys(PATTERNS)
      .map((p) => `<option value="${p}"${p === currentPattern ? " selected" : ""}>${p}</option>`)
      .join("");
    const tab = buildTab(result, { pattern: currentPattern });
    html += `<h2>L2 — tab &nbsp;<select id="pattern">${opts}</select></h2>`;
    html += `<div class="scroll"><pre class="tab">${esc(renderTab(tab))}</pre></div>`;
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

// The pattern <select> is re-rendered each time, so delegate its change event.
output.addEventListener("change", (e) => {
  const t = e.target as HTMLElement;
  if (t.id === "pattern") {
    currentPattern = (t as HTMLSelectElement).value;
    render();
  }
});

// Click an alternative voicing to pin it (or "auto ✕" to clear the override).
output.addEventListener("click", (e) => {
  const chip = (e.target as HTMLElement).closest(".alt") as HTMLElement | null;
  if (!chip) return;
  const token = chip.getAttribute("data-token")!;
  const v = chip.getAttribute("data-v")!;
  if (v === "auto") overrides.delete(token);
  else overrides.set(token, parseVoicing(v));
  render();
});

// --- audio playback (§6) ---
const synth = new GuitarSynth();
const playBtn = document.getElementById("play") as HTMLButtonElement;
const stopBtn = document.getElementById("stop") as HTMLButtonElement;
const tempoEl = document.getElementById("tempo") as HTMLInputElement;
const tempoVal = document.getElementById("tempoVal") as HTMLSpanElement;
const loopEl = document.getElementById("loop") as HTMLInputElement;

tempoEl.addEventListener("input", () => {
  tempoVal.textContent = tempoEl.value;
});

playBtn.addEventListener("click", async () => {
  try {
    const tab = buildTab(solveWithOverrides(input.value), { pattern: currentPattern });
    const tempo = Number(tempoEl.value);
    const events = tabToPlayEvents(tab, { tempo });
    await synth.play(events, { loop: loopEl.checked, period: tabDurationSec(tab, { tempo }) });
    (window as unknown as { __diag?: string }).__diag = `played:${events.length}`;
  } catch (e) {
    // parse/solve errors are already shown in the output panel; audio/worklet
    // failures are surfaced here so they aren't silently swallowed.
    (window as unknown as { __diag?: string }).__diag = `error:${(e as Error).message}`;
    console.error("play failed:", e);
  }
});

stopBtn.addEventListener("click", () => synth.stop());

input.addEventListener("input", render);
render();
