/**
 * Achievement stings — short pieces of gym music for the moments that earn
 * one, synthesized live with Web Audio: no files, so nothing to download (zero
 * data, works offline in a basement gym), and this module only loads when a
 * recap or milestone opens.
 *
 *  - "pr"        a new record: one bar of build (dark minor stabs, hats, a
 *                snare roll and a riser), then the drop — crash, 808 and a
 *                F → G → C lift into a bright major chord with a sparkle (~4.5 s)
 *  - "workout"   a finished workout: one bar, G → C over an 808 and claps (~2.4 s)
 *  - "legendary" a prestige milestone: the "pr" sting
 *
 * Built like a trap / hip-hop hit at 140 BPM because that's what's on in a
 * powerlifting gym. Short on purpose: it lands, then gets out of the way of
 * the athlete's own music (the "ambient" audio session mixes with it rather
 * than pausing it, and the silent switch silences it). Everything is
 * scheduled up front on the audio thread — no timers, no main-thread work.
 */
import { playSynth } from "@/lib/app-sounds";

export type StingKind = "pr" | "workout" | "legendary";

const BPM = 140;
const BEAT = 60 / BPM;

// Note frequencies used below.
const N = {
  C2: 65.41, F2: 87.31, G2: 98.0, A2: 110.0,
  A3: 220.0, C4: 261.63, E4: 329.63, G4: 392.0, B4: 493.88,
  F4: 349.23, A4: 440.0, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99,
  C6: 1046.5, E6: 1318.51, G6: 1567.98, C7: 2093.0,
};

// White noise for the drums, made once when this module loads (it is
// preloaded while the workout is open), so a reveal never spends time on it.
const NOISE = new Float32Array(48000);
for (let i = 0; i < NOISE.length; i++) NOISE[i] = Math.random() * 2 - 1;
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(c: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(c);
  if (!buf) {
    buf = c.createBuffer(1, NOISE.length, c.sampleRate);
    buf.copyToChannel(NOISE, 0);
    noiseCache.set(c, buf);
  }
  return buf;
}

function filter(c: BaseAudioContext, out: AudioNode, type: BiquadFilterType, freq: number, q = 0.7) {
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.connect(out);
  return f;
}

/** A noise burst into `into` (a filter shared by every hit of that drum). */
function noiseHit(c: BaseAudioContext, into: AudioNode, t: number, opts: { vel: number; decay: number; attack?: number }) {
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(opts.vel, t + (opts.attack ?? 0.002));
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay);
  src.connect(g).connect(into);
  // A random start point varies short hits; long ones need the whole buffer.
  src.start(t, opts.decay < 0.5 ? Math.random() * 0.8 : 0);
  src.stop(t + opts.decay + 0.05);
}

/** The drum kit's shared filters (one per drum, not one per hit). */
type Kit = { out: AudioNode; click: AudioNode; clap: AudioNode; hat: AudioNode; crash: AudioNode };
function kit(c: BaseAudioContext, out: AudioNode): Kit {
  return {
    out,
    click: filter(c, out, "highpass", 3500),
    clap: filter(c, out, "bandpass", 1400, 0.9),
    hat: filter(c, out, "highpass", 8000),
    crash: filter(c, out, "highpass", 5000),
  };
}

/** 808 kick: a sine dropping from ~150 Hz to the floor, with a little click on top. */
function kick(c: BaseAudioContext, k: Kit, t: number, vel = 1) {
  const out = k.out;
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.13);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.9 * vel, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.55);
  noiseHit(c, k.click, t, { vel: 0.12 * vel, decay: 0.012 });
}

/** Clap: three quick noise bursts and a short tail, band-passed. */
function clap(c: BaseAudioContext, k: Kit, t: number, vel = 1) {
  for (const [dt, decay] of [[0, 0.02], [0.011, 0.02], [0.022, 0.16]] as const) {
    noiseHit(c, k.clap, t + dt, { vel: 0.32 * vel, decay });
  }
}

