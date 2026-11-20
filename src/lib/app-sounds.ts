/**
 * The app's sounds: synthesized with Web Audio (no files, nothing to download,
 * nothing to license), one engine for every short cue, the timers' countdown,
 * the achievement stings (achievement-music.ts) and Cleo's music.
 *
 * Rules that keep them from feeling spammy:
 *  - one master switch, per device, on by default; off = total silence. Under
 *    it, per device too: workout sounds, timer alerts (+ the 3-2-1), message &
 *    notification sounds, and a volume (`SoundPrefs`, sound-settings.tsx)
 *  - never when the tab is hidden (push handles that)
 *  - the same sound at most once every 2.5 s, any sound at most every 0.6 s,
 *    unless the later one matters more (`admitSound`)
 *  - iOS: "ambient" audio session, so the ring/silent switch is respected and
 *    music isn't interrupted
 *  - browsers only allow audio after a tap, so the context wakes on every tap
 *
 * One sonic identity: every cue that means progress is built in C major
 * (a set's tock, an exercise's rising fifth, the PR's strike and chord, the
 * timer's G-G-G-C, a milestone's Cmaj9 bloom), so they read as one family
 * that ends where the finish sting does, on C. Bells are two-operator FM: a
 * crisp, bright strike that settles to a clean tone, never a square wave or
 * an arcade arpeggio.
 */

import { installMediaPlaybackSession, setBaseAudioSessionType } from "@/lib/audio-session";

export type AppSound =
  | "message" | "sent" | "notify" | "success" | "celebrate" | "reply"
  // Workout logging — short and soft, so a session full of them never nags.
  | "tick" | "set" | "exercise" | "pr" | "timer" | "milestone" | "error"
  // The workout clock, the timers' last seconds, a daily goal reached.
  | "start" | "count" | "go" | "goal";

// ------------------------------------------------------------------ settings

/** What a sound is, for the settings: a workout / app cue, a timer alert, or something arriving. */
export type SoundCategory = "effects" | "timers" | "notifications";

const CATEGORY: Record<AppSound, SoundCategory> = {
  message: "notifications", notify: "notifications", reply: "notifications",
  timer: "timers", count: "timers", go: "timers",
  sent: "effects", success: "effects", celebrate: "effects", tick: "effects", set: "effects",
  exercise: "effects", pr: "effects", milestone: "effects", error: "effects",
  start: "effects", goal: "effects",
};
export function soundCategory(name: AppSound): SoundCategory {
  return CATEGORY[name];
}

export type SoundPrefs = {
  /** Sets, exercises, PRs, the finish, milestones, the workout clock, saves. */
  effects: boolean;
  /** Rest, set and Workout Tools timers: the end (and the 3-2-1 when `countdown`). */
  timers: boolean;
  /** The last 3 seconds of a timer, one pip a second. */
  countdown: boolean;
  /** New messages and updates arriving while the app is open. */
  notifications: boolean;
  /** 0–100; 100 is the level the sounds are made at. */
  volume: number;
};
export const DEFAULT_SOUND_PREFS: SoundPrefs = { effects: true, timers: true, countdown: true, notifications: true, volume: 100 };

