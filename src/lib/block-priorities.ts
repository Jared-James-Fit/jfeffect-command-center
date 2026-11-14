/**
 * The Block view's "Priorities": what each training day of the week is about,
 * one line per day ("Mon  Primary Bench · Secondary Squat + back-offs").
 *
 * Only ranked work counts (a label that starts Primary / Secondary / Tertiary /
 * Quaternary, from the coach or derived from the exercise's category): plain
 * accessory roles ("Lats", "Upper back") and "Assistance" are the day's
 * accessories, not its priorities. A back-off row ("Primary Squat Backoff")
 * folds into its top set, the same label is never listed twice on a day, and a
 * bare rank derived from the exercise reads with its name ("Primary · Competition
 * Squat"). Coach wording is kept as written.
 */
import { format } from "date-fns";
import { displayExerciseName } from "@/lib/exercise-display-name";

const RANKS = ["Primary", "Secondary", "Tertiary", "Quaternary"] as const;
const BACKOFF = /\s*[-–]?\s*\bback[\s-]?offs?\b\s*$/i;

export type PriorityDay = { dayId: string; dayLabel: string; items: string[] };

type DayIn = { id: string; date: Date | null; dayIndex: number | null; rows: Array<{ id?: string | null; sort_order?: number | null; exercises?: { name?: string | null } | null; exercise_name_override?: string | null }> };

function rankOf(label: string): number {
  const first = label.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const i = RANKS.findIndex((r) => r.toLowerCase() === first);
  return i;
}

export function weekPriorities(days: DayIn[], labelOf: (row: DayIn["rows"][number]) => string | null | undefined): PriorityDay[] {
  const out: PriorityDay[] = [];
  const ordered = days.slice().sort((a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity) || (a.dayIndex ?? 0) - (b.dayIndex ?? 0));
  for (const d of ordered) {
    const rows = d.rows.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const picked: Array<{ text: string; rank: number; backoffs: boolean }> = [];
    for (const r of rows) {
      const label = (labelOf(r) ?? "").trim();
      const rank = rankOf(label);
      if (!label || rank < 0) continue;
      const isBackoff = BACKOFF.test(label);
      const base = label.replace(BACKOFF, "").trim();
      const text = base.split(/\s+/).length === 1 ? `${base} · ${displayExerciseName(r as any)}` : base;
      const same = picked.find((p) => p.text.toLowerCase() === text.toLowerCase());
      if (same) { if (isBackoff) same.backoffs = true; continue; }
      picked.push({ text, rank, backoffs: isBackoff });
    }
    if (!picked.length) continue;
    picked.sort((a, b) => a.rank - b.rank);
    out.push({
      dayId: d.id,
      dayLabel: d.date ? format(d.date, "EEE") : `Day ${d.dayIndex ?? out.length + 1}`,
      items: picked.map((p) => (p.backoffs ? `${p.text} + back-offs` : p.text)),
    });
  }
  return out;
}
