// Web Share API. Capacitor-ready (swap with @capacitor/share).

export type ShareInput = { title?: string; text?: string; url?: string };

export function canShare(input?: ShareInput): boolean {
  if (typeof navigator === "undefined" || !("share" in navigator)) return false;
  if (!input) return true;
  const n = navigator as Navigator & { canShare?: (d: ShareInput) => boolean };
  return n.canShare ? n.canShare(input) : true;
}

export async function share(input: ShareInput): Promise<"shared" | "copied" | "unsupported"> {
  try {
    if (canShare(input)) {
      await (navigator as Navigator & { share: (d: ShareInput) => Promise<void> }).share(input);
      return "shared";
    }
    if (input.url && typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(input.url);
      return "copied";
    }
    return "unsupported";
  } catch {
    return "unsupported";
  }
}