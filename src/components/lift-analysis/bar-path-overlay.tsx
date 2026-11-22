/**
 * The bar's path drawn over a video's still, and nothing else: one smooth
 * line where the plate went during the set (the read's own smoothed path,
 * frames where the plate was followed only, broken where it wasn't). No
 * markers, numbers or skeleton. It sits over the chat's video tile, which
 * fills its box the way `object-cover` does, so the drawing is laid out the
 * same way (`xMidYMid slice`) and lands on the plate.
 */
import { memo, useMemo } from "react";
import type { LiftAnalysis } from "@/lib/lift-analysis/analyze";

/** The path as SVG line segments in the analysed frame's pixels (pure, for the tile and tests). */
export function barPathSegments(
  a: Pick<LiftAnalysis, "series" | "window" | "frame">,
  maxPoints = 360,
): string[] {
  const { t, x, y, ok } = a.series;
  const W = a.frame.w;
  const H = a.frame.h;
  const from = a.window?.start ?? -Infinity;
  const to = a.window?.end ?? Infinity;
  const idx: number[] = [];
  for (let i = 0; i < t.length; i++) if (t[i] >= from && t[i] <= to) idx.push(i);
  const step = Math.max(1, Math.ceil(idx.length / maxPoints));
  const segs: string[] = [];
  let cur: string[] = [];
  let lastT = -Infinity;
  for (let k = 0; k < idx.length; k += step) {
    const i = idx[k];
    const good = ok[i] === 1 && Number.isFinite(x[i]) && Number.isFinite(y[i]);
    if (!good || t[i] - lastT > 0.5) {
      if (cur.length > 1) segs.push(cur.join(" "));
      cur = [];
    }
    if (good) {
      cur.push(`${(x[i] * W).toFixed(1)},${(y[i] * H).toFixed(1)}`);
      lastT = t[i];
    }
  }
  if (cur.length > 1) segs.push(cur.join(" "));
  return segs;
}

export const BarPathOverlay = memo(function BarPathOverlay({
  analysis,
  className,
}: {
  analysis: Pick<LiftAnalysis, "series" | "window" | "frame">;
  className?: string;
}) {
  const segs = useMemo(() => barPathSegments(analysis), [analysis]);
  if (!segs.length) return null;
  const { w, h } = analysis.frame;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid slice"
      className={className ?? "pointer-events-none absolute inset-0 h-full w-full"}
      aria-hidden="true"
      data-bar-path-overlay
    >
      {segs.map((p, i) => (
        <polyline
          key={`h${i}`}
          points={p}
          fill="none"
          stroke="rgba(0,0,0,0.45)"
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {segs.map((p, i) => (
        <polyline
          key={`l${i}`}
          points={p}
          fill="none"
          stroke="#fff"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
});
