import { addDays, format, isWithinInterval, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

/** Compute a single week's date range from the block start. */
export function computeWeekRange(
  blockStart: string | null | undefined,
  weekIndex: number,
  weekDurationDays = 7,
): { start: Date; end: Date } | null {
  if (!blockStart) return null;
  const base = typeof blockStart === "string" ? parseISO(blockStart) : (blockStart as Date);
  if (!base || isNaN(base.getTime())) return null;
  const start = addDays(base, (weekIndex - 1) * weekDurationDays);
  const end = addDays(start, weekDurationDays - 1);
  return { start, end };
}

/** Compute block end date from start + number of weeks. */
export function computeBlockEnd(
  blockStart: string | null | undefined,
  weeks: number,
  weekDurationDays = 7,
): Date | null {
  if (!blockStart || !weeks) return null;
  const base = typeof blockStart === "string" ? parseISO(blockStart) : (blockStart as Date);
  if (!base || isNaN(base.getTime())) return null;
  return addDays(base, weeks * weekDurationDays - 1);
}

/** Short range string like "Jun 8 – Jun 14". Same-month omits second month. */
export function formatWeekRange(start: Date, end: Date): string {
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const s = format(start, "MMM d");
  const e = sameMonth ? format(end, "d") : format(end, "MMM d");
  return `${s} – ${e}`;
}

/** Resolve a week's display range from its stored dates or auto-compute. */
export function weekDisplayRange(
  block: { start_date?: string | null; week_duration_days?: number | null } | null | undefined,
  week: { week_index: number; start_date?: string | null; end_date?: string | null; date_source?: string | null },
): { start: Date; end: Date; source: "auto" | "manual" } | null {
  if (week.start_date && week.end_date) {
    return {
      start: parseISO(week.start_date),
      end: parseISO(week.end_date),
      source: (week.date_source as any) === "manual" ? "manual" : "auto",
    };
  }
  const r = computeWeekRange(block?.start_date ?? null, week.week_index, block?.week_duration_days ?? 7);
  if (!r) return null;
  return { ...r, source: "auto" };
}

export function isCurrentWeek(range: { start: Date; end: Date } | null): boolean {
  if (!range) return false;
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return isWithinInterval(startOfDay, { start: range.start, end: addDays(range.end, 1) });
}

/**
 * Set block start date and recompute auto-dated weeks.
 * Manual-dated weeks are preserved unless `overrideManual` is true.
 */
export async function setBlockStartDate(opts: {
  blockId: string;
  startDate: string | null; // ISO yyyy-mm-dd
  weekDurationDays?: number;
  overrideManual?: boolean;
}) {
  const { blockId, startDate, weekDurationDays, overrideManual } = opts;
  const { data: block } = await sb.from("pl_blocks").select("*").eq("id", blockId).maybeSingle();
  if (!block) throw new Error("Block not found");
  const dur = weekDurationDays ?? block.week_duration_days ?? 7;
  const end = computeBlockEnd(startDate, block.weeks ?? 0, dur);
  await sb
    .from("pl_blocks")
    .update({
      start_date: startDate,
      end_date: end ? format(end, "yyyy-MM-dd") : null,
      week_duration_days: dur,
    })
    .eq("id", blockId);

  const { data: weeks } = await sb
    .from("pl_weeks")
    .select("id, week_index, date_source")
    .eq("block_id", blockId)
    .order("week_index");
  for (const w of (weeks ?? []) as any[]) {
    if (!overrideManual && w.date_source === "manual") continue;
    const r = computeWeekRange(startDate, w.week_index, dur);
    await sb
      .from("pl_weeks")
      .update({
        start_date: r ? format(r.start, "yyyy-MM-dd") : null,
        end_date: r ? format(r.end, "yyyy-MM-dd") : null,
        date_source: "auto",
      })
      .eq("id", w.id);
  }
}

export async function setWeekDates(weekId: string, start: string | null, end: string | null) {
  await sb
    .from("pl_weeks")
    .update({ start_date: start, end_date: end, date_source: "manual" })
    .eq("id", weekId);
}

export async function resetWeekToAuto(weekId: string) {
  const { data: w } = await sb.from("pl_weeks").select("*, pl_blocks(start_date, week_duration_days)").eq("id", weekId).maybeSingle();
  if (!w) return;
  const block = (w as any).pl_blocks ?? {};
  const r = computeWeekRange(block.start_date, w.week_index, block.week_duration_days ?? 7);
  await sb
    .from("pl_weeks")
    .update({
      start_date: r ? format(r.start, "yyyy-MM-dd") : null,
      end_date: r ? format(r.end, "yyyy-MM-dd") : null,
      date_source: "auto",
    })
    .eq("id", weekId);
}

export async function countManualWeeks(blockId: string): Promise<number> {
  const { count } = await sb
    .from("pl_weeks")
    .select("id", { count: "exact", head: true })
    .eq("block_id", blockId)
    .eq("date_source", "manual");
  return count ?? 0;
}