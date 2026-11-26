/**
 * The app's sounds: original, synthesized with Web Audio (no files, nothing
 * downloaded, nothing licensed, works offline in a basement gym), played
 * through one engine that every screen reaches through feedback() (feedback.ts).
 *
 * Rules that keep them premium rather than noisy:
 *  - two settings, this device's own: on / off (on by default) and a volume
 *    (DEFAULT_SOUND_VOLUME); off = total silence;
 *  - never while the app is hidden (push handles that);
 *  - one master bus with a gentle limiter, so stacked cues never clip a
 *    phone speaker, and the volume moves every sound together (stings and the
 *    Rankings music included);
 *  - the cues people hear most (a set, a confirm, a PR…) are rendered once
 *    into buffers in idle time (`preloadAppSounds`), so playing one is a
 *    single buffer source: no graph built mid-tap, near-instant;
 *  - priority: two cues in the same moment (`CROWD_MS`) play only the one
 *    that matters more, and a cue that matters more fades out a lesser one
 *    still ringing (a PR over its set's pop, an exercise's chime over a tick);
 *    each cue also has its own spacing, so a burst is one sound;
 *  - iOS: the "ambient" audio session, so the ring / silent switch is
 *    respected and the athlete's music, podcast or AirPods keep playing (Web
 *    Audio never takes Android's audio focus either);
 *  - browsers only allow audio after a tap, so the context wakes on every tap.
 */

import { installMediaPlaybackSession, setBaseAudioSessionType } from "@/lib/audio-session";

export type AppSound =
  | "message" | "sent" | "notify" | "success" | "celebrate" | "reply"
  // Workout logging: short and soft, so a session full of them never nags.
  | "tick" | "confirm" | "set" | "exercise" | "pr" | "timer" | "rest" | "milestone" | "error" | "warning"
  // Footage sent, a workout finished (the JF Effect signature).
  | "upload" | "workout"
  // Rankings: switching boards, two lifters squaring up, a lifter's card opening.
  | "whoosh" | "clash" | "clang";

/**
 * What matters more wins the moment (higher first): a PR over the set's pop
 * that carried it, the workout's signature over anything, a confirm tick
 * never over anything.
 */
export const SOUND_PRIORITY: Record<AppSound, number> = {
  tick: 0, confirm: 0,
  sent: 1, message: 1, notify: 1, reply: 1, whoosh: 1, clang: 1,
  set: 2, warning: 2,
  error: 3, clash: 3,
  exercise: 4, upload: 4, success: 4,
  rest: 5, timer: 5,
  pr: 7, celebrate: 7,
  workout: 8,
  milestone: 9,
};
/** Same-sound spacing: fast cues may repeat sooner than the 2.5 s default. */
const MIN_GAP: Partial<Record<AppSound, number>> = {
  tick: 90, confirm: 90, set: 450, exercise: 900, upload: 1200, pr: 1500, error: 900, warning: 900,
  whoosh: 350, clang: 700, clash: 900,
};
/** How long each cue rings (s): what a stronger cue fades out, and the render length. */
export const SOUND_SECONDS: Record<AppSound, number> = {
  tick: 0.09, confirm: 0.08, set: 0.16, exercise: 0.62, upload: 0.72, pr: 1.0, timer: 0.95, rest: 1.25,
  milestone: 1.25, error: 0.4, warning: 0.32, message: 0.5, sent: 0.18, notify: 0.6, success: 0.7,
  celebrate: 1.2, reply: 0.9, whoosh: 0.32, clash: 0.6, clang: 0.6, workout: 1.35,
};
/** Two cues within this long are "the same moment": only the one that matters more plays. */
export const CROWD_MS = 350;

const KEY = "jf-app-sounds";
const VOLUME_KEY = "jf-app-sounds-volume";
/** Out of the box: on, at a level that sits under the athlete's own music. */
export const DEFAULT_SOUND_VOLUME = 0.8;
const listeners = new Set<(on: boolean) => void>();
const volumeListeners = new Set<(v: number) => void>();
let ctx: AudioContext | null = null;
const lastBy: Partial<Record<AppSound, number>> = {};
const openThreads = new Set<string>();

