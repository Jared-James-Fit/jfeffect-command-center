/**
 * Cleo's own server voices: smooth, natural female voices. Shared by the
 * voice picker (Customize Cleo), the browser speaker and the server
 * (summer.server.ts), which maps each one to a provider voice. "Smooth" is
 * the default.
 */
export const CLEO_VOICES = [
  { value: "smooth", label: "Smooth", description: "Calm, smooth and clear. The default." },
  { value: "warm", label: "Warm", description: "Warm and friendly, a little richer." },
  { value: "soft", label: "Soft", description: "Gentle and soft-spoken." },
  { value: "bright", label: "Bright", description: "Light and upbeat." },
] as const;

export type CleoVoice = (typeof CLEO_VOICES)[number]["value"];
export const DEFAULT_CLEO_VOICE: CleoVoice = "smooth";

export function isCleoVoice(v: unknown): v is CleoVoice {
  return typeof v === "string" && CLEO_VOICES.some((x) => x.value === v);
}

/** Picker value for a server voice: "summer" (the default) or "summer:<voice>". */
export function serverVoiceValue(v: CleoVoice): string {
  return v === DEFAULT_CLEO_VOICE ? "summer" : `summer:${v}`;
}

/** The server voice a picker value means, or null for a device voice. */
export function serverVoiceOf(pref: string): CleoVoice | null {
  if (pref === "summer") return DEFAULT_CLEO_VOICE;
  if (!pref.startsWith("summer:")) return null;
  const v = pref.slice(7);
  return isCleoVoice(v) ? v : DEFAULT_CLEO_VOICE;
}