const KEY = "jf-app-sounds";
const PREFS_KEY = "jf-sound-prefs";
const listeners = new Set<(on: boolean) => void>();
const prefListeners = new Set<(p: SoundPrefs) => void>();
let ctx: AudioContext | null = null;
const lastBy: Partial<Record<AppSound, number>> = {};
const openThreads = new Set<string>();

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function appSoundsEnabled(): boolean {
  try {
    return storage()?.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAppSoundsEnabled(on: boolean) {
  try { storage()?.setItem(KEY, on ? "1" : "0"); } catch { /* private mode */ }
  listeners.forEach((l) => l(on));
  if (on) playAppSound("notify", { force: true });
}

export function subscribeAppSounds(fn: (on: boolean) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Clean a stored value: anything missing or wrong falls back to the default. */
export function cleanSoundPrefs(raw: unknown): SoundPrefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof SoundPrefs) => (typeof p[k] === "boolean" ? (p[k] as boolean) : (DEFAULT_SOUND_PREFS[k] as boolean));
  const v = Number(p.volume);
  return {
    effects: bool("effects"),
    timers: bool("timers"),
    countdown: bool("countdown"),
    notifications: bool("notifications"),
    volume: Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : DEFAULT_SOUND_PREFS.volume,
  };
}

let prefsCache: { raw: string | null; value: SoundPrefs } | null = null;
export function readSoundPrefs(): SoundPrefs {
  let raw: string | null = null;
  try { raw = storage()?.getItem(PREFS_KEY) ?? null; } catch { raw = null; }
  if (prefsCache && prefsCache.raw === raw) return prefsCache.value;
  let parsed: unknown = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
  const value = cleanSoundPrefs(parsed);
  prefsCache = { raw, value };
  return value;
}

export function setSoundPrefs(patch: Partial<SoundPrefs>): SoundPrefs {
  const next = cleanSoundPrefs({ ...readSoundPrefs(), ...patch });
  try { storage()?.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  prefsCache = null;
  prefListeners.forEach((l) => l(next));
  return next;
}

export function subscribeSoundPrefs(fn: (p: SoundPrefs) => void) {
  prefListeners.add(fn);
  return () => { prefListeners.delete(fn); };
}

/**
 * The volume as a gain: squared, so the slider moves evenly by ear (half way
 * is about 12 dB down, not a barely-there 6) and 0 is silence.
 */
export function volumeGain(volume: number): number {
  const v = Math.max(0, Math.min(100, Number(volume) || 0)) / 100;
  return v * v;
}

/** Whether a sound may play under these settings (the master switch first). */
export function soundAllowed(name: AppSound, prefs: SoundPrefs = readSoundPrefs(), master: boolean = appSoundsEnabled()): boolean {
  if (!master || prefs.volume <= 0) return false;
  const cat = CATEGORY[name];
  if (cat === "timers" && name === "count" && !prefs.countdown) return false;
  return prefs[cat];
}

/** A chat thread that plays its own message sounds (so the global listener stays quiet). */
export function registerOpenThread(id: string) {
  openThreads.add(id);
  return () => { openThreads.delete(id); };
}
export function isThreadOpen(id: string | null | undefined) {
  return !!id && openThreads.has(id);
}

function hidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
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
    if (c) wake(c);
  };
  // The events a browser accepts as "the person tapped" for starting audio.
  for (const type of ["touchend", "pointerup", "click", "keydown"]) window.addEventListener(type, unlock, true);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && ctx) void ctx.resume().catch(() => {});
      // A countdown scheduled on the audio clock would play late once the
      // phone lets the context run again: drop it; the timer arms it afresh.
      if (document.visibilityState === "hidden") cancelAllCountdowns();
    });
  }
  // Settings changed in another tab of the app.
  window.addEventListener("storage", (e) => {
    if (e.key === PREFS_KEY) {
      prefsCache = null;
      const p = readSoundPrefs();
      prefListeners.forEach((l) => l(p));
    } else if (e.key === KEY) {
      const on = appSoundsEnabled();
      listeners.forEach((l) => l(on));
    }
  });
}
if (typeof window !== "undefined" && typeof document !== "undefined") {
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

// ------------------------------------------------------------------ voices

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

/**
 * A bell: two-operator FM. The modulator's depth (`index`) starts high and
 * falls away over `bright` of the note, so it strikes crisp and rings clean.
 * `ratio` 2 is warm and harmonic, 3.5 metallic (a struck plate).
 */
function bell(
  c: BaseAudioContext, out: AudioNode, t: number, freq: number, dur: number, vel: number,
  { ratio = 2, index = 1, bright = 0.35, attack = 0.004 }: { ratio?: number; index?: number; bright?: number; attack?: number } = {},
) {
  const car = c.createOscillator();
  car.type = "sine";
  car.frequency.setValueAtTime(freq, t);
  const mod = c.createOscillator();
  mod.type = "sine";
  mod.frequency.setValueAtTime(freq * ratio, t);
  const depth = c.createGain();
  depth.gain.setValueAtTime(freq * index, t);
  depth.gain.exponentialRampToValueAtTime(Math.max(0.5, freq * index * 0.02), t + Math.max(0.02, dur * bright));
  mod.connect(depth).connect(car.frequency);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  car.connect(g).connect(out);
  mod.start(t);
  car.start(t);
  mod.stop(t + dur + 0.05);
  car.stop(t + dur + 0.05);
}

/** A low body hit: a sine that drops in pitch fast (felt as much as heard). */
function thump(c: BaseAudioContext, out: AudioNode, t: number, from: number, to: number, dur: number, vel: number) {
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.55);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** A short rush of air that rises into what follows (the workout starting). */
function swell(c: BaseAudioContext, out: AudioNode, t: number, dur: number, vel: number) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 0.9;
  f.frequency.setValueAtTime(500, t);
  f.frequency.exponentialRampToValueAtTime(3800, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + dur * 0.85);
  g.gain.linearRampToValueAtTime(0, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// Notes (C major: the app's key, the finish sting's too).
const C4 = 261.63, C5 = 523.25, E5 = 659.25, G5 = 783.99, B5 = 987.77;
const C6 = 1046.5, D6 = 1174.66, E6 = 1318.51, G6 = 1567.98, C7 = 2093.0;

/** The timer's last pip and "go": a clean high C with a soft one under it. */
function goTone(c: BaseAudioContext, o: AudioNode, t: number) {
  bell(c, o, t, C6, 0.75, 0.11, { ratio: 2, index: 0.9, bright: 0.25 });
  bell(c, o, t, C5, 0.6, 0.035, { ratio: 1, index: 0.3 });
  tone(c, o, t, C7, 0.18, 0.012);
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
  // Soft, low rising pair — Cleo's answer is in. Warm, never bright.
  reply: (c, o, t) => { tone(c, o, t, 440, 0.45, 0.05); tone(c, o, t + 0.12, 659.25, 0.6, 0.04); },
  // Bright arpeggio + sparkle (kept for older callers; nothing new uses it).
  celebrate: (c, o, t) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, o, t + i * 0.07, f, i === 3 ? 0.7 : 0.25, 0.12, "triangle"));
    for (let i = 0; i < 5; i++) tone(c, o, t + 0.3 + i * 0.045, 2093 * Math.pow(2, (i * 3) / 12), 0.25, 0.035);
  },
  // Barely-there tick — a checkbox or toggle.
  tick: (c, o, t) => { tone(c, o, t, 1400, 0.035, 0.035, "sine", 1100); },
  // A set logged: a soft, woody "tock" — felt more than heard. (Unchanged: it works.)
  set: (c, o, t) => { tone(c, o, t, 330, 0.09, 0.09, "triangle", 220); click(c, o, t, 2400, 0.018, 0.05); },
  // An exercise's last set: the tock, then a rising fifth (G → C) that rings.
  exercise: (c, o, t) => {
    tone(c, o, t, 330, 0.09, 0.08, "triangle", 220);
    click(c, o, t, 2400, 0.018, 0.045);
    bell(c, o, t + 0.07, G5, 0.32, 0.06, { index: 0.8 });
    bell(c, o, t + 0.15, C6, 0.6, 0.075, { index: 1.1, bright: 0.3 });
  },
  // A PR: an impact (a low hit and a metal strike), then a fast, bright C chord
  // strummed upward with a glint on top. Short enough to sit on their music.
  pr: (c, o, t) => {
    thump(c, o, t, 140, 52, 0.3, 0.2);
    tone(c, o, t, 262, 0.12, 0.05, "triangle", 131);
    click(c, o, t, 4200, 0.03, 0.06);
    bell(c, o, t + 0.01, C6, 0.4, 0.035, { ratio: 3.5, index: 1.4, bright: 0.2 });
    [C5, G5, C6, E6].forEach((f, i) => bell(c, o, t + 0.05 + i * 0.024, f, 1.05 - i * 0.08, 0.05, { index: 1.6, bright: 0.3 }));
    bell(c, o, t + 0.2, G6, 0.6, 0.018, { ratio: 3.01, index: 0.6 });
  },
  // Rest is over (no countdown before it): a pip, then the high C.
  timer: (c, o, t) => {
    bell(c, o, t, G5, 0.11, 0.07, { index: 0.4, attack: 0.003 });
    goTone(c, o, t + 0.13);
  },
  // A countdown's pip (3, 2, 1): short, clean, a fifth under the "go".
  count: (c, o, t) => { bell(c, o, t, G5, 0.12, 0.1, { index: 0.4, attack: 0.003 }); },
  // The countdown's end: the high C.
  go: (c, o, t) => { goTone(c, o, t); },
  // Milestone unlocked: a warm Cmaj9 bloom over a low C (no arcade arpeggio).
  milestone: (c, o, t) => {
    tone(c, o, t, C4, 1.25, 0.03);
    [E5, G5, B5, D6].forEach((f, i) => bell(c, o, t + i * 0.045, f, 1.2 - i * 0.1, 0.045, { index: 0.8, bright: 0.4 }));
    bell(c, o, t + 0.22, G6, 0.8, 0.016, { ratio: 3.01, index: 0.5 });
  },
  // A daily goal reached (water): a light glint, C up to G over a soft E.
  goal: (c, o, t) => {
    bell(c, o, t, E6, 0.35, 0.05, { index: 0.7 });
    bell(c, o, t + 0.07, G6, 0.55, 0.055, { index: 0.7, bright: 0.3 });
    bell(c, o, t, C6, 0.5, 0.03, { ratio: 1, index: 0.3 });
  },
  // The workout's clock starts: a rush of air into a low hit and a rising C → G.
  start: (c, o, t) => {
    swell(c, o, t, 0.2, 0.045);
    thump(c, o, t + 0.18, 150, 75, 0.22, 0.11);
    bell(c, o, t + 0.18, C5, 0.45, 0.065, { index: 1 });
    bell(c, o, t + 0.25, G5, 0.65, 0.075, { index: 1.1, bright: 0.3 });
  },
  // Something failed: low, short, not alarming.
  error: (c, o, t) => { tone(c, o, t, 300, 0.12, 0.08, "triangle", 240); tone(c, o, t + 0.12, 220, 0.16, 0.07, "triangle"); },
};