/**
 * The settings as last set in this session: storage is where they're kept
 * across sessions, but where it can't be written (a private window) the
 * switch and the slider still work until the app closes.
 */
let enabledNow: boolean | null = null;
let volumeNow: number | null = null;

export function appSoundsEnabled(): boolean {
  if (enabledNow != null) return enabledNow;
  try {
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAppSoundsEnabled(on: boolean) {
  enabledNow = on;
  try { window.localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* private mode */ }
  listeners.forEach((l) => l(on));
  if (on) playAppSound("set", { force: true });
}

export function subscribeAppSounds(fn: (on: boolean) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The volume, 0–1 (this device's own; DEFAULT_SOUND_VOLUME until it's moved). */
export function appSoundVolume(): number {
  if (volumeNow != null) return volumeNow;
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw == null || raw === "") return DEFAULT_SOUND_VOLUME;
    const v = Number(raw);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_SOUND_VOLUME;
  } catch {
    return DEFAULT_SOUND_VOLUME;
  }
}

/**
 * Set the volume (0–1). The master bus follows at once (a sting or the
 * Rankings music already playing too); `preview` plays a set's pop at the new
 * level, for a slider let go.
 */
export function setAppSoundVolume(v: number, opts: { preview?: boolean } = {}) {
  const next = Math.min(1, Math.max(0, Number.isFinite(v) ? v : DEFAULT_SOUND_VOLUME));
  volumeNow = next;
  try { window.localStorage.setItem(VOLUME_KEY, String(Math.round(next * 100) / 100)); } catch { /* private mode */ }
  applyMasterVolume();
  volumeListeners.forEach((l) => l(next));
  if (opts.preview && next > 0) playAppSound("set", { force: true });
}

export function subscribeAppSoundVolume(fn: (v: number) => void) {
  volumeListeners.add(fn);
  return () => { volumeListeners.delete(fn); };
}

/**
 * The slider's 0–1 as the bus's gain: a perceptual curve (our ears hear
 * loudness roughly logarithmically, so a linear gain would do all its work in
 * the bottom of the slider), 0 silent, the default a touch under the levels
 * the cues were tuned at, the top a little over them.
 */
export function volumeToGain(v: number): number {
  if (!(v > 0)) return 0;
  return 1.15 * Math.pow(Math.min(1, v), 1.6);
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
    try {
      ctx = new C({ latencyHint: "interactive" });
    } catch {
      ctx = new C();
    }
  }
  return ctx;
}

// ── the master bus ─────────────────────────────────────────────────────────

let master: { c: AudioContext; gain: GainNode; input: AudioNode; makeup: number } | null = null;

/** The safety limiter: only acts within a few dB of full scale. */
const LIMITER = { threshold: -4, knee: 0, ratio: 20, attack: 0.001, release: 0.08 };
/**
 * The gain a DynamicsCompressor adds by itself (the Web Audio spec's fixed
 * "makeup gain": the curve's level at 0 dBFS, inverted, to the power 0.6;
 * +2.3 dB for LIMITER), taken back out so the volume means what it says.
 */
export function limiterMakeup(l: { threshold: number; knee: number; ratio: number } = LIMITER): number {
  const fullRangeDb = l.threshold + (0 - l.threshold) / l.ratio;
  return Math.pow(Math.pow(10, -fullRangeDb / 20), 0.6);
}

/**
 * Everything the app plays goes through here: the volume, then a limiter that
 * only acts near full scale (a PR's sparkle over a sting's tail never clips).
 */
function masterBus(c: AudioContext): AudioNode {
  if (master && master.c === c) return master.input;
  const gain = c.createGain();
  let makeup = 1;
  try {
    if (typeof c.createDynamicsCompressor === "function") {
      const lim = c.createDynamicsCompressor();
      lim.threshold.value = LIMITER.threshold;
      lim.knee.value = LIMITER.knee;
      lim.ratio.value = LIMITER.ratio;
      lim.attack.value = LIMITER.attack;
      lim.release.value = LIMITER.release;
      gain.connect(lim).connect(c.destination);
      makeup = limiterMakeup();
    } else {
      gain.connect(c.destination);
    }
  } catch {
    try { gain.connect(c.destination); } catch { /* gone */ }
  }
  gain.gain.value = volumeToGain(appSoundVolume()) / makeup;
  master = { c, gain, input: gain, makeup };
  return gain;
}

