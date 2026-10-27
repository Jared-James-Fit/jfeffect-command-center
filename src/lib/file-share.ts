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
