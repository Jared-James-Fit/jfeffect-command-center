/**
 * Chill lo-fi loop for the monthly League Recap, synthesized live with the
 * Web Audio API — no audio files, no licensing. Warm Rhodes-style chords
 * (Fmaj9 → Em7 → Dm9 → Cmaj7, ~78 bpm), a soft sub bass, a lazy kick +
 * brushed hat groove, a sparse bell melody and light vinyl crackle, all
 * through a low-pass "tape" filter.
 *
 * iOS only lets audio start inside a user gesture, so callers create the
 * player any time and call `start()` again from a tap if it was blocked.
 */

const BPM = 78;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

// MIDI note numbers.
const CHORDS: number[][] = [
  [53, 57, 60, 64, 67], // Fmaj9
  [52, 55, 59, 62, 66], // Em7(9)
  [50, 53, 57, 60, 64], // Dm9
  [48, 52, 55, 59, 62], // Cmaj9
];
const BASS = [41, 40, 38, 36];
// Bell melody: [bar, beat, midi]
const MELODY: [number, number, number][] = [
  [0, 1.5, 76], [0, 2.5, 72], [0, 3.5, 74],
  [1, 2, 71], [1, 3, 74],
  [2, 1.5, 72], [2, 2.5, 69], [2, 3.5, 72],
  [3, 2, 67], [3, 3.25, 71],
];

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export type RecapSfx = "whoosh" | "tick" | "pop" | "chime" | "sparkle" | "thud" | "fanfare" | "roll" | "rise" | "fall" | "swish" | "shutter";

export type RecapMusic = {
  start: () => Promise<boolean>;
  /** One-shot sound effect layered over the music (silent when muted). */
  sfx: (name: RecapSfx, opts?: { pitch?: number; gain?: number; dur?: number }) => void;
  setMuted: (m: boolean) => void;
  duck: (on: boolean) => void;
  stop: () => void;
};

