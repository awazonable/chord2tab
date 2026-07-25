/**
 * Karplus-Strong string synth as an AudioWorklet processor (SPEC §6).
 *
 * Six independent plucked-string voices summed to the output. Data-free: each
 * voice is a noise-excited delay line with a lowpass feedback loop. Messages:
 *   { type:'pluck', string, freq, vel, bright }
 *   { type:'damp',  string }         — quick fade (mute / string-transition)
 *   { type:'dampAll' }               — rest / stop
 *
 * Shipped as a source string and loaded via a Blob URL so it works identically
 * in dev, in the production build, and under any GitHub Pages base path.
 */
export const KS_WORKLET = String.raw`
class KarplusStrong extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;
    this.voices = [];
    for (let i = 0; i < 6; i++) {
      this.voices.push({ buf: null, N: 0, pos: 0, loop: 0.996, gain: 0, target: 0, active: false, damp: false });
    }
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'pluck') this.pluck(m.string, m.freq, m.vel, m.bright);
      else if (m.type === 'damp') this.damp(m.string);
      else if (m.type === 'dampAll') { for (let i = 0; i < 6; i++) this.damp(i); }
    };
  }

  pluck(s, freq, vel, bright) {
    const N = Math.max(2, Math.floor(this.sr / freq));
    const buf = new Float32Array(N);
    // Excitation: white noise, one-pole lowpass by 'bright' (0..1; higher = brighter).
    const a = bright == null ? 0.5 : bright;
    let last = 0;
    const amp = vel == null ? 0.85 : vel;
    for (let i = 0; i < N; i++) {
      const w = Math.random() * 2 - 1;
      last = a * w + (1 - a) * last;
      buf[i] = last * amp;
    }
    const v = this.voices[s];
    v.buf = buf; v.N = N; v.pos = 0; v.active = true; v.gain = 1; v.target = 1; v.damp = false;
    // Lower notes ring longer.
    v.loop = Math.min(0.9992, 0.9945 + (1 - Math.min(1, freq / 660)) * 0.0045);
  }

  damp(s) {
    const v = this.voices[s];
    if (v.active) { v.target = 0; v.damp = true; }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const ch0 = out[0];
    const n = ch0.length;
    for (let i = 0; i < n; i++) {
      let mix = 0;
      for (let s = 0; s < 6; s++) {
        const v = this.voices[s];
        if (!v.active) continue;
        const cur = v.buf[v.pos];
        const nxt = (v.buf[v.pos] + v.buf[(v.pos + 1) % v.N]) * 0.5 * v.loop;
        v.buf[v.pos] = nxt;
        v.pos = (v.pos + 1) % v.N;
        const coeff = v.damp ? 0.004 : 0.08; // ~10ms damp fade
        v.gain += (v.target - v.gain) * coeff;
        mix += cur * v.gain;
        if (v.target === 0 && v.gain < 0.0002) v.active = false;
      }
      ch0[i] = mix * 0.3; // headroom for 6 voices
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch0);
    return true;
  }
}
registerProcessor('karplus-strong', KarplusStrong);
`;
