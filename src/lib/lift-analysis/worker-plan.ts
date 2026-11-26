/**
 * What the server's reader does with a set video's reads (pure; used by
 * scripts/velocity-worker and tested in velocity-worker.test.ts).
 *
 * The phone's own pipeline is read first (the same code a phone runs, so a
 * set read on a phone and on the server agree). Its read stands when it would
 * go on the set by the server's rule (`wouldLog`: the same checks as
 * _apply_video_velocity). Otherwise the any-angle estimate (estimate.ts). And
 * when neither can say, the most useful read is still kept with why, in plain
 * words, so a person can open it and nothing is left waiting unseen.
 */
import type { LiftAnalysis } from "@/lib/lift-analysis/analyze";
import { loadMeansFullPlates } from "@/lib/lift-analysis/verdict";

export type WorkerJob = {
  set_video_id: string;
  lease_id: string;
  attempt: number;
  exercise_name: string;
  duration_s: number | null;
  set_index: number;
  has_set: boolean;
  reps: number | null;
  load_kg: number | null;
  bodyweight: boolean;
  url: string;
};

/**
 * Whether a read would go on the logged set (pure): the server's own rule
 * (20270602110000_velocity_server_worker.sql `_apply_video_velocity`) on what
 * the phone's pipeline found, so a read that the server would refuse is never
 * committed in place of a better one.
 */
export function wouldLog(a: LiftAnalysis, job: Pick<WorkerJob, "reps" | "load_kg" | "bodyweight">): boolean {
  const v = a.velocity;
  if (!v?.accepted || v.value == null) return false;
  if (a.units !== "mm" || !a.calibration.ok) return false;
  const n = a.reps.length;
  if (!n || a.reps.some((r) => !r.complete)) return false;
  if (job.reps != null && Math.abs(job.reps - n) > 1) return false;
  const scaleOk =
    a.plate.confirmed ||
    (!job.bodyweight && loadMeansFullPlates(job.load_kg)) ||
    !!v.plateCheck;
  return scaleOk;
}

export type Outcome = {
  /** Short code for the job (admins, diagnostics). */
  outcome: string;
  /** One line a coach or admin can read. */
  message: string;
};

const WHY: Record<string, string> = {
  no_plate: "Couldn't find the end of the bar in this video.",
  ambiguous: "More than one thing could be the bar's end.",
  needs_confirm: "Found something round but couldn't confirm it's the plate.",
  unreadable: "The video couldn't be decoded.",
  too_short: "The video is too short to read a rep.",
  reps_differ: "The reps seen in the video don't match the reps logged.",
  reps_not_logged: "The set's reps aren't logged yet.",
  movement_unknown: "The exercise's name doesn't say which lift it is.",
  range_implausible: "The bar's travel didn't fit the lift (the plate's size couldn't be trusted).",
  rom_inconsistent: "The reps' ranges were too different from each other to trust.",
  plate_lost: "The bar's end was lost for too much of the set.",
  no_reps: "No reps were found.",
  scale_uncertain: "The plate's size couldn't be measured closely enough.",
  disagree: "The two ends of the bar gave different speeds.",
  camera_moved: "The camera moved during the set.",
  low_fps: "The frame rate is too low.",
};

/** The first few reasons, in words (pure). */
export function reasonWords(reasons: string[]): string {
  const words = [...new Set(reasons.map((r) => WHY[r]).filter(Boolean))];
  return (words.slice(0, 2).join(" ") || "No reliable bar speed could be read from this video.").slice(0, 240);
}

/** Which of the server's tries to keep when neither read the set (pure): a read beats a note. */
export function fallbackOf(
  phone: { analysis: LiftAnalysis | null; why: string | null },
  estimate: { analysis: LiftAnalysis | null; why: string[] },
): { result: unknown; outcome: Outcome } {
  const reasons = [...(estimate.why ?? []), ...(phone.why ? [phone.why] : [])];
  const message = reasonWords(reasons);
  if (phone.analysis) return { result: phone.analysis, outcome: { outcome: "no_reading", message } };
  if (estimate.analysis) return { result: estimate.analysis, outcome: { outcome: "no_reading", message } };
  const status = phone.why === "unreadable" || phone.why === "too_short" ? "failed" : "needs_tap";
  return {
    result: { engine: "bar-path/server", status, why: phone.why ?? "no_plate", suggestions: [] },
    outcome: { outcome: status === "failed" ? "unreadable" : "no_reading", message },
  };
}