function hat(c: BaseAudioContext, k: Kit, t: number, vel = 1) {
  noiseHit(c, k.hat, t, { vel: 0.08 * vel, decay: 0.04 });
}

function crash(c: BaseAudioContext, k: Kit, t: number) {
  noiseHit(c, k.crash, t, { vel: 0.14, decay: 1 });
}

/** A rising noise sweep into the drop. */
function riser(c: BaseAudioContext, out: AudioNode, t: number, dur: number) {
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 3;
  f.frequency.setValueAtTime(400, t);
  f.frequency.exponentialRampToValueAtTime(7000, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.05);
}

/** 808 bass note. */
function bass(c: BaseAudioContext, out: AudioNode, t: number, freq: number, dur: number, vel = 1) {
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(freq * 1.5, t);
  o.frequency.exponentialRampToValueAtTime(freq, t + 0.04);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.5 * vel, t + 0.01);
  g.gain.setValueAtTime(0.5 * vel, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** A brassy synth chord: two detuned saws per note through a filter that opens then closes. */
function stab(c: BaseAudioContext, out: AudioNode, t: number, notes: number[], dur: number, vel = 1, bright = 1) {
  const f = c.createBiquadFilter();
  f.type = "lowpass";
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(350, t);
  f.frequency.exponentialRampToValueAtTime(900 + 2600 * bright, t + 0.03);
  f.frequency.exponentialRampToValueAtTime(700, t + Math.max(0.1, dur));
  const g = c.createGain();
  const level = (0.11 * vel) / Math.sqrt(notes.length);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.006);
  g.gain.exponentialRampToValueAtTime(level * 0.45, t + 0.18);
  g.gain.setValueAtTime(level * 0.45, t + Math.max(0.2, dur - 0.08));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
  f.connect(g).connect(out);
  for (const freq of notes) {
    for (const cents of [-9, 9]) {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.4);
    }
  }
}

/** A bell for the sparkle: sine plus a quiet octave, quick attack, ringing decay. */
function bell(c: BaseAudioContext, out: AudioNode, t: number, freq: number, vel = 1) {
  for (const [mult, level, decay] of [[1, 0.06, 0.9], [2, 0.012, 0.5]] as const) {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = freq * mult;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level * vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay + 0.05);
  }
}

/** The mix bus: phone speakers turn highs harsh, so everything is rounded off. */
function bus(c: BaseAudioContext, dest: AudioNode) {
  const tone = c.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 9000;
  // Level: a moment, not a jump-scare — about 9 dB above the app's chimes
  // (-23 dB RMS vs -31 for "celebrate"), peaks well under the limiter.
  const g = c.createGain();
  g.gain.value = 0.22;
  g.connect(tone).connect(dest);
  return g;
}

/**
 * A sting as parts to schedule: the first now, the rest a moment later (the
 * PR drop starts 1.7 s in), so no single frame of the reveal pays for it all.
 */