/** For checks: the master bus's gain right now (null before any sound). */
export function appSoundBusGain(): number | null {
  return master ? master.gain.gain.value * master.makeup : null;
}

/**
 * Move the bus to the volume. A short linear ramp (no click under music
 * that's playing), defined by time: Chromium only advances setTargetAtTime
 * while audio flows through the node, so an idle bus kept the old level and
 * the next cue's start played at the volume before.
 */
function applyMasterVolume() {
  if (!master) return;
  try {
    const target = volumeToGain(appSoundVolume()) / master.makeup;
    const now = master.c.currentTime;
    const p = master.gain.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(target, now + 0.04);
  } catch { /* gone */ }
}

/**
 * Keeping the context playing. Browsers start it suspended until a tap, and
 * iPhones suspend it again ("interrupted") whenever the app goes to the
 * background, a call comes in or Spotify takes over: from then on every sound
 * was silent until a reload, because the tap listener had removed itself after
 * the first unlock (and it listened for pointerdown, which a touch screen
 * doesn't count as the tap that may start audio). Now every tap, key or return
 * to the app tries again; while it's playing that's a cheap state check.
 */
let unlockInstalled = false;
function wake(c: AudioContext) {
  if (c.state === "running") return;
  void c.resume().catch(() => {});
  // Older iPhones only open the context once a sound actually starts inside the tap.
  try {
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, c.sampleRate);
    src.connect(c.destination);
    src.start(0);
  } catch { /* fine */ }
}
function installUnlock() {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  const unlock = () => {
    const c = getCtx();
    if (c) {
      wake(c);
      // the first tap is also when the hot cues get rendered (in idle time, once)
      preloadAppSounds();
    }
  };
  // The events a browser accepts as "the person tapped" for starting audio.
  for (const type of ["touchend", "pointerup", "click", "keydown"]) window.addEventListener(type, unlock, true);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && ctx) void ctx.resume().catch(() => {});
    });
  }
}
if (typeof window !== "undefined") {
  installUnlock();
  installMediaPlaybackSession();
}

/**
 * Let the UI sound engine go quiet before something switches the page's audio
 * to "playback" (a demo video starting): changing the category under a
 * running AudioContext is the riskiest thing an iPhone web view does with
 * audio. The next tap wakes it again (`wake`), so nothing is lost.
 */
export async function quietAppSounds(): Promise<void> {
  if (ctx && ctx.state === "running") await ctx.suspend().catch(() => {});
}

/** How late a sound may still play once a suspended context comes back. */
const LATE_MS = 400;

/**
 * Run `play` on a running context: now, or (when it was suspended) as soon as
 * it resumes, if that's quick. A sound used to be dropped whenever the
 * context needed waking first, so the first sound after any pause never played.
 */
function whenRunning(play: (c: AudioContext) => void): boolean {
  const c = getCtx();
  if (!c) return false;
  if (c.state === "running") {
    play(c);
    return true;
  }
  const asked = Date.now();
  wake(c);
  void c.resume().then(
    () => {
      if (c.state === "running" && Date.now() - asked <= LATE_MS) play(c);
    },
    () => {},
  );
  return false;
}

// ── the voices ─────────────────────────────────────────────────────────────

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

/**
 * A struck bell or glass: a sine with one soft inharmonic partial (×2.76, a
 * free plate's second mode) that dies first, so a note sounds struck, not
 * synthetic. A fast attack (3 ms) for the strike.
 */
function bell(c: BaseAudioContext, out: AudioNode, t: number, freq: number, dur: number, vel: number) {
  const strike = (mult: number, level: number, decay: number) => {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq * mult, t);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * level, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay + 0.03);
  };
  strike(1, 1, dur);
  strike(2.76, 0.12, dur * 0.35);
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

