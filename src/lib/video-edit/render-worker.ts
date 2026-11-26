/**
 * One clip prepared off the page's thread (render-off-thread.ts): the same
 * renderVideo (mediabunny: the remux, the hardware re-encode through
 * WebCodecs and the in-memory MP4 it writes), so the logger, the camera and
 * the trimmer for the next clip never wait on it. Progress is posted at most
 * every PROGRESS_MS.
 */
import { renderVideo, VideoRenderError } from "@/lib/video-edit/render";
import type { SourceInfo, VideoPlan } from "@/lib/video-edit/plan";

export type RenderRequest = {
  file: File;
  info: SourceInfo;
  plan: VideoPlan;
  limitSeconds: number;
  maxBytes: number;
  uplinkBytesPerSec: number;
  codec?: "vp9" | null;
};

export type RenderReply =
  | { progress: number }
  | { ok: true; file: File; mode: "original" | "copy" | "transcode"; reason: string; ms: number }
  | { ok: false; message: string; code: string; unsupported?: boolean };

const PROGRESS_MS = 120;

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<RenderRequest | { uplink: number } | { cancel: true }>) => void) | null;
  postMessage: (v: RenderReply) => void;
};

let uplink = 1_250_000;
const ctl = new AbortController();

scope.onmessage = async (e) => {
  const msg = e.data;
  if ("cancel" in msg) return ctl.abort();
  if ("uplink" in msg) {
    uplink = msg.uplink;
    return;
  }
  // a re-encode needs the phone's encoder in a worker; without it the page does it (render-off-thread.ts)
  const g = self as unknown as { VideoEncoder?: unknown; VideoDecoder?: unknown; __jfVideoCodec?: string };
  if (msg.plan.mode === "transcode" && (typeof g.VideoEncoder !== "function" || typeof g.VideoDecoder !== "function"))
    return scope.postMessage({ ok: false, message: "No encoder in a worker here.", code: "worker-unsupported", unsupported: true });
  if (msg.codec) g.__jfVideoCodec = msg.codec;
  uplink = msg.uplinkBytesPerSec || uplink;
  let last = 0;
  try {
    const out = await renderVideo(msg.file, msg.info, msg.plan, {
      signal: ctl.signal,
      limitSeconds: msg.limitSeconds,
      maxBytes: msg.maxBytes,
      uplinkBytesPerSec: () => uplink,
      onProgress: (f) => {
        const now = Date.now();
        if (f < 1 && now - last < PROGRESS_MS) return;
        last = now;
        scope.postMessage({ progress: f });
      },
    });
    scope.postMessage({ ok: true, file: out.file, mode: out.mode, reason: out.reason, ms: out.ms });
  } catch (err) {
    if (err instanceof VideoRenderError) return scope.postMessage({ ok: false, message: err.message, code: err.code });
    const name = err instanceof Error ? err.name : "Error";
    scope.postMessage({ ok: false, message: err instanceof Error ? err.message : "Couldn't prepare that video.", code: `${name}`.slice(0, 80) });
  }
};
