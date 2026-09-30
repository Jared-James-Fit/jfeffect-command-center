/**
 * Lightweight synthesized UI sound system.
 * No asset downloads, no autoplay, no overlap storms. Sounds only run after
 * user interaction has unlocked WebAudio and are automatically disabled when
 * the user has muted UI sounds in local storage.
 */
export type UiSound = "tap" | "select" | "success" | "complete" | "pr" | "message" | "warning" | "error";

const KEY = "jf-ui-sounds-enabled";
let ctx: AudioContext | null = null;
let lastPlayed = 0;

export function uiSoundsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(KEY) !== "0";
}

export function setUiSoundsEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, enabled ? "1" : "0");
}

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return null;
  if (!ctx) ctx = new Ctx();
  return ctx;
}

const patterns: Record<UiSound, Array<[number, number, number, OscillatorType]>> = {
  tap: [[520, 0, 0.025, "sine"]],
  select: [[620, 0, 0.035, "sine"]],
  success: [[520, 0, 0.055, "sine"], [760, 0.055, 0.075, "sine"]],
  complete: [[440, 0, 0.06, "sine"], [660, 0.06, 0.07, "sine"], [880, 0.13, 0.11, "sine"]],
  pr: [[523, 0, 0.07, "triangle"], [659, 0.07, 0.07, "triangle"], [784, 0.14, 0.08, "triangle"], [1047, 0.22, 0.14, "triangle"]],
  message: [[700, 0, 0.045, "sine"], [900, 0.05, 0.055, "sine"]],
  warning: [[360, 0, 0.08, "triangle"], [300, 0.09, 0.1, "triangle"]],
  error: [[240, 0, 0.09, "square"], [190, 0.1, 0.12, "square"]],
};

export function playUiSound(sound: UiSound, volume = 0.045): void {
  if (!uiSoundsEnabled()) return;
  const nowMs = Date.now();
  if (sound === "tap" && nowMs - lastPlayed < 70) return;
  lastPlayed = nowMs;
  try {
    const ac = audioContext();
    if (!ac) return;
    if (ac.state === "suspended") void ac.resume();
    const start = ac.currentTime + 0.005;
    for (const [freq, offset, duration, type] of patterns[sound]) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start + offset);
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(volume, start + offset + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(start + offset);
      osc.stop(start + offset + duration + 0.01);
    }
  } catch {
    // Audio feedback is enhancement-only; never interrupt the user action.
  }
}
