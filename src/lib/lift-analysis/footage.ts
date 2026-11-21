/**
 * Is this footage good enough to measure from, before anything is tracked
 * (pure)? Read from what detection already has: the clip's frame rate, the
 * plate it found (its size in the camera's own pixels, its shape) and where
 * it went in the sampled frames, and how bright the picture is.
 *
 * Only what changes the numbers is flagged, each with what to do about it.
 * None of it stops a read: the athlete can always go ahead, and the result
 * says what each issue cost (analyze.ts' quality notes).
 */

export type FootageIssue =
  /** Under 50 fps: mean speed is fine, peak speed is an estimate. */
  | "low_fps"
  /** The plate under ~70 px across in the camera's own picture: its edge, the ruler, is a few px. */
  | "plate_small"
  /** The plate went within a radius of the frame's edge (or off it) during the set. */
  | "plate_cut_off"
  /** The picture is dark: edges blur into noise. */
  | "dark"
  /** The plate looks oval: the phone isn't side-on to the end of the bar. */
  | "not_side_on";

export type FootageInput = {
  fps: number;
  /** The shown frame (px, the camera's own) and the size it was analysed at. */
  frame: { width: number; height: number; w: number; h: number };
  /** The plate detection found (analysed px), if any. */
  plate: { a: number; b: number } | null;
  /** Where the plate was seen in the sampled frames (analysed px). */
  path: { x: number; y: number }[];
  /** Mean brightness of the sampled frames (0…255). */
  brightness: number;
};

/** The plate's radius (camera px) under which its edge is too few pixels to size it to ~1 %. */
export const SMALL_PLATE_PX = 35;
/** A picture darker than this (mean grey, 0…255) is dark. */
export const DARK_MEAN = 45;
/** Side-on, a plate is round; flatter than this, the phone is turned or tilted. */
export const OVAL_RATIO = 0.85;

export function footageIssues(f: FootageInput): FootageIssue[] {
  const out: FootageIssue[] = [];
  if (f.fps > 0 && f.fps < 50) out.push("low_fps");
  if (f.plate) {
    const k = Math.max(f.frame.width, f.frame.height) / Math.max(f.frame.w, f.frame.h);
    const R = Math.sqrt(f.plate.a * f.plate.b);
    if (R * k < SMALL_PLATE_PX) out.push("plate_small");
    const ratio = Math.min(f.plate.a, f.plate.b) / Math.max(f.plate.a, f.plate.b);
    if (ratio < OVAL_RATIO) out.push("not_side_on");
    const cut = f.path.some(
      (p) => p.x - R < 0 || p.y - R < 0 || p.x + R > f.frame.w || p.y + R > f.frame.h,
    );
    if (cut) out.push("plate_cut_off");
  }
  if (f.brightness > 0 && f.brightness < DARK_MEAN) out.push("dark");
  return out;
}

/** What each issue means and how to film it better, in the athlete's words. */
export const FOOTAGE_WORDS: Record<FootageIssue, { title: string; fix: string }> = {
  low_fps: {
    title: "Filmed at 30 fps",
    fix: "Average speed is measured fine. For peak speed too, film at 60 fps (Settings → Camera → Record Video on an iPhone).",
  },
  plate_small: {
    title: "The plate is small in the picture",
    fix: "Film a little closer, about 2 to 3 m away, with the whole lift still in frame.",
  },
  plate_cut_off: {
    title: "The plate goes out of the picture",
    fix: "Step back or turn the phone so the plate stays in frame from the bottom of the rep to the top.",
  },
  dark: {
    title: "The video is dark",
    fix: "More light, or something lighter behind the plate, makes its edge easier to measure.",
  },
  not_side_on: {
    title: "The phone isn't side-on",
    fix: "Point the phone straight at the end of the bar, level, about hip height, so the plate looks round.",
  },
};

/** Mean grey of some frames (every 97th pixel: enough for a mean). */
export function meanBrightness(frames: { px: ArrayLike<number> }[]): number {
  let s = 0;
  let n = 0;
  for (const f of frames)
    for (let i = 0; i < f.px.length; i += 97) {
      s += f.px[i];
      n++;
    }
  return n ? s / n : 0;
}
