/**
 * The page the server's reader drives in headless Chromium: the phone's own
 * bar-speed pipeline (window.analyze, from the validation harness) and the
 * app's own body read (window.readBody: runPose, MediaPipe on the CPU, its
 * WebAssembly and model served from this machine), packed for storage.
 * Bundled by scripts/velocity-worker/bundle.mjs.
 */
import { analyzeVideo } from "../../src/lib/lift-analysis/run";
import { POSE_FPS, runPose } from "../../src/lib/lift-analysis/pose/pose-run";
import { packPose } from "../../src/lib/lift-analysis/pose/pose-pack";
import { valueAt } from "../../src/components/lift-analysis/overlay-draw";

// the bar's read (the same wrapper as the validation harness's entry.ts; defined here, since the
// app's package.json marks every module side-effect free and a bare import of it would be dropped)
(window as unknown as { analyze: unknown }).analyze = async (url: string, opts: Record<string, unknown> = {}) => {
  const t0 = performance.now();
  const stages: Record<string, number> = {};
  const res = await analyzeVideo({
    source: url,
    ...(opts as object),
    onProgress: (p) => {
      if (!(p.stage in stages)) stages[p.stage] = Math.round(performance.now() - t0);
    },
  });
  return { ms: Math.round(performance.now() - t0), stages, res: JSON.parse(JSON.stringify(res)) };
};

// a runner has no GPU: the CPU build straight away (the GPU one would be measured slow and dropped anyway)
(globalThis as { __jfPoseDelegate?: "GPU" | "CPU" }).__jfPoseDelegate = "CPU";

(window as unknown as { readBody: unknown }).readBody = async (
  url: string,
  opts: { window: { start: number; end: number }; series?: { t: number[]; x: (number | null)[]; y: (number | null)[] } | null },
) => {
  const t0 = performance.now();
  const S = opts.series;
  const barAt =
    S && Array.isArray(S.t) && S.t.length
      ? (t: number) => {
          const x = valueAt(S.t, S.x, t);
          const y = valueAt(S.t, S.y, t);
          return x != null && y != null ? { fx: x, fy: y } : null;
        }
      : undefined;
  const res = await runPose({ source: url, window: opts.window, barAt });
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) return { ok: false, why: res.why, ms };
  const found = res.track.frames.filter(Boolean).length;
  return {
    ok: true,
    ms,
    model: res.model,
    fps: POSE_FPS,
    delegate: res.delegate,
    frames: res.track.frames.length,
    found,
    packed: packPose(res.track),
  };
};
