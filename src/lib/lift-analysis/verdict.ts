/**
 * Whether a set video's read is good enough to log as the set's velocity
 * (pure). The logged number is the set-average mean concentric velocity: the
 * arithmetic mean of every rep's MCV, and only when every rep of the set was
 * found and measured. A partial set is never averaged and called the set.
 *
 * The bar for "good enough" comes from checking the engine against two
 * commercial apps (Qwik VBT, Metric VBT; both validated against Vicon) on
 * real bench sets: on reps that pass these rules the read sat within
 * −0.017…+0.009 m/s (95 % limits) of their average. Reps that fail them are
 * the ones whose numbers can't be trusted that closely, so they stay off the
 * logger (still shown in the analysis, with why).
 *
 * The server re-checks what it can from the saved read (every rep complete
 * and measured, the same rep count as the reps logged on the set, never a
 * set with no reps logged yet, a load that means full-size plates) before it
 * writes anything to the logger.
 */
import type { LiftAnalysis } from "@/lib/lift-analysis/analyze";

export type VelocityReason =
  | "not_calibrated"
  | "no_reps"
  | "rep_incomplete"
  | "rep_not_measured"
  | "plate_hidden"
  | "camera_moved"
  | "camera_angle"
  | "low_fps"
  | "rom_inconsistent"
  | "scale_uncertain"
  | "plate_lost";

export type VelocityVerdict = {
  accepted: boolean;
  /** The set-average MCV (m/s, 3 decimals) when accepted. */
  value: number | null;
  reps: number;
  /** Each rep's MCV (m/s) when it had one. */
  perRep: (number | null)[];
  reasons: VelocityReason[];
};

export const ACCEPT_RULES = {
  /** The scale's own 1-σ uncertainty (plate size, edge, view). */
  maxScaleRel: 0.03,
  /** Of each concentric, at least this share of frames had the plate. */
  minRepCoverage: 0.9,
  /** The plate at least this round (vertical ÷ horizontal or the reverse): within ~25° of side-on. */
  minViewRatio: 0.9,
  minFps: 24,
  /**
   * Every rep's range within this share of the set's median: a rep read far
   * shorter means a missed bottom or top. Real sets drift more than you'd
   * think (one reference set's range grew 30 % as it got harder, the same
   * in both commercial apps), so only a clear outlier fails.
   */
  romSpread: 0.3,
  /**
   * The plate followed in at least this share of the clip: a rep done while
   * it was lost is a rep never counted, and an average without it would be
   * called the set's (a real clip read in the browser once found 3 of 5 reps
   * with the plate followed in 68 % of frames).
   */
  minTracked: 0.85,
} as const;

export function velocityVerdict(a: LiftAnalysis): VelocityVerdict {
  const reasons = new Set<VelocityReason>();
  const reps = a.reps;
  const perRep = reps.map((r) =>
    r.mcv.v != null && r.mcv.tier !== "unavailable" ? r.mcv.v : null,
  );
  if (a.units !== "mm" || !a.calibration.ok) reasons.add("not_calibrated");
  if (a.calibration.ok && a.calibration.relErr > ACCEPT_RULES.maxScaleRel)
    reasons.add("scale_uncertain");
  if (!reps.length) reasons.add("no_reps");
  if (a.fps < ACCEPT_RULES.minFps) reasons.add("low_fps");
  if (a.quality.notes.includes("camera_moved")) reasons.add("camera_moved");
  if (!(a.quality.tracked >= ACCEPT_RULES.minTracked)) reasons.add("plate_lost");
  if (Number.isFinite(a.plate.ratio) && a.plate.ratio < ACCEPT_RULES.minViewRatio)
    reasons.add("camera_angle");
  for (const r of reps) {
    if (!r.complete) reasons.add("rep_incomplete");
    if (r.mcv.tier !== "measured") reasons.add("rep_not_measured");
    if (r.coverage < ACCEPT_RULES.minRepCoverage) reasons.add("plate_hidden");
  }
  const roms = reps.map((r) => r.top - r.bottom).filter((v) => Number.isFinite(v) && v > 0);
  if (roms.length >= 2) {
    const sorted = [...roms].sort((x, y) => x - y);
    const mid = sorted[sorted.length >> 1];
    if (roms.some((v) => Math.abs(v - mid) > ACCEPT_RULES.romSpread * mid))
      reasons.add("rom_inconsistent");
  }
  const accepted = reasons.size === 0 && perRep.every((v) => v != null);
  const value = accepted
    ? Math.round((perRep.reduce<number>((s, v) => s + (v ?? 0), 0) / perRep.length) * 1000) / 1000
    : null;
  return { accepted, value, reps: reps.length, perRep, reasons: [...reasons] };
}