/** Schedule one sound on any context (offline rendering for checks and previews). */
export function scheduleAppSound(c: BaseAudioContext, out: AudioNode, t: number, name: AppSound) {
  PATTERNS[name](c, out, t);
}

// ------------------------------------------------------------------ spacing

/**
 * Sounds that matter more win over a cue that just played (a set's "tock"
 * must not swallow the PR that lands 200 ms later).
 */
const PRIORITY: Partial<Record<AppSound, number>> = {
  pr: 2, celebrate: 2, milestone: 2,
  exercise: 1, goal: 1,
  // the clock starting and a timer ending take the tock of the set that comes
  // with them (the first set, a timed hold logging itself), never an exercise's cue
  timer: 0.5, go: 0.5, start: 0.5,
};
/** Same-sound spacing: fast cues may repeat sooner than the 2.5 s default. */
const MIN_GAP: Partial<Record<AppSound, number>> = { tick: 90, set: 450, exercise: 900, error: 900, count: 600 };
/** How long a sound keeps quieter ones from playing over it (default 0.6 s). */
const CROWD_MS: Partial<Record<AppSound, number>> = { start: 1500, timer: 1200, go: 1200 };
const DEFAULT_CROWD_MS = 600;

export type SoundGate = {
  lastAny: number;
  lastAnyPriority: number;
  lastBy: Partial<Record<AppSound, number>>;
  /** How long the last sound crowds out quieter ones (default 600 ms). */
  lastAnyCrowdMs?: number;
  /** Sounds scheduled ahead on the audio clock (a countdown's "go"): the same rule, in the future. */
  reserved?: Array<{ from: number; until: number; priority: number }>;
};
/**
 * Spacing so sounds never pile up: any two at least 0.6 s apart unless the
 * later one matters more (a PR right after its set's tock still plays), and
 * the same sound again only after its own gap. Updates `gate` when it admits.
 */
