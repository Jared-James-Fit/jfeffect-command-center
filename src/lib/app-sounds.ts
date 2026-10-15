/**
 * Subtle in-app sounds — synthesized with Web Audio (no files).
 *
 * Rules that keep them from feeling spammy:
 *  - one toggle (per device, on by default); off = total silence
 *  - never when the tab is hidden (push handles that)
 *  - the same sound at most once every 2.5 s, any sound at most every 0.6 s
 *  - iOS: "ambient" audio session, so the ring/silent switch is respected and
 *    music isn't interrupted
 *  - browsers only allow audio after a tap, so the context unlocks on the
 *    first user gesture
 */

import { installMediaPlaybackSession, setBaseAudioSessionType } from "@/lib/audio-session";

export type AppSound =
  | "message" | "sent" | "notify" | "success" | "celebrate" | "reply"
  // Workout logging — short and soft, so a session full of them never nags.
  | "tick" | "set" | "exercise" | "pr" | "timer" | "milestone" | "error";

/**
 * Sounds that matter more win over a cue that just played (a set's "tock"
 * must not swallow the PR sparkle that lands 200 ms later).
 */
const PRIORITY: Partial<Record<AppSound, number>> = { pr: 2, celebrate: 2, milestone: 2, exercise: 1, timer: 1 };
/** Same-sound spacing: fast cues may repeat sooner than the 2.5 s default. */
const MIN_GAP: Partial<Record<AppSound, number>> = { tick: 90, set: 450, exercise: 900, error: 900 };

const KEY = "jf-app-sounds";
const listeners = new Set<(on: boolean) => void>();
let ctx: AudioContext | null = null;
const lastBy: Partial<Record<AppSound, number>> = {};
const openThreads = new Set<string>();

export function appSoundsEnabled(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAppSoundsEnabled(on: boolean) {
  try { window.localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private mode */ }
  listeners.forEach((l) => l(on));
  if (on) playAppSound("notify", { force: true });
}

export function subscribeAppSounds(fn: (on: boolean) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** A chat thread that plays its own message sounds (so the global listener stays quiet). */
export function registerOpenThread(id: string) {
  openThreads.add(id);
  return () => { openThreads.delete(id); };
}
export function isThreadOpen(id: string | null | undefined) {
  return !!id && openThreads.has(id);
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!C) return null;
    // "ambient": UI sounds mix with the user's music and follow the silent
    // switch. Media with sound holds "playback" over it (audio-session.ts).
    setBaseAudioSessionType("ambient");
    ctx = new C();
  }
  return ctx;
}

let unlockInstalled = false;
function installUnlock() {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  const unlock = () => {
    const c = getCtx();
    if (c && c.state !== "running") void c.resume().catch(() => {});
    if (c?.state === "running") {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    }
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}
if (typeof window !== "undefined") {
  installUnlock();
  installMediaPlaybackSession();
}

function tone(c: BaseAudioContext, out: AudioNode, t: number, freq: number, dur: number, vel: number, type: OscillatorType = "sine", to?: number) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** A short filtered noise burst (the "click" of a plate or a wood block). */
function click(c: BaseAudioContext, out: AudioNode, t: number, freq: number, dur: number, vel: number) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = 1.4;
  const g = c.createGain();
  g.gain.value = vel;
  src.connect(f).connect(g).connect(out);
  src.start(t);
}

