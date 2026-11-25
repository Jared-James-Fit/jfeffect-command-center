/**
 * renderVideo, off the page's thread (Nov 25 2026, T14). Profiling the set
 * video pipeline in code: the clip being sent was cut or re-encoded by
 * mediabunny on the page's own thread (demuxing, every frame handed to the
 * encoder, the whole MP4 written into memory), while the athlete filmed or
 * trimmed the next one, and the copy for Photos was remuxed at the same time.
 * Both now run in a Web Worker each (render-worker.ts), at most
 * `renderSlots()` at once, so the camera and the trimmer keep the page.
 *
 * Quality is unchanged (the same plan, the same encoder). Where a worker
 * can't (no Worker, no encoder in a worker, a grade with its own GL), or the
 * worker fails to start, the page does it as before.
 */
import { renderVideo, VideoRenderError, type RenderOptions, type RenderOutcome } from "@/lib/video-edit/render";
import type { SourceInfo, VideoPlan } from "@/lib/video-edit/plan";
import type { RenderReply, RenderRequest } from "@/lib/video-edit/render-worker";

/** How many clips are prepared at once: two on a phone with cores to spare, else one. */
export function renderSlots(cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2): number {
  return cores >= 6 ? 2 : 1;
}

let active = 0;
const waiting: (() => void)[] = [];
async function slot(signal?: AbortSignal): Promise<() => void> {
  while (active >= renderSlots()) {
    await new Promise<void>((r) => waiting.push(r));
    if (signal?.aborted) throw new VideoRenderError("Cancelled.", "aborted");
  }
  active += 1;
  let freed = false;
  return () => {
    if (freed) return;
    freed = true;
    active -= 1;
    waiting.shift()?.();
  };
}

let workerBroken = false;

function canUseWorker(opts: RenderOptions): boolean {
  return !workerBroken && typeof Worker !== "undefined" && !opts.grade;
}

function inWorker(file: File, info: SourceInfo, plan: VideoPlan, opts: RenderOptions): Promise<RenderOutcome | "unsupported"> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./render-worker.ts", import.meta.url), { type: "module" });
    } catch {
      workerBroken = true;
      return resolve("unsupported");
    }
    let settled = false;
    let uplinkTimer = 0;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearInterval(uplinkTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      fn();
    };
    const onAbort = () => finish(() => reject(new VideoRenderError("Cancelled.", "aborted")));
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    if (opts.signal?.aborted) return onAbort();
    worker.onerror = () => {
      // the worker itself couldn't load (an old webview): the page prepares clips from now on
      workerBroken = true;
      finish(() => resolve("unsupported"));
    };
    worker.onmessage = (e: MessageEvent<RenderReply>) => {
      const m = e.data;
      if ("progress" in m) return opts.onProgress?.(m.progress);
      if (m.ok) return finish(() => resolve({ file: m.file, mode: m.mode, reason: m.reason, ms: m.ms }));
      if (m.unsupported) return finish(() => resolve("unsupported"));
      finish(() => reject(new VideoRenderError(m.message, m.code)));
    };
    // the connection's measured speed moves while it encodes (the slow-encoder decision reads it)
    uplinkTimer = window.setInterval(() => {
      const u = opts.uplinkBytesPerSec?.();
      if (u) worker.postMessage({ uplink: u });
    }, 2000);
    const req: RenderRequest = {
      file,
      info,
      plan,
      limitSeconds: opts.limitSeconds,
      maxBytes: opts.maxBytes,
      uplinkBytesPerSec: opts.uplinkBytesPerSec?.() ?? 1_250_000,
      codec: (globalThis as { __jfVideoCodec?: "vp9" }).__jfVideoCodec ?? null,
    };
    worker.postMessage(req);
  });
}

/** renderVideo in a worker when it can be, one or two at a time; the same outcome either way. */
export async function renderVideoOffThread(file: File, info: SourceInfo, plan: VideoPlan, opts: RenderOptions): Promise<RenderOutcome> {
  // nothing to do: never worth a worker
  if (plan.mode === "original" || plan.mode === "reject") return renderVideo(file, info, plan, opts);
  const free = await slot(opts.signal);
  try {
    if (canUseWorker(opts)) {
      const out = await inWorker(file, info, plan, opts);
      if (out !== "unsupported") return out;
    }
    return await renderVideo(file, info, plan, opts);
  } finally {
    free();
  }
}