export function createRecapMusic(volume = 0.32): RecapMusic | null {
  if (typeof window === "undefined") return null;
  const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return null;

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let fx: GainNode | null = null;
  let bus: GainNode | null = null;
  let timer: number | null = null;
  let nextBar = 0;
  let barIndex = 0;
  let muted = false;
  let ducked = false;
  let stopped = false;
  let crackle: AudioBufferSourceNode | null = null;

  const target = () => (muted ? 0 : ducked ? volume * 0.45 : volume);

  function setup() {
    ctx = new Ctx() as AudioContext;
    master = ctx.createGain();
    master.gain.value = 0;
    // Tape-ish tone: gentle low-pass + soft compression.
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    lp.Q.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 3;
    bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(lp).connect(comp).connect(master).connect(ctx.destination);
    // Effects skip the tape filter so they stay crisp, and don't duck.
    fx = ctx.createGain();
    fx.gain.value = muted ? 0 : 0.55;
    fx.connect(ctx.destination);

    // Wow/flutter on the filter for that warm, slightly wobbly feel.
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.18;
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();

    // Vinyl crackle loop.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.6 : (Math.random() * 2 - 1) * 0.012;
    crackle = ctx.createBufferSource();
    crackle.buffer = buf;
    crackle.loop = true;
    const cg = ctx.createGain();
    cg.gain.value = 0.35;
    crackle.connect(cg).connect(bus);
    crackle.start();
  }

  function keys(t: number, midi: number, dur: number, vel: number) {
    const c = ctx!;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.03);
    g.gain.exponentialRampToValueAtTime(vel * 0.45, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = hz(midi);
    for (const [type, mult, detune, amp] of [["sine", 1, -4, 1], ["triangle", 1, 5, 0.35], ["sine", 2, 0, 0.12]] as const) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f * mult;
      o.detune.value = detune;
      const og = c.createGain();
      og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    g.connect(bus!);
  }

  function bass(t: number, midi: number, dur: number) {
    const c = ctx!;
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = hz(midi);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function kick(t: number) {
    const c = ctx!;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(bus!);
    o.start(t);
    o.stop(t + 0.35);
  }

  function noiseHit(t: number, dur: number, vel: number, freq: number) {
    const c = ctx!;
    const len = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource();
    s.buffer = buf;
    const hp = c.createBiquadFilter();
    hp.type = "bandpass";
    hp.frequency.value = freq;
    hp.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(hp).connect(g).connect(bus!);
    s.start(t);
  }

  function bell(t: number, midi: number) {
    const c = ctx!;
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = hz(midi);
    const o2 = c.createOscillator();
    o2.type = "sine";
    o2.frequency.value = hz(midi) * 3.01;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    const g2 = c.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(bus!);
    o.start(t); o2.start(t);
    o.stop(t + 1.5); o2.stop(t + 1.5);
  }

  function scheduleBar(t: number, bar: number) {
    const ci = bar % 4;
    const swing = BEAT * 0.08;
    // Chords: strum on 1, re-hit softly on the "and" of 3.
    CHORDS[ci].forEach((m, k) => keys(t + k * 0.018, m, BAR * 0.9, 0.07));
    CHORDS[ci].slice(1, 4).forEach((m, k) => keys(t + BEAT * 2.5 + swing + k * 0.015, m, BEAT * 1.4, 0.04));
    bass(t, BASS[ci], BEAT * 1.8);
    bass(t + BEAT * 2.5 + swing, BASS[ci] + 7, BEAT * 1.2);
    // Groove fades in after the first two bars.
    if (bar >= 2) {
      kick(t);
      kick(t + BEAT * 2.5 + swing);
      noiseHit(t + BEAT, 0.18, 0.12, 1800); // soft snare/rim
      noiseHit(t + BEAT * 3, 0.18, 0.12, 1800);
      for (let h = 0; h < 8; h++) noiseHit(t + h * (BEAT / 2) + (h % 2 ? swing : 0), 0.05, h % 2 ? 0.025 : 0.04, 7000);
    }
    if (bar >= 4) for (const [b, beat, m] of MELODY) if (b === ci) bell(t + beat * BEAT, m);
  }

  function pump() {
    if (!ctx || stopped) return;
    while (nextBar < ctx.currentTime + 1.2) {
      scheduleBar(nextBar, barIndex++);
      nextBar += BAR;
    }
  }

  function ramp(to: number, secs: number) {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(to, now + secs);
  }


  function tone(t: number, freq: number, dur: number, vel: number, type: OscillatorType = "sine", glideTo?: number) {
    const c = ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(fx!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noise(t: number, dur: number, vel: number, type: BiquadFilterType, from: number, to?: number, q = 1) {
    const c = ctx!;
    const len = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource();
    s.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(fx!);
    s.start(t);
  }

  function playSfx(name: RecapSfx, o: { pitch?: number; gain?: number; dur?: number } = {}) {
    if (!ctx || !fx || ctx.state !== "running" || muted || stopped) return;
    const t = ctx.currentTime + 0.01;
    const v = o.gain ?? 1;
    const p = o.pitch ?? 1;
    switch (name) {
      case "whoosh": noise(t, 0.45, 0.35 * v, "bandpass", 400, 3200, 0.9); break;
      case "swish": noise(t, 0.28, 0.22 * v, "bandpass", 2400, 900, 1.2); break;
      case "tick": tone(t, 1800 * p, 0.05, 0.08 * v, "triangle"); break;
      case "pop": tone(t, 520 * p, 0.16, 0.35 * v, "sine", 980 * p); tone(t, 1300 * p, 0.08, 0.08 * v, "triangle"); break;
      case "chime": [0, 4, 7].forEach((st, i) => tone(t + i * 0.06, 880 * p * Math.pow(2, st / 12), 0.9, 0.12 * v, "sine")); break;
      case "sparkle": for (let i = 0; i < 6; i++) tone(t + i * 0.045, 2000 * p * Math.pow(2, (i * 3) / 12), 0.35, 0.05 * v, "sine"); break;
      case "thud": tone(t, 140 * p, 0.35, 0.5 * v, "sine", 50); noise(t, 0.12, 0.12 * v, "lowpass", 900); break;
      case "rise": tone(t, 440 * p, 0.35, 0.14 * v, "triangle", 880 * p); tone(t + 0.18, 1320 * p, 0.5, 0.08 * v, "sine"); break;
      case "fall": tone(t, 520 * p, 0.45, 0.12 * v, "triangle", 300 * p); break;
      case "roll": {
        const dur = o.dur ?? 0.9;
        for (let k = 0, tt = 0; tt < dur; k++, tt += 0.055) noise(t + tt, 0.07, (0.05 + 0.12 * (tt / dur)) * v, "bandpass", 1600, undefined, 0.7);
        break;
      }
      case "fanfare": {
        const notes = [0, 4, 7, 12];
        notes.forEach((st, i) => {
          const f = 523.25 * p * Math.pow(2, st / 12);
          tone(t + i * 0.09, f, i === 3 ? 1.4 : 0.3, 0.13 * v, "sawtooth");
          tone(t + i * 0.09, f, i === 3 ? 1.4 : 0.3, 0.1 * v, "triangle");
        });
        noise(t + 0.27, 1.2, 0.08 * v, "highpass", 6000); // cymbal shimmer
        break;
      }
      case "shutter": noise(t, 0.05, 0.4 * v, "highpass", 2500); noise(t + 0.07, 0.06, 0.3 * v, "highpass", 2000); break;
    }
  }

  return {
    sfx: playSfx,
    async start() {
      if (stopped) return false;
      try {
        if (!ctx) setup();
        if (ctx!.state !== "running") await ctx!.resume();
        if (ctx!.state !== "running") return false;
        if (timer == null) {
          nextBar = ctx!.currentTime + 0.1;
          pump();
          timer = window.setInterval(pump, 250);
          ramp(target(), 2.5);
        }
        return true;
      } catch {
        return false;
      }
    },
    setMuted(m) {
      muted = m;
      ramp(target(), 0.4);
      if (fx && ctx) fx.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.05);
    },
    duck(on) { ducked = on; ramp(target(), 0.5); },
    stop() {
      stopped = true;
      if (timer != null) window.clearInterval(timer);
      timer = null;
      const c = ctx;
      if (!c) return;
      ramp(0, 0.8);
      window.setTimeout(() => { try { crackle?.stop(); } catch {} void c.close().catch(() => {}); }, 900);
    },
  };
}

const MUTE_KEY = "jf-recap-music-muted";
export function readRecapMuted(): boolean {
  try { return window.localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}
export function writeRecapMuted(m: boolean) {
  try { window.localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch {}
}
