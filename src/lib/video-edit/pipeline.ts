/**
 * One video, from the picked file to a checked upload: cut + shrink on the
 * phone (render.ts), upload (resumable: a dropped connection or a retry
 * carries on from what already landed), then the server's own check
 * (video-verify.functions.ts). Each finished step is kept, so trying again
 * after a failure never re-encodes or re-sends what's already done.
 */
import { uploadLiftFileToStorage, measuredUplink } from "@/lib/lift-video-storage-upload";
import { verifyVideoUploadFn, type VideoCheck } from "@/lib/video-verify.functions";
import { videoBudget, videoLimit, type VideoContext } from "@/lib/video-edit/limits";
import { isWhole, planVideo, selectionOf, type SourceInfo, type VideoTrim } from "@/lib/video-edit/plan";
import { renderVideo, VideoRenderError, type RenderOutcome } from "@/lib/video-edit/render";

export type VideoPhase = "preparing" | "uploading" | "checking" | "done";
export type VideoBucket = "community-media" | "message-attachments" | "progress-media" | "form-uploads" | "broadcast-media";

export type SentVideo = {
  path: string;
  file: File;
  render: RenderOutcome;
  check: VideoCheck;
};

export type VideoSendOptions = {
  file: File;
  info: SourceInfo;
  canEncode: boolean;
  trim: VideoTrim | null;
  context: VideoContext;
  bucket: VideoBucket;
  userId: string;
  /** The path without its extension (the extension follows what's sent). */
  stem: string;
};

/** How the bar is shared between the steps (a re-encode is most of the wait). */
function weights(mode: RenderOutcome["mode"] | "transcode-planned" | null): { prep: number; up: number } {
  if (mode === "transcode" || mode === "transcode-planned") return { prep: 0.45, up: 0.52 };
  if (mode === "copy") return { prep: 0.08, up: 0.89 };
  return { prep: 0.02, up: 0.95 };
}

function waitOnline(signal?: AbortSignal, maxMs = 120_000): Promise<boolean> {
  if (typeof navigator === "undefined" || navigator.onLine !== false) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(t);
      window.removeEventListener("online", on);
      resolve(ok);
    };
    const on = () => done(true);
    const t = setTimeout(() => done(false), maxMs);
    window.addEventListener("online", on);
    signal?.addEventListener("abort", () => done(false), { once: true });
  });
}

/**
 * A video on its way up. `run` does whatever's left (and can be called again
 * after a failure); `prepared` is the file that goes, once made.
 */
export function createVideoSend(o: VideoSendOptions) {
  let rendered: RenderOutcome | null = null;
  let uploadedPath: string | null = null;
  let checked: VideoCheck | null = null;
  let upMs = 0;
  const plan = planVideo(o.info, o.trim, o.context, { canEncode: o.canEncode });

  const extOf = (f: File) => (f.type.includes("webm") ? "webm" : f.type.includes("quicktime") ? "mov" : "mp4");

  async function run(onProgress?: (pct: number, phase: VideoPhase) => void, signal?: AbortSignal): Promise<SentVideo> {
    let w = weights(plan.mode === "transcode" ? "transcode-planned" : plan.mode === "copy" ? "copy" : null);
    let shown = 0;
    const report = (fraction: number, phase: VideoPhase) => {
      shown = Math.max(shown, Math.min(100, Math.round(fraction * 100)));
      onProgress?.(shown, phase);
    };
    report(0.01, rendered ? "uploading" : "preparing");

    // 1. cut / shrink
    if (!rendered) {
      rendered = await renderVideo(o.file, o.info, plan, {
        onProgress: (f) => report(f * w.prep, "preparing"),
        signal,
        uplinkBytesPerSec: () => measuredUplink() ?? 1_250_000,
        limitSeconds: videoLimit(o.context),
        maxBytes: videoBudget(o.context).max,
      });
    }
    w = weights(rendered.mode);
    const out = rendered.file;

    // 2. upload (resumable; waits for the connection to come back once)
    if (!uploadedPath) {
      const path = `${o.stem}.${extOf(out)}`;
      const started = Date.now();
      const put = () =>
        uploadLiftFileToStorage({
          file: out,
          userId: o.userId,
          bucket: o.bucket,
          path,
          resume: true,
          signal,
          onProgress: (pct) => report(w.prep + (pct / 100) * w.up, "uploading"),
        });
      try {
        await put();
      } catch (e) {
        if (signal?.aborted || !(await waitOnline(signal))) throw e;
        await put();
      }
      upMs = Date.now() - started;
      uploadedPath = path;
    }

    // 3. the server's own check (its answer is what the database holds us to)
    if (!checked) {
      report(w.prep + w.up, "checking");
      const sel = selectionOf(o.info, o.trim);
      const ask = () =>
        verifyVideoUploadFn({
          data: {
            bucket: o.bucket,
            path: uploadedPath!,
            context: o.context,
            client: {
              mode: rendered!.mode,
              reason: rendered!.reason.slice(0, 140),
              src_s: Math.round(o.info.duration * 10) / 10,
              src_mb: Math.round((o.info.bytes / 1048576) * 10) / 10,
              sel_s: Math.round((sel.end - sel.start) * 10) / 10,
              prep_ms: rendered!.ms,
              up_ms: upMs,
              encode: o.canEncode,
              ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 160) : undefined,
            },
          },
        });
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3 && !checked; attempt++) {
        if (signal?.aborted) throw new VideoRenderError("Cancelled.", "aborted");
        try {
          checked = await ask();
        } catch (e) {
          lastErr = e;
          // a real "no" (too long / not yours) won't change on a retry
          const msg = e instanceof Error ? e.message : "";
          if (/can be up to|too big|only post videos|Couldn't read/.test(msg)) throw e;
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      if (!checked) throw lastErr instanceof Error ? lastErr : new Error("Couldn't check that video. Try again.");
    }
    report(1, "done");
    return { path: uploadedPath!, file: out, render: rendered, check: checked };
  }

  return {
    run,
    plan,
    /** The file that goes up, once it's made. */
    get prepared(): File | null {
      return rendered?.file ?? null;
    },
    /** Uploaded already (to remove if the post is abandoned). */
    get uploadedPath(): string | null {
      return uploadedPath;
    },
    whole: isWhole(o.info, o.trim),
  };
}

export type VideoSend = ReturnType<typeof createVideoSend>;

/** A message for a failed send (never a stack trace). */
export function videoErrorMessage(e: unknown): string {
  if (e instanceof VideoRenderError) return e.message;
  const msg = e instanceof Error ? e.message : "";
  if (/can be up to|too big|only post videos|Couldn't read|didn't finish|Trim it/.test(msg)) return msg;
  if (/cancel/i.test(msg)) return "Cancelled.";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "You're offline. It'll carry on when you're back online. Tap to try again.";
  return "That video didn't upload. Tap to try again.";
}