const PATTERNS: Record<AppSound, (c: BaseAudioContext, out: AudioNode, t: number) => void> = {
  // Soft two-note "blip" — new message.
  message: (c, o, t) => { tone(c, o, t, 880, 0.18, 0.16); tone(c, o, t + 0.09, 1320, 0.26, 0.12); },
  // Quick upward tick — your message sent.
  sent: (c, o, t) => { tone(c, o, t, 600, 0.09, 0.08, "triangle", 900); },
  // Gentle single chime — something new (review, comment, request).
  notify: (c, o, t) => { tone(c, o, t, 1046.5, 0.45, 0.12); tone(c, o, t, 2093, 0.3, 0.03); },
  // Three rising notes — submitted / completed.
  success: (c, o, t) => { [659.25, 830.6, 987.8].forEach((f, i) => tone(c, o, t + i * 0.08, f, 0.3, 0.11)); },
  // Bright arpeggio + sparkle — PRs, level-ups.
  // Soft, low rising pair — Cleo's answer is in. Warm, never bright.
  reply: (c, o, t) => { tone(c, o, t, 440, 0.45, 0.05); tone(c, o, t + 0.12, 659.25, 0.6, 0.04); },
  celebrate: (c, o, t) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, o, t + i * 0.07, f, i === 3 ? 0.7 : 0.25, 0.12, "triangle"));
    for (let i = 0; i < 5; i++) tone(c, o, t + 0.3 + i * 0.045, 2093 * Math.pow(2, (i * 3) / 12), 0.25, 0.035);
  },
  // Barely-there tick — a checkbox or toggle.
  tick: (c, o, t) => { tone(c, o, t, 1400, 0.035, 0.035, "sine", 1100); },
  // A set logged: a soft, woody "tock" — felt more than heard.
  set: (c, o, t) => { tone(c, o, t, 330, 0.09, 0.09, "triangle", 220); click(c, o, t, 2400, 0.018, 0.05); },
  // An exercise's last set: the tock plus a warm rising pair.
  exercise: (c, o, t) => {
    tone(c, o, t, 330, 0.09, 0.08, "triangle", 220);
    tone(c, o, t + 0.07, 587.33, 0.28, 0.07);
    tone(c, o, t + 0.15, 880, 0.4, 0.06);
  },
  // A PR on a set: quick bright sparkle, short enough to sit on top of their music.
  pr: (c, o, t) => {
    [783.99, 1046.5, 1318.51].forEach((f, i) => tone(c, o, t + i * 0.06, f, i === 2 ? 0.55 : 0.2, 0.09, "triangle"));
    for (let i = 0; i < 4; i++) tone(c, o, t + 0.2 + i * 0.04, 2637 * Math.pow(2, (i * 4) / 12), 0.2, 0.025);
  },
  // Rest is over: two gentle chimes (iPhone web can't vibrate, so this is the cue).
  timer: (c, o, t) => { tone(c, o, t, 987.77, 0.35, 0.1); tone(c, o, t + 0.2, 1318.51, 0.5, 0.1); },
  // Milestone unlocked: a bell arpeggio over a soft chord.
  milestone: (c, o, t) => {
    [261.63, 329.63, 392].forEach((f) => tone(c, o, t, f, 1.1, 0.025));
    [1046.5, 1318.51, 1567.98, 2093].forEach((f, i) => tone(c, o, t + i * 0.09, f, 0.6, 0.06));
  },
  // Something failed: low, short, not alarming.
  error: (c, o, t) => { tone(c, o, t, 300, 0.12, 0.08, "triangle", 240); tone(c, o, t + 0.12, 220, 0.16, 0.07, "triangle"); },
};

/** Schedule one sound on any context (offline rendering for checks and previews). */
export function scheduleAppSound(c: BaseAudioContext, out: AudioNode, t: number, name: AppSound) {
  PATTERNS[name](c, out, t);
}

export type SoundGate = { lastAny: number; lastAnyPriority: number; lastBy: Partial<Record<AppSound, number>> };
/**
 * Spacing so sounds never pile up: any two at least 0.6 s apart unless the
 * later one matters more (a PR right after its set's tock still plays), and
 * the same sound again only after its own gap. Updates `gate` when it admits.
 */
export function admitSound(name: AppSound, now: number, gate: SoundGate): boolean {
  const priority = PRIORITY[name] ?? 0;
  const crowded = now - gate.lastAny < 600 && priority <= gate.lastAnyPriority;
  if (crowded || now - (gate.lastBy[name] ?? -Infinity) < (MIN_GAP[name] ?? 2500)) return false;
  gate.lastAny = now;
  gate.lastAnyPriority = priority;
  gate.lastBy[name] = now;
  return true;
}
const gate: SoundGate = { lastAny: 0, lastAnyPriority: 0, lastBy };

export function playAppSound(name: AppSound, opts: { force?: boolean } = {}) {
  if (typeof window === "undefined") return;
  if (!opts.force) {
    if (!appSoundsEnabled()) return;
    if (document.visibilityState === "hidden") return;
    if (!admitSound(name, Date.now(), gate)) return;
  }
  const c = getCtx();
  if (!c) return;
  if (c.state !== "running") {
    // Not unlocked yet (no tap so far) — try, but skip this sound.
    void c.resume().catch(() => {});
    return;
  }
  try {
    const out = c.createGain();
    out.gain.value = 0.9;
    out.connect(c.destination);
    PATTERNS[name](c, out, c.currentTime + 0.01);
  } catch { /* never let a sound break the UI */ }
}

