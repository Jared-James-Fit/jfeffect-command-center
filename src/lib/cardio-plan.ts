/**
 * Cardio planning helpers.
 *
 * Two jobs:
 *  1. Resolve a *suggested* default setup for steady-state (Zone 2 / LISS)
 *     cardio so a target that only says "LISS" still gives the athlete a
 *     concrete, sensible prescription to follow.
 *  2. Resolve the completion status of a prescribed cardio session so the
 *     workout logger can show Not started / Logged / Skipped.
 *
 * Suggestions NEVER overwrite coach-set values — the coach's own duration,
 * intensity, HR zone or machine always wins. The suggestion only fills gaps.
 */

export type CardioTargetLike = {
  cardio_type?: string | null;
  custom_type?: string | null;
  duration_minutes?: number | null;
  intensity?: string | null;
  heart_rate_zone?: string | null;
  machine_preference?: string | null;
};

export type CardioCompletionLike = {
  completed?: boolean | null;
  skipped?: boolean | null;
  duration_minutes?: number | null;
} | null | undefined;

export type CardioStatus = "not_started" | "logged" | "skipped";

export function cardioStatus(completion: CardioCompletionLike): CardioStatus {
  if (!completion) return "not_started";
  if (completion.skipped) return "skipped";
  if (completion.completed) return "logged";
  return "not_started";
}

export function cardioStatusLabel(status: CardioStatus): string {
  return status === "logged" ? "Logged" : status === "skipped" ? "Skipped" : "Not started";
}

const STEADY_PATTERNS = /(liss|zone\s*2|z2|steady|low\s*intensity|incline\s*walk|walking|walk)/i;

/** True when the target is a steady-state / Zone 2 style prescription. */
export function isSteadyStateCardio(target: CardioTargetLike): boolean {
  const hay = [
    target.cardio_type,
    target.custom_type,
    target.intensity,
    target.heart_rate_zone,
  ]
    .filter(Boolean)
    .join(" ");
  if (/hiit|interval|sprint/i.test(hay)) return false;
  return STEADY_PATTERNS.test(hay);
}

export type CardioSuggestion = {
  durationMinutes: number;
  intensity: string;
  heartRateZone: string;
  machine: string;
  /** Treadmill-style guidance shown as a hint, never auto-saved. */
  speedHint: string;
  inclineHint: string;
  rpeHint: string;
  summary: string;
};

/**
 * Default Zone 2 / LISS setup. Conservative, conversational-pace work that
 * suits most clients: 30 minutes, HR zone 2, RPE 3–4.
 */
export function suggestSteadyStateSetup(target: CardioTargetLike): CardioSuggestion {
  const durationMinutes = Number(target.duration_minutes) > 0
    ? Number(target.duration_minutes)
    : 30;
  const intensity = target.intensity?.trim() || "Low (conversational pace)";
  const heartRateZone = target.heart_rate_zone?.trim() || "Zone 2 (60–70% max HR)";
  const machine = target.machine_preference?.trim() || "Treadmill (incline walk)";
  return {
    durationMinutes,
    intensity,
    heartRateZone,
    machine,
    speedHint: "3.0–3.5 mph / 5.0–5.6 kph",
    inclineHint: "6–10%",
    rpeHint: "RPE 3–4",
    summary: `${durationMinutes} min · ${heartRateZone} · ${"RPE 3–4"}`,
  };
}

/** Suggested setup for a target, or null when it isn't steady-state cardio. */
export function suggestedCardioSetup(target: CardioTargetLike): CardioSuggestion | null {
  return isSteadyStateCardio(target) ? suggestSteadyStateSetup(target) : null;
}

/** Short "45 min · 5.2 km · 320 cal" style line for a logged session. */
export function formatCardioLogLine(c: {
  duration_minutes?: number | null;
  distance?: number | null;
  distance_unit?: string | null;
  calories?: number | null;
  avg_heart_rate?: number | null;
  rpe?: number | null;
}): string {
  const parts: string[] = [];
  if (Number(c.duration_minutes) > 0) parts.push(`${Number(c.duration_minutes)} min`);
  if (Number(c.distance) > 0) parts.push(`${Number(c.distance)} ${c.distance_unit || "km"}`);
  if (Number(c.calories) > 0) parts.push(`${Number(c.calories)} cal`);
  if (Number(c.avg_heart_rate) > 0) parts.push(`${Number(c.avg_heart_rate)} bpm`);
  if (c.rpe != null) parts.push(`RPE ${Number(c.rpe)}`);
  return parts.join(" · ");
}