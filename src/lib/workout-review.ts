/**
 * Quick post-workout review (v2) — the signals that actually predict recovery,
 * in as few taps as possible:
 *   • Effort  — session RPE (Foster sRPE), pre-filled from logged set RPEs
 *   • Sleep   — hours the night before
 *   • Energy  — how recovered they felt going in (recovery_today, 1–5)
 *   • Pain    — no/yes; yes asks where + how bad
 *
 * v1 asked "Feeling Good / Minor Issue / Need Attention" and wrote fake session
 * RPEs (5/7/8) from that choice; 75% of ratings were 5/5, so it carried almost
 * no signal. v2 rows are marked review_version = 2 so analytics only trust
 * their session_rpe.
 */

export const REVIEW_VERSION = 2;

export const EFFORT_OPTIONS: { v: number; label: string }[] = [
  { v: 6, label: "Easy" },
  { v: 7, label: "Moderate" },
  { v: 8, label: "Hard" },
  { v: 9, label: "Very hard" },
  { v: 10, label: "Max" },
];

export const PAIN_AREAS = ["Shoulder", "Elbow", "Wrist", "Low back", "Hip", "Knee", "Other"] as const;

export const PAIN_SEVERITY: { v: number; label: string }[] = [
  { v: 3, label: "Mild" },
  { v: 5, label: "Moderate" },
  { v: 8, label: "Sharp" },
];

/**
 * overall_rating is NOT NULL in the schema and still shown to coaches, so v2
 * derives it from the real answers instead of asking another question.
 */
export function deriveOverallRating(input: {
  pain: boolean;
  sessionRpe: number;
  recoveryToday: number | null;
}): number {
  if (input.pain) return 2;
  if (input.sessionRpe >= 10 || (input.recoveryToday != null && input.recoveryToday <= 2)) return 3;
  if (input.recoveryToday === 5 && input.sessionRpe <= 8) return 5;
  return 4;
}

/** Session RPE to show when (re)opening the review. */
export function initialEffort(
  initial: { sessionRpe?: number | null; reviewVersion?: number | null; submittedAt?: string | null } | null | undefined,
  suggested: number | null | undefined,
): number | null {
  // Only a v2 review stored a real session RPE; legacy values were derived.
  if (initial?.submittedAt && (initial.reviewVersion ?? 0) >= REVIEW_VERSION && initial.sessionRpe != null) {
    return Math.min(10, Math.max(6, initial.sessionRpe));
  }
  return suggested ?? null;
}

/** Whether the stored session_rpe is a real self-report (v2) or a legacy mapping. */
export function trustedSessionRpe(row: { session_rpe?: number | null; review_version?: number | null }): number | null {
  return (row.review_version ?? 0) >= REVIEW_VERSION && row.session_rpe != null ? Number(row.session_rpe) : null;
}