/** Noise swept through a band-pass (air moving past: a board sliding in). */
function sweep(c: BaseAudioContext, out: AudioNode, t: number, from: number, to: number, dur: number, vel: number) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 1.1;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/**
 * A struck iron plate: inharmonic partials (a free plate's modes sit near
 * 1 : 2.76 : 5.40 : 8.93, not a harmonic series), each dying away at its own
 * rate, the high ones first. The Hall of Strength's signature sound, and the
 * first thing in a finished workout's.
 */
export function plateStrike(c: BaseAudioContext, out: AudioNode, t: number, base: number, vel: number, ring = 1) {
  ([[1, 1, 0.9], [2.76, 0.55, 0.6], [5.4, 0.32, 0.38], [8.93, 0.18, 0.22]] as const).forEach(([mult, level, decay]) => {
    tone(c, out, t, base * mult, decay * ring, vel * level);
  });
  click(c, out, t, 5200, 0.025, vel * 0.6);
}

/** The one place a cue's notes are written. Levels are relative: the master bus sets how loud. */
const PATTERNS: Record<AppSound, (c: BaseAudioContext, out: AudioNode, t: number) => void> = {
  // Soft two-note "blip" — new message.
  message: (c, o, t) => { tone(c, o, t, 880, 0.18, 0.16); tone(c, o, t + 0.09, 1320, 0.26, 0.12); },
  // Quick upward tick — your message sent.
  sent: (c, o, t) => { tone(c, o, t, 600, 0.09, 0.08, "triangle", 900); },
  // Gentle single chime — something new (review, comment, request).
  notify: (c, o, t) => { tone(c, o, t, 1046.5, 0.45, 0.12); tone(c, o, t, 2093, 0.3, 0.03); },
  // Three rising notes — submitted / completed.
  success: (c, o, t) => { [659.25, 830.6, 987.8].forEach((f, i) => tone(c, o, t + i * 0.08, f, 0.3, 0.11)); },
  // Soft, low rising pair — Cleo's answer is in. Warm, never bright.
  reply: (c, o, t) => { tone(c, o, t, 440, 0.45, 0.05); tone(c, o, t + 0.12, 659.25, 0.6, 0.04); },
  // Bright arpeggio + sparkle — level-ups.
  celebrate: (c, o, t) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, o, t + i * 0.07, f, i === 3 ? 0.7 : 0.25, 0.12, "triangle"));
    for (let i = 0; i < 5; i++) tone(c, o, t + 0.3 + i * 0.045, 2093 * Math.pow(2, (i * 3) / 12), 0.25, 0.035);
  },
  // Barely-there tick — a checkbox or toggle.
  tick: (c, o, t) => { tone(c, o, t, 1400, 0.035, 0.035, "sine", 1100); },
  // A rep count, a weight or an RPE confirmed: a dry, quiet tick, lighter than a checkbox's.
  confirm: (c, o, t) => {
    tone(c, o, t, 2350, 0.024, 0.02, "sine", 1800);
    click(c, o, t, 4200, 0.008, 0.016);
  },
  // A set logged: a round, satisfying pop (a quick rising "bloop" on a soft thump) — felt more than heard.
  set: (c, o, t) => {
    tone(c, o, t, 210, 0.07, 0.07, "triangle", 150);
    tone(c, o, t + 0.004, 560, 0.075, 0.085, "sine", 1120);
    click(c, o, t, 2800, 0.01, 0.03);
  },
  // An exercise done: its pop, then a short, clean rise (D5 → A5 → D6, struck like small bells).
  exercise: (c, o, t) => {
    tone(c, o, t + 0.004, 560, 0.07, 0.06, "sine", 1120);
    bell(c, o, t + 0.05, 587.33, 0.3, 0.055);
    bell(c, o, t + 0.11, 880, 0.32, 0.05);
    bell(c, o, t + 0.17, 1174.66, 0.42, 0.048);
  },
  // Footage landed: a warm "da-ding" a fourth up (G5 → C6) with a breath of air under it. Done, and sent.
  upload: (c, o, t) => {
    bell(c, o, t, 783.99, 0.26, 0.05);
    sweep(c, o, t, 900, 2800, 0.12, 0.014);
    bell(c, o, t + 0.09, 1046.5, 0.5, 0.06);
  },
  // A genuine PR: a low hit for the weight of it, a fast bright run up (C6 E6 G6 C7) and a shimmer.
  pr: (c, o, t) => {
    tone(c, o, t, 118, 0.26, 0.09, "sine", 62);
    [1046.5, 1318.51, 1567.98, 2093].forEach((f, i) => tone(c, o, t + i * 0.045, f, i === 3 ? 0.6 : 0.22, 0.07, "triangle"));
    for (let i = 0; i < 4; i++) tone(c, o, t + 0.24 + i * 0.05, 2637 * Math.pow(2, (i * 4) / 12), 0.26, 0.02);
  },
  // A timer going off (Workout Tools, a countdown): two clear chimes (iPhone web can't vibrate, so this is the cue).
  timer: (c, o, t) => { tone(c, o, t, 987.77, 0.35, 0.1); tone(c, o, t + 0.2, 1318.51, 0.5, 0.1); },
  // Rest is over: two gentle struck bells a fifth apart (E5 → B5), soft and warm — "you're up".
  rest: (c, o, t) => {
    bell(c, o, t, 659.25, 0.75, 0.075);
    bell(c, o, t + 0.24, 987.77, 0.95, 0.07);
  },
  // Milestone unlocked: a bell arpeggio over a soft chord.
  milestone: (c, o, t) => {
    [261.63, 329.63, 392].forEach((f) => tone(c, o, t, f, 1.1, 0.025));
    [1046.5, 1318.51, 1567.98, 2093].forEach((f, i) => tone(c, o, t + i * 0.09, f, 0.6, 0.06));
  },
  // Something failed: low, short, soft — a fact, not an alarm.
  error: (c, o, t) => { tone(c, o, t, 311.13, 0.11, 0.06, "triangle", 290); tone(c, o, t + 0.12, 261.63, 0.16, 0.055, "triangle"); },
  // A value that won't do, a heads-up: two quiet low taps on one note.
  warning: (c, o, t) => { tone(c, o, t, 233.08, 0.08, 0.05, "triangle"); tone(c, o, t + 0.1, 233.08, 0.1, 0.045, "triangle"); },
  // The JF Effect signature, a finished workout: an iron plate struck, G → C (the stings' own
  // cadence) and the C-major bell rise they end on. Short enough to land and get out of the way.
  workout: (c, o, t) => {
    plateStrike(c, o, t, 392, 0.03, 0.75);
    [392, 493.88, 587.33].forEach((f) => tone(c, o, t + 0.02, f, 0.2, 0.026, "triangle"));
    [523.25, 659.25, 783.99].forEach((f) => tone(c, o, t + 0.2, f, 0.62, 0.03, "triangle"));
    bell(c, o, t + 0.3, 1046.5, 0.55, 0.05);
    bell(c, o, t + 0.37, 1318.51, 0.55, 0.045);
    bell(c, o, t + 0.44, 1567.98, 0.8, 0.045);
  },
  // Monthly League ⇄ Hall of Strength: a soft rising swish, felt as the board slides in.
  whoosh: (c, o, t) => { sweep(c, o, t, 380, 2600, 0.26, 0.07); },
  // Two lifters squaring up: a low hit with an iron ring over it. Short, so it lands and gets out of the way.
  clash: (c, o, t) => {
    tone(c, o, t, 120, 0.42, 0.16, "sine", 42);
    click(c, o, t, 900, 0.06, 0.09);
    plateStrike(c, o, t + 0.01, 420, 0.05, 0.9);
    plateStrike(c, o, t + 0.07, 610, 0.035, 0.7);
  },
  // A lifter's breakdown opening: one light plate tap.
  clang: (c, o, t) => { plateStrike(c, o, t, 560, 0.032, 0.55); },
};