export function admitSound(name: AppSound, now: number, gate: SoundGate): boolean {
  const priority = PRIORITY[name] ?? 0;
  const crowdMs = gate.lastAnyCrowdMs ?? DEFAULT_CROWD_MS;
  const crowded = now - gate.lastAny < crowdMs && priority <= gate.lastAnyPriority;
  const reserved = (gate.reserved ?? []).some((r) => now >= r.from && now < r.until && priority <= r.priority);
  if (crowded || reserved || now - (gate.lastBy[name] ?? -Infinity) < (MIN_GAP[name] ?? 2500)) return false;
  gate.lastAny = now;
  gate.lastAnyPriority = priority;
  gate.lastAnyCrowdMs = CROWD_MS[name] ?? DEFAULT_CROWD_MS;
  gate.lastBy[name] = now;
  return true;
}
/**
 * Hold `name`'s place at a time ahead (a countdown's "go" scheduled on the
 * audio clock): quieter sounds keep off it as if it had just played. Returns
 * the release, for a countdown that's cancelled before it gets there.
 */
export function reserveSound(name: AppSound, at: number, gate: SoundGate): () => void {
  const list = (gate.reserved ??= []);
  // forget the ones long gone
  for (let i = list.length - 1; i >= 0; i--) if (list[i].until < at - 10_000) list.splice(i, 1);
  const r = { from: at, until: at + (CROWD_MS[name] ?? DEFAULT_CROWD_MS), priority: PRIORITY[name] ?? 0 };
  list.push(r);
  return () => {
    const i = list.indexOf(r);
    if (i >= 0) list.splice(i, 1);
  };
}
const gate: SoundGate = { lastAny: 0, lastAnyPriority: 0, lastBy };

