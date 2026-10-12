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

export type AppSound = "message" | "sent" | "notify" | "success" | "celebrate" | "reply";

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
  // Soft rising pair, quieter than a message — Cleo's answer is in.
  reply: (c, o, t) => { tone(c, o, t, 783.99, 0.32, 0.07); tone(c, o, t + 0.1, 1174.66, 0.5, 0.06); },
  celebrate: (c, o, t) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, o, t + i * 0.07, f, i === 3 ? 0.7 : 0.25, 0.12, "triangle"));
    for (let i = 0; i < 5; i++) tone(c, o, t + 0.3 + i * 0.045, 2093 * Math.pow(2, (i * 3) / 12), 0.25, 0.035);
  },
};

export function playAppSound(name: AppSound, opts: { force?: boolean } = {}) {
  if (typeof window === "undefined") return;
  if (!opts.force) {
    if (!appSoundsEnabled()) return;
    if (document.visibilityState === "hidden") return;
    const now = Date.now();
    if (now - lastAny < 600 || now - (lastBy[name] ?? 0) < 2500) return;
    lastAny = now;
    lastBy[name] = now;
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
 * Cleo's "working on it" sound: soft, slow bell notes drifting through a
 * pentatonic set while she thinks. Very quiet, starts after a short pause
 * (quick answers stay silent), follows the sounds toggle and the silent
 * switch. Returns stop(), which fades it out.
 */
const THINK_NOTES = [659.25, 783.99, 987.77, 1174.66, 987.77, 783.99];
export function startThinkingSound(): () => void {
  if (typeof window === "undefined" || !appSoundsEnabled()) return () => {};
  const c = getCtx();
  if (!c) return () => {};
  if (c.state !== "running") void c.resume().catch(() => {});
  let master: GainNode | null = null;
  let step = 0;
  let timer = 0;
  const note = () => {
    if (!master || c.state !== "running" || document.visibilityState === "hidden") return;
    const t = c.currentTime + 0.02;
    const f = THINK_NOTES[step++ % THINK_NOTES.length];
    // Slow attack and a long tail: a breath, not a beep.
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(f, t);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 1.6);
    tone(c, master, t, f * 2, 0.8, 0.008);
  };
  const begin = window.setTimeout(() => {
    try {
      master = c.createGain();
      master.gain.value = 0.9;
      master.connect(c.destination);
      note();
      timer = window.setInterval(note, 1100);
    } catch { /* never let a sound break the UI */ }
  }, 450);
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
      m.gain.setTargetAtTime(0, c.currentTime, 0.08);
      window.setTimeout(() => { try { m.disconnect(); } catch { /* gone */ } }, 600);
    } catch { /* gone */ }
  };
}

