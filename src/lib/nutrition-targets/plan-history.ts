/**
 * A client's nutrition plans over time: one current plan, every earlier one
 * kept as "Archived" with the dates it actually ran. Publishing a new plan
 * (the AI's Update plan, the editor, or Use again on an old one) never
 * deletes the one before it. Pure; the writes are in plan-publish.ts.
 */
import { addDays, addMonths, format, parseISO } from "date-fns";
import { carryPlanDayRules } from "@/lib/client-nutrition-day";
import { dayKey, parseAiCardio } from "@/lib/nutrition-cardio-sync";

export type PlanRow = {
  id: string;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_updated_at?: string | null;
  nutrition_target_days?: Array<Record<string, any>> | null;
  [k: string]: any;
};

export const isArchived = (t: Pick<PlanRow, "status">) => t.status === "Archived";

/** When the plan was last written (published or edited), for "Updated Nov 2". */
export function planUpdatedAt(t: Pick<PlanRow, "last_updated_at" | "updated_at" | "created_at">): string | null {
  return t.last_updated_at ?? t.updated_at ?? t.created_at ?? null;
}

/** The current plan(s) first (newest start), then earlier ones (most recently ended first). */
export function splitPlans<T extends PlanRow>(rows: T[]): { current: T[]; previous: T[] } {
  const byStart = (a: T, b: T) => String(b.start_date ?? "").localeCompare(String(a.start_date ?? ""));
  const current = rows.filter((t) => !isArchived(t)).sort(byStart);
  const previous = rows
    .filter(isArchived)
    .sort((a, b) => String(b.end_date ?? b.start_date ?? "").localeCompare(String(a.end_date ?? a.start_date ?? "")) || byStart(a, b));
  return { current, previous };
}

/**
 * The day a replaced plan stopped: the day before its replacement starts
 * (never before its own start), or the end it already had if that came first.
 */
export function replacedEndDate(start: string | null, end: string | null, newStart: string): string {
  if (end && end < newStart) return end;
  const dayBefore = format(addDays(parseISO(newStart), -1), "yyyy-MM-dd");
  return start && start > dayBefore ? start : dayBefore;
}

/** A new plan runs from today for a month: the monthly Nutrition Update lands in its last week. */
export function nextPlanDates(today: string): { start_date: string; end_date: string } {
  return { start_date: today, end_date: format(addMonths(parseISO(today), 1), "yyyy-MM-dd") };
}

const fmt = (iso: string, year: boolean) => format(parseISO(iso), year ? "MMM d, yyyy" : "MMM d");

/** "Dec 2", with the year when it isn't this year. */
export function planDate(iso: string, today = new Date().toISOString().slice(0, 10)): string {
  return fmt(iso, iso.slice(0, 4) !== today.slice(0, 4));
}

/** "Oct 27 – Nov 27, 2026", "Aug 16, 2026 – ongoing". */
export function planPeriod(t: Pick<PlanRow, "start_date" | "end_date">): string {
  if (!t.start_date) return "No dates";
  if (!t.end_date) return `${fmt(t.start_date, true)} – ongoing`;
  const sameYear = t.start_date.slice(0, 4) === t.end_date.slice(0, 4);
  return `${fmt(t.start_date, !sameYear)} – ${fmt(t.end_date, true)}`;
}

const KEEP_OUT = new Set(["id", "created_at", "updated_at", "nutrition_target_days", "target_id"]);

/** An earlier plan as a fresh current one (Use again): same plan, new dates, nothing shared with the old row. */
export function reusePlanPayload(old: PlanRow, dates: { start_date: string; end_date: string }, now: string) {
  const payload: Record<string, any> = {};
  for (const [k, v] of Object.entries(old)) if (!KEEP_OUT.has(k)) payload[k] = v;
  return { ...payload, ...dates, status: "Active", last_updated_at: now };
}

/** The old plan's days, ready to insert under a new plan id. */
export function copyPlanDays(days: Array<Record<string, any>> | null | undefined) {
  return (days ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((d, i) => {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(d)) if (!KEEP_OUT.has(k)) out[k] = v;
      return { ...out, sort_order: i };
    });
}

export type AiDay = {
  day_label: string;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
  fibre?: number | null;
  notes?: string | null;
};

/**
 * The AI plan's days as the client's plan: its meals and numbers, the day's
 * steps from the targets, and when each day is used (training / rest / high,
 * weekdays) carried over from the plan they're on by day name.
 */
export function aiPlanDays(parsed: AiDay[], targetsText: string | null | undefined, currentDays: Array<Record<string, any>> | null | undefined) {
  const cardio = parseAiCardio(targetsText);
  const days = parsed.map((d, i) => ({
    day_label: d.day_label,
    calories: d.calories ?? null,
    protein: d.protein ?? null,
    carbs: d.carbs ?? null,
    fats: d.fats ?? null,
    fibre: d.fibre ?? null,
    notes: d.notes ?? null,
    steps: cardio.get(dayKey(d.day_label))?.steps ?? null,
    sort_order: i,
  }));
  return carryPlanDayRules(currentDays as any, days as any) as typeof days;
}