/**
 * Play a longer synthesized piece (the achievement stings, achievement-music.ts)
 * through the same context, toggle and audio session as every other sound.
 * `build` schedules its notes from `t` and returns their length in seconds.
 * Returns stop(): a quick fade, used when the screen closes or sound is muted.
 */
export function playSynth(build: (c: AudioContext, out: AudioNode, t: number) => number): () => void {
  if (typeof window === "undefined" || !appSoundsEnabled() || document.visibilityState === "hidden") return () => {};
  const c = getCtx();
  if (!c) return () => {};
  if (c.state !== "running") {
    void c.resume().catch(() => {});
    return () => {};
  }
  let master: GainNode | null = null;
  try {
    const t = c.currentTime + 0.02;
    master = c.createGain();
    master.gain.value = 1;
    // A gentle limiter so stacked hits never clip on a phone speaker.
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    master.connect(limiter).connect(c.destination);
    const length = build(c, master, t);
    const m = master;
    window.setTimeout(() => { try { m.disconnect(); } catch { /* gone */ } }, (length + 1.5) * 1000);
  } catch { /* never let a sound break the UI */ }
  return () => {
    const m = master;
    master = null;
    if (!m) return;
    try {
      const now = c.currentTime;
      m.gain.cancelScheduledValues(now);
      m.gain.setValueAtTime(m.gain.value, now);
      m.gain.linearRampToValueAtTime(0, now + 0.25);
      window.setTimeout(() => { try { m.disconnect(); } catch { /* gone */ } }, 400);
    } catch { /* gone */ }
  };
}

/**
 * Cleo's "working on it" music: subtle lo-fi chill. Warm, soft major-seventh
 * chords (Dmaj7, Bm7, Gmaj7, Asus) that breathe in and out, with a few
 * rounded notes floating on top and a little space around them. No sharp
 * attacks, nothing bright, quiet enough to sit under a conversation: the
 * kind of thing that makes waiting feel nice. Starts after a short pause
 * (quick answers stay silent), fades in and out, and follows the sounds
 * toggle and the silent switch. Returns stop().
 */
const STEP = 0.6; // seconds per beat (a slow, easy pulse)
const STEPS_PER_CHORD = 8; // 4.8s a chord
// Open voicings in the middle (about 200-440Hz) so a phone speaker still
// carries them. No two notes a semitone apart anywhere: not inside a chord,
// not against the melody, not where one chord fades into the next (that
// beats and buzzes). The sevenths live in the melody, where they shimmer.
const THINKING_CHORDS: Array<{ pad: number[]; tones: number[] }> = [
  { pad: [220.0, 293.66, 369.99, 440.0], tones: [587.33, 739.99, 880.0, 1108.73] }, // Dmaj7: A3 D4 F#4 A4 | D5 F#5 A5 C#6
  { pad: [246.94, 293.66, 369.99, 440.0], tones: [493.88, 587.33, 739.99, 880.0] }, // Bm7: B3 D4 F#4 A4 | B4 D5 F#5 A5
  { pad: [196.0, 246.94, 293.66, 369.99], tones: [493.88, 587.33, 739.99, 987.77] }, // Gmaj7: G3 B3 D4 F#4 | B4 D5 F#5 B5
  { pad: [220.0, 293.66, 329.63, 440.0], tones: [440.0, 587.33, 659.25, 880.0] }, // Asus: A3 D4 E4 A4 | A4 D5 E5 A5
];

/** Small seeded random, so the music never repeats exactly but stays calm. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One soft, rounded note (like a felt piano): a gentle swell in, a long fade out. */
function softNote(c: BaseAudioContext, out: AudioNode, t: number, freq: number, vel: number) {
  for (const [mult, level] of [[1, 1], [2, 0.08]] as const) {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq * mult, t);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * level, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 2.7);
  }
}

