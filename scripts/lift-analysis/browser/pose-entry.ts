/** The browser harness for the pose read: the app's own runPose on a clip URL, and a frame drawn with its skeleton. */
import { runPose } from "../../../src/lib/lift-analysis/pose/pose-run";
import {
  frameAt,
  nearSide,
  smoothTrack,
  viewOf,
  type PoseTrack,
} from "../../../src/lib/lift-analysis/pose/skeleton";
import { drawPose, drawShapes } from "../../../src/components/lift-analysis/overlay-draw";

let last: PoseTrack | null = null;

(window as unknown as { pose: unknown }).pose = async (
  url: string,
  win: { start: number; end: number },
  bar: { fx: number; fy: number } | null = null,
) => {
  const t0 = performance.now();
  const stages: Record<string, number> = {};
  const res = await runPose({
    source: url,
    window: win,
    barAt: bar ? () => bar : undefined,
    onProgress: (p) => {
      if (!(p.stage in stages)) stages[p.stage] = Math.round(performance.now() - t0);
    },
  });
  if (res.ok) last = res.track;
  return {
    ms: Math.round(performance.now() - t0),
    stages,
    ok: res.ok,
    why: res.ok ? null : res.why,
    delegate: res.ok ? res.delegate : null,
    frames: res.ok ? res.track.frames.length : 0,
    found: res.ok ? res.track.frames.filter(Boolean).length : 0,
    first: res.ok && res.track.frames.find(Boolean) ? Array.from(res.track.frames.find(Boolean)!) : null,
  };
};

/** The clip's frame at t with the skeleton drawn on it, as a data URL. */
(window as unknown as { drawAt: unknown }).drawAt = async (url: string, t: number) => {
  const v = document.createElement("video");
  v.src = url;
  v.muted = true;
  await new Promise((r) => (v.onloadeddata = r));
  v.currentTime = t;
  await new Promise((r) => (v.onseeked = r));
  const c = document.createElement("canvas");
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(v, 0, 0);
  if (last) {
    // the app's own overlay code, every layer on, plus a coach's arrow and a joint picked
    const track = smoothTrack(last);
    const view = viewOf(track);
    const side = nearSide(track);
    const P = (fx: number, fy: number): [number, number] => [fx * c.width, fy * c.height];
    const k = Math.max(1, Math.max(c.width, c.height) / 640);
    drawPose(
      ctx,
      {
        track,
        side,
        view,
        angles: true,
        layers: { bar: false, skeleton: true, angles: true, vertical: true, segments: true, paths: true },
        compare: null,
      },
      null,
      P,
      t,
      { selectedRep: null, scale: k },
    );
    drawShapes(
      ctx,
      [
        { kind: "arrow", a: [0.2, 0.15], b: [0.35, 0.3] },
        { kind: "joint", j: 25 },
      ],
      P,
      frameAt(track, t),
      k,
    );
    (window as unknown as { lastView: unknown }).lastView = { view, side };
  }
  return c.toDataURL("image/png");
};

/** The annotated clip export on a stretch of the clip: its size, length and codec. */
(window as unknown as { clip: unknown }).clip = async (url: string, start: number, end: number) => {
  const { renderAnnotatedClip } = await import("../../../src/lib/lift-analysis/frame-grab");
  const t0 = performance.now();
  const track = last ? smoothTrack(last) : null;
  const blob = await renderAnnotatedClip({
    source: url,
    start,
    end,
    draw: (ctx, w, h, t) => {
      if (!track) return;
      drawPose(
        ctx,
        {
          track,
          side: nearSide(track),
          view: viewOf(track),
          angles: false,
          layers: { bar: false, skeleton: true, angles: false, vertical: false, segments: false, paths: false },
          compare: null,
        },
        null,
        (fx, fy) => [fx * w, fy * h],
        t,
        { selectedRep: null, scale: Math.max(1, Math.max(w, h) / 640) },
      );
    },
  });
  if (!blob) return { ok: false, ms: Math.round(performance.now() - t0) };
  const v = document.createElement("video");
  v.src = URL.createObjectURL(blob);
  await new Promise((r) => (v.onloadedmetadata = r));
  return { ok: true, bytes: blob.size, w: v.videoWidth, h: v.videoHeight, duration: v.duration, ms: Math.round(performance.now() - t0) };
};