// ------------------------------------------------------------------ playing

/** A per-sound output at the person's volume (null at 0: nothing to play). */
function outputFor(c: AudioContext, level: number, volume: number): GainNode | null {
  const g = volumeGain(volume);
  if (g <= 0) return null;
  const out = c.createGain();
  out.gain.value = level * g;
  out.connect(c.destination);
  return out;
}

/**
 * Play a cue. `force` skips the settings and the spacing (a preview the
 * person asked for: switching a sound on, the volume slider) but keeps the
 * volume, so what they hear is what they'll get.
 */
export function playAppSound(name: AppSound, opts: { force?: boolean } = {}) {
  if (typeof window === "undefined") return;
  const prefs = readSoundPrefs();
  if (!opts.force) {
    if (!soundAllowed(name, prefs)) return;
    if (hidden()) return;
    if (!admitSound(name, Date.now(), gate)) return;
  }
  whenRunning((c) => {
    try {
      const out = outputFor(c, 0.9, prefs.volume);
      if (!out) return;
      PATTERNS[name](c, out, c.currentTime + 0.01);
      window.setTimeout(() => { try { out.disconnect(); } catch { /* gone */ } }, 2500);
    } catch { /* never let a sound break the UI */ }
  });
}

/**
 * A preview the person asked for (the settings' play buttons): several sounds
 * at set offsets (seconds) on the audio clock, at their volume, whatever the
 * switches say. Returns stop().
 */
