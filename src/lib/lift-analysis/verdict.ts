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
import { calibratedSetMean } from "./quality";

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
  tier?: "measured" | "estimated";
  uncertainty?: number;
};

export const ACCEPT_RULES = {
  /** The scale's own 1-σ uncertainty (plate size, edge, view). */
  maxScaleRel: 0.03,
  /** Of each concentric, the share of frames that had the plate (below it a rep that isn't measured reads as hidden). */
  minRepCoverage: 0.9,
  /**
   * The plate at least this round. Tilted (the phone pitched up or down) moves
   * the bar toward and away from the lens as it rises, which the scale can't
   * follow: within ~25° of level. Turned (the phone round to the side, how
   * nearly everyone films) leaves the plate's tall axis its true 450 mm and the
   * bar's rise square to the lens, so the vertical speed is read as well as
   * side-on: anything to ~40° (cos 40° ≈ 0.77). The sideways path is scaled by
   * the plate's narrow axis and marked an estimate past 0.96.
   */
  minViewRatio: 0.9,
  minTurnedRatio: 0.77,
  minFps: 24,
  /**
   * Every rep's range within this share of the set's median: a rep read far
   * shorter means a missed bottom or top. Real sets drift more than you'd
   * think (one reference set's range grew 30 % as it got harder, the same
   * in both commercial apps), so only a clear outlier fails.
   */
  romSpread: 0.3,
  /**
   * The plate followed in at least this share of the clip, and never lost
   * inside the set for longer than a rep takes (maxLostInsideS): a rep done
   * while it was lost is a rep never counted, and an average without it would
   * be called the set's (a real clip read in the browser once found 3 of 5
   * reps with the plate followed in 68 % of frames). Before the set and after
   * it (the walk-out, racking it) a lost plate hides no rep; the server also
   * logs a speed only when the reps it found are the reps the athlete logged.
   */
  minTracked: 0.75,
  maxLostInsideS: 1.0,
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
  const lostInside = (a.track?.lost ?? []).some(
    (l) => l.end - l.start > ACCEPT_RULES.maxLostInsideS,
  );
  if (!(a.quality.tracked >= ACCEPT_RULES.minTracked) || lostInside) reasons.add("plate_lost");
  const minRatio =
    a.plate.view === "turned" ? ACCEPT_RULES.minTurnedRatio : ACCEPT_RULES.minViewRatio;
  if (Number.isFinite(a.plate.ratio) && a.plate.ratio < minRatio) reasons.add("camera_angle");
  for (const r of reps) {
    if (!r.complete) reasons.add("rep_incomplete");
    // a rep's mean needs both its ends and the bar seen rising across any hidden moment
    // (kinematics.ts): when it's measured, a short hidden stretch inside it doesn't matter
    if (r.mcv.tier !== "measured")
      reasons.add(
        r.mcv.why === "plate_hidden" || r.coverage < ACCEPT_RULES.minRepCoverage
          ? "plate_hidden"
          : "rep_not_measured",
      );
  }
  const roms = reps.map((r) => r.top - r.bottom).filter((v) => Number.isFinite(v) && v > 0);
  if (roms.length >= 2) {
    const sorted = [...roms].sort((x, y) => x - y);
    const mid = sorted[sorted.length >> 1];
    if (roms.some((v) => Math.abs(v - mid) > ACCEPT_RULES.romSpread * mid))
      reasons.add("rom_inconsistent");
  }
  const usable = calibratedSetMean(a);
  if (usable) {
    return { accepted: true, value: usable.value, reps: reps.length, perRep, reasons: [], tier: usable.tier, uncertainty: usable.uncertainty };
  }
  if (!a.plate.confirmed) reasons.add("not_calibrated");
  const accepted = reasons.size === 0 && perRep.every((v) => v != null) && a.plate.confirmed;
  const value = accepted
    ? Math.round((perRep.reduce<number>((s, v) => s + (v ?? 0), 0) / perRep.length) * 1000) / 1000
    : null;
  return { accepted, value, reps: reps.length, perRep, reasons: [...reasons] };
}

/** Legacy API retained for callers; load is never evidence of diameter. */
export function loadMeansFullPlates(_totalKg: number | null | undefined): boolean {
  return false;
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
  if (!a.plate.confirmed)
    return {
      logged: false,
      why: "light",
      text: "Confirm the plate diameter to log speed. The load never proves its size.",
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
  camera_angle: "the camera was too far round from side-on",
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
