// Web vibration. Capacitor-ready (swap with @capacitor/haptics).
export type HapticStyle = "light" | "medium" | "heavy" | "success" | "warning" | "error";

const PATTERNS: Record<HapticStyle, number | number[]> = {
  light: 10,
  medium: 20,
  heavy: 35,
  success: [12, 40, 12],
  warning: [20, 60, 20],
  error: [40, 60, 40, 60, 40],
};

export function haptic(style: HapticStyle = "light"): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    (navigator as Navigator & { vibrate: (p: number | number[]) => boolean }).vibrate(PATTERNS[style]);
  } catch {
    // ignore
  }
}