/** Schedule one sound on any context (offline rendering for checks and previews). */
export function scheduleAppSound(c: BaseAudioContext, out: AudioNode, t: number, name: AppSound) {
  PATTERNS[name](c, out, t);
}

// ── the cache: hot cues rendered once ──────────────────────────────────────

/** The cues a workout plays, rendered first (in idle time) so the first set is as quick as the tenth. */
export const HOT_SOUNDS: AppSound[] = ["confirm", "set", "exercise", "pr", "rest", "upload", "workout", "warning", "error", "tick", "sent", "timer"];
const rendered = new Map<AppSound, AudioBuffer>();
let renderedRate = 0;
const renderQueue: AppSound[] = [];
let rendering = false;

/** A cue's rendered buffer on this context's sample rate, if it's ready. */
function cachedBuffer(c: BaseAudioContext, name: AppSound): AudioBuffer | null {
  if (renderedRate !== c.sampleRate) return null;
  return rendered.get(name) ?? null;
}

type OfflineCtor = new (ch: number, len: number, rate: number) => OfflineAudioContext;
type AudioWindow = {
  OfflineAudioContext?: OfflineCtor;
  webkitOfflineAudioContext?: OfflineCtor;
  requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
};

function offlineCtor(): OfflineCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as AudioWindow;
  return w.OfflineAudioContext || w.webkitOfflineAudioContext || null;
}

