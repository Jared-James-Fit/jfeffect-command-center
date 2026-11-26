/**
 * How lift analysis numbers are said (pure). A measured number is shown as
 * it is with its margin; an estimate carries "≈"; anything unavailable is a
 * dash with the reason in plain words, never a made-up number.
 */
import type { Metric, Tier } from "@/lib/lift-analysis/kinematics";
import type { LiftAnalysis, QualityNote } from "@/lib/lift-analysis/analyze";

export function tierWord(t: Tier): string {
  return t === "measured" ? "Measured" : t === "estimated" ? "Estimate" : "Not available";
}

const fixed = (v: number, d: number) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);

/** "0.42 m/s", "≈0.42 m/s", or "—". */
export function speed(m: Metric | null | undefined): string {
  if (!m || m.v == null || m.tier === "unavailable") return "—";
  return `${m.tier === "estimated" ? "≈" : ""}${fixed(m.v, 2)} m/s`;
}

/** The number alone (the unit said elsewhere): "0.42", "≈0.42", "—". */
export function speedNumber(m: Metric | null | undefined): string {
  if (!m || m.v == null || m.tier === "unavailable") return "—";
  return `${m.tier === "estimated" ? "≈" : ""}${fixed(m.v, 2)}`;
}

/** "± 0.03 m/s" (the 95 % margin), or "". */
export function speedMargin(m: Metric | null | undefined): string {
  if (!m || m.v == null || m.u == null || m.tier === "unavailable") return "";
  return `± ${fixed(Math.max(0.01, m.u), 2)} m/s`;
}

/** Seconds: "0.84 s", "≈0.84 s", "—". */
export function seconds(m: Metric | null | undefined): string {
  if (!m || m.v == null || m.tier === "unavailable") return "—";
  return `${m.tier === "estimated" ? "≈" : ""}${fixed(m.v, 2)} s`;
}

/** A length in mm said in cm: "54 cm", "≈54 cm", "—". */
export function cm(m: Metric | null | undefined, opts: { signed?: boolean } = {}): string {
  if (!m || m.v == null || m.tier === "unavailable") return "—";
  const v = m.v / 10;
  const d = Math.abs(v) < 10 ? 1 : 0;
  const s = opts.signed && v > 0 ? "+" : "";
  return `${m.tier === "estimated" ? "≈" : ""}${s}${fixed(v, d)} cm`;
}

/** A length that's smaller than its own margin reads as "none" rather than a number. */
export function withinNoise(m: Metric | null | undefined): boolean {
  return !!m && m.v != null && m.u != null && Math.abs(m.v) <= m.u;
}

/** Velocity loss: "18%", "≈18%", "—" (with its margin in points, "± 3"). */
export function percent(m: Metric | null | undefined): string {
  if (!m || m.v == null || m.tier === "unavailable") return "—";
  return `${m.tier === "estimated" ? "≈" : ""}${Math.round(m.v)}%`;
}

const WHY: Record<string, string> = {
  not_calibrated: "No plate to measure from, so no speeds: timing and velocity loss still are.",
  too_uncertain: "Too uncertain to show from this footage.",
  plate_hidden: "The plate was hidden for part of the rep.",
  low_fps: "Filmed at 30 fps, so this is an estimate. 60 fps measures it.",
  camera_moved: "The camera moved during the set.",
  camera_turned: "The camera wasn't quite side-on.",
  no_eccentric: "No lowering phase to read.",
  no_pause: "No pause at the bottom.",
  one_rep: "Needs at least two reps.",
  no_reps: "No reps found.",
  not_measurable: "Couldn't be read from this footage.",
  partial_set: "Not every rep's speed was read, so the fastest or the last could be missing.",
};

export function whyWords(why: string | undefined): string {
  return (why && WHY[why]) || "";
}

