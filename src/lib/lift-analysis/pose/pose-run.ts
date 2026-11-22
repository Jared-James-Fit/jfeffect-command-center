/**
 * The athlete's body through a set video, found on this device (never
 * uploaded): MediaPipe's BlazePose (Apache-2.0), its WebAssembly and model
 * served from this app, run on the phone's GPU where it has one, else its
 * CPU. Loaded only when Technique is opened (about 24 MB the first time,
 * then from the browser's cache), so bar speed never waits on it.
 *
 * Frames are decoded at `POSE_FPS` across the set (mediabunny, the same
 * decoder as the bar read), each read on its own (the model's IMAGE mode:
 * its VIDEO mode kept following whoever it found first and stopped looking
 * for anyone else), smoothed afterwards (skeleton.ts). With more than one person in
 * the picture the athlete is the one at the bar: the body nearest the bar's
 * read position, else the one nearest the body found the frame before, else
 * the biggest. Progress is measured: bytes of the model downloaded, then
 * frames read, never a timer.
 */
import { loadMediabunny } from "@/lib/video-edit/probe";
import { LANDMARKS, type PoseFrame, type PoseTrack } from "@/lib/lift-analysis/pose/skeleton";

/** Frames a second read for the body (angles and timings need no more; each one costs ~20-40 ms). */
export const POSE_FPS = 15;
/** The longest side handed to the model (it reads a 256 px square anyway). */
const POSE_LONG_SIDE = 640;
/** Read for at most this long (s) of a clip. */
const POSE_MAX_SECONDS = 90;

export const POSE_MODEL = "pose_landmarker_full";
const MODEL_URL = `/models/${POSE_MODEL}.task`;

export type PoseStage = "model" | "detecting";
export type PoseProgress = { stage: PoseStage; progress: number };

export type PoseRunInput = {
  source: Blob | string;
  /** The part of the clip to read (s): the set's window, with a little either side. */
  window: { start: number; end: number };
  /** Where the bar is at a moment (shares of the frame), to tell the athlete from anyone else. */
  barAt?: (t: number) => { fx: number; fy: number } | null;
  signal?: AbortSignal;
  onProgress?: (p: PoseProgress) => void;
  /** The track so far, as it's read (the skeleton shows on the video before the read is done). */
  onPartial?: (track: PoseTrack) => void;
};

export type PoseRunResult =
  | { ok: true; track: PoseTrack; model: string; delegate: "GPU" | "CPU"; ms: number }
  | { ok: false; why: "cancelled" | "unreadable" | "model_failed" | "no_body" };

type Landmarker = {
  detect: (img: TexImageSource) => { landmarks: { x: number; y: number; visibility?: number }[][] };
  close: () => void;
};

let landmarkerP: Promise<{ lm: Landmarker; delegate: "GPU" | "CPU" }> | null = null;
/** The CPU build of the same model, made when the GPU turns out slower (a browser drawing WebGL in software). */
let cpuMaker: (() => Promise<Landmarker>) | null = null;
/** A frame on the GPU slower than this (ms, the median of the first few) means its WebGL is software. */
const SLOW_GPU_MS = 150;

/** Fetch a file reporting how much of it has come in (Content-Length when the server says it). */
async function fetchWithProgress(
  url: string,
  expect: number,
  onBytes: (n: number) => void,
): Promise<Uint8Array> {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok || !res.body) throw new Error(`fetch ${url}: ${res.status}`);
  const total = Number(res.headers.get("content-length")) || expect;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.byteLength;
    onBytes(Math.min(got, total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

/** The model, loaded once a page (the first open downloads it, with real progress). */
function loadLandmarker(onProgress: (share: number) => void) {
  if (landmarkerP) return landmarkerP;
  landmarkerP = (async () => {
    const [vision, loaderUrl, wasmUrl] = await Promise.all([
      import("@mediapipe/tasks-vision"),
      import("@mediapipe/tasks-vision/vision_wasm_internal.js?url").then((m) => m.default),
      import("@mediapipe/tasks-vision/vision_wasm_internal.wasm?url").then((m) => m.default),
    ]);
    // the two big files, counted together (sizes as shipped: the fallback when no Content-Length)
    const EXPECT = { wasm: 14_603_354, model: 9_398_198 };
    let wasmBytes = 0;
    let modelBytes = 0;
    const tell = () => onProgress((wasmBytes + modelBytes) / (EXPECT.wasm + EXPECT.model));
    const [wasm, model] = await Promise.all([
      fetchWithProgress(wasmUrl, EXPECT.wasm, (n) => {
        wasmBytes = n;
        tell();
      }),
      fetchWithProgress(MODEL_URL, EXPECT.model, (n) => {
        modelBytes = n;
        tell();
      }),
    ]);
    const wasmBlobUrl = URL.createObjectURL(
      new Blob([wasm.buffer as ArrayBuffer], { type: "application/wasm" }),
    );
    const fileset = { wasmLoaderPath: loaderUrl, wasmBinaryPath: wasmBlobUrl };
    const make = (delegate: "GPU" | "CPU") =>
      vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: model, delegate },
        // every frame found afresh: the model's VIDEO mode follows one body and stops looking for the
        // athlete once it has someone (a coach standing beside them kept, the lifter dropped)
        runningMode: "IMAGE",
        numPoses: 2,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      }) as unknown as Promise<Landmarker>;
    cpuMaker = () => make("CPU");
    const forced = (globalThis as { __jfPoseDelegate?: "GPU" | "CPU" }).__jfPoseDelegate;
    if (forced === "CPU") return { lm: await make("CPU"), delegate: "CPU" as const };
    try {
      return { lm: await make("GPU"), delegate: "GPU" as const };
    } catch {
      return { lm: await make("CPU"), delegate: "CPU" as const };
    }
  })().catch((e) => {
    landmarkerP = null;
    throw e;
  });
  return landmarkerP;
}