function stingParts(c: BaseAudioContext, dest: AudioNode, t0: number, kind: StingKind): { parts: Array<() => void>; length: number } {
  const out = bus(c, dest);
  const k = kit(c, out);
  const at = (beat: number) => t0 + beat * BEAT;
  if (kind === "workout") {
    // One bar: G → C over an 808, claps on 2 and 4.
    return {
      length: BEAT * 4.5 + 0.8,
      parts: [() => {
        for (let b = 0; b < 4; b += 0.5) hat(c, k, at(b), b % 1 ? 0.6 : 1);
        kick(c, k, at(0));
        kick(c, k, at(1.5), 0.8);
        kick(c, k, at(2.5));
        clap(c, k, at(1));
        clap(c, k, at(3));
        bass(c, out, at(0), N.G2, BEAT * 2.2);
        bass(c, out, at(2.5), N.C2, BEAT * 2.5);
        stab(c, out, at(0), [N.G4, N.B4, N.D5], BEAT * 0.9, 0.9, 0.8);
        stab(c, out, at(1.5), [N.G4, N.B4, N.D5], BEAT * 0.4, 0.7, 0.7);
        stab(c, out, at(2.5), [N.C5, N.E5, N.G5], BEAT * 2, 1, 1);
        [N.C6, N.E6, N.G6].forEach((f, i) => bell(c, out, at(2.5) + 0.12 + i * 0.07, f));
      }],
    };
  }
  // "pr" / "legendary": a bar of build, then the drop.
  return {
    length: BEAT * 9 + 0.8,
    parts: [
      () => {
        for (let b = 0; b < 3; b += 0.5) hat(c, k, at(b), 0.35 + (b / 3) * 0.5);
        kick(c, k, at(0), 0.9);
        kick(c, k, at(1.5), 0.7);
        stab(c, out, at(0), [N.A3, N.C4, N.E4], BEAT * 0.45, 0.85, 0.45);
        stab(c, out, at(1.5), [N.A3, N.C4, N.E4], BEAT * 0.3, 0.7, 0.4);
        stab(c, out, at(2.5), [N.A3, N.C4, N.E4], BEAT * 0.3, 0.75, 0.5);
        riser(c, out, at(2), BEAT * 2);
        for (let i = 0; i < 4; i++) clap(c, k, at(3 + i * 0.25), 0.35 + i * 0.18);
      },
      () => {
        // The drop.
        crash(c, k, at(4));
        kick(c, k, at(4), 1.1);
        kick(c, k, at(5.5), 0.85);
        kick(c, k, at(6.5), 1.1);
        clap(c, k, at(5));
        clap(c, k, at(7));
        for (let b = 4; b < 8; b += 0.25) hat(c, k, at(b), b % 1 === 0 ? 1 : b % 0.5 === 0 ? 0.7 : 0.45);
        bass(c, out, at(4), N.F2, BEAT * 1.4);
        bass(c, out, at(5.5), N.G2, BEAT * 0.9);
        bass(c, out, at(6.5), N.C2, BEAT * 2.6, 1.1);
        stab(c, out, at(4), [N.F4, N.A4, N.C5], BEAT * 1.2, 1, 0.9);
        stab(c, out, at(5.5), [N.G4, N.B4, N.D5], BEAT * 0.85, 1, 0.95);
        stab(c, out, at(6.5), [N.C5, N.E5, N.G5, N.C6], BEAT * 2.6, 1.1, 1.1);
        [N.C6, N.E6, N.G6, N.C7].forEach((f, i) => bell(c, out, at(6.5) + 0.1 + i * 0.075, f, i === 3 ? 1.2 : 1));
      },
    ],
  };
}

/** Schedules a whole sting from `t0`; returns its length in seconds (offline rendering, tests). */
export function scheduleSting(c: BaseAudioContext, dest: AudioNode, t0: number, kind: StingKind): number {
  const { parts, length } = stingParts(c, dest, t0, kind);
  parts.forEach((p) => p());
  return length;
}

/** Play a sting now (sound toggle, silent switch and audio session respected). Returns stop(). */
export function playSting(kind: StingKind): () => void {
  let later: number | undefined;
  const stop = playSynth((c, out, t) => {
    const { parts, length } = stingParts(c, out, t, kind);
    parts[0]();
    // The rest well before it's due (the drop is 1.7 s away), in its own task.
    if (parts.length > 1) later = window.setTimeout(() => parts.slice(1).forEach((p) => p()), 500);
    return length;
  });
  return () => {
    window.clearTimeout(later);
    stop();
  };
}

/**
 * Run every sting once into a tiny silent offline buffer, so the code is warm
 * (compiled) before the real reveal: on a budget phone the first, cold run is
 * twice the cost of a warm one. Call from idle time; never makes a sound.
 */
export function warmUpStings(): void {
  try {
    const Offline = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    if (!Offline) return;
    const c: BaseAudioContext = new Offline(1, 128, 44100);
    scheduleSting(c, c.destination, 0, "workout");
    scheduleSting(c, c.destination, 0, "pr");
  } catch { /* warm-up only */ }
}