const NOTE: Record<QualityNote, { title: string; tip: string }> = {
  not_calibrated: {
    title: "No plate size to measure from",
    tip: "Speeds need the plate's own size as a ruler: film from the side with the end of the bar and its biggest plate in view.",
  },
  plate_size_assumed: {
    title: "Read from a standard 450 mm plate",
    tip: "Every 20 kg, 25 kg and 45 lb plate and every bumper is 450 mm across, so the speed is logged as an estimate (≈). If the biggest plate on the bar is smaller, set its size.",
  },
  low_fps: {
    title: "Filmed at 30 fps",
    tip: "Mean speed is measured at 30 fps; peak speed is an estimate. Film at 60 fps to measure peak speed too.",
  },
  camera_turned: {
    title: "Camera a little off side-on",
    tip: "Up-and-down speed is still read right; sideways bar path is corrected from the plate's shape but less exact. Point the phone straight at the end of the bar.",
  },
  camera_tilted: {
    title: "Camera tilted up or down",
    tip: "Keep the phone level, about hip height, so the bar moves straight up and down in the picture.",
  },
  camera_moved: {
    title: "The camera moved",
    tip: "A held phone moves the picture with it, so speeds are estimates. Prop the phone up for measured numbers.",
  },
  plate_small: {
    title: "The plate is small in the picture",
    tip: "Film a little closer (2–3 m away) so the plate is bigger in the frame.",
  },
  plate_hidden: {
    title: "The plate was hidden for a moment",
    tip: "Someone or something passed in front of the plate; those reps' peak speeds aren't shown.",
  },
  no_reps: {
    title: "No reps found",
    tip: "The bar didn't move up and down enough to count a rep, or the plate wasn't followed. Try tapping the end of the bar.",
  },
  short_track: {
    title: "Very short clip",
    tip: "Film the whole set, from the unrack to the rack.",
  },
  plate_edge_faint: {
    title: "The plate's edge was hard to see",
    tip: "A dark plate against a dark rack or wall: its size, the ruler for every speed, is less certain, so speeds are estimates. Something lighter behind the plate, or more light, fixes it.",
  },
  tracking_gaps: {
    title: "The plate was lost for a moment",
    tip: "Those frames are left out, never guessed. Fix tracking puts the marker back on the plate there.",
  },
  after_set: {
    title: "Movement after the set wasn't counted",
    tip: "The bar went part way up at the end and was never seen coming back down (moving the bar, or the clip ending). It isn't a rep.",
  },
  reps_edited: {
    title: "Reps edited",
    tip: "A rise you said isn't a rep is left out of the reps and the set's numbers.",
  },
  estimated_track: {
    title: "Estimated from this angle",
    tip: "Read automatically: the end of the bar was followed by its picture and the plate's height (450 mm at any angle) is the ruler, so the speed is logged as an estimate (≈). Filming from the side at hip height measures it more closely.",
  },
  implausible_scale: {
    title: "Couldn't trust the plate's size",
    tip: "The numbers it gave were impossible for a barbell, so no speeds are shown. If the biggest plate is smaller than 450 mm, set its size.",
  },
};

export function noteWords(n: QualityNote): { title: string; tip: string } {
  return NOTE[n];
}

/** The notes worth showing (the standard-plate assumption only as a footnote). */
export function shownNotes(a: LiftAnalysis): QualityNote[] {
  const order: QualityNote[] = [
    "implausible_scale",
    "not_calibrated",
    "camera_moved",
    "tracking_gaps",
    "plate_hidden",
    "plate_edge_faint",
    "camera_tilted",
    "camera_turned",
    "plate_small",
    "low_fps",
    "no_reps",
    "short_track",
    "after_set",
    "reps_edited",
    "estimated_track",
  ];
  return order.filter((n) => a.quality.notes.includes(n));
}

/**
 * One line for the set, for the sheet and the chat: "5 reps · avg 0.21 m/s"
 * when the set's average was good enough to log, else the fastest rep with
 * velocity loss ("3 reps · best ≈0.53 m/s · 31% velocity loss").
 */
export function summaryLine(a: LiftAnalysis): string {
  const parts: string[] = [];
  const n = a.set.reps;
  parts.push(n === 1 ? "1 rep" : `${n} reps`);
  if (a.velocity?.accepted && a.velocity.value != null) {
    parts.push(`${n > 1 ? "avg " : ""}${fixed(a.velocity.value, 2)} m/s`);
  } else if (a.set.bestMcv.tier !== "unavailable" && a.set.bestMcv.v != null)
    parts.push(`${n > 1 ? "best " : ""}${speed(a.set.bestMcv)}`);
  if (n > 1 && a.set.velocityLoss.tier !== "unavailable" && a.set.velocityLoss.v != null)
    parts.push(`${percent(a.set.velocityLoss)} velocity loss`);
  return parts.join(" · ");
}