/** Full-size (450 mm) plates are what a load this heavy is made of: 20 kg / 45 lb plates or bigger on each side. */
export function loadMeansFullPlates(totalKg: number | null | undefined): boolean {
  return totalKg != null && Number.isFinite(totalKg) && totalKg >= 59.5;
}

/** The set the video is on, as far as logging its speed goes. */
export type LoggedSet = {
  mean_concentric_velocity_mps?: number | string | null;
  velocity_source?: "device" | "video" | null;
  velocity_set_video_id?: string | null;
  actual_reps?: number | null;
  actual_load_kg?: number | string | null;
  is_bodyweight?: boolean | null;
};

export type LoggedState =
  | { logged: true }
  | {
      logged: false;
      why: "not_accepted" | "no_set" | "typed" | "reps" | "light" | "other";
      text: string;
    };

/**
 * Whether this read's average is the set's velocity in the logger, and if
 * not, why (the server's own rule, _apply_video_velocity, said in words).
 */
export function loggedState(
  a: LiftAnalysis,
  set: LoggedSet | null | undefined,
  setVideoId: string,
): LoggedState {
  const v = a.velocity;
  if (!v?.accepted || v.value == null)
    return {
      logged: false,
      why: "not_accepted",
      text: velocityNotLoggedText(v?.reasons ?? ["not_calibrated"]),
    };
  if (!set)
    return { logged: false, why: "no_set", text: "It goes on the set once the set is logged." };
  if (set.velocity_source === "video" && set.velocity_set_video_id === setVideoId)
    return { logged: true };
  if (set.mean_concentric_velocity_mps != null && set.velocity_source !== "video")
    return {
      logged: false,
      why: "typed",
      text: "The set already has a velocity typed in, so it's kept.",
    };
  if (set.actual_reps == null)
    return { logged: false, why: "reps", text: "It goes on the set once its reps are logged." };
  if (set.actual_reps !== v.reps)
    return {
      logged: false,
      why: "reps",
      text: `${v.reps} ${v.reps === 1 ? "rep" : "reps"} in the video, ${set.actual_reps} logged. Fix the reps and it's logged.`,
    };
  if (
    !a.plate.confirmed &&
    (set.is_bodyweight ||
      !loadMeansFullPlates(set.actual_load_kg == null ? null : Number(set.actual_load_kg)))
  )
    return {
      logged: false,
      why: "light",
      text: "Under 60 kg the plates may be smaller than 450 mm. Set the plate size to log it.",
    };
  return { logged: false, why: "other", text: "Not on the set." };
}

const REASON_TEXT: Record<VelocityReason, string> = {
  not_calibrated: "there was no plate to measure from",
  scale_uncertain: "the plate's size couldn't be read closely enough",
  no_reps: "no reps were found",
  rep_incomplete: "a rep didn't reach the top",
  rep_not_measured: "a rep's speed was only an estimate",
  plate_hidden: "the plate was hidden during a rep",
  camera_moved: "the camera moved",
  camera_angle: "the camera wasn't side-on",
  low_fps: "the frame rate was too low",
  rom_inconsistent: "one rep's range didn't match the others",
  plate_lost: "the plate was lost for part of the set",
};

/** "Not logged: the camera moved." (the first two reasons). */
export function velocityNotLoggedText(reasons: readonly VelocityReason[]): string {
  const words = reasons
    .map((r) => REASON_TEXT[r])
    .filter(Boolean)
    .slice(0, 2);
  return words.length ? `Not logged: ${words.join(" and ")}.` : "Not logged.";
}
