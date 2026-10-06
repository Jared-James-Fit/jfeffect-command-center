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

export type AppSound = "message" | "sent" | "notify" | "success" | "celebrate" | "unlock";

const KEY = "jf-app-sounds";
const listeners = new Set<(on: boolean) => void>();
let ctx: AudioContext | null = null;
let lastAny = 0;
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
    try {
      const session = (navigator as any).audioSession;
      if (session && "type" in session) session.type = "ambient";
    } catch { /* not supported */ }
    ctx = new C();
  }
  return ctx;
}

let unlockInstalled = false;
function installUnlock() {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  // Stays installed: iOS suspends/interrupts the context when the app is
  // backgrounded, and only a later gesture can bring it back.
  const unlock = () => {
    const c = getCtx();
    if (c && c.state !== "running") void c.resume().catch(() => {});
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}
if (typeof window !== "undefined") installUnlock();

function tone(c: AudioContext, out: AudioNode, t: number, freq: number, dur: number, vel: number, type: OscillatorType = "sine", to?: number) {
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

const PATTERNS: Record<AppSound, (c: AudioContext, out: AudioNode, t: number) => void> = {
  // Soft two-note "blip" — new message.
  message: (c, o, t) => { tone(c, o, t, 880, 0.18, 0.16); tone(c, o, t + 0.09, 1320, 0.26, 0.12); },
  // Quick upward tick — your message sent.
  sent: (c, o, t) => { tone(c, o, t, 600, 0.09, 0.08, "triangle", 900); },
  // Gentle single chime — something new (review, comment, request).
  notify: (c, o, t) => { tone(c, o, t, 1046.5, 0.45, 0.12); tone(c, o, t, 2093, 0.3, 0.03); },
  // Three rising notes — submitted / completed.
  success: (c, o, t) => { [659.25, 830.6, 987.8].forEach((f, i) => tone(c, o, t + i * 0.08, f, 0.3, 0.11)); },
  // Bright arpeggio + sparkle — PRs, level-ups.
  celebrate: (c, o, t) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, o, t + i * 0.07, f, i === 3 ? 0.7 : 0.25, 0.12, "triangle"));
    for (let i = 0; i < 5; i++) tone(c, o, t + 0.3 + i * 0.045, 2093 * Math.pow(2, (i * 3) / 12), 0.25, 0.035);
  },
  // Upward sweep into a ringing chord — milestone / badge unlocked.
  unlock: (c, o, t) => {
    tone(c, o, t, 392, 0.22, 0.06, "triangle", 1568);
    [1046.5, 1318.5, 1568, 1975.5].forEach((f, i) => tone(c, o, t + 0.16 + i * 0.03, f, 0.9, i === 0 ? 0.1 : 0.07));
    tone(c, o, t + 0.16, 523.25, 0.6, 0.07, "triangle");
  },
};

type PlayOpts = {
  /** Skip every check (toggle preview). */
  force?: boolean;
  /** false = skip the anti-spam limits, for choreographed sequences the UI times itself. */
  throttle?: boolean;
};

/** Gates a sound, then hands the pattern an output bus and a start time. */
function play(key: AppSound | null, opts: PlayOpts, draw: (c: AudioContext, out: AudioNode, t: number) => void) {
  if (typeof window === "undefined") return;
  if (!opts.force) {
    if (!appSoundsEnabled()) return;
    if (document.visibilityState === "hidden") return;
    if (key && opts.throttle !== false) {
      const now = Date.now();
      if (now - lastAny < 600 || now - (lastBy[key] ?? 0) < 2500) return;
      lastAny = now;
      lastBy[key] = now;
    }
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
    draw(c, out, c.currentTime + 0.01);
  } catch { /* never let a sound break the UI */ }
}

export function playAppSound(name: AppSound, opts: PlayOpts = {}) {
  play(name, opts, PATTERNS[name]);
}

/**
 * Soft rising ticks for a number counting up with an ease-out-cubic curve:
 * tick k lands when the counter passes k/steps of the way, so they bunch at
 * the start and spread out as the number settles. The final step is left to
 * the caller's landing sound.
 */
export function playCountUp(steps: number, durationMs: number) {
  const n = Math.max(0, Math.min(14, Math.round(steps)));
  if (n < 2) return;
  const d = durationMs / 1000;
  play(null, { throttle: false }, (c, o, t) => {
    for (let k = 1; k < n; k++) {
      const at = d * (1 - Math.cbrt(1 - k / n));
      tone(c, o, t + at, 660 * Math.pow(2, k / n), 0.045, 0.035, "triangle");
    }
  });
}