function idle(fn: () => void) {
  const ric = (window as unknown as AudioWindow).requestIdleCallback;
  if (typeof ric === "function") ric(fn, { timeout: 1500 });
  else window.setTimeout(fn, 60);
}

/** Render one cue into a buffer (on the audio thread: nothing here blocks a tap). */
export async function renderAppSound(name: AppSound, rate: number): Promise<AudioBuffer | null> {
  const Offline = offlineCtor();
  if (!Offline) return null;
  const len = Math.ceil(rate * (SOUND_SECONDS[name] + 0.12));
  const oc = new Offline(1, len, rate);
  PATTERNS[name](oc, oc.destination, 0.002);
  const legacy = oc as unknown as {
    oncomplete: ((e: { renderedBuffer: AudioBuffer }) => void) | null;
    startRendering: () => Promise<AudioBuffer> | undefined;
  };
  const buf = await new Promise<AudioBuffer>((resolve, reject) => {
    // the old Safari fires oncomplete and returns nothing; everything else returns a promise
    legacy.oncomplete = (e) => resolve(e.renderedBuffer);
    const p = legacy.startRendering();
    if (p && typeof p.then === "function") p.then(resolve, reject);
  });
  return buf;
}

function pumpRender() {
  if (rendering) return;
  const c = ctx;
  const next = renderQueue.shift();
  if (!c || !next) return;
  if (cachedBuffer(c, next)) return pumpRender();
  rendering = true;
  idle(() => {
    const rate = c.sampleRate;
    renderAppSound(next, rate)
      .then((buf) => {
        if (buf) {
          if (renderedRate !== rate) { rendered.clear(); renderedRate = rate; }
          rendered.set(next, buf);
        }
      })
      .catch(() => { /* live synthesis stays the fallback */ })
      .finally(() => {
        rendering = false;
        pumpRender();
      });
  });
}

/**
 * Get the cues ready: the audio context made (never started: that waits for a
 * tap) and each cue rendered into a buffer, one at a time, in idle time. Safe
 * to call often (the workout logger calls it on open, the first tap too).
 */
export function preloadAppSounds(names: AppSound[] = HOT_SOUNDS): void {
  if (typeof window === "undefined" || !appSoundsEnabled() || !offlineCtor()) return;
  const c = getCtx();
  if (!c) return;
  masterBus(c);
  for (const n of names) if (!cachedBuffer(c, n) && !renderQueue.includes(n)) renderQueue.push(n);
  pumpRender();
}

/** For checks: which cues are ready to play from the cache. */
export function preloadedAppSounds(): AppSound[] {
  return [...rendered.keys()];
}

// ── spacing and priority ───────────────────────────────────────────────────

export type SoundGate = {
  lastAny: number;
  lastAnyPriority: number;
  lastBy: Partial<Record<AppSound, number>>;
  /** Something long (a sting) holds the floor until then for anything that matters less. */
  holdUntil?: number;
  holdPriority?: number;
};
export type SoundDecision = "drop" | "play" | "preempt";

