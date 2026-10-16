/**
 * Make the file that uploads: the selection cut out of the original, and
 * re-encoded to 720p when that's what the plan says. Runs on the phone
 * (mediabunny: a remux in plain JS, the re-encode on the phone's own
 * hardware encoder through WebCodecs), so nothing outside the selection is
 * ever sent.
 *
 * Real iPhones re-encode anywhere from ~1x to ~4x slower than real time
 * (upload records from chat), so a re-encode that also has a copy to fall
 * back on is watched: once it's clearly slower than just sending the copy
 * would be, the copy goes instead. Leaving the app mid-encode can stop the
 * encoder; it's tried once more when the app's back on screen.
 */
import { encodeTooSlow, type SourceInfo, type VideoPlan } from "@/lib/video-edit/plan";
import { loadMediabunny, outputCodec } from "@/lib/video-edit/probe";

export type RenderOutcome = {
  file: File;
  mode: "original" | "copy" | "transcode";
  /** Why this mode (for the upload record: "ok", "slow-copy", "encode-failed-copy", …). */
  reason: string;
  ms: number;
};

export type RenderOptions = {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Bytes a second this connection uploads at (for the slow-encoder decision). */
  uplinkBytesPerSec?: () => number;
  /** The published limits, re-checked on the result. */
  limitSeconds: number;
  maxBytes: number;
};

export class VideoRenderError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

const VIDEO_EXT = /\.(mp4|m4v|mov|qt|webm|3gp|mkv)$/i;

/** The file with a type the storage buckets accept (no codec details; type-less clips named for what they are). */
export function normalizeVideoType(file: File): File {
  const type = (file.type.split(";")[0] ?? "").trim().toLowerCase();
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const fixed =
    type === "video/x-m4v" || (!type && (ext === "mp4" || ext === "m4v")) ? "video/mp4"
    : !type && (ext === "mov" || ext === "qt") ? "video/quicktime"
    : !type && ext === "webm" ? "video/webm"
    : type || "video/mp4";
  if (fixed === file.type) return file;
  return new File([file], VIDEO_EXT.test(file.name) ? file.name : `${file.name || "video"}.mp4`, { type: fixed, lastModified: file.lastModified });
}

function stem(name: string) {
  return (name.replace(/\.[^.]+$/, "") || "video").replace(/[^\w.-]+/g, "-").slice(0, 60);
}

function aborted(signal?: AbortSignal): never | void {
  if (signal?.aborted) throw new VideoRenderError("Cancelled.", "aborted");
}

/** Resolves when the app is on screen (immediately if it is). */
function whenVisible(signal?: AbortSignal): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState === "visible") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const on = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", on);
      resolve();
    };
    document.addEventListener("visibilitychange", on);
    signal?.addEventListener("abort", () => {
      document.removeEventListener("visibilitychange", on);
      reject(new VideoRenderError("Cancelled.", "aborted"));
    }, { once: true });
  });
}

type Job = { mode: "copy" | "transcode"; plan: Extract<VideoPlan, { mode: "copy" | "transcode" }> };

async function runConversion(
  file: File,
  info: SourceInfo,
  job: Job,
  opts: RenderOptions,
  watch: ((conv: { cancel(): Promise<void> }, p: number) => void) | null,
): Promise<File> {
  const mb = await loadMediabunny();
  aborted(opts.signal);
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  const webm = job.mode === "copy" && info.container === "webm";
  const output = new mb.Output({
    format: webm ? new mb.WebMOutputFormat() : new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new mb.BufferTarget(),
  });
  let conv: Awaited<ReturnType<typeof mb.Conversion.init>> | null = null;
  const onAbort = () => void conv?.cancel().catch(() => {});
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const p = job.plan;
    if (job.mode === "copy") {
      conv = await mb.Conversion.init({
        input,
        output,
        trim: { start: p.start, end: p.end },
        // never lose a frame of the selection; MP4 hides the lead-in from the keyframe before it, WebM can't
        copy: { mode: "forced", boundaryPolicy: "expand", ...(webm ? { shiftTolerance: Infinity } : {}) },
        showWarnings: false,
      });
    } else {
      const t = job.plan as Extract<VideoPlan, { mode: "transcode" }>;
      // only the long edge is given (the other follows the picture's own shape, rotation included)
      const portrait = info.height > info.width;
      const scaled = Math.max(t.width, t.height) < Math.max(info.width, info.height);
      let aac = false;
      if (info.hasAudio && info.audioCodec && info.audioCodec !== "aac") aac = await mb.canEncodeAudio("aac").catch(() => false);
      conv = await mb.Conversion.init({
        input,
        output,
        trim: { start: t.start, end: t.end },
        video: {
          ...(scaled ? (portrait ? { height: t.height } : { width: t.width }) : {}),
          ...(t.frameRate ? { frameRate: t.frameRate } : {}),
          codec: outputCodec(),
          quality: new mb.Quality({ bitrate: t.videoBitrate }),
          forceTranscode: true,
          keyFrameInterval: 2,
        },
        // audio is copied as it is when it can be (iPhones have no AAC encoder in the browser)
        audio: aac ? { codec: "aac", quality: new mb.Quality({ bitrate: 128_000 }) } : {},
        showWarnings: false,
      });
    }
    aborted(opts.signal);
    if (!conv.isValid) throw new VideoRenderError("This video's format can't be prepared on this phone.", "invalid");
    // Never lose the picture or the sound. An extra track we can't read is fine
    // to leave out as long as one audio track survives (newer iPhones add a
    // spatial-audio track next to the normal AAC one).
    const kept = conv.utilizedTracks;
    if (!kept.some((t) => t.type === "video") || (info.hasAudio && !kept.some((t) => t.type === "audio"))) {
      const dropped = conv.discardedTracks.map((d) => `${d.track.type}-${d.track.codec ?? "?"}:${d.reason}`).join(",");
      throw new VideoRenderError("This video's sound or picture can't be kept on this phone.", `dropped:${dropped}`);
    }
    const c = conv;
    c.onProgress = (fraction: number) => {
      const f = Math.max(0, Math.min(1, fraction));
      opts.onProgress?.(f);
      watch?.(c, f);
    };
    await c.execute();
    aborted(opts.signal);
    const buffer = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
    if (!buffer || buffer.byteLength === 0) throw new VideoRenderError("Couldn't prepare that video.", "empty");
    const ext = webm ? "webm" : "mp4";
    return new File([buffer], `${stem(file.name)}-${job.mode === "copy" ? "trim" : "720p"}.${ext}`, { type: webm ? "video/webm" : "video/mp4", lastModified: Date.now() });
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    input.dispose?.();
  }
}

