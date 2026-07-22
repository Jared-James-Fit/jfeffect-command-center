/**
 * Estimated Recovery Score (0–100).
 *
 * Pure function over data we already collect. No user input required.
 * Contributing factors, when available:
 *   - Completion % (workout summary)
 *   - Session difficulty  (self-reported session RPE, or avgRpe fallback)
 *   - Performance vs recent baseline (e1RM delta ratio)
 *   - Recent training load  (last-7d workout frequency)
 *   - Overall rating / strength / fatigue feel (from workout review)
 *   - Pain flag
 *
 * The score is intentionally simple and clamped — it's meant to be a
 * directional recovery gauge, not a diagnostic tool.
 */

export interface RecoveryInputs {
  /** 0–100 workout completion percentage. */
  completionPct?: number | null;
  /** Avg set RPE for the session (1–10). Falls back to sessionRpe when absent. */
  avgRpe?: number | null;
  /** Self-reported session RPE (1–10). Preferred over avgRpe. */
  sessionRpe?: number | null;
  /** Client overall session rating (1–5). Higher = felt better. */
  overallRating?: number | null;
  /** Strength feel bucket: "strong" | "normal" | "weak" (or free text). */
  strengthFeel?: string | null;
  /** Fatigue feel bucket: "fresh" | "normal" | "fatigued" (or free text). */
  fatigueFeel?: string | null;
  /** Pain reported for the session. */
  pain?: boolean | null;
  /** e1RM ratio vs recent baseline. e.g. 1.02 = 2% above, 0.95 = 5% below. */
  performanceRatio?: number | null;
  /** Recent training load — workouts in the last 7 days including this one. */
  recentWorkouts7d?: number | null;
}

export interface RecoveryReason {
  label: string;
  value: string;
}

export interface RecoveryResult {
  score: number;
  reasons: RecoveryReason[];
  /** true when we had enough signal to produce a meaningful score. */
  hasData: boolean;
}

function bucketRpe(rpe: number): "moderate" | "hard" | "very_hard" | "easy" {
  if (rpe >= 9) return "very_hard";
  if (rpe >= 8) return "hard";
  if (rpe >= 6) return "moderate";
  return "easy";
}

function rpeLabel(b: string): string {
  return b === "very_hard" ? "Very Hard"
    : b === "hard" ? "Hard"
    : b === "moderate" ? "Moderate"
    : "Easy";
}

function loadLabel(n: number): string {
  if (n >= 6) return "Very High";
  if (n >= 4) return "High";
  if (n >= 2) return "Moderate";
  return "Light";
}

function perfLabel(ratio: number): string {
  if (ratio >= 1.05) return "Well Above Average";
  if (ratio >= 1.02) return "Above Average";
  if (ratio >= 0.98) return "On Par";
  if (ratio >= 0.95) return "Slightly Below";
  return "Below Average";
}

/**
 * Compute the estimated recovery score.
 * Starts at a neutral 78 and adjusts per available factor.
 */
export function computeRecoveryScore(inp: RecoveryInputs): RecoveryResult {
  const reasons: RecoveryReason[] = [];
  let score = 78;
  let signals = 0;

  // Completion — big lever. Poor completion often signals fatigue/injury.
  if (inp.completionPct != null) {
    signals++;
    const c = Math.max(0, Math.min(100, inp.completionPct));
    if (c >= 95) score += 4;
    else if (c >= 80) score += 1;
    else if (c >= 60) score -= 4;
    else score -= 10;
    reasons.push({ label: "Completion", value: `${Math.round(c)}%` });
  }

  // Session difficulty — higher effort = more fatigue.
  const effRpe = inp.sessionRpe ?? inp.avgRpe ?? null;
  if (effRpe != null && Number.isFinite(effRpe)) {
    signals++;
    const bucket = bucketRpe(Number(effRpe));
    if (bucket === "very_hard") score -= 14;
    else if (bucket === "hard") score -= 6;
    else if (bucket === "moderate") score += 2;
    else score += 4;
    reasons.push({ label: "Session Difficulty", value: rpeLabel(bucket) });
  }

  // Performance vs recent baseline.
  if (inp.performanceRatio != null && Number.isFinite(inp.performanceRatio)) {
    signals++;
    const r = Number(inp.performanceRatio);
    if (r >= 1.05) score += 8;
    else if (r >= 1.02) score += 4;
    else if (r >= 0.98) score += 0;
    else if (r >= 0.95) score -= 4;
    else score -= 8;
    reasons.push({ label: "Performance", value: perfLabel(r) });
  }

  // Recent training frequency — high volume weeks tax recovery.
  if (inp.recentWorkouts7d != null) {
    signals++;
    const n = Math.max(0, inp.recentWorkouts7d);
    if (n >= 6) score -= 6;
    else if (n >= 4) score -= 2;
    else if (n >= 2) score += 1;
    else score += 2;
    reasons.push({ label: "Recent Training Load", value: loadLabel(n) });
  }

  // Overall rating (1–5).
  if (inp.overallRating != null) {
    signals++;
    const r = Math.max(1, Math.min(5, inp.overallRating));
    score += (r - 3) * 3; // 5 -> +6, 3 -> 0, 1 -> -6
    reasons.push({ label: "Session Feel", value: `${r}/5` });
  }

  // Strength / fatigue feel — small nudges.
  if (inp.strengthFeel) {
    const s = inp.strengthFeel.toLowerCase();
    if (s.includes("strong") || s.includes("great")) score += 2;
    else if (s.includes("weak") || s.includes("poor")) score -= 3;
  }
  if (inp.fatigueFeel) {
    const f = inp.fatigueFeel.toLowerCase();
    if (f.includes("fresh") || f.includes("energ")) score += 2;
    else if (f.includes("fatigued") || f.includes("tired") || f.includes("drained")) score -= 4;
  }

  if (inp.pain) {
    signals++;
    score -= 10;
    reasons.push({ label: "Pain", value: "Reported" });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, reasons, hasData: signals > 0 };
}

export function recoveryTrendLabel(current: number | null, previous: number | null): "Improving" | "Stable" | "Declining" | null {
  if (current == null || previous == null) return null;
  const diff = current - previous;
  if (Math.abs(diff) < 5) return "Stable";
  return diff > 0 ? "Improving" : "Declining";
}