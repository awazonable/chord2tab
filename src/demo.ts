/** Interactive L0/L0.5/L1 explorer for GitHub Pages. */
import { parse, ParseError } from "./l0/parse.js";
import { parseChord, pitchClasses, DEGREES, type Chord } from "./l0_5/chord.js";
import { solve, type SolveResult } from "./l1/solver.js";
import { renderVoicing } from "./l1/format.js";
import { analyze, type Voicing } from "./l1/voicing.js";
import { buildTab, renderTab } from "./l2/tab.js";
import { PATTERNS } from "./l2/patterns.js";
import { GuitarSynth, tabToPlayEvents, tabDurationSec } from "./audio/synth.js";

/**
 * Voicing pins. Each pin is keyed by OCCURRENCE (a chord's bar:offset), so the
 * same chord in different places can use different voicings. `pinScope` decides
 * whether a click pins just this occurrence or every occurrence of the chord.
 */
type PinScope = "each" | "all";
let pinScope: PinScope = "each";
const pins = new Map<string, Voicing>(); // occId ("bar:offset") -> voicing
let tokenOccs = new Map<string, string[]>(); // token -> occIds, rebuilt per render

function parseVoicing(s: string): Voicing {
  return s.split("-").map((t) => (t === "x" ? null : Number(t)));
}

const occIdOf = (res: SolveResult, node: SolveResult["nodes"][number]): string => {
  const ev = res.events[node.eventIndices[0]!]!;
  return `${ev.bar}:${ev.offset}`;
};

/** Solve, index occurrences, then apply per-occurrence voicing pins. */
function solveWithOverrides(text: string): SolveResult {
  const res = solve(parse(text));
  tokenOccs = new Map();
  for (const node of res.nodes) {
    const id = occIdOf(res, node);
    const arr = tokenOccs.get(node.token) ?? [];
    arr.push(id);
    tokenOccs.set(node.token, arr);
    const v = pins.get(id);
    if (v) {
      node.voicing = v;
      node.info = analyze(v);
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
    const scopeSel = `<select id="pinscope">
      <option value="each"${pinScope === "each" ? " selected" : ""}>pin: this occurrence</option>
      <option value="all"${pinScope === "all" ? " selected" : ""}>pin: all same chords</option>
    </select>`;
    html += `<h2>L1 — solved voicings (EADGBE) &nbsp;${scopeSel}</h2>
      <p style="color:var(--muted);font-size:13px;margin:.25rem 0 .75rem">Click an alternative to pin it (<span class="alt lib" style="cursor:default">library</span> / <span class="alt solv" style="cursor:default">solver</span>); <span class="alt reset" style="cursor:default">↺</span> clears the pin.</p>
      <div class="scroll"><table>
      <tr><th>bar:offset</th><th>chord</th><th>voicing (lo→hi)</th><th>source</th><th>alternatives (click to use)</th></tr>`;
    result.nodes.forEach((node) => {
      const firstEi = node.eventIndices[0]!;
      const ev = events[firstEi]!;
      const id = `${ev.bar}:${ev.offset.toString()}`;
      const pinned = pins.has(id);
      const current = node.voicing ? renderVoicing(node.voicing) : "";
      const chips = node.alternates
        .slice(0, 6)
        .map((c) => {
          const vs = renderVoicing(c.voicing);
          const origin = c.origin === "library" ? "lib" : "solv";
          const active = vs === current ? (pinned ? " active pinned" : " active") : "";
          return `<span class="alt ${origin}${active}" data-occ="${id}" data-token="${esc(node.token)}" data-v="${vs}">${vs}</span>`;
        })
        .join(" ");
      const reset = pinned
        ? ` <span class="alt reset" data-occ="${id}" data-token="${esc(node.token)}" data-v="__reset__" title="clear pin">↺</span>`
        : "";
      const src = pinned
        ? `<span class="tag-pin">pinned</span>`
        : node.source === "library"
          ? `<span class="tag-lib">library</span>`
          : `<span class="tag-solv">solver</span>`;
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

// The <select>s are re-rendered each time, so delegate their change events.
output.addEventListener("change", (e) => {
  const t = e.target as HTMLElement;
  if (t.id === "pattern") {
    currentPattern = (t as HTMLSelectElement).value;
    render();
  } else if (t.id === "pinscope") {
    pinScope = (t as HTMLSelectElement).value as PinScope;
    render();
  }
});

// Click an alternative to pin it, or ↺ to clear. Scope decides whether it
// affects just this occurrence or every occurrence of the chord.
output.addEventListener("click", (e) => {
  const chip = (e.target as HTMLElement).closest(".alt") as HTMLElement | null;
  if (!chip || !chip.hasAttribute("data-occ")) return;
  const occ = chip.getAttribute("data-occ")!;
  const token = chip.getAttribute("data-token")!;
  const v = chip.getAttribute("data-v")!;
  const targets = pinScope === "all" ? (tokenOccs.get(token) ?? [occ]) : [occ];
  if (v === "__reset__") {
    for (const o of targets) pins.delete(o);
  } else {
    const voicing = parseVoicing(v);
    for (const o of targets) pins.set(o, voicing);
  }
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