export function previewSounds(list: Array<[AppSound, number]>): () => void {
  if (typeof window === "undefined") return () => {};
  const volume = readSoundPrefs().volume;
  let out: GainNode | null = null;
  let cancelled = false;
  whenRunning((c) => {
    if (cancelled) return;
    try {
      const o = outputFor(c, 0.9, volume);
      if (!o) return;
      out = o;
      const t0 = c.currentTime + 0.02;
      for (const [name, at] of list) PATTERNS[name](c, o, t0 + at);
      const last = Math.max(0, ...list.map(([, at]) => at));
      window.setTimeout(() => { try { o.disconnect(); } catch { /* gone */ } }, (last + 2) * 1000);
    } catch { /* never let a sound break the UI */ }
  });
  return () => {
    cancelled = true;
    const o = out;
    out = null;
    if (!o) return;
    try {
      const c = o.context;
      o.gain.cancelScheduledValues(c.currentTime);
      o.gain.setValueAtTime(o.gain.value, c.currentTime);
      o.gain.linearRampToValueAtTime(0, c.currentTime + 0.05);
      window.setTimeout(() => { try { o.disconnect(); } catch { /* gone */ } }, 150);
    } catch { /* gone */ }
  };
}

// ------------------------------------------------------------------ countdowns

/** A timer's countdown is armed this close to its end (its repaint is every 0.5–1 s). */
export const COUNTDOWN_ARM_MS = 4500;
/** Pips at 3, 2 and 1 seconds left. */
const COUNT_FROM = 3;

type ArmedCountdown = { endsAt: number; withGo: boolean; stop: () => void };
const armed = new Map<string, ArmedCountdown>();

/**
 * The seconds a countdown should pip at, from now: 3, 2, 1 before `endsAt`
 * (only the ones still ahead, give or take a frame), and whether the "go"
 * at the end is still to come.
 */
export function countdownPlan(endsAt: number, now: number, opts: { countdown: boolean; go: boolean }): { pips: number[]; go: number | null } {
  const pips = opts.countdown
    ? Array.from({ length: COUNT_FROM }, (_, i) => endsAt - (COUNT_FROM - i) * 1000).filter((at) => at >= now - 60)
    : [];
  return { pips, go: opts.go && endsAt >= now - 60 ? endsAt : null };
}

/**
 * Keep one timer's last seconds on the audio clock: call it on every repaint
 * with the timer's end (null while paused or stopped). Idempotent: the same
 * end is armed once, a new end replaces it, null stops it. Armed only inside
 * the last `COUNTDOWN_ARM_MS` (the audio clock stops while a phone sleeps, so
 * anything scheduled further ahead would play late), only while the app is on
 * screen, and only with timer alerts on. A countdown whose "go" has already
 * sounded is left to ring out, never cut (a hold that logs itself at zero
 * resets its timer right away).
 */
