/**
 * Cleo's own server voices. Shared by the voice picker (Customize Cleo), the
 * browser speaker and the server (summer.server.ts), which maps each one to a
 * provider voice. Cleo is an AI with no gender; "Neutral" is the default.
 */
export const CLEO_VOICES = [
  { value: "neutral", label: "Neutral", description: "Clean, even and smooth. The default." },
  { value: "soft", label: "Soft", description: "Gentle and warm, a little lighter." },
  { value: "deep", label: "Deep", description: "Lower and calm." },
  { value: "bright", label: "Bright", description: "Clear and upbeat." },
] as const;

export type CleoVoice = (typeof CLEO_VOICES)[number]["value"];
export const DEFAULT_CLEO_VOICE: CleoVoice = "neutral";

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
