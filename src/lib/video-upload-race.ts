// Send a chat video as fast as this phone and connection allow.
//
// Compressing first and uploading after (the old order) means a phone that
// compresses slowly, or can't compress this clip, pays for the attempt before
// a single byte goes out. Real uploads showed exactly that: ~28s spent on a
// compression that gave up, then the full 45 MB original went out anyway.
//
// So both start at once: the original begins uploading immediately while the
// phone compresses a copy. When the copy is ready it replaces the original
// only if uploading it would finish sooner than what's left of the original;
// otherwise the original just carries on. Never slower than sending the
// original, usually much faster.

import type { CompressOutcome } from "@/lib/video-compress";

type Progress = (fraction: number) => void;

export type RaceDeps = {
  originalBytes: number;
  uploadOriginal: (onProgress: Progress, signal: AbortSignal) => Promise<void>;
  compress: (onProgress: Progress, signal: AbortSignal) => Promise<CompressOutcome>;
  uploadCompressed: (file: File, onProgress: Progress, signal: AbortSignal) => Promise<void>;
};

export type RaceResult = {
  sent: "original" | "compressed";
  /** Why this one was sent (for the upload record). */
  why: string;
  compressed: File | null;
  compress: CompressOutcome | null;
};

/** Switch to the compressed copy only if it's clearly less than what's left of the original. */
export function shouldSwitch(compressedBytes: number, originalBytes: number, originalFraction: number): boolean {
  const remaining = originalBytes * (1 - Math.max(0, Math.min(1, originalFraction)));
  return compressedBytes < remaining * 0.85;
}

export async function raceVideoUpload(
  deps: RaceDeps,
  opts: { signal?: AbortSignal; onProgress?: Progress } = {},
): Promise<RaceResult> {
  const origCtl = new AbortController();
  const compCtl = new AbortController();
  const stopAll = () => { origCtl.abort(); compCtl.abort(); };
  if (opts.signal?.aborted) stopAll();
  opts.signal?.addEventListener("abort", stopAll, { once: true });

  // One bar for the whole thing: whichever path is further along, never moving backwards.
  let origFrac = 0;
  let compFrac = 0;
  let upFrac = 0;
  let phase: "racing" | "compressed-upload" = "racing";
  let shown = 0;
  const report = () => {
    const est = phase === "racing" ? Math.max(origFrac, compFrac * 0.5) : Math.max(0.5 + upFrac * 0.5, 0);
    shown = Math.max(shown, Math.min(0.99, est));
    opts.onProgress?.(shown);
  };

  let origDone = false;
  let origError: unknown = null;
  const origP = deps
    .uploadOriginal((f) => { origFrac = f; report(); }, origCtl.signal)
    .then(() => { origDone = true; }, (e) => { origError = e ?? new Error("Upload failed"); });
  const compP = deps.compress((f) => { compFrac = f; report(); }, compCtl.signal);

  const sendCompressed = async (file: File, why: string, outcome: CompressOutcome): Promise<RaceResult> => {
    phase = "compressed-upload";
    report();
    await deps.uploadCompressed(file, (f) => { upFrac = f; report(); }, compCtl.signal);
    return { sent: "compressed", why, compressed: file, compress: outcome };
  };

  try {
    const first = await Promise.race([origP.then(() => "original" as const), compP.then(() => "compress" as const)]);

    if (first === "original") {
      if (!origError) {
        // The original made it before the copy was ready: done, stop compressing.
        compCtl.abort();
        const outcome = await Promise.race([
          compP,
          new Promise<null>((r) => setTimeout(() => r(null), 300)),
        ]);
        return { sent: "original", why: "original-first", compressed: null, compress: outcome };
      }
      // The original failed (e.g. connection dropped): the copy is the only way out.
      const outcome = await compP;
      if (outcome.file) return await sendCompressed(outcome.file, "original-failed", outcome);
      throw origError;
    }

    const outcome = await compP;
    if (outcome.file && !origDone) {
      if (origError || shouldSwitch(outcome.file.size, deps.originalBytes, origFrac)) {
        origCtl.abort();
        return await sendCompressed(outcome.file, origError ? "original-failed" : "compressed-sooner", outcome);
      }
    }
    // No usable copy, or the original is nearly there: let it finish.
    await origP;
    if (origError) {
      if (outcome.file) return await sendCompressed(outcome.file, "original-failed", outcome);
      throw origError;
    }
    return {
      sent: "original",
      why: outcome.file ? "original-nearly-done" : `not-compressed:${outcome.reason}`,
      compressed: null,
      compress: outcome,
    };
  } finally {
    opts.signal?.removeEventListener("abort", stopAll);
  }
}