/**
 * What happens to a cue asked for `now` (ms), pure and tested:
 *  - its own spacing first (a fill-down's sets are one pop, a PR never twice in 1.5 s);
 *  - in the same moment as another (`CROWD_MS`), only the one that matters
 *    more plays: a lesser or equal one is dropped, a greater one plays and
 *    fades the earlier ("preempt");
 *  - a sting holding the floor drops anything lesser until it's done;
 *  - otherwise it plays (and still fades a lesser cue that's ringing).
 * Updates `gate` when it admits.
 */
export function soundDecision(name: AppSound, now: number, gate: SoundGate): SoundDecision {
  const priority = SOUND_PRIORITY[name] ?? 0;
  if (now - (gate.lastBy[name] ?? -Infinity) < (MIN_GAP[name] ?? 2500)) return "drop";
  if (gate.holdUntil != null && now < gate.holdUntil && priority <= (gate.holdPriority ?? 0)) return "drop";
  const sameMoment = now - gate.lastAny < CROWD_MS;
  if (sameMoment && priority <= gate.lastAnyPriority) return "drop";
  const decision: SoundDecision = gate.lastAny > -Infinity && priority > gate.lastAnyPriority ? "preempt" : "play";
  gate.lastAny = now;
  gate.lastAnyPriority = priority;
  gate.lastBy[name] = now;
  return decision;
}

/** The old yes / no form of soundDecision (kept for callers and checks). */
export function admitSound(name: AppSound, now: number, gate: SoundGate): boolean {
  return soundDecision(name, now, gate) !== "drop";
}
const gate: SoundGate = { lastAny: -Infinity, lastAnyPriority: 0, lastBy };

/** The cue still ringing, so a cue that matters more can fade it. */
let ringing: { gain: GainNode; priority: number; until: number; c: AudioContext } | null = null;

