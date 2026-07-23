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
  /** Optional self-reported recovery for the day (1–5). Higher = better. */
  recoveryToday?: number | null;
  /** Optional self-reported sleep bucket the night before. */
  sleepBucket?: SleepBucket | null;
}

export type SleepBucket = "lt5" | "5_6" | "6_7" | "7_8" | "8_9" | "gte9";

/** Midpoint hours for a sleep bucket. */
export function sleepBucketHours(b: SleepBucket | null | undefined): number | null {
  if (!b) return null;
  switch (b) {
    case "lt5": return 4.5;
    case "5_6": return 5.5;
    case "6_7": return 6.5;
    case "7_8": return 7.5;
    case "8_9": return 8.5;
    case "gte9": return 9.5;
  }
}

export function sleepBucketLabel(b: SleepBucket | null | undefined): string {
  if (!b) return "—";
  return { lt5: "<5h", "5_6": "5–6h", "6_7": "6–7h", "7_8": "7–8h", "8_9": "8–9h", gte9: "9h+" }[b];
}

/** Contribution of sleep to readiness score, bounded so one night can't dominate. */
function sleepDelta(b: SleepBucket | null | undefined): { delta: number; label: string } | null {
  if (!b) return null;
  const map: Record<SleepBucket, { delta: number; label: string }> = {
    lt5: { delta: -6, label: "<5h" },
    "5_6": { delta: -3, label: "5–6h" },
    "6_7": { delta: 1, label: "6–7h" },
    "7_8": { delta: 4, label: "7–8h" },
    "8_9": { delta: 5, label: "8–9h" },
    gte9: { delta: 3, label: "9h+" },
  };
  return map[b];
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

  // Recovery Today — direct self-report. Strong but capped signal.
  if (inp.recoveryToday != null) {
    signals++;
    const r = Math.max(1, Math.min(5, inp.recoveryToday));
    // 1 -> -12, 2 -> -6, 3 -> 0, 4 -> +6, 5 -> +10
    const map: Record<number, number> = { 1: -12, 2: -6, 3: 0, 4: 6, 5: 10 };
    score += map[r] ?? 0;
    const labels: Record<number, string> = {
      1: "Very Poor",
      2: "Poor",
      3: "Average",
      4: "Good",
      5: "Excellent",
    };
    reasons.push({ label: "Recovery Today", value: labels[r] });
  }

  // Sleep — bounded ±6 pts so one bad night influences but doesn't determine readiness.
  const sd = sleepDelta(inp.sleepBucket);
  if (sd) {
    signals++;
    score += sd.delta;
    reasons.push({ label: "Sleep", value: sd.label });
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

/**
 * Fetch per-session recovery scores for a client over a date range.
 * Sources (merged, deduped by scheduled_workout_id/day):
 *   - member_workout_reviews (richest signal when present)
 *   - pl_day_completions (session_rating) + pl_row_results (avg RPE/RIR)
 *
 * Requires a Supabase client so this stays framework-agnostic.
 */
export async function fetchRecoveryScoreSeries(
  supabase: any,
  clientId: string,
  sinceIso: string,
  untilIso?: string | null,
): Promise<Array<{ ts: string; score: number }>> {
  const parseRir = (v: any): number | null => {
    if (v == null) return null;
    const n = Number(String(v).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  // 1) Reviews (may be empty for most projects)
  let reviewsQ = supabase
    .from("member_workout_reviews")
    .select(
      "overall_rating, session_rpe, strength_feel, fatigue_feel, pain, recovery_today, sleep_bucket, review_submitted_at, member_plan_enrollments!inner(client_id)",
    )
    .eq("member_plan_enrollments.client_id", clientId)
    .gte("review_submitted_at", sinceIso);
  if (untilIso) reviewsQ = reviewsQ.lte("review_submitted_at", untilIso);
  const { data: reviews } = await reviewsQ;

  // 2) Completions
  let compQ = supabase
    .from("pl_day_completions")
    .select("id, day_id, scheduled_workout_id, completed_at, session_rating, logging_percentage")
    .eq("client_id", clientId)
    .not("completed_at", "is", null)
    .gte("completed_at", sinceIso);
  if (untilIso) compQ = compQ.lte("completed_at", untilIso);
  const { data: comps } = await compQ;

  // Sleep buckets from pl_workout_feedback, keyed by completion_id.
  let fbQ = supabase
    .from("pl_workout_feedback")
    .select("completion_id, sleep_bucket")
    .eq("client_id", clientId)
    .not("sleep_bucket", "is", null);
  const { data: feedbacks } = await fbQ;
  const sleepByCompletion = new Map<string, SleepBucket>();
  for (const f of (feedbacks ?? []) as any[]) {
    if (f.completion_id && f.sleep_bucket) sleepByCompletion.set(f.completion_id, f.sleep_bucket);
  }

  // 3) Row results (for avg RPE/RIR per session)
  let rowsQ = supabase
    .from("pl_row_results")
    .select("scheduled_workout_id, row_id, actual_rpe_num, actual_rpe, actual_rir, completed_at")
    .eq("client_id", clientId)
    .not("completed_at", "is", null)
    .gte("completed_at", sinceIso);
  if (untilIso) rowsQ = rowsQ.lte("completed_at", untilIso);
  const { data: rows } = await rowsQ;

  // Group row RPE/RIR by scheduled_workout_id + by date fallback.
  const byInstance = new Map<string, { rpe: number[]; rir: number[] }>();
  const byDate = new Map<string, { rpe: number[]; rir: number[] }>();
  for (const r of (rows ?? []) as any[]) {
    const rpe =
      r.actual_rpe_num != null && Number.isFinite(Number(r.actual_rpe_num))
        ? Number(r.actual_rpe_num)
        : r.actual_rpe != null
          ? Number(String(r.actual_rpe).replace(/[^0-9.]/g, ""))
          : NaN;
    const rir = parseRir(r.actual_rir);
    const dateKey = String(r.completed_at).slice(0, 10);
    const inst = r.scheduled_workout_id ? `i:${r.scheduled_workout_id}` : null;
    if (inst) {
      if (!byInstance.has(inst)) byInstance.set(inst, { rpe: [], rir: [] });
      if (Number.isFinite(rpe)) byInstance.get(inst)!.rpe.push(rpe);
      if (rir != null) byInstance.get(inst)!.rir.push(rir);
    }
    if (!byDate.has(dateKey)) byDate.set(dateKey, { rpe: [], rir: [] });
    if (Number.isFinite(rpe)) byDate.get(dateKey)!.rpe.push(rpe);
    if (rir != null) byDate.get(dateKey)!.rir.push(rir);
  }
  const meanOr = (a: number[]): number | null =>
    a.length ? a.reduce((s, n) => s + n, 0) / a.length : null;

  const seen = new Set<string>();
  const out: Array<{ ts: string; score: number }> = [];

  // Reviews first (richer signal). Dedupe roughly by day.
  for (const r of (reviews ?? []) as any[]) {
    const key = `r:${String(r.review_submitted_at).slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const s = computeRecoveryScore({
      overallRating: r.overall_rating ?? null,
      sessionRpe: r.session_rpe ?? null,
      strengthFeel: r.strength_feel ?? null,
      fatigueFeel: r.fatigue_feel ?? null,
      pain: !!r.pain,
      recoveryToday: r.recovery_today ?? null,
      sleepBucket: (r.sleep_bucket ?? null) as SleepBucket | null,
    });
    if (s.hasData) out.push({ ts: r.review_submitted_at, score: s.score });
  }

  // Completions
  for (const c of (comps ?? []) as any[]) {
    const dateKey = String(c.completed_at).slice(0, 10);
    const dupKey = `r:${dateKey}`;
    if (seen.has(dupKey)) continue;
    const instKey = c.scheduled_workout_id ? `i:${c.scheduled_workout_id}` : null;
    const bucket =
      (instKey && byInstance.get(instKey)) || byDate.get(dateKey) || { rpe: [], rir: [] };
    const rpeAvg = meanOr(bucket.rpe);
    const rirAvg = meanOr(bucket.rir);
    // Convert RIR to an effective RPE (RPE ≈ 10 - RIR) when RPE missing.
    const effRpe = rpeAvg ?? (rirAvg != null ? 10 - rirAvg : null);
    const s = computeRecoveryScore({
      completionPct: c.logging_percentage != null ? Number(c.logging_percentage) : null,
      overallRating: c.session_rating ?? null,
      sessionRpe: effRpe,
      sleepBucket: sleepByCompletion.get(c.id) ?? null,
    });
    if (s.hasData) out.push({ ts: c.completed_at, score: s.score });
  }

  out.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  return out;
}