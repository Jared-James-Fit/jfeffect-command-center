// Validates a Program Library template payload for missing prescription
// requirements. Used in two places:
//   1) The workout builder shows a per-day banner so coaches see gaps live.
//   2) The "Assign to client" flow blocks confirmation when any day is
//      incomplete and lists every issue so nothing silent ships to a client.

export type DayIssue = {
  /** Human-readable location, e.g. "Block: Hypertrophy · Week 2 · Day 1 — Push". */
  location: string;
  /** One short bullet per missing requirement on this day. */
  missing: string[];
};

export type RowProblem =
  | "exercise"   // no exercise picked and no custom name
  | "sets"       // sets blank
  | "reps";      // reps blank

const ROW_LABEL: Record<RowProblem, string> = {
  exercise: "exercise name",
  sets: "sets",
  reps: "reps",
};

function rowProblems(row: any): RowProblem[] {
  const issues: RowProblem[] = [];
  const hasExercise =
    (row?.exercise_id != null && row.exercise_id !== "") ||
    (typeof row?.exercise_name_override === "string" && row.exercise_name_override.trim().length > 0);
  if (!hasExercise) issues.push("exercise");
  if (row?.sets == null || row.sets === "") issues.push("sets");
  if (typeof row?.reps_text !== "string" || row.reps_text.trim().length === 0) issues.push("reps");
  return issues;
}

/**
 * Validate a single day. Returns the list of human-readable missing items
 * for the day, e.g. ["Day has no exercises", "Row 2 — Squat: missing reps"].
 */
export function validateDay(day: any): string[] {
  const missing: string[] = [];
  const rows: any[] = Array.isArray(day?.rows) ? day.rows : [];
  if (rows.length === 0) {
    missing.push("Day has no exercises yet");
    return missing;
  }
  rows.forEach((r, i) => {
    const probs = rowProblems(r);
    if (probs.length === 0) return;
    const name =
      (typeof r?.exercise_name_override === "string" && r.exercise_name_override.trim()) ||
      r?.exercise_name ||
      `Row ${i + 1}`;
    missing.push(`${name}: missing ${probs.map((p) => ROW_LABEL[p]).join(", ")}`);
  });
  return missing;
}

function dayLabel(day: any, prefix: string, dayIndex: number): string {
  const base = `${prefix}Day ${day?.day_index ?? dayIndex + 1}`;
  const title = typeof day?.title === "string" && day.title.trim().length > 0 ? ` — ${day.title.trim()}` : "";
  return base + title;
}

function walkWeek(week: any, prefix: string, out: DayIssue[]) {
  const days: any[] = Array.isArray(week?.days) ? week.days : [];
  days.forEach((d, di) => {
    const missing = validateDay(d);
    if (missing.length > 0) out.push({ location: dayLabel(d, prefix, di), missing });
  });
}

function walkBlock(block: any, prefix: string, out: DayIssue[]) {
  const weeks: any[] = Array.isArray(block?.weeks_data) ? block.weeks_data : [];
  weeks.forEach((w, wi) => {
    const wPrefix = `${prefix}Week ${w?.week_index ?? wi + 1} · `;
    walkWeek(w, wPrefix, out);
  });
}

/**
 * Walk an entire template payload (any template_type) and return every day
 * with missing requirements. Empty array means the template is ready to
 * assign without warnings.
 */
export function validateTemplatePayload(tpl: any): DayIssue[] {
  const out: DayIssue[] = [];
  if (!tpl) return out;
  const type = tpl.template_type;
  const payload = tpl.payload || {};
  if (type === "full_prep") {
    const blocks: any[] = Array.isArray(payload.blocks_data) ? payload.blocks_data : [];
    blocks.forEach((b, bi) => {
      const label = b?.name || `Block ${bi + 1}`;
      walkBlock(b, `Block: ${label} · `, out);
    });
  } else if (type === "block") {
    walkBlock(payload, "", out);
  } else if (type === "week") {
    walkWeek(payload, "", out);
  } else if (type === "day") {
    const missing = validateDay(payload);
    if (missing.length > 0) {
      out.push({ location: payload?.title ? `Day — ${payload.title}` : "Day", missing });
    }
  } else if (type === "exercise_row") {
    const probs = rowProblems(payload);
    if (probs.length > 0) {
      out.push({
        location: "Exercise row",
        missing: [`Missing ${probs.map((p) => ROW_LABEL[p]).join(", ")}`],
      });
    }
  }
  return out;
}