function fadeOut(g: GainNode, c: AudioContext) {
  try {
    const now = c.currentTime;
    const p = g.gain as AudioParam;
    p.cancelScheduledValues?.(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(0, now + 0.03);
    window.setTimeout(() => { try { g.disconnect(); } catch { /* gone */ } }, 120);
  } catch { /* gone */ }
}

/**
 * Play a cue now (or the moment the audio wakes, if that's quick). Follows
 * the switch, the volume, a hidden app and the spacing; `force` skips the
 * switch and the spacing (the setting's own sample).
 */
export function playAppSound(name: AppSound, opts: { force?: boolean } = {}) {
  if (typeof window === "undefined") return;
  if (!opts.force) {
    if (!appSoundsEnabled()) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (appSoundVolume() <= 0) return;
    if (soundDecision(name, Date.now(), gate) === "drop") return;
  }
  const priority = SOUND_PRIORITY[name] ?? 0;
  whenRunning((c) => {
    try {
      const bus = masterBus(c);
      // a cue that matters more fades out a lesser one still ringing
      if (ringing && ringing.c === c && Date.now() < ringing.until && priority > ringing.priority) {
        fadeOut(ringing.gain, c);
        ringing = null;
      }
      const voice = c.createGain();
      voice.gain.value = 1;
      voice.connect(bus);
      const buf = cachedBuffer(c, name);
      if (buf) {
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(voice);
        src.start(0);
      } else {
        PATTERNS[name](c, voice, c.currentTime + 0.01);
        // the next one comes from the cache
        if (!renderQueue.includes(name)) { renderQueue.push(name); pumpRender(); }
      }
      const until = Date.now() + SOUND_SECONDS[name] * 1000;
      if (!ringing || priority >= ringing.priority || Date.now() >= ringing.until) ringing = { gain: voice, priority, until, c };
      window.setTimeout(() => { try { voice.disconnect(); } catch { /* gone */ } }, (SOUND_SECONDS[name] + 0.5) * 1000);
    } catch { /* never let a sound break the UI */ }
  });
}

/** A sting is on: anything that matters less waits until it's done. */
function holdFloor(seconds: number) {
  gate.holdUntil = Date.now() + seconds * 1000;
  gate.holdPriority = 8;
  if (ringing) {
    fadeOut(ringing.gain, ringing.c);
    ringing = null;
  }
}
function releaseFloor() {
  gate.holdUntil = undefined;
  gate.holdPriority = undefined;
}

export function playSynth(build: (c: AudioContext, out: AudioNode, t: number) => number): () => void {
  if (typeof window === "undefined" || !appSoundsEnabled() || document.visibilityState === "hidden" || appSoundVolume() <= 0) return () => {};
  let master: GainNode | null = null;
  let ctxUsed: AudioContext | null = null;
  let cancelled = false;
  whenRunning((c) => {
    if (cancelled) return;
    ctxUsed = c;
    try {
      const t = c.currentTime + 0.02;
      const m = c.createGain();
      m.gain.value = 1;
      // A gentle limiter so stacked hits never clip on a phone speaker.
      const limiter = c.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.knee.value = 8;
      limiter.ratio.value = 6;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      m.connect(limiter).connect(masterBus(c));
      master = m;
      const length = build(c, m, t);
      // the sting holds the floor: a lesser cue waits until it's done
      holdFloor(length);
      window.setTimeout(() => { try { m.disconnect(); } catch { /* gone */ } }, (length + 1.5) * 1000);
    } catch { /* never let a sound break the UI */ }
  });
  return () => {
    cancelled = true;
    const m = master;
    const c = ctxUsed;
    master = null;
    if (!m || !c) return;
    releaseFloor();
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
 * A piece of music that loops until it's stopped (the Rankings themes,
 * rankings-music.ts): `build` sets up its sound and returns a scheduler that
 * adds every note up to a time, topped up a little ahead on a timer. On the
 * same context, toggle and audio session as every other sound ("ambient":
 * it mixes with the athlete's own music and follows the silent switch). If
 * the context is waiting for a tap it starts on that tap, not dropped.
 * Returns stop(fadeSeconds).
 */
export type MusicLoop = { schedule: (until: number) => void };
export function startAppMusic(
  build: (c: BaseAudioContext, out: AudioNode, t0: number) => MusicLoop,
  opts: { volume?: number; fadeIn?: number; lookahead?: number } = {},
): (fade?: number) => void {
  if (typeof window === "undefined" || !appSoundsEnabled() || appSoundVolume() <= 0) return () => {};
  const c = getCtx();
  if (!c) return () => {};
  const volume = opts.volume ?? 0.5;
  const ahead = opts.lookahead ?? 0.9;
  let master: GainNode | null = null;
  let timer: number | undefined;
  let stopped = false;
  const begin = () => {
    if (stopped || master || c.state !== "running") return;
    try {
      const t0 = c.currentTime + 0.06;
      const m = c.createGain();
      m.gain.setValueAtTime(0, t0);
      m.gain.linearRampToValueAtTime(volume, t0 + (opts.fadeIn ?? 1.2));
      const limiter = c.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.knee.value = 8;
      limiter.ratio.value = 5;
      limiter.attack.value = 0.004;
      limiter.release.value = 0.2;
      m.connect(limiter).connect(masterBus(c));
      master = m;
      const music = build(c, m, t0);
      music.schedule(c.currentTime + ahead);
      timer = window.setInterval(() => music.schedule(c.currentTime + ahead), 200);
    } catch { /* never let music break the UI */ }
  };
  const onState = () => begin();
  wake(c);
  if (c.state === "running") begin();
  else c.addEventListener?.("statechange", onState);
  return (fade = 0.8) => {
    if (stopped) return;
    stopped = true;
    c.removeEventListener?.("statechange", onState);
    window.clearInterval(timer);
    const m = master;
    master = null;
    if (!m) return;
    try {
      const t = c.currentTime;
      m.gain.cancelScheduledValues(t);
      m.gain.setValueAtTime(m.gain.value, t);
      m.gain.linearRampToValueAtTime(0, t + fade);
      // notes already scheduled ring out under the fade, then everything is let go
      window.setTimeout(() => { try { m.disconnect(); } catch { /* gone */ } }, (fade + 0.3) * 1000);
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
  wake(c);
  let master: GainNode | null = null;
  let timer: number | undefined;
  const begin = window.setTimeout(() => {
    if (c.state !== "running" || document.visibilityState === "hidden") return;
    try {
      const t0 = c.currentTime + 0.05;
      master = c.createGain();
      master.gain.setValueAtTime(0, t0);
      master.gain.linearRampToValueAtTime(1, t0 + 1.2);
      master.connect(masterBus(c));
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
