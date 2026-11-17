/**
 * Meet Day — Final Preparation Checklist (pure, tested): the meet facts read
 * from a submission, the bodyweight-against-class check, when each part of
 * the checklist is due, and where the meet comes from before the athlete
 * opens it. Questions are found by `validation.meet_key`, never by their
 * wording, so the coach can reword or reorder them in the form builder.
 *
 * Weight is only ever flagged for the coach to look at: nothing here works
 * out a cut, a water load or any way to make weight.
 */
import type { AnswerLike } from "@/lib/form-logic";
import type { ReadinessIssue } from "@/lib/form-checklist";

export const MEET_CHECKLIST_FORM_TYPE = "meet_checklist";
export const MEET_CHECKLIST_FORM_ID = "c0a1e7e0-5a7e-4c0d-9f00-000000000d01";

export type MeetKey =
  | "name"
  | "meet_name"
  | "meet_date"
  | "weight_class"
  | "bodyweight"
  | "weight_concern"
  | "weight_details"
  | "handler"
  | "handler_name"
  | "handler_phone"
  | "handler_email"
  | "shoes";

export const LB_PER_KG = 2.2046226;

export type MeetFacts = {
  name: string | null;
  meetName: string | null;
  meetDate: string | null;
  weightClass: string | null;
  /** As typed, with its unit. */
  bodyweight: { value: number; unit: "kg" | "lb" } | null;
  bodyweightKg: number | null;
  weightConcern: string | null;
  weightDetails: string | null;
  handler: string | null;
  handlerContact: { name: string | null; phone: string | null; email: string | null };
};

type Q = { id: string; validation?: Record<string, unknown> | null };

function text(a: AnswerLike | undefined): string | null {
  const t = typeof a?.value_text === "string" ? a.value_text.trim() : "";
  return t || null;
}

/** The meet's facts from the answers (questions found by `validation.meet_key`). */
export function meetFacts(questions: Q[], answers: Record<string, AnswerLike | undefined>): MeetFacts {
  const byKey = new Map<MeetKey, AnswerLike | undefined>();
  for (const q of questions) {
    const key = (q.validation as any)?.meet_key as MeetKey | undefined;
    if (key && !byKey.has(key)) byKey.set(key, answers[q.id]);
  }
  const bw = byKey.get("bodyweight");
  const n = bw?.value_number != null ? Number(bw.value_number) : NaN;
  const unitRaw = (bw?.value_json as any)?.unit;
  const unit: "kg" | "lb" = unitRaw === "kg" ? "kg" : "lb";
  const bodyweight = Number.isFinite(n) && n > 0 ? { value: n, unit } : null;
  const date = text(byKey.get("meet_date"));
  return {
    name: text(byKey.get("name")),
    meetName: text(byKey.get("meet_name")),
    meetDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    weightClass: text(byKey.get("weight_class")),
    bodyweight,
    bodyweightKg: bodyweight ? (bodyweight.unit === "kg" ? bodyweight.value : bodyweight.value / LB_PER_KG) : null,
    weightConcern: text(byKey.get("weight_concern")),
    weightDetails: text(byKey.get("weight_details")),
    handler: text(byKey.get("handler")),
    handlerContact: {
      name: text(byKey.get("handler_name")),
      phone: text(byKey.get("handler_phone")),
      email: text(byKey.get("handler_email")),
    },
  };
}

