import { addDays, daysBetween } from "@/lib/competition/milestones";

export type PlanEvent = { id: string; name: string; meet_date: string; status: string; is_primary: boolean };
export type PlanMilestone = { label: string; date: string; event: PlanEvent; daysOut: number };

export function defaultPlanEvent(events: PlanEvent[], today: string): PlanEvent | undefined {
  return events.filter((e) => e.status === "upcoming" && e.meet_date >= today)
    .sort((a, b) => a.meet_date.localeCompare(b.meet_date) || Number(b.is_primary) - Number(a.is_primary))[0]
    ?? events.filter((e) => e.status === "completed").sort((a, b) => b.meet_date.localeCompare(a.meet_date))[0];
}

export function planMilestones(event: PlanEvent, weeks = [12, 8, 4, 2, 1]): PlanMilestone[] {
  return [...new Set(weeks)].filter((w) => Number.isInteger(w) && w > 0 && w <= 52)
    .sort((a, b) => b - a)
    .map((w) => ({ label: w + (w === 1 ? " week out" : " weeks out"), date: addDays(event.meet_date, -7 * w), event, daysOut: w * 7 }))
    .concat([{ label: "Event day", date: event.meet_date, event, daysOut: 0 }, { label: "Post-event", date: addDays(event.meet_date, 1), event, daysOut: -1 }]);
}

export function eventCountdown(event: PlanEvent, today: string) {
  const days = daysBetween(today, event.meet_date);
  return days === 0 ? "Event day" : days > 0 ? days + " days out" : Math.abs(days) + " days ago";
}

/** Resolve only a recorded date interval. Ambiguity is surfaced, not silently guessed. */
export function plansOnDate<T>(rows: T[], date: string, range: (row: T) => { start: string | null | undefined; end: string | null | undefined }): T[] {
  return rows.filter((r) => { const x = range(r); return !!x.start && x.start <= date && (!x.end || x.end >= date); });
}
