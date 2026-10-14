/**
 * UI sounds for controls (checkboxes, save buttons, chat) — a thin layer over
 * app-sounds.ts so the whole app has ONE sound system: one setting (Settings →
 * Notifications, the workout recap's speaker, Workout Tools), one audio
 * context, and the iPhone "ambient" session (mixes with the athlete's music
 * instead of pausing it, follows the silent switch). Nothing is downloaded.
 */
import { appSoundsEnabled, playAppSound, setAppSoundsEnabled, type AppSound } from "@/lib/app-sounds";

export type UiSound = "tap" | "select" | "success" | "complete" | "pr" | "message" | "warning" | "error";

/** Controls stay light: a save is a quick tick up, not a jingle. */
const AS: Record<UiSound, AppSound> = {
  tap: "tick",
  select: "tick",
  success: "sent",
  complete: "success",
  pr: "pr",
  message: "message",
  warning: "error",
  error: "error",
};

export function uiSoundsEnabled(): boolean {
  return appSoundsEnabled();
}

export function setUiSoundsEnabled(enabled: boolean) {
  setAppSoundsEnabled(enabled);
}

/** `volume` is ignored: levels are set per sound in app-sounds.ts. */
export function playUiSound(sound: UiSound, _volume?: number): void {
  playAppSound(AS[sound]);
}

/** app-sounds unlocks audio on the first tap by itself; kept for callers. */
export function unlockUiSounds(): void {}