/** A class's limit in kg ("Men's 83 kg" → 83); null for a "+" class or words it can't read. */
export function classLimitKg(cls: string | null | undefined): number | null {
  const t = String(cls ?? "").trim();
  if (!t || /\+/.test(t)) return null;
  const m = t.match(/(\d+(?:\.\d+)?)\s*(kg|lb|lbs)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const kg = /lb/i.test(m[2] ?? "") ? n / LB_PER_KG : n;
  return kg >= 30 && kg <= 200 ? kg : null;
}

/** Whole days from `today` to the meet (negative once it's past). Both YYYY-MM-DD. */
export function daysUntil(meetDate: string | null | undefined, today: string): number | null {
  if (!meetDate || !/^\d{4}-\d{2}-\d{2}$/.test(meetDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+meetDate.slice(0, 4), +meetDate.slice(5, 7) - 1, +meetDate.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function daysOutLabel(days: number | null): string | null {
  if (days == null) return null;
  if (days < 0) return days === -1 ? "Yesterday" : `${-days} days ago`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days} days out`;
}

export type WeightCheck = {
  limitKg: number;
  bodyweightKg: number;
  /** Positive: over the limit. */
  overKg: number;
  overPct: number;
  severity: "critical" | "important";
  line: string;
};

const show = (kg: number, unit: "kg" | "lb") => (unit === "lb" ? `${(kg * LB_PER_KG).toFixed(1)} lb` : `${kg.toFixed(1)} kg`);

/**
 * Bodyweight against the class, only when they're over it: within two weeks
 * of the meet any amount over is flagged, critical when it's more than 2% of
 * the limit with a week or less to go. Further out it's left to the coach's
 * own plan (a planned cut is normal). Never a recommendation.
 */
export function weightCheck(f: Pick<MeetFacts, "bodyweightKg" | "weightClass" | "bodyweight">, days: number | null): WeightCheck | null {
  const limit = classLimitKg(f.weightClass);
  if (limit == null || f.bodyweightKg == null) return null;
  const over = f.bodyweightKg - limit;
  if (over <= 0.05) return null;
  if (days != null && days > 14) return null;
  const pct = (over / limit) * 100;
  const severity = pct > 2 && days != null && days <= 7 ? "critical" : "important";
  const unit = f.bodyweight?.unit ?? "kg";
  const when = days == null ? "" : days <= 0 ? ", meet day" : `, ${days} ${days === 1 ? "day" : "days"} out`;
  return {
    limitKg: limit,
    bodyweightKg: f.bodyweightKg,
    overKg: over,
    overPct: pct,
    severity,
    line: `${show(over, unit)} (${pct.toFixed(1)}%) over the ${Number.isInteger(limit) ? limit : limit.toFixed(1)} kg limit${when}`,
  };
}

/** Issues the meet facts add to the checklist's own (the weight area). */
export function meetIssues(f: MeetFacts, today: string, weightArea = "weight"): ReadinessIssue[] {
  const check = weightCheck(f, daysUntil(f.meetDate, today));
  if (!check) return [];
  return [{ area: weightArea, severity: check.severity, kind: "flag", label: "Bodyweight vs class", detail: check.line, questionId: "" }];
}

export type TimelineStep = { key: "review" | "pack" | "final"; label: string; date: string; daysOut: number };

function addDays(date: string, n: number): string {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * When each part is due, counted back from the meet: go through it two
 * weeks out (time to order a singlet, renew a membership, find a handler),
 * pack two days out, a last look the day before. A meet that needs travel
 * moves packing a day earlier.
 */
export function meetTimeline(meetDate: string | null, opts: { travelling?: boolean } = {}): TimelineStep[] {
  if (!meetDate || !/^\d{4}-\d{2}-\d{2}$/.test(meetDate)) return [];
  const pack = opts.travelling ? 3 : 2;
  return [
    { key: "review", label: "Go through the checklist", date: addDays(meetDate, -14), daysOut: 14 },
    { key: "pack", label: "Pack and confirm", date: addDays(meetDate, -pack), daysOut: pack },
    { key: "final", label: "Last look at anything open", date: addDays(meetDate, -1), daysOut: 1 },
  ];
}

/** The step that's due now (the latest one on or before today), or null before the first. */
export function currentStep(steps: TimelineStep[], today: string): TimelineStep | null {
  let cur: TimelineStep | null = null;
  for (const s of steps) if (s.date <= today) cur = s;
  return cur;
}

// ── Where the meet comes from before they open the form ─────────────────────

export type MeetSource = "sent" | "prep" | "plan";
export type MeetGuess = {
  name: string | null;
  date: string | null;
  weightClass: string | null;
  source: MeetSource;
};

/**
 * The meet the checklist is for: the one the coach picked when sending it,
 * else the next meet prep the athlete can see, else the primary (then the
 * soonest) meet on their competition plan, never one that's already past.
 */
export function pickMeet(
  opts: {
    sent?: { name?: string | null; date?: string | null; weight_class?: string | null } | null;
    preps?: Array<{ event_name?: string | null; title?: string | null; event_date?: string | null; weight_class?: string | null; status?: string | null; archived?: boolean | null }>;
    plan?: { primary?: { name?: string | null; level?: string | null; date?: string | null } | null; meets?: Array<{ name?: string | null; level?: string | null; date?: string | null }>; weightClass?: string | null } | null;
  },
  today: string,
): MeetGuess | null {
  const ahead = (d: string | null | undefined) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today;
  const s = opts.sent;
  if (s && (s.name || s.date)) {
    return { name: s.name?.trim() || null, date: ahead(s.date) ? s.date! : null, weightClass: s.weight_class?.trim() || null, source: "sent" };
  }
  const prep = (opts.preps ?? [])
    .filter((p) => !p.archived && p.status !== "Archived" && ahead(p.event_date))
    .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))[0];
  if (prep) {
    return { name: (prep.event_name || prep.title || "").trim() || null, date: prep.event_date!, weightClass: prep.weight_class?.trim() || opts.plan?.weightClass || null, source: "prep" };
  }
  const plan = opts.plan;
  if (plan) {
    const meets = [plan.primary, ...(plan.meets ?? [])].filter((m): m is NonNullable<typeof m> => !!m && ahead(m.date));
    const primary = plan.primary && ahead(plan.primary.date) ? plan.primary : null;
    const soonest = [...meets].sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
    const m = primary ?? soonest;
    if (m) return { name: (m.name || m.level || "").trim() || null, date: m.date!, weightClass: plan.weightClass ?? null, source: "plan" };
  }
  return null;
}

/** The latest weigh-in worth suggesting: its value in the athlete's unit and how old it is. */
export function bodyweightSuggestion(
  latest: { date: string; kg: number } | null,
  unit: "kg" | "lb",
  today: string,
): { value: number; unit: "kg" | "lb"; date: string; ageDays: number; fresh: boolean } | null {
  if (!latest || !Number.isFinite(latest.kg) || latest.kg <= 0) return null;
  // daysUntil(a, b) is a − b: today minus the weigh-in is how old it is.
  const age = daysUntil(today, latest.date);
  const ageDays = age == null ? 99 : Math.max(0, age);
  const value = unit === "kg" ? Math.round(latest.kg * 10) / 10 : Math.round(latest.kg * LB_PER_KG * 10) / 10;
  // Morning bodyweight: only yesterday's or today's goes in by itself; older is a hint they tap.
  return { value, unit, date: latest.date, ageDays, fresh: ageDays <= 1 };
}

/** "≈ 83.9 kg" under a number typed in the other unit. */
export function otherUnit(value: number | null | undefined, unit: "kg" | "lb"): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return unit === "lb" ? `≈ ${(value / LB_PER_KG).toFixed(1)} kg` : `≈ ${(value * LB_PER_KG).toFixed(1)} lb`;
}