/** Start downloading the model ahead of use (Technique's tab shown, never on its own). */
export function warmPoseModel(): void {
  if (typeof window === "undefined") return;
  void loadLandmarker(() => {}).catch(() => {});
}

type Body = {
  f: PoseFrame;
  cx: number;
  cy: number;
  size: number;
  box: [number, number, number, number];
};

function bodyOf(lms: { x: number; y: number; visibility?: number }[]): Body {
  const f = new Float32Array(3 * LANDMARKS);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let j = 0; j < LANDMARKS; j++) {
    const p = lms[j];
    if (!p) {
      f[3 * j + 2] = 0;
      continue;
    }
    // the model's visibility; a build without it gives 1 for a landmark it returned
    const v = typeof p.visibility === "number" && p.visibility > 0 ? p.visibility : 1;
    f[3 * j] = p.x;
    f[3 * j + 1] = p.y;
    f[3 * j + 2] = v;
    if (v >= 0.5) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  if (!Number.isFinite(x0)) {
    x0 = y0 = 0;
    x1 = y1 = 0;
  }
  // the torso's middle (shoulders and hips) as where the body is
  const mid = [11, 12, 23, 24].map((j) => [f[3 * j], f[3 * j + 1]]);
  const cx = mid.reduce((s, p) => s + p[0], 0) / 4;
  const cy = mid.reduce((s, p) => s + p[1], 0) / 4;
  return { f, cx, cy, size: Math.max(1e-3, (x1 - x0) * (y1 - y0)), box: [x0, y0, x1, y1] };
}

/** How far (share of the frame) the athlete's torso can move between two frames read 1/15 s apart. */
export const MAX_BODY_JUMP = 0.12;
/** How far from a body's outline the bar can be and still be in their hands (share of the frame). */
export const BAR_REACH = 0.08;

/**
 * Which body is the athlete (pure, tested): the one holding the bar (its
 * outline round the bar's read position, or nearest it), else the one nearest
 * where the athlete was a frame ago, else, at the start, the biggest. Never
 * someone else: once the athlete is found, a body that isn't at the bar and
 * isn't where the athlete just was is nobody (-1), so a coach or a passer-by
 * is never read as the lifter when the model loses them for a moment.
 */