export function syncCountdown(key: string, endsAt: number | null, opts: { go?: boolean } = {}): void {
  const cur = armed.get(key);
  if (cur && cur.endsAt === endsAt) return;
  const now = Date.now();
  if (cur) {
    armed.delete(key);
    if (now < cur.endsAt - 30) cur.stop();
  }
  if (endsAt == null || typeof window === "undefined") return;
  if (endsAt - now > COUNTDOWN_ARM_MS || endsAt < now - 60 || hidden()) return;
  const prefs = readSoundPrefs();
  if (!soundAllowed("go", prefs)) return;
  const plan = countdownPlan(endsAt, now, { countdown: soundAllowed("count", prefs), go: opts.go !== false });
  if (!plan.pips.length && plan.go == null) return;

  let out: GainNode | null = null;
  let cancelled = false;
  let unreserve = () => {};
  const entry: ArmedCountdown = {
    endsAt,
    // true once the "go" is actually on the audio clock
    withGo: false,
    stop: () => {
      cancelled = true;
      unreserve();
      const o = out;
      out = null;
      if (!o) return;
      try {
        const c = o.context;
        o.gain.cancelScheduledValues(c.currentTime);
        o.gain.setValueAtTime(o.gain.value, c.currentTime);
        o.gain.linearRampToValueAtTime(0, c.currentTime + 0.03);
        window.setTimeout(() => { try { o.disconnect(); } catch { /* gone */ } }, 120);
      } catch { /* gone */ }
    },
  };
  armed.set(key, entry);
  whenRunning((c) => {
    if (cancelled) return;
    try {
      const o = outputFor(c, 0.9, prefs.volume);
      if (!o) return;
      out = o;
      const nowMs = Date.now();
      const at = (ms: number) => c.currentTime + Math.max(0.01, (ms - nowMs) / 1000);
      for (const p of plan.pips) if (p >= nowMs - 60) PATTERNS.count(c, o, at(p));
      if (plan.go != null && plan.go >= nowMs - 150) {
        PATTERNS.go(c, o, at(plan.go));
        entry.withGo = true;
        unreserve = reserveSound("go", plan.go, gate);
      }
      const doneIn = Math.max(0, endsAt - nowMs) + 1500;
      window.setTimeout(() => { try { o.disconnect(); } catch { /* gone */ } }, doneIn);
    } catch { /* never let a sound break the UI */ }
  });
}

/** True when this timer's "go" was scheduled by its countdown (so the finish chime mustn't play too). */
export function countdownSoundedEnd(key: string, endsAt: number | null | undefined): boolean {
  const cur = armed.get(key);
  return !!cur && endsAt != null && cur.endsAt === endsAt && cur.withGo;
}

function cancelAllCountdowns() {
  armed.forEach((a) => a.stop());
  armed.clear();
}

// ------------------------------------------------------------------ longer pieces

/**
 * Play a longer synthesized piece (the achievement stings, achievement-music.ts)
 * through the same context, settings and audio session as every other sound
 * (a workout sound: it follows "Workout sounds" and the volume).
 * `build` schedules its notes from `t` and returns their length in seconds.
 * Returns stop(): a quick fade, used when the screen closes or sound is muted.
 */
export function playSynth(build: (c: AudioContext, out: AudioNode, t: number) => number): () => void {
  if (typeof window === "undefined" || hidden()) return () => {};
  const prefs = readSoundPrefs();
  if (!soundAllowed("pr", prefs)) return () => {};
  let master: GainNode | null = null;
  let ctxUsed: AudioContext | null = null;
  let cancelled = false;
  whenRunning((c) => {
    if (cancelled) return;
    ctxUsed = c;
    try {
      const t = c.currentTime + 0.02;
      const m = c.createGain();
      m.gain.value = volumeGain(prefs.volume);
      // A gentle limiter so stacked hits never clip on a phone speaker.
      const limiter = c.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.knee.value = 8;
      limiter.ratio.value = 6;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      m.connect(limiter).connect(c.destination);
      master = m;
      const length = build(c, m, t);
      window.setTimeout(() => { try { m.disconnect(); } catch { /* gone */ } }, (length + 1.5) * 1000);
    } catch { /* never let a sound break the UI */ }
  });
  return () => {
    cancelled = true;
    const m = master;
    const c = ctxUsed;
    master = null;
    if (!m || !c) return;
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
  if (typeof window === "undefined") return () => {};
  // Cleo's: with her answers' sound, under "Messages & notifications" and the volume.
  const prefs = readSoundPrefs();
  if (!soundAllowed("reply", prefs)) return () => {};
  const level = volumeGain(prefs.volume);
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
      master.gain.linearRampToValueAtTime(level, t0 + 1.2);
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