/** A chord's warm bed: each note one steady sine, swelling in and fading out (chords overlap). */
function pad(c: BaseAudioContext, out: AudioNode, t: number, dur: number, freqs: number[]) {
  freqs.forEach((f, i) => {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(f, t);
    const g = c.createGain();
    const level = i === 0 ? 1 : 0.8; // the lowest note a touch stronger
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 1.6);
    g.gain.setValueAtTime(level, t + dur - 0.4);
    g.gain.linearRampToValueAtTime(0, t + dur + 1.8);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 1.9);
  });
}

/**
 * The music's signal chain and a scheduler: schedule(until) adds every beat
 * up to `until` (seconds, context time). Shared by the live sound and tests
 * (OfflineAudioContext).
 */
export function thinkingMusic(c: BaseAudioContext, dest: AudioNode, t0: number, seed = Date.now()) {
  const rand = seeded(seed);
  const bus = c.createGain();
  bus.gain.value = 1;
  // Round everything off: soft, warm, never bright on a phone speaker.
  const tone = c.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 2200;
  tone.Q.value = 0.3;
  bus.connect(tone).connect(dest);
  // A little space: a soft, low echo.
  const delay = c.createDelay(2);
  delay.delayTime.value = STEP * 0.75;
  const feedback = c.createGain();
  feedback.gain.value = 0.22;
  const wetTone = c.createBiquadFilter();
  wetTone.type = "lowpass";
  wetTone.frequency.value = 1200;
  const wet = c.createGain();
  wet.gain.value = 0.25;
  const melody = c.createGain();
  melody.gain.value = 0.034;
  melody.connect(bus);
  melody.connect(delay);
  delay.connect(wetTone).connect(wet).connect(bus);
  wetTone.connect(feedback).connect(delay);
  const bed = c.createGain();
  bed.gain.value = 0.0085;
  const bedTone = c.createBiquadFilter();
  bedTone.type = "lowpass";
  bedTone.frequency.value = 900;
  bed.connect(bedTone).connect(bus);

  let step = 0;
  let idx = 1;
  const schedule = (until: number) => {
    while (t0 + step * STEP < until) {
      const t = t0 + step * STEP;
      const inChord = step % STEPS_PER_CHORD;
      const chord = THINKING_CHORDS[Math.floor(step / STEPS_PER_CHORD) % THINKING_CHORDS.length];
      if (inChord === 0) pad(c, bed, t, STEP * STEPS_PER_CHORD, chord.pad);
      // A few notes a chord, mostly off the downbeat, so it floats rather than ticks.
      const play = inChord !== 0 && inChord !== STEPS_PER_CHORD - 1 && rand() < 0.3;
      if (play) {
        idx = Math.max(0, Math.min(chord.tones.length - 1, idx + (rand() < 0.5 ? -1 : 1)));
        // A tiny human lag so it never sounds mechanical.
        softNote(c, melody, t + rand() * 0.06, chord.tones[idx], 0.7 + rand() * 0.3);
      }
      step++;
    }
  };
  return { output: bus, schedule };
}

export function startThinkingSound(): () => void {
  if (typeof window === "undefined" || !appSoundsEnabled()) return () => {};
  const c = getCtx();
  if (!c) return () => {};
  if (c.state !== "running") void c.resume().catch(() => {});
  let master: GainNode | null = null;
  let timer: number | undefined;
  const begin = window.setTimeout(() => {
    if (c.state !== "running" || document.visibilityState === "hidden") return;
    try {
      const t0 = c.currentTime + 0.05;
      master = c.createGain();
      master.gain.setValueAtTime(0, t0);
      master.gain.linearRampToValueAtTime(1, t0 + 1.2);
      master.connect(c.destination);
      const music = thinkingMusic(c, master, t0);
      // Look ahead half a second, topped up every 150 ms.
      music.schedule(c.currentTime + 0.5);
      timer = window.setInterval(() => music.schedule(c.currentTime + 0.5), 150);
    } catch { /* never let a sound break the UI */ }
  }, 350);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(begin);
    window.clearInterval(timer);
    const m = master;
    master = null;
    if (!m) return;
    try {
      const t = c.currentTime;
      m.gain.cancelScheduledValues(t);
      m.gain.setValueAtTime(m.gain.value, t);
      m.gain.linearRampToValueAtTime(0, t + 0.6);
      // Notes already scheduled ring out under the fade, then everything is let go.
      window.setTimeout(() => { try { m.disconnect(); } catch { /* gone */ } }, 800);
    } catch { /* gone */ }
  };
}