export function pickAthlete(
  bodies: { cx: number; cy: number; size: number; box: [number, number, number, number] }[],
  bar: { fx: number; fy: number } | null,
  prev: { cx: number; cy: number } | null,
): number {
  if (!bodies.length) return -1;
  const boxDist = (b: [number, number, number, number], x: number, y: number) =>
    Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]));
  const fromPrev = (b: { cx: number; cy: number }) =>
    prev ? Math.hypot(b.cx - prev.cx, b.cy - prev.cy) : Infinity;
  if (bar) {
    let best = -1;
    let bd = Infinity;
    bodies.forEach((b, i) => {
      // inside the outline counts as 0, then the torso's distance breaks ties
      const reach = boxDist(b.box, bar.fx, bar.fy);
      const ok = reach <= BAR_REACH || fromPrev(b) <= MAX_BODY_JUMP;
      if (!ok) return;
      const d = reach * 10 + Math.hypot(b.cx - bar.fx, b.cy - bar.fy);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }
  if (prev) {
    let best = -1;
    let bd = MAX_BODY_JUMP;
    bodies.forEach((b, i) => {
      const d = fromPrev(b);
      if (d <= bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }
  return bodies.reduce((bi, b, i) => (b.size > bodies[bi].size ? i : bi), 0);
}

/** The last read, kept for reopening the same clip (one at a time). */
let lastRead: { key: string; track: PoseTrack; delegate: "GPU" | "CPU" } | null = null;
const blobIds = new WeakMap<Blob, number>();
let nextBlobId = 1;
function sourceKey(src: Blob | string): string {
  if (typeof src !== "string") {
    let id = blobIds.get(src);
    if (!id) blobIds.set(src, (id = nextBlobId++));
    return `blob:${id}`;
  }
  try {
    const u = new URL(src, typeof location !== "undefined" ? location.href : "http://x");
    return u.origin + u.pathname;
  } catch {
    return src;
  }
}

class Cancelled extends Error {}

export async function runPose(input: PoseRunInput): Promise<PoseRunResult> {
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const check = () => {
    if (input.signal?.aborted) throw new Cancelled();
  };
  const report = (stage: PoseStage, progress: number) =>
    input.onProgress?.({ stage, progress: Math.max(0, Math.min(1, progress)) });
  let disposable: { dispose?: () => void } | null = null;
  try {
    const span0 = Math.max(0, input.window.start);
    const key = `${sourceKey(input.source)}|${span0.toFixed(2)}|${input.window.end.toFixed(2)}|${POSE_FPS}`;
    if (lastRead?.key === key) {
      return {
        ok: true,
        track: lastRead.track,
        model: POSE_MODEL,
        delegate: lastRead.delegate,
        ms: 0,
      };
    }
    report("model", 0);
    let loaded: { lm: Landmarker; delegate: "GPU" | "CPU" };
    try {
      loaded = await loadLandmarker((s) => report("model", s));
    } catch {
      return { ok: false, why: "model_failed" };
    }
    check();
    report("detecting", 0);
    const mb = await loadMediabunny();
    const src =
      typeof input.source === "string"
        ? new mb.UrlSource(input.source)
        : new mb.BlobSource(input.source);
    const inp = new mb.Input({ source: src, formats: mb.ALL_FORMATS });
    disposable = inp;
    const vt = await inp.getPrimaryVideoTrack();
    if (!vt || !(await vt.canDecode())) return { ok: false, why: "unreadable" };
    const duration = await inp.computeDuration();
    const first = await vt.getFirstTimestamp().catch(() => 0);
    const start = Math.max(first, span0);
    const end = Math.min(duration, input.window.end, start + POSE_MAX_SECONDS);
    if (!(end > start)) return { ok: false, why: "unreadable" };
    const dw = vt.displayWidth || 9;
    const dh = vt.displayHeight || 16;
    const L = Math.min(POSE_LONG_SIDE, Math.max(dw, dh));
    const w = dw >= dh ? L : Math.max(16, Math.round((L * dw) / dh));
    const h = dw >= dh ? Math.max(16, Math.round((L * dh) / dw)) : L;
    const sink = new mb.CanvasSink(vt, { width: w, height: h, fit: "fill", poolSize: 2 });
    const n = Math.max(2, Math.round((end - start) * POSE_FPS));
    const times = Array.from({ length: n }, (_, i) => start + (i * (end - start)) / (n - 1));
    const track: PoseTrack = { frame: { w: dw, h: dh }, t: [], frames: [] };
    let prev: { cx: number; cy: number } | null = null;
    /** Frames since the athlete was last found (after a second, where they were says nothing). */
    let prevAge = 0;
    const gpuMs: number[] = [];
    let found = 0;
    let k = 0;
    let lastPartial = 0;
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      check();
      k++;
      if (!wc) continue;
      let res: ReturnType<Landmarker["detect"]> | null = null;
      const d0 = performance.now();
      try {
        res = loaded.lm.detect(wc.canvas as TexImageSource);
      } catch {
        res = null;
      }
      if (loaded.delegate === "GPU" && gpuMs.length < 4) {
        gpuMs.push(performance.now() - d0);
        // the first frame warms the GPU up: judged on the next three
        if (
          gpuMs.length === 4 &&
          [...gpuMs.slice(1)].sort((a, b) => a - b)[1] > SLOW_GPU_MS &&
          cpuMaker
        ) {
          try {
            const lm = await cpuMaker();
            loaded = { lm, delegate: "CPU" };
            landmarkerP = Promise.resolve(loaded);
          } catch {
            /* keep the GPU */
          }
        }
      }
      const bodies = (res?.landmarks ?? []).map(bodyOf);
      const bar = input.barAt?.(wc.timestamp) ?? null;
      const pick = pickAthlete(bodies, bar, prevAge <= POSE_FPS ? prev : null);
      track.t.push(wc.timestamp);
      if (pick >= 0) {
        track.frames.push(bodies[pick].f);
        prev = { cx: bodies[pick].cx, cy: bodies[pick].cy };
        prevAge = 0;
        found++;
      } else {
        track.frames.push(null);
        prevAge++;
      }
      report("detecting", k / n);
      if (input.onPartial && k - lastPartial >= 8) {
        lastPartial = k;
        input.onPartial({ ...track, t: track.t.slice(), frames: track.frames.slice() });
      }
      // let the page breathe (taps, the progress line) between frames
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    check();
    if (!found) return { ok: false, why: "no_body" };
    lastRead = { key, track, delegate: loaded.delegate };
    return {
      ok: true,
      track,
      model: POSE_MODEL,
      delegate: loaded.delegate,
      ms: Math.round((typeof performance !== "undefined" ? performance.now() : 0) - t0),
    };
  } catch (e) {
    if (e instanceof Cancelled || input.signal?.aborted) return { ok: false, why: "cancelled" };
    return { ok: false, why: "unreadable" };
  } finally {
    try {
      disposable?.dispose?.();
    } catch {
      /* already gone */
    }
  }
}