/** How long the result runs (read back from its own header). */
export async function fileDuration(file: File): Promise<number | null> {
  try {
    const mb = await loadMediabunny();
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    try {
      return await input.computeDuration();
    } finally {
      input.dispose?.();
    }
  } catch {
    return null;
  }
}

/** Run one conversion; if the app went to the background and that broke it, once more when it's back. */
async function convertOnceMore(file: File, info: SourceInfo, job: Job, opts: RenderOptions, watch: Parameters<typeof runConversion>[4]): Promise<File> {
  let wentAway = typeof document !== "undefined" && document.visibilityState !== "visible";
  const away = () => { if (document.visibilityState !== "visible") wentAway = true; };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", away);
  try {
    return await runConversion(file, info, job, opts, watch);
  } catch (e) {
    if (opts.signal?.aborted || (e instanceof VideoRenderError && e.code !== "empty") || !wentAway) throw e;
    if (e instanceof Error && e.name === "ConversionCanceledError") throw e;
    await whenVisible(opts.signal);
    return await runConversion(file, info, job, opts, watch);
  } finally {
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", away);
  }
}

/** Never sends more than the plan allows; throws VideoRenderError with a message to show. */
export async function renderVideo(file: File, info: SourceInfo, plan: VideoPlan, opts: RenderOptions): Promise<RenderOutcome> {
  const t0 = Date.now();
  const done = (out: File, mode: RenderOutcome["mode"], reason: string): RenderOutcome => ({ file: out, mode, reason, ms: Date.now() - t0 });
  if (plan.mode === "reject") throw new VideoRenderError(plan.reason, "rejected");
  if (plan.mode === "original") {
    opts.onProgress?.(1);
    return done(normalizeVideoType(file), "original", "ok");
  }

  const checkOut = async (out: File, mode: "copy" | "transcode") => {
    if (out.size > opts.maxBytes) throw new VideoRenderError("That clip is still too big to send. Trim it shorter.", `too-big:${out.size}`);
    const d = await fileDuration(out);
    if (d != null && d > opts.limitSeconds + 1) throw new VideoRenderError("That clip runs over the limit here. Trim it a little shorter.", `too-long:${d.toFixed(1)}`);
    return out;
  };

  if (plan.mode === "copy") {
    const out = await convertOnceMore(file, info, { mode: "copy", plan }, opts, null);
    return done(await checkOut(out, "copy"), "copy", "ok");
  }

  // transcode, watched when a copy could go instead
  const fallback = plan.copyFallback;
  let tooSlow = false;
  const started = Date.now();
  const watch = fallback
    ? (conv: { cancel(): Promise<void> }, p: number) => {
        if (tooSlow) return;
        if (encodeTooSlow({ elapsedMs: Date.now() - started, progress: p, copyBytes: fallback.estBytes, outBytes: plan.estBytes, uplinkBytesPerSec: opts.uplinkBytesPerSec?.() ?? 1_250_000 })) {
          tooSlow = true;
          void conv.cancel().catch(() => {});
        }
      }
    : null;
  const copyPlan: Extract<VideoPlan, { mode: "copy" }> = { mode: "copy", start: plan.start, end: plan.end, estBytes: fallback?.estBytes ?? 0 };
  const whole = plan.start <= 0.05 && plan.end >= info.duration - 0.05;
  const sendCopy = async (why: string) => {
    opts.onProgress?.(0);
    if (whole) return done(normalizeVideoType(file), "original", why);
    const out = await convertOnceMore(file, info, { mode: "copy", plan: copyPlan }, opts, null);
    return done(await checkOut(out, "copy"), "copy", why);
  };
  try {
    const out = await convertOnceMore(file, info, { mode: "transcode", plan }, opts, watch);
    // a re-encode that came out bigger than the copy: send the copy (fewer bytes and the original quality)
    if (fallback && out.size > fallback.estBytes) return await sendCopy("copy-smaller");
    return done(await checkOut(out, "transcode"), "transcode", "ok");
  } catch (e) {
    aborted(opts.signal);
    if (tooSlow) return await sendCopy(`slow@${Math.round(((Date.now() - started) / 1000))}s`);
    if (fallback && !(e instanceof VideoRenderError && e.code.startsWith("too-"))) {
      const why = e instanceof VideoRenderError ? e.code : e instanceof Error ? `${e.name}:${e.message}`.slice(0, 80) : "error";
      return await sendCopy(`encode-failed:${why}`);
    }
    if (e instanceof VideoRenderError) throw e;
    throw new VideoRenderError("Couldn't shrink this video on this phone. Trim it shorter and try again.", e instanceof Error ? `${e.name}:${e.message}`.slice(0, 120) : "error");
  }
}
