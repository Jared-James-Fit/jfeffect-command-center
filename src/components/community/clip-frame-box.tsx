import type { CSSProperties, ReactNode } from "react";
import { framedMediaStyle, type ClipFrame } from "@/lib/photo-frame";

type Fit = "cover" | "contain";

/** The frame's box in its area: whole inside it ("contain") or filling it ("cover"), centred (FitBox's container units). */
function boxStyle(a: number, fit: Fit): CSSProperties {
  const w = fit === "cover" ? `max(100cqw, calc(100cqh * ${a}))` : `min(100cqw, calc(100cqh * ${a}))`;
  const h = fit === "cover" ? `max(100cqh, calc(100cqw / ${a}))` : `min(100cqh, calc(100cqw / ${a}))`;
  return { width: w, height: h, left: `calc((100cqw - ${w}) / 2)`, top: `calc((100cqh - ${h}) / 2)` };
}

/**
 * A clip framed in the studio, shown as its frame wherever it plays (the
 * feed's screens and cards, a post's page, the full-screen clips): a box at
 * the frame's shape, whole in its area or filling it (`fit`, the same choice
 * as any slide: screenFit), showing exactly the part the studio framed.
 * `children(style)` is the clip's own box, sized to the whole clip and placed
 * so the frame shows the right part (framedMediaStyle); the poster sits over
 * the frame (it was baked to it when the post went up). `area` narrows where
 * it sits (a post's screen: between Crew's bar and the words).
 */
export function ClipFrameBox({
  frame,
  media,
  fit,
  area,
  poster,
  children,
}: {
  frame: ClipFrame;
  /** The clip's own shape (w / h); unknown, it just fills the frame. */
  media: number | null | undefined;
  fit: Fit;
  area?: CSSProperties;
  poster?: ReactNode;
  children: (style: CSSProperties) => ReactNode;
}) {
  return (
    <div className="absolute inset-0" style={{ ...area, containerType: "size" }} data-clip-frame-area>
      <div className="absolute overflow-hidden" style={boxStyle(frame.a, fit)} data-clip-frame={`${Math.round(frame.a * 1000) / 1000}`}>
        {children({ position: "absolute", ...framedMediaStyle(frame, media) })}
        {poster}
      </div>
    </div>
  );
}
