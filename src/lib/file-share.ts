// Handing files to the phone's share sheet, or downloading them on a computer.
// Small and dependency-free: the app shell's media viewer uses it.

/** A phone or tablet: its share sheet is where Save Image and Instagram live. */
export function isTouchDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) return true;
  // iPadOS reports itself as a Mac
  return /Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints ?? 0) > 1;
}

export function canShareFiles(files: File[]): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function" || !files.length) return false;
  try {
    return !navigator.canShare || navigator.canShare({ files });
  } catch {
    return false;
  }
}

export function downloadFiles(files: File[]): boolean {
  if (typeof document === "undefined") return false;
  try {
    files.forEach((f, i) => {
      const url = URL.createObjectURL(f);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      document.body.appendChild(a);
      // a beat apart, or browsers keep only the first
      window.setTimeout(() => {
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      }, i * 250);
    });
    return true;
  } catch {
    return false;
  }
}

export type SaveOutcome = "shared" | "cancelled" | "again" | "saved" | "failed";

/**
 * Hand the files over: the share sheet on a phone (its first await is the
 * share itself, so this must be called straight from the tap), a download
 * on a computer. "again": the phone wouldn't open the sheet from this tap.
 * Chat photos and videos (save-media) and the training report PDF use it.
 */
export async function saveFiles(files: File[]): Promise<SaveOutcome> {
  if (isTouchDevice() && canShareFiles(files)) {
    try {
      await navigator.share({ files });
      return "shared";
    } catch (e: unknown) {
      const name = (e as { name?: string })?.name;
      if (name === "AbortError") return "cancelled";
      if (name === "NotAllowedError") return "again";
      return downloadFiles(files) ? "saved" : "failed";
    }
  }
  return downloadFiles(files) ? "saved" : "failed";
}
